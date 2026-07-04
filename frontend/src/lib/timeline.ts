import type { Item, LinkRow } from "../types";
import { ITERATION_SLOTS, type IterationSlot } from "./iterations";

export interface FeatureLane {
  feature: Item | null; // null = the "No feature" orphan lane
  backlog: Item[];
  slots: Record<IterationSlot, Item[]>;
}

const emptySlots = (): Record<IterationSlot, Item[]> => ({ 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] });

function placeStory(bucket: { backlog: Item[]; slots: Record<IterationSlot, Item[]> }, story: Item): void {
  const n = story.iteration;
  if (n != null && n >= 1 && n <= 6) bucket.slots[n as IterationSlot].push(story);
  else bucket.backlog.push(story);
}

export function groupByFeature(items: Item[], pi: string, opts: { showAll: boolean }): FeatureLane[] {
  const featureById = new Map<number, Item>();
  for (const it of items) if (it.kind === "feature") featureById.set(it.id, it);

  const laneByKey = new Map<number | null, FeatureLane>();
  const ensureLane = (key: number | null, feature: Item | null): FeatureLane => {
    let lane = laneByKey.get(key);
    if (!lane) laneByKey.set(key, (lane = { feature, backlog: [], slots: emptySlots() }));
    return lane;
  };

  for (const it of items) {
    if (it.kind !== "story" || it.planning_interval !== pi) continue;
    const parent = it.parent_id != null ? featureById.get(it.parent_id) : undefined;
    placeStory(ensureLane(parent ? parent.id : null, parent ?? null), it);
  }

  if (opts.showAll) {
    for (const f of featureById.values()) {
      if (f.planning_interval === pi && !laneByKey.has(f.id)) ensureLane(f.id, f);
    }
  }

  const hasSlotStory = (lane: FeatureLane) => ITERATION_SLOTS.some((s) => lane.slots[s].length > 0);
  let lanes = [...laneByKey.values()];
  if (!opts.showAll) lanes = lanes.filter(hasSlotStory);

  // Order by manual ranking, ascending (rank 1 / highest priority first, as on
  // the Ranking page). Unranked features fall to the bottom; the orphan lane
  // always sorts last. Ties break on the feature's board position, then title.
  const rankAscNullsLast = (a: number | null | undefined, b: number | null | undefined): number => {
    if (a == null && b == null) return 0;
    if (a == null) return 1;
    if (b == null) return -1;
    return a - b;
  };
  lanes.sort((a, b) => {
    if (!a.feature) return 1;
    if (!b.feature) return -1;
    return (
      rankAscNullsLast(a.feature.manual_rank, b.feature.manual_rank) ||
      a.feature.position - b.feature.position ||
      a.feature.title.localeCompare(b.feature.title)
    );
  });
  return lanes;
}

export function layoutFlat(items: Item[], pi: string): { backlog: Item[]; slots: Record<IterationSlot, Item[]> } {
  const out = { backlog: [] as Item[], slots: emptySlots() };
  for (const it of items) {
    if (it.kind === "story" && it.planning_interval === pi) placeStory(out, it);
    else out.backlog.push(it);
  }
  return out;
}

export function dependencyComponent(items: Item[], links: LinkRow[], selectedIds: Iterable<number>): Set<number> {
  const adj = new Map<number, number[]>();
  const add = (a: number, b: number) => {
    const arr = adj.get(a);
    if (arr) arr.push(b);
    else adj.set(a, [b]);
  };
  for (const link of links) {
    if (link.relation !== "blocks" && link.relation !== "relates_to") continue;
    add(link.source_id, link.target_id);
    add(link.target_id, link.source_id);
  }
  const seen = new Set<number>();
  const queue: number[] = [];
  for (const id of selectedIds) {
    if (!seen.has(id)) {
      seen.add(id);
      queue.push(id);
    }
  }
  while (queue.length) {
    const cur = queue.shift()!;
    for (const nb of adj.get(cur) ?? []) {
      if (!seen.has(nb)) {
        seen.add(nb);
        queue.push(nb);
      }
    }
  }
  return seen;
}
