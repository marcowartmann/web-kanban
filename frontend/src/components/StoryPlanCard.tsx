import { useDraggable } from "@dnd-kit/core";
import type { CardLinkInfo } from "../lib/planningLinks";
import type { Item } from "../types";

export default function StoryPlanCard({
  story,
  parentTitle,
  info,
  dimmed = false,
  onHighlight,
  onOpen,
}: {
  story: Item;
  parentTitle?: string;
  info?: CardLinkInfo;
  dimmed?: boolean;
  onHighlight?: (ids: number[] | null) => void;
  onOpen: (id: number) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id: story.id });
  const style = transform
    ? { transform: `translate(${transform.x}px, ${transform.y}px)` }
    : undefined;

  const conflicts = info?.conflicts ?? [];
  const hasError = conflicts.some((c) => c.severity === "error");
  const ring =
    conflicts.length === 0
      ? "border-gray-200"
      : hasError
        ? "border-red-300 ring-2 ring-red-400"
        : "border-amber-300 ring-2 ring-amber-400";

  const opacity = isDragging ? "opacity-50" : dimmed ? "opacity-30" : "";

  return (
    <div ref={setNodeRef} style={style} className={`transition-opacity ${opacity}`}>
      <button
        {...listeners}
        {...attributes}
        onClick={() => onOpen(story.id)}
        className={`w-full rounded-lg border bg-white p-3 text-left shadow-sm hover:shadow ${ring}`}
      >
        {parentTitle && (
          <div className="mb-1 truncate text-xs text-gray-400">{parentTitle}</div>
        )}
        <div className="flex items-start justify-between gap-2">
          <div className="font-medium text-gray-900">{story.title}</div>
          {conflicts.length > 0 && (
            <span
              role="img"
              aria-label="timeline conflict"
              title={conflicts.map((c) => c.message).join("\n")}
              onMouseEnter={() => onHighlight?.([story.id, ...(info?.conflictPartners ?? [])])}
              onMouseLeave={() => onHighlight?.(null)}
              className={`shrink-0 cursor-help ${hasError ? "text-red-600" : "text-amber-600"}`}
            >
              ⚠
            </span>
          )}
        </div>
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-500">
          {story.assignee && (
            <span className="font-medium text-gray-700">{story.assignee}</span>
          )}
          {story.story_points != null && <span>{story.story_points} SP</span>}
          {(info?.blocked_by_count ?? 0) > 0 && (
            <span className="font-medium text-red-600">⛔ blocked by {info!.blocked_by_count}</span>
          )}
          {(info?.blocks_count ?? 0) > 0 && <span>blocks {info!.blocks_count}</span>}
          {(info?.related_count ?? 0) > 0 && (
            <span className="text-gray-500">related {info!.related_count}</span>
          )}
        </div>
      </button>
    </div>
  );
}
