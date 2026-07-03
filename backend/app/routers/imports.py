import hashlib
import json

from fastapi import APIRouter, Depends, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
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
    RestoreResult,
    SnapshotInfo,
    SnapshotList,
)
from app.snapshots import (
    compute_state_stamp,
    delete_snapshot,
    list_snapshots,
    newest_snapshot_name,
    restore_from_snapshot,
    save_uploaded_snapshot,
    snapshot_path,
    write_snapshot,
)

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
    content = await file.read()
    if hashlib.sha256(content).hexdigest() != file_sha256:
        raise HTTPException(
            status_code=400, detail="Uploaded file does not match the previewed file"
        )
    try:
        rows = read_rows(content)
    except UnicodeDecodeError as exc:
        raise HTTPException(status_code=400, detail=f"File is not valid UTF-8: {exc}")
    parsed = parse_items(rows)
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


@router.get("/import/snapshots", response_model=SnapshotList)
def get_snapshots(current: User = Depends(require_admin)) -> SnapshotList:
    return SnapshotList(snapshots=[SnapshotInfo(**s) for s in list_snapshots()])


@router.post("/import/snapshots", response_model=SnapshotInfo, status_code=201)
def create_snapshot_endpoint(
    db: Session = Depends(get_db),
    current: User = Depends(require_admin),
) -> SnapshotInfo:
    name = write_snapshot(db, actor=current.email)
    log_event(db, actor=current, event_type="snapshot.created",
              entity_type="import", entity_id=None, entity_label=name)
    db.commit()
    info = next(s for s in list_snapshots() if s["name"] == name)
    return SnapshotInfo(**info)


@router.post("/import/snapshots/upload", response_model=SnapshotInfo, status_code=201)
async def upload_snapshot_endpoint(
    file: UploadFile,
    db: Session = Depends(get_db),
    current: User = Depends(require_admin),
) -> SnapshotInfo:
    content = await file.read()
    try:
        info = save_uploaded_snapshot(content)
    except FileExistsError:
        raise HTTPException(status_code=409, detail="This snapshot is already stored")
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    log_event(db, actor=current, event_type="snapshot.uploaded",
              entity_type="import", entity_id=None, entity_label=info["name"])
    db.commit()
    return SnapshotInfo(**info)


@router.delete("/import/snapshots/{name}", status_code=204)
def delete_snapshot_endpoint(
    name: str,
    force: bool = False,
    db: Session = Depends(get_db),
    current: User = Depends(require_admin),
) -> None:
    if snapshot_path(name) is None:
        raise HTTPException(status_code=404, detail="Snapshot not found")
    if not force and name == newest_snapshot_name():
        raise HTTPException(
            status_code=409,
            detail="This is the most recent snapshot (your latest restore point)",
        )
    delete_snapshot(name)
    log_event(db, actor=current, event_type="snapshot.deleted",
              entity_type="import", entity_id=None, entity_label=name)
    db.commit()


@router.get("/import/snapshots/{name}/download")
def download_snapshot(name: str, current: User = Depends(require_admin)) -> FileResponse:
    path = snapshot_path(name)
    if path is None:
        raise HTTPException(status_code=404, detail="Snapshot not found")
    return FileResponse(path, media_type="application/json", filename=name)


@router.post("/import/snapshots/{name}/restore", response_model=RestoreResult)
def restore_snapshot(
    name: str,
    db: Session = Depends(get_db),
    current: User = Depends(require_admin),
) -> RestoreResult:
    path = snapshot_path(name)
    if path is None:
        raise HTTPException(status_code=404, detail="Snapshot not found")
    try:
        data = json.loads(path.read_text())
    except (ValueError, OSError):
        raise HTTPException(status_code=400, detail="Snapshot is unreadable")
    write_snapshot(db, actor=current.email)  # restores are undoable too
    try:
        items, comments, links, warnings = restore_from_snapshot(db, data)
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=f"Restore failed: {exc}")
    log_event(
        db,
        actor=current,
        event_type="import.restored",
        entity_type="import",
        entity_label=name,
        new_value=f"items={items} comments={comments} links={links}",
    )
    db.commit()
    return RestoreResult(items=items, comments=comments, links=links, warnings=warnings)
