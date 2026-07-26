# Budget & Support Contracts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Support contracts (M2M on components, computed expiry status) plus component-level budget fields, a Contracts tab with totals, and a cross-product Contracts view — per `docs/superpowers/specs/2026-07-26-budget-support-contracts-design.md`.

**Architecture:** Extends `backend/app/catalog/` exactly like sub-project 2 did (domain dataclasses + `ContractRepository` port + Postgres adapter + factory; ORM in `models.py`; migration `0028`; new router `contracts.py`). Frontend adds a fourth product-detail tab, a ContractDrawer, budget fields + read-only contracts in ComponentDrawer, and a Contracts top-level view mirroring LifecycleView.

**Tech Stack:** FastAPI, SQLAlchemy 2.0, Alembic, Pydantic v2, pytest; React + TypeScript + Tailwind v4, Vitest.

## Global Constraints

- API base `/api/v1`; new router mounts under `Depends(require_user)`; every endpoint writable by ANY signed-in user.
- `ContractStatus` (computed, never stored): `expired` when `end_date` ≤ today; `expiring` when `end_date` within the next `notice_period_days` days (default **90** when unset); `active` otherwise incl. no `end_date` (evergreen).
- Contract expiry stays OUT of `RiskLevel` — no rollup into component/system/service risk.
- Vendor get-or-create by name reuses `get_or_create_vendor_id`; `vendor_name` payload fields capped `max_length=128`.
- Deletion guards → `CatalogInUse` (409): component additionally blocked while linked to contracts; product additionally blocked while it has contracts. Contract delete always allowed — link rows removed explicitly (SQLite fixtures don't enforce CASCADE).
- `list_all()` ordering: expired first, then soonest `end_date`, evergreen (no end_date) last, name tiebreak — server-sorted; frontend never re-sorts.
- Error mapping (already app-level): CatalogNotFound→404, CatalogRuleViolation→422, CatalogInUse→409; `check_writable` on every write (405 seam).
- Audit: `contract.created/updated/deleted`, `contract.component_linked/unlinked` (field="component", component name as new/old value); updates field-level (detection by id/value, vendor by `vendor_id` logged by name, dates/costs as plain string values).
- Enum columns pattern n/a (status never stored); money columns use `Numeric` ORM / `float | None` Pydantic (matches `wsjf_score`).
- `changes` dicts follow `model_dump(exclude_unset=True)`: key present with None = clear where nullable. After flushes changing FKs, `expire` affected relationships before mapping.
- Frontend: custom dropdowns only; new view fits the fixed shell (`flex min-h-0 flex-1 flex-col`, `shrink-0` filter bar, internal `overflow-auto`); loading state before empty state; every input aria-labeled.
- Backend commands from `backend/` with venv active; frontend from `frontend/`. Migration dry-run (upgrade AND downgrade) against compose Postgres.
- Work on branch `feat/support-contracts` off `main`.

---

### Task 1: Domain — ContractStatus, dataclasses, Component budget fields

**Files:**
- Modify: `backend/app/catalog/domain.py` (append; extend `Component`)
- Test: `backend/tests/catalog/test_contract_status.py`

**Interfaces:**
- Produces: enum `ContractStatus(ACTIVE="active", EXPIRING="expiring", EXPIRED="expired")`; `DEFAULT_NOTICE_DAYS = 90`; `contract_status(*, end_date: date | None, notice_period_days: int | None, today: date) -> ContractStatus`; dataclasses `ContractComponentSummary(id, name, product_name)` and `SupportContract(id, name, product_id, contract_no=None, vendor_id=None, start_date=None, end_date=None, yearly_cost=None, notice_period_days=None, notes=None, vendor_name=None, product_name=None, status=ContractStatus.ACTIVE, components: list[ContractComponentSummary] = field(default_factory=list))`; `ContractSummary(id, name, status, end_date)` (for the component drawer's read-only list).
- `Component` gains, after `end_of_life` and before the read-side block: `yearly_run_cost: float | None = None`, `replacement_budget: float | None = None`; and at the end of the read-side block: `contracts: list["ContractSummary"] = field(default_factory=list)`.

- [ ] **Step 1: Write the failing tests**

`backend/tests/catalog/test_contract_status.py`:

```python
from datetime import date, timedelta

from app.catalog.domain import (
    Component,
    ContractStatus,
    SupportContract,
    contract_status,
)

TODAY = date(2026, 7, 26)


def _status(end=None, notice=None):
    return contract_status(end_date=end, notice_period_days=notice, today=TODAY)


def test_evergreen_is_active():
    assert _status() == ContractStatus.ACTIVE


def test_end_today_or_past_is_expired():
    assert _status(end=TODAY) == ContractStatus.EXPIRED
    assert _status(end=TODAY - timedelta(days=1)) == ContractStatus.EXPIRED


def test_default_notice_window_90_days():
    assert _status(end=TODAY + timedelta(days=90)) == ContractStatus.EXPIRING
    assert _status(end=TODAY + timedelta(days=91)) == ContractStatus.ACTIVE


def test_custom_notice_window():
    assert _status(end=TODAY + timedelta(days=120), notice=180) == ContractStatus.EXPIRING
    assert _status(end=TODAY + timedelta(days=120), notice=30) == ContractStatus.ACTIVE
    assert _status(end=TODAY + timedelta(days=30), notice=30) == ContractStatus.EXPIRING


def test_dataclass_defaults():
    c = SupportContract(id=1, name="SmartNet", product_id=1)
    assert c.status == ContractStatus.ACTIVE
    assert c.components == []
    comp = Component(id=1, name="C", product_id=1)
    assert comp.yearly_run_cost is None
    assert comp.contracts == []
```

- [ ] **Step 2: RED** — `pytest tests/catalog/test_contract_status.py -v` → ImportError.

- [ ] **Step 3: Implement**

Append to `backend/app/catalog/domain.py`:

```python
class ContractStatus(str, enum.Enum):
    ACTIVE = "active"
    EXPIRING = "expiring"
    EXPIRED = "expired"


DEFAULT_NOTICE_DAYS = 90


@dataclass
class ContractComponentSummary:
    id: int
    name: str
    product_name: str | None = None


@dataclass
class ContractSummary:
    id: int
    name: str
    status: ContractStatus = ContractStatus.ACTIVE
    end_date: date | None = None


@dataclass
class SupportContract:
    id: int | None
    name: str
    product_id: int
    contract_no: str | None = None
    vendor_id: int | None = None
    start_date: date | None = None
    end_date: date | None = None
    yearly_cost: float | None = None
    notice_period_days: int | None = None
    notes: str | None = None
    # read-side enrichments filled by adapters
    vendor_name: str | None = None
    product_name: str | None = None
    status: ContractStatus = ContractStatus.ACTIVE
    components: list[ContractComponentSummary] = field(default_factory=list)


def contract_status(*, end_date: date | None, notice_period_days: int | None,
                    today: date) -> ContractStatus:
    """expired once the end date passes; expiring inside the notice window
    (90 days when none is set); evergreen contracts are always active."""
    if end_date is None:
        return ContractStatus.ACTIVE
    if end_date <= today:
        return ContractStatus.EXPIRED
    window = notice_period_days if notice_period_days is not None else DEFAULT_NOTICE_DAYS
    if end_date <= today + timedelta(days=window):
        return ContractStatus.EXPIRING
    return ContractStatus.ACTIVE
```

And in the existing `Component` dataclass insert after `end_of_life`:

```python
    yearly_run_cost: float | None = None
    replacement_budget: float | None = None
```

and at the end of its read-side block:

```python
    contracts: list["ContractSummary"] = field(default_factory=list)
```

- [ ] **Step 4: GREEN** — the new file passes; `pytest tests/catalog/ -q` no regressions.
- [ ] **Step 5: Commit**

```bash
git checkout -b feat/support-contracts
git add backend/app/catalog/domain.py backend/tests/catalog/test_contract_status.py
git commit -m "feat(contracts): domain — ContractStatus, SupportContract, component budget fields"
```

---

### Task 2: ORM + migration 0028

**Files:**
- Modify: `backend/app/models.py` (append `SupportContract` + `contract_components` table; add two Numeric columns to `Component`)
- Create: `backend/alembic/versions/0028_support_contracts.py`
- Test: `backend/tests/catalog/test_contract_models.py`

**Interfaces:**
- Produces: ORM `SupportContract` (tablename `support_contracts`, unique `(product_id, name)` named `uq_contract_product_name`, FKs product RESTRICT / vendor SET NULL, relationships `product`, `vendor`), association `contract_components` Table (contract CASCADE, component RESTRICT, composite PK); `Component.yearly_run_cost` / `Component.replacement_budget` (`Mapped[float | None] = mapped_column(Numeric)`).

- [ ] **Step 1: Write the failing test**

`backend/tests/catalog/test_contract_models.py`:

```python
from datetime import date

from app.models import Art, Component, Product, SupportContract, Vendor, contract_components


def test_contract_roundtrip(db_session):
    art = Art(name="A")
    db_session.add(art)
    db_session.flush()
    product = Product(name="Network", art_id=art.id)
    vendor = Vendor(name="Cisco")
    db_session.add_all([product, vendor])
    db_session.flush()
    comp = Component(name="C9300", product_id=product.id,
                     yearly_run_cost=1200.5, replacement_budget=90000)
    contract = SupportContract(
        name="SmartNet Campus", product_id=product.id, vendor_id=vendor.id,
        contract_no="SN-1", start_date=date(2026, 1, 1), end_date=date(2027, 1, 1),
        yearly_cost=15000, notice_period_days=60,
    )
    db_session.add_all([comp, contract])
    db_session.flush()
    db_session.execute(contract_components.insert().values(
        contract_id=contract.id, component_id=comp.id))
    db_session.commit()

    assert contract.vendor.name == "Cisco"
    assert contract.product.name == "Network"
    assert float(comp.yearly_run_cost) == 1200.5
```

- [ ] **Step 2: RED** — ImportError.

- [ ] **Step 3: Implement**

`backend/app/models.py` — on `Component`, after `end_of_life`:

```python
    yearly_run_cost: Mapped[float | None] = mapped_column(Numeric)
    replacement_budget: Mapped[float | None] = mapped_column(Numeric)
```

Append at the end of the file:

```python
contract_components = Table(
    "contract_components",
    Base.metadata,
    Column("contract_id", Integer, ForeignKey("support_contracts.id", ondelete="CASCADE"), primary_key=True),
    Column("component_id", Integer, ForeignKey("components.id", ondelete="RESTRICT"), primary_key=True),
)


class SupportContract(Base):
    __tablename__ = "support_contracts"
    __table_args__ = (UniqueConstraint("product_id", "name", name="uq_contract_product_name"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(128))
    contract_no: Mapped[str | None] = mapped_column(String(64))
    product_id: Mapped[int] = mapped_column(
        ForeignKey("products.id", ondelete="RESTRICT"), index=True
    )
    vendor_id: Mapped[int | None] = mapped_column(
        ForeignKey("vendors.id", ondelete="SET NULL"), index=True
    )
    start_date: Mapped[date | None] = mapped_column(Date)
    end_date: Mapped[date | None] = mapped_column(Date)
    yearly_cost: Mapped[float | None] = mapped_column(Numeric)
    notice_period_days: Mapped[int | None] = mapped_column(Integer)
    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow, server_default=func.now()
    )

    product: Mapped["Product"] = relationship()
    vendor: Mapped["Vendor | None"] = relationship()
```

(NOTE: `contract_components` must be defined AFTER `SupportContract`? No — Table objects reference tables by string name, order doesn't matter; keep the Table first like `service_components`.)

- [ ] **Step 4: GREEN** — test passes; full `pytest` no regressions.

- [ ] **Step 5: Migration**

`backend/alembic/versions/0028_support_contracts.py`:

```python
"""support contracts + component budget fields

Revision ID: 0028
Revises: 0027
"""
from alembic import op
import sqlalchemy as sa

revision = "0028"
down_revision = "0027"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "support_contracts",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("name", sa.String(128), nullable=False),
        sa.Column("contract_no", sa.String(64)),
        sa.Column("product_id", sa.Integer, sa.ForeignKey("products.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("vendor_id", sa.Integer, sa.ForeignKey("vendors.id", ondelete="SET NULL")),
        sa.Column("start_date", sa.Date),
        sa.Column("end_date", sa.Date),
        sa.Column("yearly_cost", sa.Numeric),
        sa.Column("notice_period_days", sa.Integer),
        sa.Column("notes", sa.Text),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("product_id", "name", name="uq_contract_product_name"),
    )
    op.create_index("ix_support_contracts_product_id", "support_contracts", ["product_id"])
    op.create_index("ix_support_contracts_vendor_id", "support_contracts", ["vendor_id"])
    op.create_table(
        "contract_components",
        sa.Column("contract_id", sa.Integer, sa.ForeignKey("support_contracts.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("component_id", sa.Integer, sa.ForeignKey("components.id", ondelete="RESTRICT"), primary_key=True),
    )
    op.add_column("components", sa.Column("yearly_run_cost", sa.Numeric))
    op.add_column("components", sa.Column("replacement_budget", sa.Numeric))


def downgrade() -> None:
    op.drop_column("components", "replacement_budget")
    op.drop_column("components", "yearly_run_cost")
    op.drop_table("contract_components")
    op.drop_table("support_contracts")
```

- [ ] **Step 6: Dry-run** — `docker compose up -d db; cd backend && . .venv/bin/activate && alembic upgrade head && alembic downgrade -1 && alembic upgrade head` — all succeed.
- [ ] **Step 7: Commit** — `git commit -m "feat(contracts): ORM + migration 0028 (support_contracts, links, budget columns)"`

---

### Task 3: Port + Postgres adapter + guards

**Files:**
- Modify: `backend/app/catalog/ports.py` (append `ContractRepository`)
- Modify: `backend/app/catalog/adapters/postgres.py` (append `_to_contract`, `PostgresContractRepository`; extend `_to_component` with contracts summaries + budget fields; extend `_COMPONENT_FIELDS`; extend component create; extend component + product delete guards)
- Modify: `backend/app/catalog/factory.py` (append `get_contract_repo`)
- Test: `backend/tests/catalog/test_contract_adapter.py`

**Interfaces:**
- `ContractRepository` Protocol (with `read_only`):
  - `list(product_id: int, today: date | None = None) -> list[SupportContract]` (name-ordered)
  - `list_all(today: date | None = None) -> list[SupportContract]` (expired first → soonest end_date → evergreen last → name)
  - `get(contract_id: int, today: date | None = None) -> SupportContract`
  - `create(*, name: str, product_id: int, contract_no: str | None = None, vendor_name: str | None = None, start_date: date | None = None, end_date: date | None = None, yearly_cost: float | None = None, notice_period_days: int | None = None, notes: str | None = None) -> SupportContract`
  - `update(contract_id: int, changes: dict) -> SupportContract` (accepts `vendor_name` → get-or-create/None clears)
  - `delete(contract_id: int) -> None` (removes its link rows explicitly first)
  - `link_component(contract_id: int, component_id: int) -> SupportContract` / `unlink_component(contract_id: int, component_id: int) -> SupportContract` (duplicate → `CatalogRuleViolation("This link already exists")`; unknown component → `CatalogRuleViolation`; missing link → `CatalogNotFound("Link not found")`)
- `_to_component` additionally fills `yearly_run_cost` (as `float(...)` when not None), `replacement_budget`, and `contracts: list[ContractSummary]` (status computed with the same `today`), name-ordered.
- `_COMPONENT_FIELDS` gains `"yearly_run_cost", "replacement_budget"`; component `create(...)` gains the two kwargs.
- Component delete: additional guard `Component provides/... linked to N contract(s)` → `CatalogInUse(f"Component is covered by {n} contract(s); unlink it first")`. Product delete: `CatalogInUse(f"Product has {n} contract(s); delete them first")` (checked after systems).
- Factory: `get_contract_repo(db) -> ports.ContractRepository`.

- [ ] **Step 1: Write the failing tests**

`backend/tests/catalog/test_contract_adapter.py`:

```python
from datetime import date, timedelta

import pytest

from app.catalog.adapters.postgres import (
    PostgresArtRepository,
    PostgresComponentRepository,
    PostgresContractRepository,
    PostgresProductRepository,
)
from app.catalog.domain import (
    CatalogInUse,
    CatalogNotFound,
    CatalogRuleViolation,
    ContractStatus,
)

TODAY = date(2026, 7, 26)


@pytest.fixture()
def env(db_session):
    arts = PostgresArtRepository(db_session)
    products = PostgresProductRepository(db_session)
    art = arts.create(name="ART")
    product = products.create(name="Network", art_id=art.id)
    return {
        "db": db_session, "products": products, "product": product,
        "components": PostgresComponentRepository(db_session),
        "contracts": PostgresContractRepository(db_session),
    }


def test_contract_crud_with_vendor_and_status(env):
    contracts = env["contracts"]
    c = contracts.create(
        name="SmartNet", product_id=env["product"].id, vendor_name="Cisco",
        end_date=TODAY + timedelta(days=30), yearly_cost=15000,
    )
    assert c.vendor_name == "Cisco"
    assert contracts.get(c.id, today=TODAY).status == ContractStatus.EXPIRING
    contracts.update(c.id, {"end_date": TODAY - timedelta(days=1)})
    assert contracts.get(c.id, today=TODAY).status == ContractStatus.EXPIRED
    contracts.update(c.id, {"end_date": None})
    assert contracts.get(c.id, today=TODAY).status == ContractStatus.ACTIVE
    with pytest.raises(CatalogRuleViolation):
        contracts.create(name="SmartNet", product_id=env["product"].id)
    contracts.delete(c.id)
    with pytest.raises(CatalogNotFound):
        contracts.get(c.id)


def test_list_all_ordering(env):
    contracts = env["contracts"]
    pid = env["product"].id
    contracts.create(name="Evergreen", product_id=pid)
    contracts.create(name="Dead", product_id=pid, end_date=TODAY - timedelta(days=5))
    contracts.create(name="Soon", product_id=pid, end_date=TODAY + timedelta(days=10))
    contracts.create(name="Later", product_id=pid, end_date=TODAY + timedelta(days=400))
    names = [c.name for c in contracts.list_all(today=TODAY)]
    assert names == ["Dead", "Soon", "Later", "Evergreen"]
    assert contracts.list_all(today=TODAY)[0].product_name == "Network"


def test_links_and_component_summaries(env):
    contracts, components = env["contracts"], env["components"]
    pid = env["product"].id
    comp = components.create(name="C9300", product_id=pid)
    c = contracts.create(name="SmartNet", product_id=pid,
                         end_date=TODAY - timedelta(days=1))
    got = contracts.link_component(c.id, comp.id)
    assert [m.name for m in got.components] == ["C9300"]
    with pytest.raises(CatalogRuleViolation):
        contracts.link_component(c.id, comp.id)
    with pytest.raises(CatalogRuleViolation):
        contracts.link_component(c.id, 999)
    comp_read = components.get(comp.id, today=TODAY)
    assert [s.name for s in comp_read.contracts] == ["SmartNet"]
    assert comp_read.contracts[0].status == ContractStatus.EXPIRED
    got = contracts.unlink_component(c.id, comp.id)
    assert got.components == []
    with pytest.raises(CatalogNotFound):
        contracts.unlink_component(c.id, comp.id)


def test_guards(env):
    contracts, components = env["contracts"], env["components"]
    pid = env["product"].id
    comp = components.create(name="C", product_id=pid)
    c = contracts.create(name="S", product_id=pid)
    contracts.link_component(c.id, comp.id)
    with pytest.raises(CatalogInUse):
        components.delete(comp.id)  # covered by a contract
    with pytest.raises(CatalogInUse):
        env["products"].delete(pid)  # has contracts (and a component)
    contracts.delete(c.id)  # allowed; removes the link row
    components.delete(comp.id)  # now free


def test_component_budget_fields_roundtrip(env):
    components = env["components"]
    comp = components.create(name="C", product_id=env["product"].id,
                             yearly_run_cost=1200.5, replacement_budget=90000)
    assert comp.yearly_run_cost == 1200.5
    updated = components.update(comp.id, {"replacement_budget": None})
    assert updated.replacement_budget is None
    assert updated.yearly_run_cost == 1200.5
```

- [ ] **Step 2: RED** — ImportError.

- [ ] **Step 3: Implement ports**

Append to `ports.py` (extend the domain import with `ContractStatus, SupportContract`):

```python
class ContractRepository(Protocol):
    @property
    def read_only(self) -> bool: ...
    def list(self, product_id: int, today: date | None = None) -> list[SupportContract]: ...
    def list_all(self, today: date | None = None) -> list[SupportContract]: ...
    def get(self, contract_id: int, today: date | None = None) -> SupportContract: ...
    def create(self, *, name: str, product_id: int, contract_no: str | None = None,
               vendor_name: str | None = None, start_date: date | None = None,
               end_date: date | None = None, yearly_cost: float | None = None,
               notice_period_days: int | None = None,
               notes: str | None = None) -> SupportContract: ...
    def update(self, contract_id: int, changes: dict) -> SupportContract: ...
    def delete(self, contract_id: int) -> None: ...
    def link_component(self, contract_id: int, component_id: int) -> SupportContract: ...
    def unlink_component(self, contract_id: int, component_id: int) -> SupportContract: ...
```

- [ ] **Step 4: Implement the adapter**

Append to `adapters/postgres.py` (extend the domain import with `ContractStatus, contract_status`):

```python
def _contract_component_rows(db: Session, contract_id: int) -> list[m.Component]:
    return list(db.scalars(
        select(m.Component)
        .join(m.contract_components, m.contract_components.c.component_id == m.Component.id)
        .where(m.contract_components.c.contract_id == contract_id)
        .order_by(m.Component.name)
    ))


def _to_contract(db: Session, row: m.SupportContract, today: date) -> domain.SupportContract:
    return domain.SupportContract(
        id=row.id, name=row.name, contract_no=row.contract_no,
        product_id=row.product_id, vendor_id=row.vendor_id,
        start_date=row.start_date, end_date=row.end_date,
        yearly_cost=float(row.yearly_cost) if row.yearly_cost is not None else None,
        notice_period_days=row.notice_period_days, notes=row.notes,
        vendor_name=row.vendor.name if row.vendor else None,
        product_name=row.product.name if row.product else None,
        status=contract_status(end_date=row.end_date,
                               notice_period_days=row.notice_period_days, today=today),
        components=[
            domain.ContractComponentSummary(
                id=c.id, name=c.name,
                product_name=c.product.name if c.product else None,
            )
            for c in _contract_component_rows(db, row.id)
        ],
    )


_CONTRACT_FIELDS = ("name", "contract_no", "start_date", "end_date",
                    "yearly_cost", "notice_period_days", "notes")


class PostgresContractRepository:
    read_only = False

    def __init__(self, db: Session):
        self.db = db

    def _row(self, contract_id: int) -> m.SupportContract:
        row = self.db.get(m.SupportContract, contract_id)
        if row is None:
            raise CatalogNotFound("Contract not found")
        return row

    def _validate_name(self, *, name: str, product_id: int, exclude_id: int | None) -> None:
        q = select(m.SupportContract).where(
            m.SupportContract.product_id == product_id, m.SupportContract.name == name
        )
        if exclude_id is not None:
            q = q.where(m.SupportContract.id != exclude_id)
        if self.db.scalar(q):
            raise CatalogRuleViolation("A contract with this name already exists in this product")

    def list(self, product_id: int, today: date | None = None) -> list[domain.SupportContract]:
        today = today or date.today()
        rows = self.db.scalars(
            select(m.SupportContract)
            .where(m.SupportContract.product_id == product_id)
            .order_by(m.SupportContract.name)
        )
        return [_to_contract(self.db, r, today) for r in rows]

    def list_all(self, today: date | None = None) -> list[domain.SupportContract]:
        today = today or date.today()
        out = [_to_contract(self.db, r, today)
               for r in self.db.scalars(select(m.SupportContract))]
        order = {ContractStatus.EXPIRED: 0, ContractStatus.EXPIRING: 1,
                 ContractStatus.ACTIVE: 1}

        def key(c: domain.SupportContract):
            # expired first; then by soonest end date; evergreen (no end) last
            return (0 if c.status == ContractStatus.EXPIRED else 1,
                    c.end_date or date.max, c.name.lower())

        out.sort(key=key)
        return out

    def get(self, contract_id: int, today: date | None = None) -> domain.SupportContract:
        return _to_contract(self.db, self._row(contract_id), today or date.today())

    def create(self, *, name: str, product_id: int, contract_no: str | None = None,
               vendor_name: str | None = None, start_date: date | None = None,
               end_date: date | None = None, yearly_cost: float | None = None,
               notice_period_days: int | None = None,
               notes: str | None = None) -> domain.SupportContract:
        if self.db.get(m.Product, product_id) is None:
            raise CatalogRuleViolation("product_id does not exist")
        self._validate_name(name=name, product_id=product_id, exclude_id=None)
        row = m.SupportContract(
            name=name, product_id=product_id, contract_no=contract_no,
            vendor_id=get_or_create_vendor_id(self.db, vendor_name),
            start_date=start_date, end_date=end_date, yearly_cost=yearly_cost,
            notice_period_days=notice_period_days, notes=notes,
        )
        self.db.add(row)
        self.db.flush()
        return _to_contract(self.db, row, date.today())

    def update(self, contract_id: int, changes: dict) -> domain.SupportContract:
        row = self._row(contract_id)
        if "name" in changes and changes["name"] != row.name:
            self._validate_name(name=changes["name"], product_id=row.product_id,
                                exclude_id=contract_id)
        if "vendor_name" in changes:
            row.vendor_id = get_or_create_vendor_id(self.db, changes["vendor_name"])
        for key in _CONTRACT_FIELDS:
            if key in changes:
                setattr(row, key, changes[key])
        self.db.flush()
        self.db.expire(row, ["vendor"])
        return _to_contract(self.db, row, date.today())

    def delete(self, contract_id: int) -> None:
        row = self._row(contract_id)
        # Link rows go with the contract (explicit for the SQLite fixtures,
        # which don't enforce ON DELETE CASCADE).
        self.db.execute(m.contract_components.delete().where(
            m.contract_components.c.contract_id == contract_id))
        self.db.delete(row)
        self.db.flush()

    def _link(self, contract_id: int, component_id: int):
        return self.db.execute(
            select(m.contract_components).where(
                m.contract_components.c.contract_id == contract_id,
                m.contract_components.c.component_id == component_id,
            )
        ).first()

    def link_component(self, contract_id: int, component_id: int) -> domain.SupportContract:
        row = self._row(contract_id)
        if self.db.get(m.Component, component_id) is None:
            raise CatalogRuleViolation("component_id does not exist")
        if self._link(contract_id, component_id):
            raise CatalogRuleViolation("This link already exists")
        self.db.execute(m.contract_components.insert().values(
            contract_id=contract_id, component_id=component_id))
        return _to_contract(self.db, row, date.today())

    def unlink_component(self, contract_id: int, component_id: int) -> domain.SupportContract:
        row = self._row(contract_id)
        if not self._link(contract_id, component_id):
            raise CatalogNotFound("Link not found")
        self.db.execute(m.contract_components.delete().where(
            m.contract_components.c.contract_id == contract_id,
            m.contract_components.c.component_id == component_id))
        return _to_contract(self.db, row, date.today())
```

Also in the adapter:
1. Add a helper next to `_to_component`:

```python
def _component_contract_rows(db: Session, component_id: int) -> list[m.SupportContract]:
    return list(db.scalars(
        select(m.SupportContract)
        .join(m.contract_components,
              m.contract_components.c.contract_id == m.SupportContract.id)
        .where(m.contract_components.c.component_id == component_id)
        .order_by(m.SupportContract.name)
    ))
```

Change `_to_component`'s signature to `_to_component(row: m.Component, today: date, db: Session | None = None)`. In the returned dataclass add `yearly_run_cost=float(row.yearly_run_cost) if row.yearly_run_cost is not None else None`, `replacement_budget=float(row.replacement_budget) if row.replacement_budget is not None else None`, and:

```python
        contracts=[
            domain.ContractSummary(
                id=ct.id, name=ct.name, end_date=ct.end_date,
                status=contract_status(end_date=ct.end_date,
                                       notice_period_days=ct.notice_period_days,
                                       today=today),
            )
            for ct in _component_contract_rows(db, row.id)
        ] if db is not None else [],
```

Pass `db=self.db` ONLY from `PostgresComponentRepository.get/list/list_all`. All other call sites (`_to_system`'s members, `list_tech`) keep calling `_to_component(r, today)` unchanged — the `db=None` default leaves `contracts` empty there, which keeps N+1 bounded (systems/tech views don't need contract summaries).
2. `_COMPONENT_FIELDS` — append `"yearly_run_cost", "replacement_budget"`.
3. `PostgresComponentRepository.create(...)` — add the two kwargs (`yearly_run_cost: float | None = None, replacement_budget: float | None = None`) and pass them to `m.Component(...)`; mirror in the `ComponentRepository` Protocol.
4. Component delete guard — after the service-link check:

```python
        n_ct = self.db.scalar(
            select(func.count()).select_from(m.contract_components)
            .where(m.contract_components.c.component_id == component_id)
        )
        if n_ct:
            raise CatalogInUse(f"Component is covered by {n_ct} contract(s); unlink it first")
```

5. Product delete guard — after the systems check:

```python
        n_ct = self.db.scalar(
            select(func.count()).select_from(m.SupportContract)
            .where(m.SupportContract.product_id == product_id)
        )
        if n_ct:
            raise CatalogInUse(f"Product has {n_ct} contract(s); delete them first")
```

Factory:

```python
def get_contract_repo(db: Session = Depends(get_db)) -> ports.ContractRepository:
    return PostgresContractRepository(db)
```

- [ ] **Step 5: GREEN** — new tests pass; full `pytest` no regressions.
- [ ] **Step 6: Commit** — `git commit -m "feat(contracts): contract repository, component contract summaries, guards"`

---

### Task 4: Schemas + contracts router

**Files:**
- Modify: `backend/app/schemas.py` (append contract schemas; extend Component schemas)
- Create: `backend/app/routers/contracts.py`
- Modify: `backend/app/main.py` (register `contracts`)
- Test: `backend/tests/catalog/test_contracts_api.py`

**Interfaces:**
- Schemas (import `ContractStatus` from `app.catalog.domain`):

```python
class ContractSummaryRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    status: ContractStatus
    end_date: date | None = None


class ContractComponentRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    product_name: str | None = None


class ContractRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    contract_no: str | None = None
    product_id: int
    product_name: str | None = None
    vendor_id: int | None = None
    vendor_name: str | None = None
    start_date: date | None = None
    end_date: date | None = None
    yearly_cost: float | None = None
    notice_period_days: int | None = None
    notes: str | None = None
    status: ContractStatus
    components: list[ContractComponentRead] = []


class ContractCreate(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    product_id: int
    contract_no: str | None = Field(default=None, max_length=64)
    vendor_name: str | None = Field(default=None, max_length=128)
    start_date: date | None = None
    end_date: date | None = None
    yearly_cost: float | None = Field(default=None, ge=0)
    notice_period_days: int | None = Field(default=None, ge=0)
    notes: str | None = None


class ContractUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str | None = Field(default=None, min_length=1, max_length=128)
    contract_no: str | None = Field(default=None, max_length=64)
    vendor_name: str | None = Field(default=None, max_length=128)
    start_date: date | None = None
    end_date: date | None = None
    yearly_cost: float | None = Field(default=None, ge=0)
    notice_period_days: int | None = Field(default=None, ge=0)
    notes: str | None = None


class ContractComponentLink(BaseModel):
    component_id: int
```

- `ComponentRead` gains `yearly_run_cost: float | None = None`, `replacement_budget: float | None = None`, `contracts: list[ContractSummaryRead] = []` (define `ContractSummaryRead` ABOVE `ComponentRead` or rely on forward refs — place the contract schemas before the component block's end and reference normally). `ComponentCreate`/`ComponentUpdate` gain the two budget fields (`Field(default=None, ge=0)`).
- Router endpoints (prefix `/api/v1`, tags `["contracts"]`): `GET /products/{product_id}/contracts` (repo.list), `GET /contracts` (repo.list_all), `POST /contracts` (201), `GET/PATCH/DELETE /contracts/{contract_id}` (DELETE 204), `POST /contracts/{contract_id}/components` (201, returns ContractRead), `DELETE /contracts/{contract_id}/components/{component_id}` (200, returns ContractRead). Audit per Global Constraints; PATCH field-level over `_AUDIT_FIELDS = ("name", "contract_no", "start_date", "end_date", "yearly_cost", "notice_period_days", "notes")` with the `_s()` stringifier pattern from `components.py`, vendor detected by `vendor_id` / logged by name; link/unlink fetch the component name for the audit value (link BEFORE returns fine; unlink fetch BEFORE removal).

- [ ] **Step 1: Write the failing tests**

`backend/tests/catalog/test_contracts_api.py`:

```python
import pytest

from app.models import AuditEvent


@pytest.fixture()
def env(client, member_client):
    art_id = client.post("/api/v1/arts", json={"name": "ART"}).json()["id"]
    pid = client.post("/api/v1/products", json={"name": "Network", "art_id": art_id}).json()["id"]
    cid = member_client.post("/api/v1/components",
                             json={"name": "C9300", "product_id": pid}).json()["id"]
    return {"pid": pid, "cid": cid}


def test_contract_crud_any_user(member_client, env):
    r = member_client.post("/api/v1/contracts", json={
        "name": "SmartNet", "product_id": env["pid"], "vendor_name": "Cisco",
        "end_date": "2026-08-15", "yearly_cost": 15000, "notice_period_days": 60,
    })
    assert r.status_code == 201
    body = r.json()
    assert body["vendor_name"] == "Cisco"
    assert body["status"] in ("expiring", "expired")
    ctid = body["id"]
    listed = member_client.get(f"/api/v1/products/{env['pid']}/contracts").json()
    assert listed[0]["name"] == "SmartNet"
    r = member_client.patch(f"/api/v1/contracts/{ctid}", json={"end_date": None})
    assert r.json()["status"] == "active"
    assert member_client.delete(f"/api/v1/contracts/{ctid}").status_code == 204


def test_link_flow_and_component_read(member_client, env):
    ctid = member_client.post("/api/v1/contracts", json={
        "name": "SmartNet", "product_id": env["pid"], "end_date": "2020-01-01",
    }).json()["id"]
    r = member_client.post(f"/api/v1/contracts/{ctid}/components",
                           json={"component_id": env["cid"]})
    assert r.status_code == 201
    assert [c["name"] for c in r.json()["components"]] == ["C9300"]
    comp = member_client.get(f"/api/v1/components/{env['cid']}").json()
    assert comp["contracts"][0]["name"] == "SmartNet"
    assert comp["contracts"][0]["status"] == "expired"
    # component delete blocked while covered
    assert member_client.delete(f"/api/v1/components/{env['cid']}").status_code == 409
    r = member_client.delete(f"/api/v1/contracts/{ctid}/components/{env['cid']}")
    assert r.status_code == 200
    assert r.json()["components"] == []


def test_flat_list_sorted(member_client, env):
    member_client.post("/api/v1/contracts",
                       json={"name": "Evergreen", "product_id": env["pid"]})
    member_client.post("/api/v1/contracts", json={
        "name": "Dead", "product_id": env["pid"], "end_date": "2020-01-01"})
    rows = member_client.get("/api/v1/contracts").json()
    assert rows[0]["name"] == "Dead"
    assert rows[0]["status"] == "expired"
    assert rows[-1]["name"] == "Evergreen"


def test_component_budget_fields_api(member_client, env):
    r = member_client.patch(f"/api/v1/components/{env['cid']}",
                            json={"yearly_run_cost": 1200.5, "replacement_budget": 90000})
    assert r.json()["yearly_run_cost"] == 1200.5
    r = member_client.post("/api/v1/components", json={
        "name": "New", "product_id": env["pid"], "yearly_run_cost": 10})
    assert r.status_code == 201
    assert r.json()["yearly_run_cost"] == 10


def test_contract_update_field_level_audit(client, env, db_session):
    ctid = client.post("/api/v1/contracts", json={
        "name": "S", "product_id": env["pid"], "vendor_name": "Cisco",
        "yearly_cost": 100}).json()["id"]
    db_session.query(AuditEvent).filter_by(event_type="contract.updated").delete()
    client.patch(f"/api/v1/contracts/{ctid}", json={
        "vendor_name": "Juniper", "yearly_cost": 200, "name": "S"})
    events = db_session.query(AuditEvent).filter_by(event_type="contract.updated").all()
    by_field = {e.field: e for e in events}
    assert by_field["vendor"].old_value == "Cisco"
    assert by_field["vendor"].new_value == "Juniper"
    assert by_field["yearly_cost"].new_value == "200"
    assert "name" not in by_field
```

(If the `yearly_cost` audit stringification yields `"200.0"` instead of `"200"`, assert `float(by_field["yearly_cost"].new_value) == 200` instead — Numeric round-trips as float; keep the assertion robust.)

- [ ] **Step 2: RED** — 404s / missing schemas.
- [ ] **Step 3: Implement** schemas + `backend/app/routers/contracts.py` following `components.py` byte-for-byte in structure (imports, `_s()` helper reused inline, `check_writable` first, audit before single commit, `require_user` writes). Register in `main.py` (import + protected tuple).
- [ ] **Step 4: GREEN** — new tests + full `pytest` clean.
- [ ] **Step 5: Commit** — `git commit -m "feat(contracts): contracts API with link management and budget fields"`

---

### Task 5: Frontend types + client

**Files:**
- Modify: `frontend/src/types.ts`, `frontend/src/api/client.ts`
- Test: extend `frontend/src/api/client.test.ts` (existing `mockFetch(status, body)` idiom)

**Interfaces (produces):**

```ts
export type ContractStatus = "active" | "expiring" | "expired";

export interface ContractSummary {
  id: number;
  name: string;
  status: ContractStatus;
  end_date: string | null;
}

export interface ContractComponentRef {
  id: number;
  name: string;
  product_name: string | null;
}

export interface SupportContract {
  id: number;
  name: string;
  contract_no: string | null;
  product_id: number;
  product_name: string | null;
  vendor_id: number | null;
  vendor_name: string | null;
  start_date: string | null;
  end_date: string | null;
  yearly_cost: number | null;
  notice_period_days: number | null;
  notes: string | null;
  status: ContractStatus;
  components: ContractComponentRef[];
}
```

`Component` gains `yearly_run_cost: number | null; replacement_budget: number | null; contracts: ContractSummary[];` (and the component create/update payload types gain the two budget fields).

Client functions: `getProductContracts(productId): Promise<SupportContract[]>` → GET `${API}/products/${productId}/contracts`; `getContracts(): Promise<SupportContract[]>` → GET `${API}/contracts`; `createContract(payload)`: POST; `updateContract(id, changes)`: PATCH; `deleteContract(id)`: DELETE (void); `linkContractComponent(contractId, componentId): Promise<SupportContract>` → POST `${API}/contracts/${contractId}/components` body `{component_id}`; `unlinkContractComponent(contractId, componentId): Promise<SupportContract>` → DELETE `.../components/${componentId}`.

- [ ] **Step 1:** Failing client tests: `getProductContracts` URL; `createContract` URL+method+body; `updateContract` PATCH; `linkContractComponent` URL+method+body; `unlinkContractComponent` URL+method; `getContracts` URL.
- [ ] **Step 2: RED**, **Step 3:** implement, **Step 4: GREEN** + `npm run build`, **Step 5: Commit** — `feat(contracts): frontend types + client`.

---

### Task 6: Contracts tab + ContractDrawer + totals

**Files:**
- Create: `frontend/src/components/ContractDrawer.tsx`, `frontend/src/components/ContractBadge.tsx`
- Modify: `frontend/src/components/ProductDetail.tsx` (fourth tab "Contracts")
- Test: `frontend/src/components/ContractsTab.test.tsx`

**Interfaces:**
- `ContractBadge({ status }: { status: ContractStatus })` — nothing for `active`; `expiring` → `bg-amber-50 text-amber-700`; `expired` → `bg-red-50 text-red-700` (mirror RiskBadge.tsx exactly).
- `ContractDrawer({ contract, productId, onClose, onChanged })` — `contract: SupportContract | null` (create/edit). Fields: name, contract no., vendor (SearchableSelect `allowCreate` over `getVendors()` names, clear→null), start/end `<input type="date">`, yearly cost + notice-period `<input type="number">`, notes textarea — all aria-labeled ("Contract name", "Contract number", "Vendor", "Start date", "End date", "Yearly cost", "Notice period days", "Notes"). Edit mode only: linked-components section — rows `name (product_name)` + unlink button (`aria-label` `Unlink <name>`), add via SearchableSelect `ariaLabel="Link component"` over `getLifecycle()` options labeled `"Name (Product)"` excluding already-linked ids; link/unlink update local contract state from the returned SupportContract AND `await onChanged()`. PATCH sends only changed keys; create POSTs all fields. Delete behind ConfirmDialog; error strip; remount via `key={editing?.id ?? "new"}` in ProductDetail.
- ProductDetail: tab union gains `"contracts"`; tab row gains the pill; Contracts tab loads `getProductContracts(product.id)` lazily on first open (same pattern as components/systems); rows — name, vendor, end date (`?? "—"`), `ContractBadge`, yearly cost (right-aligned, `?? "—"`); "Add contract" button; row click → drawer. Totals footer below the list: `Contract costs / yr: Σ yearly_cost` (contracts), `Run costs / yr: Σ yearly_run_cost` (product's components — reuse the components list, loading it if not yet loaded when the Contracts tab opens), `Replacement budget: Σ replacement_budget`; render sums with `toLocaleString()`, show "—" when every input is null.

- [ ] **Step 1: Write the failing tests**

`frontend/src/components/ContractsTab.test.tsx` — copy the mock block from `ComponentsTab.test.tsx` and extend with `getProductContracts`, `getContracts`, `createContract`, `updateContract`, `deleteContract`, `linkContractComponent`, `unlinkContractComponent` mocks. Fixtures: `contract` (SupportContract, name "SmartNet", vendor "Cisco", end_date "2026-08-15", status "expiring", yearly_cost 15000, components: []); product per Task 9 of SP2's shape.

```tsx
it("lists contracts with status badge and totals", async () => {
  vi.mocked(getProductContracts).mockResolvedValue([contract]);
  vi.mocked(getProductComponents).mockResolvedValue([
    { ...comp, yearly_run_cost: 1200, replacement_budget: 90000 },
  ]);
  render(<ProductDetail product={product} onBack={() => {}} />);
  await userEvent.click(await screen.findByRole("button", { name: "Contracts" }));
  expect(await screen.findByText("SmartNet")).toBeInTheDocument();
  expect(screen.getByText("expiring")).toBeInTheDocument();
  expect(screen.getByText(/15’000|15,000/)).toBeInTheDocument();
  expect(screen.getByText(/1’200|1,200/)).toBeInTheDocument();
});

it("creates a contract through the drawer", async () => {
  vi.mocked(getProductContracts).mockResolvedValue([]);
  vi.mocked(createContract).mockResolvedValue(contract);
  render(<ProductDetail product={product} onBack={() => {}} />);
  await userEvent.click(await screen.findByRole("button", { name: "Contracts" }));
  await userEvent.click(await screen.findByRole("button", { name: "Add contract" }));
  await userEvent.type(screen.getByLabelText("Contract name"), "SmartNet");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(vi.mocked(createContract).mock.calls[0][0]).toMatchObject({
    name: "SmartNet", product_id: 1,
  });
});

it("links a component from the drawer", async () => {
  vi.mocked(getProductContracts).mockResolvedValue([contract]);
  vi.mocked(getLifecycle).mockResolvedValue([comp]);
  vi.mocked(linkContractComponent).mockResolvedValue({
    ...contract,
    components: [{ id: comp.id, name: comp.name, product_name: "Network" }],
  });
  render(<ProductDetail product={product} onBack={() => {}} />);
  await userEvent.click(await screen.findByRole("button", { name: "Contracts" }));
  await userEvent.click(await screen.findByText("SmartNet"));
  await userEvent.click(await screen.findByRole("combobox", { name: "Link component" }));
  await userEvent.click(screen.getByText("Catalyst 9300 (Network)"));
  expect(linkContractComponent).toHaveBeenCalledWith(7, 1);
});
```

(`contract.id` = 7 in the fixture; the number-format regex tolerates locale separators — keep it.)

- [ ] **Step 2: RED**, **Step 3:** implement per Interfaces, **Step 4: GREEN** — new + ALL existing FE tests + `npm run build`, **Step 5: Commit** — `feat(contracts): contracts tab, drawer with component links, totals`.

---

### Task 7: Component drawer — budget fields + read-only contracts

**Files:**
- Modify: `frontend/src/components/ComponentDrawer.tsx`
- Test: extend `frontend/src/components/ComponentsTab.test.tsx`

**Interfaces:**
- Two number inputs after Quantity: `aria-label "Yearly run cost"` / `"Replacement budget"`; empty → null; included in create payload and in PATCH only when changed (exact same diffing pattern as quantity).
- Edit mode only: read-only "Contracts" section under the dates — rows `name` + `ContractBadge` + end date (`?? "—"`); empty → "None" muted row; sourced from `component.contracts` (no fetch).

- [ ] **Step 1:** Failing tests: (a) edit drawer shows the contract list with badge (extend fixture `comp` with `contracts: [{id: 7, name: "SmartNet", status: "expired", end_date: "2020-01-01"}]`); (b) editing "Yearly run cost" and saving PATCHes `yearly_run_cost`; unchanged budget fields stay OUT of the payload (assert via `mock.calls.at(-1)[1]`).
- [ ] **Step 2: RED**, **Step 3:** implement, **Step 4: GREEN** + build + full suite, **Step 5: Commit** — `feat(contracts): component budget fields + read-only contract list in drawer`.

---

### Task 8: Contracts view + navigation

**Files:**
- Create: `frontend/src/components/ContractsView.tsx`
- Modify: `frontend/src/App.tsx` (View union + nav + branch)
- Test: `frontend/src/components/ContractsView.test.tsx`

**Interfaces:**
- `<ContractsView />` self-contained, mirrors `LifecycleView.tsx` structurally: loads `getContracts()` (server-sorted — no client re-sort), `loading` state before empty state ("No contracts yet. Add them on a product's Contracts tab."), filter bar with FilterSelect "Product" (distinct product_names) + pill "Only expiring or expired" (`status !== "active"`), table columns Contract / Product / Vendor / End date / Status / Yearly cost — Status renders `ContractBadge` or "—" for active; End date/Vendor/cost `?? "—"`, cost via `toLocaleString()`.
- App.tsx: View union + `"contracts"`; `{navButton("contracts", "Contracts")}` after Lifecycle; branch `view === "contracts" ? <ContractsView /> : ...`.

- [ ] **Step 1:** Failing tests (mirror LifecycleView.test.tsx): renders rows incl. badge + dash-for-active; "Only expiring or expired" filter hides active rows; loading state (never-resolving promise → "Loading…" and no empty-state text via full-string query).
- [ ] **Step 2: RED**, **Step 3:** implement, **Step 4: GREEN** + build + full suite, **Step 5: Commit** — `feat(contracts): cross-product Contracts view + navigation`.

---

### Task 9: Full verification + docs

**Files:**
- Modify: `CLAUDE.md` (migration head → `0028`; catalog bullet gains support contracts + budget; views seven → eight, adding Contracts)

**Steps:**

- [ ] **Step 1:** Full suites (backend `pytest`, frontend `npm run test` + `npm run build`) — green (frontend judged by counts; known App.auth flake).
- [ ] **Step 2:** Rebuild + verify stack: FA token export (never echo), `docker compose build backend frontend && docker compose up -d`; alembic at `0028`. Playwright walkthrough: on the "Network" product create component "C9300" (if absent) with run cost 1200 / replacement 90000 → Contracts tab → add contract "SmartNet" (vendor Cisco, end date next month, notice 90, cost 15000) → status badge expiring; drawer: link C9300; component drawer shows the read-only contract row; Contracts view lists it sorted with badges, filters work; component delete while covered → 409 in error strip; dark mode check; delete all demo data (unlink first), leave pre-existing rows + vendor rows.
- [ ] **Step 3:** Update CLAUDE.md; commit `docs: support contracts + migration head 0028`.
- [ ] **Step 4:** Finish with superpowers:finishing-a-development-branch.
