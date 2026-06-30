import { useCallback, useEffect, useState } from "react";
import { getBoards, listItems } from "../api/client";
import type { Board, Item } from "../types";

export function useBoard() {
  const [boards, setBoards] = useState<Board[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [b, its] = await Promise.all([getBoards(), listItems()]);
      setBoards(b);
      setItems(its);
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

  return { boards, items, loading, error, reload };
}
