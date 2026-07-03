from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session, selectinload
from sqlalchemy.orm.exc import StaleDataError

from app.audit import ITEM_TRACKED_FIELDS, diff_item_changes, log_event
from app.auth import require_user
from app.db import get_db
from app.links import RELATIONS
from app.models import AuditEvent, Container, Item, ItemKind, ItemLink, TeamDepartment, User
from app.schemas import AuditEventRead, ItemCreate, ItemDetail, ItemPage, ItemRead, ItemUpdate, ItemRef, LinkedItem
from app.wsjf import recompute

router = APIRouter(prefix="/api/v1/items", tags=["items"])

_WSJF_FIELDS = {"business_value", "time_criticality", "risk_reduction", "job_size"}


def _get_or_404(db: Session, item_id: int, *, eager: bool = False) -> Item:
    options = (
        [
            selectinload(Item.assignee_user),
            selectinload(Item.children).selectinload(Item.assignee_user),
        ]
        if eager
        else []
    )
    item = db.get(Item, item_id, options=options)
    if item is None:
        raise HTTPException(status_code=404, detail="Item not found")
    return item


def _check_assignee(db: Session, assignee_id: int | None) -> None:
    if assignee_id is not None and db.get(User, assignee_id) is None:
        raise HTTPException(status_code=422, detail="assignee_id does not exist")


def _check_container(
    db: Session, container_id: int, *, planning_interval: str | None, leading_team: str | None
) -> Container:
    container = db.get(Container, container_id)
    if container is None:
        raise HTTPException(status_code=422, detail="container_id does not exist")
    if container.planning_interval != planning_interval or container.team.name != leading_team:
        raise HTTPException(
            status_code=409,
            detail="Container does not match the item's planning interval and leading team",
        )
    return container


def _container_matches(
    db: Session, container_id: int, *, planning_interval: str | None, leading_team: str | None
) -> bool:
    container = db.get(Container, container_id)
    return (
        container is not None
        and container.planning_interval == planning_interval
        and container.team.name == leading_team
    )


def _container_name(db: Session, container_id: int | None) -> str | None:
    if container_id is None:
        return None
    container = db.get(Container, container_id)
    return container.name if container else None


def _check_department(
    db: Session, department_id: int, *, kind: ItemKind, leading_team: str | None
) -> TeamDepartment:
    dep = db.get(TeamDepartment, department_id)
    if dep is None:
        raise HTTPException(status_code=422, detail="department_id does not exist")
    if kind not in (ItemKind.FEATURE, ItemKind.STORY):
        raise HTTPException(status_code=422, detail="Department applies to features and stories only")
    if leading_team is None or dep.team.name != leading_team:
        raise HTTPException(status_code=422, detail="Department must belong to the item's leading team")
    return dep


def _department_matches(db: Session, department_id: int, *, leading_team: str | None) -> bool:
    dep = db.get(TeamDepartment, department_id)
    return dep is not None and dep.team.name == leading_team


def _department_name(db: Session, department_id: int | None) -> str | None:
    if department_id is None:
        return None
    dep = db.get(TeamDepartment, department_id)
    return dep.name if dep else None


def _resolve_links(db: Session, item_id: int) -> list[LinkedItem]:
    edges = db.scalars(
        select(ItemLink).where(
            (ItemLink.source_id == item_id) | (ItemLink.target_id == item_id)
        )
    )
    out: list[LinkedItem] = []
    for edge in edges:
        rel = RELATIONS.get(edge.relation)
        if rel is None:  # unknown/legacy relation key — skip defensively
            continue
        if edge.source_id == item_id:
            other = db.get(Item, edge.target_id)
            direction, label = "outgoing", rel.forward
        else:
            other = db.get(Item, edge.source_id)
            direction, label = "incoming", rel.inverse
        out.append(
            LinkedItem(
                link_id=edge.id,
                relation=edge.relation,
                direction=direction,
                label=label,
                item=ItemRef.model_validate(other),
            )
        )
    out.sort(key=lambda link: (link.relation, link.direction, link.item.title))
    return out


@router.get("", response_model=ItemPage)
def list_items(
    kind: ItemKind | None = None,
    status: str | None = None,
    planning_interval: str | None = None,
    leading_team: str | None = None,
    assignee_id: int | None = None,
    q: str | None = None,
    limit: int = 200,
    offset: int = 0,
    db: Session = Depends(get_db),
) -> ItemPage:
    stmt = select(Item)
    if kind is not None:
        stmt = stmt.where(Item.kind == kind)
    if status is not None:
        stmt = stmt.where(Item.status == status)
    if planning_interval is not None:
        stmt = stmt.where(Item.planning_interval == planning_interval)
    if leading_team is not None:
        stmt = stmt.where(Item.leading_team == leading_team)
    if assignee_id is not None:
        stmt = stmt.where(Item.assignee_id == assignee_id)
    if q:
        stmt = stmt.where(Item.title.ilike(f"%{q}%"))
    total = db.scalar(select(func.count()).select_from(stmt.subquery()))
    limit = max(1, min(limit, 1000))
    offset = max(0, offset)
    rows = db.scalars(
        stmt.order_by(Item.position)
        .offset(offset)
        .limit(limit)
        .options(selectinload(Item.assignee_user))
    )
    return ItemPage(items=[ItemRead.model_validate(r) for r in rows], total=total or 0)


@router.get("/{item_id}", response_model=ItemDetail)
def get_item(item_id: int, db: Session = Depends(get_db)) -> ItemDetail:
    item = _get_or_404(db, item_id, eager=True)
    detail = ItemDetail.model_validate(item)
    detail.links = _resolve_links(db, item_id)
    return detail


@router.get("/{item_id}/events", response_model=list[AuditEventRead])
def item_events(item_id: int, db: Session = Depends(get_db)) -> list[AuditEvent]:
    _get_or_404(db, item_id)
    return list(
        db.scalars(
            select(AuditEvent)
            .where(AuditEvent.entity_type == "item", AuditEvent.entity_id == item_id)
            .order_by(AuditEvent.created_at.desc(), AuditEvent.id.desc())
            .limit(100)
        )
    )


@router.post("", response_model=ItemDetail, status_code=201)
def create_item(
    payload: ItemCreate,
    db: Session = Depends(get_db),
    current: User = Depends(require_user),
) -> Item:
    if payload.parent_id is not None and db.get(Item, payload.parent_id) is None:
        raise HTTPException(status_code=422, detail="parent_id does not exist")
    _check_assignee(db, payload.assignee_id)
    if payload.container_id is not None:
        _check_container(
            db, payload.container_id,
            planning_interval=payload.planning_interval,
            leading_team=payload.leading_team,
        )
    if payload.department_id is not None:
        _check_department(
            db, payload.department_id,
            kind=payload.kind, leading_team=payload.leading_team,
        )
    item = Item(**payload.model_dump())
    recompute(item)
    db.add(item)
    db.flush()
    log_event(
        db,
        actor=current,
        event_type="item.created",
        entity_type="item",
        entity_id=item.id,
        entity_label=item.title,
    )
    db.commit()
    db.refresh(item)
    return item


@router.patch("/{item_id}", response_model=ItemDetail)
def update_item(
    item_id: int,
    payload: ItemUpdate,
    db: Session = Depends(get_db),
    current: User = Depends(require_user),
) -> Item:
    item = _get_or_404(db, item_id)
    if payload.version != item.version:
        raise HTTPException(
            status_code=409,
            detail="Item was modified by someone else — reload and retry",
        )
    changes = payload.model_dump(exclude_unset=True)
    changes.pop("version", None)
    if "assignee_id" in changes:
        _check_assignee(db, changes["assignee_id"])
    new_pi = changes.get("planning_interval", item.planning_interval)
    new_team = changes.get("leading_team", item.leading_team)
    if changes.get("container_id") is not None:
        _check_container(
            db, changes["container_id"], planning_interval=new_pi, leading_team=new_team
        )
    elif (
        "container_id" not in changes
        and item.container_id is not None
        and ("planning_interval" in changes or "leading_team" in changes)
        and not _container_matches(
            db, item.container_id, planning_interval=new_pi, leading_team=new_team
        )
    ):
        # The patch moved the item out of its container's (PI, team) scope.
        changes["container_id"] = None
    if changes.get("department_id") is not None:
        _check_department(db, changes["department_id"], kind=item.kind, leading_team=new_team)
    elif (
        "department_id" not in changes
        and item.department_id is not None
        and "leading_team" in changes
        and not _department_matches(db, item.department_id, leading_team=new_team)
    ):
        # The patch moved the item out of its department's team scope.
        changes["department_id"] = None
    before = {f: getattr(item, f) for f in changes if f in ITEM_TRACKED_FIELDS}
    if "assignee_id" in changes:
        before["assignee"] = item.assignee
    if "container_id" in changes:
        before["container"] = _container_name(db, item.container_id)
    if "department_id" in changes:
        before["department"] = _department_name(db, item.department_id)
    for key, value in changes.items():
        setattr(item, key, value)
    if _WSJF_FIELDS & changes.keys():
        recompute(item)
    if "assignee_id" in changes:
        try:
            db.flush()  # emits the versioned UPDATE — the race can surface HERE
        except StaleDataError:
            db.rollback()
            raise HTTPException(
                status_code=409,
                detail="Item was modified by someone else — reload and retry",
            )
        db.refresh(item, ["assignee_user"])
        changes = dict(changes)
        changes["assignee"] = item.assignee
        changes.pop("assignee_id")
    if "container_id" in changes:
        # Audit the container by name (ids mean nothing in the log).
        changes = dict(changes)
        changes["container"] = _container_name(db, changes["container_id"])
        changes.pop("container_id")
    if "department_id" in changes:
        # Audit the department by name (ids mean nothing in the log).
        changes = dict(changes)
        changes["department"] = _department_name(db, changes["department_id"])
        changes.pop("department_id")
    for field, old, new in diff_item_changes(before, changes):
        log_event(
            db,
            actor=current,
            event_type="item.updated",
            entity_type="item",
            entity_id=item.id,
            entity_label=item.title,
            field=field,
            old_value=old,
            new_value=new,
        )
    try:
        db.commit()
    except StaleDataError:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="Item was modified by someone else — reload and retry",
        )
    db.refresh(item)
    return item


@router.delete("/{item_id}", status_code=204)
def delete_item(
    item_id: int,
    db: Session = Depends(get_db),
    current: User = Depends(require_user),
) -> None:
    item = _get_or_404(db, item_id)
    doomed = [(item.id, item.title), *[(c.id, c.title) for c in item.children]]
    ids = [i for i, _ in doomed]
    for did, title in doomed:
        log_event(
            db,
            actor=current,
            event_type="item.deleted",
            entity_type="item",
            entity_id=did,
            entity_label=title,
        )
    db.execute(
        delete(ItemLink).where(
            ItemLink.source_id.in_(ids) | ItemLink.target_id.in_(ids)
        )
    )
    db.delete(item)  # ORM cascade removes child stories
    try:
        db.commit()
    except StaleDataError:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="Item was modified by someone else — reload and retry",
        )
