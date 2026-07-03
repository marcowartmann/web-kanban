import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { useMemo, useState } from "react";
import { ConflictError, updateItem } from "../api/client";
import { UNSCHEDULED, buildBoardCards, groupIntoLanes } from "../lib/boardLanes";
import type { Board, BoardCard, Container, Item, LinkRow } from "../types";
import type { BoardFilters } from "./Toolbar";
import Column from "./Column";
import LaneEditor from "./LaneEditor";
import { btnSecondary } from "./ui";

export async function handleCardDragEnd(
  event: DragEndEvent,
  items: Item[],
  reload: () => Promise<void> | void,
): Promise<void> {
  if (!event.over) return;
  const cardId = Number(event.active.id);
  const current = items.find((i) => i.id === cardId);
  if (!current) return;
  const target = String(event.over.id);
  try {
    await updateItem(cardId, {
      status: target === UNSCHEDULED ? "" : target,
      version: current.version,
    });
  } catch (e) {
    if (!(e instanceof ConflictError)) throw e;
    // Someone else changed the card — the reload below snaps it back.
  }
  await reload();
}

function visible(
  cards: BoardCard[],
  board: Board,
  f: BoardFilters,
  containers: Container[] = [],
): BoardCard[] {
  const boardKinds = new Set(board.kinds);
  const selected = f.kinds && f.kinds.length ? new Set(f.kinds) : null;
  const q = f.q?.toLowerCase();
  // Container names repeat across (team, PI) scopes — filtering by name means
  // matching any container id carrying that name.
  const containerIds = f.container
    ? new Set(containers.filter((c) => c.name === f.container).map((c) => c.id))
    : null;
  return cards.filter((c) => {
    if (!boardKinds.has(c.kind)) return false;
    if (selected && !selected.has(c.kind)) return false;
    if (f.planning_interval && c.planning_interval !== f.planning_interval) return false;
    if (f.leading_team && c.leading_team !== f.leading_team) return false;
    if (f.assignee && c.assignee !== f.assignee) return false;
    if (containerIds && (c.container_id == null || !containerIds.has(c.container_id))) return false;
    if (q && !c.title.toLowerCase().includes(q)) return false;
    return true;
  });
}

export default function BoardView({
  board,
  items,
  links,
  filters,
  containers = [],
  onOpenCard,
  onOpenStories,
  onChanged,
  canEditLanes = true,
}: {
  board: Board;
  items: Item[];
  links: LinkRow[];
  filters: BoardFilters;
  containers?: Container[];
  onOpenCard: (id: number) => void;
  onOpenStories: (featureId: number) => void;
  onChanged: () => void | Promise<void>;
  canEditLanes?: boolean;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );
  const columns = useMemo(() => {
    const cards = buildBoardCards(items, links);
    return groupIntoLanes(visible(cards, board, filters, containers), board.lanes);
  }, [items, links, board, filters, containers]);

  const [editing, setEditing] = useState(false);

  return (
    <div>
      {canEditLanes && (
        <div className="flex justify-end px-6 pt-3">
          <button onClick={() => setEditing((v) => !v)} className={btnSecondary}>
            {editing ? "Done" : "Edit lanes"}
          </button>
        </div>
      )}
      {canEditLanes && editing && <LaneEditor board={board} onChanged={onChanged} />}
      <DndContext
        sensors={sensors}
        onDragEnd={(event) => void handleCardDragEnd(event, items, onChanged)}
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
    </div>
  );
}
