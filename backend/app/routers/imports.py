from fastapi import APIRouter, Depends, HTTPException, UploadFile
from sqlalchemy.orm import Session

from app.audit import log_event
from app.auth import require_admin
from app.csv_import import parse_items, read_rows, replace_all
from app.db import get_db
from app.models import User
from app.schemas import ImportResult

router = APIRouter(prefix="/api", tags=["import"])


@router.post("/import", response_model=ImportResult)
async def import_csv(
    file: UploadFile,
    db: Session = Depends(get_db),
    current: User = Depends(require_admin),
) -> ImportResult:
    content = await file.read()
    try:
        rows = read_rows(content)
    except UnicodeDecodeError as exc:
        raise HTTPException(status_code=400, detail=f"File is not valid UTF-8: {exc}")
    parsed = parse_items(rows)
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
        new_value=f"features={result.features} stories={result.stories} risks={result.risks}",
    )
    db.commit()
    return result
