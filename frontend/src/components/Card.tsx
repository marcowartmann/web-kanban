import { useDraggable } from "@dnd-kit/core";
import type { BoardCard } from "../types";

const kindStyles: Record<string, string> = {
  feature: "bg-blue-100 text-blue-800",
  risk: "bg-red-100 text-red-800",
  story: "bg-gray-100 text-gray-800",
};

export default function Card({
  card,
  onOpen,
}: {
  card: BoardCard;
  onOpen: (id: number) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id: card.id });
  const style = transform
    ? { transform: `translate(${transform.x}px, ${transform.y}px)` }
    : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={isDragging ? "opacity-50" : undefined}
    >
      <button
        {...listeners}
        {...attributes}
        onClick={() => onOpen(card.id)}
        className="w-full rounded-lg border border-gray-200 bg-white p-3 text-left shadow-sm hover:shadow"
      >
        <div className="mb-1 flex items-center justify-between gap-2">
          <span className={`rounded px-1.5 py-0.5 text-xs ${kindStyles[card.kind] ?? "bg-gray-100 text-gray-800"}`}>
            {card.type ?? card.kind}
          </span>
          {card.wsjf_score != null && (
            <span className="text-xs font-semibold text-gray-600">
              WSJF {card.wsjf_score}
            </span>
          )}
        </div>
        <div className="font-medium text-gray-900">{card.title}</div>
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-500">
          {card.leading_team && <span>{card.leading_team}</span>}
          {card.iteration && <span>{card.iteration}</span>}
          {card.kind === "feature" && <span>{card.children_count} stories</span>}
          {card.kind === "feature" && card.children_points > 0 && (
            <span>{card.children_points} SP</span>
          )}
        </div>
      </button>
    </div>
  );
}
