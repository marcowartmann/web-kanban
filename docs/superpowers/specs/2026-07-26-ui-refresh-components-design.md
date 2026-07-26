# UI Refresh B — Component System (Design)

Date: 2026-07-26
Status: Approved design, pending spec review
Predecessor: UI Refresh A (app shell & page grammar), merged to main 73a06d8.
Restore point: git tag `pre-ui-refresh` (26bee67).

## Background

The 2026-07-26 UI audit counted ~20 independent status-chip color maps, ~20
empty-state stylings, ~14 error-message class variants, 4 loading-state variants
(many views having none), 8 verbatim copies of a `pill()` helper, two diverging
drawer families (ItemDrawer with backdrop + Delete-beside-Save vs five catalog
drawers with no backdrop + Delete-left), inert rows on the two cross-product
table views, and an inconsistent z-index ladder. Sub-project B replaces these
with shared primitives and adopts them everywhere.

User decisions shaping this spec:
- **Strict badge normalization** — one shape and one tint scale app-wide; chips
  that look different today are allowed to visibly change.
- **Escape closes every drawer/modal, except a drawer with unsaved changes.**
- **Skeleton placeholders** for loading, not text.

## Scope

In: eight shared primitives (Badge, Banner, EmptyState, Skeleton set,
SegmentedToggle, TogglePill, TabBar, Menu), DrawerShell + drawer behavior
unification, table shell + row-click editing on Lifecycle/Contracts, the
states sweep (loading/empty/error) across all views and fetching admin
sections, the z-index ladder, and the test-hygiene items deferred from A.
Out (stays in sub-project C): icon-glyph sweep outside the drawers, container
padding scale, caption/label unification, `window.prompt` removal, raw
btnPrimary/btnSecondary literal dedupe, avatar palette merge, dark-remap
additions beyond what Badge makes moot.

No backend changes.

## 1. Display primitives (new files in `frontend/src/components/`)

### Badge

```tsx
type BadgeTone = "gray" | "blue" | "emerald" | "amber" | "red" | "violet" | "indigo" | "sky";
Badge({ tone, strike = false, children }: { tone: BadgeTone; strike?: boolean; children: ReactNode })
```

Always renders `rounded-full px-2 py-0.5 text-xs font-medium` with
`bg-{tone}-50 text-{tone}-700` (`strike` adds `line-through text-gray-400`
regardless of tone — used by roadmap `cancelled`). The `-50/-700` pairing is
the dark-mode-safe combination (all `-50` tints are remapped in index.css).

Every chip mapping object becomes a `Record<X, BadgeTone>`:

| Current map | New tones |
|---|---|
| Roadmap `STATUS_CLASSES` | idea gray · planned blue · committed violet · done emerald · cancelled gray+strike |
| Service lifecycle `BADGE` | planned blue · active emerald · deprecated amber · retired gray |
| `RiskBadge` / `ContractBadge` | thin wrappers over Badge (amber/red); keep render-nothing on ok/active |
| Card `kindStyles` | feature blue · risk red · story gray (visible change: soft pills) |
| ItemDrawer `KIND_CHIP` | same tones as kindStyles (slate → gray) |
| Users `statusPill` / auth chip | active emerald · inactive amber; ldap indigo · oidc violet · local gray |
| risk_scope chip | art amber · team gray |
| lifecycle_stage chip (3 copies) | gray (single shared use of Badge) |
| WSJF chips (ItemDrawer/StoryBoardModal) | amber |
| dep type / criticality (ServiceDrawer) | gray · amber |
| story status / SP chips (ItemDrawer) | gray |
| load/capacity chip (PlanningColumn) | over red · under gray |
| key-delivery chip (ObjectiveCard) | amber (keeps faStar icon inside) |

Not badges (untouched): WsjfToggle fibonacci buttons, avatars,
UtilizationMeter, Column count pills. `DeltaBadge` stays text-only but its
`green-600` becomes `emerald-600` (dark-remap gap).

### Banner

```tsx
Banner({ tone, children }: { tone: "error" | "success" | "warning"; children: ReactNode })
```

`rounded-lg px-3 py-2 text-sm` + red/emerald/amber `-50/-700`. Replaces all
error banners and bare `<p className="text-red-600">` messages, the
success messages (Snapshots/Backup/Ldap), and the amber conflict warnings
(ItemDrawer, ImportButton). **Lifecycle and Contracts gain load-error
handling** (fetch failures currently vanish): catch → `Banner tone="error"`
above the table.

### EmptyState

```tsx
EmptyState({ children, action }: { children: ReactNode; action?: ReactNode })
```

`py-12 text-center text-sm text-gray-400`, optional action row beneath.
Adopted by every view/tab/admin-card empty state; existing wordings are kept
verbatim. Not applied to drawer sub-list "None" placeholders, SearchableSelect
"No matches", or table `<td colSpan>` empties inside admin tables (those keep
their in-table treatment).

### Skeleton set

```tsx
Skeleton({ className })                    // one pulse block: motion-safe:animate-pulse rounded bg-gray-100
SkeletonRows({ rows = 5 })                 // stacked full-width row blocks (tables/lists)
SkeletonCards({ count = 6 })               // grid of card-shaped blocks (Products)
SkeletonBoard({ columns = 4 })             // column strips with card blocks (Board)
```

`motion-safe:` respects prefers-reduced-motion; gray-ramp colors are
dark-remapped for free. Replaces every "Loading…" text and fills the gaps:

| Surface | Skeleton |
|---|---|
| Board (useBoard loading) | SkeletonBoard |
| Products grid | SkeletonCards |
| ProductDetail tabs (services/systems/components/contracts — no state today) | SkeletonRows |
| Lifecycle / Contracts tables | SkeletonRows |
| Roadmap | SkeletonRows |
| Admin: Users, Snapshots, Audit Log (fetching sections) | SkeletonRows inside the card |
| ItemDrawer body load | SkeletonRows |

Planning/Timeline/Ranking receive data via WorkLayout props and render
instantly from cache — no skeleton (they never showed loading states).

## 2. Control primitives

### SegmentedToggle + TogglePill

```tsx
SegmentedToggle<T extends string>({ options: { value: T; label: string }[]; value: T; onChange: (v: T) => void; ariaLabel: string })
TogglePill({ active, onChange, children })
```

Both render the existing pill visual (`rounded-full border px-3 py-1 text-sm
font-medium`, active `border-blue-600 bg-blue-600 text-white shadow-xs`) —
one source of truth instead of 8 copies. Adoption: Timeline Mode + Lanes
(SegmentedToggle), Board KIND multi-select (TogglePill per kind), Planning
Unassigned/Capacity, Lifecycle "Only at risk", Contracts "Only expiring or
expired", ContainersSection/CapacitySection PI pill rows (SegmentedToggle).
SegmentedToggle carries `role="radiogroup"`/`role="radio"` semantics;
TogglePill uses `aria-pressed`.

### TabBar

```tsx
TabBar({ tabs: { key: string; label: ReactNode }[]; active: string; onSelect: (k: string) => void })
```

The BoardTabs underline idiom (`border-b-2`, active `border-blue-600
text-blue-700`) extracted. BoardTabs refactors onto it (keeping its
board/objectives wiring); **ProductDetail's pill tabs switch to underline
tabs** — closing the audit's four-tab-idiom finding (segmented control =
global nav only, underline = in-view tabs, sidebar = Admin).

### Menu

```tsx
Menu({ trigger: (props: TriggerProps) => ReactNode; items: MenuItem[]; ariaLabel: string })
// MenuItem = { label: string; onSelect: () => void; disabled?: boolean; danger?: boolean }
```

Accessible popover menu extracted from the StreamMenu pattern: outside-click
and Escape close, arrow-key roving focus, Home/End, Enter/Space select,
focus returns to the trigger on close. Adopted by RoadmapView's StreamMenu.
UserMenu keeps its own popover (it carries a non-item header block the Menu
API deliberately doesn't model — YAGNI) but adopts the same keyboard
contract inline: arrow-key focus movement between its menu items and
focus-return-to-trigger on Escape. Closes phase A's deferred ARIA finding.

## 3. DrawerShell + interaction unification

```tsx
DrawerShell({
  title: string;
  headerExtra?: ReactNode;          // e.g. RiskBadge
  onClose: () => void;
  footer: { onDelete?: () => void; deleteLabel?: string; onCancel: () => void; onSave: () => void; saveLabel?: string; saving?: boolean };
  children: ReactNode;
})
```

- Fixed right panel `w-[26rem]` (existing width), **with backdrop**
  `bg-black/40 backdrop-blur-xs` — click closes; Escape closes; ✕ close
  button = `closeButtonClass` (ui.ts's dead token, finally used) +
  `faXmark` from icons.ts (replacing the five ✕ text glyphs).
- Footer: **Delete far-left** (`btnDangerGhost`, omitted in create mode) ·
  Cancel (`btnSecondary`) + Save (`btnPrimary`) right — the existing catalog
  convention, now enforced by the shell.
- Adopted by the five catalog drawers: ServiceDrawer, ComponentDrawer,
  SystemDrawer, ContractDrawer, RoadmapItemDrawer (bodies unchanged).
- **ItemDrawer** keeps its custom kind-tinted header, width, and live-edit
  model but aligns behavior: Delete moves from beside-Save to far-left, and
  Escape closes it **unless unsaved changes exist** (it already tracks
  dirtiness for its "Unsaved changes" indicator).
- Remaining modals gain Escape-to-close: StoryBoardModal, UserModal,
  ObjectiveEditor, UserMenu password modal, ImportButton preview (ignored
  while the import is running). ConfirmDialog already has it.

**Z-index ladder**, documented as constants used by the components
(`ui.ts`): popover 20 · drawer overlay 40 · modal 50 · ConfirmDialog 60.
Fixes StoryBoardModal's `z-20` (below the drawer overlay) and lifts
ConfirmDialog above everything it can be launched from.

Note: drawers opened from cross-product views (section 4) must not depend on
ProductDetail-supplied option lists; where a drawer currently receives such
context via props, it gains self-contained fetching keyed on the entity it
edits (verified per-drawer in the plan).

## 4. Table shell + row-click editing

- New `thClass` token in ui.ts: `text-[11px] font-semibold uppercase
  tracking-wide text-gray-400` + the `px-3 py-2 border-b` cell conventions —
  adopted by Lifecycle, Contracts, and the admin tables (Snapshots/Backup
  align from their `text-xs font-medium` variant).
- Numeric columns (yearly cost, totals) right-aligned with `tabular-nums`.
- **LifecycleView rows open ComponentDrawer; ContractsView rows open
  ContractDrawer** — the same drawers ProductDetail uses; on save/delete the
  view refetches. Row affordance: `hover:bg-gray-50 cursor-pointer`, whole
  row clickable, and the name cell rendered as a button for keyboard/AT
  access (Enter opens). Admin tables stay non-clickable (no hover).

## 5. Testing

- Each primitive: colocated unit tests (Badge tone/strike rendering, Banner
  tones, EmptyState action slot, Skeleton reduced-motion class presence,
  SegmentedToggle radiogroup semantics + keyboard, TogglePill aria-pressed,
  TabBar underline active state, Menu full keyboard contract, DrawerShell
  Escape/backdrop/footer-order/create-mode).
- Adoption tasks preserve every existing assertion; chip assertions stay on
  visible text, never class strings.
- New behavior tests: ItemDrawer Escape-guard (dirty vs clean), Lifecycle/
  Contracts row-click opens the right drawer + refetch on change,
  Lifecycle/Contracts load-error Banner.
- Absorbed from A's deferred list: RoadmapView add-stream close-on-success /
  stay-open-on-error; kebab Move-down-disabled-on-last + delete-cancel path;
  App.auth.test.tsx history reset between tests; ProductsView.test.tsx stray
  blank line.
- Finish: Docker rebuild + Playwright walkthrough (light/dark; all drawers
  incl. Escape paths and backdrop; row-click editing on both table views;
  menus with keyboard; skeletons visible on throttled load or verified by
  component test only).

## 6. Build order

Primitives first, then adoption sweeps (rejected alternative: view-by-view
conversion — it churns primitives mid-flight):

1. Badge + adoption of all chip maps.
2. Banner + EmptyState + adoption (including Lifecycle/Contracts error
   handling).
3. Skeleton set + loading sweep.
4. SegmentedToggle/TogglePill + adoption; TabBar + BoardTabs/ProductDetail.
5. Menu + StreamMenu/UserMenu adoption.
6. Z-ladder constants + modal Escape sweep.
7. DrawerShell + five catalog drawers.
8. ItemDrawer behavior alignment (Delete placement, Escape guard).
9. Table shell + Lifecycle/Contracts row-click editing.
10. Stack verification + docs (CLAUDE.md conventions section, ledger).

Detailed task breakdown lives in the implementation plan.
