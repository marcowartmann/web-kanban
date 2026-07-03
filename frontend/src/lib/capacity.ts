import type { Capacity, Item, TeamMember } from "../types";
import { ITERATION_SLOTS, type IterationSlot } from "./iterations";

export interface SlotLoadCap {
  load: number;
  capacity: number;
}

export interface MemberLoadRow {
  member: TeamMember | null; // null = the "Unassigned" row
  slots: Record<IterationSlot, SlotLoadCap>;
  totalLoad: number;
  totalCapacity: number;
}

const round = (n: number) => Math.round(n * 100) / 100;

const emptySlots = (): Record<IterationSlot, SlotLoadCap> => {
  const out = {} as Record<IterationSlot, SlotLoadCap>;
  for (const s of ITERATION_SLOTS) out[s] = { load: 0, capacity: 0 };
  return out;
};

function finalize(member: TeamMember | null, slots: Record<IterationSlot, SlotLoadCap>): MemberLoadRow {
  let totalLoad = 0;
  let totalCapacity = 0;
  for (const s of ITERATION_SLOTS) {
    slots[s].load = round(slots[s].load);
    slots[s].capacity = round(slots[s].capacity);
    totalLoad += slots[s].load;
    totalCapacity += slots[s].capacity;
  }
  return { member, slots, totalLoad: round(totalLoad), totalCapacity: round(totalCapacity) };
}

/**
 * One row per member (capacity + assigned load bucketed by iteration for this
 * PI), plus a trailing "Unassigned" row when unassigned/unmatched load exists.
 * `stories` is the team-scoped PI story list; load matches `assignee` to member
 * name.
 */
export function loadCapacityRows(
  members: TeamMember[],
  capacities: Capacity[],
  stories: Item[],
  pi: string,
): MemberLoadRow[] {
  const piStories = stories.filter((s) => s.kind === "story" && s.planning_interval === pi);
  const memberNames = new Set(members.map((m) => m.name));

  const buildRow = (
    member: TeamMember | null,
    matches: (story: Item) => boolean,
  ): MemberLoadRow => {
    const slots = emptySlots();
    if (member) {
      for (const c of capacities) {
        if (c.user_id !== member.id || c.planning_interval !== pi) continue;
        if (c.iteration >= 1 && c.iteration <= 6) slots[c.iteration as IterationSlot].capacity += c.points;
      }
    }
    for (const s of piStories) {
      if (!matches(s)) continue;
      const n = s.iteration;
      if (n != null && n >= 1 && n <= 6) slots[n as IterationSlot].load += s.story_points ?? 0;
    }
    return finalize(member, slots);
  };

  const rows = members.map((m) => buildRow(m, (s) => s.assignee === m.name));
  const unassigned = buildRow(null, (s) => !s.assignee || !memberNames.has(s.assignee));
  if (unassigned.totalLoad > 0) rows.push(unassigned);
  return rows;
}

/** Column totals (per iteration + grand totals) across the given rows. */
export function loadCapacityTotals(
  rows: MemberLoadRow[],
): { slots: Record<IterationSlot, SlotLoadCap>; totalLoad: number; totalCapacity: number } {
  const slots = emptySlots();
  for (const row of rows) {
    for (const s of ITERATION_SLOTS) {
      slots[s].load += row.slots[s].load;
      slots[s].capacity += row.slots[s].capacity;
    }
  }
  const row = finalize(null, slots);
  return { slots: row.slots, totalLoad: row.totalLoad, totalCapacity: row.totalCapacity };
}
