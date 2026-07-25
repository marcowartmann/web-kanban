from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.audit import log_event
from app.auth import require_admin
from app.catalog import ports
from app.catalog.factory import get_art_repo
from app.catalog.http import check_writable
from app.db import get_db
from app.models import User
from app.schemas import ArtCreate, ArtRead, ArtUpdate

router = APIRouter(prefix="/api/v1/arts", tags=["arts"])


@router.get("", response_model=list[ArtRead])
def list_arts(repo: ports.ArtRepository = Depends(get_art_repo)):
    return repo.list()


@router.post("", response_model=ArtRead, status_code=201)
def create_art(
    payload: ArtCreate,
    repo: ports.ArtRepository = Depends(get_art_repo),
    db: Session = Depends(get_db),
    current: User = Depends(require_admin),
):
    check_writable(repo)
    art = repo.create(name=payload.name, description=payload.description)
    log_event(db, actor=current, event_type="art.created", entity_type="art",
              entity_id=art.id, entity_label=art.name)
    db.commit()
    return art


@router.patch("/{art_id}", response_model=ArtRead)
def update_art(
    art_id: int,
    payload: ArtUpdate,
    repo: ports.ArtRepository = Depends(get_art_repo),
    db: Session = Depends(get_db),
    current: User = Depends(require_admin),
):
    check_writable(repo)
    before = repo.get(art_id)
    changes = payload.model_dump(exclude_unset=True)
    art = repo.update(art_id, changes)
    for key in ("name", "description"):
        if key not in changes:
            continue
        old_value = getattr(before, key)
        new_value = getattr(art, key)
        if old_value == new_value:
            continue
        log_event(db, actor=current, event_type="art.updated", entity_type="art",
                  entity_id=art.id, entity_label=art.name,
                  field=key, old_value=old_value, new_value=new_value)
    db.commit()
    return art


@router.delete("/{art_id}", status_code=204)
def delete_art(
    art_id: int,
    repo: ports.ArtRepository = Depends(get_art_repo),
    db: Session = Depends(get_db),
    current: User = Depends(require_admin),
):
    check_writable(repo)
    art = repo.get(art_id)
    repo.delete(art_id)
    log_event(db, actor=current, event_type="art.deleted", entity_type="art",
              entity_id=art_id, entity_label=art.name)
    db.commit()
