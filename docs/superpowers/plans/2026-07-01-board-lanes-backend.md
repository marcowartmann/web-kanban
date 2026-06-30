# Configurable Board Lanes — Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `boards` and `lanes` tables with a CRUD API (list+seed defaults, add/rename/delete lane, reorder lanes), and retire the old status-grouped `/api/board` endpoint.

**Architecture:** Two new tables — `boards` (name, CSV `kinds`, position) and `lanes` (board_id FK cascade, name, position, unique per board). Two default boards are seeded lazily on the first `GET /api/boards`. Board rendering itself moves to the frontend (this plan only provides config + CRUD).

**Tech Stack:** FastAPI, SQLAlchemy 2.0, Pydantic v2, Alembic. Tests run on SQLite via the existing `conftest` fixtures.

## Global Constraints

- Python 3.14+; SQLAlchemy 2.0 declarative (`Mapped`/`mapped_column`); Pydantic v2.
- All API routes prefixed `/api`.
- `boards.name` unique not null; `boards.kinds` is a CSV text column (e.g. `"feature,story"`); `lanes` unique on `(board_id, name)`; `lanes.board_id` FK → `boards.id` `ON DELETE CASCADE`.
- Default boards seeded lazily (only when zero boards exist), idempotent: `Features & Stories` (kinds `feature,story`, lanes `Funnel, Analyzing, New`); `Risks` (kinds `risk`, lanes `New, Analyzing, Resolved`).
- `Unscheduled` is a reserved virtual lane name — never stored; reject add/rename to it.
- The old `GET /api/board` router and `tests/test_api_board.py` are removed.
- Backend tests run on SQLite (`conftest` `client`/`db_session` fixtures); prod uses Postgres via Alembic.

---

### Task 1: Board & Lane models + schemas

**Files:**
- Modify: `backend/app/models.py`
- Modify: `backend/app/schemas.py`
- Create: `backend/tests/test_board_models.py`

**Interfaces:**
- Produces: `app.models.Board` (`id, name, kinds, position, created_at, lanes`), `app.models.Lane` (`id, board_id, name, position, created_at, board`); schemas `LaneRead`, `BoardRead`, `LaneCreate`, `LaneUpdate`, `LaneOrder`.

- [ ] **Step 1: Write the failing test** — `backend/tests/test_board_models.py`

```python
from app.models import Board, Lane


def test_board_has_ordered_lanes(db_session):
    board = Board(name="Main", kinds="feature,story", position=0)
    board.lanes.append(Lane(name="Analyzing", position=1))
    board.lanes.append(Lane(name="Funnel", position=0))
    db_session.add(board)
    db_session.commit()
    loaded = db_session.get(Board, board.id)
    assert [lane.name for lane in loaded.lanes] == ["Funnel", "Analyzing"]


def test_deleting_board_cascades_to_lanes(db_session):
    board = Board(name="Main", kinds="risk", position=0)
    board.lanes.append(Lane(name="New", position=0))
    db_session.add(board)
    db_session.commit()
    db_session.delete(board)
    db_session.commit()
    assert db_session.query(Lane).count() == 0
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && . .venv/bin/activate && pytest tests/test_board_models.py -q`
Expected: FAIL — `ImportError: cannot import name 'Board'`.

- [ ] **Step 3: Append models to `backend/app/models.py`**

Add `UniqueConstraint` to the existing `from sqlalchemy import ...` line, then append:

```python
class Board(Base):
    __tablename__ = "boards"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(128), unique=True)
    kinds: Mapped[str] = mapped_column(String(128))  # CSV, e.g. "feature,story"
    position: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())

    lanes: Mapped[list["Lane"]] = relationship(
        back_populates="board",
        cascade="all, delete-orphan",
        order_by="Lane.position",
    )


class Lane(Base):
    __tablename__ = "lanes"
    __table_args__ = (UniqueConstraint("board_id", "name", name="uq_lane_board_name"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    board_id: Mapped[int] = mapped_column(
        ForeignKey("boards.id", ondelete="CASCADE")
    )
    name: Mapped[str] = mapped_column(String(128))
    position: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())

    board: Mapped["Board"] = relationship(back_populates="lanes")
```

- [ ] **Step 4: Append schemas to `backend/app/schemas.py`**

```python
class LaneRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    position: int


class BoardRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    kinds: list[str]
    position: int
    lanes: list[LaneRead]

    @field_validator("kinds", mode="before")
    @classmethod
    def _split_csv_kinds(cls, value: object) -> object:
        if isinstance(value, str):
            return [k for k in value.split(",") if k]
        return value


class LaneCreate(BaseModel):
    name: str


class LaneUpdate(BaseModel):
    name: str


class LaneOrder(BaseModel):
    lane_ids: list[int]
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && . .venv/bin/activate && pytest tests/test_board_models.py -q`
Expected: PASS — both tests.

- [ ] **Step 6: Commit**

```bash
git add backend/app/models.py backend/app/schemas.py backend/tests/test_board_models.py
git commit -m "feat(backend): add Board/Lane models and schemas"
```

---

### Task 2: GET /api/boards with default seeding; retire old /api/board

**Files:**
- Create: `backend/app/routers/boards.py`
- Modify: `backend/app/main.py`
- Delete: `backend/app/routers/board.py`
- Delete: `backend/tests/test_api_board.py`
- Create: `backend/tests/test_api_boards.py`

**Interfaces:**
- Consumes: `Board`, `Lane`, `BoardRead`, `LaneRead`, `get_db`.
- Produces: `GET /api/boards` (seeds defaults when empty); module helpers `_ensure_defaults(db)`, `_to_read(board)`. (Lane-mutation endpoints are added in Tasks 3–4 to this same router.)

- [ ] **Step 1: Write the failing test** — `backend/tests/test_api_boards.py`

```python
def test_lists_and_seeds_default_boards(client):
    boards = client.get("/api/boards").json()
    assert [b["name"] for b in boards] == ["Features & Stories", "Risks"]
    fs = boards[0]
    assert fs["kinds"] == ["feature", "story"]
    assert [lane["name"] for lane in fs["lanes"]] == ["Funnel", "Analyzing", "New"]
    risks = boards[1]
    assert risks["kinds"] == ["risk"]
    assert [lane["name"] for lane in risks["lanes"]] == ["New", "Analyzing", "Resolved"]


def test_seeding_is_idempotent(client):
    first = client.get("/api/boards").json()
    second = client.get("/api/boards").json()
    assert len(first) == 2 and len(second) == 2
    assert [b["id"] for b in first] == [b["id"] for b in second]
```

- [ ] **Step 2: Delete the old board endpoint + its test**

Run:
```bash
cd backend && rm app/routers/board.py tests/test_api_board.py
```

- [ ] **Step 3: Remove the old board router from `backend/app/main.py`**

Delete the `from app.routers import board` import and the `app.include_router(board.router)` line.

- [ ] **Step 4: Run test to verify it fails**

Run: `cd backend && . .venv/bin/activate && pytest tests/test_api_boards.py -q`
Expected: FAIL — 404 on `/api/boards` (router not created yet).

- [ ] **Step 5: Create `backend/app/routers/boards.py`**

```python
from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Board, Lane
from app.schemas import BoardRead, LaneRead

router = APIRouter(prefix="/api", tags=["boards"])

_DEFAULT_BOARDS = [
    ("Features & Stories", "feature,story", 0, ["Funnel", "Analyzing", "New"]),
    ("Risks", "risk", 1, ["New", "Analyzing", "Resolved"]),
]


def _ensure_defaults(db: Session) -> None:
    if db.scalar(select(Board.id).limit(1)) is not None:
        return
    for name, kinds, position, lane_names in _DEFAULT_BOARDS:
        board = Board(name=name, kinds=kinds, position=position)
        db.add(board)
        db.flush()
        for index, lane_name in enumerate(lane_names):
            db.add(Lane(board_id=board.id, name=lane_name, position=index))
    db.commit()


def _to_read(board: Board) -> BoardRead:
    return BoardRead(
        id=board.id,
        name=board.name,
        kinds=[k for k in board.kinds.split(",") if k],
        position=board.position,
        lanes=[LaneRead.model_validate(lane) for lane in board.lanes],
    )


@router.get("/boards", response_model=list[BoardRead])
def list_boards(db: Session = Depends(get_db)) -> list[BoardRead]:
    _ensure_defaults(db)
    boards = db.scalars(select(Board).order_by(Board.position))
    return [_to_read(board) for board in boards]
```

- [ ] **Step 6: Register the router in `backend/app/main.py`**

```python
from app.routers import boards

app.include_router(boards.router)
```

- [ ] **Step 7: Run test to verify it passes; then the full suite**

Run: `cd backend && . .venv/bin/activate && pytest tests/test_api_boards.py -q && pytest -q`
Expected: PASS — boards tests, and the full suite (with the old board tests removed).

- [ ] **Step 8: Commit**

```bash
git add backend/app/routers/boards.py backend/app/main.py
git add -u backend/app/routers/board.py backend/tests/test_api_board.py
git commit -m "feat(backend): GET /api/boards with seeded defaults; remove /api/board"
```

---

### Task 3: Lane add / rename / delete endpoints

**Files:**
- Modify: `backend/app/routers/boards.py`
- Create: `backend/tests/test_api_lanes.py`

**Interfaces:**
- Consumes: `Board`, `Lane`, `LaneCreate`, `LaneUpdate`, `LaneRead`.
- Produces: `POST /api/boards/{board_id}/lanes`, `PATCH /api/lanes/{lane_id}`, `DELETE /api/lanes/{lane_id}`.

- [ ] **Step 1: Write the failing test** — `backend/tests/test_api_lanes.py`

```python
def _board_id(client):
    return client.get("/api/boards").json()[0]["id"]


def test_add_lane_appends_at_end(client):
    bid = _board_id(client)
    resp = client.post(f"/api/boards/{bid}/lanes", json={"name": "Done"})
    assert resp.status_code == 201
    assert resp.json()["name"] == "Done"
    lanes = client.get("/api/boards").json()[0]["lanes"]
    assert [lane["name"] for lane in lanes] == ["Funnel", "Analyzing", "New", "Done"]


def test_add_duplicate_lane_returns_409(client):
    bid = _board_id(client)
    assert client.post(f"/api/boards/{bid}/lanes", json={"name": "Funnel"}).status_code == 409


def test_add_reserved_unscheduled_returns_409(client):
    bid = _board_id(client)
    assert client.post(f"/api/boards/{bid}/lanes", json={"name": "Unscheduled"}).status_code == 409


def test_add_lane_missing_board_returns_404(client):
    assert client.post("/api/boards/999/lanes", json={"name": "X"}).status_code == 404


def test_rename_lane(client):
    bid = _board_id(client)
    lane_id = client.get("/api/boards").json()[0]["lanes"][0]["id"]
    resp = client.patch(f"/api/lanes/{lane_id}", json={"name": "Backlog"})
    assert resp.status_code == 200 and resp.json()["name"] == "Backlog"


def test_rename_to_existing_name_returns_409(client):
    bid = _board_id(client)
    lane_id = client.get("/api/boards").json()[0]["lanes"][0]["id"]
    assert client.patch(f"/api/lanes/{lane_id}", json={"name": "Analyzing"}).status_code == 409


def test_delete_lane(client):
    bid = _board_id(client)
    lane_id = client.get("/api/boards").json()[0]["lanes"][2]["id"]
    assert client.delete(f"/api/lanes/{lane_id}").status_code == 204
    names = [lane["name"] for lane in client.get("/api/boards").json()[0]["lanes"]]
    assert names == ["Funnel", "Analyzing"]


def test_delete_missing_lane_returns_404(client):
    assert client.delete("/api/lanes/999").status_code == 404
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && . .venv/bin/activate && pytest tests/test_api_lanes.py -q`
Expected: FAIL — 405/404 (endpoints not defined).

- [ ] **Step 3: Add the endpoints to `backend/app/routers/boards.py`**

Update the imports at the top of the file:
```python
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select

from app.schemas import BoardRead, LaneCreate, LaneRead, LaneUpdate
```
Append:
```python
_RESERVED_LANE = "Unscheduled"


def _name_taken(db: Session, board_id: int, name: str) -> bool:
    return db.scalar(
        select(Lane).where(Lane.board_id == board_id, Lane.name == name)
    ) is not None


@router.post("/boards/{board_id}/lanes", response_model=LaneRead, status_code=201)
def add_lane(board_id: int, payload: LaneCreate, db: Session = Depends(get_db)) -> Lane:
    if db.get(Board, board_id) is None:
        raise HTTPException(status_code=404, detail="Board not found")
    if payload.name == _RESERVED_LANE:
        raise HTTPException(status_code=409, detail="'Unscheduled' is reserved")
    if _name_taken(db, board_id, payload.name):
        raise HTTPException(status_code=409, detail="Lane already exists on this board")
    max_pos = db.scalar(
        select(func.max(Lane.position)).where(Lane.board_id == board_id)
    )
    lane = Lane(
        board_id=board_id,
        name=payload.name,
        position=0 if max_pos is None else max_pos + 1,
    )
    db.add(lane)
    db.commit()
    db.refresh(lane)
    return lane


@router.patch("/lanes/{lane_id}", response_model=LaneRead)
def rename_lane(lane_id: int, payload: LaneUpdate, db: Session = Depends(get_db)) -> Lane:
    lane = db.get(Lane, lane_id)
    if lane is None:
        raise HTTPException(status_code=404, detail="Lane not found")
    if payload.name == _RESERVED_LANE:
        raise HTTPException(status_code=409, detail="'Unscheduled' is reserved")
    if payload.name != lane.name and _name_taken(db, lane.board_id, payload.name):
        raise HTTPException(status_code=409, detail="Lane already exists on this board")
    lane.name = payload.name
    db.commit()
    db.refresh(lane)
    return lane


@router.delete("/lanes/{lane_id}", status_code=204)
def delete_lane(lane_id: int, db: Session = Depends(get_db)) -> None:
    lane = db.get(Lane, lane_id)
    if lane is None:
        raise HTTPException(status_code=404, detail="Lane not found")
    db.delete(lane)
    db.commit()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && . .venv/bin/activate && pytest tests/test_api_lanes.py -q`
Expected: PASS — all eight tests.

- [ ] **Step 5: Commit**

```bash
git add backend/app/routers/boards.py backend/tests/test_api_lanes.py
git commit -m "feat(backend): add/rename/delete lane endpoints"
```

---

### Task 4: Lane reorder endpoint

**Files:**
- Modify: `backend/app/routers/boards.py`
- Create: `backend/tests/test_api_lane_order.py`

**Interfaces:**
- Consumes: `Board`, `Lane`, `LaneOrder`, `LaneRead`.
- Produces: `PUT /api/boards/{board_id}/lanes/order`.

- [ ] **Step 1: Write the failing test** — `backend/tests/test_api_lane_order.py`

```python
def _fs_board(client):
    return client.get("/api/boards").json()[0]


def test_reorder_lanes_persists_new_order(client):
    board = _fs_board(client)
    ids = [lane["id"] for lane in board["lanes"]]  # [Funnel, Analyzing, New]
    new_order = [ids[2], ids[0], ids[1]]           # [New, Funnel, Analyzing]
    resp = client.put(f"/api/boards/{board['id']}/lanes/order", json={"lane_ids": new_order})
    assert resp.status_code == 200
    assert [lane["name"] for lane in resp.json()] == ["New", "Funnel", "Analyzing"]
    refetched = client.get("/api/boards").json()[0]["lanes"]
    assert [lane["name"] for lane in refetched] == ["New", "Funnel", "Analyzing"]


def test_reorder_with_wrong_ids_returns_422(client):
    board = _fs_board(client)
    ids = [lane["id"] for lane in board["lanes"]]
    assert client.put(
        f"/api/boards/{board['id']}/lanes/order", json={"lane_ids": ids[:2]}
    ).status_code == 422


def test_reorder_missing_board_returns_404(client):
    assert client.put("/api/boards/999/lanes/order", json={"lane_ids": []}).status_code == 404
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && . .venv/bin/activate && pytest tests/test_api_lane_order.py -q`
Expected: FAIL — 405/404.

- [ ] **Step 3: Add the endpoint to `backend/app/routers/boards.py`**

Add `LaneOrder` to the schemas import line, then append:
```python
@router.put("/boards/{board_id}/lanes/order", response_model=list[LaneRead])
def reorder_lanes(
    board_id: int, payload: LaneOrder, db: Session = Depends(get_db)
) -> list[Lane]:
    if db.get(Board, board_id) is None:
        raise HTTPException(status_code=404, detail="Board not found")
    lanes = {
        lane.id: lane
        for lane in db.scalars(select(Lane).where(Lane.board_id == board_id))
    }
    if set(payload.lane_ids) != set(lanes) or len(payload.lane_ids) != len(lanes):
        raise HTTPException(
            status_code=422, detail="lane_ids must match the board's lanes exactly"
        )
    for position, lane_id in enumerate(payload.lane_ids):
        lanes[lane_id].position = position
    db.commit()
    return list(
        db.scalars(
            select(Lane).where(Lane.board_id == board_id).order_by(Lane.position)
        )
    )
```

- [ ] **Step 4: Run test to verify it passes; then full suite**

Run: `cd backend && . .venv/bin/activate && pytest tests/test_api_lane_order.py -q && pytest -q`
Expected: PASS — reorder tests and the whole backend suite.

- [ ] **Step 5: Commit**

```bash
git add backend/app/routers/boards.py backend/tests/test_api_lane_order.py
git commit -m "feat(backend): reorder lanes endpoint"
```

---

### Task 5: Alembic migration 0003

**Files:**
- Create: `backend/alembic/versions/0003_boards_lanes.py`

**Interfaces:**
- Produces: a migration creating `boards` and `lanes` matching the models, chained after `0002`.

- [ ] **Step 1: Create `backend/alembic/versions/0003_boards_lanes.py`**

```python
"""create boards and lanes

Revision ID: 0003
Revises: 0002
"""
from alembic import op
import sqlalchemy as sa

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "boards",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("name", sa.String(128), nullable=False, unique=True),
        sa.Column("kinds", sa.String(128), nullable=False),
        sa.Column("position", sa.Integer, nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now(),
                  nullable=False),
    )
    op.create_table(
        "lanes",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("board_id", sa.Integer,
                  sa.ForeignKey("boards.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(128), nullable=False),
        sa.Column("position", sa.Integer, nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now(),
                  nullable=False),
        sa.UniqueConstraint("board_id", "name", name="uq_lane_board_name"),
    )
    op.create_index("ix_lanes_board_id", "lanes", ["board_id"])


def downgrade() -> None:
    op.drop_table("lanes")
    op.drop_table("boards")
```

- [ ] **Step 2: Verify offline SQL generation**

Run: `cd backend && . .venv/bin/activate && alembic upgrade head --sql`
Expected: output includes `CREATE TABLE boards (` and `CREATE TABLE lanes (` with the `board_id` FK to `boards` and the unique constraint; no error.

- [ ] **Step 3: Confirm the suite still passes**

Run: `cd backend && . .venv/bin/activate && pytest -q`
Expected: PASS — full backend suite (tests use SQLite `create_all`, not Alembic).

- [ ] **Step 4: Commit**

```bash
git add backend/alembic/versions/0003_boards_lanes.py
git commit -m "feat(backend): alembic migration for boards and lanes"
```

---

## Self-Review Notes

- **Spec coverage:** tables/model → Task 1; GET boards + lazy seed + retire `/api/board` → Task 2; lane add/rename/delete (incl reserved `Unscheduled`, 404/409) → Task 3; reorder (422 on mismatched ids) → Task 4; migration → Task 5; cascade delete → Task 1. Board create/delete UI correctly absent (out of scope).
- **Type consistency:** `Board`/`Lane`, `BoardRead`/`LaneRead`/`LaneCreate`/`LaneUpdate`/`LaneOrder`, and helper names (`_ensure_defaults`, `_to_read`, `_name_taken`, `_RESERVED_LANE`) are used identically across tasks.
- **Frontend** consumes these endpoints; see `2026-07-01-board-lanes-frontend.md`.
