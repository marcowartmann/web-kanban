"""Postgres adapter for the catalog bounded context (SQLAlchemy)."""
from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app import models as m
from app.catalog import domain
from app.catalog.domain import (
    CatalogInUse,
    CatalogNotFound,
    CatalogRuleViolation,
    Criticality,
    DependencyType,
    LifecycleState,
)


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
