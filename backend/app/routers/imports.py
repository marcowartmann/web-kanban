from fastapi import APIRouter, Depends, HTTPException, UploadFile
from sqlalchemy.orm import Session

from app.auth import require_admin
from app.csv_import import parse_items, read_rows, replace_all
from app.db import get_db
from app.schemas import ImportResult

router = APIRouter(prefix="/api", tags=["import"])


@router.post("/import", response_model=ImportResult, dependencies=[Depends(require_admin)])
async def import_csv(file: UploadFile, db: Session = Depends(get_db)) -> ImportResult:
    content = await file.read()
    try:
        rows = read_rows(content)
    except UnicodeDecodeError as exc:
        raise HTTPException(status_code=400, detail=f"File is not valid UTF-8: {exc}")
    parsed = parse_items(rows)
    try:
        return replace_all(db, parsed)
    except Exception as exc:  # roll back leaves existing data intact
        db.rollback()
        raise HTTPException(status_code=400, detail=f"Import failed: {exc}")
