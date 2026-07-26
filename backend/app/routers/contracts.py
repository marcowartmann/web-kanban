from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.audit import log_event
from app.auth import require_user
from app.catalog import ports
from app.catalog.factory import get_contract_repo
from app.catalog.http import check_writable
from app.db import get_db
from app.models import User
from app.schemas import ContractComponentLink, ContractCreate, ContractRead, ContractUpdate

router = APIRouter(prefix="/api/v1", tags=["contracts"])

# Fields whose old/new values are logged by simple value comparison. The
# vendor is handled separately (detected by id, logged by name).
_AUDIT_FIELDS = ("name", "contract_no", "start_date", "end_date",
                 "yearly_cost", "notice_period_days", "notes")


def _s(value) -> str | None:
    if value is None:
        return None
    if hasattr(value, "value"):
        return value.value
    return str(value)


@router.get("/products/{product_id}/contracts", response_model=list[ContractRead])
def product_contracts(
    product_id: int,
    repo: ports.ContractRepository = Depends(get_contract_repo),
):
    return repo.list(product_id)


@router.get("/contracts", response_model=list[ContractRead])
def list_contracts(repo: ports.ContractRepository = Depends(get_contract_repo)):
    return repo.list_all()


@router.post("/contracts", response_model=ContractRead, status_code=201)
def create_contract(
    payload: ContractCreate,
    repo: ports.ContractRepository = Depends(get_contract_repo),
    db: Session = Depends(get_db),
    current: User = Depends(require_user),
):
    check_writable(repo)
    contract = repo.create(**payload.model_dump())
    log_event(db, actor=current, event_type="contract.created", entity_type="contract",
              entity_id=contract.id, entity_label=contract.name)
    db.commit()
    return contract


@router.get("/contracts/{contract_id}", response_model=ContractRead)
def get_contract(contract_id: int,
                 repo: ports.ContractRepository = Depends(get_contract_repo)):
    return repo.get(contract_id)


@router.patch("/contracts/{contract_id}", response_model=ContractRead)
def update_contract(
    contract_id: int,
    payload: ContractUpdate,
    repo: ports.ContractRepository = Depends(get_contract_repo),
    db: Session = Depends(get_db),
    current: User = Depends(require_user),
):
    check_writable(repo)
    before = repo.get(contract_id)
    changes = payload.model_dump(exclude_unset=True)
    contract = repo.update(contract_id, changes)
    for key in _AUDIT_FIELDS:
        if key in changes:
            old, new = getattr(before, key), getattr(contract, key)
            if old != new:
                log_event(db, actor=current, event_type="contract.updated",
                          entity_type="contract", entity_id=contract.id,
                          entity_label=contract.name, field=key,
                          old_value=_s(old), new_value=_s(new))
    # vendor: detect by id, log by name — ids mean nothing in the log.
    if "vendor_name" in changes and before.vendor_id != contract.vendor_id:
        log_event(db, actor=current, event_type="contract.updated",
                  entity_type="contract", entity_id=contract.id,
                  entity_label=contract.name, field="vendor",
                  old_value=before.vendor_name, new_value=contract.vendor_name)
    db.commit()
    return contract


@router.delete("/contracts/{contract_id}", status_code=204)
def delete_contract(
    contract_id: int,
    repo: ports.ContractRepository = Depends(get_contract_repo),
    db: Session = Depends(get_db),
    current: User = Depends(require_user),
):
    check_writable(repo)
    contract = repo.get(contract_id)
    repo.delete(contract_id)
    log_event(db, actor=current, event_type="contract.deleted", entity_type="contract",
              entity_id=contract_id, entity_label=contract.name)
    db.commit()


@router.post("/contracts/{contract_id}/components", response_model=ContractRead, status_code=201)
def link_component(
    contract_id: int,
    payload: ContractComponentLink,
    repo: ports.ContractRepository = Depends(get_contract_repo),
    db: Session = Depends(get_db),
    current: User = Depends(require_user),
):
    check_writable(repo)
    contract = repo.link_component(contract_id, payload.component_id)
    component_name = next(
        (c.name for c in contract.components if c.id == payload.component_id), None
    )
    log_event(db, actor=current, event_type="contract.component_linked",
              entity_type="contract", entity_id=contract.id, entity_label=contract.name,
              field="component", new_value=component_name)
    db.commit()
    return contract


@router.delete("/contracts/{contract_id}/components/{component_id}", response_model=ContractRead)
def unlink_component(
    contract_id: int,
    component_id: int,
    repo: ports.ContractRepository = Depends(get_contract_repo),
    db: Session = Depends(get_db),
    current: User = Depends(require_user),
):
    check_writable(repo)
    before = repo.get(contract_id)
    component_name = next(
        (c.name for c in before.components if c.id == component_id), None
    )
    contract = repo.unlink_component(contract_id, component_id)
    log_event(db, actor=current, event_type="contract.component_unlinked",
              entity_type="contract", entity_id=contract.id, entity_label=contract.name,
              field="component", old_value=component_name)
    db.commit()
    return contract
