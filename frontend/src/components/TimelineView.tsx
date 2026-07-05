import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useEffect, useMemo, useState } from "react";
import { ConflictError, updateItem } from "../api/client";
import { faMagnifyingGlass, faXmark } from "../icons";
import { ITERATION_SLOTS, iterationLabel } from "../lib/iterations";
import { computePlanningLinks } from "../lib/planningLinks";
import { dependencyComponent, groupByFeature, layoutFlat, type FeatureLane } from "../lib/timeline";
import type { Item, LinkRow } from "../types";
import FilterSelect from "./FilterSelect";
import TimelineLane, { type TimelineColumn } from "./TimelineLane";

export async function handleTimelineDragEnd(
  event: DragEndEvent,
  items: Item[],
  reload: () => void | Promise<void>,
): Promise<void> {
  if (!event.over) return;
  const storyId = Number(event.active.id);
  const current = items.find((i) => i.id === storyId);
  if (!current) return;
  const slot = String(event.over.id).split("::")[1];
  const iteration = slot === "backlog" ? null : Number(slot);
  try {
    await updateItem(storyId, { iteration, version: current.version });
  } catch (e) {
    if (!(e instanceof ConflictError)) throw e;
    // Someone else changed the story — the reload below snaps it back.
  }
  await reload();
}

export default function TimelineView({
  items,
  links,
  planningIntervals,
  departmentNames = [],
  onOpenCard,
  onChanged,
}: {
  items: Item[];
  links: LinkRow[];
  planningIntervals: string[];
  departmentNames?: string[];
  onOpenCard: (id: number) => void;
  onChanged: () => void | Promise<void>;
}) {
  const [pi, setPi] = useState<string | null>(planningIntervals[0] ?? null);
  const [showAll, setShowAll] = useState(true);
  const [query, setQuery] = useState("");
  const [department, setDepartment] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<Set<number> | null>(null);
  const onHighlight = (ids: number[] | null) => setHighlight(ids ? new Set(ids) : null);
  const [mode, setMode] = useState<"feature" | "deps">("feature");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const toggleSelect = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  useEffect(() => {
    if ((pi == null || !planningIntervals.includes(pi)) && planningIntervals.length) {
      setPi(planningIntervals[0]);
    }
  }, [planningIntervals, pi]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));
  const cardInfo = useMemo(() => computePlanningLinks(items, links, pi ?? ""), [items, links, pi]);
  const lanes = useMemo(
    () => (pi ? groupByFeature(items, pi, { showAll }) : []),
    [items, pi, showAll],
  );
  // Filter the feature lanes by a single query matching the feature title
  // (case-insensitive substring) or its id (a leading "#" is ignored). An
  // empty query shows every lane; the "No feature" orphan lane is hidden
  // while a query is active.
  const filteredLanes = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/^#/, "");
    return lanes.filter((lane) => {
      if (department && lane.feature?.department_name !== department) return false;
      if (q) {
        return (
          lane.feature != null &&
          (lane.feature.title.toLowerCase().includes(q) || String(lane.feature.id).includes(q))
        );
      }
      return true;
    });
  }, [lanes, query, department]);
  const depsLane: FeatureLane = useMemo(() => {
    let base: Item[] = [];
    if (pi) {
      if (selected.size) {
        const component = dependencyComponent(items, links, selected);
        base = items.filter((it) => component.has(it.id));
      } else {
        base = items.filter((it) => it.kind === "story" && it.planning_interval === pi);
      }
    }
    const flat = layoutFlat(base, pi ?? "");
    return { feature: null, backlog: flat.backlog, slots: flat.slots };
  }, [items, links, pi, selected]);

  const columns: TimelineColumn[] = [
    ...(showAll || mode === "deps" ? [{ slot: "backlog" as const, label: "Backlog" }] : []),
    ...ITERATION_SLOTS.map((s) => ({ slot: s, label: iterationLabel(s) })),
  ];

  if (!planningIntervals.length) {
    return <div className="p-8 text-gray-500">No planning intervals yet. Set a Planning Interval on stories first.</div>;
  }

  const pill = (active: boolean) =>
    `rounded-full border px-3 py-1 text-sm font-medium transition ${
      active ? "border-blue-600 bg-blue-600 text-white shadow-xs" : "border-gray-200 bg-surface text-gray-600 hover:bg-gray-50"
    }`;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-gray-200 bg-surface px-6 py-3">
        <FilterSelect
          label="Planning Interval"
          value={pi ?? undefined}
          options={planningIntervals}
          onChange={(v) => v && setPi(v)}
          allowAll={false}
        />
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Mode</span>
          <button onClick={() => setMode("feature")} className={pill(mode === "feature")}>By feature</button>
          <button onClick={() => setMode("deps")} className={pill(mode === "deps")}>Dependencies</button>
          {mode === "deps" && selected.size > 0 && (
            <button onClick={() => setSelected(new Set())} className={pill(false)}>Clear ({selected.size})</button>
          )}
        </div>
        {mode === "feature" && (
          <>
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Lanes</span>
              <button onClick={() => setShowAll(true)} className={pill(showAll)}>Show all</button>
              <button onClick={() => setShowAll(false)} className={pill(!showAll)}>Only planned</button>
            </div>
            <FilterSelect
              label="Department"
              value={department ?? undefined}
              options={departmentNames}
              onChange={(v) => setDepartment(v ?? null)}
            />
          </>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-4">
        <div className="flex items-center gap-2 pl-2">
          <div className="w-64 shrink-0 px-2">
            {mode === "feature" && (
              <div className="relative">
                <FontAwesomeIcon
                  icon={faMagnifyingGlass}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs text-gray-400"
                />
                <input
                  aria-label="Filter by feature title or ID"
                  placeholder="Filter features…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="w-full rounded-lg border border-gray-200 bg-gray-50 py-1.5 pl-9 pr-8 text-sm text-gray-700 transition placeholder:text-gray-400 focus:border-blue-300 focus:bg-surface focus:outline-hidden focus:ring-2 focus:ring-blue-100"
                />
                {query && (
                  <button
                    aria-label="Clear feature filter"
                    onClick={() => setQuery("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-sm p-0.5 text-xs text-gray-400 transition hover:bg-gray-200 hover:text-gray-600"
                  >
                    <FontAwesomeIcon icon={faXmark} />
                  </button>
                )}
              </div>
            )}
          </div>
          {columns.map((col) => (
            <div key={String(col.slot)} className="w-64 shrink-0 px-2 text-sm font-semibold text-gray-700">
              {col.label}
            </div>
          ))}
        </div>
        <DndContext sensors={sensors} onDragEnd={(e) => void handleTimelineDragEnd(e, items, onChanged)}>
          <div className="flex flex-col">
            {mode === "feature" && filteredLanes.length === 0 && query.trim() ? (
              <div className="px-2 py-8 text-sm text-gray-400">
                No features match “{query.trim()}”.
              </div>
            ) : (
              (mode === "feature" ? filteredLanes : [depsLane]).map((lane) => (
                <TimelineLane
                  key={lane.feature ? lane.feature.id : "orphan"}
                  lane={lane}
                  columns={columns}
                  cardInfo={cardInfo}
                  highlight={highlight}
                  selectedIds={mode === "deps" ? selected : undefined}
                  onHighlight={onHighlight}
                  onOpenCard={mode === "deps" ? toggleSelect : onOpenCard}
                  onOpenFeature={mode === "deps" ? toggleSelect : onOpenCard}
                />
              ))
            )}
          </div>
        </DndContext>
      </div>
    </div>
  );
}
