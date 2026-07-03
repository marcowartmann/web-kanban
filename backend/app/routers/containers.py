from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.audit import log_event
from app.auth import require_admin
from app.db import get_db
from app.models import Container, Item, PlanningInterval, Team, User
from app.schemas import ContainerCreate, ContainerRead, ContainerUpdate

router = APIRouter(prefix="/api/v1/containers", tags=["containers"])

DEFAULT_CONTAINER_NAMES = ("Operations", "Local Items", "Strategic Items")


def _container_label(container: Container, team_name: str) -> str:
    return f"{container.name} ({team_name} · {container.planning_interval})"


def add_default_containers(
    db: Session, *, actor: User, teams: list[Team], planning_intervals: list[str]
) -> None:
    """Add the default containers for every (team, PI) pair and audit each.
    Flushes (for ids) but does not commit — the caller owns the transaction."""
    for team in teams:
        for pi in planning_intervals:
            for name in DEFAULT_CONTAINER_NAMES:
                container = Container(name=name, planning_interval=pi, team_id=team.id)
                db.add(container)
                db.flush()
                log_event(
                    db, actor=actor, event_type="container.created",
                    entity_type="container", entity_id=container.id,
                    entity_label=_container_label(container, team.name),
                )


def remove_containers_of(db: Session, *, team_id: int | None = None,
                         planning_interval: str | None = None) -> None:
    """Delete a team's or a PI's containers, clearing container_id on their
    items first (explicit — SQLite tests don't enforce FK actions)."""
    scope = select(Container.id)
    if team_id is not None:
        scope = scope.where(Container.team_id == team_id)
    if planning_interval is not None:
        scope = scope.where(Container.planning_interval == planning_interval)
    db.execute(
        update(Item)
        .where(Item.container_id.in_(scope))
        .values(container_id=None)
        .execution_options(synchronize_session=False)
    )
    for container in db.scalars(select(Container).where(Container.id.in_(scope))):
        db.delete(container)


@router.get("", response_model=list[ContainerRead])
def list_containers(db: Session = Depends(get_db)) -> list[Container]:
    return list(
        db.scalars(
            select(Container).order_by(
                Container.planning_interval, Container.team_id, Container.name
            )
        )
    )


@router.post("", response_model=ContainerRead, status_code=201, dependencies=[Depends(require_admin)])
def create_container(
    payload: ContainerCreate,
    db: Session = Depends(get_db),
    current: User = Depends(require_admin),
) -> Container:
    team = db.get(Team, payload.team_id)
    if team is None:
        raise HTTPException(status_code=422, detail="team_id does not exist")
    if not db.scalar(select(PlanningInterval).where(PlanningInterval.name == payload.planning_interval)):
        raise HTTPException(status_code=422, detail="planning_interval does not exist")
    if db.scalar(
        select(Container).where(
            Container.team_id == payload.team_id,
            Container.planning_interval == payload.planning_interval,
            Container.name == payload.name,
        )
    ):
        raise HTTPException(status_code=409, detail="Container already exists for this team and planning interval")
    container = Container(**payload.model_dump())
    db.add(container)
    db.flush()
    log_event(db, actor=current, event_type="container.created", entity_type="container",
              entity_id=container.id, entity_label=_container_label(container, team.name))
    db.commit()
    db.refresh(container)
    return container


@router.patch("/{container_id}", response_model=ContainerRead, dependencies=[Depends(require_admin)])
def rename_container(
    container_id: int,
    payload: ContainerUpdate,
    db: Session = Depends(get_db),
    current: User = Depends(require_admin),
) -> Container:
    container = db.get(Container, container_id)
    if container is None:
        raise HTTPException(status_code=404, detail="Container not found")
    if payload.name == container.name:
        return container
    if db.scalar(
        select(Container).where(
            Container.team_id == container.team_id,
            Container.planning_interval == container.planning_interval,
            Container.name == payload.name,
            Container.id != container_id,
        )
    ):
        raise HTTPException(status_code=409, detail="Container already exists for this team and planning interval")
    old = container.name
    container.name = payload.name
    log_event(db, actor=current, event_type="container.renamed", entity_type="container",
              entity_id=container.id,
              entity_label=_container_label(container, container.team.name),
              field="name", old_value=old, new_value=container.name)
    db.commit()
    db.refresh(container)
    return container


@router.delete("/{container_id}", status_code=204, dependencies=[Depends(require_admin)])
def delete_container(
    container_id: int,
    force: bool = False,
    db: Session = Depends(get_db),
    current: User = Depends(require_admin),
) -> None:
    container = db.get(Container, container_id)
    if container is None:
        raise HTTPException(status_code=404, detail="Container not found")
    used = db.scalar(
        select(func.count()).select_from(Item).where(Item.container_id == container_id)
    )
    if used and not force:
        raise HTTPException(
            status_code=409,
            detail=f"Container '{container.name}' is used by {used} items",
        )
    if used:
        db.execute(
            update(Item)
            .where(Item.container_id == container_id)
            .values(container_id=None)
            .execution_options(synchronize_session=False)
        )
    log_event(db, actor=current, event_type="container.deleted", entity_type="container",
              entity_id=container.id,
              entity_label=_container_label(container, container.team.name))
    db.delete(container)
    db.commit()
