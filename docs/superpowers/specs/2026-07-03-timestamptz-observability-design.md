# True UTC Timestamps (TIMESTAMPTZ) + Basic Observability — Design

**Date:** 2026-07-03
**Status:** Approved (design); pending spec review
**Context:** P4, the last sub-project of the enterprise-hardening package (P1 reference
integrity 839de24, P2 concurrency + /api/v1 b2e7ccc, P3 import safety c6513d8 — all merged).
CI is explicitly out of scope per the user.

## Problem

Every datetime column is `timestamp without time zone`. The DB runs UTC (verified:
container TZ `Etc/UTC`), so stored values are UTC wall-time — but Pydantic serializes
them offset-less (`2026-06-30T21:48:32`), and all four date-rendering components
(`ItemComments`, `ItemActivity`, `AuditLogSection`, `SnapshotsSection`) call
`new Date(s).toLocaleString()`, which treats offset-less strings as **local** time.
Every timestamp in the UI is shifted by the viewer's UTC offset. Separately, the API
has no request correlation ids, uvicorn's access log is unstructured, and
`/api/health` returns 200 even when the database is down.

## Part A — TIMESTAMPTZ end to end

### Column inventory (all 14, across 12 tables)

`items.created_at`, `items.updated_at`, `item_links.created_at`, `teams.created_at`,
`team_members.created_at`, `boards.created_at`, `lanes.created_at`,
`planning_intervals.created_at`, `users.created_at`, `user_sessions.created_at`,
`user_sessions.expires_at`, `audit_events.created_at`, `comments.created_at`,
`comments.updated_at`.

### Migration `0014_timestamptz` (`down_revision = "0013"`)

For each column above:

```python
op.alter_column("items", "created_at",
    type_=sa.DateTime(timezone=True),
    postgresql_using="created_at AT TIME ZONE 'UTC'")
```

Downgrade mirrors back to `sa.DateTime()` with the same
`postgresql_using="<col> AT TIME ZONE 'UTC'"` (timestamptz → naive UTC). Lossless in
both directions because stored naive values are UTC. On PostgreSQL ≥ 12 with a UTC
session timezone this is metadata-only (no table rewrite). Per the standing migration
rule, the task dry-runs `alembic upgrade head` + `downgrade 0013` against the compose
Postgres and restores head.

### Shared clock: `backend/app/timeutil.py` (new)

```python
from datetime import datetime, timezone


def utcnow() -> datetime:
    return datetime.now(timezone.utc)
```

- `app/auth.py` deletes its own naive `utcnow` and re-exports:
  `from app.timeutil import utcnow` (the comments router imports `utcnow` from
  `app.auth` — untouched). Models import from `app.timeutil` (importing `app.auth`
  from models would be a cycle).

### Models

Every column in the inventory becomes `DateTime(timezone=True)` and gains a
Python-side aware default so SQLite tests and core inserts produce aware values too
(`server_default=func.now()` stays for raw SQL). **`DateTime` here is a thin
`TypeDecorator` in `app/timeutil.py`** (impl `sa.DateTime`, the documented SQLAlchemy
recipe): SQLite's dialect ignores the `timezone` flag and returns naive values, so the
decorator normalizes to UTC on bind and attaches `timezone.utc` on result — a no-op on
PostgreSQL's native timestamptz, and it keeps old naive-UTC snapshot restores correct.
`app/snapshots.py`'s `_revive` imports this `DateTime` for its column-type check.

```python
created_at: Mapped[datetime] = mapped_column(
    DateTime(timezone=True), default=utcnow, server_default=func.now()
)
```

Specifics:
- `items.updated_at`: `default=utcnow, onupdate=utcnow, server_default=func.now()` —
  the Python `onupdate` replaces the SQL `onupdate=func.now()` so updates are aware
  under SQLite as well. (P3's restore already pins `updated_at` explicitly in its
  two-pass update, so the auto-inject behavior change is inert there.)
- `user_sessions.expires_at` and `comments.updated_at` (nullable, set on edit) have no
  defaults today and gain none — they are Python-written via `utcnow()`, which is now
  aware.
- `audit_events.created_at` keeps `index=True`.

### Behavior after the flip

- Pydantic v2 serializes aware datetimes with a UTC designator (`…Z` on this Pydantic
  version; offset forms parse identically) → JS `new Date()` parses correctly →
  **zero frontend code changes**; the UI starts showing correct local times.
- Session expiry comparisons become aware-vs-aware (`auth.py` uses `utcnow()`
  everywhere already).
- Snapshots: `_jsonable` isoformat now carries the offset; `_revive`'s
  `fromisoformat` parses it. Old snapshot files with naive-UTC ISO stay restorable —
  the timeutil `DateTime` decorator's `process_bind_param` tags naive values as UTC
  before psycopg binds them, so restore correctness is independent of the Postgres
  session timezone (documented, not tested).

## Part B — Observability (chosen scope: request-ID logs + deep health only)

### Request-ID middleware — `backend/app/request_logging.py` (new)

Starlette `BaseHTTPMiddleware` registered on the app:

- Request id: incoming `X-Request-ID` header is used iff it matches
  `^[A-Za-z0-9-]{1,64}$` (log-injection guard); otherwise `uuid4().hex`. Always set
  on the response as `X-Request-ID`.
- On completion, emit ONE log record on logger **`app.access`**, level INFO, with
  extra fields; **`/api/health` is exempt** (compose probes every 5 s).
- Unhandled exception from `call_next`: emit the same record shape at level ERROR
  with `status: 500` and `exc_info`, then re-raise.
- Timing: `time.perf_counter()`, `duration_ms = round(elapsed * 1000)`.

### JSON log formatter — wired in `backend/app/main.py`

Stdlib-only `logging.config.dictConfig` applied at app import: a `JsonFormatter`
(in `request_logging.py`) emitting exactly these keys per line:

```json
{"ts": "<aware UTC ISO>", "level": "info", "logger": "app.access",
 "request_id": "…", "method": "GET", "path": "/api/v1/items",
 "status": 200, "duration_ms": 12}
```

ERROR lines add `"message"` and a `"traceback"` string (from `exc_info`). Only the
`app.access` logger gets this handler/formatter (propagate off); uvicorn's error log
stays human-readable. `backend/docker-entrypoint.sh` adds `--no-access-log` to the
uvicorn line so the structured line replaces uvicorn's duplicate access log.

### Deep health — `/api/health` (URL and unversioned status unchanged)

```python
@app.get("/api/health")
def health(db: Session = Depends(get_db)) -> JSONResponse:
    try:
        db.execute(text("SELECT 1"))
    except Exception:
        return JSONResponse(status_code=503, content={"status": "unavailable"})
    return JSONResponse(content={"status": "ok"})
```

Success body stays `{"status":"ok"}` (compose healthcheck asserts HTTP 200 —
unaffected). A dead DB now flips the container to unhealthy — intended.

## Testing

**Backend** (SQLite suite + compose dry-run):
- Migration: upgrade + downgrade dry-run against compose Postgres (task step, not a
  pytest); `psql` column-type check for a sample of the 14 columns.
- Awareness: creating an item via the API returns `created_at`/`updated_at` that
  `datetime.fromisoformat` parses with non-null `tzinfo` (suffix-agnostic — Pydantic
  emits `Z`); PATCH refreshes `updated_at` and it stays aware; a comment edit sets an
  aware `updated_at`; session login → `expires_at` aware and expiry check still works.
- Middleware: response carries a generated `X-Request-ID`; a valid incoming id is
  echoed; an invalid one (`"bad id!"` / overlong) is replaced; `caplog` shows one
  `app.access` record per request with the exact field set; `/api/health` produces no
  access record; an endpoint that raises logs an ERROR record with the same
  request_id and status 500.
- Health: 200 `{"status":"ok"}` normally; with a `get_db` override whose `execute`
  raises → 503 `{"status":"unavailable"}`.
- P3 suites (snapshots round-trip incl. pinned `updated_at`) stay green — aware
  datetimes flow through `_jsonable`/`_revive` unchanged.

**Frontend:** no code changes; suite stays at 192 (existing fixtures already use
offset or offset-less strings that keep parsing).

Suite baselines at spec time: backend 190, frontend 192 (exact per-task counts pinned
at plan time).

## Scope guards (v1)

- No metrics, tracing, Sentry, or log shipping; no CI (user-excluded).
- Request-id is not persisted (not in audit rows) and not propagated to the frontend
  beyond the response header.
- Uvicorn/alembic startup logs stay in their default text format; only `app.access`
  is JSON.
- No timezone preferences UI — the frontend renders viewer-local via
  `toLocaleString()` as today.
