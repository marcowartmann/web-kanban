import { useEffect, useState } from "react";
import { createTeam, deleteTeam, getTeams } from "../../api/client";
import type { Team } from "../../types";

export default function TeamsSection({ onChanged }: { onChanged: () => void }) {
  const [teams, setTeams] = useState<Team[]>([]);
  const [name, setName] = useState("");

  const reload = () => void getTeams().then(setTeams);
  useEffect(reload, []);

  const add = async () => {
    if (!name.trim()) return;
    await createTeam(name.trim());
    setName("");
    reload();
    onChanged();
  };

  const remove = async (id: number) => {
    await deleteTeam(id);
    reload();
    onChanged();
  };

  return (
    <section className="rounded-lg border bg-white p-4">
      <h2 className="mb-3 text-sm font-semibold text-gray-700">Teams</h2>
      <div className="mb-3 flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="New team name"
          className="rounded border border-gray-300 px-2 py-1 text-sm"
        />
        <button onClick={add} className="rounded bg-blue-600 px-3 py-1 text-sm text-white">
          Add
        </button>
      </div>
      <ul className="flex flex-col gap-1">
        {teams.map((t) => (
          <li
            key={t.id}
            className="flex items-center justify-between rounded bg-gray-50 px-2 py-1 text-sm"
          >
            <span>{t.name}</span>
            <button
              aria-label={`remove team ${t.id}`}
              onClick={() => remove(t.id)}
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
