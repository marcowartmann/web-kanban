import { useCallback, useEffect, useState } from "react";
import { getBoard } from "../api/client";
import type { BoardColumn } from "../types";

export function useBoard() {
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

  return { columns, loading, error, reload, setColumns };
}
