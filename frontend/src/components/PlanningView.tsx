import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { useEffect, useMemo, useState } from "react";
import { updateItem } from "../api/client";
import {
  ITERATION_SLOTS,
  groupStoriesByIteration,
  iterationLabel,
  slotPoints,
} from "../lib/iterations";
import type { Item } from "../types";
import PlanningColumn from "./PlanningColumn";

export async function handlePlanDragEnd(
  event: DragEndEvent,
  reload: () => void | Promise<void>,
): Promise<void> {
  if (!event.over) return;
  const slot = event.over.id === "backlog" ? null : Number(event.over.id);
  await updateItem(Number(event.active.id), { iteration: slot });
  await reload();
}

export default function PlanningView({
  items,
  planningIntervals,
  onOpenCard,
  onChanged,
}: {
  items: Item[];
  planningIntervals: string[];
  onOpenCard: (id: number) => void;
  onChanged: () => void | Promise<void>;
}) {
  const [pi, setPi] = useState<string | null>(planningIntervals[0] ?? null);

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

  const groups = useMemo(
    () => (pi ? groupStoriesByIteration(items, pi) : null),
    [items, pi],
  );

  if (!planningIntervals.length) {
    return (
      <div className="p-8 text-gray-500">
        No planning intervals yet. Set a Planning Interval on stories first.
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 border-b bg-white px-6 py-3">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
          Planning Interval
        </span>
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

      {groups && (
        <DndContext sensors={sensors} onDragEnd={(e) => void handlePlanDragEnd(e, onChanged)}>
          <div className="flex gap-4 overflow-x-auto p-6">
            <PlanningColumn
              id="backlog"
              title="Backlog"
              stories={groups.backlog}
              parentTitles={parentTitles}
              onOpen={onOpenCard}
            />
            {ITERATION_SLOTS.map((slot) => (
              <PlanningColumn
                key={slot}
                id={String(slot)}
                title={iterationLabel(slot)}
                points={slotPoints(groups.slots[slot])}
                stories={groups.slots[slot]}
                parentTitles={parentTitles}
                onOpen={onOpenCard}
              />
            ))}
          </div>
        </DndContext>
      )}
    </div>
  );
}
