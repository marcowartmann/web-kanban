from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Item, ItemKind
from app.schemas import ItemCreate, ItemDetail, ItemRead, ItemUpdate
from app.wsjf import recompute

router = APIRouter(prefix="/api/items", tags=["items"])

_WSJF_FIELDS = {"business_value", "time_criticality", "risk_reduction", "job_size"}


def _get_or_404(db: Session, item_id: int) -> Item:
    item = db.get(Item, item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Item not found")
    return item


@router.get("", response_model=list[ItemRead])
def list_items(
    kind: ItemKind | None = None,
    status: str | None = None,
    iteration: str | None = None,
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
    if iteration is not None:
        stmt = stmt.where(Item.iteration == iteration)
    if leading_team is not None:
        stmt = stmt.where(Item.leading_team == leading_team)
    if assignee is not None:
        stmt = stmt.where(Item.assignee == assignee)
    if q:
        stmt = stmt.where(Item.title.ilike(f"%{q}%"))
    stmt = stmt.order_by(Item.position)
    return list(db.scalars(stmt))


@router.get("/{item_id}", response_model=ItemDetail)
def get_item(item_id: int, db: Session = Depends(get_db)) -> Item:
    return _get_or_404(db, item_id)


@router.post("", response_model=ItemDetail, status_code=201)
def create_item(payload: ItemCreate, db: Session = Depends(get_db)) -> Item:
    if payload.parent_id is not None and db.get(Item, payload.parent_id) is None:
        raise HTTPException(status_code=422, detail="parent_id does not exist")
    item = Item(**payload.model_dump())
    recompute(item)
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@router.patch("/{item_id}", response_model=ItemDetail)
def update_item(
    item_id: int, payload: ItemUpdate, db: Session = Depends(get_db)
) -> Item:
    item = _get_or_404(db, item_id)
    changes = payload.model_dump(exclude_unset=True)
    for key, value in changes.items():
        setattr(item, key, value)
    if _WSJF_FIELDS & changes.keys():
        recompute(item)
    db.commit()
    db.refresh(item)
    return item


@router.delete("/{item_id}", status_code=204)
def delete_item(item_id: int, db: Session = Depends(get_db)) -> None:
    item = _get_or_404(db, item_id)
    db.delete(item)  # ORM cascade removes child stories
    db.commit()
