# Item Panel Redesign (feature/story detail) — Design

**Date:** 2026-07-03
**Status:** Approved (design); pending spec review
**Context:** Frontend-only visual + content upgrade of the item detail surface.
Follows the members→users merge (main at a3c05db). Direct implementation (no
subagent pipeline) per working agreement — spec/design gates unchanged.

## Problem

The item drawer is a cramped 384px column: titles truncate, every control has equal
visual weight, and the narrative content items actually carry — description,
acceptance criteria, Definition of Done, t-shirt size, stakeholder, supporting team —
is never rendered. Three `window.prompt()` dialogs (new feature/risk, add story ×2)
undercut the otherwise modern UI. User decisions: **adaptive width** (wide two-zone
when one panel is open, compact side-by-side otherwise), **surface all narrative
fields**, and sweep in **prompt replacement, unified Comments|Activity tabs, and the
StoryBoardModal restyle**.

## Scope of change (files)

- `frontend/src/components/ItemDrawer.tsx` — the redesign (shell, header, rail/grid,
  content column, tabs, inline add-story).
- `frontend/src/App.tsx` — passes `compact={panels.length > 1}` to each drawer;
  docked-row wrapper unchanged otherwise.
- `frontend/src/components/NewItemBar.tsx` — prompt() → `NewItemDialog`.
- `frontend/src/components/StoryBoardModal.tsx` — restyle + prompt() → inline title
  input in its header (reuses the same primitive).
- New: `frontend/src/components/NewItemDialog.tsx`, `frontend/src/components/Avatar.tsx`,
  `frontend/src/components/InlineAddInput.tsx` (shared by drawer story list and
  StoryBoardModal header).
- Tests: updated drawer/StoryBoardModal/NewItemBar tests + new ones (below).
- NOTHING else: no backend, no API, no board cards, no dnd, no save/conflict
  machinery changes (the drawer keeps draft + version + ConflictError flow exactly).

## 1. Adaptive shell

- Drawer accepts `compact?: boolean` (default false). App passes
  `compact={panels.length > 1}`.
- **Wide mode** (single panel): `w-[40rem]` panel; body is a two-zone flex — content
  column (`flex-1 min-w-0`) + properties rail (`w-56 shrink-0 border-l
  border-gray-100 bg-gray-50/50`). Rail scrolls with the panel (single scroll
  container, as today).
- **Compact mode** (side-by-side): `w-[26rem]`; the rail's controls render instead as
  a two-column grid (`grid grid-cols-2 gap-3`) directly under the header, before the
  content column; textareas and lists span full width below.
- The same `PropertyControls` fragment renders in exactly one of two slots (rail or
  grid) depending on `compact`. A mode switch remounts the controls, which is safe:
  all editing state lives in the drawer's `draft` (controlled inputs), so a
  half-typed draft survives a second panel opening.

## 2. Header

- Kind-tinted band: `bg-gradient-to-b` from `blue-50` / `slate-50` / `red-50`
  (feature/story/risk) to white, replacing the 4px accent strip; content padding as
  today; sticky with `z-10` and the border under it.
- Row 1: kind chip (existing colors), `#id` (click-to-copy: `navigator.clipboard`,
  brief "Copied" tooltip via title-swap; aria-label `copy id`), WSJF badge (amber, as
  today), close button.
- Row 2 (stories only): parent breadcrumb — `Parent feature ❯ <title>` button
  (opens/focuses the parent panel; replaces the current blue parent box in the body;
  hidden when the parent is already open, as today).
- Row 3: title as auto-growing `<textarea rows={1}>` (resize via
  `el.style.height = el.scrollHeight`), same borderless→focus-elevate idiom, `text-lg
  font-semibold`, aria-label `Title`. No truncation.
- Conflict banner: unchanged copy and placement (inside the sticky header).

## 3. Properties (rail / grid)

Order: Status, Planning Interval, Leading Team, Supporting Team, Assignee, T-Shirt
Size, Stakeholder — each `label-over-control`, labels `text-[11px] font-medium
uppercase tracking-wide text-gray-400` (existing idiom). Controls:

- Status / Planning Interval / Leading Team: existing `SearchableSelect` (aria labels
  unchanged: `Status`, `Planning Interval`, `Leading Team`).
- Supporting Team: `SearchableSelect` over the same team options, aria-label
  `Supporting Team`, writes `supporting_team`.
- Assignee: existing id-mapped `SearchableSelect` (aria `Assignee`) with an
  `Avatar` (initials, deterministic bg from name hash over a fixed 8-color palette,
  `size` prop) rendered beside the control showing the current person.
- T-Shirt Size: `SearchableSelect` over `["XS","S","M","L","XL","XXL"]` +
  `withCurrent` (aria `T-Shirt Size`), writes `tshirt_size`.
- Stakeholder: plain text `Field` (aria/label `Stakeholder`), writes
  `bo_stakeholder`.

**Estimation block** (below properties, same container): features keep the four
`WsjfToggle`s (unchanged component) + a computed WSJF chip row; stories keep the
Story Points numeric `Field`. (WSJF chip = the item's `wsjf_score` as today's badge —
already in the header; the block just groups the toggles under an "Estimation"
label.)

## 4. Content column

Top-to-bottom:

1. **Description** — auto-growing textarea, ghost placeholder `Add a description…`,
   borderless→focus-elevate, `text-sm text-gray-700`, writes `description`,
   aria-label `Description`.
2. **Acceptance criteria** — same idiom, placeholder `Add acceptance criteria…`,
   writes `akzeptanzkriterien`, aria-label `Acceptance criteria`.
3. **Definition of Done** — same idiom, placeholder `Add a definition of done…`,
   writes `definition_of_done`, aria-label `Definition of Done`.
4. **Stories** (features only) — section header `Stories · N` + `+ Add story`
   button that reveals an `InlineAddInput` row (autofocused text input; Enter
   creates via `createItem({kind:"story", title, parent_id})` then reloads; Escape
   or blur-when-empty cancels; aria-label `New story title`). Story rows: status
   chip (existing board chip colors), title button (opens child), SP badge when
   set, remove ✕ (aria unchanged `remove story ${id}`).
5. **Dependencies** — behavior unchanged; restyle: relation options as pill buttons,
   picker card `rounded-xl ring-1 ring-black/5`; aria labels unchanged
   (`choose item`, `remove link ${id}`).
6. **Comments | Activity** — one section with a segmented control
   (`role="tablist"`, buttons `Comments` / `Activity`, `aria-selected`), defaulting
   to Comments; panels lazy-render the non-active tab (keep both mounted after
   first visit to avoid refetch churn — `ItemComments`/`ItemActivity` unchanged).

Footer: `Save` primary (disabled when `Object.keys(draft).length === 0`; when dirty,
an `Unsaved changes` hint `text-xs text-gray-400` sits left of it), `Delete` as
text-danger ghost on the right. Save/conflict flow byte-identical.

## 5. NewItemDialog (replaces window.prompt)

`NewItemDialog {kind, onCreate(title), onClose}` — small centered modal (same
overlay idiom as UserModal: `bg-black/40 backdrop-blur-sm`, `rounded-2xl`,
`max-w-md`), title `New feature` / `New story` / `New risk`, one autofocused input
(aria-label `Title`), Enter or `Create` button submits (disabled when blank), Escape
or Cancel closes. `NewItemBar` uses it for feature/risk creation;
`StoryBoardModal`'s `+ Add story` swaps prompt() for `InlineAddInput` appearing in
its header row (consistent with the drawer's story list).

## 6. StoryBoardModal restyle

Header gains the same kind-tinted band + chips arrangement (Feature chip, `#id`,
story-count chip, WSJF badge when set); buttons restyled to the shared button
recipe; body/board unchanged (Column/Card untouched). Empty state keeps copy.

## Testing

Existing suites must stay green — preserved contracts: aria labels listed above,
`Save`/`Delete`/`Close` roles, conflict copy, PATCH payload shapes. Updated: any
test asserting the old parent-box, prompt() flows (`ItemDrawerStories`,
`StoryBoardModal`, `NewItemBar` tests re-keyed to the new input/dialog), Toolbar
snapshot-ish assertions if any. New tests (~8):

- compact vs wide: panel width class + rail-vs-grid presence driven by `compact`.
- description / acceptance criteria / DoD: typing + Save PATCHes the right keys.
- title textarea saves `title` (replaces the old input test if separate).
- tabs: Activity hidden until its tab selected; switch works (`role=tab`).
- inline add-story: Enter creates with typed title; Escape cancels without a call.
- NewItemDialog: Enter/Create submit, blank disabled, Escape closes.
- Save disabled when draft empty, enabled after an edit.
- Avatar: initials + stable color class for a given name.

Baselines: frontend 198 + tsc clean → expect ~206 (exact count verified during
implementation; backend 215 untouched).

## Scope guards

- No autosave, no markdown rendering, no @-mentions, no attachment support.
- No board/card/dnd changes; no Planning/Timeline changes.
- `SearchableSelect`, `WsjfToggle`, `ItemComments`, `ItemActivity`, `Field`
  internals untouched (only composition/props around them).
- Existing duplicate-display-name select limitation unchanged (roadmap item).
- `iteration`, `kategorie`, `art`, `sdi_prio`, `externer_partner` stay off the panel
  (iteration is managed in the Planning view; the others remain import-only data).
- Desktop-first (the app is desktop-oriented); compact mode is the narrow layout.
