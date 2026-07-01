import { useEffect, useState } from "react";
import { getCapacities, getTeamMembers, upsertCapacity } from "../../api/client";
import { ITERATION_SLOTS, iterationLabel } from "../../lib/iterations";
import type { Capacity, TeamMember } from "../../types";

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
      if (c.planning_interval === pi) next[`${c.member_id}:${c.iteration}`] = String(c.points);
    }
    setValues(next);
  }, [pi, capacities]);

  const commit = async (memberId: number, slot: number, raw: string) => {
    if (!pi) return;
    const points = raw === "" ? 0 : Number(raw);
    if (Number.isNaN(points) || points < 0) return;
    const saved = await upsertCapacity({
      member_id: memberId,
      planning_interval: pi,
      iteration: slot,
      points,
    });
    setCapacities((cs) => [...cs.filter((c) => c.id !== saved.id), saved]);
  };

  if (!planningIntervals.length) {
    return (
      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="mb-2 text-sm font-semibold text-gray-700">Capacity</h2>
        <p className="text-sm text-gray-500">
          No planning intervals yet. Set a Planning Interval on stories first.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold text-gray-700">Capacity (SP)</h2>
        <span className="ml-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
          Planning Interval
        </span>
        {planningIntervals.map((p) => (
          <button
            key={p}
            onClick={() => setPi(p)}
            className={`rounded-full border px-3 py-1 text-sm font-medium transition ${
              p === pi
                ? "border-blue-600 bg-blue-600 text-white"
                : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
            }`}
          >
            {p}
          </button>
        ))}
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-gray-500">
              <th className="py-1 pr-3 font-medium">Member</th>
              {ITERATION_SLOTS.map((slot) => (
                <th key={slot} className="px-2 py-1 font-medium">{iterationLabel(slot)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.id} className="border-t">
                <td className="py-1 pr-3 text-gray-800">{m.name}</td>
                {ITERATION_SLOTS.map((slot) => {
                  const key = `${m.id}:${slot}`;
                  return (
                    <td key={slot} className="px-1 py-1">
                      <input
                        type="number"
                        min="0"
                        aria-label={`${m.name} ${iterationLabel(slot)}`}
                        value={values[key] ?? ""}
                        onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value }))}
                        onBlur={(e) => void commit(m.id, slot, e.target.value)}
                        className="w-16 rounded border border-gray-200 px-2 py-1 text-sm"
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
            {members.length === 0 && (
              <tr>
                <td colSpan={7} className="py-2 text-gray-400">No team members yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
