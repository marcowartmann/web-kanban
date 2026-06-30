import type { BoardColumn } from "../types";
import Card from "./Card";

export default function Column({
  column,
  onOpenCard,
}: {
  column: BoardColumn;
  onOpenCard: (id: number) => void;
}) {
  return (
    <div className="flex w-72 shrink-0 flex-col rounded-xl bg-gray-100 p-3">
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
