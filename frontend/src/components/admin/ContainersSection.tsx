import { useEffect, useState } from "react";
import {
  ConflictError,
  createContainer,
  deleteContainer,
  getContainers,
  getTeams,
  renameContainer,
} from "../../api/client";
import type { Container, Team } from "../../types";
import ConfirmDialog from "../ConfirmDialog";
import FilterSelect from "../FilterSelect";
import { captionClass } from "../ui";
import {
  adminAddButtonClass,
  adminCardClass,
  adminEmptyClass,
  adminInputClass,
  adminRemoveButtonClass,
  adminRowClass,
} from "./AdminCard";

export default function ContainersSection({
  planningIntervals,
}: {
  planningIntervals: string[];
}) {
  const [containers, setContainers] = useState<Container[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [pi, setPi] = useState<string | null>(planningIntervals[0] ?? null);
  const [teamFilter, setTeamFilter] = useState<string | undefined>();
  const [newName, setNewName] = useState("");
  const [newTeamId, setNewTeamId] = useState<number | "">("");
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [forceDelete, setForceDelete] = useState<{ id: number; detail: string } | null>(null);

  const reload = () => void getContainers().then(setContainers);
  useEffect(() => {
    reload();
    void getTeams().then(setTeams);
  }, []);

  const iconChip = (
    <span
      className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-50 text-base text-violet-600"
      aria-hidden
    >
      📦
    </span>
  );

  if (!planningIntervals.length) {
    return (
      <section className={adminCardClass}>
        <header className="mb-2 flex items-center gap-2.5">
          {iconChip}
          <h2 className="text-sm font-semibold text-gray-900">Containers</h2>
        </header>
        <p className="text-sm text-gray-500">
          No planning intervals yet. Create a Planning Interval first.
        </p>
      </section>
    );
  }

  // The Team filter narrows both the list and the add-row default.
  const filterTeam = teams.find((t) => t.name === teamFilter);
  const scoped = containers.filter(
    (c) => c.planning_interval === pi && (!filterTeam || c.team_id === filterTeam.id),
  );
  const visibleTeams = filterTeam ? [filterTeam] : teams;
  const addTeamId = newTeamId !== "" ? newTeamId : filterTeam?.id ?? "";

  const add = async () => {
    if (!newName.trim() || !pi || addTeamId === "") return;
    setError(null);
    try {
      await createContainer({
        name: newName.trim(),
        planning_interval: pi,
        team_id: addTeamId,
      });
      setNewName("");
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add the container.");
    }
  };

  const startRename = (c: Container) => {
    setRenamingId(c.id);
    setRenameValue(c.name);
    setError(null);
  };

  const saveRename = async () => {
    if (renamingId == null || !renameValue.trim()) return;
    setError(null);
    try {
      await renameContainer(renamingId, renameValue.trim());
      setRenamingId(null);
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not rename the container.");
    }
  };

  const remove = async (id: number) => {
    setError(null);
    try {
      await deleteContainer(id);
    } catch (e) {
      if (e instanceof ConflictError) setForceDelete({ id, detail: e.detail });
      else setError(e instanceof Error ? e.message : "Could not delete the container.");
      return;
    }
    reload();
  };

  const forceRemove = async () => {
    if (!forceDelete) return;
    const { id } = forceDelete;
    setForceDelete(null);
    try {
      await deleteContainer(id, true);
    } catch (forced) {
      setError(forced instanceof Error ? forced.message : "Could not delete the container.");
      return;
    }
    reload();
  };

  const row = (c: Container) => (
    <li key={c.id} className={adminRowClass}>
      {renamingId === c.id ? (
        <span className="flex flex-1 items-center gap-2">
          <input
            aria-label={`new name for container ${c.id}`}
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
          <span className="truncate font-medium text-gray-800">{c.name}</span>
          <span className="flex shrink-0 items-center gap-1">
            <button
              aria-label={`rename container ${c.id}`}
              onClick={() => startRename(c)}
              className="rounded-md px-1.5 py-1 text-xs text-gray-300 transition hover:bg-blue-50 hover:text-blue-600 group-hover:text-gray-400"
            >
              ✎
            </button>
            <button
              aria-label={`remove container ${c.id}`}
              onClick={() => remove(c.id)}
              className={adminRemoveButtonClass}
            >
              ✕
            </button>
          </span>
        </>
      )}
    </li>
  );

  return (
    <section className={adminCardClass}>
      <div className="mb-4 flex flex-wrap items-center gap-2.5">
        {iconChip}
        <h2 className="text-sm font-semibold text-gray-900">Containers</h2>
        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">
          {scoped.length}
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-2.5">
          <FilterSelect
            label="Team"
            value={teamFilter}
            options={teams.map((t) => t.name)}
            onChange={setTeamFilter}
          />
          <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
            Planning Interval
          </span>
          <div className="flex flex-wrap gap-1.5">
            {planningIntervals.map((p) => (
              <button
                key={p}
                onClick={() => setPi(p)}
                className={`rounded-full border px-3 py-1 text-sm font-medium transition ${
                  p === pi
                    ? "border-blue-600 bg-blue-600 text-white shadow-sm"
                    : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="mb-4 flex gap-2">
        <select
          aria-label="Team for new container"
          value={addTeamId}
          onChange={(e) => setNewTeamId(e.target.value === "" ? "" : Number(e.target.value))}
          className={`${adminInputClass} w-44`}
        >
          <option value="">Select team…</option>
          {teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void add()}
          placeholder="New container name"
          className={`${adminInputClass} flex-1`}
        />
        <button onClick={add} className={adminAddButtonClass}>
          Add
        </button>
      </div>
      {error && <p className="mb-2 text-xs text-red-600">{error}</p>}

      <div className="flex flex-col gap-3">
        {visibleTeams.map((t) => {
          const own = scoped.filter((c) => c.team_id === t.id);
          if (!own.length) return null;
          return (
            <div key={t.id}>
              <h3 className={`mb-1 px-3 ${captionClass}`}>{t.name}</h3>
              <ul className="flex flex-col gap-0.5">{own.map(row)}</ul>
            </div>
          );
        })}
        {scoped.length === 0 && <p className={adminEmptyClass}>No containers in this scope yet.</p>}
      </div>

      {forceDelete && (
        <ConfirmDialog
          title="Delete container?"
          message={forceDelete.detail}
          confirmLabel="Delete anyway"
          onConfirm={() => void forceRemove()}
          onClose={() => setForceDelete(null)}
        />
      )}
    </section>
  );
}
