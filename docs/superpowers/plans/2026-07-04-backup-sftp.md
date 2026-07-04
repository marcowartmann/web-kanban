# Backup to SFTP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admin-configurable scheduled + manual export of the Postgres DB and snapshot files to an SFTP server, with a dockerized SFTP test server.

**Architecture:** A singleton `backup_config` + `backup_runs` history in the DB; a `backup.py` module that builds a `pg_dump` gzip and a snapshots tar.gz and uploads them via paramiko; an APScheduler job started in the FastAPI lifespan and re-scheduled on config save; an admin-only `/backup/*` API; and an Admin → Backup UI. Credentials are Fernet-encrypted at rest.

**Tech Stack:** FastAPI + SQLAlchemy + Alembic + APScheduler + paramiko + cryptography (Fernet) + `pg_dump`; React + TS + vitest.

## Global Constraints

- SFTP auth is **password only**. Schedule presets: `disabled` / `daily` / `weekly` + `HH:MM` **UTC**. Contents: DB dump and snapshots, each toggleable.
- Credentials encrypted at rest with **Fernet**; key = `urlsafe_b64encode(sha256(APP_SECRET).digest())`. API never returns the password (write-only; `has_password: bool`).
- New Alembic revision: `revision = "0023"`, `down_revision = "0022"`; seed one `backup_config` row (id=1). Dry-run upgrade+downgrade on compose Postgres.
- Backend runs a single uvicorn process → exactly one APScheduler instance in `lifespan`.
- Blocking work (pg_dump, paramiko) runs off the event loop (`fastapi.concurrency.run_in_threadpool` for endpoints; APScheduler runs sync jobs in its thread executor).
- Run backend from `backend/`; frontend from `frontend/`; git from repo root.

---

### Task 1: Dependencies + Fernet crypto helper

**Files:**
- Modify: `backend/pyproject.toml` (add deps)
- Modify: `backend/app/config.py` (add `app_secret`)
- Create: `backend/app/crypto.py`
- Test: `backend/tests/test_crypto.py`

**Interfaces:**
- Produces: `encrypt(plain: str) -> str`, `decrypt(cipher: str) -> str`.

- [ ] **Step 1: Add dependencies**

In `backend/pyproject.toml`, add to `dependencies`: `"cryptography>=42"`, `"paramiko>=3.4"`, `"apscheduler>=3.10"`. Then reinstall:

Run: `cd backend && pip install -e ".[dev]"`
Expected: installs cryptography, paramiko, apscheduler.

- [ ] **Step 2: Add the app_secret setting**

In `backend/app/config.py`, add to `Settings` (after `cookie_secure`):

```python
    app_secret: str = "dev-insecure-change-me"
```

- [ ] **Step 3: Write the failing test**

```python
# backend/tests/test_crypto.py
from app.crypto import decrypt, encrypt


def test_encrypt_roundtrip():
    c = encrypt("s3cret-pw")
    assert c != "s3cret-pw"
    assert decrypt(c) == "s3cret-pw"


def test_ciphertext_is_not_deterministic_but_decrypts():
    a, b = encrypt("x"), encrypt("x")
    assert a != b  # Fernet includes a random IV
    assert decrypt(a) == decrypt(b) == "x"
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_crypto.py -q`
Expected: FAIL — `ModuleNotFoundError: app.crypto`.

- [ ] **Step 5: Implement**

```python
# backend/app/crypto.py
import base64
import hashlib

from cryptography.fernet import Fernet

from app.config import settings


def _fernet() -> Fernet:
    key = base64.urlsafe_b64encode(hashlib.sha256(settings.app_secret.encode()).digest())
    return Fernet(key)


def encrypt(plain: str) -> str:
    return _fernet().encrypt(plain.encode()).decode()


def decrypt(cipher: str) -> str:
    return _fernet().decrypt(cipher.encode()).decode()
```

- [ ] **Step 6: Run test + commit**

Run: `cd backend && python -m pytest tests/test_crypto.py -q` → PASS (2).

```bash
cd /Users/marco/Coding/web-kanban
git add backend/pyproject.toml backend/app/config.py backend/app/crypto.py backend/tests/test_crypto.py
git commit -m "feat(backup): deps + Fernet crypto helper"
```

---

### Task 2: Models + migration 0023

**Files:**
- Modify: `backend/app/models.py`
- Create: `backend/alembic/versions/0023_backup.py`
- Test: `backend/tests/test_backup_models.py`

**Interfaces:**
- Produces: `BackupConfig`, `BackupRun` models; tables `backup_config`, `backup_runs`.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_backup_models.py
from app.models import BackupConfig, BackupRun


def test_config_defaults(db_session):
    cfg = BackupConfig(id=1)
    db_session.add(cfg)
    db_session.commit()
    assert cfg.sftp_port == 22
    assert cfg.remote_dir == "upload"
    assert cfg.include_db is True
    assert cfg.include_snapshots is True
    assert cfg.schedule_frequency == "disabled"
    assert cfg.enabled is False


def test_run_row(db_session):
    r = BackupRun(trigger="manual", status="success")
    db_session.add(r)
    db_session.commit()
    assert r.id is not None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_backup_models.py -q`
Expected: FAIL — cannot import `BackupConfig`.

- [ ] **Step 3: Add the models**

In `backend/app/models.py`, append (uses already-imported `Mapped`, `mapped_column`, `Integer`, `String`, `Text`, `DateTime`, `func`, `utcnow`, `datetime`):

```python
class BackupConfig(Base):
    __tablename__ = "backup_config"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)  # singleton row id=1
    sftp_host: Mapped[str | None] = mapped_column(String(255))
    sftp_port: Mapped[int] = mapped_column(Integer, default=22)
    sftp_username: Mapped[str | None] = mapped_column(String(255))
    sftp_password_enc: Mapped[str | None] = mapped_column(Text)
    remote_dir: Mapped[str] = mapped_column(String(512), default="upload")
    include_db: Mapped[bool] = mapped_column(default=True)
    include_snapshots: Mapped[bool] = mapped_column(default=True)
    schedule_frequency: Mapped[str] = mapped_column(String(16), default="disabled")
    schedule_day_of_week: Mapped[int] = mapped_column(Integer, default=0)
    schedule_time: Mapped[str] = mapped_column(String(5), default="02:00")
    enabled: Mapped[bool] = mapped_column(default=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, server_default=func.now(), onupdate=utcnow
    )


class BackupRun(Base):
    __tablename__ = "backup_runs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, server_default=func.now()
    )
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    trigger: Mapped[str] = mapped_column(String(16))
    status: Mapped[str] = mapped_column(String(16))
    db_file: Mapped[str | None] = mapped_column(String(255))
    snapshots_file: Mapped[str | None] = mapped_column(String(255))
    message: Mapped[str | None] = mapped_column(Text)
```

- [ ] **Step 4: Create migration `backend/alembic/versions/0023_backup.py`**

```python
"""backup_config + backup_runs

Revision ID: 0023
Revises: 0022
"""
from alembic import op
import sqlalchemy as sa

revision = "0023"
down_revision = "0022"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "backup_config",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("sftp_host", sa.String(255)),
        sa.Column("sftp_port", sa.Integer, nullable=False, server_default="22"),
        sa.Column("sftp_username", sa.String(255)),
        sa.Column("sftp_password_enc", sa.Text),
        sa.Column("remote_dir", sa.String(512), nullable=False, server_default="upload"),
        sa.Column("include_db", sa.Boolean, nullable=False, server_default=sa.true()),
        sa.Column("include_snapshots", sa.Boolean, nullable=False, server_default=sa.true()),
        sa.Column("schedule_frequency", sa.String(16), nullable=False, server_default="disabled"),
        sa.Column("schedule_day_of_week", sa.Integer, nullable=False, server_default="0"),
        sa.Column("schedule_time", sa.String(5), nullable=False, server_default="02:00"),
        sa.Column("enabled", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.execute("INSERT INTO backup_config (id) VALUES (1)")
    op.create_table(
        "backup_runs",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("started_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True)),
        sa.Column("trigger", sa.String(16), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("db_file", sa.String(255)),
        sa.Column("snapshots_file", sa.String(255)),
        sa.Column("message", sa.Text),
    )


def downgrade() -> None:
    op.drop_table("backup_runs")
    op.drop_table("backup_config")
```

- [ ] **Step 5: Dry-run migration on compose Postgres**

```bash
cd /Users/marco/Coding/web-kanban
docker compose cp backend/alembic/versions/0023_backup.py backend:/app/alembic/versions/0023_backup.py
docker compose exec backend alembic upgrade head
docker compose exec -T db psql -U kanban -d kanban -c "SELECT id, remote_dir, schedule_frequency, enabled FROM backup_config;"
docker compose exec backend alembic downgrade -1
docker compose exec -T db psql -U kanban -d kanban -c "\dt backup*" || echo "dropped OK"
docker compose exec backend alembic upgrade head
```
Expected: upgrade creates both tables + a seeded config row (id=1); downgrade drops them; re-upgrade succeeds.

- [ ] **Step 6: Run test + full backend suite + commit**

Run: `cd backend && python -m pytest tests/test_backup_models.py -q` → PASS.
Run: `cd backend && python -m pytest -q 2>&1 | tail -3` → all pass.

```bash
cd /Users/marco/Coding/web-kanban
git add backend/app/models.py backend/alembic/versions/0023_backup.py backend/tests/test_backup_models.py
git commit -m "feat(backup): config + runs tables (migration 0023)"
```

---

### Task 3: Schemas + config endpoints (GET/PUT, write-only password)

**Files:**
- Modify: `backend/app/schemas.py`
- Create: `backend/app/routers/backup.py`
- Modify: `backend/app/main.py` (register router)
- Test: `backend/tests/test_backup_config_api.py`

**Interfaces:**
- Consumes: `encrypt` (Task 1), `BackupConfig` (Task 2).
- Produces: `GET/PUT /api/v1/backup/config`; helper `get_config(db) -> BackupConfig`; `router`.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_backup_config_api.py
def test_get_config_hides_password_and_reports_flag(client):
    r = client.get("/api/v1/backup/config")
    assert r.status_code == 200
    body = r.json()
    assert "sftp_password_enc" not in body and "password" not in body
    assert body["has_password"] is False
    assert body["remote_dir"] == "upload"


def test_put_sets_password_and_fields(client):
    r = client.put("/api/v1/backup/config", json={
        "sftp_host": "sftp", "sftp_port": 22, "sftp_username": "kanban",
        "password": "kanban", "remote_dir": "upload", "include_db": True,
        "include_snapshots": False, "schedule_frequency": "daily",
        "schedule_day_of_week": 0, "schedule_time": "03:30", "enabled": True,
    })
    assert r.status_code == 200
    assert r.json()["has_password"] is True
    assert r.json()["include_snapshots"] is False
    # password omitted → unchanged
    r2 = client.put("/api/v1/backup/config", json={
        "sftp_host": "sftp2", "sftp_port": 22, "sftp_username": "kanban",
        "remote_dir": "upload", "include_db": True, "include_snapshots": True,
        "schedule_frequency": "disabled", "schedule_day_of_week": 0,
        "schedule_time": "02:00", "enabled": False,
    })
    assert r2.json()["has_password"] is True  # still set
    # clear_password clears it
    r3 = client.put("/api/v1/backup/config", json={
        "sftp_host": "sftp2", "sftp_port": 22, "sftp_username": "kanban",
        "remote_dir": "upload", "include_db": True, "include_snapshots": True,
        "schedule_frequency": "disabled", "schedule_day_of_week": 0,
        "schedule_time": "02:00", "enabled": False, "clear_password": True,
    })
    assert r3.json()["has_password"] is False


def test_config_requires_admin(member_client):
    assert member_client.get("/api/v1/backup/config").status_code == 403
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_backup_config_api.py -q`
Expected: FAIL — 404 (router not registered).

- [ ] **Step 3: Add schemas**

In `backend/app/schemas.py`, append:

```python
class BackupConfigRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    sftp_host: str | None
    sftp_port: int
    sftp_username: str | None
    remote_dir: str
    include_db: bool
    include_snapshots: bool
    schedule_frequency: str
    schedule_day_of_week: int
    schedule_time: str
    enabled: bool
    has_password: bool = False


class BackupConfigUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    sftp_host: str | None = None
    sftp_port: int = 22
    sftp_username: str | None = None
    password: str | None = None
    clear_password: bool = False
    remote_dir: str = "upload"
    include_db: bool = True
    include_snapshots: bool = True
    schedule_frequency: str = "disabled"
    schedule_day_of_week: int = 0
    schedule_time: str = "02:00"
    enabled: bool = False


class BackupRunRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    started_at: datetime
    finished_at: datetime | None
    trigger: str
    status: str
    db_file: str | None
    snapshots_file: str | None
    message: str | None


class SftpTestRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    sftp_host: str | None = None
    sftp_port: int | None = None
    sftp_username: str | None = None
    password: str | None = None
    remote_dir: str | None = None
```

- [ ] **Step 4: Create the router (config endpoints)**

```python
# backend/app/routers/backup.py
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
    # Task 6 adds: reschedule(db) here.
    return _serialize(cfg)
```

- [ ] **Step 5: Register the router**

In `backend/app/main.py`: add `backup` to `from app.routers import ...` and add `backup.router,` to the `protected` tuple.

- [ ] **Step 6: Run test + commit**

Run: `cd backend && python -m pytest tests/test_backup_config_api.py -q` → PASS (3).

```bash
cd /Users/marco/Coding/web-kanban
git add backend/app/schemas.py backend/app/routers/backup.py backend/app/main.py backend/tests/test_backup_config_api.py
git commit -m "feat(backup): config get/put endpoints (write-only password)"
```

---

### Task 4: Backup module (dump + archive + upload)

**Files:**
- Create: `backend/app/backup.py`
- Test: `backend/tests/test_backup_run.py`

**Interfaces:**
- Consumes: `decrypt` (Task 1), `BackupConfig`/`BackupRun` (Task 2), `_snapshot_dir` (`app.snapshots`).
- Produces: `dump_db(dest_dir) -> Path`, `archive_snapshots(dest_dir) -> Path | None`, `upload(cfg, local_paths) -> None`, `test_connection(host, port, username, password, remote_dir) -> None`, `run_backup(db, trigger) -> BackupRun`.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_backup_run.py
from pathlib import Path

import app.backup as backup
from app.models import BackupConfig, BackupRun


def _config(db, **over):
    cfg = db.get(BackupConfig, 1) or BackupConfig(id=1)
    cfg.sftp_host, cfg.sftp_username = "sftp", "kanban"
    from app.crypto import encrypt
    cfg.sftp_password_enc = encrypt("kanban")
    cfg.include_db, cfg.include_snapshots = True, True
    for k, v in over.items():
        setattr(cfg, k, v)
    db.add(cfg); db.commit()
    return cfg


def test_run_backup_success(db_session, tmp_path, monkeypatch):
    _config(db_session)
    monkeypatch.setattr(backup, "dump_db", lambda d: Path(d) / "kanban-db-x.sql.gz")
    monkeypatch.setattr(backup, "archive_snapshots", lambda d: Path(d) / "kanban-snapshots-x.tar.gz")
    uploaded = []
    monkeypatch.setattr(backup, "upload", lambda cfg, paths: uploaded.extend(p.name for p in paths))
    run = backup.run_backup(db_session, trigger="manual")
    assert run.status == "success"
    assert run.db_file == "kanban-db-x.sql.gz"
    assert run.snapshots_file == "kanban-snapshots-x.tar.gz"
    assert set(uploaded) == {"kanban-db-x.sql.gz", "kanban-snapshots-x.tar.gz"}


def test_run_backup_records_error(db_session, tmp_path, monkeypatch):
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
    from pathlib import Path as P
    monkeypatch.setattr(backup, "dump_db", lambda d: P(d) / "db.sql.gz")
    called = {"snap": False}
    monkeypatch.setattr(backup, "archive_snapshots", lambda d: called.__setitem__("snap", True))
    monkeypatch.setattr(backup, "upload", lambda cfg, paths: None)
    run = backup.run_backup(db_session, trigger="manual")
    assert called["snap"] is False and run.snapshots_file is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_backup_run.py -q`
Expected: FAIL — `ModuleNotFoundError: app.backup`.

- [ ] **Step 3: Implement**

```python
# backend/app/backup.py
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
    with gzip.open(out, "wb") as fh:
        proc = subprocess.run(cmd, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True)
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
```

- [ ] **Step 4: Run test + commit**

Run: `cd backend && python -m pytest tests/test_backup_run.py -q` → PASS (3).

```bash
cd /Users/marco/Coding/web-kanban
git add backend/app/backup.py backend/tests/test_backup_run.py
git commit -m "feat(backup): dump/archive/upload + run_backup"
```

---

### Task 5: run / test / runs endpoints

**Files:**
- Modify: `backend/app/routers/backup.py`
- Test: `backend/tests/test_backup_run_api.py`

**Interfaces:**
- Consumes: `run_backup`, `test_connection` (Task 4), `decrypt` (Task 1).
- Produces: `POST /backup/run`, `POST /backup/test`, `GET /backup/runs`.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_backup_run_api.py
import app.backup as backup
from app.models import BackupRun


def test_run_now_invokes_backup(client, db_session, monkeypatch):
    def fake_run(db, trigger):
        r = BackupRun(trigger=trigger, status="success", message="ok")
        db.add(r); db.commit(); db.refresh(r)
        return r
    monkeypatch.setattr(backup, "run_backup", fake_run)
    r = client.post("/api/v1/backup/run")
    assert r.status_code == 200
    assert r.json()["status"] == "success" and r.json()["trigger"] == "manual"


def test_runs_list_newest_first(client, db_session):
    for i in range(3):
        db_session.add(BackupRun(trigger="manual", status="success", message=f"r{i}"))
    db_session.commit()
    rows = client.get("/api/v1/backup/runs").json()
    assert len(rows) == 3
    assert rows[0]["id"] > rows[-1]["id"]


def test_test_connection_reports_failure(client, monkeypatch):
    def boom(*a, **k):
        raise OSError("no route to host")
    monkeypatch.setattr(backup, "test_connection", boom)
    r = client.post("/api/v1/backup/test", json={"sftp_host": "nope"})
    assert r.status_code == 422
    assert "no route to host" in r.json()["detail"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_backup_run_api.py -q`
Expected: FAIL — 404/405 (endpoints missing).

- [ ] **Step 3: Add the endpoints**

Append to `backend/app/routers/backup.py` (extend imports:
`from fastapi import APIRouter, Depends, HTTPException`;
`from fastapi.concurrency import run_in_threadpool`;
`from sqlalchemy import select`;
`from app import backup as backup_svc`;
`from app.crypto import decrypt`;
`from app.models import BackupConfig, BackupRun, User`;
`from app.schemas import ..., BackupRunRead, SftpTestRequest`):

```python
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
```

- [ ] **Step 4: Run test + full suite + commit**

Run: `cd backend && python -m pytest tests/test_backup_run_api.py -q` → PASS (3).
Run: `cd backend && python -m pytest -q 2>&1 | tail -3` → all pass.

```bash
cd /Users/marco/Coding/web-kanban
git add backend/app/routers/backup.py backend/tests/test_backup_run_api.py
git commit -m "feat(backup): run/test/runs endpoints"
```

---

### Task 6: Scheduler (APScheduler in lifespan)

**Files:**
- Create: `backend/app/scheduler.py`
- Modify: `backend/app/main.py` (lifespan start/stop)
- Modify: `backend/app/routers/backup.py` (call `reschedule` on save)
- Test: `backend/tests/test_scheduler.py`

**Interfaces:**
- Consumes: `run_backup` (Task 4), `BackupConfig` (Task 2), `SessionLocal` (`app.db`).
- Produces: `cron_kwargs(cfg) -> dict | None`; `start()`, `reschedule(db)`, `shutdown()`.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_scheduler.py
from app.models import BackupConfig
from app.scheduler import cron_kwargs


def test_daily_cron():
    cfg = BackupConfig(id=1, enabled=True, schedule_frequency="daily", schedule_time="03:30")
    assert cron_kwargs(cfg) == {"hour": 3, "minute": 30}


def test_weekly_cron():
    cfg = BackupConfig(id=1, enabled=True, schedule_frequency="weekly",
                       schedule_day_of_week=2, schedule_time="23:05")
    assert cron_kwargs(cfg) == {"day_of_week": 2, "hour": 23, "minute": 5}


def test_disabled_or_off_returns_none():
    assert cron_kwargs(BackupConfig(id=1, enabled=True, schedule_frequency="disabled")) is None
    assert cron_kwargs(BackupConfig(id=1, enabled=False, schedule_frequency="daily", schedule_time="01:00")) is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_scheduler.py -q`
Expected: FAIL — cannot import `cron_kwargs`.

- [ ] **Step 3: Implement**

```python
# backend/app/scheduler.py
import logging

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from sqlalchemy.orm import Session

from app import backup as backup_svc
from app.db import SessionLocal
from app.models import BackupConfig

_log = logging.getLogger("uvicorn")
_scheduler: AsyncIOScheduler | None = None
_JOB_ID = "backup"


def cron_kwargs(cfg: BackupConfig) -> dict | None:
    if not cfg.enabled or cfg.schedule_frequency == "disabled":
        return None
    hour, minute = (int(x) for x in cfg.schedule_time.split(":"))
    if cfg.schedule_frequency == "weekly":
        return {"day_of_week": cfg.schedule_day_of_week, "hour": hour, "minute": minute}
    return {"hour": hour, "minute": minute}


def _run_scheduled() -> None:
    with SessionLocal() as db:
        run = backup_svc.run_backup(db, trigger="scheduled")
        _log.info("scheduled backup: %s (%s)", run.status, run.message)


def reschedule(db: Session) -> None:
    if _scheduler is None:
        return
    cfg = db.get(BackupConfig, 1)
    _scheduler.remove_all_jobs()
    kwargs = cron_kwargs(cfg) if cfg else None
    if kwargs is not None:
        _scheduler.add_job(_run_scheduled, CronTrigger(timezone="UTC", **kwargs), id=_JOB_ID)
        _log.info("backup scheduled: %s", kwargs)


def start() -> None:
    global _scheduler
    _scheduler = AsyncIOScheduler(timezone="UTC")
    _scheduler.start()
    with SessionLocal() as db:
        reschedule(db)


def shutdown() -> None:
    if _scheduler is not None:
        _scheduler.shutdown(wait=False)
```

- [ ] **Step 4: Wire into lifespan**

In `backend/app/main.py`, import `from app import scheduler` and update `lifespan`:

```python
@asynccontextmanager
async def lifespan(app: FastAPI):
    if settings.bootstrap_admin:
        with SessionLocal() as db:
            ensure_initial_admin(db)
            logging.getLogger("uvicorn").info(
                "auth bootstrap: initial admin is %s", settings.initial_admin_email
            )
    scheduler.start()
    try:
        yield
    finally:
        scheduler.shutdown()
```

- [ ] **Step 5: Re-schedule on config save**

In `backend/app/routers/backup.py`, add `from app.scheduler import reschedule` and call `reschedule(db)` at the end of `update_config` (after `db.refresh(cfg)`, before returning).

- [ ] **Step 6: Run test + full suite + commit**

Run: `cd backend && python -m pytest tests/test_scheduler.py -q` → PASS (3).
Run: `cd backend && python -m pytest -q 2>&1 | tail -3` → all pass (the config API tests still pass; `reschedule` is a no-op when `_scheduler is None` under tests).

```bash
cd /Users/marco/Coding/web-kanban
git add backend/app/scheduler.py backend/app/main.py backend/app/routers/backup.py backend/tests/test_scheduler.py
git commit -m "feat(backup): APScheduler cron from presets, wired in lifespan"
```

---

### Task 7: Infra — pg_dump in image, SFTP service, APP_SECRET

**Files:**
- Modify: `backend/Dockerfile` (postgresql-client-18)
- Modify: `docker-compose.yml` (sftp service, APP_SECRET, sftp_data volume)
- Modify: `.env.example`

**Interfaces:** none (deployment).

- [ ] **Step 1: Add postgresql-client-18 to the backend image**

In `backend/Dockerfile`, before `RUN pip install --no-cache-dir .`:

```dockerfile
# pg_dump (v18, matching the server) for database backups.
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates gnupg \
 && install -d /usr/share/postgresql-common/pgdg \
 && curl -fsSL -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc https://www.postgresql.org/media/keys/ACCC4CF8.asc \
 && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt $(. /etc/os-release && echo $VERSION_CODENAME)-pgdg main" > /etc/apt/sources.list.d/pgdg.list \
 && apt-get update && apt-get install -y --no-install-recommends postgresql-client-18 \
 && rm -rf /var/lib/apt/lists/*
```

- [ ] **Step 2: Add the sftp service + APP_SECRET + volume to docker-compose.yml**

Add the `APP_SECRET` env to the `backend` service `environment:`:

```yaml
      APP_SECRET: ${APP_SECRET:-dev-insecure-change-me}
```

Add a new service (top-level under `services:`):

```yaml
  sftp:
    image: atmoz/sftp:alpine
    command: ["${SFTP_USER:-kanban}:${SFTP_PASSWORD:-kanban}:::upload"]
    volumes:
      - sftp_data:/home/${SFTP_USER:-kanban}/upload
    ports:
      - "127.0.0.1:${SFTP_PORT:-2222}:22"
```

Add `sftp_data:` under the top-level `volumes:`.

- [ ] **Step 3: Document env in .env.example**

Append to `.env.example`:

```bash
# Backup encryption key (encrypts stored SFTP password). Change in production.
APP_SECRET=dev-insecure-change-me
# Dev SFTP target (atmoz/sftp)
SFTP_USER=kanban
SFTP_PASSWORD=kanban
SFTP_PORT=2222
```

- [ ] **Step 4: Build + bring up; verify pg_dump present and sftp reachable**

```bash
cd /Users/marco/Coding/web-kanban
docker compose build backend
docker compose up -d db backend sftp
docker compose exec backend pg_dump --version
docker compose exec backend python -c "import socket; s=socket.create_connection(('sftp',22),5); print('sftp reachable'); s.close()"
```
Expected: `pg_dump (PostgreSQL) 18.x`; `sftp reachable`.

- [ ] **Step 5: Commit**

```bash
cd /Users/marco/Coding/web-kanban
git add backend/Dockerfile docker-compose.yml .env.example
git commit -m "feat(backup): pg_dump-18 in image + atmoz/sftp dev service + APP_SECRET"
```

---

### Task 8: Frontend types + API client

**Files:**
- Modify: `frontend/src/types.ts`
- Modify: `frontend/src/api/client.ts`

**Interfaces:**
- Produces: `BackupConfig`, `BackupRun` types; `getBackupConfig`, `saveBackupConfig`, `testBackup`, `runBackup`, `getBackupRuns`.

- [ ] **Step 1: Add types**

In `frontend/src/types.ts`:

```ts
export interface BackupConfig {
  sftp_host: string | null;
  sftp_port: number;
  sftp_username: string | null;
  remote_dir: string;
  include_db: boolean;
  include_snapshots: boolean;
  schedule_frequency: "disabled" | "daily" | "weekly";
  schedule_day_of_week: number;
  schedule_time: string;
  enabled: boolean;
  has_password: boolean;
}

export interface BackupRun {
  id: number;
  started_at: string;
  finished_at: string | null;
  trigger: "manual" | "scheduled";
  status: "success" | "error" | "running";
  db_file: string | null;
  snapshots_file: string | null;
  message: string | null;
}
```

- [ ] **Step 2: Add client fns**

Append to `frontend/src/api/client.ts` (import the two types at top):

```ts
export function getBackupConfig(): Promise<BackupConfig> {
  return request<BackupConfig>(`${API}/backup/config`);
}
export function saveBackupConfig(
  body: Omit<BackupConfig, "has_password"> & { password?: string; clear_password?: boolean },
): Promise<BackupConfig> {
  return request<BackupConfig>(`${API}/backup/config`, { ...json(body), method: "PUT" });
}
export function testBackup(
  body: { sftp_host?: string; sftp_port?: number; sftp_username?: string; password?: string; remote_dir?: string },
): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`${API}/backup/test`, json(body));
}
export function runBackup(): Promise<BackupRun> {
  return request<BackupRun>(`${API}/backup/run`, { method: "POST" });
}
export function getBackupRuns(): Promise<BackupRun[]> {
  return request<BackupRun[]>(`${API}/backup/runs`);
}
```

- [ ] **Step 3: Typecheck + commit**

Run: `cd frontend && npm run build` → clean.

```bash
cd /Users/marco/Coding/web-kanban
git add frontend/src/types.ts frontend/src/api/client.ts
git commit -m "feat(backup): frontend types + api client"
```

---

### Task 9: Backup admin section + nav entry

**Files:**
- Create: `frontend/src/components/admin/BackupSection.tsx`
- Modify: `frontend/src/components/admin/AdminView.tsx` (nav entry + render)
- Test: `frontend/src/components/admin/BackupSection.test.tsx`

**Interfaces:**
- Consumes: client fns + types (Task 8); `FontAwesomeIcon`, `faCloudArrowUp` (add to `src/icons.ts`), `PlainSelect`, admin UI classes.

- [ ] **Step 1: Add the nav entry**

In `frontend/src/icons.ts`, add `faCloudArrowUp` to the duotone re-export list.

In `frontend/src/components/admin/AdminView.tsx`:
- import `BackupSection` and `faCloudArrowUp`.
- extend `AdminSection` union with `"backup"`.
- add to `SECTIONS`: `{ id: "backup", label: "Backup", icon: faCloudArrowUp }`.
- render: `{section === "backup" && <BackupSection />}`.

- [ ] **Step 2: Write the failing test**

```tsx
// frontend/src/components/admin/BackupSection.test.tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import * as client from "../../api/client";
import type { BackupConfig } from "../../types";
import BackupSection from "./BackupSection";

afterEach(() => vi.restoreAllMocks());

const cfg: BackupConfig = {
  sftp_host: "sftp", sftp_port: 22, sftp_username: "kanban", remote_dir: "upload",
  include_db: true, include_snapshots: true, schedule_frequency: "daily",
  schedule_day_of_week: 0, schedule_time: "02:00", enabled: true, has_password: true,
};

it("loads config, masks the password, and runs a backup", async () => {
  vi.spyOn(client, "getBackupConfig").mockResolvedValue(cfg);
  vi.spyOn(client, "getBackupRuns").mockResolvedValue([]);
  const run = vi.spyOn(client, "runBackup").mockResolvedValue({
    id: 1, started_at: "", finished_at: "", trigger: "manual", status: "success",
    db_file: "db.gz", snapshots_file: null, message: "ok",
  });
  render(<BackupSection />);
  expect(await screen.findByDisplayValue("sftp")).toBeInTheDocument();
  // password field is empty (write-only) with a "set" hint
  expect(screen.getByLabelText(/password/i)).toHaveValue("");
  expect(screen.getByText(/password is set/i)).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: /run now/i }));
  await waitFor(() => expect(run).toHaveBeenCalled());
  expect(await screen.findByText(/success/i)).toBeInTheDocument();
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/components/admin/BackupSection.test.tsx`
Expected: FAIL — cannot resolve `./BackupSection`.

- [ ] **Step 4: Implement `BackupSection.tsx`**

Build a card (reuse `adminCardClass`/`adminInputClass` from `./AdminCard`) with:
- state `cfg` loaded from `getBackupConfig()` and `runs` from `getBackupRuns()`; a separate `password` state (starts `""`).
- **SFTP fields**: host, port (number), username, `remote_dir`; a password `<input type="password" aria-label="SFTP password">` bound to `password`, with a hint "Password is set — leave blank to keep" when `cfg.has_password`.
- **Contents**: two checkboxes bound to `include_db` / `include_snapshots`.
- **Schedule**: an `enabled` checkbox; a `PlainSelect` for frequency (Disabled/Daily/Weekly mapping to the union); when `weekly`, a `PlainSelect` for day-of-week (Mon..Sun → 0..6); a `schedule_time` `<input placeholder="HH:MM">`; caption "times are UTC".
- **Buttons**: Test connection (`testBackup({...form, password})` → show ok/error), Save (`saveBackupConfig({...cfg without has_password, password: password || undefined})` then reload + clear the local password field), Run now (`runBackup()` then prepend to `runs`, show status).
- **Recent runs** table: started_at (localized), trigger, status (green `text-emerald-600` / red `text-red-600`), files, message.

Use `PlainSelect` for the dropdowns and the existing `btnPrimary`/`btnSecondary`/`btnGhost` from `../ui`. Keep the password out of state unless typed. Match the visual style of the other admin sections (e.g. `TeamsSection`).

- [ ] **Step 5: Run test + full suite + build**

Run: `cd frontend && npx vitest run src/components/admin/BackupSection.test.tsx` → PASS.
Run: `cd frontend && npm run build` → clean; `npm test` → all pass.

- [ ] **Step 6: Commit**

```bash
cd /Users/marco/Coding/web-kanban
git add frontend/src/icons.ts frontend/src/components/admin/AdminView.tsx frontend/src/components/admin/BackupSection.tsx frontend/src/components/admin/BackupSection.test.tsx
git commit -m "feat(backup): Admin Backup section (config, test, run, history)"
```

---

### Task 10: End-to-end Docker verification

- [ ] **Step 1: Bring up the full stack with the SFTP server**

```bash
cd /Users/marco/Coding/web-kanban
FONTAWESOME_PACKAGE_TOKEN="$(tr -d '\n' < frontend/.fa-token)" docker compose build backend frontend
docker compose up -d
```

- [ ] **Step 2: Configure + run a backup from the UI**

In the app: Admin → Backup. Set host `sftp`, port `22`, user `kanban`, password `kanban`, remote dir `upload`; enable DB + snapshots. Click **Test connection** (expect success), then **Run now**.

- [ ] **Step 3: Confirm the files landed on the SFTP server**

```bash
docker compose exec sftp ls -la /home/kanban/upload
```
Expected: `kanban-db-*.sql.gz` and (if snapshots exist) `kanban-snapshots-*.tar.gz`. The Recent runs table shows a `success` row.

- [ ] **Step 4: (optional) verify the schedule installs**

Set frequency Daily at a near-future UTC time, Save, and confirm the backend log prints `backup scheduled: {...}`.

---

## After all tasks

Use **superpowers:finishing-a-development-branch**: verify backend + frontend suites, then present merge/PR/keep/discard options.

## Self-Review notes

- **Spec coverage:** crypto (T1), model+migration+seed (T2), config API write-only password (T3), dump/archive/upload/run_backup (T4), run/test/runs endpoints (T5), scheduler presets→cron + lifespan + reschedule-on-save (T6), pg_dump image + atmoz/sftp + APP_SECRET (T7), FE types/client (T8), Backup UI + nav (T9), E2E (T10). All spec sections mapped.
- **Type consistency:** `BackupConfig`/`BackupRun` fields, `has_password`, `clear_password`, `cron_kwargs`, `run_backup(db, trigger)`, `test_connection(host,port,username,password,remote_dir)`, and the client fn names are used identically across tasks.
- **No placeholders:** every step has concrete code/commands.
- **Watch items (flagged for executor):** confirm `python:3.14-slim` is Debian trixie so `postgresql-client-18` resolves via PGDG (adjust codename if not); the config-API tests run with `_scheduler is None`, so `reschedule` no-ops there; `db.get(BackupConfig, 1)` relies on the migration's seed row (Task 2).
