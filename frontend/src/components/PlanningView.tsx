import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { useEffect, useMemo, useState } from "react";
import { ConflictError, getCapacities, getPersonOptions, getTeams, updateItem } from "../api/client";
import {
  ITERATION_SLOTS,
  capacityBySlot,
  groupStoriesByIteration,
  iterationLabel,
  slotPoints,
} from "../lib/iterations";
import { loadCapacityRows } from "../lib/capacity";
import { computePlanningLinks } from "../lib/planningLinks";
import type { Capacity, Item, LinkRow, PersonOption, Team } from "../types";
import CapacityGrid from "./CapacityGrid";
import FilterSelect from "./FilterSelect";
import PlanningColumn from "./PlanningColumn";

export async function handlePlanDragEnd(
  event: DragEndEvent,
  items: Item[],
  reload: () => void | Promise<void>,
): Promise<void> {
  if (!event.over) return;
  const storyId = Number(event.active.id);
  const current = items.find((i) => i.id === storyId);
  if (!current) return;
  const slot = event.over.id === "backlog" ? null : Number(event.over.id);
  try {
    await updateItem(storyId, { iteration: slot, version: current.version });
  } catch (e) {
    if (!(e instanceof ConflictError)) throw e;
    // Someone else changed the story — the reload below snaps it back.
  }
  await reload();
}

export default function PlanningView({
  items,
  links,
  planningIntervals,
  onOpenCard,
  onChanged,
}: {
  items: Item[];
  links: LinkRow[];
  planningIntervals: string[];
  onOpenCard: (id: number) => void;
  onChanged: () => void | Promise<void>;
}) {
  const [pi, setPi] = useState<string | null>(planningIntervals[0] ?? null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [people, setPeople] = useState<PersonOption[]>([]);
  const [capacities, setCapacities] = useState<Capacity[]>([]);
  const [teamId, setTeamId] = useState<number | null>(null);
  const [assigneeName, setAssigneeName] = useState<string | null>(null);
  const [showCapacity, setShowCapacity] = useState(false);
  // On ⚠ hover: the card + its conflict partners stay lit; other cards dim.
  const [highlight, setHighlight] = useState<Set<number> | null>(null);
  const onHighlight = (ids: number[] | null) => setHighlight(ids ? new Set(ids) : null);

  useEffect(() => {
    void getTeams().then(setTeams);
    void getPersonOptions().then(setPeople);
    void getCapacities().then(setCapacities);
  }, []);

  // Keep the selected PI valid as data loads/changes.
  useEffect(() => {
    if ((pi == null || !planningIntervals.includes(pi)) && planningIntervals.length) {
      setPi(planningIntervals[0]);
    }
  }, [planningIntervals, pi]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  const parentTitles = useMemo(() => {
    const m = new Map<number, string>();
    for (const i of items) if (i.kind === "feature") m.set(i.id, i.title);
    return m;
  }, [items]);

  const team = teamId != null ? teams.find((t) => t.id === teamId) ?? null : null;

  // People to choose from = assignees on the current PI's stories (team-scoped).
  const assigneeOptions = useMemo(() => {
    const scoped = team ? items.filter((i) => i.leading_team === team.name) : items;
    const names = scoped
      .filter((i) => i.kind === "story" && i.planning_interval === pi && i.assignee)
      .map((i) => i.assignee as string);
    return [...new Set(names)].sort();
  }, [items, team, pi]);

  // Drop a stale assignee selection when the team/PI change hides them.
  useEffect(() => {
    if (assigneeName && !assigneeOptions.includes(assigneeName)) setAssigneeName(null);
  }, [assigneeOptions, assigneeName]);

  const groups = useMemo(() => {
    if (!pi) return null;
    let scoped = team ? items.filter((i) => i.leading_team === team.name) : items;
    if (assigneeName) scoped = scoped.filter((i) => i.assignee === assigneeName);
    return groupStoriesByIteration(scoped, pi);
  }, [items, pi, team, assigneeName]);

  // Dependency badges + timeline conflicts, computed over the full (unfiltered)
  // item list so a blocker hidden by the team/assignee filter is still detected.
  const cardInfo = useMemo(
    () => computePlanningLinks(items, links, pi ?? ""),
    [items, links, pi],
  );

  // PersonOption has no team_id (unlike the retired member records), so team
  // selection can no longer narrow which people's capacity counts here — only the
  // assignee filter can. Team scoping of the *load* side is unaffected: teamStories
  // below still restricts stories to the selected team.
  const caps = useMemo(() => {
    if (!pi) return null;
    const personIds = assigneeName
      ? new Set(people.filter((p) => p.display_name === assigneeName).map((p) => p.id))
      : null;
    return capacityBySlot(capacities, pi, personIds);
  }, [capacities, pi, assigneeName, people]);

  // Per-person load/capacity rows for the grid. Stories are scoped to the selected
  // team (all when "All teams"); the people list is org-wide (see note above).
  const teamStories = useMemo(
    () =>
      (team ? items.filter((i) => i.leading_team === team.name) : items).filter(
        (i) => i.kind === "story" && i.planning_interval === pi,
      ),
    [items, team, pi],
  );
  const capacityRows = useMemo(
    () => (pi ? loadCapacityRows(people, capacities, teamStories, pi) : []),
    [people, capacities, teamStories, pi],
  );

  if (!planningIntervals.length) {
    return (
      <div className="p-8 text-gray-500">
        No planning intervals yet. Set a Planning Interval on stories first.
      </div>
    );
  }

  const pill = (active: boolean) =>
    `rounded-full border px-3 py-1 text-sm font-medium transition ${
      active
        ? "border-blue-600 bg-blue-600 text-white shadow-sm"
        : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
    }`;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 border-b bg-white px-6 py-3">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
          Planning Interval
        </span>
        {planningIntervals.map((p) => (
          <button key={p} onClick={() => setPi(p)} className={pill(p === pi)}>
            {p}
          </button>
        ))}

        <span className="ml-4 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
          Team
        </span>
        <button onClick={() => setTeamId(null)} className={pill(teamId === null)}>
          All teams
        </button>
        {teams.map((t) => (
          <button key={t.id} onClick={() => setTeamId(t.id)} className={pill(teamId === t.id)}>
            {t.name}
          </button>
        ))}

        <div className="ml-4">
          <FilterSelect
            label="Assignee"
            value={assigneeName ?? undefined}
            options={assigneeOptions}
            onChange={(v) => setAssigneeName(v ?? null)}
          />
        </div>

        <button onClick={() => setShowCapacity((v) => !v)} className={`ml-2 ${pill(showCapacity)}`}>
          Capacity
        </button>
      </div>

      {groups && (
        <div className="overflow-x-auto p-6">
          {showCapacity && <CapacityGrid rows={capacityRows} />}
          <DndContext sensors={sensors} onDragEnd={(e) => void handlePlanDragEnd(e, items, onChanged)}>
            <div className="flex gap-4">
              <PlanningColumn
                id="backlog"
                title="Backlog"
                stories={groups.backlog}
                parentTitles={parentTitles}
                linkInfo={cardInfo}
                highlight={highlight}
                onHighlight={onHighlight}
                onOpen={onOpenCard}
              />
              {ITERATION_SLOTS.map((slot) => (
                <PlanningColumn
                  key={slot}
                  id={String(slot)}
                  title={iterationLabel(slot)}
                  load={slotPoints(groups.slots[slot])}
                  capacity={caps ? caps[slot] : undefined}
                  stories={groups.slots[slot]}
                  parentTitles={parentTitles}
                  linkInfo={cardInfo}
                  highlight={highlight}
                  onHighlight={onHighlight}
                  onOpen={onOpenCard}
                />
              ))}
            </div>
          </DndContext>
        </div>
      )}
    </div>
  );
}
