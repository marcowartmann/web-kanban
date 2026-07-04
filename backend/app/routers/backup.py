from fastapi import APIRouter, Depends, HTTPException
from fastapi.concurrency import run_in_threadpool
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import backup as backup_svc
from app.audit import log_event
from app.auth import require_admin
from app.crypto import decrypt, encrypt
from app.db import get_db
from app.models import BackupConfig, BackupRun, User
from app.schemas import (
    BackupConfigRead,
    BackupConfigUpdate,
    BackupRunRead,
    SftpTestRequest,
)

router = APIRouter(prefix="/api/v1/backup", tags=["backup"],
                   dependencies=[Depends(require_admin)])


def get_config(db: Session) -> BackupConfig:
    cfg = db.get(BackupConfig, 1)
    if cfg is None:  # safety net if the seed row is missing
        cfg = BackupConfig(id=1)
        db.add(cfg)
        db.commit()
        db.refresh(cfg)
    return cfg


def _serialize(cfg: BackupConfig) -> BackupConfigRead:
    read = BackupConfigRead.model_validate(cfg)
    read.has_password = cfg.sftp_password_enc is not None
    return read


@router.get("/config", response_model=BackupConfigRead)
def read_config(db: Session = Depends(get_db)) -> BackupConfigRead:
    return _serialize(get_config(db))


@router.put("/config", response_model=BackupConfigRead)
def update_config(
    payload: BackupConfigUpdate,
    db: Session = Depends(get_db),
    current: User = Depends(require_admin),
) -> BackupConfigRead:
    cfg = get_config(db)
    for field in ("sftp_host", "sftp_port", "sftp_username", "remote_dir",
                  "include_db", "include_snapshots", "schedule_frequency",
                  "schedule_day_of_week", "schedule_time", "enabled"):
        setattr(cfg, field, getattr(payload, field))
    if payload.clear_password:
        cfg.sftp_password_enc = None
    elif payload.password:
        cfg.sftp_password_enc = encrypt(payload.password)
    log_event(db, actor=current, event_type="backup.config_updated",
              entity_type="backup", entity_id=1, entity_label="backup config")
    db.commit()
    db.refresh(cfg)
    return _serialize(cfg)


@router.post("/run", response_model=BackupRunRead)
async def run_now(
    db: Session = Depends(get_db),
    current: User = Depends(require_admin),
) -> BackupRun:
    run = await run_in_threadpool(backup_svc.run_backup, db, "manual")
    log_event(db, actor=current, event_type="backup.ran",
              entity_type="backup", entity_id=run.id, entity_label=run.status)
    db.commit()
    return run


@router.post("/test")
async def test_conn(
    payload: SftpTestRequest,
    db: Session = Depends(get_db),
) -> dict:
    cfg = get_config(db)
    host = payload.sftp_host or cfg.sftp_host
    port = payload.sftp_port or cfg.sftp_port
    username = payload.sftp_username or cfg.sftp_username
    password = payload.password or (decrypt(cfg.sftp_password_enc) if cfg.sftp_password_enc else "")
    remote_dir = payload.remote_dir or cfg.remote_dir
    if not host or not username:
        raise HTTPException(status_code=422, detail="Host and username are required")
    try:
        await run_in_threadpool(backup_svc.test_connection, host, port, username, password, remote_dir)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=str(exc)[:500])
    return {"ok": True}


@router.get("/runs", response_model=list[BackupRunRead])
def list_runs(limit: int = 20, db: Session = Depends(get_db)) -> list[BackupRun]:
    return list(db.scalars(select(BackupRun).order_by(BackupRun.id.desc()).limit(limit)))
