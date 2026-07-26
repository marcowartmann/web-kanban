# UI Refresh A — App Shell & Page Grammar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the header pill nav with a routed, collapsible grouped sidebar and give every view the same page anatomy (PageHeader → tabs → filter bar → content), per `docs/superpowers/specs/2026-07-26-ui-refresh-shell-design.md`.

**Architecture:** react-router v7 (library mode) provides real paths for all nine views plus `/products/:productId` and `/admin/:section`. Shared board state moves from `App.tsx` into a `WorkLayout` route layout exposed via outlet context. New `shell/` components: `Sidebar` (grouped, collapsible, user menu + theme in footer), `PageHeader` (title/subtitle/backTo/actions), `WorkLayout`, `nav.ts` config.

**Tech Stack:** React 18 + Vite + TypeScript + Tailwind v4, react-router v7, Vitest + Testing Library, FontAwesome Pro duotone via `src/icons.ts`.

## Global Constraints

- Branch: `feat/ui-shell`, created off `main` in Task 1.
- **FontAwesome token**: before ANY `npm install`/`npm ci`/`docker compose build frontend`, run `export FONTAWESOME_PACKAGE_TOKEN=$(tr -d '\n' < frontend/.fa-token)` (from repo root). Never echo or commit the token.
- Router package is `react-router` **v7**; all imports from `"react-router"` (NOT `react-router-dom`).
- Icons only through `frontend/src/icons.ts` re-exports of `@fortawesome/pro-duotone-svg-icons`. Never import an FA package directly in a component.
- Never use native `<select>`/`window.confirm`; use PlainSelect/SearchableSelect/FilterSelect/ConfirmDialog.
- Never append a conflicting utility (second `px-*`/`py-*`) to a token from `ui.ts` (see the header comment in that file).
- CWD discipline: `npm`/`npx vitest` from `frontend/`, `git` from repo root.
- localStorage key for the sidebar: `"jamra.sidebarCollapsed"` (`"1"` collapsed / `"0"` expanded).
- Components using router hooks/`Link` must be wrapped in `MemoryRouter` in tests.
- All frontend tests green after every task: `npm run test` (411 tests at branch start; count grows). `App.auth.test.tsx` has a known pre-existing unhandled-rejection flake — judge by pass/fail counts.

---

### Task 1: Routing skeleton behind the existing nav

**Files:**
- Modify: `frontend/package.json` (via npm install)
- Modify: `frontend/src/App.tsx`
- Create: `frontend/src/App.routes.test.tsx`
- Modify: `frontend/src/App.auth.test.tsx`

**Interfaces:**
- Consumes: existing `AppShell`-less `App.tsx` (view switch via `useState<View>`).
- Produces: `export default App` (wraps `BrowserRouter`) and `export function AppShell()` (everything else) — later tasks render `AppShell` inside `MemoryRouter` in tests. Paths: `/board`, `/planning`, `/timeline`, `/ranking`, `/products`, `/lifecycle`, `/contracts`, `/roadmap`, `/admin/*` (admin-gated), `*`→`/board`.

- [ ] **Step 1: Branch + dependency**

```bash
cd /Users/marco/Coding/web-kanban && git checkout -b feat/ui-shell
export FONTAWESOME_PACKAGE_TOKEN=$(tr -d '\n' < frontend/.fa-token)
cd frontend && npm install react-router
```

Expected: `react-router` v7.x lands in `package.json` dependencies.

- [ ] **Step 2: Write the failing route tests**

Create `frontend/src/App.routes.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import * as client from "./api/client";
import { AppShell } from "./App";
import { AuthProvider } from "./auth/AuthContext";
import { ThemeProvider } from "./theme/ThemeContext";

afterEach(() => vi.restoreAllMocks());

export function mockAppData(role: "admin" | "member" = "admin") {
  vi.spyOn(client, "getMe").mockResolvedValue(
    { id: 1, email: "u@x.ch", display_name: "U", role, team_id: 1, is_active: true } as never,
  );
  vi.spyOn(client, "getBoards").mockResolvedValue([] as never);
  vi.spyOn(client, "listItems").mockResolvedValue([] as never);
  vi.spyOn(client, "listLinks").mockResolvedValue([] as never);
  vi.spyOn(client, "getPlanningIntervals").mockResolvedValue([] as never);
  vi.spyOn(client, "getPersonOptions").mockResolvedValue([] as never);
  vi.spyOn(client, "getTeams").mockResolvedValue([] as never);
  vi.spyOn(client, "getContainers").mockResolvedValue([] as never);
  vi.spyOn(client, "getDepartments").mockResolvedValue([] as never);
  vi.spyOn(client, "getObjectiveLinkedFeatures").mockResolvedValue([] as never);
  vi.spyOn(client, "getProducts").mockResolvedValue([] as never);
  vi.spyOn(client, "getLifecycle").mockResolvedValue([] as never);
  vi.spyOn(client, "getContracts").mockResolvedValue([] as never);
  vi.spyOn(client, "listUsers").mockResolvedValue([] as never);
}

export function renderAt(path: string, role: "admin" | "member" = "admin") {
  mockAppData(role);
  render(
    <ThemeProvider>
      <AuthProvider>
        <MemoryRouter initialEntries={[path]}>
          <AppShell />
        </MemoryRouter>
      </AuthProvider>
    </ThemeProvider>,
  );
}

it("deep link renders the Roadmap view", async () => {
  renderAt("/roadmap");
  expect(await screen.findByRole("link", { name: "Roadmap" })).toHaveAttribute("aria-current", "page");
  expect(await screen.findByText(/no streams yet/i)).toBeInTheDocument();
});

it("the root path lands on the Board", async () => {
  renderAt("/");
  expect(await screen.findByRole("link", { name: "Board" })).toHaveAttribute("aria-current", "page");
});

it("unknown paths land on the Board", async () => {
  renderAt("/nope");
  expect(await screen.findByRole("link", { name: "Board" })).toHaveAttribute("aria-current", "page");
});

it("members deep-linking to /admin are redirected to the Board", async () => {
  renderAt("/admin", "member");
  expect(await screen.findByRole("link", { name: "Board" })).toHaveAttribute("aria-current", "page");
  expect(screen.queryByRole("link", { name: "Admin" })).not.toBeInTheDocument();
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run src/App.routes.test.tsx`
Expected: FAIL — `AppShell` is not exported.

- [ ] **Step 4: Convert App.tsx to routes**

In `frontend/src/App.tsx`:

1. Replace the react import line's neighbors — add router imports and split the component:

```tsx
import { BrowserRouter, Navigate, NavLink, Route, Routes, useLocation } from "react-router";
```

2. Delete the `type View = …` union, the `const [view, setView] = useState<View>("board")` line, and the `navButton` helper. Add instead (inside the component, same place `navButton` was):

```tsx
  const { pathname } = useLocation();

  const navLink = (target: string, label: string) => (
    <NavLink
      to={target}
      className={({ isActive }) =>
        `rounded-md px-3 py-1.5 text-sm font-medium transition focus:outline-hidden focus:ring-2 focus:ring-blue-100 ${
          isActive ? "bg-surface text-gray-900 shadow-xs" : "text-gray-500 hover:text-gray-700"
        }`
      }
    >
      {label}
    </NavLink>
  );
```

3. Rename the existing `export default function App()` to `export function AppShell()` and append at the bottom of the file:

```tsx
export default function App() {
  return (
    <BrowserRouter>
      <AppShell />
    </BrowserRouter>
  );
}
```

4. In the header nav, replace every `{navButton("board", "Board")}` etc. with `{navLink("/board", "Board")}` … `{isAdmin && navLink("/admin", "Admin")}`.

5. NewItemBar visibility: `{pathname === "/board" && <NewItemBar onCreated={handleChanged} />}`.

6. Replace the whole `{view === "admin" ? … : null}` conditional chain with a `Routes` block. The board branch becomes a const **above** the `return`:

```tsx
  const boardElement =
    loading && !activeBoard ? (
      <div className="p-8 text-gray-500">Loading board…</div>
    ) : error ? (
      <div className="p-8 text-red-600">{error}</div>
    ) : activeBoard ? (
      <>
        <BoardTabs
          boards={boards}
          activeId={objectivesTab ? null : activeBoardId}
          onSelect={selectBoard}
          objectivesActive={objectivesTab}
          onSelectObjectives={() => setObjectivesTab(true)}
        />
        {objectivesTab ? (
          <PIObjectivesBoard
            teams={teamOptions}
            planningIntervals={planningIntervals}
            user={user}
            features={items.filter((i) => i.kind === "feature")}
            onChanged={handleChanged}
          />
        ) : (
          <>
            <Toolbar
              filters={filters}
              onChange={setFilters}
              planningIntervals={planningIntervals}
              teams={teams}
              assignees={assignees}
              containerNames={containerNames}
              departmentNames={departmentNames}
              kindOptions={activeBoard.kinds}
            />
            <BoardView
              board={activeBoard}
              items={items}
              links={links}
              filters={filters}
              containers={containers}
              onOpenCard={openItem}
              onOpenStories={setOpenStoriesFeatureId}
              onChanged={handleChanged}
              canEditLanes={isAdmin}
            />
          </>
        )}
      </>
    ) : null;
```

and in the JSX where the conditional chain was:

```tsx
      <Routes>
        <Route path="/board" element={boardElement} />
        <Route
          path="/planning"
          element={
            <PlanningView
              items={items}
              links={links}
              planningIntervals={planningIntervals}
              departmentNames={departmentNames}
              onOpenCard={openItem}
              onChanged={handleChanged}
            />
          }
        />
        <Route
          path="/timeline"
          element={
            <TimelineView
              items={items}
              links={links}
              planningIntervals={planningIntervals}
              departmentNames={departmentNames}
              onOpenCard={openItem}
              onChanged={handleChanged}
            />
          }
        />
        <Route
          path="/ranking"
          element={
            <RankingView
              items={items}
              planningIntervals={planningIntervals}
              teams={teams}
              containers={containers}
              departmentNames={departmentNames}
              user={user}
              onOpenCard={openItem}
              onChanged={handleChanged}
            />
          }
        />
        <Route path="/products" element={<ProductsView />} />
        <Route path="/lifecycle" element={<LifecycleView />} />
        <Route path="/contracts" element={<ContractsView />} />
        <Route path="/roadmap" element={<RoadmapView />} />
        <Route
          path="/admin/*"
          element={
            isAdmin ? (
              <div className="min-h-0 flex-1 overflow-auto">
                <AdminView onChanged={handleChanged} planningIntervals={planningIntervals} />
              </div>
            ) : (
              <Navigate to="/board" replace />
            )
          }
        />
        <Route path="*" element={<Navigate to="/board" replace />} />
      </Routes>
```

The `StoryBoardModal`/`ItemDrawer` overlay blocks after the Routes stay exactly as they are.

- [ ] **Step 5: Update App.auth.test.tsx**

The nav entries are links now, and App.tsx always calls `getDepartments`/`getObjectiveLinkedFeatures` (previously unmocked — the source of the known flake). In `mockAppData` add:

```tsx
  vi.spyOn(client, "getDepartments").mockResolvedValue([] as never);
  vi.spyOn(client, "getObjectiveLinkedFeatures").mockResolvedValue([] as never);
```

and change the two `role: "button", name: "Admin"` queries to `role: "link", name: "Admin"` (the click target and the members-don't-see-it assertion).

- [ ] **Step 6: Run tests**

Run: `npx vitest run src/App.routes.test.tsx src/App.auth.test.tsx`
Expected: PASS. Then full suite: `npm run test` — all green.

- [ ] **Step 7: Commit**

```bash
cd /Users/marco/Coding/web-kanban && git add frontend && git commit -m "feat(shell): route all nine views with react-router behind the existing nav"
```

---

### Task 2: Admin section routes (`/admin/:section`)

**Files:**
- Modify: `frontend/src/App.tsx` (admin routes)
- Modify: `frontend/src/components/admin/AdminView.tsx`
- Modify: `frontend/src/App.routes.test.tsx`

**Interfaces:**
- Consumes: `AppShell` routes from Task 1; `SECTIONS` array in AdminView (ids: users, teams, intervals, containers, catalog, import, snapshots, backup, ldap, audit).
- Produces: `/admin` → `/admin/users` redirect; `/admin/:section` renders AdminView with the section from the URL; unknown sections → `/admin/users`. AdminView's sidebar uses `NavLink`s.

- [ ] **Step 1: Write the failing tests** (append to `App.routes.test.tsx`)

```tsx
it("/admin redirects to the Users section", async () => {
  renderAt("/admin");
  expect(await screen.findByRole("link", { name: "Users" })).toHaveAttribute("aria-current", "page");
});

it("/admin/import deep-links to the Import section", async () => {
  renderAt("/admin/import");
  expect(await screen.findByRole("heading", { name: /import csv/i })).toBeInTheDocument();
});

it("unknown admin sections fall back to Users", async () => {
  renderAt("/admin/bogus");
  expect(await screen.findByRole("link", { name: "Users" })).toHaveAttribute("aria-current", "page");
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/App.routes.test.tsx`
Expected: the three new tests FAIL (sidebar entries are buttons, no redirect).

- [ ] **Step 3: Implement**

In `App.tsx`, replace the single `/admin/*` route with:

```tsx
        <Route
          path="/admin"
          element={isAdmin ? <Navigate to="/admin/users" replace /> : <Navigate to="/board" replace />}
        />
        <Route
          path="/admin/:section"
          element={
            isAdmin ? (
              <div className="min-h-0 flex-1 overflow-auto">
                <AdminView onChanged={handleChanged} planningIntervals={planningIntervals} />
              </div>
            ) : (
              <Navigate to="/board" replace />
            )
          }
        />
```

In `AdminView.tsx`:

```tsx
import { Navigate, NavLink, useParams } from "react-router";
```

Replace `const [section, setSection] = useState<AdminSection>("users");` with:

```tsx
  const params = useParams();
  const section = SECTIONS.some((s) => s.id === params.section)
    ? (params.section as AdminSection)
    : null;
```

Directly after the `capacityKey` state line add the fallback:

```tsx
  if (!section) return <Navigate to="/admin/users" replace />;
```

Replace the sidebar `<button onClick={() => setSection(s.id)} …>` with:

```tsx
                <NavLink
                  to={`/admin/${s.id}`}
                  className={({ isActive }) =>
                    `flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition focus:outline-hidden focus:ring-2 focus:ring-blue-100 ${
                      isActive
                        ? "bg-blue-50 font-medium text-blue-700"
                        : "text-gray-600 hover:bg-gray-100"
                    }`
                  }
                >
                  <FontAwesomeIcon icon={s.icon} fixedWidth aria-hidden className="text-gray-400" />
                  {s.label}
                </NavLink>
```

(the `section === s.id` comparison and `setSection` disappear; everything below that keys off the derived `section` unchanged).

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/App.routes.test.tsx src/App.auth.test.tsx`
Expected: PASS. The auth test clicks the "Admin" **link** and lands on `/admin` → redirect → Users; the "Import CSV" navigation inside it now clicks a link too — if that test clicked the sidebar button by `role: "button"`, update it to `role: "link"`.
Then: `npm run test` — all green.

- [ ] **Step 5: Commit**

```bash
cd /Users/marco/Coding/web-kanban && git add frontend && git commit -m "feat(shell): admin sections routed at /admin/:section"
```

---

### Task 3: Product routes (`/products/:productId`)

**Files:**
- Create: `frontend/src/components/ProductDetailPage.tsx`
- Create: `frontend/src/components/ProductDetailPage.test.tsx`
- Modify: `frontend/src/components/ProductsView.tsx` (navigate instead of internal selection)
- Modify: `frontend/src/components/ProductsView.test.tsx` (MemoryRouter wrap)
- Modify: `frontend/src/App.tsx` (add the route)

**Interfaces:**
- Consumes: `getProduct(id: number): Promise<Product>` (`api/client.ts:514`); `ProductDetail` (`{ product: Product; onBack: () => void }`, unchanged in this task).
- Produces: `ProductDetailPage` (no props — reads `:productId`); ProductsView navigates via `useNavigate`.

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/components/ProductDetailPage.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import * as client from "../api/client";
import ProductDetailPage from "./ProductDetailPage";

afterEach(() => vi.restoreAllMocks());

const NETWORK = {
  id: 7, name: "Network", description: null,
  art_id: 1, art_name: "DP", team_id: 1, team_name: "Network", service_count: 2,
} as never;

function renderAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/products/:productId" element={<ProductDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

it("loads the product from the route param and renders its detail", async () => {
  vi.spyOn(client, "getProduct").mockResolvedValue(NETWORK);
  vi.spyOn(client, "getProductServices").mockResolvedValue([] as never);
  renderAt("/products/7");
  expect(await screen.findByRole("heading", { name: "Network" })).toBeInTheDocument();
  expect(client.getProduct).toHaveBeenCalledWith(7);
});

it("unknown product ids show an error with a way back", async () => {
  vi.spyOn(client, "getProduct").mockRejectedValue(new Error("Not found"));
  renderAt("/products/999");
  expect(await screen.findByText("Product not found.")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /back to products/i })).toBeInTheDocument();
});
```

Append to `ProductsView.test.tsx` (and wrap that file's existing `render(<ProductsView />)` calls in `<MemoryRouter><ProductsView /></MemoryRouter>`):

```tsx
it("clicking a product card navigates to its detail route", async () => {
  vi.spyOn(client, "getProducts").mockResolvedValue([
    { id: 7, name: "Network", description: null, art_id: 1, art_name: "DP", team_id: 1, team_name: "Network", service_count: 2 },
  ] as never);
  render(
    <MemoryRouter initialEntries={["/products"]}>
      <Routes>
        <Route path="/products" element={<ProductsView />} />
        <Route path="/products/:productId" element={<div>DETAIL PROBE</div>} />
      </Routes>
    </MemoryRouter>,
  );
  await userEvent.click(await screen.findByText("Network"));
  expect(await screen.findByText("DETAIL PROBE")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/components/ProductDetailPage.test.tsx src/components/ProductsView.test.tsx`
Expected: FAIL (module missing / navigation absent).

- [ ] **Step 3: Implement**

Create `frontend/src/components/ProductDetailPage.tsx`:

```tsx
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { getProduct } from "../api/client";
import type { Product } from "../types";
import ProductDetail from "./ProductDetail";

/** Route wrapper: resolves :productId to a Product, with a not-found state. */
export default function ProductDetailPage() {
  const { productId } = useParams();
  const navigate = useNavigate();
  const [product, setProduct] = useState<Product | null>(null);
  const [error, setError] = useState<string | null>(null);
  const id = Number(productId);

  useEffect(() => {
    if (!Number.isInteger(id)) {
      setError("Product not found.");
      return;
    }
    getProduct(id)
      .then(setProduct)
      .catch(() => setError("Product not found."));
  }, [id]);

  if (error) {
    return (
      <div className="min-h-0 flex-1 overflow-auto px-6 py-6">
        <div className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
        <Link to="/products" className="text-sm text-blue-600 hover:underline">
          ← Back to products
        </Link>
      </div>
    );
  }
  if (!product) return <div className="min-h-0 flex-1 overflow-auto px-6 py-6 text-gray-500">Loading…</div>;
  return <ProductDetail product={product} onBack={() => navigate("/products")} />;
}
```

In `ProductsView.tsx`: add `import { useNavigate } from "react-router";`, delete the `selectedId` state, the `selected` lookup, and the early-return `<ProductDetail …>` block; add `const navigate = useNavigate();` and change the card's `onClick` to `onClick={() => navigate(`/products/${p.id}`)}`. Remove the now-unused `ProductDetail` import.

In `App.tsx` add below the `/products` route:

```tsx
        <Route path="/products/:productId" element={<ProductDetailPage />} />
```

with `import ProductDetailPage from "./components/ProductDetailPage";`.

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/components/ProductDetailPage.test.tsx src/components/ProductsView.test.tsx`, then `npm run test`.
Expected: PASS / all green.

- [ ] **Step 5: Commit**

```bash
cd /Users/marco/Coding/web-kanban && git add frontend && git commit -m "feat(shell): product detail routed at /products/:productId"
```

---

### Task 4: PageHeader component + Board adoption

**Files:**
- Create: `frontend/src/shell/PageHeader.tsx`
- Create: `frontend/src/shell/PageHeader.test.tsx`
- Modify: `frontend/src/App.tsx` (board PageHeader, action lift, header slimming)
- Modify: `frontend/src/components/PIObjectivesBoard.tsx` (controlled team + addSignal)
- Modify: `frontend/src/components/BoardView.tsx` (controlled `laneEditing`, button removed)
- Modify: `frontend/src/components/BoardView.test.tsx`, `frontend/src/App.routes.test.tsx`

**Interfaces:**
- Produces: `PageHeader({ title: string; subtitle?: ReactNode; backTo?: { label: string; to: string }; actions?: ReactNode })` (default export); `canAddObjective(user: AuthUser, team: Team | null): boolean` (named export from PIObjectivesBoard); `PIObjectivesBoard` new props `team: string | null; onTeamChange: (t: string | null) => void; addSignal: number`; `BoardView` new required prop `laneEditing: boolean` (its internal Edit-lanes button and state are removed; `canEditLanes` still gates the editor).

- [ ] **Step 1: Write the failing PageHeader test**

Create `frontend/src/shell/PageHeader.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { expect, it } from "vitest";
import PageHeader from "./PageHeader";

it("renders title, subtitle, back link and actions", () => {
  render(
    <MemoryRouter>
      <PageHeader
        title="Products"
        subtitle="All ARTs"
        backTo={{ label: "Back to products", to: "/products" }}
        actions={<button>Add product</button>}
      />
    </MemoryRouter>,
  );
  expect(screen.getByRole("heading", { name: "Products" })).toBeInTheDocument();
  expect(screen.getByText("All ARTs")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /back to products/i })).toHaveAttribute("href", "/products");
  expect(screen.getByRole("button", { name: "Add product" })).toBeInTheDocument();
});

it("renders without optional parts", () => {
  render(<PageHeader title="Planning" />);
  expect(screen.getByRole("heading", { name: "Planning" })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/shell/PageHeader.test.tsx` — FAIL (module missing).

- [ ] **Step 3: Implement PageHeader**

Create `frontend/src/shell/PageHeader.tsx`:

```tsx
import type { ReactNode } from "react";
import { Link } from "react-router";

/** Canonical first row of every routed view: title left, actions right.
 *  Page anatomy: Sidebar | PageHeader → tabs → filter bar → content. */
export default function PageHeader({
  title,
  subtitle,
  backTo,
  actions,
}: {
  title: string;
  subtitle?: ReactNode;
  backTo?: { label: string; to: string };
  actions?: ReactNode;
}) {
  return (
    <div className="flex shrink-0 items-center justify-between gap-3 border-b border-gray-200 bg-surface px-6 py-3">
      <div className="min-w-0">
        {backTo && (
          <Link to={backTo.to} className="text-xs text-blue-600 hover:underline">
            ← {backTo.label}
          </Link>
        )}
        <h1 className="truncate text-lg font-semibold text-gray-900">{title}</h1>
        {subtitle && <p className="truncate text-sm text-gray-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}
```

Run: `npx vitest run src/shell/PageHeader.test.tsx` — PASS.

- [ ] **Step 4: Lift the objectives button + lane editing (failing tests first)**

Append to `App.routes.test.tsx`:

```tsx
const BOARD = {
  id: 1,
  name: "Features & Stories",
  kinds: ["feature", "story"],
  lanes: [],
} as never;

it("the Board page header holds New Feature / New Risk and Edit lanes", async () => {
  mockAppData("admin");
  vi.spyOn(client, "getBoards").mockResolvedValue([BOARD] as never);
  render(
    <ThemeProvider>
      <AuthProvider>
        <MemoryRouter initialEntries={["/board"]}>
          <AppShell />
        </MemoryRouter>
      </AuthProvider>
    </ThemeProvider>,
  );
  expect(await screen.findByRole("button", { name: /new feature/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /new risk/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Edit lanes" })).toBeInTheDocument();
});

it("the New objective action is disabled until a team is chosen", async () => {
  mockAppData("admin");
  vi.spyOn(client, "getBoards").mockResolvedValue([BOARD] as never);
  vi.spyOn(client, "getTeams").mockResolvedValue([{ id: 1, name: "Network" }] as never);
  vi.spyOn(client, "getPIObjectives").mockResolvedValue([] as never);
  render(
    <ThemeProvider>
      <AuthProvider>
        <MemoryRouter initialEntries={["/board"]}>
          <AppShell />
        </MemoryRouter>
      </AuthProvider>
    </ThemeProvider>,
  );
  await userEvent.click(await screen.findByRole("button", { name: /pi objectives/i }));
  const btn = await screen.findByRole("button", { name: /new objective/i });
  expect(btn).toBeDisabled();
  await userEvent.click(screen.getByRole("button", { name: /team/i }));
  await userEvent.click(await screen.findByRole("button", { name: "Network" }));
  expect(screen.getByRole("button", { name: /new objective/i })).toBeEnabled();
});
```

Add `import userEvent from "@testing-library/user-event";` and the `render`-related imports the file needs.
(If the FilterSelect popover option isn't `role: "button"`, mirror how existing PIObjectivesBoard/PlanningView tests select a FilterSelect option — reuse their exact query pattern.)

Run: `npx vitest run src/App.routes.test.tsx` — new tests FAIL.

- [ ] **Step 5: Implement the lifts**

`PIObjectivesBoard.tsx`:

1. Props: add `team: string | null; onTeamChange: (t: string | null) => void; addSignal: number;` and delete the internal `const [team, setTeam] = useState<string | null>(null);`. The Team `FilterSelect` becomes `value={team ?? undefined} onChange={(v) => onTeamChange(v ?? null)}`.
2. Delete the `{canAdd ? (<button …+ New objective…</button>) : (<span…Select your team…</span>)}` block from the filter bar.
3. Add the signal effect near the other effects:

```tsx
  // The page header owns the "+ New objective" button; each increment of
  // addSignal is one click. Guarded upstream by the disabled state.
  useEffect(() => {
    if (addSignal > 0) setEditing("new");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addSignal]);
```

4. Export the permission helper (used by the page header) and use it for `canAdd`:

```tsx
export function canAddObjective(user: AuthUser, team: Team | null): boolean {
  return team != null && (user.role === "admin" || user.team_id === team.id);
}
```

with `const canAdd = canAddObjective(user, selectedTeam);` replacing the old inline logic (`canEditTeam` stays for the cards).

`BoardView.tsx`: add required prop `laneEditing: boolean`; delete the `const [editing, setEditing] = useState(false);`, the whole `{canEditLanes && (<div className="flex shrink-0 justify-end px-6 pt-3">…</div>)}` strip, and the `btnSecondary` import; the editor line becomes `{canEditLanes && laneEditing && <LaneEditor board={board} onChanged={onChanged} />}`.

`App.tsx` (AppShell):

1. New state next to `filters`: `const [objTeam, setObjTeam] = useState<string | null>(null); const [addObjectiveSignal, setAddObjectiveSignal] = useState(0); const [laneEditing, setLaneEditing] = useState(false);`
2. Imports: `import PageHeader from "./shell/PageHeader"; import { canAddObjective } from "./components/PIObjectivesBoard"; import { btnPrimary, btnSecondary } from "./components/ui";`
3. Above `boardElement`:

```tsx
  const objTeamObj = objTeam ? teamOptions.find((t) => t.name === objTeam) ?? null : null;
  const boardActions = objectivesTab ? (
    <button
      onClick={() => setAddObjectiveSignal((s) => s + 1)}
      disabled={!canAddObjective(user, objTeamObj)}
      title={canAddObjective(user, objTeamObj) ? undefined : "Select your team first"}
      className={btnPrimary}
    >
      + New objective
    </button>
  ) : (
    <>
      <NewItemBar onCreated={handleChanged} />
      {isAdmin && activeBoard && (
        <button onClick={() => setLaneEditing((v) => !v)} className={btnSecondary}>
          {laneEditing ? "Done" : "Edit lanes"}
        </button>
      )}
    </>
  );
```

4. `boardElement` gains `<PageHeader title="Board" actions={boardActions} />` as its first child (wrap the existing ternary in a fragment below it); pass the new props: `PIObjectivesBoard … team={objTeam} onTeamChange={setObjTeam} addSignal={addObjectiveSignal}` and `BoardView … laneEditing={laneEditing}`.
5. Header right group loses NewItemBar (delete the `{pathname === "/board" && …}` line and, if now unused, the `useLocation` import).

- [ ] **Step 6: Fix BoardView/PIObjectivesBoard test fallout**

- `BoardView.test.tsx`: add `laneEditing={false}` to renders; replace any test that clicked the internal "Edit lanes" button with:

```tsx
it("shows the lane editor only when laneEditing is set", () => {
  // reuse the file's existing board/items fixtures and render helper
  renderBoard({ laneEditing: true });
  expect(screen.getByRole("button", { name: "Add lane" })).toBeInTheDocument();
});
```

- `PIObjectivesBoard.test.tsx` (if present): pass `team={null} onTeamChange={() => {}} addSignal={0}` and adapt any "+ New objective" click tests to `addSignal` (rerender with `addSignal={1}` and assert the editor opens).

- [ ] **Step 7: Run tests + commit**

Run: `npm run test` — all green.

```bash
cd /Users/marco/Coding/web-kanban && git add frontend && git commit -m "feat(shell): PageHeader with Board action lift (new item, edit lanes, new objective)"
```

---

### Task 5: WorkLayout extraction + BoardPage

**Files:**
- Create: `frontend/src/shell/WorkLayout.tsx`
- Create: `frontend/src/components/BoardPage.tsx`
- Modify: `frontend/src/App.tsx` (slims to shell + routes + wrappers)
- Modify: `frontend/src/App.routes.test.tsx` / `frontend/src/App.auth.test.tsx` (only if queries break)

**Interfaces:**
- Consumes: `useBoard()` hook, `statusOptionsByKind`, `ObjectiveLinksContext`, ItemDrawer/StoryBoardModal props as currently wired in App.tsx.
- Produces:

```tsx
// shell/WorkLayout.tsx
export type WorkContext = ReturnType<typeof useBoard> & {
  user: AuthUser;
  people: PersonOption[];
  teamOptions: Team[];
  containers: Container[];
  departments: Department[];
  teams: string[];            // distinct leading teams from items
  assignees: string[];
  containerNames: string[];
  departmentNames: string[];
  refreshKey: number;
  openItem: (id: number) => void;
  onChanged: () => void;
  onOpenStories: (featureId: number) => void;
};
export function useWork(): WorkContext;   // wraps useOutletContext
export default function WorkLayout(): JSX.Element;  // <Outlet context> + drawers
```

`BoardPage` (no props) renders PageHeader/BoardTabs/Toolbar/BoardView/PIObjectivesBoard from `useWork()`.

- [ ] **Step 1: Create WorkLayout**

Move — do not rewrite — the following out of `AppShell` into `frontend/src/shell/WorkLayout.tsx`: `useBoard()` call; `panels`/`openStoriesFeatureId`/`refreshKey` state; the `people`/`teamOptions`/`containers`/`departments`/`objectiveLinks` effects; `openItem`/`openChild`/`openParent`/`openItemDocked`/`closePanel`/`closePanels`; `handleChanged`; `statusOptions`; the `teams`/`assignees`/`containerNames`/`departmentNames` memos; the `ObjectiveLinksContext.Provider`, `StoryBoardModal` block, and the `panels.length > 0` ItemDrawer overlay block. Shape:

```tsx
export default function WorkLayout() {
  const { user } = useAuth();
  const board = useBoard();
  const { boards, items, reload } = board;
  /* …all the moved state/effects/handlers… */
  const ctx: WorkContext = {
    ...board, user, people, teamOptions, containers, departments,
    teams, assignees, containerNames, departmentNames, refreshKey,
    openItem, onChanged: handleChanged, onOpenStories: setOpenStoriesFeatureId,
  };
  return (
    <ObjectiveLinksContext.Provider value={objectiveLinks}>
      <Outlet context={ctx} />
      {openStoriesFeatureId != null && (
        <StoryBoardModal
          featureId={openStoriesFeatureId}
          refreshSignal={refreshKey}
          onClose={() => setOpenStoriesFeatureId(null)}
          onOpenItem={openItem}
          onChanged={handleChanged}
        />
      )}
      {panels.length > 0 && (
        <div className="fixed inset-0 z-30 flex justify-end bg-black/30" onClick={closePanels}>
          {panels.map((id) => (
            <ItemDrawer
              key={id}
              itemId={id}
              compact={panels.length > 1}
              people={people}
              statusOptionsByKind={statusOptions}
              planningIntervalOptions={board.planningIntervals}
              leadingTeamOptions={teamOptions.map((t) => t.name)}
              containers={containers}
              departments={departments}
              teams={teamOptions}
              openIds={panels}
              onClose={() => closePanel(id)}
              onChanged={handleChanged}
              onOpenParent={openParent}
              onOpenChild={openChild}
              onOpenItem={openItemDocked}
              onLinksChanged={reload}
            />
          ))}
        </div>
      )}
    </ObjectiveLinksContext.Provider>
  );
}

export function useWork(): WorkContext {
  return useOutletContext<WorkContext>();
}
```

- [ ] **Step 2: Create BoardPage**

`frontend/src/components/BoardPage.tsx` takes over from Task 4's `boardElement` + board-local state (`activeBoardId`, `objectivesTab`, `filters`, `objTeam`, `addObjectiveSignal`, `laneEditing`, `selectBoard`, `boardActions`), consuming `useWork()` for data (`boards items links planningIntervals loading error user teams assignees containerNames departments containers openItem onChanged onOpenStories teamOptions`). `isAdmin` = `user.role === "admin"`. The `useEffect` seeding `activeBoardId` from `boards[0]` moves here. JSX is exactly the Task-4 `boardElement` wrapped in `<div className="flex min-h-0 flex-1 flex-col">…</div>`.

- [ ] **Step 3: Slim App.tsx**

`AppShell` keeps only: `useAuth`, `isAdmin`, header (brand + navLinks + ThemeToggle + UserMenu), Routes. Route wrappers live at the bottom of App.tsx:

```tsx
function PlanningRoute() {
  const w = useWork();
  return (
    <PlanningView
      items={w.items} links={w.links} planningIntervals={w.planningIntervals}
      departmentNames={w.departmentNames} onOpenCard={w.openItem} onChanged={w.onChanged}
    />
  );
}
function TimelineRoute() {
  const w = useWork();
  return (
    <TimelineView
      items={w.items} links={w.links} planningIntervals={w.planningIntervals}
      departmentNames={w.departmentNames} onOpenCard={w.openItem} onChanged={w.onChanged}
    />
  );
}
function RankingRoute() {
  const w = useWork();
  return (
    <RankingView
      items={w.items} planningIntervals={w.planningIntervals} teams={w.teams}
      containers={w.containers} departmentNames={w.departmentNames} user={w.user}
      onOpenCard={w.openItem} onChanged={w.onChanged}
    />
  );
}
function AdminRoute() {
  const w = useWork();
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <AdminView onChanged={w.onChanged} planningIntervals={w.planningIntervals} />
    </div>
  );
}
```

Routes (admin nests under WorkLayout because AdminView consumes `planningIntervals`/`onChanged` — a deliberate, documented deviation from the spec's "Admin mounts directly"):

```tsx
      <Routes>
        <Route element={<WorkLayout />}>
          <Route path="/board" element={<BoardPage />} />
          <Route path="/planning" element={<PlanningRoute />} />
          <Route path="/timeline" element={<TimelineRoute />} />
          <Route path="/ranking" element={<RankingRoute />} />
          <Route
            path="/admin"
            element={isAdmin ? <Navigate to="/admin/users" replace /> : <Navigate to="/board" replace />}
          />
          <Route
            path="/admin/:section"
            element={isAdmin ? <AdminRoute /> : <Navigate to="/board" replace />}
          />
        </Route>
        <Route path="/products" element={<ProductsView />} />
        <Route path="/products/:productId" element={<ProductDetailPage />} />
        <Route path="/lifecycle" element={<LifecycleView />} />
        <Route path="/contracts" element={<ContractsView />} />
        <Route path="/roadmap" element={<RoadmapView />} />
        <Route path="*" element={<Navigate to="/board" replace />} />
      </Routes>
```

Remove all now-unused imports/state from App.tsx (typecheck will list them).

- [ ] **Step 4: Verify**

Run: `npm run test` (all suites — the Task 1/2/4 route tests are the regression net; fix any query drift, not behavior) and `npm run build` (typecheck catches missed imports).
Expected: green build + tests.

- [ ] **Step 5: Commit**

```bash
cd /Users/marco/Coding/web-kanban && git add frontend && git commit -m "refactor(shell): extract WorkLayout route layout and BoardPage from App"
```

---

### Task 6: Sidebar

**Files:**
- Modify: `frontend/src/icons.ts`
- Create: `frontend/src/shell/nav.ts`
- Create: `frontend/src/shell/Sidebar.tsx`
- Create: `frontend/src/shell/Sidebar.test.tsx`
- Modify: `frontend/src/components/UserMenu.tsx` (`compact`, `dropUp` props)
- Modify: `frontend/src/App.tsx` (header removed, sidebar mounted)
- Modify: `frontend/src/App.routes.test.tsx` / `App.auth.test.tsx` (nav queries unchanged — links keep their names)

**Interfaces:**
- Produces: `NAV_GROUPS: NavGroup[]`, `ADMIN_ITEM: NavItem` from `shell/nav.ts` (`NavItem = { path: string; label: string; icon: IconDefinition }`, `NavGroup = { label: string; items: NavItem[] }`); `Sidebar({ onLoggedOut }: { onLoggedOut: () => void })`; `UserMenu` gains optional `compact?: boolean` (avatar-only trigger, `aria-label` = display name) and `dropUp?: boolean` (popover opens upward).

- [ ] **Step 1: Icons**

Append to the export list in `frontend/src/icons.ts` (single export block, keep grouping comments):

```ts
  // sidebar navigation
  faTableColumns,
  faListCheck,
  faTimeline,
  faRankingStar,
  faBoxesStacked,
  faArrowsSpin,
  faFileContract,
  faMapLocationDot,
  faGear,
  faAnglesLeft,
  faAnglesRight,
  // roadmap stream actions (Task 8)
  faEllipsisVertical,
  faPlus,
```

- [ ] **Step 2: Failing Sidebar tests**

Create `frontend/src/shell/Sidebar.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as client from "../api/client";
import { AuthProvider } from "../auth/AuthContext";
import { ThemeProvider } from "../theme/ThemeContext";
import Sidebar from "./Sidebar";

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

function renderSidebar(role: "admin" | "member" = "admin") {
  vi.spyOn(client, "getMe").mockResolvedValue(
    { id: 1, email: "u@x.ch", display_name: "U", role, team_id: 1, is_active: true } as never,
  );
  render(
    <ThemeProvider>
      <AuthProvider>
        <MemoryRouter initialEntries={["/board"]}>
          <Sidebar onLoggedOut={() => {}} />
        </MemoryRouter>
      </AuthProvider>
    </ThemeProvider>,
  );
}

it("renders both groups with all nine views for admins", async () => {
  renderSidebar("admin");
  expect(await screen.findByText("Work")).toBeInTheDocument();
  expect(screen.getByText("Catalog")).toBeInTheDocument();
  for (const name of ["Board", "Planning", "Timeline", "Ranking", "Products", "Lifecycle", "Contracts", "Roadmap", "Admin"]) {
    expect(screen.getByRole("link", { name })).toBeInTheDocument();
  }
  expect(screen.getByRole("link", { name: "Board" })).toHaveAttribute("aria-current", "page");
});

it("hides the Admin entry for members", async () => {
  renderSidebar("member");
  expect(await screen.findByRole("link", { name: "Board" })).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Admin" })).not.toBeInTheDocument();
});

it("collapse hides labels, keeps accessible names, and persists", async () => {
  renderSidebar("admin");
  await userEvent.click(await screen.findByRole("button", { name: "Collapse sidebar" }));
  expect(localStorage.getItem("jamra.sidebarCollapsed")).toBe("1");
  expect(screen.queryByText("Work")).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Planning" })).toBeInTheDocument(); // via aria-label
  expect(screen.getByRole("button", { name: "Expand sidebar" })).toBeInTheDocument();
});
```

Run: `npx vitest run src/shell/Sidebar.test.tsx` — FAIL (module missing).

- [ ] **Step 3: Implement nav.ts + Sidebar**

`frontend/src/shell/nav.ts`:

```ts
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import {
  faArrowsSpin, faBoxesStacked, faFileContract, faGear, faListCheck,
  faMapLocationDot, faRankingStar, faTableColumns, faTimeline,
} from "../icons";

export type NavItem = { path: string; label: string; icon: IconDefinition };
export type NavGroup = { label: string; items: NavItem[] };

export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Work",
    items: [
      { path: "/board", label: "Board", icon: faTableColumns },
      { path: "/planning", label: "Planning", icon: faListCheck },
      { path: "/timeline", label: "Timeline", icon: faTimeline },
      { path: "/ranking", label: "Ranking", icon: faRankingStar },
    ],
  },
  {
    label: "Catalog",
    items: [
      { path: "/products", label: "Products", icon: faBoxesStacked },
      { path: "/lifecycle", label: "Lifecycle", icon: faArrowsSpin },
      { path: "/contracts", label: "Contracts", icon: faFileContract },
      { path: "/roadmap", label: "Roadmap", icon: faMapLocationDot },
    ],
  },
];

export const ADMIN_ITEM: NavItem = { path: "/admin", label: "Admin", icon: faGear };
```

`frontend/src/shell/Sidebar.tsx`:

```tsx
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useState } from "react";
import { NavLink } from "react-router";
import { useAuth } from "../auth/AuthContext";
import ThemeToggle from "../components/ThemeToggle";
import UserMenu from "../components/UserMenu";
import { captionClass } from "../components/ui";
import { faAnglesLeft, faAnglesRight } from "../icons";
import { ADMIN_ITEM, NAV_GROUPS, type NavGroup, type NavItem } from "./nav";

const COLLAPSE_KEY = "jamra.sidebarCollapsed";

function SidebarLink({ item, collapsed }: { item: NavItem; collapsed: boolean }) {
  return (
    <NavLink
      to={item.path}
      title={collapsed ? item.label : undefined}
      aria-label={item.label}
      className={({ isActive }) =>
        `flex items-center gap-2.5 rounded-lg text-sm transition focus:outline-hidden focus:ring-2 focus:ring-blue-100 ${
          collapsed ? "justify-center px-2 py-2" : "px-3 py-2"
        } ${isActive ? "bg-blue-50 font-medium text-blue-700" : "text-gray-600 hover:bg-gray-100"}`
      }
    >
      <FontAwesomeIcon icon={item.icon} fixedWidth aria-hidden />
      {!collapsed && <span className="truncate">{item.label}</span>}
    </NavLink>
  );
}

function Group({ group, collapsed }: { group: NavGroup; collapsed: boolean }) {
  return (
    <div className="mb-1">
      {collapsed ? (
        <div aria-hidden className="mx-2 my-2 border-t border-gray-200" />
      ) : (
        <div className={`px-3 pb-1 pt-3 ${captionClass}`}>{group.label}</div>
      )}
      <div className="flex flex-col gap-0.5">
        {group.items.map((item) => (
          <SidebarLink key={item.path} item={item} collapsed={collapsed} />
        ))}
      </div>
    </div>
  );
}

/** Global navigation: grouped views, admin entry, collapse-to-rail, and the
 *  user/theme controls pinned to the footer. */
export default function Sidebar({ onLoggedOut }: { onLoggedOut: () => void }) {
  const { user } = useAuth();
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSE_KEY) === "1");
  const toggle = () =>
    setCollapsed((c) => {
      const next = !c;
      localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      return next;
    });

  return (
    <aside
      className={`flex h-full shrink-0 flex-col border-r border-gray-200 bg-surface ${collapsed ? "w-14" : "w-56"}`}
    >
      <div className={`flex items-center py-4 ${collapsed ? "justify-center" : "px-4"}`}>
        <span className="text-lg font-semibold text-gray-900">{collapsed ? "J" : "JAMra"}</span>
      </div>
      <nav aria-label="Main" className={`min-h-0 flex-1 overflow-y-auto ${collapsed ? "px-1.5" : "px-3"}`}>
        {NAV_GROUPS.map((g) => (
          <Group key={g.label} group={g} collapsed={collapsed} />
        ))}
        {user.role === "admin" && (
          <Group group={{ label: "Admin", items: [ADMIN_ITEM] }} collapsed={collapsed} />
        )}
      </nav>
      <div className={`shrink-0 border-t border-gray-200 py-3 ${collapsed ? "px-1.5" : "px-3"}`}>
        <div className={`mb-2 flex items-center ${collapsed ? "flex-col gap-1" : "justify-between"}`}>
          <ThemeToggle />
          <button
            type="button"
            onClick={toggle}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="rounded-lg p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700"
          >
            <FontAwesomeIcon icon={collapsed ? faAnglesRight : faAnglesLeft} />
          </button>
        </div>
        <UserMenu user={user} onLoggedOut={onLoggedOut} compact={collapsed} dropUp />
      </div>
    </aside>
  );
}
```

`UserMenu.tsx`: props become `{ user, onLoggedOut, compact = false, dropUp = false }`. Trigger button: when `compact`, render only `<Avatar name={user.display_name} />` inside the button and add `aria-label={user.display_name}` (keep the button element and popover logic identical). Popover positioning: replace the fixed `absolute right-0 z-30 mt-2 w-52` with:

```tsx
        <div
          role="menu"
          className={`absolute z-30 w-52 ${dropUp ? "bottom-full left-0 mb-2" : "right-0 mt-2"} ${popoverClass}`}
        >
```

`App.tsx`: delete the `<header>…</header>` block and the `navLink` helper; the shell becomes:

```tsx
export function AppShell() {
  const { user, setUser } = useAuth();
  const isAdmin = user.role === "admin";
  return (
    <div className="flex h-screen overflow-hidden bg-canvas">
      <Sidebar onLoggedOut={() => setUser(null)} />
      <main className="flex min-h-0 min-w-0 flex-1 flex-col">
        <Routes>{/* …unchanged routes… */}</Routes>
      </main>
    </div>
  );
}
```

Remove now-unused imports (`NavLink`, `ThemeToggle`, `UserMenu`, `NewItemBar` if it lingers).

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/shell/Sidebar.test.tsx src/App.routes.test.tsx src/App.auth.test.tsx`, then `npm run test`.
Expected: PASS — nav queries by `role: "link"` keep working (links moved, names unchanged).

- [ ] **Step 5: Commit**

```bash
cd /Users/marco/Coding/web-kanban && git add frontend && git commit -m "feat(shell): collapsible grouped sidebar replaces the header nav"
```

---

### Task 7: PageHeader adoption across all views

**Files:**
- Modify: `frontend/src/components/PlanningView.tsx`, `TimelineView.tsx`, `RankingView.tsx`, `ProductsView.tsx`, `LifecycleView.tsx`, `ContractsView.tsx`, `RoadmapView.tsx`, `ProductDetail.tsx`, `ProductDetailPage.tsx`, `admin/AdminView.tsx`
- Modify: their colocated test files.

**Interfaces:**
- Consumes: `PageHeader` from Task 4.
- Produces: every routed view starts with a PageHeader; `ProductDetail` prop change: `onBack` **removed** (back navigation via `backTo` Link).

- [ ] **Step 1: Failing title assertions**

In one existing render test per view file, add (adjusting the render helper where needed):

```tsx
expect(screen.getByRole("heading", { name: "Planning" })).toBeInTheDocument();
```

with titles: Planning, Timeline, Ranking, Products, Lifecycle, Contracts, Roadmap, Administration (AdminView — this assertion goes in `App.routes.test.tsx`'s `/admin` test since AdminView needs the router), and for ProductDetail the heading stays the product name but add the back-link assertion:

```tsx
expect(screen.getByRole("link", { name: /back to products/i })).toHaveAttribute("href", "/products");
```

For RoadmapView also add the add-stream toggle test:

```tsx
it("Add stream lives in the page header and toggles the input row", async () => {
  // reuse the file's product/stream mocks
  render(<RoadmapView />);
  expect(screen.queryByPlaceholderText("New stream name")).not.toBeInTheDocument();
  await userEvent.click(await screen.findByRole("button", { name: /add stream/i }));
  expect(screen.getByPlaceholderText("New stream name")).toBeInTheDocument();
});
```

Run the touched suites — new assertions FAIL.

- [ ] **Step 2: Implement, view by view**

Pattern for the six simple views — insert as first child of the outer `flex min-h-0 flex-1 flex-col` div (`import PageHeader from "../shell/PageHeader";`):

- `PlanningView.tsx`: `<PageHeader title="Planning" />` in the main return; the no-intervals guard becomes

```tsx
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <PageHeader title="Planning" />
        <div className="p-8 text-gray-500">No planning intervals yet. Set a Planning Interval on stories first.</div>
      </div>
    );
```

- `TimelineView.tsx`: same treatment, title "Timeline" (guard + main return).
- `RankingView.tsx`: `<PageHeader title="Ranking" />`.
- `ProductsView.tsx`: wrap in the standard shell if not already and add `<PageHeader title="Products" />` above the scroll container.
- `LifecycleView.tsx` / `ContractsView.tsx`: `<PageHeader title="Lifecycle" />` / `<PageHeader title="Contracts" />` above the filter bar.
- `RoadmapView.tsx`: add state `const [addingStream, setAddingStream] = useState(false);`;

```tsx
      <PageHeader
        title="Roadmap"
        actions={
          product && (
            <button className={btnSecondary} onClick={() => setAddingStream((v) => !v)}>
              + Add stream
            </button>
          )
        }
      />
```

Move the whole `{!loading && product && (<div className="mt-4 flex items-center gap-2">…Add stream…</div>)}` block from the bottom to the **top** of the scroll container, gated by `addingStream`, with `mb-4` instead of `mt-4` and `autoFocus` on the input; on successful `addStream()` also `setAddingStream(false)`. Import `btnSecondary` stays (kebab task later removes other uses). Delete the old bottom block.
- `ProductDetail.tsx`: change props to `{ product }: { product: Product }` (drop `onBack`); restructure the return to:

```tsx
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title={product.name}
        subtitle={`${product.art_name}${product.team_name ? ` · Team ${product.team_name}` : ""}`}
        backTo={{ label: "Back to products", to: "/products" }}
        actions={/* the existing four per-tab Add buttons, unchanged JSX minus their wrapper */}
      />
      <div className="min-h-0 flex-1 overflow-auto px-6 py-6">
        {product.description && (
          <p className="mb-4 max-w-2xl text-sm text-gray-600">{product.description}</p>
        )}
        {/* tab pills + tab content exactly as before */}
      </div>
    </div>
```

deleting the old back-button/h1 block. `ProductDetailPage.tsx`: drop the `onBack` prop and the `useNavigate` import.
- `admin/AdminView.tsx`: replace the `<header className="mb-6">…</header>` with nothing and restructure:

```tsx
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Administration" subtitle="Manage teams, people, planning intervals, and capacity." />
      <div className="min-h-0 flex-1 overflow-auto">
        <div className="mx-auto max-w-7xl px-6 py-8">
          <div className="flex items-start gap-6">{/* nav + section, unchanged */}</div>
        </div>
      </div>
    </div>
```

and in `App.tsx` simplify `AdminRoute` to return `<AdminView …/>` without the wrapping scroll div (AdminView owns its scroll now).

- [ ] **Step 3: Fix test fallout**

`ProductDetail`-rendering tests now need `<MemoryRouter>` (Link in backTo) and must drop `onBack` props — assert back-link `href` instead of `onBack` callbacks. RoadmapView tests that used the always-visible "New stream name" input must click "+ Add stream" first.

- [ ] **Step 4: Run + commit**

Run: `npm run test` — all green. `npm run build` — typecheck clean.

```bash
cd /Users/marco/Coding/web-kanban && git add frontend && git commit -m "feat(shell): PageHeader adopted across all views; roadmap add-stream moves to header"
```

---

### Task 8: Roadmap stream kebab + gutter Add item

**Files:**
- Modify: `frontend/src/components/RoadmapView.tsx`
- Modify: `frontend/src/components/RoadmapView.test.tsx`

**Interfaces:**
- Consumes: `faEllipsisVertical`, `faPlus` from `icons.ts` (added in Task 6); `popoverClass` from `ui.ts`; existing `moveStream`, `setRenaming`, `setConfirmDelete`, `openCreate`.
- Produces: internal `StreamMenu` component; aria contract: kebab trigger `Stream actions for {name}`, menu items `Move up`/`Move down`/`Rename`/`Delete`; add button `Add item to {name}`.

- [ ] **Step 1: Failing tests**

In `RoadmapView.test.tsx`, rewrite the reorder/rename/delete interaction tests to go through the menu, e.g.:

```tsx
async function openStreamMenu(name: string) {
  await userEvent.click(await screen.findByRole("button", { name: `Stream actions for ${name}` }));
}

it("reorders streams via the kebab menu", async () => {
  // keep the existing two-stream mocks and updateStream spies
  render(<RoadmapView />);
  await openStreamMenu("Campus");
  await userEvent.click(screen.getByRole("menuitem", { name: "Move down" }));
  // keep the file's existing position-write assertions unchanged
});

it("Move up is disabled for the first stream", async () => {
  render(<RoadmapView />);
  await openStreamMenu("Campus");
  expect(screen.getByRole("menuitem", { name: "Move up" })).toBeDisabled();
});

it("adds an item from the stream gutter", async () => {
  render(<RoadmapView />);
  await userEvent.click(await screen.findByRole("button", { name: "Add item to Campus" }));
  expect(await screen.findByRole("heading", { name: /new roadmap item/i })).toBeInTheDocument();
});
```

(Adapt the drawer-heading query to the actual RoadmapItemDrawer title — reuse whatever the existing "Add item" test asserted.) The duplicated-positions self-healing regression test keeps its assertions; only its click path changes to the menu.

Run: `npx vitest run src/components/RoadmapView.test.tsx` — FAIL.

- [ ] **Step 2: Implement**

In `RoadmapView.tsx` add imports (`useRef` from react, `FontAwesomeIcon`, `faEllipsisVertical, faPlus` from `../icons`, `popoverClass` from `./ui`) and the menu component above `RoadmapView`:

```tsx
function StreamMenu({
  name, index, count, onMove, onRename, onDelete,
}: {
  name: string;
  index: number;
  count: number;
  onMove: (direction: -1 | 1) => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const itemClass =
    "flex w-full items-center rounded-lg px-3 py-1.5 text-left text-sm text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40";
  const act = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Stream actions for ${name}`}
        onClick={() => setOpen((o) => !o)}
        className="rounded-lg px-1.5 py-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700"
      >
        <FontAwesomeIcon icon={faEllipsisVertical} />
      </button>
      {open && (
        <div role="menu" className={`absolute left-0 z-20 mt-1 w-40 ${popoverClass}`}>
          <button role="menuitem" disabled={index === 0} onClick={act(() => onMove(-1))} className={itemClass}>
            Move up
          </button>
          <button role="menuitem" disabled={index === count - 1} onClick={act(() => onMove(1))} className={itemClass}>
            Move down
          </button>
          <button role="menuitem" onClick={act(onRename)} className={itemClass}>
            Rename
          </button>
          <button
            role="menuitem"
            onClick={act(onDelete)}
            className="flex w-full items-center rounded-lg px-3 py-1.5 text-left text-sm text-red-600 transition hover:bg-red-50"
          >
            Delete
          </button>
        </div>
      )}
    </div>
  );
}
```

In the stream gutter, replace the name span + the four-button row with:

```tsx
                <div className="flex w-56 shrink-0 items-center gap-1 pr-3">
                  {renaming?.id === stream.id ? (
                    <input /* unchanged rename input */ />
                  ) : (
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-gray-800">
                      {stream.name}
                    </span>
                  )}
                  <button
                    type="button"
                    aria-label={`Add item to ${stream.name}`}
                    onClick={() => openCreate(stream.id)}
                    className="rounded-lg px-1.5 py-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700"
                  >
                    <FontAwesomeIcon icon={faPlus} />
                  </button>
                  <StreamMenu
                    name={stream.name}
                    index={index}
                    count={streams.length}
                    onMove={(d) => void moveStream(index, d)}
                    onRename={() => setRenaming({ id: stream.id, name: stream.name })}
                    onDelete={() => setConfirmDelete({ id: stream.id, name: stream.name })}
                  />
                </div>
```

Delete the old floating `Add item` button (`absolute right-1 top-1`) from the lane and remove the now-unused `btnDangerGhost`/`btnGhost` imports if nothing else uses them.

- [ ] **Step 3: Run + commit**

Run: `npx vitest run src/components/RoadmapView.test.tsx`, then `npm run test` — green.

```bash
cd /Users/marco/Coding/web-kanban && git add frontend && git commit -m "feat(roadmap): stream kebab menu and gutter add-item replace floating controls"
```

---

### Task 9: Filter-bar convention compliance

**Files:**
- Modify: `frontend/src/components/TimelineView.tsx` (search into the filter bar)
- Modify: `frontend/src/components/RankingView.tsx` (label + wrapper)
- Modify: `frontend/src/components/ui.ts` (convention comment)
- Modify: `frontend/src/components/TimelineView.test.tsx`, `frontend/src/components/RankingView.test.tsx`

**Interfaces:**
- Consumes: existing search state (`query`) in TimelineView.
- Produces: documented slot order in `ui.ts`; no API changes.

- [ ] **Step 1: Failing tests**

`RankingView.test.tsx`: change any "Interval" label queries to "Planning Interval" and add:

```tsx
expect(screen.getByText("Planning Interval")).toBeInTheDocument();
```

`TimelineView.test.tsx`: existing search tests keep passing by placeholder; add a placement assertion:

```tsx
it("the feature search sits in the filter bar", () => {
  // reuse the file's standard render with planning intervals
  const input = screen.getByPlaceholderText("Filter features…");
  expect(input.closest("div.border-b")).not.toBeNull(); // filter bar row, not the lane header
});
```

Run the two suites — new assertions FAIL.

- [ ] **Step 2: Implement**

`TimelineView.tsx`: move the entire `mode === "feature" && (<div className="relative">…input + clear button…</div>)` block from the sticky lane-header row into the filter bar as its **first** child (before the Planning Interval FilterSelect), changing the input class's `w-full` to `w-56`. The sticky row keeps the empty `<div className="w-64 shrink-0 px-2" />` spacer for column alignment.

`RankingView.tsx`: wrapper `flex shrink-0 flex-wrap gap-2 border-b border-gray-200 bg-surface px-6 py-3` → `flex shrink-0 flex-wrap items-center gap-3 border-b border-gray-200 bg-surface px-6 py-3`; `label="Interval"` → `label="Planning Interval"`.

`ui.ts`: append to the header comment block:

```ts
/** Filter-bar slot order (left → right): search input → scope filters
 *  (Product / Planning Interval) → dimension filters → pill toggles →
 *  ml-auto secondary actions. Primary page actions live in PageHeader. */
```

- [ ] **Step 3: Run + commit**

Run: `npx vitest run src/components/TimelineView.test.tsx src/components/RankingView.test.tsx`, then `npm run test` — green.

```bash
cd /Users/marco/Coding/web-kanban && git add frontend && git commit -m "fix(shell): timeline search joins the filter bar; ranking label and wrapper normalized"
```

---

### Task 10: Stack verification + docs

**Files:**
- Modify: `CLAUDE.md` (architecture section)
- Modify: `.superpowers/sdd/progress.md` (new ledger section)

- [ ] **Step 1: Full local verification**

```bash
cd /Users/marco/Coding/web-kanban/frontend && npm run build && npm run test
cd ../backend && . .venv/bin/activate && pytest -q
```

Expected: build clean, FE suite green (count > 411), BE 465 green (untouched).

- [ ] **Step 2: Docker rebuild + deep-link check**

```bash
cd /Users/marco/Coding/web-kanban
export FONTAWESOME_PACKAGE_TOKEN=$(tr -d '\n' < frontend/.fa-token)
docker compose build frontend && docker compose up -d
```

Then with Playwright against http://localhost:8080: log in; walk all nine views via the sidebar (light + dark, expanded + collapsed rail); open an ItemDrawer from Board AND from Planning; open a product detail, reload the browser on `/products/<id>` and on `/admin/snapshots` (nginx `try_files` fallback must serve the app and land on the right view); exercise the Roadmap kebab (reorder, rename, delete-guard) and gutter add-item; confirm "+ Add stream" toggle. No stray screenshots at repo root afterwards.

- [ ] **Step 3: Update docs**

`CLAUDE.md` frontend bullet: replace "App.tsx is the shell with nine top-level views …" with a sentence covering: react-router v7 routes (`/board`…`/roadmap`, `/products/:productId`, `/admin/:section`), the grouped collapsible `shell/Sidebar` (nav config in `shell/nav.ts`), `shell/PageHeader` as the first row of every view, and `shell/WorkLayout` holding shared board state + the ItemDrawer stack for the work views and Admin.

`.superpowers/sdd/progress.md`: append a "UI Refresh A — App Shell & Page Grammar" ledger section recording task completions (established format).

- [ ] **Step 4: Commit**

```bash
cd /Users/marco/Coding/web-kanban && git add CLAUDE.md .superpowers/sdd/progress.md && git commit -m "docs: app shell routing + sidebar architecture notes"
```
