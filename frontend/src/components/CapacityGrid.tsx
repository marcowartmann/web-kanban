import { loadCapacityTotals, type MemberLoadRow } from "../lib/capacity";
import { ITERATION_SLOTS } from "../lib/iterations";
import UtilizationMeter from "./UtilizationMeter";

const AVATAR_COLORS = [
  "bg-blue-500",
  "bg-emerald-500",
  "bg-violet-500",
  "bg-amber-500",
  "bg-rose-500",
  "bg-cyan-500",
  "bg-indigo-500",
];

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? "") : "";
  return (first + last).toUpperCase() || "?";
}

function avatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

function NameCell({ label, avatar, avatarClass }: { label: string; avatar: string; avatarClass: string }) {
  return (
    <div className="sticky left-0 z-10 flex w-72 shrink-0 items-center gap-2 bg-white px-3 py-2">
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
    <div className="mb-4 w-max rounded-xl border border-gray-200 bg-white text-gray-600">
      {rows.map((r) => {
        const name = r.person?.display_name ?? "Unassigned";
        const unassigned = r.person === null;
        return (
          <div key={r.person?.id ?? "unassigned"} data-testid="capacity-row" className="flex gap-4 hover:bg-gray-50/60">
            <NameCell
              label={name}
              avatar={unassigned ? "?" : initials(name)}
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
