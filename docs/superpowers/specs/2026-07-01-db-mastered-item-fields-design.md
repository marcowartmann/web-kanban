# DB-Mastered Status / Planning Interval / Leading Team — Design

**Date:** 2026-07-01
**Status:** Approved (design); pending spec review

## Goal

Make the item drawer's **Status**, **Planning Interval**, and **Leading Team**
fields **dropdowns of database-mastered values** instead of free text:

- **Status** → the board **lanes** (already a DB entity), scoped to the item's
  kind.
- **Leading Team** → the **Team** table (already a DB entity, `GET /api/teams`).
- **Planning Interval** → a **new `PlanningInterval` DB entity** (today it is only
  a free-text string on items), used as the single source of truth app-wide.

Each dropdown keeps the item's current value selectable (no data loss) but is
otherwise strict (no free typing). `items.planning_interval` stays a string
column; the entity is the master list the UI validates against.

## Backend — new `PlanningInterval` entity

**Model** (`models.py`), table `planning_intervals`:

```python
class PlanningInterval(Base):
    __tablename__ = "planning_intervals"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(64), unique=True)
    position: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
```

**Migration `0007_planning_intervals`**: create the table (unique `name`), then
**seed** it from the distinct non-null `items.planning_interval` values, ordered
(`position` = index in the sorted-distinct list). Uses `op.get_bind()` to select
distinct values and insert rows.

**Schemas** (`schemas.py`):

```python
class PlanningIntervalRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    position: int

class PlanningIntervalCreate(BaseModel):
    name: str = Field(min_length=1, max_length=64)
```

**Router** `routers/planning_intervals.py` (`prefix="/api/planning-intervals"`),
mirroring `teams.py`:

- `GET ""` → all, `order_by(position, name)`.
- `POST ""` `PlanningIntervalCreate` → 201; reject a duplicate `name` (409);
  `position = (max existing position) + 1`.
- `DELETE "/{pi_id}"` → 204 (404 if missing).

Registered in `main.py`.

**CSV import** (`csv_import.py`): add `_seed_planning_intervals(db, parsed)`
(mirroring `_seed_teams_and_members`): collect distinct non-empty
`planning_interval` values across imported features/stories/risks; insert those
not already present, appending `position` after the current max. Call it in
`replace_all` before the commit. (Import still stores each item's
`planning_interval` string as today; this only maintains the master list.)

## Frontend — types + client

- `types.ts`: `interface PlanningInterval { id: number; name: string; position: number }`.
- `api/client.ts`:
  - `getPlanningIntervals(): Promise<PlanningInterval[]>`
  - `createPlanningInterval(name: string): Promise<PlanningInterval>`
  - `deletePlanningInterval(id: number): Promise<void>`

## Frontend — single source of truth for PIs

- `hooks/useBoard.ts` also calls `getPlanningIntervals()` in its `Promise.all`
  and returns **`planningIntervals: string[]`** (names ordered by position).
- `App.tsx` **removes** its derive-from-items `planningIntervals` memo and uses
  `useBoard`'s list, feeding it to the Board `Toolbar`, `PlanningView`,
  `TimelineView`, `AdminView`, and the drawer. It refreshes on `reload()` (which
  runs on `handleChanged`, i.e. after CSV import or admin edits). The consuming
  components already take `planningIntervals: string[]`, so no prop-type changes.

## Frontend — Admin section

- New `components/admin/PlanningIntervalsSection.tsx` mirroring `TeamsSection`:
  list PIs, add (`createPlanningInterval`), delete (`deletePlanningInterval`,
  `aria-label={"remove planning interval " + id}`); `onChanged` triggers the App
  refresh so all selectors update. Added to `AdminView` beside `TeamsSection`.

## Frontend — the three drawer dropdowns

`ItemDrawer` gains props (all defaulting to empty):

- `statusOptionsByKind?: Partial<Record<ItemKind, string[]>>`
- `planningIntervalOptions?: string[]`
- `leadingTeamOptions?: string[]`

The three free-text `Field`s become `SearchableSelect`s (like Assignee),
wrapped in the same labelled `<label>`, with:

- **Status** options = `statusOptionsByKind[item.kind] ?? []`.
- **Planning Interval** options = `planningIntervalOptions`.
- **Leading Team** options = `leadingTeamOptions`.
- Each: `options = withCurrent(current, options)` — a small helper that puts the
  item's current value first (when truthy) and dedupes, so an off-list value is
  shown and re-selectable. `onChange={(v) => setDraft((d) => ({ ...d, <field>: v ?? "" }))}`.

**`statusOptionsByKind(boards: Board[]): Partial<Record<ItemKind, string[]>>`**
(new, in `lib/boardLanes.ts`): for each board, for each kind in `board.kinds`,
append the board's lane names in lane order; dedupe per kind preserving first
occurrence. `App` memoizes `statusOptionsByKind(boards)` and passes it.

**Leading-team master:** `App` fetches `getTeams()` into state (refreshed with
`assigneeOptions` on `refreshKey`), maps to names, and passes as
`leadingTeamOptions`. (The Board toolbar's team *filter* is unchanged — only the
editable drawer field uses the Team master.)

**`SearchableSelect`** gains an optional `ariaLabel?: string` applied to its input
(so the four selects are individually addressable/accessible). `ItemDrawer`
passes `"Status"`, `"Planning Interval"`, `"Leading Team"`, `"Assignee"`.

## Testing

**Backend**

- `PlanningInterval` model + migration roundtrip (insert, unique name).
- `planning_intervals` router: `GET` ordered by position; `POST` creates and
  rejects a duplicate name (409); `DELETE` removes (404 for missing).
- CSV import seeds `planning_intervals` from the imported column (new values
  added, existing untouched).

**Frontend**

- `statusOptionsByKind`: maps each kind to its boards' lane names in order,
  deduped, unioned across boards that share a kind.
- client fns: `getPlanningIntervals` / `createPlanningInterval` /
  `deletePlanningInterval` hit the right URLs/methods.
- `PlanningIntervalsSection`: renders PIs, add calls `createPlanningInterval`,
  delete calls `deletePlanningInterval`.
- `ItemDrawer`: Status renders a dropdown offering a board lane and saving
  persists the pick; an off-list current value stays selectable; PI and Team
  render from their option lists.
- `SearchableSelect`: `ariaLabel` sets the input's accessible name; update the
  existing Assignee test to target `combobox` **by name** (there are now four).

## Scope guards (v1 — YAGNI)

- Only Status / Planning Interval / Leading Team drawer fields change to
  dropdowns; Assignee, supporting_team, and the rest are untouched.
- `items.planning_interval` remains a free-text string column — the entity is the
  UI's master list; no FK/backfill of items, no rename cascades.
- The board team *filter* still derives from items; only the editable drawer
  field uses the Team master.
- Dropdowns are strict except for keeping the current value; no inline
  "create new" from the drawer (PIs/teams are managed in Admin).
