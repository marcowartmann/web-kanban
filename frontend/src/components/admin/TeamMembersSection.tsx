import { useEffect, useState } from "react";
import {
  createTeamMember,
  deleteTeamMember,
  getTeamMembers,
  getTeams,
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

  const reload = () => {
    void getTeamMembers().then(setMembers);
    void getTeams().then(setTeams);
  };
  useEffect(reload, []);

  const add = async () => {
    if (!name.trim()) return;
    await createTeamMember({
      name: name.trim(),
      team_id: teamId ? Number(teamId) : null,
    });
    setName("");
    setTeamId("");
    reload();
    onChanged();
  };

  const remove = async (id: number) => {
    await deleteTeamMember(id);
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
      <ul className="flex flex-col gap-0.5">
        {members.map((m) => (
          <li key={m.id} className={adminRowClass}>
            <span className="flex min-w-0 items-center gap-2 truncate">
              <span className="truncate font-medium text-gray-800">{m.name}</span>
              {m.team_name && (
                <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                  {m.team_name}
                </span>
              )}
            </span>
            <button
              aria-label={`remove member ${m.id}`}
              onClick={() => remove(m.id)}
              className={adminRemoveButtonClass}
            >
              ×
            </button>
          </li>
        ))}
        {members.length === 0 && <li className={adminEmptyClass}>No team members yet.</li>}
      </ul>
    </AdminCard>
  );
}
