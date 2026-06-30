from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Item
from app.schemas import BoardCard, BoardColumn

router = APIRouter(prefix="/api", tags=["board"])

_STATUS_ORDER = ["Funnel", "Analyzing", "New"]
_UNSCHEDULED = "Unscheduled"


def _status_key(status: str) -> tuple[int, str]:
    if status == _UNSCHEDULED:
        return (len(_STATUS_ORDER) + 1, "")
    if status in _STATUS_ORDER:
        return (_STATUS_ORDER.index(status), "")
    return (len(_STATUS_ORDER), status.lower())


@router.get("/board", response_model=list[BoardColumn])
def get_board(db: Session = Depends(get_db)) -> list[BoardColumn]:
    stmt = select(Item).where(Item.parent_id.is_(None)).order_by(Item.position)
    grouped: dict[str, list[BoardCard]] = {}
    for item in db.scalars(stmt):
        status = (item.status or "").strip() or _UNSCHEDULED
        children = item.children
        card = BoardCard.model_validate(item).model_copy(
            update={
                "children_count": len(children),
                "children_points": sum((c.story_points or 0) for c in children),
            }
        )
        grouped.setdefault(status, []).append(card)
    return [
        BoardColumn(status=status, cards=cards)
        for status, cards in sorted(grouped.items(), key=lambda kv: _status_key(kv[0]))
    ]
