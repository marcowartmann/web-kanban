# Planning Per-Member Capacity Grid — Design

**Date:** 2026-07-01
**Status:** Approved (design); pending spec review

## Goal

On the Planning board, add a **Capacity** toggle in the filter bar that reveals an
inline grid **aligned above the iteration lanes**, showing each team member's
story-point capacity per iteration (plus a totals row). This makes the per-member
make-up of the column "load / capacity" totals visible at a glance.

Frontend-only: `PlanningView` already loads `members: TeamMember[]` and
`capacities: Capacity[]` (`Capacity { member_id, planning_interval, iteration,
points }`), so the breakdown is fully derivable client-side. No backend changes.

## Rows & scope

- Rows = members of the **selected team** (`teamId`); when "All teams" is
  selected, **all** members. Members with **zero** capacity this PI are still
  shown.
- Independent of the Assignee filter — the grid mirrors the **team** selection
  only.

## Layout — aligned grid above the lanes

```
Member       Backlog   Iter1  Iter2  Iter3  Iter4  Iter5   IP
Marco          —         5      5      5      3      ·      ·
Manuela        —         3      3      ·      ·      ·      ·
Total          —         8      8      5      3      0      0
────────────────── iteration lanes below ──────────────────
[ Backlog ][ Iter 1 ][ Iter 2 ][ Iter 3 ][ Iter 4 ][ Iter 5 ][ IP ]
```

- The grid reuses the lanes' column widths (`w-72`) and `gap-4` spacing. Each row
  is a horizontal flex: a **name cell** (over the Backlog column — capacity is
  iteration-only, so Backlog shows "—") followed by six iteration cells aligned
  under Iteration 1–IP.
- Zero capacity renders as "·".
- A trailing **Total** row sums each iteration column across the shown members.
- To stay aligned and co-scroll, the grid and the lane columns move into **one**
  horizontal-scroll container (see PlanningView restructure). The lane headers
  below label the iteration columns.

## Data helper — `frontend/src/lib/capacity.ts`

```ts
import type { Capacity, TeamMember } from "../types";
import { ITERATION_SLOTS, type IterationSlot } from "./iterations";

export interface MemberCapacityRow {
  member: TeamMember;
  slots: Record<IterationSlot, number>;
  total: number;
}

// One row per member: their capacity bucketed by iteration for this PI.
export function memberCapacityRows(
  members: TeamMember[],
  capacities: Capacity[],
  pi: string,
): MemberCapacityRow[];

// Column totals across the given rows (per iteration + grand total).
export function capacityColumnTotals(
  rows: MemberCapacityRow[],
): { slots: Record<IterationSlot, number>; total: number };
```

- `memberCapacityRows`: for each member, sum `capacities` where
  `member_id === member.id && planning_interval === pi`, bucketed into
  `slots[iteration]` for `iteration ∈ 1..6`; `total` = sum of slots. Float noise
  trimmed with `Math.round(x * 100) / 100` (matching `capacityBySlot` in
  `iterations.ts`).
- `capacityColumnTotals`: sum each slot across rows; same rounding.

## Component — `frontend/src/components/CapacityGrid.tsx`

`CapacityGrid({ rows }: { rows: MemberCapacityRow[] })` — presentational.

- Renders one flex row per member: name cell (`w-72`, shows `member.name`) + six
  `w-72` cells showing `slots[slot]` (or "·" when 0), matched to `ITERATION_SLOTS`
  and `gap-4`.
- A final bold **Total** row using `capacityColumnTotals(rows)`.
- Styled to sit above the lanes (light card/row background); the Backlog-aligned
  name cell holds the label, the six iteration cells hold numbers (centered).
- Renders nothing meaningful when `rows` is empty (an empty container is fine).

## PlanningView changes

- New state `const [showCapacity, setShowCapacity] = useState(false)`.
- Derive rows (team-scoped):
  ```ts
  const teamMembers = useMemo(
    () => (teamId != null ? members.filter((m) => m.team_id === teamId) : members),
    [members, teamId],
  );
  const capacityRows = useMemo(
    () => (pi ? memberCapacityRows(teamMembers, capacities, pi) : []),
    [teamMembers, capacities, pi],
  );
  ```
- Add a **Capacity** toggle button in the filter bar after the Assignee
  `FilterSelect`, using the existing `pill(active)` helper:
  ```tsx
  <button onClick={() => setShowCapacity((v) => !v)} className={`ml-2 ${pill(showCapacity)}`}>
    Capacity
  </button>
  ```
- Restructure the lanes block so grid + columns share one scroll container:
  ```tsx
  {groups && (
    <div className="overflow-x-auto p-6">
      {showCapacity && <CapacityGrid rows={capacityRows} />}
      <DndContext sensors={sensors} onDragEnd={(e) => void handlePlanDragEnd(e, onChanged)}>
        <div className="flex gap-4">
          <PlanningColumn id="backlog" ... />
          {ITERATION_SLOTS.map((slot) => (<PlanningColumn ... />))}
        </div>
      </DndContext>
    </div>
  )}
  ```
  (The `overflow-x-auto p-6` moves from the inner lanes `div` to the new wrapper;
  the lanes `div` keeps `flex gap-4`.)

## Testing

**`lib/capacity.test.ts`**

- `memberCapacityRows`: buckets a member's capacities into the right iteration
  slots for the PI; ignores other PIs / other members; a member with no capacity
  yields all-zero slots + total 0; multiple capacities in the same slot sum.
- `capacityColumnTotals`: per-iteration sums across rows + grand total; empty rows
  → all zeros.

**Component / view (vitest)**

- `CapacityGrid`: renders a row per member with the right per-iteration values and
  "·" for zero; the Total row shows the column sums.
- `PlanningView`: the **Capacity** toggle shows/hides the grid; the grid's rows are
  the selected team's members (switching team changes the rows); "All teams" shows
  all members.

## Scope guards (v1 — YAGNI)

- Capacity only — no per-member **load** (assigned SP) in the grid; the column
  headers already show load/capacity totals.
- Rows follow the **team** selection, not the Assignee filter.
- The Backlog column carries no capacity (name-cell placeholder "—").
- Frontend-only; no backend, schema, or API changes.
