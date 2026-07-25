# Product & Service Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add ARTs, Products (team ≙ product), Services/sub-services with typed dependencies, and a DDD repository seam for future external datasources — per the approved spec `docs/superpowers/specs/2026-07-25-product-service-catalog-design.md`.

**Architecture:** New bounded-context package `backend/app/catalog/` (domain dataclasses, repository Protocols, Postgres adapter, factory). ORM tables stay in `app/models.py` (single Alembic metadata, SQLite test fixtures). Routers depend only on ports. `items.art` free text becomes a FK to the new `arts` table; the item API keeps exposing `art` as a string. Frontend gets a top-level Products view and an Admin → Catalog section.

**Tech Stack:** FastAPI, SQLAlchemy 2.0, Alembic, Pydantic v2, pytest; React + TypeScript + Tailwind v4, Vitest + Testing Library.

## Global Constraints

- API base is `/api/v1` (all new routers use prefix `/api/v1/...`).
- All new routers mount under `Depends(require_user)` in `main.py`; ART/product writes additionally `Depends(require_admin)` per-endpoint.
- Never import `DateTime` from sqlalchemy for a column — use `from app.timeutil import DateTime, utcnow` (tz-normalizing TypeDecorator).
- Enums on ORM columns use `Enum(..., native_enum=False)`.
- Domain layer (`app/catalog/domain.py`) must not import SQLAlchemy or FastAPI.
- Lifecycle states: `planned | active | deprecated | retired` (default `planned`). Dependency types: `requires | uses`. Criticalities: `critical | important | optional`.
- Error mapping: `CatalogNotFound` → 404, `CatalogRuleViolation` → 422, `CatalogInUse` → 409, read-only repo write → 405.
- Migrations must be dry-run (`alembic upgrade head` AND `alembic downgrade -1`) against the compose Postgres before a task is complete — SQLite fixtures never exercise the DDL.
- Frontend: custom dropdowns only (`PlainSelect`/`SearchableSelect`) — never native `<select>`. Icons only via `frontend/src/icons.ts`.
- Backend commands run from `backend/` with the venv active (`. .venv/bin/activate`); frontend commands from `frontend/`.
- Work on branch `feat/product-service-catalog` off `main`.

---

### Task 1: Catalog domain layer

**Files:**
- Create: `backend/app/catalog/__init__.py` (empty)
- Create: `backend/app/catalog/domain.py`
- Test: `backend/tests/catalog/__init__.py` (empty), `backend/tests/catalog/test_domain.py`

**Interfaces:**
- Consumes: nothing (pure stdlib).
- Produces: dataclasses `Art(id, name, description)`, `Product(id, name, art_id, description, team_id, art_name, team_name, service_count)`, `Service(id, name, product_id, description, parent_service_id, owner_user_id, lifecycle_state, owner_name, product_name, children)`, `ServiceDependency(id, from_service_id, to_service_id, dep_type, criticality, note, from_service_name, to_service_name, from_product_name, to_product_name)`; enums `LifecycleState`, `DependencyType`, `Criticality`; exceptions `CatalogError`, `CatalogNotFound`, `CatalogRuleViolation`, `CatalogInUse`; validators `validate_parent(service_id, product_id, parent)` and `validate_dependency(from_service_id, to_service_id)`.

- [ ] **Step 1: Write the failing tests**

`backend/tests/catalog/test_domain.py`:

```python
import pytest

from app.catalog.domain import (
    CatalogRuleViolation,
    LifecycleState,
    Service,
    validate_dependency,
    validate_parent,
)


def _svc(id=1, product_id=10, parent=None):
    return Service(id=id, name=f"svc{id}", product_id=product_id, parent_service_id=parent)


def test_validate_parent_accepts_same_product():
    validate_parent(service_id=2, product_id=10, parent=_svc(id=1, product_id=10))


def test_validate_parent_rejects_other_product():
    with pytest.raises(CatalogRuleViolation):
        validate_parent(service_id=2, product_id=10, parent=_svc(id=1, product_id=99))


def test_validate_parent_rejects_self():
    with pytest.raises(CatalogRuleViolation):
        validate_parent(service_id=1, product_id=10, parent=_svc(id=1, product_id=10))


def test_validate_parent_allows_none():
    validate_parent(service_id=1, product_id=10, parent=None)


def test_validate_dependency_rejects_self_loop():
    with pytest.raises(CatalogRuleViolation):
        validate_dependency(5, 5)


def test_service_defaults():
    s = _svc()
    assert s.lifecycle_state == LifecycleState.PLANNED
    assert s.children == []
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/catalog/test_domain.py -v`
Expected: FAIL / collection error — `ModuleNotFoundError: No module named 'app.catalog'`

- [ ] **Step 3: Implement the domain module**

`backend/app/catalog/domain.py`:

```python
"""Catalog bounded context — pure domain layer.

No SQLAlchemy or FastAPI imports here: these dataclasses are what the
repository ports (app/catalog/ports.py) traffic in, regardless of whether
the backing store is Postgres or, later, an external API (ServiceNow,
LeanIX, Jira)."""
from __future__ import annotations

import enum
from dataclasses import dataclass, field


class LifecycleState(str, enum.Enum):
    PLANNED = "planned"
    ACTIVE = "active"
    DEPRECATED = "deprecated"
    RETIRED = "retired"


class DependencyType(str, enum.Enum):
    REQUIRES = "requires"
    USES = "uses"


class Criticality(str, enum.Enum):
    CRITICAL = "critical"
    IMPORTANT = "important"
    OPTIONAL = "optional"


class CatalogError(Exception):
    """Base for catalog domain errors."""


class CatalogNotFound(CatalogError):
    """Entity does not exist (HTTP 404)."""


class CatalogRuleViolation(CatalogError):
    """Domain rule broken — bad parent, duplicate, self-loop (HTTP 422)."""


class CatalogInUse(CatalogError):
    """Deletion blocked by dependents (HTTP 409)."""


@dataclass
class Art:
    id: int | None
    name: str
    description: str | None = None


@dataclass
class Product:
    id: int | None
    name: str
    art_id: int
    description: str | None = None
    team_id: int | None = None
    # read-side enrichments filled by adapters
    art_name: str | None = None
    team_name: str | None = None
    service_count: int = 0


@dataclass
class Service:
    id: int | None
    name: str
    product_id: int
    description: str | None = None
    parent_service_id: int | None = None
    owner_user_id: int | None = None
    lifecycle_state: LifecycleState = LifecycleState.PLANNED
    # read-side enrichments filled by adapters
    owner_name: str | None = None
    product_name: str | None = None
    children: list["Service"] = field(default_factory=list)


@dataclass
class ServiceDependency:
    id: int | None
    from_service_id: int
    to_service_id: int
    dep_type: DependencyType
    criticality: Criticality
    note: str | None = None
    # read-side enrichments filled by adapters
    from_service_name: str | None = None
    to_service_name: str | None = None
    from_product_name: str | None = None
    to_product_name: str | None = None


def validate_parent(*, service_id: int | None, product_id: int, parent: Service | None) -> None:
    """A parent must exist in the same product and must not be the service itself.
    (The full ancestor-cycle walk needs storage access and lives in the adapter.)"""
    if parent is None:
        return
    if service_id is not None and parent.id == service_id:
        raise CatalogRuleViolation("A service cannot be its own parent")
    if parent.product_id != product_id:
        raise CatalogRuleViolation("Parent service must belong to the same product")


def validate_dependency(from_service_id: int, to_service_id: int) -> None:
    if from_service_id == to_service_id:
        raise CatalogRuleViolation("A service cannot depend on itself")
```

Also create empty `backend/app/catalog/__init__.py` and `backend/tests/catalog/__init__.py`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/catalog/test_domain.py -v`
Expected: 6 passed

- [ ] **Step 5: Commit**

```bash
git checkout -b feat/product-service-catalog
git add backend/app/catalog backend/tests/catalog
git commit -m "feat(catalog): domain layer — dataclasses, enums, errors, validators"
```

---

### Task 2: Catalog ORM tables + migration 0025

**Files:**
- Modify: `backend/app/models.py` (append after `LdapConfig`/`BackupRun`, import enums at top)
- Create: `backend/alembic/versions/0025_catalog_tables.py`
- Test: `backend/tests/catalog/test_models.py`

**Interfaces:**
- Consumes: `LifecycleState`, `DependencyType`, `Criticality` from Task 1.
- Produces: ORM classes `Art`, `Product`, `Service`, `ServiceDependency` in `app.models` with relationships `Product.art`, `Product.team`, `Service.product`, `Service.owner`, `ServiceDependency.from_service`, `ServiceDependency.to_service`.

- [ ] **Step 1: Write the failing test**

`backend/tests/catalog/test_models.py`:

```python
from app.catalog.domain import Criticality, DependencyType, LifecycleState
from app.models import Art, Product, Service, ServiceDependency, Team


def test_catalog_models_roundtrip(db_session):
    art = Art(name="Platform ART")
    team = Team(name="Network")
    db_session.add_all([art, team])
    db_session.flush()
    product = Product(name="Network Product", art_id=art.id, team_id=team.id)
    db_session.add(product)
    db_session.flush()
    parent = Service(name="Connectivity", product_id=product.id)
    db_session.add(parent)
    db_session.flush()
    child = Service(
        name="Campus LAN", product_id=product.id,
        parent_service_id=parent.id, lifecycle_state=LifecycleState.ACTIVE,
    )
    db_session.add(child)
    db_session.flush()
    dep = ServiceDependency(
        from_service_id=child.id, to_service_id=parent.id,
        dep_type=DependencyType.REQUIRES, criticality=Criticality.CRITICAL,
    )
    db_session.add(dep)
    db_session.commit()

    assert product.art.name == "Platform ART"
    assert product.team.name == "Network"
    assert child.product.name == "Network Product"
    assert dep.from_service.name == "Campus LAN"
    assert dep.to_service.name == "Connectivity"
    assert parent.lifecycle_state == LifecycleState.PLANNED
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/catalog/test_models.py -v`
Expected: FAIL — `ImportError: cannot import name 'Art' from 'app.models'`

- [ ] **Step 3: Add the ORM models**

In `backend/app/models.py`, add to the imports at the top:

```python
from app.catalog.domain import Criticality, DependencyType, LifecycleState
```

Append at the end of the file:

```python
class Art(Base):
    __tablename__ = "arts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(64), unique=True)
    description: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow, server_default=func.now()
    )


class Product(Base):
    __tablename__ = "products"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(128), unique=True)
    description: Mapped[str | None] = mapped_column(Text)
    art_id: Mapped[int] = mapped_column(
        ForeignKey("arts.id", ondelete="RESTRICT"), index=True
    )
    team_id: Mapped[int | None] = mapped_column(
        ForeignKey("teams.id", ondelete="SET NULL"), unique=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow, server_default=func.now()
    )

    art: Mapped["Art"] = relationship()
    team: Mapped["Team | None"] = relationship()


class Service(Base):
    __tablename__ = "services"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(128))
    description: Mapped[str | None] = mapped_column(Text)
    product_id: Mapped[int] = mapped_column(
        ForeignKey("products.id", ondelete="RESTRICT"), index=True
    )
    parent_service_id: Mapped[int | None] = mapped_column(
        ForeignKey("services.id", ondelete="RESTRICT"), index=True
    )
    owner_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    lifecycle_state: Mapped[LifecycleState] = mapped_column(
        Enum(LifecycleState, native_enum=False),
        default=LifecycleState.PLANNED,
        server_default="planned",
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow, server_default=func.now()
    )

    product: Mapped["Product"] = relationship()
    owner: Mapped["User | None"] = relationship()


class ServiceDependency(Base):
    __tablename__ = "service_dependencies"
    __table_args__ = (
        UniqueConstraint("from_service_id", "to_service_id", name="uq_service_dependency"),
        CheckConstraint("from_service_id != to_service_id", name="ck_service_dep_no_self"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    from_service_id: Mapped[int] = mapped_column(
        ForeignKey("services.id", ondelete="CASCADE"), index=True
    )
    to_service_id: Mapped[int] = mapped_column(
        ForeignKey("services.id", ondelete="RESTRICT"), index=True
    )
    dep_type: Mapped[DependencyType] = mapped_column(Enum(DependencyType, native_enum=False))
    criticality: Mapped[Criticality] = mapped_column(Enum(Criticality, native_enum=False))
    note: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, server_default=func.now()
    )

    from_service: Mapped["Service"] = relationship(foreign_keys=[from_service_id])
    to_service: Mapped["Service"] = relationship(foreign_keys=[to_service_id])
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/catalog/test_models.py -v`
Expected: 1 passed. Also run `pytest` (full suite) — no regressions.

- [ ] **Step 5: Write migration 0025**

`backend/alembic/versions/0025_catalog_tables.py`:

```python
"""catalog tables: arts, products, services, service_dependencies

Revision ID: 0025
Revises: 0024
"""
from alembic import op
import sqlalchemy as sa

revision = "0025"
down_revision = "0024"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "arts",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("name", sa.String(64), nullable=False, unique=True),
        sa.Column("description", sa.Text),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_table(
        "products",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("name", sa.String(128), nullable=False, unique=True),
        sa.Column("description", sa.Text),
        sa.Column("art_id", sa.Integer, sa.ForeignKey("arts.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("team_id", sa.Integer, sa.ForeignKey("teams.id", ondelete="SET NULL"), unique=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_products_art_id", "products", ["art_id"])
    op.create_table(
        "services",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("name", sa.String(128), nullable=False),
        sa.Column("description", sa.Text),
        sa.Column("product_id", sa.Integer, sa.ForeignKey("products.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("parent_service_id", sa.Integer, sa.ForeignKey("services.id", ondelete="RESTRICT")),
        sa.Column("owner_user_id", sa.Integer, sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("lifecycle_state", sa.String(16), nullable=False, server_default="planned"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_services_product_id", "services", ["product_id"])
    op.create_index("ix_services_parent_service_id", "services", ["parent_service_id"])
    op.create_table(
        "service_dependencies",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("from_service_id", sa.Integer, sa.ForeignKey("services.id", ondelete="CASCADE"), nullable=False),
        sa.Column("to_service_id", sa.Integer, sa.ForeignKey("services.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("dep_type", sa.String(16), nullable=False),
        sa.Column("criticality", sa.String(16), nullable=False),
        sa.Column("note", sa.Text),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("from_service_id", "to_service_id", name="uq_service_dependency"),
        sa.CheckConstraint("from_service_id != to_service_id", name="ck_service_dep_no_self"),
    )
    op.create_index("ix_service_dependencies_from_service_id", "service_dependencies", ["from_service_id"])
    op.create_index("ix_service_dependencies_to_service_id", "service_dependencies", ["to_service_id"])


def downgrade() -> None:
    op.drop_table("service_dependencies")
    op.drop_table("services")
    op.drop_table("products")
    op.drop_table("arts")
```

- [ ] **Step 6: Dry-run the migration on compose Postgres**

```bash
docker compose up -d db
cd backend && . .venv/bin/activate
alembic upgrade head       # expect: 0024 -> 0025
alembic downgrade -1       # expect: 0025 -> 0024, tables gone
alembic upgrade head       # back to 0025
```
Expected: all three commands succeed without error.

- [ ] **Step 7: Commit**

```bash
git add backend/app/models.py backend/alembic/versions/0025_catalog_tables.py backend/tests/catalog/test_models.py
git commit -m "feat(catalog): ORM models + migration 0025 (arts, products, services, dependencies)"
```

---

### Task 3: items.art → arts FK (migration 0026)

**Files:**
- Modify: `backend/app/models.py` (Item: replace `art` column with `art_id` + relationship + property)
- Modify: `backend/app/routers/items.py` (create path resolves art name)
- Modify: `backend/app/csv_import.py` (`_insert_item` resolves art name)
- Modify: `backend/app/snapshots.py` (restore maps legacy art names / dangling ids)
- Create: `backend/app/catalog/adapters/__init__.py` (empty), `backend/app/catalog/adapters/postgres.py` (starts with just `get_or_create_art_id`; Task 4 extends it)
- Create: `backend/alembic/versions/0026_items_art_fk.py`
- Test: `backend/tests/catalog/test_items_art_fk.py`

**Interfaces:**
- Consumes: ORM `Art` from Task 2.
- Produces: `get_or_create_art_id(db: Session, name: str | None) -> int | None` in `app.catalog.adapters.postgres`; `Item.art_id`, `Item.art_ref` (joined-eager relationship), `Item.art` (read-only property returning the ART name).

- [ ] **Step 1: Write the failing tests**

`backend/tests/catalog/test_items_art_fk.py`:

```python
from sqlalchemy import select

from app.models import Art, Item


def test_create_item_with_art_string_creates_art_row(client, db_session):
    resp = client.post("/api/v1/items", json={"kind": "feature", "title": "F1", "art": "Platform ART"})
    assert resp.status_code == 201
    assert resp.json()["art"] == "Platform ART"
    art = db_session.scalar(select(Art).where(Art.name == "Platform ART"))
    assert art is not None
    item = db_session.get(Item, resp.json()["id"])
    assert item.art_id == art.id
    assert item.art == "Platform ART"


def test_create_item_reuses_existing_art(client, db_session):
    db_session.add(Art(name="Platform ART"))
    db_session.commit()
    client.post("/api/v1/items", json={"kind": "feature", "title": "F1", "art": "Platform ART"})
    assert db_session.scalar(select(Art).where(Art.name == "Platform ART")) is not None
    assert len(list(db_session.scalars(select(Art)))) == 1


def test_create_item_without_art(client):
    resp = client.post("/api/v1/items", json={"kind": "feature", "title": "F1"})
    assert resp.status_code == 201
    assert resp.json()["art"] is None


def test_csv_insert_item_resolves_art(db_session):
    from app.csv_import import ParsedItem, _insert_item
    from app.models import ItemKind

    parsed = ParsedItem(kind=ItemKind.FEATURE, data={"title": "F", "art": "CSV ART"})
    item = _insert_item(db_session, parsed, parent_id=None, position=0, assignee_ids={})
    db_session.commit()
    assert item.art == "CSV ART"
    assert db_session.scalar(select(Art).where(Art.name == "CSV ART")) is not None


def test_get_or_create_art_id_strips_and_ignores_empty(db_session):
    from app.catalog.adapters.postgres import get_or_create_art_id

    assert get_or_create_art_id(db_session, None) is None
    assert get_or_create_art_id(db_session, "  ") is None
    a = get_or_create_art_id(db_session, "  ART X ")
    assert db_session.get(Art, a).name == "ART X"
    assert get_or_create_art_id(db_session, "ART X") == a
```

Also extend `backend/tests/catalog/test_items_art_fk.py` with the snapshot-restore cases:

```python
def test_snapshot_restore_maps_legacy_art_name(client, db_session):
    from app.snapshots import restore_from_snapshot

    data = {
        "items": [{"id": 1, "kind": "feature", "title": "Old", "art": "Legacy ART",
                   "position": 0, "version": 1, "parent_id": None,
                   "created_at": "2026-01-01T00:00:00+00:00",
                   "updated_at": "2026-01-01T00:00:00+00:00"}],
        "comments": [], "links": [],
    }
    restore_from_snapshot(db_session, data)
    db_session.commit()
    item = db_session.get(Item, 1)
    assert item.art == "Legacy ART"


def test_snapshot_restore_clears_dangling_art_id(client, db_session):
    from app.snapshots import restore_from_snapshot

    data = {
        "items": [{"id": 1, "kind": "feature", "title": "Old", "art_id": 999,
                   "position": 0, "version": 1, "parent_id": None,
                   "created_at": "2026-01-01T00:00:00+00:00",
                   "updated_at": "2026-01-01T00:00:00+00:00"}],
        "comments": [], "links": [],
    }
    restore_from_snapshot(db_session, data)
    db_session.commit()
    assert db_session.get(Item, 1).art is None
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/catalog/test_items_art_fk.py -v`
Expected: FAIL — no `app.catalog.adapters` module; item POST stores raw string, no `Art` row.

- [ ] **Step 3: Implement**

3a. Create `backend/app/catalog/adapters/__init__.py` (empty) and `backend/app/catalog/adapters/postgres.py`:

```python
"""Postgres adapter for the catalog bounded context (SQLAlchemy)."""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app import models as m


def get_or_create_art_id(db: Session, name: str | None) -> int | None:
    """Resolve an ART name to its id, creating the ART on first sight.
    Shared by the item API, CSV import, and snapshot restore."""
    clean = str(name).strip() if name and str(name).strip() else None
    if clean is None:
        return None
    art = db.scalar(select(m.Art).where(m.Art.name == clean))
    if art is None:
        art = m.Art(name=clean)
        db.add(art)
        db.flush()
    return art.id
```

3b. In `backend/app/models.py`, on `Item` replace

```python
    art: Mapped[str | None] = mapped_column(String(64))
```

with

```python
    art_id: Mapped[int | None] = mapped_column(
        ForeignKey("arts.id", ondelete="SET NULL"), index=True
    )
```

and below the existing `department_name` property add (the relationship goes with the other Item relationships):

```python
    art_ref: Mapped["Art | None"] = relationship(lazy="joined")

    @property
    def art(self) -> str | None:
        return self.art_ref.name if self.art_ref else None
```

(`Art` is defined later in the file — the string annotation resolves lazily, same as the other relationships.)

3c. In `backend/app/routers/items.py` `create_item`, replace

```python
    item = Item(**payload.model_dump())
```

with

```python
    from app.catalog.adapters.postgres import get_or_create_art_id

    data = payload.model_dump()
    art_name = data.pop("art", None)
    item = Item(**data, art_id=get_or_create_art_id(db, art_name))
```

(Put the import at the top of the file with the other imports, not inline.)

3d. In `backend/app/csv_import.py` `_insert_item`, after `data = dict(parsed_item.data)` and the assignee pop, add:

```python
    from app.catalog.adapters.postgres import get_or_create_art_id

    art_id = get_or_create_art_id(db, data.pop("art", None))
```

and pass `art_id=art_id` to the `Item(...)` constructor.

3e. In `backend/app/snapshots.py` `restore_from_snapshot`, after the department-clearing block add:

```python
    # ART: rows carry art_id (new snapshots) or a legacy "art" name string
    # (snapshots from before migration 0026). Resolve names, clear dangling ids.
    from app.catalog.adapters.postgres import get_or_create_art_id
    from app.models import Art

    existing_art_ids = set(db.scalars(select(Art.id)))
    for raw, row in zip(raw_items, item_rows):
        if row.get("art_id") is not None and row["art_id"] not in existing_art_ids:
            row["art_id"] = None
        if row.get("art_id") is None and raw.get("art"):
            row["art_id"] = get_or_create_art_id(db, raw["art"])
            existing_art_ids.add(row["art_id"])
```

(Check the local variable holding the raw item dicts — it is `raw_items` next to `item_rows = [_revive(Item, r) for r in raw_items]`; adjust if named differently.)

- [ ] **Step 4: Run the full backend suite**

Run: `pytest`
Expected: all pass, including `tests/catalog/test_items_art_fk.py`. Fix any existing test that constructed `Item(art=...)` directly by switching it to `art_id=get_or_create_art_id(...)` or posting via the API.

- [ ] **Step 5: Write migration 0026**

`backend/alembic/versions/0026_items_art_fk.py`:

```python
"""items.art text column -> art_id FK to arts, backfilling ART rows

Revision ID: 0026
Revises: 0025
"""
from alembic import op
import sqlalchemy as sa

revision = "0026"
down_revision = "0025"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    conn.execute(sa.text(
        "INSERT INTO arts (name) "
        "SELECT DISTINCT trim(art) FROM items "
        "WHERE art IS NOT NULL AND trim(art) <> '' "
        "ON CONFLICT (name) DO NOTHING"
    ))
    op.add_column("items", sa.Column(
        "art_id", sa.Integer, sa.ForeignKey("arts.id", ondelete="SET NULL"), nullable=True
    ))
    conn.execute(sa.text(
        "UPDATE items SET art_id = arts.id FROM arts WHERE trim(items.art) = arts.name"
    ))
    op.create_index("ix_items_art_id", "items", ["art_id"])
    op.drop_column("items", "art")


def downgrade() -> None:
    op.add_column("items", sa.Column("art", sa.String(64), nullable=True))
    conn = op.get_bind()
    conn.execute(sa.text(
        "UPDATE items SET art = arts.name FROM arts WHERE items.art_id = arts.id"
    ))
    op.drop_index("ix_items_art_id", table_name="items")
    op.drop_column("items", "art_id")
```

- [ ] **Step 6: Dry-run against compose Postgres with data**

```bash
docker compose up -d db
cd backend && . .venv/bin/activate
alembic upgrade head       # expect: 0025 -> 0026
alembic downgrade -1       # expect: art column restored with names
alembic upgrade head
```
If the dev DB has items with `art` values, spot-check after upgrade:
`docker compose exec db psql -U kanban -c "SELECT name FROM arts; SELECT count(*) FROM items WHERE art_id IS NOT NULL;"`
Expected: distinct former art strings appear as ART rows; the item count matches rows that previously had art text.

- [ ] **Step 7: Commit**

```bash
git add backend/app backend/alembic/versions/0026_items_art_fk.py backend/tests/catalog/test_items_art_fk.py
git commit -m "feat(catalog): items.art becomes FK to arts (migration 0026), API keeps art string"
```

---

### Task 4: Repository ports, Postgres adapter, factory

**Files:**
- Create: `backend/app/catalog/ports.py`
- Modify: `backend/app/catalog/adapters/postgres.py` (add the three repository classes)
- Create: `backend/app/catalog/factory.py`
- Create: `backend/app/catalog/http.py`
- Test: `backend/tests/catalog/test_postgres_adapter.py`

**Interfaces:**
- Consumes: domain types (Task 1), ORM models (Task 2).
- Produces:
  - `ArtRepository` Protocol: `read_only: bool`; `list() -> list[Art]`; `get(art_id) -> Art`; `create(*, name, description=None) -> Art`; `update(art_id, changes: dict) -> Art`; `delete(art_id) -> None`.
  - `ProductRepository` Protocol: `read_only`; `list() -> list[Product]`; `get(product_id) -> Product`; `create(*, name, art_id, description=None, team_id=None) -> Product`; `update(product_id, changes: dict) -> Product`; `delete(product_id) -> None`.
  - `ServiceRepository` Protocol: `read_only`; `get(service_id) -> Service`; `tree(product_id) -> list[Service]`; `list_all() -> list[Service]`; `create(*, name, product_id, description=None, parent_service_id=None, owner_user_id=None, lifecycle_state=LifecycleState.PLANNED) -> Service`; `update(service_id, changes: dict) -> Service`; `delete(service_id) -> None`; `list_dependencies(service_id) -> tuple[list[ServiceDependency], list[ServiceDependency]]` (outbound, inbound); `add_dependency(*, from_service_id, to_service_id, dep_type, criticality, note=None) -> ServiceDependency`; `remove_dependency(from_service_id, dep_id) -> None`.
  - FastAPI deps `get_art_repo`, `get_product_repo`, `get_service_repo` in `factory.py`.
  - `check_writable(repo)` in `http.py` raising HTTP 405 when `repo.read_only`.
  - `update(...)` `changes` dicts come from Pydantic `model_dump(exclude_unset=True)` — a key present with value `None` means "set to NULL" where the column is nullable.

- [ ] **Step 1: Write the failing tests**

`backend/tests/catalog/test_postgres_adapter.py`:

```python
import pytest

from app.catalog.adapters.postgres import (
    PostgresArtRepository,
    PostgresProductRepository,
    PostgresServiceRepository,
)
from app.catalog.domain import (
    CatalogInUse,
    CatalogNotFound,
    CatalogRuleViolation,
    Criticality,
    DependencyType,
    LifecycleState,
)
from app.models import Team


@pytest.fixture()
def repos(db_session):
    return (
        PostgresArtRepository(db_session),
        PostgresProductRepository(db_session),
        PostgresServiceRepository(db_session),
    )


def _seed(repos):
    arts, products, services = repos
    art = arts.create(name="Platform ART")
    product = products.create(name="Network", art_id=art.id)
    return art, product


def test_art_crud_and_duplicate(repos):
    arts, _, _ = repos
    a = arts.create(name="A1", description="d")
    assert arts.get(a.id).name == "A1"
    with pytest.raises(CatalogRuleViolation):
        arts.create(name="A1")
    arts.update(a.id, {"description": None})
    assert arts.get(a.id).description is None
    arts.delete(a.id)
    with pytest.raises(CatalogNotFound):
        arts.get(a.id)


def test_art_delete_blocked_by_product(repos):
    arts, products, _ = repos
    art, _ = _seed(repos)
    with pytest.raises(CatalogInUse):
        arts.delete(art.id)


def test_product_list_enriched(repos, db_session):
    arts, products, services = repos
    art, product = _seed(repos)
    team = Team(name="Net Team")
    db_session.add(team)
    db_session.flush()
    products.update(product.id, {"team_id": team.id})
    services.create(name="Connectivity", product_id=product.id)
    listed = products.list()
    assert listed[0].art_name == "Platform ART"
    assert listed[0].team_name == "Net Team"
    assert listed[0].service_count == 1


def test_product_team_unique(repos, db_session):
    arts, products, _ = repos
    art, product = _seed(repos)
    team = Team(name="Net Team")
    db_session.add(team)
    db_session.flush()
    products.update(product.id, {"team_id": team.id})
    with pytest.raises(CatalogRuleViolation):
        products.create(name="Other", art_id=art.id, team_id=team.id)


def test_product_delete_blocked_by_service(repos):
    _, products, services = repos
    _, product = _seed(repos)
    services.create(name="S", product_id=product.id)
    with pytest.raises(CatalogInUse):
        products.delete(product.id)


def test_service_tree_and_sibling_names(repos):
    _, _, services = repos
    _, product = _seed(repos)
    parent = services.create(name="Connectivity", product_id=product.id)
    services.create(name="Campus", product_id=product.id, parent_service_id=parent.id)
    with pytest.raises(CatalogRuleViolation):
        services.create(name="Campus", product_id=product.id, parent_service_id=parent.id)
    # same name at another level is fine
    services.create(name="Campus", product_id=product.id)
    tree = services.tree(product.id)
    roots = {s.name for s in tree}
    assert roots == {"Connectivity", "Campus"}
    conn = next(s for s in tree if s.name == "Connectivity")
    assert [c.name for c in conn.children] == ["Campus"]


def test_service_parent_rules(repos):
    arts, products, services = repos
    art, product = _seed(repos)
    other = products.create(name="Other", art_id=art.id)
    s1 = services.create(name="S1", product_id=product.id)
    s2 = services.create(name="S2", product_id=other.id)
    with pytest.raises(CatalogRuleViolation):
        services.create(name="X", product_id=product.id, parent_service_id=s2.id)
    # ancestor cycle: s1 -> child c; setting s1.parent = c must fail
    c = services.create(name="C", product_id=product.id, parent_service_id=s1.id)
    with pytest.raises(CatalogRuleViolation):
        services.update(s1.id, {"parent_service_id": c.id})


def test_service_delete_guards(repos):
    _, _, services = repos
    _, product = _seed(repos)
    parent = services.create(name="P", product_id=product.id)
    child = services.create(name="C", product_id=product.id, parent_service_id=parent.id)
    with pytest.raises(CatalogInUse):
        services.delete(parent.id)
    dep_target = services.create(name="T", product_id=product.id)
    services.add_dependency(
        from_service_id=child.id, to_service_id=dep_target.id,
        dep_type=DependencyType.REQUIRES, criticality=Criticality.CRITICAL,
    )
    with pytest.raises(CatalogInUse):
        services.delete(dep_target.id)  # inbound dependency blocks
    services.delete(child.id)  # outbound dependency is removed with the service


def test_dependencies(repos):
    _, _, services = repos
    _, product = _seed(repos)
    a = services.create(name="A", product_id=product.id)
    b = services.create(name="B", product_id=product.id)
    dep = services.add_dependency(
        from_service_id=a.id, to_service_id=b.id,
        dep_type=DependencyType.USES, criticality=Criticality.OPTIONAL, note="n",
    )
    assert dep.to_service_name == "B"
    assert dep.from_product_name == "Network"
    with pytest.raises(CatalogRuleViolation):
        services.add_dependency(
            from_service_id=a.id, to_service_id=b.id,
            dep_type=DependencyType.USES, criticality=Criticality.OPTIONAL,
        )
    with pytest.raises(CatalogRuleViolation):
        services.add_dependency(
            from_service_id=a.id, to_service_id=a.id,
            dep_type=DependencyType.USES, criticality=Criticality.OPTIONAL,
        )
    outbound, inbound = services.list_dependencies(a.id)
    assert len(outbound) == 1 and len(inbound) == 0
    _, inbound_b = services.list_dependencies(b.id)
    assert len(inbound_b) == 1
    services.remove_dependency(a.id, dep.id)
    assert services.list_dependencies(a.id) == ([], [])


def test_list_all_carries_product_name(repos):
    _, _, services = repos
    _, product = _seed(repos)
    services.create(name="A", product_id=product.id)
    assert services.list_all()[0].product_name == "Network"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/catalog/test_postgres_adapter.py -v`
Expected: FAIL — `ImportError: cannot import name 'PostgresArtRepository'`

- [ ] **Step 3: Implement ports**

`backend/app/catalog/ports.py`:

```python
"""Repository ports (Protocols) for the catalog bounded context.

Routers depend on these, never on SQLAlchemy. A future external adapter
(ServiceNow, LeanIX, Jira) implements the same Protocol; read-only sources
set read_only=True and the HTTP layer answers writes with 405."""
from __future__ import annotations

from typing import Protocol

from app.catalog.domain import (
    Art,
    Criticality,
    DependencyType,
    LifecycleState,
    Product,
    Service,
    ServiceDependency,
)


class ArtRepository(Protocol):
    @property
    def read_only(self) -> bool: ...
    def list(self) -> list[Art]: ...
    def get(self, art_id: int) -> Art: ...
    def create(self, *, name: str, description: str | None = None) -> Art: ...
    def update(self, art_id: int, changes: dict) -> Art: ...
    def delete(self, art_id: int) -> None: ...


class ProductRepository(Protocol):
    @property
    def read_only(self) -> bool: ...
    def list(self) -> list[Product]: ...
    def get(self, product_id: int) -> Product: ...
    def create(self, *, name: str, art_id: int, description: str | None = None,
               team_id: int | None = None) -> Product: ...
    def update(self, product_id: int, changes: dict) -> Product: ...
    def delete(self, product_id: int) -> None: ...


class ServiceRepository(Protocol):
    @property
    def read_only(self) -> bool: ...
    def get(self, service_id: int) -> Service: ...
    def tree(self, product_id: int) -> list[Service]: ...
    def list_all(self) -> list[Service]: ...
    def create(self, *, name: str, product_id: int, description: str | None = None,
               parent_service_id: int | None = None, owner_user_id: int | None = None,
               lifecycle_state: LifecycleState = LifecycleState.PLANNED) -> Service: ...
    def update(self, service_id: int, changes: dict) -> Service: ...
    def delete(self, service_id: int) -> None: ...
    def list_dependencies(
        self, service_id: int
    ) -> tuple[list[ServiceDependency], list[ServiceDependency]]: ...
    def add_dependency(self, *, from_service_id: int, to_service_id: int,
                       dep_type: DependencyType, criticality: Criticality,
                       note: str | None = None) -> ServiceDependency: ...
    def remove_dependency(self, from_service_id: int, dep_id: int) -> None: ...
```

- [ ] **Step 4: Implement the Postgres adapter**

Extend `backend/app/catalog/adapters/postgres.py` (keep `get_or_create_art_id` from Task 3):

```python
from sqlalchemy import func, select

from app.catalog import domain
from app.catalog.domain import (
    CatalogInUse,
    CatalogNotFound,
    CatalogRuleViolation,
    Criticality,
    DependencyType,
    LifecycleState,
)


def _to_art(row: m.Art) -> domain.Art:
    return domain.Art(id=row.id, name=row.name, description=row.description)


def _to_product(row: m.Product, service_count: int = 0) -> domain.Product:
    return domain.Product(
        id=row.id, name=row.name, description=row.description,
        art_id=row.art_id, art_name=row.art.name if row.art else None,
        team_id=row.team_id, team_name=row.team.name if row.team else None,
        service_count=service_count,
    )


def _to_service(row: m.Service) -> domain.Service:
    return domain.Service(
        id=row.id, name=row.name, description=row.description,
        product_id=row.product_id, parent_service_id=row.parent_service_id,
        owner_user_id=row.owner_user_id,
        owner_name=row.owner.display_name if row.owner else None,
        lifecycle_state=LifecycleState(row.lifecycle_state),
    )


def _to_dep(row: m.ServiceDependency) -> domain.ServiceDependency:
    return domain.ServiceDependency(
        id=row.id, from_service_id=row.from_service_id, to_service_id=row.to_service_id,
        dep_type=DependencyType(row.dep_type), criticality=Criticality(row.criticality),
        note=row.note,
        from_service_name=row.from_service.name, to_service_name=row.to_service.name,
        from_product_name=row.from_service.product.name,
        to_product_name=row.to_service.product.name,
    )


class PostgresArtRepository:
    read_only = False

    def __init__(self, db: Session):
        self.db = db

    def _row(self, art_id: int) -> m.Art:
        row = self.db.get(m.Art, art_id)
        if row is None:
            raise CatalogNotFound("ART not found")
        return row

    def list(self) -> list[domain.Art]:
        return [_to_art(a) for a in self.db.scalars(select(m.Art).order_by(m.Art.name))]

    def get(self, art_id: int) -> domain.Art:
        return _to_art(self._row(art_id))

    def create(self, *, name: str, description: str | None = None) -> domain.Art:
        if self.db.scalar(select(m.Art).where(m.Art.name == name)):
            raise CatalogRuleViolation("An ART with this name already exists")
        row = m.Art(name=name, description=description)
        self.db.add(row)
        self.db.flush()
        return _to_art(row)

    def update(self, art_id: int, changes: dict) -> domain.Art:
        row = self._row(art_id)
        if "name" in changes and changes["name"] != row.name and self.db.scalar(
            select(m.Art).where(m.Art.name == changes["name"], m.Art.id != art_id)
        ):
            raise CatalogRuleViolation("An ART with this name already exists")
        for key in ("name", "description"):
            if key in changes:
                setattr(row, key, changes[key])
        self.db.flush()
        return _to_art(row)

    def delete(self, art_id: int) -> None:
        row = self._row(art_id)
        n = self.db.scalar(
            select(func.count()).select_from(m.Product).where(m.Product.art_id == art_id)
        )
        if n:
            raise CatalogInUse(f"ART has {n} product(s); reassign or delete them first")
        self.db.delete(row)
        self.db.flush()


class PostgresProductRepository:
    read_only = False

    def __init__(self, db: Session):
        self.db = db

    def _row(self, product_id: int) -> m.Product:
        row = self.db.get(m.Product, product_id)
        if row is None:
            raise CatalogNotFound("Product not found")
        return row

    def _service_count(self, product_id: int) -> int:
        return self.db.scalar(
            select(func.count()).select_from(m.Service).where(m.Service.product_id == product_id)
        ) or 0

    def _check_team(self, team_id: int, exclude_product_id: int | None) -> None:
        if self.db.get(m.Team, team_id) is None:
            raise CatalogRuleViolation("team_id does not exist")
        q = select(m.Product).where(m.Product.team_id == team_id)
        if exclude_product_id is not None:
            q = q.where(m.Product.id != exclude_product_id)
        if self.db.scalar(q):
            raise CatalogRuleViolation("Team is already linked to another product")

    def list(self) -> list[domain.Product]:
        counts = dict(
            self.db.execute(
                select(m.Service.product_id, func.count()).group_by(m.Service.product_id)
            ).all()
        )
        rows = self.db.scalars(select(m.Product).order_by(m.Product.name))
        return [_to_product(r, counts.get(r.id, 0)) for r in rows]

    def get(self, product_id: int) -> domain.Product:
        row = self._row(product_id)
        return _to_product(row, self._service_count(product_id))

    def create(self, *, name: str, art_id: int, description: str | None = None,
               team_id: int | None = None) -> domain.Product:
        if self.db.get(m.Art, art_id) is None:
            raise CatalogRuleViolation("art_id does not exist")
        if self.db.scalar(select(m.Product).where(m.Product.name == name)):
            raise CatalogRuleViolation("A product with this name already exists")
        if team_id is not None:
            self._check_team(team_id, exclude_product_id=None)
        row = m.Product(name=name, art_id=art_id, description=description, team_id=team_id)
        self.db.add(row)
        self.db.flush()
        return _to_product(row)

    def update(self, product_id: int, changes: dict) -> domain.Product:
        row = self._row(product_id)
        if "art_id" in changes and changes["art_id"] is None:
            raise CatalogRuleViolation("A product must belong to an ART")
        if changes.get("art_id") is not None and self.db.get(m.Art, changes["art_id"]) is None:
            raise CatalogRuleViolation("art_id does not exist")
        if "name" in changes and changes["name"] != row.name and self.db.scalar(
            select(m.Product).where(m.Product.name == changes["name"], m.Product.id != product_id)
        ):
            raise CatalogRuleViolation("A product with this name already exists")
        if changes.get("team_id") is not None:
            self._check_team(changes["team_id"], exclude_product_id=product_id)
        for key in ("name", "description", "art_id", "team_id"):
            if key in changes:
                setattr(row, key, changes[key])
        self.db.flush()
        return _to_product(row, self._service_count(product_id))

    def delete(self, product_id: int) -> None:
        row = self._row(product_id)
        n = self._service_count(product_id)
        if n:
            raise CatalogInUse(f"Product has {n} service(s); delete them first")
        self.db.delete(row)
        self.db.flush()


class PostgresServiceRepository:
    read_only = False

    def __init__(self, db: Session):
        self.db = db

    def _row(self, service_id: int) -> m.Service:
        row = self.db.get(m.Service, service_id)
        if row is None:
            raise CatalogNotFound("Service not found")
        return row

    def get(self, service_id: int) -> domain.Service:
        return _to_service(self._row(service_id))

    def tree(self, product_id: int) -> list[domain.Service]:
        rows = list(self.db.scalars(
            select(m.Service).where(m.Service.product_id == product_id).order_by(m.Service.name)
        ))
        nodes = {r.id: _to_service(r) for r in rows}
        roots: list[domain.Service] = []
        for r in rows:
            node = nodes[r.id]
            if r.parent_service_id and r.parent_service_id in nodes:
                nodes[r.parent_service_id].children.append(node)
            else:
                roots.append(node)
        return roots

    def list_all(self) -> list[domain.Service]:
        out = []
        for r in self.db.scalars(select(m.Service).order_by(m.Service.name)):
            s = _to_service(r)
            s.product_name = r.product.name
            out.append(s)
        return out

    def _validate_parent(self, *, service_id: int | None, product_id: int,
                         parent_service_id: int | None) -> None:
        if parent_service_id is None:
            return
        parent = self.db.get(m.Service, parent_service_id)
        if parent is None:
            raise CatalogRuleViolation("parent_service_id does not exist")
        domain.validate_parent(
            service_id=service_id, product_id=product_id, parent=_to_service(parent)
        )
        # Walk up the ancestor chain; reaching the service itself means a cycle.
        seen: set[int] = set()
        cur = parent
        while cur is not None and cur.id not in seen:
            if service_id is not None and cur.id == service_id:
                raise CatalogRuleViolation("Parent chain would create a cycle")
            seen.add(cur.id)
            cur = (
                self.db.get(m.Service, cur.parent_service_id)
                if cur.parent_service_id else None
            )

    def _validate_sibling_name(self, *, name: str, product_id: int,
                               parent_service_id: int | None,
                               exclude_id: int | None) -> None:
        q = select(m.Service).where(
            m.Service.product_id == product_id,
            m.Service.name == name,
            m.Service.parent_service_id.is_(None)
            if parent_service_id is None
            else m.Service.parent_service_id == parent_service_id,
        )
        if exclude_id is not None:
            q = q.where(m.Service.id != exclude_id)
        if self.db.scalar(q):
            raise CatalogRuleViolation("A service with this name already exists at this level")

    def create(self, *, name: str, product_id: int, description: str | None = None,
               parent_service_id: int | None = None, owner_user_id: int | None = None,
               lifecycle_state: LifecycleState = LifecycleState.PLANNED) -> domain.Service:
        if self.db.get(m.Product, product_id) is None:
            raise CatalogRuleViolation("product_id does not exist")
        if owner_user_id is not None and self.db.get(m.User, owner_user_id) is None:
            raise CatalogRuleViolation("owner_user_id does not exist")
        self._validate_parent(service_id=None, product_id=product_id,
                              parent_service_id=parent_service_id)
        self._validate_sibling_name(name=name, product_id=product_id,
                                    parent_service_id=parent_service_id, exclude_id=None)
        row = m.Service(
            name=name, product_id=product_id, description=description,
            parent_service_id=parent_service_id, owner_user_id=owner_user_id,
            lifecycle_state=lifecycle_state,
        )
        self.db.add(row)
        self.db.flush()
        return _to_service(row)

    def update(self, service_id: int, changes: dict) -> domain.Service:
        row = self._row(service_id)
        name = changes.get("name", row.name)
        parent = (
            changes["parent_service_id"] if "parent_service_id" in changes
            else row.parent_service_id
        )
        if "parent_service_id" in changes:
            self._validate_parent(service_id=service_id, product_id=row.product_id,
                                  parent_service_id=parent)
        if changes.get("owner_user_id") is not None and \
                self.db.get(m.User, changes["owner_user_id"]) is None:
            raise CatalogRuleViolation("owner_user_id does not exist")
        if "name" in changes or "parent_service_id" in changes:
            self._validate_sibling_name(name=name, product_id=row.product_id,
                                        parent_service_id=parent, exclude_id=service_id)
        for key in ("name", "description", "parent_service_id",
                    "owner_user_id", "lifecycle_state"):
            if key in changes:
                setattr(row, key, changes[key])
        self.db.flush()
        return _to_service(row)

    def delete(self, service_id: int) -> None:
        row = self._row(service_id)
        n_children = self.db.scalar(
            select(func.count()).select_from(m.Service)
            .where(m.Service.parent_service_id == service_id)
        )
        if n_children:
            raise CatalogInUse(f"Service has {n_children} sub-service(s); delete them first")
        n_inbound = self.db.scalar(
            select(func.count()).select_from(m.ServiceDependency)
            .where(m.ServiceDependency.to_service_id == service_id)
        )
        if n_inbound:
            raise CatalogInUse(
                f"{n_inbound} service(s) depend on this service; remove those dependencies first"
            )
        # Outbound dependency rows go with the service (explicit for SQLite,
        # where the fixture engine doesn't enforce ON DELETE CASCADE).
        for dep in self.db.scalars(
            select(m.ServiceDependency)
            .where(m.ServiceDependency.from_service_id == service_id)
        ):
            self.db.delete(dep)
        self.db.delete(row)
        self.db.flush()

    def list_dependencies(
        self, service_id: int
    ) -> tuple[list[domain.ServiceDependency], list[domain.ServiceDependency]]:
        self._row(service_id)
        outbound = [_to_dep(r) for r in self.db.scalars(
            select(m.ServiceDependency)
            .where(m.ServiceDependency.from_service_id == service_id)
            .order_by(m.ServiceDependency.id)
        )]
        inbound = [_to_dep(r) for r in self.db.scalars(
            select(m.ServiceDependency)
            .where(m.ServiceDependency.to_service_id == service_id)
            .order_by(m.ServiceDependency.id)
        )]
        return outbound, inbound

    def add_dependency(self, *, from_service_id: int, to_service_id: int,
                       dep_type: DependencyType, criticality: Criticality,
                       note: str | None = None) -> domain.ServiceDependency:
        domain.validate_dependency(from_service_id, to_service_id)
        self._row(from_service_id)
        if self.db.get(m.Service, to_service_id) is None:
            raise CatalogRuleViolation("to_service_id does not exist")
        if self.db.scalar(select(m.ServiceDependency).where(
            m.ServiceDependency.from_service_id == from_service_id,
            m.ServiceDependency.to_service_id == to_service_id,
        )):
            raise CatalogRuleViolation("This dependency already exists")
        row = m.ServiceDependency(
            from_service_id=from_service_id, to_service_id=to_service_id,
            dep_type=dep_type, criticality=criticality, note=note,
        )
        self.db.add(row)
        self.db.flush()
        return _to_dep(row)

    def remove_dependency(self, from_service_id: int, dep_id: int) -> None:
        row = self.db.get(m.ServiceDependency, dep_id)
        if row is None or row.from_service_id != from_service_id:
            raise CatalogNotFound("Dependency not found")
        self.db.delete(row)
        self.db.flush()
```

- [ ] **Step 5: Implement factory and HTTP helper**

`backend/app/catalog/factory.py`:

```python
"""Datasource seam: FastAPI dependencies returning the active repository per
entity. Today everything is Postgres; a future config switch returns an
external adapter (ServiceNow / LeanIX / Jira) here — routers never change."""
from fastapi import Depends
from sqlalchemy.orm import Session

from app.catalog import ports
from app.catalog.adapters.postgres import (
    PostgresArtRepository,
    PostgresProductRepository,
    PostgresServiceRepository,
)
from app.db import get_db


def get_art_repo(db: Session = Depends(get_db)) -> ports.ArtRepository:
    return PostgresArtRepository(db)


def get_product_repo(db: Session = Depends(get_db)) -> ports.ProductRepository:
    return PostgresProductRepository(db)


def get_service_repo(db: Session = Depends(get_db)) -> ports.ServiceRepository:
    return PostgresServiceRepository(db)
```

`backend/app/catalog/http.py`:

```python
from fastapi import HTTPException


def check_writable(repo) -> None:
    """Guard write endpoints: read-only adapters (external mirrors) answer 405."""
    if repo.read_only:
        raise HTTPException(
            status_code=405,
            detail="This entity is provided by a read-only external source",
        )
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pytest tests/catalog/ -v`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add backend/app/catalog backend/tests/catalog/test_postgres_adapter.py
git commit -m "feat(catalog): repository ports, Postgres adapter, factory seam"
```

---

### Task 5: Arts & Products routers + schemas + exception handlers

**Files:**
- Modify: `backend/app/schemas.py` (append catalog schemas)
- Create: `backend/app/routers/arts.py`, `backend/app/routers/products.py`
- Modify: `backend/app/main.py` (exception handlers + router registration)
- Test: `backend/tests/catalog/test_arts_api.py`, `backend/tests/catalog/test_products_api.py`

**Interfaces:**
- Consumes: ports/factory/http from Task 4, `log_event` from `app.audit`.
- Produces: endpoints `GET/POST /api/v1/arts`, `PATCH/DELETE /api/v1/arts/{id}`, `GET/POST /api/v1/products`, `GET/PATCH/DELETE /api/v1/products/{id}`; Pydantic models `ArtRead`, `ArtCreate`, `ArtUpdate`, `ProductRead`, `ProductCreate`, `ProductUpdate` in `app.schemas`.

- [ ] **Step 1: Write the failing tests**

`backend/tests/catalog/test_arts_api.py`:

```python
def test_art_crud_as_admin(client):
    r = client.post("/api/v1/arts", json={"name": "Platform ART", "description": "d"})
    assert r.status_code == 201
    art_id = r.json()["id"]
    assert client.get("/api/v1/arts").json()[0]["name"] == "Platform ART"
    r = client.patch(f"/api/v1/arts/{art_id}", json={"name": "P-ART"})
    assert r.json()["name"] == "P-ART"
    assert client.delete(f"/api/v1/arts/{art_id}").status_code == 204
    assert client.get("/api/v1/arts").json() == []


def test_art_duplicate_name_422(client):
    client.post("/api/v1/arts", json={"name": "A"})
    assert client.post("/api/v1/arts", json={"name": "A"}).status_code == 422


def test_art_delete_with_products_409(client):
    art_id = client.post("/api/v1/arts", json={"name": "A"}).json()["id"]
    client.post("/api/v1/products", json={"name": "P", "art_id": art_id})
    assert client.delete(f"/api/v1/arts/{art_id}").status_code == 409


def test_art_writes_admin_only(member_client):
    assert member_client.post("/api/v1/arts", json={"name": "A"}).status_code == 403
    assert member_client.get("/api/v1/arts").status_code == 200
```

`backend/tests/catalog/test_products_api.py`:

```python
import pytest


@pytest.fixture()
def art_id(client):
    return client.post("/api/v1/arts", json={"name": "Platform ART"}).json()["id"]


def test_product_crud(client, art_id):
    r = client.post("/api/v1/products", json={"name": "Network", "art_id": art_id})
    assert r.status_code == 201
    pid = r.json()["id"]
    listed = client.get("/api/v1/products").json()
    assert listed[0]["art_name"] == "Platform ART"
    assert listed[0]["service_count"] == 0
    detail = client.get(f"/api/v1/products/{pid}").json()
    assert detail["name"] == "Network"
    r = client.patch(f"/api/v1/products/{pid}", json={"description": "core net"})
    assert r.json()["description"] == "core net"
    assert client.delete(f"/api/v1/products/{pid}").status_code == 204


def test_product_team_link(client, art_id):
    team_id = client.post("/api/v1/teams", json={"name": "Net Team"}).json()["id"]
    r = client.post("/api/v1/products",
                    json={"name": "Network", "art_id": art_id, "team_id": team_id})
    assert r.json()["team_name"] == "Net Team"
    r2 = client.post("/api/v1/products",
                     json={"name": "Other", "art_id": art_id, "team_id": team_id})
    assert r2.status_code == 422  # team already linked


def test_product_unknown_art_422(client):
    assert client.post("/api/v1/products",
                       json={"name": "P", "art_id": 999}).status_code == 422


def test_product_missing_404(client):
    assert client.get("/api/v1/products/999").status_code == 404


def test_product_writes_admin_only(member_client):
    assert member_client.post("/api/v1/products",
                              json={"name": "P", "art_id": 1}).status_code == 403
    assert member_client.get("/api/v1/products").status_code == 200
```

(If `POST /api/v1/teams` differs, check `backend/app/routers/teams.py` and create the team through whatever endpoint exists, or insert a `Team` via `db_session`.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/catalog/test_arts_api.py tests/catalog/test_products_api.py -v`
Expected: 404s — routes don't exist.

- [ ] **Step 3: Add schemas**

Append to `backend/app/schemas.py` (import `LifecycleState`, `DependencyType`, `Criticality` from `app.catalog.domain` at the top):

```python
# --- Catalog: ARTs, products ------------------------------------------------

class ArtRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    description: str | None = None


class ArtCreate(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    description: str | None = None


class ArtUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str | None = Field(default=None, min_length=1, max_length=64)
    description: str | None = None


class ProductRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    description: str | None = None
    art_id: int
    art_name: str | None = None
    team_id: int | None = None
    team_name: str | None = None
    service_count: int = 0


class ProductCreate(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    art_id: int
    description: str | None = None
    team_id: int | None = None


class ProductUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str | None = Field(default=None, min_length=1, max_length=128)
    description: str | None = None
    art_id: int | None = None
    team_id: int | None = None
```

- [ ] **Step 4: Implement the routers and wire main.py**

`backend/app/routers/arts.py`:

```python
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.audit import log_event
from app.auth import require_admin
from app.catalog import ports
from app.catalog.factory import get_art_repo
from app.catalog.http import check_writable
from app.db import get_db
from app.models import User
from app.schemas import ArtCreate, ArtRead, ArtUpdate

router = APIRouter(prefix="/api/v1/arts", tags=["arts"])


@router.get("", response_model=list[ArtRead])
def list_arts(repo: ports.ArtRepository = Depends(get_art_repo)):
    return repo.list()


@router.post("", response_model=ArtRead, status_code=201)
def create_art(
    payload: ArtCreate,
    repo: ports.ArtRepository = Depends(get_art_repo),
    db: Session = Depends(get_db),
    current: User = Depends(require_admin),
):
    check_writable(repo)
    art = repo.create(name=payload.name, description=payload.description)
    log_event(db, actor=current, event_type="art.created", entity_type="art",
              entity_id=art.id, entity_label=art.name)
    db.commit()
    return art


@router.patch("/{art_id}", response_model=ArtRead)
def update_art(
    art_id: int,
    payload: ArtUpdate,
    repo: ports.ArtRepository = Depends(get_art_repo),
    db: Session = Depends(get_db),
    current: User = Depends(require_admin),
):
    check_writable(repo)
    art = repo.update(art_id, payload.model_dump(exclude_unset=True))
    log_event(db, actor=current, event_type="art.updated", entity_type="art",
              entity_id=art.id, entity_label=art.name)
    db.commit()
    return art


@router.delete("/{art_id}", status_code=204)
def delete_art(
    art_id: int,
    repo: ports.ArtRepository = Depends(get_art_repo),
    db: Session = Depends(get_db),
    current: User = Depends(require_admin),
):
    check_writable(repo)
    art = repo.get(art_id)
    repo.delete(art_id)
    log_event(db, actor=current, event_type="art.deleted", entity_type="art",
              entity_id=art_id, entity_label=art.name)
    db.commit()
```

`backend/app/routers/products.py`:

```python
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.audit import log_event
from app.auth import require_admin
from app.catalog import ports
from app.catalog.factory import get_product_repo
from app.catalog.http import check_writable
from app.db import get_db
from app.models import User
from app.schemas import ProductCreate, ProductRead, ProductUpdate

router = APIRouter(prefix="/api/v1/products", tags=["products"])


@router.get("", response_model=list[ProductRead])
def list_products(repo: ports.ProductRepository = Depends(get_product_repo)):
    return repo.list()


@router.get("/{product_id}", response_model=ProductRead)
def get_product(product_id: int, repo: ports.ProductRepository = Depends(get_product_repo)):
    return repo.get(product_id)


@router.post("", response_model=ProductRead, status_code=201)
def create_product(
    payload: ProductCreate,
    repo: ports.ProductRepository = Depends(get_product_repo),
    db: Session = Depends(get_db),
    current: User = Depends(require_admin),
):
    check_writable(repo)
    product = repo.create(name=payload.name, art_id=payload.art_id,
                          description=payload.description, team_id=payload.team_id)
    log_event(db, actor=current, event_type="product.created", entity_type="product",
              entity_id=product.id, entity_label=product.name)
    db.commit()
    return product


@router.patch("/{product_id}", response_model=ProductRead)
def update_product(
    product_id: int,
    payload: ProductUpdate,
    repo: ports.ProductRepository = Depends(get_product_repo),
    db: Session = Depends(get_db),
    current: User = Depends(require_admin),
):
    check_writable(repo)
    product = repo.update(product_id, payload.model_dump(exclude_unset=True))
    log_event(db, actor=current, event_type="product.updated", entity_type="product",
              entity_id=product.id, entity_label=product.name)
    db.commit()
    return product


@router.delete("/{product_id}", status_code=204)
def delete_product(
    product_id: int,
    repo: ports.ProductRepository = Depends(get_product_repo),
    db: Session = Depends(get_db),
    current: User = Depends(require_admin),
):
    check_writable(repo)
    product = repo.get(product_id)
    repo.delete(product_id)
    log_event(db, actor=current, event_type="product.deleted", entity_type="product",
              entity_id=product_id, entity_label=product.name)
    db.commit()
```

In `backend/app/main.py`:
- extend the router import line with `arts, products`
- add both to the `for protected in (...)` tuple
- after the middleware setup add the exception handlers:

```python
from fastapi import Request

from app.catalog.domain import CatalogInUse, CatalogNotFound, CatalogRuleViolation


@app.exception_handler(CatalogNotFound)
async def _catalog_not_found(request: Request, exc: CatalogNotFound) -> JSONResponse:
    return JSONResponse(status_code=404, content={"detail": str(exc)})


@app.exception_handler(CatalogRuleViolation)
async def _catalog_rule_violation(request: Request, exc: CatalogRuleViolation) -> JSONResponse:
    return JSONResponse(status_code=422, content={"detail": str(exc)})


@app.exception_handler(CatalogInUse)
async def _catalog_in_use(request: Request, exc: CatalogInUse) -> JSONResponse:
    return JSONResponse(status_code=409, content={"detail": str(exc)})
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pytest tests/catalog/ -v` then the full `pytest`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add backend/app backend/tests/catalog
git commit -m "feat(catalog): arts + products API (admin-managed), catalog exception handlers"
```

---

### Task 6: Services & dependencies router

**Files:**
- Modify: `backend/app/schemas.py` (append service schemas)
- Create: `backend/app/routers/services.py`
- Modify: `backend/app/main.py` (register `services` router)
- Test: `backend/tests/catalog/test_services_api.py`

**Interfaces:**
- Consumes: `get_service_repo`/`get_product_repo`, `check_writable`, `log_event`.
- Produces: endpoints `GET /api/v1/products/{id}/services` (tree), `GET /api/v1/services` (flat options), `POST /api/v1/services`, `GET/PATCH/DELETE /api/v1/services/{id}`, `GET/POST /api/v1/services/{id}/dependencies`, `DELETE /api/v1/services/{id}/dependencies/{dep_id}`; schemas `ServiceRead` (recursive `children`), `ServiceCreate`, `ServiceUpdate`, `ServiceOption`, `DependencyCreate`, `DependencyRead`, `ServiceDependenciesRead`.

- [ ] **Step 1: Write the failing tests**

`backend/tests/catalog/test_services_api.py`:

```python
import pytest


@pytest.fixture()
def product_id(client):
    art_id = client.post("/api/v1/arts", json={"name": "ART"}).json()["id"]
    return client.post("/api/v1/products", json={"name": "Network", "art_id": art_id}).json()["id"]


def test_service_crud_any_user(member_client, client, product_id):
    r = member_client.post("/api/v1/services", json={"name": "Connectivity", "product_id": product_id})
    assert r.status_code == 201
    sid = r.json()["id"]
    assert r.json()["lifecycle_state"] == "planned"
    r = member_client.post("/api/v1/services", json={
        "name": "Campus", "product_id": product_id, "parent_service_id": sid,
        "lifecycle_state": "active",
    })
    assert r.status_code == 201
    tree = member_client.get(f"/api/v1/products/{product_id}/services").json()
    assert tree[0]["name"] == "Connectivity"
    assert tree[0]["children"][0]["name"] == "Campus"
    r = member_client.patch(f"/api/v1/services/{sid}", json={"lifecycle_state": "deprecated"})
    assert r.json()["lifecycle_state"] == "deprecated"


def test_service_delete_guard(member_client, product_id):
    parent = member_client.post("/api/v1/services",
                                json={"name": "P", "product_id": product_id}).json()["id"]
    member_client.post("/api/v1/services",
                       json={"name": "C", "product_id": product_id, "parent_service_id": parent})
    assert member_client.delete(f"/api/v1/services/{parent}").status_code == 409


def test_dependency_lifecycle(member_client, product_id):
    a = member_client.post("/api/v1/services",
                           json={"name": "A", "product_id": product_id}).json()["id"]
    b = member_client.post("/api/v1/services",
                           json={"name": "B", "product_id": product_id}).json()["id"]
    r = member_client.post(f"/api/v1/services/{a}/dependencies", json={
        "to_service_id": b, "dep_type": "requires", "criticality": "critical", "note": "core",
    })
    assert r.status_code == 201
    dep_id = r.json()["id"]
    deps = member_client.get(f"/api/v1/services/{a}/dependencies").json()
    assert deps["outbound"][0]["to_service_name"] == "B"
    assert deps["inbound"] == []
    deps_b = member_client.get(f"/api/v1/services/{b}/dependencies").json()
    assert deps_b["inbound"][0]["from_service_name"] == "A"
    # b now has an inbound dependency -> delete blocked
    assert member_client.delete(f"/api/v1/services/{b}").status_code == 409
    assert member_client.delete(
        f"/api/v1/services/{a}/dependencies/{dep_id}").status_code == 204
    assert member_client.delete(f"/api/v1/services/{b}").status_code == 204


def test_dependency_self_loop_422(member_client, product_id):
    a = member_client.post("/api/v1/services",
                           json={"name": "A", "product_id": product_id}).json()["id"]
    assert member_client.post(f"/api/v1/services/{a}/dependencies", json={
        "to_service_id": a, "dep_type": "uses", "criticality": "optional",
    }).status_code == 422


def test_service_options_flat(member_client, product_id):
    member_client.post("/api/v1/services", json={"name": "A", "product_id": product_id})
    opts = member_client.get("/api/v1/services").json()
    assert opts[0]["product_name"] == "Network"


def test_read_only_repo_returns_405(client, product_id, monkeypatch):
    from app.catalog.adapters.postgres import PostgresServiceRepository

    monkeypatch.setattr(PostgresServiceRepository, "read_only", True)
    assert client.post("/api/v1/services",
                       json={"name": "X", "product_id": product_id}).status_code == 405
```

(The `product_id` fixture uses the admin `client`; combining `client` and `member_client` in one test works — identity rides a per-request header, see `conftest.py`.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/catalog/test_services_api.py -v`
Expected: 404s — routes don't exist.

- [ ] **Step 3: Add schemas**

Append to `backend/app/schemas.py`:

```python
# --- Catalog: services + dependencies ---------------------------------------

class ServiceRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    description: str | None = None
    product_id: int
    parent_service_id: int | None = None
    owner_user_id: int | None = None
    owner_name: str | None = None
    lifecycle_state: LifecycleState
    children: list["ServiceRead"] = []


class ServiceCreate(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    product_id: int
    description: str | None = None
    parent_service_id: int | None = None
    owner_user_id: int | None = None
    lifecycle_state: LifecycleState = LifecycleState.PLANNED


class ServiceUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str | None = Field(default=None, min_length=1, max_length=128)
    description: str | None = None
    parent_service_id: int | None = None
    owner_user_id: int | None = None
    lifecycle_state: LifecycleState | None = None


class ServiceOption(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    product_id: int
    product_name: str | None = None


class DependencyCreate(BaseModel):
    to_service_id: int
    dep_type: DependencyType
    criticality: Criticality
    note: str | None = None


class DependencyRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    from_service_id: int
    to_service_id: int
    from_service_name: str | None = None
    to_service_name: str | None = None
    from_product_name: str | None = None
    to_product_name: str | None = None
    dep_type: DependencyType
    criticality: Criticality
    note: str | None = None


class ServiceDependenciesRead(BaseModel):
    outbound: list[DependencyRead]
    inbound: list[DependencyRead]
```

- [ ] **Step 4: Implement the router and wire main.py**

`backend/app/routers/services.py`:

```python
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.audit import log_event
from app.auth import require_user
from app.catalog import ports
from app.catalog.factory import get_product_repo, get_service_repo
from app.catalog.http import check_writable
from app.db import get_db
from app.models import User
from app.schemas import (
    DependencyCreate,
    DependencyRead,
    ServiceCreate,
    ServiceDependenciesRead,
    ServiceOption,
    ServiceRead,
    ServiceUpdate,
)

router = APIRouter(prefix="/api/v1", tags=["services"])


@router.get("/products/{product_id}/services", response_model=list[ServiceRead])
def product_service_tree(
    product_id: int,
    repo: ports.ServiceRepository = Depends(get_service_repo),
    products: ports.ProductRepository = Depends(get_product_repo),
):
    products.get(product_id)  # 404 when missing
    return repo.tree(product_id)


@router.get("/services", response_model=list[ServiceOption])
def list_service_options(repo: ports.ServiceRepository = Depends(get_service_repo)):
    return repo.list_all()


@router.post("/services", response_model=ServiceRead, status_code=201)
def create_service(
    payload: ServiceCreate,
    repo: ports.ServiceRepository = Depends(get_service_repo),
    db: Session = Depends(get_db),
    current: User = Depends(require_user),
):
    check_writable(repo)
    service = repo.create(
        name=payload.name, product_id=payload.product_id,
        description=payload.description, parent_service_id=payload.parent_service_id,
        owner_user_id=payload.owner_user_id, lifecycle_state=payload.lifecycle_state,
    )
    log_event(db, actor=current, event_type="service.created", entity_type="service",
              entity_id=service.id, entity_label=service.name)
    db.commit()
    return service


@router.get("/services/{service_id}", response_model=ServiceRead)
def get_service(service_id: int, repo: ports.ServiceRepository = Depends(get_service_repo)):
    return repo.get(service_id)


@router.patch("/services/{service_id}", response_model=ServiceRead)
def update_service(
    service_id: int,
    payload: ServiceUpdate,
    repo: ports.ServiceRepository = Depends(get_service_repo),
    db: Session = Depends(get_db),
    current: User = Depends(require_user),
):
    check_writable(repo)
    service = repo.update(service_id, payload.model_dump(exclude_unset=True))
    log_event(db, actor=current, event_type="service.updated", entity_type="service",
              entity_id=service.id, entity_label=service.name)
    db.commit()
    return service


@router.delete("/services/{service_id}", status_code=204)
def delete_service(
    service_id: int,
    repo: ports.ServiceRepository = Depends(get_service_repo),
    db: Session = Depends(get_db),
    current: User = Depends(require_user),
):
    check_writable(repo)
    service = repo.get(service_id)
    repo.delete(service_id)
    log_event(db, actor=current, event_type="service.deleted", entity_type="service",
              entity_id=service_id, entity_label=service.name)
    db.commit()


@router.get("/services/{service_id}/dependencies", response_model=ServiceDependenciesRead)
def list_dependencies(
    service_id: int,
    repo: ports.ServiceRepository = Depends(get_service_repo),
):
    outbound, inbound = repo.list_dependencies(service_id)
    return ServiceDependenciesRead(
        outbound=[DependencyRead.model_validate(d) for d in outbound],
        inbound=[DependencyRead.model_validate(d) for d in inbound],
    )


@router.post("/services/{service_id}/dependencies", response_model=DependencyRead, status_code=201)
def add_dependency(
    service_id: int,
    payload: DependencyCreate,
    repo: ports.ServiceRepository = Depends(get_service_repo),
    db: Session = Depends(get_db),
    current: User = Depends(require_user),
):
    check_writable(repo)
    dep = repo.add_dependency(
        from_service_id=service_id, to_service_id=payload.to_service_id,
        dep_type=payload.dep_type, criticality=payload.criticality, note=payload.note,
    )
    log_event(db, actor=current, event_type="service.dependency_added", entity_type="service",
              entity_id=service_id, entity_label=dep.from_service_name,
              field="depends_on", new_value=dep.to_service_name)
    db.commit()
    return dep


@router.delete("/services/{service_id}/dependencies/{dep_id}", status_code=204)
def remove_dependency(
    service_id: int,
    dep_id: int,
    repo: ports.ServiceRepository = Depends(get_service_repo),
    db: Session = Depends(get_db),
    current: User = Depends(require_user),
):
    check_writable(repo)
    repo.remove_dependency(service_id, dep_id)
    log_event(db, actor=current, event_type="service.dependency_removed",
              entity_type="service", entity_id=service_id)
    db.commit()
```

Register in `main.py`: add `services` to the router import and the `for protected in (...)` tuple.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pytest tests/catalog/ -v` then full `pytest`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add backend/app backend/tests/catalog/test_services_api.py
git commit -m "feat(catalog): services + dependencies API (user-editable, guarded deletes)"
```

---

### Task 7: Frontend types + API client

**Files:**
- Modify: `frontend/src/types.ts` (append catalog types)
- Modify: `frontend/src/api/client.ts` (append catalog functions + type imports)
- Test: extend `frontend/src/api/client.test.ts` (follow the existing fetch-mock pattern in that file)

**Interfaces:**
- Consumes: backend endpoints from Tasks 5–6.
- Produces (types): `Art`, `Product`, `CatalogService`, `ServiceOption`, `ServiceDependencyRead`, `ServiceDependencies`, `LifecycleState`, `DependencyType`, `DependencyCriticality`.
- Produces (client): `getArts()`, `createArt(name, description?)`, `updateArt(id, changes)`, `deleteArt(id)`, `getProducts()`, `getProduct(id)`, `createProduct(payload)`, `updateProduct(id, changes)`, `deleteProduct(id)`, `getProductServices(productId)`, `getServiceOptions()`, `createService(payload)`, `updateService(id, changes)`, `deleteService(id)`, `getServiceDependencies(id)`, `addServiceDependency(id, payload)`, `removeServiceDependency(id, depId)`.

- [ ] **Step 1: Add types**

Append to `frontend/src/types.ts`:

```ts
// --- Catalog ---------------------------------------------------------------

export type LifecycleState = "planned" | "active" | "deprecated" | "retired";
export type DependencyType = "requires" | "uses";
export type DependencyCriticality = "critical" | "important" | "optional";

export interface Art {
  id: number;
  name: string;
  description: string | null;
}

export interface Product {
  id: number;
  name: string;
  description: string | null;
  art_id: number;
  art_name: string | null;
  team_id: number | null;
  team_name: string | null;
  service_count: number;
}

export interface CatalogService {
  id: number;
  name: string;
  description: string | null;
  product_id: number;
  parent_service_id: number | null;
  owner_user_id: number | null;
  owner_name: string | null;
  lifecycle_state: LifecycleState;
  children: CatalogService[];
}

export interface ServiceOption {
  id: number;
  name: string;
  product_id: number;
  product_name: string | null;
}

export interface ServiceDependencyRead {
  id: number;
  from_service_id: number;
  to_service_id: number;
  from_service_name: string | null;
  to_service_name: string | null;
  from_product_name: string | null;
  to_product_name: string | null;
  dep_type: DependencyType;
  criticality: DependencyCriticality;
  note: string | null;
}

export interface ServiceDependencies {
  outbound: ServiceDependencyRead[];
  inbound: ServiceDependencyRead[];
}
```

- [ ] **Step 2: Write failing client tests**

Add to `frontend/src/api/client.test.ts`, following its existing mock-fetch pattern (look at the `deleteUser`/`getDepartments` tests there and mirror the setup):

```ts
it("getProducts GETs /api/v1/products", async () => {
  mockFetch({ ok: true, json: [] });
  await getProducts();
  expect(fetch).toHaveBeenCalledWith("/api/v1/products", undefined);
});

it("createService POSTs payload", async () => {
  mockFetch({ ok: true, json: { id: 1 } });
  await createService({ name: "S", product_id: 2 });
  const [url, init] = vi.mocked(fetch).mock.calls[0];
  expect(url).toBe("/api/v1/services");
  expect(JSON.parse((init as RequestInit).body as string)).toEqual({ name: "S", product_id: 2 });
});

it("addServiceDependency POSTs to nested route", async () => {
  mockFetch({ ok: true, json: { id: 1 } });
  await addServiceDependency(5, { to_service_id: 6, dep_type: "requires", criticality: "critical" });
  expect(vi.mocked(fetch).mock.calls[0][0]).toBe("/api/v1/services/5/dependencies");
});

it("removeServiceDependency DELETEs", async () => {
  mockFetch({ ok: true, empty: true });
  await removeServiceDependency(5, 9);
  expect(vi.mocked(fetch).mock.calls[0][0]).toBe("/api/v1/services/5/dependencies/9");
});
```

(Adapt `mockFetch` to whatever helper the file actually uses — read the file first and copy its idiom exactly.)

Run: `npx vitest run src/api/client.test.ts` — expect FAIL (functions not exported).

- [ ] **Step 3: Implement client functions**

Append to `frontend/src/api/client.ts` (add the new types to the type-import block at the top):

```ts
// --- Catalog ---------------------------------------------------------------

export function getArts(): Promise<Art[]> {
  return request<Art[]>(`${API}/arts`);
}

export function createArt(name: string, description?: string | null): Promise<Art> {
  return request<Art>(`${API}/arts`, json({ name, description: description ?? null }));
}

export function updateArt(
  id: number,
  changes: Partial<Pick<Art, "name" | "description">>,
): Promise<Art> {
  return request<Art>(`${API}/arts/${id}`, { ...json(changes), method: "PATCH" });
}

export function deleteArt(id: number): Promise<void> {
  return request<void>(`${API}/arts/${id}`, { method: "DELETE" });
}

export function getProducts(): Promise<Product[]> {
  return request<Product[]>(`${API}/products`);
}

export function getProduct(id: number): Promise<Product> {
  return request<Product>(`${API}/products/${id}`);
}

export function createProduct(payload: {
  name: string;
  art_id: number;
  description?: string | null;
  team_id?: number | null;
}): Promise<Product> {
  return request<Product>(`${API}/products`, json(payload));
}

export function updateProduct(
  id: number,
  changes: Partial<{
    name: string;
    description: string | null;
    art_id: number;
    team_id: number | null;
  }>,
): Promise<Product> {
  return request<Product>(`${API}/products/${id}`, { ...json(changes), method: "PATCH" });
}

export function deleteProduct(id: number): Promise<void> {
  return request<void>(`${API}/products/${id}`, { method: "DELETE" });
}

export function getProductServices(productId: number): Promise<CatalogService[]> {
  return request<CatalogService[]>(`${API}/products/${productId}/services`);
}

export function getServiceOptions(): Promise<ServiceOption[]> {
  return request<ServiceOption[]>(`${API}/services`);
}

export function createService(payload: {
  name: string;
  product_id: number;
  description?: string | null;
  parent_service_id?: number | null;
  owner_user_id?: number | null;
  lifecycle_state?: LifecycleState;
}): Promise<CatalogService> {
  return request<CatalogService>(`${API}/services`, json(payload));
}

export function updateService(
  id: number,
  changes: Partial<{
    name: string;
    description: string | null;
    parent_service_id: number | null;
    owner_user_id: number | null;
    lifecycle_state: LifecycleState;
  }>,
): Promise<CatalogService> {
  return request<CatalogService>(`${API}/services/${id}`, { ...json(changes), method: "PATCH" });
}

export function deleteService(id: number): Promise<void> {
  return request<void>(`${API}/services/${id}`, { method: "DELETE" });
}

export function getServiceDependencies(id: number): Promise<ServiceDependencies> {
  return request<ServiceDependencies>(`${API}/services/${id}/dependencies`);
}

export function addServiceDependency(
  id: number,
  payload: {
    to_service_id: number;
    dep_type: DependencyType;
    criticality: DependencyCriticality;
    note?: string | null;
  },
): Promise<ServiceDependencyRead> {
  return request<ServiceDependencyRead>(`${API}/services/${id}/dependencies`, json(payload));
}

export function removeServiceDependency(id: number, depId: number): Promise<void> {
  return request<void>(`${API}/services/${id}/dependencies/${depId}`, { method: "DELETE" });
}
```

- [ ] **Step 4: Run tests + typecheck**

Run: `npx vitest run src/api/client.test.ts` — expect PASS.
Run: `npm run build` — expect clean typecheck.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/types.ts frontend/src/api/client.ts frontend/src/api/client.test.ts
git commit -m "feat(catalog): frontend types + API client for arts/products/services"
```

---

### Task 8: Products view (list grouped by ART) + navigation

**Files:**
- Create: `frontend/src/components/ProductsView.tsx`
- Modify: `frontend/src/App.tsx` (add `"products"` to the `View` union, nav button, render branch)
- Test: `frontend/src/components/ProductsView.test.tsx`

**Interfaces:**
- Consumes: `getProducts()` (Task 7); `ProductDetail` (Task 9 — until then use the placeholder below and let Task 9 replace it).
- Produces: `<ProductsView />` default export, self-contained (fetches its own data), fits the app shell (`flex min-h-0 flex-1 flex-col` root, internal scroll).

- [ ] **Step 1: Write the failing test**

`frontend/src/components/ProductsView.test.tsx`:

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import ProductsView from "./ProductsView";

vi.mock("../api/client", () => ({
  getProducts: vi.fn().mockResolvedValue([
    { id: 1, name: "Network", description: "core", art_id: 1, art_name: "Platform ART",
      team_id: null, team_name: null, service_count: 3 },
    { id: 2, name: "Storage", description: null, art_id: 2, art_name: "Infra ART",
      team_id: 5, team_name: "Storage Team", service_count: 0 },
  ]),
  getProductServices: vi.fn().mockResolvedValue([]),
  getPersonOptions: vi.fn().mockResolvedValue([]),
  getServiceOptions: vi.fn().mockResolvedValue([]),
}));

describe("ProductsView", () => {
  it("groups products by ART with service counts", async () => {
    render(<ProductsView />);
    expect(await screen.findByText("Platform ART")).toBeInTheDocument();
    expect(screen.getByText("Infra ART")).toBeInTheDocument();
    expect(screen.getByText("Network")).toBeInTheDocument();
    expect(screen.getByText("3 services")).toBeInTheDocument();
    expect(screen.getByText("Team: Storage Team")).toBeInTheDocument();
  });

  it("opens the product detail on click", async () => {
    render(<ProductsView />);
    await userEvent.click(await screen.findByText("Network"));
    await waitFor(() => expect(screen.getByRole("button", { name: /back/i })).toBeInTheDocument());
  });
});
```

Run: `npx vitest run src/components/ProductsView.test.tsx` — expect FAIL (module missing).

- [ ] **Step 2: Implement ProductsView**

`frontend/src/components/ProductsView.tsx`:

```tsx
import { useCallback, useEffect, useState } from "react";
import { getProducts } from "../api/client";
import type { Product } from "../types";
import ProductDetail from "./ProductDetail";

export default function ProductsView() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const load = useCallback(
    () => getProducts().then(setProducts).finally(() => setLoading(false)),
    [],
  );
  useEffect(() => {
    void load();
  }, [load]);

  const selected = selectedId != null ? products.find((p) => p.id === selectedId) : null;
  if (selected) {
    return (
      <ProductDetail
        product={selected}
        onBack={() => {
          setSelectedId(null);
          void load();
        }}
      />
    );
  }

  const byArt = new Map<string, Product[]>();
  for (const p of products) {
    const key = p.art_name ?? "No ART";
    const list = byArt.get(key) ?? [];
    list.push(p);
    byArt.set(key, list);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-auto px-6 py-6">
        {loading ? (
          <div className="text-gray-500">Loading…</div>
        ) : products.length === 0 ? (
          <div className="py-16 text-center text-gray-400">
            No products yet. Admins can create them under Admin → Catalog.
          </div>
        ) : (
          [...byArt.entries()].map(([artName, list]) => (
            <section key={artName} className="mb-8">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-400">
                {artName}
              </h2>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {list.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => setSelectedId(p.id)}
                    className="rounded-xl border border-gray-200 bg-surface p-4 text-left shadow-xs transition hover:border-blue-300 hover:shadow-sm"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-gray-900">{p.name}</span>
                      <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                        {p.service_count} services
                      </span>
                    </div>
                    {p.description && (
                      <p className="mt-1 line-clamp-2 text-sm text-gray-500">{p.description}</p>
                    )}
                    {p.team_name && (
                      <p className="mt-2 text-xs text-gray-400">Team: {p.team_name}</p>
                    )}
                  </button>
                ))}
              </div>
            </section>
          ))
        )}
      </div>
    </div>
  );
}
```

Until Task 9 lands, create a minimal placeholder `frontend/src/components/ProductDetail.tsx` so this compiles (Task 9 replaces it entirely):

```tsx
import type { Product } from "../types";

export default function ProductDetail({
  product,
  onBack,
}: {
  product: Product;
  onBack: () => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col px-6 py-6">
      <button onClick={onBack} className="self-start text-sm text-blue-600">
        ← Back
      </button>
      <h1 className="mt-2 text-lg font-semibold text-gray-900">{product.name}</h1>
    </div>
  );
}
```

- [ ] **Step 3: Wire navigation in App.tsx**

- `type View = "board" | "admin" | "planning" | "timeline" | "ranking" | "products";`
- After `{navButton("ranking", "Ranking")}` add `{navButton("products", "Products")}`.
- In the render chain add, before the board fallback:

```tsx
      ) : view === "products" ? (
        <ProductsView />
```

and import `ProductsView` at the top.

- [ ] **Step 4: Run tests + typecheck**

Run: `npx vitest run src/components/ProductsView.test.tsx` — PASS.
Run: `npm run build` — clean. Run full `npm run test` — no regressions.

- [ ] **Step 5: Commit**

```bash
git add frontend/src
git commit -m "feat(catalog): Products view grouped by ART + top-level navigation"
```

---

### Task 9: Product detail — service tree + service drawer with dependencies

**Files:**
- Replace: `frontend/src/components/ProductDetail.tsx` (placeholder from Task 8)
- Create: `frontend/src/components/ServiceDrawer.tsx`
- Test: `frontend/src/components/ProductDetail.test.tsx`

**Interfaces:**
- Consumes: `getProductServices`, `createService`, `updateService`, `deleteService`, `getServiceDependencies`, `addServiceDependency`, `removeServiceDependency`, `getServiceOptions`, `getPersonOptions` (all Task 7 / existing); `PlainSelect` (`value: string | null, options: string[], onChange, placeholder?, ariaLabel?, disabled?, clearable?`); `SearchableSelect` (`value, options, onChange, placeholder?, ariaLabel?`); `ConfirmDialog` (`title, message, confirmLabel, onConfirm, onClose`); `btnSecondary`, `btnDanger`, `inputClass`, `captionClass` from `./ui`.
- Produces: `<ProductDetail product onBack />`; `<ServiceDrawer service productId onClose onChanged />`.

- [ ] **Step 1: Write the failing tests**

`frontend/src/components/ProductDetail.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { CatalogService, Product } from "../types";
import ProductDetail from "./ProductDetail";

const tree: CatalogService[] = [
  {
    id: 1, name: "Connectivity", description: null, product_id: 1,
    parent_service_id: null, owner_user_id: null, owner_name: null,
    lifecycle_state: "active",
    children: [
      { id: 2, name: "Campus LAN", description: null, product_id: 1,
        parent_service_id: 1, owner_user_id: null, owner_name: null,
        lifecycle_state: "planned", children: [] },
    ],
  },
];

vi.mock("../api/client", () => ({
  getProductServices: vi.fn().mockResolvedValue([]),
  getPersonOptions: vi.fn().mockResolvedValue([]),
  getServiceOptions: vi.fn().mockResolvedValue([]),
  getServiceDependencies: vi.fn().mockResolvedValue({ outbound: [], inbound: [] }),
  createService: vi.fn(),
  updateService: vi.fn(),
  deleteService: vi.fn(),
  addServiceDependency: vi.fn(),
  removeServiceDependency: vi.fn(),
}));

import { getProductServices } from "../api/client";

const product: Product = {
  id: 1, name: "Network", description: "core", art_id: 1, art_name: "Platform ART",
  team_id: null, team_name: null, service_count: 2,
};

describe("ProductDetail", () => {
  it("renders the service tree with lifecycle badges and expand/collapse", async () => {
    vi.mocked(getProductServices).mockResolvedValue(tree);
    render(<ProductDetail product={product} onBack={() => {}} />);
    expect(await screen.findByText("Connectivity")).toBeInTheDocument();
    expect(screen.getByText("active")).toBeInTheDocument();
    expect(screen.getByText("Campus LAN")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /collapse connectivity/i }));
    expect(screen.queryByText("Campus LAN")).not.toBeInTheDocument();
  });

  it("opens the drawer when a service is clicked", async () => {
    vi.mocked(getProductServices).mockResolvedValue(tree);
    render(<ProductDetail product={product} onBack={() => {}} />);
    await userEvent.click(await screen.findByText("Connectivity"));
    expect(await screen.findByRole("heading", { name: "Edit service" })).toBeInTheDocument();
  });

  it("shows the add-service form", async () => {
    vi.mocked(getProductServices).mockResolvedValue([]);
    render(<ProductDetail product={product} onBack={() => {}} />);
    await userEvent.click(await screen.findByRole("button", { name: /add service/i }));
    expect(screen.getByPlaceholderText("Service name")).toBeInTheDocument();
  });
});
```

Run: `npx vitest run src/components/ProductDetail.test.tsx` — expect FAIL.

- [ ] **Step 2: Implement ProductDetail**

Replace `frontend/src/components/ProductDetail.tsx`:

```tsx
import { useCallback, useEffect, useState } from "react";
import { createService, getProductServices } from "../api/client";
import type { CatalogService, LifecycleState, Product } from "../types";
import ServiceDrawer from "./ServiceDrawer";
import { btnPrimary, btnSecondary, inputClass } from "./ui";

const BADGE: Record<LifecycleState, string> = {
  planned: "bg-blue-50 text-blue-700",
  active: "bg-emerald-50 text-emerald-700",
  deprecated: "bg-amber-50 text-amber-700",
  retired: "bg-gray-100 text-gray-500",
};

function ServiceNode({
  service,
  depth,
  onOpen,
}: {
  service: CatalogService;
  depth: number;
  onOpen: (s: CatalogService) => void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div style={{ marginLeft: depth ? 20 : 0 }}>
      <div className="mb-1.5 flex items-center gap-2 rounded-lg border border-gray-200 bg-surface px-3 py-2">
        {service.children.length > 0 && (
          <button
            aria-label={`${open ? "Collapse" : "Expand"} ${service.name}`}
            onClick={() => setOpen((v) => !v)}
            className="text-xs text-gray-400 hover:text-gray-600"
          >
            {open ? "▾" : "▸"}
          </button>
        )}
        <button onClick={() => onOpen(service)} className="flex-1 text-left text-sm font-medium text-gray-800">
          {service.name}
        </button>
        {service.owner_name && <span className="text-xs text-gray-400">{service.owner_name}</span>}
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${BADGE[service.lifecycle_state]}`}>
          {service.lifecycle_state}
        </span>
      </div>
      {open &&
        service.children.map((c) => (
          <ServiceNode key={c.id} service={c} depth={depth + 1} onOpen={onOpen} />
        ))}
    </div>
  );
}

export default function ProductDetail({
  product,
  onBack,
}: {
  product: Product;
  onBack: () => void;
}) {
  const [tree, setTree] = useState<CatalogService[]>([]);
  const [drawer, setDrawer] = useState<CatalogService | null>(null);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");

  const load = useCallback(
    () => getProductServices(product.id).then(setTree),
    [product.id],
  );
  useEffect(() => {
    void load();
  }, [load]);

  const addService = async () => {
    if (!newName.trim()) return;
    await createService({ name: newName.trim(), product_id: product.id });
    setNewName("");
    setAdding(false);
    await load();
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-auto px-6 py-6">
        <button onClick={onBack} className="text-sm text-blue-600 hover:underline">
          ← Back to products
        </button>
        <div className="mt-2 mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold text-gray-900">{product.name}</h1>
            <p className="text-sm text-gray-500">
              {product.art_name}
              {product.team_name ? ` · Team ${product.team_name}` : ""}
            </p>
            {product.description && (
              <p className="mt-1 max-w-2xl text-sm text-gray-600">{product.description}</p>
            )}
          </div>
          <button onClick={() => setAdding((v) => !v)} className={btnSecondary}>
            Add service
          </button>
        </div>
        {adding && (
          <div className="mb-4 flex max-w-md items-center gap-2">
            <input
              autoFocus
              placeholder="Service name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void addService()}
              className={inputClass}
            />
            <button onClick={() => void addService()} className={btnPrimary}>
              Create
            </button>
          </div>
        )}
        {tree.length === 0 ? (
          <div className="py-12 text-center text-sm text-gray-400">No services yet.</div>
        ) : (
          tree.map((s) => <ServiceNode key={s.id} service={s} depth={0} onOpen={setDrawer} />)
        )}
      </div>
      {drawer && (
        <ServiceDrawer
          service={drawer}
          productId={product.id}
          onClose={() => setDrawer(null)}
          onChanged={async () => {
            await load();
          }}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 3: Implement ServiceDrawer**

`frontend/src/components/ServiceDrawer.tsx`:

```tsx
import { useCallback, useEffect, useState } from "react";
import {
  addServiceDependency,
  deleteService,
  getPersonOptions,
  getServiceDependencies,
  getServiceOptions,
  removeServiceDependency,
  updateService,
} from "../api/client";
import type {
  CatalogService,
  DependencyCriticality,
  DependencyType,
  PersonOption,
  ServiceDependencies,
  ServiceOption,
} from "../types";
import ConfirmDialog from "./ConfirmDialog";
import PlainSelect from "./PlainSelect";
import SearchableSelect from "./SearchableSelect";
import { btnDangerGhost, btnPrimary, btnSecondary, captionClass, inputClass } from "./ui";

const STATES = ["planned", "active", "deprecated", "retired"];
const DEP_TYPES: DependencyType[] = ["requires", "uses"];
const CRITICALITIES: DependencyCriticality[] = ["critical", "important", "optional"];

export default function ServiceDrawer({
  service,
  productId,
  onClose,
  onChanged,
}: {
  service: CatalogService;
  productId: number;
  onClose: () => void;
  onChanged: () => Promise<void> | void;
}) {
  const [name, setName] = useState(service.name);
  const [description, setDescription] = useState(service.description ?? "");
  const [state, setState] = useState<string>(service.lifecycle_state);
  const [people, setPeople] = useState<PersonOption[]>([]);
  const [ownerName, setOwnerName] = useState<string | null>(service.owner_name);
  const [deps, setDeps] = useState<ServiceDependencies>({ outbound: [], inbound: [] });
  const [options, setOptions] = useState<ServiceOption[]>([]);
  const [depTarget, setDepTarget] = useState<string | null>(null);
  const [depType, setDepType] = useState<DependencyType>("requires");
  const [depCrit, setDepCrit] = useState<DependencyCriticality>("important");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadDeps = useCallback(
    () => getServiceDependencies(service.id).then(setDeps),
    [service.id],
  );
  useEffect(() => {
    void loadDeps();
    void getPersonOptions().then(setPeople);
    void getServiceOptions().then(setOptions);
  }, [loadDeps]);

  const optionLabel = (o: ServiceOption) => `${o.name} (${o.product_name ?? "?"})`;
  const pickable = options.filter((o) => o.id !== service.id);

  const save = async () => {
    setError(null);
    try {
      const owner = people.find((p) => p.display_name === ownerName);
      await updateService(service.id, {
        name,
        description: description || null,
        lifecycle_state: state as CatalogService["lifecycle_state"],
        owner_user_id: owner ? owner.id : null,
      });
      await onChanged();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    }
  };

  const addDep = async () => {
    const target = pickable.find((o) => optionLabel(o) === depTarget);
    if (!target) return;
    setError(null);
    try {
      await addServiceDependency(service.id, {
        to_service_id: target.id,
        dep_type: depType,
        criticality: depCrit,
      });
      setDepTarget(null);
      await loadDeps();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add dependency");
    }
  };

  const remove = async () => {
    setError(null);
    try {
      await deleteService(service.id);
      await onChanged();
      onClose();
    } catch (e) {
      setConfirmDelete(false);
      setError(e instanceof Error ? e.message : "Delete blocked");
    }
  };

  return (
    <aside
      aria-label="Service drawer"
      className="fixed inset-y-0 right-0 z-40 flex w-[26rem] flex-col overflow-y-auto border-l border-gray-200 bg-surface p-5 shadow-2xl"
    >
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-semibold text-gray-900">Edit service</h2>
        <button onClick={onClose} aria-label="Close" className="text-gray-400 hover:text-gray-600">
          ✕
        </button>
      </div>
      {error && (
        <div className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      )}
      <label className={captionClass}>Name</label>
      <input value={name} onChange={(e) => setName(e.target.value)} className={`${inputClass} mb-3`} />
      <label className={captionClass}>Description</label>
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        rows={3}
        className={`${inputClass} mb-3`}
      />
      <label className={captionClass}>Lifecycle</label>
      <div className="mb-3">
        <PlainSelect
          ariaLabel="Lifecycle state"
          value={state}
          options={STATES}
          onChange={(v) => v && setState(v)}
          clearable={false}
        />
      </div>
      <label className={captionClass}>Owner</label>
      <div className="mb-4">
        <SearchableSelect
          ariaLabel="Service owner"
          value={ownerName}
          options={people.map((p) => p.display_name)}
          onChange={setOwnerName}
        />
      </div>

      <h3 className="mb-2 text-sm font-semibold text-gray-700">Depends on</h3>
      <ul className="mb-2 flex flex-col gap-1.5">
        {deps.outbound.map((d) => (
          <li key={d.id} className="flex items-center gap-2 rounded-lg bg-gray-50 px-2.5 py-1.5 text-sm">
            <span className="flex-1 truncate text-gray-800">
              {d.to_service_name}
              <span className="text-gray-400"> ({d.to_product_name})</span>
            </span>
            <span className="rounded-full bg-gray-200 px-1.5 text-xs text-gray-600">{d.dep_type}</span>
            <span className="rounded-full bg-amber-50 px-1.5 text-xs text-amber-700">{d.criticality}</span>
            <button
              aria-label={`Remove dependency on ${d.to_service_name}`}
              onClick={() => void removeServiceDependency(service.id, d.id).then(loadDeps)}
              className="text-xs text-gray-400 hover:text-red-600"
            >
              ✕
            </button>
          </li>
        ))}
        {deps.outbound.length === 0 && <li className="text-sm text-gray-400">None</li>}
      </ul>
      <div className="mb-1.5">
        <SearchableSelect
          ariaLabel="Add dependency"
          value={depTarget}
          options={pickable.map(optionLabel)}
          onChange={setDepTarget}
          placeholder="Add dependency…"
        />
      </div>
      {depTarget && (
        <div className="mb-3 flex items-center gap-2">
          <PlainSelect
            ariaLabel="Dependency type"
            value={depType}
            options={DEP_TYPES as unknown as string[]}
            onChange={(v) => v && setDepType(v as DependencyType)}
            clearable={false}
          />
          <PlainSelect
            ariaLabel="Dependency criticality"
            value={depCrit}
            options={CRITICALITIES as unknown as string[]}
            onChange={(v) => v && setDepCrit(v as DependencyCriticality)}
            clearable={false}
          />
          <button onClick={() => void addDep()} className={btnSecondary}>
            Add
          </button>
        </div>
      )}

      <h3 className="mb-2 mt-2 text-sm font-semibold text-gray-700">Used by</h3>
      <ul className="mb-4 flex flex-col gap-1.5">
        {deps.inbound.map((d) => (
          <li key={d.id} className="rounded-lg bg-gray-50 px-2.5 py-1.5 text-sm text-gray-800">
            {d.from_service_name}
            <span className="text-gray-400"> ({d.from_product_name})</span>
          </li>
        ))}
        {deps.inbound.length === 0 && <li className="text-sm text-gray-400">None</li>}
      </ul>

      <div className="mt-auto flex items-center justify-between gap-2 pt-4">
        <button onClick={() => setConfirmDelete(true)} className={btnDangerGhost}>
          Delete
        </button>
        <div className="flex gap-2">
          <button onClick={onClose} className={btnSecondary}>
            Cancel
          </button>
          <button onClick={() => void save()} className={btnPrimary}>
            Save
          </button>
        </div>
      </div>
      {confirmDelete && (
        <ConfirmDialog
          title="Delete service"
          message={`Delete “${service.name}”? Sub-services or inbound dependencies will block this.`}
          confirmLabel="Delete"
          onConfirm={remove}
          onClose={() => setConfirmDelete(false)}
        />
      )}
    </aside>
  );
}
```

Note: `productId` is currently unused inside the drawer but part of the interface for adding sub-services later; if the typecheck complains, prefix it with `_` or drop it from both files consistently.

- [ ] **Step 4: Run tests + typecheck**

Run: `npx vitest run src/components/ProductDetail.test.tsx` — PASS.
Run: `npm run build` and full `npm run test` — clean.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components
git commit -m "feat(catalog): product detail with service tree + service drawer (deps, lifecycle)"
```

---

### Task 10: Admin → Catalog section

**Files:**
- Create: `frontend/src/components/admin/CatalogSection.tsx`
- Modify: `frontend/src/components/admin/AdminView.tsx` (register section)
- Modify: `frontend/src/icons.ts` (export `faSitemap` from the duotone package, same pattern as existing icons)
- Test: `frontend/src/components/admin/CatalogSection.test.tsx`

**Interfaces:**
- Consumes: `getArts/createArt/updateArt/deleteArt`, `getProducts/createProduct/updateProduct/deleteProduct`, `getTeams` (existing), `PlainSelect`, `ConfirmDialog`, ui classes.
- Produces: `<CatalogSection />` self-contained admin panel.

- [ ] **Step 1: Write the failing test**

`frontend/src/components/admin/CatalogSection.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import CatalogSection from "./CatalogSection";

vi.mock("../../api/client", () => ({
  getArts: vi.fn().mockResolvedValue([{ id: 1, name: "Platform ART", description: null }]),
  getProducts: vi.fn().mockResolvedValue([
    { id: 1, name: "Network", description: null, art_id: 1, art_name: "Platform ART",
      team_id: null, team_name: null, service_count: 0 },
  ]),
  getTeams: vi.fn().mockResolvedValue([{ id: 1, name: "Net Team" }]),
  createArt: vi.fn().mockResolvedValue({ id: 2, name: "New ART", description: null }),
  updateArt: vi.fn(),
  deleteArt: vi.fn(),
  createProduct: vi.fn(),
  updateProduct: vi.fn(),
  deleteProduct: vi.fn(),
}));

import { createArt, deleteProduct } from "../../api/client";

describe("CatalogSection", () => {
  it("lists ARTs and products", async () => {
    render(<CatalogSection />);
    expect(await screen.findByText("Platform ART")).toBeInTheDocument();
    expect(await screen.findByText("Network")).toBeInTheDocument();
  });

  it("creates an ART", async () => {
    render(<CatalogSection />);
    await screen.findByText("Platform ART");
    await userEvent.type(screen.getByPlaceholderText("New ART name"), "New ART");
    await userEvent.click(screen.getByRole("button", { name: "Add ART" }));
    expect(createArt).toHaveBeenCalledWith("New ART");
  });

  it("asks for confirmation before deleting a product", async () => {
    render(<CatalogSection />);
    await userEvent.click(await screen.findByRole("button", { name: /delete network/i }));
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(deleteProduct).toHaveBeenCalledWith(1);
  });
});
```

Run: `npx vitest run src/components/admin/CatalogSection.test.tsx` — expect FAIL.

- [ ] **Step 2: Implement CatalogSection**

`frontend/src/components/admin/CatalogSection.tsx`:

```tsx
import { useCallback, useEffect, useState } from "react";
import {
  createArt,
  createProduct,
  deleteArt,
  deleteProduct,
  getArts,
  getProducts,
  getTeams,
  updateProduct,
} from "../../api/client";
import type { Art, Product, Team } from "../../types";
import ConfirmDialog from "../ConfirmDialog";
import PlainSelect from "../PlainSelect";
import { btnDangerGhost, btnSecondary, captionClass, inputClass } from "../ui";

export default function CatalogSection() {
  const [arts, setArts] = useState<Art[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [newArt, setNewArt] = useState("");
  const [newProduct, setNewProduct] = useState("");
  const [newProductArt, setNewProductArt] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ kind: "art" | "product"; id: number; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [a, p, t] = await Promise.all([getArts(), getProducts(), getTeams()]);
    setArts(a);
    setProducts(p);
    setTeams(t);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    }
  };

  const addArt = () =>
    run(async () => {
      if (newArt.trim()) await createArt(newArt.trim());
      setNewArt("");
    });

  const addProduct = () =>
    run(async () => {
      const art = arts.find((a) => a.name === newProductArt);
      if (newProduct.trim() && art) {
        await createProduct({ name: newProduct.trim(), art_id: art.id });
      }
      setNewProduct("");
    });

  const linkTeam = (product: Product, teamName: string | null) =>
    run(() =>
      updateProduct(product.id, {
        team_id: teamName ? teams.find((t) => t.name === teamName)?.id ?? null : null,
      }),
    );

  const changeArt = (product: Product, artName: string | null) => {
    const art = arts.find((a) => a.name === artName);
    if (art) void run(() => updateProduct(product.id, { art_id: art.id }));
  };

  return (
    <div className="flex flex-col gap-6">
      {error && (
        <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      )}

      <section className="rounded-xl border border-gray-200 bg-surface p-4">
        <h2 className="mb-3 text-sm font-semibold text-gray-900">ARTs</h2>
        <ul className="mb-3 flex flex-col gap-1.5">
          {arts.map((a) => (
            <li key={a.id} className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-1.5 text-sm">
              <span className="text-gray-800">{a.name}</span>
              <button
                aria-label={`Delete ${a.name}`}
                onClick={() => setConfirm({ kind: "art", id: a.id, name: a.name })}
                className={btnDangerGhost}
              >
                Delete
              </button>
            </li>
          ))}
          {arts.length === 0 && <li className="text-sm text-gray-400">No ARTs yet.</li>}
        </ul>
        <div className="flex items-center gap-2">
          <input
            placeholder="New ART name"
            value={newArt}
            onChange={(e) => setNewArt(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void addArt()}
            className={inputClass}
          />
          <button onClick={() => void addArt()} className={btnSecondary}>
            Add ART
          </button>
        </div>
      </section>

      <section className="rounded-xl border border-gray-200 bg-surface p-4">
        <h2 className="mb-3 text-sm font-semibold text-gray-900">Products</h2>
        <ul className="mb-3 flex flex-col gap-2">
          {products.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-3 rounded-lg bg-gray-50 px-3 py-2 text-sm">
              <span className="min-w-32 font-medium text-gray-800">{p.name}</span>
              <div className="flex items-center gap-1.5">
                <span className={captionClass}>ART</span>
                <PlainSelect
                  ariaLabel={`ART for ${p.name}`}
                  value={p.art_name}
                  options={arts.map((a) => a.name)}
                  onChange={(v) => changeArt(p, v)}
                  clearable={false}
                />
              </div>
              <div className="flex items-center gap-1.5">
                <span className={captionClass}>Team</span>
                <PlainSelect
                  ariaLabel={`Team for ${p.name}`}
                  value={p.team_name}
                  options={teams
                    .filter((t) => t.id === p.team_id || !products.some((q) => q.team_id === t.id))
                    .map((t) => t.name)}
                  onChange={(v) => linkTeam(p, v)}
                />
              </div>
              <span className="ml-auto text-xs text-gray-400">{p.service_count} services</span>
              <button
                aria-label={`Delete ${p.name}`}
                onClick={() => setConfirm({ kind: "product", id: p.id, name: p.name })}
                className={btnDangerGhost}
              >
                Delete
              </button>
            </li>
          ))}
          {products.length === 0 && <li className="text-sm text-gray-400">No products yet.</li>}
        </ul>
        <div className="flex items-center gap-2">
          <input
            placeholder="New product name"
            value={newProduct}
            onChange={(e) => setNewProduct(e.target.value)}
            className={inputClass}
          />
          <PlainSelect
            ariaLabel="ART for new product"
            value={newProductArt}
            options={arts.map((a) => a.name)}
            onChange={setNewProductArt}
            placeholder="ART…"
            clearable={false}
          />
          <button onClick={() => void addProduct()} className={btnSecondary}>
            Add product
          </button>
        </div>
      </section>

      {confirm && (
        <ConfirmDialog
          title={`Delete ${confirm.kind === "art" ? "ART" : "product"}`}
          message={`Delete “${confirm.name}”? Linked ${
            confirm.kind === "art" ? "products" : "services"
          } will block this.`}
          confirmLabel="Delete"
          onConfirm={async () => {
            const { kind, id } = confirm;
            setConfirm(null);
            await run(() => (kind === "art" ? deleteArt(id) : deleteProduct(id)));
          }}
          onClose={() => setConfirm(null)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 3: Register in AdminView**

In `frontend/src/components/admin/AdminView.tsx`:
- add `"catalog"` to the `AdminSection` union
- add `{ id: "catalog", label: "Catalog", icon: faSitemap }` to `SECTIONS` (after "containers")
- import `CatalogSection` and render `{section === "catalog" && <CatalogSection />}`
- export `faSitemap` from `frontend/src/icons.ts` (duotone, same import style as the existing icons there).

- [ ] **Step 4: Run tests + typecheck**

Run: `npx vitest run src/components/admin/CatalogSection.test.tsx`, then full `npm run test` and `npm run build`.
Expected: all pass, clean build.

- [ ] **Step 5: Commit**

```bash
git add frontend/src
git commit -m "feat(catalog): Admin Catalog section — ART + product management"
```

---

### Task 11: Full verification + docs

**Files:**
- Modify: `CLAUDE.md` (migration head 0026; mention `app/catalog/` in architecture)
- Modify: `README.md` only if it documents the API/views (check first)

**Steps:**

- [ ] **Step 1: Full test suites**

```bash
cd backend && . .venv/bin/activate && pytest
cd ../frontend && npm run test && npm run build
```
Expected: everything green.

- [ ] **Step 2: Rebuild Docker images and verify in the stack**

```bash
export FONTAWESOME_PACKAGE_TOKEN=$(tr -d '\n' < frontend/.fa-token)
docker compose build backend frontend
docker compose up -d
```
Then verify with Playwright against http://localhost:8080 (the backend auto-runs `alembic upgrade head` on start — confirm the log shows `0026`):
1. Log in as admin → Admin → Catalog: create ART "Platform ART", product "Network" linked to a team.
2. Products view: product card appears under the ART with 0 services; open it, add service "Connectivity", add sub-service is possible via drawer parent later — add second service "DNS", open "Connectivity", add dependency on "DNS" (requires/critical), verify "Used by" on DNS.
3. Try deleting DNS → blocked with the 409 message; remove the dependency, delete succeeds.
4. Board view: existing items still show their ART strings (filter/CSV unaffected).
5. Check dark mode on the new views (badges, drawer, admin section).

- [ ] **Step 3: Update CLAUDE.md**

In the Migrations section: change the head to `0026`. In the backend architecture section, add one line:
`**Catalog bounded context:** [catalog/](backend/app/catalog/) — domain dataclasses + repository ports + Postgres adapter (datasource-exchangeable); ORM tables stay in models.py; items.art is a FK to arts exposed as a string.`

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md README.md
git commit -m "docs: catalog architecture + migration head 0026"
```

- [ ] **Step 5: Finish the branch**

Use superpowers:finishing-a-development-branch (tests green → present merge/PR options).
