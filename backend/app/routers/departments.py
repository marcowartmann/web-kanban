from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.audit import log_event
from app.auth import require_admin
from app.db import get_db
from app.models import Team, TeamDepartment, User
from app.schemas import DepartmentCreate, DepartmentMembers, DepartmentRead, DepartmentRename

router = APIRouter(prefix="/api/v1/departments", tags=["departments"],
                   dependencies=[Depends(require_admin)])


def _get(db: Session, dep_id: int) -> TeamDepartment:
    dep = db.get(TeamDepartment, dep_id)
    if dep is None:
        raise HTTPException(status_code=404, detail="Department not found")
    return dep


@router.get("", response_model=list[DepartmentRead])
def list_departments(db: Session = Depends(get_db)) -> list[TeamDepartment]:
    return list(db.scalars(
        select(TeamDepartment).order_by(TeamDepartment.team_id, TeamDepartment.name)
    ))


@router.post("", response_model=DepartmentRead, status_code=201)
def create_department(
    payload: DepartmentCreate,
    db: Session = Depends(get_db),
    current: User = Depends(require_admin),
) -> TeamDepartment:
    if db.get(Team, payload.team_id) is None:
        raise HTTPException(status_code=422, detail="team_id does not exist")
    if db.scalar(select(TeamDepartment).where(
        TeamDepartment.team_id == payload.team_id, TeamDepartment.name == payload.name
    )):
        raise HTTPException(status_code=409, detail="Department already exists in this team")
    dep = TeamDepartment(name=payload.name, team_id=payload.team_id)
    db.add(dep)
    db.flush()
    log_event(db, actor=current, event_type="department.created", entity_type="department",
              entity_id=dep.id, entity_label=dep.name)
    db.commit()
    db.refresh(dep)
    return dep


@router.patch("/{dep_id}", response_model=DepartmentRead)
def rename_department(
    dep_id: int,
    payload: DepartmentRename,
    db: Session = Depends(get_db),
    current: User = Depends(require_admin),
) -> TeamDepartment:
    dep = _get(db, dep_id)
    if payload.name != dep.name and db.scalar(select(TeamDepartment).where(
        TeamDepartment.team_id == dep.team_id,
        TeamDepartment.name == payload.name,
        TeamDepartment.id != dep.id,
    )):
        raise HTTPException(status_code=409, detail="Department already exists in this team")
    old = dep.name
    dep.name = payload.name
    log_event(db, actor=current, event_type="department.updated", entity_type="department",
              entity_id=dep.id, entity_label=dep.name, field="name", old_value=old, new_value=dep.name)
    db.commit()
    db.refresh(dep)
    return dep


@router.delete("/{dep_id}", status_code=204)
def delete_department(
    dep_id: int,
    db: Session = Depends(get_db),
    current: User = Depends(require_admin),
) -> None:
    dep = _get(db, dep_id)
    log_event(db, actor=current, event_type="department.deleted", entity_type="department",
              entity_id=dep.id, entity_label=dep.name)
    db.delete(dep)
    db.commit()


@router.put("/{dep_id}/members", response_model=DepartmentRead)
def set_members(
    dep_id: int,
    payload: DepartmentMembers,
    db: Session = Depends(get_db),
    current: User = Depends(require_admin),
) -> TeamDepartment:
    dep = _get(db, dep_id)
    members = []
    for uid in payload.user_ids:
        user = db.get(User, uid)
        if user is None:
            raise HTTPException(status_code=422, detail=f"user {uid} does not exist")
        members.append(user)
    dep.members = members
    log_event(db, actor=current, event_type="department.members_changed",
              entity_type="department", entity_id=dep.id, entity_label=dep.name)
    db.commit()
    db.refresh(dep)
    return dep
