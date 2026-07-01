import { useEffect, useState } from "react";
import { createTeam, deleteTeam, getTeams } from "../../api/client";
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
      <ul className="flex flex-col gap-0.5">
        {teams.map((t) => (
          <li key={t.id} className={adminRowClass}>
            <span className="truncate font-medium text-gray-800">{t.name}</span>
            <button
              aria-label={`remove team ${t.id}`}
              onClick={() => remove(t.id)}
              className={adminRemoveButtonClass}
            >
              ×
            </button>
          </li>
        ))}
        {teams.length === 0 && <li className={adminEmptyClass}>No teams yet.</li>}
      </ul>
    </AdminCard>
  );
}
