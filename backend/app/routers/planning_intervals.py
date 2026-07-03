from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.audit import log_event
from app.auth import require_admin
from app.db import get_db
from app.models import Capacity, Container, Item, PlanningInterval, Team, User
from app.routers.containers import add_default_containers, remove_containers_of
from app.schemas import PlanningIntervalCreate, PlanningIntervalRead, PlanningIntervalUpdate

router = APIRouter(prefix="/api/v1/planning-intervals", tags=["planning-intervals"])


@router.get("", response_model=list[PlanningIntervalRead])
def list_planning_intervals(db: Session = Depends(get_db)) -> list[PlanningInterval]:
    return list(
        db.scalars(select(PlanningInterval).order_by(PlanningInterval.position, PlanningInterval.name))
    )


@router.post("", response_model=PlanningIntervalRead, status_code=201, dependencies=[Depends(require_admin)])
def create_planning_interval(
    payload: PlanningIntervalCreate,
    db: Session = Depends(get_db),
    current: User = Depends(require_admin),
) -> PlanningInterval:
    if db.scalar(select(PlanningInterval).where(PlanningInterval.name == payload.name)):
        raise HTTPException(status_code=409, detail="Planning interval already exists")
    max_pos = db.scalar(select(func.max(PlanningInterval.position)))
    pi = PlanningInterval(name=payload.name, position=(max_pos or 0) + 1)
    db.add(pi)
    db.flush()
    log_event(db, actor=current, event_type="planning_interval.created", entity_type="planning_interval",
              entity_id=pi.id, entity_label=pi.name)
    add_default_containers(
        db, actor=current,
        teams=list(db.scalars(select(Team))),
        planning_intervals=[pi.name],
    )
    db.commit()
    db.refresh(pi)
    return pi


@router.patch("/{pi_id}", response_model=PlanningIntervalRead, dependencies=[Depends(require_admin)])
def rename_planning_interval(
    pi_id: int,
    payload: PlanningIntervalUpdate,
    db: Session = Depends(get_db),
    current: User = Depends(require_admin),
) -> PlanningInterval:
    pi = db.get(PlanningInterval, pi_id)
    if pi is None:
        raise HTTPException(status_code=404, detail="Planning interval not found")
    if payload.name == pi.name:
        return pi
    if db.scalar(select(PlanningInterval).where(PlanningInterval.name == payload.name, PlanningInterval.id != pi_id)):
        raise HTTPException(status_code=409, detail="Planning interval already exists")
    old = pi.name
    pi.name = payload.name
    db.execute(
        update(Item)
        .where(Item.planning_interval == old)
        .values(planning_interval=payload.name)
        .execution_options(synchronize_session=False)
    )
    db.execute(
        update(Capacity)
        .where(Capacity.planning_interval == old)
        .values(planning_interval=payload.name)
        .execution_options(synchronize_session=False)
    )
    db.execute(
        update(Container)
        .where(Container.planning_interval == old)
        .values(planning_interval=payload.name)
        .execution_options(synchronize_session=False)
    )
    log_event(db, actor=current, event_type="planning_interval.renamed", entity_type="planning_interval",
              entity_id=pi.id, entity_label=pi.name,
              field="name", old_value=old, new_value=pi.name)
    db.commit()
    db.refresh(pi)
    return pi


@router.delete("/{pi_id}", status_code=204, dependencies=[Depends(require_admin)])
def delete_planning_interval(
    pi_id: int,
    force: bool = False,
    db: Session = Depends(get_db),
    current: User = Depends(require_admin),
) -> None:
    pi = db.get(PlanningInterval, pi_id)
    if pi is None:
        raise HTTPException(status_code=404, detail="Planning interval not found")
    if not force:
        items_used = db.scalar(
            select(func.count()).select_from(Item).where(Item.planning_interval == pi.name)
        )
        caps_used = db.scalar(
            select(func.count()).select_from(Capacity).where(Capacity.planning_interval == pi.name)
        )
        if items_used or caps_used:
            raise HTTPException(
                status_code=409,
                detail=(
                    f"Planning interval '{pi.name}' is used by {items_used} items "
                    f"and {caps_used} capacity entries"
                ),
            )
    log_event(db, actor=current, event_type="planning_interval.deleted", entity_type="planning_interval",
              entity_id=pi.id, entity_label=pi.name)
    # Containers are scope-bound to the PI: remove them (clearing items'
    # container_id). They deliberately don't count toward the delete guard —
    # auto-creation means every PI always has containers.
    remove_containers_of(db, planning_interval=pi.name)
    db.delete(pi)
    db.commit()
