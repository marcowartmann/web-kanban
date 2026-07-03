from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.audit import log_event
from app.auth import require_user
from app.db import get_db
from app.models import Item, ItemKind, User
from app.schemas import FeatureReorderRequest

router = APIRouter(prefix="/api/v1/features", tags=["features"])


def _resolved_order(features: list[Item]) -> list[Item]:
    """manual_rank ASC (nulls last), then wsjf_score DESC (nulls last), then id."""
    def key(f: Item):
        manual = (0, f.manual_rank) if f.manual_rank is not None else (1, 0)
        wsjf = (0, -float(f.wsjf_score)) if f.wsjf_score is not None else (1, 0.0)
        return (manual, wsjf, f.id)
    return sorted(features, key=key)


@router.post("/ranking/reorder", status_code=204)
def reorder_ranking(
    payload: FeatureReorderRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_user),
) -> None:
    moved = db.get(Item, payload.feature_id)
    if moved is None:
        raise HTTPException(status_code=404, detail="Feature not found")
    if moved.kind != ItemKind.FEATURE:
        raise HTTPException(status_code=422, detail="Not a feature")
    if user.team is None or user.team.name != moved.leading_team:
        raise HTTPException(status_code=403, detail="You can only rank features of your own team")

    after_id = payload.after_id
    if after_id is not None:
        anchor = db.get(Item, after_id)
        if anchor is None:
            raise HTTPException(status_code=404, detail="Anchor feature not found")
        if anchor.kind != ItemKind.FEATURE:
            raise HTTPException(status_code=422, detail="Anchor is not a feature")

    features = list(db.scalars(select(Item).where(Item.kind == ItemKind.FEATURE)))
    ordered = _resolved_order(features)
    ordered = [f for f in ordered if f.id != moved.id]
    insert_at = 0
    if after_id is not None:
        insert_at = next(i for i, f in enumerate(ordered) if f.id == after_id) + 1
    ordered.insert(insert_at, moved)
    for i, f in enumerate(ordered, start=1):
        f.manual_rank = i

    log_event(
        db, actor=user, event_type="feature.reranked",
        entity_type="item", entity_id=moved.id, entity_label=moved.title,
    )
    db.commit()
