import { useCallback, useEffect, useMemo, useState } from "react";
import { getBoard } from "../api/client";
import type { BoardColumn } from "../types";
import type { BoardFilters } from "../components/Toolbar";

function matches(card: BoardColumn["cards"][number], f: BoardFilters): boolean {
  if (f.kinds?.length && !f.kinds.includes(card.kind)) return false;
  if (f.iteration && card.iteration !== f.iteration) return false;
  if (f.leading_team && card.leading_team !== f.leading_team) return false;
  if (f.q && !card.title.toLowerCase().includes(f.q.toLowerCase())) return false;
  return true;
}

export function useBoard(filters: BoardFilters = {}) {
  const [columns, setColumns] = useState<BoardColumn[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setColumns(await getBoard());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load board");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const filtered = useMemo(
    () =>
      columns.map((col) => ({
        ...col,
        cards: col.cards.filter((card) => matches(card, filters)),
      })),
    [columns, filters],
  );

  return { columns: filtered, raw: columns, loading, error, reload, setColumns };
}
