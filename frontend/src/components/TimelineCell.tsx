import { useDroppable } from "@dnd-kit/core";
import type { CardLinkInfo } from "../lib/planningLinks";
import type { Item } from "../types";
import StoryPlanCard from "./StoryPlanCard";

export type SlotKey = "backlog" | 1 | 2 | 3 | 4 | 5 | 6;

export default function TimelineCell({
  laneKey,
  slot,
  stories,
  cardInfo,
  highlight,
  selectedIds,
  onHighlight,
  onOpen,
}: {
  laneKey: string;
  slot: SlotKey;
  stories: Item[];
  cardInfo: Map<number, CardLinkInfo>;
  highlight?: Set<number> | null;
  selectedIds?: Set<number>;
  onHighlight?: (ids: number[] | null) => void;
  onOpen: (id: number) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `${laneKey}::${slot}` });
  return (
    <div
      ref={setNodeRef}
      className={`flex w-64 shrink-0 flex-col gap-2 rounded-lg p-2 ${isOver ? "bg-blue-50 ring-2 ring-blue-300" : ""}`}
    >
      {stories.map((s) => (
        <StoryPlanCard
          key={s.id}
          story={s}
          info={cardInfo.get(s.id)}
          dimmed={highlight != null && !highlight.has(s.id)}
          selected={selectedIds?.has(s.id) ?? false}
          onHighlight={onHighlight}
          onOpen={onOpen}
        />
      ))}
    </div>
  );
}
