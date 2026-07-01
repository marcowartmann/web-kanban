import { useCallback, useEffect, useState } from "react";
import { getBoards, getPlanningIntervals, listItems, listLinks } from "../api/client";
import type { Board, Item, LinkRow } from "../types";

export function useBoard() {
  const [boards, setBoards] = useState<Board[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [links, setLinks] = useState<LinkRow[]>([]);
  const [planningIntervals, setPlanningIntervals] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [b, its, lks, pis] = await Promise.all([
        getBoards(),
        listItems(),
        listLinks(),
        getPlanningIntervals(),
      ]);
      setBoards(b);
      setItems(its);
      setLinks(lks);
      setPlanningIntervals(pis.map((p) => p.name));
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

  return { boards, items, links, planningIntervals, loading, error, reload };
}
