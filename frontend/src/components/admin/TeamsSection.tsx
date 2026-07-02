import { useEffect, useState } from "react";
import { ConflictError, createTeam, deleteTeam, getTeams, renameTeam } from "../../api/client";
import type { Team } from "../../types";
import AdminCard, {
  adminAddButtonClass,
  adminEmptyClass,
  adminInputClass,
  adminRemoveButtonClass,
  adminRowClass,
} from "./AdminCard";

export default function TeamsSection({ onChanged }: { onChanged: () => void }) {
  const [teams, setTeams] = useState<Team[]>([]);
  const [name, setName] = useState("");
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  const reload = () => void getTeams().then(setTeams);
  useEffect(reload, []);

  const add = async () => {
    if (!name.trim()) return;
    setError(null);
    try {
      await createTeam(name.trim());
      setName("");
      reload();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add the team.");
    }
  };

  const startRename = (t: Team) => {
    setRenamingId(t.id);
    setRenameValue(t.name);
    setError(null);
  };

  const saveRename = async () => {
    if (renamingId == null || !renameValue.trim()) return;
    setError(null);
    try {
      await renameTeam(renamingId, renameValue.trim());
      setRenamingId(null);
      reload();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not rename the team.");
    }
  };

  const remove = async (id: number) => {
    setError(null);
    try {
      await deleteTeam(id);
    } catch (e) {
      if (e instanceof ConflictError) {
        if (!window.confirm(`${e.detail} Delete anyway?`)) return;
        try {
          await deleteTeam(id, true);
        } catch (forced) {
          setError(forced instanceof Error ? forced.message : "Could not delete the team.");
          return;
        }
      } else {
        setError(e instanceof Error ? e.message : "Could not delete the team.");
        return;
      }
    }
    reload();
    onChanged();
  };

  return (
    <AdminCard title="Teams" icon="👥" accent="bg-blue-50 text-blue-600" count={teams.length}>
      <div className="mb-4 flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void add()}
          placeholder="New team name"
          className={`${adminInputClass} flex-1`}
        />
        <button onClick={add} className={adminAddButtonClass}>
          Add
        </button>
      </div>
      {error && <p className="mb-2 text-xs text-red-600">{error}</p>}
      <ul className="flex flex-col gap-0.5">
        {teams.map((t) => (
          <li key={t.id} className={adminRowClass}>
            {renamingId === t.id ? (
              <span className="flex flex-1 items-center gap-2">
                <input
                  aria-label={`new name for team ${t.id}`}
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
                <span className="truncate font-medium text-gray-800">{t.name}</span>
                <span className="flex shrink-0 items-center gap-1">
                  <button
                    aria-label={`rename team ${t.id}`}
                    onClick={() => startRename(t)}
                    className="rounded-md px-1.5 py-1 text-xs text-gray-300 transition hover:bg-blue-50 hover:text-blue-600 group-hover:text-gray-400"
                  >
                    ✎
                  </button>
                  <button
                    aria-label={`remove team ${t.id}`}
                    onClick={() => remove(t.id)}
                    className={adminRemoveButtonClass}
                  >
                    ×
                  </button>
                </span>
              </>
            )}
          </li>
        ))}
        {teams.length === 0 && <li className={adminEmptyClass}>No teams yet.</li>}
      </ul>
    </AdminCard>
  );
}
