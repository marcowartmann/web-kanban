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
