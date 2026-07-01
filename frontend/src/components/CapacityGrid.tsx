import { capacityColumnTotals, type MemberCapacityRow } from "../lib/capacity";
import { ITERATION_SLOTS } from "../lib/iterations";

const cell = (v: number) => (v > 0 ? String(v) : "·");

// A per-member capacity table whose columns line up with the iteration lanes:
// the name cell sits over the Backlog column, the six value cells over Iter 1–IP.
export default function CapacityGrid({ rows }: { rows: MemberCapacityRow[] }) {
  const totals = capacityColumnTotals(rows);
  return (
    <div className="mb-4 text-xs text-gray-600">
      {rows.map((r) => (
        <div key={r.member.id} data-testid="capacity-row" className="flex gap-4">
          <div className="w-72 shrink-0 truncate px-3 py-1 font-medium text-gray-700">
            {r.member.name}
          </div>
          {ITERATION_SLOTS.map((s) => (
            <div key={s} className="w-72 shrink-0 px-3 py-1 text-center">
              {cell(r.slots[s])}
            </div>
          ))}
        </div>
      ))}
      <div data-testid="capacity-total" className="flex gap-4 border-t border-gray-200">
        <div className="w-72 shrink-0 px-3 py-1 font-semibold text-gray-700">Total</div>
        {ITERATION_SLOTS.map((s) => (
          <div key={s} className="w-72 shrink-0 px-3 py-1 text-center font-semibold text-gray-700">
            {cell(totals.slots[s])}
          </div>
        ))}
      </div>
    </div>
  );
}
