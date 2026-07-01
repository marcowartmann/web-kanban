# Team Capacity per Iteration — Design

**Date:** 2026-07-01
**Status:** Approved (design); pending spec review

## Goal

Let users define a story-point **capacity per team member, per Planning Interval,
per iteration**. In the planning view, each iteration column shows the **total team
capacity** alongside the **cumulated load** (sum of planned story points), so
over-allocation is visible. A **Team filter** scopes both numbers (and the stories
shown) to one team.

## Data model

New table **`capacities`** (migration `0005`):

- `id` PK
- `member_id` → `team_members.id`, `ON DELETE CASCADE`
- `planning_interval` `String(64)`
- `iteration` `Integer` (1–5, 6 = IP)
- `points` `Numeric` (≥ 0)
- `UniqueConstraint(member_id, planning_interval, iteration)` → `uq_capacity_member_pi_iter`

`models.py`: `Capacity` class. `TeamMember` gains
`capacities = relationship(cascade="all, delete-orphan")` so ORM delete also clears rows.

## Backend API (`routers/capacities.py`, registered in `main.py`)

- `GET /api/capacities` → `list[CapacityRead]` (all rows).
- `PUT /api/capacities` → upsert one cell. Body `CapacityUpsert`
  `{member_id, planning_interval, iteration, points}`; looks up the unique
  `(member_id, planning_interval, iteration)` row, updates `points` or inserts.
  Returns `CapacityRead`. 422 if `member_id` doesn't exist.

**Schemas** (`schemas.py`):

- `CapacityRead` (`from_attributes`): `{id, member_id, planning_interval, iteration, points}`.
- `CapacityUpsert`: `member_id: int`, `planning_interval: str`,
  `iteration: int = Field(ge=1, le=6)`, `points: float = Field(ge=0)`.

## Frontend

**Types (`types.ts`)**

```ts
export interface Capacity {
  id: number;
  member_id: number;
  planning_interval: string;
  iteration: number;
  points: number;
}
```

**API client (`api/client.ts`)**

- `getCapacities(): Promise<Capacity[]>` → `GET /api/capacities`.
- `upsertCapacity(body: { member_id: number; planning_interval: string; iteration: number; points: number }): Promise<Capacity>` → `PUT /api/capacities`.

**Capacity aggregation (`lib/iterations.ts`)**

```ts
// Sum member capacities per iteration slot for one PI, optionally restricted to a
// set of member ids (null = all members). Returns a slot→points record.
export function capacityBySlot(
  capacities: Capacity[],
  pi: string,
  memberIds: Set<number> | null,
): Record<IterationSlot, number>
```

**Admin capacity editor (`admin/CapacitySection.tsx` + test)**

- Rendered by `AdminView` below the Teams/Members grid (full width).
- A Planning-Interval selector (pills), fed by `planningIntervals` passed from `App`
  through `AdminView`.
- A grid: one row per team member (from `getTeamMembers`), columns **Iteration 1–5 · IP**,
  each cell a number input showing the member's capacity for the selected PI
  (from `getCapacities`). Editing a cell commits **on blur** via `upsertCapacity`
  for `(member, selectedPI, slot)`.
- Empty state when there are no planning intervals yet.

`AdminView` gains a `planningIntervals: string[]` prop; `App` passes it (already computed).

**Planning view (`PlanningView.tsx`)**

- Fetches `getTeams()`, `getTeamMembers()`, `getCapacities()` on mount.
- New **Team** filter (pills): *All teams* + each team, beside the PI selector.
- `teamName = selected team's name | null`. Stories are scoped before grouping:
  `scoped = teamName ? items.filter(i => i.leading_team === teamName) : items`,
  then `groupStoriesByIteration(scoped, pi)`.
- `memberIds = selectedTeam ? new Set(members.filter(m => m.team_id === selectedTeam.id).map(m => m.id)) : null`.
- `caps = capacityBySlot(capacities, pi, memberIds)`.
- Passes `load = slotPoints(slotStories)` and `capacity = caps[slot]` to each iteration column.
- Drag/assign unchanged; `onChanged` still reloads items (capacities unaffected by drag).

**Planning column (`PlanningColumn.tsx`)**

- Iteration columns show **`Load X / Cap Y SP`**; the badge is **red when `X > Y`**,
  otherwise neutral. Backlog keeps just its count (no capacity concept).
- Props extend to `load?: number` and `capacity?: number` (replacing the current
  `points`), plus the story count.

## Decisions

- A story's team is its **`leading_team`** field (matched against the team name) for
  both the Team filter and the load total.
- Capacity comparison is **aggregate** per iteration (team total vs total planned
  load), not a per-member breakdown.
- Capacity applies to iterations **1–6** (including IP).

## Error handling

- `iteration` out of 1–6 or `points < 0` → 422 (Pydantic validators).
- `PUT` with unknown `member_id` → 422.
- Deleting a member cascades its capacity rows (FK + ORM cascade).
- Unset capacity reads as `0`; a column with load and `Cap 0` shows red (over).

## Testing

**Backend** (`tests/test_api_capacities.py`)

- `PUT` inserts then updates the same `(member, PI, iteration)` row (no duplicate).
- `iteration=0/7` and `points=-1` → 422; unknown `member_id` → 422.
- `GET` returns saved rows.
- Deleting a member removes its capacity rows.

**Frontend**

- `capacityBySlot`: sums per slot for a PI; restricts to `memberIds`; ignores other PIs.
- `PlanningView`: selecting a team scopes the stories shown and the capacity total;
  a column with load > capacity renders the over-allocation state.
- `CapacitySection`: editing a cell calls `upsertCapacity` with the right
  `(member, PI, iteration, points)`.

## Scope guards (v1 — YAGNI)

- No per-member load breakdown (aggregate team totals only).
- No copy-capacity-between-PIs helper; each PI is edited on its own.
- No capacity on the Backlog column.
- Team association for load uses `leading_team` only (not assignee's team).
