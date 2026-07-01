import type { Item, LinkRow } from "../types";
import { iterationLabel } from "./iterations";
import { linkCounts } from "./links";

export type ConflictSeverity = "error" | "warning";

export interface CardConflict {
  severity: ConflictSeverity;
  message: string;
}

export interface CardLinkInfo {
  blocks_count: number;
  blocked_by_count: number;
  related_count: number;
  conflicts: CardConflict[];
  /** Item ids on the other end of this card's conflicts (for hover highlighting). */
  conflictPartners: number[];
  /** Item ids of every dependency partner (any relation), for hover highlighting. */
  linkPartners: number[];
}

/**
 * Per-item dependency badges + timeline conflicts for one Planning Interval.
 *
 * Counts cover all links (like the board). Conflicts come only from `blocks`
 * edges, evaluated against the sequential iterations of `pi`: a blocker
 * scheduled in a later iteration than the item it blocks is an error; the same
 * iteration, or a blocker not scheduled in this PI, is a warning. Only entries
 * for items that have a count or a conflict are returned.
 */
export function computePlanningLinks(
  items: Item[],
  links: LinkRow[],
  pi: string,
): Map<number, CardLinkInfo> {
  const byId = new Map<number, Item>();
  for (const it of items) byId.set(it.id, it);

  // A story's iteration slot within `pi`, or null if it isn't scheduled here
  // (this PI's backlog, another PI, or a non-story feature/risk).
  const positionInPi = (it: Item | undefined): number | null => {
    if (!it || it.kind !== "story" || it.planning_interval !== pi) return null;
    const n = it.iteration;
    return n != null && n >= 1 && n <= 6 ? n : null;
  };

  // Every dependency partner of an item (both ends of each blocks/relates_to edge).
  const neighbors = new Map<number, Set<number>>();
  const addNeighbor = (a: number, b: number) => {
    let set = neighbors.get(a);
    if (!set) neighbors.set(a, (set = new Set()));
    set.add(b);
  };
  for (const link of links) {
    if (link.relation !== "blocks" && link.relation !== "relates_to") continue;
    addNeighbor(link.source_id, link.target_id);
    addNeighbor(link.target_id, link.source_id);
  }

  const counts = linkCounts(links);
  const info = new Map<number, CardLinkInfo>();
  const ids = new Set<number>([
    ...counts.blocks.keys(),
    ...counts.blockedBy.keys(),
    ...counts.related.keys(),
  ]);
  for (const id of ids) {
    info.set(id, {
      blocks_count: counts.blocks.get(id) ?? 0,
      blocked_by_count: counts.blockedBy.get(id) ?? 0,
      related_count: counts.related.get(id) ?? 0,
      conflicts: [],
      conflictPartners: [],
      linkPartners: [...(neighbors.get(id) ?? [])],
    });
  }

  // Track each conflicting card's counterpart ids (for hover highlighting).
  const partners = new Map<number, Set<number>>();
  const addPartner = (cardId: number, otherId: number) => {
    let set = partners.get(cardId);
    if (!set) partners.set(cardId, (set = new Set()));
    set.add(otherId);
  };

  const label = (it: Item | undefined, id: number) => `"${it?.title ?? "?"}" (#${id})`;

  for (const link of links) {
    if (link.relation !== "blocks") continue;
    const blocker = byId.get(link.source_id);
    const blocked = byId.get(link.target_id);
    const blockerPos = positionInPi(blocker);
    const blockedPos = positionInPi(blocked);

    // Only when the blocked item is scheduled here is there a timeline to violate.
    if (blockedPos == null) continue;

    // Both endpoints are `blocks` edges, so both are already in `info`.
    const onBlocked = info.get(link.target_id)!;
    const onBlocker = info.get(link.source_id)!;

    if (blockerPos == null) {
      onBlocked.conflicts.push({
        severity: "warning",
        message: `Blocked by ${label(blocker, link.source_id)}, not scheduled in this PI`,
      });
      addPartner(link.target_id, link.source_id);
    } else if (blockerPos > blockedPos) {
      onBlocked.conflicts.push({
        severity: "error",
        message: `Blocked by ${label(blocker, link.source_id)} scheduled in ${iterationLabel(blockerPos)} (after this)`,
      });
      onBlocker.conflicts.push({
        severity: "error",
        message: `Blocks ${label(blocked, link.target_id)} in ${iterationLabel(blockedPos)} (before this)`,
      });
      addPartner(link.target_id, link.source_id);
      addPartner(link.source_id, link.target_id);
    } else if (blockerPos === blockedPos) {
      onBlocked.conflicts.push({
        severity: "warning",
        message: `Same iteration as blocker ${label(blocker, link.source_id)}`,
      });
      onBlocker.conflicts.push({
        severity: "warning",
        message: `Same iteration as blocked ${label(blocked, link.target_id)}`,
      });
      addPartner(link.target_id, link.source_id);
      addPartner(link.source_id, link.target_id);
    }
    // blockerPos < blockedPos: correctly ordered, no conflict.
  }

  for (const [id, set] of partners) info.get(id)!.conflictPartners = [...set];

  return info;
}
