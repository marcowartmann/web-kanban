import type { SlotLoadCap } from "../lib/capacity";

// A compact load-vs-capacity meter: a fill bar (load / capacity) plus the
// numbers, colored by utilization — emerald under, amber at, red over/no-cap.
export default function UtilizationMeter({ load, capacity }: SlotLoadCap) {
  if (capacity === 0 && load === 0) {
    return <div className="py-1 text-center text-sm text-gray-300">—</div>;
  }

  const over = load > capacity; // includes capacity === 0 && load > 0
  const full = capacity > 0 && load === capacity;
  const fill = over ? "bg-red-500" : full ? "bg-amber-500" : "bg-emerald-500";
  const text = over ? "text-red-600" : full ? "text-amber-600" : "text-emerald-600";
  const width = capacity > 0 ? Math.min(load / capacity, 1) * 100 : 100;

  return (
    <div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-200">
        <div className={`h-full rounded-full ${fill}`} style={{ width: `${width}%` }} />
      </div>
      <div className={`mt-1 text-center text-[11px] font-medium tabular-nums ${text}`}>
        {load} / {capacity}
      </div>
    </div>
  );
}
