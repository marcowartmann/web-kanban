import {
  DndContext,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { useCallback, useEffect, useState } from "react";
import { getPIObjectives, updatePIObjective } from "../api/client";
import type { AuthUser, Item, ObjectiveState, PIObjective, Team } from "../types";
import FilterSelect from "./FilterSelect";
import ObjectiveCard from "./ObjectiveCard";
import ObjectiveEditor from "./ObjectiveEditor";

const COLUMNS: { key: ObjectiveState; label: string }[] = [
  { key: "committed", label: "Committed" },
  { key: "uncommitted", label: "Uncommitted" },
  { key: "out_of_scope", label: "Out of scope" },
];

/** Pure drop resolver — extracted so the drag logic is unit-testable. */
export function computeStateChange(from: ObjectiveState, to: ObjectiveState) {
  return { changed: from !== to, state: to };
}

function Column({ col, children }: { col: ObjectiveState; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: col });
  return (
    <div ref={setNodeRef} className={`flex flex-col gap-2 rounded-lg p-1 ${isOver ? "bg-blue-50 ring-2 ring-blue-300" : ""}`}>
      {children}
    </div>
  );
}

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
  const [editing, setEditing] = useState<PIObjective | "new" | null>(null);

  const reload = useCallback(() => {
    if (!pi) return;
    void getPIObjectives({ planning_interval: pi, team: team ?? undefined }).then(setObjectives);
  }, [pi, team]);

  useEffect(reload, [reload]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  const onDragEnd = (e: DragEndEvent) => {
    const id = Number(e.active.id);
    const to = e.over?.id as ObjectiveState | undefined;
    const current = objectives.find((o) => o.id === id);
    if (!current || !to) return;
    const { changed, state } = computeStateChange(current.state, to);
    if (!changed) return;
    setObjectives((os) =>
      os.map((o) =>
        o.id === id
          ? { ...o, state, is_key_delivery: state === "committed" ? o.is_key_delivery : false }
          : o,
      ),
    );
    void updatePIObjective(id, { state }).catch(reload);
  };

  const selectedTeam = team ? teams.find((t) => t.name === team) ?? null : null;
  const canEditTeam = (tid: number | undefined) => user.role === "admin" || (tid != null && user.team_id === tid);
  const canAdd = selectedTeam != null && canEditTeam(selectedTeam.id);
  const editorTeam = editing === "new" ? selectedTeam : editing ? { id: editing.team_id, name: editing.team_name } : null;

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
        {canAdd ? (
          <button
            onClick={() => setEditing("new")}
            className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white shadow-xs transition hover:bg-blue-700"
          >
            + New objective
          </button>
        ) : (
          <span className="text-xs text-gray-400">Select your team to add objectives</span>
        )}
      </div>
      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <div className="grid grid-cols-3 gap-4 p-6">
          {COLUMNS.map((col) => {
            const inColumn = objectives.filter((o) => o.state === col.key);
            return (
              <div key={col.key}>
                <h2 className="mb-2 text-sm font-semibold text-gray-700">
                  {col.label} <span className="text-gray-400">{inColumn.length}</span>
                </h2>
                <Column col={col.key}>
                  {inColumn.map((o) => (
                    <ObjectiveCard
                      key={o.id}
                      obj={o}
                      showTeam={team == null}
                      draggable={canEditTeam(o.team_id)}
                      onOpen={canEditTeam(o.team_id) ? () => setEditing(o) : undefined}
                    />
                  ))}
                </Column>
              </div>
            );
          })}
        </div>
      </DndContext>

      {editing && editorTeam && (
        <ObjectiveEditor
          existing={editing === "new" ? undefined : editing}
          teamId={editorTeam.id}
          teamName={editorTeam.name}
          planningInterval={pi}
          features={features}
          onClose={() => setEditing(null)}
          onSaved={() => {
            reload();
            onChanged();
          }}
        />
      )}
    </div>
  );
}
