from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.auth import require_admin
from app.db import get_db
from app.models import Board, Lane
from app.schemas import BoardRead, LaneCreate, LaneOrder, LaneRead, LaneUpdate

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


_RESERVED_LANE = "Unscheduled"


def _name_taken(db: Session, board_id: int, name: str) -> bool:
    return db.scalar(
        select(Lane).where(Lane.board_id == board_id, Lane.name == name)
    ) is not None


@router.post(
    "/boards/{board_id}/lanes",
    response_model=LaneRead,
    status_code=201,
    dependencies=[Depends(require_admin)],
)
def add_lane(board_id: int, payload: LaneCreate, db: Session = Depends(get_db)) -> Lane:
    if db.get(Board, board_id) is None:
        raise HTTPException(status_code=404, detail="Board not found")
    if payload.name == _RESERVED_LANE:
        raise HTTPException(status_code=409, detail="'Unscheduled' is reserved")
    if _name_taken(db, board_id, payload.name):
        raise HTTPException(status_code=409, detail="Lane already exists on this board")
    max_pos = db.scalar(
        select(func.max(Lane.position)).where(Lane.board_id == board_id)
    )
    lane = Lane(
        board_id=board_id,
        name=payload.name,
        position=0 if max_pos is None else max_pos + 1,
    )
    db.add(lane)
    db.commit()
    db.refresh(lane)
    return lane


@router.patch("/lanes/{lane_id}", response_model=LaneRead, dependencies=[Depends(require_admin)])
def rename_lane(lane_id: int, payload: LaneUpdate, db: Session = Depends(get_db)) -> Lane:
    lane = db.get(Lane, lane_id)
    if lane is None:
        raise HTTPException(status_code=404, detail="Lane not found")
    if payload.name == _RESERVED_LANE:
        raise HTTPException(status_code=409, detail="'Unscheduled' is reserved")
    if payload.name != lane.name and _name_taken(db, lane.board_id, payload.name):
        raise HTTPException(status_code=409, detail="Lane already exists on this board")
    lane.name = payload.name
    db.commit()
    db.refresh(lane)
    return lane


@router.delete("/lanes/{lane_id}", status_code=204, dependencies=[Depends(require_admin)])
def delete_lane(lane_id: int, db: Session = Depends(get_db)) -> None:
    lane = db.get(Lane, lane_id)
    if lane is None:
        raise HTTPException(status_code=404, detail="Lane not found")
    db.delete(lane)
    db.commit()


@router.put(
    "/boards/{board_id}/lanes/order",
    response_model=list[LaneRead],
    dependencies=[Depends(require_admin)],
)
def reorder_lanes(
    board_id: int, payload: LaneOrder, db: Session = Depends(get_db)
) -> list[Lane]:
    if db.get(Board, board_id) is None:
        raise HTTPException(status_code=404, detail="Board not found")
    lanes = {
        lane.id: lane
        for lane in db.scalars(select(Lane).where(Lane.board_id == board_id))
    }
    if set(payload.lane_ids) != set(lanes) or len(payload.lane_ids) != len(lanes):
        raise HTTPException(
            status_code=422, detail="lane_ids must match the board's lanes exactly"
        )
    for position, lane_id in enumerate(payload.lane_ids):
        lanes[lane_id].position = position
    db.commit()
    return list(
        db.scalars(
            select(Lane).where(Lane.board_id == board_id).order_by(Lane.position)
        )
    )
