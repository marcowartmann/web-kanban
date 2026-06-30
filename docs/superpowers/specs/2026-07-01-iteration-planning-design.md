# Iteration Planning — Design

**Date:** 2026-07-01
**Status:** Approved (design); pending spec review

## Goal

Add a way to plan **stories** into iterations within a Planning Interval (PI),
alongside the existing Kanban board. Each PI has **6 iterations**: development
iterations 1–5 plus a final **IP** iteration. A story belongs to exactly one
iteration within its PI (or none = backlog).

## Domain reframe

The current free-text `iteration` field on items actually holds the Planning
Interval (`PI1-Q3`, `PI2-Q4`). It is renamed to **`planning_interval`**. A new
integer **`iteration`** (1–6, nullable) holds the slot a story is planned into,
where `6` is displayed as **IP** and `null` means unplanned (backlog).

Only **stories** carry an `iteration` value. Features and risks keep just their
`planning_interval`.

## Data model

`items` table changes (one Alembic migration `0004`):

- Rename column `iteration` → `planning_interval` (data preserved).
- Add column `iteration` `INTEGER NULL`.

`models.py` `Item`:

- `planning_interval: Mapped[str | None] = mapped_column(String(64))`
- `iteration: Mapped[int | None] = mapped_column(Integer)`

### Iteration labels

A single source of truth, shared in spirit across back and front:

- slots are the integers `1, 2, 3, 4, 5, 6`
- label(`n`) = `"IP"` if `n == 6` else `"Iteration {n}"`
- backlog = `iteration is null`

## Backend

**`schemas.py`**

- `ItemBase`: rename `iteration: str | None` → `planning_interval: str | None`;
  add `iteration: int | None = None`.
- `ItemUpdate`: rename `iteration` → `planning_interval: str | None`; add
  `iteration: int | None = Field(default=None, ge=1, le=6)`. (`extra="forbid"`
  stays, so the field must be declared to be PATCHable.)
- `ItemRead` inherits both via `ItemBase`.

**`routers/items.py`**

- `list_items`: rename the `iteration` query param and its filter to
  `planning_interval` (`Item.planning_interval == planning_interval`).
- `update_item` already does `model_dump(exclude_unset=True)` + `setattr`, so it
  handles the new `iteration` field with no change. Out-of-range values are
  rejected by the Pydantic validator (422).

**`csv_import.py`**

- The CSV "Iteration" column now maps to `planning_interval`
  (`"planning_interval": g(COL_ITERATION)`); imported rows get `iteration = None`.

## Frontend

**Types (`types.ts`)**

- `Item`: `planning_interval: string | null`; `iteration: number | null`.
- `ItemUpdate`: `planning_interval?`; `iteration?: number | null`.

**Iteration helper (`lib/iterations.ts`)**

- `ITERATION_SLOTS = [1,2,3,4,5,6]`
- `iterationLabel(n: number): string` → `n === 6 ? "IP" : \`Iteration ${n}\``
- `groupStoriesByIteration(stories, pi)` → `{ backlog: Story[], slots: Record<1..6, Story[]> }`,
  filtering to stories whose `planning_interval === pi`; plus `slotPoints(stories)`
  summing `story_points`.

**Planning view (new "Planning" nav tab in `App.tsx`)**

- Third nav button beside Board / Admin.
- Top control: a `FilterSelect` (reused) labelled **Planning Interval**, options =
  distinct `planning_interval` values across items; defaults to the first.
- Columns: **Backlog · Iteration 1 · 2 · 3 · 4 · 5 · IP** (7 droppable columns).
- Shows only `kind === "story"` items whose `planning_interval` = selected PI.
- Each non-backlog column header shows its **story-point total**.
- dnd-kit drag (PointerSensor, 8px activation), same as the board. Dropping a card
  on a column PATCHes `{ iteration: slot }` (Backlog → `{ iteration: null }`), then
  reloads.
- Clicking a card opens the existing `ItemDrawer`.
- Compact card: title, parent-feature name (best-effort from the items list),
  assignee, SP.

New components: `PlanningView.tsx`, `PlanningColumn.tsx`, `StoryPlanCard.tsx`.
Reuses existing `useBoard` items + `reload`, `FilterSelect`, `ItemDrawer`.

**Relabel "Iteration" → "Planning Interval"** (board side):

- `Toolbar.tsx`: `BoardFilters.iteration` → `planning_interval`; the dropdown
  `label="Planning Interval"`; filters by `planning_interval`.
- `BoardView.tsx` `visible()`: `f.planning_interval` vs `c.planning_interval`.
- `App.tsx`: the `iterations` memo → `planningIntervals` from
  `items.map(i => i.planning_interval)`; passed to both the board toolbar and the
  planning view's PI selector.
- `ItemDrawer.tsx`: the "Iteration" field label → "Planning Interval", bound to
  `planning_interval`. (Iteration slot is set via the planning board, not the
  drawer.)
- `Card.tsx`: the card's `iteration` line now reads `planning_interval`.

## Error handling

- Iteration out of 1–6 → 422 from the Pydantic validator.
- Drag with no drop target → no-op (matches board behavior).
- A story with a `planning_interval` not equal to the selected PI simply does not
  appear in that PI's planning view.

## Testing

**Backend**

- Migration upgrade/downgrade is exercised by the container's `alembic upgrade head`.
- `PATCH /api/items/{id}` accepts `iteration` (1–6 and null) and rejects 0 / 7 (422).
- `list_items?planning_interval=PI1-Q3` filters correctly.
- CSV import populates `planning_interval` from the "Iteration" column.

**Frontend**

- `iterations.ts`: `iterationLabel` (incl. IP for 6); `groupStoriesByIteration`
  buckets backlog vs slots and filters by PI; `slotPoints` sums SP.
- `PlanningView`: renders 7 columns for a PI, places a story in its slot, and a
  drag-to-column drop calls `updateItem` with the right `iteration` (and `null`
  for Backlog).
- `Toolbar`: the renamed Planning Interval filter still emits `planning_interval`.

## Scope guards (v1 — YAGNI)

- No per-team / per-assignee filter on the planning view (PI selector only).
- No capacity limits or over-allocation warnings (SP totals are display only).
- Iteration is assigned on the planning board, not in the item drawer.
- Stories only; features/risks are not planned into iterations.
