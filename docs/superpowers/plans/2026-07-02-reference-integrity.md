# Reference Integrity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Master-data renames (teams, team members, planning intervals, lanes) propagate into item strings transactionally; deletes warn with usage counts; schema hygiene (drop `items.dependencies`, indexes, CHECK, NOT-NULL drift).

**Architecture:** New admin-only PATCH endpoints on the three master-data routers plus propagation in the existing lane rename, all using bulk `update(Item)` in the same transaction as the rename. Delete guards return 409 with counted messages unless `?force=true`. Migration 0012 carries the hygiene changes, and `models.py` gains matching declarations so SQLite test fixtures enforce exactly what Postgres does.

**Tech Stack:** FastAPI, SQLAlchemy 2.0, Alembic, Postgres (SQLite in tests), React 18 + TS + vitest.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-02-reference-integrity-design.md`. Branch `feat/reference-integrity`.
- Migration id `0012`, `down_revision = "0011"`, file `backend/alembic/versions/0012_reference_integrity.py`.
- Exact error strings — 404: `"Team not found"` / `"Member not found"` / `"Planning interval not found"`; 409 duplicates: `"Team already exists"` / `"Member already exists"` / `"Planning interval already exists"`; 409 guards: `"Team '<name>' is referenced by <n> items"`, `"Member '<name>' is assigned to <n> items"`, `"Planning interval '<name>' is used by <i> items and <c> capacity entries"`.
- Rename-to-same-name: 200, **no** propagation, **no** audit event. Propagation writes **no** per-item `item.updated` events.
- Audit events: `team.renamed` / `team_member.renamed` / `planning_interval.renamed` — `field="name"`, `old_value`=old, `new_value`=new, entity label = **new** name. `lane.renamed` unchanged.
- Update payloads: `name: str = Field(min_length=1, max_length=128)` (teams, members) / `max_length=64` (PIs).
- `ConflictError` is thrown by the client wrapper **only** for HTTP 409; all other statuses keep the existing generic `Error` with message `` `${resp.status} ${resp.statusText}: ${text}` ``.
- Backend suite: 145 baseline → 148 (T1) → 152 (T2) → 158 (T3). Frontend: 168 baseline → 172 (T4) → 177 (T5).
- ENV: backend tests run in the Docker container (no bind mount) — copy `app/`, `alembic/`, `tests/` in, `pip install -q "pytest>=8.2" "httpx>=0.27" "bcrypt>=4.1"`, then `python -m pytest -q /app/tests`. Frontend tests on host (`cd frontend && npx vitest run`).

---

### Task 1: Schema hygiene — migration 0012 + model/schema/audit/csv scrub

**Files:**
- Create: `backend/alembic/versions/0012_reference_integrity.py`
- Modify: `backend/app/models.py` (Item lines 20-43, Capacity lines 110-125)
- Modify: `backend/app/schemas.py` (remove line 27 and line 60 `dependencies` fields)
- Modify: `backend/app/audit.py` (remove `"dependencies"` from `ITEM_TRACKED_FIELDS`)
- Modify: `backend/app/csv_import.py` (remove line 26 `COL_DEPENDENCIES` constant and line 110 mapping)
- Test: `backend/tests/test_schema_hygiene.py` (new)

**Interfaces:**
- Produces: items API responses no longer contain `dependencies`; `Capacity` rejects `iteration` outside 1..6; six new indexes on `items`.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_schema_hygiene.py`:

```python
import pytest
from sqlalchemy import inspect
from sqlalchemy.exc import IntegrityError

from app.models import Capacity, TeamMember


def test_item_response_has_no_dependencies_field(client):
    resp = client.post("/api/items", json={"kind": "feature", "title": "Clean"})
    assert resp.status_code == 201
    assert "dependencies" not in resp.json()


def test_items_filter_columns_are_indexed(db_session):
    names = {ix["name"] for ix in inspect(db_session.get_bind()).get_indexes("items")}
    assert {
        "ix_items_parent_id",
        "ix_items_kind",
        "ix_items_status",
        "ix_items_planning_interval",
        "ix_items_leading_team",
        "ix_items_assignee",
    } <= names


def test_capacity_iteration_check_constraint(db_session):
    member = TeamMember(name="Checked")
    db_session.add(member)
    db_session.flush()
    db_session.add(
        Capacity(member_id=member.id, planning_interval="PI1", iteration=7, points=1)
    )
    with pytest.raises(IntegrityError):
        db_session.flush()
    db_session.rollback()
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run (after the container copy dance from Global Constraints):
`docker compose exec -T backend python -m pytest -q /app/tests/test_schema_hygiene.py`
Expected: 3 failures — `dependencies` present in the response, missing index names, no IntegrityError raised.

- [ ] **Step 3: Implement**

`backend/app/models.py` — change the `Item` columns (existing lines shown for orientation; only the named ones change):

```python
    kind: Mapped[ItemKind] = mapped_column(Enum(ItemKind, native_enum=False), index=True)
    type: Mapped[str | None] = mapped_column(String(64))
    parent_id: Mapped[int | None] = mapped_column(
        ForeignKey("items.id", ondelete="CASCADE"), index=True
    )
```

```python
    status: Mapped[str | None] = mapped_column(String(64), index=True)
```

```python
    planning_interval: Mapped[str | None] = mapped_column(String(64), index=True)
```

```python
    leading_team: Mapped[str | None] = mapped_column(String(128), index=True)
```

```python
    assignee: Mapped[str | None] = mapped_column(String(128), index=True)
```

Delete the line `dependencies: Mapped[str | None] = mapped_column(Text)` entirely.

`Capacity` gains the CHECK (extend the existing `__table_args__` tuple and import `CheckConstraint` alongside the other `sqlalchemy` imports at the top of the file):

```python
from sqlalchemy import CheckConstraint, Enum, ForeignKey, Index, Integer, Numeric, String, Text, UniqueConstraint, func
```

```python
class Capacity(Base):
    __tablename__ = "capacities"
    __table_args__ = (
        UniqueConstraint(
            "member_id", "planning_interval", "iteration",
            name="uq_capacity_member_pi_iter",
        ),
        CheckConstraint("iteration >= 1 AND iteration <= 6", name="ck_capacities_iteration"),
    )
```

`backend/app/schemas.py`: delete the `dependencies: str | None = None` line from `ItemBase` (line 27) AND from `ItemUpdate` (line 60).

`backend/app/audit.py`: delete the `"dependencies",` entry from `ITEM_TRACKED_FIELDS`.

`backend/app/csv_import.py`: delete line 26 (`COL_DEPENDENCIES = "Dependencies"`) and line 110 (`"dependencies": g(COL_DEPENDENCIES),`).

Create `backend/alembic/versions/0012_reference_integrity.py`:

```python
"""reference integrity: drop legacy dependencies text, indexes, checks, not-null drift

Revision ID: 0012
Revises: 0011
"""
from alembic import op
import sqlalchemy as sa

revision = "0012"
down_revision = "0011"
branch_labels = None
depends_on = None

# created_at columns whose migrations omitted nullable=False while the models
# are non-Optional (drift since 0006).
_NOT_NULL_FIXES = [
    "item_links",
    "planning_intervals",
    "users",
    "user_sessions",
    "audit_events",
    "comments",
]


def upgrade() -> None:
    op.drop_column("items", "dependencies")
    # ix_items_parent_id and ix_items_status already exist in Postgres (created
    # by migration 0001, undeclared in the model until now) — only these four
    # indexes are new. models.py still declares index=True on all six so the
    # SQLite create_all fixtures match the real database.
    op.create_index("ix_items_kind", "items", ["kind"])
    op.create_index("ix_items_planning_interval", "items", ["planning_interval"])
    op.create_index("ix_items_leading_team", "items", ["leading_team"])
    op.create_index("ix_items_assignee", "items", ["assignee"])
    op.create_check_constraint(
        "ck_capacities_iteration", "capacities", "iteration >= 1 AND iteration <= 6"
    )
    for table in _NOT_NULL_FIXES:
        op.execute(f"UPDATE {table} SET created_at = now() WHERE created_at IS NULL")
        op.alter_column(table, "created_at", existing_type=sa.DateTime(), nullable=False)


def downgrade() -> None:
    for table in reversed(_NOT_NULL_FIXES):
        op.alter_column(table, "created_at", existing_type=sa.DateTime(), nullable=True)
    op.drop_constraint("ck_capacities_iteration", "capacities", type_="check")
    # ix_items_parent_id / ix_items_status belong to migration 0001 — not dropped here.
    op.drop_index("ix_items_assignee", table_name="items")
    op.drop_index("ix_items_leading_team", table_name="items")
    op.drop_index("ix_items_planning_interval", table_name="items")
    op.drop_index("ix_items_kind", table_name="items")
    op.add_column("items", sa.Column("dependencies", sa.Text, nullable=True))
```

- [ ] **Step 4: Run the full backend suite**

`docker compose exec -T backend python -m pytest -q /app/tests`
Expected: **148 passed** (145 baseline + 3 new; no existing backend test references `dependencies`).

- [ ] **Step 5: Commit**

```bash
git add backend/alembic/versions/0012_reference_integrity.py backend/app/models.py backend/app/schemas.py backend/app/audit.py backend/app/csv_import.py backend/tests/test_schema_hygiene.py
git commit -m "feat(backend): schema hygiene — drop legacy dependencies, indexes, checks, not-null drift (0012)"
```

---

### Task 2: Team rename + delete guard

**Files:**
- Modify: `backend/app/routers/teams.py`
- Modify: `backend/app/schemas.py` (add `TeamUpdate` after `TeamCreate`, line ~143)
- Test: `backend/tests/test_api_renames.py` (new)

**Interfaces:**
- Consumes: `log_event` from `app.audit` (never commits); `Item` model.
- Produces: `PATCH /api/teams/{team_id}` (`TeamUpdate {name}` → `TeamRead`), `DELETE /api/teams/{team_id}?force=` — Task 4's `renameTeam`/`deleteTeam(force)` client fns call these.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_api_renames.py`:

```python
from app.models import AuditEvent, Capacity, Item


def _mk_item(client, **fields):
    body = {"kind": "feature", "title": "T", **fields}
    resp = client.post("/api/items", json=body)
    assert resp.status_code == 201
    return resp.json()["id"]


def _events(db_session, event_type):
    return [
        e for e in db_session.query(AuditEvent).all() if e.event_type == event_type
    ]


def test_team_rename_propagates_to_items(client, db_session):
    team = client.post("/api/teams", json={"name": "Network"}).json()
    lead = _mk_item(client, leading_team="Network")
    support = _mk_item(client, supporting_team="Network")
    other = _mk_item(client, leading_team="Platform")

    resp = client.patch(f"/api/teams/{team['id']}", json={"name": "Net & Cloud"})
    assert resp.status_code == 200
    assert resp.json()["name"] == "Net & Cloud"
    assert client.get(f"/api/items/{lead}").json()["leading_team"] == "Net & Cloud"
    assert client.get(f"/api/items/{support}").json()["supporting_team"] == "Net & Cloud"
    assert client.get(f"/api/items/{other}").json()["leading_team"] == "Platform"

    events = _events(db_session, "team.renamed")
    assert len(events) == 1
    assert events[0].field == "name"
    assert events[0].old_value == "Network"
    assert events[0].new_value == "Net & Cloud"
    assert events[0].entity_label == "Net & Cloud"
    # propagation must not write per-item events
    assert _events(db_session, "item.updated") == []


def test_team_rename_conflicts_and_noop(client, db_session):
    a = client.post("/api/teams", json={"name": "A"}).json()
    client.post("/api/teams", json={"name": "B"})

    dup = client.patch(f"/api/teams/{a['id']}", json={"name": "B"})
    assert dup.status_code == 409
    assert dup.json()["detail"] == "Team already exists"

    noop = client.patch(f"/api/teams/{a['id']}", json={"name": "A"})
    assert noop.status_code == 200
    assert _events(db_session, "team.renamed") == []

    missing = client.patch("/api/teams/9999", json={"name": "X"})
    assert missing.status_code == 404
    assert missing.json()["detail"] == "Team not found"


def test_team_delete_guard_and_force(client, db_session):
    team = client.post("/api/teams", json={"name": "Guarded"}).json()
    # one item referencing the team twice still counts once
    _mk_item(client, leading_team="Guarded", supporting_team="Guarded")
    _mk_item(client, supporting_team="Guarded")

    blocked = client.delete(f"/api/teams/{team['id']}")
    assert blocked.status_code == 409
    assert blocked.json()["detail"] == "Team 'Guarded' is referenced by 2 items"

    forced = client.delete(f"/api/teams/{team['id']}?force=true")
    assert forced.status_code == 204
    assert len(_events(db_session, "team.deleted")) == 1


def test_team_delete_without_usage_needs_no_force(client):
    team = client.post("/api/teams", json={"name": "Idle"}).json()
    assert client.delete(f"/api/teams/{team['id']}").status_code == 204
```

- [ ] **Step 2: Run to verify failure**

`docker compose exec -T backend python -m pytest -q /app/tests/test_api_renames.py`
Expected: FAIL — `PATCH /api/teams/{id}` returns 405 (no route), guard test gets 204 instead of 409.

- [ ] **Step 3: Implement**

`backend/app/schemas.py` — add directly after `TeamCreate`:

```python
class TeamUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=128)
```

(`Field` is already imported in this file.)

`backend/app/routers/teams.py` — replace the imports and add/replace the endpoints:

```python
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.audit import log_event
from app.auth import require_admin
from app.db import get_db
from app.models import Item, Team, TeamMember, User
from app.schemas import TeamCreate, TeamRead, TeamUpdate
```

Add after `create_team`:

```python
@router.patch("/{team_id}", response_model=TeamRead, dependencies=[Depends(require_admin)])
def rename_team(
    team_id: int,
    payload: TeamUpdate,
    db: Session = Depends(get_db),
    current: User = Depends(require_admin),
) -> Team:
    team = db.get(Team, team_id)
    if team is None:
        raise HTTPException(status_code=404, detail="Team not found")
    if payload.name == team.name:
        return team
    if db.scalar(select(Team).where(Team.name == payload.name, Team.id != team_id)):
        raise HTTPException(status_code=409, detail="Team already exists")
    old = team.name
    team.name = payload.name
    for column in (Item.leading_team, Item.supporting_team):
        db.execute(
            update(Item)
            .where(column == old)
            .values({column.key: payload.name})
            .execution_options(synchronize_session=False)
        )
    log_event(db, actor=current, event_type="team.renamed", entity_type="team",
              entity_id=team.id, entity_label=team.name,
              field="name", old_value=old, new_value=team.name)
    db.commit()
    db.refresh(team)
    return team
```

Replace `delete_team` (guard added before the existing detach/delete flow):

```python
@router.delete("/{team_id}", status_code=204, dependencies=[Depends(require_admin)])
def delete_team(
    team_id: int,
    force: bool = False,
    db: Session = Depends(get_db),
    current: User = Depends(require_admin),
) -> None:
    team = db.get(Team, team_id)
    if team is None:
        raise HTTPException(status_code=404, detail="Team not found")
    if not force:
        used = db.scalar(
            select(func.count())
            .select_from(Item)
            .where((Item.leading_team == team.name) | (Item.supporting_team == team.name))
        )
        if used:
            raise HTTPException(
                status_code=409,
                detail=f"Team '{team.name}' is referenced by {used} items",
            )
    # Detach members explicitly (DB also enforces ON DELETE SET NULL).
    for member in db.scalars(select(TeamMember).where(TeamMember.team_id == team_id)):
        member.team_id = None
    log_event(db, actor=current, event_type="team.deleted", entity_type="team",
              entity_id=team.id, entity_label=team.name)
    db.delete(team)
    db.commit()
```

- [ ] **Step 4: Run the full backend suite**

`docker compose exec -T backend python -m pytest -q /app/tests`
Expected: **152 passed** (148 + 4 new).

- [ ] **Step 5: Commit**

```bash
git add backend/app/routers/teams.py backend/app/schemas.py backend/tests/test_api_renames.py
git commit -m "feat(backend): team rename with propagation + usage-guarded delete"
```

---

### Task 3: Member + PI renames/guards + lane rename propagation

**Files:**
- Modify: `backend/app/routers/team_members.py`
- Modify: `backend/app/routers/planning_intervals.py`
- Modify: `backend/app/routers/boards.py` (`rename_lane`, lines 92-114)
- Modify: `backend/app/schemas.py` (add `TeamMemberUpdate`, `PlanningIntervalUpdate`)
- Test: extend `backend/tests/test_api_renames.py`

**Interfaces:**
- Consumes: `TeamUpdate` pattern from Task 2; helpers `_mk_item` / `_events` already in the test file.
- Produces: `PATCH /api/team-members/{id}`, `PATCH /api/planning-intervals/{id}`, `DELETE ...?force=` on both — Task 4's client fns call these.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_api_renames.py`:

```python
def test_member_rename_propagates_assignee(client, db_session):
    m = client.post("/api/team-members", json={"name": "Anna"}).json()
    mine = _mk_item(client, assignee="Anna")
    other = _mk_item(client, assignee="Ben")

    resp = client.patch(f"/api/team-members/{m['id']}", json={"name": "Anna B."})
    assert resp.status_code == 200
    assert client.get(f"/api/items/{mine}").json()["assignee"] == "Anna B."
    assert client.get(f"/api/items/{other}").json()["assignee"] == "Ben"
    events = _events(db_session, "team_member.renamed")
    assert len(events) == 1 and events[0].old_value == "Anna"


def test_member_rename_conflict_and_delete_guard(client, db_session):
    a = client.post("/api/team-members", json={"name": "A"}).json()
    client.post("/api/team-members", json={"name": "B"})
    dup = client.patch(f"/api/team-members/{a['id']}", json={"name": "B"})
    assert dup.status_code == 409
    assert dup.json()["detail"] == "Member already exists"

    _mk_item(client, assignee="A")
    blocked = client.delete(f"/api/team-members/{a['id']}")
    assert blocked.status_code == 409
    assert blocked.json()["detail"] == "Member 'A' is assigned to 1 items"
    assert client.delete(f"/api/team-members/{a['id']}?force=true").status_code == 204


def test_pi_rename_propagates_items_and_capacities(client, db_session):
    pi = client.post("/api/planning-intervals", json={"name": "PI1"}).json()
    member = client.post("/api/team-members", json={"name": "Cap"}).json()
    item = _mk_item(client, planning_interval="PI1")
    db_session.add(
        Capacity(member_id=member["id"], planning_interval="PI1", iteration=1, points=5)
    )
    db_session.commit()

    resp = client.patch(f"/api/planning-intervals/{pi['id']}", json={"name": "PI1-Q3"})
    assert resp.status_code == 200
    assert client.get(f"/api/items/{item}").json()["planning_interval"] == "PI1-Q3"
    caps = db_session.query(Capacity).all()
    assert [c.planning_interval for c in caps] == ["PI1-Q3"]
    assert len(_events(db_session, "planning_interval.renamed")) == 1


def test_pi_delete_guard_counts_items_and_capacities(client, db_session):
    pi = client.post("/api/planning-intervals", json={"name": "PI9"}).json()
    member = client.post("/api/team-members", json={"name": "Niner"}).json()
    _mk_item(client, planning_interval="PI9")
    db_session.add(
        Capacity(member_id=member["id"], planning_interval="PI9", iteration=2, points=3)
    )
    db_session.commit()

    blocked = client.delete(f"/api/planning-intervals/{pi['id']}")
    assert blocked.status_code == 409
    assert blocked.json()["detail"] == (
        "Planning interval 'PI9' is used by 1 items and 1 capacity entries"
    )
    assert client.delete(f"/api/planning-intervals/{pi['id']}?force=true").status_code == 204


def test_pi_rename_duplicate_409(client):
    a = client.post("/api/planning-intervals", json={"name": "P-A"}).json()
    client.post("/api/planning-intervals", json={"name": "P-B"})
    dup = client.patch(f"/api/planning-intervals/{a['id']}", json={"name": "P-B"})
    assert dup.status_code == 409
    assert dup.json()["detail"] == "Planning interval already exists"


def test_lane_rename_propagates_scoped_by_board_kinds(client, db_session):
    boards = client.get("/api/boards").json()
    risks_board = next(b for b in boards if b["kinds"] == ["risk"])
    new_lane = next(l for l in risks_board["lanes"] if l["name"] == "New")
    story_parent = _mk_item(client, kind="feature", status="New")
    risk = client.post(
        "/api/items", json={"kind": "risk", "title": "R", "status": "New"}
    ).json()["id"]

    resp = client.patch(f"/api/lanes/{new_lane['id']}", json={"name": "Fresh"})
    assert resp.status_code == 200
    assert client.get(f"/api/items/{risk}").json()["status"] == "Fresh"
    assert client.get(f"/api/items/{story_parent}").json()["status"] == "New"
    assert _events(db_session, "item.updated") == []
```

- [ ] **Step 2: Run to verify failure**

`docker compose exec -T backend python -m pytest -q /app/tests/test_api_renames.py`
Expected: the 6 new tests FAIL (405s on the PATCH routes; lane rename leaves the risk's status "New").

- [ ] **Step 3: Implement**

`backend/app/schemas.py` — add after `TeamMemberCreate` / after `PlanningIntervalCreate` respectively:

```python
class TeamMemberUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=128)
```

```python
class PlanningIntervalUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=64)
```

`backend/app/routers/team_members.py` — imports become:

```python
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.audit import log_event
from app.auth import require_admin
from app.db import get_db
from app.models import Item, Team, TeamMember, User
from app.schemas import TeamMemberCreate, TeamMemberRead, TeamMemberUpdate
```

Add after `create_member`:

```python
@router.patch("/{member_id}", response_model=TeamMemberRead, dependencies=[Depends(require_admin)])
def rename_member(
    member_id: int,
    payload: TeamMemberUpdate,
    db: Session = Depends(get_db),
    current: User = Depends(require_admin),
) -> TeamMemberRead:
    member = db.get(TeamMember, member_id)
    if member is None:
        raise HTTPException(status_code=404, detail="Member not found")
    if payload.name == member.name:
        return _to_read(member)
    if db.scalar(select(TeamMember).where(TeamMember.name == payload.name, TeamMember.id != member_id)):
        raise HTTPException(status_code=409, detail="Member already exists")
    old = member.name
    member.name = payload.name
    db.execute(
        update(Item)
        .where(Item.assignee == old)
        .values(assignee=payload.name)
        .execution_options(synchronize_session=False)
    )
    log_event(db, actor=current, event_type="team_member.renamed", entity_type="team_member",
              entity_id=member.id, entity_label=member.name,
              field="name", old_value=old, new_value=member.name)
    db.commit()
    db.refresh(member)
    return _to_read(member)
```

Replace `delete_member` — add `force: bool = False` parameter and, after the 404 check:

```python
    if not force:
        used = db.scalar(
            select(func.count()).select_from(Item).where(Item.assignee == member.name)
        )
        if used:
            raise HTTPException(
                status_code=409,
                detail=f"Member '{member.name}' is assigned to {used} items",
            )
```

(the existing `log_event` + `db.delete` + `db.commit` lines stay unchanged below it).

`backend/app/routers/planning_intervals.py` — imports become:

```python
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.audit import log_event
from app.auth import require_admin
from app.db import get_db
from app.models import Capacity, Item, PlanningInterval, User
from app.schemas import PlanningIntervalCreate, PlanningIntervalRead, PlanningIntervalUpdate
```

Add after `create_planning_interval`:

```python
@router.patch("/{pi_id}", response_model=PlanningIntervalRead, dependencies=[Depends(require_admin)])
def rename_planning_interval(
    pi_id: int,
    payload: PlanningIntervalUpdate,
    db: Session = Depends(get_db),
    current: User = Depends(require_admin),
) -> PlanningInterval:
    pi = db.get(PlanningInterval, pi_id)
    if pi is None:
        raise HTTPException(status_code=404, detail="Planning interval not found")
    if payload.name == pi.name:
        return pi
    if db.scalar(select(PlanningInterval).where(PlanningInterval.name == payload.name, PlanningInterval.id != pi_id)):
        raise HTTPException(status_code=409, detail="Planning interval already exists")
    old = pi.name
    pi.name = payload.name
    db.execute(
        update(Item)
        .where(Item.planning_interval == old)
        .values(planning_interval=payload.name)
        .execution_options(synchronize_session=False)
    )
    db.execute(
        update(Capacity)
        .where(Capacity.planning_interval == old)
        .values(planning_interval=payload.name)
        .execution_options(synchronize_session=False)
    )
    log_event(db, actor=current, event_type="planning_interval.renamed", entity_type="planning_interval",
              entity_id=pi.id, entity_label=pi.name,
              field="name", old_value=old, new_value=pi.name)
    db.commit()
    db.refresh(pi)
    return pi
```

Replace `delete_planning_interval` — add `force: bool = False` and, after the 404 check:

```python
    if not force:
        items_used = db.scalar(
            select(func.count()).select_from(Item).where(Item.planning_interval == pi.name)
        )
        caps_used = db.scalar(
            select(func.count()).select_from(Capacity).where(Capacity.planning_interval == pi.name)
        )
        if items_used or caps_used:
            raise HTTPException(
                status_code=409,
                detail=(
                    f"Planning interval '{pi.name}' is used by {items_used} items "
                    f"and {caps_used} capacity entries"
                ),
            )
```

`backend/app/routers/boards.py` — extend imports:

```python
from sqlalchemy import func, select, update
```
```python
from app.models import Board, Item, ItemKind, Lane, User
```

In `rename_lane`, inside the existing `if old_name != lane.name:` block, add the propagation **before** the `log_event` call:

```python
    if old_name != lane.name:
        kinds = [ItemKind(k) for k in lane.board.kinds.split(",") if k]
        db.execute(
            update(Item)
            .where(Item.status == old_name, Item.kind.in_(kinds))
            .values(status=lane.name)
            .execution_options(synchronize_session=False)
        )
        log_event(db, actor=current, event_type="lane.renamed", entity_type="lane",
                  entity_id=lane.id, entity_label=lane.name,
                  field="name", old_value=old_name, new_value=lane.name)
```

- [ ] **Step 4: Run the full backend suite**

`docker compose exec -T backend python -m pytest -q /app/tests`
Expected: **158 passed** (152 + 6 new).

- [ ] **Step 5: Commit**

```bash
git add backend/app/routers/team_members.py backend/app/routers/planning_intervals.py backend/app/routers/boards.py backend/app/schemas.py backend/tests/test_api_renames.py
git commit -m "feat(backend): member/PI renames with propagation, guarded deletes, kind-scoped lane rename"
```

---

### Task 4: Frontend client — ConflictError, rename fns, force deletes, types scrub

**Files:**
- Modify: `frontend/src/api/client.ts`
- Modify: `frontend/src/types.ts` (remove `dependencies` from `Item` line 25 and from the update payload type line 111)
- Modify (fixture scrub — remove the `dependencies` fixture keys only): `frontend/src/components/BoardView.test.tsx`, `Card.test.tsx`, `ItemDrawer.test.tsx`, `ItemDrawerAssignee.test.tsx`, `ItemDrawerFields.test.tsx`, `ItemDrawerLinks.test.tsx`, `ItemDrawerStories.test.tsx`, `StoryBoardModal.test.tsx`, `StoryPlanCard.test.tsx`, `TimelineView.test.tsx`, `frontend/src/lib/boardLanes.test.ts`, `frontend/src/lib/groupByStatus.test.ts`
- Test: `frontend/src/api/client.renames.test.ts` (new)

**Interfaces:**
- Consumes: Task 2/3 endpoints.
- Produces (Task 5 relies on these exact signatures):
  - `class ConflictError extends Error { readonly detail: string }`
  - `renameTeam(id: number, name: string): Promise<Team>`
  - `renameTeamMember(id: number, name: string): Promise<TeamMember>`
  - `renamePlanningInterval(id: number, name: string): Promise<PlanningInterval>`
  - `deleteTeam(id: number, force = false)`, `deleteTeamMember(id: number, force = false)`, `deletePlanningInterval(id: number, force = false)` — append `?force=true` when `force` is truthy.

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/api/client.renames.test.ts`:

```ts
import { afterEach, expect, it, vi } from "vitest";
import {
  ConflictError,
  deleteTeam,
  renamePlanningInterval,
  renameTeam,
  renameTeamMember,
} from "./client";

const ok = (body: unknown) =>
  ({ ok: true, status: 200, json: () => Promise.resolve(body) }) as Response;

afterEach(() => vi.restoreAllMocks());

it("rename fns PATCH the right URLs", async () => {
  const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(ok({ id: 1 }));
  await renameTeam(1, "Net");
  await renameTeamMember(2, "Anna");
  await renamePlanningInterval(3, "PI2");
  expect(spy).toHaveBeenNthCalledWith(1, "/api/teams/1", expect.objectContaining({ method: "PATCH" }));
  expect(spy).toHaveBeenNthCalledWith(2, "/api/team-members/2", expect.objectContaining({ method: "PATCH" }));
  expect(spy).toHaveBeenNthCalledWith(3, "/api/planning-intervals/3", expect.objectContaining({ method: "PATCH" }));
});

it("delete fns append force=true only when forced", async () => {
  const spy = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue({ ok: true, status: 204 } as Response);
  await deleteTeam(7);
  await deleteTeam(7, true);
  expect(spy).toHaveBeenNthCalledWith(1, "/api/teams/7", expect.anything());
  expect(spy).toHaveBeenNthCalledWith(2, "/api/teams/7?force=true", expect.anything());
});

it("409 responses throw ConflictError with the parsed detail", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok: false,
    status: 409,
    statusText: "Conflict",
    text: () => Promise.resolve('{"detail":"Team \'X\' is referenced by 3 items"}'),
  } as Response);
  const err = await deleteTeam(1).catch((e: unknown) => e);
  expect(err).toBeInstanceOf(ConflictError);
  expect((err as ConflictError).detail).toBe("Team 'X' is referenced by 3 items");
});

it("non-409 errors keep the generic Error shape", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok: false,
    status: 404,
    statusText: "Not Found",
    text: () => Promise.resolve('{"detail":"Team not found"}'),
  } as Response);
  const err = await renameTeam(9, "Z").catch((e: unknown) => e);
  expect(err).not.toBeInstanceOf(ConflictError);
  expect((err as Error).message).toContain("404 Not Found");
});
```

- [ ] **Step 2: Run to verify failure**

`cd frontend && npx vitest run src/api/client.renames.test.ts`
Expected: FAIL — `ConflictError`/`renameTeam` etc. are not exported.

- [ ] **Step 3: Implement**

`frontend/src/api/client.ts` — add above `request`:

```ts
/** Thrown for HTTP 409 responses; `detail` is the server's conflict message. */
export class ConflictError extends Error {
  readonly detail: string;
  constructor(detail: string) {
    super(detail);
    this.name = "ConflictError";
    this.detail = detail;
  }
}
```

Replace the `!resp.ok` branch of `request` with:

```ts
  if (!resp.ok) {
    if (resp.status === 401 && notify401) onUnauthorized?.();
    const text = await resp.text();
    if (resp.status === 409) {
      let detail = text;
      try {
        const parsed = JSON.parse(text) as { detail?: unknown };
        if (typeof parsed.detail === "string") detail = parsed.detail;
      } catch {
        // non-JSON body — keep the raw text
      }
      throw new ConflictError(detail);
    }
    throw new Error(`${resp.status} ${resp.statusText}: ${text}`);
  }
```

Replace the three delete fns and add the three rename fns (keep each beside its entity's existing fns):

```ts
export function renameTeam(id: number, name: string): Promise<Team> {
  return request<Team>(`/api/teams/${id}`, { ...json({ name }), method: "PATCH" });
}

export function deleteTeam(id: number, force = false): Promise<void> {
  return request<void>(`/api/teams/${id}${force ? "?force=true" : ""}`, { method: "DELETE" });
}
```

```ts
export function renameTeamMember(id: number, name: string): Promise<TeamMember> {
  return request<TeamMember>(`/api/team-members/${id}`, { ...json({ name }), method: "PATCH" });
}

export function deleteTeamMember(id: number, force = false): Promise<void> {
  return request<void>(`/api/team-members/${id}${force ? "?force=true" : ""}`, { method: "DELETE" });
}
```

```ts
export function renamePlanningInterval(id: number, name: string): Promise<PlanningInterval> {
  return request<PlanningInterval>(`/api/planning-intervals/${id}`, { ...json({ name }), method: "PATCH" });
}

export function deletePlanningInterval(id: number, force = false): Promise<void> {
  return request<void>(`/api/planning-intervals/${id}${force ? "?force=true" : ""}`, { method: "DELETE" });
}
```

`frontend/src/types.ts`: delete the `dependencies: string | null;` line from `Item` and the `dependencies?: string | null;` line from the item update payload interface.

Fixture scrub: in the 12 listed test files, delete every `dependencies: null,` / `dependencies: "...",` fixture property (they are object-literal keys in test items; no assertions reference them). If any test asserts on the old 409 generic message format (search `409` in `frontend/src`), update it to the new `ConflictError` behavior — expected: none do.

- [ ] **Step 4: Run the full frontend suite + type-check**

`cd frontend && npx vitest run && npx tsc --noEmit`
Expected: **172 passed** (168 + 4 new), tsc clean (the scrub is what keeps it clean — `Item` fixtures with a removed field would otherwise fail `tsc`).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api/client.ts frontend/src/api/client.renames.test.ts frontend/src/types.ts frontend/src/components/*.test.tsx frontend/src/lib/*.test.ts
git commit -m "feat(frontend): rename/force-delete client fns, ConflictError, drop legacy dependencies field"
```

---

### Task 5: Admin sections — inline rename + guarded delete flow

**Files:**
- Modify: `frontend/src/components/admin/TeamsSection.tsx`
- Modify: `frontend/src/components/admin/TeamMembersSection.tsx`
- Modify: `frontend/src/components/admin/PlanningIntervalsSection.tsx`
- Test: `frontend/src/components/admin/TeamsSection.test.tsx` (new), extend `frontend/src/components/admin/PlanningIntervalsSection.test.tsx`

**Interfaces:**
- Consumes: Task 4's client fns and `ConflictError` (exact signatures in Task 4's Produces block).

Note: these sections have no error display today — each gains a small error line (`text-xs text-red-600`). The spec's "existing error line" phrase refers to this line once added.

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/components/admin/TeamsSection.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import * as client from "../../api/client";
import TeamsSection from "./TeamsSection";

afterEach(() => vi.restoreAllMocks());

const team = { id: 1, name: "Network" };

it("renames a team inline", async () => {
  vi.spyOn(client, "getTeams").mockResolvedValue([team] as never);
  const rename = vi.spyOn(client, "renameTeam").mockResolvedValue({ id: 1, name: "Net" } as never);

  render(<TeamsSection onChanged={() => {}} />);
  await userEvent.click(await screen.findByRole("button", { name: /rename team 1/i }));
  const input = screen.getByRole("textbox", { name: /new name for team 1/i });
  await userEvent.clear(input);
  await userEvent.type(input, "Net");
  await userEvent.click(screen.getByRole("button", { name: /^save$/i }));
  expect(rename).toHaveBeenCalledWith(1, "Net");
});

it("shows the error line when a rename conflicts", async () => {
  vi.spyOn(client, "getTeams").mockResolvedValue([team] as never);
  vi.spyOn(client, "renameTeam").mockRejectedValue(new client.ConflictError("Team already exists"));

  render(<TeamsSection onChanged={() => {}} />);
  await userEvent.click(await screen.findByRole("button", { name: /rename team 1/i }));
  await userEvent.click(screen.getByRole("button", { name: /^save$/i }));
  expect(await screen.findByText("Team already exists")).toBeInTheDocument();
});

it("confirms and forces the delete when the server reports usage", async () => {
  vi.spyOn(client, "getTeams").mockResolvedValue([team] as never);
  const del = vi
    .spyOn(client, "deleteTeam")
    .mockRejectedValueOnce(new client.ConflictError("Team 'Network' is referenced by 3 items"))
    .mockResolvedValueOnce(undefined as never);
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);

  render(<TeamsSection onChanged={() => {}} />);
  await userEvent.click(await screen.findByRole("button", { name: /remove team 1/i }));
  expect(confirm).toHaveBeenCalledWith("Team 'Network' is referenced by 3 items Delete anyway?");
  expect(del).toHaveBeenNthCalledWith(1, 1);
  expect(del).toHaveBeenNthCalledWith(2, 1, true);
});

it("declining the confirm leaves the team alone", async () => {
  vi.spyOn(client, "getTeams").mockResolvedValue([team] as never);
  const del = vi
    .spyOn(client, "deleteTeam")
    .mockRejectedValue(new client.ConflictError("Team 'Network' is referenced by 3 items"));
  vi.spyOn(window, "confirm").mockReturnValue(false);

  render(<TeamsSection onChanged={() => {}} />);
  await userEvent.click(await screen.findByRole("button", { name: /remove team 1/i }));
  expect(del).toHaveBeenCalledTimes(1);
});
```

Append to `frontend/src/components/admin/PlanningIntervalsSection.test.tsx`:

```tsx
it("renames a planning interval inline", async () => {
  vi.spyOn(client, "getPlanningIntervals").mockResolvedValue([{ id: 1, name: "PI1", position: 0 }] as never);
  const rename = vi.spyOn(client, "renamePlanningInterval").mockResolvedValue({ id: 1, name: "PI1-Q3", position: 0 } as never);

  render(<PlanningIntervalsSection onChanged={() => {}} />);
  await userEvent.click(await screen.findByRole("button", { name: /rename planning interval 1/i }));
  const input = screen.getByRole("textbox", { name: /new name for planning interval 1/i });
  await userEvent.clear(input);
  await userEvent.type(input, "PI1-Q3");
  await userEvent.click(screen.getByRole("button", { name: /^save$/i }));
  expect(rename).toHaveBeenCalledWith(1, "PI1-Q3");
});
```

- [ ] **Step 2: Run to verify failure**

`cd frontend && npx vitest run src/components/admin`
Expected: new tests FAIL (`rename team 1` button not found).

- [ ] **Step 3: Implement**

Pattern (shown complete for `TeamsSection.tsx`; apply the same shape to the other two sections with their own entity names, client fns, and aria labels):

```tsx
import { useEffect, useState } from "react";
import { ConflictError, createTeam, deleteTeam, getTeams, renameTeam } from "../../api/client";
import type { Team } from "../../types";
import AdminCard, {
  adminAddButtonClass,
  adminEmptyClass,
  adminInputClass,
  adminRemoveButtonClass,
  adminRowClass,
} from "./AdminCard";

export default function TeamsSection({ onChanged }: { onChanged: () => void }) {
  const [teams, setTeams] = useState<Team[]>([]);
  const [name, setName] = useState("");
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  const reload = () => void getTeams().then(setTeams);
  useEffect(reload, []);

  const add = async () => {
    if (!name.trim()) return;
    setError(null);
    try {
      await createTeam(name.trim());
      setName("");
      reload();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add the team.");
    }
  };

  const startRename = (t: Team) => {
    setRenamingId(t.id);
    setRenameValue(t.name);
    setError(null);
  };

  const saveRename = async () => {
    if (renamingId == null || !renameValue.trim()) return;
    setError(null);
    try {
      await renameTeam(renamingId, renameValue.trim());
      setRenamingId(null);
      reload();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not rename the team.");
    }
  };

  const remove = async (id: number) => {
    setError(null);
    try {
      await deleteTeam(id);
    } catch (e) {
      if (e instanceof ConflictError) {
        if (!window.confirm(`${e.detail} Delete anyway?`)) return;
        try {
          await deleteTeam(id, true);
        } catch (forced) {
          setError(forced instanceof Error ? forced.message : "Could not delete the team.");
          return;
        }
      } else {
        setError(e instanceof Error ? e.message : "Could not delete the team.");
        return;
      }
    }
    reload();
    onChanged();
  };

  return (
    <AdminCard title="Teams" icon="👥" accent="bg-blue-50 text-blue-600" count={teams.length}>
      <div className="mb-4 flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void add()}
          placeholder="New team name"
          className={`${adminInputClass} flex-1`}
        />
        <button onClick={add} className={adminAddButtonClass}>
          Add
        </button>
      </div>
      {error && <p className="mb-2 text-xs text-red-600">{error}</p>}
      <ul className="flex flex-col gap-0.5">
        {teams.map((t) => (
          <li key={t.id} className={adminRowClass}>
            {renamingId === t.id ? (
              <span className="flex flex-1 items-center gap-2">
                <input
                  aria-label={`new name for team ${t.id}`}
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && void saveRename()}
                  className={`${adminInputClass} flex-1 py-1`}
                />
                <button onClick={saveRename} className="text-xs font-semibold text-blue-600 hover:underline">
                  Save
                </button>
                <button
                  onClick={() => setRenamingId(null)}
                  className="text-xs text-gray-400 hover:underline"
                >
                  Cancel
                </button>
              </span>
            ) : (
              <>
                <span className="truncate font-medium text-gray-800">{t.name}</span>
                <span className="flex shrink-0 items-center gap-1">
                  <button
                    aria-label={`rename team ${t.id}`}
                    onClick={() => startRename(t)}
                    className="rounded-md px-1.5 py-1 text-xs text-gray-300 transition hover:bg-blue-50 hover:text-blue-600 group-hover:text-gray-400"
                  >
                    ✎
                  </button>
                  <button
                    aria-label={`remove team ${t.id}`}
                    onClick={() => remove(t.id)}
                    className={adminRemoveButtonClass}
                  >
                    ×
                  </button>
                </span>
              </>
            )}
          </li>
        ))}
        {teams.length === 0 && <li className={adminEmptyClass}>No teams yet.</li>}
      </ul>
    </AdminCard>
  );
}
```

For `TeamMembersSection.tsx`: same states/handlers with `renameTeamMember` / `deleteTeamMember`, aria labels `rename member ${m.id}` / `new name for member ${m.id}`, error copy "…the member.", and the rename input replaces only the name/team-badge span (the badge hides while editing). Keep the existing add-row (name + team select) untouched.

For `PlanningIntervalsSection.tsx`: same with `renamePlanningInterval` / `deletePlanningInterval`, aria labels `rename planning interval ${p.id}` / `new name for planning interval ${p.id}`, error copy "…the planning interval.".

- [ ] **Step 4: Run the full frontend suite + type-check**

`cd frontend && npx vitest run && npx tsc --noEmit`
Expected: **177 passed** (172 + 4 TeamsSection + 1 PlanningIntervals), tsc clean.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/admin/TeamsSection.tsx frontend/src/components/admin/TeamMembersSection.tsx frontend/src/components/admin/PlanningIntervalsSection.tsx frontend/src/components/admin/TeamsSection.test.tsx frontend/src/components/admin/PlanningIntervalsSection.test.tsx
git commit -m "feat(frontend): inline master-data renames + usage-guarded deletes in Admin"
```

---

### Task 6: Deploy + end-to-end smoke

**Files:** none (deploy + verification only)

- [ ] **Step 1: Rebuild + migrate**

```bash
docker compose up -d --build backend frontend
docker compose exec -T backend alembic current   # expect: 0012 (head)
```

- [ ] **Step 2: Curl smoke through nginx**

```bash
curl -s -c /tmp/ri-cookies -X POST localhost:8080/api/auth/login \
  -H 'Content-Type: application/json' -d '{"email":"admin@example.com","password":"admin"}' -o /dev/null -w "login: %{http_code}\n"
TEAM=$(curl -s -b /tmp/ri-cookies -X POST localhost:8080/api/teams -H 'Content-Type: application/json' -d '{"name":"RI Smoke"}' | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
ITEM=$(curl -s -b /tmp/ri-cookies -X POST localhost:8080/api/items -H 'Content-Type: application/json' -d '{"kind":"feature","title":"RI smoke item","leading_team":"RI Smoke"}' | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
curl -s -b /tmp/ri-cookies -X PATCH localhost:8080/api/teams/$TEAM -H 'Content-Type: application/json' -d '{"name":"RI Smoke 2"}' -o /dev/null -w "rename: %{http_code}\n"
curl -s -b /tmp/ri-cookies localhost:8080/api/items/$ITEM | python3 -c "import sys,json; print('propagated:', json.load(sys.stdin)['leading_team'])"
curl -s -b /tmp/ri-cookies -X DELETE localhost:8080/api/teams/$TEAM -w "guard: %{http_code} " -o /tmp/ri-guard; python3 -c "import json; print(json.load(open('/tmp/ri-guard'))['detail'])"
curl -s -b /tmp/ri-cookies -X DELETE "localhost:8080/api/teams/$TEAM?force=true" -o /dev/null -w "force: %{http_code}\n"
curl -s -b /tmp/ri-cookies "localhost:8080/api/audit?q=renamed" | python3 -c "import sys,json; print('renamed events:', json.load(sys.stdin)['total'])"
curl -s -b /tmp/ri-cookies -X DELETE localhost:8080/api/items/$ITEM -o /dev/null -w "cleanup item: %{http_code}\n"
rm -f /tmp/ri-cookies /tmp/ri-guard
```

Expected: login 200; rename 200; `propagated: RI Smoke 2`; guard 409 with `Team 'RI Smoke 2' is referenced by 1 items`; force 204; renamed events ≥ 1; cleanup 204.

- [ ] **Step 3: Browser check** (controller, via Playwright): Admin page — rename a planning interval inline (✎ → input → Save) and see the list refresh; delete a team that's in use and see the confirm dialog with the usage count.

- [ ] **Step 4: Commit** — nothing to commit unless smoke revealed fixes.

---

## Self-Review Notes

- **Spec coverage:** rename endpoints ×3 with exact strings (T2/T3); lane kind-scoped propagation (T3); delete guards with exact counted messages + force (T2/T3); one `*.renamed` audit event, no per-item events (T2/T3 tests assert `item.updated == []`); migration 0012 with drop/indexes/CHECK/NOT-NULL + downgrade (T1); model/migration parity via `index=True` + `CheckConstraint` (T1); schemas/audit/csv scrub (T1); ConflictError + client fns + types scrub (T4); admin inline rename + confirm-force flow + added error line (T5); deploy/smoke (T6). Spec scope guards are omissions.
- **Type consistency:** `TeamUpdate`/`TeamMemberUpdate`/`PlanningIntervalUpdate` names match between schemas and router imports; client fn names in T5 match T4's Produces block; `ConflictError.detail` used by T5's confirm.
- **Count math:** backend 145 → T1 +3 = 148 → T2 +4 = 152 → T3 +6 = 158. Frontend 168 → T4 +4 = 172 → T5 +5 = 177.
- **Known trade-offs:** guard counts use live queries (no snapshot race protection — P2 adds versioning); `iteration=7` CHECK test relies on SQLite enforcing named CHECK constraints from `create_all` (it does); the lane test uses the Risks board's "New" lane precisely because both default boards share it; `execution_options(synchronize_session=False)` means in-session Item instances are not refreshed after propagation — tests re-fetch via the API, and endpoints return the renamed master row, not items.
- **Fixed during self-review:** Task 2 Step 4 originally said 154; the file has exactly 4 tests → correct expectation is **152** (Global Constraints updated to 148 → 152 → 158).
- **Fixed after Task 1 review (Critical):** migration 0001 already creates `ix_items_parent_id` and `ix_items_status` (undeclared in the model — the reverse drift direction). 0012 now creates only the four genuinely new indexes and its downgrade leaves 0001's two alone; models.py keeps `index=True` on all six for SQLite parity. Migration-authoring tasks must dry-run `alembic upgrade head` + `downgrade` against the compose Postgres, not rely on SQLite fixtures.
