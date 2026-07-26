# Components & Systems Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Type-level components and composed systems with vendor EoL/EoS lifecycle, service "provided by" links, computed risk rollup, and a cross-product Lifecycle view — per `docs/superpowers/specs/2026-07-26-components-systems-lifecycle-design.md`.

**Architecture:** Extends the existing `backend/app/catalog/` bounded context (pure domain + repository Protocols + Postgres adapter + factory). ORM classes stay in `app/models.py`; migration `0027`. New routers `components.py`, `systems.py`; the services router gains tech endpoints. Frontend: product-detail tabs, two new drawers, a "Provided by" drawer block, and a top-level Lifecycle view.

**Tech Stack:** FastAPI, SQLAlchemy 2.0, Alembic, Pydantic v2, pytest; React + TypeScript + Tailwind v4, Vitest + Testing Library.

## Global Constraints

- API base `/api/v1`; all new routers mount under `Depends(require_user)` in `main.py`; every endpoint here is writable by ANY signed-in user (no `require_admin`).
- Enum columns: `Enum(<enum>, native_enum=False, values_callable=lambda e: [m.value for m in e], length=16)` — persisted values are the lowercase enum values.
- New enum `LifecycleStage`: `plan | build | operate | phase_out | retired` (default `plan`). Risk levels `ok | warning | danger` are computed, never stored.
- Risk rule: `danger` when `end_of_support` or `end_of_life` ≤ today; `warning` when either is within the next 365 days; else `ok`. Service risk = worst of direct components + all components of linked systems. System risk = worst of members.
- Vendor get-or-create by trimmed name (pattern of `get_or_create_art_id`); vendors are never deleted in this cut.
- Deletion guards → `CatalogInUse` (409): component in any system or linked to any service; system linked to any service; product now additionally blocked by components/systems.
- Error mapping (already wired app-level): `CatalogNotFound`→404, `CatalogRuleViolation`→422, `CatalogInUse`→409; read-only repo writes → 405 via `check_writable`.
- Audit: `log_event` on every mutation; UPDATE endpoints log field-level events (change detection by id/value; names — not ids — in old/new values; dates as ISO strings).
- Migrations: named FKs (`fk_<table>_<col>` where added post-hoc; inline FKs fine inside `create_table`); dry-run `alembic upgrade head` AND `alembic downgrade -1` against compose Postgres (`docker compose up -d db`).
- Never import `DateTime` from sqlalchemy for columns (use `app.timeutil`); plain `sqlalchemy.Date` for the four vendor date columns is correct (no tz).
- Frontend: custom dropdowns only (`PlainSelect`/`SearchableSelect`); icons only via `frontend/src/icons.ts`; new views fit the fixed app shell (`flex min-h-0 flex-1 flex-col` root, internal `overflow-auto` scroll region).
- Backend commands from `backend/` with venv active (`. .venv/bin/activate`); frontend from `frontend/`.
- Work on branch `feat/components-systems` off `main`.

---

### Task 1: Domain — enums, dataclasses, risk functions

**Files:**
- Modify: `backend/app/catalog/domain.py` (append)
- Test: `backend/tests/catalog/test_risk.py`

**Interfaces:**
- Consumes: existing `domain.py` (dataclass/enum patterns).
- Produces: `LifecycleStage`, `RiskLevel`, `RISK_WARNING_DAYS = 365`; dataclasses `Vendor(id, name, notes)`, `Component(id, name, product_id, model, description, vendor_id, lifecycle_stage, quantity, eos_announced, end_of_sale, end_of_support, end_of_life, vendor_name, product_name, risk)`, `SystemMember(component, quantity)`, `System(id, name, product_id, description, lifecycle_stage, members, product_name, risk)`, `ServiceTech(components, systems, risk)`; functions `component_risk(*, end_of_support, end_of_life, today) -> RiskLevel`, `worst_risk(levels) -> RiskLevel`.

- [ ] **Step 1: Write the failing tests**

`backend/tests/catalog/test_risk.py`:

```python
from datetime import date, timedelta

from app.catalog.domain import (
    Component,
    LifecycleStage,
    RiskLevel,
    component_risk,
    worst_risk,
)

TODAY = date(2026, 7, 26)


def _risk(eos=None, eol=None):
    return component_risk(end_of_support=eos, end_of_life=eol, today=TODAY)


def test_no_dates_is_ok():
    assert _risk() == RiskLevel.OK


def test_far_future_is_ok():
    assert _risk(eos=TODAY + timedelta(days=366)) == RiskLevel.OK


def test_within_365_days_is_warning():
    assert _risk(eos=TODAY + timedelta(days=365)) == RiskLevel.WARNING
    assert _risk(eol=TODAY + timedelta(days=1)) == RiskLevel.WARNING


def test_today_or_past_is_danger():
    assert _risk(eos=TODAY) == RiskLevel.DANGER
    assert _risk(eol=TODAY - timedelta(days=1)) == RiskLevel.DANGER


def test_worst_date_wins():
    assert _risk(eos=TODAY + timedelta(days=400), eol=TODAY - timedelta(days=1)) == RiskLevel.DANGER


def test_worst_risk():
    assert worst_risk([]) == RiskLevel.OK
    assert worst_risk([RiskLevel.OK, RiskLevel.WARNING]) == RiskLevel.WARNING
    assert worst_risk([RiskLevel.WARNING, RiskLevel.DANGER, RiskLevel.OK]) == RiskLevel.DANGER


def test_component_defaults():
    c = Component(id=1, name="C9300", product_id=1)
    assert c.lifecycle_stage == LifecycleStage.PLAN
    assert c.risk == RiskLevel.OK
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/catalog/test_risk.py -v`
Expected: FAIL — `ImportError: cannot import name 'component_risk'`

- [ ] **Step 3: Implement**

Append to `backend/app/catalog/domain.py` (add `from datetime import date, timedelta` and `from collections.abc import Iterable` to the imports):

```python
class LifecycleStage(str, enum.Enum):
    PLAN = "plan"
    BUILD = "build"
    OPERATE = "operate"
    PHASE_OUT = "phase_out"
    RETIRED = "retired"


class RiskLevel(str, enum.Enum):
    OK = "ok"
    WARNING = "warning"
    DANGER = "danger"


RISK_WARNING_DAYS = 365

_RISK_ORDER = {RiskLevel.OK: 0, RiskLevel.WARNING: 1, RiskLevel.DANGER: 2}


@dataclass
class Vendor:
    id: int | None
    name: str
    notes: str | None = None


@dataclass
class Component:
    id: int | None
    name: str
    product_id: int
    model: str | None = None
    description: str | None = None
    vendor_id: int | None = None
    lifecycle_stage: LifecycleStage = LifecycleStage.PLAN
    quantity: int | None = None
    eos_announced: date | None = None
    end_of_sale: date | None = None
    end_of_support: date | None = None
    end_of_life: date | None = None
    # read-side enrichments filled by adapters
    vendor_name: str | None = None
    product_name: str | None = None
    risk: RiskLevel = RiskLevel.OK


@dataclass
class SystemMember:
    component: Component
    quantity: int | None = None


@dataclass
class System:
    id: int | None
    name: str
    product_id: int
    description: str | None = None
    lifecycle_stage: LifecycleStage = LifecycleStage.PLAN
    members: list[SystemMember] = field(default_factory=list)
    # read-side enrichments
    product_name: str | None = None
    risk: RiskLevel = RiskLevel.OK


@dataclass
class ServiceTech:
    components: list[Component] = field(default_factory=list)
    systems: list[System] = field(default_factory=list)
    risk: RiskLevel = RiskLevel.OK


def component_risk(*, end_of_support: date | None, end_of_life: date | None,
                   today: date) -> RiskLevel:
    """danger once support/life has ended; warning inside the 365-day window."""
    dates = [d for d in (end_of_support, end_of_life) if d is not None]
    if any(d <= today for d in dates):
        return RiskLevel.DANGER
    if any(d <= today + timedelta(days=RISK_WARNING_DAYS) for d in dates):
        return RiskLevel.WARNING
    return RiskLevel.OK


def worst_risk(levels: Iterable[RiskLevel]) -> RiskLevel:
    return max(levels, key=lambda lv: _RISK_ORDER[lv], default=RiskLevel.OK)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/catalog/test_risk.py -v` → 7 passed. Then `pytest tests/catalog/ -q` → no regressions.

- [ ] **Step 5: Commit**

```bash
git checkout -b feat/components-systems
git add backend/app/catalog/domain.py backend/tests/catalog/test_risk.py
git commit -m "feat(lifecycle): domain enums, component/system dataclasses, risk functions"
```

---

### Task 2: ORM models + migration 0027

**Files:**
- Modify: `backend/app/models.py` (append after `ServiceDependency`; extend the `app.catalog.domain` import with `LifecycleStage`; add `Date` to the sqlalchemy import and `date` to the datetime import)
- Create: `backend/alembic/versions/0027_components_systems.py`
- Test: `backend/tests/catalog/test_component_models.py`

**Interfaces:**
- Produces: ORM `Vendor`, `Component`, `System`, `SystemComponent`, association tables `service_components`, `service_systems`; relationships `Component.vendor`, `Component.product`, `System.product`, `SystemComponent.component`, `System.memberships`.

- [ ] **Step 1: Write the failing test**

`backend/tests/catalog/test_component_models.py`:

```python
from datetime import date

from app.catalog.domain import LifecycleStage
from app.models import (
    Art,
    Component,
    Product,
    Service,
    System,
    SystemComponent,
    Vendor,
    service_components,
    service_systems,
)


def test_component_system_roundtrip(db_session):
    art = Art(name="A")
    db_session.add(art)
    db_session.flush()
    product = Product(name="Network", art_id=art.id)
    vendor = Vendor(name="Cisco")
    db_session.add_all([product, vendor])
    db_session.flush()
    comp = Component(
        name="Catalyst 9300", model="C9300-48P", product_id=product.id,
        vendor_id=vendor.id, lifecycle_stage=LifecycleStage.OPERATE,
        quantity=120, end_of_support=date(2028, 10, 31),
    )
    system = System(name="Campus fabric", product_id=product.id)
    db_session.add_all([comp, system])
    db_session.flush()
    db_session.add(SystemComponent(system_id=system.id, component_id=comp.id, quantity=80))
    svc = Service(name="Connectivity", product_id=product.id)
    db_session.add(svc)
    db_session.flush()
    db_session.execute(service_components.insert().values(service_id=svc.id, component_id=comp.id))
    db_session.execute(service_systems.insert().values(service_id=svc.id, system_id=system.id))
    db_session.commit()

    assert comp.vendor.name == "Cisco"
    assert comp.product.name == "Network"
    assert system.memberships[0].component.name == "Catalyst 9300"
    assert system.memberships[0].quantity == 80


def test_lifecycle_stage_persists_value(db_session):
    from sqlalchemy import text

    art = Art(name="A")
    db_session.add(art)
    db_session.flush()
    product = Product(name="P", art_id=art.id)
    db_session.add(product)
    db_session.flush()
    comp = Component(name="X", product_id=product.id, lifecycle_stage=LifecycleStage.PHASE_OUT)
    db_session.add(comp)
    db_session.commit()
    raw = db_session.execute(
        text("SELECT lifecycle_stage FROM components WHERE id = :i"), {"i": comp.id}
    ).scalar_one()
    assert raw == "phase_out"
```

- [ ] **Step 2: Run to verify failure**

Run: `pytest tests/catalog/test_component_models.py -v`
Expected: `ImportError: cannot import name 'Vendor' from 'app.models'`

- [ ] **Step 3: Add the ORM models**

In `backend/app/models.py`:
- extend `from app.catalog.domain import Criticality, DependencyType, LifecycleState` with `LifecycleStage`
- add `Date` to the `from sqlalchemy import ...` list and `date` to `from datetime import datetime` (→ `from datetime import date, datetime`)
- append at the end of the file:

```python
service_components = Table(
    "service_components",
    Base.metadata,
    Column("service_id", Integer, ForeignKey("services.id", ondelete="CASCADE"), primary_key=True),
    Column("component_id", Integer, ForeignKey("components.id", ondelete="RESTRICT"), primary_key=True),
)

service_systems = Table(
    "service_systems",
    Base.metadata,
    Column("service_id", Integer, ForeignKey("services.id", ondelete="CASCADE"), primary_key=True),
    Column("system_id", Integer, ForeignKey("systems.id", ondelete="RESTRICT"), primary_key=True),
)


class Vendor(Base):
    __tablename__ = "vendors"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(128), unique=True)
    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow, server_default=func.now()
    )


class Component(Base):
    __tablename__ = "components"
    __table_args__ = (UniqueConstraint("product_id", "name", name="uq_component_product_name"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(128))
    model: Mapped[str | None] = mapped_column(String(64))
    description: Mapped[str | None] = mapped_column(Text)
    product_id: Mapped[int] = mapped_column(
        ForeignKey("products.id", ondelete="RESTRICT"), index=True
    )
    vendor_id: Mapped[int | None] = mapped_column(
        ForeignKey("vendors.id", ondelete="SET NULL"), index=True
    )
    lifecycle_stage: Mapped[LifecycleStage] = mapped_column(
        Enum(LifecycleStage, native_enum=False,
             values_callable=lambda e: [m.value for m in e], length=16),
        default=LifecycleStage.PLAN,
        server_default="plan",
    )
    quantity: Mapped[int | None] = mapped_column(Integer)
    eos_announced: Mapped[date | None] = mapped_column(Date)
    end_of_sale: Mapped[date | None] = mapped_column(Date)
    end_of_support: Mapped[date | None] = mapped_column(Date)
    end_of_life: Mapped[date | None] = mapped_column(Date)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow, server_default=func.now()
    )

    product: Mapped["Product"] = relationship()
    vendor: Mapped["Vendor | None"] = relationship()


class System(Base):
    __tablename__ = "systems"
    __table_args__ = (UniqueConstraint("product_id", "name", name="uq_system_product_name"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(128))
    description: Mapped[str | None] = mapped_column(Text)
    product_id: Mapped[int] = mapped_column(
        ForeignKey("products.id", ondelete="RESTRICT"), index=True
    )
    lifecycle_stage: Mapped[LifecycleStage] = mapped_column(
        Enum(LifecycleStage, native_enum=False,
             values_callable=lambda e: [m.value for m in e], length=16),
        default=LifecycleStage.PLAN,
        server_default="plan",
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow, server_default=func.now()
    )

    product: Mapped["Product"] = relationship()
    memberships: Mapped[list["SystemComponent"]] = relationship(
        cascade="all, delete-orphan", back_populates="system"
    )


class SystemComponent(Base):
    __tablename__ = "system_components"
    __table_args__ = (
        UniqueConstraint("system_id", "component_id", name="uq_system_component"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    system_id: Mapped[int] = mapped_column(
        ForeignKey("systems.id", ondelete="CASCADE"), index=True
    )
    component_id: Mapped[int] = mapped_column(
        ForeignKey("components.id", ondelete="RESTRICT"), index=True
    )
    quantity: Mapped[int | None] = mapped_column(Integer)

    system: Mapped["System"] = relationship(back_populates="memberships")
    component: Mapped["Component"] = relationship()
```

- [ ] **Step 4: Run tests**

`pytest tests/catalog/test_component_models.py -v` → 2 passed; full `pytest` → no regressions.

- [ ] **Step 5: Write migration 0027**

`backend/alembic/versions/0027_components_systems.py`:

```python
"""vendors, components, systems, memberships, service tech links

Revision ID: 0027
Revises: 0026
"""
from alembic import op
import sqlalchemy as sa

revision = "0027"
down_revision = "0026"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "vendors",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("name", sa.String(128), nullable=False, unique=True),
        sa.Column("notes", sa.Text),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_table(
        "components",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("name", sa.String(128), nullable=False),
        sa.Column("model", sa.String(64)),
        sa.Column("description", sa.Text),
        sa.Column("product_id", sa.Integer, sa.ForeignKey("products.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("vendor_id", sa.Integer, sa.ForeignKey("vendors.id", ondelete="SET NULL")),
        sa.Column("lifecycle_stage", sa.String(16), nullable=False, server_default="plan"),
        sa.Column("quantity", sa.Integer),
        sa.Column("eos_announced", sa.Date),
        sa.Column("end_of_sale", sa.Date),
        sa.Column("end_of_support", sa.Date),
        sa.Column("end_of_life", sa.Date),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("product_id", "name", name="uq_component_product_name"),
    )
    op.create_index("ix_components_product_id", "components", ["product_id"])
    op.create_index("ix_components_vendor_id", "components", ["vendor_id"])
    op.create_table(
        "systems",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("name", sa.String(128), nullable=False),
        sa.Column("description", sa.Text),
        sa.Column("product_id", sa.Integer, sa.ForeignKey("products.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("lifecycle_stage", sa.String(16), nullable=False, server_default="plan"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("product_id", "name", name="uq_system_product_name"),
    )
    op.create_index("ix_systems_product_id", "systems", ["product_id"])
    op.create_table(
        "system_components",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("system_id", sa.Integer, sa.ForeignKey("systems.id", ondelete="CASCADE"), nullable=False),
        sa.Column("component_id", sa.Integer, sa.ForeignKey("components.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("quantity", sa.Integer),
        sa.UniqueConstraint("system_id", "component_id", name="uq_system_component"),
    )
    op.create_index("ix_system_components_system_id", "system_components", ["system_id"])
    op.create_index("ix_system_components_component_id", "system_components", ["component_id"])
    op.create_table(
        "service_components",
        sa.Column("service_id", sa.Integer, sa.ForeignKey("services.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("component_id", sa.Integer, sa.ForeignKey("components.id", ondelete="RESTRICT"), primary_key=True),
    )
    op.create_table(
        "service_systems",
        sa.Column("service_id", sa.Integer, sa.ForeignKey("services.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("system_id", sa.Integer, sa.ForeignKey("systems.id", ondelete="RESTRICT"), primary_key=True),
    )


def downgrade() -> None:
    op.drop_table("service_systems")
    op.drop_table("service_components")
    op.drop_table("system_components")
    op.drop_table("systems")
    op.drop_table("components")
    op.drop_table("vendors")
```

- [ ] **Step 6: Dry-run on compose Postgres**

```bash
docker compose up -d db
cd backend && . .venv/bin/activate
alembic upgrade head     # 0026 -> 0027
alembic downgrade -1     # 0027 -> 0026
alembic upgrade head
```
Expected: all succeed.

- [ ] **Step 7: Commit**

```bash
git add backend/app/models.py backend/alembic/versions/0027_components_systems.py backend/tests/catalog/test_component_models.py
git commit -m "feat(lifecycle): ORM models + migration 0027 (vendors, components, systems, links)"
```

---

### Task 3: Ports + Postgres adapter (vendors, components, systems) + product guard

**Files:**
- Modify: `backend/app/catalog/ports.py` (append `VendorRepository`, `ComponentRepository`, `SystemRepository`)
- Modify: `backend/app/catalog/adapters/postgres.py` (append `get_or_create_vendor_id`, mappers, three repository classes; extend `PostgresProductRepository.delete`)
- Modify: `backend/app/catalog/factory.py` (append `get_vendor_repo`, `get_component_repo`, `get_system_repo`)
- Test: `backend/tests/catalog/test_component_adapter.py`

**Interfaces:**
- Consumes: Task 1 domain types, Task 2 ORM.
- Produces (all also declared as Protocols in `ports.py`, each with `read_only`):
  - `get_or_create_vendor_id(db, name: str | None) -> int | None`
  - `PostgresVendorRepository.list() -> list[Vendor]`
  - `PostgresComponentRepository`: `list(product_id, today=None) -> list[Component]` (name-ordered, risk-annotated), `list_all(today=None) -> list[Component]` (risk-severity desc, then nearest end_of_support/end_of_life, dateless last; `product_name`/`vendor_name` filled), `get(component_id, today=None) -> Component`, `create(*, name, product_id, model=None, description=None, vendor_name=None, lifecycle_stage=LifecycleStage.PLAN, quantity=None, eos_announced=None, end_of_sale=None, end_of_support=None, end_of_life=None) -> Component`, `update(component_id, changes: dict) -> Component` (accepts `vendor_name` key → get-or-create/None clears), `delete(component_id) -> None`
  - `PostgresSystemRepository`: `list(product_id, today=None) -> list[System]`, `list_all(today=None) -> list[System]` (name-ordered, `product_name` filled — powers the cross-product picker), `get(system_id, today=None) -> System`, `create(*, name, product_id, description=None, lifecycle_stage=LifecycleStage.PLAN) -> System`, `update(system_id, changes: dict) -> System`, `delete(system_id) -> None`, `set_member(system_id, component_id, quantity=None) -> System` (insert or update quantity; component must belong to the same product), `remove_member(system_id, component_id) -> System`
  - Factory deps `get_vendor_repo`, `get_component_repo`, `get_system_repo`
- `changes` dicts follow `model_dump(exclude_unset=True)` semantics (key present with None = clear where nullable).
- After a `flush()` that changed FKs, `expire` the affected relationships before mapping (staleness convention from `f2a8a2e`).

- [ ] **Step 1: Write the failing tests**

`backend/tests/catalog/test_component_adapter.py`:

```python
from datetime import date, timedelta

import pytest

from app.catalog.adapters.postgres import (
    PostgresArtRepository,
    PostgresComponentRepository,
    PostgresProductRepository,
    PostgresSystemRepository,
    PostgresVendorRepository,
    get_or_create_vendor_id,
)
from app.catalog.domain import (
    CatalogInUse,
    CatalogNotFound,
    CatalogRuleViolation,
    LifecycleStage,
    RiskLevel,
)

TODAY = date(2026, 7, 26)


@pytest.fixture()
def repos(db_session):
    arts = PostgresArtRepository(db_session)
    products = PostgresProductRepository(db_session)
    art = arts.create(name="ART")
    product = products.create(name="Network", art_id=art.id)
    return {
        "db": db_session,
        "products": products,
        "product": product,
        "components": PostgresComponentRepository(db_session),
        "systems": PostgresSystemRepository(db_session),
        "vendors": PostgresVendorRepository(db_session),
    }


def test_vendor_get_or_create(repos):
    a = get_or_create_vendor_id(repos["db"], "  Cisco ")
    b = get_or_create_vendor_id(repos["db"], "Cisco")
    assert a == b
    assert get_or_create_vendor_id(repos["db"], "  ") is None
    assert [v.name for v in repos["vendors"].list()] == ["Cisco"]


def test_component_crud_with_vendor_and_risk(repos):
    comps = repos["components"]
    c = comps.create(
        name="Catalyst 9300", product_id=repos["product"].id,
        vendor_name="Cisco", model="C9300-48P",
        end_of_support=TODAY + timedelta(days=30),
    )
    assert c.vendor_name == "Cisco"
    got = comps.get(c.id, today=TODAY)
    assert got.risk == RiskLevel.WARNING
    comps.update(c.id, {"end_of_support": TODAY - timedelta(days=1)})
    assert comps.get(c.id, today=TODAY).risk == RiskLevel.DANGER
    comps.update(c.id, {"vendor_name": None})
    assert comps.get(c.id).vendor_id is None
    with pytest.raises(CatalogRuleViolation):
        comps.create(name="Catalyst 9300", product_id=repos["product"].id)
    comps.delete(c.id)
    with pytest.raises(CatalogNotFound):
        comps.get(c.id)


def test_list_all_ordering(repos):
    comps = repos["components"]
    pid = repos["product"].id
    comps.create(name="NoDates", product_id=pid)
    comps.create(name="Soon", product_id=pid, end_of_support=TODAY + timedelta(days=10))
    comps.create(name="Dead", product_id=pid, end_of_life=TODAY - timedelta(days=10))
    comps.create(name="Later", product_id=pid, end_of_support=TODAY + timedelta(days=100))
    names = [c.name for c in comps.list_all(today=TODAY)]
    assert names == ["Dead", "Soon", "Later", "NoDates"]
    assert comps.list_all(today=TODAY)[0].product_name == "Network"


def test_system_membership_and_risk(repos):
    comps, systems = repos["components"], repos["systems"]
    pid = repos["product"].id
    c1 = comps.create(name="OK", product_id=pid)
    c2 = comps.create(name="Dying", product_id=pid, end_of_support=TODAY - timedelta(days=1))
    s = systems.create(name="Campus fabric", product_id=pid)
    systems.set_member(s.id, c1.id, quantity=10)
    got = systems.set_member(s.id, c2.id)
    assert {m.component.name for m in got.members} == {"OK", "Dying"}
    assert systems.get(s.id, today=TODAY).risk == RiskLevel.DANGER
    got = systems.set_member(s.id, c1.id, quantity=99)  # update quantity in place
    assert next(m for m in got.members if m.component.name == "OK").quantity == 99
    got = systems.remove_member(s.id, c2.id)
    assert {m.component.name for m in got.members} == {"OK"}
    with pytest.raises(CatalogNotFound):
        systems.remove_member(s.id, c2.id)


def test_member_must_share_product(repos):
    arts = PostgresArtRepository(repos["db"])
    other = repos["products"].create(name="Other", art_id=arts.list()[0].id)
    foreign = repos["components"].create(name="Foreign", product_id=other.id)
    s = repos["systems"].create(name="Sys", product_id=repos["product"].id)
    with pytest.raises(CatalogRuleViolation):
        repos["systems"].set_member(s.id, foreign.id)


def test_delete_guards(repos):
    comps, systems = repos["components"], repos["systems"]
    pid = repos["product"].id
    c = comps.create(name="C", product_id=pid)
    s = systems.create(name="S", product_id=pid)
    systems.set_member(s.id, c.id)
    with pytest.raises(CatalogInUse):
        comps.delete(c.id)  # member of a system
    systems.delete(s.id)  # memberships go with it
    comps.delete(c.id)  # now free


def test_product_delete_blocked_by_components(repos):
    comps = repos["components"]
    comps.create(name="C", product_id=repos["product"].id)
    with pytest.raises(CatalogInUse):
        repos["products"].delete(repos["product"].id)
```

- [ ] **Step 2: Run to verify failure**

Run: `pytest tests/catalog/test_component_adapter.py -v`
Expected: `ImportError: cannot import name 'PostgresComponentRepository'`

- [ ] **Step 3: Implement ports**

Append to `backend/app/catalog/ports.py` (extend the domain import with `Component, LifecycleStage, System, Vendor` and add `from datetime import date`):

```python
class VendorRepository(Protocol):
    @property
    def read_only(self) -> bool: ...
    def list(self) -> list[Vendor]: ...


class ComponentRepository(Protocol):
    @property
    def read_only(self) -> bool: ...
    def list(self, product_id: int, today: date | None = None) -> list[Component]: ...
    def list_all(self, today: date | None = None) -> list[Component]: ...
    def get(self, component_id: int, today: date | None = None) -> Component: ...
    def create(self, *, name: str, product_id: int, model: str | None = None,
               description: str | None = None, vendor_name: str | None = None,
               lifecycle_stage: LifecycleStage = LifecycleStage.PLAN,
               quantity: int | None = None, eos_announced: date | None = None,
               end_of_sale: date | None = None, end_of_support: date | None = None,
               end_of_life: date | None = None) -> Component: ...
    def update(self, component_id: int, changes: dict) -> Component: ...
    def delete(self, component_id: int) -> None: ...


class SystemRepository(Protocol):
    @property
    def read_only(self) -> bool: ...
    def list(self, product_id: int, today: date | None = None) -> list[System]: ...
    def list_all(self, today: date | None = None) -> list[System]: ...
    def get(self, system_id: int, today: date | None = None) -> System: ...
    def create(self, *, name: str, product_id: int, description: str | None = None,
               lifecycle_stage: LifecycleStage = LifecycleStage.PLAN) -> System: ...
    def update(self, system_id: int, changes: dict) -> System: ...
    def delete(self, system_id: int) -> None: ...
    def set_member(self, system_id: int, component_id: int,
                   quantity: int | None = None) -> System: ...
    def remove_member(self, system_id: int, component_id: int) -> System: ...
```

- [ ] **Step 4: Implement the adapter**

Append to `backend/app/catalog/adapters/postgres.py` (extend the domain import with `LifecycleStage, RiskLevel, component_risk, worst_risk`; add `from datetime import date`):

```python
def get_or_create_vendor_id(db: Session, name: str | None) -> int | None:
    """Resolve a vendor name to its id, creating the vendor on first sight."""
    clean = str(name).strip() if name and str(name).strip() else None
    if clean is None:
        return None
    vendor = db.scalar(select(m.Vendor).where(m.Vendor.name == clean))
    if vendor is None:
        vendor = m.Vendor(name=clean)
        db.add(vendor)
        db.flush()
    return vendor.id


def _to_vendor(row: m.Vendor) -> domain.Vendor:
    return domain.Vendor(id=row.id, name=row.name, notes=row.notes)


def _to_component(row: m.Component, today: date) -> domain.Component:
    return domain.Component(
        id=row.id, name=row.name, model=row.model, description=row.description,
        product_id=row.product_id, vendor_id=row.vendor_id,
        lifecycle_stage=LifecycleStage(row.lifecycle_stage), quantity=row.quantity,
        eos_announced=row.eos_announced, end_of_sale=row.end_of_sale,
        end_of_support=row.end_of_support, end_of_life=row.end_of_life,
        vendor_name=row.vendor.name if row.vendor else None,
        product_name=row.product.name if row.product else None,
        risk=component_risk(end_of_support=row.end_of_support,
                            end_of_life=row.end_of_life, today=today),
    )


def _to_system(row: m.System, today: date) -> domain.System:
    members = [
        domain.SystemMember(component=_to_component(ms.component, today), quantity=ms.quantity)
        for ms in sorted(row.memberships, key=lambda ms: ms.component.name)
    ]
    return domain.System(
        id=row.id, name=row.name, description=row.description,
        product_id=row.product_id, lifecycle_stage=LifecycleStage(row.lifecycle_stage),
        members=members,
        product_name=row.product.name if row.product else None,
        risk=worst_risk(mb.component.risk for mb in members),
    )


class PostgresVendorRepository:
    read_only = False

    def __init__(self, db: Session):
        self.db = db

    def list(self) -> list[domain.Vendor]:
        return [_to_vendor(v) for v in self.db.scalars(select(m.Vendor).order_by(m.Vendor.name))]


_COMPONENT_FIELDS = ("name", "model", "description", "lifecycle_stage", "quantity",
                     "eos_announced", "end_of_sale", "end_of_support", "end_of_life")


class PostgresComponentRepository:
    read_only = False

    def __init__(self, db: Session):
        self.db = db

    def _row(self, component_id: int) -> m.Component:
        row = self.db.get(m.Component, component_id)
        if row is None:
            raise CatalogNotFound("Component not found")
        return row

    def _validate_name(self, *, name: str, product_id: int, exclude_id: int | None) -> None:
        q = select(m.Component).where(
            m.Component.product_id == product_id, m.Component.name == name
        )
        if exclude_id is not None:
            q = q.where(m.Component.id != exclude_id)
        if self.db.scalar(q):
            raise CatalogRuleViolation("A component with this name already exists in this product")

    def list(self, product_id: int, today: date | None = None) -> list[domain.Component]:
        today = today or date.today()
        rows = self.db.scalars(
            select(m.Component).where(m.Component.product_id == product_id)
            .order_by(m.Component.name)
        )
        return [_to_component(r, today) for r in rows]

    def list_all(self, today: date | None = None) -> list[domain.Component]:
        today = today or date.today()
        out = [_to_component(r, today) for r in self.db.scalars(select(m.Component))]
        severity = {RiskLevel.DANGER: 0, RiskLevel.WARNING: 1, RiskLevel.OK: 2}

        def nearest(c: domain.Component) -> date:
            dates = [d for d in (c.end_of_support, c.end_of_life) if d is not None]
            return min(dates) if dates else date.max

        out.sort(key=lambda c: (severity[c.risk], nearest(c), c.name.lower()))
        return out

    def get(self, component_id: int, today: date | None = None) -> domain.Component:
        return _to_component(self._row(component_id), today or date.today())

    def create(self, *, name: str, product_id: int, model: str | None = None,
               description: str | None = None, vendor_name: str | None = None,
               lifecycle_stage: LifecycleStage = LifecycleStage.PLAN,
               quantity: int | None = None, eos_announced: date | None = None,
               end_of_sale: date | None = None, end_of_support: date | None = None,
               end_of_life: date | None = None) -> domain.Component:
        if self.db.get(m.Product, product_id) is None:
            raise CatalogRuleViolation("product_id does not exist")
        self._validate_name(name=name, product_id=product_id, exclude_id=None)
        row = m.Component(
            name=name, product_id=product_id, model=model, description=description,
            vendor_id=get_or_create_vendor_id(self.db, vendor_name),
            lifecycle_stage=lifecycle_stage, quantity=quantity,
            eos_announced=eos_announced, end_of_sale=end_of_sale,
            end_of_support=end_of_support, end_of_life=end_of_life,
        )
        self.db.add(row)
        self.db.flush()
        return _to_component(row, date.today())

    def update(self, component_id: int, changes: dict) -> domain.Component:
        row = self._row(component_id)
        if "name" in changes and changes["name"] != row.name:
            self._validate_name(name=changes["name"], product_id=row.product_id,
                                exclude_id=component_id)
        if "vendor_name" in changes:
            row.vendor_id = get_or_create_vendor_id(self.db, changes["vendor_name"])
        for key in _COMPONENT_FIELDS:
            if key in changes:
                setattr(row, key, changes[key])
        self.db.flush()
        self.db.expire(row, ["vendor"])
        return _to_component(row, date.today())

    def delete(self, component_id: int) -> None:
        row = self._row(component_id)
        n_sys = self.db.scalar(
            select(func.count()).select_from(m.SystemComponent)
            .where(m.SystemComponent.component_id == component_id)
        )
        if n_sys:
            raise CatalogInUse(f"Component is a member of {n_sys} system(s); remove it first")
        n_svc = self.db.scalar(
            select(func.count()).select_from(m.service_components)
            .where(m.service_components.c.component_id == component_id)
        )
        if n_svc:
            raise CatalogInUse(f"Component provides {n_svc} service(s); unlink it first")
        self.db.delete(row)
        self.db.flush()


class PostgresSystemRepository:
    read_only = False

    def __init__(self, db: Session):
        self.db = db

    def _row(self, system_id: int) -> m.System:
        row = self.db.get(m.System, system_id)
        if row is None:
            raise CatalogNotFound("System not found")
        return row

    def _validate_name(self, *, name: str, product_id: int, exclude_id: int | None) -> None:
        q = select(m.System).where(m.System.product_id == product_id, m.System.name == name)
        if exclude_id is not None:
            q = q.where(m.System.id != exclude_id)
        if self.db.scalar(q):
            raise CatalogRuleViolation("A system with this name already exists in this product")

    def list(self, product_id: int, today: date | None = None) -> list[domain.System]:
        today = today or date.today()
        rows = self.db.scalars(
            select(m.System).where(m.System.product_id == product_id).order_by(m.System.name)
        )
        return [_to_system(r, today) for r in rows]

    def list_all(self, today: date | None = None) -> list[domain.System]:
        today = today or date.today()
        rows = self.db.scalars(select(m.System).order_by(m.System.name))
        return [_to_system(r, today) for r in rows]

    def get(self, system_id: int, today: date | None = None) -> domain.System:
        return _to_system(self._row(system_id), today or date.today())

    def create(self, *, name: str, product_id: int, description: str | None = None,
               lifecycle_stage: LifecycleStage = LifecycleStage.PLAN) -> domain.System:
        if self.db.get(m.Product, product_id) is None:
            raise CatalogRuleViolation("product_id does not exist")
        self._validate_name(name=name, product_id=product_id, exclude_id=None)
        row = m.System(name=name, product_id=product_id, description=description,
                       lifecycle_stage=lifecycle_stage)
        self.db.add(row)
        self.db.flush()
        return _to_system(row, date.today())

    def update(self, system_id: int, changes: dict) -> domain.System:
        row = self._row(system_id)
        if "name" in changes and changes["name"] != row.name:
            self._validate_name(name=changes["name"], product_id=row.product_id,
                                exclude_id=system_id)
        for key in ("name", "description", "lifecycle_stage"):
            if key in changes:
                setattr(row, key, changes[key])
        self.db.flush()
        return _to_system(row, date.today())

    def delete(self, system_id: int) -> None:
        row = self._row(system_id)
        n_svc = self.db.scalar(
            select(func.count()).select_from(m.service_systems)
            .where(m.service_systems.c.system_id == system_id)
        )
        if n_svc:
            raise CatalogInUse(f"System provides {n_svc} service(s); unlink it first")
        self.db.delete(row)  # memberships cascade via ORM relationship
        self.db.flush()

    def set_member(self, system_id: int, component_id: int,
                   quantity: int | None = None) -> domain.System:
        row = self._row(system_id)
        comp = self.db.get(m.Component, component_id)
        if comp is None:
            raise CatalogRuleViolation("component_id does not exist")
        if comp.product_id != row.product_id:
            raise CatalogRuleViolation("Component must belong to the same product as the system")
        member = self.db.scalar(select(m.SystemComponent).where(
            m.SystemComponent.system_id == system_id,
            m.SystemComponent.component_id == component_id,
        ))
        if member is None:
            self.db.add(m.SystemComponent(system_id=system_id, component_id=component_id,
                                          quantity=quantity))
        else:
            member.quantity = quantity
        self.db.flush()
        self.db.expire(row, ["memberships"])
        return _to_system(row, date.today())

    def remove_member(self, system_id: int, component_id: int) -> domain.System:
        row = self._row(system_id)
        member = self.db.scalar(select(m.SystemComponent).where(
            m.SystemComponent.system_id == system_id,
            m.SystemComponent.component_id == component_id,
        ))
        if member is None:
            raise CatalogNotFound("Membership not found")
        self.db.delete(member)
        self.db.flush()
        self.db.expire(row, ["memberships"])
        return _to_system(row, date.today())
```

In `PostgresProductRepository.delete`, extend the guard (before `self.db.delete(row)`):

```python
        n_comp = self.db.scalar(
            select(func.count()).select_from(m.Component)
            .where(m.Component.product_id == product_id)
        )
        if n_comp:
            raise CatalogInUse(f"Product has {n_comp} component(s); delete them first")
        n_sys = self.db.scalar(
            select(func.count()).select_from(m.System)
            .where(m.System.product_id == product_id)
        )
        if n_sys:
            raise CatalogInUse(f"Product has {n_sys} system(s); delete them first")
```

Append to `backend/app/catalog/factory.py` (extend the adapter import):

```python
def get_vendor_repo(db: Session = Depends(get_db)) -> ports.VendorRepository:
    return PostgresVendorRepository(db)


def get_component_repo(db: Session = Depends(get_db)) -> ports.ComponentRepository:
    return PostgresComponentRepository(db)


def get_system_repo(db: Session = Depends(get_db)) -> ports.SystemRepository:
    return PostgresSystemRepository(db)
```

- [ ] **Step 5: Run tests**

`pytest tests/catalog/test_component_adapter.py -v` → 7 passed; full `pytest` → no regressions.

- [ ] **Step 6: Commit**

```bash
git add backend/app/catalog
git add backend/tests/catalog/test_component_adapter.py
git commit -m "feat(lifecycle): vendor/component/system repositories + product delete guard"
```

---

### Task 4: ServiceRepository tech links

**Files:**
- Modify: `backend/app/catalog/ports.py` (extend `ServiceRepository`)
- Modify: `backend/app/catalog/adapters/postgres.py` (extend `PostgresServiceRepository`)
- Test: `backend/tests/catalog/test_service_tech_adapter.py`

**Interfaces:**
- Produces on `ServiceRepository` (Protocol + Postgres impl):
  - `list_tech(service_id, today: date | None = None) -> ServiceTech` — direct components (name-ordered), linked systems (name-ordered, with members + risk), `risk` = worst of direct components + all system members.
  - `add_tech_component(service_id, component_id) -> None` / `remove_tech_component(service_id, component_id) -> None`
  - `add_tech_system(service_id, system_id) -> None` / `remove_tech_system(service_id, system_id) -> None`
  - Duplicates → `CatalogRuleViolation("This link already exists")`; unknown targets → `CatalogRuleViolation`; missing link on remove → `CatalogNotFound("Link not found")`.
  - Service delete stays allowed with tech links; its link rows are removed explicitly (SQLite fixtures don't enforce CASCADE) — extend `PostgresServiceRepository.delete` accordingly.

- [ ] **Step 1: Write the failing tests**

`backend/tests/catalog/test_service_tech_adapter.py`:

```python
from datetime import date, timedelta

import pytest
from sqlalchemy import func, select

from app.catalog.adapters.postgres import (
    PostgresArtRepository,
    PostgresComponentRepository,
    PostgresProductRepository,
    PostgresServiceRepository,
    PostgresSystemRepository,
)
from app.catalog.domain import CatalogNotFound, CatalogRuleViolation, RiskLevel
from app.models import service_components

TODAY = date(2026, 7, 26)


@pytest.fixture()
def env(db_session):
    arts = PostgresArtRepository(db_session)
    products = PostgresProductRepository(db_session)
    art = arts.create(name="ART")
    product = products.create(name="Network", art_id=art.id)
    services = PostgresServiceRepository(db_session)
    svc = services.create(name="Connectivity", product_id=product.id)
    return {
        "db": db_session, "product": product, "service": svc,
        "services": services,
        "components": PostgresComponentRepository(db_session),
        "systems": PostgresSystemRepository(db_session),
    }


def test_tech_links_and_rollup(env):
    svc, services = env["service"], env["services"]
    pid = env["product"].id
    direct = env["components"].create(name="Direct", product_id=pid,
                                      end_of_support=TODAY + timedelta(days=30))
    member = env["components"].create(name="Member", product_id=pid,
                                      end_of_life=TODAY - timedelta(days=1))
    system = env["systems"].create(name="Fabric", product_id=pid)
    env["systems"].set_member(system.id, member.id)

    services.add_tech_component(svc.id, direct.id)
    services.add_tech_system(svc.id, system.id)
    tech = services.list_tech(svc.id, today=TODAY)
    assert [c.name for c in tech.components] == ["Direct"]
    assert [s.name for s in tech.systems] == ["Fabric"]
    assert tech.components[0].risk == RiskLevel.WARNING
    assert tech.risk == RiskLevel.DANGER  # via the system member

    with pytest.raises(CatalogRuleViolation):
        services.add_tech_component(svc.id, direct.id)  # duplicate
    with pytest.raises(CatalogRuleViolation):
        services.add_tech_component(svc.id, 999)

    services.remove_tech_system(svc.id, system.id)
    assert services.list_tech(svc.id, today=TODAY).risk == RiskLevel.WARNING
    with pytest.raises(CatalogNotFound):
        services.remove_tech_system(svc.id, system.id)


def test_component_delete_blocked_by_service_link(env):
    from app.catalog.domain import CatalogInUse

    c = env["components"].create(name="C", product_id=env["product"].id)
    env["services"].add_tech_component(env["service"].id, c.id)
    with pytest.raises(CatalogInUse):
        env["components"].delete(c.id)
    env["services"].remove_tech_component(env["service"].id, c.id)
    env["components"].delete(c.id)


def test_system_delete_blocked_by_service_link(env):
    from app.catalog.domain import CatalogInUse

    s = env["systems"].create(name="S", product_id=env["product"].id)
    env["services"].add_tech_system(env["service"].id, s.id)
    with pytest.raises(CatalogInUse):
        env["systems"].delete(s.id)


def test_service_delete_removes_link_rows(env):
    c = env["components"].create(name="C", product_id=env["product"].id)
    env["services"].add_tech_component(env["service"].id, c.id)
    env["services"].delete(env["service"].id)
    assert env["db"].scalar(select(func.count()).select_from(service_components)) == 0
```

- [ ] **Step 2: Run to verify failure**

Run: `pytest tests/catalog/test_service_tech_adapter.py -v`
Expected: `AttributeError: ... has no attribute 'add_tech_component'`

- [ ] **Step 3: Implement**

Append to the `ServiceRepository` Protocol in `ports.py` (add `ServiceTech` to the domain import; `date` already imported in Task 3):

```python
    def list_tech(self, service_id: int, today: date | None = None) -> ServiceTech: ...
    def add_tech_component(self, service_id: int, component_id: int) -> None: ...
    def remove_tech_component(self, service_id: int, component_id: int) -> None: ...
    def add_tech_system(self, service_id: int, system_id: int) -> None: ...
    def remove_tech_system(self, service_id: int, system_id: int) -> None: ...
```

Append to `PostgresServiceRepository` in `adapters/postgres.py`:

```python
    def list_tech(self, service_id: int, today: date | None = None) -> domain.ServiceTech:
        today = today or date.today()
        self._row(service_id)
        comp_rows = self.db.scalars(
            select(m.Component)
            .join(m.service_components, m.service_components.c.component_id == m.Component.id)
            .where(m.service_components.c.service_id == service_id)
            .order_by(m.Component.name)
        )
        components = [_to_component(r, today) for r in comp_rows]
        sys_rows = self.db.scalars(
            select(m.System)
            .join(m.service_systems, m.service_systems.c.system_id == m.System.id)
            .where(m.service_systems.c.service_id == service_id)
            .order_by(m.System.name)
        )
        systems = [_to_system(r, today) for r in sys_rows]
        member_risks = [mb.component.risk for s in systems for mb in s.members]
        rolled = worst_risk([c.risk for c in components] + member_risks)
        return domain.ServiceTech(components=components, systems=systems, risk=rolled)

    def _tech_link(self, table, service_id: int, key_col, key_id: int):
        return self.db.execute(
            select(table).where(table.c.service_id == service_id, key_col == key_id)
        ).first()

    def add_tech_component(self, service_id: int, component_id: int) -> None:
        self._row(service_id)
        if self.db.get(m.Component, component_id) is None:
            raise CatalogRuleViolation("component_id does not exist")
        if self._tech_link(m.service_components, service_id,
                           m.service_components.c.component_id, component_id):
            raise CatalogRuleViolation("This link already exists")
        self.db.execute(m.service_components.insert().values(
            service_id=service_id, component_id=component_id))

    def remove_tech_component(self, service_id: int, component_id: int) -> None:
        if not self._tech_link(m.service_components, service_id,
                               m.service_components.c.component_id, component_id):
            raise CatalogNotFound("Link not found")
        self.db.execute(m.service_components.delete().where(
            m.service_components.c.service_id == service_id,
            m.service_components.c.component_id == component_id))

    def add_tech_system(self, service_id: int, system_id: int) -> None:
        self._row(service_id)
        if self.db.get(m.System, system_id) is None:
            raise CatalogRuleViolation("system_id does not exist")
        if self._tech_link(m.service_systems, service_id,
                           m.service_systems.c.system_id, system_id):
            raise CatalogRuleViolation("This link already exists")
        self.db.execute(m.service_systems.insert().values(
            service_id=service_id, system_id=system_id))

    def remove_tech_system(self, service_id: int, system_id: int) -> None:
        if not self._tech_link(m.service_systems, service_id,
                               m.service_systems.c.system_id, system_id):
            raise CatalogNotFound("Link not found")
        self.db.execute(m.service_systems.delete().where(
            m.service_systems.c.service_id == service_id,
            m.service_systems.c.system_id == system_id))
```

In `PostgresServiceRepository.delete`, next to the existing outbound-dependency cleanup loop, add (same SQLite-CASCADE rationale):

```python
        self.db.execute(m.service_components.delete().where(
            m.service_components.c.service_id == service_id))
        self.db.execute(m.service_systems.delete().where(
            m.service_systems.c.service_id == service_id))
```

Also extend `PostgresComponentRepository.delete`'s service-link guard — already written in Task 3 (`n_svc` check) — no change needed here; this task's tests exercise it.

- [ ] **Step 4: Run tests**

`pytest tests/catalog/test_service_tech_adapter.py -v` → 4 passed; full `pytest` → no regressions.

- [ ] **Step 5: Commit**

```bash
git add backend/app/catalog backend/tests/catalog/test_service_tech_adapter.py
git commit -m "feat(lifecycle): service tech links (components/systems) with risk rollup"
```

---

### Task 5: Schemas + vendors/components routers + /lifecycle

**Files:**
- Modify: `backend/app/schemas.py` (append; extend the catalog import with `LifecycleStage, RiskLevel`; add `from datetime import date` if absent)
- Create: `backend/app/routers/components.py`
- Modify: `backend/app/main.py` (register `components` router)
- Test: `backend/tests/catalog/test_components_api.py`

**Interfaces:**
- Produces schemas: `VendorRead(id, name, notes)`, `ComponentRead(id, name, model, description, product_id, product_name, vendor_id, vendor_name, lifecycle_stage, quantity, eos_announced, end_of_sale, end_of_support, end_of_life, risk)`, `ComponentCreate(name, product_id, model?, description?, vendor_name?, lifecycle_stage=plan, quantity?, four dates?)`, `ComponentUpdate(extra="forbid"; all of name/model/description/vendor_name/lifecycle_stage/quantity/four dates optional)`.
- Endpoints: `GET /api/v1/vendors`, `GET /api/v1/products/{product_id}/components`, `POST /api/v1/components` (201), `GET/PATCH/DELETE /api/v1/components/{id}` (DELETE 204), `GET /api/v1/lifecycle` (list of `ComponentRead`, adapter ordering).
- Audit events `component.created/updated/deleted`; update logs field-level (vendor by NAME old→new; dates/enums as their string values; detection: vendor by `vendor_id`, others by value).

- [ ] **Step 1: Write the failing tests**

`backend/tests/catalog/test_components_api.py`:

```python
import pytest

from app.models import AuditEvent


@pytest.fixture()
def product_id(client):
    art_id = client.post("/api/v1/arts", json={"name": "ART"}).json()["id"]
    return client.post("/api/v1/products", json={"name": "Network", "art_id": art_id}).json()["id"]


def test_component_crud_any_user(member_client, product_id):
    r = member_client.post("/api/v1/components", json={
        "name": "Catalyst 9300", "product_id": product_id, "vendor_name": "Cisco",
        "model": "C9300-48P", "end_of_support": "2026-08-15",
    })
    assert r.status_code == 201
    body = r.json()
    cid = body["id"]
    assert body["vendor_name"] == "Cisco"
    assert body["lifecycle_stage"] == "plan"
    assert body["risk"] in ("warning", "danger")  # EoS within a year of any 2026 test date
    listed = member_client.get(f"/api/v1/products/{product_id}/components").json()
    assert listed[0]["name"] == "Catalyst 9300"
    r = member_client.patch(f"/api/v1/components/{cid}",
                            json={"lifecycle_stage": "operate", "quantity": 120})
    assert r.json()["lifecycle_stage"] == "operate"
    assert member_client.delete(f"/api/v1/components/{cid}").status_code == 204


def test_component_duplicate_name_422(member_client, product_id):
    member_client.post("/api/v1/components", json={"name": "X", "product_id": product_id})
    assert member_client.post(
        "/api/v1/components", json={"name": "X", "product_id": product_id}
    ).status_code == 422


def test_vendors_listed(member_client, product_id):
    member_client.post("/api/v1/components",
                       json={"name": "X", "product_id": product_id, "vendor_name": "Cisco"})
    assert member_client.get("/api/v1/vendors").json()[0]["name"] == "Cisco"


def test_lifecycle_endpoint_sorted(member_client, product_id):
    member_client.post("/api/v1/components", json={"name": "NoDates", "product_id": product_id})
    member_client.post("/api/v1/components", json={
        "name": "Dead", "product_id": product_id, "end_of_life": "2020-01-01"})
    rows = member_client.get("/api/v1/lifecycle").json()
    assert rows[0]["name"] == "Dead"
    assert rows[0]["risk"] == "danger"
    assert rows[0]["product_name"] == "Network"
    assert rows[-1]["name"] == "NoDates"


def test_component_update_field_level_audit(client, product_id, db_session):
    cid = client.post("/api/v1/components", json={
        "name": "C", "product_id": product_id, "vendor_name": "Cisco"}).json()["id"]
    db_session.query(AuditEvent).filter_by(event_type="component.updated").delete()
    client.patch(f"/api/v1/components/{cid}", json={
        "vendor_name": "Juniper", "end_of_support": "2027-01-31", "name": "C",
    })
    events = db_session.query(AuditEvent).filter_by(event_type="component.updated").all()
    by_field = {e.field: e for e in events}
    assert by_field["vendor"].old_value == "Cisco"
    assert by_field["vendor"].new_value == "Juniper"
    assert by_field["end_of_support"].new_value == "2027-01-31"
    assert "name" not in by_field  # unchanged
```

- [ ] **Step 2: Run to verify failure**

Run: `pytest tests/catalog/test_components_api.py -v` — expect 404s / missing schema imports.

- [ ] **Step 3: Add schemas**

Append to `backend/app/schemas.py`:

```python
# --- Catalog: vendors, components, lifecycle ---------------------------------

class VendorRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    notes: str | None = None


class ComponentRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    model: str | None = None
    description: str | None = None
    product_id: int
    product_name: str | None = None
    vendor_id: int | None = None
    vendor_name: str | None = None
    lifecycle_stage: LifecycleStage
    quantity: int | None = None
    eos_announced: date | None = None
    end_of_sale: date | None = None
    end_of_support: date | None = None
    end_of_life: date | None = None
    risk: RiskLevel


class ComponentCreate(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    product_id: int
    model: str | None = Field(default=None, max_length=64)
    description: str | None = None
    vendor_name: str | None = None
    lifecycle_stage: LifecycleStage = LifecycleStage.PLAN
    quantity: int | None = Field(default=None, ge=0)
    eos_announced: date | None = None
    end_of_sale: date | None = None
    end_of_support: date | None = None
    end_of_life: date | None = None


class ComponentUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str | None = Field(default=None, min_length=1, max_length=128)
    model: str | None = Field(default=None, max_length=64)
    description: str | None = None
    vendor_name: str | None = None
    lifecycle_stage: LifecycleStage | None = None
    quantity: int | None = Field(default=None, ge=0)
    eos_announced: date | None = None
    end_of_sale: date | None = None
    end_of_support: date | None = None
    end_of_life: date | None = None
```

- [ ] **Step 4: Implement the router**

`backend/app/routers/components.py`:

```python
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.audit import log_event
from app.auth import require_user
from app.catalog import ports
from app.catalog.factory import get_component_repo, get_vendor_repo
from app.catalog.http import check_writable
from app.db import get_db
from app.models import User
from app.schemas import ComponentCreate, ComponentRead, ComponentUpdate, VendorRead

router = APIRouter(prefix="/api/v1", tags=["components"])

# Fields whose old/new values are logged by simple value comparison. The
# vendor is handled separately (detected by id, logged by name).
_AUDIT_FIELDS = ("name", "model", "description", "lifecycle_stage", "quantity",
                 "eos_announced", "end_of_sale", "end_of_support", "end_of_life")


def _s(value) -> str | None:
    if value is None:
        return None
    if hasattr(value, "value"):
        return value.value
    return str(value)


@router.get("/vendors", response_model=list[VendorRead])
def list_vendors(repo: ports.VendorRepository = Depends(get_vendor_repo)):
    return repo.list()


@router.get("/products/{product_id}/components", response_model=list[ComponentRead])
def product_components(
    product_id: int,
    repo: ports.ComponentRepository = Depends(get_component_repo),
):
    return repo.list(product_id)


@router.get("/lifecycle", response_model=list[ComponentRead])
def lifecycle(repo: ports.ComponentRepository = Depends(get_component_repo)):
    return repo.list_all()


@router.post("/components", response_model=ComponentRead, status_code=201)
def create_component(
    payload: ComponentCreate,
    repo: ports.ComponentRepository = Depends(get_component_repo),
    db: Session = Depends(get_db),
    current: User = Depends(require_user),
):
    check_writable(repo)
    component = repo.create(**payload.model_dump())
    log_event(db, actor=current, event_type="component.created", entity_type="component",
              entity_id=component.id, entity_label=component.name)
    db.commit()
    return component


@router.get("/components/{component_id}", response_model=ComponentRead)
def get_component(component_id: int,
                  repo: ports.ComponentRepository = Depends(get_component_repo)):
    return repo.get(component_id)


@router.patch("/components/{component_id}", response_model=ComponentRead)
def update_component(
    component_id: int,
    payload: ComponentUpdate,
    repo: ports.ComponentRepository = Depends(get_component_repo),
    db: Session = Depends(get_db),
    current: User = Depends(require_user),
):
    check_writable(repo)
    before = repo.get(component_id)
    changes = payload.model_dump(exclude_unset=True)
    component = repo.update(component_id, changes)
    for key in _AUDIT_FIELDS:
        if key in changes:
            old, new = getattr(before, key), getattr(component, key)
            if old != new:
                log_event(db, actor=current, event_type="component.updated",
                          entity_type="component", entity_id=component.id,
                          entity_label=component.name, field=key,
                          old_value=_s(old), new_value=_s(new))
    # vendor: detect by id, log by name — ids mean nothing in the log.
    if "vendor_name" in changes and before.vendor_id != component.vendor_id:
        log_event(db, actor=current, event_type="component.updated",
                  entity_type="component", entity_id=component.id,
                  entity_label=component.name, field="vendor",
                  old_value=before.vendor_name, new_value=component.vendor_name)
    db.commit()
    return component


@router.delete("/components/{component_id}", status_code=204)
def delete_component(
    component_id: int,
    repo: ports.ComponentRepository = Depends(get_component_repo),
    db: Session = Depends(get_db),
    current: User = Depends(require_user),
):
    check_writable(repo)
    component = repo.get(component_id)
    repo.delete(component_id)
    log_event(db, actor=current, event_type="component.deleted", entity_type="component",
              entity_id=component_id, entity_label=component.name)
    db.commit()
```

Register in `main.py`: add `components` to the router import line and to the `for protected in (...)` tuple.

- [ ] **Step 5: Run tests**

`pytest tests/catalog/test_components_api.py -v` → 5 passed; full `pytest` → no regressions.

- [ ] **Step 6: Commit**

```bash
git add backend/app backend/tests/catalog/test_components_api.py
git commit -m "feat(lifecycle): vendors + components API with /lifecycle listing"
```

---

### Task 6: Systems router

**Files:**
- Modify: `backend/app/schemas.py` (append system schemas)
- Create: `backend/app/routers/systems.py`
- Modify: `backend/app/main.py` (register `systems` router)
- Test: `backend/tests/catalog/test_systems_api.py`

**Interfaces:**
- Schemas: `SystemMemberRead(component: ComponentRead, quantity)`, `SystemRead(id, name, description, product_id, lifecycle_stage, risk, members: list[SystemMemberRead])`, `SystemCreate(name, product_id, description?, lifecycle_stage=plan)`, `SystemUpdate(extra="forbid")`, `SystemMemberSet(component_id, quantity?=None)`.
- Endpoints: `GET /api/v1/products/{id}/systems`, `GET /api/v1/systems` (flat, cross-product, for pickers), `POST /api/v1/systems` (201), `GET/PATCH/DELETE /api/v1/systems/{id}`, `PUT /api/v1/systems/{id}/components` (add-or-update membership, returns `SystemRead`), `DELETE /api/v1/systems/{id}/components/{component_id}` (returns `SystemRead`).
- Audit: `system.created/updated/deleted`, `system.member_set` (field="component", new_value=component name, old_value=None), `system.member_removed` (field="component", old_value=component name); update logs field-level like components.

- [ ] **Step 1: Write the failing tests**

`backend/tests/catalog/test_systems_api.py`:

```python
import pytest


@pytest.fixture()
def env(client, member_client):
    art_id = client.post("/api/v1/arts", json={"name": "ART"}).json()["id"]
    pid = client.post("/api/v1/products", json={"name": "Network", "art_id": art_id}).json()["id"]
    cid = member_client.post("/api/v1/components", json={
        "name": "C9300", "product_id": pid, "end_of_life": "2020-01-01"}).json()["id"]
    return {"pid": pid, "cid": cid}


def test_system_crud_and_membership(member_client, env):
    r = member_client.post("/api/v1/systems", json={"name": "Fabric", "product_id": env["pid"]})
    assert r.status_code == 201
    sid = r.json()["id"]
    r = member_client.put(f"/api/v1/systems/{sid}/components",
                          json={"component_id": env["cid"], "quantity": 40})
    assert r.status_code == 200
    body = r.json()
    assert body["members"][0]["component"]["name"] == "C9300"
    assert body["members"][0]["quantity"] == 40
    assert body["risk"] == "danger"
    r = member_client.put(f"/api/v1/systems/{sid}/components",
                          json={"component_id": env["cid"], "quantity": 55})
    assert r.json()["members"][0]["quantity"] == 55
    listed = member_client.get(f"/api/v1/products/{env['pid']}/systems").json()
    assert listed[0]["name"] == "Fabric"
    r = member_client.delete(f"/api/v1/systems/{sid}/components/{env['cid']}")
    assert r.json()["members"] == []
    r = member_client.patch(f"/api/v1/systems/{sid}", json={"lifecycle_stage": "operate"})
    assert r.json()["lifecycle_stage"] == "operate"
    assert member_client.delete(f"/api/v1/systems/{sid}").status_code == 204


def test_membership_wrong_product_422(client, member_client, env):
    art_id = client.post("/api/v1/arts", json={"name": "A2"}).json()["id"]
    other = client.post("/api/v1/products", json={"name": "Other", "art_id": art_id}).json()["id"]
    foreign = member_client.post("/api/v1/components",
                                 json={"name": "F", "product_id": other}).json()["id"]
    sid = member_client.post("/api/v1/systems",
                             json={"name": "S", "product_id": env["pid"]}).json()["id"]
    assert member_client.put(f"/api/v1/systems/{sid}/components",
                             json={"component_id": foreign}).status_code == 422


def test_component_delete_blocked_while_member(member_client, env):
    sid = member_client.post("/api/v1/systems",
                             json={"name": "S", "product_id": env["pid"]}).json()["id"]
    member_client.put(f"/api/v1/systems/{sid}/components", json={"component_id": env["cid"]})
    assert member_client.delete(f"/api/v1/components/{env['cid']}").status_code == 409
```

- [ ] **Step 2: Run to verify failure** — 404s expected.

- [ ] **Step 3: Add schemas**

Append to `backend/app/schemas.py`:

```python
class SystemMemberRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    component: ComponentRead
    quantity: int | None = None


class SystemRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    description: str | None = None
    product_id: int
    product_name: str | None = None
    lifecycle_stage: LifecycleStage
    risk: RiskLevel
    members: list[SystemMemberRead] = []


class SystemCreate(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    product_id: int
    description: str | None = None
    lifecycle_stage: LifecycleStage = LifecycleStage.PLAN


class SystemUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str | None = Field(default=None, min_length=1, max_length=128)
    description: str | None = None
    lifecycle_stage: LifecycleStage | None = None


class SystemMemberSet(BaseModel):
    component_id: int
    quantity: int | None = Field(default=None, ge=0)
```

- [ ] **Step 4: Implement the router**

`backend/app/routers/systems.py`:

```python
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.audit import log_event
from app.auth import require_user
from app.catalog import ports
from app.catalog.factory import get_component_repo, get_system_repo
from app.catalog.http import check_writable
from app.db import get_db
from app.models import User
from app.schemas import SystemCreate, SystemMemberSet, SystemRead, SystemUpdate

router = APIRouter(prefix="/api/v1", tags=["systems"])


@router.get("/products/{product_id}/systems", response_model=list[SystemRead])
def product_systems(product_id: int,
                    repo: ports.SystemRepository = Depends(get_system_repo)):
    return repo.list(product_id)


@router.get("/systems", response_model=list[SystemRead])
def list_systems(repo: ports.SystemRepository = Depends(get_system_repo)):
    """Flat cross-product list for the service tech picker."""
    return repo.list_all()


@router.post("/systems", response_model=SystemRead, status_code=201)
def create_system(
    payload: SystemCreate,
    repo: ports.SystemRepository = Depends(get_system_repo),
    db: Session = Depends(get_db),
    current: User = Depends(require_user),
):
    check_writable(repo)
    system = repo.create(**payload.model_dump())
    log_event(db, actor=current, event_type="system.created", entity_type="system",
              entity_id=system.id, entity_label=system.name)
    db.commit()
    return system


@router.get("/systems/{system_id}", response_model=SystemRead)
def get_system(system_id: int, repo: ports.SystemRepository = Depends(get_system_repo)):
    return repo.get(system_id)


@router.patch("/systems/{system_id}", response_model=SystemRead)
def update_system(
    system_id: int,
    payload: SystemUpdate,
    repo: ports.SystemRepository = Depends(get_system_repo),
    db: Session = Depends(get_db),
    current: User = Depends(require_user),
):
    check_writable(repo)
    before = repo.get(system_id)
    changes = payload.model_dump(exclude_unset=True)
    system = repo.update(system_id, changes)
    for key in ("name", "description", "lifecycle_stage"):
        if key in changes:
            old, new = getattr(before, key), getattr(system, key)
            if old != new:
                old_s = old.value if hasattr(old, "value") else old
                new_s = new.value if hasattr(new, "value") else new
                log_event(db, actor=current, event_type="system.updated",
                          entity_type="system", entity_id=system.id,
                          entity_label=system.name, field=key,
                          old_value=old_s, new_value=new_s)
    db.commit()
    return system


@router.delete("/systems/{system_id}", status_code=204)
def delete_system(
    system_id: int,
    repo: ports.SystemRepository = Depends(get_system_repo),
    db: Session = Depends(get_db),
    current: User = Depends(require_user),
):
    check_writable(repo)
    system = repo.get(system_id)
    repo.delete(system_id)
    log_event(db, actor=current, event_type="system.deleted", entity_type="system",
              entity_id=system_id, entity_label=system.name)
    db.commit()


@router.put("/systems/{system_id}/components", response_model=SystemRead)
def set_member(
    system_id: int,
    payload: SystemMemberSet,
    repo: ports.SystemRepository = Depends(get_system_repo),
    components: ports.ComponentRepository = Depends(get_component_repo),
    db: Session = Depends(get_db),
    current: User = Depends(require_user),
):
    check_writable(repo)
    system = repo.set_member(system_id, payload.component_id, quantity=payload.quantity)
    component = components.get(payload.component_id)
    log_event(db, actor=current, event_type="system.member_set", entity_type="system",
              entity_id=system_id, entity_label=system.name,
              field="component", new_value=component.name)
    db.commit()
    return system


@router.delete("/systems/{system_id}/components/{component_id}", response_model=SystemRead)
def remove_member(
    system_id: int,
    component_id: int,
    repo: ports.SystemRepository = Depends(get_system_repo),
    components: ports.ComponentRepository = Depends(get_component_repo),
    db: Session = Depends(get_db),
    current: User = Depends(require_user),
):
    check_writable(repo)
    component = components.get(component_id)
    system = repo.remove_member(system_id, component_id)
    log_event(db, actor=current, event_type="system.member_removed", entity_type="system",
              entity_id=system_id, entity_label=system.name,
              field="component", old_value=component.name)
    db.commit()
    return system
```

Register in `main.py` (import + protected tuple).

- [ ] **Step 5: Run tests**

`pytest tests/catalog/test_systems_api.py -v` → 3 passed; full `pytest` → clean.

- [ ] **Step 6: Commit**

```bash
git add backend/app backend/tests/catalog/test_systems_api.py
git commit -m "feat(lifecycle): systems API with membership management"
```

---

### Task 7: Service tech endpoints

**Files:**
- Modify: `backend/app/schemas.py` (append `ServiceTechRead`, `TechComponentLink`, `TechSystemLink`)
- Modify: `backend/app/routers/services.py` (append endpoints)
- Test: `backend/tests/catalog/test_service_tech_api.py`

**Interfaces:**
- Schemas: `ServiceTechRead(components: list[ComponentRead], systems: list[SystemRead], risk: RiskLevel)`, `TechComponentLink(component_id: int)`, `TechSystemLink(system_id: int)`.
- Endpoints: `GET /api/v1/services/{id}/tech`, `POST /api/v1/services/{id}/tech/components` (201, returns `ServiceTechRead`), `DELETE /api/v1/services/{id}/tech/components/{component_id}` (200, returns `ServiceTechRead`), same pair for `/tech/systems`.
- Audit: `service.tech_linked` / `service.tech_unlinked` with field `"component"` or `"system"` and the target name as new/old value; entity is the service.

- [ ] **Step 1: Write the failing tests**

`backend/tests/catalog/test_service_tech_api.py`:

```python
import pytest


@pytest.fixture()
def env(client, member_client):
    art_id = client.post("/api/v1/arts", json={"name": "ART"}).json()["id"]
    pid = client.post("/api/v1/products", json={"name": "Network", "art_id": art_id}).json()["id"]
    sid = member_client.post("/api/v1/services",
                             json={"name": "Connectivity", "product_id": pid}).json()["id"]
    cid = member_client.post("/api/v1/components", json={
        "name": "C9300", "product_id": pid, "end_of_life": "2020-01-01"}).json()["id"]
    sysid = member_client.post("/api/v1/systems",
                               json={"name": "Fabric", "product_id": pid}).json()["id"]
    return {"pid": pid, "sid": sid, "cid": cid, "sysid": sysid}


def test_tech_link_flow(member_client, env):
    r = member_client.post(f"/api/v1/services/{env['sid']}/tech/components",
                           json={"component_id": env["cid"]})
    assert r.status_code == 201
    assert r.json()["risk"] == "danger"
    r = member_client.post(f"/api/v1/services/{env['sid']}/tech/systems",
                           json={"system_id": env["sysid"]})
    assert r.status_code == 201
    tech = member_client.get(f"/api/v1/services/{env['sid']}/tech").json()
    assert [c["name"] for c in tech["components"]] == ["C9300"]
    assert [s["name"] for s in tech["systems"]] == ["Fabric"]
    r = member_client.delete(
        f"/api/v1/services/{env['sid']}/tech/components/{env['cid']}")
    assert r.status_code == 200
    assert r.json()["components"] == []
    assert r.json()["risk"] == "ok"  # Fabric has no members


def test_duplicate_link_422(member_client, env):
    member_client.post(f"/api/v1/services/{env['sid']}/tech/components",
                       json={"component_id": env["cid"]})
    assert member_client.post(f"/api/v1/services/{env['sid']}/tech/components",
                              json={"component_id": env["cid"]}).status_code == 422


def test_missing_link_404(member_client, env):
    assert member_client.delete(
        f"/api/v1/services/{env['sid']}/tech/systems/{env['sysid']}").status_code == 404
```

- [ ] **Step 2: Run to verify failure** — 404s expected.

- [ ] **Step 3: Add schemas**

```python
class ServiceTechRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    components: list[ComponentRead] = []
    systems: list[SystemRead] = []
    risk: RiskLevel


class TechComponentLink(BaseModel):
    component_id: int


class TechSystemLink(BaseModel):
    system_id: int
```

- [ ] **Step 4: Implement endpoints**

Append to `backend/app/routers/services.py` (extend the factory import with `get_component_repo, get_system_repo`, the schemas import with `ServiceTechRead, TechComponentLink, TechSystemLink`):

```python
@router.get("/services/{service_id}/tech", response_model=ServiceTechRead)
def service_tech(service_id: int,
                 repo: ports.ServiceRepository = Depends(get_service_repo)):
    return repo.list_tech(service_id)


@router.post("/services/{service_id}/tech/components",
             response_model=ServiceTechRead, status_code=201)
def link_tech_component(
    service_id: int,
    payload: TechComponentLink,
    repo: ports.ServiceRepository = Depends(get_service_repo),
    components: ports.ComponentRepository = Depends(get_component_repo),
    db: Session = Depends(get_db),
    current: User = Depends(require_user),
):
    check_writable(repo)
    repo.add_tech_component(service_id, payload.component_id)
    service = repo.get(service_id)
    component = components.get(payload.component_id)
    log_event(db, actor=current, event_type="service.tech_linked", entity_type="service",
              entity_id=service_id, entity_label=service.name,
              field="component", new_value=component.name)
    db.commit()
    return repo.list_tech(service_id)


@router.delete("/services/{service_id}/tech/components/{component_id}",
               response_model=ServiceTechRead)
def unlink_tech_component(
    service_id: int,
    component_id: int,
    repo: ports.ServiceRepository = Depends(get_service_repo),
    components: ports.ComponentRepository = Depends(get_component_repo),
    db: Session = Depends(get_db),
    current: User = Depends(require_user),
):
    check_writable(repo)
    component = components.get(component_id)
    repo.remove_tech_component(service_id, component_id)
    service = repo.get(service_id)
    log_event(db, actor=current, event_type="service.tech_unlinked", entity_type="service",
              entity_id=service_id, entity_label=service.name,
              field="component", old_value=component.name)
    db.commit()
    return repo.list_tech(service_id)


@router.post("/services/{service_id}/tech/systems",
             response_model=ServiceTechRead, status_code=201)
def link_tech_system(
    service_id: int,
    payload: TechSystemLink,
    repo: ports.ServiceRepository = Depends(get_service_repo),
    systems: ports.SystemRepository = Depends(get_system_repo),
    db: Session = Depends(get_db),
    current: User = Depends(require_user),
):
    check_writable(repo)
    repo.add_tech_system(service_id, payload.system_id)
    service = repo.get(service_id)
    system = systems.get(payload.system_id)
    log_event(db, actor=current, event_type="service.tech_linked", entity_type="service",
              entity_id=service_id, entity_label=service.name,
              field="system", new_value=system.name)
    db.commit()
    return repo.list_tech(service_id)


@router.delete("/services/{service_id}/tech/systems/{system_id}",
               response_model=ServiceTechRead)
def unlink_tech_system(
    service_id: int,
    system_id: int,
    repo: ports.ServiceRepository = Depends(get_service_repo),
    systems: ports.SystemRepository = Depends(get_system_repo),
    db: Session = Depends(get_db),
    current: User = Depends(require_user),
):
    check_writable(repo)
    system = systems.get(system_id)
    repo.remove_tech_system(service_id, system_id)
    service = repo.get(service_id)
    log_event(db, actor=current, event_type="service.tech_unlinked", entity_type="service",
              entity_id=service_id, entity_label=service.name,
              field="system", old_value=system.name)
    db.commit()
    return repo.list_tech(service_id)
```

- [ ] **Step 5: Run tests**

`pytest tests/catalog/test_service_tech_api.py -v` → 3 passed; full `pytest` → clean.

- [ ] **Step 6: Commit**

```bash
git add backend/app backend/tests/catalog/test_service_tech_api.py
git commit -m "feat(lifecycle): service tech-link API with risk rollup"
```

---

### Task 8: Frontend types + client

**Files:**
- Modify: `frontend/src/types.ts` (append)
- Modify: `frontend/src/api/client.ts` (append + type imports)
- Test: extend `frontend/src/api/client.test.ts` (follow the file's `mockFetch(status, body)` idiom)

**Interfaces (produces):**

Types:

```ts
export type LifecycleStage = "plan" | "build" | "operate" | "phase_out" | "retired";
export type RiskLevel = "ok" | "warning" | "danger";

export interface Vendor { id: number; name: string; notes: string | null; }

export interface Component {
  id: number;
  name: string;
  model: string | null;
  description: string | null;
  product_id: number;
  product_name: string | null;
  vendor_id: number | null;
  vendor_name: string | null;
  lifecycle_stage: LifecycleStage;
  quantity: number | null;
  eos_announced: string | null;
  end_of_sale: string | null;
  end_of_support: string | null;
  end_of_life: string | null;
  risk: RiskLevel;
}

export interface SystemMember { component: Component; quantity: number | null; }

export interface CatalogSystem {
  id: number;
  name: string;
  description: string | null;
  product_id: number;
  product_name: string | null;
  lifecycle_stage: LifecycleStage;
  risk: RiskLevel;
  members: SystemMember[];
}

export interface ServiceTech {
  components: Component[];
  systems: CatalogSystem[];
  risk: RiskLevel;
}
```

Client functions (all via `request<T>`/`json()`):
- `getVendors(): Promise<Vendor[]>` → GET `${API}/vendors`
- `getProductComponents(productId): Promise<Component[]>` → GET `${API}/products/${productId}/components`
- `getLifecycle(): Promise<Component[]>` → GET `${API}/lifecycle`
- `createComponent(payload: {name; product_id; model?; description?; vendor_name?; lifecycle_stage?; quantity?; eos_announced?; end_of_sale?; end_of_support?; end_of_life?}): Promise<Component>` → POST `${API}/components`
- `updateComponent(id, changes: Partial<same fields>): Promise<Component>` → PATCH `${API}/components/${id}`
- `deleteComponent(id): Promise<void>` → DELETE
- `getProductSystems(productId): Promise<CatalogSystem[]>` → GET `${API}/products/${productId}/systems`
- `getSystems(): Promise<CatalogSystem[]>` → GET `${API}/systems` (flat, for pickers)
- `createSystem(payload: {name; product_id; description?; lifecycle_stage?}): Promise<CatalogSystem>` → POST `${API}/systems`
- `updateSystem(id, changes): Promise<CatalogSystem>` → PATCH; `deleteSystem(id): Promise<void>` → DELETE
- `setSystemMember(systemId, componentId, quantity?: number | null): Promise<CatalogSystem>` → PUT `${API}/systems/${systemId}/components` body `{component_id, quantity: quantity ?? null}`
- `removeSystemMember(systemId, componentId): Promise<CatalogSystem>` → DELETE `${API}/systems/${systemId}/components/${componentId}`
- `getServiceTech(serviceId): Promise<ServiceTech>` → GET `${API}/services/${serviceId}/tech`
- `addServiceTechComponent(serviceId, componentId): Promise<ServiceTech>` → POST `.../tech/components` body `{component_id}`
- `removeServiceTechComponent(serviceId, componentId): Promise<ServiceTech>` → DELETE `.../tech/components/${componentId}`
- `addServiceTechSystem(serviceId, systemId): Promise<ServiceTech>` / `removeServiceTechSystem(serviceId, systemId): Promise<ServiceTech>` — same for systems.

- [ ] **Step 1: Write failing tests** — add to `client.test.ts`, at minimum: `getProductComponents` URL, `createComponent` URL+body, `setSystemMember` URL+method+body, `removeSystemMember` URL+method, `addServiceTechSystem` URL+body, `getLifecycle` URL. Follow the existing import/mock idiom exactly.

```ts
it("getProductComponents GETs nested route", async () => {
  const spy = mockFetch(200, []);
  await getProductComponents(4);
  expect(spy).toHaveBeenCalledWith("/api/v1/products/4/components", undefined);
});

it("createComponent POSTs payload", async () => {
  const spy = mockFetch(201, { id: 1 });
  await createComponent({ name: "C", product_id: 2, vendor_name: "Cisco" });
  expect(spy.mock.calls[0][0]).toBe("/api/v1/components");
  expect(JSON.parse(spy.mock.calls[0][1]?.body as string)).toEqual({
    name: "C", product_id: 2, vendor_name: "Cisco",
  });
});

it("setSystemMember PUTs component + quantity", async () => {
  const spy = mockFetch(200, { id: 1, members: [] });
  await setSystemMember(3, 7, 40);
  expect(spy.mock.calls[0][0]).toBe("/api/v1/systems/3/components");
  expect(spy.mock.calls[0][1]?.method).toBe("PUT");
  expect(JSON.parse(spy.mock.calls[0][1]?.body as string)).toEqual({ component_id: 7, quantity: 40 });
});

it("removeSystemMember DELETEs membership", async () => {
  const spy = mockFetch(200, { id: 1, members: [] });
  await removeSystemMember(3, 7);
  expect(spy.mock.calls[0][0]).toBe("/api/v1/systems/3/components/7");
  expect(spy.mock.calls[0][1]?.method).toBe("DELETE");
});

it("addServiceTechSystem POSTs to tech route", async () => {
  const spy = mockFetch(201, { components: [], systems: [], risk: "ok" });
  await addServiceTechSystem(5, 9);
  expect(spy.mock.calls[0][0]).toBe("/api/v1/services/5/tech/systems");
  expect(JSON.parse(spy.mock.calls[0][1]?.body as string)).toEqual({ system_id: 9 });
});

it("getLifecycle GETs /api/v1/lifecycle", async () => {
  const spy = mockFetch(200, []);
  await getLifecycle();
  expect(spy).toHaveBeenCalledWith("/api/v1/lifecycle", undefined);
});
```

- [ ] **Step 2: RED** — `npx vitest run src/api/client.test.ts` fails (missing exports).
- [ ] **Step 3: Implement** the types and functions exactly per Interfaces. For `setSystemMember`, `json({ component_id: componentId, quantity: quantity ?? null })` with `{ ...json(...), method: "PUT" }`.
- [ ] **Step 4: GREEN** — client tests pass; `npm run build` clean.
- [ ] **Step 5: Commit** — `git add frontend/src/types.ts frontend/src/api/client.ts frontend/src/api/client.test.ts && git commit -m "feat(lifecycle): frontend types + client for components/systems/tech"`

---

### Task 9: Risk badge + product-detail tabs + Components tab + component drawer

**Files:**
- Create: `frontend/src/components/RiskBadge.tsx`
- Create: `frontend/src/components/ComponentDrawer.tsx`
- Modify: `frontend/src/components/ProductDetail.tsx` (add tab state + Components tab; Services content unchanged)
- Test: `frontend/src/components/ComponentsTab.test.tsx` (rendering via ProductDetail)

**Interfaces:**
- `RiskBadge({ risk }: { risk: RiskLevel })` — renders nothing for `ok`; `warning` → `bg-amber-50 text-amber-700` pill "warning"; `danger` → `bg-red-50 text-red-700` pill "danger".
- `ComponentDrawer({ component, productId, onClose, onChanged })` — `component: Component | null` (null = create mode, POST; else PATCH). Fields: name, model, description, vendor (SearchableSelect over `getVendors()` names, free text creates via typed-but-unmatched value — commit the TYPED value: track the select's value; on save send `vendor_name`), stage (PlainSelect over `["plan","build","operate","phase_out","retired"]`, clearable=false), quantity (`<input type="number">`), four `<input type="date">` (value `?? ""`, send `null` when empty). Save → `createComponent`/`updateComponent` with only-changed keys for PATCH; delete behind `ConfirmDialog` (guarded 409 surfaces in error strip).
- ProductDetail: tab row `Services | Systems | Components` under the header (pill buttons, `Services` default); Components tab lists `getProductComponents(product.id)` rows: name + model, vendor, stage badge (neutral gray pill), `RiskBadge`, quantity; "Add component" opens the drawer in create mode; row click opens edit mode. (Systems tab content arrives in Task 10 — render a placeholder `<div>` for now that Task 10 replaces.)

- [ ] **Step 1: Write the failing tests**

`frontend/src/components/ComponentsTab.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Component, Product } from "../types";
import ProductDetail from "./ProductDetail";

const comp: Component = {
  id: 1, name: "Catalyst 9300", model: "C9300-48P", description: null,
  product_id: 1, product_name: "Network", vendor_id: 1, vendor_name: "Cisco",
  lifecycle_stage: "operate", quantity: 120,
  eos_announced: null, end_of_sale: null,
  end_of_support: "2026-10-31", end_of_life: null, risk: "warning",
};

vi.mock("../api/client", () => ({
  getProductServices: vi.fn().mockResolvedValue([]),
  getProductComponents: vi.fn().mockResolvedValue([]),
  getProductSystems: vi.fn().mockResolvedValue([]),
  getVendors: vi.fn().mockResolvedValue([]),
  getPersonOptions: vi.fn().mockResolvedValue([]),
  getServiceOptions: vi.fn().mockResolvedValue([]),
  getServiceDependencies: vi.fn().mockResolvedValue({ outbound: [], inbound: [] }),
  getServiceTech: vi.fn().mockResolvedValue({ components: [], systems: [], risk: "ok" }),
  createService: vi.fn(), updateService: vi.fn(), deleteService: vi.fn(),
  addServiceDependency: vi.fn(), removeServiceDependency: vi.fn(),
  createComponent: vi.fn(), updateComponent: vi.fn(), deleteComponent: vi.fn(),
  createSystem: vi.fn(), updateSystem: vi.fn(), deleteSystem: vi.fn(),
  setSystemMember: vi.fn(), removeSystemMember: vi.fn(),
  addServiceTechComponent: vi.fn(), removeServiceTechComponent: vi.fn(),
  addServiceTechSystem: vi.fn(), removeServiceTechSystem: vi.fn(),
}));

import { createComponent, getProductComponents } from "../api/client";

const product: Product = {
  id: 1, name: "Network", description: null, art_id: 1, art_name: "ART",
  team_id: null, team_name: null, service_count: 0,
};

describe("ProductDetail Components tab", () => {
  it("lists components with vendor, stage, and risk badge", async () => {
    vi.mocked(getProductComponents).mockResolvedValue([comp]);
    render(<ProductDetail product={product} onBack={() => {}} />);
    await userEvent.click(await screen.findByRole("button", { name: "Components" }));
    expect(await screen.findByText("Catalyst 9300")).toBeInTheDocument();
    expect(screen.getByText("Cisco")).toBeInTheDocument();
    expect(screen.getByText("operate")).toBeInTheDocument();
    expect(screen.getByText("warning")).toBeInTheDocument();
  });

  it("creates a component through the drawer", async () => {
    vi.mocked(getProductComponents).mockResolvedValue([]);
    vi.mocked(createComponent).mockResolvedValue(comp);
    render(<ProductDetail product={product} onBack={() => {}} />);
    await userEvent.click(await screen.findByRole("button", { name: "Components" }));
    await userEvent.click(await screen.findByRole("button", { name: "Add component" }));
    await userEvent.type(screen.getByLabelText("Component name"), "New Switch");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(vi.mocked(createComponent).mock.calls[0][0]).toMatchObject({
      name: "New Switch", product_id: 1,
    });
  });

  it("opens edit mode with existing values", async () => {
    vi.mocked(getProductComponents).mockResolvedValue([comp]);
    render(<ProductDetail product={product} onBack={() => {}} />);
    await userEvent.click(await screen.findByRole("button", { name: "Components" }));
    await userEvent.click(await screen.findByText("Catalyst 9300"));
    expect(await screen.findByDisplayValue("Catalyst 9300")).toBeInTheDocument();
    expect(screen.getByDisplayValue("2026-10-31")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: RED** — module/roles missing.
- [ ] **Step 3: Implement.** `RiskBadge.tsx`:

```tsx
import type { RiskLevel } from "../types";

const STYLE: Record<Exclude<RiskLevel, "ok">, string> = {
  warning: "bg-amber-50 text-amber-700",
  danger: "bg-red-50 text-red-700",
};

/** EoL/EoS risk pill; renders nothing when the risk is "ok". */
export default function RiskBadge({ risk }: { risk: RiskLevel }) {
  if (risk === "ok") return null;
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STYLE[risk]}`}>
      {risk}
    </span>
  );
}
```

`ComponentDrawer.tsx` — follow `ServiceDrawer.tsx`'s structure exactly (fixed right `<aside aria-label="Component drawer">`, error strip, `captionClass` labels, `inputClass` fields, Save/Cancel/Delete + `ConfirmDialog`). Fields per Interfaces; every input gets an `aria-label` (`"Component name"`, `"Model"`, `"Quantity"`, `"End of support"` etc. — the date inputs use `aria-label` since `<label>` isn't wired). Create mode when `component == null`: title "New component", no Delete button, Save calls `createComponent({...})`; edit mode: Save sends only changed keys via `updateComponent`. Vendor select: `SearchableSelect` with `value={vendorName}` over `vendors.map(v => v.name)`; because SearchableSelect discards uncommitted typing, ALSO keep the free-text path: if the typed vendor doesn't exist the user can still commit it by selecting nothing — so render a small hint row under the select when its query has no match: a button "Use “{query}” as new vendor" is NOT required; instead simply document that new vendors are typed into the field and committed on Save by reading the select's committed value OR, simpler and testable: replace SearchableSelect with a plain `<input aria-label="Vendor" list-free>` text field (styled `inputClass`) — free text IS the get-or-create contract. **Decision: use a plain text input for vendor** (custom-dropdown rule applies to dropdowns; this is a text field), pre-filled with `component?.vendor_name ?? ""`; empty string saves `vendor_name: null`.

ProductDetail: add `const [tab, setTab] = useState<"services" | "systems" | "components">("services")` + pill-button row (reuse the `pill(active)` class pattern from `PlanningView.tsx`); wrap the existing service-tree block in `tab === "services" && (...)`; Components tab: load via `getProductComponents(product.id)` in a `loadComponents` callback (called on mount and after drawer changes); rows as flex cards (name+model left, vendor, stage pill `bg-gray-100 text-gray-600`, `RiskBadge`, quantity right); "Add component" button opens `ComponentDrawer` with `component={null}`; row click opens with the row's component. Systems tab renders `<div />` placeholder (Task 10 fills it).

- [ ] **Step 4: GREEN** — `npx vitest run src/components/ComponentsTab.test.tsx`, then existing `ProductDetail.test.tsx` must still pass (tabs default to Services), `npm run build`, full `npm run test`.
- [ ] **Step 5: Commit** — `git commit -m "feat(lifecycle): product-detail tabs, components tab + drawer, risk badge"`

---

### Task 10: Systems tab + system drawer

**Files:**
- Create: `frontend/src/components/SystemDrawer.tsx`
- Modify: `frontend/src/components/ProductDetail.tsx` (replace the Systems placeholder)
- Test: `frontend/src/components/SystemsTab.test.tsx`

**Interfaces:**
- `SystemDrawer({ system, productId, components, onClose, onChanged })` — `system: CatalogSystem | null` (create/edit), `components: Component[]` (the product's components, for the member picker). Fields: name, description, stage (PlainSelect). Members section (edit mode only): list rows "component name — qty" with a quantity `<input type="number" aria-label={\`Quantity for ${name}\`}>` (committed on blur/Enter via `setSystemMember`) and a remove button; add member via SearchableSelect over unlinked component names + `setSystemMember(system.id, id, null)`. Delete behind ConfirmDialog.
- ProductDetail Systems tab: rows with name, member count ("N components"), stage pill, `RiskBadge`; "Add system"; row click opens drawer.

- [ ] **Step 1: Write the failing tests**

`frontend/src/components/SystemsTab.test.tsx` (same mock block as Task 9's test file, plus):

```tsx
const system: CatalogSystem = {
  id: 9, name: "Campus fabric", description: null, product_id: 1,
  lifecycle_stage: "operate", risk: "danger",
  members: [{ component: comp, quantity: 80 }],
};

it("lists systems with member count and risk", async () => {
  vi.mocked(getProductSystems).mockResolvedValue([system]);
  render(<ProductDetail product={product} onBack={() => {}} />);
  await userEvent.click(await screen.findByRole("button", { name: "Systems" }));
  expect(await screen.findByText("Campus fabric")).toBeInTheDocument();
  expect(screen.getByText("1 components")).toBeInTheDocument();
  expect(screen.getByText("danger")).toBeInTheDocument();
});

it("adds a member through the drawer", async () => {
  vi.mocked(getProductSystems).mockResolvedValue([system]);
  vi.mocked(getProductComponents).mockResolvedValue([comp, comp2]);
  vi.mocked(setSystemMember).mockResolvedValue(system);
  render(<ProductDetail product={product} onBack={() => {}} />);
  await userEvent.click(await screen.findByRole("button", { name: "Systems" }));
  await userEvent.click(await screen.findByText("Campus fabric"));
  await userEvent.click(await screen.findByRole("combobox", { name: "Add component member" }));
  await userEvent.click(screen.getByText("Nexus 9k"));
  expect(setSystemMember).toHaveBeenCalledWith(9, 2, null);
});

it("removes a member", async () => {
  vi.mocked(getProductSystems).mockResolvedValue([system]);
  vi.mocked(removeSystemMember).mockResolvedValue({ ...system, members: [] });
  render(<ProductDetail product={product} onBack={() => {}} />);
  await userEvent.click(await screen.findByRole("button", { name: "Systems" }));
  await userEvent.click(await screen.findByText("Campus fabric"));
  await userEvent.click(await screen.findByRole("button", { name: "Remove Catalyst 9300" }));
  expect(removeSystemMember).toHaveBeenCalledWith(9, 1);
});
```

(`comp2` = second Component fixture `id: 2, name: "Nexus 9k"`; SearchableSelect options commit on `mouseDown` — `userEvent.click` covers it.)

- [ ] **Step 2: RED.**
- [ ] **Step 3: Implement** per Interfaces, mirroring ServiceDrawer structure; drawer keeps a local `CatalogSystem` state updated from each `setSystemMember`/`removeSystemMember` response (they return the fresh system) and calls `onChanged` so the tab list refreshes on close.
- [ ] **Step 4: GREEN** + `npm run build` + full `npm run test`.
- [ ] **Step 5: Commit** — `git commit -m "feat(lifecycle): systems tab + system drawer with membership editing"`

---

### Task 11: Service drawer "Provided by" block

**Files:**
- Modify: `frontend/src/components/ServiceDrawer.tsx`
- Modify: `frontend/src/components/ProductDetail.test.tsx` (mock additions only, if the shared mock block lacks the tech functions)
- Test: extend `frontend/src/components/ProductDetail.test.tsx`

**Interfaces:**
- ServiceDrawer loads `getServiceTech(service.id)` alongside deps. New section between "Used by" and the footer: heading "Provided by" + `RiskBadge` with the rolled `tech.risk` next to the drawer's "Edit service" title. Lists: linked systems then components, each row name + `RiskBadge` + remove button (`aria-label` `Unlink <name>`). Two SearchableSelects to add, cross-product per spec, options labeled `"Name (Product)"`: "Add system" over `getSystems()` (flat endpoint from Task 6) and "Add component" over `getLifecycle()` (already flat with `product_name`). The drawer fetches both lists itself on mount — no new props from ProductDetail.
- Remove/add errors surface in the existing error strip; every mutation refreshes local `tech` from the returned `ServiceTech`.

- [ ] **Step 1: Write failing tests** (append to ProductDetail.test.tsx; extend its mock block with the tech functions and `getProductComponents`/`getProductSystems` if absent):

```tsx
it("shows Provided by with rolled-up risk and unlink", async () => {
  vi.mocked(getProductServices).mockResolvedValue(tree);
  vi.mocked(getServiceTech).mockResolvedValue({
    components: [comp], systems: [], risk: "warning",
  });
  vi.mocked(removeServiceTechComponent).mockResolvedValue({
    components: [], systems: [], risk: "ok",
  });
  render(<ProductDetail product={product} onBack={() => {}} />);
  await userEvent.click(await screen.findByText("Connectivity"));
  expect(await screen.findByText("Provided by")).toBeInTheDocument();
  expect(screen.getAllByText("warning").length).toBeGreaterThan(0);
  await userEvent.click(screen.getByRole("button", { name: "Unlink Catalyst 9300" }));
  expect(removeServiceTechComponent).toHaveBeenCalledWith(1, 1);
});

it("links a system from the picker", async () => {
  vi.mocked(getProductServices).mockResolvedValue(tree);
  vi.mocked(getSystems).mockResolvedValue([systemFixture]);
  vi.mocked(addServiceTechSystem).mockResolvedValue({
    components: [], systems: [systemFixture], risk: "danger",
  });
  render(<ProductDetail product={product} onBack={() => {}} />);
  await userEvent.click(await screen.findByText("Connectivity"));
  await userEvent.click(await screen.findByRole("combobox", { name: "Add system" }));
  await userEvent.click(screen.getByText("Campus fabric (Network)"));
  expect(addServiceTechSystem).toHaveBeenCalledWith(1, 9);
});
```

(`comp`/`systemFixture` fixtures as in Tasks 9/10; mock `getSystems`/`getLifecycle` in the shared mock block; the drawer's system picker options render as "Campus fabric (Network)" — click that label text.)

- [ ] **Step 2: RED.**
- [ ] **Step 3: Implement**: ServiceDrawer state `tech: ServiceTech`, `allSystems: CatalogSystem[]`, `allComponents: Component[]`; `useEffect` loads `getServiceTech` + `getSystems` + `getLifecycle`; section UI per Interfaces; pickers exclude already-linked ids and label options `"Name (Product)"`; every add/remove `try/catch → setError`, updates `tech` from the returned `ServiceTech`.
- [ ] **Step 4: GREEN** (new + all existing ProductDetail tests) + `npm run build` + full `npm run test`.
- [ ] **Step 5: Commit** — `git commit -m "feat(lifecycle): service drawer Provided-by block with risk rollup"`

---

### Task 12: Lifecycle view + navigation

**Files:**
- Create: `frontend/src/components/LifecycleView.tsx`
- Modify: `frontend/src/App.tsx` (View union + nav button + render branch)
- Test: `frontend/src/components/LifecycleView.test.tsx`

**Interfaces:**
- `<LifecycleView />` self-contained: loads `getLifecycle()` (backend pre-sorts). Shell: `flex min-h-0 flex-1 flex-col`; filter bar (`shrink-0 border-b border-gray-200 bg-surface px-6 py-3`): `FilterSelect` label "Product" over distinct `product_name`s + pill toggle "Only at risk" (`risk !== "ok"`); scroll region with a table: Component (name, model beneath in gray), Product, Vendor, Stage (gray pill), End of Sale, End of Support, End of Life (ISO dates or "—"), Risk (`RiskBadge` or "—" for ok). Empty state: "No components yet. Add them on a product's Components tab."
- App.tsx: `View` union + `"lifecycle"`; nav `{navButton("lifecycle", "Lifecycle")}` after Products; render branch `view === "lifecycle" ? <LifecycleView /> : ...`.

- [ ] **Step 1: Write the failing test**

`frontend/src/components/LifecycleView.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Component } from "../types";
import LifecycleView from "./LifecycleView";

const rows: Component[] = [
  { id: 1, name: "Dead", model: null, description: null, product_id: 1,
    product_name: "Network", vendor_id: 1, vendor_name: "Cisco",
    lifecycle_stage: "operate", quantity: null, eos_announced: null,
    end_of_sale: null, end_of_support: null, end_of_life: "2020-01-01", risk: "danger" },
  { id: 2, name: "Fine", model: "X", description: null, product_id: 2,
    product_name: "Storage", vendor_id: null, vendor_name: null,
    lifecycle_stage: "plan", quantity: null, eos_announced: null,
    end_of_sale: null, end_of_support: null, end_of_life: null, risk: "ok" },
];

vi.mock("../api/client", () => ({ getLifecycle: vi.fn() }));
import { getLifecycle } from "../api/client";

describe("LifecycleView", () => {
  it("renders the component table", async () => {
    vi.mocked(getLifecycle).mockResolvedValue(rows);
    render(<LifecycleView />);
    expect(await screen.findByText("Dead")).toBeInTheDocument();
    expect(screen.getByText("2020-01-01")).toBeInTheDocument();
    expect(screen.getByText("danger")).toBeInTheDocument();
    expect(screen.getByText("Fine")).toBeInTheDocument();
  });

  it("filters to at-risk only", async () => {
    vi.mocked(getLifecycle).mockResolvedValue(rows);
    render(<LifecycleView />);
    await screen.findByText("Dead");
    await userEvent.click(screen.getByRole("button", { name: "Only at risk" }));
    expect(screen.queryByText("Fine")).not.toBeInTheDocument();
    expect(screen.getByText("Dead")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: RED.**
- [ ] **Step 3: Implement** per Interfaces (table inside `overflow-auto`; `FilterSelect` used exactly like `TimelineView.tsx`'s Department filter; pill class copied from `PlanningView.tsx`).
- [ ] **Step 4: GREEN** + `npm run build` + full `npm run test`.
- [ ] **Step 5: Commit** — `git commit -m "feat(lifecycle): cross-product Lifecycle view + navigation"`

---

### Task 13: Full verification + docs

**Files:**
- Modify: `CLAUDE.md` (migration head → `0027`; extend the catalog bullet with components/systems/lifecycle + Lifecycle view; view count 6 → 7)

**Steps:**

- [ ] **Step 1:** Full suites: `pytest` (backend/), `npm run test` + `npm run build` (frontend/) — all green.
- [ ] **Step 2:** Rebuild + verify the stack: `export FONTAWESOME_PACKAGE_TOKEN=$(tr -d '\n' < frontend/.fa-token) && docker compose build backend frontend && docker compose up -d`; backend log reaches alembic `0027`. Playwright walkthrough: create component "Catalyst 9300" (vendor Cisco, EoS next month) on a product → risk badge; create system, add member, see rolled risk; link both to a service, drawer shows Provided-by with risk; Lifecycle view lists it sorted, "Only at risk" filters; verify guards (delete component while member → 409 message); dark-mode check; clean up demo data via the UI.
- [ ] **Step 3:** Update CLAUDE.md; commit `docs: components/systems lifecycle + migration head 0027`.
- [ ] **Step 4:** Finish with superpowers:finishing-a-development-branch.
