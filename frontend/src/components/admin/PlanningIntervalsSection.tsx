import { useEffect, useState } from "react";
import { createPlanningInterval, deletePlanningInterval, getPlanningIntervals } from "../../api/client";
import type { PlanningInterval } from "../../types";
import AdminCard, {
  adminAddButtonClass,
  adminEmptyClass,
  adminInputClass,
  adminRemoveButtonClass,
  adminRowClass,
} from "./AdminCard";

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
    <AdminCard
      title="Planning Intervals"
      icon="🗓️"
      accent="bg-violet-50 text-violet-600"
      count={intervals.length}
    >
      <div className="mb-4 flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void add()}
          placeholder="New planning interval"
          className={`${adminInputClass} flex-1`}
        />
        <button onClick={add} className={adminAddButtonClass}>
          Add
        </button>
      </div>
      <ul className="flex flex-col gap-0.5">
        {intervals.map((p) => (
          <li key={p.id} className={adminRowClass}>
            <span className="truncate font-medium text-gray-800">{p.name}</span>
            <button
              aria-label={`remove planning interval ${p.id}`}
              onClick={() => remove(p.id)}
              className={adminRemoveButtonClass}
            >
              ×
            </button>
          </li>
        ))}
        {intervals.length === 0 && <li className={adminEmptyClass}>No planning intervals yet.</li>}
      </ul>
    </AdminCard>
  );
}
