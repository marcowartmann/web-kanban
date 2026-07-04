import gzip
import os
import subprocess
import tarfile
from datetime import datetime, timezone
from pathlib import Path
from tempfile import TemporaryDirectory
from urllib.parse import urlparse

import paramiko
from sqlalchemy.orm import Session

from app.config import settings
from app.crypto import decrypt
from app.models import BackupConfig, BackupRun
from app.snapshots import _snapshot_dir


def _ts() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def dump_db(dest_dir: str) -> Path:
    """pg_dump the configured database, gzipped, into dest_dir."""
    url = urlparse(settings.database_url.replace("postgresql+psycopg", "postgresql"))
    out = Path(dest_dir) / f"kanban-db-{_ts()}.sql.gz"
    env = {**os.environ, "PGPASSWORD": url.password or ""}
    cmd = ["pg_dump", "-h", url.hostname or "db", "-p", str(url.port or 5432),
           "-U", url.username or "kanban", (url.path or "/kanban").lstrip("/")]
    proc = subprocess.run(cmd, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True)
    with gzip.open(out, "wb") as fh:
        fh.write(proc.stdout)
    return out


def archive_snapshots(dest_dir: str) -> Path | None:
    src = _snapshot_dir()
    if not src.is_dir() or not any(src.iterdir()):
        return None
    out = Path(dest_dir) / f"kanban-snapshots-{_ts()}.tar.gz"
    with tarfile.open(out, "w:gz") as tar:
        tar.add(src, arcname="snapshots")
    return out


def _sftp(host: str, port: int, username: str, password: str):
    transport = paramiko.Transport((host, port))
    transport.connect(username=username, password=password)
    return transport, paramiko.SFTPClient.from_transport(transport)


def _mkdir_p(sftp: "paramiko.SFTPClient", remote_dir: str) -> None:
    parts = [p for p in remote_dir.strip("/").split("/") if p]
    path = ""
    for part in parts:
        path = f"{path}/{part}" if path else part
        try:
            sftp.stat(path)
        except FileNotFoundError:
            sftp.mkdir(path)


def upload(cfg: BackupConfig, local_paths: list[Path]) -> None:
    password = decrypt(cfg.sftp_password_enc) if cfg.sftp_password_enc else ""
    transport, sftp = _sftp(cfg.sftp_host, cfg.sftp_port, cfg.sftp_username, password)
    try:
        _mkdir_p(sftp, cfg.remote_dir)
        for p in local_paths:
            sftp.put(str(p), f"{cfg.remote_dir.rstrip('/')}/{p.name}")
    finally:
        sftp.close()
        transport.close()


def test_connection(host: str, port: int, username: str, password: str, remote_dir: str) -> None:
    transport, sftp = _sftp(host, port, username, password)
    try:
        sftp.listdir(".")
    finally:
        sftp.close()
        transport.close()


def run_backup(db: Session, trigger: str) -> BackupRun:
    cfg = db.get(BackupConfig, 1)
    run = BackupRun(trigger=trigger, status="running")
    db.add(run)
    db.commit()
    try:
        with TemporaryDirectory() as tmp:
            paths: list[Path] = []
            if cfg.include_db:
                db_path = dump_db(tmp)
                run.db_file = db_path.name
                paths.append(db_path)
            if cfg.include_snapshots:
                snap_path = archive_snapshots(tmp)
                if snap_path is not None:
                    run.snapshots_file = snap_path.name
                    paths.append(snap_path)
            upload(cfg, paths)
        run.status = "success"
        run.message = f"Uploaded {len(paths)} file(s) to {cfg.remote_dir}"
    except Exception as exc:  # record and surface a friendly message
        run.status = "error"
        run.message = str(exc)[:2000]
    run.finished_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(run)
    return run
