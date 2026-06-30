# Configurable Per-Board Lanes — Design

**Date:** 2026-07-01
**Status:** Approved (pending spec review)

## 1. Purpose

Replace the board's dynamically-derived status columns with **fixed, configurable,
reorderable lanes scoped per board**. Seed two boards — **Features & Stories** and
**Risks** — each a kanban over its own item kinds with its own ordered lanes.

## 2. Concept

- A **Board** is a named view scoped to a set of item **kinds**, owning an ordered list
  of **Lanes** (each lane's `name` is a status value).
- A board **selector (tabs)** switches between boards. The selected board renders its
  lanes in configured order as columns, plus a fixed trailing **Unscheduled** lane.
- A card is placed in the lane whose `name == item.status`; items whose status matches no
  lane (or is blank) go to **Unscheduled**. Nothing disappears.

## 3. Scope

In scope: `boards`/`lanes` tables + API, two seeded boards, board tabs, config-driven
lane rendering, card-drag→status, an **Edit lanes** mode (reorder by drag + add/rename/
delete), client-side grouping into lanes.

Out of scope (flagged + accepted): board create/delete UI (only the two seeded boards;
model supports more later); converting the per-feature **story modal** (stays dynamic).

## 4. Data model (new tables, migration `0003`)

- **`boards`**: `id`, `name` (unique), `kinds` (text CSV, e.g. `"feature,story"`),
  `position` (int), `created_at`.
- **`lanes`**: `id`, `board_id` FK → `boards.id` **`ON DELETE CASCADE`**, `name`,
  `position` (int), `created_at`; unique `(board_id, name)`.

**Default seeding** (lazy: performed when `GET /api/boards` finds zero boards, idempotent):
- `Features & Stories` (kinds `feature,story`, position 0) → lanes `Funnel`, `Analyzing`, `New`.
- `Risks` (kinds `risk`, position 1) → lanes `New`, `Analyzing`, `Resolved`.

Lanes are user-editable, so these are only starting points. `Unscheduled` is virtual
(never stored, never editable, always last).

## 5. Backend API

```
GET    /api/boards                       boards (ordered) each with ordered lanes;
                                         seeds the two defaults if none exist
POST   /api/boards/{board_id}/lanes      { name }            append a lane (404 board, 409 dup-in-board)
PATCH  /api/lanes/{lane_id}              { name }            rename (404, 409 dup-in-board)
DELETE /api/lanes/{lane_id}                                  remove (404)
PUT    /api/boards/{board_id}/lanes/order { lane_ids: [...] } set lane order (404 board;
                                         422 if ids don't exactly match the board's lanes)
```

Schemas: `LaneRead{id,name,position}`, `BoardRead{id,name,kinds:list[str],position,lanes:list[LaneRead]}`,
`LaneCreate{name}`, `LaneUpdate{name}`, `LaneOrder{lane_ids:list[int]}`. `kinds` is stored
CSV and exposed as a string list.

The old `GET /api/board` (status-grouped) router is **removed**; grouping moves client-side.
Moving a card still uses `PATCH /api/items/{id} {status}` (existing).

## 6. Frontend

### 6.1 Data flow (`useBoard` reworked)
- Fetch `getBoards()` (board config) and `listItems()` (all items, flat, with `parent_id`
  + `story_points`).
- Build `BoardCard`s from items, computing per-feature aggregates client-side
  (`children_count` = count of items with `parent_id == feature.id`; `children_points` =
  sum of their `story_points`). This replaces the retired `/api/board` aggregation.
- For the selected board: keep items whose `kind ∈ board.kinds`, apply the existing
  filters (kind checkboxes, iteration, team, title search), then group via
  `groupIntoLanes(cards, board.lanes)` → columns = lanes in order, each with matching
  cards, + a trailing **Unscheduled** column for unmatched/blank status.

### 6.2 Board tabs + Kind filter
- Tabs from `getBoards()` (by `position`); selecting sets the active board.
- **Kind filter is kept**, scoped to the active board: it shows a checkbox per kind in
  `board.kinds`, defaulting to all of them selected (so the Risks board shows just a
  `risk` checkbox; Features & Stories shows `feature` + `story`). It narrows within the
  board. Iteration / team / title search are unchanged.

### 6.3 Normal mode (card kanban)
- Cards are draggable; lanes (incl. Unscheduled) are droppable. Dropping a card on a lane
  → `PATCH /api/items/{id} {status: laneName}`; dropping on **Unscheduled** → `{status: ""}`.
  (Same dnd-kit pattern + 8px activation constraint already in use.)

### 6.4 "Edit lanes" mode (per board)
- An **Edit lanes** toggle on the board. In this mode (cards not draggable):
  - **Reorder**: lane headers become a horizontal sortable list (`@dnd-kit/sortable`,
    added dep); dropping persists order via `PUT /api/boards/{id}/lanes/order`.
  - **Rename**: each lane header is an editable input → `PATCH /api/lanes/{id}`.
  - **Delete**: a × on each lane → `DELETE /api/lanes/{id}` (its cards fall to Unscheduled
    until reassigned).
  - **Add**: an "+ Add lane" input → `POST /api/boards/{id}/lanes`.
  - The **Unscheduled** lane is not editable/reorderable/deletable.
- Separating the two drag interactions by mode means card-drag and lane-drag never
  conflict in the same DndContext.

### 6.5 Files
- New: `src/lib/groupIntoLanes.ts`; `src/components/BoardTabs.tsx`;
  `src/components/LaneEditor.tsx` (edit-mode header: sortable + rename/delete);
  client fns + types for boards/lanes.
- Reworked: `src/hooks/useBoard.ts` (boards + items → lanes), `src/components/Board.tsx`
  (tabs, mode toggle, two drag modes), `src/components/Column.tsx` (edit affordances),
  `src/App.tsx` (active board + Kind-filter scoping). `groupByStatus` is replaced by
  `groupIntoLanes`; the story modal keeps `groupByStatus` (unchanged).

## 7. Testing

- **Backend:** seed-defaults on first `GET /api/boards`; lane add/rename/delete (404/409);
  reorder (`PUT …/lanes/order` updates positions; 422 on mismatched ids); delete-board
  cascades lanes (model-level).
- **Frontend:** `groupIntoLanes` (matched lanes in order + Unscheduled catch-all; feature
  aggregates computed); board-tab switch changes kinds/lanes; card-drag handler →
  PATCH status (incl. Unscheduled → ""); lane reorder handler → PUT order; inline
  add/rename/delete call the right endpoints; Kind filter scoped to the board.
- **Verify:** Docker rebuild (migration 0003 applies) + Playwright — switch boards, edit
  lanes (add/rename/reorder/delete), drag a card between lanes.

## 8. Compatibility / migration

- New tables only; `items` unchanged. The retired `/api/board` endpoint and its tests are
  removed; board rendering is fully client-side from `getBoards()` + `listItems()`.
- New items keep the existing create default (`status: "Funnel"`); on the Risks board (no
  Funnel lane) such an item would appear under Unscheduled until dragged — acceptable.
