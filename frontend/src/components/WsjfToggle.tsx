/** The only permitted WSJF estimation values (a modified Fibonacci scale). */
export const WSJF_VALUES = [1, 2, 3, 5, 8, 13, 20] as const;

// Selected-state colors, one per value position: low (green) → high (red).
const ACTIVE_CLASS = [
  "border-emerald-500 bg-emerald-500 text-white", // 1
  "border-green-500 bg-green-500 text-white", // 2
  "border-lime-500 bg-lime-500 text-gray-900", // 3
  "border-yellow-400 bg-yellow-400 text-gray-900", // 5
  "border-amber-500 bg-amber-500 text-white", // 8
  "border-orange-500 bg-orange-500 text-white", // 13
  "border-red-500 bg-red-500 text-white", // 20
];

/** A horizontal segmented control for a WSJF estimation field. Renders one
 *  button per allowed value, color-coded green→red; clicking selects a value
 *  (or clears it when the active value is clicked again). */
export default function WsjfToggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string | number | null;
  onChange: (value: number | null) => void;
}) {
  const current = value == null || value === "" ? null : Number(value);
  return (
    <div>
      <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-gray-400">
        {label}
      </span>
      <div role="group" aria-label={label} className="flex gap-1">
        {WSJF_VALUES.map((v, i) => {
          const active = current === v;
          return (
            <button
              key={v}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(active ? null : v)}
              className={`flex-1 rounded-md border py-1.5 text-xs font-semibold transition ${
                active
                  ? `${ACTIVE_CLASS[i]} shadow-xs`
                  : "border-gray-200 bg-surface text-gray-500 hover:bg-gray-50 hover:text-gray-700"
              }`}
            >
              {v}
            </button>
          );
        })}
      </div>
    </div>
  );
}
