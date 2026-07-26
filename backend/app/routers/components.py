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
                 "eos_announced", "end_of_sale", "end_of_support", "end_of_life",
                 "yearly_run_cost", "replacement_budget")


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
