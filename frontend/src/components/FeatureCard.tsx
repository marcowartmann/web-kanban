import type { CardLinkInfo } from "../lib/planningLinks";
import type { Item } from "../types";
import CardLinkBadges from "./CardLinkBadges";

export default function FeatureCard({
  feature,
  info,
  dimmed = false,
  selected = false,
  onHighlight,
  onOpen,
}: {
  feature: Item;
  info?: CardLinkInfo;
  dimmed?: boolean;
  selected?: boolean;
  onHighlight?: (ids: number[] | null) => void;
  onOpen: (id: number) => void;
}) {
  const hasLinks =
    (info?.blocks_count ?? 0) + (info?.blocked_by_count ?? 0) + (info?.related_count ?? 0) > 0;
  const ring = selected ? "border-blue-400 ring-2 ring-blue-400" : "border-gray-300";

  return (
    <button
      onClick={() => onOpen(feature.id)}
      className={`w-full rounded-lg border bg-surface p-3 text-left shadow-xs transition-opacity hover:shadow-sm ${ring} ${dimmed ? "opacity-30" : ""}`}
    >
      <div className="mb-1 flex items-center gap-1.5">
        <span className="rounded-sm bg-blue-100 px-1.5 py-0.5 text-xs text-blue-800">
          {feature.type ?? feature.kind}
        </span>
        <span className="text-xs text-gray-400">#{feature.id}</span>
      </div>
      <div className="flex items-start justify-between gap-2">
        <div className="font-semibold text-gray-900">{feature.title}</div>
        {hasLinks && (
          <span
            role="img"
            aria-label="dependencies"
            title="Highlight all dependencies"
            onMouseEnter={() => onHighlight?.([feature.id, ...(info?.linkPartners ?? [])])}
            onMouseLeave={() => onHighlight?.(null)}
            className="shrink-0 cursor-help text-gray-400"
          >
            🔗
          </span>
        )}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-500">
        <CardLinkBadges info={info} />
      </div>
    </button>
  );
}
