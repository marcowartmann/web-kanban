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
    });
  }

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
    } else if (blockerPos > blockedPos) {
      onBlocked.conflicts.push({
        severity: "error",
        message: `Blocked by ${label(blocker, link.source_id)} scheduled in ${iterationLabel(blockerPos)} (after this)`,
      });
      onBlocker.conflicts.push({
        severity: "error",
        message: `Blocks ${label(blocked, link.target_id)} in ${iterationLabel(blockedPos)} (before this)`,
      });
    } else if (blockerPos === blockedPos) {
      onBlocked.conflicts.push({
        severity: "warning",
        message: `Same iteration as blocker ${label(blocker, link.source_id)}`,
      });
      onBlocker.conflicts.push({
        severity: "warning",
        message: `Same iteration as blocked ${label(blocked, link.target_id)}`,
      });
    }
    // blockerPos < blockedPos: correctly ordered, no conflict.
  }

  return info;
}
