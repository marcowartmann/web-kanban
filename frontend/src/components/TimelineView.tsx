import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { useEffect, useMemo, useState } from "react";
import { updateItem } from "../api/client";
import { ITERATION_SLOTS, iterationLabel } from "../lib/iterations";
import { computePlanningLinks } from "../lib/planningLinks";
import { groupByFeature } from "../lib/timeline";
import type { Item, LinkRow } from "../types";
import TimelineLane, { type TimelineColumn } from "./TimelineLane";

export async function handleTimelineDragEnd(
  event: DragEndEvent,
  reload: () => void | Promise<void>,
): Promise<void> {
  if (!event.over) return;
  const slot = String(event.over.id).split("::")[1];
  const iteration = slot === "backlog" ? null : Number(slot);
  await updateItem(Number(event.active.id), { iteration });
  await reload();
}

export default function TimelineView({
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
  const [showAll, setShowAll] = useState(true);
  const [highlight, setHighlight] = useState<Set<number> | null>(null);
  const onHighlight = (ids: number[] | null) => setHighlight(ids ? new Set(ids) : null);

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

  const columns: TimelineColumn[] = [
    ...(showAll ? [{ slot: "backlog" as const, label: "Backlog" }] : []),
    ...ITERATION_SLOTS.map((s) => ({ slot: s, label: iterationLabel(s) })),
  ];

  if (!planningIntervals.length) {
    return <div className="p-8 text-gray-500">No planning intervals yet. Set a Planning Interval on stories first.</div>;
  }

  const pill = (active: boolean) =>
    `rounded-full border px-3 py-1 text-sm font-medium transition ${
      active ? "border-blue-600 bg-blue-600 text-white shadow-sm" : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
    }`;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 border-b bg-white px-6 py-3">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Planning Interval</span>
        {planningIntervals.map((p) => (
          <button key={p} onClick={() => setPi(p)} className={pill(p === pi)}>
            {p}
          </button>
        ))}
        <span className="ml-4 text-[11px] font-semibold uppercase tracking-wide text-gray-400">Lanes</span>
        <button onClick={() => setShowAll(true)} className={pill(showAll)}>Show all</button>
        <button onClick={() => setShowAll(false)} className={pill(!showAll)}>Only planned</button>
      </div>

      <div className="overflow-x-auto p-4">
        <div className="flex items-center gap-2 pl-2">
          <div className="w-64 shrink-0" />
          {columns.map((col) => (
            <div key={String(col.slot)} className="w-64 shrink-0 px-2 text-sm font-semibold text-gray-700">
              {col.label}
            </div>
          ))}
        </div>
        <DndContext sensors={sensors} onDragEnd={(e) => void handleTimelineDragEnd(e, onChanged)}>
          <div className="flex flex-col">
            {lanes.map((lane) => (
              <TimelineLane
                key={lane.feature ? lane.feature.id : "orphan"}
                lane={lane}
                columns={columns}
                cardInfo={cardInfo}
                highlight={highlight}
                onHighlight={onHighlight}
                onOpenCard={onOpenCard}
                onOpenFeature={onOpenCard}
              />
            ))}
          </div>
        </DndContext>
      </div>
    </div>
  );
}
