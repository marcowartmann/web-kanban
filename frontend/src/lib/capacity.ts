import type { Capacity, TeamMember } from "../types";
import { ITERATION_SLOTS, type IterationSlot } from "./iterations";

export interface MemberCapacityRow {
  member: TeamMember;
  slots: Record<IterationSlot, number>;
  total: number;
}

const round = (n: number) => Math.round(n * 100) / 100;
const emptySlots = (): Record<IterationSlot, number> => ({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 });
const sumSlots = (slots: Record<IterationSlot, number>) =>
  round(ITERATION_SLOTS.reduce((sum, s) => sum + slots[s], 0));

/** One row per member: their capacity bucketed by iteration for this PI. */
export function memberCapacityRows(
  members: TeamMember[],
  capacities: Capacity[],
  pi: string,
): MemberCapacityRow[] {
  return members.map((member) => {
    const slots = emptySlots();
    for (const c of capacities) {
      if (c.member_id !== member.id || c.planning_interval !== pi) continue;
      if (c.iteration >= 1 && c.iteration <= 6) slots[c.iteration as IterationSlot] += c.points;
    }
    for (const s of ITERATION_SLOTS) slots[s] = round(slots[s]);
    return { member, slots, total: sumSlots(slots) };
  });
}

/** Column totals across the given rows (per iteration + grand total). */
export function capacityColumnTotals(
  rows: MemberCapacityRow[],
): { slots: Record<IterationSlot, number>; total: number } {
  const slots = emptySlots();
  for (const row of rows) for (const s of ITERATION_SLOTS) slots[s] += row.slots[s];
  for (const s of ITERATION_SLOTS) slots[s] = round(slots[s]);
  return { slots, total: sumSlots(slots) };
}
