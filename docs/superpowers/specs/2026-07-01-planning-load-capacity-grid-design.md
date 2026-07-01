# Planning Load-vs-Capacity Utilization Grid — Design

**Date:** 2026-07-01
**Status:** Approved (design); pending spec review

## Goal

Evolve the Planning **Capacity** grid (built earlier today) so each member ×
iteration cell shows **load vs capacity** as a compact, modern utilization meter
(a bar + `load / cap`, color-coded), instead of a plain capacity number. Add an
**Unassigned** row so every planned story point is visible. Frontend-only.

- **Capacity** per member/iteration: from the already-loaded `capacities`.
- **Load** per member/iteration: sum of `story_points` for the PI's stories where
  `iteration === slot` and `assignee === member.name`. Stories are **team-scoped**
  (leading_team = selected team; all when "All teams"), so the grid's per-iteration
  load totals line up with the existing lane-header load.

## Data — `frontend/src/lib/capacity.ts` (replaces the current row helpers)

```ts
import type { Capacity, Item, TeamMember } from "../types";
import { ITERATION_SLOTS, type IterationSlot } from "./iterations";

export interface SlotLoadCap {
  load: number;
  capacity: number;
}
export interface MemberLoadRow {
  member: TeamMember | null;                    // null = the "Unassigned" row
  slots: Record<IterationSlot, SlotLoadCap>;
  totalLoad: number;
  totalCapacity: number;
}

// One row per member (their capacity + assigned load bucketed by iteration for
// this PI), plus a trailing "Unassigned" row when unassigned/unmatched load
// exists. `stories` is the team-scoped PI story list.
export function loadCapacityRows(
  members: TeamMember[],
  capacities: Capacity[],
  stories: Item[],
  pi: string,
): MemberLoadRow[];

// Column totals (per iteration + grand totals) across the given rows.
export function loadCapacityTotals(
  rows: MemberLoadRow[],
): { slots: Record<IterationSlot, SlotLoadCap>; totalLoad: number; totalCapacity: number };
```

**`loadCapacityRows` algorithm**

- `memberNames = new Set(members.map((m) => m.name))`.
- For each member: `slots[s].capacity` = sum of `capacities` where
  `member_id === m.id && planning_interval === pi && iteration === s`;
  `slots[s].load` = sum of `story_points` for `stories` where
  `kind === "story" && planning_interval === pi && iteration === s &&
  assignee === m.name`. `totalCapacity`/`totalLoad` = sums over slots.
- **Unassigned row** (`member: null`): from stories where `kind === "story" &&
  planning_interval === pi` and (`!assignee` or `!memberNames.has(assignee)`),
  sum `story_points` per slot; `capacity = 0`. Included **only when** its
  `totalLoad > 0`; always sorted last.
- All sums rounded with `Math.round(x * 100) / 100` (matching `capacityBySlot`).

`loadCapacityTotals`: sum `load` and `capacity` per slot across all rows; grand
totals. (So per-iteration total load includes the Unassigned row.)

## Visual — utilization meter

**`UtilizationMeter({ load, capacity }: SlotLoadCap)`** (`frontend/src/components/UtilizationMeter.tsx`)

- Status: `over = load > capacity`; `full = load === capacity && capacity > 0`;
  `under = load < capacity`; `empty = capacity === 0 && load === 0`;
  `noCap = capacity === 0 && load > 0`.
- Color: `under` → **emerald**; `full` → **amber**; `over` or `noCap` → **red**;
  `empty` → muted.
- `empty` renders a muted "—" (no bar). Otherwise:
  - A `h-1.5 rounded-full bg-gray-200` track with a `rounded-full` fill whose
    width = `capacity > 0 ? Math.min(load / capacity, 1) * 100 : 100`% and whose
    color is the status color (`bg-emerald-500` / `bg-amber-500` / `bg-red-500`).
  - Below/beside it, `load / cap` text in `tabular-nums`, tinted the status color.

**`CapacityGrid({ rows }: { rows: MemberLoadRow[] })`** (redesigned)

- One flex row per `MemberLoadRow`, columns aligned to the lanes (`w-72`,
  `gap-4`; name cell over Backlog, six meter cells over Iteration 1–IP), inside
  the existing shared horizontal-scroll container.
- **Name cell**: a small **avatar** (a `rounded-full` circle with the member's
  initials — first letters of the first and last name-words, uppercased — over a
  deterministic color from the name) + the member name; `sticky left-0` so it
  stays while scrolling. The Unassigned row uses a neutral "?" avatar and the
  label "Unassigned".
- Six cells each render `<UtilizationMeter {...row.slots[slot]} />`.
- A bold **Total** row (using `loadCapacityTotals(rows)`), rendered as meters too.
- Subtle `hover:bg-gray-50` per row; the whole grid gets a light card
  (`rounded-xl border bg-white`) so it reads as a panel above the lanes.

## PlanningView changes

- Compute the **team-scoped PI stories** for load (independent of the assignee
  filter, matching the grid's team scoping):
  ```ts
  const teamStories = useMemo(
    () =>
      (team ? items.filter((i) => i.leading_team === team.name) : items).filter(
        (i) => i.kind === "story" && i.planning_interval === pi,
      ),
    [items, team, pi],
  );
  ```
  (`team` and `pi` already exist in the component.)
- Replace the `memberCapacityRows(...)` memo with
  `loadCapacityRows(teamMembers, capacities, teamStories, pi ?? "")`.
- The **Capacity** toggle, `showCapacity` state, and the shared scroll-container
  alignment are unchanged; only the grid's contents get richer.

## Testing

**`lib/capacity.test.ts`** (rewritten for the new shape)

- `loadCapacityRows`: per-member capacity + load bucketed by iteration/assignee;
  same-slot sums; other-PI stories/capacities ignored; a member with capacity but
  no load shows `load 0`; the **Unassigned** row aggregates `null`-assignee and
  unmatched-name load with `capacity 0`, and is omitted when there is none.
- `loadCapacityTotals`: per-iteration load + capacity sums incl. the Unassigned
  row; empty rows → all zeros.

**Component (vitest)**

- `UtilizationMeter`: renders `load / cap`; picks emerald/amber/red for
  under/full/over (assert the fill color class); `capacity 0 & load 0` renders
  "—" and no bar; `capacity 0 & load > 0` is red.
- `CapacityGrid`: a member row shows an avatar (initials) + its meters; the Total
  row shows aggregate `load / cap`; an Unassigned row appears only when unassigned
  load exists.

**`PlanningView`**: the Capacity toggle still reveals the grid; switching team
changes the member rows (existing test extended/retained).

## Scope guards (v1 — YAGNI)

- Load vs capacity only — no velocity/history/forecasting.
- Rows follow the **team** selection, not the Assignee filter.
- Unassigned row only when it has load; capacity always 0 for it.
- Fill bar caps at 100% width; over-allocation is conveyed by the **red** color +
  the `load / cap` text (no overflowing bar).
- Frontend-only; no backend, schema, or API changes.
