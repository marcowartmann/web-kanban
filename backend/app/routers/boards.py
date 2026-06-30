from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Board, Lane
from app.schemas import BoardRead, LaneRead

router = APIRouter(prefix="/api", tags=["boards"])

_DEFAULT_BOARDS = [
    ("Features & Stories", "feature,story", 0, ["Funnel", "Analyzing", "New"]),
    ("Risks", "risk", 1, ["New", "Analyzing", "Resolved"]),
]


def _ensure_defaults(db: Session) -> None:
    if db.scalar(select(Board.id).limit(1)) is not None:
        return
    for name, kinds, position, lane_names in _DEFAULT_BOARDS:
        board = Board(name=name, kinds=kinds, position=position)
        db.add(board)
        db.flush()
        for index, lane_name in enumerate(lane_names):
            db.add(Lane(board_id=board.id, name=lane_name, position=index))
    db.commit()


def _to_read(board: Board) -> BoardRead:
    return BoardRead(
        id=board.id,
        name=board.name,
        kinds=[k for k in board.kinds.split(",") if k],
        position=board.position,
        lanes=[LaneRead.model_validate(lane) for lane in board.lanes],
    )


@router.get("/boards", response_model=list[BoardRead])
def list_boards(db: Session = Depends(get_db)) -> list[BoardRead]:
    _ensure_defaults(db)
    boards = db.scalars(select(Board).order_by(Board.position))
    return [_to_read(board) for board in boards]
