# UI Refresh C — Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close out the UI refresh: icon-glyph sweep, one padding scale, one caption convention, token dedupe, the no-`+` copy sweep, and the A/B ledger leftovers, per `docs/superpowers/specs/2026-07-27-ui-refresh-polish-design.md`.

**Architecture:** Seven mechanical sweep tasks over the existing component system — no new primitives, no new dependencies. Every change site is enumerated; visible changes (padding settling, uppercase form labels, admin button sizing, duotone theme icons) are deliberate.

**Tech Stack:** React 18 + TS + Tailwind v4, Vitest + Testing Library, FA Pro duotone via `src/icons.ts`.

## Global Constraints

- Branch: `feat/ui-polish`, created off `main` in Task 1 Step 0.
- FA token before any npm/docker build: `export FONTAWESOME_PACKAGE_TOKEN=$(tr -d '\n' < frontend/.fa-token)` from repo root; never echo it.
- Icons only via `frontend/src/icons.ts` (duotone); never a conflicting `px-*`/`py-*` composed onto a ui.ts token; no `dark:` utilities; chip/test assertions by visible text/roles, never class strings (primitives' own tests excepted).
- Copy rule: create-button labels carry NO `+ ` prefix anywhere.
- Padding rule: every top-level view scroll container is `px-6 py-4`.
- Label rule: `captionClass` is the only caption/field-label convention.
- Tests: adapt queries by accessible name/label only; never delete/weaken an assertion. Full suite green + exit 0 after every task (`npm run test`, 482 at branch start). npm/npx from `frontend/`, git from repo root.

---

### Task 1: Icon glyph sweep

**Files:**
- Modify: `frontend/src/icons.ts`, `frontend/src/shell/PageHeader.tsx`, `frontend/src/components/ThemeToggle.tsx`, `frontend/src/components/ProductDetail.tsx` (ServiceNode), `frontend/src/components/ServiceDrawer.tsx`, `frontend/src/components/SystemDrawer.tsx`, `frontend/src/components/ContractDrawer.tsx`, `frontend/src/components/RoadmapItemDrawer.tsx`
- Test: `frontend/src/shell/PageHeader.test.tsx` (unchanged queries — verify), colocated drawer/tab tests (query adaptations only if any referenced the glyphs)

**Interfaces:**
- Produces: `faChevronLeft`, `faMoon`, `faSun` newly exported from icons.ts (duotone).

- [ ] **Step 0: Create the branch**

```bash
cd /Users/marco/Coding/web-kanban && git checkout -b feat/ui-polish
```

- [ ] **Step 1: icons.ts additions**

Append to the export block (with the existing grouping comments):

```ts
  // page chrome
  faChevronLeft,
  faMoon,
  faSun,
```

- [ ] **Step 2: Site conversions**

1. `shell/PageHeader.tsx` — the backTo link `← {backTo.label}` becomes:

```tsx
          <Link to={backTo.to} className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline">
            <FontAwesomeIcon icon={faChevronLeft} aria-hidden className="text-[10px]" />
            {backTo.label}
          </Link>
```

with `import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";` and `import { faChevronLeft } from "../icons";`.

2. `ThemeToggle.tsx` — replace `import { faMoon, faSun } from "@fortawesome/pro-solid-svg-icons";` with `import { faMoon, faSun } from "../icons";`. Nothing else changes.
3. `ProductDetail.tsx` ServiceNode — the expander button's `{open ? "▾" : "▸"}` becomes `<FontAwesomeIcon icon={open ? faChevronDown : faChevronRight} aria-hidden className="text-xs" />` (keep the button's existing aria-label/handler); the add-child button's `+` text becomes `<FontAwesomeIcon icon={faPlus} aria-hidden className="text-xs" />` (keep its aria-label). Imports from `../icons` (`FontAwesomeIcon` already imported? check — add if not).
4. The four drawers' body sub-list remove buttons rendering `✕` text (ServiceDrawer ×3 lists, SystemDrawer members, ContractDrawer components, RoadmapItemDrawer features) become `<FontAwesomeIcon icon={faXmark} aria-hidden />` inside the same buttons (aria-labels/classes unchanged; import from `../icons`).

- [ ] **Step 3: Run + commit**

Run: `npx vitest run src/shell/PageHeader.test.tsx src/components/ProductDetail.test.tsx src/components/ThemeToggle.test.tsx` (if the last exists), then `npm run test` — green, exit 0. Glyph-text queries: grep test files for `"▸"`, `"▾"`, `"✕"`, `"←"` — adapt any hits to aria-label queries (none expected; drawers' remove buttons already have aria-labels).

```bash
cd /Users/marco/Coding/web-kanban && git add frontend && git commit -m "polish(ui): icon glyph sweep — duotone icons replace text glyphs"
```

---

### Task 2: Padding scale

**Files:**
- Modify: `frontend/src/components/BoardView.tsx` (`px-6 pb-6` container), `PlanningView.tsx` (`px-6 pb-6`), `TimelineView.tsx` (`px-4 pb-4` + sticky-row internals), `RankingView.tsx` (`p-6`), `PIObjectivesBoard.tsx` (`p-6` grid), `ProductsView.tsx` (`px-6 py-6`), `ProductDetail.tsx` (`px-6 py-6`), `admin/AdminView.tsx` (`px-6 py-8`)

**Interfaces:** none new — pure class changes.

- [ ] **Step 1: Apply the standard**

Change each view's top-level scroll-container padding to `px-6 py-4`:

| File | From | To |
|---|---|---|
| BoardView.tsx | `min-h-0 flex-1 overflow-auto px-6 pb-6` | `min-h-0 flex-1 overflow-auto px-6 py-4` |
| PlanningView.tsx | `min-h-0 flex-1 overflow-auto px-6 pb-6` | `min-h-0 flex-1 overflow-auto px-6 py-4` |
| TimelineView.tsx | `min-h-0 flex-1 overflow-auto px-4 pb-4` | `min-h-0 flex-1 overflow-auto px-6 py-4` — and the sticky header row loses its compensating `pt-4` (`sticky top-0 z-20 flex items-center gap-2 bg-canvas pb-2 pl-2 pt-4` → drop `pt-4`; the container's `py-4` supplies the rhythm; check the sticky row still fully covers scrolled content — if a 4px gap shows behind it, use `-mt-4 pt-4` on the sticky row and note it) |
| RankingView.tsx | `grid min-h-0 flex-1 grid-cols-1 gap-6 overflow-auto p-6 lg:grid-cols-2` | `… overflow-auto px-6 py-4 lg:grid-cols-2` |
| PIObjectivesBoard.tsx | `grid min-h-0 flex-1 grid-cols-3 gap-4 overflow-auto p-6` | `… overflow-auto px-6 py-4` |
| ProductsView.tsx | `min-h-0 flex-1 overflow-auto px-6 py-6` | `px-6 py-4` |
| ProductDetail.tsx | `min-h-0 flex-1 overflow-auto px-6 py-6` | `px-6 py-4` — its TabBar wrapper `mb-5 -mx-6` keeps working (same horizontal inset) |
| admin/AdminView.tsx | `mx-auto max-w-7xl px-6 py-8` | `mx-auto max-w-7xl px-6 py-4` |

- [ ] **Step 2: Run + commit**

Run: `npm run test` (class-free assertions — expect zero fallout) and `npm run build`.

```bash
cd /Users/marco/Coding/web-kanban && git add frontend && git commit -m "polish(ui): one content padding scale (px-6 py-4) across all views"
```

---

### Task 3: Caption/label unification

**Files:**
- Modify: `frontend/src/components/Toolbar.tsx` (Kind caption), `TimelineView.tsx` (Mode/Lanes captions), `FilterSelect.tsx` (label span), `admin/ContainersSection.tsx` + `admin/CapacitySection.tsx` (PI captions), `admin/LdapSection.tsx` (preset caption + form labels + section heads), `admin/BackupSection.tsx` (form labels + section heads), `ObjectiveEditor.tsx` (field labels), `ItemDrawer.tsx` (its 4 hand-copied `text-[11px] font-semibold uppercase…` spans), `WsjfToggle.tsx` (its hand-copied caption span → `captionClass`)

**Interfaces:**
- Consumes: `captionClass` from ui.ts.

- [ ] **Step 1: Sweep**

Replace every occurrence of these class strings with `captionClass` (import where missing):

- `text-[11px] font-semibold uppercase tracking-wide text-gray-400` (Toolbar:~115, TimelineView Mode/Lanes captions, FilterSelect:~59, ContainersSection:~201, CapacitySection:~104, LdapSection preset:~99, ItemDrawer ×4)
- `text-xs font-medium text-gray-500` used as a form label (BackupSection:~43, LdapSection:~40, ObjectiveEditor:~91,95,100,121)
- `text-xs font-semibold uppercase tracking-wide text-gray-400` (BackupSection:~105,119,161; LdapSection:~106,122,128)
- WsjfToggle:30's hand-copied `text-[11px] font-medium uppercase tracking-wide text-gray-400` → `captionClass`

Where the old span carried extra layout classes (`mb-1 block` etc.), compose: `` className={`mb-1 block ${captionClass}`} `` — layout utilities don't conflict with the token.

- [ ] **Step 2: Run + commit**

Run: `npm run test` — label TEXT is unchanged so queries survive; adapt only if some test matched exact case-sensitive rendered text where CSS `uppercase` doesn't matter to Testing Library (it doesn't — text content is untransformed in the DOM). Expect zero fallout.

```bash
cd /Users/marco/Coding/web-kanban && git add frontend && git commit -m "polish(ui): captionClass is the one caption/field-label convention"
```

---

### Task 4: Literal dedupe

**Files:**
- Modify: `frontend/src/components/admin/UsersSection.tsx`, `StoryBoardModal.tsx`, `NewItemDialog.tsx`, `admin/UserModal.tsx`, `UserMenu.tsx`, `ObjectiveEditor.tsx`, `LoginPage.tsx`, `admin/AuditLogSection.tsx`, `Toolbar.tsx`, `FilterSelect.tsx`, `ItemDrawer.tsx` (popover literal), `admin/AdminCard.tsx` (delete adminAddButtonClass), `admin/TeamsSection.tsx`, `admin/PlanningIntervalsSection.tsx`, `admin/ContainersSection.tsx`, `admin/DepartmentsSection.tsx`, `admin/SnapshotsSection.tsx` (adminAddButtonClass users), `admin/CatalogSection.tsx`

**Interfaces:**
- Consumes: `btnPrimary`, `btnSecondary`, `btnGhost`, `btnDanger`, `overlayClass`, `popoverClass` from ui.ts; `adminCardClass` from AdminCard.tsx.
- Produces: `adminAddButtonClass` no longer exists.

- [ ] **Step 1: btnPrimary adoptions** (labels here still carry `+` — Task 5 strips them; keep current label text in this task)

Replace the raw blue-button literals with `className={btnPrimary}` (import from `./ui` / `../ui`): UsersSection "+ Add person" (:~79), StoryBoardModal "+ Add story" (:~136), NewItemDialog "Create" (:~57), UserModal "Save" (:~244), UserMenu password "Save" (:~138 area), ObjectiveEditor "Save" (:~173), LoginPage submit (:~93 — it may be `w-full`-composed: `` `w-full ${btnPrimary}` ``). ItemDrawer's Save is explicitly LEFT as its full-literal size variant.

- [ ] **Step 2: Secondary/ghost adoptions**

StoryBoardModal "Edit feature" raw secondary → `btnSecondary`. AuditLogSection "Load more" raw → `btnSecondary`. Toolbar "Clear all" raw ghost → `` `${btnGhost} ml-auto inline-flex items-center gap-1` `` (ml-auto + flex are sanctioned compose utilities; drop the literal's own text-gray/hover classes — btnGhost carries them).

- [ ] **Step 3: Shell-literal imports**

- StoryBoardModal overlay: replace the inlined `fixed inset-0 … bg-black/40 p-6 backdrop-blur-xs` string with `` `${overlayClass} ${zModal}` `` (both from ui.ts — zModal already imported since B).
- FilterSelect popover: replace its re-typed popover string with `` `${popoverClass} absolute left-0 top-full z-20 mt-1 max-h-60 min-w-44 w-max overflow-auto` `` — KEEP its current geometry utilities exactly as they are today, only the border/bg/shadow/ring part comes from the token (read the current string first and preserve everything not covered by popoverClass).
- ItemDrawer's partial popover literal (~:903, missing ring): same treatment with `popoverClass` + its existing geometry classes.
- UsersSection (:~65) and AuditLogSection (:~46) hand-rolled `rounded-2xl border … p-5 shadow-xs ring-1` section shells → `adminCardClass` import (+ any extra layout classes they carry).

- [ ] **Step 4: adminAddButtonClass dies; CatalogSection card alignment**

- In AdminCard.tsx delete the `adminAddButtonClass` export. Its users (TeamsSection, PlanningIntervalsSection, ContainersSection, DepartmentsSection, SnapshotsSection — grep `adminAddButtonClass` for the authoritative list) switch to `btnPrimary`.
- CatalogSection's two `rounded-xl border border-gray-200 bg-surface p-4` sections → `adminCardClass`.
- UsersSection row "Edit"/"Delete" buttons: keep their `text-xs` size but rebuild on tokens ONLY if no px/py conflict arises; their current literals are size variants (`px-2.5 py-1 text-xs` shapes) — per ui.ts's rule, size variants keep FULL literals. Decision: keep both as full literals, unchanged. (Documented; not a dedupe target.)

- [ ] **Step 5: Run + commit**

Run: `npm run test` + `npm run build`. Expected fallout: none by name (labels unchanged this task); visual-size change on admin Add buttons is intended.

```bash
cd /Users/marco/Coding/web-kanban && git add frontend && git commit -m "polish(ui): dedupe button/shell literals onto ui.ts tokens; retire adminAddButtonClass"
```

---

### Task 5: Copy sweep — no `+ ` prefixes

**Files:**
- Modify: `frontend/src/components/NewItemBar.tsx` ("+ New Feature"/"+ New Risk"), `components/BoardPage.tsx` ("+ New objective"), `admin/UsersSection.tsx` ("+ Add person"), `StoryBoardModal.tsx` ("+ Add story" + empty-state sentence), `ItemDrawer.tsx` ("+ Add story", "+ Add dependency"), `RoadmapView.tsx` ("+ Add stream")
- Test: every test querying those names (grep `"\+ (New|Add)"` and `/\+ ?(new|add)/i` patterns across `frontend/src`)

- [ ] **Step 1: Strip the prefixes**

| Site | New label |
|---|---|
| NewItemBar buttons | `New Feature`, `New Risk` |
| BoardPage objectives action | `New objective` |
| UsersSection header button | `Add person` |
| StoryBoardModal header button | `Add story` |
| StoryBoardModal empty state | `Use “Add story” to add the first one.` |
| ItemDrawer section buttons | `Add story`, `Add dependency` |
| RoadmapView PageHeader action | `Add stream` |

- [ ] **Step 2: Test fallout**

Regex-insensitive queries (`/new feature/i`, `/add stream/i`) survive; exact-string queries (`"+ Add person"` etc.) update to the new labels. Grep first, adapt query strings only.

- [ ] **Step 3: Run + commit**

`npm run test` — green, exit 0.

```bash
cd /Users/marco/Coding/web-kanban && git add frontend && git commit -m "polish(copy): create-button labels drop the + prefix"
```

---

### Task 6: Interaction & robustness leftovers

**Files:**
- Modify: `frontend/src/components/admin/DepartmentsSection.tsx` (inline rename), `CapacityGrid.tsx` (avatar merge), `ProductDetailPage.tsx` + `BoardPage.tsx` + `ItemDrawer.tsx` (Banner trio), `LifecycleView.tsx` + `ContractsView.tsx` (error/empty precedence), `ProductDetail.tsx` (tab loader catches), `Menu.tsx` + `UserMenu.tsx` (ArrowUp entry), `WsjfToggle.tsx` (dark text)
- Test: `admin/DepartmentsSection.test.tsx` (rename flow), `Menu.test.tsx` (ArrowUp), `LifecycleView.test.tsx`/`ContractsView.test.tsx` (precedence)

- [ ] **Step 1: DepartmentsSection inline rename (failing test first)**

Test (in the file's existing idiom — it has mocks for renameDepartment):

```tsx
it("renames a department inline (Enter commits, Escape cancels)", async () => {
  // reuse the file's render + department fixtures
  await userEvent.click(await screen.findByRole("button", { name: "Rename" }));
  const input = screen.getByLabelText(/rename department/i);
  await userEvent.clear(input);
  await userEvent.type(input, "Network Ops{Enter}");
  expect(client.renameDepartment).toHaveBeenCalledWith(expect.any(Number), "Network Ops");
});
```

Implementation — replace the `prompt(...)` `rename` handler with inline state:

```tsx
const [renaming, setRenaming] = useState<{ id: number; name: string } | null>(null);

const commitRename = async () => {
  if (!renaming) return;
  const name = renaming.name.trim();
  const dep = departments.find((d) => d.id === renaming.id);
  setRenaming(null);
  if (!name || !dep || name === dep.name) return;
  try {
    await renameDepartment(dep.id, name);
    reload();
    onChanged();
  } catch (e) {
    setError(e instanceof Error ? e.message : "Could not rename the department.");
  }
};
```

Row rendering: when `renaming?.id === dep.id`, replace the name button with

```tsx
<input
  autoFocus
  aria-label={`Rename department ${dep.name}`}
  value={renaming.name}
  onChange={(e) => setRenaming({ id: dep.id, name: e.target.value })}
  onKeyDown={(e) => {
    if (e.key === "Enter") void commitRename();
    if (e.key === "Escape") setRenaming(null);
  }}
  className={`flex-1 ${adminInputClass}`}
/>
```

and the "Rename" button becomes `onClick={() => setRenaming({ id: dep.id, name: dep.name })}`. Delete the old `rename` function (no more `prompt`). Grep the repo for `window.prompt`/`prompt(` afterwards — zero hits in `frontend/src`.

- [ ] **Step 2: Avatar palette merge**

CapacityGrid.tsx: delete its local `AVATAR_COLORS`, `initials`, `avatarColor`; `import { avatarColor, initialsOf } from "./Avatar";` and in the row render use `avatar={unassigned ? "?" : initialsOf(name)}` / `avatarClass={unassigned ? "bg-gray-400" : avatarColor(name)}`. NameCell markup unchanged (keeps its h-7 sizing). Existing CapacityGrid tests query rows/meters, not colors — verify.

- [ ] **Step 3: Banner trio**

- ProductDetailPage.tsx error branch: the hand-rolled red div → `<div className="mb-4"><Banner tone="error">{error}</Banner></div>` (keep the back Link below).
- BoardPage.tsx board error branch: `<div className="p-8 text-red-600">{error}</div>` → `<div className="px-6 py-4"><Banner tone="error">{error}</Banner></div>`.
- ItemDrawer.tsx load-error state (~:169): `<p className="p-6 text-sm text-red-600">…` → `<div className="p-6"><Banner tone="error">{the same message}</Banner></div>`.

- [ ] **Step 4: Error/empty precedence (failing tests first)**

LifecycleView.test.tsx / ContractsView.test.tsx:

```tsx
it("shows only the error banner when loading fails", async () => {
  vi.mocked(getLifecycle).mockRejectedValueOnce(new Error("boom"));   // match file idiom
  render(<LifecycleView />);
  expect(await screen.findByRole("alert")).toHaveTextContent("boom");
  expect(screen.queryByText(/no components yet/i)).not.toBeInTheDocument();
});
```

Implementation in both views: the empty branch gates on `!error` (`filtered.length === 0 && !error ? <EmptyState…> : …` — with the table branch also guarded so an errored view shows the Banner alone).

- [ ] **Step 5: ProductDetail tab loader catches**

Each of the four tab loaders (`load`, `loadSystems`, `loadComponents`, `loadContracts`) gains `.catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))` before its `.finally` — routing into the existing `error` state/Banner (which currently only the services flow sets).

- [ ] **Step 6: ArrowUp entry symmetry (failing Menu test first)**

Menu.test.tsx:

```tsx
it("ArrowUp on the open trigger focuses the last enabled item", async () => {
  renderMenu();
  await userEvent.click(screen.getByRole("button", { name: "Stream actions" }));
  await userEvent.keyboard("{ArrowUp}");
  expect(screen.getByRole("menuitem", { name: "Delete" })).toHaveFocus();
});
```

Menu.tsx trigger onKeyDown gains: `if (open && e.key === "ArrowUp") { e.preventDefault(); focusAt(enabled.length - 1); }` (and the existing ArrowDown-while-open branch stays). UserMenu.tsx mirrors the same addition in its trigger handler for its two menuitems.

- [ ] **Step 7: WsjfToggle dark text**

In `ACTIVE_CLASS`, `text-gray-900` (lime + yellow rows) → `text-zinc-900` with the comment:

```ts
// zinc-900 (not gray-900): the gray ramp inverts in dark mode, but these
// bright fills need stable dark text in both themes.
```

- [ ] **Step 8: Run + commit**

`npx vitest run` on the six touched test files, then `npm run test` + `npm run build`.

```bash
cd /Users/marco/Coding/web-kanban && git add frontend && git commit -m "polish(ui): last native prompt dies; avatar merge; banner trio; a11y + dark leftovers"
```

---

### Task 7: Deferred tests, stack verification + docs

**Files:**
- Modify: `frontend/src/components/UserMenu.test.tsx` (password-modal Escape test), `frontend/src/components/ProductsView.test.tsx` (skeleton test), `frontend/src/components/LifecycleView.test.tsx` (fix vacuous loading assertion), `CLAUDE.md`
- Ledger: `.superpowers/sdd/progress.md` (append; gitignored — do not commit)

- [ ] **Step 1: Deferred tests**

1. UserMenu.test.tsx — in the file's idiom:

```tsx
it("Escape closes the password modal", async () => {
  // open menu → "Change password" → modal visible
  await userEvent.click(screen.getByRole("button", { name: /change password/i }));
  expect(screen.getByRole("heading", { name: "Change password" })).toBeInTheDocument();
  await userEvent.keyboard("{Escape}");
  expect(screen.queryByRole("heading", { name: "Change password" })).not.toBeInTheDocument();
});
```

2. ProductsView.test.tsx:

```tsx
it("shows skeleton cards while products load", () => {
  vi.spyOn(client, "getProducts").mockReturnValue(new Promise(() => {}));
  render(<MemoryRouter><ProductsView /></MemoryRouter>);
  expect(screen.getByLabelText("Loading")).toBeInTheDocument();
});
```

3. LifecycleView.test.tsx — locate the loading test's vacuous secondary assertion (`queryByText("No components yet")` — a substring that can never match the full sentence) and fix it to `queryByText(/no components yet/i)` so it can genuinely fail.

- [ ] **Step 2: Full verification**

```bash
cd /Users/marco/Coding/web-kanban/frontend && npm run build && npm run test
cd ../backend && . .venv/bin/activate && pytest -q     # expect 465 passed
cd .. && export FONTAWESOME_PACKAGE_TOKEN=$(tr -d '\n' < frontend/.fa-token)
docker compose build frontend && docker compose up -d
```

Playwright walkthrough at http://localhost:8080 (read-only): all nine views light + dark — padding rhythm consistent, duotone theme-toggle/back-link/tree icons render, captions uniform; admin: add-buttons at standard size, Departments inline rename (Escape out — no commit), no `prompt()`; ProductDetail tree expand/collapse with chevrons; a drawer sub-list ✕ renders as icon; WSJF toggle legible in dark (values 3 and 5 selected states); create-button labels show no `+`. No stray screenshots/.playwright-mcp at repo root afterwards.

- [ ] **Step 3: Docs + ledger**

CLAUDE.md frontend conventions: add the three closing rules to the conventions bullet — `captionClass` for every caption/field label; content scroll containers are `px-6 py-4`; create-button labels carry no `+` prefix. Append the "UI Refresh C — Polish" section to `.superpowers/sdd/progress.md` (task lines from this plan's workspace ledger; not committed).

- [ ] **Step 4: Commit**

```bash
cd /Users/marco/Coding/web-kanban && git add frontend CLAUDE.md && git commit -m "docs+test: polish conventions recorded; deferred tests closed"
```
