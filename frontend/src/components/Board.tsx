import { DndContext, type DragEndEvent } from "@dnd-kit/core";
import { useBoard } from "../hooks/useBoard";
import { updateItem } from "../api/client";
import type { BoardFilters } from "./Toolbar";
import Column from "./Column";

export async function handleDragEnd(
  event: DragEndEvent,
  reload: () => Promise<void>,
): Promise<void> {
  if (!event.over) return;
  const cardId = Number(event.active.id);
  const targetStatus = String(event.over.id);
  await updateItem(cardId, { status: targetStatus });
  await reload();
}

export default function Board({
  filters = {},
  onOpenCard,
  onOpenStories,
}: {
  filters?: BoardFilters;
  onOpenCard: (id: number) => void;
  onOpenStories?: (featureId: number) => void;
}) {
  const { columns, loading, error, reload } = useBoard(filters);

  if (loading) return <div className="p-8 text-gray-500">Loading board…</div>;
  if (error) return <div className="p-8 text-red-600">{error}</div>;

  return (
    <DndContext onDragEnd={(event) => void handleDragEnd(event, reload)}>
      <div className="flex gap-4 overflow-x-auto p-6">
        {columns.map((column) => (
          <Column
            key={column.status}
            column={column}
            onOpenCard={onOpenCard}
            onOpenStories={onOpenStories}
          />
        ))}
      </div>
    </DndContext>
  );
}
