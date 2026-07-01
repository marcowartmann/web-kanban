import type { CardLinkInfo } from "../lib/planningLinks";
import type { FeatureLane } from "../lib/timeline";
import FeatureCard from "./FeatureCard";
import TimelineCell, { type SlotKey } from "./TimelineCell";

export interface TimelineColumn {
  slot: SlotKey;
  label: string;
}

export default function TimelineLane({
  lane,
  columns,
  cardInfo,
  highlight,
  selectedIds,
  onHighlight,
  onOpenCard,
  onOpenFeature,
}: {
  lane: FeatureLane;
  columns: TimelineColumn[];
  cardInfo: Map<number, CardLinkInfo>;
  highlight?: Set<number> | null;
  selectedIds?: Set<number>;
  onHighlight?: (ids: number[] | null) => void;
  onOpenCard: (id: number) => void;
  onOpenFeature: (id: number) => void;
}) {
  const laneKey = lane.feature ? String(lane.feature.id) : "orphan";
  const storiesFor = (slot: SlotKey) => (slot === "backlog" ? lane.backlog : lane.slots[slot]);

  return (
    <div className="flex items-start gap-2 border-b py-2">
      <div className="sticky left-0 z-10 w-64 shrink-0 bg-gray-50 p-2">
        {lane.feature ? (
          <FeatureCard
            feature={lane.feature}
            info={cardInfo.get(lane.feature.id)}
            dimmed={highlight != null && !highlight.has(lane.feature.id)}
            selected={selectedIds?.has(lane.feature.id) ?? false}
            onHighlight={onHighlight}
            onOpen={onOpenFeature}
          />
        ) : (
          <div className="rounded-lg border border-dashed border-gray-300 p-3 text-sm font-medium text-gray-400">
            No feature
          </div>
        )}
      </div>
      {columns.map((col) => (
        <TimelineCell
          key={String(col.slot)}
          laneKey={laneKey}
          slot={col.slot}
          stories={storiesFor(col.slot)}
          cardInfo={cardInfo}
          highlight={highlight}
          selectedIds={selectedIds}
          onHighlight={onHighlight}
          onOpen={onOpenCard}
        />
      ))}
    </div>
  );
}
