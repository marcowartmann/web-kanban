"""Catalog bounded context — pure domain layer.

No SQLAlchemy or FastAPI imports here: these dataclasses are what the
repository ports (app/catalog/ports.py) traffic in, regardless of whether
the backing store is Postgres or, later, an external API (ServiceNow,
LeanIX, Jira)."""
from __future__ import annotations

import enum
from collections.abc import Iterable
from dataclasses import dataclass, field
from datetime import date, timedelta


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
    yearly_run_cost: float | None = None
    replacement_budget: float | None = None
    # read-side enrichments filled by adapters
    vendor_name: str | None = None
    product_name: str | None = None
    risk: RiskLevel = RiskLevel.OK
    contracts: list["ContractSummary"] = field(default_factory=list)


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
