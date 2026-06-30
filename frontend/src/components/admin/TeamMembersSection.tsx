import { useEffect, useState } from "react";
import {
  createTeamMember,
  deleteTeamMember,
  getTeamMembers,
  getTeams,
} from "../../api/client";
import type { Team, TeamMember } from "../../types";

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
    <section className="rounded-lg border bg-white p-4">
      <h2 className="mb-3 text-sm font-semibold text-gray-700">Team Members</h2>
      <div className="mb-3 flex flex-wrap gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="New member name"
          className="rounded border border-gray-300 px-2 py-1 text-sm"
        />
        <select
          aria-label="Team"
          value={teamId}
          onChange={(e) => setTeamId(e.target.value)}
          className="rounded border border-gray-300 px-2 py-1 text-sm"
        >
          <option value="">No team</option>
          {teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <button onClick={add} className="rounded bg-blue-600 px-3 py-1 text-sm text-white">
          Add
        </button>
      </div>
      <ul className="flex flex-col gap-1">
        {members.map((m) => (
          <li
            key={m.id}
            className="flex items-center justify-between rounded bg-gray-50 px-2 py-1 text-sm"
          >
            <span>
              {m.name}
              {m.team_name && <span className="text-gray-400"> — {m.team_name}</span>}
            </span>
            <button
              aria-label={`remove member ${m.id}`}
              onClick={() => remove(m.id)}
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
