from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import require_admin
from app.db import get_db
from app.models import Team, TeamMember
from app.schemas import TeamCreate, TeamRead

router = APIRouter(prefix="/api/teams", tags=["teams"])


@router.get("", response_model=list[TeamRead])
def list_teams(db: Session = Depends(get_db)) -> list[Team]:
    return list(db.scalars(select(Team).order_by(Team.name)))


@router.post("", response_model=TeamRead, status_code=201, dependencies=[Depends(require_admin)])
def create_team(payload: TeamCreate, db: Session = Depends(get_db)) -> Team:
    if db.scalar(select(Team).where(Team.name == payload.name)):
        raise HTTPException(status_code=409, detail="Team already exists")
    team = Team(name=payload.name)
    db.add(team)
    db.commit()
    db.refresh(team)
    return team


@router.delete("/{team_id}", status_code=204, dependencies=[Depends(require_admin)])
def delete_team(team_id: int, db: Session = Depends(get_db)) -> None:
    team = db.get(Team, team_id)
    if team is None:
        raise HTTPException(status_code=404, detail="Team not found")
    # Detach members explicitly (DB also enforces ON DELETE SET NULL).
    for member in db.scalars(select(TeamMember).where(TeamMember.team_id == team_id)):
        member.team_id = None
    db.delete(team)
    db.commit()
