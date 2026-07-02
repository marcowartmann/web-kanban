import { useEffect, useState } from "react";
import {
  ConflictError,
  createPlanningInterval,
  deletePlanningInterval,
  getPlanningIntervals,
  renamePlanningInterval,
} from "../../api/client";
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
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  const reload = () => void getPlanningIntervals().then(setIntervals);
  useEffect(reload, []);

  const add = async () => {
    if (!name.trim()) return;
    setError(null);
    try {
      await createPlanningInterval(name.trim());
      setName("");
      reload();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add the planning interval.");
    }
  };

  const startRename = (p: PlanningInterval) => {
    setRenamingId(p.id);
    setRenameValue(p.name);
    setError(null);
  };

  const saveRename = async () => {
    if (renamingId == null || !renameValue.trim()) return;
    setError(null);
    try {
      await renamePlanningInterval(renamingId, renameValue.trim());
      setRenamingId(null);
      reload();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not rename the planning interval.");
    }
  };

  const remove = async (id: number) => {
    setError(null);
    try {
      await deletePlanningInterval(id);
    } catch (e) {
      if (e instanceof ConflictError) {
        if (!window.confirm(`${e.detail} Delete anyway?`)) return;
        try {
          await deletePlanningInterval(id, true);
        } catch (forced) {
          setError(forced instanceof Error ? forced.message : "Could not delete the planning interval.");
          return;
        }
      } else {
        setError(e instanceof Error ? e.message : "Could not delete the planning interval.");
        return;
      }
    }
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
      {error && <p className="mb-2 text-xs text-red-600">{error}</p>}
      <ul className="flex flex-col gap-0.5">
        {intervals.map((p) => (
          <li key={p.id} className={adminRowClass}>
            {renamingId === p.id ? (
              <span className="flex flex-1 items-center gap-2">
                <input
                  aria-label={`new name for planning interval ${p.id}`}
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && void saveRename()}
                  className={`${adminInputClass} flex-1 py-1`}
                />
                <button onClick={saveRename} className="text-xs font-semibold text-blue-600 hover:underline">
                  Save
                </button>
                <button
                  onClick={() => {
                    setRenamingId(null);
                    setError(null);
                  }}
                  className="text-xs text-gray-400 hover:underline"
                >
                  Cancel
                </button>
              </span>
            ) : (
              <>
                <span className="truncate font-medium text-gray-800">{p.name}</span>
                <span className="flex shrink-0 items-center gap-1">
                  <button
                    aria-label={`rename planning interval ${p.id}`}
                    onClick={() => startRename(p)}
                    className="rounded-md px-1.5 py-1 text-xs text-gray-300 transition hover:bg-blue-50 hover:text-blue-600 group-hover:text-gray-400"
                  >
                    ✎
                  </button>
                  <button
                    aria-label={`remove planning interval ${p.id}`}
                    onClick={() => remove(p.id)}
                    className={adminRemoveButtonClass}
                  >
                    ×
                  </button>
                </span>
              </>
            )}
          </li>
        ))}
        {intervals.length === 0 && <li className={adminEmptyClass}>No planning intervals yet.</li>}
      </ul>
    </AdminCard>
  );
}
