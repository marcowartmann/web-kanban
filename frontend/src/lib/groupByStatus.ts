import type { BoardCard, BoardColumn, Item } from "../types";

// Mirrors the backend board ordering (backend/app/routers/board.py).
const STATUS_ORDER = ["Funnel", "Analyzing", "New"];
const UNSCHEDULED = "Unscheduled";

function statusKey(status: string): [number, string] {
  if (status === UNSCHEDULED) return [STATUS_ORDER.length + 1, ""];
  const idx = STATUS_ORDER.indexOf(status);
  if (idx !== -1) return [idx, ""];
  return [STATUS_ORDER.length, status.toLowerCase()];
}

function toCard(item: Item): BoardCard {
  return { ...item, children_count: 0, children_points: 0, blocked_by_count: 0, blocks_count: 0 };
}

/**
 * Group items into board columns by status, using the canonical order
 * Funnel -> Analyzing -> New -> (other statuses A-Z) -> Unscheduled. Blank or
 * missing status maps to the Unscheduled column. Each item is mapped to a
 * BoardCard (children aggregates default to 0).
 */
export function groupByStatus(items: Item[]): BoardColumn[] {
  const grouped = new Map<string, BoardCard[]>();
  for (const item of items) {
    const status = (item.status ?? "").trim() || UNSCHEDULED;
    const list = grouped.get(status) ?? [];
    list.push(toCard(item));
    grouped.set(status, list);
  }
  return [...grouped.entries()]
    .sort(([a], [b]) => {
      const ka = statusKey(a);
      const kb = statusKey(b);
      return ka[0] - kb[0] || ka[1].localeCompare(kb[1]);
    })
    .map(([status, cards]) => ({ status, cards }));
}
