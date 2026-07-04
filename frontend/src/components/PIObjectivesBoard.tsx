import { useCallback, useEffect, useState } from "react";
import { getPIObjectives } from "../api/client";
import type { AuthUser, Item, ObjectiveState, PIObjective, Team } from "../types";
import FilterSelect from "./FilterSelect";
import ObjectiveCard from "./ObjectiveCard";

const COLUMNS: { key: ObjectiveState; label: string }[] = [
  { key: "committed", label: "Committed" },
  { key: "uncommitted", label: "Uncommitted" },
  { key: "out_of_scope", label: "Out of scope" },
];

export default function PIObjectivesBoard({
  teams,
  planningIntervals,
  user,
  features,
  onChanged,
}: {
  teams: Team[];
  planningIntervals: string[];
  user: AuthUser;
  features: Item[];
  onChanged: () => void;
}) {
  const [pi, setPi] = useState<string>(planningIntervals[0] ?? "");
  const [team, setTeam] = useState<string | null>(null);
  const [objectives, setObjectives] = useState<PIObjective[]>([]);

  const reload = useCallback(() => {
    if (!pi) return;
    void getPIObjectives({ planning_interval: pi, team: team ?? undefined }).then(setObjectives);
  }, [pi, team]);

  useEffect(reload, [reload]);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 border-b border-gray-200 bg-surface px-6 py-3">
        <FilterSelect
          label="Planning Interval"
          value={pi || undefined}
          options={planningIntervals}
          onChange={(v) => v && setPi(v)}
          allowAll={false}
        />
        <FilterSelect
          label="Team"
          value={team ?? undefined}
          options={teams.map((t) => t.name)}
          onChange={(v) => setTeam(v ?? null)}
          allLabel="All teams"
        />
      </div>
      <div className="grid grid-cols-3 gap-4 p-6">
        {COLUMNS.map((col) => {
          const inColumn = objectives.filter((o) => o.state === col.key);
          return (
            <div key={col.key}>
              <h2 className="mb-2 text-sm font-semibold text-gray-700">
                {col.label} <span className="text-gray-400">{inColumn.length}</span>
              </h2>
              <div className="flex flex-col gap-2">
                {inColumn.map((o) => (
                  <ObjectiveCard key={o.id} obj={o} showTeam={team == null} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
