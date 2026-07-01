import { useDraggable } from "@dnd-kit/core";
import type { Item } from "../types";

export default function StoryPlanCard({
  story,
  parentTitle,
  onOpen,
}: {
  story: Item;
  parentTitle?: string;
  onOpen: (id: number) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id: story.id });
  const style = transform
    ? { transform: `translate(${transform.x}px, ${transform.y}px)` }
    : undefined;

  return (
    <div ref={setNodeRef} style={style} className={isDragging ? "opacity-50" : undefined}>
      <button
        {...listeners}
        {...attributes}
        onClick={() => onOpen(story.id)}
        className="w-full rounded-lg border border-gray-200 bg-white p-3 text-left shadow-sm hover:shadow"
      >
        {parentTitle && (
          <div className="mb-1 truncate text-xs text-gray-400">{parentTitle}</div>
        )}
        <div className="font-medium text-gray-900">{story.title}</div>
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-500">
          {story.assignee && (
            <span className="font-medium text-gray-700">{story.assignee}</span>
          )}
          {story.story_points != null && <span>{story.story_points} SP</span>}
        </div>
      </button>
    </div>
  );
}
