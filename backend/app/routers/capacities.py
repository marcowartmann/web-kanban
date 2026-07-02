from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.audit import log_event
from app.auth import require_admin
from app.db import get_db
from app.models import Capacity, TeamMember, User
from app.schemas import CapacityRead, CapacityUpsert

router = APIRouter(prefix="/api/v1/capacities", tags=["capacities"])


@router.get("", response_model=list[CapacityRead])
def list_capacities(db: Session = Depends(get_db)) -> list[Capacity]:
    return list(db.scalars(select(Capacity)))


@router.put("", response_model=CapacityRead, dependencies=[Depends(require_admin)])
def upsert_capacity(
    payload: CapacityUpsert,
    db: Session = Depends(get_db),
    current: User = Depends(require_admin),
) -> Capacity:
    member = db.get(TeamMember, payload.member_id)
    if member is None:
        raise HTTPException(status_code=422, detail="member_id does not exist")
    row = db.scalar(
        select(Capacity).where(
            Capacity.member_id == payload.member_id,
            Capacity.planning_interval == payload.planning_interval,
            Capacity.iteration == payload.iteration,
        )
    )
    old_points = None if row is None else row.points
    if row is None:
        row = Capacity(
            member_id=payload.member_id,
            planning_interval=payload.planning_interval,
            iteration=payload.iteration,
            points=payload.points,
        )
        db.add(row)
    else:
        row.points = payload.points
    db.flush()
    log_event(
        db,
        actor=current,
        event_type="capacity.set",
        entity_type="capacity",
        entity_id=row.id,
        entity_label=f"{member.name} · {payload.planning_interval} · I{payload.iteration}",
        field="points",
        old_value=old_points,
        new_value=payload.points,
    )
    db.commit()
    db.refresh(row)
    return row
