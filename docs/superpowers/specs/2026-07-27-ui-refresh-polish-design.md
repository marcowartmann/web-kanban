# UI Refresh C — Polish (Design)

Date: 2026-07-27
Status: Approved design, pending spec review
Predecessors: UI Refresh A (shell, merged 73a06d8) and B (component system, merged 7f62d48).
Restore point: git tag `pre-ui-refresh` (26bee67).

## Background

Sub-projects A and B rebuilt the shell and the component system. C is the closing
sweep: the audit items deliberately deferred (icon glyphs, padding scale, caption
unification, literal dedupe, `window.prompt`, avatar palettes) plus the leftovers
recorded in the A/B ledgers. After C, the UI refresh is complete.

User decisions: standardize content padding to `px-6 py-4`; drop the `+ ` prefix
from ALL create-button labels.

No backend changes. All work is mechanical sweeps with per-site lists; visual
changes are deliberate and small (padding settling, uppercase form labels,
admin buttons adopting the standard size).

## 1. Icon glyph sweep

All through `icons.ts` (FA Pro duotone), replacing text glyphs:

| Site | Today | Becomes |
|---|---|---|
| ProductDetail service tree expander | `▾` / `▸` | `faChevronDown` / `faChevronRight` (already exported) |
| ProductDetail add-sub-service | `+` | `faPlus` (already exported) |
| Drawer-body sub-list remove buttons (ServiceDrawer ×3, SystemDrawer, ContractDrawer, RoadmapItemDrawer) | `✕` | `faXmark` |
| PageHeader backTo link | `←` text | `faChevronLeft` (new export) |
| ThemeToggle | `faMoon`/`faSun` from `@fortawesome/pro-solid-svg-icons` directly | same names re-exported through `icons.ts` from the duotone package |

Aria-labels/titles stay; only the glyph rendering changes.

## 2. Padding scale

Every top-level view's scroll container standardizes to `px-6 py-4`:
Board (`px-6 pb-6`), Planning (`px-6 pb-6`), Timeline (`px-4 pb-4`),
Ranking (`p-6`), PI Objectives grid (`p-6`), Products (`px-6 py-6`),
ProductDetail (`px-6 py-6`), Roadmap/Lifecycle/Contracts (already `px-6 py-4`),
AdminView's `max-w-7xl` wrapper (`px-6 py-8` → `px-6 py-4`). Timeline's sticky
lane-header row keeps functioning (its `pt-4`/`pl-2` internals adjust so the
first row's rhythm matches).

## 3. Caption/label unification

`captionClass` (`text-[11px] font-medium uppercase tracking-wide text-gray-400`)
becomes the single convention for section captions AND form field labels:

- `font-semibold` caption variant → `captionClass`: Toolbar "Kind", TimelineView
  "Mode"/"Lanes", FilterSelect label, ContainersSection + CapacitySection
  "Planning Interval" captions, LdapSection preset caption, ItemDrawer section
  heads (its four hand-copied `text-[11px] font-semibold …` spots).
- Non-uppercase form labels (`text-xs font-medium text-gray-500`) →
  `captionClass`: BackupSection, LdapSection, ObjectiveEditor (fields become
  small uppercase captions, matching every drawer).
- The `text-xs font-semibold uppercase` fourth variant (BackupSection:105/119/161,
  LdapSection:106/122/128) → `captionClass`.

## 4. Literal dedupe

- Raw `btnPrimary` copies import the token: UsersSection "Add person",
  StoryBoardModal "Add story", NewItemDialog "Create", UserModal "Save",
  UserMenu password "Save", ObjectiveEditor "Save", LoginPage submit.
  Exception: ItemDrawer's Save keeps its deliberate `px-5 py-2` full-literal
  variant (per ui.ts's size-variant rule).
- Raw secondary/ghost copies adopt tokens: StoryBoardModal "Edit feature" →
  `btnSecondary`; AuditLogSection "Load more" → `btnSecondary`; Toolbar
  "Clear all" → `btnGhost` (keeps its icon).
- Re-typed shell literals import + compose: StoryBoardModal's inlined
  `overlayClass`; FilterSelect's re-typed `popoverClass` (becomes
  `` `${popoverClass} max-h-60 min-w-44 overflow-auto…` `` compose);
  ItemDrawer's partial popover literal (:903 area); UsersSection +
  AuditLogSection hand-rolled `adminCardClass` literals.
- `adminAddButtonClass` is deleted; admin add-rows use `btnPrimary`
  (buttons shrink from `px-4 py-2` to the app-standard `px-3 py-1.5`).
- CatalogSection's two bespoke `rounded-xl border … p-4` sections adopt
  `adminCardClass` for admin-card visual consistency.
- UsersSection per-row "Edit"/"Delete" buttons rebuild from tokens where the
  size survives (`btnSecondary`/`btnDanger` with their existing `text-xs`
  compose if non-conflicting; otherwise keep full literals per the
  size-variant rule — decided per-site in the plan).

## 5. Copy sweep — drop the `+ ` prefix everywhere

"+ New Feature" → "New Feature"; "+ New Risk" → "New Risk"; "+ New objective" →
"New objective"; "+ Add person" → "Add person"; "+ Add story" → "Add story"
(both sites); "+ Add dependency" → "Add dependency"; "+ Add stream" →
"Add stream". StoryBoardModal's empty-state sentence "Use “+ Add story” to add
the first one." updates to quote the new label. Tests adapt by accessible name
only; regex-based queries (`/new feature/i`) mostly survive unchanged.

## 6. Interaction & robustness leftovers (A/B ledger items)

- **DepartmentsSection rename**: `window.prompt` (the app's last native
  dialog) → inline rename input following the TeamsSection/CatalogSection
  idiom (Enter commits, Escape cancels).
- **Avatar palette merge**: CapacityGrid drops its local `AVATAR_COLORS`/
  `initials`/`avatarColor` and renders the shared `Avatar` component.
- **Banner adoption, last three error surfaces**: ProductDetailPage not-found
  (currently a hand-rolled red div), BoardPage board-load error
  (`p-8 text-red-600`), ItemDrawer item-load error (`p-6 text-sm text-red-600`)
  — all become `Banner tone="error"` in suitable padding wrappers.
- **Error/empty precedence**: LifecycleView + ContractsView render the
  EmptyState only when there is no error (error Banner alone on failure).
- **ProductDetail tab loaders**: the four tab fetches gain `.catch` routing
  into the existing `error` state (Banner already renders it).
- **Menu + UserMenu ArrowUp symmetry**: ArrowUp on the open trigger focuses
  the LAST enabled item (ArrowDown already focuses the first).
- **WsjfToggle dark contrast**: the lime/yellow tones' `text-gray-900`
  (remapped to near-white in dark) → `text-zinc-900` (un-remapped family,
  deliberately stable dark text on bright fills; one-line comment).

## 7. Testing & verification

- Closing the deferred test debts: UserMenu password-modal Escape test;
  ProductsView skeleton-loading test; LifecycleView's vacuous
  `queryByText("No components yet")` loading assertion fixed to a matcher
  that can actually fail.
- Sweep tasks: existing tests adapt by accessible name/label only — no
  assertion deletions; icon swaps keep aria-labels so most queries survive.
- Finish: `npm run build` + full FE suite (exit 0) + BE pytest; Docker
  frontend rebuild; Playwright walkthrough light + dark (icons render, padding
  rhythm, admin buttons, rename-inline flow, WSJF toggle in dark);
  CLAUDE.md conventions note (captionClass-for-all-labels, `px-6 py-4`
  content padding, no `+` prefixes); ledger append. Version-cut/push decision
  follows the merge (user-triggered).

## 8. Build order

1. Icons sweep (incl. icons.ts additions + ThemeToggle rerouting).
2. Padding scale.
3. Caption unification.
4. Literal dedupe (tokens + admin card/button alignment).
5. Copy sweep (labels + tests).
6. Leftovers: prompt removal, avatar merge, Banner trio, precedence, tab
   catches, ArrowUp symmetry, WsjfToggle.
7. Deferred tests + stack verification + docs.

Detailed per-site lists live in the implementation plan.
