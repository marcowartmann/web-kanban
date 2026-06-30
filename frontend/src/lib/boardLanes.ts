import type { BoardCard, BoardColumn, Item } from "../types";

export const UNSCHEDULED = "Unscheduled";

/** Map items to BoardCards, computing per-feature child aggregates client-side. */
export function buildBoardCards(items: Item[]): BoardCard[] {
  const childrenByParent = new Map<number, Item[]>();
  for (const it of items) {
    if (it.parent_id != null) {
      const arr = childrenByParent.get(it.parent_id) ?? [];
      arr.push(it);
      childrenByParent.set(it.parent_id, arr);
    }
  }
  return items.map((it) => {
    const kids = childrenByParent.get(it.id) ?? [];
    return {
      ...it,
      children_count: kids.length,
      children_points: kids.reduce((sum, c) => sum + (c.story_points ?? 0), 0),
    };
  });
}

/** Columns = the given lanes in order, each with cards whose status matches the
 *  lane name, plus a trailing Unscheduled column for unmatched/blank statuses. */
export function groupIntoLanes(
  cards: BoardCard[],
  lanes: { name: string }[],
): BoardColumn[] {
  const buckets = new Map<string, BoardCard[]>();
  for (const lane of lanes) buckets.set(lane.name, []);
  const unscheduled: BoardCard[] = [];
  for (const card of cards) {
    const status = (card.status ?? "").trim();
    const bucket = status ? buckets.get(status) : undefined;
    if (bucket) bucket.push(card);
    else unscheduled.push(card);
  }
  const columns: BoardColumn[] = lanes.map((lane) => ({
    status: lane.name,
    cards: buckets.get(lane.name) ?? [],
  }));
  columns.push({ status: UNSCHEDULED, cards: unscheduled });
  return columns;
}
