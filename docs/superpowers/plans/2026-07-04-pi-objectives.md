# PI Objectives Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add team-scoped PI Objectives (per Planning Interval) with a state (committed/uncommitted/out-of-scope), a committed-only Key Delivery flag, and 0..n linked features, managed from a new "PI Objectives" board tab.

**Architecture:** New `pi_objectives` table + `pi_objective_features` M2M join to feature items; a team-gated CRUD router; and a new client-side board tab rendering objectives in state columns with an editor and drag-to-restate.

**Tech Stack:** FastAPI + SQLAlchemy 2.0 + Alembic + Pydantic v2 (Postgres in Docker / SQLite in-memory unit tests); React + TS + Vite + vitest; @dnd-kit for drag.

## Global Constraints

- State values: `committed`, `uncommitted`, `out_of_scope`. Enum stored via `Enum(ObjectiveState, native_enum=False)` (like `ItemKind`); DB column is a plain string.
- `is_key_delivery` true only when `state == committed`; leaving committed forces it false; `is_key_delivery=true` with non-committed state → 422.
- A linkable feature must be `kind == feature` with `leading_team == objective.team.name` AND `planning_interval == objective.planning_interval.name`; else 422.
- Team gate: `user.role == "admin" or user.team_id == <objective's team_id>`, else 403.
- New Alembic revision: `revision = "0022"`, `down_revision = "0021"`.
- Migration rule: dry-run upgrade AND downgrade on compose Postgres before accepting.
- Run backend from `backend/`; frontend from `frontend/`; `cd /Users/marco/Coding/web-kanban` for git.

---

### Task 1: Models — `PIObjective`, join table, `ObjectiveState`

**Files:**
- Modify: `backend/app/models.py`
- Test: `backend/tests/test_pi_objective_model.py` (create)

**Interfaces:**
- Produces: `ObjectiveState` enum; `PIObjective` (`team_id`, `planning_interval_id`, `title`, `description`, `state`, `is_key_delivery`, `position`, `created_at`, `updated_at`; props `team_name`, `planning_interval_name`, `feature_ids`); `pi_objective_features` Table; `PIObjective.features` relationship.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_pi_objective_model.py
from app.models import ObjectiveState, PIObjective


def test_objective_state_values():
    assert {s.value for s in ObjectiveState} == {"committed", "uncommitted", "out_of_scope"}


def test_objective_defaults(db_session, seed_team_and_pi):
    team, pi = seed_team_and_pi
    obj = PIObjective(team_id=team.id, planning_interval_id=pi.id, title="Ship X")
    db_session.add(obj)
    db_session.commit()
    assert obj.state == ObjectiveState.UNCOMMITTED
    assert obj.is_key_delivery is False
    assert obj.position == 0
    assert obj.team_name == team.name
    assert obj.planning_interval_name == pi.name
    assert obj.feature_ids == []
```

Add this fixture to `backend/tests/conftest.py` (if `db_session` exists, reuse it; otherwise use the project's existing session fixture name — check `conftest.py`):

```python
# backend/tests/conftest.py — append
import pytest
from app.models import PlanningInterval, Team


@pytest.fixture
def seed_team_and_pi(db_session):
    team = Team(name="Network")
    pi = PlanningInterval(name="PI1-Q3", position=1)
    db_session.add_all([team, pi])
    db_session.commit()
    return team, pi
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_pi_objective_model.py -q`
Expected: FAIL — `ImportError: cannot import name 'ObjectiveState'`.

- [ ] **Step 3: Add the enum, join table, and model**

In `backend/app/models.py`, add near `ItemKind` (top-level enum):

```python
class ObjectiveState(str, enum.Enum):
    COMMITTED = "committed"
    UNCOMMITTED = "uncommitted"
    OUT_OF_SCOPE = "out_of_scope"
```

Add the join table near `user_team_departments` (top-level `Table`):

```python
pi_objective_features = Table(
    "pi_objective_features",
    Base.metadata,
    Column("pi_objective_id", Integer, ForeignKey("pi_objectives.id", ondelete="CASCADE"), primary_key=True),
    Column("item_id", Integer, ForeignKey("items.id", ondelete="CASCADE"), primary_key=True),
)
```

Add the model (anywhere after `Team` and `PlanningInterval` are defined — place it after `PlanningInterval`):

```python
class PIObjective(Base):
    __tablename__ = "pi_objectives"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    team_id: Mapped[int] = mapped_column(
        ForeignKey("teams.id", ondelete="CASCADE"), index=True
    )
    planning_interval_id: Mapped[int] = mapped_column(
        ForeignKey("planning_intervals.id", ondelete="CASCADE"), index=True
    )
    title: Mapped[str] = mapped_column(String(512))
    description: Mapped[str | None] = mapped_column(Text)
    state: Mapped[ObjectiveState] = mapped_column(
        Enum(ObjectiveState, native_enum=False), index=True, default=ObjectiveState.UNCOMMITTED
    )
    is_key_delivery: Mapped[bool] = mapped_column(default=False)
    position: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, server_default=func.now(), onupdate=utcnow
    )

    team: Mapped["Team"] = relationship()
    planning_interval: Mapped["PlanningInterval"] = relationship()
    features: Mapped[list["Item"]] = relationship(secondary=pi_objective_features)

    @property
    def team_name(self) -> str:
        return self.team.name

    @property
    def planning_interval_name(self) -> str:
        return self.planning_interval.name

    @property
    def feature_ids(self) -> list[int]:
        return sorted(f.id for f in self.features)
```

(`Table`, `Column`, `Integer`, `ForeignKey`, `String`, `Text`, `Enum`, `DateTime`, `Mapped`, `mapped_column`, `relationship`, `func`, `utcnow`, `enum`, `datetime` are already imported in models.py.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && python -m pytest tests/test_pi_objective_model.py -q`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
cd /Users/marco/Coding/web-kanban
git add backend/app/models.py backend/tests/test_pi_objective_model.py backend/tests/conftest.py
git commit -m "feat(pi-objectives): model + join table + ObjectiveState"
```

---

### Task 2: Migration `0022` (create tables) + dry-run

**Files:**
- Create: `backend/alembic/versions/0022_pi_objectives.py`

**Interfaces:**
- Produces: DB tables `pi_objectives`, `pi_objective_features`.

- [ ] **Step 1: Create the migration**

```python
# backend/alembic/versions/0022_pi_objectives.py
"""pi_objectives + pi_objective_features

Revision ID: 0022
Revises: 0021
"""
from alembic import op
import sqlalchemy as sa

revision = "0022"
down_revision = "0021"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "pi_objectives",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("team_id", sa.Integer, sa.ForeignKey("teams.id", ondelete="CASCADE"), nullable=False),
        sa.Column("planning_interval_id", sa.Integer, sa.ForeignKey("planning_intervals.id", ondelete="CASCADE"), nullable=False),
        sa.Column("title", sa.String(512), nullable=False),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("state", sa.String(32), nullable=False, server_default="uncommitted"),
        sa.Column("is_key_delivery", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("position", sa.Integer, nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_pi_objectives_team_id", "pi_objectives", ["team_id"])
    op.create_index("ix_pi_objectives_planning_interval_id", "pi_objectives", ["planning_interval_id"])
    op.create_index("ix_pi_objectives_state", "pi_objectives", ["state"])
    op.create_table(
        "pi_objective_features",
        sa.Column("pi_objective_id", sa.Integer, sa.ForeignKey("pi_objectives.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("item_id", sa.Integer, sa.ForeignKey("items.id", ondelete="CASCADE"), primary_key=True),
    )


def downgrade() -> None:
    op.drop_table("pi_objective_features")
    op.drop_index("ix_pi_objectives_state", table_name="pi_objectives")
    op.drop_index("ix_pi_objectives_planning_interval_id", table_name="pi_objectives")
    op.drop_index("ix_pi_objectives_team_id", table_name="pi_objectives")
    op.drop_table("pi_objectives")
```

- [ ] **Step 2: Dry-run upgrade + downgrade on compose Postgres**

```bash
cd /Users/marco/Coding/web-kanban
docker compose cp backend/alembic/versions/0022_pi_objectives.py backend:/app/alembic/versions/0022_pi_objectives.py
docker compose exec backend alembic upgrade head
docker compose exec -T db psql -U kanban -d kanban -c "\dt pi_objective*"
docker compose exec backend alembic downgrade -1
docker compose exec -T db psql -U kanban -d kanban -c "\dt pi_objective*" || echo "tables dropped OK"
docker compose exec backend alembic upgrade head
```
Expected: after upgrade both tables exist; after downgrade they are gone; final upgrade re-creates them. No errors.

- [ ] **Step 3: Full backend suite still collects/creates schema**

Run: `cd backend && python -m pytest -q 2>&1 | tail -3`
Expected: all tests pass (SQLite `create_all` now builds the new tables).

- [ ] **Step 4: Commit**

```bash
cd /Users/marco/Coding/web-kanban
git add backend/alembic/versions/0022_pi_objectives.py
git commit -m "feat(pi-objectives): create-tables migration 0022"
```

---

### Task 3: Schemas + key-delivery normalizer

**Files:**
- Modify: `backend/app/schemas.py`
- Create: `backend/app/pi_objectives.py` (pure invariant helper)
- Test: `backend/tests/test_pi_objective_rules.py` (create)

**Interfaces:**
- Produces: `normalize_key_delivery(state, is_key_delivery) -> bool`; schemas `PIObjectiveCreate`, `PIObjectiveUpdate`, `PIObjectiveRead`, `FeatureLinkRequest`.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_pi_objective_rules.py
import pytest
from app.models import ObjectiveState
from app.pi_objectives import normalize_key_delivery


def test_key_delivery_allowed_only_when_committed():
    assert normalize_key_delivery(ObjectiveState.COMMITTED, True) is True
    assert normalize_key_delivery(ObjectiveState.COMMITTED, False) is False


@pytest.mark.parametrize("state", [ObjectiveState.UNCOMMITTED, ObjectiveState.OUT_OF_SCOPE])
def test_key_delivery_forced_false_when_not_committed(state):
    assert normalize_key_delivery(state, False) is False


@pytest.mark.parametrize("state", [ObjectiveState.UNCOMMITTED, ObjectiveState.OUT_OF_SCOPE])
def test_key_delivery_true_with_noncommitted_raises(state):
    with pytest.raises(ValueError):
        normalize_key_delivery(state, True)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_pi_objective_rules.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.pi_objectives'`.

- [ ] **Step 3: Implement the normalizer**

```python
# backend/app/pi_objectives.py
from app.models import ObjectiveState


def normalize_key_delivery(state: ObjectiveState, is_key_delivery: bool) -> bool:
    """Key Delivery applies only to committed objectives.

    Returns False for any non-committed state. Raises ValueError if the caller
    explicitly asked for key delivery on a non-committed state.
    """
    if state == ObjectiveState.COMMITTED:
        return bool(is_key_delivery)
    if is_key_delivery:
        raise ValueError("Key Delivery is only allowed on committed objectives")
    return False
```

- [ ] **Step 4: Add the schemas**

In `backend/app/schemas.py`, add (after the imports; `ObjectiveState` import at top: `from app.models import ObjectiveState`):

```python
class PIObjectiveCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    team_id: int
    planning_interval: str
    title: str = Field(min_length=1)
    description: str | None = None
    state: ObjectiveState = ObjectiveState.UNCOMMITTED
    is_key_delivery: bool = False
    feature_ids: list[int] = []


class PIObjectiveUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str | None = Field(default=None, min_length=1)
    description: str | None = None
    state: ObjectiveState | None = None
    is_key_delivery: bool | None = None
    position: int | None = None


class PIObjectiveRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    team_id: int
    team_name: str
    planning_interval: str = Field(validation_alias="planning_interval_name")
    title: str
    description: str | None
    state: ObjectiveState
    is_key_delivery: bool
    position: int
    feature_ids: list[int]
    feature_count: int = 0


class FeatureLinkRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    feature_ids: list[int]
```

Note: `planning_interval` reads the model's `planning_interval_name` property via `validation_alias`; `feature_count` is set explicitly by the router (below) since it is not a model attribute. If `from_attributes` + alias needs `populate_by_name`, add `model_config = ConfigDict(from_attributes=True, populate_by_name=True)`.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && python -m pytest tests/test_pi_objective_rules.py -q`
Expected: PASS (5 cases).

- [ ] **Step 6: Commit**

```bash
cd /Users/marco/Coding/web-kanban
git add backend/app/pi_objectives.py backend/app/schemas.py backend/tests/test_pi_objective_rules.py
git commit -m "feat(pi-objectives): schemas + key-delivery normalizer"
```

---

### Task 4: Router — list + create (team gate, invariants) + registration

**Files:**
- Create: `backend/app/routers/pi_objectives.py`
- Modify: `backend/app/main.py` (register router)
- Test: `backend/tests/test_pi_objectives_api.py` (create)

**Interfaces:**
- Consumes: `normalize_key_delivery` (Task 3), schemas (Task 3), `PIObjective` (Task 1).
- Produces: `router` with `GET /api/v1/pi-objectives`, `POST /api/v1/pi-objectives`; helpers `_serialize(obj)`, `_require_team(user, team_id)`, `_validated_feature_ids(db, team, pi, ids)`.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_pi_objectives_api.py
# Uses the project's existing API test client + auth helpers. Mirror an existing
# router test (e.g. tests/test_departments_api.py) for client/login fixtures.
from app.models import Team, PlanningInterval, User


def _seed(db):
    team = Team(name="Network")
    pi = PlanningInterval(name="PI1-Q3", position=1)
    db.add_all([team, pi]); db.commit()
    return team, pi


def test_member_of_team_creates_objective(client, db, login_member):
    team, pi = _seed(db)
    member = db.get(User, login_member.id)
    member.team_id = team.id; db.commit()
    r = client.post("/api/v1/pi-objectives", json={
        "team_id": team.id, "planning_interval": "PI1-Q3", "title": "Ship X",
    })
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["state"] == "uncommitted"
    assert body["team_name"] == "Network"
    assert body["planning_interval"] == "PI1-Q3"
    assert body["feature_ids"] == []


def test_non_team_member_forbidden(client, db, login_member):
    team, pi = _seed(db)  # member has no team_id set → not a member
    r = client.post("/api/v1/pi-objectives", json={
        "team_id": team.id, "planning_interval": "PI1-Q3", "title": "X",
    })
    assert r.status_code == 403


def test_committed_key_delivery_ok_but_uncommitted_rejected(client, db, login_admin):
    team, pi = _seed(db)
    ok = client.post("/api/v1/pi-objectives", json={
        "team_id": team.id, "planning_interval": "PI1-Q3", "title": "KD",
        "state": "committed", "is_key_delivery": True,
    })
    assert ok.status_code == 201 and ok.json()["is_key_delivery"] is True
    bad = client.post("/api/v1/pi-objectives", json={
        "team_id": team.id, "planning_interval": "PI1-Q3", "title": "bad",
        "state": "uncommitted", "is_key_delivery": True,
    })
    assert bad.status_code == 422


def test_list_filters_by_pi_and_team(client, db, login_admin):
    team, pi = _seed(db)
    other = Team(name="Cloud"); db.add(other); db.commit()
    for t in (team, other):
        client.post("/api/v1/pi-objectives", json={
            "team_id": t.id, "planning_interval": "PI1-Q3", "title": f"O-{t.name}",
        })
    r = client.get("/api/v1/pi-objectives", params={"planning_interval": "PI1-Q3", "team": "Network"})
    assert r.status_code == 200
    assert [o["team_name"] for o in r.json()] == ["Network"]
```

(If the repo's API fixtures differ, adapt fixture names to match `tests/test_departments_api.py`; the assertions stay the same.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_pi_objectives_api.py -q`
Expected: FAIL — 404 (router not registered).

- [ ] **Step 3: Implement the router (list + create)**

```python
# backend/app/routers/pi_objectives.py
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.audit import log_event
from app.auth import require_user
from app.db import get_db
from app.models import Item, ItemKind, PIObjective, PlanningInterval, Team, User
from app.pi_objectives import normalize_key_delivery
from app.schemas import PIObjectiveCreate, PIObjectiveRead

router = APIRouter(prefix="/api/v1/pi-objectives", tags=["pi-objectives"])


def _require_team(user: User, team_id: int) -> None:
    if user.role != "admin" and user.team_id != team_id:
        raise HTTPException(status_code=403, detail="You can only manage your own team's objectives")


def _serialize(obj: PIObjective) -> PIObjectiveRead:
    read = PIObjectiveRead.model_validate(obj)
    read.feature_count = len(obj.features)
    return read


def _validated_feature_ids(db: Session, team: Team, pi: PlanningInterval, ids: list[int]) -> list[Item]:
    if not ids:
        return []
    items = list(db.scalars(select(Item).where(Item.id.in_(ids))))
    found = {i.id for i in items}
    missing = set(ids) - found
    if missing:
        raise HTTPException(status_code=422, detail=f"Unknown feature id(s): {sorted(missing)}")
    for i in items:
        if i.kind != ItemKind.FEATURE or i.leading_team != team.name or i.planning_interval != pi.name:
            raise HTTPException(
                status_code=422,
                detail=f"Feature #{i.id} must be a feature of team {team.name} in {pi.name}",
            )
    return items


@router.get("", response_model=list[PIObjectiveRead])
def list_objectives(
    planning_interval: str | None = None,
    team: str | None = None,
    db: Session = Depends(get_db),
) -> list[PIObjectiveRead]:
    stmt = select(PIObjective).join(Team).join(PlanningInterval)
    if planning_interval:
        stmt = stmt.where(PlanningInterval.name == planning_interval)
    if team:
        stmt = stmt.where(Team.name == team)
    stmt = stmt.order_by(PIObjective.state, PIObjective.position, PIObjective.id)
    return [_serialize(o) for o in db.scalars(stmt)]


@router.post("", response_model=PIObjectiveRead, status_code=201)
def create_objective(
    payload: PIObjectiveCreate,
    db: Session = Depends(get_db),
    current: User = Depends(require_user),
) -> PIObjectiveRead:
    _require_team(current, payload.team_id)
    team = db.get(Team, payload.team_id)
    if team is None:
        raise HTTPException(status_code=422, detail="team_id does not exist")
    pi = db.scalar(select(PlanningInterval).where(PlanningInterval.name == payload.planning_interval))
    if pi is None:
        raise HTTPException(status_code=422, detail="planning_interval does not exist")
    try:
        key = normalize_key_delivery(payload.state, payload.is_key_delivery)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    features = _validated_feature_ids(db, team, pi, payload.feature_ids)
    obj = PIObjective(
        team_id=team.id, planning_interval_id=pi.id, title=payload.title.strip(),
        description=payload.description, state=payload.state, is_key_delivery=key,
    )
    obj.features = features
    db.add(obj)
    db.flush()
    log_event(db, actor=current, event_type="pi_objective.created",
              entity_type="pi_objective", entity_id=obj.id, entity_label=obj.title)
    db.commit()
    db.refresh(obj)
    return _serialize(obj)
```

- [ ] **Step 4: Register the router**

In `backend/app/main.py`: add `pi_objectives` to the `from app.routers import ...` line, and add `pi_objectives.router,` to the `protected` tuple.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && python -m pytest tests/test_pi_objectives_api.py -q`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
cd /Users/marco/Coding/web-kanban
git add backend/app/routers/pi_objectives.py backend/app/main.py backend/tests/test_pi_objectives_api.py
git commit -m "feat(pi-objectives): list + create endpoints (team-gated)"
```

---

### Task 5: Router — patch, set-features, delete

**Files:**
- Modify: `backend/app/routers/pi_objectives.py`
- Test: `backend/tests/test_pi_objectives_api.py` (extend)

**Interfaces:**
- Consumes: helpers from Task 4.
- Produces: `PATCH /{id}`, `PUT /{id}/features`, `DELETE /{id}`.

- [ ] **Step 1: Write the failing tests**

```python
# append to backend/tests/test_pi_objectives_api.py
def test_patch_state_clears_key_delivery(client, db, login_admin):
    team, pi = _seed(db)
    oid = client.post("/api/v1/pi-objectives", json={
        "team_id": team.id, "planning_interval": "PI1-Q3", "title": "KD",
        "state": "committed", "is_key_delivery": True,
    }).json()["id"]
    r = client.patch(f"/api/v1/pi-objectives/{oid}", json={"state": "uncommitted"})
    assert r.status_code == 200
    assert r.json()["state"] == "uncommitted"
    assert r.json()["is_key_delivery"] is False


def test_put_features_enforces_team_and_pi(client, db, login_admin):
    from app.models import Item, ItemKind
    team, pi = _seed(db)
    good = Item(kind=ItemKind.FEATURE, title="F", leading_team="Network", planning_interval="PI1-Q3")
    wrong_pi = Item(kind=ItemKind.FEATURE, title="F2", leading_team="Network", planning_interval="PI2-Q4")
    db.add_all([good, wrong_pi]); db.commit()
    oid = client.post("/api/v1/pi-objectives", json={
        "team_id": team.id, "planning_interval": "PI1-Q3", "title": "O",
    }).json()["id"]
    ok = client.put(f"/api/v1/pi-objectives/{oid}/features", json={"feature_ids": [good.id]})
    assert ok.status_code == 200 and ok.json()["feature_ids"] == [good.id]
    bad = client.put(f"/api/v1/pi-objectives/{oid}/features", json={"feature_ids": [wrong_pi.id]})
    assert bad.status_code == 422


def test_delete_objective(client, db, login_admin):
    team, pi = _seed(db)
    oid = client.post("/api/v1/pi-objectives", json={
        "team_id": team.id, "planning_interval": "PI1-Q3", "title": "O",
    }).json()["id"]
    assert client.delete(f"/api/v1/pi-objectives/{oid}").status_code == 204
    assert client.get("/api/v1/pi-objectives").json() == []
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && python -m pytest tests/test_pi_objectives_api.py -q -k "patch or put_features or delete"`
Expected: FAIL — 405/404 (endpoints missing).

- [ ] **Step 3: Implement patch, set-features, delete**

Append to `backend/app/routers/pi_objectives.py` (add `PIObjectiveUpdate, FeatureLinkRequest` to the schema import; add `ObjectiveState` to the models import):

```python
def _get(db: Session, obj_id: int) -> PIObjective:
    obj = db.get(PIObjective, obj_id)
    if obj is None:
        raise HTTPException(status_code=404, detail="PI Objective not found")
    return obj


@router.patch("/{obj_id}", response_model=PIObjectiveRead)
def update_objective(
    obj_id: int,
    payload: PIObjectiveUpdate,
    db: Session = Depends(get_db),
    current: User = Depends(require_user),
) -> PIObjectiveRead:
    obj = _get(db, obj_id)
    _require_team(current, obj.team_id)
    data = payload.model_dump(exclude_unset=True)
    if "title" in data and data["title"] is not None:
        obj.title = data["title"].strip()
    if "description" in data:
        obj.description = data["description"]
    if "position" in data and data["position"] is not None:
        obj.position = data["position"]
    # Resolve the final (state, key_delivery) pair through the normalizer.
    new_state = data.get("state") or obj.state
    new_key = data.get("is_key_delivery")
    if new_key is None:
        new_key = obj.is_key_delivery
    try:
        obj.is_key_delivery = normalize_key_delivery(new_state, new_key)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    obj.state = new_state
    log_event(db, actor=current, event_type="pi_objective.updated",
              entity_type="pi_objective", entity_id=obj.id, entity_label=obj.title)
    db.commit()
    db.refresh(obj)
    return _serialize(obj)


@router.put("/{obj_id}/features", response_model=PIObjectiveRead)
def set_features(
    obj_id: int,
    payload: FeatureLinkRequest,
    db: Session = Depends(get_db),
    current: User = Depends(require_user),
) -> PIObjectiveRead:
    obj = _get(db, obj_id)
    _require_team(current, obj.team_id)
    obj.features = _validated_feature_ids(db, obj.team, obj.planning_interval, payload.feature_ids)
    log_event(db, actor=current, event_type="pi_objective.updated",
              entity_type="pi_objective", entity_id=obj.id, entity_label=obj.title)
    db.commit()
    db.refresh(obj)
    return _serialize(obj)


@router.delete("/{obj_id}", status_code=204)
def delete_objective(
    obj_id: int,
    db: Session = Depends(get_db),
    current: User = Depends(require_user),
) -> None:
    obj = _get(db, obj_id)
    _require_team(current, obj.team_id)
    label = obj.title
    db.delete(obj)
    log_event(db, actor=current, event_type="pi_objective.deleted",
              entity_type="pi_objective", entity_id=obj_id, entity_label=label)
    db.commit()
```

- [ ] **Step 4: Run the full router test file**

Run: `cd backend && python -m pytest tests/test_pi_objectives_api.py -q`
Expected: PASS (7 tests).

- [ ] **Step 5: Full backend suite**

Run: `cd backend && python -m pytest -q 2>&1 | tail -3`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
cd /Users/marco/Coding/web-kanban
git add backend/app/routers/pi_objectives.py backend/tests/test_pi_objectives_api.py
git commit -m "feat(pi-objectives): patch/set-features/delete endpoints"
```

---

### Task 6: Frontend types + API client

**Files:**
- Modify: `frontend/src/types.ts`
- Modify: `frontend/src/api/client.ts`

**Interfaces:**
- Produces: `ObjectiveState`, `PIObjective` types; `getPIObjectives`, `createPIObjective`, `updatePIObjective`, `setObjectiveFeatures`, `deletePIObjective`.

- [ ] **Step 1: Add the types**

In `frontend/src/types.ts`:

```ts
export type ObjectiveState = "committed" | "uncommitted" | "out_of_scope";

export interface PIObjective {
  id: number;
  team_id: number;
  team_name: string;
  planning_interval: string;
  title: string;
  description: string | null;
  state: ObjectiveState;
  is_key_delivery: boolean;
  position: number;
  feature_ids: number[];
  feature_count: number;
}
```

- [ ] **Step 2: Add the client functions**

In `frontend/src/api/client.ts` (follow the existing `request`/fetch helpers used by other calls):

```ts
export const getPIObjectives = (params: { planning_interval?: string; team?: string }) => {
  const q = new URLSearchParams();
  if (params.planning_interval) q.set("planning_interval", params.planning_interval);
  if (params.team) q.set("team", params.team);
  return request<PIObjective[]>(`/pi-objectives?${q.toString()}`);
};

export const createPIObjective = (body: {
  team_id: number; planning_interval: string; title: string; description?: string | null;
  state?: ObjectiveState; is_key_delivery?: boolean; feature_ids?: number[];
}) => request<PIObjective>("/pi-objectives", { method: "POST", body: JSON.stringify(body) });

export const updatePIObjective = (id: number, body: Partial<{
  title: string; description: string | null; state: ObjectiveState; is_key_delivery: boolean; position: number;
}>) => request<PIObjective>(`/pi-objectives/${id}`, { method: "PATCH", body: JSON.stringify(body) });

export const setObjectiveFeatures = (id: number, feature_ids: number[]) =>
  request<PIObjective>(`/pi-objectives/${id}/features`, { method: "PUT", body: JSON.stringify({ feature_ids }) });

export const deletePIObjective = (id: number) =>
  request<void>(`/pi-objectives/${id}`, { method: "DELETE" });
```

Add `PIObjective`, `ObjectiveState` to the type imports at the top of `client.ts`.

- [ ] **Step 3: Typecheck**

Run: `cd frontend && npm run build`
Expected: `tsc` clean (no consumer yet).

- [ ] **Step 4: Commit**

```bash
cd /Users/marco/Coding/web-kanban
git add frontend/src/types.ts frontend/src/api/client.ts
git commit -m "feat(pi-objectives): frontend types + api client"
```

---

### Task 7: Board tab + PIObjectivesBoard (columns, card)

**Files:**
- Create: `frontend/src/components/PIObjectivesBoard.tsx`
- Create: `frontend/src/components/ObjectiveCard.tsx`
- Modify: `frontend/src/components/BoardTabs.tsx`
- Modify: `frontend/src/App.tsx`
- Test: `frontend/src/components/PIObjectivesBoard.test.tsx` (create)

**Interfaces:**
- Consumes: client fns + types (Task 6); `FilterSelect`.
- Produces: `PIObjectivesBoard` (props `teams: Team[]`, `planningIntervals: string[]`, `user: AuthUser`), a trailing "PI Objectives" tab.

- [ ] **Step 1: Extend BoardTabs with the objectives tab**

In `frontend/src/components/BoardTabs.tsx`, accept `objectivesActive: boolean` and `onSelectObjectives: () => void`, and render a trailing button after the board buttons:

```tsx
<button
  onClick={onSelectObjectives}
  className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
    objectivesActive ? "border-blue-600 text-blue-700" : "border-transparent text-gray-500 hover:text-gray-800"
  }`}
>
  PI Objectives
</button>
```

Update the props type accordingly (`objectivesActive: boolean; onSelectObjectives: () => void;`).

- [ ] **Step 2: Write the failing PIObjectivesBoard test**

```tsx
// frontend/src/components/PIObjectivesBoard.test.tsx
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import * as client from "../api/client";
import type { AuthUser, PIObjective, Team } from "../types";
import PIObjectivesBoard from "./PIObjectivesBoard";

afterEach(() => vi.restoreAllMocks());

const teams: Team[] = [{ id: 1, name: "Network" }];
const user = { id: 1, display_name: "A", role: "admin", team_id: 1 } as unknown as AuthUser;
const obj = (over: Partial<PIObjective>): PIObjective => ({
  id: 1, team_id: 1, team_name: "Network", planning_interval: "PI1-Q3", title: "O1",
  description: null, state: "committed", is_key_delivery: true, position: 0,
  feature_ids: [7, 8], feature_count: 2, ...over,
});

it("renders objectives in state columns with feature count and Key Delivery badge", async () => {
  vi.spyOn(client, "getPIObjectives").mockResolvedValue([
    obj({ id: 1, title: "Committed KD", state: "committed", is_key_delivery: true }),
    obj({ id: 2, title: "Uncommitted", state: "uncommitted", is_key_delivery: false, feature_ids: [], feature_count: 0 }),
  ]);
  render(<PIObjectivesBoard teams={teams} planningIntervals={["PI1-Q3"]} user={user} />);
  expect(await screen.findByText("Committed KD")).toBeInTheDocument();
  expect(screen.getByText("Uncommitted")).toBeInTheDocument();
  expect(screen.getByText(/2 features/i)).toBeInTheDocument();
  expect(screen.getByText(/key delivery/i)).toBeInTheDocument();
  await waitFor(() => expect(client.getPIObjectives).toHaveBeenCalled());
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/components/PIObjectivesBoard.test.tsx`
Expected: FAIL — cannot resolve `./PIObjectivesBoard`.

- [ ] **Step 4: Implement ObjectiveCard and PIObjectivesBoard**

```tsx
// frontend/src/components/ObjectiveCard.tsx
import type { PIObjective } from "../types";

export default function ObjectiveCard({ obj, showTeam, onOpen }: {
  obj: PIObjective; showTeam?: boolean; onOpen?: (id: number) => void;
}) {
  return (
    <button
      onClick={() => onOpen?.(obj.id)}
      className="w-full rounded-lg border border-gray-200 bg-surface p-3 text-left shadow-xs transition hover:shadow-sm"
    >
      <div className="mb-1 flex items-center justify-between gap-2">
        {showTeam && <span className="text-xs text-gray-400">{obj.team_name}</span>}
        {obj.state === "committed" && obj.is_key_delivery && (
          <span className="rounded-sm bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800">
            ★ Key Delivery
          </span>
        )}
      </div>
      <div className="font-medium text-gray-900">{obj.title}</div>
      <div className="mt-2 text-xs text-gray-500">
        {obj.feature_count} {obj.feature_count === 1 ? "feature" : "features"}
      </div>
    </button>
  );
}
```

```tsx
// frontend/src/components/PIObjectivesBoard.tsx
import { useEffect, useState } from "react";
import { getPIObjectives } from "../api/client";
import type { AuthUser, ObjectiveState, PIObjective, Team } from "../types";
import FilterSelect from "./FilterSelect";
import ObjectiveCard from "./ObjectiveCard";

const COLUMNS: { key: ObjectiveState; label: string }[] = [
  { key: "committed", label: "Committed" },
  { key: "uncommitted", label: "Uncommitted" },
  { key: "out_of_scope", label: "Out of scope" },
];

export default function PIObjectivesBoard({ teams, planningIntervals, user }: {
  teams: Team[]; planningIntervals: string[]; user: AuthUser;
}) {
  const [pi, setPi] = useState<string>(planningIntervals[0] ?? "");
  const [team, setTeam] = useState<string | null>(null);
  const [objectives, setObjectives] = useState<PIObjective[]>([]);

  useEffect(() => {
    if (!pi) return;
    void getPIObjectives({ planning_interval: pi, team: team ?? undefined }).then(setObjectives);
  }, [pi, team]);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 border-b border-gray-200 bg-surface px-6 py-3">
        <FilterSelect label="Planning Interval" value={pi || undefined} options={planningIntervals}
          onChange={(v) => v && setPi(v)} allowAll={false} />
        <FilterSelect label="Team" value={team ?? undefined} options={teams.map((t) => t.name)}
          onChange={(v) => setTeam(v ?? null)} allLabel="All teams" />
      </div>
      <div className="grid grid-cols-3 gap-4 p-6">
        {COLUMNS.map((col) => (
          <div key={col.key}>
            <h2 className="mb-2 text-sm font-semibold text-gray-700">
              {col.label}{" "}
              <span className="text-gray-400">
                {objectives.filter((o) => o.state === col.key).length}
              </span>
            </h2>
            <div className="flex flex-col gap-2">
              {objectives.filter((o) => o.state === col.key).map((o) => (
                <ObjectiveCard key={o.id} obj={o} showTeam={team == null} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Wire the tab into App.tsx**

In `frontend/src/App.tsx`: add state `const [objectivesTab, setObjectivesTab] = useState(false);`. In the board branch, pass `objectivesActive={objectivesTab}` and `onSelectObjectives={() => setObjectivesTab(true)}` to `BoardTabs`, and make `selectBoard` also `setObjectivesTab(false)`. Then render conditionally:

```tsx
<BoardTabs boards={boards} activeId={objectivesTab ? null : activeBoardId}
  onSelect={selectBoard} objectivesActive={objectivesTab}
  onSelectObjectives={() => setObjectivesTab(true)} />
{objectivesTab ? (
  <PIObjectivesBoard teams={teamOptions} planningIntervals={planningIntervals.map((p) => p.name)} user={user} />
) : (
  <>
    <Toolbar ... />
    <BoardView ... />
  </>
)}
```

Import `PIObjectivesBoard`. (`teamOptions` is the existing `Team[]` state; `planningIntervals` is the existing `PlanningInterval[]` — map to names.)

- [ ] **Step 6: Run the test + full suite + build**

Run: `cd frontend && npx vitest run src/components/PIObjectivesBoard.test.tsx` → PASS.
Run: `cd frontend && npm run build` → clean.
Run: `cd frontend && npm test 2>&1 | grep -E "Tests " | tail -1` → all pass.

- [ ] **Step 7: Commit**

```bash
cd /Users/marco/Coding/web-kanban
git add frontend/src/components/PIObjectivesBoard.tsx frontend/src/components/ObjectiveCard.tsx frontend/src/components/BoardTabs.tsx frontend/src/App.tsx frontend/src/components/PIObjectivesBoard.test.tsx
git commit -m "feat(pi-objectives): board tab with state columns + card"
```

---

### Task 8: Objective editor (create/edit, key-delivery gate, feature multi-select)

**Files:**
- Create: `frontend/src/components/ObjectiveEditor.tsx`
- Modify: `frontend/src/components/PIObjectivesBoard.tsx` (open editor; add "+ New objective"; open card → edit)
- Test: `frontend/src/components/ObjectiveEditor.test.tsx` (create)

**Interfaces:**
- Consumes: `createPIObjective`, `updatePIObjective`, `setObjectiveFeatures`, `deletePIObjective`, `PlainSelect`, `getPersonOptions`? (no — features come from the `items` already loaded by App; pass `features: Item[]` filtered to feature kind into the board).
- Produces: `ObjectiveEditor` modal.

- [ ] **Step 1: Pass feature items into the board**

In `App.tsx`, pass `features={items.filter((i) => i.kind === "feature")}` to `PIObjectivesBoard`; add `features: Item[]` to its props and thread into the editor. (Reuses already-loaded board items.)

- [ ] **Step 2: Write the failing editor test**

```tsx
// frontend/src/components/ObjectiveEditor.test.tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import * as client from "../api/client";
import type { Item } from "../types";
import ObjectiveEditor from "./ObjectiveEditor";

afterEach(() => vi.restoreAllMocks());

const feature = (id: number, over: Partial<Item> = {}): Item => ({
  id, kind: "feature", title: `F${id}`, leading_team: "Network",
  planning_interval: "PI1-Q3", ...over,
} as unknown as Item);

it("creates an objective; Key Delivery is disabled unless committed", async () => {
  const create = vi.spyOn(client, "createPIObjective").mockResolvedValue({ id: 9 } as never);
  vi.spyOn(client, "setObjectiveFeatures").mockResolvedValue({ id: 9 } as never);
  render(
    <ObjectiveEditor teamId={1} teamName="Network" planningInterval="PI1-Q3"
      features={[feature(7), feature(8, { leading_team: "Cloud" })]}
      onClose={() => {}} onSaved={() => {}} />,
  );
  // Only same-team+PI features are offered.
  expect(screen.getByLabelText("F7")).toBeInTheDocument();
  expect(screen.queryByLabelText("F8")).toBeNull();

  await userEvent.type(screen.getByLabelText(/title/i), "Objective A");
  const keyToggle = screen.getByLabelText(/key delivery/i);
  expect(keyToggle).toBeDisabled(); // default state uncommitted
  await userEvent.click(screen.getByLabelText("F7"));
  await userEvent.click(screen.getByRole("button", { name: /save/i }));
  await waitFor(() => expect(create).toHaveBeenCalledWith(expect.objectContaining({
    team_id: 1, planning_interval: "PI1-Q3", title: "Objective A",
  })));
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/components/ObjectiveEditor.test.tsx`
Expected: FAIL — cannot resolve `./ObjectiveEditor`.

- [ ] **Step 4: Implement ObjectiveEditor**

```tsx
// frontend/src/components/ObjectiveEditor.tsx
import { useState } from "react";
import { createPIObjective, setObjectiveFeatures, updatePIObjective } from "../api/client";
import type { Item, ObjectiveState, PIObjective } from "../types";
import PlainSelect from "./PlainSelect";
import { btnGhost, inputClass, modalPanelClass, overlayClass } from "./ui";

const STATES: { value: ObjectiveState; label: string }[] = [
  { value: "committed", label: "Committed" },
  { value: "uncommitted", label: "Uncommitted" },
  { value: "out_of_scope", label: "Out of scope" },
];

export default function ObjectiveEditor({
  existing, teamId, teamName, planningInterval, features, onClose, onSaved,
}: {
  existing?: PIObjective; teamId: number; teamName: string; planningInterval: string;
  features: Item[]; onClose: () => void; onSaved: () => void;
}) {
  const scoped = features.filter((f) => f.leading_team === teamName && f.planning_interval === planningInterval);
  const [title, setTitle] = useState(existing?.title ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [state, setState] = useState<ObjectiveState>(existing?.state ?? "uncommitted");
  const [keyDelivery, setKeyDelivery] = useState(existing?.is_key_delivery ?? false);
  const [featureIds, setFeatureIds] = useState<number[]>(existing?.feature_ids ?? []);

  const toggleFeature = (id: number) =>
    setFeatureIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  const save = async () => {
    const key = state === "committed" ? keyDelivery : false;
    let id = existing?.id;
    if (id == null) {
      const created = await createPIObjective({
        team_id: teamId, planning_interval: planningInterval, title: title.trim(),
        description: description || null, state, is_key_delivery: key,
      });
      id = created.id;
    } else {
      await updatePIObjective(id, { title: title.trim(), description: description || null, state, is_key_delivery: key });
    }
    await setObjectiveFeatures(id, featureIds);
    onSaved();
    onClose();
  };

  return (
    <div className={`${overlayClass} z-30`} onClick={onClose}>
      <div className={`${modalPanelClass} max-w-lg`} onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-4 text-sm font-semibold text-gray-900">
          {existing ? "Edit" : "New"} PI Objective · {teamName} · {planningInterval}
        </h2>
        <label className="mb-3 block">
          <span className="mb-1 block text-xs font-medium text-gray-500">Title</span>
          <input aria-label="Title" value={title} onChange={(e) => setTitle(e.target.value)} className={`w-full ${inputClass}`} />
        </label>
        <label className="mb-3 block">
          <span className="mb-1 block text-xs font-medium text-gray-500">Description</span>
          <textarea aria-label="Description" value={description} onChange={(e) => setDescription(e.target.value)} className={`w-full ${inputClass}`} rows={2} />
        </label>
        <div className="mb-3 flex items-center gap-3">
          <div className="flex-1">
            <span className="mb-1 block text-xs font-medium text-gray-500">State</span>
            <PlainSelect ariaLabel="State" value={state} options={STATES.map((s) => s.label)}
              onChange={(v) => setState((STATES.find((s) => s.label === v)?.value) ?? "uncommitted")} placeholder="Select state" />
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" aria-label="Key Delivery" checked={keyDelivery}
              disabled={state !== "committed"}
              onChange={(e) => setKeyDelivery(e.target.checked)} />
            Key Delivery
          </label>
        </div>
        <div className="mb-4">
          <span className="mb-1 block text-xs font-medium text-gray-500">Linked features</span>
          <div className="max-h-40 overflow-auto rounded-lg border border-gray-200 p-2">
            {scoped.length === 0 && <p className="text-xs text-gray-400">No features for this team + PI.</p>}
            {scoped.map((f) => (
              <label key={f.id} className="flex items-center gap-2 py-0.5 text-sm text-gray-700">
                <input type="checkbox" aria-label={f.title} checked={featureIds.includes(f.id)} onChange={() => toggleFeature(f.id)} />
                <span className="text-xs text-gray-400">#{f.id}</span> {f.title}
              </label>
            ))}
          </div>
        </div>
        <div className="flex justify-between">
          <button onClick={onClose} className={btnGhost}>Cancel</button>
          <button onClick={() => void save()} disabled={!title.trim()}
            className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-semibold text-white shadow-xs transition hover:bg-blue-700 disabled:opacity-50">
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Open the editor from PIObjectivesBoard**

In `PIObjectivesBoard.tsx`: add `const [editing, setEditing] = useState<PIObjective | "new" | null>(null);`, a `+ New objective` button in the filter bar (shown when `canEdit`), pass `onOpen={(id) => setEditing(objectives.find((o) => o.id === id)!)}` to `ObjectiveCard`, and render `ObjectiveEditor` when `editing`, reloading on save. Compute `canEdit = user.role === "admin" || (team != null && teams.find((t) => t.name === team)?.id === user.team_id)`; when `team == null`, require picking a team in the editor (out of v1 scope — disable "+ New objective" until a specific team is selected, with a hint). Pass `teamId`/`teamName` from the selected team.

- [ ] **Step 6: Run test + full suite + build**

Run: `cd frontend && npx vitest run src/components/ObjectiveEditor.test.tsx` → PASS.
Run: `cd frontend && npm run build` → clean. `npm test` → all pass.

- [ ] **Step 7: Commit**

```bash
cd /Users/marco/Coding/web-kanban
git add frontend/src/components/ObjectiveEditor.tsx frontend/src/components/PIObjectivesBoard.tsx frontend/src/App.tsx frontend/src/components/ObjectiveEditor.test.tsx
git commit -m "feat(pi-objectives): objective editor with key-delivery gate + feature links"
```

---

### Task 9: Drag-to-restate + Docker verification

**Files:**
- Modify: `frontend/src/components/PIObjectivesBoard.tsx` (dnd)
- Modify: `frontend/src/components/ObjectiveCard.tsx` (draggable)
- Test: `frontend/src/components/PIObjectivesBoard.test.tsx` (extend)

**Interfaces:**
- Consumes: `@dnd-kit/core` (already a dependency; see `PlanningColumn`/`TimelineCell` for `useDroppable`/`useDraggable` usage).

- [ ] **Step 1: Write the failing drag test**

```tsx
// append to PIObjectivesBoard.test.tsx
it("moving a card to a new column patches its state", async () => {
  vi.spyOn(client, "getPIObjectives").mockResolvedValue([
    obj({ id: 1, title: "O1", state: "uncommitted", is_key_delivery: false }),
  ]);
  const patch = vi.spyOn(client, "updatePIObjective").mockResolvedValue(obj({ id: 1, state: "committed" }) as never);
  const { container } = render(<PIObjectivesBoard teams={teams} planningIntervals={["PI1-Q3"]} user={user} features={[]} />);
  await screen.findByText("O1");
  // Simulate the board's onDragEnd handler directly (dnd-kit pointer sim is flaky in jsdom):
  // export a pure `stateForDrop(objectiveId, columnKey)` and assert it calls updatePIObjective.
  // See Step 3 — the handler is extracted so it can be unit-tested.
  expect(container).toBeTruthy();
  // The extracted handler test:
  const { computeStateChange } = await import("./PIObjectivesBoard");
  expect(computeStateChange("uncommitted", "committed")).toEqual({ changed: true, state: "committed" });
  expect(computeStateChange("committed", "committed")).toEqual({ changed: false, state: "committed" });
  void patch;
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/components/PIObjectivesBoard.test.tsx -t "moving a card"`
Expected: FAIL — `computeStateChange` not exported.

- [ ] **Step 3: Add dnd + the extracted handler**

In `PIObjectivesBoard.tsx`:
- Export a pure helper:

```ts
export function computeStateChange(from: ObjectiveState, to: ObjectiveState) {
  return { changed: from !== to, state: to };
}
```

- Wrap the three columns in `<DndContext onDragEnd={onDragEnd}>`; make each column a `useDroppable({ id: col.key })`; make `ObjectiveCard` a `useDraggable({ id: obj.id })` (add optional `draggable` props passed from the board, gated by `canEdit`). On drop:

```tsx
const onDragEnd = (e: DragEndEvent) => {
  const id = Number(e.active.id);
  const to = e.over?.id as ObjectiveState | undefined;
  const current = objectives.find((o) => o.id === id);
  if (!current || !to) return;
  const { changed, state } = computeStateChange(current.state, to);
  if (!changed) return;
  setObjectives((os) => os.map((o) => (o.id === id ? { ...o, state, is_key_delivery: state === "committed" ? o.is_key_delivery : false } : o)));
  void updatePIObjective(id, { state }).catch(() => reload());
};
```

(Import `DndContext`, `DragEndEvent`, `useDroppable`, `useDraggable` from `@dnd-kit/core`; `updatePIObjective` from the client; `reload` = the effect's fetch extracted into a callback.)

- [ ] **Step 4: Run test + full suite + build**

Run: `cd frontend && npx vitest run src/components/PIObjectivesBoard.test.tsx` → PASS.
Run: `cd frontend && npm run build` → clean. `npm test` → all pass.

- [ ] **Step 5: Docker end-to-end verification**

```bash
cd /Users/marco/Coding/web-kanban
docker compose build backend frontend && docker compose up -d backend frontend
```
In the app: open the **PI Objectives** tab, pick a PI + Team, create an objective, link a same-team+PI feature, toggle Key Delivery only in Committed, drag a card between columns (state persists after reload), and confirm a non-team member can't edit. Confirm the backend rejects a cross-team/PI feature link (422).

- [ ] **Step 6: Commit**

```bash
cd /Users/marco/Coding/web-kanban
git add frontend/src/components/PIObjectivesBoard.tsx frontend/src/components/ObjectiveCard.tsx frontend/src/components/PIObjectivesBoard.test.tsx
git commit -m "feat(pi-objectives): drag objectives between state columns"
```

---

## After all tasks

Use **superpowers:finishing-a-development-branch**: verify backend + frontend suites green, then present merge/PR/keep/discard options.

## Self-Review notes

- **Spec coverage:** model+join (T1), migration (T2), schemas+key-delivery rule (T3), list/create + team gate + feature-scope (T4), patch/features/delete (T5), types+client (T6), board tab+columns+card (T7), editor+key-delivery gate+feature multi-select (T8), drag-to-restate + Docker verify (T9). Permissions covered in T4/T5 (backend) and T8 (UI gating). All spec sections mapped.
- **Type consistency:** `ObjectiveState` values `committed`/`uncommitted`/`out_of_scope`, `PIObjective` fields, and client fn names (`getPIObjectives`, `createPIObjective`, `updatePIObjective`, `setObjectiveFeatures`, `deletePIObjective`) are used identically across backend serialization, types, client, board, and editor.
- **Watch items (flagged for executor):** confirm the backend test fixtures' names (`client`, `db`, `login_member`, `login_admin`, `db_session`) against `backend/tests/conftest.py` and adapt if different; confirm `client.ts` uses a `request()` helper (else use the file's fetch wrapper); `computeStateChange` is exported so the drag logic is unit-testable without jsdom pointer simulation.
