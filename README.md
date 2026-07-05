# JAMra

Web app for managing SAFe Feature / Story / Risk items on a Kanban board, backed by
Postgres, with CSV import of planning data.

- **Backend:** FastAPI + SQLAlchemy + Alembic ([backend/](backend/))
- **Frontend:** React + Vite + TypeScript + Tailwind ([frontend/](frontend/))

## Run with Docker (full stack)

Runs Postgres, the backend (auto-migrates on start), and the frontend (nginx) together.

The frontend uses **FontAwesome Pro** icons, which install from a private
registry. Export your Pro package token before building — it's passed to the
frontend build as a BuildKit secret and never stored in the image or git:

```bash
export FONTAWESOME_PACKAGE_TOKEN="<your-fa-pro-package-token>"
cp .env.example .env        # optional — override credentials/ports
docker compose up --build
```

(For local frontend work outside Docker, the same env var must be set so
`npm ci` / `npm install` can reach the `@fortawesome` registry — see
`frontend/.npmrc`.)

Then open **http://localhost:8080** and use the **Import CSV** button to load
`Team Planning Q3 26.csv`.

- App (frontend): http://localhost:8080 — or HTTPS at https://localhost:8443
- Backend API (direct): http://localhost:8000/api/health
- Stop: `docker compose down` (add `-v` to also drop the database volume)

### HTTPS / TLS

The frontend serves on both HTTP (`APP_PORT`, default `8080`) and HTTPS (`HTTPS_PORT`,
default `8443`). The cert and key are read from the host directory `./nginx/certs`,
bind-mounted into the container at `/etc/nginx/certs`:

- `server.crt` — certificate (public key / full chain)
- `server.key` — private key

If that directory is empty on first start, a **self-signed dev certificate** is
generated into it automatically (browsers will warn — expected for local dev).
To use your own certificate, drop `server.crt` / `server.key` into `./nginx/certs`
before starting; they take precedence and are never overwritten. The cert files are
gitignored.

Host ports are overridable in `.env` (`APP_PORT`, `HTTPS_PORT`, `BACKEND_PORT`). Postgres is published
for external clients (psql/DBeaver/pgAdmin) at `DB_PORT` (default `5432`), bound to
`DB_BIND` (default `127.0.0.1` — this host only). Set `DB_BIND=0.0.0.0` to allow LAN
access, and use a strong `POSTGRES_PASSWORD` if you do. You can still inspect it in-container
with `docker compose exec db psql -U kanban`.

## Production deployment (Docker Hub images)

Production runs prebuilt images from Docker Hub (`marcowartmannmw/jamra-frontend`
and `marcowartmannmw/jamra-backend`) via [`docker-compose.prod.yml`](docker-compose.prod.yml).
The images are built for `linux/amd64` and pushed from a dev machine, so the
FontAwesome Pro token never touches the server.

**1. Build & push the images** (from a machine with `frontend/.fa-token` and
`docker login` as `marcowartmannmw`):

```bash
scripts/publish.sh            # tags :latest
scripts/publish.sh v1.0.0     # tags :v1.0.0 and :latest
```

Builds cross-compile to `linux/amd64` via `docker buildx` (QEMU), so this works
from an Apple-Silicon Mac.

**2. On the server**, copy the compose file, `.env.prod.example`, and the
`nginx/` dir into one directory, then create `.env` **next to
`docker-compose.prod.yml`**. Compose auto-loads `.env` from the compose file's
directory (its "project directory") — *not* from your current working
directory — so if `.env` lives elsewhere you get
`POSTGRES_PASSWORD is missing a value` even though it is set. Keep them together,
or pass `--env-file /path/to/.env` explicitly on every command.

```bash
cd <dir with docker-compose.prod.yml>
cp .env.prod.example .env
```

Edit `.env` and set real, **non-empty** values for the three required secrets —
the stack refuses to start until they are set (`POSTGRES_PASSWORD is missing a
value` means one is still blank *or the wrong `.env` is being read*):

```bash
POSTGRES_PASSWORD=$(openssl rand -hex 24)
APP_SECRET=$(openssl rand -hex 32)
INITIAL_ADMIN_PASSWORD=<choose one>
```

Verify the config resolves before starting — this prints an error naming any
missing variable:

```bash
docker compose -f docker-compose.prod.yml config >/dev/null && echo OK
```

Then launch:

```bash
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

> **Changed `POSTGRES_PASSWORD` after a first run and now the backend won't
> become healthy?** Postgres only applies the password when it *initialises* its
> data volume, so an existing volume keeps the old password and the backend can't
> authenticate. Reset the (empty) database with
> `docker compose -f docker-compose.prod.yml down -v` and `up -d` again. `-v`
> deletes the database — only do this before you have real data.

The stack runs under its own Compose project name (`jamra-prod`), so its
containers and volumes never collide with the dev stack.

Postgres runs bundled in the compose stack (named `pgdata` volume, not published
to the host). The backend applies DB migrations automatically on start. Put your
real TLS `server.crt` / `server.key` in `./nginx/certs`; if absent, a self-signed
cert is generated so the site still comes up. Set `IMAGE_TAG` in `.env` to deploy
a specific version; upgrade with `pull` + `up -d` again.

### Migrating a full instance (database dump/restore)

To seed a new deployment as a **complete copy** of an existing instance — all
users, teams, planning intervals, containers, departments, items, links and
comments — use a full database dump. (The in-app **snapshot** restore only covers
items/comments/links, so restoring a snapshot into a fresh DB leaves the config
tables empty and nulls item references to missing departments/containers/users.)

On the **source** machine (against whichever stack holds the data):

```bash
scripts/db-dump.sh                       # dev stack -> jamra-db-<timestamp>.sql.gz
# or an explicit target/stack:
scripts/db-dump.sh dump.sql.gz docker-compose.prod.yml
```

Copy the `.sql.gz` to the **target** server, then restore into the prod stack:

```bash
scripts/db-restore.sh dump.sql.gz docker-compose.prod.yml
```

The restore stops the backend, **recreates the target database empty**, loads the
dump, and restarts the backend (its `alembic upgrade head` is a no-op when the
dump's migration version matches the image). Recreating the DB first means it
works for **both** dump styles — the `db-dump.sh` output *and* the in-app Backup
feature's `kanban-db-*.sql.gz` files (plain `pg_dump`, which have no `DROP`
statements and would otherwise collide with the existing schema). To restore a
Backup-feature dump, point the script at it:

```bash
scripts/db-restore.sh sftp/uploads/kanban-db-20260101T120000Z.sql.gz docker-compose.prod.yml
```

**It replaces all data in the target**, including the bootstrap admin — afterwards
log in with the dump source's credentials (user password hashes transfer; LDAP
users still authenticate via LDAP). Dumps may contain password hashes and are
gitignored (`*.sql.gz`) — keep them private.

## Local development (without Docker for the app)

```bash
# database only
cd backend && docker compose up -d db

# backend
cd backend && python -m venv .venv && . .venv/bin/activate
pip install -e ".[dev]"
alembic upgrade head
uvicorn app.main:app --reload          # http://localhost:8000

# frontend
cd frontend && npm install && npm run dev   # http://localhost:5173 (proxies /api)
```

## Tests

```bash
cd backend && pytest        # 25 tests
cd frontend && npm run test # 19 tests
```

## Security scanning (Trivy)

[`scripts/scan.sh`](scripts/scan.sh) scans for vulnerabilities, Dockerfile/compose
misconfigurations, and committed secrets using Trivy — run from its Docker image,
so nothing needs installing.

```bash
scripts/scan.sh                                   # default images + the repo
scripts/scan.sh web-kanban-backend web-kanban-frontend   # scan local pre-publish images
SEVERITY=CRITICAL scripts/scan.sh                 # narrow the report
FAIL=1 scripts/scan.sh                            # gate: non-zero exit on findings
```

It scans the repo filesystem (dependency CVEs from `pyproject.toml` /
`package-lock.json`, Dockerfile/compose misconfig, secrets — skipping local
artifact dirs like `nginx/certs` and `sftp/uploads`) and the two container
images. Report-only by default (never fails); set `FAIL=1` to gate a publish.
Run it before `scripts/publish.sh` to check what you're about to ship.
