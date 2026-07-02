import hashlib

from fastapi import APIRouter, Depends, Form, HTTPException, UploadFile
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.audit import log_event
from app.auth import require_admin
from app.csv_import import parse_items, read_rows, replace_all
from app.db import get_db
from app.models import Comment, Item, ItemKind, ItemLink, User
from app.schemas import (
    ImportPreview,
    ImportPreviewCurrent,
    ImportPreviewIncoming,
    ImportResult,
)
from app.snapshots import compute_state_stamp, write_snapshot

router = APIRouter(prefix="/api/v1", tags=["import"])

TITLE_CAP = 20


async def _read_and_parse(file: UploadFile):
    content = await file.read()
    try:
        rows = read_rows(content)
    except UnicodeDecodeError as exc:
        raise HTTPException(status_code=400, detail=f"File is not valid UTF-8: {exc}")
    return content, parse_items(rows)


@router.post("/import/preview", response_model=ImportPreview)
async def preview_import(
    file: UploadFile,
    db: Session = Depends(get_db),
    current: User = Depends(require_admin),
) -> ImportPreview:
    content, parsed = await _read_and_parse(file)

    incoming_titles = {f.data["title"] for f in parsed.features}
    incoming_titles |= {s.data["title"] for f in parsed.features for s in f.stories}
    incoming_titles |= {r.data["title"] for r in parsed.risks}
    current_titles = set(db.scalars(select(Item.title)))
    added = sorted(incoming_titles - current_titles)
    removed = sorted(current_titles - incoming_titles)

    by_kind = dict(db.execute(select(Item.kind, func.count()).group_by(Item.kind)).all())
    return ImportPreview(
        file_sha256=hashlib.sha256(content).hexdigest(),
        state_stamp=compute_state_stamp(db),
        incoming=ImportPreviewIncoming(
            features=len(parsed.features),
            stories=sum(len(f.stories) for f in parsed.features),
            risks=len(parsed.risks),
            warnings=parsed.warnings,
        ),
        current=ImportPreviewCurrent(
            features=by_kind.get(ItemKind.FEATURE, 0),
            stories=by_kind.get(ItemKind.STORY, 0),
            risks=by_kind.get(ItemKind.RISK, 0),
            comments=db.scalar(select(func.count()).select_from(Comment)) or 0,
            links=db.scalar(select(func.count()).select_from(ItemLink)) or 0,
        ),
        added_titles=added[:TITLE_CAP],
        removed_titles=removed[:TITLE_CAP],
        added_more=max(0, len(added) - TITLE_CAP),
        removed_more=max(0, len(removed) - TITLE_CAP),
    )


@router.post("/import", response_model=ImportResult)
async def import_csv(
    file: UploadFile,
    state_stamp: str = Form(...),
    file_sha256: str = Form(...),
    db: Session = Depends(get_db),
    current: User = Depends(require_admin),
) -> ImportResult:
    content, parsed = await _read_and_parse(file)
    if hashlib.sha256(content).hexdigest() != file_sha256:
        raise HTTPException(
            status_code=400, detail="Uploaded file does not match the previewed file"
        )
    if compute_state_stamp(db) != state_stamp:
        raise HTTPException(
            status_code=409, detail="Data changed since preview — run the preview again"
        )
    try:
        snapshot_name = write_snapshot(db, actor=current.email)
    except OSError:
        raise HTTPException(
            status_code=500, detail="Snapshot could not be written — import aborted"
        )
    try:
        result = replace_all(db, parsed)
    except Exception as exc:  # roll back leaves existing data intact
        db.rollback()
        raise HTTPException(status_code=400, detail=f"Import failed: {exc}")
    # Accepted gap: replace_all committed above, so a crash before the next
    # commit loses only this summary row — never the imported data.
    log_event(
        db,
        actor=current,
        event_type="import.replaced",
        entity_type="import",
        entity_label=file.filename,
        new_value=(
            f"features={result.features} stories={result.stories} "
            f"risks={result.risks} snapshot={snapshot_name}"
        ),
    )
    db.commit()
    return result
