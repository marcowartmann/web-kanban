from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.audit import log_event
from app.auth import require_admin
from app.db import get_db
from app.models import PlanningInterval, User
from app.schemas import PlanningIntervalCreate, PlanningIntervalRead

router = APIRouter(prefix="/api/planning-intervals", tags=["planning-intervals"])


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
    db.commit()
    db.refresh(pi)
    return pi


@router.delete("/{pi_id}", status_code=204, dependencies=[Depends(require_admin)])
def delete_planning_interval(
    pi_id: int,
    db: Session = Depends(get_db),
    current: User = Depends(require_admin),
) -> None:
    pi = db.get(PlanningInterval, pi_id)
    if pi is None:
        raise HTTPException(status_code=404, detail="Planning interval not found")
    log_event(db, actor=current, event_type="planning_interval.deleted", entity_type="planning_interval",
              entity_id=pi.id, entity_label=pi.name)
    db.delete(pi)
    db.commit()
