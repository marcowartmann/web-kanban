from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.audit import log_event
from app.auth import require_user
from app.catalog import ports
from app.catalog.factory import get_product_repo, get_roadmap_item_repo, get_stream_repo
from app.catalog.http import check_writable
from app.db import get_db
from app.models import User
from app.schemas import (
    RoadmapFeatureLink,
    RoadmapItemCreate,
    RoadmapItemRead,
    RoadmapItemUpdate,
    StreamCreate,
    StreamRead,
    StreamUpdate,
)

router = APIRouter(prefix="/api/v1", tags=["roadmap"])

# Fields whose old/new values are logged by simple value comparison. The
# stream is handled separately (detected by id, logged by name).
_STREAM_AUDIT_FIELDS = ("name", "position")
_ITEM_AUDIT_FIELDS = ("title", "description", "status", "start_date", "end_date")


def _s(value) -> str | None:
    if value is None:
        return None
    if hasattr(value, "value"):
        return value.value
    return str(value)


@router.get("/products/{product_id}/roadmap", response_model=list[StreamRead])
def product_roadmap(
    product_id: int,
    repo: ports.StreamRepository = Depends(get_stream_repo),
    products: ports.ProductRepository = Depends(get_product_repo),
):
    products.get(product_id)  # 404 when missing
    return repo.list(product_id)


@router.post("/streams", response_model=StreamRead, status_code=201)
def create_stream(
    payload: StreamCreate,
    repo: ports.StreamRepository = Depends(get_stream_repo),
    db: Session = Depends(get_db),
    current: User = Depends(require_user),
):
    check_writable(repo)
    stream = repo.create(**payload.model_dump())
    log_event(db, actor=current, event_type="stream.created", entity_type="stream",
              entity_id=stream.id, entity_label=stream.name)
    db.commit()
    return stream


@router.patch("/streams/{stream_id}", response_model=StreamRead)
def update_stream(
    stream_id: int,
    payload: StreamUpdate,
    repo: ports.StreamRepository = Depends(get_stream_repo),
    db: Session = Depends(get_db),
    current: User = Depends(require_user),
):
    check_writable(repo)
    before = repo.get(stream_id)
    changes = payload.model_dump(exclude_unset=True)
    stream = repo.update(stream_id, changes)
    for key in _STREAM_AUDIT_FIELDS:
        if key in changes:
            old, new = getattr(before, key), getattr(stream, key)
            if old != new:
                log_event(db, actor=current, event_type="stream.updated",
                          entity_type="stream", entity_id=stream.id,
                          entity_label=stream.name, field=key,
                          old_value=_s(old), new_value=_s(new))
    db.commit()
    return stream


@router.delete("/streams/{stream_id}", status_code=204)
def delete_stream(
    stream_id: int,
    repo: ports.StreamRepository = Depends(get_stream_repo),
    db: Session = Depends(get_db),
    current: User = Depends(require_user),
):
    check_writable(repo)
    stream = repo.get(stream_id)
    repo.delete(stream_id)
    log_event(db, actor=current, event_type="stream.deleted", entity_type="stream",
              entity_id=stream_id, entity_label=stream.name)
    db.commit()


@router.post("/roadmap-items", response_model=RoadmapItemRead, status_code=201)
def create_roadmap_item(
    payload: RoadmapItemCreate,
    repo: ports.RoadmapItemRepository = Depends(get_roadmap_item_repo),
    db: Session = Depends(get_db),
    current: User = Depends(require_user),
):
    check_writable(repo)
    item = repo.create(**payload.model_dump())
    log_event(db, actor=current, event_type="roadmap_item.created", entity_type="roadmap_item",
              entity_id=item.id, entity_label=item.title)
    db.commit()
    return item


@router.get("/roadmap-items/{item_id}", response_model=RoadmapItemRead)
def get_roadmap_item(item_id: int,
                     repo: ports.RoadmapItemRepository = Depends(get_roadmap_item_repo)):
    return repo.get(item_id)


@router.patch("/roadmap-items/{item_id}", response_model=RoadmapItemRead)
def update_roadmap_item(
    item_id: int,
    payload: RoadmapItemUpdate,
    repo: ports.RoadmapItemRepository = Depends(get_roadmap_item_repo),
    stream_repo: ports.StreamRepository = Depends(get_stream_repo),
    db: Session = Depends(get_db),
    current: User = Depends(require_user),
):
    check_writable(repo)
    before = repo.get(item_id)
    changes = payload.model_dump(exclude_unset=True)
    item = repo.update(item_id, changes)
    for key in _ITEM_AUDIT_FIELDS:
        if key in changes:
            old, new = getattr(before, key), getattr(item, key)
            if old != new:
                log_event(db, actor=current, event_type="roadmap_item.updated",
                          entity_type="roadmap_item", entity_id=item.id,
                          entity_label=item.title, field=key,
                          old_value=_s(old), new_value=_s(new))
    # stream: detect by id, log by name — ids mean nothing in the log.
    if "stream_id" in changes and before.stream_id != item.stream_id:
        old_stream = stream_repo.get(before.stream_id)
        new_stream = stream_repo.get(item.stream_id)
        log_event(db, actor=current, event_type="roadmap_item.updated",
                  entity_type="roadmap_item", entity_id=item.id,
                  entity_label=item.title, field="stream",
                  old_value=old_stream.name, new_value=new_stream.name)
    db.commit()
    return item


@router.delete("/roadmap-items/{item_id}", status_code=204)
def delete_roadmap_item(
    item_id: int,
    repo: ports.RoadmapItemRepository = Depends(get_roadmap_item_repo),
    db: Session = Depends(get_db),
    current: User = Depends(require_user),
):
    check_writable(repo)
    item = repo.get(item_id)
    repo.delete(item_id)
    log_event(db, actor=current, event_type="roadmap_item.deleted", entity_type="roadmap_item",
              entity_id=item_id, entity_label=item.title)
    db.commit()


@router.post("/roadmap-items/{item_id}/features", response_model=RoadmapItemRead, status_code=201)
def link_feature(
    item_id: int,
    payload: RoadmapFeatureLink,
    repo: ports.RoadmapItemRepository = Depends(get_roadmap_item_repo),
    db: Session = Depends(get_db),
    current: User = Depends(require_user),
):
    check_writable(repo)
    item = repo.link_feature(item_id, payload.feature_id)
    feature_title = next(
        (f.title for f in item.features if f.id == payload.feature_id), None
    )
    log_event(db, actor=current, event_type="roadmap_item.feature_linked",
              entity_type="roadmap_item", entity_id=item.id, entity_label=item.title,
              field="feature", new_value=feature_title)
    db.commit()
    return item


@router.delete("/roadmap-items/{item_id}/features/{feature_id}", response_model=RoadmapItemRead)
def unlink_feature(
    item_id: int,
    feature_id: int,
    repo: ports.RoadmapItemRepository = Depends(get_roadmap_item_repo),
    db: Session = Depends(get_db),
    current: User = Depends(require_user),
):
    check_writable(repo)
    before = repo.get(item_id)
    feature_title = next(
        (f.title for f in before.features if f.id == feature_id), None
    )
    item = repo.unlink_feature(item_id, feature_id)
    log_event(db, actor=current, event_type="roadmap_item.feature_unlinked",
              entity_type="roadmap_item", entity_id=item.id, entity_label=item.title,
              field="feature", old_value=feature_title)
    db.commit()
    return item
