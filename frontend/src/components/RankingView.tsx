import { useMemo, useState } from "react";
import { DndContext, type DragEndEvent, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { reorderFeatureRanking } from "../api/client";
import { byManual, byWsjf, computeAfterId } from "../lib/ranking";
import type { AuthUser, Container, Item } from "../types";
import FilterSelect from "./FilterSelect";

function ManualRow({ feature, index, canMove }: { feature: Item; index: number; canMove: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: feature.id,
    disabled: !canMove,
  });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };
  return (
    <div
      ref={setNodeRef}
      style={style}
      data-testid="manual-row"
      data-draggable={canMove}
      className={`flex items-center gap-3 rounded-md border px-3 py-2 text-sm ${
        canMove ? "cursor-grab bg-white" : "bg-gray-50 text-gray-400"
      }`}
      {...(canMove ? { ...attributes, ...listeners } : {})}
    >
      <span className="w-6 text-right tabular-nums text-gray-400">{index + 1}</span>
      <span className="w-4">{canMove ? "⠿" : "🔒"}</span>
      <span data-testid="rank-title" className="flex-1 truncate text-gray-900">
        {feature.title}
      </span>
      <span className="text-xs text-gray-500">{feature.leading_team ?? "—"}</span>
    </div>
  );
}

export default function RankingView({
  items,
  planningIntervals,
  teams,
  containers,
  user,
  onChanged,
}: {
  items: Item[];
  planningIntervals: string[];
  teams: string[];
  containers: Container[];
  user: AuthUser;
  onChanged: () => void | Promise<void>;
}) {
  const [pi, setPi] = useState<string | undefined>();
  const [team, setTeam] = useState<string | undefined>();
  const [container, setContainer] = useState<string | undefined>();
  const sensors = useSensors(useSensor(PointerSensor));

  const containerName = useMemo(() => {
    const byId = new Map(containers.map((c) => [c.id, c.name]));
    return (it: Item) => (it.container_id != null ? byId.get(it.container_id) : undefined);
  }, [containers]);

  const features = useMemo(
    () =>
      items.filter(
        (it) =>
          it.kind === "feature" &&
          (pi === undefined || it.planning_interval === pi) &&
          (team === undefined || it.leading_team === team) &&
          (container === undefined || containerName(it) === container),
      ),
    [items, pi, team, container, containerName],
  );

  const wsjfOrder = useMemo(() => byWsjf(features), [features]);
  const manualOrder = useMemo(() => byManual(features), [features]);
  const canMove = (f: Item) => !!user.team_name && f.leading_team === user.team_name;

  const onDragEnd = async (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const afterId = computeAfterId(manualOrder, Number(active.id), Number(over.id));
    await reorderFeatureRanking(Number(active.id), afterId);
    await onChanged();
  };

  return (
    <div className="p-6">
      <div className="mb-4 flex flex-wrap gap-2">
        <FilterSelect label="Interval" value={pi} options={planningIntervals} onChange={setPi} />
        <FilterSelect label="Team" value={team} options={teams} onChange={setTeam} />
        <FilterSelect label="Container" value={container} options={[...new Set(containers.map((c) => c.name))]} onChange={setContainer} />
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section>
          <h2 className="mb-2 text-sm font-semibold text-gray-700">WSJF ranking</h2>
          <div data-testid="wsjf-list" className="space-y-1">
            {wsjfOrder.map((f, i) => (
              <div key={f.id} className="flex items-center gap-3 rounded-md border bg-white px-3 py-2 text-sm">
                <span className="w-6 text-right tabular-nums text-gray-400">{i + 1}</span>
                <span data-testid="rank-title" className="flex-1 truncate text-gray-900">{f.title}</span>
                <span className="tabular-nums text-gray-500">{f.wsjf_score ?? "—"}</span>
                <span className="text-xs text-gray-500">{f.leading_team ?? "—"}</span>
              </div>
            ))}
          </div>
        </section>
        <section>
          <h2 className="mb-2 text-sm font-semibold text-gray-700">Manual priority</h2>
          <DndContext sensors={sensors} onDragEnd={(e) => void onDragEnd(e)}>
            <SortableContext items={manualOrder.map((f) => f.id)} strategy={verticalListSortingStrategy}>
              <div data-testid="manual-list" className="space-y-1">
                {manualOrder.map((f, i) => (
                  <ManualRow key={f.id} feature={f} index={i} canMove={canMove(f)} />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        </section>
      </div>
    </div>
  );
}
