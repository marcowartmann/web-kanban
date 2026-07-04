import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faXmark } from "../icons";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { useCallback, useEffect, useState } from "react";
import { ConflictError, createItem, getItem, updateItem } from "../api/client";
import { groupByStatus } from "../lib/groupByStatus";
import type { Item } from "../types";
import Column from "./Column";
import InlineAddInput from "./InlineAddInput";

export async function handleStoryDragEnd(
  event: DragEndEvent,
  items: Item[],
  reload: () => Promise<void>,
): Promise<void> {
  if (!event.over) return;
  const storyId = Number(event.active.id);
  const current = items.find((i) => i.id === storyId);
  if (!current) return;
  try {
    await updateItem(storyId, { status: String(event.over.id), version: current.version });
  } catch (e) {
    if (!(e instanceof ConflictError)) throw e;
    // Someone else changed the story — the reload below snaps it back.
  }
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
  const [addingStory, setAddingStory] = useState(false);

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

  const addStory = async (title: string) => {
    try {
      await createItem({ kind: "story", title, parent_id: featureId });
      setAddingStory(false);
      await reload();
      onChanged();
    } catch (e) {
      setError(String(e));
    }
  };

  const onDragEnd = async (event: DragEndEvent) => {
    try {
      await handleStoryDragEnd(event, feature?.children ?? [], reload);
      onChanged();
    } catch (e) {
      setError(String(e));
    }
  };

  const columns = groupByStatus(feature?.children ?? []);
  const isEmpty = columns.every((c) => c.cards.length === 0);

  return (
    <div
      className="fixed inset-0 z-20 flex items-center justify-center bg-black/40 p-6 backdrop-blur-xs"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-surface shadow-2xl ring-1 ring-black/5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-gray-200 bg-linear-to-b from-blue-50/90 via-blue-50/40 to-surface px-5 py-3.5">
          <h2 className="flex min-w-0 items-center gap-2 text-base font-semibold text-gray-900">
            <span className="shrink-0 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
              Feature
            </span>
            {feature && <span className="shrink-0 text-xs text-gray-400">#{feature.id}</span>}
            <span className="truncate">{feature ? feature.title : "Loading…"}</span>
            <span className="shrink-0 rounded-full bg-surface px-2 py-0.5 text-xs font-medium text-gray-500 ring-1 ring-gray-200">
              {feature?.children?.length ?? 0} stories
            </span>
            {feature?.wsjf_score != null && (
              <span className="shrink-0 rounded-full bg-amber-100/80 px-2 py-0.5 text-xs font-semibold text-amber-700">
                WSJF {feature.wsjf_score}
              </span>
            )}
          </h2>
          <div className="flex shrink-0 items-center gap-2">
            <button
              onClick={() => onOpenItem(featureId)}
              className="rounded-lg border border-gray-200 bg-surface px-3 py-1.5 text-sm font-medium text-gray-700 shadow-xs transition hover:bg-gray-50"
            >
              Edit feature
            </button>
            {addingStory ? (
              <div className="w-64">
                <InlineAddInput
                  ariaLabel="New story title"
                  placeholder="Story title — Enter to add"
                  onSubmit={addStory}
                  onCancel={() => setAddingStory(false)}
                />
              </div>
            ) : (
              <button
                onClick={() => setAddingStory(true)}
                className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white shadow-xs transition hover:bg-blue-700"
              >
                + Add story
              </button>
            )}
            <button
              onClick={onClose}
              aria-label="Close"
              className="rounded-lg p-1.5 text-gray-400 transition hover:bg-surface/70 hover:text-gray-700"
            >
              <FontAwesomeIcon icon={faXmark} aria-hidden />
            </button>
          </div>
        </div>

        {error && <p className="px-5 py-2 text-sm text-red-600">{error}</p>}

        <div className="overflow-auto bg-gray-50 p-4">
          {feature && isEmpty ? (
            <div className="flex flex-col items-center justify-center gap-1 p-12 text-center">
              <p className="text-sm font-medium text-gray-600">No stories yet</p>
              <p className="text-sm text-gray-400">Use “+ Add story” to add the first one.</p>
            </div>
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
