from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.audit import log_event
from app.auth import require_admin
from app.db import get_db
from app.models import Item, Team, TeamMember, User
from app.schemas import TeamMemberCreate, TeamMemberRead, TeamMemberUpdate

router = APIRouter(prefix="/api/v1/team-members", tags=["team-members"])


def _to_read(member: TeamMember) -> TeamMemberRead:
    return TeamMemberRead(
        id=member.id,
        name=member.name,
        team_id=member.team_id,
        team_name=member.team.name if member.team else None,
    )


@router.get("", response_model=list[TeamMemberRead])
def list_members(db: Session = Depends(get_db)) -> list[TeamMemberRead]:
    members = db.scalars(select(TeamMember).order_by(TeamMember.name))
    return [_to_read(m) for m in members]


@router.post("", response_model=TeamMemberRead, status_code=201, dependencies=[Depends(require_admin)])
def create_member(
    payload: TeamMemberCreate,
    db: Session = Depends(get_db),
    current: User = Depends(require_admin),
) -> TeamMemberRead:
    if payload.team_id is not None and db.get(Team, payload.team_id) is None:
        raise HTTPException(status_code=422, detail="team_id does not exist")
    if db.scalar(select(TeamMember).where(TeamMember.name == payload.name)):
        raise HTTPException(status_code=409, detail="Member already exists")
    member = TeamMember(name=payload.name, team_id=payload.team_id)
    db.add(member)
    db.flush()
    log_event(db, actor=current, event_type="team_member.created", entity_type="team_member",
              entity_id=member.id, entity_label=member.name)
    db.commit()
    db.refresh(member)
    return _to_read(member)


@router.patch("/{member_id}", response_model=TeamMemberRead, dependencies=[Depends(require_admin)])
def rename_member(
    member_id: int,
    payload: TeamMemberUpdate,
    db: Session = Depends(get_db),
    current: User = Depends(require_admin),
) -> TeamMemberRead:
    member = db.get(TeamMember, member_id)
    if member is None:
        raise HTTPException(status_code=404, detail="Member not found")
    if payload.name == member.name:
        return _to_read(member)
    if db.scalar(select(TeamMember).where(TeamMember.name == payload.name, TeamMember.id != member_id)):
        raise HTTPException(status_code=409, detail="Member already exists")
    old = member.name
    member.name = payload.name
    db.execute(
        update(Item)
        .where(Item.assignee == old)
        .values(assignee=payload.name)
        .execution_options(synchronize_session=False)
    )
    log_event(db, actor=current, event_type="team_member.renamed", entity_type="team_member",
              entity_id=member.id, entity_label=member.name,
              field="name", old_value=old, new_value=member.name)
    db.commit()
    db.refresh(member)
    return _to_read(member)


@router.delete("/{member_id}", status_code=204, dependencies=[Depends(require_admin)])
def delete_member(
    member_id: int,
    force: bool = False,
    db: Session = Depends(get_db),
    current: User = Depends(require_admin),
) -> None:
    member = db.get(TeamMember, member_id)
    if member is None:
        raise HTTPException(status_code=404, detail="Member not found")
    if not force:
        used = db.scalar(
            select(func.count()).select_from(Item).where(Item.assignee == member.name)
        )
        if used:
            raise HTTPException(
                status_code=409,
                detail=f"Member '{member.name}' is assigned to {used} items",
            )
    log_event(db, actor=current, event_type="team_member.deleted", entity_type="team_member",
              entity_id=member.id, entity_label=member.name)
    db.delete(member)
    db.commit()
