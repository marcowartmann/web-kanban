import type { Item } from "../types";

// A Planning Interval has 6 iteration slots: development 1..5 plus IP (6).
export const ITERATION_SLOTS = [1, 2, 3, 4, 5, 6] as const;
export type IterationSlot = (typeof ITERATION_SLOTS)[number];

export function iterationLabel(slot: number): string {
  return slot === 6 ? "IP" : `Iteration ${slot}`;
}

export interface IterationGroups {
  backlog: Item[];
  slots: Record<IterationSlot, Item[]>;
}

// Group the stories of one Planning Interval into a backlog (no iteration)
// plus the six iteration slots. Items from other PIs and non-stories are ignored.
export function groupStoriesByIteration(items: Item[], pi: string): IterationGroups {
  const groups: IterationGroups = {
    backlog: [],
    slots: { 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] },
  };
  for (const item of items) {
    if (item.kind !== "story" || item.planning_interval !== pi) continue;
    const slot = item.iteration;
    if (slot != null && slot >= 1 && slot <= 6) {
      groups.slots[slot as IterationSlot].push(item);
    } else {
      groups.backlog.push(item);
    }
  }
  return groups;
}

export function slotPoints(stories: Item[]): number {
  const total = stories.reduce((sum, s) => sum + (s.story_points ?? 0), 0);
  // Trim float noise from summed Numerics (e.g. 2.4000000000000004).
  return Math.round(total * 100) / 100;
}
