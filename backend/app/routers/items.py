from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.audit import ITEM_TRACKED_FIELDS, diff_item_changes, log_event
from app.auth import require_user
from app.db import get_db
from app.links import RELATIONS
from app.models import AuditEvent, Item, ItemKind, ItemLink, User
from app.schemas import AuditEventRead, ItemCreate, ItemDetail, ItemRead, ItemUpdate, ItemRef, LinkedItem
from app.wsjf import recompute

router = APIRouter(prefix="/api/v1/items", tags=["items"])

_WSJF_FIELDS = {"business_value", "time_criticality", "risk_reduction", "job_size"}


def _get_or_404(db: Session, item_id: int) -> Item:
    item = db.get(Item, item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Item not found")
    return item


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


@router.get("", response_model=list[ItemRead])
def list_items(
    kind: ItemKind | None = None,
    status: str | None = None,
    planning_interval: str | None = None,
    leading_team: str | None = None,
    assignee: str | None = None,
    q: str | None = None,
    db: Session = Depends(get_db),
) -> list[Item]:
    stmt = select(Item)
    if kind is not None:
        stmt = stmt.where(Item.kind == kind)
    if status is not None:
        stmt = stmt.where(Item.status == status)
    if planning_interval is not None:
        stmt = stmt.where(Item.planning_interval == planning_interval)
    if leading_team is not None:
        stmt = stmt.where(Item.leading_team == leading_team)
    if assignee is not None:
        stmt = stmt.where(Item.assignee == assignee)
    if q:
        stmt = stmt.where(Item.title.ilike(f"%{q}%"))
    stmt = stmt.order_by(Item.position)
    return list(db.scalars(stmt))


@router.get("/{item_id}", response_model=ItemDetail)
def get_item(item_id: int, db: Session = Depends(get_db)) -> ItemDetail:
    item = _get_or_404(db, item_id)
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
    before = {f: getattr(item, f) for f in changes if f in ITEM_TRACKED_FIELDS}
    for key, value in changes.items():
        setattr(item, key, value)
    if _WSJF_FIELDS & changes.keys():
        recompute(item)
    item.version += 1
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
    db.commit()
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
    db.commit()
