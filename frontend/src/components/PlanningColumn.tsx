import { useDroppable } from "@dnd-kit/core";
import type { Item } from "../types";
import StoryPlanCard from "./StoryPlanCard";

export default function PlanningColumn({
  id,
  title,
  points,
  stories,
  parentTitles,
  onOpen,
}: {
  id: string;
  title: string;
  points?: number;
  stories: Item[];
  parentTitles: Map<number, string>;
  onOpen: (id: number) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      className={`flex w-72 shrink-0 flex-col rounded-xl p-3 ${
        isOver ? "bg-blue-50 ring-2 ring-blue-300" : "bg-gray-100"
      }`}
    >
      <h2 className="mb-3 flex items-center justify-between gap-2 text-sm font-semibold text-gray-700">
        <span>{title}</span>
        <span className="flex items-center gap-2 text-xs font-normal text-gray-500">
          {points != null && (
            <span className="rounded-full bg-white px-2 py-0.5 font-medium text-gray-600">
              {points} SP
            </span>
          )}
          <span className="rounded-full bg-gray-200 px-2 py-0.5">{stories.length}</span>
        </span>
      </h2>
      <div className="flex flex-col gap-2">
        {stories.map((s) => (
          <StoryPlanCard
            key={s.id}
            story={s}
            parentTitle={s.parent_id != null ? parentTitles.get(s.parent_id) : undefined}
            onOpen={onOpen}
          />
        ))}
      </div>
    </div>
  );
}
