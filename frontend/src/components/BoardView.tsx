import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { useMemo } from "react";
import { updateItem } from "../api/client";
import { UNSCHEDULED, buildBoardCards, groupIntoLanes } from "../lib/boardLanes";
import type { Board, BoardCard, Item } from "../types";
import type { BoardFilters } from "./Toolbar";
import Column from "./Column";

export async function handleCardDragEnd(
  event: DragEndEvent,
  reload: () => Promise<void> | void,
): Promise<void> {
  if (!event.over) return;
  const cardId = Number(event.active.id);
  const target = String(event.over.id);
  await updateItem(cardId, { status: target === UNSCHEDULED ? "" : target });
  await reload();
}

function visible(cards: BoardCard[], board: Board, f: BoardFilters): BoardCard[] {
  const boardKinds = new Set(board.kinds);
  const selected = f.kinds && f.kinds.length ? new Set(f.kinds) : null;
  const q = f.q?.toLowerCase();
  return cards.filter((c) => {
    if (!boardKinds.has(c.kind)) return false;
    if (selected && !selected.has(c.kind)) return false;
    if (f.iteration && c.iteration !== f.iteration) return false;
    if (f.leading_team && c.leading_team !== f.leading_team) return false;
    if (q && !c.title.toLowerCase().includes(q)) return false;
    return true;
  });
}

export default function BoardView({
  board,
  items,
  filters,
  onOpenCard,
  onOpenStories,
  onChanged,
}: {
  board: Board;
  items: Item[];
  filters: BoardFilters;
  onOpenCard: (id: number) => void;
  onOpenStories: (featureId: number) => void;
  onChanged: () => void | Promise<void>;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );
  const columns = useMemo(() => {
    const cards = buildBoardCards(items);
    return groupIntoLanes(visible(cards, board, filters), board.lanes);
  }, [items, board, filters]);

  return (
    <DndContext
      sensors={sensors}
      onDragEnd={(event) => void handleCardDragEnd(event, onChanged)}
    >
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
