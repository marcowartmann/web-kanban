from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.audit import log_event
from app.auth import require_user, utcnow
from app.db import get_db
from app.models import Comment, Item, User
from app.schemas import CommentCreate, CommentRead, CommentUpdate

router = APIRouter(prefix="/api/v1", tags=["comments"])


def _excerpt(body: str) -> str:
    return body[:120] + "…" if len(body) > 120 else body


def _can_modify(user: User, comment: Comment) -> bool:
    return user.role == "admin" or comment.author_id == user.id


def _item_or_404(db: Session, item_id: int) -> Item:
    item = db.get(Item, item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Item not found")
    return item


def _comment_or_404(db: Session, comment_id: int) -> Comment:
    comment = db.get(Comment, comment_id)
    if comment is None:
        raise HTTPException(status_code=404, detail="Comment not found")
    return comment


@router.get("/items/{item_id}/comments", response_model=list[CommentRead])
def list_comments(item_id: int, db: Session = Depends(get_db)) -> list[Comment]:
    _item_or_404(db, item_id)
    return list(
        db.scalars(
            select(Comment)
            .where(Comment.item_id == item_id)
            .order_by(Comment.created_at.asc(), Comment.id.asc())
        )
    )


@router.post("/items/{item_id}/comments", response_model=CommentRead, status_code=201)
def create_comment(
    item_id: int,
    payload: CommentCreate,
    db: Session = Depends(get_db),
    current: User = Depends(require_user),
) -> Comment:
    item = _item_or_404(db, item_id)
    if payload.parent_id is not None:
        parent = db.get(Comment, payload.parent_id)
        if parent is None:
            raise HTTPException(status_code=422, detail="parent_id does not exist")
        if parent.item_id != item_id:
            raise HTTPException(status_code=422, detail="parent belongs to a different item")
        if parent.parent_id is not None:
            raise HTTPException(status_code=422, detail="replies cannot be nested")
    comment = Comment(
        item_id=item_id,
        parent_id=payload.parent_id,
        author_id=current.id,
        body=payload.body,
    )
    db.add(comment)
    db.flush()
    log_event(
        db,
        actor=current,
        event_type="comment.added",
        entity_type="item",
        entity_id=item.id,
        entity_label=item.title,
        field="comment",
        new_value=_excerpt(payload.body),
    )
    db.commit()
    db.refresh(comment)
    return comment


@router.patch("/comments/{comment_id}", response_model=CommentRead)
def update_comment(
    comment_id: int,
    payload: CommentUpdate,
    db: Session = Depends(get_db),
    current: User = Depends(require_user),
) -> Comment:
    comment = _comment_or_404(db, comment_id)
    if not _can_modify(current, comment):
        raise HTTPException(status_code=403, detail="Not your comment")
    old_body = comment.body
    comment.body = payload.body
    comment.updated_at = utcnow()
    item = db.get(Item, comment.item_id)
    log_event(
        db,
        actor=current,
        event_type="comment.edited",
        entity_type="item",
        entity_id=comment.item_id,
        entity_label=item.title if item else None,
        field="comment",
        old_value=_excerpt(old_body),
        new_value=_excerpt(payload.body),
    )
    db.commit()
    db.refresh(comment)
    return comment


@router.delete("/comments/{comment_id}", status_code=204)
def delete_comment(
    comment_id: int,
    db: Session = Depends(get_db),
    current: User = Depends(require_user),
) -> None:
    comment = _comment_or_404(db, comment_id)
    if not _can_modify(current, comment):
        raise HTTPException(status_code=403, detail="Not your comment")
    reply_count = len(comment.replies)
    item = db.get(Item, comment.item_id)
    old_value = _excerpt(comment.body) + (f" (+{reply_count} replies)" if reply_count else "")
    log_event(
        db,
        actor=current,
        event_type="comment.deleted",
        entity_type="item",
        entity_id=comment.item_id,
        entity_label=item.title if item else None,
        field="comment",
        old_value=old_value,
    )
    db.delete(comment)  # ORM delete-orphan removes replies
    db.commit()
