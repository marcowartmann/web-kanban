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
    before = repo.get(service_id)
    changes = payload.model_dump(exclude_unset=True)
    service = repo.update(service_id, changes)

    # Change detection is gated on the underlying id — two different owners
    # (or parents) can share a display name, and comparing names would then
    # silently swallow a real FK change. The resolved names are still what
    # gets logged, since ids mean nothing to a human reading the audit log.
    for key, field, changed, old_value, new_value in (
        ("name", "name", before.name != service.name, before.name, service.name),
        ("description", "description", before.description != service.description,
         before.description, service.description),
        ("owner_user_id", "owner", before.owner_user_id != service.owner_user_id,
         before.owner_name, service.owner_name),
        ("lifecycle_state", "lifecycle_state",
         before.lifecycle_state != service.lifecycle_state,
         before.lifecycle_state.value, service.lifecycle_state.value),
    ):
        if key not in changes or not changed:
            continue
        log_event(db, actor=current, event_type="service.updated", entity_type="service",
                  entity_id=service.id, entity_label=service.name,
                  field=field, old_value=old_value, new_value=new_value)

    if "parent_service_id" in changes and before.parent_service_id != service.parent_service_id:
        # Old parent id relies on the child-delete guard (a service with
        # children can't be deleted) to still be resolvable here.
        old_parent = repo.get(before.parent_service_id).name if before.parent_service_id else None
        new_parent = repo.get(service.parent_service_id).name if service.parent_service_id else None
        log_event(db, actor=current, event_type="service.updated", entity_type="service",
                  entity_id=service.id, entity_label=service.name,
                  field="parent", old_value=old_parent, new_value=new_parent)

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
