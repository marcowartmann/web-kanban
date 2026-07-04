# Backup to SFTP — Design

**Date:** 2026-07-04
**Status:** Approved (brainstorm), pending implementation plan

## Goal

Let an admin configure **scheduled and manually-triggered** exports of the
Postgres database and the import snapshots to an **SFTP server**, from a new
**Admin → Backup** section. Provide a dockerized SFTP server for testing.

## Decisions (from brainstorming)

1. **SFTP auth:** password only (host / port / username / password).
2. **Schedule:** simple presets — frequency (`disabled` / `daily` / `weekly`) +
   time of day (UTC), plus a manual "Run now".
3. **Contents:** both a Postgres dump and the snapshot files, each toggleable.
4. **Credentials:** stored in the DB **encrypted at rest** (Fernet, key from
   `APP_SECRET`); write-only in the API/UI.

## Dev SFTP server (docker-compose)

Add an `sftp` service using `atmoz/sftp`:

```yaml
  sftp:
    image: atmoz/sftp:alpine
    command: ["${SFTP_USER:-kanban}:${SFTP_PASSWORD:-kanban}:::upload"]
    volumes:
      - sftp_data:/home/${SFTP_USER:-kanban}/upload
    # host access optional for inspection; the backend reaches it at sftp:22
    ports:
      - "127.0.0.1:${SFTP_PORT:-2222}:22"
```

The backend connects to host `sftp`, port `22`, user/password from the config.
The uploaded files land in the `sftp_data` volume under `upload/`.

## Data model (migration 0023)

### `backup_config` (single row, id fixed = 1)

| Column                 | Type            | Notes                                  |
| ---------------------- | --------------- | -------------------------------------- |
| `id`                   | int PK          | always 1 (singleton)                   |
| `sftp_host`            | String(255)     | nullable until configured              |
| `sftp_port`            | int             | default 22                             |
| `sftp_username`        | String(255)     | nullable                               |
| `sftp_password_enc`    | Text            | Fernet ciphertext, nullable            |
| `remote_dir`           | String(512)     | default `"upload"`                     |
| `include_db`           | bool            | default true                           |
| `include_snapshots`    | bool            | default true                           |
| `schedule_frequency`   | String(16)      | `disabled` \| `daily` \| `weekly`, default `disabled` |
| `schedule_day_of_week` | int             | 0=Mon..6=Sun, for weekly; default 0    |
| `schedule_time`        | String(5)       | `"HH:MM"` UTC, default `"02:00"`       |
| `enabled`              | bool            | master on/off, default false           |
| `updated_at`           | DateTime(tz)    | onupdate now                           |

### `backup_runs` (history)

| Column          | Type          | Notes                                   |
| --------------- | ------------- | --------------------------------------- |
| `id`            | int PK        |                                         |
| `started_at`    | DateTime(tz)  |                                         |
| `finished_at`   | DateTime(tz)  | nullable                                |
| `trigger`       | String(16)    | `manual` \| `scheduled`                 |
| `status`        | String(16)    | `success` \| `error`                    |
| `db_file`       | String(255)   | uploaded db filename, nullable          |
| `snapshots_file`| String(255)   | uploaded snapshots filename, nullable   |
| `message`       | Text          | summary or error detail, nullable       |

Migration seeds one `backup_config` row (id=1) with defaults. Dry-run
upgrade+downgrade on compose Postgres.

## Encryption (`app/crypto.py`)

- `APP_SECRET` env var (defaulted in compose for dev). Fernet key =
  `base64.urlsafe_b64encode(sha256(APP_SECRET.encode()).digest())`.
- `encrypt(plain: str) -> str` / `decrypt(cipher: str) -> str`.
- The password is decrypted only in-process when connecting; it is never
  serialized back to the API.
- Adds dependency `cryptography`.

## Export mechanism (`app/backup.py`)

- **DB dump:** `subprocess.run(["pg_dump", <conn>], ...)` piped through gzip to
  `kanban-db-<UTC>.sql.gz`. Connection parsed from `settings.database_url`
  (host/port/db/user, `PGPASSWORD` in env). Requires `postgresql-client` in the
  backend image (added to `backend/Dockerfile`).
- **Snapshots:** `tarfile` gzip of the snapshot dir → `kanban-snapshots-<UTC>.tar.gz`.
  If the dir is empty/missing, skip with a note.
- **Upload:** `paramiko.Transport((host, port))` → `connect(username, password)`
  → `SFTPClient` → ensure `remote_dir` exists (mkdir-p) → `put(local, remote)`.
- `run_backup(db, trigger) -> BackupRunResult`:
  1. insert a `backup_runs` row (`started_at`, `trigger`, status pending).
  2. build enabled artifacts in a temp dir.
  3. upload each; on any failure record `error` + message; else `success`.
  4. set `finished_at`, filenames, message; commit; return the row.
  - Blocking (pg_dump/paramiko) — callers run it via a thread executor.
- `test_connection(cfg | overrides) -> None` raises on failure (used by the
  test endpoint): connect + list `remote_dir`.

## Scheduling (`app/scheduler.py`)

- `AsyncIOScheduler` created in the FastAPI `lifespan` (single uvicorn process,
  so exactly one scheduler).
- `reschedule(db)` reads `backup_config`; if `enabled` and
  `schedule_frequency != disabled`, installs a single cron job (id
  `"backup"`, replacing any existing) from the presets:
  - daily → `CronTrigger(hour, minute)` (UTC)
  - weekly → `CronTrigger(day_of_week, hour, minute)` (UTC)
  Otherwise removes the job.
- The job runs `run_backup(db, trigger="scheduled")` inside
  `run_in_executor` (blocking work off the event loop), using a fresh DB session.
- `PUT /backup/config` calls `reschedule` after saving.

## API (`app/routers/backup.py`, admin-only)

- `GET /api/v1/backup/config` → `BackupConfigRead` (no password; `has_password: bool`).
- `PUT /api/v1/backup/config` → save; `password` optional (only overwrites when a
  non-empty value is sent; sending `""` leaves it unchanged, a dedicated
  `clear_password: true` clears it). Re-schedules. Audit-logged.
- `POST /api/v1/backup/test` → run `test_connection` with the saved config
  (optionally overridden by the request body for a not-yet-saved form); 200 `{ok}`
  or 422 with the error message.
- `POST /api/v1/backup/run` → `run_backup(trigger="manual")` via executor; returns
  the `BackupRunRead`. Audit-logged.
- `GET /api/v1/backup/runs?limit=20` → recent `BackupRunRead[]`, newest first.

### Schemas

- `BackupConfigRead`: all config fields **except** the ciphertext, plus
  `has_password: bool`.
- `BackupConfigUpdate`: writable fields; `password: str | None`,
  `clear_password: bool = False`.
- `BackupRunRead`: the run row fields.
- `SftpTestRequest`: optional host/port/username/password/remote_dir overrides.

## Frontend (`Admin → Backup` section)

- New nav entry "Backup" (icon `faCloudArrowUp` duotone) in `AdminView`.
- `BackupSection.tsx`:
  - **SFTP**: host, port, username, password (write-only; placeholder shows
    "•••• set" when `has_password`, empty leaves unchanged), remote dir.
  - **Contents**: include-DB toggle, include-snapshots toggle.
  - **Schedule**: enabled toggle, frequency `PlainSelect` (Disabled/Daily/Weekly),
    day-of-week `PlainSelect` (shown for Weekly), time `HH:MM` input; note "times
    are UTC".
  - **Actions**: Test connection, Save, Run now (with inline result/status).
  - **Recent runs** table: started, trigger, status (green/red), files, message.
- `api/client.ts`: `getBackupConfig`, `saveBackupConfig`, `testBackup`,
  `runBackup`, `getBackupRuns`.

## Testing

**Backend**
- `crypto`: encrypt→decrypt round-trip; decrypt of a known ciphertext.
- Config: `GET` never returns the password and reports `has_password`; `PUT`
  with a password sets `has_password`; `PUT` without leaves it; `clear_password`
  clears it.
- `run_backup`: with `pg_dump` and `paramiko` **mocked**, builds the enabled
  artifacts, "uploads" them, and records a `success` run with filenames; a
  raised upload error records `error` + message and does not crash.
- Schedule: preset→`CronTrigger` fields (daily/weekly, UTC); `disabled`/not-
  enabled removes the job.
- `test_connection`: success path (mock) and failure raises.
- Endpoints: admin-only (non-admin 403); run/test/runs happy paths.

**Frontend**
- `BackupSection` renders config, masks the password, toggles weekly day
  visibility, Save posts the form, Run now calls the API and shows the result,
  runs table lists history.

**Docker (end-to-end)**
- Bring up the stack incl. `sftp`; configure host `sftp` / user / password via
  the UI; **Run now**; confirm `kanban-db-*.sql.gz` and
  `kanban-snapshots-*.tar.gz` appear in the `sftp_data` volume; a run row shows
  `success`.

## Out of scope

- SSH key auth (password only for v1).
- Restore-from-SFTP (this is export only; restore stays the existing snapshot
  upload/restore flow).
- Retention/pruning of remote backups.
- Cron-expression scheduling and sub-daily intervals.
- Multiple SFTP targets.
