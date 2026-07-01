import { useEffect, useState } from "react";
import { createPlanningInterval, deletePlanningInterval, getPlanningIntervals } from "../../api/client";
import type { PlanningInterval } from "../../types";

export default function PlanningIntervalsSection({ onChanged }: { onChanged: () => void }) {
  const [intervals, setIntervals] = useState<PlanningInterval[]>([]);
  const [name, setName] = useState("");

  const reload = () => void getPlanningIntervals().then(setIntervals);
  useEffect(reload, []);

  const add = async () => {
    if (!name.trim()) return;
    await createPlanningInterval(name.trim());
    setName("");
    reload();
    onChanged();
  };

  const remove = async (id: number) => {
    await deletePlanningInterval(id);
    reload();
    onChanged();
  };

  return (
    <section className="rounded-lg border bg-white p-4">
      <h2 className="mb-3 text-sm font-semibold text-gray-700">Planning Intervals</h2>
      <div className="mb-3 flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="New planning interval"
          className="rounded border border-gray-300 px-2 py-1 text-sm"
        />
        <button onClick={add} className="rounded bg-blue-600 px-3 py-1 text-sm text-white">
          Add
        </button>
      </div>
      <ul className="flex flex-col gap-1">
        {intervals.map((p) => (
          <li key={p.id} className="flex items-center justify-between rounded bg-gray-50 px-2 py-1 text-sm">
            <span>{p.name}</span>
            <button
              aria-label={`remove planning interval ${p.id}`}
              onClick={() => remove(p.id)}
              className="text-gray-400 hover:text-red-600"
            >
              ×
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
