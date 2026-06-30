# SAFe Kanban Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a FastAPI + SQLAlchemy + Postgres backend that imports the `Team Planning Q3 26.csv` planning export (replace-all), stores Features/Stories/Risks in one table, and exposes a Kanban board + CRUD API.

**Architecture:** A single `items` table with a `kind` discriminator and self-referential `parent_id`. CSV import is split into pure, testable functions (decode → parse rows → build items) plus a transactional `replace_all`. A thin FastAPI layer exposes board, CRUD, and import endpoints. WSJF is recomputed on edit.

**Tech Stack:** Python 3.14+, FastAPI, SQLAlchemy 2.0, Pydantic v2, Alembic, psycopg 3, Postgres 18, pytest, httpx. Tests run against SQLite in-memory (via `Base.metadata.create_all`); production uses Postgres via Alembic.

## Global Constraints

- Python 3.14+; SQLAlchemy 2.0 declarative style (`Mapped` / `mapped_column`).
- Pydantic v2 (`model_config = ConfigDict(from_attributes=True)`).
- All API routes are prefixed `/api`.
- Item primary key is an autoincrement **integer** (SQLite-test-friendly).
- Money/score fields are `Numeric`; counts (`business_value`, `time_criticality`, `risk_reduction`) are `Integer`; all nullable except `title`, `kind`, `position`.
- The CSV `Child` column is never stored; hierarchy comes only from row position.
- `kind` values are exactly: `feature`, `story`, `risk`.
- Reference CSV lives at repo root: `Team Planning Q3 26.csv` (26 columns, UTF-8).

---

### Task 1: Backend scaffold, config, DB session, health check

**Files:**
- Create: `backend/pyproject.toml`
- Create: `backend/app/__init__.py` (empty)
- Create: `backend/app/config.py`
- Create: `backend/app/db.py`
- Create: `backend/app/main.py`
- Create: `backend/tests/__init__.py` (empty)
- Create: `backend/tests/conftest.py`
- Create: `backend/tests/test_health.py`
- Create: `backend/docker-compose.yml`
- Create: `backend/.env.example`

**Interfaces:**
- Produces: `app.db.Base` (declarative base), `app.db.get_db` (FastAPI dependency yielding a `Session`), `app.db.engine`, `app.config.settings.database_url`, `app.main.app` (FastAPI instance).

- [ ] **Step 1: Create `backend/pyproject.toml`**

```toml
[project]
name = "safe-kanban-backend"
version = "0.1.0"
requires-python = ">=3.14"
dependencies = [
    "fastapi>=0.111",
    "uvicorn[standard]>=0.30",
    "sqlalchemy>=2.0",
    "psycopg[binary]>=3.1",
    "alembic>=1.13",
    "pydantic>=2.7",
    "pydantic-settings>=2.3",
    "python-multipart>=0.0.9",
]

[project.optional-dependencies]
dev = ["pytest>=8.2", "httpx>=0.27"]

[tool.pytest.ini_options]
pythonpath = ["."]
testpaths = ["tests"]
```

- [ ] **Step 2: Create `backend/app/config.py`**

```python
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+psycopg://kanban:kanban@localhost:5432/kanban"
    cors_origins: list[str] = ["http://localhost:5173"]


settings = Settings()
```

- [ ] **Step 3: Create `backend/app/db.py`**

```python
from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import settings

engine = create_engine(settings.database_url, future=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, future=True)


class Base(DeclarativeBase):
    pass


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
```

- [ ] **Step 4: Create `backend/app/main.py`**

```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings

app = FastAPI(title="SAFe Kanban API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
```

- [ ] **Step 5: Create `backend/tests/conftest.py`** (SQLite test DB + client fixture)

```python
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db import Base, get_db
from app.main import app


@pytest.fixture()
def db_session():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
        future=True,
    )
    Base.metadata.create_all(engine)
    TestingSession = sessionmaker(bind=engine, autoflush=False, future=True)
    session = TestingSession()
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(engine)


@pytest.fixture()
def client(db_session):
    app.dependency_overrides[get_db] = lambda: db_session
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()
```

- [ ] **Step 6: Create `backend/tests/test_health.py`**

```python
def test_health_ok(client):
    resp = client.get("/api/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}
```

- [ ] **Step 7: Create `backend/docker-compose.yml`**

```yaml
services:
  db:
    image: postgres:18
    environment:
      POSTGRES_USER: kanban
      POSTGRES_PASSWORD: kanban
      POSTGRES_DB: kanban
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data

volumes:
  pgdata:
```

- [ ] **Step 8: Create `backend/.env.example`**

```
DATABASE_URL=postgresql+psycopg://kanban:kanban@localhost:5432/kanban
CORS_ORIGINS=["http://localhost:5173"]
```

- [ ] **Step 9: Install deps and run the test**

Run:
```bash
cd backend && python -m venv .venv && . .venv/bin/activate && pip install -e ".[dev]" && pytest tests/test_health.py -v
```
Expected: PASS — `test_health_ok`.

- [ ] **Step 10: Commit**

```bash
git add backend/
git commit -m "feat(backend): scaffold FastAPI app with config, db session, health check"
```

---

### Task 2: Item model + enum + Pydantic schemas

**Files:**
- Create: `backend/app/models.py`
- Create: `backend/app/schemas.py`
- Create: `backend/tests/test_models.py`

**Interfaces:**
- Consumes: `app.db.Base`.
- Produces:
  - `app.models.ItemKind` (str Enum: `FEATURE="feature"`, `STORY="story"`, `RISK="risk"`).
  - `app.models.Item` ORM model with columns from the spec, `children` relationship (`cascade="all, delete-orphan"`), `parent_id` self-FK.
  - `app.schemas.ItemCreate`, `ItemUpdate`, `ItemRead`, `ItemDetail` (adds `children: list[ItemRead]`), `BoardCard`, `BoardColumn`, `ImportResult`.

- [ ] **Step 1: Write failing test `backend/tests/test_models.py`**

```python
from app.models import Item, ItemKind


def test_item_parent_child_round_trip(db_session):
    feature = Item(kind=ItemKind.FEATURE, type="Enabler Feature",
                   title="Feature A", status="Analyzing", position=0)
    db_session.add(feature)
    db_session.flush()
    story = Item(kind=ItemKind.STORY, type="Enabler Story", title="Story 1",
                 status="Analyzing", position=0, parent_id=feature.id)
    db_session.add(story)
    db_session.commit()

    loaded = db_session.get(Item, feature.id)
    assert loaded.children[0].title == "Story 1"


def test_feature_delete_cascades_to_children(db_session):
    feature = Item(kind=ItemKind.FEATURE, type="Feature", title="F", position=0)
    feature.children.append(
        Item(kind=ItemKind.STORY, type="Enabler Story", title="S", position=0)
    )
    db_session.add(feature)
    db_session.commit()
    fid = feature.id

    db_session.delete(feature)
    db_session.commit()
    assert db_session.query(Item).count() == 0
    assert db_session.get(Item, fid) is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && pytest tests/test_models.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.models'`.

- [ ] **Step 3: Create `backend/app/models.py`**

```python
import enum
from datetime import datetime

from sqlalchemy import Enum, ForeignKey, Integer, Numeric, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


class ItemKind(str, enum.Enum):
    FEATURE = "feature"
    STORY = "story"
    RISK = "risk"


class Item(Base):
    __tablename__ = "items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    kind: Mapped[ItemKind] = mapped_column(Enum(ItemKind, native_enum=False))
    type: Mapped[str | None] = mapped_column(String(64))
    parent_id: Mapped[int | None] = mapped_column(
        ForeignKey("items.id", ondelete="CASCADE")
    )
    position: Mapped[int] = mapped_column(Integer, default=0)

    title: Mapped[str] = mapped_column(String(512))
    description: Mapped[str | None] = mapped_column(Text)
    kategorie: Mapped[str | None] = mapped_column(String(256))
    art: Mapped[str | None] = mapped_column(String(64))
    sdi_prio: Mapped[str | None] = mapped_column(String(64))
    status: Mapped[str | None] = mapped_column(String(64))
    tshirt_size: Mapped[str | None] = mapped_column(String(16))
    wsjf_score: Mapped[float | None] = mapped_column(Numeric)
    story_points: Mapped[float | None] = mapped_column(Numeric)
    iteration: Mapped[str | None] = mapped_column(String(64))
    leading_team: Mapped[str | None] = mapped_column(String(128))
    supporting_team: Mapped[str | None] = mapped_column(String(128))
    externer_partner: Mapped[str | None] = mapped_column(String(128))
    assignee: Mapped[str | None] = mapped_column(String(128))
    akzeptanzkriterien: Mapped[str | None] = mapped_column(Text)
    dependencies: Mapped[str | None] = mapped_column(Text)
    bo_stakeholder: Mapped[str | None] = mapped_column(String(256))
    business_value: Mapped[int | None] = mapped_column(Integer)
    time_criticality: Mapped[int | None] = mapped_column(Integer)
    risk_reduction: Mapped[int | None] = mapped_column(Integer)
    cost_of_delay: Mapped[float | None] = mapped_column(Numeric)
    job_size: Mapped[float | None] = mapped_column(Numeric)
    definition_of_done: Mapped[str | None] = mapped_column(Text)

    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        server_default=func.now(), onupdate=func.now()
    )

    children: Mapped[list["Item"]] = relationship(
        cascade="all, delete-orphan",
        order_by="Item.position",
    )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && pytest tests/test_models.py -v`
Expected: PASS — both tests.

- [ ] **Step 5: Create `backend/app/schemas.py`**

```python
from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.models import ItemKind


class ItemBase(BaseModel):
    title: str
    description: str | None = None
    type: str | None = None
    kategorie: str | None = None
    art: str | None = None
    sdi_prio: str | None = None
    status: str | None = None
    tshirt_size: str | None = None
    wsjf_score: float | None = None
    story_points: float | None = None
    iteration: str | None = None
    leading_team: str | None = None
    supporting_team: str | None = None
    externer_partner: str | None = None
    assignee: str | None = None
    akzeptanzkriterien: str | None = None
    dependencies: str | None = None
    bo_stakeholder: str | None = None
    business_value: int | None = None
    time_criticality: int | None = None
    risk_reduction: int | None = None
    cost_of_delay: float | None = None
    job_size: float | None = None
    definition_of_done: str | None = None


class ItemCreate(ItemBase):
    kind: ItemKind
    parent_id: int | None = None
    position: int = 0


class ItemUpdate(BaseModel):
    # every field optional; only provided fields are changed
    model_config = ConfigDict(extra="forbid")
    title: str | None = None
    description: str | None = None
    status: str | None = None
    position: int | None = None
    tshirt_size: str | None = None
    iteration: str | None = None
    leading_team: str | None = None
    supporting_team: str | None = None
    externer_partner: str | None = None
    assignee: str | None = None
    kategorie: str | None = None
    sdi_prio: str | None = None
    akzeptanzkriterien: str | None = None
    dependencies: str | None = None
    bo_stakeholder: str | None = None
    definition_of_done: str | None = None
    story_points: float | None = None
    business_value: int | None = None
    time_criticality: int | None = None
    risk_reduction: int | None = None
    job_size: float | None = None
    wsjf_score: float | None = None


class ItemRead(ItemBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    kind: ItemKind
    parent_id: int | None
    position: int
    created_at: datetime
    updated_at: datetime


class ItemDetail(ItemRead):
    children: list[ItemRead] = []


class BoardCard(ItemRead):
    children_count: int = 0
    children_points: float = 0.0


class BoardColumn(BaseModel):
    status: str
    cards: list[BoardCard]


class ImportResult(BaseModel):
    features: int
    stories: int
    risks: int
    warnings: list[str]
```

- [ ] **Step 6: Run full test suite**

Run: `cd backend && pytest -v`
Expected: PASS — health + model tests; schemas import cleanly.

- [ ] **Step 7: Commit**

```bash
git add backend/app/models.py backend/app/schemas.py backend/tests/test_models.py
git commit -m "feat(backend): add Item model, ItemKind enum, and Pydantic schemas"
```

---

### Task 3: CSV value parsing helpers (numeric, int, kind mapping)

**Files:**
- Create: `backend/app/csv_import.py`
- Create: `backend/tests/test_csv_helpers.py`

**Interfaces:**
- Produces, in `app.csv_import`:
  - `parse_number(raw: str | None) -> float | None`
  - `parse_int(raw: str | None) -> int | None`
  - `kind_for_type(raw_type: str | None) -> tuple[ItemKind, str | None]` — returns `(kind, warning_or_None)`.

- [ ] **Step 1: Write failing test `backend/tests/test_csv_helpers.py`**

```python
from app.csv_import import kind_for_type, parse_int, parse_number
from app.models import ItemKind


def test_parse_number_variants():
    assert parse_number("0.5") == 0.5
    assert parse_number("12.666666666666666") == 12.666666666666666
    assert parse_number("60") == 60.0
    assert parse_number("") is None
    assert parse_number(None) is None
    assert parse_number("  ") is None


def test_parse_int_variants():
    assert parse_int("20") == 20
    assert parse_int("") is None
    assert parse_int("8") == 8
    # tolerate a stray decimal like "5.0"
    assert parse_int("5.0") == 5


def test_kind_for_type_known():
    assert kind_for_type("Enabler Feature") == (ItemKind.FEATURE, None)
    assert kind_for_type("Feature") == (ItemKind.FEATURE, None)
    assert kind_for_type("Enabler Story") == (ItemKind.STORY, None)
    assert kind_for_type("Risk") == (ItemKind.RISK, None)


def test_kind_for_type_unknown_defaults_to_feature_with_warning():
    kind, warning = kind_for_type("Spike")
    assert kind == ItemKind.FEATURE
    assert warning is not None and "Spike" in warning
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && pytest tests/test_csv_helpers.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.csv_import'`.

- [ ] **Step 3: Create `backend/app/csv_import.py`** (helpers only)

```python
from app.models import ItemKind

_TYPE_MAP: dict[str, ItemKind] = {
    "enabler feature": ItemKind.FEATURE,
    "feature": ItemKind.FEATURE,
    "enabler story": ItemKind.STORY,
    "story": ItemKind.STORY,
    "risk": ItemKind.RISK,
}


def parse_number(raw: str | None) -> float | None:
    if raw is None:
        return None
    text = raw.strip()
    if not text:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def parse_int(raw: str | None) -> int | None:
    value = parse_number(raw)
    if value is None:
        return None
    return int(value)


def kind_for_type(raw_type: str | None) -> tuple[ItemKind, str | None]:
    key = (raw_type or "").strip().lower()
    if key in _TYPE_MAP:
        return _TYPE_MAP[key], None
    return ItemKind.FEATURE, f"Unknown Type '{raw_type}', treated as feature"
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && pytest tests/test_csv_helpers.py -v`
Expected: PASS — all four tests.

- [ ] **Step 5: Commit**

```bash
git add backend/app/csv_import.py backend/tests/test_csv_helpers.py
git commit -m "feat(backend): add CSV value parsing and type-mapping helpers"
```

---

### Task 4: Parse CSV into structured items (positional hierarchy)

**Files:**
- Modify: `backend/app/csv_import.py`
- Create: `backend/tests/fixtures/team_planning.csv` (copy of repo-root `Team Planning Q3 26.csv`)
- Create: `backend/tests/test_csv_parse.py`

**Interfaces:**
- Consumes: `parse_number`, `parse_int`, `kind_for_type`.
- Produces, in `app.csv_import`:
  - `@dataclass ParsedItem` with fields: `kind: ItemKind`, `data: dict` (all model column values except id/parent/position/timestamps), `stories: list[ParsedItem]` (only for features).
  - `@dataclass ParsedImport` with `features: list[ParsedItem]`, `risks: list[ParsedItem]`, `warnings: list[str]`.
  - `read_rows(content: bytes) -> list[dict[str, str]]` — UTF-8 decode + `csv.DictReader`.
  - `parse_items(rows: list[dict[str, str]]) -> ParsedImport` — positional hierarchy.

**Column-name constants** (the CSV header strings), defined at top of module so tests and code agree:

```python
COL_TITLE = "Title"
COL_DESCRIPTION = "Description / Nutzenhypothese"
COL_TYPE = "Type"
COL_KATEGORIE = "Kategorie"
COL_ART = "ART"
COL_SDI_PRIO = "SDI Prio"
COL_STATUS = "Status"
COL_TSHIRT = "T-Shirt Size"
COL_WSJF = "WSJF Score"
COL_STORY_POINTS = "Story Points"
COL_ITERATION = "Iteration"
COL_LEADING_TEAM = "Leading Team"
COL_SUPPORTING_TEAM = "Supporting Team"
COL_EXTERNER_PARTNER = "Externer Partner"
COL_ASSIGNEE = "Assignee"
COL_AKZEPTANZ = "Akzeptanzkriterien"
COL_DEPENDENCIES = "Dependencies"
COL_BO = "BO/Stakeholder"
COL_BUSINESS_VALUE = "Business Value / Direkter Nutzen (1,2,3,5,8,13,20)"
COL_TIME_CRIT = "Time Criticality / Zukünftiger Nutzen (1,2,3,5,8,13,20)"
COL_RISK_RED = "Risk Reduction / Dringlichkeit (1,2,3,5,8,13,20)"
COL_COST_OF_DELAY = "Cost of Delay"
COL_JOB_SIZE = "Job Size / Aufwand (1,2,3,5,8,13,20)"
COL_PARENT = "Parent"
COL_DOD = "Definition of Done (DoD)"
```

- [ ] **Step 1: Copy the real CSV into the test fixtures dir**

Run:
```bash
mkdir -p backend/tests/fixtures && cp "Team Planning Q3 26.csv" backend/tests/fixtures/team_planning.csv
```

- [ ] **Step 2: Write failing test `backend/tests/test_csv_parse.py`**

```python
from pathlib import Path

from app.csv_import import parse_items, read_rows
from app.models import ItemKind

FIXTURE = Path(__file__).parent / "fixtures" / "team_planning.csv"


def _parse_fixture():
    rows = read_rows(FIXTURE.read_bytes())
    return parse_items(rows)


def test_synthetic_positional_hierarchy():
    rows = [
        {"Title": "Feature A", "Type": "Enabler Feature", "Status": "Analyzing",
         "Story Points": "", "Parent": "", "WSJF Score": "60"},
        {"Title": "Story A1", "Type": "Enabler Story", "Status": "Analyzing",
         "Story Points": "0.5", "Parent": "Feature A", "WSJF Score": ""},
        {"Title": "Story A2", "Type": "Enabler Story", "Status": "Analyzing",
         "Story Points": "0.8", "Parent": "Feature A", "WSJF Score": ""},
        {"Title": "Risk X", "Type": "Risk", "Status": "New",
         "Story Points": "", "Parent": "", "WSJF Score": ""},
    ]
    parsed = parse_items(rows)
    assert len(parsed.features) == 1
    assert len(parsed.risks) == 1
    feature = parsed.features[0]
    assert [s.data["title"] for s in feature.stories] == ["Story A1", "Story A2"]
    assert feature.stories[0].data["story_points"] == 0.5
    assert parsed.risks[0].data["title"] == "Risk X"


def test_story_before_any_feature_is_warned_and_skipped():
    rows = [
        {"Title": "Orphan", "Type": "Enabler Story", "Status": "", "Parent": ""},
    ]
    parsed = parse_items(rows)
    assert parsed.features == []
    assert any("Orphan" in w for w in parsed.warnings)


def test_real_fixture_counts_and_duplicates():
    parsed = _parse_fixture()
    # 8 Risk rows at the bottom of the file
    assert len(parsed.risks) == 8
    # Duplicate feature title appears as two separate features
    netapp = [f for f in parsed.features if f.data["title"] == "NetApp AirGap Recovery - ruttm"]
    assert len(netapp) == 2
    # Each NetApp feature owns its own 3 stories (recurring child titles)
    assert all(len(f.stories) == 3 for f in netapp)
    # A recurring story title is parented under multiple distinct features
    parents_of_doku = [
        f.data["title"]
        for f in parsed.features
        for s in f.stories
        if s.data["title"].strip() == "Dokumentation"
    ]
    assert len(set(parents_of_doku)) >= 2


def test_real_fixture_multiline_description_preserved():
    parsed = _parse_fixture()
    teton = next(f for f in parsed.features if f.data["title"].startswith("Teton Isolierung"))
    assert "\n" in (teton.data["description"] or "")
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd backend && pytest tests/test_csv_parse.py -v`
Expected: FAIL — `ImportError: cannot import name 'parse_items'`.

- [ ] **Step 4: Append parsing code to `backend/app/csv_import.py`**

Add the column constants block (shown in Interfaces above) at the top of the module (after the existing imports), then append:

```python
import csv
import io
from dataclasses import dataclass, field


@dataclass
class ParsedItem:
    kind: ItemKind
    data: dict
    stories: list["ParsedItem"] = field(default_factory=list)


@dataclass
class ParsedImport:
    features: list[ParsedItem] = field(default_factory=list)
    risks: list[ParsedItem] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


def read_rows(content: bytes) -> list[dict[str, str]]:
    text = content.decode("utf-8-sig")
    reader = csv.DictReader(io.StringIO(text))
    return [dict(row) for row in reader]


def _row_to_data(row: dict[str, str]) -> dict:
    g = row.get
    return {
        "title": (g(COL_TITLE) or "").strip(),
        "type": g(COL_TYPE),
        "description": g(COL_DESCRIPTION),
        "kategorie": g(COL_KATEGORIE),
        "art": g(COL_ART),
        "sdi_prio": g(COL_SDI_PRIO),
        "status": (g(COL_STATUS) or "").strip(),
        "tshirt_size": g(COL_TSHIRT),
        "wsjf_score": parse_number(g(COL_WSJF)),
        "story_points": parse_number(g(COL_STORY_POINTS)),
        "iteration": g(COL_ITERATION),
        "leading_team": g(COL_LEADING_TEAM),
        "supporting_team": g(COL_SUPPORTING_TEAM),
        "externer_partner": g(COL_EXTERNER_PARTNER),
        "assignee": g(COL_ASSIGNEE),
        "akzeptanzkriterien": g(COL_AKZEPTANZ),
        "dependencies": g(COL_DEPENDENCIES),
        "bo_stakeholder": g(COL_BO),
        "business_value": parse_int(g(COL_BUSINESS_VALUE)),
        "time_criticality": parse_int(g(COL_TIME_CRIT)),
        "risk_reduction": parse_int(g(COL_RISK_RED)),
        "cost_of_delay": parse_number(g(COL_COST_OF_DELAY)),
        "job_size": parse_number(g(COL_JOB_SIZE)),
        "definition_of_done": g(COL_DOD),
    }


def parse_items(rows: list[dict[str, str]]) -> ParsedImport:
    result = ParsedImport()
    current_feature: ParsedItem | None = None

    for index, row in enumerate(rows):
        title = (row.get(COL_TITLE) or "").strip()
        if not title:
            continue
        kind, type_warning = kind_for_type(row.get(COL_TYPE))
        if type_warning:
            result.warnings.append(f"Row {index + 2}: {type_warning}")
        data = _row_to_data(row)

        if kind == ItemKind.FEATURE:
            item = ParsedItem(kind=kind, data=data)
            result.features.append(item)
            current_feature = item
        elif kind == ItemKind.RISK:
            result.risks.append(ParsedItem(kind=kind, data=data))
            # risks do not change the current feature
        else:  # STORY
            if current_feature is None:
                result.warnings.append(
                    f"Row {index + 2}: story '{title}' has no preceding feature; skipped"
                )
                continue
            stated_parent = (row.get(COL_PARENT) or "").strip()
            if stated_parent and stated_parent != current_feature.data["title"]:
                result.warnings.append(
                    f"Row {index + 2}: story '{title}' Parent column "
                    f"'{stated_parent}' != positional parent "
                    f"'{current_feature.data['title']}'; using positional"
                )
            current_feature.stories.append(ParsedItem(kind=kind, data=data))

    return result
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && pytest tests/test_csv_parse.py -v`
Expected: PASS — all four tests.

- [ ] **Step 6: Commit**

```bash
git add backend/app/csv_import.py backend/tests/test_csv_parse.py backend/tests/fixtures/
git commit -m "feat(backend): parse CSV into positional Feature/Story/Risk hierarchy"
```

---

### Task 5: Import endpoint with transactional replace-all

**Files:**
- Modify: `backend/app/csv_import.py`
- Create: `backend/app/routers/__init__.py` (empty)
- Create: `backend/app/routers/imports.py`
- Modify: `backend/app/main.py`
- Create: `backend/tests/test_import_endpoint.py`

**Interfaces:**
- Consumes: `parse_items`, `read_rows`, `ParsedImport`, `app.models.Item`, `app.schemas.ImportResult`.
- Produces:
  - `app.csv_import.replace_all(db: Session, parsed: ParsedImport) -> ImportResult` — deletes all `Item` rows then inserts features (with their stories) and risks in one transaction; assigns `position` from list order.
  - `POST /api/import` (multipart `file`) → `ImportResult`.

- [ ] **Step 1: Write failing test `backend/tests/test_import_endpoint.py`**

```python
from pathlib import Path

from app.models import Item, ItemKind

FIXTURE = Path(__file__).parent / "fixtures" / "team_planning.csv"


def test_import_replaces_all_and_returns_counts(client, db_session):
    # pre-existing item should be wiped by replace-all
    db_session.add(Item(kind=ItemKind.FEATURE, type="Feature",
                        title="STALE", position=0))
    db_session.commit()

    with FIXTURE.open("rb") as fh:
        resp = client.post("/api/import",
                           files={"file": ("team_planning.csv", fh, "text/csv")})

    assert resp.status_code == 200
    body = resp.json()
    assert body["risks"] == 8
    assert body["features"] > 0
    assert body["stories"] > 0
    assert db_session.query(Item).filter_by(title="STALE").count() == 0
    # stories are linked to a parent feature
    story = db_session.query(Item).filter_by(kind=ItemKind.STORY).first()
    assert story.parent_id is not None


def test_second_import_does_not_accumulate(client):
    with FIXTURE.open("rb") as fh:
        first = client.post("/api/import",
                           files={"file": ("p.csv", fh, "text/csv")}).json()
    with FIXTURE.open("rb") as fh:
        second = client.post("/api/import",
                            files={"file": ("p.csv", fh, "text/csv")}).json()
    assert first == second
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && pytest tests/test_import_endpoint.py -v`
Expected: FAIL — 404 on `/api/import` (route not registered).

- [ ] **Step 3: Append `replace_all` to `backend/app/csv_import.py`**

```python
def _insert_item(db, parsed_item, parent_id, position):
    from app.models import Item

    item = Item(
        kind=parsed_item.kind,
        parent_id=parent_id,
        position=position,
        **parsed_item.data,
    )
    db.add(item)
    db.flush()  # assign id for child linkage
    return item


def replace_all(db, parsed):
    from app.models import Item
    from app.schemas import ImportResult

    stories = 0
    db.query(Item).delete()
    for f_index, feature in enumerate(parsed.features):
        feature_row = _insert_item(db, feature, None, f_index)
        for s_index, story in enumerate(feature.stories):
            _insert_item(db, story, feature_row.id, s_index)
            stories += 1
    for r_index, risk in enumerate(parsed.risks):
        _insert_item(db, risk, None, r_index)
    db.commit()
    return ImportResult(
        features=len(parsed.features),
        stories=stories,
        risks=len(parsed.risks),
        warnings=parsed.warnings,
    )
```

- [ ] **Step 4: Create `backend/app/routers/imports.py`**

```python
from fastapi import APIRouter, Depends, HTTPException, UploadFile
from sqlalchemy.orm import Session

from app.csv_import import parse_items, read_rows, replace_all
from app.db import get_db
from app.schemas import ImportResult

router = APIRouter(prefix="/api", tags=["import"])


@router.post("/import", response_model=ImportResult)
async def import_csv(file: UploadFile, db: Session = Depends(get_db)) -> ImportResult:
    content = await file.read()
    try:
        rows = read_rows(content)
    except UnicodeDecodeError as exc:
        raise HTTPException(status_code=400, detail=f"File is not valid UTF-8: {exc}")
    parsed = parse_items(rows)
    try:
        return replace_all(db, parsed)
    except Exception as exc:  # roll back leaves existing data intact
        db.rollback()
        raise HTTPException(status_code=400, detail=f"Import failed: {exc}")
```

- [ ] **Step 5: Register the router in `backend/app/main.py`**

Add after the `app.add_middleware(...)` block:

```python
from app.routers import imports

app.include_router(imports.router)
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd backend && pytest tests/test_import_endpoint.py -v`
Expected: PASS — both tests.

- [ ] **Step 7: Commit**

```bash
git add backend/app/csv_import.py backend/app/routers/ backend/app/main.py backend/tests/test_import_endpoint.py
git commit -m "feat(backend): add POST /api/import with transactional replace-all"
```

---

### Task 6: Item CRUD endpoints + WSJF recompute

**Files:**
- Create: `backend/app/wsjf.py`
- Create: `backend/app/routers/items.py`
- Modify: `backend/app/main.py`
- Create: `backend/tests/test_wsjf.py`
- Create: `backend/tests/test_api_items.py`

**Interfaces:**
- Consumes: `app.models.Item`, schemas `ItemCreate/ItemUpdate/ItemRead/ItemDetail`.
- Produces:
  - `app.wsjf.recompute(item: Item) -> None` — sets `cost_of_delay = bv+tc+rr` (only when all three present) and `wsjf_score = cost_of_delay / job_size` (when `job_size` truthy).
  - `GET /api/items` (filters: `kind, status, iteration, leading_team, assignee, q`), `GET /api/items/{id}`, `POST /api/items`, `PATCH /api/items/{id}`, `DELETE /api/items/{id}`.

- [ ] **Step 1: Write failing test `backend/tests/test_wsjf.py`**

```python
from app.models import Item, ItemKind
from app.wsjf import recompute


def test_recompute_sets_cod_and_wsjf():
    item = Item(kind=ItemKind.FEATURE, title="F", position=0,
                business_value=8, time_criticality=13, risk_reduction=13,
                job_size=1)
    recompute(item)
    assert item.cost_of_delay == 34
    assert item.wsjf_score == 34


def test_recompute_guards_zero_job_size():
    item = Item(kind=ItemKind.FEATURE, title="F", position=0,
                business_value=1, time_criticality=2, risk_reduction=3,
                job_size=0)
    recompute(item)
    assert item.cost_of_delay == 6
    assert item.wsjf_score is None  # no divide by zero


def test_recompute_skips_when_components_missing():
    item = Item(kind=ItemKind.FEATURE, title="F", position=0,
                business_value=None, job_size=2, cost_of_delay=99, wsjf_score=42)
    recompute(item)
    assert item.cost_of_delay == 99  # untouched
    assert item.wsjf_score == 42
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && pytest tests/test_wsjf.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.wsjf'`.

- [ ] **Step 3: Create `backend/app/wsjf.py`**

```python
from app.models import Item


def recompute(item: Item) -> None:
    bv, tc, rr = item.business_value, item.time_criticality, item.risk_reduction
    if bv is None or tc is None or rr is None:
        return
    cod = bv + tc + rr
    item.cost_of_delay = cod
    if item.job_size:
        item.wsjf_score = cod / item.job_size
    else:
        item.wsjf_score = None
```

- [ ] **Step 4: Run WSJF test to verify it passes**

Run: `cd backend && pytest tests/test_wsjf.py -v`
Expected: PASS — three tests.

- [ ] **Step 5: Create `backend/app/routers/items.py`**

```python
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Item, ItemKind
from app.schemas import ItemCreate, ItemDetail, ItemRead, ItemUpdate
from app.wsjf import recompute

router = APIRouter(prefix="/api/items", tags=["items"])

_WSJF_FIELDS = {"business_value", "time_criticality", "risk_reduction", "job_size"}


def _get_or_404(db: Session, item_id: int) -> Item:
    item = db.get(Item, item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Item not found")
    return item


@router.get("", response_model=list[ItemRead])
def list_items(
    kind: ItemKind | None = None,
    status: str | None = None,
    iteration: str | None = None,
    leading_team: str | None = None,
    assignee: str | None = None,
    q: str | None = None,
    db: Session = Depends(get_db),
) -> list[Item]:
    stmt = select(Item)
    if kind is not None:
        stmt = stmt.where(Item.kind == kind)
    if status is not None:
        stmt = stmt.where(Item.status == status)
    if iteration is not None:
        stmt = stmt.where(Item.iteration == iteration)
    if leading_team is not None:
        stmt = stmt.where(Item.leading_team == leading_team)
    if assignee is not None:
        stmt = stmt.where(Item.assignee == assignee)
    if q:
        stmt = stmt.where(Item.title.ilike(f"%{q}%"))
    stmt = stmt.order_by(Item.position)
    return list(db.scalars(stmt))


@router.get("/{item_id}", response_model=ItemDetail)
def get_item(item_id: int, db: Session = Depends(get_db)) -> Item:
    return _get_or_404(db, item_id)


@router.post("", response_model=ItemDetail, status_code=201)
def create_item(payload: ItemCreate, db: Session = Depends(get_db)) -> Item:
    if payload.parent_id is not None and db.get(Item, payload.parent_id) is None:
        raise HTTPException(status_code=422, detail="parent_id does not exist")
    item = Item(**payload.model_dump())
    recompute(item)
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@router.patch("/{item_id}", response_model=ItemDetail)
def update_item(
    item_id: int, payload: ItemUpdate, db: Session = Depends(get_db)
) -> Item:
    item = _get_or_404(db, item_id)
    changes = payload.model_dump(exclude_unset=True)
    for key, value in changes.items():
        setattr(item, key, value)
    if _WSJF_FIELDS & changes.keys():
        recompute(item)
    db.commit()
    db.refresh(item)
    return item


@router.delete("/{item_id}", status_code=204)
def delete_item(item_id: int, db: Session = Depends(get_db)) -> None:
    item = _get_or_404(db, item_id)
    db.delete(item)  # ORM cascade removes child stories
    db.commit()
```

- [ ] **Step 6: Register router in `backend/app/main.py`**

Add next to the imports router include:

```python
from app.routers import items

app.include_router(items.router)
```

- [ ] **Step 7: Write failing test `backend/tests/test_api_items.py`**

```python
from app.models import Item, ItemKind


def _make_feature(db, **kw):
    item = Item(kind=ItemKind.FEATURE, type="Feature", title="F",
                status="Analyzing", position=0, **kw)
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


def test_create_item(client):
    resp = client.post("/api/items", json={
        "kind": "feature", "title": "New Feature", "status": "Funnel",
        "business_value": 8, "time_criticality": 13, "risk_reduction": 13,
        "job_size": 1,
    })
    assert resp.status_code == 201
    body = resp.json()
    assert body["title"] == "New Feature"
    assert body["cost_of_delay"] == 34
    assert body["wsjf_score"] == 34


def test_patch_status_only(client, db_session):
    feature = _make_feature(db_session)
    resp = client.patch(f"/api/items/{feature.id}", json={"status": "New"})
    assert resp.status_code == 200
    assert resp.json()["status"] == "New"


def test_patch_recomputes_wsjf(client, db_session):
    feature = _make_feature(db_session, business_value=5, time_criticality=5,
                            risk_reduction=5, job_size=5, wsjf_score=0)
    resp = client.patch(f"/api/items/{feature.id}", json={"job_size": 3})
    assert resp.status_code == 200
    assert resp.json()["cost_of_delay"] == 15
    assert resp.json()["wsjf_score"] == 5


def test_get_missing_returns_404(client):
    assert client.get("/api/items/999").status_code == 404


def test_delete_feature_cascades(client, db_session):
    feature = _make_feature(db_session)
    db_session.add(Item(kind=ItemKind.STORY, type="Enabler Story",
                       title="child", position=0, parent_id=feature.id))
    db_session.commit()
    resp = client.delete(f"/api/items/{feature.id}")
    assert resp.status_code == 204
    assert db_session.query(Item).count() == 0


def test_list_filter_by_kind_and_search(client, db_session):
    _make_feature(db_session, title="Alpha Feature")
    db_session.add(Item(kind=ItemKind.RISK, type="Risk", title="Beta Risk",
                       status="New", position=0))
    db_session.commit()
    by_kind = client.get("/api/items?kind=risk").json()
    assert [i["title"] for i in by_kind] == ["Beta Risk"]
    by_q = client.get("/api/items?q=alpha").json()
    assert [i["title"] for i in by_q] == ["Alpha Feature"]
```

- [ ] **Step 8: Run the item API tests to verify they pass**

Run: `cd backend && pytest tests/test_api_items.py -v`
Expected: PASS — all six tests.

- [ ] **Step 9: Commit**

```bash
git add backend/app/wsjf.py backend/app/routers/items.py backend/app/main.py backend/tests/test_wsjf.py backend/tests/test_api_items.py
git commit -m "feat(backend): add item CRUD endpoints with WSJF recompute"
```

---

### Task 7: Board endpoint (columns grouped by status)

**Files:**
- Create: `backend/app/routers/board.py`
- Modify: `backend/app/main.py`
- Create: `backend/tests/test_api_board.py`

**Interfaces:**
- Consumes: `app.models.Item`, schemas `BoardColumn`, `BoardCard`.
- Produces: `GET /api/board` → `list[BoardColumn]`. Columns are top-level items (features + risks, `parent_id IS NULL`) grouped by `status`, ordered `Funnel → Analyzing → New`, then any other statuses alphabetically, then an `Unscheduled` column for blank/NULL status. Each `BoardCard` carries `children_count` and `children_points` (sum of child `story_points`).

- [ ] **Step 1: Write failing test `backend/tests/test_api_board.py`**

```python
from app.models import Item, ItemKind


def _seed(db):
    feature = Item(kind=ItemKind.FEATURE, type="Feature", title="F1",
                   status="Analyzing", position=0)
    feature.children.append(
        Item(kind=ItemKind.STORY, type="Enabler Story", title="S1",
             position=0, story_points=0.5))
    feature.children.append(
        Item(kind=ItemKind.STORY, type="Enabler Story", title="S2",
             position=1, story_points=1.5))
    db.add(feature)
    db.add(Item(kind=ItemKind.RISK, type="Risk", title="R1",
               status="New", position=0))
    db.add(Item(kind=ItemKind.FEATURE, type="Feature", title="F2",
               status="", position=1))
    db.commit()


def test_board_groups_and_orders_columns(client, db_session):
    _seed(db_session)
    columns = client.get("/api/board").json()
    statuses = [c["status"] for c in columns]
    assert statuses[:2] == ["Analyzing", "New"]  # Funnel absent here
    assert "Unscheduled" in statuses


def test_board_card_aggregates_children(client, db_session):
    _seed(db_session)
    columns = client.get("/api/board").json()
    analyzing = next(c for c in columns if c["status"] == "Analyzing")
    card = analyzing["cards"][0]
    assert card["children_count"] == 2
    assert card["children_points"] == 2.0


def test_board_excludes_child_stories_as_cards(client, db_session):
    _seed(db_session)
    columns = client.get("/api/board").json()
    titles = [card["title"] for col in columns for card in col["cards"]]
    assert "S1" not in titles and "S2" not in titles
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && pytest tests/test_api_board.py -v`
Expected: FAIL — 404 on `/api/board`.

- [ ] **Step 3: Create `backend/app/routers/board.py`**

```python
from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Item
from app.schemas import BoardCard, BoardColumn

router = APIRouter(prefix="/api", tags=["board"])

_STATUS_ORDER = ["Funnel", "Analyzing", "New"]
_UNSCHEDULED = "Unscheduled"


def _status_key(status: str) -> tuple[int, str]:
    if status == _UNSCHEDULED:
        return (len(_STATUS_ORDER) + 1, "")
    if status in _STATUS_ORDER:
        return (_STATUS_ORDER.index(status), "")
    return (len(_STATUS_ORDER), status.lower())


@router.get("/board", response_model=list[BoardColumn])
def get_board(db: Session = Depends(get_db)) -> list[BoardColumn]:
    stmt = select(Item).where(Item.parent_id.is_(None)).order_by(Item.position)
    grouped: dict[str, list[BoardCard]] = {}
    for item in db.scalars(stmt):
        status = (item.status or "").strip() or _UNSCHEDULED
        card = BoardCard.model_validate(item)
        card.children_count = len(item.children)
        card.children_points = sum(
            (c.story_points or 0) for c in item.children
        )
        grouped.setdefault(status, []).append(card)
    return [
        BoardColumn(status=status, cards=cards)
        for status, cards in sorted(grouped.items(), key=lambda kv: _status_key(kv[0]))
    ]
```

- [ ] **Step 4: Register router in `backend/app/main.py`**

```python
from app.routers import board

app.include_router(board.router)
```

- [ ] **Step 5: Run board tests to verify they pass**

Run: `cd backend && pytest tests/test_api_board.py -v`
Expected: PASS — three tests.

- [ ] **Step 6: Commit**

```bash
git add backend/app/routers/board.py backend/app/main.py backend/tests/test_api_board.py
git commit -m "feat(backend): add GET /api/board grouped by status with child aggregates"
```

---

### Task 8: Alembic migration + run docs + full-suite green

**Files:**
- Create: `backend/alembic.ini`
- Create: `backend/alembic/env.py`
- Create: `backend/alembic/script.py.mako`
- Create: `backend/alembic/versions/0001_create_items.py`
- Create: `backend/README.md`

**Interfaces:**
- Produces: a runnable Postgres migration that creates the `items` table identical to `app.models.Item`, and developer run instructions.

- [ ] **Step 1: Create `backend/alembic.ini`** (minimal)

```ini
[alembic]
script_location = alembic
sqlalchemy.url =

[loggers]
keys = root

[handlers]
keys = console

[formatters]
keys = generic

[logger_root]
level = WARN
handlers = console

[handler_console]
class = StreamHandler
args = (sys.stderr,)
level = NOTSET
formatter = generic

[formatter_generic]
format = %(levelname)-5.5s [%(name)s] %(message)s
```

- [ ] **Step 2: Create `backend/alembic/env.py`** (autogenerate-aware, reads settings + models)

```python
from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool

from app.config import settings
from app.db import Base
from app import models  # noqa: F401  (registers Item on Base.metadata)

config = context.config
config.set_main_option("sqlalchemy.url", settings.database_url)
if config.config_file_name:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()


run_migrations_online()
```

- [ ] **Step 3: Create `backend/alembic/script.py.mako`**

```mako
"""${message}

Revision ID: ${up_revision}
Revises: ${down_revision | comma,n}
"""
from alembic import op
import sqlalchemy as sa
${imports if imports else ""}

revision = ${repr(up_revision)}
down_revision = ${repr(down_revision)}
branch_labels = ${repr(branch_labels)}
depends_on = ${repr(depends_on)}


def upgrade() -> None:
    ${upgrades if upgrades else "pass"}


def downgrade() -> None:
    ${downgrades if downgrades else "pass"}
```

- [ ] **Step 4: Create `backend/alembic/versions/0001_create_items.py`**

```python
"""create items table

Revision ID: 0001
Revises:
"""
from alembic import op
import sqlalchemy as sa

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "items",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("type", sa.String(64)),
        sa.Column("parent_id", sa.Integer,
                  sa.ForeignKey("items.id", ondelete="CASCADE")),
        sa.Column("position", sa.Integer, nullable=False, server_default="0"),
        sa.Column("title", sa.String(512), nullable=False),
        sa.Column("description", sa.Text),
        sa.Column("kategorie", sa.String(256)),
        sa.Column("art", sa.String(64)),
        sa.Column("sdi_prio", sa.String(64)),
        sa.Column("status", sa.String(64)),
        sa.Column("tshirt_size", sa.String(16)),
        sa.Column("wsjf_score", sa.Numeric),
        sa.Column("story_points", sa.Numeric),
        sa.Column("iteration", sa.String(64)),
        sa.Column("leading_team", sa.String(128)),
        sa.Column("supporting_team", sa.String(128)),
        sa.Column("externer_partner", sa.String(128)),
        sa.Column("assignee", sa.String(128)),
        sa.Column("akzeptanzkriterien", sa.Text),
        sa.Column("dependencies", sa.Text),
        sa.Column("bo_stakeholder", sa.String(256)),
        sa.Column("business_value", sa.Integer),
        sa.Column("time_criticality", sa.Integer),
        sa.Column("risk_reduction", sa.Integer),
        sa.Column("cost_of_delay", sa.Numeric),
        sa.Column("job_size", sa.Numeric),
        sa.Column("definition_of_done", sa.Text),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime, server_default=sa.func.now()),
    )
    op.create_index("ix_items_parent_id", "items", ["parent_id"])
    op.create_index("ix_items_status", "items", ["status"])


def downgrade() -> None:
    op.drop_table("items")
```

- [ ] **Step 5: Create `backend/README.md`**

```markdown
# SAFe Kanban Backend

## Setup
```bash
cd backend
python -m venv .venv && . .venv/bin/activate
pip install -e ".[dev]"
cp .env.example .env
docker compose up -d db        # Postgres on :5432
alembic upgrade head           # create the items table
uvicorn app.main:app --reload  # API on :8000
```

## Tests
```bash
pytest                         # runs against SQLite in-memory
```

## Import data
`POST /api/import` with the planning CSV as multipart `file` (replace-all).
```

- [ ] **Step 6: Verify migration applies against Postgres**

Run:
```bash
cd backend && docker compose up -d db && sleep 3 && . .venv/bin/activate && alembic upgrade head
```
Expected: `Running upgrade  -> 0001, create items table` with no error.

- [ ] **Step 7: Run the FULL test suite**

Run: `cd backend && pytest -v`
Expected: PASS — every test across all files.

- [ ] **Step 8: Commit**

```bash
git add backend/alembic.ini backend/alembic/ backend/README.md
git commit -m "feat(backend): add Alembic migration for items table and run docs"
```

---

## Self-Review Notes

- **Spec coverage:** data model → Task 2; positional import + replace-all + warnings → Tasks 3–5; CRUD + WSJF recompute → Task 6; board grouped by status with child aggregates → Task 7; cascade delete → Tasks 2 & 6; migration + docker-compose + run → Tasks 1 & 8; tests against real CSV fixture → Task 4. No auth (out of scope) — correctly absent.
- **Type consistency:** `ParsedItem`/`ParsedImport`, `replace_all`, `recompute`, and `ItemKind` values (`feature/story/risk`) are used identically across tasks. Schema field names match model columns.
- **Frontend** is covered by the companion plan `2026-06-30-safe-kanban-frontend.md`.
