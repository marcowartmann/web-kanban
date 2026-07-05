import { useMemo, useState } from "react";
import { DndContext, type DragEndEvent, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCaretDown, faCaretUp, faCircleInfo, faGripVertical, faLock } from "../icons";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { reorderFeatureRanking } from "../api/client";
import { byManual, byWsjf, computeAfterId, wsjfRankMap } from "../lib/ranking";
import type { AuthUser, Container, Item } from "../types";
import FilterSelect from "./FilterSelect";

function InfoButton({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      type="button"
      aria-label="Feature detail"
      title="Feature detail"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onOpen();
      }}
      className="shrink-0 rounded-md p-1 text-gray-300 transition hover:bg-blue-50 hover:text-blue-600"
    >
      <FontAwesomeIcon icon={faCircleInfo} className="text-sm" />
    </button>
  );
}

function DeltaBadge({ delta }: { delta: number }) {
  const direction = delta > 0 ? "up" : delta < 0 ? "down" : "none";
  const cls =
    delta > 0 ? "text-green-600" : delta < 0 ? "text-red-600" : "text-gray-300";
  return (
    <span
      data-testid="delta"
      data-direction={direction}
      className={`flex w-10 items-center justify-end gap-0.5 text-xs font-semibold tabular-nums ${cls}`}
    >
      {delta === 0 ? (
        "–"
      ) : (
        <>
          <FontAwesomeIcon icon={delta > 0 ? faCaretUp : faCaretDown} aria-hidden />
          {Math.abs(delta)}
        </>
      )}
    </span>
  );
}

function ManualRow({
  feature,
  index,
  canMove,
  wsjfRank,
  highlighted,
  onHover,
  onOpen,
}: {
  feature: Item;
  index: number;
  canMove: boolean;
  wsjfRank: number;
  highlighted: boolean;
  onHover: (id: number | null) => void;
  onOpen: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: feature.id,
    disabled: !canMove,
  });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };
  const delta = wsjfRank - (index + 1); // >0 = promoted above its WSJF rank
  return (
    <div
      ref={setNodeRef}
      style={style}
      data-testid="manual-row"
      data-feature-id={feature.id}
      data-draggable={canMove}
      data-highlighted={highlighted}
      onMouseEnter={() => onHover(feature.id)}
      onMouseLeave={() => onHover(null)}
      className={`flex items-center gap-3 rounded-md border px-3 py-2 text-sm transition ${
        canMove ? "cursor-grab" : "text-gray-400"
      } ${highlighted ? "border-blue-400 bg-blue-100 ring-1 ring-blue-300" : canMove ? "border-gray-200 bg-surface" : "border-gray-200 bg-gray-50"}`}
      {...(canMove ? { ...attributes, ...listeners } : {})}
    >
      <span className="w-6 text-right tabular-nums text-gray-400">{index + 1}</span>
      <span className="w-4 text-xs text-gray-400">
        <FontAwesomeIcon icon={canMove ? faGripVertical : faLock} aria-hidden />
      </span>
      <span className="tabular-nums text-xs text-gray-400">#{feature.id}</span>
      <span data-testid="rank-title" className="flex-1 truncate text-gray-900">
        {feature.title}
      </span>
      <span className="text-xs text-gray-500">{feature.leading_team ?? "—"}</span>
      <span data-testid="wsjf-rank" className="w-16 text-right text-xs tabular-nums text-gray-500">
        WSJF #{wsjfRank}
      </span>
      <DeltaBadge delta={delta} />
      <InfoButton onOpen={onOpen} />
    </div>
  );
}

export default function RankingView({
  items,
  planningIntervals,
  teams,
  containers,
  departmentNames = [],
  user,
  onOpenCard,
  onChanged,
}: {
  items: Item[];
  planningIntervals: string[];
  teams: string[];
  containers: Container[];
  departmentNames?: string[];
  user: AuthUser;
  onOpenCard?: (id: number) => void;
  onChanged: () => void | Promise<void>;
}) {
  const [pi, setPi] = useState<string | undefined>();
  const [team, setTeam] = useState<string | undefined>();
  const [container, setContainer] = useState<string | undefined>();
  const [department, setDepartment] = useState<string | undefined>();
  const [hoveredId, setHoveredId] = useState<number | null>(null);
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
          (container === undefined || containerName(it) === container) &&
          (department === undefined || it.department_name === department),
      ),
    [items, pi, team, container, department, containerName],
  );

  const wsjfOrder = useMemo(() => byWsjf(features), [features]);
  const manualOrder = useMemo(() => byManual(features), [features]);
  const wsjfRanks = useMemo(() => wsjfRankMap(features), [features]);
  const canMove = (f: Item) => !!user.team_name && f.leading_team === user.team_name;

  const onDragEnd = async (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const afterId = computeAfterId(manualOrder, Number(active.id), Number(over.id));
    await reorderFeatureRanking(Number(active.id), afterId);
    await onChanged();
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap gap-2 border-b border-gray-200 bg-surface px-6 py-3">
        <FilterSelect label="Interval" value={pi} options={planningIntervals} onChange={setPi} />
        <FilterSelect label="Team" value={team} options={teams} onChange={setTeam} />
        <FilterSelect label="Container" value={container} options={[...new Set(containers.map((c) => c.name))]} onChange={setContainer} />
        <FilterSelect label="Department" value={department} options={departmentNames} onChange={setDepartment} />
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-6 overflow-auto p-6 lg:grid-cols-2">
        <section>
          <h2 className="mb-2 text-sm font-semibold text-gray-700">WSJF ranking</h2>
          <div data-testid="wsjf-list" className="space-y-1">
            {wsjfOrder.map((f, i) => (
              <div
                key={f.id}
                data-testid="wsjf-row"
                data-feature-id={f.id}
                data-highlighted={hoveredId === f.id}
                onMouseEnter={() => setHoveredId(f.id)}
                onMouseLeave={() => setHoveredId(null)}
                className={`flex items-center gap-3 rounded-md border px-3 py-2 text-sm transition ${
                  hoveredId === f.id ? "border-blue-400 bg-blue-100 ring-1 ring-blue-300" : "border-gray-200 bg-surface"
                }`}
              >
                <span className="w-6 text-right tabular-nums text-gray-400">{i + 1}</span>
                <span className="tabular-nums text-xs text-gray-400">#{f.id}</span>
                <span data-testid="rank-title" className="flex-1 truncate text-gray-900">{f.title}</span>
                <span className="tabular-nums text-gray-500">{f.wsjf_score ?? "—"}</span>
                <span className="text-xs text-gray-500">{f.leading_team ?? "—"}</span>
                <InfoButton onOpen={() => onOpenCard?.(f.id)} />
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
                  <ManualRow key={f.id} feature={f} index={i} canMove={canMove(f)} wsjfRank={wsjfRanks.get(f.id) ?? i + 1} highlighted={hoveredId === f.id} onHover={setHoveredId} onOpen={() => onOpenCard?.(f.id)} />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        </section>
      </div>
    </div>
  );
}
