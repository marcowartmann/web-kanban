# Global UI Consistency Pass — Design

**Date:** 2026-07-03
**Status:** Approved (design gate) — pending spec review

## Context

The item-panel redesign (94b4bfd) and the earlier Admin restyle established the app's
design language, but seven surfaces still speak the pre-redesign dialect (flat `rounded`
corners, `border-gray-300` without focus rings, unstyled native `window.confirm`).
This pass makes the language global. **No layout changes anywhere** — in particular the
board lanes and item cards (`Column`, `Card`, `PlanningColumn`, `StoryPlanCard`,
`TimelineLane`, `TimelineCell`, `FeatureCard`) are not touched at all.

User decisions (AskUserQuestion):
- Replace all six native `window.confirm()` calls with a styled `ConfirmDialog`.
- Header navigation becomes a **segmented control** matching the drawer's
  Comments|Activity tabs.

## The canonical language (source of truth: ItemDrawer / NewItemDialog / AdminCard)

| Role | Classes |
|---|---|
| Radius | `rounded-lg` controls/inputs · `rounded-xl` popovers · `rounded-2xl` modals/cards · `rounded-full` chips/pills |
| Overlay | `fixed inset-0 flex items-center justify-center bg-black/40 p-6 backdrop-blur-sm` (+ per-site `z-*`) |
| Modal panel | `w-full rounded-2xl bg-white p-6 shadow-2xl ring-1 ring-black/5` (+ per-site `max-w-*`) |
| Primary button | `rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:opacity-60` |
| Secondary button | `rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 shadow-sm transition hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-100` |
| Ghost button | `rounded-lg px-3 py-1.5 text-sm text-gray-600 transition hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-100` |
| Danger button | `rounded-lg bg-red-600 px-3 py-1.5 text-sm font-semibold text-white shadow-sm transition hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-200 disabled:opacity-60` |
| Input | `rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 transition placeholder:text-gray-400 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100` |
| Caption label | `text-[11px] font-medium uppercase tracking-wide text-gray-400` |
| Popover | `rounded-xl border border-gray-200 bg-white p-1 shadow-lg ring-1 ring-black/5` |
| Popover option | `rounded-lg px-3 py-1.5 text-left text-sm transition` + selected `bg-blue-50 font-medium text-blue-700` / rest `text-gray-700 hover:bg-gray-50` |
| Close/remove | glyph `✕` (never `×`), `rounded-lg p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700` (remove variants hover red) |

## 1. New module: `frontend/src/components/ui.ts`

Exported class-string constants (AdminCard's proven pattern, promoted app-wide):
`btnPrimary`, `btnSecondary`, `btnGhost`, `btnDanger`, `btnDangerGhost`
(`rounded-lg px-3 py-1.5 text-sm font-semibold text-red-600 transition hover:bg-red-50
focus:outline-none focus:ring-2 focus:ring-red-100`), `inputClass`, `captionClass`,
`overlayClass`, `modalPanelClass`, `popoverClass`, `closeButtonClass` — values exactly
as in the table above.

**Composition rule:** call sites may append only non-conflicting utilities
(`w-*`, `max-w-*`, `max-h-*`, `flex-1`, `ml-auto`, `z-*`, `cursor-pointer`, `overflow-*`).
Never append a utility that conflicts with one inside the token (e.g. `py-1.5` onto
`inputClass`) — Tailwind's output order, not class order, would decide the winner.
Where a deliberate size variant is needed (compact toolbar inputs, `px-4 py-2` admin
add-button), keep the full literal string at the call site instead of fighting the token.

`AdminCard.tsx` keeps its exports; `adminInputClass` becomes an alias of `inputClass`
(identical utilities today, only ordering differs). `adminAddButtonClass` (deliberate
`px-4 py-2` size variant) and the other admin tokens stay literal.

## 2. New component: `frontend/src/components/ConfirmDialog.tsx`

```
ConfirmDialog({ title, message, confirmLabel, onConfirm, onClose }: {
  title: string; message: string; confirmLabel: string;
  onConfirm: () => void | Promise<void>; onClose: () => void;
})
```

- Overlay (`overlayClass` + `z-50` — above the drawer backdrop `z-30` so the drawer's
  delete confirm renders on top) closing on backdrop click; panel `modalPanelClass` +
  `max-w-md` with `stopPropagation`. The overlay's own click handler also calls
  `stopPropagation` before `onClose`: when mounted inside the drawer tree, a bubbling
  click would otherwise reach the app's panel backdrop and close every open panel.
- `role="alertdialog"` `aria-label={title}`; title `text-sm font-semibold text-gray-900`,
  message `mt-2 text-sm text-gray-600 whitespace-pre-line`.
- Footer: Cancel (`btnGhost`, **autoFocus** — Enter can never destroy) then the confirm
  button (`btnDanger`, `onClick={() => void onConfirm()}`).
- Escape closes (keydown handler on the overlay; focus starts inside via the
  autofocused Cancel).
- Always danger-styled: every current call site is destructive, so no `danger` prop
  (YAGNI — simplification vs. the approved design sketch).
- Callers own the open/closed state and call both `onConfirm` and then close themselves
  (or close via `onClose` on cancel). The dialog never closes itself except
  backdrop/Escape/Cancel → `onClose`.

### Call-site migrations (all six `window.confirm`s)

| File | Trigger | Dialog copy (title / message / confirm label) |
|---|---|---|
| `ItemDrawer.tsx` `remove()` | Delete button | `Delete item?` / `“{item.title}” and any child stories will be permanently deleted.` / `Delete` |
| `ItemComments.tsx` `remove()` | Delete on a comment **with replies** (reply-less deletes stay immediate, as today) | `Delete comment?` / `This comment and its replies will be permanently deleted.` / `Delete` |
| `admin/UsersSection.tsx` | ConflictError on delete that is forceable (not “deactivate instead”, which stays an inline error) | `Delete user?` / `{e.detail}` / `Delete anyway` |
| `admin/TeamsSection.tsx` | ConflictError on delete | `Delete team?` / `{e.detail}` / `Delete anyway` |
| `admin/PlanningIntervalsSection.tsx` | ConflictError on delete | `Delete planning interval?` / `{e.detail}` / `Delete anyway` |
| `admin/SnapshotsSection.tsx` `restore()` | Restore link | `Restore snapshot?` / `{name}\nCurrent data is snapshotted first, then replaced.` / `Restore` |

Each caller holds pending state (e.g. `const [pendingDelete, setPendingDelete] =
useState<...|null>(null)`); the ConflictError sites stash `{ id, detail }` from the
caught error and run the forced call from `onConfirm`. Error handling after the forced
call is unchanged (inline `setError`).

## 3. Restyled components

**`SearchableSelect.tsx`** — same props, same behavior (strict close-discards-typing,
mousedown-outside close, `onMouseDown` commit), same test idiom (focus opens; option
click selects); only classes and the clear glyph change:
- Input: `inputClass` equivalent at compact size — full literal
  `w-full rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-900 transition placeholder:text-gray-400 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100`.
- Clear button: glyph `✕`, `rounded p-0.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700`
  (aria-labels unchanged).
- Popover: `absolute z-10 mt-1 max-h-48 w-full overflow-auto` + `popoverClass`.
- Options: popover-option classes; the option matching `value` gets the selected
  treatment + check icon (same SVG as FilterSelect). “No matches” row:
  `px-3 py-1.5 text-xs text-gray-400`.

**`App.tsx` nav** — segmented control: wrap the four buttons in
`<nav className="flex gap-0.5 rounded-lg bg-gray-100 p-0.5">`; each button
`rounded-md px-3 py-1.5 text-sm font-medium transition focus:outline-none focus:ring-2 focus:ring-blue-100`
+ active `bg-white text-gray-900 shadow-sm` / inactive `text-gray-500 hover:text-gray-700`.

**`LaneEditor.tsx`** (the admin editing strip — the board lanes themselves are untouched):
- Chip: `flex items-center gap-1.5 rounded-lg bg-white px-2 py-1 text-sm shadow-sm ring-1 ring-gray-200`.
- Chip input: `w-24 rounded-md border border-transparent px-1.5 py-0.5 text-sm transition hover:border-gray-200 focus:border-blue-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-100`.
- Chip delete: glyph `✕`, `rounded p-0.5 text-gray-400 transition hover:bg-red-50 hover:text-red-600`
  (aria-label unchanged).
- New-lane input: compact literal
  `w-40 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-900 transition placeholder:text-gray-400 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100`.
- “Add lane”: `btnPrimary`.

**`BoardView.tsx`** — “Edit lanes” button: `btnSecondary`.

**`ImportButton.tsx`**
- Trigger label: `btnSecondary` + `cursor-pointer focus-within:ring-2 focus-within:ring-blue-100`.
- Modal: overlay `overlayClass` + `z-50`, closing on backdrop click (it cancels);
  panel `modalPanelClass` + `max-w-lg max-h-[80vh] overflow-y-auto` with `stopPropagation`.
- Cancel: `btnGhost`. “Replace all data”: `btnDanger`.
- Stays its own modal (not ConfirmDialog): it has a rich preview body, busy state, and
  in-modal 409 re-arm — generalizing ConfirmDialog for one caller isn’t worth it.

**`admin/AuditLogSection.tsx`** — entity-type `<select>` gains
`bg-white transition focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100`.

**Glyph sweep** — `×` → `✕` in `TeamsSection`/`PlanningIntervalsSection` remove buttons
(with `adminRemoveButtonClass` dropping `text-lg` for `text-sm` so ✕ sits at chip scale).

## 4. Conservative token adoption (no visual churn)

Rewire to `ui.ts` tokens only where the rendered result is identical or gains a missing
`transition`/focus ring: `NewItemDialog` (overlay/panel/input/ghost),
`NewItemBar` (primary/danger), `UserMenu` (ghosts, modal shell, inputs),
`UserModal` (field/caption/ghost), `LoginPage` (inputs), `ItemComments`
(`box` → `inputClass`; its `Post` button already matches `btnPrimary` sizing).
Primary CTAs with deliberately wider padding (`px-4`/`px-5` in NewItemDialog, UserMenu,
UserModal, LoginPage, drawer Save) keep their literal class strings — per the
composition rule they must not append conflicting `px-*` onto `btnPrimary` — and only
gain any missing `shadow-sm`/`focus:ring` utilities inline. Files already on AdminCard
tokens are not rewritten.

## Out of scope

- Board lanes and item cards (`Column`, `Card`, `PlanningColumn`, `StoryPlanCard`,
  `TimelineLane`, `TimelineCell`, `FeatureCard`, `CardLinkBadges`) — explicitly frozen.
- Native `<select>`s in `UserModal`/`AuditLogSection` stay native (styled consistently).
- No new component APIs beyond `ConfirmDialog`; no Button/Input React components.
- Backend, routing, and behavior of all flows other than the confirm dialogs.

## Testing

- New `ConfirmDialog.test.tsx`: renders title/message/label; confirm fires `onConfirm`
  and not `onClose`; Cancel/backdrop/Escape fire `onClose` and never `onConfirm`;
  Cancel has focus on open.
- Update the suites that stub `window.confirm` to drive the dialog instead
  (`ItemDrawer.test.tsx`, `ItemComments.test.tsx`, `admin/UsersSection.test.tsx`,
  `admin/TeamsSection.test.tsx`, `admin/SnapshotsSection.test.tsx`; add the previously
  untestable force-delete path in `PlanningIntervalsSection.test.tsx` if absent).
- Existing `SearchableSelect`/`FilterSelect`/`NewItemBar`/`ImportButton` suites must
  pass unchanged except where they assert removed classes/glyphs.
- Verification: `npx tsc --noEmit` + `npx vitest run` green from `frontend/`; rebuild
  the frontend container; visually verify nav, lane editor, import preview, drawer
  selects, and one confirm flow in the live stack (screenshots; scratch data only).
