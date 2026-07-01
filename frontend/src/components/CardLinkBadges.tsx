import type { CardLinkInfo } from "../lib/planningLinks";

/** The blocked-by / blocks / related count badges, shared by story and feature cards. */
export default function CardLinkBadges({ info }: { info?: CardLinkInfo }) {
  return (
    <>
      {(info?.blocked_by_count ?? 0) > 0 && (
        <span className="font-medium text-red-600">⛔ blocked by {info!.blocked_by_count}</span>
      )}
      {(info?.blocks_count ?? 0) > 0 && <span>blocks {info!.blocks_count}</span>}
      {(info?.related_count ?? 0) > 0 && <span className="text-gray-500">related {info!.related_count}</span>}
    </>
  );
}
