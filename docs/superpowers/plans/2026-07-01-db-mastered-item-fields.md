# DB-Mastered Item Fields Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the item drawer's Status / Planning Interval / Leading Team fields DB-mastered dropdowns — Status from board lanes, Team from the Team table, and Planning Interval from a new PlanningInterval entity used app-wide.

**Architecture:** New `PlanningInterval` backend entity (table + CRUD API + migration seed + CSV upsert), surfaced everywhere the PI list is used. The item drawer's three free-text fields become `SearchableSelect` dropdowns whose options come from the DB (lanes / teams / planning intervals), keeping any off-list current value selectable.

**Tech Stack:** Backend — Python 3.14, FastAPI, SQLAlchemy 2.0, Pydantic v2, Alembic, pytest. Frontend — React + TypeScript, Vitest + Testing Library, Tailwind.

## Global Constraints

- New Alembic migration is `0007`, `down_revision = "0006"`.
- `planning_intervals` table: `id`, `name` (`String(64)`, unique, not null), `position` (int), `created_at`. Order lists by `position, name`.
- `items.planning_interval` stays a free-text string column — no FK, no items backfill. The entity is only the UI's master list.
- Mirror the existing Teams patterns: `routers/teams.py` (router), `TeamsSection.tsx` (admin), and `_seed_teams_and_members` (CSV seeding).
- `SearchableSelect` gains an optional `ariaLabel` on its input; after this there are FOUR comboboxes in the drawer, so tests target `combobox` by name.
- Backend tests use the existing `client` / `db_session` fixtures (in-memory SQLite via `Base.metadata.create_all`; the migration is NOT run in tests, so the table is created but not seeded — API tests create rows explicitly).
- Backend runs in Docker; pytest isn't baked in and tests aren't in the image. Copy tests in with: `docker compose exec -T backend rm -rf /app/tests && docker compose cp ./backend/tests backend:/app/tests` (install once if missing: `docker compose exec -T backend pip install -q "pytest>=8.2" "httpx>=0.27"`). Re-copy after editing tests.
- Frontend tests/type-check run locally: `cd frontend && npx vitest run <file>` and `npx tsc --noEmit`. Both clean before each commit.

---

### Task 1: `PlanningInterval` model + migration `0007`

**Files:**
- Modify: `backend/app/models.py` (add `PlanningInterval` after the `Lane` class)
- Create: `backend/alembic/versions/0007_planning_intervals.py`
- Test: `backend/tests/test_planning_interval_model.py`

**Interfaces:**
- Produces: `PlanningInterval` ORM model, table `planning_intervals`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_planning_interval_model.py`:

```python
from app.models import PlanningInterval


def test_planning_interval_roundtrip(db_session):
    pi = PlanningInterval(name="PI1-Q3", position=0)
    db_session.add(pi)
    db_session.commit()
    db_session.refresh(pi)
    assert pi.id is not None
    assert pi.created_at is not None
    assert db_session.query(PlanningInterval).count() == 1
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker compose exec -T backend rm -rf /app/tests && docker compose cp ./backend/tests backend:/app/tests && docker compose exec -T backend python -m pytest tests/test_planning_interval_model.py -q`
Expected: FAIL — `ImportError: cannot import name 'PlanningInterval'`.

- [ ] **Step 3: Write the model + migration**

In `backend/app/models.py`, add after the `Lane` class (all needed imports — `Integer, String, func, Mapped, mapped_column, datetime` — are already imported at the top):

```python
class PlanningInterval(Base):
    __tablename__ = "planning_intervals"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(64), unique=True)
    position: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
```

Create `backend/alembic/versions/0007_planning_intervals.py`:

```python
"""planning intervals master list

Revision ID: 0007
Revises: 0006
"""
from alembic import op
import sqlalchemy as sa

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "planning_intervals",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("name", sa.String(64), nullable=False, unique=True),
        sa.Column("position", sa.Integer, nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now()),
    )
    # Seed from the distinct planning_interval values already on items.
    bind = op.get_bind()
    rows = bind.execute(
        sa.text(
            "SELECT DISTINCT planning_interval FROM items "
            "WHERE planning_interval IS NOT NULL AND planning_interval <> ''"
        )
    ).fetchall()
    for position, name in enumerate(sorted(r[0] for r in rows)):
        bind.execute(
            sa.text("INSERT INTO planning_intervals (name, position) VALUES (:name, :position)"),
            {"name": name, "position": position},
        )


def downgrade() -> None:
    op.drop_table("planning_intervals")
```

- [ ] **Step 4: Run test to verify it passes**

Run: `docker compose exec -T backend rm -rf /app/tests && docker compose cp ./backend/tests backend:/app/tests && docker compose exec -T backend python -m pytest tests/test_planning_interval_model.py -q`
Expected: PASS (1 passed).

- [ ] **Step 5: Verify the migration applies + seeds against Postgres**

Run: `docker compose exec -T backend alembic upgrade head`
Expected: `Running upgrade 0006 -> 0007, planning intervals master list` (or "already at head").

- [ ] **Step 6: Commit**

```bash
git add backend/app/models.py backend/alembic/versions/0007_planning_intervals.py backend/tests/test_planning_interval_model.py
git commit -m "feat(backend): planning_intervals entity + seeding migration"
```

---

### Task 2: Planning-interval schemas + router

**Files:**
- Modify: `backend/app/schemas.py` (add `PlanningIntervalRead`, `PlanningIntervalCreate`)
- Create: `backend/app/routers/planning_intervals.py`
- Modify: `backend/app/main.py` (register the router)
- Test: `backend/tests/test_api_planning_intervals.py`

**Interfaces:**
- Consumes: `PlanningInterval` (Task 1).
- Produces: `GET /api/planning-intervals`, `POST /api/planning-intervals`, `DELETE /api/planning-intervals/{pi_id}`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_api_planning_intervals.py`:

```python
def test_create_list_ordered_and_dedupe(client):
    assert client.post("/api/planning-intervals", json={"name": "PI1-Q3"}).status_code == 201
    assert client.post("/api/planning-intervals", json={"name": "PI2-Q4"}).status_code == 201
    assert client.post("/api/planning-intervals", json={"name": "PI1-Q3"}).status_code == 409
    rows = client.get("/api/planning-intervals").json()
    assert [r["name"] for r in rows] == ["PI1-Q3", "PI2-Q4"]  # by position


def test_delete(client):
    pid = client.post("/api/planning-intervals", json={"name": "PIX"}).json()["id"]
    assert client.delete(f"/api/planning-intervals/{pid}").status_code == 204
    assert client.get("/api/planning-intervals").json() == []
    assert client.delete(f"/api/planning-intervals/{pid}").status_code == 404
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker compose exec -T backend rm -rf /app/tests && docker compose cp ./backend/tests backend:/app/tests && docker compose exec -T backend python -m pytest tests/test_api_planning_intervals.py -q`
Expected: FAIL — 404s (router not registered).

- [ ] **Step 3: Write the schemas**

In `backend/app/schemas.py`, add (near the Team schemas; `Field`/`ConfigDict` are already imported):

```python
class PlanningIntervalRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    position: int


class PlanningIntervalCreate(BaseModel):
    name: str = Field(min_length=1, max_length=64)
```

- [ ] **Step 4: Write the router + register it**

Create `backend/app/routers/planning_intervals.py`:

```python
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import PlanningInterval
from app.schemas import PlanningIntervalCreate, PlanningIntervalRead

router = APIRouter(prefix="/api/planning-intervals", tags=["planning-intervals"])


@router.get("", response_model=list[PlanningIntervalRead])
def list_planning_intervals(db: Session = Depends(get_db)) -> list[PlanningInterval]:
    return list(
        db.scalars(select(PlanningInterval).order_by(PlanningInterval.position, PlanningInterval.name))
    )


@router.post("", response_model=PlanningIntervalRead, status_code=201)
def create_planning_interval(
    payload: PlanningIntervalCreate, db: Session = Depends(get_db)
) -> PlanningInterval:
    if db.scalar(select(PlanningInterval).where(PlanningInterval.name == payload.name)):
        raise HTTPException(status_code=409, detail="Planning interval already exists")
    max_pos = db.scalar(select(func.max(PlanningInterval.position)))
    pi = PlanningInterval(name=payload.name, position=(max_pos or 0) + 1)
    db.add(pi)
    db.commit()
    db.refresh(pi)
    return pi


@router.delete("/{pi_id}", status_code=204)
def delete_planning_interval(pi_id: int, db: Session = Depends(get_db)) -> None:
    pi = db.get(PlanningInterval, pi_id)
    if pi is None:
        raise HTTPException(status_code=404, detail="Planning interval not found")
    db.delete(pi)
    db.commit()
```

In `backend/app/main.py`, add `planning_intervals` to the routers import line and register it:

```python
from app.routers import imports, items, boards, teams, team_members, capacities, links, planning_intervals

app.include_router(planning_intervals.router)
```

- [ ] **Step 5: Run test to verify it passes**

Run: `docker compose exec -T backend rm -rf /app/tests && docker compose cp ./backend/tests backend:/app/tests && docker compose exec -T backend python -m pytest tests/test_api_planning_intervals.py -q`
Expected: PASS (2 passed).

- [ ] **Step 6: Commit**

```bash
git add backend/app/schemas.py backend/app/routers/planning_intervals.py backend/app/main.py backend/tests/test_api_planning_intervals.py
git commit -m "feat(backend): planning-intervals CRUD API"
```

---

### Task 3: CSV import seeds planning intervals

**Files:**
- Modify: `backend/app/csv_import.py`
- Test: `backend/tests/test_import_endpoint.py` (append)

**Interfaces:**
- Consumes: `PlanningInterval` (Task 1).

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_import_endpoint.py`:

```python
from pathlib import Path

_FIXTURE = Path(__file__).parent / "fixtures" / "team_planning.csv"


def test_import_seeds_planning_intervals(client):
    with _FIXTURE.open("rb") as f:
        assert client.post("/api/import", files={"file": ("p.csv", f, "text/csv")}).status_code == 200
    names = [p["name"] for p in client.get("/api/planning-intervals").json()]
    assert "PI1-Q3" in names
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker compose exec -T backend rm -rf /app/tests && docker compose cp ./backend/tests backend:/app/tests && docker compose exec -T backend python -m pytest tests/test_import_endpoint.py::test_import_seeds_planning_intervals -q`
Expected: FAIL — `planning_intervals` is empty after import.

- [ ] **Step 3: Write the seeding**

In `backend/app/csv_import.py`, change the SQLAlchemy import to include `func`:

```python
from sqlalchemy import func, select
```

Add this function next to `_seed_teams_and_members`:

```python
def _seed_planning_intervals(db, parsed) -> None:
    from app.models import PlanningInterval

    all_data = []
    for feature in parsed.features:
        all_data.append(feature.data)
        all_data.extend(story.data for story in feature.stories)
    all_data.extend(risk.data for risk in parsed.risks)

    names: set[str] = set()
    for data in all_data:
        raw = data.get("planning_interval")
        if raw and str(raw).strip():
            names.add(str(raw).strip())
    existing = {p.name for p in db.scalars(select(PlanningInterval))}
    start = db.scalar(select(func.max(PlanningInterval.position))) or 0
    for offset, name in enumerate(sorted(names - existing), start=1):
        db.add(PlanningInterval(name=name, position=start + offset))
```

In `replace_all`, call it right after the teams/members seeding (before `db.commit()`):

```python
    _seed_teams_and_members(db, parsed)
    _seed_planning_intervals(db, parsed)
    db.commit()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `docker compose exec -T backend rm -rf /app/tests && docker compose cp ./backend/tests backend:/app/tests && docker compose exec -T backend python -m pytest tests/test_import_endpoint.py -q`
Expected: PASS (all import tests, including the new one).

- [ ] **Step 5: Commit**

```bash
git add backend/app/csv_import.py backend/tests/test_import_endpoint.py
git commit -m "feat(backend): CSV import seeds planning intervals"
```

---

### Task 4: Frontend types, client fns, and `statusOptionsByKind`

**Files:**
- Modify: `frontend/src/types.ts`
- Modify: `frontend/src/api/client.ts`
- Modify: `frontend/src/lib/boardLanes.ts`
- Test: `frontend/src/api/client.test.ts` (append), `frontend/src/lib/boardLanes.test.ts` (append)

**Interfaces:**
- Produces:
  - `interface PlanningInterval { id: number; name: string; position: number }`
  - `getPlanningIntervals(): Promise<PlanningInterval[]>`, `createPlanningInterval(name): Promise<PlanningInterval>`, `deletePlanningInterval(id): Promise<void>`
  - `statusOptionsByKind(boards: Board[]): Partial<Record<ItemKind, string[]>>`

- [ ] **Step 1: Write the failing tests**

Append to `frontend/src/lib/boardLanes.test.ts` (add `statusOptionsByKind` to the `./boardLanes` import):

```ts
it("statusOptionsByKind maps each kind to its boards' lane names in order", () => {
  const boards = [
    { id: 1, name: "F&S", kinds: ["feature", "story"], lanes: [{ name: "Funnel" }, { name: "Ready" }] },
    { id: 2, name: "Risks", kinds: ["risk"], lanes: [{ name: "Open" }, { name: "Closed" }] },
  ] as never;
  const out = statusOptionsByKind(boards);
  expect(out.feature).toEqual(["Funnel", "Ready"]);
  expect(out.story).toEqual(["Funnel", "Ready"]);
  expect(out.risk).toEqual(["Open", "Closed"]);
});
```

Append to `frontend/src/api/client.test.ts` (import the three fns from `./client`, inside the existing `describe`):

```ts
import { createPlanningInterval, deletePlanningInterval, getPlanningIntervals } from "./client";

it("getPlanningIntervals fetches the list", async () => {
  mockFetch(200, [{ id: 1, name: "PI1-Q3", position: 0 }]);
  expect(await getPlanningIntervals()).toHaveLength(1);
});

it("createPlanningInterval posts the name", async () => {
  const spy = mockFetch(201, { id: 2, name: "PI2-Q4", position: 1 });
  await createPlanningInterval("PI2-Q4");
  const [url, init] = spy.mock.calls[0];
  expect(url).toBe("/api/planning-intervals");
  expect(init?.method).toBe("POST");
  expect(JSON.parse(init?.body as string)).toEqual({ name: "PI2-Q4" });
});

it("deletePlanningInterval sends DELETE", async () => {
  const spy = mockFetch(204, "");
  await deletePlanningInterval(5);
  expect(spy.mock.calls[0][0]).toBe("/api/planning-intervals/5");
  expect(spy.mock.calls[0][1]?.method).toBe("DELETE");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/lib/boardLanes.test.ts src/api/client.test.ts`
Expected: FAIL — `statusOptionsByKind` / the client fns aren't exported.

- [ ] **Step 3: Add the type**

In `frontend/src/types.ts`, add:

```ts
export interface PlanningInterval {
  id: number;
  name: string;
  position: number;
}
```

- [ ] **Step 4: Add the client functions**

In `frontend/src/api/client.ts`, add `PlanningInterval` to the `import type { ... } from "../types"` block, then add:

```ts
export function getPlanningIntervals(): Promise<PlanningInterval[]> {
  return request<PlanningInterval[]>("/api/planning-intervals");
}

export function createPlanningInterval(name: string): Promise<PlanningInterval> {
  return request<PlanningInterval>("/api/planning-intervals", json({ name }));
}

export function deletePlanningInterval(id: number): Promise<void> {
  return request<void>(`/api/planning-intervals/${id}`, { method: "DELETE" });
}
```

- [ ] **Step 5: Add `statusOptionsByKind`**

In `frontend/src/lib/boardLanes.ts`, extend the type import to include `Board` and `ItemKind`:

```ts
import type { Board, BoardCard, BoardColumn, Item, ItemKind, LinkRow } from "../types";
```

Add at the end of the file:

```ts
/** Status options per item kind: the lane names of the boards whose `kinds`
 *  include that kind, in lane order, deduped. */
export function statusOptionsByKind(boards: Board[]): Partial<Record<ItemKind, string[]>> {
  const out: Partial<Record<ItemKind, string[]>> = {};
  for (const board of boards) {
    for (const kind of board.kinds) {
      const list = out[kind] ?? (out[kind] = []);
      for (const lane of board.lanes) {
        if (!list.includes(lane.name)) list.push(lane.name);
      }
    }
  }
  return out;
}
```

- [ ] **Step 6: Run tests + type-check to verify they pass**

Run: `cd frontend && npx vitest run src/lib/boardLanes.test.ts src/api/client.test.ts && npx tsc --noEmit`
Expected: PASS and clean.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/types.ts frontend/src/api/client.ts frontend/src/lib/boardLanes.ts frontend/src/lib/boardLanes.test.ts frontend/src/api/client.test.ts
git commit -m "feat(frontend): planning-interval client fns + statusOptionsByKind"
```

---

### Task 5: `SearchableSelect` ariaLabel + item drawer dropdowns

**Files:**
- Modify: `frontend/src/components/SearchableSelect.tsx`
- Modify: `frontend/src/components/ItemDrawer.tsx`
- Modify: `frontend/src/components/ItemDrawerAssignee.test.tsx`
- Test: `frontend/src/components/ItemDrawerFields.test.tsx` (new)

**Interfaces:**
- Consumes: `statusOptionsByKind` shape (`Partial<Record<ItemKind, string[]>>`), `SearchableSelect`.
- Produces: `ItemDrawer` props `statusOptionsByKind?`, `planningIntervalOptions?`, `leadingTeamOptions?`.

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/components/ItemDrawerFields.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import * as client from "../api/client";
import ItemDrawer from "./ItemDrawer";

afterEach(() => vi.restoreAllMocks());

const feature = {
  id: 5, kind: "feature", type: "Feature", title: "F", status: "Funnel", wsjf_score: null,
  business_value: null, time_criticality: null, risk_reduction: null, cost_of_delay: null,
  job_size: null, parent_id: null, position: 0, description: null, planning_interval: "PI1-Q3",
  iteration: null, leading_team: "Network", story_points: null, tshirt_size: null, kategorie: null,
  art: null, sdi_prio: null, supporting_team: null, externer_partner: null, assignee: null,
  akzeptanzkriterien: null, dependencies: null, bo_stakeholder: null, definition_of_done: null,
  children: [], links: [],
};

it("Status is a dropdown of the item-kind's board lanes and saves the pick", async () => {
  // status starts empty so the dropdown shows all lane options on focus
  // (SearchableSelect filters by the current value while it mirrors it).
  vi.spyOn(client, "getItem").mockResolvedValue({ ...feature, status: null } as never);
  const update = vi.spyOn(client, "updateItem").mockResolvedValue(feature as never);
  render(
    <ItemDrawer
      itemId={5}
      statusOptionsByKind={{ feature: ["Funnel", "Ready"] }}
      onClose={() => {}}
      onChanged={() => {}}
    />,
  );
  const status = await screen.findByRole("combobox", { name: "Status" });
  fireEvent.focus(status);
  fireEvent.mouseDown(screen.getByText("Ready"));
  fireEvent.click(screen.getByRole("button", { name: /save/i }));
  expect(update).toHaveBeenCalledWith(5, expect.objectContaining({ status: "Ready" }));
});

it("keeps an off-list current planning interval selectable", async () => {
  vi.spyOn(client, "getItem").mockResolvedValue({ ...feature, planning_interval: "LEGACY-PI" } as never);
  render(
    <ItemDrawer
      itemId={5}
      planningIntervalOptions={["PI1-Q3", "PI2-Q4"]}
      onClose={() => {}}
      onChanged={() => {}}
    />,
  );
  const pi = await screen.findByRole("combobox", { name: "Planning Interval" });
  expect((pi as HTMLInputElement).value).toBe("LEGACY-PI");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/components/ItemDrawerFields.test.tsx`
Expected: FAIL — the fields aren't comboboxes / props don't exist.

- [ ] **Step 3: Add `ariaLabel` to `SearchableSelect`**

In `frontend/src/components/SearchableSelect.tsx`, add `ariaLabel` to the props:

```tsx
export default function SearchableSelect({
  value,
  options,
  onChange,
  placeholder = "Search…",
  ariaLabel,
}: {
  value: string | null;
  options: string[];
  onChange: (value: string | null) => void;
  placeholder?: string;
  ariaLabel?: string;
}) {
```

Set it on the input and make the clear button's label generic:

```tsx
        <input
          role="combobox"
          aria-label={ariaLabel}
          aria-expanded={open}
```

```tsx
          <button
            aria-label={ariaLabel ? `Clear ${ariaLabel}` : "Clear"}
            onClick={clear}
```

- [ ] **Step 4: Add the drawer props + dropdowns**

In `frontend/src/components/ItemDrawer.tsx`, add `ItemKind` to the type import:

```tsx
import type { Item, ItemKind, ItemUpdate, RelationOption } from "../types";
```

Add the three props to the destructure and the prop type (beside `assigneeOptions`):

```tsx
  assigneeOptions = [],
  statusOptionsByKind = {},
  planningIntervalOptions = [],
  leadingTeamOptions = [],
```

```tsx
  assigneeOptions?: string[];
  statusOptionsByKind?: Partial<Record<ItemKind, string[]>>;
  planningIntervalOptions?: string[];
  leadingTeamOptions?: string[];
```

Add a helper next to the other module-scope helpers (e.g. below `KIND_ACCENT`):

```tsx
const withCurrent = (current: string | null, options: string[]): string[] =>
  current && !options.includes(current) ? [current, ...options] : options;
```

Replace the three `Field`s (Status / Planning Interval / Leading Team) in the Details section with `SearchableSelect`s wrapped like the Assignee label:

```tsx
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-gray-400">
              Status
            </span>
            <SearchableSelect
              ariaLabel="Status"
              value={(value("status") as string | null) || null}
              options={withCurrent(
                (value("status") as string | null) || null,
                statusOptionsByKind[item.kind] ?? [],
              )}
              onChange={(v) => setDraft((d) => ({ ...d, status: v ?? "" }))}
              placeholder="Select status…"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-gray-400">
              Planning Interval
            </span>
            <SearchableSelect
              ariaLabel="Planning Interval"
              value={(value("planning_interval") as string | null) || null}
              options={withCurrent((value("planning_interval") as string | null) || null, planningIntervalOptions)}
              onChange={(v) => setDraft((d) => ({ ...d, planning_interval: v ?? "" }))}
              placeholder="Select planning interval…"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-gray-400">
              Leading Team
            </span>
            <SearchableSelect
              ariaLabel="Leading Team"
              value={(value("leading_team") as string | null) || null}
              options={withCurrent((value("leading_team") as string | null) || null, leadingTeamOptions)}
              onChange={(v) => setDraft((d) => ({ ...d, leading_team: v ?? "" }))}
              placeholder="Select team…"
            />
          </label>
```

Add `ariaLabel="Assignee"` to the existing Assignee `SearchableSelect`.

- [ ] **Step 5: Update the Assignee test for the named combobox**

In `frontend/src/components/ItemDrawerAssignee.test.tsx`, change the combobox query (there are now four) to target Assignee by name:

```tsx
  fireEvent.focus(screen.getByRole("combobox", { name: "Assignee" }));
```

- [ ] **Step 6: Run tests + type-check to verify they pass**

Run: `cd frontend && npx vitest run src/components/ItemDrawerFields.test.tsx src/components/ItemDrawerAssignee.test.tsx src/components/ItemDrawer.test.tsx && npx tsc --noEmit`
Expected: PASS and clean.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/SearchableSelect.tsx frontend/src/components/ItemDrawer.tsx frontend/src/components/ItemDrawerAssignee.test.tsx frontend/src/components/ItemDrawerFields.test.tsx
git commit -m "feat(frontend): DB-mastered dropdowns for status/PI/team in the item drawer"
```

---

### Task 6: Admin `PlanningIntervalsSection`

**Files:**
- Create: `frontend/src/components/admin/PlanningIntervalsSection.tsx`
- Modify: `frontend/src/components/admin/AdminView.tsx`
- Test: `frontend/src/components/admin/PlanningIntervalsSection.test.tsx`

**Interfaces:**
- Consumes: `getPlanningIntervals` / `createPlanningInterval` / `deletePlanningInterval` (Task 4).

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/admin/PlanningIntervalsSection.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import * as client from "../../api/client";
import PlanningIntervalsSection from "./PlanningIntervalsSection";

afterEach(() => vi.restoreAllMocks());

it("lists, adds, and removes planning intervals", async () => {
  vi.spyOn(client, "getPlanningIntervals").mockResolvedValue([{ id: 1, name: "PI1-Q3", position: 0 }] as never);
  const create = vi.spyOn(client, "createPlanningInterval").mockResolvedValue({ id: 2, name: "PI2-Q4", position: 1 } as never);
  const del = vi.spyOn(client, "deletePlanningInterval").mockResolvedValue(undefined as never);

  render(<PlanningIntervalsSection onChanged={() => {}} />);
  expect(await screen.findByText("PI1-Q3")).toBeInTheDocument();

  await userEvent.type(screen.getByPlaceholderText(/new planning interval/i), "PI2-Q4");
  await userEvent.click(screen.getByRole("button", { name: /^add$/i }));
  expect(create).toHaveBeenCalledWith("PI2-Q4");

  await userEvent.click(screen.getByRole("button", { name: /remove planning interval 1/i }));
  expect(del).toHaveBeenCalledWith(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/components/admin/PlanningIntervalsSection.test.tsx`
Expected: FAIL — module missing.

- [ ] **Step 3: Create the section**

Create `frontend/src/components/admin/PlanningIntervalsSection.tsx`:

```tsx
import { useEffect, useState } from "react";
import { createPlanningInterval, deletePlanningInterval, getPlanningIntervals } from "../../api/client";
import type { PlanningInterval } from "../../types";

export default function PlanningIntervalsSection({ onChanged }: { onChanged: () => void }) {
  const [intervals, setIntervals] = useState<PlanningInterval[]>([]);
  const [name, setName] = useState("");

  const reload = () => void getPlanningIntervals().then(setIntervals);
  useEffect(reload, []);

  const add = async () => {
    if (!name.trim()) return;
    await createPlanningInterval(name.trim());
    setName("");
    reload();
    onChanged();
  };

  const remove = async (id: number) => {
    await deletePlanningInterval(id);
    reload();
    onChanged();
  };

  return (
    <section className="rounded-lg border bg-white p-4">
      <h2 className="mb-3 text-sm font-semibold text-gray-700">Planning Intervals</h2>
      <div className="mb-3 flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="New planning interval"
          className="rounded border border-gray-300 px-2 py-1 text-sm"
        />
        <button onClick={add} className="rounded bg-blue-600 px-3 py-1 text-sm text-white">
          Add
        </button>
      </div>
      <ul className="flex flex-col gap-1">
        {intervals.map((p) => (
          <li key={p.id} className="flex items-center justify-between rounded bg-gray-50 px-2 py-1 text-sm">
            <span>{p.name}</span>
            <button
              aria-label={`remove planning interval ${p.id}`}
              onClick={() => remove(p.id)}
              className="text-gray-400 hover:text-red-600"
            >
              ×
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
```

In `frontend/src/components/admin/AdminView.tsx`, import it and render it in the grid beside Teams/Members:

```tsx
import PlanningIntervalsSection from "./PlanningIntervalsSection";
```

```tsx
      <div className="grid gap-4 md:grid-cols-2">
        <TeamsSection onChanged={onChanged} />
        <TeamMembersSection onChanged={onChanged} />
        <PlanningIntervalsSection onChanged={onChanged} />
      </div>
```

- [ ] **Step 4: Run test + type-check to verify they pass**

Run: `cd frontend && npx vitest run src/components/admin/PlanningIntervalsSection.test.tsx && npx tsc --noEmit`
Expected: PASS and clean.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/admin/PlanningIntervalsSection.tsx frontend/src/components/admin/AdminView.tsx frontend/src/components/admin/PlanningIntervalsSection.test.tsx
git commit -m "feat(frontend): admin Planning Intervals section"
```

---

### Task 7: App-wide single source + drawer wiring

**Files:**
- Modify: `frontend/src/hooks/useBoard.ts`
- Modify: `frontend/src/App.tsx`

**Interfaces:**
- Consumes: `getPlanningIntervals`, `getTeams`, `statusOptionsByKind` (Task 4); the drawer props (Task 5).

- [ ] **Step 1: useBoard returns the DB planning-interval names**

In `frontend/src/hooks/useBoard.ts`:

```ts
import { getBoards, getPlanningIntervals, listItems, listLinks } from "../api/client";
import type { Board, Item, LinkRow } from "../types";
```

Add state and include it in the parallel fetch:

```ts
  const [planningIntervals, setPlanningIntervals] = useState<string[]>([]);
```

```ts
      const [b, its, lks, pis] = await Promise.all([
        getBoards(),
        listItems(),
        listLinks(),
        getPlanningIntervals(),
      ]);
      setBoards(b);
      setItems(its);
      setLinks(lks);
      setPlanningIntervals(pis.map((p) => p.name));
```

Return it:

```ts
  return { boards, items, links, planningIntervals, loading, error, reload };
```

- [ ] **Step 2: App uses the DB list + passes drawer props**

In `frontend/src/App.tsx`:

Add imports:

```tsx
import { getTeamMembers, getTeams } from "./api/client";
import { statusOptionsByKind } from "./lib/boardLanes";
```

Destructure `planningIntervals` from `useBoard` and **remove** the derived `planningIntervals` memo (the one building it from `items.map((i) => i.planning_interval)`):

```tsx
  const { boards, items, links, planningIntervals, loading, error, reload } = useBoard();
```

Add leading-team master state + a status-options memo (near `assigneeOptions`):

```tsx
  const [leadingTeamOptions, setLeadingTeamOptions] = useState<string[]>([]);
```

```tsx
  useEffect(() => {
    void getTeams().then((ts) => setLeadingTeamOptions(ts.map((t) => t.name)));
  }, [refreshKey]);

  const statusOptions = useMemo(() => statusOptionsByKind(boards), [boards]);
```

Pass the new props to `ItemDrawer` (in the panels `.map`):

```tsx
              assigneeOptions={assigneeOptions}
              statusOptionsByKind={statusOptions}
              planningIntervalOptions={planningIntervals}
              leadingTeamOptions={leadingTeamOptions}
```

- [ ] **Step 3: Full suite + type-check**

Run: `cd frontend && npx vitest run && npx tsc --noEmit`
Expected: all PASS, clean. (The App-level `planningIntervals` is now the DB list; existing PlanningView/Toolbar/Timeline tests pass their own `planningIntervals` prop directly, so they're unaffected.)

- [ ] **Step 4: Commit**

```bash
git add frontend/src/hooks/useBoard.ts frontend/src/App.tsx
git commit -m "feat(frontend): app-wide DB planning intervals + drawer field options"
```

- [ ] **Step 5: Rebuild the stack, apply the migration, and smoke-test**

Run: `docker compose up -d --build backend frontend` then `docker compose exec -T backend alembic upgrade head`.
Then confirm:
- `curl -s localhost:8000/api/planning-intervals` returns the seeded list (e.g. contains `PI1-Q3`).
- In the app (http://localhost:8080), open an item drawer: Status, Planning Interval, and Leading Team are dropdowns; Status offers the board's lane names; the current value is preselected; saving persists.
- Admin shows a "Planning Intervals" section (add/remove works and the drawer/pills update).

---

## Self-Review Notes

- **Spec coverage:** PlanningInterval model+migration+seed (T1); CRUD API (T2); CSV upsert (T3); FE types/client + `statusOptionsByKind` (T4); drawer dropdowns + `SearchableSelect.ariaLabel` + current-value-kept (T5); Admin section (T6); app-wide single source + Team master + drawer wiring (T7). `items.planning_interval` stays a string throughout.
- **Type consistency:** `statusOptionsByKind(boards): Partial<Record<ItemKind, string[]>>` produced in T4, consumed as the drawer prop in T5 and computed in T7; `planningIntervals: string[]` from useBoard (T7) matches the existing `planningIntervals` prop type on Toolbar/PlanningView/TimelineView/AdminView.
- **Deviation:** the board team *filter* still derives from items (per spec); only the editable drawer field uses the Team master. Two team lists in App (`teams` for the filter, `leadingTeamOptions` for the drawer) is intentional.
