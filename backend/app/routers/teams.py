from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.audit import log_event
from app.auth import require_admin
from app.db import get_db
from app.models import Item, Team, TeamMember, User
from app.schemas import TeamCreate, TeamRead, TeamUpdate

router = APIRouter(prefix="/api/teams", tags=["teams"])


@router.get("", response_model=list[TeamRead])
def list_teams(db: Session = Depends(get_db)) -> list[Team]:
    return list(db.scalars(select(Team).order_by(Team.name)))


@router.post("", response_model=TeamRead, status_code=201, dependencies=[Depends(require_admin)])
def create_team(
    payload: TeamCreate,
    db: Session = Depends(get_db),
    current: User = Depends(require_admin),
) -> Team:
    if db.scalar(select(Team).where(Team.name == payload.name)):
        raise HTTPException(status_code=409, detail="Team already exists")
    team = Team(name=payload.name)
    db.add(team)
    db.flush()
    log_event(db, actor=current, event_type="team.created", entity_type="team",
              entity_id=team.id, entity_label=team.name)
    db.commit()
    db.refresh(team)
    return team


@router.patch("/{team_id}", response_model=TeamRead, dependencies=[Depends(require_admin)])
def rename_team(
    team_id: int,
    payload: TeamUpdate,
    db: Session = Depends(get_db),
    current: User = Depends(require_admin),
) -> Team:
    team = db.get(Team, team_id)
    if team is None:
        raise HTTPException(status_code=404, detail="Team not found")
    if payload.name == team.name:
        return team
    if db.scalar(select(Team).where(Team.name == payload.name, Team.id != team_id)):
        raise HTTPException(status_code=409, detail="Team already exists")
    old = team.name
    team.name = payload.name
    for column in (Item.leading_team, Item.supporting_team):
        db.execute(
            update(Item)
            .where(column == old)
            .values({column.key: payload.name})
            .execution_options(synchronize_session=False)
        )
    log_event(db, actor=current, event_type="team.renamed", entity_type="team",
              entity_id=team.id, entity_label=team.name,
              field="name", old_value=old, new_value=team.name)
    db.commit()
    db.refresh(team)
    return team


@router.delete("/{team_id}", status_code=204, dependencies=[Depends(require_admin)])
def delete_team(
    team_id: int,
    force: bool = False,
    db: Session = Depends(get_db),
    current: User = Depends(require_admin),
) -> None:
    team = db.get(Team, team_id)
    if team is None:
        raise HTTPException(status_code=404, detail="Team not found")
    if not force:
        used = db.scalar(
            select(func.count())
            .select_from(Item)
            .where((Item.leading_team == team.name) | (Item.supporting_team == team.name))
        )
        if used:
            raise HTTPException(
                status_code=409,
                detail=f"Team '{team.name}' is referenced by {used} items",
            )
    # Detach members explicitly (DB also enforces ON DELETE SET NULL).
    for member in db.scalars(select(TeamMember).where(TeamMember.team_id == team_id)):
        member.team_id = None
    log_event(db, actor=current, event_type="team.deleted", entity_type="team",
              entity_id=team.id, entity_label=team.name)
    db.delete(team)
    db.commit()
