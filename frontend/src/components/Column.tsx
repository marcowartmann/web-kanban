import { useDroppable } from "@dnd-kit/core";
import type { BoardColumn } from "../types";
import Card from "./Card";

export default function Column({
  column,
  onOpenCard,
}: {
  column: BoardColumn;
  onOpenCard: (id: number) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: column.status });
  return (
    <div
      ref={setNodeRef}
      className={`flex w-72 shrink-0 flex-col rounded-xl p-3 ${
        isOver ? "bg-blue-50 ring-2 ring-blue-300" : "bg-gray-100"
      }`}
    >
      <h2 className="mb-3 flex items-center justify-between text-sm font-semibold text-gray-700">
        <span>{column.status}</span>
        <span className="rounded-full bg-gray-200 px-2 text-xs">
          {column.cards.length}
        </span>
      </h2>
      <div className="flex flex-col gap-2">
        {column.cards.map((card) => (
          <Card key={card.id} card={card} onOpen={onOpenCard} />
        ))}
      </div>
    </div>
  );
}
