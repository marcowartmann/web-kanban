import { loadCapacityTotals, type MemberLoadRow } from "../lib/capacity";
import { ITERATION_SLOTS } from "../lib/iterations";
import { avatarColor, initialsOf } from "./Avatar";
import UtilizationMeter from "./UtilizationMeter";

function NameCell({ label, avatar, avatarClass }: { label: string; avatar: string; avatarClass: string }) {
  return (
    <div className="sticky left-0 z-10 flex w-72 shrink-0 items-center gap-2 bg-surface px-3 py-2">
      <span
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white ${avatarClass}`}
      >
        {avatar}
      </span>
      <span className="truncate text-sm font-medium text-gray-700">{label}</span>
    </div>
  );
}

export default function CapacityGrid({ rows }: { rows: MemberLoadRow[] }) {
  const totals = loadCapacityTotals(rows);
  return (
    <div className="mb-4 w-max rounded-xl border border-gray-200 bg-surface text-gray-600">
      {rows.map((r) => {
        const name = r.person?.display_name ?? "Unassigned";
        const unassigned = r.person === null;
        return (
          <div key={r.person?.id ?? "unassigned"} data-testid="capacity-row" className="flex gap-4 hover:bg-gray-50/60">
            <NameCell
              label={name}
              avatar={unassigned ? "?" : initialsOf(name)}
              avatarClass={unassigned ? "bg-gray-400" : avatarColor(name)}
            />
            {ITERATION_SLOTS.map((s) => (
              <div key={s} className="w-72 shrink-0 px-3 py-2">
                <UtilizationMeter {...r.slots[s]} />
              </div>
            ))}
          </div>
        );
      })}
      <div data-testid="capacity-total" className="flex gap-4 border-t border-gray-200">
        <NameCell label="Total" avatar="Σ" avatarClass="bg-gray-700" />
        {ITERATION_SLOTS.map((s) => (
          <div key={s} className="w-72 shrink-0 px-3 py-2">
            <UtilizationMeter {...totals.slots[s]} />
          </div>
        ))}
      </div>
    </div>
  );
}
