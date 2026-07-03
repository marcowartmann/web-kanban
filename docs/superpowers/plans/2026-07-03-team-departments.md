# Team Departments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add team departments (sub-teams nested under a Team) with 0..n user membership across any team, managed from the Admin UI on both the department and user side.

**Architecture:** New `TeamDepartment` entity + `user_team_departments` many-to-many join. A flat admin `departments` API plus a user-side `PUT /users/{id}/departments`. Frontend adds a `DepartmentsSection` inside the Admin "Teams & Capacity" section and a departments multi-select in the user modal.

**Tech Stack:** FastAPI, SQLAlchemy 2.0, Alembic, Postgres (prod) / SQLite (unit tests); React + TypeScript, vitest.

## Global Constraints

- Membership is unconstrained by the user's primary team (a user may join departments of any team).
- Department name unique within a team: `(team_id, name)` → `409` on duplicate.
- Departments are managed only via the dedicated endpoints; `UserCreate`/`UserUpdate` stay unchanged. `UserRead` gains `department_ids`.
- All department endpoints and the user-departments endpoint are admin-only.
- Backend tests: `cd backend && python -m pytest`. Frontend: `cd frontend && npx vitest run`. Migration verified upgrade+downgrade on compose Postgres.

---

### Task 1: Models + migration

**Files:**
- Modify: `backend/app/models.py`
- Create: `backend/alembic/versions/0019_team_departments.py`
- Test: `backend/tests/test_department_models.py` (new)

**Interfaces:**
- Produces: `TeamDepartment` (`team_departments`), `user_team_departments` table, `Team.departments`, `User.departments`, `TeamDepartment.members`, `TeamDepartment.team_name`, `TeamDepartment.member_ids`, `User.department_ids`; migration `"0019"`.

- [ ] **Step 1: Write the failing model tests**

Create `backend/tests/test_department_models.py`:

```python
from app.models import Team, TeamDepartment, User


def _team(db, name):
    t = Team(name=name)
    db.add(t)
    db.commit()
    db.refresh(t)
    return t


def test_department_membership_roundtrip(db_session):
    net = _team(db_session, "Net")
    dep = TeamDepartment(name="Frontend", team_id=net.id)
    u = User(display_name="U", username="u1")
    db_session.add_all([dep, u])
    db_session.commit()
    dep.members.append(u)
    db_session.commit()
    db_session.refresh(dep)
    db_session.refresh(u)
    assert dep.member_ids == [u.id]
    assert dep.team_name == "Net"
    assert u.department_ids == [dep.id]


def test_deleting_team_cascades_departments(db_session):
    net = _team(db_session, "Net")
    dep = TeamDepartment(name="Frontend", team_id=net.id)
    db_session.add(dep)
    db_session.commit()
    db_session.delete(net)
    db_session.commit()
    assert db_session.query(TeamDepartment).count() == 0


def test_deleting_user_removes_membership(db_session):
    net = _team(db_session, "Net")
    dep = TeamDepartment(name="Frontend", team_id=net.id)
    u = User(display_name="U", username="u1")
    db_session.add_all([dep, u])
    db_session.commit()
    dep.members.append(u)
    db_session.commit()
    db_session.delete(u)
    db_session.commit()
    db_session.refresh(dep)
    assert dep.member_ids == []
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && python -m pytest tests/test_department_models.py -q`
Expected: FAIL — `ImportError: cannot import name 'TeamDepartment'`.

- [ ] **Step 3: Add `Table`/`Column` to the models import**

In `backend/app/models.py`, extend the SQLAlchemy import line:
```python
from sqlalchemy import CheckConstraint, Column, Enum, ForeignKey, Index, Integer, Numeric, String, Table, Text, UniqueConstraint, func
```

- [ ] **Step 4: Define the join table (top of the module)**

In `backend/app/models.py`, immediately after the `from app.timeutil import ...` import block (before the first model class), add:

```python
user_team_departments = Table(
    "user_team_departments",
    Base.metadata,
    Column("user_id", Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
    Column("department_id", Integer, ForeignKey("team_departments.id", ondelete="CASCADE"), primary_key=True),
)
```

- [ ] **Step 5: Add the `TeamDepartment` model + `Team.departments`**

In `backend/app/models.py`, in `class Team`, add a relationship (after the `created_at` column):
```python
    departments: Mapped[list["TeamDepartment"]] = relationship(
        cascade="all, delete-orphan", back_populates="team"
    )
```

Then add the class immediately after `class Team`:
```python
class TeamDepartment(Base):
    __tablename__ = "team_departments"
    __table_args__ = (UniqueConstraint("team_id", "name", name="uq_department_team_name"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(128))
    team_id: Mapped[int] = mapped_column(
        ForeignKey("teams.id", ondelete="CASCADE"), index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, server_default=func.now()
    )

    team: Mapped["Team"] = relationship(back_populates="departments")
    members: Mapped[list["User"]] = relationship(
        secondary=user_team_departments, back_populates="departments"
    )

    @property
    def team_name(self) -> str:
        return self.team.name

    @property
    def member_ids(self) -> list[int]:
        return sorted(u.id for u in self.members)
```

- [ ] **Step 6: Add `User.departments` + `User.department_ids`**

In `backend/app/models.py`, in `class User`, add the relationship (near the `capacities` relationship):
```python
    departments: Mapped[list["TeamDepartment"]] = relationship(
        secondary=user_team_departments, back_populates="members"
    )

    @property
    def department_ids(self) -> list[int]:
        return sorted(d.id for d in self.departments)
```

- [ ] **Step 7: Run to verify pass**

Run: `cd backend && python -m pytest tests/test_department_models.py -q`
Expected: PASS

- [ ] **Step 8: Write the migration**

Create `backend/alembic/versions/0019_team_departments.py`:

```python
"""team_departments + user_team_departments

Revision ID: 0019
Revises: 0018
"""
from alembic import op
import sqlalchemy as sa

revision = "0019"
down_revision = "0018"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "team_departments",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("name", sa.String(128), nullable=False),
        sa.Column("team_id", sa.Integer,
                  sa.ForeignKey("teams.id", ondelete="CASCADE"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True),
                  server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("team_id", "name", name="uq_department_team_name"),
    )
    op.create_index("ix_team_departments_team_id", "team_departments", ["team_id"])
    op.create_table(
        "user_team_departments",
        sa.Column("user_id", sa.Integer,
                  sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("department_id", sa.Integer,
                  sa.ForeignKey("team_departments.id", ondelete="CASCADE"), primary_key=True),
    )


def downgrade() -> None:
    op.drop_table("user_team_departments")
    op.drop_index("ix_team_departments_team_id", table_name="team_departments")
    op.drop_table("team_departments")
```

- [ ] **Step 9: Dry-run the migration on compose Postgres (upgrade + downgrade + upgrade)**

Run:
```bash
cd /Users/marco/Coding/web-kanban
docker compose cp backend/alembic/versions/0019_team_departments.py backend:/app/alembic/versions/0019_team_departments.py
docker compose exec backend alembic upgrade head
docker compose exec db psql -U kanban -d kanban -c '\dt' | grep -E 'team_departments|user_team_departments'
docker compose exec backend alembic downgrade -1
docker compose exec backend alembic upgrade head
```
Expected: both tables created on upgrade, dropped on downgrade, recreated on re-upgrade — no errors.

- [ ] **Step 10: Run the full backend suite + commit**

Run: `cd backend && python -m pytest -q` → PASS.
```bash
git add backend/app/models.py backend/alembic/versions/0019_team_departments.py backend/tests/test_department_models.py
git commit -m "feat(departments): TeamDepartment model + membership join + migration"
```

---

### Task 2: Departments API

**Files:**
- Modify: `backend/app/schemas.py`
- Create: `backend/app/routers/departments.py`
- Modify: `backend/app/main.py`
- Test: `backend/tests/test_api_departments.py` (new)

**Interfaces:**
- Consumes: `TeamDepartment`, `User`, `Team` (Task 1).
- Produces: `DepartmentRead`, `DepartmentCreate`, `DepartmentRename`, `DepartmentMembers` schemas; `GET/POST /api/v1/departments`, `PATCH/DELETE /api/v1/departments/{id}`, `PUT /api/v1/departments/{id}/members`.

- [ ] **Step 1: Add the schemas**

In `backend/app/schemas.py`, add near the other admin schemas:

```python
class DepartmentRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    team_id: int
    team_name: str
    member_ids: list[int]


class DepartmentCreate(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    team_id: int


class DepartmentRename(BaseModel):
    name: str = Field(min_length=1, max_length=128)


class DepartmentMembers(BaseModel):
    user_ids: list[int]
```

- [ ] **Step 2: Write the failing API tests**

Create `backend/tests/test_api_departments.py`:

```python
from app.models import Team, TeamDepartment, User


def _team(db, name):
    t = Team(name=name)
    db.add(t)
    db.commit()
    db.refresh(t)
    return t


def _user(db, name):
    u = User(display_name=name, username=name.lower())
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


def test_create_list_rename_delete(client, db_session):
    net = _team(db_session, "Net")
    created = client.post("/api/v1/departments", json={"name": "Frontend", "team_id": net.id})
    assert created.status_code == 201
    dep_id = created.json()["id"]
    assert created.json()["team_name"] == "Net"
    assert created.json()["member_ids"] == []

    listed = client.get("/api/v1/departments").json()
    assert [d["name"] for d in listed] == ["Frontend"]

    renamed = client.patch(f"/api/v1/departments/{dep_id}", json={"name": "FE"})
    assert renamed.status_code == 200 and renamed.json()["name"] == "FE"

    assert client.delete(f"/api/v1/departments/{dep_id}").status_code == 204
    assert client.get("/api/v1/departments").json() == []


def test_duplicate_name_within_team_409(client, db_session):
    net = _team(db_session, "Net")
    client.post("/api/v1/departments", json={"name": "FE", "team_id": net.id})
    dup = client.post("/api/v1/departments", json={"name": "FE", "team_id": net.id})
    assert dup.status_code == 409


def test_same_name_different_team_ok(client, db_session):
    net = _team(db_session, "Net")
    cloud = _team(db_session, "Cloud")
    a = client.post("/api/v1/departments", json={"name": "FE", "team_id": net.id})
    b = client.post("/api/v1/departments", json={"name": "FE", "team_id": cloud.id})
    assert a.status_code == 201 and b.status_code == 201


def test_bad_team_422(client, db_session):
    resp = client.post("/api/v1/departments", json={"name": "FE", "team_id": 9999})
    assert resp.status_code == 422


def test_set_members_replaces(client, db_session):
    net = _team(db_session, "Net")
    dep = TeamDepartment(name="FE", team_id=net.id)
    db_session.add(dep)
    db_session.commit()
    db_session.refresh(dep)
    a = _user(db_session, "Ann")
    b = _user(db_session, "Ben")
    r1 = client.put(f"/api/v1/departments/{dep.id}/members", json={"user_ids": [a.id, b.id]})
    assert r1.status_code == 200 and r1.json()["member_ids"] == sorted([a.id, b.id])
    r2 = client.put(f"/api/v1/departments/{dep.id}/members", json={"user_ids": [a.id]})
    assert r2.json()["member_ids"] == [a.id]


def test_set_members_unknown_user_422(client, db_session):
    net = _team(db_session, "Net")
    dep = TeamDepartment(name="FE", team_id=net.id)
    db_session.add(dep)
    db_session.commit()
    db_session.refresh(dep)
    resp = client.put(f"/api/v1/departments/{dep.id}/members", json={"user_ids": [9999]})
    assert resp.status_code == 422


def test_members_cannot_manage_departments(member_client, db_session):
    net = _team(db_session, "Net")
    assert member_client.post("/api/v1/departments", json={"name": "FE", "team_id": net.id}).status_code == 403
    assert member_client.get("/api/v1/departments").status_code == 403
```

- [ ] **Step 3: Run to verify failures**

Run: `cd backend && python -m pytest tests/test_api_departments.py -q`
Expected: FAIL — 404 (route missing).

- [ ] **Step 4: Implement the router**

Create `backend/app/routers/departments.py`:

```python
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.audit import log_event
from app.auth import require_admin
from app.db import get_db
from app.models import Team, TeamDepartment, User
from app.schemas import DepartmentCreate, DepartmentMembers, DepartmentRead, DepartmentRename

router = APIRouter(prefix="/api/v1/departments", tags=["departments"],
                   dependencies=[Depends(require_admin)])


def _get(db: Session, dep_id: int) -> TeamDepartment:
    dep = db.get(TeamDepartment, dep_id)
    if dep is None:
        raise HTTPException(status_code=404, detail="Department not found")
    return dep


@router.get("", response_model=list[DepartmentRead])
def list_departments(db: Session = Depends(get_db)) -> list[TeamDepartment]:
    return list(db.scalars(
        select(TeamDepartment).order_by(TeamDepartment.team_id, TeamDepartment.name)
    ))


@router.post("", response_model=DepartmentRead, status_code=201)
def create_department(
    payload: DepartmentCreate,
    db: Session = Depends(get_db),
    current: User = Depends(require_admin),
) -> TeamDepartment:
    if db.get(Team, payload.team_id) is None:
        raise HTTPException(status_code=422, detail="team_id does not exist")
    if db.scalar(select(TeamDepartment).where(
        TeamDepartment.team_id == payload.team_id, TeamDepartment.name == payload.name
    )):
        raise HTTPException(status_code=409, detail="Department already exists in this team")
    dep = TeamDepartment(name=payload.name, team_id=payload.team_id)
    db.add(dep)
    db.flush()
    log_event(db, actor=current, event_type="department.created", entity_type="department",
              entity_id=dep.id, entity_label=dep.name)
    db.commit()
    db.refresh(dep)
    return dep


@router.patch("/{dep_id}", response_model=DepartmentRead)
def rename_department(
    dep_id: int,
    payload: DepartmentRename,
    db: Session = Depends(get_db),
    current: User = Depends(require_admin),
) -> TeamDepartment:
    dep = _get(db, dep_id)
    if payload.name != dep.name and db.scalar(select(TeamDepartment).where(
        TeamDepartment.team_id == dep.team_id,
        TeamDepartment.name == payload.name,
        TeamDepartment.id != dep.id,
    )):
        raise HTTPException(status_code=409, detail="Department already exists in this team")
    old = dep.name
    dep.name = payload.name
    log_event(db, actor=current, event_type="department.updated", entity_type="department",
              entity_id=dep.id, entity_label=dep.name, field="name", old_value=old, new_value=dep.name)
    db.commit()
    db.refresh(dep)
    return dep


@router.delete("/{dep_id}", status_code=204)
def delete_department(
    dep_id: int,
    db: Session = Depends(get_db),
    current: User = Depends(require_admin),
) -> None:
    dep = _get(db, dep_id)
    log_event(db, actor=current, event_type="department.deleted", entity_type="department",
              entity_id=dep.id, entity_label=dep.name)
    db.delete(dep)
    db.commit()


@router.put("/{dep_id}/members", response_model=DepartmentRead)
def set_members(
    dep_id: int,
    payload: DepartmentMembers,
    db: Session = Depends(get_db),
    current: User = Depends(require_admin),
) -> TeamDepartment:
    dep = _get(db, dep_id)
    members = []
    for uid in payload.user_ids:
        user = db.get(User, uid)
        if user is None:
            raise HTTPException(status_code=422, detail=f"user {uid} does not exist")
        members.append(user)
    dep.members = members
    log_event(db, actor=current, event_type="department.members_changed",
              entity_type="department", entity_id=dep.id, entity_label=dep.name)
    db.commit()
    db.refresh(dep)
    return dep
```

- [ ] **Step 5: Mount the router in `main.py`**

In `backend/app/main.py`, add `departments` to the router import line, and add `departments.router,` to the `protected` tuple.

- [ ] **Step 6: Run the departments tests**

Run: `cd backend && python -m pytest tests/test_api_departments.py -q`
Expected: PASS (7 tests).

- [ ] **Step 7: Full backend suite + commit**

Run: `cd backend && python -m pytest -q` → PASS.
```bash
git add backend/app/schemas.py backend/app/routers/departments.py backend/app/main.py backend/tests/test_api_departments.py
git commit -m "feat(departments): admin CRUD + set-members API"
```

---

### Task 3: User-side departments endpoint + `UserRead.department_ids`

**Files:**
- Modify: `backend/app/schemas.py` (`UserRead`, `UserDepartments`)
- Modify: `backend/app/routers/users.py`
- Test: `backend/tests/test_api_users.py`

**Interfaces:**
- Consumes: `TeamDepartment`, `User.departments`/`User.department_ids` (Task 1).
- Produces: `UserRead.department_ids`; `UserDepartments` schema; `PUT /api/v1/users/{id}/departments`.

- [ ] **Step 1: Write the failing tests**

In `backend/tests/test_api_users.py`, add:

```python
def test_user_read_includes_department_ids(anon_client, db_session):
    from app.models import Team, TeamDepartment
    admin = _seed(db_session, "admin@x.ch", role="admin")
    net = Team(name="Net")
    db_session.add(net)
    db_session.commit()
    dep = TeamDepartment(name="FE", team_id=net.id)
    db_session.add(dep)
    db_session.commit()
    admin.departments.append(dep)
    db_session.commit()
    _as(admin)
    body = anon_client.get("/api/v1/users").json()
    row = next(u for u in body if u["id"] == admin.id)
    assert row["department_ids"] == [dep.id]
    app.dependency_overrides.clear()


def test_set_user_departments_replaces(anon_client, db_session):
    from app.models import Team, TeamDepartment
    admin = _seed(db_session, "admin@x.ch", role="admin")
    member = _seed(db_session, "m@x.ch")
    net = Team(name="Net")
    db_session.add(net)
    db_session.commit()
    d1 = TeamDepartment(name="FE", team_id=net.id)
    d2 = TeamDepartment(name="BE", team_id=net.id)
    db_session.add_all([d1, d2])
    db_session.commit()
    _as(admin)
    r1 = anon_client.put(f"/api/v1/users/{member.id}/departments", json={"department_ids": [d1.id, d2.id]})
    assert r1.status_code == 200 and r1.json()["department_ids"] == sorted([d1.id, d2.id])
    r2 = anon_client.put(f"/api/v1/users/{member.id}/departments", json={"department_ids": [d2.id]})
    assert r2.json()["department_ids"] == [d2.id]
    app.dependency_overrides.clear()


def test_set_user_departments_unknown_422(anon_client, db_session):
    admin = _seed(db_session, "admin@x.ch", role="admin")
    member = _seed(db_session, "m@x.ch")
    _as(admin)
    resp = anon_client.put(f"/api/v1/users/{member.id}/departments", json={"department_ids": [9999]})
    assert resp.status_code == 422
    app.dependency_overrides.clear()
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && python -m pytest tests/test_api_users.py::test_set_user_departments_replaces -q`
Expected: FAIL — 405/404 (route missing) or KeyError on `department_ids`.

- [ ] **Step 3: Add `department_ids` to `UserRead` and the `UserDepartments` schema**

In `backend/app/schemas.py`, in `class UserRead`, after `username`:
```python
    department_ids: list[int] = []
```
And add:
```python
class UserDepartments(BaseModel):
    department_ids: list[int]
```

- [ ] **Step 4: Add the endpoint in the users router**

In `backend/app/routers/users.py`, extend the model import to include `TeamDepartment`:
```python
from app.models import Team, TeamDepartment, User, UserSession
```
and the schema import to include `UserDepartments`:
```python
from app.schemas import PersonOption, UserCreate, UserDepartments, UserRead, UserUpdate
```
Then add the endpoint (after `update_user`):
```python
@router.put("/{user_id}/departments", response_model=UserRead, dependencies=[Depends(require_admin)])
def set_user_departments(
    user_id: int,
    payload: UserDepartments,
    db: Session = Depends(get_db),
    current: User = Depends(require_admin),
) -> User:
    user = _get_or_404(db, user_id)
    departments = []
    for dep_id in payload.department_ids:
        dep = db.get(TeamDepartment, dep_id)
        if dep is None:
            raise HTTPException(status_code=422, detail=f"department {dep_id} does not exist")
        departments.append(dep)
    user.departments = departments
    log_event(db, actor=current, event_type="user.departments_changed", entity_type="user",
              entity_id=user.id, entity_label=user.email or user.display_name)
    db.commit()
    db.refresh(user)
    return user
```

- [ ] **Step 5: Run the tests**

Run: `cd backend && python -m pytest tests/test_api_users.py -q`
Expected: PASS.

- [ ] **Step 6: Full backend suite + commit**

Run: `cd backend && python -m pytest -q` → PASS.
```bash
git add backend/app/schemas.py backend/app/routers/users.py backend/tests/test_api_users.py
git commit -m "feat(departments): user-side set-departments endpoint + UserRead.department_ids"
```

---

### Task 4: Frontend types + client

**Files:**
- Modify: `frontend/src/types.ts`
- Modify: `frontend/src/api/client.ts`
- Test: `frontend/src/api/client.departments.test.ts` (new)

**Interfaces:**
- Produces: `Department` type; `AuthUser.department_ids`; `getDepartments`, `createDepartment`, `renameDepartment`, `deleteDepartment`, `setDepartmentMembers`, `setUserDepartments`.

- [ ] **Step 1: Write the failing client test**

Create `frontend/src/api/client.departments.test.ts`:

```typescript
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createDepartment,
  getDepartments,
  setDepartmentMembers,
  setUserDepartments,
} from "./client";

function mockFetch(status: number, body: unknown) {
  const nullBody = new Set([204, 205, 304]);
  const spy = vi.fn().mockResolvedValue(
    new Response(nullBody.has(status) ? null : JSON.stringify(body), { status }),
  );
  vi.stubGlobal("fetch", spy);
  return spy;
}

afterEach(() => vi.unstubAllGlobals());

describe("departments client", () => {
  it("getDepartments hits the right URL", async () => {
    const spy = mockFetch(200, []);
    await getDepartments();
    expect(spy.mock.calls[0][0]).toBe("/api/v1/departments");
  });

  it("createDepartment posts name + team_id", async () => {
    const spy = mockFetch(201, { id: 1, name: "FE", team_id: 2, team_name: "Net", member_ids: [] });
    await createDepartment("FE", 2);
    expect(JSON.parse(spy.mock.calls[0][1]?.body as string)).toEqual({ name: "FE", team_id: 2 });
  });

  it("setDepartmentMembers PUTs user_ids", async () => {
    const spy = mockFetch(200, { id: 1, name: "FE", team_id: 2, team_name: "Net", member_ids: [7] });
    await setDepartmentMembers(1, [7]);
    expect(spy.mock.calls[0][0]).toBe("/api/v1/departments/1/members");
    expect(spy.mock.calls[0][1]?.method).toBe("PUT");
    expect(JSON.parse(spy.mock.calls[0][1]?.body as string)).toEqual({ user_ids: [7] });
  });

  it("setUserDepartments PUTs department_ids", async () => {
    const spy = mockFetch(200, { id: 7, email: null, display_name: "U", role: "member", is_active: true });
    await setUserDepartments(7, [1, 2]);
    expect(spy.mock.calls[0][0]).toBe("/api/v1/users/7/departments");
    expect(JSON.parse(spy.mock.calls[0][1]?.body as string)).toEqual({ department_ids: [1, 2] });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npx vitest run src/api/client.departments.test.ts`
Expected: FAIL — functions not exported.

- [ ] **Step 3: Add the `Department` type + `AuthUser.department_ids`**

In `frontend/src/types.ts`, add:
```typescript
export interface Department {
  id: number;
  name: string;
  team_id: number;
  team_name: string;
  member_ids: number[];
}
```
And in `interface AuthUser`, after `username`:
```typescript
  department_ids?: number[];
```

- [ ] **Step 4: Add the client functions**

In `frontend/src/api/client.ts`, add (near the team functions):
```typescript
export function getDepartments(): Promise<Department[]> {
  return request<Department[]>(`${API}/departments`);
}

export function createDepartment(name: string, teamId: number): Promise<Department> {
  return request<Department>(`${API}/departments`, json({ name, team_id: teamId }));
}

export function renameDepartment(id: number, name: string): Promise<Department> {
  return request<Department>(`${API}/departments/${id}`, { ...json({ name }), method: "PATCH" });
}

export function deleteDepartment(id: number): Promise<void> {
  return request<void>(`${API}/departments/${id}`, { method: "DELETE" });
}

export function setDepartmentMembers(id: number, userIds: number[]): Promise<Department> {
  return request<Department>(`${API}/departments/${id}/members`, { ...json({ user_ids: userIds }), method: "PUT" });
}

export function setUserDepartments(userId: number, departmentIds: number[]): Promise<AuthUser> {
  return request<AuthUser>(`${API}/users/${userId}/departments`, { ...json({ department_ids: departmentIds }), method: "PUT" });
}
```
Add `Department` to the `types` import at the top of `client.ts`.

- [ ] **Step 5: Run to verify pass + typecheck**

Run: `cd frontend && npx vitest run src/api/client.departments.test.ts && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/types.ts frontend/src/api/client.ts frontend/src/api/client.departments.test.ts
git commit -m "feat(departments): frontend Department type + client functions"
```

---

### Task 5: DepartmentsSection + Admin wiring

**Files:**
- Create: `frontend/src/components/admin/DepartmentsSection.tsx`
- Modify: `frontend/src/components/admin/AdminView.tsx`
- Test: `frontend/src/components/admin/DepartmentsSection.test.tsx` (new)

**Interfaces:**
- Consumes: `getDepartments`, `createDepartment`, `renameDepartment`, `deleteDepartment`, `setDepartmentMembers` (Task 4); `getTeams`, `getPersonOptions`.

- [ ] **Step 1: Write the failing component test**

Create `frontend/src/components/admin/DepartmentsSection.test.tsx`:

```typescript
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import * as client from "../../api/client";
import DepartmentsSection from "./DepartmentsSection";

afterEach(() => vi.restoreAllMocks());

function mockData() {
  vi.spyOn(client, "getTeams").mockResolvedValue([{ id: 1, name: "Net" }] as never);
  vi.spyOn(client, "getPersonOptions").mockResolvedValue(
    [{ id: 7, display_name: "Ann", team_id: 1 }] as never,
  );
  vi.spyOn(client, "getDepartments").mockResolvedValue(
    [{ id: 3, name: "Frontend", team_id: 1, team_name: "Net", member_ids: [] }] as never,
  );
}

it("lists departments grouped by team", async () => {
  mockData();
  render(<DepartmentsSection onChanged={vi.fn()} />);
  expect(await screen.findByText("Frontend")).toBeInTheDocument();
  expect(screen.getByText("Net")).toBeInTheDocument();
});

it("creates a department under a team", async () => {
  mockData();
  const create = vi.spyOn(client, "createDepartment").mockResolvedValue(
    { id: 4, name: "Backend", team_id: 1, team_name: "Net", member_ids: [] } as never,
  );
  render(<DepartmentsSection onChanged={vi.fn()} />);
  await screen.findByText("Frontend");
  await userEvent.type(screen.getByLabelText(/new department for Net/i), "Backend");
  await userEvent.click(screen.getByRole("button", { name: /add department to Net/i }));
  await waitFor(() => expect(create).toHaveBeenCalledWith("Backend", 1));
});

it("toggling a member calls setDepartmentMembers", async () => {
  mockData();
  const setMembers = vi.spyOn(client, "setDepartmentMembers").mockResolvedValue(
    { id: 3, name: "Frontend", team_id: 1, team_name: "Net", member_ids: [7] } as never,
  );
  render(<DepartmentsSection onChanged={vi.fn()} />);
  await userEvent.click(await screen.findByRole("button", { name: /members of Frontend/i }));
  const ann = within(screen.getByTestId("members-3")).getByLabelText("Ann");
  await userEvent.click(ann);
  await waitFor(() => expect(setMembers).toHaveBeenCalledWith(3, [7]));
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npx vitest run src/components/admin/DepartmentsSection.test.tsx`
Expected: FAIL — `Cannot find module './DepartmentsSection'`.

- [ ] **Step 3: Implement `DepartmentsSection`**

Create `frontend/src/components/admin/DepartmentsSection.tsx`:

```tsx
import { useEffect, useState } from "react";
import {
  createDepartment,
  deleteDepartment,
  getDepartments,
  getPersonOptions,
  getTeams,
  renameDepartment,
  setDepartmentMembers,
} from "../../api/client";
import type { Department, PersonOption, Team } from "../../types";
import AdminCard, {
  adminAddButtonClass,
  adminEmptyClass,
  adminInputClass,
  adminRemoveButtonClass,
  adminRowClass,
} from "./AdminCard";

export default function DepartmentsSection({ onChanged }: { onChanged: () => void }) {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [people, setPeople] = useState<PersonOption[]>([]);
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [expanded, setExpanded] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = () => void getDepartments().then(setDepartments);
  useEffect(() => {
    reload();
    void getTeams().then(setTeams);
    void getPersonOptions().then(setPeople);
  }, []);

  const add = async (teamId: number) => {
    const name = (drafts[teamId] ?? "").trim();
    if (!name) return;
    setError(null);
    try {
      await createDepartment(name, teamId);
      setDrafts((d) => ({ ...d, [teamId]: "" }));
      reload();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add the department.");
    }
  };

  const rename = async (dep: Department) => {
    const name = prompt("Rename department", dep.name)?.trim();
    if (!name || name === dep.name) return;
    try {
      await renameDepartment(dep.id, name);
      reload();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not rename the department.");
    }
  };

  const remove = async (dep: Department) => {
    try {
      await deleteDepartment(dep.id);
      reload();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete the department.");
    }
  };

  const toggleMember = async (dep: Department, userId: number) => {
    const next = dep.member_ids.includes(userId)
      ? dep.member_ids.filter((id) => id !== userId)
      : [...dep.member_ids, userId];
    try {
      await setDepartmentMembers(dep.id, next);
      reload();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update members.");
    }
  };

  return (
    <AdminCard title="Departments" icon="🏢" count={departments.length}>
      {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
      {teams.length === 0 ? (
        <p className={adminEmptyClass}>Add a team first.</p>
      ) : (
        <div className="flex flex-col gap-4">
          {teams.map((team) => {
            const deps = departments.filter((d) => d.team_id === team.id);
            return (
              <div key={team.id}>
                <h3 className="mb-1 text-sm font-semibold text-gray-800">{team.name}</h3>
                {deps.length === 0 && <p className="px-3 py-1 text-xs text-gray-400">No departments yet.</p>}
                {deps.map((dep) => (
                  <div key={dep.id}>
                    <div className={adminRowClass}>
                      <button
                        onClick={() => setExpanded((e) => (e === dep.id ? null : dep.id))}
                        aria-label={`members of ${dep.name}`}
                        className="flex-1 text-left"
                      >
                        {dep.name}{" "}
                        <span className="text-xs text-gray-400">({dep.member_ids.length})</span>
                      </button>
                      <button onClick={() => void rename(dep)} className="text-xs text-gray-400 hover:text-gray-700">
                        Rename
                      </button>
                      <button onClick={() => void remove(dep)} aria-label={`delete ${dep.name}`} className={adminRemoveButtonClass}>
                        ✕
                      </button>
                    </div>
                    {expanded === dep.id && (
                      <div data-testid={`members-${dep.id}`} className="ml-3 mb-2 grid grid-cols-2 gap-1 border-l border-gray-100 pl-3">
                        {people.map((p) => (
                          <label key={p.id} className="flex items-center gap-2 text-sm text-gray-700">
                            <input
                              type="checkbox"
                              checked={dep.member_ids.includes(p.id)}
                              onChange={() => void toggleMember(dep, p.id)}
                              className="h-4 w-4 rounded border-gray-300"
                            />
                            {p.display_name}
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
                <div className="mt-1 flex gap-2">
                  <input
                    value={drafts[team.id] ?? ""}
                    onChange={(e) => setDrafts((d) => ({ ...d, [team.id]: e.target.value }))}
                    placeholder="New department"
                    aria-label={`new department for ${team.name}`}
                    className={`flex-1 ${adminInputClass}`}
                  />
                  <button onClick={() => void add(team.id)} aria-label={`add department to ${team.name}`} className={adminAddButtonClass}>
                    Add
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </AdminCard>
  );
}
```

- [ ] **Step 4: Run the component tests**

Run: `cd frontend && npx vitest run src/components/admin/DepartmentsSection.test.tsx`
Expected: PASS

- [ ] **Step 5: Render it in the Admin teams section**

In `frontend/src/components/admin/AdminView.tsx`, add the import:
```tsx
import DepartmentsSection from "./DepartmentsSection";
```
In the `section === "teams"` block, add `DepartmentsSection` after `CapacitySection` inside the flex column:
```tsx
              <CapacitySection key={capacityKey} planningIntervals={planningIntervals} />
              <DepartmentsSection onChanged={onChanged} />
```

- [ ] **Step 6: Full frontend suite + build + commit**

Run: `cd frontend && npx vitest run && npm run build` → PASS.
```bash
git add frontend/src/components/admin/DepartmentsSection.tsx frontend/src/components/admin/DepartmentsSection.test.tsx frontend/src/components/admin/AdminView.tsx
git commit -m "feat(departments): DepartmentsSection in the admin teams area"
```

---

### Task 6: User modal departments multi-select

**Files:**
- Modify: `frontend/src/components/admin/UsersSection.tsx`
- Modify: `frontend/src/components/admin/UserModal.tsx`
- Test: `frontend/src/components/admin/UserModal.test.tsx`

**Interfaces:**
- Consumes: `getDepartments`, `setUserDepartments` (Task 4); `Department`, `AuthUser.department_ids`.

- [ ] **Step 1: Write the failing modal test**

In `frontend/src/components/admin/UserModal.test.tsx`, add near the top after `teams`:
```typescript
const departments = [
  { id: 3, name: "Frontend", team_id: 1, team_name: "Network", member_ids: [] },
] as never;
```
Then add:
```typescript
it("edit: changing departments calls setUserDepartments", async () => {
  vi.spyOn(client, "updateUser").mockResolvedValue(ben);
  const setDepts = vi.spyOn(client, "setUserDepartments").mockResolvedValue(ben);
  const withDept = { ...(ben as Record<string, unknown>), department_ids: [] } as never;
  render(
    <UserModal mode="edit" user={withDept} teams={teams} departments={departments} currentUserId={1} onSaved={() => {}} onClose={() => {}} />,
  );
  await userEvent.click(screen.getByLabelText("Frontend"));
  await userEvent.click(screen.getByRole("button", { name: /^save$/i }));
  expect(setDepts).toHaveBeenCalledWith(2, [3]);
});
```
Update the three existing `render(<UserModal ... />)` calls that omit `departments` to pass `departments={departments}` (create-mode tests and the edit tests) so the prop is present.

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npx vitest run src/components/admin/UserModal.test.tsx`
Expected: FAIL — `departments` prop unknown / checkbox not found.

- [ ] **Step 3: Add the departments picker to `UserModal`**

In `frontend/src/components/admin/UserModal.tsx`:

Add to imports:
```typescript
import { ConflictError, createUser, setUserDepartments, updateUser } from "../../api/client";
import type { AuthUser, Department, Team } from "../../types";
```
Add `departments` to the props type and destructure it:
```typescript
  departments,
```
```typescript
  departments: Department[];
```
Add state (after `password`):
```typescript
  const [deptIds, setDeptIds] = useState<number[]>(user?.department_ids ?? []);
```
In `save`, capture the created user and persist departments on both branches.

Edit A — replace the create branch opening:
```typescript
      if (mode === "create") {
        await createUser({
          email: email.trim() === "" ? null : email.trim(),
          username: username.trim() === "" ? null : username.trim(),
          display_name: name.trim(),
          password: password === "" ? null : password,
          role,
          team_id: teamId,
        });
      } else if (user) {
```
with:
```typescript
      if (mode === "create") {
        const created = await createUser({
          email: email.trim() === "" ? null : email.trim(),
          username: username.trim() === "" ? null : username.trim(),
          display_name: name.trim(),
          password: password === "" ? null : password,
          role,
          team_id: teamId,
        });
        if (deptIds.length) await setUserDepartments(created.id, deptIds);
      } else if (user) {
```

Edit B — in the `else if (user)` branch, immediately after the line
`        if (Object.keys(diff).length) await updateUser(user.id, diff);`
add:
```typescript
        const before = user.department_ids ?? [];
        const changed =
          deptIds.length !== before.length || deptIds.some((id) => !before.includes(id));
        if (changed) await setUserDepartments(user.id, deptIds);
```

Add the picker to the JSX (after the password field, inside the grid, full width):
```tsx
          {departments.length > 0 && (
            <div className="col-span-2">
              <span className={caption}>Departments</span>
              <div className="mt-1 grid grid-cols-2 gap-1">
                {departments.map((d) => (
                  <label key={d.id} className="flex items-center gap-2 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      checked={deptIds.includes(d.id)}
                      onChange={() =>
                        setDeptIds((ids) =>
                          ids.includes(d.id) ? ids.filter((x) => x !== d.id) : [...ids, d.id],
                        )
                      }
                      className="h-4 w-4 rounded border-gray-300"
                    />
                    {d.name} <span className="text-xs text-gray-400">· {d.team_name}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
```

- [ ] **Step 4: Pass departments from `UsersSection`**

In `frontend/src/components/admin/UsersSection.tsx`:
- Import `getDepartments` and the `Department` type.
- Add state `const [departments, setDepartments] = useState<Department[]>([]);`
- In `reload`, add `void getDepartments().then(setDepartments);`
- Pass `departments={departments}` to both `<UserModal ... />` usages.

- [ ] **Step 5: Run the modal tests**

Run: `cd frontend && npx vitest run src/components/admin/UserModal.test.tsx`
Expected: PASS

- [ ] **Step 6: Full frontend suite + build + commit**

Run: `cd frontend && npx vitest run && npm run build` → PASS.
```bash
git add frontend/src/components/admin/UsersSection.tsx frontend/src/components/admin/UserModal.tsx frontend/src/components/admin/UserModal.test.tsx
git commit -m "feat(departments): departments multi-select in the user modal"
```

---

## Final verification

- [ ] Backend: `cd backend && python -m pytest -q` → green.
- [ ] Frontend: `cd frontend && npx vitest run && npm run build` → green.
- [ ] Migration reconfirmed on Postgres (upgrade/downgrade/upgrade clean).
- [ ] Manual smoke in the Docker stack (rebuild images): Admin → Teams & Capacity shows Departments; add a department under a team; expand it and toggle a member; edit a user and check/uncheck departments — reload shows persistence.
