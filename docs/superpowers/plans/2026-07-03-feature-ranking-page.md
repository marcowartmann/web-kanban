# Feature Ranking Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Ranking page showing features by WSJF (read-only) beside a manual drag-and-drop ordering backed by a new `manual_rank` field, with reordering gated to the feature's own team.

**Architecture:** Add a nullable `Item.manual_rank` column surfaced in `ItemRead` (page reuses the existing items feed). A dedicated `POST /api/v1/features/ranking/reorder` endpoint renumbers the global order in one transaction, enforcing team ownership. Frontend adds a `RankingView` using `@dnd-kit/sortable`, with pure sort/target helpers extracted for testing.

**Tech Stack:** FastAPI, SQLAlchemy 2.0, Alembic, Postgres (prod) / SQLite (unit tests); React + TypeScript, `@dnd-kit/core` + `@dnd-kit/sortable`, vitest.

## Global Constraints

- Manual order resolves as: `manual_rank ASC (nulls last)`, then `wsjf_score DESC (nulls last)`, then `id ASC`.
- WSJF order: `wsjf_score DESC (nulls last)`, then `id ASC`.
- Reorder permission: allowed **iff** `caller.team is not None and caller.team.name == feature.leading_team`. No admin override. Enforced server-side (`403`).
- `manual_rank` is read-only output (in `ItemRead`, never in `ItemCreate`/`ItemUpdate`); only the reorder endpoint writes it.
- Backend tests: `cd backend && python -m pytest`. Frontend: `cd frontend && npx vitest run`. Migration verified upgrade+downgrade on compose Postgres.

---

### Task 1: Backend — `manual_rank` column, migration, serialization

**Files:**
- Modify: `backend/app/models.py` (Item, after `position`)
- Modify: `backend/app/schemas.py` (`ItemRead`)
- Create: `backend/alembic/versions/0018_item_manual_rank.py`
- Test: `backend/tests/test_api_items.py`

**Interfaces:**
- Produces: `Item.manual_rank: Mapped[int | None]`; `ItemRead.manual_rank: int | None`; migration `"0018"`.

- [ ] **Step 1: Write the failing serialization test**

In `backend/tests/test_api_items.py`, add:

```python
def test_item_read_includes_manual_rank(client, db_session):
    from app.models import Item, ItemKind
    f = Item(kind=ItemKind.FEATURE, title="F", position=0, manual_rank=3)
    db_session.add(f)
    db_session.commit()
    body = client.get(f"/api/v1/items/{f.id}").json()
    assert body["manual_rank"] == 3
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && python -m pytest tests/test_api_items.py::test_item_read_includes_manual_rank -q`
Expected: FAIL — `TypeError: 'manual_rank' is an invalid keyword argument` / KeyError.

- [ ] **Step 3: Add the column to the model**

In `backend/app/models.py`, in `class Item`, directly under the `position` column:

```python
    manual_rank: Mapped[int | None] = mapped_column(Integer)  # global manual feature ordering; NULL = unranked
```

- [ ] **Step 4: Add `manual_rank` to `ItemRead`**

In `backend/app/schemas.py`, in `class ItemRead`, after `position: int`:

```python
    manual_rank: int | None = None
```

- [ ] **Step 5: Run to verify it passes**

Run: `cd backend && python -m pytest tests/test_api_items.py::test_item_read_includes_manual_rank -q`
Expected: PASS

- [ ] **Step 6: Write the migration**

Create `backend/alembic/versions/0018_item_manual_rank.py`:

```python
"""item.manual_rank: global manual feature ordering

Revision ID: 0018
Revises: 0017
"""
from alembic import op
import sqlalchemy as sa

revision = "0018"
down_revision = "0017"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("items", sa.Column("manual_rank", sa.Integer, nullable=True))


def downgrade() -> None:
    op.drop_column("items", "manual_rank")
```

- [ ] **Step 7: Dry-run the migration on compose Postgres (upgrade + downgrade + upgrade)**

Run:
```bash
cd /Users/marco/Coding/web-kanban
docker compose cp backend/alembic/versions/0018_item_manual_rank.py backend:/app/alembic/versions/0018_item_manual_rank.py
docker compose exec backend alembic upgrade head
docker compose exec db psql -U kanban -d kanban -c '\d items' | grep manual_rank
docker compose exec backend alembic downgrade -1
docker compose exec backend alembic upgrade head
```
Expected: upgrade adds `manual_rank`, downgrade removes it, re-upgrade succeeds — no errors.

- [ ] **Step 8: Run the full backend suite**

Run: `cd backend && python -m pytest -q`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add backend/app/models.py backend/app/schemas.py backend/alembic/versions/0018_item_manual_rank.py backend/tests/test_api_items.py
git commit -m "feat(ranking): add items.manual_rank column + serialization"
```

---

### Task 2: Backend — reorder endpoint

**Files:**
- Create: `backend/app/routers/features_ranking.py`
- Modify: `backend/app/schemas.py` (`FeatureReorderRequest`)
- Modify: `backend/app/main.py` (import + include router)
- Test: `backend/tests/test_api_feature_ranking.py` (new)

**Interfaces:**
- Consumes: `Item.manual_rank` (Task 1); `require_user`, `get_db`, `log_event`.
- Produces: `POST /api/v1/features/ranking/reorder` `{feature_id, after_id|null}` → `204`.

- [ ] **Step 1: Add the request schema**

In `backend/app/schemas.py`, near the other request models:

```python
class FeatureReorderRequest(BaseModel):
    feature_id: int
    after_id: int | None = None
```

- [ ] **Step 2: Write the failing endpoint tests**

Create `backend/tests/test_api_feature_ranking.py`:

```python
from app.auth import get_current_user
from app.main import app
from app.models import Item, ItemKind, Team, User


def _as(user):
    app.dependency_overrides[get_current_user] = lambda: user


def _team(db, name):
    t = Team(name=name)
    db.add(t)
    db.commit()
    db.refresh(t)
    return t


def _user(db, team=None, role="member"):
    u = User(display_name="U", username=f"u{team.id if team else 0}", role=role,
             team_id=team.id if team else None)
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


def _feat(db, title, team_name, wsjf=None, rank=None):
    f = Item(kind=ItemKind.FEATURE, title=title, position=0, leading_team=team_name,
             wsjf_score=wsjf, manual_rank=rank)
    db.add(f)
    db.commit()
    db.refresh(f)
    return f


def test_reorder_renumbers_and_moves(anon_client, db_session):
    net = _team(db_session, "Net")
    user = _user(db_session, team=net)
    a = _feat(db_session, "A", "Net", wsjf=10)
    b = _feat(db_session, "B", "Net", wsjf=8)
    c = _feat(db_session, "C", "Net", wsjf=6)
    _as(user)
    # Move A to just after C: order becomes B, C, A
    resp = anon_client.post("/api/v1/features/ranking/reorder",
                            json={"feature_id": a.id, "after_id": c.id})
    assert resp.status_code == 204
    db_session.expire_all()
    ranks = {f.title: f.manual_rank for f in db_session.query(Item).all()}
    assert ranks == {"B": 1, "C": 2, "A": 3}
    app.dependency_overrides.clear()


def test_reorder_after_none_moves_to_top(anon_client, db_session):
    net = _team(db_session, "Net")
    user = _user(db_session, team=net)
    a = _feat(db_session, "A", "Net", wsjf=10)
    b = _feat(db_session, "B", "Net", wsjf=8)
    _as(user)
    resp = anon_client.post("/api/v1/features/ranking/reorder",
                            json={"feature_id": b.id, "after_id": None})
    assert resp.status_code == 204
    db_session.expire_all()
    assert db_session.get(Item, b.id).manual_rank == 1
    app.dependency_overrides.clear()


def test_reorder_wrong_team_is_403(anon_client, db_session):
    net = _team(db_session, "Net")
    cloud = _team(db_session, "Cloud")
    user = _user(db_session, team=cloud)
    a = _feat(db_session, "A", "Net", wsjf=10)
    _as(user)
    resp = anon_client.post("/api/v1/features/ranking/reorder",
                            json={"feature_id": a.id, "after_id": None})
    assert resp.status_code == 403
    app.dependency_overrides.clear()


def test_reorder_no_team_is_403(anon_client, db_session):
    user = _user(db_session, team=None)
    a = _feat(db_session, "A", "Net", wsjf=10)
    _as(user)
    resp = anon_client.post("/api/v1/features/ranking/reorder",
                            json={"feature_id": a.id, "after_id": None})
    assert resp.status_code == 403
    app.dependency_overrides.clear()


def test_reorder_unknown_feature_404(anon_client, db_session):
    net = _team(db_session, "Net")
    user = _user(db_session, team=net)
    _as(user)
    resp = anon_client.post("/api/v1/features/ranking/reorder",
                            json={"feature_id": 9999, "after_id": None})
    assert resp.status_code == 404
    app.dependency_overrides.clear()


def test_reorder_non_feature_422(anon_client, db_session):
    net = _team(db_session, "Net")
    user = _user(db_session, team=net)
    story = Item(kind=ItemKind.STORY, title="S", position=0, leading_team="Net")
    db_session.add(story)
    db_session.commit()
    db_session.refresh(story)
    _as(user)
    resp = anon_client.post("/api/v1/features/ranking/reorder",
                            json={"feature_id": story.id, "after_id": None})
    assert resp.status_code == 422
    app.dependency_overrides.clear()


def test_reorder_materializes_default_wsjf_order(anon_client, db_session):
    net = _team(db_session, "Net")
    user = _user(db_session, team=net)
    # All ranks null; wsjf desc default = high, mid, low
    high = _feat(db_session, "high", "Net", wsjf=20)
    mid = _feat(db_session, "mid", "Net", wsjf=10)
    low = _feat(db_session, "low", "Net", wsjf=5)
    _as(user)
    # Move low to top → low, high, mid
    resp = anon_client.post("/api/v1/features/ranking/reorder",
                            json={"feature_id": low.id, "after_id": None})
    assert resp.status_code == 204
    db_session.expire_all()
    ranks = {f.title: f.manual_rank for f in db_session.query(Item).all()}
    assert ranks == {"low": 1, "high": 2, "mid": 3}
    app.dependency_overrides.clear()
```

- [ ] **Step 3: Run to verify failures**

Run: `cd backend && python -m pytest tests/test_api_feature_ranking.py -q`
Expected: FAIL — 404 (route missing) on all.

- [ ] **Step 4: Implement the router**

Create `backend/app/routers/features_ranking.py`:

```python
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.audit import log_event
from app.auth import require_user
from app.db import get_db
from app.models import Item, ItemKind, User
from app.schemas import FeatureReorderRequest

router = APIRouter(prefix="/api/v1/features", tags=["features"])


def _resolved_order(features: list[Item]) -> list[Item]:
    """manual_rank ASC (nulls last), then wsjf_score DESC (nulls last), then id."""
    def key(f: Item):
        manual = (0, f.manual_rank) if f.manual_rank is not None else (1, 0)
        wsjf = (0, -float(f.wsjf_score)) if f.wsjf_score is not None else (1, 0.0)
        return (manual, wsjf, f.id)
    return sorted(features, key=key)


@router.post("/ranking/reorder", status_code=204)
def reorder_ranking(
    payload: FeatureReorderRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_user),
) -> None:
    moved = db.get(Item, payload.feature_id)
    if moved is None:
        raise HTTPException(status_code=404, detail="Feature not found")
    if moved.kind != ItemKind.FEATURE:
        raise HTTPException(status_code=422, detail="Not a feature")
    if user.team is None or user.team.name != moved.leading_team:
        raise HTTPException(status_code=403, detail="You can only rank features of your own team")

    after_id = payload.after_id
    if after_id is not None:
        anchor = db.get(Item, after_id)
        if anchor is None:
            raise HTTPException(status_code=404, detail="Anchor feature not found")
        if anchor.kind != ItemKind.FEATURE:
            raise HTTPException(status_code=422, detail="Anchor is not a feature")

    features = list(db.scalars(select(Item).where(Item.kind == ItemKind.FEATURE)))
    ordered = _resolved_order(features)
    ordered = [f for f in ordered if f.id != moved.id]
    insert_at = 0
    if after_id is not None:
        insert_at = next(i for i, f in enumerate(ordered) if f.id == after_id) + 1
    ordered.insert(insert_at, moved)
    for i, f in enumerate(ordered, start=1):
        f.manual_rank = i

    log_event(
        db, actor=user, event_type="feature.reranked",
        entity_type="item", entity_id=moved.id, entity_label=moved.title,
    )
    db.commit()
```

- [ ] **Step 5: Wire the router into `main.py`**

In `backend/app/main.py`, add `features_ranking` to the import line:

```python
from app.routers import auth, imports, items, boards, teams, capacities, containers, links, planning_intervals, users, audit, comments, features_ranking
```
And add `features_ranking.router,` to the `protected` tuple (the one wrapped with `dependencies=[Depends(require_user)]`).

- [ ] **Step 6: Run the ranking tests**

Run: `cd backend && python -m pytest tests/test_api_feature_ranking.py -q`
Expected: PASS (all 7).

- [ ] **Step 7: Run the full backend suite**

Run: `cd backend && python -m pytest -q`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add backend/app/routers/features_ranking.py backend/app/schemas.py backend/app/main.py backend/tests/test_api_feature_ranking.py
git commit -m "feat(ranking): team-gated feature reorder endpoint"
```

---

### Task 3: Frontend — types, client, pure ranking helpers

**Files:**
- Modify: `frontend/src/types.ts` (`Item`)
- Modify: `frontend/src/api/client.ts` (`reorderFeatureRanking`)
- Create: `frontend/src/lib/ranking.ts`
- Test: `frontend/src/lib/ranking.test.ts` (new)

**Interfaces:**
- Produces:
  - `Item.manual_rank: number | null`.
  - `reorderFeatureRanking(featureId: number, afterId: number | null): Promise<void>`.
  - `byWsjf(features: Item[]): Item[]`, `byManual(features: Item[]): Item[]`, `computeAfterId(order: Item[], activeId: number, overId: number): number | null`.

- [ ] **Step 1: Write the failing helper tests**

Create `frontend/src/lib/ranking.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { byManual, byWsjf, computeAfterId } from "./ranking";
import type { Item } from "../types";

function f(id: number, wsjf: number | null, rank: number | null): Item {
  return { id, wsjf_score: wsjf, manual_rank: rank } as Item;
}

describe("byWsjf", () => {
  it("sorts by wsjf desc, nulls last, id tiebreak", () => {
    const out = byWsjf([f(1, 5, null), f(2, 10, null), f(3, null, null), f(4, 10, null)]);
    expect(out.map((x) => x.id)).toEqual([2, 4, 1, 3]);
  });
});

describe("byManual", () => {
  it("ranked first (asc), then wsjf desc for unranked", () => {
    const out = byManual([f(1, 5, null), f(2, 20, 2), f(3, 1, 1), f(4, 8, null)]);
    expect(out.map((x) => x.id)).toEqual([3, 2, 4, 1]);
  });
});

describe("computeAfterId", () => {
  const order = [f(1, null, 1), f(2, null, 2), f(3, null, 3)];
  it("returns the id now before the moved item", () => {
    expect(computeAfterId(order, 1, 3)).toBe(3); // move 1 after 3 → [2,3,1]; anchor is 3
  });
  it("returns null when moved to the top", () => {
    expect(computeAfterId(order, 3, 1)).toBe(null); // move 3 above 1 → [3,1,2]
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npx vitest run src/lib/ranking.test.ts`
Expected: FAIL — `Cannot find module './ranking'`.

- [ ] **Step 3: Implement the helpers**

Create `frontend/src/lib/ranking.ts`:

```typescript
import { arrayMove } from "@dnd-kit/sortable";
import type { Item } from "../types";

function cmpDescNullsLast(a: number | null, b: number | null): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return b - a;
}

function cmpAscNullsLast(a: number | null, b: number | null): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return a - b;
}

export function byWsjf(features: Item[]): Item[] {
  return [...features].sort(
    (a, b) => cmpDescNullsLast(a.wsjf_score, b.wsjf_score) || a.id - b.id,
  );
}

export function byManual(features: Item[]): Item[] {
  return [...features].sort(
    (a, b) =>
      cmpAscNullsLast(a.manual_rank, b.manual_rank) ||
      cmpDescNullsLast(a.wsjf_score, b.wsjf_score) ||
      a.id - b.id,
  );
}

/** Given the current manual order and a drag from activeId onto overId,
 *  return the id that ends up immediately before the moved item (the reorder
 *  anchor), or null if it moves to the top. */
export function computeAfterId(order: Item[], activeId: number, overId: number): number | null {
  const oldIndex = order.findIndex((f) => f.id === activeId);
  const newIndex = order.findIndex((f) => f.id === overId);
  if (oldIndex < 0 || newIndex < 0) return null;
  const next = arrayMove(order, oldIndex, newIndex);
  const idx = next.findIndex((f) => f.id === activeId);
  return idx > 0 ? next[idx - 1].id : null;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd frontend && npx vitest run src/lib/ranking.test.ts`
Expected: PASS

- [ ] **Step 5: Add `manual_rank` to the `Item` type**

In `frontend/src/types.ts`, in `interface Item`, after `position: number;`:

```typescript
  manual_rank: number | null;
```

- [ ] **Step 6: Add the client call**

In `frontend/src/api/client.ts`, near the other item functions:

```typescript
export function reorderFeatureRanking(featureId: number, afterId: number | null): Promise<void> {
  return request<void>(`${API}/features/ranking/reorder`, json({ feature_id: featureId, after_id: afterId }));
}
```

- [ ] **Step 7: Typecheck + run lib tests**

Run: `cd frontend && npx tsc --noEmit && npx vitest run src/lib/ranking.test.ts`
Expected: PASS, no type errors.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/types.ts frontend/src/api/client.ts frontend/src/lib/ranking.ts frontend/src/lib/ranking.test.ts
git commit -m "feat(ranking): item manual_rank type, client, sort helpers"
```

---

### Task 4: Frontend — RankingView + nav wiring

**Files:**
- Create: `frontend/src/components/RankingView.tsx`
- Modify: `frontend/src/App.tsx` (View type + nav + render)
- Test: `frontend/src/components/RankingView.test.tsx` (new)

**Interfaces:**
- Consumes: `byWsjf`, `byManual`, `computeAfterId`, `reorderFeatureRanking` (Task 3); `items`, `planningIntervals`, `containers`, `user` from `App`.

- [ ] **Step 1: Write the failing component tests**

Create `frontend/src/components/RankingView.test.tsx`:

```typescript
import { render, screen, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import RankingView from "./RankingView";
import type { AuthUser, Item } from "../types";

function feat(id: number, title: string, team: string | null, wsjf: number | null, rank: number | null): Item {
  return { id, kind: "feature", title, leading_team: team, wsjf_score: wsjf, manual_rank: rank } as Item;
}

const user = { id: 1, display_name: "U", role: "member", is_active: true, team_name: "Net" } as AuthUser;

const items: Item[] = [
  feat(1, "Alpha", "Net", 10, null),
  feat(2, "Bravo", "Cloud", 20, null),
  feat(3, "Charlie", "Net", 5, null),
];

function renderView() {
  render(
    <RankingView items={items} planningIntervals={[]} teams={["Net", "Cloud"]} containers={[]} user={user} onChanged={vi.fn()} />,
  );
}

it("renders the WSJF list in descending score order", () => {
  renderView();
  const wsjf = screen.getByTestId("wsjf-list");
  const titles = within(wsjf).getAllByTestId("rank-title").map((n) => n.textContent);
  expect(titles).toEqual(["Bravo", "Alpha", "Charlie"]);
});

it("marks only own-team rows draggable in the manual list", () => {
  renderView();
  const manual = screen.getByTestId("manual-list");
  const rows = within(manual).getAllByTestId("manual-row");
  // rows carry data-draggable="true" only for team Net (Alpha, Charlie)
  const byTitle = Object.fromEntries(
    rows.map((r) => [within(r).getByTestId("rank-title").textContent, r.getAttribute("data-draggable")]),
  );
  expect(byTitle["Alpha"]).toBe("true");
  expect(byTitle["Charlie"]).toBe("true");
  expect(byTitle["Bravo"]).toBe("false");
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npx vitest run src/components/RankingView.test.tsx`
Expected: FAIL — `Cannot find module './RankingView'`.

- [ ] **Step 3: Implement `RankingView`**

Create `frontend/src/components/RankingView.tsx`:

```tsx
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
import type { AuthUser, Container, Item, PlanningInterval } from "../types";
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
  planningIntervals: PlanningInterval[];
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
        <FilterSelect label="Interval" value={pi} options={planningIntervals.map((p) => p.name)} onChange={setPi} />
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
```

- [ ] **Step 4: Run the component tests**

Run: `cd frontend && npx vitest run src/components/RankingView.test.tsx`
Expected: PASS

- [ ] **Step 5: Wire the nav in `App.tsx`**

In `frontend/src/App.tsx`:

Add the import:
```tsx
import RankingView from "./components/RankingView";
```
Extend the `View` type:
```tsx
type View = "board" | "admin" | "planning" | "timeline" | "ranking";
```
Add a nav button after `timeline`:
```tsx
            {navButton("ranking", "Ranking")}
```
Add a render branch (place it alongside the other `view === …` branches, e.g. right after the `timeline` branch):
```tsx
      ) : view === "ranking" ? (
        <RankingView
          items={items}
          planningIntervals={planningIntervals}
          teams={teams}
          containers={containers}
          user={user}
          onChanged={handleChanged}
        />
```

- [ ] **Step 6: Full frontend suite + build**

Run: `cd frontend && npx vitest run && npm run build`
Expected: PASS (build = tsc typecheck clean).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/RankingView.tsx frontend/src/components/RankingView.test.tsx frontend/src/App.tsx
git commit -m "feat(ranking): RankingView page with WSJF + manual drag lists"
```

---

## Final verification

- [ ] Backend: `cd backend && python -m pytest -q` → green.
- [ ] Frontend: `cd frontend && npx vitest run && npm run build` → green.
- [ ] Migration reconfirmed on Postgres (upgrade/downgrade/upgrade clean).
- [ ] Manual smoke in the Docker stack (rebuild images): open **Ranking**; the WSJF list is descending by score; drag one of your team's features in the Manual list → order persists after reload; a feature from another team shows the lock and cannot be dragged.
```
