from fastapi import APIRouter, Depends
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.auth import require_admin
from app.db import get_db
from app.models import AuditEvent
from app.schemas import AuditEventRead, AuditPage

router = APIRouter(prefix="/api/v1/audit", tags=["audit"], dependencies=[Depends(require_admin)])


@router.get("", response_model=AuditPage)
def list_audit_events(
    limit: int = 50,
    offset: int = 0,
    q: str | None = None,
    entity_type: str | None = None,
    db: Session = Depends(get_db),
) -> AuditPage:
    limit = max(1, min(limit, 200))
    offset = max(0, offset)

    stmt = select(AuditEvent)
    if q:
        pattern = f"%{q}%"
        stmt = stmt.where(
            or_(
                AuditEvent.actor_name.ilike(pattern),
                AuditEvent.entity_label.ilike(pattern),
                AuditEvent.event_type.ilike(pattern),
            )
        )
    if entity_type:
        stmt = stmt.where(AuditEvent.entity_type == entity_type)

    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.scalars(
        stmt.order_by(AuditEvent.created_at.desc(), AuditEvent.id.desc())
        .limit(limit)
        .offset(offset)
    )
    return AuditPage(items=[AuditEventRead.model_validate(r) for r in rows], total=total)
