from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.audit import log_event
from app.auth import require_admin
from app.crypto import encrypt
from app.db import get_db
from app.models import BackupConfig, User
from app.schemas import BackupConfigRead, BackupConfigUpdate

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
