import { arrayMove } from "@dnd-kit/sortable";
import type { Item } from "../types";

function cmpDescNullsLast(a: number | null | undefined, b: number | null | undefined): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return b - a;
}

function cmpAscNullsLast(a: number | null | undefined, b: number | null | undefined): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return a - b;
}

export function byWsjf(features: Item[]): Item[] {
  return [...features].sort(
    (a, b) => cmpDescNullsLast(a.wsjf_score, b.wsjf_score) || a.id - b.id,
  );
}

export function byManual(features: Item[]): Item[] {
  return [...features].sort(
    (a, b) =>
      cmpAscNullsLast(a.manual_rank, b.manual_rank) ||
      cmpDescNullsLast(a.wsjf_score, b.wsjf_score) ||
      a.id - b.id,
  );
}

/** Map each feature id to its 1-based position in the WSJF ordering. */
export function wsjfRankMap(features: Item[]): Map<number, number> {
  const m = new Map<number, number>();
  byWsjf(features).forEach((f, i) => m.set(f.id, i + 1));
  return m;
}

/** Given the current manual order and a drag from activeId onto overId,
 *  return the id that ends up immediately before the moved item (the reorder
 *  anchor), or null if it moves to the top. */
export function computeAfterId(order: Item[], activeId: number, overId: number): number | null {
  const oldIndex = order.findIndex((f) => f.id === activeId);
  const newIndex = order.findIndex((f) => f.id === overId);
  if (oldIndex < 0 || newIndex < 0) return null;
  const next = arrayMove(order, oldIndex, newIndex);
  const idx = next.findIndex((f) => f.id === activeId);
  return idx > 0 ? next[idx - 1].id : null;
}
