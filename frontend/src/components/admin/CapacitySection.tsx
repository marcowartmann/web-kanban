import { useEffect, useState } from "react";
import { getCapacities, getTeamMembers, upsertCapacity } from "../../api/client";
import { ITERATION_SLOTS, iterationLabel } from "../../lib/iterations";
import type { Capacity, TeamMember } from "../../types";
import { adminCardClass } from "./AdminCard";

export default function CapacitySection({
  planningIntervals,
}: {
  planningIntervals: string[];
}) {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [capacities, setCapacities] = useState<Capacity[]>([]);
  const [pi, setPi] = useState<string | null>(planningIntervals[0] ?? null);
  const [values, setValues] = useState<Record<string, string>>({});

  useEffect(() => {
    void getTeamMembers().then(setMembers);
    void getCapacities().then(setCapacities);
  }, []);

  useEffect(() => {
    if ((pi == null || !planningIntervals.includes(pi)) && planningIntervals.length) {
      setPi(planningIntervals[0]);
    }
  }, [planningIntervals, pi]);

  // Rebuild the editable cells whenever the selected PI or saved data changes.
  useEffect(() => {
    if (!pi) return;
    const next: Record<string, string> = {};
    for (const c of capacities) {
      if (c.planning_interval === pi) next[`${c.user_id}:${c.iteration}`] = String(c.points);
    }
    setValues(next);
  }, [pi, capacities]);

  const commit = async (memberId: number, slot: number, raw: string) => {
    if (!pi) return;
    const points = raw === "" ? 0 : Number(raw);
    if (Number.isNaN(points) || points < 0) return;
    const saved = await upsertCapacity({
      user_id: memberId,
      planning_interval: pi,
      iteration: slot,
      points,
    });
    setCapacities((cs) => [...cs.filter((c) => c.id !== saved.id), saved]);
  };

  const iconChip = (
    <span
      className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-50 text-base text-amber-600"
      aria-hidden
    >
      📊
    </span>
  );

  if (!planningIntervals.length) {
    return (
      <section className={adminCardClass}>
        <header className="mb-2 flex items-center gap-2.5">
          {iconChip}
          <h2 className="text-sm font-semibold text-gray-900">Capacity</h2>
        </header>
        <p className="text-sm text-gray-500">
          No planning intervals yet. Set a Planning Interval on stories first.
        </p>
      </section>
    );
  }

  return (
    <section className={adminCardClass}>
      <div className="mb-4 flex flex-wrap items-center gap-2.5">
        {iconChip}
        <h2 className="text-sm font-semibold text-gray-900">Capacity</h2>
        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">
          SP
        </span>
        <span className="ml-auto text-[11px] font-semibold uppercase tracking-wide text-gray-400">
          Planning Interval
        </span>
        <div className="flex flex-wrap gap-1.5">
          {planningIntervals.map((p) => (
            <button
              key={p}
              onClick={() => setPi(p)}
              className={`rounded-full border px-3 py-1 text-sm font-medium transition ${
                p === pi
                  ? "border-blue-600 bg-blue-600 text-white shadow-sm"
                  : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-[11px] uppercase tracking-wide text-gray-400">
              <th className="py-2 pr-3 font-semibold">Member</th>
              {ITERATION_SLOTS.map((slot) => (
                <th key={slot} className="px-2 py-2 text-center font-semibold">
                  {iterationLabel(slot)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.id} className="border-b border-gray-100 last:border-0">
                <td className="whitespace-nowrap py-1.5 pr-3 font-medium text-gray-800">
                  {m.name}
                </td>
                {ITERATION_SLOTS.map((slot) => {
                  const key = `${m.id}:${slot}`;
                  return (
                    <td key={slot} className="px-1 py-1.5 text-center">
                      <input
                        type="number"
                        min="0"
                        aria-label={`${m.name} ${iterationLabel(slot)}`}
                        value={values[key] ?? ""}
                        onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value }))}
                        onBlur={(e) => void commit(m.id, slot, e.target.value)}
                        className="w-16 rounded-lg border border-gray-200 px-2 py-1.5 text-center text-sm transition focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
            {members.length === 0 && (
              <tr>
                <td colSpan={ITERATION_SLOTS.length + 1} className="py-4 text-center text-gray-400">
                  No team members yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
