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
