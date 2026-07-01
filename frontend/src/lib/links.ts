import type { LinkRow } from "../types";

export interface LinkCounts {
  blocks: Map<number, number>; // outgoing `blocks`, keyed by source id
  blockedBy: Map<number, number>; // incoming `blocks`, keyed by target id
  related: Map<number, number>; // `relates_to`, both endpoints
}

/** Tally dependency links per item id: blocks (outgoing), blocked-by (incoming),
 *  and relates-to (both endpoints). Shared by the board and planning badges. */
export function linkCounts(links: LinkRow[]): LinkCounts {
  const blocks = new Map<number, number>();
  const blockedBy = new Map<number, number>();
  const related = new Map<number, number>();
  const bump = (m: Map<number, number>, id: number) => m.set(id, (m.get(id) ?? 0) + 1);
  for (const link of links) {
    if (link.relation === "blocks") {
      bump(blocks, link.source_id);
      bump(blockedBy, link.target_id);
    } else if (link.relation === "relates_to") {
      bump(related, link.source_id);
      bump(related, link.target_id);
    }
  }
  return { blocks, blockedBy, related };
}
