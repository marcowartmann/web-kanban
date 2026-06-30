# Stories as Cards + Per-Feature Story Modal — Design

**Date:** 2026-06-30
**Status:** Approved (pending spec review)

## 1. Purpose

Surface Stories as first-class cards: show them on the main board (filterable), and
add a per-feature modal that presents a feature's stories as their own Kanban board.

## 2. Current behavior

- The main board (`GET /api/board`) returns only top-level items (`parent_id IS NULL`)
  — Features + Risks — as cards. Clicking a card opens the edit `ItemDrawer`.
- A Feature's stories are shown only as a read-only text list (with add / × remove)
  inside the feature's drawer.

## 3. Desired behavior

1. **Stories appear as cards on the main board**, alongside Features and Risks.
2. **Kind filter becomes multi-select** (Feature / Story / Risk); default **Feature +
   Risk** selected (stories hidden until the user enables them).
3. **Feature cards keep the edit drawer on click**, and gain a **`Stories (N)` button**
   that opens a modal.
4. **The modal is a board of that feature's stories** as cards: click a story to edit it
   (drawer), drag a story between status columns to change its status, plus Add story /
   Edit feature actions.

## 4. Approach (one real fork)

**Including stories on the main board** — chosen: **backend includes them**. Drop the
`parent_id IS NULL` filter in `GET /api/board` so the endpoint returns every item grouped
by status. The board UI already handles any card kind (click-to-edit, drag-to-status)
generically, so stories get those behaviors for free. Alternative (client-side fetch of
stories + merge) was rejected as redundant with the existing board query.

## 5. Backend changes

### 5.1 `backend/app/routers/board.py`
- Remove the `.where(Item.parent_id.is_(None))` filter so all items become cards grouped
  by status. Aggregation is unchanged: a Feature card still reports
  `children_count = len(item.children)` and `children_points = sum(child story_points)`;
  Story/Risk cards naturally report `0` (no children).

### 5.2 `backend/tests/test_api_board.py`
- `test_board_excludes_child_stories_as_cards` → replace with
  `test_board_includes_child_stories_as_cards`: seed a feature with 2 stories and assert
  the story titles now appear as cards (in their own status column), while the feature
  card still reports `children_count == 2`.
- Keep the grouping/ordering and aggregate tests.

## 6. Frontend changes

### 6.1 Multi-select Kind filter
- **`types.ts`**: `BoardFilters.kind?: ItemKind` → `kinds?: ItemKind[]` (absent/empty ⇒
  no kind constraint).
- **`Toolbar.tsx`**: replace the Kind `<select>` with three checkboxes (Feature / Story /
  Risk) that emit `kinds`. Each checkbox has an accessible label (`getByRole("checkbox",
  { name: /story/i })`).
- **`hooks/useBoard.ts`**: `matches()` — `if (f.kinds?.length && !f.kinds.includes(card.kind)) return false`.
- **`App.tsx`**: initial filters `{ kinds: ["feature", "risk"] }` (stories hidden by
  default).

### 6.2 `lib/groupByStatus.ts` (new, shared helper)
```ts
export function groupByStatus(items: Item[]): BoardColumn[]
```
Groups items into `{ status, cards }` columns using the canonical order
`Funnel → Analyzing → New → (other statuses A–Z) → Unscheduled`, mapping each `Item` to a
`BoardCard` with `children_count: 0`, `children_points: 0`. Mirrors the backend ordering
(the one duplicated constant — documented as such). Used by the modal.

### 6.3 `Card.tsx`
- Add optional prop `onOpenStories?: (featureId: number) => void`.
- Render the `Stories (N)` button only when `card.kind === "feature" && onOpenStories`
  (N = `children_count`). Its `onClick` calls `stopPropagation()` then
  `onOpenStories(card.id)`.
- **DOM detail:** the card content currently lives inside the draggable `<button>`.
  Nesting another `<button>` there is invalid HTML, so the Stories button is rendered as
  a **sibling** of the draggable `<button>` (both inside the existing outer `<div ref=
  setNodeRef>`), keeping it out of the drag listeners. Story/Risk cards render no such
  button. The component is otherwise unchanged and is reused inside the modal.

### 6.4 `Column.tsx` / `Board.tsx`
- Thread the optional `onOpenStories` prop through `Board → Column → Card`.

### 6.5 `StoryBoardModal.tsx` (new)
- Props: `{ featureId: number; onClose: () => void; onOpenItem: (id:number)=>void;
  onChanged: () => void }`.
- Loads the feature via `getItem(featureId)`; groups `feature.children` with
  `groupByStatus`.
- Renders a centered modal: header (feature title, `Edit feature` → `onOpenItem(featureId)`,
  `+ Add story`, close ×) over a `DndContext` of `Column`s of story `Card`s.
- **Story card click** → `onOpenItem(storyId)` (opens the shared `ItemDrawer`).
- **Story drag → column** → `updateItem(storyId, { status })`, then reload the modal and
  call `onChanged()` (so the main board refreshes too).
- **Add story** → prompt title → `createItem({ kind:"story", title, parent_id:featureId })`
  → reload modal + `onChanged()`.
- Backdrop click / × closes; inner click stops propagation. Errors via an inline message.

### 6.6 `App.tsx` wiring
- New state `openStoriesFeatureId: number | null`.
- `<Board ... onOpenStories={setOpenStoriesFeatureId} />`.
- Render `<StoryBoardModal>` when set, passing `onOpenItem={setOpenItemId}` (reuses the
  existing drawer) and `onChanged={handleChanged}`. Opening a story drawer from the modal
  leaves the modal open underneath; saving/deleting in the drawer triggers `handleChanged`.

### 6.7 Drawer
- The feature drawer's existing text list of stories is **kept as-is** (quick reference);
  the modal is the richer view. (Flagged for removal if desired later.)

## 7. Tests (frontend, Vitest)

- `lib/groupByStatus.test.ts`: ordering (Funnel/Analyzing/New/other/Unscheduled), blank
  status → Unscheduled, card mapping.
- `Toolbar.test.tsx`: toggling the Story checkbox emits `kinds` including `"story"`.
- `Card.test.tsx` (or a new test): a feature card shows `Stories (N)` and clicking it
  calls `onOpenStories` (and does not call `onOpen`); a story card shows no such button.
- `StoryBoardModal.test.tsx`: renders story cards grouped by status from a mocked
  `getItem`; clicking a story calls `onOpenItem`; the drag handler calls
  `updateItem(id,{status})`; Add story calls `createItem` with `parent_id`.

## 8. Verification

- `cd backend && pytest` (board test updated) and `cd frontend && npm run test` green;
  `npm run build` clean.
- In the running Docker stack: rebuild frontend image, open the board, enable the Story
  filter to see story cards, open a feature's `Stories (N)` modal, drag a story to another
  column, confirm the change persists on the main board.

## 9. Out of scope

- A global all-stories board separate from the per-feature modal.
- Backend endpoint dedicated to a feature's story board (client-side grouping suffices).
- Removing the drawer's text story list.
