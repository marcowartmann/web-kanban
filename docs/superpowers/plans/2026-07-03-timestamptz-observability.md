# TIMESTAMPTZ + Observability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every stored timestamp a true UTC `timestamptz` serialized with an offset (fixing the UI's local-time shift), add request-ID JSON access logging, and make `/api/health` verify the database.

**Architecture:** Migration 0014 converts all 14 datetime columns with `AT TIME ZONE 'UTC'`; a new `app/timeutil.py` aware `utcnow()` becomes the single Python clock (models' `default=`, auth's re-export). A new `app/request_logging.py` holds a `BaseHTTPMiddleware` + `JsonFormatter` wired via `dictConfig` in main.py; `/api/health` gains a `SELECT 1`. Frontend untouched.

**Tech Stack:** Alembic, SQLAlchemy 2.0 `DateTime(timezone=True)`, Starlette middleware, stdlib logging/json. pytest on SQLite + compose-Postgres dry-runs.

**Spec:** `docs/superpowers/specs/2026-07-03-timestamptz-observability-design.md`

## Global Constraints

- Branch: `feat/timestamptz-observability` off main (978cd72).
- The 14 columns (12 tables) EXACTLY: items.created_at, items.updated_at, item_links.created_at, teams.created_at, team_members.created_at, boards.created_at, lanes.created_at, planning_intervals.created_at, users.created_at, user_sessions.created_at, user_sessions.expires_at, audit_events.created_at, comments.created_at, comments.updated_at.
- Migration 0014 `down_revision = "0013"`; both directions use `postgresql_using=f"{col} AT TIME ZONE 'UTC'"`; MUST dry-run `alembic upgrade head` AND `alembic downgrade 0013` against the compose Postgres, then restore head (standing migration rule; SQLite fixtures never execute DDL).
- `app/timeutil.py` `utcnow()` returns aware `datetime.now(timezone.utc)`. auth.py re-exports it (`from app.timeutil import utcnow`) — the comments router's `from app.auth import utcnow` must keep working. models.py imports from `app.timeutil` (never from app.auth — cycle).
- Access log: logger name `app.access`; JSON keys EXACTLY `ts, level, logger, request_id, method, path, status, duration_ms` (+ `message`, `traceback` on ERROR); level values lowercase. Request-ID accept regex `^[A-Za-z0-9-]{1,64}$`, else `uuid.uuid4().hex`. Response header `X-Request-ID` always set. `/api/health` NEVER produces an access record.
- Health: 200 `{"status":"ok"}` / 503 `{"status":"unavailable"}`; URL `/api/health` unversioned, unchanged.
- Suite math: backend 190 → 194 (T1) → 201 (T2) → 202 (T3; test_health.py pre-existed with test_health_ok — net +1); frontend stays 192 (no FE changes; T4 runs it once for regression).
- ENV (backend tasks): the backend container does NOT bind-mount code. Before pytest (from repo root):
  ```bash
  docker compose exec -T backend sh -c 'rm -rf /app/app /app/alembic /app/tests'
  docker compose cp ./backend/app backend:/app/app
  docker compose cp ./backend/alembic backend:/app/alembic
  docker compose cp ./backend/tests backend:/app/tests
  docker compose exec -T backend python -m pytest -q /app/tests
  ```
  (pytest/httpx/bcrypt already installed in the running container; re-run the `pip install -q "pytest>=8.2" "httpx>=0.27" "bcrypt>=4.1"` line if a rebuilt container lacks them.)

---

### Task 1: Aware UTC everywhere (timeutil, models, migration 0014)

**Files:**
- Create: `backend/app/timeutil.py`
- Modify: `backend/app/auth.py` (replace local utcnow), `backend/app/models.py` (14 columns + imports), `backend/app/snapshots.py` (_revive's DateTime import source)
- Create: `backend/alembic/versions/0014_timestamptz.py`
- Test: `backend/tests/test_timestamptz.py` (new, 4 tests)

**Interfaces:**
- Produces: `app.timeutil.utcnow() -> datetime` (aware); all model datetime columns `DateTime(timezone=True)`; `app.auth.utcnow` still importable (re-export).

- [ ] **Step 1: Write the failing tests** — create `backend/tests/test_timestamptz.py`:

```python
from datetime import datetime

from app.models import Comment, User, UserSession
from app.timeutil import utcnow


def test_item_create_returns_aware_timestamps(client):
    body = client.post("/api/v1/items", json={"kind": "feature", "title": "TZ"}).json()
    detail = client.get(f"/api/v1/items/{body['id']}").json()
    # Pydantic emits Z for exact-UTC; offset forms parse identically in JS new Date().
    assert datetime.fromisoformat(detail["created_at"]).tzinfo is not None
    assert datetime.fromisoformat(detail["updated_at"]).tzinfo is not None


def test_item_update_refreshes_aware_updated_at(client):
    body = client.post("/api/v1/items", json={"kind": "feature", "title": "TZ2"}).json()
    updated = client.patch(
        f"/api/v1/items/{body['id']}", json={"title": "TZ2b", "version": 1}
    ).json()
    assert datetime.fromisoformat(updated["updated_at"]).tzinfo is not None


def test_comment_edit_sets_aware_updated_at(client, db_session):
    item = client.post("/api/v1/items", json={"kind": "feature", "title": "C"}).json()
    comment = client.post(
        f"/api/v1/items/{item['id']}/comments", json={"body": "hi"}
    ).json()
    client.patch(f"/api/v1/comments/{comment['id']}", json={"body": "edited"})
    row = db_session.get(Comment, comment["id"])
    assert row.updated_at is not None and row.updated_at.tzinfo is not None
    assert row.created_at.tzinfo is not None


def test_session_expiry_is_aware(anon_client, db_session):
    from app.auth import hash_password

    user = User(
        email="tz@x.local",
        display_name="TZ",
        password_hash=hash_password("secret123"),
        role="member",
    )
    db_session.add(user)
    db_session.commit()
    resp = anon_client.post(
        "/api/v1/auth/login", json={"email": "tz@x.local", "password": "secret123"}
    )
    assert resp.status_code == 200
    sess = db_session.query(UserSession).filter_by(user_id=user.id).one()
    assert sess.expires_at.tzinfo is not None
    assert sess.expires_at > utcnow()
    assert sess.created_at.tzinfo is not None
```

If `hash_password` has a different name in app/auth.py, use the function the login
flow actually verifies against (read auth.py first) — everything else stays as written.

- [ ] **Step 2: Run — expect FAIL** (`ModuleNotFoundError: app.timeutil`; after a naive
  partial implementation the `endswith("+00:00")` asserts fail because serialized
  datetimes carry no offset).

- [ ] **Step 3: Create `backend/app/timeutil.py`** — `utcnow()` plus a `DateTime`
  TypeDecorator (SQLAlchemy's documented recipe): SQLite's dialect ignores
  `timezone=True` and returns naive values after commit+reload, so the decorator
  normalizes to UTC on bind and attaches `timezone.utc` on result (no-op on Postgres
  timestamptz). Models import `DateTime` from here, keeping the column definitions
  textually `DateTime(timezone=True)`:

```python
from datetime import datetime, timezone

from sqlalchemy import DateTime as _DateTime
from sqlalchemy.types import TypeDecorator


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class DateTime(TypeDecorator):
    """Drop-in for sqlalchemy.DateTime that always round-trips aware UTC,
    even on backends whose dialect ignores ``timezone=True`` (SQLite)."""

    impl = _DateTime
    cache_ok = True

    def process_bind_param(self, value: datetime | None, dialect) -> datetime | None:
        if value is None:
            return None
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)

    def process_result_value(self, value: datetime | None, dialect) -> datetime | None:
        if value is None or value.tzinfo is not None:
            return value
        return value.replace(tzinfo=timezone.utc)
```

  Consequence: `app/snapshots.py`'s `_revive` changes its type-check import to
  `from app.timeutil import DateTime` (the `isinstance(col.type, DateTime)` check
  must match the decorator, not `sqlalchemy.DateTime`).

- [ ] **Step 4: auth.py** — delete the local definition:

```python
def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)
```

and add `from app.timeutil import utcnow` with the app imports. Fix the
`datetime`/`timezone` imports if now unused (keep `timedelta` — `session_ttl` uses it).

- [ ] **Step 5: models.py** — add `from app.timeutil import DateTime, utcnow` after
  the sqlalchemy imports (do NOT import DateTime from sqlalchemy — the timeutil
  decorator is the one that round-trips aware on SQLite). Then convert exactly the
  14 columns:
  - All nine plain `created_at` columns (item_links, teams, team_members, boards,
    lanes, planning_intervals, users, user_sessions, comments) and items.created_at:

```python
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, server_default=func.now()
    )
```

  - items.updated_at (replaces the SQL onupdate with the Python one):

```python
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow, server_default=func.now()
    )
```

  - audit_events.created_at (keeps its index):

```python
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, server_default=func.now(), index=True
    )
```

  - user_sessions.expires_at:

```python
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
```

  - comments.updated_at:

```python
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))  # set on edit
```

- [ ] **Step 6: Create `backend/alembic/versions/0014_timestamptz.py`:**

```python
"""Convert all datetime columns to timestamptz (stored values are UTC).

Revision ID: 0014
Revises: 0013
"""

import sqlalchemy as sa
from alembic import op

revision = "0014"
down_revision = "0013"
branch_labels = None
depends_on = None

COLUMNS = [
    ("items", "created_at"),
    ("items", "updated_at"),
    ("item_links", "created_at"),
    ("teams", "created_at"),
    ("team_members", "created_at"),
    ("boards", "created_at"),
    ("lanes", "created_at"),
    ("planning_intervals", "created_at"),
    ("users", "created_at"),
    ("user_sessions", "created_at"),
    ("user_sessions", "expires_at"),
    ("audit_events", "created_at"),
    ("comments", "created_at"),
    ("comments", "updated_at"),
]


def upgrade() -> None:
    for table, col in COLUMNS:
        op.alter_column(
            table,
            col,
            existing_type=sa.DateTime(),
            type_=sa.DateTime(timezone=True),
            postgresql_using=f"{col} AT TIME ZONE 'UTC'",
        )


def downgrade() -> None:
    for table, col in COLUMNS:
        op.alter_column(
            table,
            col,
            existing_type=sa.DateTime(timezone=True),
            type_=sa.DateTime(),
            postgresql_using=f"{col} AT TIME ZONE 'UTC'",
        )
```

- [ ] **Step 7: Dry-run the migration against compose Postgres** (code was copied in
  Step 8's copy-dance — run that first if needed):

```bash
docker compose exec -T backend alembic upgrade head
docker compose exec -T backend sh -c "psql \"$DATABASE_URL\" -c '\\d items'" 2>/dev/null || docker compose exec -T db psql -U kanban -d kanban -c "select column_name, data_type from information_schema.columns where table_name='items' and column_name in ('created_at','updated_at');"
# expect: timestamp with time zone
docker compose exec -T backend alembic downgrade 0013
docker compose exec -T db psql -U kanban -d kanban -c "select data_type from information_schema.columns where table_name='items' and column_name='created_at';"
# expect: timestamp without time zone
docker compose exec -T backend alembic upgrade head   # leave DB at 0014 (head)
```

Also verify a sample VALUE survives the round trip (compare
`select created_at from items order by id limit 1` before/after — same UTC instant).

- [ ] **Step 8: Full backend suite in the container — expect 194 passed** (190 + 4).
  Sweep any existing tests that fail on aware-vs-naive comparisons and fix them
  minimally (report each in your notes) — none are expected, but the sweep is part of
  this task.
- [ ] **Step 9: Commit** — `git add backend && git commit -m "feat(backend): aware UTC timestamps end to end (timestamptz migration 0014)"`

---

### Task 2: Request-ID middleware + JSON access log

**Files:**
- Create: `backend/app/request_logging.py`
- Modify: `backend/app/main.py` (configure logging + register middleware)
- Test: `backend/tests/test_request_logging.py` (new, 7 tests)

**Interfaces:**
- Consumes: nothing new. Produces: `RequestLoggingMiddleware`, `JsonFormatter`, `configure_access_logging()`; every response carries `X-Request-ID`.

- [ ] **Step 1: Write the failing tests** — create `backend/tests/test_request_logging.py`:

```python
import json
import logging
import re

from fastapi.testclient import TestClient

from app.main import app
from app.request_logging import JsonFormatter, access_logger


def _propagate(monkeypatch):
    # access_logger has propagate=False; caplog captures via root, so re-enable.
    monkeypatch.setattr(access_logger, "propagate", True)


def test_response_carries_generated_request_id(client):
    resp = client.get("/api/v1/items?limit=1")
    rid = resp.headers.get("x-request-id")
    assert rid and re.fullmatch(r"[0-9a-f]{32}", rid)


def test_valid_incoming_request_id_is_echoed(client):
    resp = client.get("/api/v1/items?limit=1", headers={"X-Request-ID": "trace-Abc-123"})
    assert resp.headers["x-request-id"] == "trace-Abc-123"


def test_invalid_incoming_request_id_is_replaced(client):
    resp = client.get("/api/v1/items?limit=1", headers={"X-Request-ID": "bad id!"})
    rid = resp.headers["x-request-id"]
    assert rid != "bad id!" and re.fullmatch(r"[0-9a-f]{32}", rid)


def test_access_record_fields(client, caplog, monkeypatch):
    _propagate(monkeypatch)
    with caplog.at_level(logging.INFO, logger="app.access"):
        resp = client.get("/api/v1/items?limit=1")
    records = [r for r in caplog.records if r.name == "app.access"]
    assert len(records) == 1
    r = records[0]
    assert r.method == "GET"
    assert r.path == "/api/v1/items"
    assert r.status == 200
    assert isinstance(r.duration_ms, int)
    assert r.request_id == resp.headers["x-request-id"]


def test_health_is_exempt_from_access_log(client, caplog, monkeypatch):
    _propagate(monkeypatch)
    with caplog.at_level(logging.INFO, logger="app.access"):
        client.get("/api/health")
    assert [r for r in caplog.records if r.name == "app.access"] == []


def test_unhandled_exception_logs_error_with_request_id(db_session, caplog, monkeypatch):
    _propagate(monkeypatch)
    from app.db import get_db

    app.dependency_overrides[get_db] = lambda: db_session
    try:
        with TestClient(app, raise_server_exceptions=False) as boom_client:
            with caplog.at_level(logging.INFO, logger="app.access"):
                resp = boom_client.get(
                    "/api/v1/_boom", headers={"X-Request-ID": "boom-1"}
                )
    finally:
        app.dependency_overrides.clear()
    assert resp.status_code == 500
    errors = [r for r in caplog.records if r.name == "app.access" and r.levelno == logging.ERROR]
    assert len(errors) == 1
    assert errors[0].request_id == "boom-1"
    assert errors[0].status == 500
    assert errors[0].exc_info is not None


def test_json_formatter_output_keys():
    fmt = JsonFormatter()
    record = logging.LogRecord("app.access", logging.INFO, __file__, 1, "request", None, None)
    record.request_id = "rid1"
    record.method = "GET"
    record.path = "/x"
    record.status = 200
    record.duration_ms = 7
    line = json.loads(fmt.format(record))
    assert set(line) == {"ts", "level", "logger", "request_id", "method", "path", "status", "duration_ms"}
    assert line["level"] == "info"
    assert line["ts"].endswith("+00:00")
    try:
        raise RuntimeError("boom")
    except RuntimeError:
        import sys

        err = logging.LogRecord(
            "app.access", logging.ERROR, __file__, 1, "unhandled exception", None, sys.exc_info()
        )
    err.request_id = "rid2"
    err.method = "GET"
    err.path = "/x"
    err.status = 500
    err.duration_ms = 3
    eline = json.loads(fmt.format(err))
    assert eline["level"] == "error"
    assert eline["message"] == "unhandled exception"
    assert "RuntimeError: boom" in eline["traceback"]
```

The `/api/v1/_boom` test route: add it inside the TEST FILE, at module import time
(unauthenticated on purpose — it exists only in the test process):

```python
@app.get("/api/v1/_boom")
def _boom() -> None:  # pragma: no cover - exercised via TestClient
    raise RuntimeError("boom endpoint")
```

Place this block right after the imports, before the tests.

- [ ] **Step 2: Run — expect FAIL** (`ModuleNotFoundError: app.request_logging`).

- [ ] **Step 3: Create `backend/app/request_logging.py`:**

```python
"""Request-ID middleware and JSON access logging (logger: app.access)."""

import json
import logging
import logging.config
import re
import time
import traceback
import uuid
from datetime import datetime, timezone

from starlette.middleware.base import BaseHTTPMiddleware

access_logger = logging.getLogger("app.access")

REQUEST_ID_RE = re.compile(r"^[A-Za-z0-9-]{1,64}$")

HEALTH_PATH = "/api/health"


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        line: dict = {
            "ts": datetime.fromtimestamp(record.created, tz=timezone.utc).isoformat(),
            "level": record.levelname.lower(),
            "logger": record.name,
            "request_id": getattr(record, "request_id", None),
            "method": getattr(record, "method", None),
            "path": getattr(record, "path", None),
            "status": getattr(record, "status", None),
            "duration_ms": getattr(record, "duration_ms", None),
        }
        if record.levelno >= logging.ERROR:
            line["message"] = record.getMessage()
            if record.exc_info:
                line["traceback"] = "".join(traceback.format_exception(*record.exc_info))
        return json.dumps(line)


class RequestLoggingMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        incoming = request.headers.get("X-Request-ID", "")
        request_id = incoming if REQUEST_ID_RE.fullmatch(incoming) else uuid.uuid4().hex
        start = time.perf_counter()
        try:
            response = await call_next(request)
        except Exception:
            if request.url.path != HEALTH_PATH:
                access_logger.error(
                    "unhandled exception",
                    exc_info=True,
                    extra={
                        "request_id": request_id,
                        "method": request.method,
                        "path": request.url.path,
                        "status": 500,
                        "duration_ms": round((time.perf_counter() - start) * 1000),
                    },
                )
            raise
        response.headers["X-Request-ID"] = request_id
        if request.url.path != HEALTH_PATH:
            access_logger.info(
                "request",
                extra={
                    "request_id": request_id,
                    "method": request.method,
                    "path": request.url.path,
                    "status": response.status_code,
                    "duration_ms": round((time.perf_counter() - start) * 1000),
                },
            )
        return response


def configure_access_logging() -> None:
    logging.config.dictConfig(
        {
            "version": 1,
            "disable_existing_loggers": False,
            "formatters": {"json_access": {"()": "app.request_logging.JsonFormatter"}},
            "handlers": {
                "access_json": {"class": "logging.StreamHandler", "formatter": "json_access"}
            },
            "loggers": {
                "app.access": {
                    "handlers": ["access_json"],
                    "level": "INFO",
                    "propagate": False,
                }
            },
        }
    )
```

- [ ] **Step 4: Wire in `backend/app/main.py`** — after the existing imports add:

```python
from app.request_logging import RequestLoggingMiddleware, configure_access_logging
```

Immediately after `app = FastAPI(...)` is created and the CORS middleware block, add:

```python
configure_access_logging()
app.add_middleware(RequestLoggingMiddleware)
```

(Last-added middleware runs outermost, so the access line also covers CORS-rejected
and 401 responses.)

- [ ] **Step 5: Full backend suite in the container — expect 201 passed** (194 + 7).
- [ ] **Step 6: Commit** — `git add backend && git commit -m "feat(backend): request-ID middleware with JSON access log"`

---

### Task 3: Deep health + uvicorn access-log removal

**Files:**
- Modify: `backend/app/main.py` (health endpoint), `backend/docker-entrypoint.sh`
- Test: `backend/tests/test_health.py` (pre-existing file holding exactly `test_health_ok`;
  gains the 503 test — net +1 collected test, not +2)

**Interfaces:**
- Consumes: `get_db` from app.db. Produces: `/api/health` 200/503 contract.

- [ ] **Step 1: Write the failing tests** — create `backend/tests/test_health.py`:

```python
from fastapi.testclient import TestClient

from app.db import get_db
from app.main import app


def test_health_ok(client):
    resp = client.get("/api/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


def test_health_unavailable_when_db_down():
    class BrokenSession:
        def execute(self, *args, **kwargs):
            raise RuntimeError("db down")

    app.dependency_overrides[get_db] = lambda: BrokenSession()
    try:
        with TestClient(app) as c:
            resp = c.get("/api/health")
    finally:
        app.dependency_overrides.clear()
    assert resp.status_code == 503
    assert resp.json() == {"status": "unavailable"}
```

- [ ] **Step 2: Run — expect** `test_health_unavailable_when_db_down` **to FAIL**
  (current health never touches the DB → returns 200 ok).

- [ ] **Step 3: Implement** — in `backend/app/main.py` extend imports:

```python
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db import SessionLocal, get_db
```

(keep the existing `SessionLocal` usage) and replace the health endpoint:

```python
@app.get("/api/health")
def health(db: Session = Depends(get_db)) -> JSONResponse:
    try:
        db.execute(text("SELECT 1"))
    except Exception:
        return JSONResponse(status_code=503, content={"status": "unavailable"})
    return JSONResponse(content={"status": "ok"})
```

- [ ] **Step 4: `backend/docker-entrypoint.sh`** — the uvicorn line becomes:

```sh
exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --no-access-log
```

- [ ] **Step 5: Full backend suite in the container — expect 202 passed** (201 + 1 net:
  `test_health_ok` already existed in this file and is preserved byte-identically).
  The other pre-existing health assertion elsewhere must also stay green — it asserts
  200 + `{"status":"ok"}`, which still holds.
- [ ] **Step 6: Commit** — `git add backend && git commit -m "feat(backend): deep DB-ping health + structured-only access log"`

---

### Task 4: Deploy + smoke

**Files:**
- None (verification only; containers rebuilt).

- [ ] **Step 1: Rebuild** — `docker compose up -d --build backend frontend` (entrypoint
  runs `alembic upgrade head` → 0014).
- [ ] **Step 2: Suites at HEAD on the new images** — backend copy-dance: expect **202
  passed** (then `docker compose exec -T backend sh -c 'rm -rf /app/tests'` to leave the
  container clean); frontend on host: `npx vitest run` expect **192 passed**, `npx tsc
  --noEmit` clean.
- [ ] **Step 3: Smoke (read-only against live data):**

```bash
docker compose exec -T backend alembic current            # 0014 (head)
docker compose exec -T db psql -U kanban -d kanban -c "select data_type from information_schema.columns where table_name='items' and column_name='created_at';"   # timestamp with time zone
curl -si http://localhost:8080/api/health | head -12       # 200 {"status":"ok"} + X-Request-ID header
curl -si http://localhost:8080/api/health -H 'X-Request-ID: smoke-42' | grep -i x-request-id   # echoed
# authenticated: timestamps now carry offsets
curl -s -c /tmp/kb.jar -X POST http://localhost:8080/api/v1/auth/login -H 'Content-Type: application/json' -d '{"email":"admin@example.com","password":"admin"}' >/dev/null
curl -s -b /tmp/kb.jar 'http://localhost:8080/api/v1/items?limit=1' | python3 -c 'import json,sys; item=json.load(sys.stdin)["items"][0]; print(item["created_at"], item["updated_at"])'
# expect both carrying a UTC designator (Z suffix)
docker compose logs backend --tail 5   # JSON access lines for the API calls; NO lines for /api/health probes
```

- [ ] **Step 4: Report DONE with outputs.** The controller then does the browser check
  (comment/activity timestamps render correct local time).
- [ ] **Step 5: No commit** (nothing changed) — unless Step 2/3 exposed a fix, which
  goes through the controller.
