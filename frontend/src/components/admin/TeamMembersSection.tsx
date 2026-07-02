import { useEffect, useState } from "react";
import {
  ConflictError,
  createTeamMember,
  deleteTeamMember,
  getTeamMembers,
  getTeams,
  renameTeamMember,
} from "../../api/client";
import type { Team, TeamMember } from "../../types";
import AdminCard, {
  adminAddButtonClass,
  adminEmptyClass,
  adminInputClass,
  adminRemoveButtonClass,
  adminRowClass,
} from "./AdminCard";

export default function TeamMembersSection({ onChanged }: { onChanged: () => void }) {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [name, setName] = useState("");
  const [teamId, setTeamId] = useState("");
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  const reload = () => {
    void getTeamMembers().then(setMembers);
    void getTeams().then(setTeams);
  };
  useEffect(reload, []);

  const add = async () => {
    if (!name.trim()) return;
    setError(null);
    try {
      await createTeamMember({
        name: name.trim(),
        team_id: teamId ? Number(teamId) : null,
      });
      setName("");
      setTeamId("");
      reload();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add the member.");
    }
  };

  const startRename = (m: TeamMember) => {
    setRenamingId(m.id);
    setRenameValue(m.name);
    setError(null);
  };

  const saveRename = async () => {
    if (renamingId == null || !renameValue.trim()) return;
    setError(null);
    try {
      await renameTeamMember(renamingId, renameValue.trim());
      setRenamingId(null);
      reload();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not rename the member.");
    }
  };

  const remove = async (id: number) => {
    setError(null);
    try {
      await deleteTeamMember(id);
    } catch (e) {
      if (e instanceof ConflictError) {
        if (!window.confirm(`${e.detail} Delete anyway?`)) return;
        try {
          await deleteTeamMember(id, true);
        } catch (forced) {
          setError(forced instanceof Error ? forced.message : "Could not delete the member.");
          return;
        }
      } else {
        setError(e instanceof Error ? e.message : "Could not delete the member.");
        return;
      }
    }
    reload();
    onChanged();
  };

  return (
    <AdminCard
      title="Team Members"
      icon="🧑‍💻"
      accent="bg-emerald-50 text-emerald-600"
      count={members.length}
    >
      <div className="mb-4 flex flex-wrap gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void add()}
          placeholder="New member name"
          className={`${adminInputClass} min-w-[7rem] flex-1`}
        />
        <select
          aria-label="Team"
          value={teamId}
          onChange={(e) => setTeamId(e.target.value)}
          className={`${adminInputClass} min-w-[7rem] flex-1`}
        >
          <option value="">No team</option>
          {teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <button onClick={add} className={adminAddButtonClass}>
          Add
        </button>
      </div>
      {error && <p className="mb-2 text-xs text-red-600">{error}</p>}
      <ul className="flex flex-col gap-0.5">
        {members.map((m) => (
          <li key={m.id} className={adminRowClass}>
            {renamingId === m.id ? (
              <span className="flex flex-1 items-center gap-2">
                <input
                  aria-label={`new name for member ${m.id}`}
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
                <span className="flex min-w-0 items-center gap-2 truncate">
                  <span className="truncate font-medium text-gray-800">{m.name}</span>
                  {m.team_name && (
                    <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                      {m.team_name}
                    </span>
                  )}
                </span>
                <span className="flex shrink-0 items-center gap-1">
                  <button
                    aria-label={`rename member ${m.id}`}
                    onClick={() => startRename(m)}
                    className="rounded-md px-1.5 py-1 text-xs text-gray-300 transition hover:bg-blue-50 hover:text-blue-600 group-hover:text-gray-400"
                  >
                    ✎
                  </button>
                  <button
                    aria-label={`remove member ${m.id}`}
                    onClick={() => remove(m.id)}
                    className={adminRemoveButtonClass}
                  >
                    ×
                  </button>
                </span>
              </>
            )}
          </li>
        ))}
        {members.length === 0 && <li className={adminEmptyClass}>No team members yet.</li>}
      </ul>
    </AdminCard>
  );
}
