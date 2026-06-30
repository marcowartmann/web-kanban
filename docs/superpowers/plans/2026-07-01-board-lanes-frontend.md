# Configurable Board Lanes — Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the board render from configured per-board lanes: board tabs, client-side grouping into the active board's lanes (+ Unscheduled), card-drag→status, and an "Edit lanes" mode (reorder/add/rename/delete).

**Architecture:** `getBoards()` + `listItems()` feed a reworked `useBoard`. Cards are built with client-side aggregates, filtered to the active board's kinds + the existing filters, then grouped into the board's lanes. Normal mode drags cards between lanes; an Edit-lanes mode uses `@dnd-kit/sortable` for lane reorder plus inline add/rename/delete. The old `/api/board` path is removed.

**Tech Stack:** React 18, Vite, TS strict, Tailwind, `@dnd-kit/core` (+ `@dnd-kit/sortable`), Vitest.

## Global Constraints

- All backend calls go through `src/api/client.ts`; TS `strict: true`.
- The backend plan (`2026-07-01-board-lanes-backend.md`) is implemented: `GET /api/boards`, `POST /api/boards/{id}/lanes`, `PATCH /api/lanes/{id}`, `DELETE /api/lanes/{id}`, `PUT /api/boards/{id}/lanes/order`. The old `GET /api/board` is gone.
- A board's `kinds` is `("feature"|"story"|"risk")[]`. `Unscheduled` is the virtual trailing lane (column `status === "Unscheduled"`); dropping a card there sets `status: ""`.
- The Kind filter is kept but scoped to the active board's kinds (a checkbox per board kind, default all on).
- The per-feature story modal keeps `groupByStatus` (unchanged).

---

### Task 1: Types + client functions for boards/lanes

**Files:**
- Modify: `frontend/src/types.ts`
- Modify: `frontend/src/api/client.ts`
- Modify: `frontend/src/api/client.test.ts`

**Interfaces:**
- Produces: types `Lane`, `Board`; client `getBoards`, `addLane`, `renameLane`, `deleteLane`, `reorderLanes`. (`getBoard` is kept for now; removed in Task 3.)

- [ ] **Step 1: Add types to `frontend/src/types.ts`** (end of file)

```ts
export interface Lane {
  id: number;
  name: string;
  position: number;
}

export interface Board {
  id: number;
  name: string;
  kinds: ItemKind[];
  position: number;
  lanes: Lane[];
}
```

- [ ] **Step 2: Add client functions to `frontend/src/api/client.ts`**

Add `Board, Lane` to the `import type { ... } from "../types";` line, then append:
```ts
export function getBoards(): Promise<Board[]> {
  return request<Board[]>("/api/boards");
}

export function addLane(boardId: number, name: string): Promise<Lane> {
  return request<Lane>(`/api/boards/${boardId}/lanes`, json({ name }));
}

export function renameLane(laneId: number, name: string): Promise<Lane> {
  return request<Lane>(`/api/lanes/${laneId}`, { ...json({ name }), method: "PATCH" });
}

export function deleteLane(laneId: number): Promise<void> {
  return request<void>(`/api/lanes/${laneId}`, { method: "DELETE" });
}

export function reorderLanes(boardId: number, laneIds: number[]): Promise<Lane[]> {
  return request<Lane[]>(`/api/boards/${boardId}/lanes/order`, {
    ...json({ lane_ids: laneIds }),
    method: "PUT",
  });
}
```

- [ ] **Step 3: Add client tests** — append inside the `describe("api client", ...)` block of `frontend/src/api/client.test.ts`

```ts
  it("getBoards fetches /api/boards", async () => {
    const spy = mockFetch(200, [{ id: 1, name: "Main", kinds: ["feature"], position: 0, lanes: [] }]);
    const boards = await getBoards();
    expect(spy).toHaveBeenCalledWith("/api/boards", undefined);
    expect(boards[0].name).toBe("Main");
  });

  it("reorderLanes PUTs lane_ids", async () => {
    const spy = mockFetch(200, []);
    await reorderLanes(7, [3, 1, 2]);
    const [url, init] = spy.mock.calls[0];
    expect(url).toBe("/api/boards/7/lanes/order");
    expect(init?.method).toBe("PUT");
    expect(JSON.parse(init?.body as string)).toEqual({ lane_ids: [3, 1, 2] });
  });
```
Update the import line at the top of the test file to include the new functions:
```ts
import { createItem, createTeamMember, getBoard, getBoards, getTeams, importCsv, reorderLanes, updateItem } from "./client";
```

- [ ] **Step 4: Run the client tests**

Run: `cd frontend && npm run test -- src/api/client.test.ts`
Expected: PASS — existing plus the two new tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/types.ts frontend/src/api/client.ts frontend/src/api/client.test.ts
git commit -m "feat(frontend): types + client for boards and lanes"
```

---

### Task 2: groupIntoLanes + buildBoardCards helpers

**Files:**
- Create: `frontend/src/lib/boardLanes.ts`
- Create: `frontend/src/lib/boardLanes.test.ts`

**Interfaces:**
- Produces: `buildBoardCards(items: Item[]): BoardCard[]` (computes per-feature `children_count`/`children_points`); `groupIntoLanes(cards: BoardCard[], lanes: { name: string }[]): BoardColumn[]` (columns = lanes in order + trailing `Unscheduled`).

- [ ] **Step 1: Write the failing test** — `frontend/src/lib/boardLanes.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { buildBoardCards, groupIntoLanes } from "./boardLanes";
import type { Item } from "../types";

function item(over: Partial<Item> & Pick<Item, "id" | "kind">): Item {
  return {
    id: 0, kind: "feature", type: null, parent_id: null, position: 0, title: "t",
    status: null, description: null, kategorie: null, art: null, sdi_prio: null,
    tshirt_size: null, wsjf_score: null, story_points: null, iteration: null,
    leading_team: null, supporting_team: null, externer_partner: null,
    assignee: null, akzeptanzkriterien: null, dependencies: null,
    bo_stakeholder: null, business_value: null, time_criticality: null,
    risk_reduction: null, cost_of_delay: null, job_size: null,
    definition_of_done: null, ...over,
  };
}

describe("buildBoardCards", () => {
  it("computes feature children_count and children_points", () => {
    const cards = buildBoardCards([
      item({ id: 1, kind: "feature", title: "F" }),
      item({ id: 2, kind: "story", parent_id: 1, story_points: 0.5 }),
      item({ id: 3, kind: "story", parent_id: 1, story_points: 1.5 }),
    ]);
    const feature = cards.find((c) => c.id === 1)!;
    expect(feature.children_count).toBe(2);
    expect(feature.children_points).toBe(2);
  });
});

describe("groupIntoLanes", () => {
  it("places cards by status into lanes (in order) + trailing Unscheduled", () => {
    const cards = buildBoardCards([
      item({ id: 1, kind: "feature", status: "Analyzing" }),
      item({ id: 2, kind: "risk", status: "New" }),
      item({ id: 3, kind: "feature", status: "Bogus" }),
      item({ id: 4, kind: "feature", status: null }),
    ]);
    const cols = groupIntoLanes(cards, [{ name: "Funnel" }, { name: "Analyzing" }, { name: "New" }]);
    expect(cols.map((c) => c.status)).toEqual(["Funnel", "Analyzing", "New", "Unscheduled"]);
    expect(cols[1].cards.map((c) => c.id)).toEqual([1]);
    expect(cols[2].cards.map((c) => c.id)).toEqual([2]);
    // unmatched status ("Bogus") and blank both fall to Unscheduled
    expect(cols[3].cards.map((c) => c.id).sort()).toEqual([3, 4]);
    expect(cols[0].cards).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm run test -- src/lib/boardLanes.test.ts`
Expected: FAIL — cannot resolve `./boardLanes`.

- [ ] **Step 3: Create `frontend/src/lib/boardLanes.ts`**

```ts
import type { BoardCard, BoardColumn, Item } from "../types";

export const UNSCHEDULED = "Unscheduled";

/** Map items to BoardCards, computing per-feature child aggregates client-side. */
export function buildBoardCards(items: Item[]): BoardCard[] {
  const childrenByParent = new Map<number, Item[]>();
  for (const it of items) {
    if (it.parent_id != null) {
      const arr = childrenByParent.get(it.parent_id) ?? [];
      arr.push(it);
      childrenByParent.set(it.parent_id, arr);
    }
  }
  return items.map((it) => {
    const kids = childrenByParent.get(it.id) ?? [];
    return {
      ...it,
      children_count: kids.length,
      children_points: kids.reduce((sum, c) => sum + (c.story_points ?? 0), 0),
    };
  });
}

/** Columns = the given lanes in order, each with cards whose status matches the
 *  lane name, plus a trailing Unscheduled column for unmatched/blank statuses. */
export function groupIntoLanes(
  cards: BoardCard[],
  lanes: { name: string }[],
): BoardColumn[] {
  const buckets = new Map<string, BoardCard[]>();
  for (const lane of lanes) buckets.set(lane.name, []);
  const unscheduled: BoardCard[] = [];
  for (const card of cards) {
    const status = (card.status ?? "").trim();
    const bucket = status ? buckets.get(status) : undefined;
    if (bucket) bucket.push(card);
    else unscheduled.push(card);
  }
  const columns: BoardColumn[] = lanes.map((lane) => ({
    status: lane.name,
    cards: buckets.get(lane.name) ?? [],
  }));
  columns.push({ status: UNSCHEDULED, cards: unscheduled });
  return columns;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm run test -- src/lib/boardLanes.test.ts`
Expected: PASS — all three tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/boardLanes.ts frontend/src/lib/boardLanes.test.ts
git commit -m "feat(frontend): buildBoardCards + groupIntoLanes helpers"
```

---

### Task 3: Lane-driven board — tabs, rework useBoard, normal-mode rendering

**Files:**
- Modify: `frontend/src/hooks/useBoard.ts` (full replace)
- Modify: `frontend/src/api/client.ts` (remove `getBoard`)
- Create: `frontend/src/components/BoardTabs.tsx`
- Create: `frontend/src/components/BoardView.tsx`
- Modify: `frontend/src/components/Toolbar.tsx` (Kind options scoped via prop)
- Modify: `frontend/src/App.tsx` (full replace)
- Delete: `frontend/src/components/Board.tsx`, `frontend/src/components/Board.test.tsx`, `frontend/src/components/Board.dnd.test.tsx`
- Create: `frontend/src/components/BoardView.test.tsx`
- Modify: `frontend/src/components/Toolbar.test.tsx`

**Interfaces:**
- Consumes: `getBoards`, `listItems`, `updateItem`, `buildBoardCards`, `groupIntoLanes`, `UNSCHEDULED`, `Column`.
- Produces: `useBoard()` → `{ boards: Board[]; items: Item[]; loading; error; reload }`; `BoardTabs({ boards, activeId, onSelect })`; `BoardView({ board, items, filters, onOpenCard, onOpenStories, onChanged })` + exported `handleCardDragEnd(event, reload)`; `Toolbar` gains `kindOptions: ItemKind[]`.

- [ ] **Step 1: Write the failing test** — `frontend/src/components/BoardView.test.tsx`

```tsx
import { render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import * as client from "../api/client";
import BoardView, { handleCardDragEnd } from "./BoardView";
import type { Board, Item } from "../types";

afterEach(() => vi.restoreAllMocks());

const board: Board = {
  id: 1, name: "Features & Stories", kinds: ["feature", "story"], position: 0,
  lanes: [
    { id: 10, name: "Funnel", position: 0 },
    { id: 11, name: "Analyzing", position: 1 },
  ],
};

const items: Item[] = [
  { id: 1, kind: "feature", type: "Feature", parent_id: null, position: 0, title: "Feat A",
    status: "Analyzing", description: null, kategorie: null, art: null, sdi_prio: null,
    tshirt_size: null, wsjf_score: null, story_points: null, iteration: null,
    leading_team: null, supporting_team: null, externer_partner: null, assignee: null,
    akzeptanzkriterien: null, dependencies: null, bo_stakeholder: null,
    business_value: null, time_criticality: null, risk_reduction: null,
    cost_of_delay: null, job_size: null, definition_of_done: null },
  { id: 2, kind: "risk", type: "Risk", parent_id: null, position: 1, title: "Risk B",
    status: "Analyzing", description: null, kategorie: null, art: null, sdi_prio: null,
    tshirt_size: null, wsjf_score: null, story_points: null, iteration: null,
    leading_team: null, supporting_team: null, externer_partner: null, assignee: null,
    akzeptanzkriterien: null, dependencies: null, bo_stakeholder: null,
    business_value: null, time_criticality: null, risk_reduction: null,
    cost_of_delay: null, job_size: null, definition_of_done: null },
];

it("renders the board's lanes + Unscheduled and only the board's kinds", () => {
  render(<BoardView board={board} items={items} filters={{}} onOpenCard={() => {}} onOpenStories={() => {}} onChanged={() => {}} />);
  expect(screen.getByText("Funnel")).toBeInTheDocument();
  expect(screen.getByText("Analyzing")).toBeInTheDocument();
  expect(screen.getByText("Unscheduled")).toBeInTheDocument();
  expect(screen.getByText("Feat A")).toBeInTheDocument();
  // the risk is not one of this board's kinds, so it must not appear
  expect(screen.queryByText("Risk B")).toBeNull();
});

it("drag handler sets status to the lane (and '' for Unscheduled) then reloads", async () => {
  const update = vi.spyOn(client, "updateItem").mockResolvedValue({} as never);
  const reload = vi.fn().mockResolvedValue(undefined);
  await handleCardDragEnd({ active: { id: 1 }, over: { id: "Funnel" } } as never, reload);
  expect(update).toHaveBeenCalledWith(1, { status: "Funnel" });
  await handleCardDragEnd({ active: { id: 1 }, over: { id: "Unscheduled" } } as never, reload);
  expect(update).toHaveBeenCalledWith(1, { status: "" });
  expect(reload).toHaveBeenCalledTimes(2);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm run test -- src/components/BoardView.test.tsx`
Expected: FAIL — cannot resolve `./BoardView`.

- [ ] **Step 3: Replace `frontend/src/hooks/useBoard.ts`**

```ts
import { useCallback, useEffect, useState } from "react";
import { getBoards, listItems } from "../api/client";
import type { Board, Item } from "../types";

export function useBoard() {
  const [boards, setBoards] = useState<Board[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [b, its] = await Promise.all([getBoards(), listItems()]);
      setBoards(b);
      setItems(its);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load board");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { boards, items, loading, error, reload };
}
```

- [ ] **Step 4: Remove `getBoard` from `frontend/src/api/client.ts`**

Delete the `getBoard` function (the `GET /api/board` wrapper). Leave `getBoards` and everything else.

- [ ] **Step 5: Create `frontend/src/components/BoardTabs.tsx`**

```tsx
import type { Board } from "../types";

export default function BoardTabs({
  boards,
  activeId,
  onSelect,
}: {
  boards: Board[];
  activeId: number | null;
  onSelect: (id: number) => void;
}) {
  return (
    <div className="flex gap-1 border-b bg-white px-6">
      {boards.map((board) => (
        <button
          key={board.id}
          onClick={() => onSelect(board.id)}
          className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
            board.id === activeId
              ? "border-blue-600 text-blue-700"
              : "border-transparent text-gray-500 hover:text-gray-800"
          }`}
        >
          {board.name}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 6: Create `frontend/src/components/BoardView.tsx`**

```tsx
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { useMemo } from "react";
import { updateItem } from "../api/client";
import { UNSCHEDULED, buildBoardCards, groupIntoLanes } from "../lib/boardLanes";
import type { Board, BoardCard, Item } from "../types";
import type { BoardFilters } from "./Toolbar";
import Column from "./Column";

export async function handleCardDragEnd(
  event: DragEndEvent,
  reload: () => Promise<void> | void,
): Promise<void> {
  if (!event.over) return;
  const cardId = Number(event.active.id);
  const target = String(event.over.id);
  await updateItem(cardId, { status: target === UNSCHEDULED ? "" : target });
  await reload();
}

function visible(cards: BoardCard[], board: Board, f: BoardFilters): BoardCard[] {
  const boardKinds = new Set(board.kinds);
  const selected = f.kinds && f.kinds.length ? new Set(f.kinds) : null;
  const q = f.q?.toLowerCase();
  return cards.filter((c) => {
    if (!boardKinds.has(c.kind)) return false;
    if (selected && !selected.has(c.kind)) return false;
    if (f.iteration && c.iteration !== f.iteration) return false;
    if (f.leading_team && c.leading_team !== f.leading_team) return false;
    if (q && !c.title.toLowerCase().includes(q)) return false;
    return true;
  });
}

export default function BoardView({
  board,
  items,
  filters,
  onOpenCard,
  onOpenStories,
  onChanged,
}: {
  board: Board;
  items: Item[];
  filters: BoardFilters;
  onOpenCard: (id: number) => void;
  onOpenStories: (featureId: number) => void;
  onChanged: () => void | Promise<void>;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );
  const columns = useMemo(() => {
    const cards = buildBoardCards(items);
    return groupIntoLanes(visible(cards, board, filters), board.lanes);
  }, [items, board, filters]);

  return (
    <DndContext
      sensors={sensors}
      onDragEnd={(event) => void handleCardDragEnd(event, onChanged)}
    >
      <div className="flex gap-4 overflow-x-auto p-6">
        {columns.map((column) => (
          <Column
            key={column.status}
            column={column}
            onOpenCard={onOpenCard}
            onOpenStories={onOpenStories}
          />
        ))}
      </div>
    </DndContext>
  );
}
```

- [ ] **Step 7: Scope the Kind filter via a prop — `frontend/src/components/Toolbar.tsx`**

Replace the module-level `KIND_OPTIONS` constant and the `Toolbar` signature/`fieldset` so the kinds come from a prop. Change the props type to add `kindOptions: ItemKind[]`:
```tsx
export default function Toolbar({
  filters,
  onChange,
  iterations,
  teams,
  kindOptions,
}: {
  filters: BoardFilters;
  onChange: (next: BoardFilters) => void;
  iterations: string[];
  teams: string[];
  kindOptions: ItemKind[];
}) {
```
Delete the `const KIND_OPTIONS = [...]` constant. In the JSX, build the checkboxes from `kindOptions` (capitalizing the label):
```tsx
      <fieldset className="flex items-center gap-2 text-xs text-gray-500">
        <span>Kind</span>
        {kindOptions.map((kind) => (
          <label key={kind} className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={(filters.kinds ?? []).includes(kind)}
              onChange={(e) => toggleKind(kind, e.target.checked)}
            />
            {kind.charAt(0).toUpperCase() + kind.slice(1)}
          </label>
        ))}
      </fieldset>
```
(`toggleKind` and `BoardFilters` are unchanged.)

- [ ] **Step 8: Replace `frontend/src/App.tsx`**

```tsx
import { useEffect, useMemo, useState } from "react";
import BoardTabs from "./components/BoardTabs";
import BoardView from "./components/BoardView";
import ImportButton from "./components/ImportButton";
import ItemDrawer from "./components/ItemDrawer";
import NewItemBar from "./components/NewItemBar";
import StoryBoardModal from "./components/StoryBoardModal";
import Toolbar, { type BoardFilters } from "./components/Toolbar";
import AdminView from "./components/admin/AdminView";
import { useBoard } from "./hooks/useBoard";
import { getTeamMembers } from "./api/client";

export default function App() {
  const { boards, items, loading, error, reload } = useBoard();
  const [view, setView] = useState<"board" | "admin">("board");
  const [activeBoardId, setActiveBoardId] = useState<number | null>(null);
  const [openItemId, setOpenItemId] = useState<number | null>(null);
  const [openStoriesFeatureId, setOpenStoriesFeatureId] = useState<number | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [filters, setFilters] = useState<BoardFilters>({});
  const [assigneeOptions, setAssigneeOptions] = useState<string[]>([]);

  useEffect(() => {
    if (activeBoardId == null && boards.length) setActiveBoardId(boards[0].id);
  }, [boards, activeBoardId]);

  useEffect(() => {
    void getTeamMembers().then((ms) => setAssigneeOptions(ms.map((m) => m.name)));
  }, [refreshKey]);

  const activeBoard = boards.find((b) => b.id === activeBoardId) ?? null;

  const iterations = useMemo(
    () => [...new Set(items.map((i) => i.iteration).filter(Boolean) as string[])].sort(),
    [items],
  );
  const teams = useMemo(
    () => [...new Set(items.map((i) => i.leading_team).filter(Boolean) as string[])].sort(),
    [items],
  );

  const selectBoard = (id: number) => {
    setActiveBoardId(id);
    setFilters((f) => ({ ...f, kinds: undefined })); // reset kind narrowing per board
  };

  const handleChanged = () => {
    setOpenItemId(null);
    setRefreshKey((k) => k + 1);
    void reload();
  };

  const navButton = (target: "board" | "admin", label: string) => (
    <button
      onClick={() => setView(target)}
      className={`rounded px-3 py-1 text-sm font-medium ${
        view === target ? "bg-gray-900 text-white" : "text-gray-600 hover:bg-gray-100"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="flex items-center justify-between border-b bg-white px-6 py-4">
        <div className="flex items-center gap-4">
          <h1 className="text-lg font-semibold text-gray-900">SAFe Kanban</h1>
          <nav className="flex gap-1">
            {navButton("board", "Board")}
            {navButton("admin", "Admin")}
          </nav>
        </div>
        {view === "board" && (
          <div className="flex items-center gap-3">
            <ImportButton onImported={handleChanged} />
            <NewItemBar onCreated={handleChanged} />
          </div>
        )}
      </header>

      {view === "admin" ? (
        <AdminView onChanged={handleChanged} />
      ) : loading && !activeBoard ? (
        <div className="p-8 text-gray-500">Loading board…</div>
      ) : error ? (
        <div className="p-8 text-red-600">{error}</div>
      ) : activeBoard ? (
        <>
          <BoardTabs boards={boards} activeId={activeBoardId} onSelect={selectBoard} />
          <Toolbar
            filters={filters}
            onChange={setFilters}
            iterations={iterations}
            teams={teams}
            kindOptions={activeBoard.kinds}
          />
          <BoardView
            board={activeBoard}
            items={items}
            filters={filters}
            onOpenCard={setOpenItemId}
            onOpenStories={setOpenStoriesFeatureId}
            onChanged={handleChanged}
          />
        </>
      ) : null}

      {openStoriesFeatureId != null && (
        <StoryBoardModal
          featureId={openStoriesFeatureId}
          refreshSignal={refreshKey}
          onClose={() => setOpenStoriesFeatureId(null)}
          onOpenItem={setOpenItemId}
          onChanged={handleChanged}
        />
      )}
      {openItemId != null && (
        <ItemDrawer
          itemId={openItemId}
          assigneeOptions={assigneeOptions}
          onClose={() => setOpenItemId(null)}
          onChanged={handleChanged}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 9: Delete the obsolete Board files and update the Toolbar test**

Run:
```bash
cd frontend && rm src/components/Board.tsx src/components/Board.test.tsx src/components/Board.dnd.test.tsx
```
In `src/components/Toolbar.test.tsx`, add `kindOptions={["feature", "story", "risk"]}` to every `<Toolbar .../>` render so the three existing tests still compile (they query the same checkboxes). For example the first render becomes:
```tsx
  render(<Toolbar filters={{}} onChange={onChange} iterations={["PI1-Q3"]} teams={["Network"]} kindOptions={["feature", "story", "risk"]} />);
```
Apply the same `kindOptions={["feature", "story", "risk"]}` addition to all four `render(<Toolbar .../>)` calls in that file.

- [ ] **Step 10: Run the full frontend suite + build**

Run: `cd frontend && npm run test && npm run build`
Expected: PASS — all tests (BoardView, boardLanes, Toolbar with kindOptions, client, drawer/admin/etc.); `tsc --noEmit` clean and Vite emits `dist/`.

- [ ] **Step 11: Commit**

```bash
git add -A frontend/src
git commit -m "feat(frontend): lane-driven board with tabs, reworked useBoard, board-scoped kind filter"
```

---

### Task 4: Edit-lanes mode (reorder + add/rename/delete)

**Files:**
- Modify: `frontend/package.json` (add `@dnd-kit/sortable`)
- Create: `frontend/src/components/LaneEditor.tsx`
- Modify: `frontend/src/components/BoardView.tsx` (edit-mode toggle + render)
- Create: `frontend/src/components/LaneEditor.test.tsx`

**Interfaces:**
- Consumes: `addLane`, `renameLane`, `deleteLane`, `reorderLanes` from `api/client`; `@dnd-kit/sortable`.
- Produces: `LaneEditor({ board, onChanged })` (sortable lane chips + rename/delete + add) with an exported pure `handleLaneDragEnd(event, board, onChanged)`; `BoardView` gains an "Edit lanes" toggle that renders `LaneEditor` above the columns.

- [ ] **Step 1: Add the dependency**

Run:
```bash
cd frontend && npm install @dnd-kit/sortable@^8
```
Expected: `package.json`/`package-lock.json` updated; no error.

- [ ] **Step 2: Write the failing test** — `frontend/src/components/LaneEditor.test.tsx`

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import * as client from "../api/client";
import LaneEditor, { handleLaneDragEnd } from "./LaneEditor";
import type { Board } from "../types";

afterEach(() => vi.restoreAllMocks());

const board: Board = {
  id: 1, name: "Main", kinds: ["feature"], position: 0,
  lanes: [
    { id: 10, name: "Funnel", position: 0 },
    { id: 11, name: "Analyzing", position: 1 },
    { id: 12, name: "New", position: 2 },
  ],
};

it("adds a lane with the typed name", async () => {
  const add = vi.spyOn(client, "addLane").mockResolvedValue({ id: 13, name: "Done", position: 3 });
  const onChanged = vi.fn();
  render(<LaneEditor board={board} onChanged={onChanged} />);
  fireEvent.change(screen.getByPlaceholderText(/new lane/i), { target: { value: "Done" } });
  fireEvent.click(screen.getByRole("button", { name: /add lane/i }));
  expect(add).toHaveBeenCalledWith(1, "Done");
});

it("deletes a lane", async () => {
  const del = vi.spyOn(client, "deleteLane").mockResolvedValue();
  render(<LaneEditor board={board} onChanged={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: /delete lane 11/i }));
  expect(del).toHaveBeenCalledWith(11);
});

it("renames a lane on blur", async () => {
  const rename = vi.spyOn(client, "renameLane").mockResolvedValue({ id: 10, name: "Backlog", position: 0 });
  render(<LaneEditor board={board} onChanged={() => {}} />);
  const input = screen.getByDisplayValue("Funnel");
  fireEvent.change(input, { target: { value: "Backlog" } });
  fireEvent.blur(input);
  expect(rename).toHaveBeenCalledWith(10, "Backlog");
});

it("drag handler persists the reordered lane ids", async () => {
  const reorder = vi.spyOn(client, "reorderLanes").mockResolvedValue([]);
  const onChanged = vi.fn();
  // move lane 12 (New) to where lane 10 (Funnel) is -> [12,10,11]
  await handleLaneDragEnd({ active: { id: 12 }, over: { id: 10 } } as never, board, onChanged);
  expect(reorder).toHaveBeenCalledWith(1, [12, 10, 11]);
  expect(onChanged).toHaveBeenCalled();
});
```

- [ ] **Step 3: Create `frontend/src/components/LaneEditor.tsx`**

```tsx
import { DndContext, type DragEndEvent } from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { useState } from "react";
import { addLane, deleteLane, renameLane, reorderLanes } from "../api/client";
import type { Board } from "../types";

export async function handleLaneDragEnd(
  event: DragEndEvent,
  board: Board,
  onChanged: () => void | Promise<void>,
): Promise<void> {
  if (!event.over || event.active.id === event.over.id) return;
  const ids = board.lanes.map((l) => l.id);
  const from = ids.indexOf(Number(event.active.id));
  const to = ids.indexOf(Number(event.over.id));
  if (from === -1 || to === -1) return;
  await reorderLanes(board.id, arrayMove(ids, from, to));
  await onChanged();
}

function LaneChip({
  id,
  name,
  onRename,
  onDelete,
}: {
  id: number;
  name: string;
  onRename: (id: number, name: string) => void;
  onDelete: (id: number) => void;
}) {
  const { attributes, listeners, setNodeRef, transform } = useSortable({ id });
  const [value, setValue] = useState(name);
  const style = transform
    ? { transform: `translate(${transform.x}px, ${transform.y}px)` }
    : undefined;
  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-1 rounded border border-gray-300 bg-white px-2 py-1 text-sm"
    >
      <span {...attributes} {...listeners} className="cursor-grab text-gray-400">⠿</span>
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => value.trim() && value !== name && onRename(id, value.trim())}
        className="w-24 rounded border border-transparent px-1 hover:border-gray-200"
      />
      <button
        aria-label={`delete lane ${id}`}
        onClick={() => onDelete(id)}
        className="text-gray-400 hover:text-red-600"
      >
        ×
      </button>
    </div>
  );
}

export default function LaneEditor({
  board,
  onChanged,
}: {
  board: Board;
  onChanged: () => void | Promise<void>;
}) {
  const [newName, setNewName] = useState("");

  const onRename = async (id: number, name: string) => {
    await renameLane(id, name);
    await onChanged();
  };
  const onDelete = async (id: number) => {
    await deleteLane(id);
    await onChanged();
  };
  const onAdd = async () => {
    if (!newName.trim()) return;
    await addLane(board.id, newName.trim());
    setNewName("");
    await onChanged();
  };

  return (
    <div className="flex flex-wrap items-center gap-2 border-b bg-gray-50 px-6 py-3">
      <DndContext onDragEnd={(e) => void handleLaneDragEnd(e, board, onChanged)}>
        <SortableContext
          items={board.lanes.map((l) => l.id)}
          strategy={horizontalListSortingStrategy}
        >
          <div className="flex flex-wrap gap-2">
            {board.lanes.map((lane) => (
              <LaneChip
                key={lane.id}
                id={lane.id}
                name={lane.name}
                onRename={onRename}
                onDelete={onDelete}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
      <div className="flex items-center gap-1">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="New lane"
          className="rounded border border-gray-300 px-2 py-1 text-sm"
        />
        <button
          onClick={onAdd}
          className="rounded bg-blue-600 px-3 py-1 text-sm text-white"
        >
          Add lane
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run the LaneEditor test to verify it passes**

Run: `cd frontend && npm run test -- src/components/LaneEditor.test.tsx`
Expected: PASS — four tests.

- [ ] **Step 5: Add the Edit-lanes toggle to `frontend/src/components/BoardView.tsx`**

Add the import:
```tsx
import { useState } from "react";
import LaneEditor from "./LaneEditor";
```
(merge the `useState` into the existing `react` import: `import { useMemo, useState } from "react";`). Inside `BoardView`, add edit state and render the editor + a toggle. Replace the `return (...)` block with:
```tsx
  const [editing, setEditing] = useState(false);

  return (
    <div>
      <div className="flex justify-end px-6 pt-3">
        <button
          onClick={() => setEditing((v) => !v)}
          className="rounded border border-gray-300 px-3 py-1 text-sm text-gray-600 hover:bg-gray-100"
        >
          {editing ? "Done" : "Edit lanes"}
        </button>
      </div>
      {editing && <LaneEditor board={board} onChanged={onChanged} />}
      <DndContext
        sensors={sensors}
        onDragEnd={(event) => void handleCardDragEnd(event, onChanged)}
      >
        <div className="flex gap-4 overflow-x-auto p-6">
          {columns.map((column) => (
            <Column
              key={column.status}
              column={column}
              onOpenCard={onOpenCard}
              onOpenStories={onOpenStories}
            />
          ))}
        </div>
      </DndContext>
    </div>
  );
```

- [ ] **Step 6: Run the FULL frontend suite + build**

Run: `cd frontend && npm run test && npm run build`
Expected: PASS — every test (incl. LaneEditor + BoardView still rendering lanes); `tsc --noEmit` clean, Vite emits `dist/`.

- [ ] **Step 7: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/src/components/LaneEditor.tsx frontend/src/components/LaneEditor.test.tsx frontend/src/components/BoardView.tsx
git commit -m "feat(frontend): Edit lanes mode (sortable reorder + add/rename/delete)"
```

---

## Self-Review Notes

- **Spec coverage:** board tabs + per-board kinds → Task 3; client-side grouping into lanes (+ Unscheduled, feature aggregates) → Tasks 2–3; card-drag→status (incl Unscheduled → "") → Task 3; Kind filter kept + board-scoped → Tasks 3 (Toolbar `kindOptions`) & App; Edit-lanes mode reorder/add/rename/delete → Task 4; retire `/api/board` → Task 3; story modal unchanged (still imports `groupByStatus`) → untouched.
- **Type consistency:** `Board`/`Lane`, client fn names (`getBoards`/`addLane`/`renameLane`/`deleteLane`/`reorderLanes`), `buildBoardCards`/`groupIntoLanes`/`UNSCHEDULED`, `handleCardDragEnd`/`handleLaneDragEnd`, `BoardFilters`, and `Toolbar`'s new `kindOptions` are used identically across tasks.
- **Note for reviewers:** Task 3 deletes `Board.tsx`/`Board.test.tsx`/`Board.dnd.test.tsx` and removes `getBoard`; the board now renders via `BoardView` from `getBoards()` + `listItems()`. `lib/groupByStatus.ts` stays (the story modal uses it).
