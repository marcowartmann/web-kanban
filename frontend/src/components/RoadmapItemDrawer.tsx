import type { RoadmapItem, Stream } from "../types";

/** Placeholder for the roadmap item create/edit drawer — Task 8 replaces
 *  this entirely (title/description/status/dates/stream fields, feature
 *  links). Kept minimal here so RoadmapView's drawer wiring
 *  (`key={editing?.id ?? "new"}`) has a real component to render against. */
export default function RoadmapItemDrawer({
  item,
  streams,
  defaultStreamId,
  onClose,
  onChanged,
}: {
  item: RoadmapItem | null;
  streams: Stream[];
  defaultStreamId: number | null;
  onClose: () => void;
  onChanged: () => Promise<void> | void;
}) {
  return <aside aria-label="Roadmap item drawer" />;
}
