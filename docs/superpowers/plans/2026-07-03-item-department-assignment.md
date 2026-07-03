# Item → Department Assignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let feature and story items be assigned one team department that belongs to the item's leading team.

**Architecture:** A nullable `Item.department_id` FK (`ON DELETE SET NULL`), validated on create/patch by a `_check_department` helper mirroring `_check_container`, with the same "clear when leading_team moves out of scope" behavior. The ItemDrawer gains a leading-team-scoped Department field.

**Tech Stack:** FastAPI, SQLAlchemy 2.0, Alembic, Postgres (prod) / SQLite (unit tests); React + TypeScript, vitest.

## Global Constraints

- One nullable `department_id` per item.
- A set department must: exist; be on a `feature`/`story` item; belong to the item's `leading_team` (`department.team.name == leading_team`). Else `422`.
- Changing `leading_team` such that the current department no longer matches clears `department_id`.
- Backend tests: `cd backend && python -m pytest`. Frontend: `cd frontend && npx vitest run`. Migration verified upgrade+downgrade on compose Postgres.

---

### Task 1: Backend — `Item.department_id` model, migration, schema

**Files:**
- Modify: `backend/app/models.py` (Item)
- Create: `backend/alembic/versions/0020_item_department.py`
- Modify: `backend/app/schemas.py` (`ItemBase`, `ItemUpdate`, `ItemRead`)
- Test: `backend/tests/test_api_items.py`

**Interfaces:**
- Produces: `Item.department_id`, `Item.department`, `Item.department_name`; `ItemBase.department_id`, `ItemUpdate.department_id`, `ItemRead.department_name`; migration `"0020"`.

- [ ] **Step 1: Write the failing serialization test**

In `backend/tests/test_api_items.py`, add:

```python
def test_item_read_includes_department_fields(client, db_session):
    from app.models import Team, TeamDepartment
    net = Team(name="Net")
    db_session.add(net)
    db_session.commit()
    dep = TeamDepartment(name="FE", team_id=net.id)
    db_session.add(dep)
    db_session.commit()
    f = _make_feature(db_session, leading_team="Net", department_id=dep.id)
    body = client.get(f"/api/v1/items/{f.id}").json()
    assert body["department_id"] == dep.id
    assert body["department_name"] == "FE"
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && python -m pytest tests/test_api_items.py::test_item_read_includes_department_fields -q`
Expected: FAIL — `TypeError: 'department_id' is an invalid keyword argument` / KeyError.

- [ ] **Step 3: Add the column + relationship + property to the model**

In `backend/app/models.py`, in `class Item`, add after the `container_id` column:

```python
    department_id: Mapped[int | None] = mapped_column(
        ForeignKey("team_departments.id", ondelete="SET NULL"), index=True
    )
```
And add a relationship + property alongside `assignee_user` (near the bottom of the class, before `@property def assignee`):

```python
    department: Mapped["TeamDepartment | None"] = relationship()

    @property
    def department_name(self) -> str | None:
        return self.department.name if self.department else None
```

- [ ] **Step 4: Add the schema fields**

In `backend/app/schemas.py`:
- In `class ItemBase`, after `container_id: int | None = None`:
```python
    department_id: int | None = None
```
- In `class ItemUpdate`, after `container_id: int | None = None`:
```python
    department_id: int | None = None
```
- In `class ItemRead`, add (after `assignee`):
```python
    department_name: str | None = None
```

- [ ] **Step 5: Run to verify pass**

Run: `cd backend && python -m pytest tests/test_api_items.py::test_item_read_includes_department_fields -q`
Expected: PASS

- [ ] **Step 6: Write the migration**

Create `backend/alembic/versions/0020_item_department.py`:

```python
"""item.department_id → team_departments (SET NULL)

Revision ID: 0020
Revises: 0019
"""
from alembic import op
import sqlalchemy as sa

revision = "0020"
down_revision = "0019"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("items", sa.Column("department_id", sa.Integer, nullable=True))
    op.create_index("ix_items_department_id", "items", ["department_id"])
    op.create_foreign_key(
        "fk_items_department_id", "items", "team_departments",
        ["department_id"], ["id"], ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("fk_items_department_id", "items", type_="foreignkey")
    op.drop_index("ix_items_department_id", table_name="items")
    op.drop_column("items", "department_id")
```

- [ ] **Step 7: Dry-run the migration on compose Postgres (upgrade + downgrade + upgrade)**

Run:
```bash
cd /Users/marco/Coding/web-kanban
docker compose cp backend/alembic/versions/0020_item_department.py backend:/app/alembic/versions/0020_item_department.py
docker compose exec backend alembic upgrade head
docker compose exec db psql -U kanban -d kanban -c '\d items' | grep department_id
docker compose exec backend alembic downgrade -1
docker compose exec backend alembic upgrade head
```
Expected: column + FK added on upgrade, removed on downgrade, re-added on re-upgrade — no errors.

- [ ] **Step 8: Full backend suite + commit**

Run: `cd backend && python -m pytest -q` → PASS.
```bash
git add backend/app/models.py backend/alembic/versions/0020_item_department.py backend/app/schemas.py backend/tests/test_api_items.py
git commit -m "feat(item-dept): items.department_id column + serialization"
```

---

### Task 2: Backend — validation, auto-clear, audit

**Files:**
- Modify: `backend/app/routers/items.py`
- Modify: `backend/app/audit.py` (`ITEM_TRACKED_FIELDS`)
- Test: `backend/tests/test_api_item_department.py` (new)

**Interfaces:**
- Consumes: `Item.department_id` (Task 1), `TeamDepartment`.
- Produces: `_check_department`, `_department_matches`, `_department_name` in the items router; create/patch validation + `leading_team`-clear.

- [ ] **Step 1: Write the failing endpoint tests**

Create `backend/tests/test_api_item_department.py`:

```python
from app.models import Team, TeamDepartment


def _team(db, name):
    t = Team(name=name)
    db.add(t)
    db.commit()
    db.refresh(t)
    return t


def _dep(db, name, team):
    d = TeamDepartment(name=name, team_id=team.id)
    db.add(d)
    db.commit()
    db.refresh(d)
    return d


def _create(client, **over):
    body = {"kind": "feature", "title": "F", "leading_team": "Net"}
    body.update(over)
    return client.post("/api/v1/items", json=body)


def test_create_feature_with_matching_department(client, db_session):
    net = _team(db_session, "Net")
    dep = _dep(db_session, "FE", net)
    resp = _create(client, department_id=dep.id)
    assert resp.status_code == 201
    assert resp.json()["department_id"] == dep.id


def test_create_wrong_team_department_422(client, db_session):
    net = _team(db_session, "Net")
    cloud = _team(db_session, "Cloud")
    dep = _dep(db_session, "FE", cloud)
    resp = _create(client, department_id=dep.id)  # item leading_team = Net
    assert resp.status_code == 422


def test_create_department_on_risk_422(client, db_session):
    net = _team(db_session, "Net")
    dep = _dep(db_session, "FE", net)
    resp = _create(client, kind="risk", department_id=dep.id)
    assert resp.status_code == 422


def test_create_department_without_leading_team_422(client, db_session):
    net = _team(db_session, "Net")
    dep = _dep(db_session, "FE", net)
    resp = _create(client, leading_team=None, department_id=dep.id)
    assert resp.status_code == 422


def test_patch_sets_matching_department(client, db_session):
    net = _team(db_session, "Net")
    dep = _dep(db_session, "FE", net)
    created = _create(client).json()
    resp = client.patch(f"/api/v1/items/{created['id']}",
                        json={"version": created["version"], "department_id": dep.id})
    assert resp.status_code == 200
    assert resp.json()["department_id"] == dep.id


def test_patch_leading_team_change_clears_department(client, db_session):
    net = _team(db_session, "Net")
    cloud = _team(db_session, "Cloud")
    dep = _dep(db_session, "FE", net)
    created = _create(client, department_id=dep.id).json()
    resp = client.patch(f"/api/v1/items/{created['id']}",
                        json={"version": created["version"], "leading_team": "Cloud"})
    assert resp.status_code == 200
    assert resp.json()["department_id"] is None
```

- [ ] **Step 2: Run to verify failures**

Run: `cd backend && python -m pytest tests/test_api_item_department.py -q`
Expected: FAIL — matching-team create returns 201 but wrong-team/risk/no-team return 201 (no validation yet), and the clear test still shows the department id.

- [ ] **Step 3: Import `TeamDepartment` and add the helpers**

In `backend/app/routers/items.py`, extend the models import:
```python
from app.models import AuditEvent, Container, Item, ItemKind, ItemLink, TeamDepartment, User
```
Add the helpers next to `_container_name` (after it):
```python
def _check_department(
    db: Session, department_id: int, *, kind: ItemKind, leading_team: str | None
) -> TeamDepartment:
    dep = db.get(TeamDepartment, department_id)
    if dep is None:
        raise HTTPException(status_code=422, detail="department_id does not exist")
    if kind not in (ItemKind.FEATURE, ItemKind.STORY):
        raise HTTPException(status_code=422, detail="Department applies to features and stories only")
    if leading_team is None or dep.team.name != leading_team:
        raise HTTPException(status_code=422, detail="Department must belong to the item's leading team")
    return dep


def _department_matches(db: Session, department_id: int, *, leading_team: str | None) -> bool:
    dep = db.get(TeamDepartment, department_id)
    return dep is not None and dep.team.name == leading_team


def _department_name(db: Session, department_id: int | None) -> str | None:
    if department_id is None:
        return None
    dep = db.get(TeamDepartment, department_id)
    return dep.name if dep else None
```

- [ ] **Step 4: Validate on create**

In `create_item`, after the `container_id` check block:
```python
    if payload.department_id is not None:
        _check_department(
            db, payload.department_id,
            kind=payload.kind, leading_team=payload.leading_team,
        )
```

- [ ] **Step 5: Validate + auto-clear on patch**

In `update_item`, immediately after the container check/clear block (before `before = {...}`):
```python
    if changes.get("department_id") is not None:
        _check_department(db, changes["department_id"], kind=item.kind, leading_team=new_team)
    elif (
        "department_id" not in changes
        and item.department_id is not None
        and "leading_team" in changes
        and not _department_matches(db, item.department_id, leading_team=new_team)
    ):
        changes["department_id"] = None
```

- [ ] **Step 6: Audit the department by name**

In `backend/app/audit.py`, add `"department"` to the `ITEM_TRACKED_FIELDS` set (next to `"container"`).

In `backend/app/routers/items.py` `update_item`:
- After the `if "container_id" in changes: before["container"] = ...` line, add:
```python
    if "department_id" in changes:
        before["department"] = _department_name(db, item.department_id)
```
- After the container audit-rename block (`changes["container"] = ...; changes.pop("container_id")`), add:
```python
    if "department_id" in changes:
        changes = dict(changes)
        changes["department"] = _department_name(db, changes["department_id"])
        changes.pop("department_id")
```

- [ ] **Step 7: Run the department tests**

Run: `cd backend && python -m pytest tests/test_api_item_department.py -q`
Expected: PASS (6 tests).

- [ ] **Step 8: Full backend suite + commit**

Run: `cd backend && python -m pytest -q` → PASS.
```bash
git add backend/app/routers/items.py backend/app/audit.py backend/tests/test_api_item_department.py
git commit -m "feat(item-dept): validate + auto-clear + audit item department"
```

---

### Task 3: Frontend — types, App wiring, ItemDrawer field

**Files:**
- Modify: `frontend/src/types.ts` (`Item`)
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/components/ItemDrawer.tsx`
- Test: `frontend/src/components/ItemDrawerFields.test.tsx`

**Interfaces:**
- Consumes: `getDepartments`, `Department` (existing); `Item.department_id`/`department_name`.

- [ ] **Step 1: Add the `Item` fields**

In `frontend/src/types.ts`, in `interface Item`, after `container_id: number | null;`:
```typescript
  department_id: number | null;
  department_name: string | null;
```

- [ ] **Step 2: Write the failing drawer test**

In `frontend/src/components/ItemDrawerFields.test.tsx`, add (mirroring the existing Container test — the shared `feature` fixture has `leading_team: "Network"`):

```typescript
it("Department options are scoped to the item's leading team and save department_id", async () => {
  vi.spyOn(client, "getItem").mockResolvedValue({ ...feature, department_id: null } as never);
  const update = vi.spyOn(client, "updateItem").mockResolvedValue(feature as never);
  render(
    <ItemDrawer
      itemId={5}
      teams={[{ id: 1, name: "Network" }, { id: 2, name: "Cloud" }]}
      departments={[
        { id: 3, name: "FE", team_id: 1, team_name: "Network", member_ids: [] },
        { id: 4, name: "Cloud-FE", team_id: 2, team_name: "Cloud", member_ids: [] },
      ]}
      onClose={() => {}}
      onChanged={() => {}}
    />,
  );
  const dep = await screen.findByRole("combobox", { name: "Department" });
  fireEvent.focus(dep);
  expect(screen.queryByText("Cloud-FE")).toBeNull(); // other team's dept not offered
  fireEvent.mouseDown(screen.getByText("FE"));
  fireEvent.click(screen.getByRole("button", { name: /save/i }));
  expect(update).toHaveBeenCalledWith(5, expect.objectContaining({ department_id: 3 }));
});

it("Department field is hidden for risk items", async () => {
  vi.spyOn(client, "getItem").mockResolvedValue({ ...feature, kind: "risk", department_id: null } as never);
  render(
    <ItemDrawer
      itemId={5}
      teams={[{ id: 1, name: "Network" }]}
      departments={[{ id: 3, name: "FE", team_id: 1, team_name: "Network", member_ids: [] }]}
      onClose={() => {}}
      onChanged={() => {}}
    />,
  );
  await screen.findByRole("button", { name: /save/i });
  expect(screen.queryByRole("combobox", { name: "Department" })).toBeNull();
});
```

- [ ] **Step 3: Run to verify failure**

Run: `cd frontend && npx vitest run src/components/ItemDrawerFields.test.tsx`
Expected: FAIL — no Department field / prop unknown.

- [ ] **Step 4: Add the `departments` prop + Department field to `ItemDrawer`**

In `frontend/src/components/ItemDrawer.tsx`:
- Import the `Department` type in the existing `../types` import.
- Add `departments = [],` to the destructured props and `departments?: Department[];` to the props type (next to `containers`).
- After the **Container** `PropLabel` block, add a Department field, rendered only for non-risk items:
```tsx
      {item.kind !== "risk" && (
        <PropLabel text="Department">
          {(() => {
            const teamName = (value("leading_team") as string | null) || null;
            if (!teamName) {
              return <p className="py-1.5 text-sm text-gray-400">Set a leading team first</p>;
            }
            const scoped = departments.filter((d) => d.team_name === teamName);
            const currentId = value("department_id") as number | null;
            return (
              <SearchableSelect
                ariaLabel="Department"
                value={scoped.find((d) => d.id === currentId)?.name ?? null}
                options={scoped.map((d) => d.name)}
                onChange={(v) =>
                  setDraft((d) => ({
                    ...d,
                    department_id: v == null ? null : scoped.find((x) => x.name === v)?.id ?? null,
                  }))
                }
                placeholder="Select department…"
              />
            );
          })()}
        </PropLabel>
      )}
```

- [ ] **Step 5: Load + pass departments in `App.tsx`**

In `frontend/src/App.tsx`:
- Import `getDepartments` (extend the existing `../api/client` import) and the `Department` type.
- Add state: `const [departments, setDepartments] = useState<Department[]>([]);`
- In the existing effect that loads teams/containers (keyed on `refreshKey`), add `void getDepartments().then(setDepartments);`
- Pass `departments={departments}` to the `<ItemDrawer ... />` render.

- [ ] **Step 6: Run the drawer test**

Run: `cd frontend && npx vitest run src/components/ItemDrawerFields.test.tsx`
Expected: PASS

- [ ] **Step 7: Full frontend suite + build + commit**

Run: `cd frontend && npx vitest run && npm run build` → PASS.
```bash
git add frontend/src/types.ts frontend/src/App.tsx frontend/src/components/ItemDrawer.tsx frontend/src/components/ItemDrawerFields.test.tsx
git commit -m "feat(item-dept): Department field in the item drawer"
```

---

## Final verification

- [ ] Backend: `cd backend && python -m pytest -q` → green.
- [ ] Frontend: `cd frontend && npx vitest run && npm run build` → green.
- [ ] Migration reconfirmed on Postgres (upgrade/downgrade/upgrade clean).
- [ ] Manual smoke in the Docker stack (rebuild images): open a feature with a leading team that has a department; the Department field lists that team's departments; assign one; reload shows it. Change the leading team to another team → the department clears. A risk item shows no Department field.
