import { DndContext, type DragEndEvent } from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { useState } from "react";
import { addLane, deleteLane, renameLane, reorderLanes } from "../api/client";
import type { Board } from "../types";

export async function handleLaneDragEnd(
  event: DragEndEvent,
  board: Board,
  onChanged: () => void | Promise<void>,
): Promise<void> {
  if (!event.over || event.active.id === event.over.id) return;
  const ids = board.lanes.map((l) => l.id);
  const from = ids.indexOf(Number(event.active.id));
  const to = ids.indexOf(Number(event.over.id));
  if (from === -1 || to === -1) return;
  await reorderLanes(board.id, arrayMove(ids, from, to));
  await onChanged();
}

function LaneChip({
  id,
  name,
  onRename,
  onDelete,
}: {
  id: number;
  name: string;
  onRename: (id: number, name: string) => void;
  onDelete: (id: number) => void;
}) {
  const { attributes, listeners, setNodeRef, transform } = useSortable({ id });
  const [value, setValue] = useState(name);
  const style = transform
    ? { transform: `translate(${transform.x}px, ${transform.y}px)` }
    : undefined;
  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-1 rounded border border-gray-300 bg-white px-2 py-1 text-sm"
    >
      <span {...attributes} {...listeners} className="cursor-grab text-gray-400">⠿</span>
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => value.trim() && value !== name && onRename(id, value.trim())}
        className="w-24 rounded border border-transparent px-1 hover:border-gray-200"
      />
      <button
        aria-label={`delete lane ${id}`}
        onClick={() => onDelete(id)}
        className="text-gray-400 hover:text-red-600"
      >
        ×
      </button>
    </div>
  );
}

export default function LaneEditor({
  board,
  onChanged,
}: {
  board: Board;
  onChanged: () => void | Promise<void>;
}) {
  const [newName, setNewName] = useState("");

  const onRename = async (id: number, name: string) => {
    await renameLane(id, name);
    await onChanged();
  };
  const onDelete = async (id: number) => {
    await deleteLane(id);
    await onChanged();
  };
  const onAdd = async () => {
    if (!newName.trim()) return;
    await addLane(board.id, newName.trim());
    setNewName("");
    await onChanged();
  };

  return (
    <div className="flex flex-wrap items-center gap-2 border-b bg-gray-50 px-6 py-3">
      <DndContext onDragEnd={(e) => void handleLaneDragEnd(e, board, onChanged)}>
        <SortableContext
          items={board.lanes.map((l) => l.id)}
          strategy={horizontalListSortingStrategy}
        >
          <div className="flex flex-wrap gap-2">
            {board.lanes.map((lane) => (
              <LaneChip
                key={lane.id}
                id={lane.id}
                name={lane.name}
                onRename={onRename}
                onDelete={onDelete}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
      <div className="flex items-center gap-1">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="New lane"
          className="rounded border border-gray-300 px-2 py-1 text-sm"
        />
        <button
          onClick={onAdd}
          className="rounded bg-blue-600 px-3 py-1 text-sm text-white"
        >
          Add lane
        </button>
      </div>
    </div>
  );
}
