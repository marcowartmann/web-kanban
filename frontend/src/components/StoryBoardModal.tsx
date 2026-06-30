import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { useCallback, useEffect, useState } from "react";
import { createItem, getItem, updateItem } from "../api/client";
import { groupByStatus } from "../lib/groupByStatus";
import type { Item } from "../types";
import Column from "./Column";

export async function handleStoryDragEnd(
  event: DragEndEvent,
  reload: () => Promise<void>,
): Promise<void> {
  if (!event.over) return;
  await updateItem(Number(event.active.id), { status: String(event.over.id) });
  await reload();
}

export default function StoryBoardModal({
  featureId,
  refreshSignal,
  onClose,
  onOpenItem,
  onChanged,
}: {
  featureId: number;
  refreshSignal?: number;
  onClose: () => void;
  onOpenItem: (id: number) => void;
  onChanged: () => void;
}) {
  const [feature, setFeature] = useState<Item | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setFeature(await getItem(featureId));
    } catch (e) {
      setError(String(e));
    }
  }, [featureId]);

  useEffect(() => {
    void reload();
  }, [reload, refreshSignal]);

  // 8px drag threshold so clicking a story opens it instead of starting a drag.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  const addStory = async () => {
    const title = window.prompt("New story title");
    if (!title) return;
    try {
      await createItem({ kind: "story", title, parent_id: featureId });
      await reload();
      onChanged();
    } catch (e) {
      setError(String(e));
    }
  };

  const onDragEnd = async (event: DragEndEvent) => {
    try {
      await handleStoryDragEnd(event, reload);
      onChanged();
    } catch (e) {
      setError(String(e));
    }
  };

  const columns = groupByStatus(feature?.children ?? []);
  const isEmpty = columns.every((c) => c.cards.length === 0);

  return (
    <div
      className="fixed inset-0 z-20 flex items-center justify-center bg-black/40 p-6"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-5xl flex-col rounded-xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b px-5 py-3">
          <h2 className="truncate text-base font-semibold text-gray-900">
            {feature ? feature.title : "Loading…"}
            <span className="ml-1 font-normal text-gray-400">— Stories</span>
          </h2>
          <div className="flex shrink-0 items-center gap-2">
            <button
              onClick={() => onOpenItem(featureId)}
              className="rounded bg-gray-100 px-3 py-1 text-sm font-medium text-gray-700"
            >
              Edit feature
            </button>
            <button
              onClick={addStory}
              className="rounded bg-blue-600 px-3 py-1 text-sm font-medium text-white"
            >
              + Add story
            </button>
            <button
              onClick={onClose}
              aria-label="Close"
              className="rounded px-2 py-1 text-lg leading-none text-gray-400 hover:text-gray-700"
            >
              ×
            </button>
          </div>
        </div>

        {error && <p className="px-5 py-2 text-sm text-red-600">{error}</p>}

        <div className="overflow-auto p-4">
          {feature && isEmpty ? (
            <p className="p-6 text-sm text-gray-500">
              No stories yet. Use “+ Add story”.
            </p>
          ) : (
            <DndContext sensors={sensors} onDragEnd={(e) => void onDragEnd(e)}>
              <div className="flex gap-4">
                {columns.map((column) => (
                  <Column
                    key={column.status}
                    column={column}
                    onOpenCard={onOpenItem}
                  />
                ))}
              </div>
            </DndContext>
          )}
        </div>
      </div>
    </div>
  );
}
