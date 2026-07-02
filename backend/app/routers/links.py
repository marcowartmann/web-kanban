from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.audit import log_event
from app.auth import require_user
from app.db import get_db
from app.links import RELATIONS, canonicalize, relation_options
from app.models import Item, ItemLink, User
from app.schemas import LinkCreate, LinkRow, RelationOption

router = APIRouter(prefix="/api", tags=["links"])


@router.get("/link-relations", response_model=list[RelationOption])
def list_relations() -> list[dict[str, str]]:
    return relation_options()


@router.get("/links", response_model=list[LinkRow])
def list_links(db: Session = Depends(get_db)) -> list[ItemLink]:
    return list(db.scalars(select(ItemLink)))


@router.post("/links", response_model=LinkRow, status_code=201)
def create_link(
    payload: LinkCreate,
    db: Session = Depends(get_db),
    current: User = Depends(require_user),
) -> ItemLink:
    if payload.relation not in RELATIONS:
        raise HTTPException(status_code=422, detail=f"Unknown relation '{payload.relation}'")
    if payload.source_id == payload.target_id:
        raise HTTPException(status_code=422, detail="An item cannot depend on itself")
    if db.get(Item, payload.source_id) is None or db.get(Item, payload.target_id) is None:
        raise HTTPException(status_code=422, detail="source_id or target_id does not exist")

    source_id, target_id = canonicalize(payload.source_id, payload.target_id, payload.relation)
    duplicate = db.scalar(
        select(ItemLink).where(
            ItemLink.source_id == source_id,
            ItemLink.target_id == target_id,
            ItemLink.relation == payload.relation,
        )
    )
    if duplicate is not None:
        raise HTTPException(status_code=409, detail="Link already exists")

    link = ItemLink(source_id=source_id, target_id=target_id, relation=payload.relation)
    db.add(link)
    source = db.get(Item, source_id)
    target = db.get(Item, target_id)
    log_event(
        db,
        actor=current,
        event_type="link.added",
        entity_type="item",
        entity_id=source.id,
        entity_label=source.title,
        field="link",
        new_value=f"{payload.relation} → #{target.id} {target.title}",
    )
    log_event(
        db,
        actor=current,
        event_type="link.added",
        entity_type="item",
        entity_id=target.id,
        entity_label=target.title,
        field="link",
        new_value=f"{payload.relation} → #{source.id} {source.title}",
    )
    db.commit()
    db.refresh(link)
    return link


@router.delete("/links/{link_id}", status_code=204)
def delete_link(
    link_id: int,
    db: Session = Depends(get_db),
    current: User = Depends(require_user),
) -> None:
    link = db.get(ItemLink, link_id)
    if link is None:
        raise HTTPException(status_code=404, detail="Link not found")
    source = db.get(Item, link.source_id)
    target = db.get(Item, link.target_id)
    if source and target:
        log_event(
            db,
            actor=current,
            event_type="link.removed",
            entity_type="item",
            entity_id=source.id,
            entity_label=source.title,
            field="link",
            old_value=f"{link.relation} → #{target.id} {target.title}",
        )
        log_event(
            db,
            actor=current,
            event_type="link.removed",
            entity_type="item",
            entity_id=target.id,
            entity_label=target.title,
            field="link",
            old_value=f"{link.relation} → #{source.id} {source.title}",
        )
    db.delete(link)
    db.commit()
