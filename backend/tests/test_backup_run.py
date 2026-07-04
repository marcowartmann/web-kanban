from pathlib import Path

import app.backup as backup
from app.crypto import encrypt
from app.models import BackupConfig


def _config(db, **over):
    cfg = db.get(BackupConfig, 1) or BackupConfig(id=1)
    cfg.sftp_host, cfg.sftp_username = "sftp", "kanban"
    cfg.sftp_password_enc = encrypt("kanban")
    cfg.include_db, cfg.include_snapshots = True, True
    for k, v in over.items():
        setattr(cfg, k, v)
    db.add(cfg)
    db.commit()
    return cfg


def test_run_backup_success(db_session, monkeypatch):
    _config(db_session)
    monkeypatch.setattr(backup, "dump_db", lambda d: Path(d) / "kanban-db-x.sql.gz")
    monkeypatch.setattr(backup, "archive_snapshots", lambda d: Path(d) / "kanban-snapshots-x.tar.gz")
    uploaded: list[str] = []
    monkeypatch.setattr(backup, "upload", lambda cfg, paths: uploaded.extend(p.name for p in paths))
    run = backup.run_backup(db_session, trigger="manual")
    assert run.status == "success"
    assert run.db_file == "kanban-db-x.sql.gz"
    assert run.snapshots_file == "kanban-snapshots-x.tar.gz"
    assert set(uploaded) == {"kanban-db-x.sql.gz", "kanban-snapshots-x.tar.gz"}


def test_run_backup_records_error(db_session, monkeypatch):
    _config(db_session)
    monkeypatch.setattr(backup, "dump_db", lambda d: Path(d) / "db.sql.gz")
    monkeypatch.setattr(backup, "archive_snapshots", lambda d: None)

    def boom(cfg, paths):
        raise RuntimeError("connection refused")

    monkeypatch.setattr(backup, "upload", boom)
    run = backup.run_backup(db_session, trigger="scheduled")
    assert run.status == "error"
    assert "connection refused" in run.message


def test_run_backup_respects_toggles(db_session, monkeypatch):
    _config(db_session, include_snapshots=False)
    monkeypatch.setattr(backup, "dump_db", lambda d: Path(d) / "db.sql.gz")
    called = {"snap": False}
    monkeypatch.setattr(backup, "archive_snapshots", lambda d: called.__setitem__("snap", True))
    monkeypatch.setattr(backup, "upload", lambda cfg, paths: None)
    run = backup.run_backup(db_session, trigger="manual")
    assert called["snap"] is False and run.snapshots_file is None
