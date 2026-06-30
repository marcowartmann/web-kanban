# SAFe Kanban Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a React + Vite + TypeScript + Tailwind Kanban UI that renders Features/Risks as cards grouped by status, supports drag-to-change-status, full CRUD via a detail drawer (including child Stories), filters/search, and replace-all CSV import.

**Architecture:** A typed `api` client wraps the backend (`/api/...`). A `useBoard` hook owns board state and refetch. Presentational components (`Board → Column → Card`) render the board; `ItemDrawer` handles view/edit/create; `Toolbar` handles filters + import. Drag/drop uses `@dnd-kit`. Tests use Vitest + React Testing Library with the network mocked.

**Tech Stack:** React 18, Vite 5, TypeScript 5, Tailwind CSS 3, `@dnd-kit/core`, Vitest, `@testing-library/react`, `@testing-library/user-event`, jsdom.

## Global Constraints

- All backend calls go through `src/api/client.ts`; components never call `fetch` directly.
- Vite dev server proxies `/api` → `http://localhost:8000` (see Task 1 `vite.config.ts`).
- TypeScript `strict: true`. No `any` in committed code except mocked test payloads.
- `kind` is the string union `"feature" | "story" | "risk"`; statuses are arbitrary strings; the `Unscheduled` column name is produced by the backend.
- This plan assumes the backend plan (`2026-06-30-safe-kanban-backend.md`) is implemented: endpoints `GET /api/board`, `GET/POST /api/items`, `GET/PATCH/DELETE /api/items/{id}`, `POST /api/import`.

---

### Task 1: Scaffold Vite + TS + Tailwind, types, and API client

**Files:**
- Create: `frontend/package.json`
- Create: `frontend/vite.config.ts`
- Create: `frontend/tsconfig.json`
- Create: `frontend/index.html`
- Create: `frontend/tailwind.config.js`
- Create: `frontend/postcss.config.js`
- Create: `frontend/src/index.css`
- Create: `frontend/src/main.tsx`
- Create: `frontend/src/types.ts`
- Create: `frontend/src/api/client.ts`
- Create: `frontend/vitest.setup.ts`
- Create: `frontend/src/api/client.test.ts`

**Interfaces:**
- Produces:
  - `src/types.ts`: `ItemKind`, `Item`, `BoardCard`, `BoardColumn`, `ImportResult`, `ItemCreate`, `ItemUpdate`.
  - `src/api/client.ts`: `getBoard()`, `getItem(id)`, `createItem(body)`, `updateItem(id, patch)`, `deleteItem(id)`, `importCsv(file)`, and `listItems(params)`.

- [ ] **Step 1: Create `frontend/package.json`**

```json
{
  "name": "safe-kanban-frontend",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@dnd-kit/core": "^6.1.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.4.0",
    "@testing-library/react": "^16.0.0",
    "@testing-library/user-event": "^14.5.0",
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.0",
    "autoprefixer": "^10.4.0",
    "jsdom": "^24.1.0",
    "postcss": "^8.4.0",
    "tailwindcss": "^3.4.0",
    "typescript": "^5.5.0",
    "vite": "^5.3.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 2: Create config files**

`frontend/vite.config.ts`:
```ts
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: { "/api": "http://localhost:8000" },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: "./vitest.setup.ts",
  },
});
```

`frontend/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "skipLibCheck": true,
    "types": ["vitest/globals", "@testing-library/jest-dom"]
  },
  "include": ["src", "vitest.setup.ts"]
}
```

`frontend/index.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>SAFe Kanban</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`frontend/tailwind.config.js`:
```js
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: { extend: {} },
  plugins: [],
};
```

`frontend/postcss.config.js`:
```js
export default { plugins: { tailwindcss: {}, autoprefixer: {} } };
```

`frontend/src/index.css`:
```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

`frontend/vitest.setup.ts`:
```ts
import "@testing-library/jest-dom/vitest";
```

- [ ] **Step 3: Create `frontend/src/types.ts`**

```ts
export type ItemKind = "feature" | "story" | "risk";

export interface Item {
  id: number;
  kind: ItemKind;
  type: string | null;
  parent_id: number | null;
  position: number;
  title: string;
  description: string | null;
  kategorie: string | null;
  art: string | null;
  sdi_prio: string | null;
  status: string | null;
  tshirt_size: string | null;
  wsjf_score: number | null;
  story_points: number | null;
  iteration: string | null;
  leading_team: string | null;
  supporting_team: string | null;
  externer_partner: string | null;
  assignee: string | null;
  akzeptanzkriterien: string | null;
  dependencies: string | null;
  bo_stakeholder: string | null;
  business_value: number | null;
  time_criticality: number | null;
  risk_reduction: number | null;
  cost_of_delay: number | null;
  job_size: number | null;
  definition_of_done: string | null;
  children?: Item[];
}

export interface BoardCard extends Item {
  children_count: number;
  children_points: number;
}

export interface BoardColumn {
  status: string;
  cards: BoardCard[];
}

export interface ImportResult {
  features: number;
  stories: number;
  risks: number;
  warnings: string[];
}

export interface ItemCreate {
  kind: ItemKind;
  title: string;
  parent_id?: number | null;
  status?: string | null;
  [key: string]: unknown;
}

export type ItemUpdate = Partial<Omit<Item, "id" | "kind" | "parent_id">>;
```

- [ ] **Step 4: Create `frontend/src/api/client.ts`**

```ts
import type {
  BoardColumn,
  ImportResult,
  Item,
  ItemCreate,
  ItemUpdate,
} from "../types";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(url, init);
  if (!resp.ok) {
    const detail = await resp.text();
    throw new Error(`${resp.status} ${resp.statusText}: ${detail}`);
  }
  if (resp.status === 204) return undefined as T;
  return (await resp.json()) as T;
}

const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export function getBoard(): Promise<BoardColumn[]> {
  return request<BoardColumn[]>("/api/board");
}

export function listItems(params: Record<string, string> = {}): Promise<Item[]> {
  const qs = new URLSearchParams(params).toString();
  return request<Item[]>(`/api/items${qs ? `?${qs}` : ""}`);
}

export function getItem(id: number): Promise<Item> {
  return request<Item>(`/api/items/${id}`);
}

export function createItem(body: ItemCreate): Promise<Item> {
  return request<Item>("/api/items", json(body));
}

export function updateItem(id: number, patch: ItemUpdate): Promise<Item> {
  return request<Item>(`/api/items/${id}`, { ...json(patch), method: "PATCH" });
}

export function deleteItem(id: number): Promise<void> {
  return request<void>(`/api/items/${id}`, { method: "DELETE" });
}

export function importCsv(file: File): Promise<ImportResult> {
  const form = new FormData();
  form.append("file", file);
  return request<ImportResult>("/api/import", { method: "POST", body: form });
}
```

- [ ] **Step 5: Create `frontend/src/main.tsx`** (placeholder root; real App in Task 2)

```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <div className="p-8 text-gray-700">Loading…</div>
  </React.StrictMode>,
);
```

- [ ] **Step 6: Write failing test `frontend/src/api/client.test.ts`**

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { createItem, getBoard, importCsv, updateItem } from "./client";

afterEach(() => vi.restoreAllMocks());

function mockFetch(status: number, body: unknown) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(typeof body === "string" ? body : JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

describe("api client", () => {
  it("getBoard fetches /api/board", async () => {
    const spy = mockFetch(200, [{ status: "Analyzing", cards: [] }]);
    const board = await getBoard();
    expect(spy).toHaveBeenCalledWith("/api/board", undefined);
    expect(board[0].status).toBe("Analyzing");
  });

  it("updateItem sends PATCH with JSON body", async () => {
    const spy = mockFetch(200, { id: 1, status: "New" });
    await updateItem(1, { status: "New" });
    const [url, init] = spy.mock.calls[0];
    expect(url).toBe("/api/items/1");
    expect(init?.method).toBe("PATCH");
    expect(JSON.parse(init?.body as string)).toEqual({ status: "New" });
  });

  it("createItem posts to /api/items", async () => {
    const spy = mockFetch(201, { id: 9, title: "X" });
    await createItem({ kind: "feature", title: "X" });
    expect(spy.mock.calls[0][1]?.method).toBe("POST");
  });

  it("importCsv posts multipart form data", async () => {
    const spy = mockFetch(200, { features: 1, stories: 0, risks: 0, warnings: [] });
    const file = new File(["Title\nX"], "p.csv", { type: "text/csv" });
    const result = await importCsv(file);
    expect(result.features).toBe(1);
    expect(spy.mock.calls[0][1]?.body).toBeInstanceOf(FormData);
  });

  it("throws on non-ok responses", async () => {
    mockFetch(404, "Item not found");
    await expect(updateItem(1, {})).rejects.toThrow("404");
  });
});
```

- [ ] **Step 7: Install deps, run the client test**

Run:
```bash
cd frontend && npm install && npm run test -- src/api/client.test.ts
```
Expected: PASS — five tests in `api client`.

- [ ] **Step 8: Commit**

```bash
git add frontend/
git commit -m "feat(frontend): scaffold Vite+TS+Tailwind, types, and typed API client"
```

---

### Task 2: Board data hook + Board/Column/Card rendering

**Files:**
- Create: `frontend/src/hooks/useBoard.ts`
- Create: `frontend/src/components/Card.tsx`
- Create: `frontend/src/components/Column.tsx`
- Create: `frontend/src/components/Board.tsx`
- Create: `frontend/src/App.tsx`
- Modify: `frontend/src/main.tsx`
- Create: `frontend/src/components/Board.test.tsx`

**Interfaces:**
- Consumes: `getBoard` from `api/client`, types `BoardColumn`, `BoardCard`.
- Produces:
  - `useBoard()` → `{ columns: BoardColumn[]; loading: boolean; error: string | null; reload: () => Promise<void>; setColumns: (c: BoardColumn[]) => void }`.
  - `Card({ card, onOpen })`, `Column({ column, onOpenCard })`, `Board({ onOpenCard })` (Board renders columns from `useBoard`).
  - `App()` renders `<Board />`.

- [ ] **Step 1: Write failing test `frontend/src/components/Board.test.tsx`**

```tsx
import { render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import Board from "./Board";
import * as client from "../api/client";

afterEach(() => vi.restoreAllMocks());

const sampleBoard = [
  {
    status: "Analyzing",
    cards: [
      {
        id: 1, kind: "feature", title: "Feature One", status: "Analyzing",
        wsjf_score: 60, leading_team: "Network", iteration: "PI1-Q3",
        children_count: 3, children_points: 4.5, parent_id: null, position: 0,
        type: "Enabler Feature", description: null, kategorie: null, art: null,
        sdi_prio: null, tshirt_size: "XS", story_points: null,
        supporting_team: null, externer_partner: null, assignee: null,
        akzeptanzkriterien: null, dependencies: null, bo_stakeholder: null,
        business_value: null, time_criticality: null, risk_reduction: null,
        cost_of_delay: null, job_size: null, definition_of_done: null,
      },
    ],
  },
  { status: "Unscheduled", cards: [] },
];

it("renders a column per status and a card per item", async () => {
  vi.spyOn(client, "getBoard").mockResolvedValue(sampleBoard as never);
  render(<Board onOpenCard={() => {}} />);

  expect(await screen.findByText("Feature One")).toBeInTheDocument();
  expect(screen.getByText("Analyzing")).toBeInTheDocument();
  expect(screen.getByText("Unscheduled")).toBeInTheDocument();
  // card surfaces WSJF and child-story count
  expect(screen.getByText(/60/)).toBeInTheDocument();
  expect(screen.getByText(/3 stories/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm run test -- src/components/Board.test.tsx`
Expected: FAIL — cannot resolve `./Board`.

- [ ] **Step 3: Create `frontend/src/hooks/useBoard.ts`**

```ts
import { useCallback, useEffect, useState } from "react";
import { getBoard } from "../api/client";
import type { BoardColumn } from "../types";

export function useBoard() {
  const [columns, setColumns] = useState<BoardColumn[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setColumns(await getBoard());
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

  return { columns, loading, error, reload, setColumns };
}
```

- [ ] **Step 4: Create `frontend/src/components/Card.tsx`**

```tsx
import type { BoardCard } from "../types";

const kindStyles: Record<string, string> = {
  feature: "bg-blue-100 text-blue-800",
  risk: "bg-red-100 text-red-800",
  story: "bg-gray-100 text-gray-800",
};

export default function Card({
  card,
  onOpen,
}: {
  card: BoardCard;
  onOpen: (id: number) => void;
}) {
  return (
    <button
      onClick={() => onOpen(card.id)}
      className="w-full rounded-lg border border-gray-200 bg-white p-3 text-left shadow-sm hover:shadow"
    >
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className={`rounded px-1.5 py-0.5 text-xs ${kindStyles[card.kind] ?? "bg-gray-100 text-gray-800"}`}>
          {card.type ?? card.kind}
        </span>
        {card.wsjf_score != null && (
          <span className="text-xs font-semibold text-gray-600">
            WSJF {card.wsjf_score}
          </span>
        )}
      </div>
      <div className="font-medium text-gray-900">{card.title}</div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-500">
        {card.leading_team && <span>{card.leading_team}</span>}
        {card.iteration && <span>{card.iteration}</span>}
        {card.kind === "feature" && <span>{card.children_count} stories</span>}
        {card.kind === "feature" && card.children_points > 0 && (
          <span>{card.children_points} SP</span>
        )}
      </div>
    </button>
  );
}
```

- [ ] **Step 5: Create `frontend/src/components/Column.tsx`**

```tsx
import type { BoardColumn } from "../types";
import Card from "./Card";

export default function Column({
  column,
  onOpenCard,
}: {
  column: BoardColumn;
  onOpenCard: (id: number) => void;
}) {
  return (
    <div className="flex w-72 shrink-0 flex-col rounded-xl bg-gray-100 p-3">
      <h2 className="mb-3 flex items-center justify-between text-sm font-semibold text-gray-700">
        <span>{column.status}</span>
        <span className="rounded-full bg-gray-200 px-2 text-xs">
          {column.cards.length}
        </span>
      </h2>
      <div className="flex flex-col gap-2">
        {column.cards.map((card) => (
          <Card key={card.id} card={card} onOpen={onOpenCard} />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Create `frontend/src/components/Board.tsx`**

```tsx
import { useBoard } from "../hooks/useBoard";
import Column from "./Column";

export default function Board({
  onOpenCard,
}: {
  onOpenCard: (id: number) => void;
}) {
  const { columns, loading, error } = useBoard();

  if (loading) return <div className="p-8 text-gray-500">Loading board…</div>;
  if (error) return <div className="p-8 text-red-600">{error}</div>;

  return (
    <div className="flex gap-4 overflow-x-auto p-6">
      {columns.map((column) => (
        <Column key={column.status} column={column} onOpenCard={onOpenCard} />
      ))}
    </div>
  );
}
```

- [ ] **Step 7: Create `frontend/src/App.tsx`** (drawer wiring added in Task 4)

```tsx
import Board from "./components/Board";

export default function App() {
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b bg-white px-6 py-4">
        <h1 className="text-lg font-semibold text-gray-900">SAFe Kanban</h1>
      </header>
      <Board onOpenCard={() => {}} />
    </div>
  );
}
```

- [ ] **Step 8: Update `frontend/src/main.tsx` to render App**

```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

- [ ] **Step 9: Run the board test to verify it passes**

Run: `cd frontend && npm run test -- src/components/Board.test.tsx`
Expected: PASS — renders columns + card with WSJF and "3 stories".

- [ ] **Step 10: Commit**

```bash
git add frontend/src/
git commit -m "feat(frontend): board hook + Board/Column/Card rendering from API"
```

---

### Task 3: Drag a card to change its status

**Files:**
- Modify: `frontend/src/components/Card.tsx`
- Modify: `frontend/src/components/Column.tsx`
- Modify: `frontend/src/components/Board.tsx`
- Create: `frontend/src/components/Board.dnd.test.tsx`

**Interfaces:**
- Consumes: `updateItem` from `api/client`, `@dnd-kit/core` (`DndContext`, `useDraggable`, `useDroppable`).
- Produces: dragging a card onto a column calls `updateItem(cardId, { status: targetStatus })` then `reload()`. `Board` owns the `DndContext` and `onDragEnd`.

- [ ] **Step 1: Write failing test `frontend/src/components/Board.dnd.test.tsx`**

This test verifies the drag-end handler logic directly (jsdom can't do pointer-precise DnD), so the handler is exported as a pure function.

```tsx
import { afterEach, expect, it, vi } from "vitest";
import * as client from "../api/client";
import { handleDragEnd } from "./Board";

afterEach(() => vi.restoreAllMocks());

it("moves a card to the dropped column's status and reloads", async () => {
  const update = vi.spyOn(client, "updateItem").mockResolvedValue({} as never);
  const reload = vi.fn().mockResolvedValue(undefined);

  await handleDragEnd(
    { active: { id: 7 }, over: { id: "New" } } as never,
    reload,
  );

  expect(update).toHaveBeenCalledWith(7, { status: "New" });
  expect(reload).toHaveBeenCalled();
});

it("does nothing when dropped outside any column", async () => {
  const update = vi.spyOn(client, "updateItem").mockResolvedValue({} as never);
  const reload = vi.fn();
  await handleDragEnd({ active: { id: 7 }, over: null } as never, reload);
  expect(update).not.toHaveBeenCalled();
  expect(reload).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm run test -- src/components/Board.dnd.test.tsx`
Expected: FAIL — `handleDragEnd` is not exported.

- [ ] **Step 3: Make `Card` draggable — replace `frontend/src/components/Card.tsx`**

```tsx
import { useDraggable } from "@dnd-kit/core";
import type { BoardCard } from "../types";

const kindStyles: Record<string, string> = {
  feature: "bg-blue-100 text-blue-800",
  risk: "bg-red-100 text-red-800",
  story: "bg-gray-100 text-gray-800",
};

export default function Card({
  card,
  onOpen,
}: {
  card: BoardCard;
  onOpen: (id: number) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id: card.id });
  const style = transform
    ? { transform: `translate(${transform.x}px, ${transform.y}px)` }
    : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={isDragging ? "opacity-50" : undefined}
    >
      <button
        {...listeners}
        {...attributes}
        onClick={() => onOpen(card.id)}
        className="w-full rounded-lg border border-gray-200 bg-white p-3 text-left shadow-sm hover:shadow"
      >
        <div className="mb-1 flex items-center justify-between gap-2">
          <span className={`rounded px-1.5 py-0.5 text-xs ${kindStyles[card.kind] ?? "bg-gray-100 text-gray-800"}`}>
            {card.type ?? card.kind}
          </span>
          {card.wsjf_score != null && (
            <span className="text-xs font-semibold text-gray-600">
              WSJF {card.wsjf_score}
            </span>
          )}
        </div>
        <div className="font-medium text-gray-900">{card.title}</div>
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-500">
          {card.leading_team && <span>{card.leading_team}</span>}
          {card.iteration && <span>{card.iteration}</span>}
          {card.kind === "feature" && <span>{card.children_count} stories</span>}
          {card.kind === "feature" && card.children_points > 0 && (
            <span>{card.children_points} SP</span>
          )}
        </div>
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Make `Column` a droppable — replace `frontend/src/components/Column.tsx`**

```tsx
import { useDroppable } from "@dnd-kit/core";
import type { BoardColumn } from "../types";
import Card from "./Card";

export default function Column({
  column,
  onOpenCard,
}: {
  column: BoardColumn;
  onOpenCard: (id: number) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: column.status });
  return (
    <div
      ref={setNodeRef}
      className={`flex w-72 shrink-0 flex-col rounded-xl p-3 ${
        isOver ? "bg-blue-50 ring-2 ring-blue-300" : "bg-gray-100"
      }`}
    >
      <h2 className="mb-3 flex items-center justify-between text-sm font-semibold text-gray-700">
        <span>{column.status}</span>
        <span className="rounded-full bg-gray-200 px-2 text-xs">
          {column.cards.length}
        </span>
      </h2>
      <div className="flex flex-col gap-2">
        {column.cards.map((card) => (
          <Card key={card.id} card={card} onOpen={onOpenCard} />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Add `DndContext` + exported `handleDragEnd` — replace `frontend/src/components/Board.tsx`**

```tsx
import { DndContext, type DragEndEvent } from "@dnd-kit/core";
import { useBoard } from "../hooks/useBoard";
import { updateItem } from "../api/client";
import Column from "./Column";

export async function handleDragEnd(
  event: DragEndEvent,
  reload: () => Promise<void>,
): Promise<void> {
  if (!event.over) return;
  const cardId = Number(event.active.id);
  const targetStatus = String(event.over.id);
  await updateItem(cardId, { status: targetStatus });
  await reload();
}

export default function Board({
  onOpenCard,
}: {
  onOpenCard: (id: number) => void;
}) {
  const { columns, loading, error, reload } = useBoard();

  if (loading) return <div className="p-8 text-gray-500">Loading board…</div>;
  if (error) return <div className="p-8 text-red-600">{error}</div>;

  return (
    <DndContext onDragEnd={(event) => void handleDragEnd(event, reload)}>
      <div className="flex gap-4 overflow-x-auto p-6">
        {columns.map((column) => (
          <Column key={column.status} column={column} onOpenCard={onOpenCard} />
        ))}
      </div>
    </DndContext>
  );
}
```

- [ ] **Step 6: Run the DnD test + full suite**

Run: `cd frontend && npm run test`
Expected: PASS — DnD handler tests + all earlier tests.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/
git commit -m "feat(frontend): drag a card between columns to change status"
```

---

### Task 4: Item detail drawer (view + edit, with WSJF display)

**Files:**
- Create: `frontend/src/components/Field.tsx`
- Create: `frontend/src/components/ItemDrawer.tsx`
- Modify: `frontend/src/App.tsx`
- Create: `frontend/src/components/ItemDrawer.test.tsx`

**Interfaces:**
- Consumes: `getItem`, `updateItem`, `deleteItem` from `api/client`; type `Item`.
- Produces:
  - `Field` — labeled text/number input helper: `Field({ label, value, onChange, type? })`.
  - `ItemDrawer({ itemId, onClose, onChanged })` — loads the item, shows editable fields, Save calls `updateItem` then `onChanged()`, Delete calls `deleteItem` then `onChanged()`; lists child stories (read-only here; CRUD added in Task 5).
  - `App` now owns `openItemId` state and renders `<ItemDrawer>` when set.

- [ ] **Step 1: Write failing test `frontend/src/components/ItemDrawer.test.tsx`**

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import * as client from "../api/client";
import ItemDrawer from "./ItemDrawer";

afterEach(() => vi.restoreAllMocks());

const item = {
  id: 5, kind: "feature", type: "Enabler Feature", title: "Teton Isolierung",
  status: "Analyzing", wsjf_score: 60, business_value: 20, time_criticality: 20,
  risk_reduction: 20, cost_of_delay: 60, job_size: 1, parent_id: null,
  position: 0, description: "isolate", iteration: "PI1-Q3", leading_team: "Network",
  story_points: null, tshirt_size: "XS", kategorie: null, art: "DP",
  sdi_prio: null, supporting_team: null, externer_partner: null, assignee: null,
  akzeptanzkriterien: null, dependencies: null, bo_stakeholder: null,
  definition_of_done: null, children: [],
};

it("loads an item and shows editable title + WSJF", async () => {
  vi.spyOn(client, "getItem").mockResolvedValue(item as never);
  render(<ItemDrawer itemId={5} onClose={() => {}} onChanged={() => {}} />);
  expect(await screen.findByDisplayValue("Teton Isolierung")).toBeInTheDocument();
  expect(screen.getByText(/WSJF/)).toBeInTheDocument();
});

it("saves edits via updateItem then notifies", async () => {
  vi.spyOn(client, "getItem").mockResolvedValue(item as never);
  const update = vi.spyOn(client, "updateItem").mockResolvedValue(item as never);
  const onChanged = vi.fn();
  render(<ItemDrawer itemId={5} onClose={() => {}} onChanged={onChanged} />);

  const title = await screen.findByDisplayValue("Teton Isolierung");
  await userEvent.clear(title);
  await userEvent.type(title, "Teton v2");
  await userEvent.click(screen.getByRole("button", { name: /save/i }));

  expect(update).toHaveBeenCalledWith(5, expect.objectContaining({ title: "Teton v2" }));
  expect(onChanged).toHaveBeenCalled();
});

it("deletes via deleteItem after confirm", async () => {
  vi.spyOn(client, "getItem").mockResolvedValue(item as never);
  const del = vi.spyOn(client, "deleteItem").mockResolvedValue();
  vi.spyOn(window, "confirm").mockReturnValue(true);
  const onChanged = vi.fn();
  render(<ItemDrawer itemId={5} onClose={() => {}} onChanged={onChanged} />);
  await screen.findByDisplayValue("Teton Isolierung");
  await userEvent.click(screen.getByRole("button", { name: /delete/i }));
  expect(del).toHaveBeenCalledWith(5);
  expect(onChanged).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm run test -- src/components/ItemDrawer.test.tsx`
Expected: FAIL — cannot resolve `./ItemDrawer`.

- [ ] **Step 3: Create `frontend/src/components/Field.tsx`**

```tsx
export default function Field({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string | number | null;
  onChange: (value: string) => void;
  type?: "text" | "number";
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-gray-500">{label}</span>
      <input
        type={type}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded border border-gray-300 px-2 py-1 text-sm"
      />
    </label>
  );
}
```

- [ ] **Step 4: Create `frontend/src/components/ItemDrawer.tsx`**

```tsx
import { useEffect, useState } from "react";
import { deleteItem, getItem, updateItem } from "../api/client";
import type { Item, ItemUpdate } from "../types";
import Field from "./Field";

const NUMERIC_FIELDS = new Set([
  "story_points", "business_value", "time_criticality",
  "risk_reduction", "job_size",
]);

export default function ItemDrawer({
  itemId,
  onClose,
  onChanged,
}: {
  itemId: number;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [item, setItem] = useState<Item | null>(null);
  const [draft, setDraft] = useState<ItemUpdate>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void getItem(itemId).then(setItem).catch((e) => setError(String(e)));
  }, [itemId]);

  if (error) return <Drawer onClose={onClose}><p className="text-red-600">{error}</p></Drawer>;
  if (!item) return <Drawer onClose={onClose}><p>Loading…</p></Drawer>;

  const value = <K extends keyof Item>(key: K) =>
    (key in draft ? (draft as Record<string, unknown>)[key as string] : item[key]) as
      | string
      | number
      | null;

  const set = (key: string, raw: string) => {
    const next: unknown = NUMERIC_FIELDS.has(key)
      ? raw === "" ? null : Number(raw)
      : raw;
    setDraft((d) => ({ ...d, [key]: next }));
  };

  const save = async () => {
    try {
      await updateItem(item.id, draft);
      onChanged();
    } catch (e) {
      setError(String(e));
    }
  };

  const remove = async () => {
    if (!window.confirm(`Delete "${item.title}" and any child stories?`)) return;
    await deleteItem(item.id);
    onChanged();
  };

  return (
    <Drawer onClose={onClose}>
      <div className="mb-4 flex items-center justify-between">
        <span className="rounded bg-blue-100 px-2 py-0.5 text-xs text-blue-800">
          {item.type ?? item.kind}
        </span>
        {item.wsjf_score != null && (
          <span className="text-sm font-semibold text-gray-700">
            WSJF {item.wsjf_score}
          </span>
        )}
      </div>
      <div className="flex flex-col gap-3">
        <Field label="Title" value={value("title")} onChange={(v) => set("title", v)} />
        <Field label="Status" value={value("status")} onChange={(v) => set("status", v)} />
        <Field label="Iteration" value={value("iteration")} onChange={(v) => set("iteration", v)} />
        <Field label="Leading Team" value={value("leading_team")} onChange={(v) => set("leading_team", v)} />
        <Field label="Assignee" value={value("assignee")} onChange={(v) => set("assignee", v)} />
        <Field label="Story Points" type="number" value={value("story_points")} onChange={(v) => set("story_points", v)} />
        <Field label="Business Value" type="number" value={value("business_value")} onChange={(v) => set("business_value", v)} />
        <Field label="Time Criticality" type="number" value={value("time_criticality")} onChange={(v) => set("time_criticality", v)} />
        <Field label="Risk Reduction" type="number" value={value("risk_reduction")} onChange={(v) => set("risk_reduction", v)} />
        <Field label="Job Size" type="number" value={value("job_size")} onChange={(v) => set("job_size", v)} />
      </div>

      {item.children && item.children.length > 0 && (
        <div className="mt-5">
          <h3 className="mb-2 text-sm font-semibold text-gray-700">Stories</h3>
          <ul className="flex flex-col gap-1">
            {item.children.map((child) => (
              <li key={child.id} className="rounded bg-gray-50 px-2 py-1 text-sm">
                {child.title}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-6 flex gap-2">
        <button onClick={save} className="rounded bg-blue-600 px-4 py-1.5 text-sm font-medium text-white">
          Save
        </button>
        <button onClick={remove} className="rounded bg-red-50 px-4 py-1.5 text-sm font-medium text-red-700">
          Delete
        </button>
      </div>
    </Drawer>
  );
}

function Drawer({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-10 flex justify-end bg-black/30" onClick={onClose}>
      <aside
        className="h-full w-96 overflow-y-auto bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </aside>
    </div>
  );
}
```

- [ ] **Step 5: Wire the drawer into `frontend/src/App.tsx`**

```tsx
import { useState } from "react";
import Board from "./components/Board";
import ItemDrawer from "./components/ItemDrawer";

export default function App() {
  const [openItemId, setOpenItemId] = useState<number | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const handleChanged = () => {
    setOpenItemId(null);
    setRefreshKey((k) => k + 1);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b bg-white px-6 py-4">
        <h1 className="text-lg font-semibold text-gray-900">SAFe Kanban</h1>
      </header>
      <Board key={refreshKey} onOpenCard={setOpenItemId} />
      {openItemId != null && (
        <ItemDrawer
          itemId={openItemId}
          onClose={() => setOpenItemId(null)}
          onChanged={handleChanged}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 6: Run drawer tests + full suite**

Run: `cd frontend && npm run test`
Expected: PASS — drawer load/save/delete + all earlier tests.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/
git commit -m "feat(frontend): item detail drawer with edit, WSJF display, and delete"
```

---

### Task 5: Create items + manage child stories

**Files:**
- Create: `frontend/src/components/NewItemBar.tsx`
- Modify: `frontend/src/components/ItemDrawer.tsx`
- Modify: `frontend/src/App.tsx`
- Create: `frontend/src/components/NewItemBar.test.tsx`
- Create: `frontend/src/components/ItemDrawerStories.test.tsx`

**Interfaces:**
- Consumes: `createItem`, `deleteItem` from `api/client`.
- Produces:
  - `NewItemBar({ onCreated })` — buttons "New Feature" and "New Risk"; on click prompts for a title and calls `createItem({ kind, title, status: "Funnel" })` then `onCreated()`.
  - `ItemDrawer` gains an "Add story" control (only when `kind === "feature"`) that calls `createItem({ kind: "story", title, parent_id: item.id })` and reloads the drawer; each child row gets a delete (×) button calling `deleteItem`.

- [ ] **Step 1: Write failing test `frontend/src/components/NewItemBar.test.tsx`**

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import * as client from "../api/client";
import NewItemBar from "./NewItemBar";

afterEach(() => vi.restoreAllMocks());

it("creates a feature with the prompted title", async () => {
  const create = vi.spyOn(client, "createItem").mockResolvedValue({ id: 1 } as never);
  vi.spyOn(window, "prompt").mockReturnValue("Brand New Feature");
  const onCreated = vi.fn();
  render(<NewItemBar onCreated={onCreated} />);
  await userEvent.click(screen.getByRole("button", { name: /new feature/i }));
  expect(create).toHaveBeenCalledWith(
    expect.objectContaining({ kind: "feature", title: "Brand New Feature" }),
  );
  expect(onCreated).toHaveBeenCalled();
});

it("does nothing if the prompt is cancelled", async () => {
  const create = vi.spyOn(client, "createItem").mockResolvedValue({ id: 1 } as never);
  vi.spyOn(window, "prompt").mockReturnValue(null);
  render(<NewItemBar onCreated={() => {}} />);
  await userEvent.click(screen.getByRole("button", { name: /new risk/i }));
  expect(create).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm run test -- src/components/NewItemBar.test.tsx`
Expected: FAIL — cannot resolve `./NewItemBar`.

- [ ] **Step 3: Create `frontend/src/components/NewItemBar.tsx`**

```tsx
import { createItem } from "../api/client";
import type { ItemKind } from "../types";

export default function NewItemBar({ onCreated }: { onCreated: () => void }) {
  const add = async (kind: ItemKind) => {
    const title = window.prompt(`New ${kind} title`);
    if (!title) return;
    await createItem({ kind, title, status: "Funnel" });
    onCreated();
  };
  return (
    <div className="flex gap-2">
      <button
        onClick={() => add("feature")}
        className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white"
      >
        + New Feature
      </button>
      <button
        onClick={() => add("risk")}
        className="rounded bg-red-600 px-3 py-1.5 text-sm font-medium text-white"
      >
        + New Risk
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Write failing test `frontend/src/components/ItemDrawerStories.test.tsx`**

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import * as client from "../api/client";
import ItemDrawer from "./ItemDrawer";

afterEach(() => vi.restoreAllMocks());

const feature = {
  id: 5, kind: "feature", type: "Feature", title: "F", status: "Analyzing",
  wsjf_score: null, business_value: null, time_criticality: null,
  risk_reduction: null, cost_of_delay: null, job_size: null, parent_id: null,
  position: 0, description: null, iteration: null, leading_team: null,
  story_points: null, tshirt_size: null, kategorie: null, art: null,
  sdi_prio: null, supporting_team: null, externer_partner: null, assignee: null,
  akzeptanzkriterien: null, dependencies: null, bo_stakeholder: null,
  definition_of_done: null,
  children: [{ id: 6, kind: "story", title: "Existing Story", parent_id: 5 }],
};

it("adds a child story to the feature", async () => {
  vi.spyOn(client, "getItem").mockResolvedValue(feature as never);
  const create = vi.spyOn(client, "createItem").mockResolvedValue({ id: 7 } as never);
  vi.spyOn(window, "prompt").mockReturnValue("Fresh Story");
  render(<ItemDrawer itemId={5} onClose={() => {}} onChanged={() => {}} />);

  await screen.findByText("Existing Story");
  await userEvent.click(screen.getByRole("button", { name: /add story/i }));
  expect(create).toHaveBeenCalledWith(
    expect.objectContaining({ kind: "story", title: "Fresh Story", parent_id: 5 }),
  );
});

it("deletes a child story", async () => {
  vi.spyOn(client, "getItem").mockResolvedValue(feature as never);
  const del = vi.spyOn(client, "deleteItem").mockResolvedValue();
  render(<ItemDrawer itemId={5} onClose={() => {}} onChanged={() => {}} />);
  await screen.findByText("Existing Story");
  await userEvent.click(screen.getByRole("button", { name: /remove story 6/i }));
  expect(del).toHaveBeenCalledWith(6);
});
```

- [ ] **Step 5: Add story management to `ItemDrawer.tsx`**

Add `createItem` to the import from `../api/client`:
```tsx
import { createItem, deleteItem, getItem, updateItem } from "../api/client";
```

Add a `reload` helper and replace the existing Stories block. Inside the component, after the `useEffect`, add:
```tsx
  const reloadItem = async () => setItem(await getItem(itemId));

  const addStory = async () => {
    const title = window.prompt("New story title");
    if (!title) return;
    await createItem({ kind: "story", title, parent_id: itemId });
    await reloadItem();
  };

  const removeStory = async (storyId: number) => {
    await deleteItem(storyId);
    await reloadItem();
  };
```

Replace the `{item.children && ...}` Stories block with:
```tsx
      {item.kind === "feature" && (
        <div className="mt-5">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-700">Stories</h3>
            <button
              onClick={addStory}
              className="rounded bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700"
            >
              + Add story
            </button>
          </div>
          <ul className="flex flex-col gap-1">
            {(item.children ?? []).map((child) => (
              <li
                key={child.id}
                className="flex items-center justify-between rounded bg-gray-50 px-2 py-1 text-sm"
              >
                <span>{child.title}</span>
                <button
                  aria-label={`remove story ${child.id}`}
                  onClick={() => removeStory(child.id)}
                  className="text-gray-400 hover:text-red-600"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
```

- [ ] **Step 6: Add `NewItemBar` to the header in `frontend/src/App.tsx`**

Replace the `<header>` block with:
```tsx
      <header className="flex items-center justify-between border-b bg-white px-6 py-4">
        <h1 className="text-lg font-semibold text-gray-900">SAFe Kanban</h1>
        <NewItemBar onCreated={handleChanged} />
      </header>
```
And add the import at the top:
```tsx
import NewItemBar from "./components/NewItemBar";
```

- [ ] **Step 7: Run the full suite**

Run: `cd frontend && npm run test`
Expected: PASS — NewItemBar (2) + drawer story add/delete (2) + all earlier tests.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/
git commit -m "feat(frontend): create features/risks and manage child stories"
```

---

### Task 6: Toolbar filters + title search

**Files:**
- Create: `frontend/src/components/Toolbar.tsx`
- Modify: `frontend/src/hooks/useBoard.ts`
- Modify: `frontend/src/components/Board.tsx`
- Modify: `frontend/src/App.tsx`
- Create: `frontend/src/components/Toolbar.test.tsx`

**Interfaces:**
- Produces:
  - `BoardFilters` type `{ iteration?: string; leading_team?: string; kind?: ItemKind; q?: string }`.
  - `Toolbar({ filters, onChange })` — text search input + iteration/team/kind selects; calls `onChange(nextFilters)`.
  - `useBoard(filters?)` — applies filters client-side to the fetched board (drops cards that don't match; keeps all columns).
  - `Board({ filters, onOpenCard })` passes filters to `useBoard`.

- [ ] **Step 1: Write failing test `frontend/src/components/Toolbar.test.tsx`**

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import Toolbar from "./Toolbar";

it("emits the search query on type", async () => {
  const onChange = vi.fn();
  render(<Toolbar filters={{}} onChange={onChange} iterations={["PI1-Q3"]} teams={["Network"]} />);
  await userEvent.type(screen.getByPlaceholderText(/search/i), "teton");
  expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ q: "teton" }));
});

it("emits an iteration filter on select", async () => {
  const onChange = vi.fn();
  render(<Toolbar filters={{}} onChange={onChange} iterations={["PI1-Q3"]} teams={["Network"]} />);
  await userEvent.selectOptions(screen.getByLabelText(/iteration/i), "PI1-Q3");
  expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ iteration: "PI1-Q3" }));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm run test -- src/components/Toolbar.test.tsx`
Expected: FAIL — cannot resolve `./Toolbar`.

- [ ] **Step 3: Create `frontend/src/components/Toolbar.tsx`**

```tsx
import type { ItemKind } from "../types";

export interface BoardFilters {
  iteration?: string;
  leading_team?: string;
  kind?: ItemKind;
  q?: string;
}

export default function Toolbar({
  filters,
  onChange,
  iterations,
  teams,
}: {
  filters: BoardFilters;
  onChange: (next: BoardFilters) => void;
  iterations: string[];
  teams: string[];
}) {
  const set = (patch: Partial<BoardFilters>) =>
    onChange({ ...filters, ...patch });

  return (
    <div className="flex flex-wrap items-end gap-3 border-b bg-white px-6 py-3">
      <input
        placeholder="Search title…"
        value={filters.q ?? ""}
        onChange={(e) => set({ q: e.target.value })}
        className="rounded border border-gray-300 px-2 py-1 text-sm"
      />
      <label className="text-xs text-gray-500">
        Iteration
        <select
          value={filters.iteration ?? ""}
          onChange={(e) => set({ iteration: e.target.value || undefined })}
          className="ml-1 rounded border border-gray-300 px-1 py-1 text-sm"
        >
          <option value="">All</option>
          {iterations.map((it) => (
            <option key={it} value={it}>{it}</option>
          ))}
        </select>
      </label>
      <label className="text-xs text-gray-500">
        Team
        <select
          value={filters.leading_team ?? ""}
          onChange={(e) => set({ leading_team: e.target.value || undefined })}
          className="ml-1 rounded border border-gray-300 px-1 py-1 text-sm"
        >
          <option value="">All</option>
          {teams.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </label>
      <label className="text-xs text-gray-500">
        Kind
        <select
          value={filters.kind ?? ""}
          onChange={(e) =>
            set({ kind: (e.target.value || undefined) as ItemKind | undefined })
          }
          className="ml-1 rounded border border-gray-300 px-1 py-1 text-sm"
        >
          <option value="">All</option>
          <option value="feature">Feature</option>
          <option value="risk">Risk</option>
        </select>
      </label>
    </div>
  );
}
```

- [ ] **Step 4: Make `useBoard` filter-aware — replace `frontend/src/hooks/useBoard.ts`**

```ts
import { useCallback, useEffect, useMemo, useState } from "react";
import { getBoard } from "../api/client";
import type { BoardColumn } from "../types";
import type { BoardFilters } from "../components/Toolbar";

function matches(card: BoardColumn["cards"][number], f: BoardFilters): boolean {
  if (f.kind && card.kind !== f.kind) return false;
  if (f.iteration && card.iteration !== f.iteration) return false;
  if (f.leading_team && card.leading_team !== f.leading_team) return false;
  if (f.q && !card.title.toLowerCase().includes(f.q.toLowerCase())) return false;
  return true;
}

export function useBoard(filters: BoardFilters = {}) {
  const [columns, setColumns] = useState<BoardColumn[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setColumns(await getBoard());
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

  const filtered = useMemo(
    () =>
      columns.map((col) => ({
        ...col,
        cards: col.cards.filter((card) => matches(card, filters)),
      })),
    [columns, filters],
  );

  return { columns: filtered, raw: columns, loading, error, reload, setColumns };
}
```

- [ ] **Step 5: Pass filters through `Board` — update `frontend/src/components/Board.tsx`**

Change the component signature and `useBoard` call:
```tsx
import { DndContext, type DragEndEvent } from "@dnd-kit/core";
import { useBoard } from "../hooks/useBoard";
import { updateItem } from "../api/client";
import type { BoardFilters } from "./Toolbar";
import Column from "./Column";

export async function handleDragEnd(
  event: DragEndEvent,
  reload: () => Promise<void>,
): Promise<void> {
  if (!event.over) return;
  const cardId = Number(event.active.id);
  const targetStatus = String(event.over.id);
  await updateItem(cardId, { status: targetStatus });
  await reload();
}

export default function Board({
  filters = {},
  onOpenCard,
}: {
  filters?: BoardFilters;
  onOpenCard: (id: number) => void;
}) {
  const { columns, loading, error, reload } = useBoard(filters);

  if (loading) return <div className="p-8 text-gray-500">Loading board…</div>;
  if (error) return <div className="p-8 text-red-600">{error}</div>;

  return (
    <DndContext onDragEnd={(event) => void handleDragEnd(event, reload)}>
      <div className="flex gap-4 overflow-x-auto p-6">
        {columns.map((column) => (
          <Column key={column.status} column={column} onOpenCard={onOpenCard} />
        ))}
      </div>
    </DndContext>
  );
}
```

- [ ] **Step 6: Render `Toolbar` in `frontend/src/App.tsx`**

Add state + derive option lists from a fetched item list. Replace the App body:
```tsx
import { useEffect, useState } from "react";
import Board from "./components/Board";
import ItemDrawer from "./components/ItemDrawer";
import NewItemBar from "./components/NewItemBar";
import Toolbar, { type BoardFilters } from "./components/Toolbar";
import { listItems } from "./api/client";

export default function App() {
  const [openItemId, setOpenItemId] = useState<number | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [filters, setFilters] = useState<BoardFilters>({});
  const [iterations, setIterations] = useState<string[]>([]);
  const [teams, setTeams] = useState<string[]>([]);

  useEffect(() => {
    void listItems().then((items) => {
      setIterations([...new Set(items.map((i) => i.iteration).filter(Boolean) as string[])].sort());
      setTeams([...new Set(items.map((i) => i.leading_team).filter(Boolean) as string[])].sort());
    });
  }, [refreshKey]);

  const handleChanged = () => {
    setOpenItemId(null);
    setRefreshKey((k) => k + 1);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="flex items-center justify-between border-b bg-white px-6 py-4">
        <h1 className="text-lg font-semibold text-gray-900">SAFe Kanban</h1>
        <NewItemBar onCreated={handleChanged} />
      </header>
      <Toolbar filters={filters} onChange={setFilters} iterations={iterations} teams={teams} />
      <Board key={refreshKey} filters={filters} onOpenCard={setOpenItemId} />
      {openItemId != null && (
        <ItemDrawer
          itemId={openItemId}
          onClose={() => setOpenItemId(null)}
          onChanged={handleChanged}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 7: Run the full suite**

Run: `cd frontend && npm run test`
Expected: PASS — Toolbar (2) + all earlier tests (board test still renders with no filters).

- [ ] **Step 8: Commit**

```bash
git add frontend/src/
git commit -m "feat(frontend): toolbar filters and title search over the board"
```

---

### Task 7: CSV import button with confirm + result toast

**Files:**
- Create: `frontend/src/components/ImportButton.tsx`
- Modify: `frontend/src/App.tsx`
- Create: `frontend/src/components/ImportButton.test.tsx`

**Interfaces:**
- Consumes: `importCsv` from `api/client`.
- Produces: `ImportButton({ onImported })` — a hidden file input + button; after a file is chosen it shows a confirm dialog ("This deletes all current items…"); on confirm calls `importCsv(file)`, then calls `onImported(result)`. Displays an inline status message with the returned counts (and warning count).

- [ ] **Step 1: Write failing test `frontend/src/components/ImportButton.test.tsx`**

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import * as client from "../api/client";
import ImportButton from "./ImportButton";

afterEach(() => vi.restoreAllMocks());

it("imports the chosen file after confirm and reports counts", async () => {
  const importSpy = vi.spyOn(client, "importCsv").mockResolvedValue({
    features: 40, stories: 60, risks: 8, warnings: ["w1"],
  });
  vi.spyOn(window, "confirm").mockReturnValue(true);
  const onImported = vi.fn();
  render(<ImportButton onImported={onImported} />);

  const file = new File(["Title\nX"], "plan.csv", { type: "text/csv" });
  await userEvent.upload(screen.getByLabelText(/import csv/i), file);

  expect(importSpy).toHaveBeenCalledWith(file);
  expect(onImported).toHaveBeenCalled();
  expect(await screen.findByText(/40 features/i)).toBeInTheDocument();
  expect(screen.getByText(/1 warning/i)).toBeInTheDocument();
});

it("aborts when the confirm dialog is cancelled", async () => {
  const importSpy = vi.spyOn(client, "importCsv").mockResolvedValue({
    features: 0, stories: 0, risks: 0, warnings: [],
  });
  vi.spyOn(window, "confirm").mockReturnValue(false);
  render(<ImportButton onImported={() => {}} />);
  const file = new File(["x"], "plan.csv", { type: "text/csv" });
  await userEvent.upload(screen.getByLabelText(/import csv/i), file);
  expect(importSpy).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm run test -- src/components/ImportButton.test.tsx`
Expected: FAIL — cannot resolve `./ImportButton`.

- [ ] **Step 3: Create `frontend/src/components/ImportButton.tsx`**

```tsx
import { useRef, useState } from "react";
import { importCsv } from "../api/client";
import type { ImportResult } from "../types";

export default function ImportButton({
  onImported,
}: {
  onImported: (result: ImportResult) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<string | null>(null);

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!window.confirm("This deletes all current items and reloads from the file. Continue?")) {
      return;
    }
    try {
      const result = await importCsv(file);
      setStatus(
        `Imported ${result.features} features, ${result.stories} stories, ` +
          `${result.risks} risks` +
          (result.warnings.length ? ` — ${result.warnings.length} warning(s)` : ""),
      );
      onImported(result);
    } catch (err) {
      setStatus(`Import failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return (
    <div className="flex items-center gap-3">
      <label className="cursor-pointer rounded border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700">
        Import CSV
        <input
          ref={inputRef}
          type="file"
          accept=".csv"
          aria-label="Import CSV"
          onChange={onFile}
          className="hidden"
        />
      </label>
      {status && <span className="text-xs text-gray-500">{status}</span>}
    </div>
  );
}
```

- [ ] **Step 4: Add `ImportButton` to the header in `frontend/src/App.tsx`**

Add the import:
```tsx
import ImportButton from "./components/ImportButton";
```
Replace the header's right side so it holds both controls:
```tsx
      <header className="flex items-center justify-between border-b bg-white px-6 py-4">
        <h1 className="text-lg font-semibold text-gray-900">SAFe Kanban</h1>
        <div className="flex items-center gap-3">
          <ImportButton onImported={handleChanged} />
          <NewItemBar onCreated={handleChanged} />
        </div>
      </header>
```

- [ ] **Step 5: Run the FULL test suite**

Run: `cd frontend && npm run test`
Expected: PASS — ImportButton (2) + every earlier test.

- [ ] **Step 6: Verify the production build compiles**

Run: `cd frontend && npm run build`
Expected: `tsc -b` passes with no type errors and Vite emits `dist/`.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/
git commit -m "feat(frontend): CSV import button with confirm and result summary"
```

---

## Self-Review Notes

- **Spec coverage:** board grouped by status → Tasks 2 & 6; cards surface title/type/WSJF/points/team/iteration/child-count → Tasks 2 & 3; drag to change status → Task 3; detail drawer with full edit + WSJF display → Task 4; create items + child-story add/delete → Task 5; filters (iteration/team/kind) + title search → Task 6; CSV import with confirm dialog + result summary → Task 7; toasts/inline status + confirm on destructive actions → Tasks 4 & 7. No auth — correctly absent.
- **Placeholder scan:** every component and test contains complete code; no TODO/TBD.
- **Type consistency:** `BoardCard`/`BoardColumn`/`Item`/`ItemUpdate`, the `api/client` function names (`getBoard`, `getItem`, `createItem`, `updateItem`, `deleteItem`, `importCsv`, `listItems`), `handleDragEnd`, `useBoard(filters)`, and `BoardFilters` are referenced identically across tasks.
- **Backend dependency:** consumes the endpoints delivered by `2026-06-30-safe-kanban-backend.md`; run that plan first (or stub the API) before manual end-to-end verification.
- **Reduced-motion / a11y:** card drag uses `@dnd-kit` defaults; buttons carry `aria-label`s where text is an icon (`×`, file input).
