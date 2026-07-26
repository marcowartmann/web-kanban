# Product Roadmaps with Streams Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Per-product streams holding date-ranged roadmap items linkable to Kanban Features, rendered as a Gantt-style top-level Roadmap view — per `docs/superpowers/specs/2026-07-26-product-roadmaps-streams-design.md`.

**Architecture:** Extends `backend/app/catalog/` exactly like sub-projects 2–3 (domain + `StreamRepository`/`RoadmapItemRepository` ports + Postgres adapter + factory; ORM in `models.py`; migration `0029`; router `roadmap.py`). Frontend: pure geometry helper `lib/roadmap.ts`, top-level `RoadmapView` with swimlanes + status-colored bars + inline stream management, `RoadmapItemDrawer` with feature links.

**Tech Stack:** FastAPI, SQLAlchemy 2.0, Alembic, Pydantic v2, pytest; React + TypeScript + Tailwind v4, Vitest.

## Global Constraints

- API base `/api/v1`; router under `Depends(require_user)`; every endpoint writable by ANY signed-in user.
- `RoadmapStatus`: `idea | planned | committed | done | cancelled` (default `idea`), persisted lowercase via `values_callable`, VARCHAR(16).
- `start_date` and `end_date` are both REQUIRED; domain rule `start_date ≤ end_date` → `CatalogRuleViolation("start_date must not be after end_date")`, enforced on create AND update (effective post-change pair).
- Feature links: target must be an item of kind `feature` (422 "Only features can be linked"); duplicate → 422 "This link already exists"; missing on unlink → 404 "Link not found". **Feature-side deletes never blocked**: `roadmap_item_features.feature_id` is ON DELETE CASCADE (deliberate departure from the catalog RESTRICT convention).
- Guards (409): stream delete blocked while it has items ("Stream has {n} roadmap item(s); delete them first"); product delete additionally blocked by streams ("Product has {n} stream(s); delete them first"). Roadmap-item delete always allowed (link rows removed explicitly — SQLite fixtures don't enforce CASCADE).
- Stream move on item update: target stream must belong to the same product (422 "Target stream must belong to the same product").
- Error mapping app-level (404/422/409); `check_writable` on every write; adapters flush-only.
- Audit: `stream.created/updated/deleted`; `roadmap_item.created/updated/deleted` (updates field-level — dates as ISO strings, status values, stream move as field "stream" with old/new stream NAMES); `roadmap_item.feature_linked/unlinked` (field "feature", feature TITLE as value; unlink fetches the title BEFORE removal).
- Frontend: custom dropdowns only; Roadmap view fits the fixed shell; loading-before-empty; every input aria-labeled; no drag-and-drop of bars (drawer-edited dates); no client re-sort of stream/item order (server orders: streams by position then name; items by start_date then id).
- Status bar colors: idea `bg-gray-200 text-gray-700`, planned `bg-blue-100 text-blue-800`, committed `bg-violet-100 text-violet-800`, done `bg-emerald-100 text-emerald-800`, cancelled `bg-gray-100 text-gray-400 line-through`.
- Backend from `backend/` (venv); frontend from `frontend/`; migration dry-run up+down on compose Postgres.
- Branch `feat/product-roadmaps` off `main`.

---

### Task 1: Domain — RoadmapStatus, dataclasses, date-range validator

**Files:**
- Modify: `backend/app/catalog/domain.py` (append)
- Test: `backend/tests/catalog/test_roadmap_domain.py`

**Interfaces (produces):**

```python
class RoadmapStatus(str, enum.Enum):
    IDEA = "idea"
    PLANNED = "planned"
    COMMITTED = "committed"
    DONE = "done"
    CANCELLED = "cancelled"


@dataclass
class LinkedFeature:
    id: int
    title: str
    status: str | None = None


@dataclass
class RoadmapItem:
    id: int | None
    title: str
    stream_id: int
    start_date: date
    end_date: date
    description: str | None = None
    status: RoadmapStatus = RoadmapStatus.IDEA
    # read-side enrichment filled by adapters
    features: list[LinkedFeature] = field(default_factory=list)


@dataclass
class Stream:
    id: int | None
    name: str
    product_id: int
    position: int = 0
    # read-side enrichment filled by adapters
    items: list[RoadmapItem] = field(default_factory=list)


def validate_date_range(start_date: date, end_date: date) -> None:
    if start_date > end_date:
        raise CatalogRuleViolation("start_date must not be after end_date")
```

- [ ] **Step 1: Failing tests** — `backend/tests/catalog/test_roadmap_domain.py`:

```python
from datetime import date

import pytest

from app.catalog.domain import (
    CatalogRuleViolation,
    RoadmapItem,
    RoadmapStatus,
    Stream,
    validate_date_range,
)


def test_validate_date_range_ok_and_equal():
    validate_date_range(date(2026, 1, 1), date(2026, 6, 30))
    validate_date_range(date(2026, 1, 1), date(2026, 1, 1))  # single-day item


def test_validate_date_range_rejects_inverted():
    with pytest.raises(CatalogRuleViolation):
        validate_date_range(date(2026, 6, 30), date(2026, 1, 1))


def test_dataclass_defaults():
    item = RoadmapItem(id=1, title="Wi-Fi 7 rollout", stream_id=1,
                       start_date=date(2026, 1, 1), end_date=date(2026, 6, 30))
    assert item.status == RoadmapStatus.IDEA
    assert item.features == []
    s = Stream(id=1, name="Campus access", product_id=1)
    assert s.position == 0
    assert s.items == []
```

- [ ] **Step 2: RED** (ImportError) → **Step 3: implement** (append the Interfaces code verbatim) → **Step 4: GREEN** + `pytest tests/catalog/ -q` clean.
- [ ] **Step 5: Commit**

```bash
git checkout -b feat/product-roadmaps
git add backend/app/catalog/domain.py backend/tests/catalog/test_roadmap_domain.py
git commit -m "feat(roadmap): domain — RoadmapStatus, Stream/RoadmapItem, date-range rule"
```

---

### Task 2: ORM + migration 0029

**Files:**
- Modify: `backend/app/models.py` (extend the catalog enum import with `RoadmapStatus`; append models)
- Create: `backend/alembic/versions/0029_roadmap_streams.py`
- Test: `backend/tests/catalog/test_roadmap_models.py`

**Interfaces (produces):** ORM `Stream` (table `streams`, unique `(product_id, name)` named `uq_stream_product_name`, `position` int not null default 0 server_default "0", product FK RESTRICT indexed, relationship `product`), `RoadmapItem` (table `roadmap_items`, title String(256), description Text, stream FK RESTRICT indexed, `status` enum column with the values_callable pattern + server_default "idea", start_date/end_date `Date` NOT NULL, timestamps, relationship `stream`), association `roadmap_item_features` Table (`roadmap_item_id` FK CASCADE + `feature_id` FK → items.id CASCADE, composite PK).

- [ ] **Step 1: Failing test** — `backend/tests/catalog/test_roadmap_models.py`:

```python
from datetime import date

from app.catalog.domain import RoadmapStatus
from app.models import Art, Item, ItemKind, Product, RoadmapItem, Stream, roadmap_item_features


def test_roadmap_roundtrip(db_session):
    art = Art(name="A")
    db_session.add(art)
    db_session.flush()
    product = Product(name="Network", art_id=art.id)
    db_session.add(product)
    db_session.flush()
    stream = Stream(name="Campus access", product_id=product.id, position=1)
    db_session.add(stream)
    db_session.flush()
    item = RoadmapItem(title="Wi-Fi 7 rollout", stream_id=stream.id,
                       status=RoadmapStatus.COMMITTED,
                       start_date=date(2026, 1, 1), end_date=date(2026, 6, 30))
    feature = Item(kind=ItemKind.FEATURE, title="Wi-Fi 7 APs")
    db_session.add_all([item, feature])
    db_session.flush()
    db_session.execute(roadmap_item_features.insert().values(
        roadmap_item_id=item.id, feature_id=feature.id))
    db_session.commit()

    assert stream.product.name == "Network"
    assert item.stream.name == "Campus access"


def test_status_persists_value(db_session):
    from sqlalchemy import text

    art = Art(name="A")
    db_session.add(art)
    db_session.flush()
    product = Product(name="P", art_id=art.id)
    db_session.add(product)
    db_session.flush()
    stream = Stream(name="S", product_id=product.id)
    db_session.add(stream)
    db_session.flush()
    item = RoadmapItem(title="X", stream_id=stream.id, status=RoadmapStatus.COMMITTED,
                       start_date=date(2026, 1, 1), end_date=date(2026, 1, 2))
    db_session.add(item)
    db_session.commit()
    raw = db_session.execute(
        text("SELECT status FROM roadmap_items WHERE id = :i"), {"i": item.id}
    ).scalar_one()
    assert raw == "committed"
```

- [ ] **Step 2: RED** → **Step 3: implement models** — append to `models.py`:

```python
class Stream(Base):
    __tablename__ = "streams"
    __table_args__ = (UniqueConstraint("product_id", "name", name="uq_stream_product_name"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(128))
    product_id: Mapped[int] = mapped_column(
        ForeignKey("products.id", ondelete="RESTRICT"), index=True
    )
    position: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow, server_default=func.now()
    )

    product: Mapped["Product"] = relationship()


roadmap_item_features = Table(
    "roadmap_item_features",
    Base.metadata,
    Column("roadmap_item_id", Integer, ForeignKey("roadmap_items.id", ondelete="CASCADE"), primary_key=True),
    Column("feature_id", Integer, ForeignKey("items.id", ondelete="CASCADE"), primary_key=True),
)


class RoadmapItem(Base):
    __tablename__ = "roadmap_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    title: Mapped[str] = mapped_column(String(256))
    description: Mapped[str | None] = mapped_column(Text)
    stream_id: Mapped[int] = mapped_column(
        ForeignKey("streams.id", ondelete="RESTRICT"), index=True
    )
    status: Mapped[RoadmapStatus] = mapped_column(
        Enum(RoadmapStatus, native_enum=False,
             values_callable=lambda e: [m.value for m in e], length=16),
        default=RoadmapStatus.IDEA,
        server_default="idea",
    )
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    end_date: Mapped[date] = mapped_column(Date, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow, server_default=func.now()
    )

    stream: Mapped["Stream"] = relationship()
```

- [ ] **Step 4: GREEN** + full `pytest`.
- [ ] **Step 5: Migration** — `backend/alembic/versions/0029_roadmap_streams.py`:

```python
"""streams, roadmap_items, roadmap_item_features

Revision ID: 0029
Revises: 0028
"""
from alembic import op
import sqlalchemy as sa

revision = "0029"
down_revision = "0028"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "streams",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("name", sa.String(128), nullable=False),
        sa.Column("product_id", sa.Integer, sa.ForeignKey("products.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("position", sa.Integer, nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("product_id", "name", name="uq_stream_product_name"),
    )
    op.create_index("ix_streams_product_id", "streams", ["product_id"])
    op.create_table(
        "roadmap_items",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("title", sa.String(256), nullable=False),
        sa.Column("description", sa.Text),
        sa.Column("stream_id", sa.Integer, sa.ForeignKey("streams.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("status", sa.String(16), nullable=False, server_default="idea"),
        sa.Column("start_date", sa.Date, nullable=False),
        sa.Column("end_date", sa.Date, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_roadmap_items_stream_id", "roadmap_items", ["stream_id"])
    op.create_table(
        "roadmap_item_features",
        sa.Column("roadmap_item_id", sa.Integer, sa.ForeignKey("roadmap_items.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("feature_id", sa.Integer, sa.ForeignKey("items.id", ondelete="CASCADE"), primary_key=True),
    )


def downgrade() -> None:
    op.drop_table("roadmap_item_features")
    op.drop_table("roadmap_items")
    op.drop_table("streams")
```

- [ ] **Step 6: Dry-run** on compose Postgres (up → down → up). **Step 7: Commit** — `feat(roadmap): ORM + migration 0029 (streams, roadmap_items, feature links)`

---

### Task 3: Ports + Postgres adapter + guards

**Files:**
- Modify: `backend/app/catalog/ports.py`, `backend/app/catalog/adapters/postgres.py`, `backend/app/catalog/factory.py`
- Test: `backend/tests/catalog/test_roadmap_adapter.py`

**Interfaces (produces; both Protocols carry `read_only`):**

```python
class StreamRepository(Protocol):
    @property
    def read_only(self) -> bool: ...
    def list(self, product_id: int) -> list[Stream]: ...
    def get(self, stream_id: int) -> Stream: ...
    def create(self, *, name: str, product_id: int) -> Stream: ...
    def update(self, stream_id: int, changes: dict) -> Stream: ...
    def delete(self, stream_id: int) -> None: ...


class RoadmapItemRepository(Protocol):
    @property
    def read_only(self) -> bool: ...
    def get(self, item_id: int) -> RoadmapItem: ...
    def create(self, *, title: str, stream_id: int, start_date: date, end_date: date,
               description: str | None = None,
               status: RoadmapStatus = RoadmapStatus.IDEA) -> RoadmapItem: ...
    def update(self, item_id: int, changes: dict) -> RoadmapItem: ...
    def delete(self, item_id: int) -> None: ...
    def link_feature(self, item_id: int, feature_id: int) -> RoadmapItem: ...
    def unlink_feature(self, item_id: int, feature_id: int) -> RoadmapItem: ...
```

Adapter semantics (implement in `PostgresStreamRepository` / `PostgresRoadmapItemRepository`, mapping helpers `_to_stream(db, row)` / `_to_roadmap_item(db, row)` / `_roadmap_item_feature_rows(db, item_id)`):
- `Stream.list(product_id)` ordered `(position, name)`; nested `items` ordered `(start_date, id)`, each with `features` (LinkedFeature id/title/status from `m.Item`, title-ordered).
- `Stream.create`: product must exist (422 "product_id does not exist"); name unique per product (422 "A stream with this name already exists in this product"); `position` = current max for the product + 1 (0 when none... use max+1 with max defaulting to -1 so the first stream gets 0).
- `Stream.update`: accepts `name` (dup check excl. self) and/or `position` (int, no further rule).
- `Stream.delete`: guard `f"Stream has {n} roadmap item(s); delete them first"`.
- `RoadmapItem.create`: stream must exist (422 "stream_id does not exist"); `validate_date_range(start_date, end_date)`.
- `RoadmapItem.update`: fields `title, description, status, start_date, end_date, stream_id`; when `stream_id` in changes, target must exist and share the product (422 "Target stream must belong to the same product"); date rule on the effective post-change pair (`changes.get("start_date", row.start_date)` etc.) BEFORE applying.
- `RoadmapItem.delete`: removes `roadmap_item_features` rows explicitly, then the row.
- `link_feature`: item must exist (404 via `_row`); feature must exist AND `kind == ItemKind.FEATURE` (422 "Only features can be linked"); duplicate → 422 "This link already exists"; returns fresh item.
- `unlink_feature`: missing link → 404 "Link not found"; returns fresh item.
- `PostgresProductRepository.delete`: new guard after contracts — `f"Product has {n} stream(s); delete them first"`.
- Factory: `get_stream_repo`, `get_roadmap_item_repo`.

- [ ] **Step 1: Failing tests** — `backend/tests/catalog/test_roadmap_adapter.py`:

```python
from datetime import date

import pytest

from app.catalog.adapters.postgres import (
    PostgresArtRepository,
    PostgresProductRepository,
    PostgresRoadmapItemRepository,
    PostgresStreamRepository,
)
from app.catalog.domain import (
    CatalogInUse,
    CatalogNotFound,
    CatalogRuleViolation,
    RoadmapStatus,
)
from app.models import Item, ItemKind

D1, D2 = date(2026, 1, 1), date(2026, 6, 30)


@pytest.fixture()
def env(db_session):
    arts = PostgresArtRepository(db_session)
    products = PostgresProductRepository(db_session)
    art = arts.create(name="ART")
    product = products.create(name="Network", art_id=art.id)
    return {
        "db": db_session, "products": products, "product": product,
        "streams": PostgresStreamRepository(db_session),
        "items": PostgresRoadmapItemRepository(db_session),
    }


def test_stream_crud_and_positions(env):
    streams = env["streams"]
    pid = env["product"].id
    s1 = streams.create(name="Campus", product_id=pid)
    s2 = streams.create(name="Backbone", product_id=pid)
    assert (s1.position, s2.position) == (0, 1)
    with pytest.raises(CatalogRuleViolation):
        streams.create(name="Campus", product_id=pid)
    streams.update(s2.id, {"position": 0, "name": "Backbone Net"})
    listed = streams.list(pid)
    assert [s.name for s in listed] == ["Backbone Net", "Campus"]
    streams.delete(s2.id)
    with pytest.raises(CatalogNotFound):
        streams.get(s2.id)


def test_item_crud_dates_and_grouping(env):
    streams, items = env["streams"], env["items"]
    s = streams.create(name="Campus", product_id=env["product"].id)
    with pytest.raises(CatalogRuleViolation):
        items.create(title="Bad", stream_id=s.id, start_date=D2, end_date=D1)
    b = items.create(title="B", stream_id=s.id, start_date=date(2026, 3, 1), end_date=D2)
    a = items.create(title="A", stream_id=s.id, start_date=D1, end_date=D2,
                     status=RoadmapStatus.COMMITTED)
    listed = streams.list(env["product"].id)[0]
    assert [i.title for i in listed.items] == ["A", "B"]
    with pytest.raises(CatalogRuleViolation):
        items.update(b.id, {"end_date": date(2026, 2, 1)})  # would invert vs start 03-01
    items.update(b.id, {"start_date": date(2026, 2, 1), "end_date": date(2026, 2, 1)})
    assert items.get(b.id).start_date == date(2026, 2, 1)
    assert a.status == RoadmapStatus.COMMITTED


def test_stream_move_same_product_rule(env):
    arts = PostgresArtRepository(env["db"])
    other = env["products"].create(name="Other", art_id=arts.list()[0].id)
    s1 = env["streams"].create(name="Campus", product_id=env["product"].id)
    foreign = env["streams"].create(name="Foreign", product_id=other.id)
    item = env["items"].create(title="X", stream_id=s1.id, start_date=D1, end_date=D2)
    with pytest.raises(CatalogRuleViolation):
        env["items"].update(item.id, {"stream_id": foreign.id})
    s2 = env["streams"].create(name="Backbone", product_id=env["product"].id)
    assert env["items"].update(item.id, {"stream_id": s2.id}).stream_id == s2.id


def test_feature_links(env):
    s = env["streams"].create(name="Campus", product_id=env["product"].id)
    item = env["items"].create(title="X", stream_id=s.id, start_date=D1, end_date=D2)
    feature = Item(kind=ItemKind.FEATURE, title="Wi-Fi 7 APs", status="New")
    story = Item(kind=ItemKind.STORY, title="Not linkable")
    env["db"].add_all([feature, story])
    env["db"].flush()
    got = env["items"].link_feature(item.id, feature.id)
    assert [f.title for f in got.features] == ["Wi-Fi 7 APs"]
    assert got.features[0].status == "New"
    with pytest.raises(CatalogRuleViolation):
        env["items"].link_feature(item.id, feature.id)  # duplicate
    with pytest.raises(CatalogRuleViolation):
        env["items"].link_feature(item.id, story.id)  # not a feature
    got = env["items"].unlink_feature(item.id, feature.id)
    assert got.features == []
    with pytest.raises(CatalogNotFound):
        env["items"].unlink_feature(item.id, feature.id)


def test_guards(env):
    streams = env["streams"]
    s = streams.create(name="Campus", product_id=env["product"].id)
    env["items"].create(title="X", stream_id=s.id, start_date=D1, end_date=D2)
    with pytest.raises(CatalogInUse):
        streams.delete(s.id)
    with pytest.raises(CatalogInUse):
        env["products"].delete(env["product"].id)  # has streams


def test_item_delete_removes_links(env):
    from sqlalchemy import func, select
    from app.models import roadmap_item_features

    s = env["streams"].create(name="Campus", product_id=env["product"].id)
    item = env["items"].create(title="X", stream_id=s.id, start_date=D1, end_date=D2)
    feature = Item(kind=ItemKind.FEATURE, title="F")
    env["db"].add(feature)
    env["db"].flush()
    env["items"].link_feature(item.id, feature.id)
    env["items"].delete(item.id)
    assert env["db"].scalar(select(func.count()).select_from(roadmap_item_features)) == 0
```

- [ ] **Step 2: RED** → **Step 3: implement** ports (Interfaces verbatim; extend the domain import with `RoadmapItem, RoadmapStatus, Stream`), adapter classes per the semantics above following `PostgresContractRepository`'s structure byte-for-byte (`_row` 404 helpers, `_validate_name` per product, flush-only, Core insert/delete for the association table), product-guard extension, factory functions.
- [ ] **Step 4: GREEN** + full `pytest`. **Step 5: Commit** — `feat(roadmap): stream + roadmap-item repositories, guards, factory`

---

### Task 4: Schemas + roadmap router

**Files:**
- Modify: `backend/app/schemas.py`
- Create: `backend/app/routers/roadmap.py`
- Modify: `backend/app/main.py` (register `roadmap`)
- Test: `backend/tests/catalog/test_roadmap_api.py`

**Interfaces (produces):** schemas (import `RoadmapStatus` from domain):

```python
class LinkedFeatureRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    title: str
    status: str | None = None


class RoadmapItemRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    title: str
    description: str | None = None
    stream_id: int
    status: RoadmapStatus
    start_date: date
    end_date: date
    features: list[LinkedFeatureRead] = []


class StreamRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    product_id: int
    position: int
    items: list[RoadmapItemRead] = []


class StreamCreate(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    product_id: int


class StreamUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str | None = Field(default=None, min_length=1, max_length=128)
    position: int | None = Field(default=None, ge=0)


class RoadmapItemCreate(BaseModel):
    title: str = Field(min_length=1, max_length=256)
    stream_id: int
    start_date: date
    end_date: date
    description: str | None = None
    status: RoadmapStatus = RoadmapStatus.IDEA


class RoadmapItemUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str | None = Field(default=None, min_length=1, max_length=256)
    description: str | None = None
    stream_id: int | None = None
    status: RoadmapStatus | None = None
    start_date: date | None = None
    end_date: date | None = None


class RoadmapFeatureLink(BaseModel):
    feature_id: int
```

Router `backend/app/routers/roadmap.py` (prefix `/api/v1`, tags `["roadmap"]`), following `contracts.py` structure byte-for-byte:
- `GET /products/{product_id}/roadmap` → product existence via `get_product_repo().get()` (404), then `stream_repo.list(product_id)`.
- `POST /streams` (201) / `PATCH /streams/{id}` / `DELETE /streams/{id}` (204). PATCH audit field-level over name/position.
- `POST /roadmap-items` (201) / `GET|PATCH|DELETE /roadmap-items/{id}` (DELETE 204). PATCH audit field-level over title/description/status/start_date/end_date via the `_s()` pattern; stream move detected by `stream_id`, logged as field "stream" with old/new stream NAMES (fetch via `stream_repo.get`).
- `POST /roadmap-items/{id}/features` (201, RoadmapItemRead) / `DELETE /roadmap-items/{id}/features/{feature_id}` (200, RoadmapItemRead); audit `roadmap_item.feature_linked/unlinked`, field "feature", TITLE as value (unlink fetches title from the pre-removal item's features list).

- [ ] **Step 1: Failing tests** — `backend/tests/catalog/test_roadmap_api.py`:

```python
import pytest

from app.models import AuditEvent


@pytest.fixture()
def env(client, member_client):
    art_id = client.post("/api/v1/arts", json={"name": "ART"}).json()["id"]
    pid = client.post("/api/v1/products", json={"name": "Network", "art_id": art_id}).json()["id"]
    fid = member_client.post("/api/v1/items",
                             json={"kind": "feature", "title": "Wi-Fi 7 APs"}).json()["id"]
    return {"pid": pid, "fid": fid}


def test_stream_and_item_flow(member_client, env):
    sid = member_client.post("/api/v1/streams",
                             json={"name": "Campus", "product_id": env["pid"]}).json()["id"]
    r = member_client.post("/api/v1/roadmap-items", json={
        "title": "Wi-Fi 7 rollout", "stream_id": sid,
        "start_date": "2026-01-01", "end_date": "2026-06-30", "status": "committed",
    })
    assert r.status_code == 201
    iid = r.json()["id"]
    roadmap = member_client.get(f"/api/v1/products/{env['pid']}/roadmap").json()
    assert roadmap[0]["name"] == "Campus"
    assert roadmap[0]["items"][0]["title"] == "Wi-Fi 7 rollout"
    assert roadmap[0]["items"][0]["status"] == "committed"
    r = member_client.patch(f"/api/v1/roadmap-items/{iid}", json={"status": "done"})
    assert r.json()["status"] == "done"
    assert member_client.delete(f"/api/v1/roadmap-items/{iid}").status_code == 204
    assert member_client.delete(f"/api/v1/streams/{sid}").status_code == 204


def test_date_rule_422(member_client, env):
    sid = member_client.post("/api/v1/streams",
                             json={"name": "S", "product_id": env["pid"]}).json()["id"]
    assert member_client.post("/api/v1/roadmap-items", json={
        "title": "Bad", "stream_id": sid,
        "start_date": "2026-06-30", "end_date": "2026-01-01",
    }).status_code == 422


def test_feature_link_flow(member_client, env):
    sid = member_client.post("/api/v1/streams",
                             json={"name": "S", "product_id": env["pid"]}).json()["id"]
    iid = member_client.post("/api/v1/roadmap-items", json={
        "title": "X", "stream_id": sid,
        "start_date": "2026-01-01", "end_date": "2026-06-30"}).json()["id"]
    r = member_client.post(f"/api/v1/roadmap-items/{iid}/features",
                           json={"feature_id": env["fid"]})
    assert r.status_code == 201
    assert r.json()["features"][0]["title"] == "Wi-Fi 7 APs"
    assert member_client.post(f"/api/v1/roadmap-items/{iid}/features",
                              json={"feature_id": env["fid"]}).status_code == 422
    r = member_client.delete(f"/api/v1/roadmap-items/{iid}/features/{env['fid']}")
    assert r.status_code == 200
    assert r.json()["features"] == []


def test_stream_delete_guard_409(member_client, env):
    sid = member_client.post("/api/v1/streams",
                             json={"name": "S", "product_id": env["pid"]}).json()["id"]
    member_client.post("/api/v1/roadmap-items", json={
        "title": "X", "stream_id": sid,
        "start_date": "2026-01-01", "end_date": "2026-06-30"})
    assert member_client.delete(f"/api/v1/streams/{sid}").status_code == 409


def test_item_update_field_level_audit(client, env, db_session):
    s1 = client.post("/api/v1/streams",
                     json={"name": "S1", "product_id": env["pid"]}).json()["id"]
    s2 = client.post("/api/v1/streams",
                     json={"name": "S2", "product_id": env["pid"]}).json()["id"]
    iid = client.post("/api/v1/roadmap-items", json={
        "title": "X", "stream_id": s1,
        "start_date": "2026-01-01", "end_date": "2026-06-30"}).json()["id"]
    db_session.query(AuditEvent).filter_by(event_type="roadmap_item.updated").delete()
    client.patch(f"/api/v1/roadmap-items/{iid}", json={
        "status": "planned", "stream_id": s2, "title": "X"})
    events = db_session.query(AuditEvent).filter_by(event_type="roadmap_item.updated").all()
    by_field = {e.field: e for e in events}
    assert by_field["status"].new_value == "planned"
    assert by_field["stream"].old_value == "S1"
    assert by_field["stream"].new_value == "S2"
    assert "title" not in by_field
```

- [ ] **Step 2: RED** → **Step 3: implement** schemas + router + main.py wiring → **Step 4: GREEN** + full `pytest`. **Step 5: Commit** — `feat(roadmap): streams + roadmap-items API with feature links`

---

### Task 5: Frontend types + client

**Files:**
- Modify: `frontend/src/types.ts`, `frontend/src/api/client.ts`
- Test: extend `frontend/src/api/client.test.ts`

**Interfaces (produces):**

```ts
export type RoadmapStatus = "idea" | "planned" | "committed" | "done" | "cancelled";

export interface LinkedFeature {
  id: number;
  title: string;
  status: string | null;
}

export interface RoadmapItem {
  id: number;
  title: string;
  description: string | null;
  stream_id: number;
  status: RoadmapStatus;
  start_date: string;
  end_date: string;
  features: LinkedFeature[];
}

export interface Stream {
  id: number;
  name: string;
  product_id: number;
  position: number;
  items: RoadmapItem[];
}
```

Client: `getProductRoadmap(productId): Promise<Stream[]>` → GET `${API}/products/${productId}/roadmap`; `createStream(name: string, productId: number): Promise<Stream>` → POST `${API}/streams`; `updateStream(id, changes: Partial<{name: string; position: number}>): Promise<Stream>` → PATCH; `deleteStream(id): Promise<void>`; `createRoadmapItem(payload: {title; stream_id; start_date; end_date; description?; status?}): Promise<RoadmapItem>` → POST `${API}/roadmap-items`; `updateRoadmapItem(id, changes): Promise<RoadmapItem>` → PATCH; `deleteRoadmapItem(id): Promise<void>`; `linkRoadmapFeature(id, featureId): Promise<RoadmapItem>` → POST `${API}/roadmap-items/${id}/features` `{feature_id}`; `unlinkRoadmapFeature(id, featureId): Promise<RoadmapItem>` → DELETE `.../features/${featureId}`. (Feature options in the drawer reuse the existing `listItems({ kind: "feature" })` — no new function.)

- [ ] **Step 1:** failing tests (mockFetch idiom): URL for getProductRoadmap; URL+method+body for createStream/createRoadmapItem/updateRoadmapItem/linkRoadmapFeature; URL+method for deleteStream/unlinkRoadmapFeature.
- [ ] **Step 2: RED** → **Step 3: implement** → **Step 4: GREEN** + `npm run build`. **Step 5: Commit** — `feat(roadmap): frontend types + client`

---

### Task 6: Geometry helper `lib/roadmap.ts`

**Files:**
- Create: `frontend/src/lib/roadmap.ts`
- Test: `frontend/src/lib/roadmap.test.ts`

**Interfaces (produces):**

```ts
export interface MonthTick { label: string; leftPct: number; }
export interface AxisRange { startMs: number; endMs: number; months: MonthTick[]; todayPct: number | null; }

/** Axis spanning all items padded to whole months, always including today's month. */
export function axisRange(
  items: { start_date: string; end_date: string }[],
  today: Date,
): AxisRange;

/** Bar position within the axis as percentages; width floors at 1.5%. */
export function barGeometry(
  item: { start_date: string; end_date: string },
  range: AxisRange,
): { leftPct: number; widthPct: number };
```

Semantics: parse `"YYYY-MM-DD"` as UTC. Axis start = first day of the earliest month among items+today; axis end = first day of the month AFTER the latest month among items+today (exclusive end). `months` = one tick per month with `label` like `"Aug 26"` (en-US short month + 2-digit year) and `leftPct` of the month start. `todayPct` = today's position (always inside by construction). `barGeometry` clamps into [0,100] and enforces `widthPct >= 1.5` (single-day items visible); the bar's right edge is the END of the end_date day (add one day, exclusive).

- [ ] **Step 1: Failing tests** — `frontend/src/lib/roadmap.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { axisRange, barGeometry } from "./roadmap";

const TODAY = new Date(Date.UTC(2026, 6, 26)); // 2026-07-26

describe("axisRange", () => {
  it("pads to whole months and includes today", () => {
    const r = axisRange(
      [{ start_date: "2026-01-15", end_date: "2026-03-10" }],
      TODAY,
    );
    expect(new Date(r.startMs).toISOString().slice(0, 10)).toBe("2026-01-01");
    // latest month is July (today) -> exclusive end = Aug 1
    expect(new Date(r.endMs).toISOString().slice(0, 10)).toBe("2026-08-01");
    expect(r.months).toHaveLength(7);
    expect(r.months[0].label).toBe("Jan 26");
    expect(r.months[0].leftPct).toBe(0);
    expect(r.todayPct).toBeGreaterThan(85);
  });

  it("with no items spans today's month alone", () => {
    const r = axisRange([], TODAY);
    expect(r.months).toHaveLength(1);
    expect(r.months[0].label).toBe("Jul 26");
  });
});

describe("barGeometry", () => {
  const range = axisRange(
    [{ start_date: "2026-01-01", end_date: "2026-06-30" }],
    TODAY,
  ); // axis Jan 1 .. Aug 1 (212 days)

  it("computes left and width percentages", () => {
    const g = barGeometry({ start_date: "2026-01-01", end_date: "2026-06-30" }, range);
    expect(g.leftPct).toBe(0);
    expect(g.widthPct).toBeCloseTo((181 / 212) * 100, 1);
  });

  it("floors tiny bars at 1.5% and clamps into the axis", () => {
    const g = barGeometry({ start_date: "2026-02-01", end_date: "2026-02-01" }, range);
    expect(g.widthPct).toBe(1.5);
    expect(g.leftPct).toBeGreaterThan(0);
    expect(g.leftPct + g.widthPct).toBeLessThanOrEqual(100);
  });
});
```

- [ ] **Step 2: RED** → **Step 3: implement** (pure functions, `Date.UTC` arithmetic, no deps) → **Step 4: GREEN**. **Step 5: Commit** — `feat(roadmap): timeline geometry helper`

---

### Task 7: RoadmapView — lanes, bars, stream management, navigation

**Files:**
- Create: `frontend/src/components/RoadmapView.tsx`
- Modify: `frontend/src/App.tsx` (View union + `{navButton("roadmap", "Roadmap")}` after Contracts + render branch)
- Test: `frontend/src/components/RoadmapView.test.tsx`

**Interfaces:**
- `<RoadmapView />` self-contained: loads `getProducts()`; product FilterSelect (`label "Product"`, `allowAll={false}`, defaults to first product name); loads `getProductRoadmap(productId)` on selection (loading-before-empty; empty state "No streams yet. Add one to start the roadmap.").
- Month axis header from `axisRange` (all items across all streams + today): tick labels positioned at `leftPct`, vertical gridlines, a red "today" line at `todayPct` (aria-hidden, `title="Today"`).
- Lanes: streams in server order. Lane header (left column, w-56): stream name with inline rename (`aria-label` `Rename <name>`, Enter commits via `updateStream(id, {name})`, Escape cancels), reorder buttons `Move <name> up` / `Move <name> down` (swap `position` values with the neighbor via two `updateStream` calls, then refetch; first/last disabled), delete button `Delete <name>` behind ConfirmDialog (guarded 409 → view error strip). Lane body: relative container with the gridlines; item bars absolutely positioned via `barGeometry`, classes from the STATUS map (Global Constraints), `title` tooltip = `"{title}: {start} → {end}"`, click opens the drawer. "Add item" button per lane (opens drawer in create mode with the stream preset). "Add stream" input + button below the lanes.
- Error strip at the top (view-level mutations: stream rename/reorder/delete/add — the `run()`-style helper from CatalogSection, incl. load-failure surfacing).
- Drawer wiring: `RoadmapItemDrawer` (Task 8) rendered with `key={editing?.id ?? "new"}`; until Task 8 lands, create a minimal placeholder `frontend/src/components/RoadmapItemDrawer.tsx` (renders `<aside aria-label="Roadmap item drawer" />`, Task 8 replaces it entirely).

- [ ] **Step 1: Failing tests** — `frontend/src/components/RoadmapView.test.tsx` (mock `../api/client` with getProducts/getProductRoadmap/createStream/updateStream/deleteStream + drawer deps stubbed; fixtures: product "Network"; streams `[{id:1,name:"Campus",product_id:1,position:0,items:[{id:9,title:"Wi-Fi 7 rollout",description:null,stream_id:1,status:"committed",start_date:"2026-01-01",end_date:"2026-06-30",features:[]}]},{id:2,name:"Backbone",product_id:1,position:1,items:[]}]`):

```tsx
it("renders lanes with status-colored bars and month axis", async () => {
  render(<RoadmapView />);
  expect(await screen.findByText("Campus")).toBeInTheDocument();
  expect(screen.getByText("Backbone")).toBeInTheDocument();
  const bar = await screen.findByText("Wi-Fi 7 rollout");
  expect(bar.closest("button")?.className).toContain("bg-violet-100");
  expect(screen.getByText("Jan 26")).toBeInTheDocument();
});

it("adds a stream", async () => {
  render(<RoadmapView />);
  await screen.findByText("Campus");
  await userEvent.type(screen.getByPlaceholderText("New stream name"), "Datacenter");
  await userEvent.click(screen.getByRole("button", { name: "Add stream" }));
  expect(createStream).toHaveBeenCalledWith("Datacenter", 1);
});

it("reorders streams by swapping positions", async () => {
  render(<RoadmapView />);
  await screen.findByText("Campus");
  await userEvent.click(screen.getByRole("button", { name: "Move Backbone up" }));
  expect(updateStream).toHaveBeenCalledWith(2, { position: 0 });
  expect(updateStream).toHaveBeenCalledWith(1, { position: 1 });
});

it("renames a stream inline", async () => {
  render(<RoadmapView />);
  await screen.findByText("Campus");
  await userEvent.click(screen.getByRole("button", { name: "Rename Campus" }));
  const input = screen.getByRole("textbox", { name: "Rename Campus" });
  await userEvent.clear(input);
  await userEvent.type(input, "Campus LAN{Enter}");
  expect(updateStream).toHaveBeenCalledWith(1, { name: "Campus LAN" });
});
```

- [ ] **Step 2: RED** → **Step 3: implement** (+ placeholder drawer + App wiring) → **Step 4: GREEN** + all existing tests + `npm run build` + full `npm run test`. **Step 5: Commit** — `feat(roadmap): Roadmap view with swimlanes, bars, stream management + navigation`

---

### Task 8: RoadmapItemDrawer

**Files:**
- Replace: `frontend/src/components/RoadmapItemDrawer.tsx` (placeholder from Task 7)
- Test: extend `frontend/src/components/RoadmapView.test.tsx`

**Interfaces:**
- `RoadmapItemDrawer({ item, streams, defaultStreamId, onClose, onChanged })` — `item: RoadmapItem | null` (create/edit); `streams: Stream[]` (the product's streams, for the stream PlainSelect labeled by name); `defaultStreamId: number | null` (preset for per-lane "Add item").
- Fields (all aria-labeled): "Title" text input; "Description" textarea; "Status" PlainSelect (`["idea","planned","committed","done","cancelled"]`, clearable=false); "Start date"/"End date" `<input type="date">` — client-side check on Save: if start > end, `setError("Start date must not be after end date")` and DON'T submit; "Stream" PlainSelect over stream names (edit + create; resolves name→id).
- Create → `createRoadmapItem({title, stream_id, start_date, end_date, description?, status})`; edit → `updateRoadmapItem` only-changed-keys. Save/Cancel/Delete(ConfirmDialog, edit only) + error strip; onChanged after successful save/delete.
- Edit mode only — "Linked features" section: rows `title` + muted feature status + `Unlink <title>` button; add via SearchableSelect `ariaLabel "Link feature"` over features fetched once via `listItems({ kind: "feature" })`, labeled `"{title} (#{id})"`, excluding linked; link/unlink update local `features` from the returned RoadmapItem AND `await onChanged()`.

- [ ] **Step 1: Failing tests** (append to RoadmapView.test.tsx; extend mocks with createRoadmapItem/updateRoadmapItem/deleteRoadmapItem/linkRoadmapFeature/unlinkRoadmapFeature/listItems):

```tsx
it("creates an item from a lane's Add item button", async () => {
  vi.mocked(createRoadmapItem).mockResolvedValue(itemFixture);
  render(<RoadmapView />);
  await screen.findByText("Campus");
  await userEvent.click(screen.getAllByRole("button", { name: "Add item" })[0]);
  await userEvent.type(screen.getByLabelText("Title"), "New thing");
  await userEvent.type(screen.getByLabelText("Start date"), "2026-09-01");
  await userEvent.type(screen.getByLabelText("End date"), "2026-12-31");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(vi.mocked(createRoadmapItem).mock.calls[0][0]).toMatchObject({
    title: "New thing", stream_id: 1,
    start_date: "2026-09-01", end_date: "2026-12-31",
  });
});

it("blocks save when dates are inverted", async () => {
  render(<RoadmapView />);
  await screen.findByText("Campus");
  await userEvent.click(screen.getAllByRole("button", { name: "Add item" })[0]);
  await userEvent.type(screen.getByLabelText("Title"), "Bad");
  await userEvent.type(screen.getByLabelText("Start date"), "2026-12-31");
  await userEvent.type(screen.getByLabelText("End date"), "2026-01-01");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(screen.getByText("Start date must not be after end date")).toBeInTheDocument();
  expect(createRoadmapItem).not.toHaveBeenCalled();
});

it("links a feature in edit mode", async () => {
  vi.mocked(listItems).mockResolvedValue([
    { id: 42, title: "Wi-Fi 7 APs", status: "New" } as never,
  ]);
  vi.mocked(linkRoadmapFeature).mockResolvedValue({
    ...itemFixture, features: [{ id: 42, title: "Wi-Fi 7 APs", status: "New" }],
  });
  render(<RoadmapView />);
  await userEvent.click(await screen.findByText("Wi-Fi 7 rollout"));
  await userEvent.click(await screen.findByRole("combobox", { name: "Link feature" }));
  await userEvent.click(screen.getByText("Wi-Fi 7 APs (#42)"));
  expect(linkRoadmapFeature).toHaveBeenCalledWith(9, 42);
});
```

- [ ] **Step 2: RED** → **Step 3: implement** (mirror ContractDrawer's structure) → **Step 4: GREEN** + `npm run build` + full `npm run test`. **Step 5: Commit** — `feat(roadmap): roadmap item drawer with feature links`

---

### Task 9: Full verification + docs

**Files:** `CLAUDE.md` (migration head → `0029`; views eight → nine adding Roadmap; catalog bullet gains streams/roadmap items/feature links).

- [ ] **Step 1:** Full suites (BE `pytest`, FE `npm run test` + `npm run build`; known App.auth flake judged by counts).
- [ ] **Step 2:** Stack: FA token export (never echo) → `docker compose build backend frontend && docker compose up -d`; alembic at `0029`. Playwright walkthrough on product "Network": add streams "Campus access" + "Backbone"; add item "Wi-Fi 7 rollout" (committed, ~6-month range crossing today) → violet bar, today line visible; drawer: link an existing feature, verify row; move item to Backbone via drawer; rename + reorder streams; stream delete guard 409 while items exist; delete item then stream; dark-mode check; clean up all demo data (leave pre-existing rows).
- [ ] **Step 3:** CLAUDE.md updates; commit `docs: product roadmaps + migration head 0029`. STOP — controller handles branch finishing.
