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
