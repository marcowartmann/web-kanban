import { useEffect, useState } from "react";
import {
  createDepartment,
  deleteDepartment,
  getDepartments,
  getPersonOptions,
  getTeams,
  renameDepartment,
  setDepartmentMembers,
} from "../../api/client";
import type { Department, PersonOption, Team } from "../../types";
import AdminCard, {
  adminAddButtonClass,
  adminEmptyClass,
  adminInputClass,
  adminRemoveButtonClass,
  adminRowClass,
} from "./AdminCard";

export default function DepartmentsSection({ onChanged }: { onChanged: () => void }) {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [people, setPeople] = useState<PersonOption[]>([]);
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [expanded, setExpanded] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = () => void getDepartments().then(setDepartments);
  useEffect(() => {
    reload();
    void getTeams().then(setTeams);
    void getPersonOptions().then(setPeople);
  }, []);

  const add = async (teamId: number) => {
    const name = (drafts[teamId] ?? "").trim();
    if (!name) return;
    setError(null);
    try {
      await createDepartment(name, teamId);
      setDrafts((d) => ({ ...d, [teamId]: "" }));
      reload();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add the department.");
    }
  };

  const rename = async (dep: Department) => {
    const name = prompt("Rename department", dep.name)?.trim();
    if (!name || name === dep.name) return;
    try {
      await renameDepartment(dep.id, name);
      reload();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not rename the department.");
    }
  };

  const remove = async (dep: Department) => {
    try {
      await deleteDepartment(dep.id);
      reload();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete the department.");
    }
  };

  const toggleMember = async (dep: Department, userId: number) => {
    const next = dep.member_ids.includes(userId)
      ? dep.member_ids.filter((id) => id !== userId)
      : [...dep.member_ids, userId];
    try {
      await setDepartmentMembers(dep.id, next);
      reload();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update members.");
    }
  };

  return (
    <AdminCard title="Departments" icon="🏢" count={departments.length}>
      {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
      {teams.length === 0 ? (
        <p className={adminEmptyClass}>Add a team first.</p>
      ) : (
        <div className="flex flex-col gap-4">
          {teams.map((team) => {
            const deps = departments.filter((d) => d.team_id === team.id);
            return (
              <div key={team.id}>
                <h3 className="mb-1 text-sm font-semibold text-gray-800">{team.name}</h3>
                {deps.length === 0 && <p className="px-3 py-1 text-xs text-gray-400">No departments yet.</p>}
                {deps.map((dep) => (
                  <div key={dep.id}>
                    <div className={adminRowClass}>
                      <button
                        onClick={() => setExpanded((e) => (e === dep.id ? null : dep.id))}
                        aria-label={`members of ${dep.name}`}
                        className="flex-1 text-left"
                      >
                        {dep.name}{" "}
                        <span className="text-xs text-gray-400">({dep.member_ids.length})</span>
                      </button>
                      <button onClick={() => void rename(dep)} className="text-xs text-gray-400 hover:text-gray-700">
                        Rename
                      </button>
                      <button onClick={() => void remove(dep)} aria-label={`delete ${dep.name}`} className={adminRemoveButtonClass}>
                        ✕
                      </button>
                    </div>
                    {expanded === dep.id && (
                      <div data-testid={`members-${dep.id}`} className="ml-3 mb-2 grid grid-cols-2 gap-1 border-l border-gray-100 pl-3">
                        {people.map((p) => (
                          <label key={p.id} className="flex items-center gap-2 text-sm text-gray-700">
                            <input
                              type="checkbox"
                              checked={dep.member_ids.includes(p.id)}
                              onChange={() => void toggleMember(dep, p.id)}
                              className="h-4 w-4 rounded-sm border-gray-300"
                            />
                            {p.display_name}
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
                <div className="mt-1 flex gap-2">
                  <input
                    value={drafts[team.id] ?? ""}
                    onChange={(e) => setDrafts((d) => ({ ...d, [team.id]: e.target.value }))}
                    placeholder="New department"
                    aria-label={`new department for ${team.name}`}
                    className={`flex-1 ${adminInputClass}`}
                  />
                  <button onClick={() => void add(team.id)} aria-label={`add department to ${team.name}`} className={adminAddButtonClass}>
                    Add
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </AdminCard>
  );
}
