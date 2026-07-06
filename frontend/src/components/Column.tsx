import { useDroppable } from "@dnd-kit/core";
import type { BoardColumn } from "../types";
import Card from "./Card";

export default function Column({
  column,
  onOpenCard,
  onOpenStories,
}: {
  column: BoardColumn;
  onOpenCard: (id: number) => void;
  onOpenStories?: (featureId: number) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: column.status });
  return (
    <div
      ref={setNodeRef}
      className={`flex w-72 shrink-0 flex-col rounded-xl p-3 ${
        isOver ? "bg-blue-50 ring-2 ring-blue-300" : "bg-gray-100"
      }`}
    >
      {/* Sticky within the board's scroll container so the lane title + count
          stay visible while the board scrolls. Negative margins + matching bg
          extend the header to the column edges so cards scroll cleanly behind. */}
      <h2
        className={`sticky top-0 z-10 -mx-3 -mt-3 mb-3 flex items-center justify-between rounded-t-xl px-3 pb-2 pt-3 text-sm font-semibold text-gray-700 ${
          isOver ? "bg-blue-50" : "bg-gray-100"
        }`}
      >
        <span>{column.status}</span>
        <span className="rounded-full bg-gray-200 px-2 text-xs">
          {column.cards.length}
        </span>
      </h2>
      <div className="flex flex-col gap-2">
        {column.cards.map((card) => (
          <Card
            key={card.id}
            card={card}
            onOpen={onOpenCard}
            onOpenStories={onOpenStories}
          />
        ))}
      </div>
    </div>
  );
}
