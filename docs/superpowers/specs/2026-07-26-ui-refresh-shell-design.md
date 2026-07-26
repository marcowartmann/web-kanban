# UI Refresh A — App Shell & Page Grammar (Design)

Date: 2026-07-26
Status: Approved design, pending spec review
Restore point: git tag `pre-ui-refresh` (26bee67)

## Background

A full UI-consistency audit (2026-07-26, code inventory + Playwright walkthrough of all
nine views in light and dark mode) found the visual foundation solid — shared tokens in
`ui.ts`, semantic dark theme, one canonical filter-bar wrapper — but page *anatomy*
inconsistent: four navigation/tab idioms, thirteen distinct placements for "Add X"
actions, page titles only in Admin, and a nine-item flat nav at its scaling ceiling.

The refresh is split into three sub-projects, each with its own spec → plan → execution
cycle:

- **A (this spec): App shell & page grammar** — sidebar navigation, URL routing,
  PageHeader, action-placement convention, Roadmap action cleanup.
- **B: Component system** — Badge, EmptyState, Banner, DrawerShell (backdrop, footer
  order, Escape, z-scale), SegmentedToggle; click-to-edit on Lifecycle/Contracts tables.
- **C: Polish** — icon glyph replacement, dark-remap gap fixes, padding scale, caption
  unification, dedupe of raw class literals.

User decisions shaping this spec: consistency **plus** in-place facelift (keep the
blue/gray identity); collapsible grouped sidebar; interaction changes in scope;
react-router with real paths; Admin keeps its internal sidebar; user menu and theme
toggle move to the sidebar footer.

## Scope

In: navigation shell, routing, page headers, action placement, filter-bar slot order,
Roadmap stream-action cleanup, and the tests for all of it.
Out: everything listed under sub-projects B and C; any backend change; Board inner-tab
routing (tabs stay component state, routable later).

## 1. Routing

New dependency: `react-router` v7 (library mode — `BrowserRouter`, `Routes`, `Route`,
`NavLink`, `Outlet`, `Navigate`, `useParams`; no framework mode, no loader API).

| Path | View |
|---|---|
| `/board` | Board (inner tabs Features & Stories / Risks / PI Objectives stay state) |
| `/planning` | PlanningView |
| `/timeline` | TimelineView |
| `/ranking` | RankingView |
| `/products` | ProductsView (grid) |
| `/products/:productId` | ProductDetail (replaces internal `selected` state; unknown id → error banner + back link) |
| `/lifecycle` | LifecycleView |
| `/contracts` | ContractsView |
| `/roadmap` | RoadmapView |
| `/admin` | `Navigate` → `/admin/users` |
| `/admin/:section` | AdminView; internal sidebar items become `NavLink`s driven by `:section`; unknown section → `/admin/users` |
| `/` and `*` | `Navigate` → `/board` |

Auth stays route-independent: when `user` is null, `LoginPage` renders regardless of
path; after login the current path is preserved (no redirect logic needed — the router
mounts around the authed shell).

Deployment: nginx already serves `try_files $uri /index.html`
(`frontend/app_locations.conf`), and the Vite dev server falls back automatically — no
config change required.

**WorkLayout.** The four work views share `useBoard` data and the ItemDrawer panel
stack, today held in `App.tsx`. That state moves to `shell/WorkLayout.tsx`, a route
layout element wrapping `/board`, `/planning`, `/timeline`, `/ranking`: it owns
`useBoard`, the people/teams/containers/departments fetches, `ObjectiveLinksContext`,
the `panels` stack, `StoryBoardModal`, the ItemDrawer overlay, and `handleChanged`, and
exposes them to child routes via `useOutletContext<WorkContext>()` (typed in
`shell/WorkLayout.tsx`). Catalog views and Admin are already self-contained and mount
directly.

`App.tsx` shrinks to: providers → `LoginPage` gate → `BrowserRouter` → flex row of
`Sidebar` + `<main className="flex min-h-0 flex-1 flex-col">` → `Routes`.

## 2. Sidebar

New files: `shell/Sidebar.tsx`, `shell/nav.ts`.

`nav.ts` exports the nav model (no JSX): groups **Work** (Board, Planning, Timeline,
Ranking) and **Catalog** (Products, Lifecycle, Contracts, Roadmap), each item
`{ path, label, icon }`, plus a separate admin-only entry `{ path: "/admin", label:
"Admin", icon }`. Sidebar renders groups with uppercase caption labels (hidden when
collapsed; a divider separates groups instead).

- Widths: expanded `w-56`, collapsed `w-14` (icon rail). Collapse state in
  `localStorage["jamra.sidebarCollapsed"]`, read once on mount.
- Brand at top: "JAMra" expanded, "J" monogram collapsed.
- Items are `NavLink`s; active `bg-blue-50 font-medium text-blue-700`, inactive
  `text-gray-600 hover:bg-gray-100` (matches today's Admin sidebar idiom; dark mode
  comes free via the existing token remap). Collapsed items show icon only with
  `title` tooltip + `aria-label`.
- Footer (pinned bottom): collapse toggle (chevron, aria-labelled), `ThemeToggle`,
  `UserMenu` (avatar only when collapsed; popover unchanged).
- Icons: nine new FontAwesome Pro **duotone** icons added to `icons.ts` (table-columns,
  list-check, timeline, ranking-star, boxes-stacked, arrows-spin, file-contract,
  map-location-dot, gear — exact names chosen from the installed FA Pro set at
  implementation time, all routed through `icons.ts` per convention).

The old header pill nav (`navButton` in App.tsx) is deleted.

## 3. PageHeader & page grammar

New file: `shell/PageHeader.tsx`.

```tsx
type PageHeaderProps = {
  title: string;
  subtitle?: ReactNode;          // e.g. "DP · Team Network"
  backTo?: { label: string; to: string };  // renders ← link above the title
  actions?: ReactNode;           // right-aligned slot
};
```

Wrapper: `flex shrink-0 items-center justify-between gap-3 border-b border-gray-200
bg-surface px-6 py-3`; title `text-lg font-semibold text-gray-900`; subtitle `text-sm
text-gray-500`. Every routed view renders a PageHeader as its first row. The global
header row is gone, so Board's vertical budget is unchanged (PageHeader replaces it
1:1); other views gain one row and a title they never had.

Canonical page anatomy, top to bottom:
**Sidebar | PageHeader (title · actions) → optional tab row → filter bar → content →
drawers/modals.**

Action placements after this change:

| View | PageHeader actions |
|---|---|
| Board — Features & Stories / Risks tabs | `NewItemBar` (+ New Feature / + New Risk), plus **Edit lanes** (`btnSecondary`, admin-only; the floating strip below the toolbar is removed) |
| Board — PI Objectives tab | **+ New objective** (`btnPrimary`), disabled with `title="Select your team first"` until a team is chosen; the objectives team-filter state lifts from `PIObjectivesBoard` into the Board page so the header button and the filter stay in sync |
| Planning / Timeline / Ranking / Lifecycle / Contracts | none (read/arrange views) — title only |
| Products | none (creation lives in Admin → Catalog; the empty state keeps saying so) |
| ProductDetail | existing per-tab **Add service / system / component / contract** buttons move into the PageHeader actions slot; back link becomes `backTo` |
| Roadmap | **+ Add stream** (`btnSecondary`) — toggles the name input row, which moves from the page bottom to directly under the filter bar |
| Admin | none; AdminView adopts `PageHeader title="Administration" subtitle=…` and drops its bespoke `text-xl` h1; internal sidebar and card layout unchanged |

Filter-bar slot order becomes the documented convention (comment in `ui.ts`):
**search → scope filters (Product / Planning Interval) → dimension filters → toggles →
`ml-auto` secondary actions.** Two views change to comply:

- **Timeline**: the "Filter features…" search moves from the sticky in-content row into
  the filter bar (leftmost), using the same search-input styling as Board's Toolbar;
  the sticky lane-gutter row keeps only the column headers.
- **Ranking**: label "Interval" → "Planning Interval"; wrapper normalized to the
  canonical string (`items-center gap-3`).

## 4. Roadmap stream-action cleanup

In the stream gutter (`RoadmapView`):

- **Kebab menu** replaces the four always-visible buttons: an icon button
  (ellipsis-vertical, aria-label `Stream actions for {name}`) opens a `popoverClass`
  popover with **Move up / Move down / Rename / Delete** entries (disabled states as
  today; Delete keeps the ConfirmDialog; Rename keeps the inline input).
- **Add item** becomes a small always-visible icon button (plus icon, aria-label
  `Add item to {name}`) next to the stream name — the floating `absolute right-1 top-1`
  button overlapping bar space is removed.
- The two new icons (ellipsis-vertical, plus) also come from FA Pro duotone via
  `icons.ts`.

## 5. Testing

- **Router**: `MemoryRouter`-based tests — each path renders its view; `/` and unknown
  paths land on Board; `/admin` redirects to `/admin/users`; `/admin/backup` renders
  the Backup section; `/products/:id` renders ProductDetail and an unknown id shows the
  error state. Existing `App.auth` tests updated for the new shell.
- **Sidebar**: groups render; Admin entry hidden for non-admin; collapse toggle flips
  the rail and persists to localStorage; active item reflects the route.
- **PageHeader**: title/subtitle/backTo/actions render; snapshot of wrapper classes not
  required (assert semantics, not class strings).
- **View updates**: Board header actions per tab (incl. disabled New-objective until
  team chosen); Roadmap kebab (open, move, rename, delete paths — existing reorder
  regression tests keep passing); Timeline search relocation (filtering behavior
  unchanged); Ranking label.
- Components with router hooks get wrapped in `MemoryRouter` in their existing tests.
- After merge: Docker rebuild, Playwright walkthrough of all views in light + dark,
  expanded + collapsed rail, plus a deep-link refresh check against nginx.

## 6. Implementation order

Router first, shell second (approach chosen for smaller reviewable steps):

1. Introduce react-router + routes behind the **existing** pill nav (nav buttons become
   `NavLink`s in place) — all view tests green with routing.
2. WorkLayout extraction (shared state via outlet context).
3. Sidebar + removal of the old header; user menu/theme to sidebar footer.
4. PageHeader + per-view adoption and action moves.
5. Roadmap cleanup; Timeline/Ranking filter-bar compliance.
6. Stack verification (Docker + Playwright) and docs.

Detailed task breakdown lives in the implementation plan.
