import type { Board, BoardCard, BoardColumn, Item, ItemKind, LinkRow } from "../types";
import { linkCounts } from "./links";

export const UNSCHEDULED = "Unscheduled";

/** Map items to BoardCards, computing per-feature child aggregates and
 *  dependency counts (blocks / blocked-by / relates-to) client-side. */
export function buildBoardCards(items: Item[], links: LinkRow[] = []): BoardCard[] {
  const childrenByParent = new Map<number, Item[]>();
  for (const it of items) {
    if (it.parent_id != null) {
      const arr = childrenByParent.get(it.parent_id) ?? [];
      arr.push(it);
      childrenByParent.set(it.parent_id, arr);
    }
  }

  const counts = linkCounts(links);

  return items.map((it) => {
    const kids = childrenByParent.get(it.id) ?? [];
    const points = kids.reduce((sum, c) => sum + (c.story_points ?? 0), 0);
    return {
      ...it,
      children_count: kids.length,
      // Trim float noise from summed Numerics (e.g. 2.4000000000000004).
      children_points: Math.round(points * 100) / 100,
      blocked_by_count: counts.blockedBy.get(it.id) ?? 0,
      blocks_count: counts.blocks.get(it.id) ?? 0,
      related_count: counts.related.get(it.id) ?? 0,
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

/** Status options per item kind: the lane names of the boards whose `kinds`
 *  include that kind, in lane order, deduped. */
export function statusOptionsByKind(boards: Board[]): Partial<Record<ItemKind, string[]>> {
  const out: Partial<Record<ItemKind, string[]>> = {};
  for (const board of boards) {
    for (const kind of board.kinds) {
      const list = out[kind] ?? (out[kind] = []);
      for (const lane of board.lanes) {
        if (!list.includes(lane.name)) list.push(lane.name);
      }
    }
  }
  return out;
}
