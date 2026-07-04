from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.audit import log_event
from app.auth import require_user
from app.db import get_db
from app.models import Item, ItemKind, ObjectiveState, PIObjective, PlanningInterval, Team, User
from app.pi_objectives import normalize_key_delivery
from app.schemas import (
    FeatureLinkRequest,
    PIObjectiveCreate,
    PIObjectiveRead,
    PIObjectiveUpdate,
)

router = APIRouter(prefix="/api/v1/pi-objectives", tags=["pi-objectives"])


def _require_team(user: User, team_id: int) -> None:
    if user.role != "admin" and user.team_id != team_id:
        raise HTTPException(
            status_code=403, detail="You can only manage your own team's objectives"
        )


def _serialize(obj: PIObjective) -> PIObjectiveRead:
    return PIObjectiveRead(
        id=obj.id,
        team_id=obj.team_id,
        team_name=obj.team_name,
        planning_interval=obj.planning_interval_name,
        title=obj.title,
        description=obj.description,
        state=obj.state,
        is_key_delivery=obj.is_key_delivery,
        position=obj.position,
        feature_ids=obj.feature_ids,
        feature_count=len(obj.features),
    )


def _get(db: Session, obj_id: int) -> PIObjective:
    obj = db.get(PIObjective, obj_id)
    if obj is None:
        raise HTTPException(status_code=404, detail="PI Objective not found")
    return obj


def _validated_features(db: Session, team: Team, pi: PlanningInterval, ids: list[int]) -> list[Item]:
    if not ids:
        return []
    items = list(db.scalars(select(Item).where(Item.id.in_(ids))))
    missing = set(ids) - {i.id for i in items}
    if missing:
        raise HTTPException(status_code=422, detail=f"Unknown feature id(s): {sorted(missing)}")
    for i in items:
        if i.kind != ItemKind.FEATURE or i.leading_team != team.name or i.planning_interval != pi.name:
            raise HTTPException(
                status_code=422,
                detail=f"Feature #{i.id} must be a feature of team {team.name} in {pi.name}",
            )
    return items


@router.get("", response_model=list[PIObjectiveRead])
def list_objectives(
    planning_interval: str | None = None,
    team: str | None = None,
    db: Session = Depends(get_db),
) -> list[PIObjectiveRead]:
    stmt = select(PIObjective).join(Team).join(PlanningInterval)
    if planning_interval:
        stmt = stmt.where(PlanningInterval.name == planning_interval)
    if team:
        stmt = stmt.where(Team.name == team)
    stmt = stmt.order_by(PIObjective.state, PIObjective.position, PIObjective.id)
    return [_serialize(o) for o in db.scalars(stmt)]


@router.post("", response_model=PIObjectiveRead, status_code=201)
def create_objective(
    payload: PIObjectiveCreate,
    db: Session = Depends(get_db),
    current: User = Depends(require_user),
) -> PIObjectiveRead:
    _require_team(current, payload.team_id)
    team = db.get(Team, payload.team_id)
    if team is None:
        raise HTTPException(status_code=422, detail="team_id does not exist")
    pi = db.scalar(select(PlanningInterval).where(PlanningInterval.name == payload.planning_interval))
    if pi is None:
        raise HTTPException(status_code=422, detail="planning_interval does not exist")
    try:
        key = normalize_key_delivery(payload.state, payload.is_key_delivery)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    features = _validated_features(db, team, pi, payload.feature_ids)
    obj = PIObjective(
        team_id=team.id,
        planning_interval_id=pi.id,
        title=payload.title.strip(),
        description=payload.description,
        state=payload.state,
        is_key_delivery=key,
    )
    obj.features = features
    db.add(obj)
    db.flush()
    log_event(db, actor=current, event_type="pi_objective.created",
              entity_type="pi_objective", entity_id=obj.id, entity_label=obj.title)
    db.commit()
    db.refresh(obj)
    return _serialize(obj)


@router.patch("/{obj_id}", response_model=PIObjectiveRead)
def update_objective(
    obj_id: int,
    payload: PIObjectiveUpdate,
    db: Session = Depends(get_db),
    current: User = Depends(require_user),
) -> PIObjectiveRead:
    obj = _get(db, obj_id)
    _require_team(current, obj.team_id)
    data = payload.model_dump(exclude_unset=True)
    if data.get("title") is not None:
        obj.title = data["title"].strip()
    if "description" in data:
        obj.description = data["description"]
    if data.get("position") is not None:
        obj.position = data["position"]
    new_state = data.get("state") or obj.state
    if "is_key_delivery" in data:
        # Explicit request — reject key delivery on a non-committed state.
        try:
            obj.is_key_delivery = normalize_key_delivery(new_state, data["is_key_delivery"])
        except ValueError as e:
            raise HTTPException(status_code=422, detail=str(e))
    else:
        # Implicit: keep only while committed, auto-clear when leaving committed.
        obj.is_key_delivery = obj.is_key_delivery if new_state == ObjectiveState.COMMITTED else False
    obj.state = new_state
    log_event(db, actor=current, event_type="pi_objective.updated",
              entity_type="pi_objective", entity_id=obj.id, entity_label=obj.title)
    db.commit()
    db.refresh(obj)
    return _serialize(obj)


@router.put("/{obj_id}/features", response_model=PIObjectiveRead)
def set_features(
    obj_id: int,
    payload: FeatureLinkRequest,
    db: Session = Depends(get_db),
    current: User = Depends(require_user),
) -> PIObjectiveRead:
    obj = _get(db, obj_id)
    _require_team(current, obj.team_id)
    obj.features = _validated_features(db, obj.team, obj.planning_interval, payload.feature_ids)
    log_event(db, actor=current, event_type="pi_objective.updated",
              entity_type="pi_objective", entity_id=obj.id, entity_label=obj.title)
    db.commit()
    db.refresh(obj)
    return _serialize(obj)


@router.delete("/{obj_id}", status_code=204)
def delete_objective(
    obj_id: int,
    db: Session = Depends(get_db),
    current: User = Depends(require_user),
) -> None:
    obj = _get(db, obj_id)
    _require_team(current, obj.team_id)
    label = obj.title
    db.delete(obj)
    log_event(db, actor=current, event_type="pi_objective.deleted",
              entity_type="pi_objective", entity_id=obj_id, entity_label=label)
    db.commit()
