from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Capacity, TeamMember
from app.schemas import CapacityRead, CapacityUpsert

router = APIRouter(prefix="/api/capacities", tags=["capacities"])


@router.get("", response_model=list[CapacityRead])
def list_capacities(db: Session = Depends(get_db)) -> list[Capacity]:
    return list(db.scalars(select(Capacity)))


@router.put("", response_model=CapacityRead)
def upsert_capacity(payload: CapacityUpsert, db: Session = Depends(get_db)) -> Capacity:
    if db.get(TeamMember, payload.member_id) is None:
        raise HTTPException(status_code=422, detail="member_id does not exist")
    row = db.scalar(
        select(Capacity).where(
            Capacity.member_id == payload.member_id,
            Capacity.planning_interval == payload.planning_interval,
            Capacity.iteration == payload.iteration,
        )
    )
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
    db.commit()
    db.refresh(row)
    return row
