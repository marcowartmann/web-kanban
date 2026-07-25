"""Postgres adapter for the catalog bounded context (SQLAlchemy)."""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app import models as m


def get_or_create_art_id(db: Session, name: str | None) -> int | None:
    """Resolve an ART name to its id, creating the ART on first sight.
    Shared by the item API, CSV import, and snapshot restore."""
    clean = str(name).strip() if name and str(name).strip() else None
    if clean is None:
        return None
    art = db.scalar(select(m.Art).where(m.Art.name == clean))
    if art is None:
        art = m.Art(name=clean)
        db.add(art)
        db.flush()
    return art.id
