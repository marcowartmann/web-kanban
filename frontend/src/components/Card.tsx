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
  onOpenStories,
}: {
  card: BoardCard;
  onOpen: (id: number) => void;
  onOpenStories?: (featureId: number) => void;
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
          <span className="flex items-center gap-1.5">
            <span className={`rounded px-1.5 py-0.5 text-xs ${kindStyles[card.kind] ?? "bg-gray-100 text-gray-800"}`}>
              {card.type ?? card.kind}
            </span>
            <span className="text-xs text-gray-400">#{card.id}</span>
          </span>
          {card.wsjf_score != null && (
            <span className="text-xs font-semibold text-gray-600">
              WSJF {card.wsjf_score}
            </span>
          )}
        </div>
        <div className="font-medium text-gray-900">{card.title}</div>
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-500">
          {card.assignee && (
            <span className="font-medium text-gray-700">{card.assignee}</span>
          )}
          {card.leading_team && <span>{card.leading_team}</span>}
          {card.planning_interval && <span>{card.planning_interval}</span>}
          {card.kind === "feature" && <span>{card.children_count} stories</span>}
          {card.kind === "feature" && card.children_points > 0 && (
            <span>{card.children_points} SP</span>
          )}
        </div>
      </button>

      {/* Sibling of the draggable button (nested <button> would be invalid DOM). */}
      {card.kind === "feature" && onOpenStories && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onOpenStories(card.id);
          }}
          className="mt-1 w-full rounded bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100"
        >
          Stories ({card.children_count})
        </button>
      )}
    </div>
  );
}
