# Concurrency + /api/v1 + Pagination Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move all resource routes to `/api/v1`, add optimistic locking to items (required `version`, 409 on conflict), and paginate `GET /api/v1/items` behind an auto-paginating client.

**Architecture:** Backend-first: bulk URL migration (routers + tests), then the `version` column/flow, then the `{items, total}` page contract. Frontend follows: one `API` base constant, version threading through all five `updateItem` call sites with `ConflictError` handling, and a pagination loop hidden inside `listItems()`.

**Tech Stack:** FastAPI, SQLAlchemy 2.0, Alembic, Postgres (SQLite fixtures in tests), React 18 + TS + vitest.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-02-concurrency-api-v1-design.md`. Branch `feat/concurrency-api-v1`.
- `GET /api/health` stays **unversioned** (main.py, compose healthcheck, nginx untouched). Two backend tests reference it and must keep `/api/health`: `test_authz.py:8`, `test_health.py:2`.
- Conflict detail EXACTLY: `"Item was modified by someone else — reload and retry"` (409).
- Drawer conflict copy EXACTLY: `This item was changed by someone else — showing the latest version.`
- Migration id `0013`, `down_revision = "0012"`, file `backend/alembic/versions/0013_item_version.py`. Migration tasks MUST dry-run `alembic upgrade head` + `alembic downgrade 0012` against the compose Postgres and leave the DB at `0012` (Task 6 deploys for real).
- `version` is never audit-tracked (not in `ITEM_TRACKED_FIELDS`); a conflicted PATCH writes nothing (no changes, no audit rows).
- Items page contract: `{"items": [...], "total": N}`; `limit` default 200 clamped to 1..1000; `offset` clamped >= 0; ordering `Item.position`; filters unchanged.
- Client: `export const API = "/api/v1";` — every client.ts URL templates off it; `listItems()` keeps returning `Promise<Item[]>` (auto-paginates with per-page limit 500).
- `updateItem` client signature: `updateItem(id: number, patch: ItemUpdate & { version: number })` — types.ts `ItemUpdate` itself stays all-optional (the drawer's `draft` starts `{}`).
- Suite math: backend 158 baseline → 158 (T1) → 162 (T3) → 165 (T4). Frontend 177 baseline → 177 (T2) → 181 (T5).
- ENV: backend tests run in the container (no bind mount): `rm -rf` + `docker compose cp` app/alembic/tests, `pip install -q "pytest>=8.2" "httpx>=0.27" "bcrypt>=4.1"`, `python -m pytest -q /app/tests`. Frontend on host.

---

### Task 1: Backend `/api/v1` — router prefixes + bulk test URL migration

**Files:**
- Modify: all 12 files in `backend/app/routers/` (prefix strings only)
- Modify: every file in `backend/tests/` containing `"/api/` (22 files, mechanical)

**Interfaces:**
- Produces: all resource routes under `/api/v1/...`; `/api/health` unchanged. Tasks 2-6 assume exactly this.

- [ ] **Step 1: Change the 12 router prefixes**

Exact old → new (one edit each; only the prefix string changes, tags/dependencies stay):

| File | Old | New |
|---|---|---|
| `routers/auth.py:22` | `prefix="/api/auth"` | `prefix="/api/v1/auth"` |
| `routers/items.py:13` | `prefix="/api/items"` | `prefix="/api/v1/items"` |
| `routers/links.py:12` | `prefix="/api"` | `prefix="/api/v1"` |
| `routers/imports.py:11` | `prefix="/api"` | `prefix="/api/v1"` |
| `routers/teams.py:11` | `prefix="/api/teams"` | `prefix="/api/v1/teams"` |
| `routers/team_members.py:11` | `prefix="/api/team-members"` | `prefix="/api/v1/team-members"` |
| `routers/planning_intervals.py:11` | `prefix="/api/planning-intervals"` | `prefix="/api/v1/planning-intervals"` |
| `routers/capacities.py:11` | `prefix="/api/capacities"` | `prefix="/api/v1/capacities"` |
| `routers/boards.py:11` | `prefix="/api"` | `prefix="/api/v1"` |
| `routers/users.py:12` | `prefix="/api/users"` | `prefix="/api/v1/users"` |
| `routers/audit.py:10` | `prefix="/api/audit"` | `prefix="/api/v1/audit"` |
| `routers/comments.py:11` | `prefix="/api"` | `prefix="/api/v1"` |

Do NOT touch `main.py`'s `@app.get("/api/health")`.

- [ ] **Step 2: Bulk-migrate the test URLs (with health carve-out)**

```bash
python3 - <<'EOF'
import pathlib
for p in sorted(pathlib.Path("backend/tests").glob("*.py")):
    s = p.read_text()
    s2 = s.replace('"/api/', '"/api/v1/').replace('"/api/v1/health"', '"/api/health"')
    if s2 != s:
        p.write_text(s2)
        print("rewrote", p)
EOF
```

- [ ] **Step 3: Verify the rewrite is complete and health survived**

```bash
grep -rn '"/api/' backend/tests | grep -v '"/api/v1/'
```
Expected: exactly the two health lines (`test_authz.py`, `test_health.py`), nothing else.

- [ ] **Step 4: Run the full backend suite in the container**

Copy dance + `docker compose exec -T backend python -m pytest -q /app/tests`
Expected: **158 passed** (same count — pure rename).

- [ ] **Step 5: Commit**

```bash
git add backend/app/routers backend/tests
git commit -m "feat(backend): move all resource routes to /api/v1 (health stays unversioned)"
```

---

### Task 2: Frontend `/api/v1` — API constant + client/test URL migration

**Files:**
- Modify: `frontend/src/api/client.ts` (42 URL literals)
- Modify: `frontend/src/api/client.test.ts`, `client.renames.test.ts`, `client.audit.test.ts`, `client.auth.test.ts`

**Interfaces:**
- Produces: `export const API = "/api/v1";` in client.ts — Task 5's code uses it.

- [ ] **Step 1: Add the constant and convert every URL**

After the imports in `client.ts`:

```ts
/** Versioned API base. Breaking changes bump this (see the /api/v1 spec). */
export const API = "/api/v1";
```

Then convert ALL 42 URLs: plain strings become template literals off the constant (`"/api/teams"` → `` `${API}/teams` ``), existing template literals swap their prefix (`` `/api/teams/${id}` `` → `` `${API}/teams/${id}` ``). The three-arg auth calls keep their `notify401=false` arguments unchanged.

- [ ] **Step 2: Verify no unversioned URLs remain**

```bash
grep -n '"/api/\|`/api/' frontend/src/api/client.ts
```
Expected: only the `export const API = "/api/v1";` line.

- [ ] **Step 3: Migrate the four client test files**

```bash
python3 - <<'EOF'
import pathlib
for name in ["client.test.ts", "client.renames.test.ts", "client.audit.test.ts", "client.auth.test.ts"]:
    p = pathlib.Path("frontend/src/api") / name
    s = p.read_text()
    s2 = s.replace('"/api/', '"/api/v1/')
    if s2 != s:
        p.write_text(s2)
        print("rewrote", p)
EOF
```

- [ ] **Step 4: Run the full frontend suite + type-check**

`cd frontend && npx vitest run && npx tsc --noEmit`
Expected: **177 passed** (same count), tsc clean.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api
git commit -m "feat(frontend): API base constant /api/v1 across the client"
```

---

### Task 3: Optimistic locking backend — migration 0013 + required version + 409

**Files:**
- Create: `backend/alembic/versions/0013_item_version.py`
- Modify: `backend/app/models.py` (Item, after `position`)
- Modify: `backend/app/schemas.py` (`ItemUpdate`, `ItemRead`)
- Modify: `backend/app/routers/items.py` (`update_item`)
- Modify: `backend/tests/test_api_items.py` (6 PATCH payloads), `backend/tests/test_audit_items.py` (2 PATCH payloads)
- Test: `backend/tests/test_item_version.py` (new)

**Interfaces:**
- Consumes: Task 1's `/api/v1/items` routes.
- Produces: `ItemRead.version: int`; PATCH requires `version` (else 422); mismatch → 409 `"Item was modified by someone else — reload and retry"`. Task 5 threads this.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_item_version.py`:

```python
from app.models import AuditEvent


def _create(client, **fields):
    body = {"kind": "feature", "title": "V", **fields}
    resp = client.post("/api/v1/items", json=body)
    assert resp.status_code == 201
    return resp.json()


def test_version_starts_at_1_and_increments(client):
    item = _create(client)
    assert item["version"] == 1
    resp = client.patch(
        f"/api/v1/items/{item['id']}", json={"title": "V2", "version": 1}
    )
    assert resp.status_code == 200
    assert resp.json()["version"] == 2


def test_stale_version_conflicts_and_writes_nothing(client, db_session):
    item = _create(client)
    client.patch(f"/api/v1/items/{item['id']}", json={"title": "First", "version": 1})
    events_before = db_session.query(AuditEvent).count()
    resp = client.patch(
        f"/api/v1/items/{item['id']}", json={"title": "Second", "version": 1}
    )
    assert resp.status_code == 409
    assert resp.json()["detail"] == "Item was modified by someone else — reload and retry"
    assert client.get(f"/api/v1/items/{item['id']}").json()["title"] == "First"
    assert db_session.query(AuditEvent).count() == events_before


def test_missing_version_is_422(client):
    item = _create(client)
    resp = client.patch(f"/api/v1/items/{item['id']}", json={"title": "X"})
    assert resp.status_code == 422


def test_version_is_never_audit_tracked(client, db_session):
    item = _create(client)
    client.patch(f"/api/v1/items/{item['id']}", json={"status": "New", "version": 1})
    fields = [e.field for e in db_session.query(AuditEvent).all() if e.event_type == "item.updated"]
    assert "version" not in fields
    assert "status" in fields
```

- [ ] **Step 2: Run to verify failure**

`docker compose exec -T backend python -m pytest -q /app/tests/test_item_version.py`
Expected: FAIL — no `version` in responses (KeyError), PATCH without version returns 200 not 422.

- [ ] **Step 3: Implement**

`backend/app/models.py` — after `position`:

```python
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
```

`backend/app/schemas.py` — `ItemUpdate` gains its ONLY required field (keep `extra="forbid"`), placed first in the class body:

```python
    version: int
```

`ItemRead` gains, after `position: int`:

```python
    version: int
```

`backend/app/routers/items.py` `update_item` — replace the current top of the function body:

```python
    item = _get_or_404(db, item_id)
    if payload.version != item.version:
        raise HTTPException(
            status_code=409,
            detail="Item was modified by someone else — reload and retry",
        )
    changes = payload.model_dump(exclude_unset=True)
    changes.pop("version", None)
```

and after the `recompute(item)` conditional add:

```python
    item.version += 1
```

(the `before`/diff/audit lines stay exactly as they are — `version` is not in `ITEM_TRACKED_FIELDS`, so nothing else changes).

Create `backend/alembic/versions/0013_item_version.py`:

```python
"""optimistic locking: items.version

Revision ID: 0013
Revises: 0012
"""
from alembic import op
import sqlalchemy as sa

revision = "0013"
down_revision = "0012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "items",
        sa.Column("version", sa.Integer, nullable=False, server_default="1"),
    )


def downgrade() -> None:
    op.drop_column("items", "version")
```

- [ ] **Step 4: Update the 8 existing PATCH payloads**

`backend/tests/test_api_items.py` (post-Task-1 URLs):
- line ~30: `json={"status": "New", "version": 1}`
- line ~38: `json={"job_size": 3, "version": 1}`
- line ~80: `json={"iteration": 6, "version": 1}`
- line ~84: `json={"iteration": None, "version": 2}` (the previous PATCH in the same test succeeded, so the item is at version 2)
- lines ~91 and ~92: `json={"iteration": 0, "version": 1}` / `json={"iteration": 7, "version": 1}` (both 422 on iteration; version must be present and valid so the 422 is for the right reason — both PATCHes fail, so version stays 1)

`backend/tests/test_audit_items.py`:
- line ~40: `json={"title": "F1", "version": 1}`
- line ~55: `json={"status": "Ready", "version": 1}`

- [ ] **Step 5: Dry-run the migration against Postgres (both directions)**

```bash
docker compose cp ./backend/alembic backend:/app/alembic
docker compose exec -T backend alembic upgrade head      # expect 0013
docker compose exec -T backend alembic downgrade 0012    # back
docker compose exec -T backend alembic current           # expect: 0012
```

- [ ] **Step 6: Run the full backend suite**

Copy dance + `docker compose exec -T backend python -m pytest -q /app/tests`
Expected: **162 passed** (158 + 4 new).

- [ ] **Step 7: Commit**

```bash
git add backend/alembic/versions/0013_item_version.py backend/app/models.py backend/app/schemas.py backend/app/routers/items.py backend/tests/test_item_version.py backend/tests/test_api_items.py backend/tests/test_audit_items.py
git commit -m "feat(backend): optimistic locking on items (required version, 409 on conflict)"
```

---

### Task 4: Paginated `GET /api/v1/items`

**Files:**
- Modify: `backend/app/routers/items.py` (`list_items`, imports)
- Modify: `backend/app/schemas.py` (add `ItemPage` after `ItemRead`)
- Modify: `backend/tests/test_api_items.py` (3 list assertions)
- Test: append to `backend/tests/test_api_items.py`

**Interfaces:**
- Consumes: Task 3's `ItemRead.version`.
- Produces: `GET /api/v1/items` → `{"items": [...], "total": N}` with `limit` (default 200, clamped 1..1000) and `offset` (clamped >= 0). Task 5's client loop consumes this.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_api_items.py`:

```python
def test_items_are_paginated_with_total(client, db_session):
    for i in range(5):
        _make_feature(db_session, title=f"P{i}", position=i)
    db_session.commit()
    page = client.get("/api/v1/items?limit=2&offset=2").json()
    assert page["total"] == 5
    assert [i["title"] for i in page["items"]] == ["P2", "P3"]


def test_items_limit_is_clamped(client, db_session):
    _make_feature(db_session)
    db_session.commit()
    assert client.get("/api/v1/items?limit=99999").status_code == 200
    assert client.get("/api/v1/items?limit=0").status_code == 200
    assert client.get("/api/v1/items?offset=-5").status_code == 200


def test_items_total_respects_filters(client, db_session):
    _make_feature(db_session, title="Filtered", planning_interval="PI-X")
    _make_feature(db_session, title="Other")
    db_session.commit()
    page = client.get("/api/v1/items?planning_interval=PI-X&limit=1").json()
    assert page["total"] == 1
    assert page["items"][0]["title"] == "Filtered"
```

(`_make_feature(db, **kw)` accepts arbitrary kwargs and defaults `position=0` — the explicit `position=i` above is what makes the page order deterministic.)

- [ ] **Step 2: Run to verify failure**

`docker compose exec -T backend python -m pytest -q /app/tests/test_api_items.py`
Expected: new tests FAIL — response is a JSON array, not an object with `total`.

- [ ] **Step 3: Implement**

`backend/app/schemas.py` — after `ItemRead`:

```python
class ItemPage(BaseModel):
    items: list[ItemRead]
    total: int
```

`backend/app/routers/items.py` — extend imports (`func` from sqlalchemy; `ItemPage` from app.schemas) and replace `list_items`:

```python
@router.get("", response_model=ItemPage)
def list_items(
    kind: ItemKind | None = None,
    status: str | None = None,
    planning_interval: str | None = None,
    leading_team: str | None = None,
    assignee: str | None = None,
    q: str | None = None,
    limit: int = 200,
    offset: int = 0,
    db: Session = Depends(get_db),
) -> ItemPage:
    stmt = select(Item)
    if kind is not None:
        stmt = stmt.where(Item.kind == kind)
    if status is not None:
        stmt = stmt.where(Item.status == status)
    if planning_interval is not None:
        stmt = stmt.where(Item.planning_interval == planning_interval)
    if leading_team is not None:
        stmt = stmt.where(Item.leading_team == leading_team)
    if assignee is not None:
        stmt = stmt.where(Item.assignee == assignee)
    if q:
        stmt = stmt.where(Item.title.ilike(f"%{q}%"))
    total = db.scalar(select(func.count()).select_from(stmt.subquery()))
    limit = max(1, min(limit, 1000))
    offset = max(0, offset)
    rows = db.scalars(stmt.order_by(Item.position).offset(offset).limit(limit))
    return ItemPage(items=[ItemRead.model_validate(r) for r in rows], total=total or 0)
```

Update the 3 existing list assertions in `test_api_items.py` (post-Task-1 URLs):
- `by_kind = client.get("/api/v1/items?kind=risk").json()["items"]`
- `by_q = client.get("/api/v1/items?q=alpha").json()["items"]`
- `out = client.get("/api/v1/items?planning_interval=PI1-Q3").json()["items"]`

(`test_authz.py`'s anonymous `get("/api/v1/items")` asserts only the 401 status — unchanged.)

- [ ] **Step 4: Run the full backend suite**

Copy dance + `docker compose exec -T backend python -m pytest -q /app/tests`
Expected: **165 passed** (162 + 3 new).

- [ ] **Step 5: Commit**

```bash
git add backend/app/routers/items.py backend/app/schemas.py backend/tests/test_api_items.py
git commit -m "feat(backend): paginated items collection with filtered totals"
```

---

### Task 5: Frontend — version threading, conflict UX, pagination loop

**Files:**
- Modify: `frontend/src/types.ts` (`Item` gains `version: number`)
- Modify: `frontend/src/api/client.ts` (`listItems` loop, `updateItem` signature)
- Modify: `frontend/src/components/BoardView.tsx`, `StoryBoardModal.tsx`, `PlanningView.tsx`, `TimelineView.tsx` (drag handlers + their call sites), `ItemDrawer.tsx` (save + conflict line)
- Modify: their test files where handler signatures / `updateItem` assertions change, plus typed `Item` fixtures gain `version: 1` (tsc pinpoints them; `as unknown as Item` casts need nothing)
- Test: new cases in `frontend/src/api/client.test.ts` and `frontend/src/components/ItemDrawer.test.tsx` and `BoardView.test.tsx`

**Interfaces:**
- Consumes: Task 2's `API` constant, Task 3's 409 + `version`, Task 4's page shape, existing `ConflictError`.
- Produces: `updateItem(id: number, patch: ItemUpdate & { version: number })`; `listItems()` unchanged signature (`Promise<Item[]>`); drag handlers gain an `items: Item[]` parameter: `handleCardDragEnd(event, items, reload)` and likewise `handleStoryDragEnd`, `handlePlanDragEnd`, `handleTimelineDragEnd`.

- [ ] **Step 1: Write the failing tests**

Append to `frontend/src/api/client.test.ts`:

```ts
it("listItems auto-paginates until total", async () => {
  const page = (items: unknown[], total: number) =>
    ({ ok: true, status: 200, json: () => Promise.resolve({ items, total }) }) as Response;
  const spy = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(page([{ id: 1 }, { id: 2 }], 3))
    .mockResolvedValueOnce(page([{ id: 3 }], 3));
  const out = await listItems();
  expect(out.map((i) => i.id)).toEqual([1, 2, 3]);
  expect(spy).toHaveBeenNthCalledWith(1, "/api/v1/items?limit=500&offset=0", undefined);
  expect(spy).toHaveBeenNthCalledWith(2, "/api/v1/items?limit=500&offset=2", undefined);
});

it("updateItem sends the version in the body", async () => {
  const spy = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({}) } as Response);
  await updateItem(7, { status: "New", version: 3 });
  const body = JSON.parse((spy.mock.calls[0][1] as RequestInit).body as string);
  expect(body).toEqual({ status: "New", version: 3 });
});
```

(add `listItems`/`updateItem` to the file's imports if missing.)

Append to `frontend/src/components/BoardView.test.tsx` (imports exist; add `ConflictError` import from `../api/client`):

```ts
it("drag conflict still reloads and does not throw", async () => {
  vi.spyOn(client, "updateItem").mockRejectedValue(new ConflictError("Item was modified by someone else — reload and retry"));
  const reload = vi.fn();
  const items = [{ id: 5, version: 2 } as unknown as Item];
  await handleCardDragEnd(
    { active: { id: 5 }, over: { id: "Ready" } } as unknown as DragEndEvent,
    items,
    reload,
  );
  expect(reload).toHaveBeenCalled();
});
```

Append to `frontend/src/components/ItemDrawer.test.tsx` (uses the file's existing mock setup for `getItem`; add `ConflictError` to its client imports):

```ts
it("shows the conflict notice and reloads on 409", async () => {
  vi.spyOn(client, "updateItem").mockRejectedValue(
    new client.ConflictError("Item was modified by someone else — reload and retry"),
  );
  render(<ItemDrawer itemId={1} onClose={() => {}} onChanged={() => {}} />);
  await screen.findByDisplayValue("Feature A");
  await userEvent.click(screen.getByRole("button", { name: /^save$/i }));
  expect(
    await screen.findByText("This item was changed by someone else — showing the latest version."),
  ).toBeInTheDocument();
});
```

(adapt the render props/mocked item title to the file's existing helpers — the file already renders the drawer with a mocked `getItem`; reuse its exact fixture and add `version: 1` to it. The `getItem` mock will be called again by the reload — assert via `findByText` only.)

- [ ] **Step 2: Run to verify failure**

`cd frontend && npx vitest run src/api/client.test.ts src/components/BoardView.test.tsx src/components/ItemDrawer.test.tsx`
Expected: FAIL — listItems returns the page object (or crashes), handlers have two params, no conflict copy.

- [ ] **Step 3: Implement**

`frontend/src/types.ts` — `Item` gains, after `position: number;`:

```ts
  version: number;
```

(`ItemUpdate` type stays all-optional.)

`frontend/src/api/client.ts`:

```ts
export async function listItems(params: Record<string, string> = {}): Promise<Item[]> {
  const out: Item[] = [];
  let offset = 0;
  for (;;) {
    const qs = new URLSearchParams({ ...params, limit: "500", offset: String(offset) }).toString();
    const page = await request<{ items: Item[]; total: number }>(`${API}/items?${qs}`);
    out.push(...page.items);
    if (out.length >= page.total || page.items.length === 0) return out;
    offset = out.length;
  }
}
```

```ts
export function updateItem(id: number, patch: ItemUpdate & { version: number }): Promise<Item> {
  return request<Item>(`${API}/items/${id}`, { ...json(patch), method: "PATCH" });
}
```

The four drag handlers — full new `BoardView.tsx` handler (the other three follow the identical shape):

```ts
export async function handleCardDragEnd(
  event: DragEndEvent,
  items: Item[],
  reload: () => Promise<void> | void,
): Promise<void> {
  if (!event.over) return;
  const cardId = Number(event.active.id);
  const current = items.find((i) => i.id === cardId);
  if (!current) return;
  const target = String(event.over.id);
  try {
    await updateItem(cardId, {
      status: target === UNSCHEDULED ? "" : target,
      version: current.version,
    });
  } catch (e) {
    if (!(e instanceof ConflictError)) throw e;
    // Someone else changed the card — the reload below snaps it back.
  }
  await reload();
}
```

- `StoryBoardModal.handleStoryDragEnd(event, items, reload)`: payload `{ status: String(event.over.id), version: current.version }`.
- `PlanningView.handlePlanDragEnd(event, items, reload)`: payload `{ iteration: slot, version: current.version }`.
- `TimelineView.handleTimelineDragEnd(event, items, reload)`: payload `{ iteration, version: current.version }`.
- Each handler imports `ConflictError` from `../api/client` and keeps its existing early returns.
- Update each component's `onDragEnd={...}` call site to pass its in-scope items array (BoardView: the same `items` prop it filters; StoryBoardModal: its loaded stories state; PlanningView/TimelineView: their `items` prop). Update the existing handler tests to pass an `items` array containing the dragged id with `version: 1` and extend their `updateItem` assertions to include `version: 1`.

`frontend/src/components/ItemDrawer.tsx`:

- Add state after `error`: `const [conflict, setConflict] = useState<string | null>(null);`
- In the `[itemId]` fetch effect, reset it: `setConflict(null);` before the `getItem` call.
- Replace `save`:

```ts
  const save = async () => {
    try {
      await updateItem(item.id, { ...draft, version: item.version });
      setConflict(null);
      onChanged();
    } catch (e) {
      if (e instanceof ConflictError) {
        setConflict("This item was changed by someone else — showing the latest version.");
        setDraft({});
        await reloadItem();
      } else {
        setError(String(e));
      }
    }
  };
```

- Render the notice as the FIRST element inside the main `<Drawer …>` return, directly after `<CloseBar onClose={onClose} />`:

```tsx
        {conflict && <p className="px-6 pt-3 text-xs font-medium text-amber-700">{conflict}</p>}
```

- Import `ConflictError` alongside the other client imports.

Fixtures: run `npx tsc --noEmit`; every typed `Item` literal it flags gains `version: 1` (the `as unknown as Item` casts need nothing). Existing `updateItem` assertions (e.g. drawer save tests) gain `version: 1` in their expected payloads.

- [ ] **Step 4: Run the full frontend suite + type-check**

`cd frontend && npx vitest run && npx tsc --noEmit`
Expected: **181 passed** (177 + 2 client + 1 board + 1 drawer), tsc clean.

- [ ] **Step 5: Commit**

```bash
git add frontend/src
git commit -m "feat(frontend): version threading with conflict UX + auto-paginating listItems"
```

---

### Task 6: Deploy + end-to-end smoke

**Files:** none (deploy + verification only)

- [ ] **Step 1: Rebuild + migrate**

```bash
docker compose up -d --build backend frontend
docker compose exec -T backend alembic current   # expect: 0013 (head)
```

- [ ] **Step 2: Curl smoke through nginx**

```bash
curl -s -c /tmp/v1-cookies -X POST localhost:8080/api/v1/auth/login \
  -H 'Content-Type: application/json' -d '{"email":"admin@example.com","password":"admin"}' -o /dev/null -w "login: %{http_code}\n"
curl -s -o /dev/null -w "health unversioned: %{http_code}\n" localhost:8080/api/health
curl -s -b /tmp/v1-cookies -o /dev/null -w "old path gone: %{http_code}\n" localhost:8080/api/items
PAGE=$(curl -s -b /tmp/v1-cookies "localhost:8080/api/v1/items?limit=3")
echo "$PAGE" | python3 -c "import sys,json; d=json.load(sys.stdin); print('page shape:', sorted(d.keys()), 'items:', len(d['items']), 'total:', d['total'])"
ITEM=$(curl -s -b /tmp/v1-cookies -X POST localhost:8080/api/v1/items -H 'Content-Type: application/json' -d '{"kind":"feature","title":"V1 smoke"}' | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['id'])")
curl -s -b /tmp/v1-cookies -X PATCH localhost:8080/api/v1/items/$ITEM -H 'Content-Type: application/json' -d '{"title":"V1 smoke edited","version":1}' | python3 -c "import sys,json; print('after edit version:', json.load(sys.stdin)['version'])"
curl -s -b /tmp/v1-cookies -X PATCH localhost:8080/api/v1/items/$ITEM -H 'Content-Type: application/json' -d '{"title":"stale","version":1}' -w "conflict: %{http_code} " -o /tmp/v1-conflict; python3 -c "import json; print(json.load(open('/tmp/v1-conflict'))['detail'])"
curl -s -b /tmp/v1-cookies -X DELETE localhost:8080/api/v1/items/$ITEM -o /dev/null -w "cleanup: %{http_code}\n"
rm -f /tmp/v1-cookies /tmp/v1-conflict
```

Expected: login 200; health 200; old path 404; page shape `['items', 'total']`; after edit version 2; conflict 409 + `Item was modified by someone else — reload and retry`; cleanup 204.

- [ ] **Step 3: Browser check** (controller, via Playwright): board loads (client pagination), drag a card between lanes and see it stick, open a drawer, edit a field, Save works.

- [ ] **Step 4: Commit** — nothing to commit unless smoke revealed fixes.

---

## Self-Review Notes

- **Spec coverage:** /api/v1 prefixes + health carve-out + policy (T1/T2, policy lives in the spec doc); version column/migration/dry-run (T3); required version 422, 409 exact detail, nothing-applied, never-audit-tracked (T3 tests); pagination contract + clamping + filtered totals (T4); client API constant, auto-pagination, version threading through all 5 call sites, drawer conflict copy + reload, board snap-back (T5); deploy + smoke incl. old-path 404 and unversioned health (T6). Scope guards are omissions.
- **Type consistency:** `updateItem(id, patch: ItemUpdate & { version: number })` used by all T5 call sites; handler signatures `(event, items, reload)` consistent across the four views and their tests; `ItemPage` matches the client's `{ items, total }` inline type; `API` constant produced in T2, consumed in T5.
- **Count math:** backend 158 → T1 158 → T3 +4 = 162 → T4 +3 = 165. Frontend 177 → T2 177 → T5 +4 = 181.
- **Known trade-offs:** clamped (not 422) limit/offset mirrors `/api/audit`; drawer drops unsaved edits on conflict (spec'd v1 trade-off); drag conflict is silent-with-snap-back (reload is the feedback); `total or 0` guards the empty-table `count()` None edge; the pagination test relies on `_make_feature(..., position=i)` for deterministic order — the helper accepts arbitrary kwargs.
- **Ordering note:** T3 and T4 both edit `items.py`/`test_api_items.py` — strictly sequential, and T4's test edits assume T3's version payloads are already in place.
