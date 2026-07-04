import { useDraggable } from "@dnd-kit/core";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faStar } from "../icons";
import type { PIObjective } from "../types";

export default function ObjectiveCard({
  obj,
  showTeam,
  onOpen,
  draggable = false,
  linkedFeatures = [],
}: {
  obj: PIObjective;
  showTeam?: boolean;
  onOpen?: (id: number) => void;
  draggable?: boolean;
  linkedFeatures?: { id: number; title: string }[];
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: obj.id,
    disabled: !draggable,
  });
  const style = transform ? { transform: `translate(${transform.x}px, ${transform.y}px)` } : undefined;
  return (
    <button
      ref={setNodeRef}
      style={style}
      {...(draggable ? { ...listeners, ...attributes } : {})}
      onClick={() => onOpen?.(obj.id)}
      className={`w-full rounded-lg border border-gray-200 bg-surface p-3 text-left shadow-xs transition hover:shadow-sm ${
        isDragging ? "opacity-50" : ""
      }`}
    >
      <div className="mb-1 flex items-center justify-between gap-2">
        {showTeam ? <span className="text-xs text-gray-400">{obj.team_name}</span> : <span />}
        {obj.state === "committed" && obj.is_key_delivery && (
          <span className="rounded-sm bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800">
            <FontAwesomeIcon icon={faStar} aria-hidden /> Key Delivery
          </span>
        )}
      </div>
      <div className="font-medium text-gray-900">{obj.title}</div>
      <div className="mt-2 text-xs text-gray-500">
        {obj.feature_count} {obj.feature_count === 1 ? "feature" : "features"}
      </div>
      {linkedFeatures.length > 0 && (
        <ul className="mt-1 space-y-0.5">
          {linkedFeatures.map((f) => (
            <li key={f.id} className="truncate text-xs text-gray-600">
              <span className="text-gray-400">#{f.id}</span> {f.title}
            </li>
          ))}
        </ul>
      )}
    </button>
  );
}
