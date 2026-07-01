# Timeline View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Timeline nav tab that shows a PI's features and stories on iteration columns, as feature swimlanes or a selected item's transitive dependency chain, reusing the existing cards + dependency badges + hover-highlight.

**Architecture:** Frontend-only. Pure helpers in `lib/timeline.ts` shape the existing `items`/`links` into feature lanes or a flat dependency layout; a `TimelineView` renders iteration columns of `StoryPlanCard`s (and `FeatureCard` lane headers) inside a dnd-kit context, reusing `computePlanningLinks` for per-card info and the shared highlight/dim mechanism.

**Tech Stack:** React + TypeScript, dnd-kit, Vitest + Testing Library, Tailwind.

## Global Constraints

- Single PI only; other-PI / feature / unplanned dependency items appear in the **Backlog** column. No cross-PI axis.
- Dependencies are conveyed with badges + hover-highlight (reuse `StoryPlanCard`, `computePlanningLinks`); **no drawn connector lines**.
- Iteration slots are `ITERATION_SLOTS = [1,2,3,4,5,6]` with `iterationLabel` (`6` → `"IP"`); Backlog = `iteration null`. Only **stories** carry an iteration; features are non-draggable lane headers.
- Reuse, don't duplicate: `StoryPlanCard`, `computePlanningLinks(items, links, pi)`, `iterationLabel`, `ITERATION_SLOTS`. Extract shared badge JSX into `CardLinkBadges`.
- No backend / schema / API changes.
- Dependencies mode: a card click **selects** (does not open the drawer). Build **feature mode first, then dependencies mode**.
- Drag mirrors Planning: `updateItem(id, { iteration })` then `reload()`.
- Frontend tests: `cd frontend && npx vitest run <file>`; type-check `cd frontend && npx tsc --noEmit`. Both must be clean before each commit.

---

### Task 1: `lib/timeline.ts` data helpers

**Files:**
- Create: `frontend/src/lib/timeline.ts`
- Test: `frontend/src/lib/timeline.test.ts`

**Interfaces:**
- Consumes: `ITERATION_SLOTS`, `IterationSlot` from `./iterations`; `Item`, `LinkRow` from `../types`.
- Produces:
  - `interface FeatureLane { feature: Item | null; backlog: Item[]; slots: Record<IterationSlot, Item[]> }`
  - `groupByFeature(items: Item[], pi: string, opts: { showAll: boolean }): FeatureLane[]`
  - `layoutFlat(items: Item[], pi: string): { backlog: Item[]; slots: Record<IterationSlot, Item[]> }`
  - `dependencyComponent(items: Item[], links: LinkRow[], selectedIds: Iterable<number>): Set<number>`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/lib/timeline.test.ts`:

```ts
import { expect, it } from "vitest";
import type { Item, LinkRow } from "../types";
import { dependencyComponent, groupByFeature, layoutFlat } from "./timeline";

const feature = (id: number, over: Partial<Item> = {}): Item =>
  ({ id, kind: "feature", title: `F${id}`, position: id, planning_interval: "PI1-Q3", parent_id: null, ...over }) as unknown as Item;
const story = (id: number, parent_id: number | null, iteration: number | null, pi = "PI1-Q3"): Item =>
  ({ id, kind: "story", title: `S${id}`, parent_id, iteration, planning_interval: pi }) as unknown as Item;

it("groupByFeature buckets a feature's PI stories into backlog vs slots", () => {
  const items = [feature(1), story(10, 1, null), story(11, 1, 2), story(12, 1, 2)];
  const lanes = groupByFeature(items, "PI1-Q3", { showAll: true });
  expect(lanes).toHaveLength(1);
  expect(lanes[0].feature!.id).toBe(1);
  expect(lanes[0].backlog.map((s) => s.id)).toEqual([10]);
  expect(lanes[0].slots[2].map((s) => s.id)).toEqual([11, 12]);
});

it("groupByFeature puts parentless stories in the orphan (null) lane, last", () => {
  const items = [feature(1), story(11, 1, 1), story(99, null, 3)];
  const lanes = groupByFeature(items, "PI1-Q3", { showAll: true });
  expect(lanes[lanes.length - 1].feature).toBeNull();
  expect(lanes[lanes.length - 1].slots[3].map((s) => s.id)).toEqual([99]);
});

it("groupByFeature showAll:false hides backlog-only/empty lanes; showAll:true keeps an empty in-PI feature", () => {
  const items = [feature(1), feature(2), story(10, 1, null)]; // F1 only backlog, F2 no stories
  expect(groupByFeature(items, "PI1-Q3", { showAll: false })).toHaveLength(0);
  const all = groupByFeature(items, "PI1-Q3", { showAll: true });
  expect(all.map((l) => l.feature!.id).sort()).toEqual([1, 2]);
});

it("groupByFeature ignores other PIs", () => {
  const items = [feature(1), story(11, 1, 2, "PI2-Q4")];
  expect(groupByFeature(items, "PI1-Q3", { showAll: false })).toHaveLength(0);
});

it("layoutFlat places PI stories by iteration and everything else in backlog", () => {
  const items = [feature(1), story(11, 1, 2), story(12, 1, null), story(13, 1, 4, "PI2-Q4")];
  const out = layoutFlat(items, "PI1-Q3");
  expect(out.slots[2].map((s) => s.id)).toEqual([11]);
  expect(out.backlog.map((s) => s.id).sort()).toEqual([1, 12, 13]); // feature, unplanned, other-PI
});

it("dependencyComponent returns the transitive closure over both directions/relations", () => {
  const links: LinkRow[] = [
    { id: 1, source_id: 1, target_id: 2, relation: "blocks" },
    { id: 2, source_id: 2, target_id: 3, relation: "relates_to" },
    { id: 3, source_id: 8, target_id: 9, relation: "blocks" }, // unrelated
  ];
  const comp = dependencyComponent([], links, [3]);
  expect([...comp].sort()).toEqual([1, 2, 3]);
  expect(comp.has(8)).toBe(false);
  expect([...dependencyComponent([], links, [])]).toEqual([]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/lib/timeline.test.ts`
Expected: FAIL — cannot resolve `./timeline`.

- [ ] **Step 3: Write the implementation**

Create `frontend/src/lib/timeline.ts`:

```ts
import type { Item, LinkRow } from "../types";
import { ITERATION_SLOTS, type IterationSlot } from "./iterations";

export interface FeatureLane {
  feature: Item | null; // null = the "No feature" orphan lane
  backlog: Item[];
  slots: Record<IterationSlot, Item[]>;
}

const emptySlots = (): Record<IterationSlot, Item[]> => ({ 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] });

function placeStory(bucket: { backlog: Item[]; slots: Record<IterationSlot, Item[]> }, story: Item): void {
  const n = story.iteration;
  if (n != null && n >= 1 && n <= 6) bucket.slots[n as IterationSlot].push(story);
  else bucket.backlog.push(story);
}

export function groupByFeature(items: Item[], pi: string, opts: { showAll: boolean }): FeatureLane[] {
  const featureById = new Map<number, Item>();
  for (const it of items) if (it.kind === "feature") featureById.set(it.id, it);

  const laneByKey = new Map<number | null, FeatureLane>();
  const ensureLane = (key: number | null, feature: Item | null): FeatureLane => {
    let lane = laneByKey.get(key);
    if (!lane) laneByKey.set(key, (lane = { feature, backlog: [], slots: emptySlots() }));
    return lane;
  };

  for (const it of items) {
    if (it.kind !== "story" || it.planning_interval !== pi) continue;
    const parent = it.parent_id != null ? featureById.get(it.parent_id) : undefined;
    placeStory(ensureLane(parent ? parent.id : null, parent ?? null), it);
  }

  if (opts.showAll) {
    for (const f of featureById.values()) {
      if (f.planning_interval === pi && !laneByKey.has(f.id)) ensureLane(f.id, f);
    }
  }

  const hasSlotStory = (lane: FeatureLane) => ITERATION_SLOTS.some((s) => lane.slots[s].length > 0);
  let lanes = [...laneByKey.values()];
  if (!opts.showAll) lanes = lanes.filter(hasSlotStory);

  lanes.sort((a, b) => {
    if (!a.feature) return 1;
    if (!b.feature) return -1;
    return a.feature.position - b.feature.position || a.feature.title.localeCompare(b.feature.title);
  });
  return lanes;
}

export function layoutFlat(items: Item[], pi: string): { backlog: Item[]; slots: Record<IterationSlot, Item[]> } {
  const out = { backlog: [] as Item[], slots: emptySlots() };
  for (const it of items) {
    if (it.kind === "story" && it.planning_interval === pi) placeStory(out, it);
    else out.backlog.push(it);
  }
  return out;
}

export function dependencyComponent(items: Item[], links: LinkRow[], selectedIds: Iterable<number>): Set<number> {
  const adj = new Map<number, number[]>();
  const add = (a: number, b: number) => {
    const arr = adj.get(a);
    if (arr) arr.push(b);
    else adj.set(a, [b]);
  };
  for (const link of links) {
    if (link.relation !== "blocks" && link.relation !== "relates_to") continue;
    add(link.source_id, link.target_id);
    add(link.target_id, link.source_id);
  }
  const seen = new Set<number>();
  const queue: number[] = [];
  for (const id of selectedIds) {
    if (!seen.has(id)) {
      seen.add(id);
      queue.push(id);
    }
  }
  while (queue.length) {
    const cur = queue.shift()!;
    for (const nb of adj.get(cur) ?? []) {
      if (!seen.has(nb)) {
        seen.add(nb);
        queue.push(nb);
      }
    }
  }
  return seen;
}
```

- [ ] **Step 4: Run test + type-check to verify they pass**

Run: `cd frontend && npx vitest run src/lib/timeline.test.ts && npx tsc --noEmit`
Expected: PASS (6 tests) and clean type-check.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/timeline.ts frontend/src/lib/timeline.test.ts
git commit -m "feat(frontend): timeline data helpers (groupByFeature, layoutFlat, dependencyComponent)"
```

---

### Task 2: Shared `CardLinkBadges`, `StoryPlanCard.selected`, and `FeatureCard`

**Files:**
- Create: `frontend/src/components/CardLinkBadges.tsx`
- Create: `frontend/src/components/FeatureCard.tsx`
- Modify: `frontend/src/components/StoryPlanCard.tsx` (use `CardLinkBadges`; add `selected` prop)
- Test: `frontend/src/components/FeatureCard.test.tsx`; extend `frontend/src/components/StoryPlanCard.test.tsx`

**Interfaces:**
- Consumes: `CardLinkInfo` from `../lib/planningLinks`.
- Produces:
  - `CardLinkBadges({ info }: { info?: CardLinkInfo })` — the ⛔/blocks/related badge spans.
  - `StoryPlanCard` accepts `selected?: boolean` (blue ring, takes precedence over conflict ring).
  - `FeatureCard({ feature, info, dimmed, selected, onHighlight, onOpen })` — non-draggable lane-header card.

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/components/FeatureCard.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import type { Item } from "../types";
import FeatureCard from "./FeatureCard";

const feature = { id: 3, kind: "feature", type: "Feature", title: "Auth" } as unknown as Item;

it("shows the feature title, id, and dependency badges, and opens on click", async () => {
  const onOpen = vi.fn();
  render(
    <FeatureCard
      feature={feature}
      info={{ blocks_count: 2, blocked_by_count: 0, related_count: 0, conflicts: [], conflictPartners: [], linkPartners: [7] }}
      onOpen={onOpen}
    />,
  );
  expect(screen.getByText("Auth")).toBeInTheDocument();
  expect(screen.getByText("#3")).toBeInTheDocument();
  expect(screen.getByText(/blocks 2/i)).toBeInTheDocument();
  await userEvent.click(screen.getByText("Auth"));
  expect(onOpen).toHaveBeenCalledWith(3);
});
```

Extend `frontend/src/components/StoryPlanCard.test.tsx` (append):

```tsx
it("shows a blue ring when selected", () => {
  const { container } = render(
    <DndContext>
      <StoryPlanCard story={story} selected onOpen={() => {}} />
    </DndContext>,
  );
  expect(container.querySelector(".ring-blue-400")).toBeTruthy();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/components/FeatureCard.test.tsx src/components/StoryPlanCard.test.tsx`
Expected: FAIL — `FeatureCard` missing; no `.ring-blue-400`.

- [ ] **Step 3: Create `CardLinkBadges`**

Create `frontend/src/components/CardLinkBadges.tsx`:

```tsx
import type { CardLinkInfo } from "../lib/planningLinks";

/** The blocked-by / blocks / related count badges, shared by story and feature cards. */
export default function CardLinkBadges({ info }: { info?: CardLinkInfo }) {
  return (
    <>
      {(info?.blocked_by_count ?? 0) > 0 && (
        <span className="font-medium text-red-600">⛔ blocked by {info!.blocked_by_count}</span>
      )}
      {(info?.blocks_count ?? 0) > 0 && <span>blocks {info!.blocks_count}</span>}
      {(info?.related_count ?? 0) > 0 && <span className="text-gray-500">related {info!.related_count}</span>}
    </>
  );
}
```

- [ ] **Step 4: Refactor `StoryPlanCard` to use `CardLinkBadges` + add `selected`**

In `frontend/src/components/StoryPlanCard.tsx`:

Add the import:

```tsx
import CardLinkBadges from "./CardLinkBadges";
```

Add `selected` to the props destructure and type (beside `dimmed`):

```tsx
  dimmed = false,
  selected = false,
  onHighlight,
```

```tsx
  dimmed?: boolean;
  selected?: boolean;
  onHighlight?: (ids: number[] | null) => void;
```

Change the `ring` computation so selection wins:

```tsx
  const ring = selected
    ? "border-blue-400 ring-2 ring-blue-400"
    : conflicts.length === 0
      ? "border-gray-200"
      : hasError
        ? "border-red-300 ring-2 ring-red-400"
        : "border-amber-300 ring-2 ring-amber-400";
```

Replace the three inline badge spans (the `blocked_by_count` / `blocks_count` / `related_count` block inside the chip row) with:

```tsx
          <CardLinkBadges info={info} />
```

- [ ] **Step 5: Create `FeatureCard`**

Create `frontend/src/components/FeatureCard.tsx`:

```tsx
import type { CardLinkInfo } from "../lib/planningLinks";
import type { Item } from "../types";
import CardLinkBadges from "./CardLinkBadges";

export default function FeatureCard({
  feature,
  info,
  dimmed = false,
  selected = false,
  onHighlight,
  onOpen,
}: {
  feature: Item;
  info?: CardLinkInfo;
  dimmed?: boolean;
  selected?: boolean;
  onHighlight?: (ids: number[] | null) => void;
  onOpen: (id: number) => void;
}) {
  const hasLinks =
    (info?.blocks_count ?? 0) + (info?.blocked_by_count ?? 0) + (info?.related_count ?? 0) > 0;
  const ring = selected ? "border-blue-400 ring-2 ring-blue-400" : "border-gray-300";

  return (
    <button
      onClick={() => onOpen(feature.id)}
      className={`w-full rounded-lg border bg-white p-3 text-left shadow-sm transition-opacity hover:shadow ${ring} ${dimmed ? "opacity-30" : ""}`}
    >
      <div className="mb-1 flex items-center gap-1.5">
        <span className="rounded bg-blue-100 px-1.5 py-0.5 text-xs text-blue-800">
          {feature.type ?? feature.kind}
        </span>
        <span className="text-xs text-gray-400">#{feature.id}</span>
      </div>
      <div className="flex items-start justify-between gap-2">
        <div className="font-semibold text-gray-900">{feature.title}</div>
        {hasLinks && (
          <span
            role="img"
            aria-label="dependencies"
            title="Highlight all dependencies"
            onMouseEnter={() => onHighlight?.([feature.id, ...(info?.linkPartners ?? [])])}
            onMouseLeave={() => onHighlight?.(null)}
            className="shrink-0 cursor-help text-gray-400"
          >
            🔗
          </span>
        )}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-500">
        <CardLinkBadges info={info} />
      </div>
    </button>
  );
}
```

- [ ] **Step 6: Run tests + type-check**

Run: `cd frontend && npx vitest run src/components/FeatureCard.test.tsx src/components/StoryPlanCard.test.tsx && npx tsc --noEmit`
Expected: PASS (FeatureCard + all StoryPlanCard tests, incl. the new blue-ring test) and clean type-check.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/CardLinkBadges.tsx frontend/src/components/FeatureCard.tsx frontend/src/components/StoryPlanCard.tsx frontend/src/components/FeatureCard.test.tsx frontend/src/components/StoryPlanCard.test.tsx
git commit -m "feat(frontend): CardLinkBadges + FeatureCard + StoryPlanCard selected ring"
```

---

### Task 3: `TimelineCell` + `TimelineLane`

**Files:**
- Create: `frontend/src/components/TimelineCell.tsx`
- Create: `frontend/src/components/TimelineLane.tsx`
- Test: `frontend/src/components/TimelineLane.test.tsx`

**Interfaces:**
- Consumes: `StoryPlanCard`, `FeatureCard`, `CardLinkInfo`, `FeatureLane`, `iterationLabel`, `ITERATION_SLOTS`, `IterationSlot`.
- Produces:
  - `type SlotKey = "backlog" | IterationSlot`
  - `TimelineColumn = { slot: SlotKey; label: string }`
  - `TimelineCell({ laneKey, slot, stories, cardInfo, highlight, selectedIds, onHighlight, onOpen })` — droppable id `` `${laneKey}::${slot}` ``.
  - `TimelineLane({ lane, columns, cardInfo, highlight, selectedIds, onHighlight, onOpenCard, onOpenFeature })`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/TimelineLane.test.tsx`:

```tsx
import { DndContext } from "@dnd-kit/core";
import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import type { FeatureLane } from "../lib/timeline";
import type { Item } from "../types";
import TimelineLane, { type TimelineColumn } from "./TimelineLane";

const feature = { id: 1, kind: "feature", type: "Feature", title: "Auth" } as unknown as Item;
const story = (id: number, iteration: number) =>
  ({ id, kind: "story", title: `S${id}`, iteration, parent_id: 1 }) as unknown as Item;

const columns: TimelineColumn[] = [
  { slot: "backlog", label: "Backlog" },
  { slot: 1, label: "Iteration 1" },
  { slot: 2, label: "Iteration 2" },
];

it("renders the feature header and places stories in their iteration cells", () => {
  const lane: FeatureLane = {
    feature,
    backlog: [],
    slots: { 1: [story(11, 1)], 2: [story(12, 2)], 3: [], 4: [], 5: [], 6: [] },
  };
  render(
    <DndContext>
      <TimelineLane
        lane={lane}
        columns={columns}
        cardInfo={new Map()}
        onOpenCard={() => {}}
        onOpenFeature={() => {}}
      />
    </DndContext>,
  );
  expect(screen.getByText("Auth")).toBeInTheDocument();
  expect(screen.getByText("S11")).toBeInTheDocument();
  expect(screen.getByText("S12")).toBeInTheDocument();
});

it("renders a 'No feature' header for the orphan lane", () => {
  const lane: FeatureLane = { feature: null, backlog: [], slots: { 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] } };
  render(
    <DndContext>
      <TimelineLane lane={lane} columns={columns} cardInfo={new Map()} onOpenCard={() => {}} onOpenFeature={() => {}} />
    </DndContext>,
  );
  expect(screen.getByText(/no feature/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/components/TimelineLane.test.tsx`
Expected: FAIL — modules missing.

- [ ] **Step 3: Create `TimelineCell`**

Create `frontend/src/components/TimelineCell.tsx`:

```tsx
import { useDroppable } from "@dnd-kit/core";
import type { CardLinkInfo } from "../lib/planningLinks";
import type { Item } from "../types";
import StoryPlanCard from "./StoryPlanCard";

export type SlotKey = "backlog" | 1 | 2 | 3 | 4 | 5 | 6;

export default function TimelineCell({
  laneKey,
  slot,
  stories,
  cardInfo,
  highlight,
  selectedIds,
  onHighlight,
  onOpen,
}: {
  laneKey: string;
  slot: SlotKey;
  stories: Item[];
  cardInfo: Map<number, CardLinkInfo>;
  highlight?: Set<number> | null;
  selectedIds?: Set<number>;
  onHighlight?: (ids: number[] | null) => void;
  onOpen: (id: number) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `${laneKey}::${slot}` });
  return (
    <div
      ref={setNodeRef}
      className={`flex w-64 shrink-0 flex-col gap-2 rounded-lg p-2 ${isOver ? "bg-blue-50 ring-2 ring-blue-300" : ""}`}
    >
      {stories.map((s) => (
        <StoryPlanCard
          key={s.id}
          story={s}
          info={cardInfo.get(s.id)}
          dimmed={highlight != null && !highlight.has(s.id)}
          selected={selectedIds?.has(s.id) ?? false}
          onHighlight={onHighlight}
          onOpen={onOpen}
        />
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Create `TimelineLane`**

Create `frontend/src/components/TimelineLane.tsx`:

```tsx
import type { CardLinkInfo } from "../lib/planningLinks";
import type { FeatureLane } from "../lib/timeline";
import FeatureCard from "./FeatureCard";
import TimelineCell, { type SlotKey } from "./TimelineCell";

export interface TimelineColumn {
  slot: SlotKey;
  label: string;
}

export default function TimelineLane({
  lane,
  columns,
  cardInfo,
  highlight,
  selectedIds,
  onHighlight,
  onOpenCard,
  onOpenFeature,
}: {
  lane: FeatureLane;
  columns: TimelineColumn[];
  cardInfo: Map<number, CardLinkInfo>;
  highlight?: Set<number> | null;
  selectedIds?: Set<number>;
  onHighlight?: (ids: number[] | null) => void;
  onOpenCard: (id: number) => void;
  onOpenFeature: (id: number) => void;
}) {
  const laneKey = lane.feature ? String(lane.feature.id) : "orphan";
  const storiesFor = (slot: SlotKey) => (slot === "backlog" ? lane.backlog : lane.slots[slot]);

  return (
    <div className="flex items-start gap-2 border-b py-2">
      <div className="sticky left-0 z-10 w-64 shrink-0 bg-gray-50 p-2">
        {lane.feature ? (
          <FeatureCard
            feature={lane.feature}
            info={cardInfo.get(lane.feature.id)}
            dimmed={highlight != null && !highlight.has(lane.feature.id)}
            selected={selectedIds?.has(lane.feature.id) ?? false}
            onHighlight={onHighlight}
            onOpen={onOpenFeature}
          />
        ) : (
          <div className="rounded-lg border border-dashed border-gray-300 p-3 text-sm font-medium text-gray-400">
            No feature
          </div>
        )}
      </div>
      {columns.map((col) => (
        <TimelineCell
          key={String(col.slot)}
          laneKey={laneKey}
          slot={col.slot}
          stories={storiesFor(col.slot)}
          cardInfo={cardInfo}
          highlight={highlight}
          selectedIds={selectedIds}
          onHighlight={onHighlight}
          onOpen={onOpenCard}
        />
      ))}
    </div>
  );
}
```

- [ ] **Step 5: Run test + type-check**

Run: `cd frontend && npx vitest run src/components/TimelineLane.test.tsx && npx tsc --noEmit`
Expected: PASS (2 tests) and clean type-check.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/TimelineCell.tsx frontend/src/components/TimelineLane.tsx frontend/src/components/TimelineLane.test.tsx
git commit -m "feat(frontend): TimelineCell + TimelineLane (droppable iteration cells + feature header)"
```

---

### Task 4: `TimelineView` — feature mode

**Files:**
- Create: `frontend/src/components/TimelineView.tsx`
- Test: `frontend/src/components/TimelineView.test.tsx`

**Interfaces:**
- Consumes: `groupByFeature` (Task 1), `TimelineLane`/`TimelineColumn` (Task 3), `computePlanningLinks`, `ITERATION_SLOTS`, `iterationLabel`, `updateItem`, `SlotKey`.
- Produces:
  - default export `TimelineView({ items, links, planningIntervals, onOpenCard, onChanged })`.
  - `handleTimelineDragEnd(event: DragEndEvent, reload: () => void | Promise<void>): Promise<void>`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/TimelineView.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import * as client from "../api/client";
import type { Item } from "../types";
import TimelineView, { handleTimelineDragEnd } from "./TimelineView";

afterEach(() => vi.restoreAllMocks());

const feature = (id: number, over: Partial<Item> = {}): Item =>
  ({ id, kind: "feature", type: "Feature", title: `F${id}`, position: id, planning_interval: "PI1-Q3", parent_id: null, ...over }) as unknown as Item;
const story = (id: number, parent_id: number, iteration: number | null): Item =>
  ({ id, kind: "story", title: `S${id}`, parent_id, iteration, planning_interval: "PI1-Q3" }) as unknown as Item;

it("renders feature lanes with stories in their iteration cells", () => {
  const items = [feature(1), story(11, 1, 1), story(12, 1, null)];
  render(<TimelineView items={items} links={[]} planningIntervals={["PI1-Q3"]} onOpenCard={() => {}} onChanged={() => {}} />);
  expect(screen.getByText("F1")).toBeInTheDocument();
  expect(screen.getByText("S11")).toBeInTheDocument();
  expect(screen.getByText("S12")).toBeInTheDocument(); // backlog visible by default (Show all)
});

it("the Only planned toggle hides the backlog story", async () => {
  const items = [feature(1), story(11, 1, 1), story(12, 1, null)];
  render(<TimelineView items={items} links={[]} planningIntervals={["PI1-Q3"]} onOpenCard={() => {}} onChanged={() => {}} />);
  await userEvent.click(screen.getByRole("button", { name: /only planned/i }));
  expect(screen.getByText("S11")).toBeInTheDocument();
  expect(screen.queryByText("S12")).not.toBeInTheDocument();
});

it("handleTimelineDragEnd updates iteration from the drop target slot", async () => {
  const update = vi.spyOn(client, "updateItem").mockResolvedValue({} as never);
  const reload = vi.fn().mockResolvedValue(undefined);
  await handleTimelineDragEnd({ active: { id: 11 }, over: { id: "1::3" } } as never, reload);
  expect(update).toHaveBeenCalledWith(11, { iteration: 3 });
  await handleTimelineDragEnd({ active: { id: 11 }, over: { id: "1::backlog" } } as never, reload);
  expect(update).toHaveBeenLastCalledWith(11, { iteration: null });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/components/TimelineView.test.tsx`
Expected: FAIL — module missing.

- [ ] **Step 3: Write `TimelineView` (feature mode)**

Create `frontend/src/components/TimelineView.tsx`:

```tsx
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
```

- [ ] **Step 4: Run test + type-check**

Run: `cd frontend && npx vitest run src/components/TimelineView.test.tsx && npx tsc --noEmit`
Expected: PASS (3 tests) and clean type-check.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/TimelineView.tsx frontend/src/components/TimelineView.test.tsx
git commit -m "feat(frontend): TimelineView feature mode (swimlanes, Show all toggle, drag)"
```

---

### Task 5: `TimelineView` — dependencies mode

**Files:**
- Modify: `frontend/src/components/TimelineView.tsx`
- Test: extend `frontend/src/components/TimelineView.test.tsx`

**Interfaces:**
- Consumes: `dependencyComponent`, `layoutFlat` (Task 1); existing `TimelineLane` (rendered with a synthetic `FeatureLane` whose `feature` is `null`).
- Produces: a `mode` toggle (`feature`/`deps`), selection state, and a `Clear` button; card clicks in deps mode toggle selection.

- [ ] **Step 1: Write the failing test**

Append to `frontend/src/components/TimelineView.test.tsx`:

```tsx
it("dependencies mode narrows to the selected item's transitive component", async () => {
  const items = [feature(1), story(11, 1, 1), story(12, 1, 2), story(13, 1, 3)];
  const links = [
    { id: 1, source_id: 11, target_id: 12, relation: "blocks" as const },
    // 13 is unrelated
  ];
  render(<TimelineView items={items} links={links} planningIntervals={["PI1-Q3"]} onOpenCard={() => {}} onChanged={() => {}} />);
  await userEvent.click(screen.getByRole("button", { name: /dependencies/i }));
  // empty selection -> all PI stories shown
  expect(screen.getByText("S13")).toBeInTheDocument();
  // select S11 -> component is {11,12}; S13 drops out
  await userEvent.click(screen.getByText("S11"));
  expect(screen.getByText("S11")).toBeInTheDocument();
  expect(screen.getByText("S12")).toBeInTheDocument();
  expect(screen.queryByText("S13")).not.toBeInTheDocument();
  // clear resets
  await userEvent.click(screen.getByRole("button", { name: /clear/i }));
  expect(screen.getByText("S13")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/components/TimelineView.test.tsx`
Expected: FAIL — no `dependencies` toggle / selection behavior.

- [ ] **Step 3: Add dependencies mode to `TimelineView`**

In `frontend/src/components/TimelineView.tsx`:

Add imports:

```tsx
import { dependencyComponent, groupByFeature, layoutFlat, type FeatureLane } from "../lib/timeline";
```
(Replace the existing `groupByFeature` import line with this combined one.)

Add state (beside `showAll`):

```tsx
  const [mode, setMode] = useState<"feature" | "deps">("feature");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const toggleSelect = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
```

Compute the dependencies-mode lane (a single orphan-style lane from `layoutFlat`):

```tsx
  const depsLane: FeatureLane = useMemo(() => {
    const base = pi
      ? selected.size
        ? items.filter((it) => dependencyComponent(items, links, selected).has(it.id))
        : items.filter((it) => it.kind === "story" && it.planning_interval === pi)
      : [];
    const flat = layoutFlat(base, pi ?? "");
    return { feature: null, backlog: flat.backlog, slots: flat.slots };
  }, [items, links, pi, selected]);
```

In deps mode always include the Backlog column. Change the `columns` derivation:

```tsx
  const columns: TimelineColumn[] = [
    ...(showAll || mode === "deps" ? [{ slot: "backlog" as const, label: "Backlog" }] : []),
    ...ITERATION_SLOTS.map((s) => ({ slot: s, label: iterationLabel(s) })),
  ];
```

Add a **Mode** button pair + Clear to the control bar. Insert this right after the
PI-pill `.map(...)` block (before the `Lanes` span):

```tsx
        <span className="ml-4 text-[11px] font-semibold uppercase tracking-wide text-gray-400">Mode</span>
        <button onClick={() => setMode("feature")} className={pill(mode === "feature")}>By feature</button>
        <button onClick={() => setMode("deps")} className={pill(mode === "deps")}>Dependencies</button>
        {mode === "deps" && selected.size > 0 && (
          <button onClick={() => setSelected(new Set())} className={pill(false)}>Clear ({selected.size})</button>
        )}
```

Then hide the Lanes (Show all / Only planned) controls outside feature mode — wrap
the `Lanes` span and its two buttons from Task 4 in a `mode === "feature"` guard:

```tsx
        {mode === "feature" && (
          <>
            <span className="ml-4 text-[11px] font-semibold uppercase tracking-wide text-gray-400">Lanes</span>
            <button onClick={() => setShowAll(true)} className={pill(showAll)}>Show all</button>
            <button onClick={() => setShowAll(false)} className={pill(!showAll)}>Only planned</button>
          </>
        )}
```

Replace the lanes rendering block so it switches on mode:

```tsx
          <div className="flex flex-col">
            {(mode === "feature" ? lanes : [depsLane]).map((lane) => (
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
            ))}
          </div>
```

- [ ] **Step 4: Run test + type-check + full suite**

Run: `cd frontend && npx vitest run src/components/TimelineView.test.tsx && npx vitest run && npx tsc --noEmit`
Expected: the new deps test + all prior tests PASS; clean type-check.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/TimelineView.tsx frontend/src/components/TimelineView.test.tsx
git commit -m "feat(frontend): TimelineView dependencies mode (select + transitive component)"
```

---

### Task 6: Wire the Timeline tab into the app + verify

**Files:**
- Modify: `frontend/src/App.tsx`

**Interfaces:**
- Consumes: `TimelineView` default export; existing `items`, `links`, `planningIntervals`, `openItem`, `handleChanged` in `App`.

- [ ] **Step 1: Add the import + view type + nav button + render branch**

In `frontend/src/App.tsx`:

Add the import (beside the other component imports):

```tsx
import TimelineView from "./components/TimelineView";
```

Extend the `View` union:

```tsx
type View = "board" | "admin" | "planning" | "timeline";
```

Add the nav button after the Planning button:

```tsx
            {navButton("planning", "Planning")}
            {navButton("timeline", "Timeline")}
            {navButton("admin", "Admin")}
```

Add a render branch beside the Planning one (before the board fallbacks):

```tsx
      ) : view === "timeline" ? (
        <TimelineView
          items={items}
          links={links}
          planningIntervals={planningIntervals}
          onOpenCard={openItem}
          onChanged={handleChanged}
        />
```
Place it in the existing ternary chain: after the `view === "planning" ? (...)` block and before `loading && !activeBoard ? (...)`.

- [ ] **Step 2: Full suite + type-check**

Run: `cd frontend && npx vitest run && npx tsc --noEmit`
Expected: all tests PASS, clean type-check.

- [ ] **Step 3: Rebuild the frontend and smoke-test**

Run: `docker compose up -d --build frontend` (from repo root)
Expected: `frontend` container up.

Then in the app (http://localhost:8080) click the **Timeline** tab, pick a PI, confirm: feature swimlanes render with stories in iteration columns; **Only planned** hides the Backlog column and empty lanes; dragging a story between cells re-plans it (badge/position updates after reload); the **Dependencies** toggle lets you click-select a card and narrows to its chain; hovering 🔗/⚠ highlights partners and dims the rest.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/App.tsx
git commit -m "feat(frontend): add Timeline nav tab"
```

---

## Self-Review Notes

- **Spec coverage:** new Timeline tab (T6); single-PI iteration columns + PI pills (T4); feature swimlanes with sticky feature header + stories in cells (T3/T4); Show all / Only planned toggle (T4); backlog + orphan "No feature" lane (T1/T3); drag to re-plan (T4); Dependencies mode with click-select + transitive component + Clear + flat layout (T1/T5); badges + hover-highlight + selected ring reuse (T2/T3); `computePlanningLinks` reuse (T4); no backend changes.
- **Reuse/DRY:** `CardLinkBadges` de-duplicates the badge JSX for story + feature cards (T2); conflict/highlight logic stays in `StoryPlanCard`; drag mirrors Planning's handler.
- **Deviations from spec (deliberate):** `FeatureCard` shows only the 🔗 marker (features never receive ⚠ conflicts — `computePlanningLinks` only attaches conflicts to planned stories, so a feature/unscheduled blocker never gets one). Dependencies mode reuses `TimelineLane` with a synthetic `feature: null` lane rather than a separate component.
- **Scope guards honored:** single PI, no connector lines, features non-draggable, no backend, no team/assignee filters, deps-mode click selects (no drawer).
