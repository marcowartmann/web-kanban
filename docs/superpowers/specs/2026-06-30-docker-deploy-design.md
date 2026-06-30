# Dockerized Deployment (db + backend + frontend) — Design

**Date:** 2026-06-30
**Status:** Approved (pending spec review)

## 1. Purpose

Deploy the SAFe Kanban app as three Docker containers — Postgres, FastAPI backend,
and the React frontend — orchestrated by a single root `docker-compose.yml`. Today
only the database is containerized (`backend/docker-compose.yml`, db-only).

## 2. Scope

In scope:

- A new root `docker-compose.yml` running `db` + `backend` + `frontend`.
- `backend/Dockerfile` + entrypoint that auto-runs Alembic migrations then serves uvicorn.
- A small `backend/pyproject.toml` addition (`[build-system]` + `[tool.setuptools]
  packages = ["app"]`) so `pip install .` works in the image.
- `frontend/Dockerfile` (multi-stage build) + `nginx.conf` serving the built SPA and
  reverse-proxying `/api` to the backend.
- `.dockerignore` files and a root `.env.example`.
- Documentation of the one-command deploy.

Out of scope:

- The existing `backend/docker-compose.yml` (db-only) — kept unchanged for local dev.
- Production TLS / reverse proxy / domain config, secrets management, CI/CD.
- Application code changes (the React client already uses relative `/api`).

## 3. Topology

```
browser :8080 ──► frontend (nginx :80)
                    /        → static dist/
                    /api/*   → proxy → backend:8000
                                         │ DATABASE_URL
                                      backend (uvicorn :8000, also published :8000)
                                         │
                                      db (postgres:18, volume pgdata, internal only)
```

- The React client calls relative `/api`; nginx proxies it to the backend, so the
  browser sees a single origin ⇒ **no CORS needed** and **no client code change**.
- Services communicate over the default compose network by service name (`db`,
  `backend`).

## 4. Port mapping

Verified free on the host at design time (other stacks use 8001 / 5174 / 5433 / 8200–8201):

| Service  | Container | Host (default) | Override env  | Published? |
| -------- | --------- | -------------- | ------------- | ---------- |
| frontend | 80        | 8080           | `APP_PORT`    | yes        |
| backend  | 8000      | 8000           | `BACKEND_PORT`| yes        |
| db       | 5432      | —              | —             | no (internal only) |

`db` is intentionally not published to the host: the app reaches it over the compose
network, and leaving it unpublished avoids colliding with the dev `backend/docker-compose.yml`
db (which publishes 5432). Inspect it with `docker compose exec db psql -U kanban`.

## 5. Components

### 5.1 `backend/Dockerfile`
- Base `python:3.14-slim`, `WORKDIR /app`.
- `COPY . /app` (the whole `backend/` tree — needs `app/`, `alembic/`, `alembic.ini`,
  `docker-entrypoint.sh`).
- `RUN pip install --no-cache-dir .` — installs the declared deps + the `app` package.
  psycopg ships a binary wheel, so no system `libpq`/build toolchain is required.
- `chmod +x docker-entrypoint.sh`; `ENTRYPOINT ["./docker-entrypoint.sh"]`. `EXPOSE 8000`.
- Migrations run from `/app` (where `alembic.ini` + `alembic/` live); `app` is importable
  by both uvicorn and `alembic/env.py`.

### 5.1a `backend/pyproject.toml` (modified)
The current file has no build backend, so `pip install .` would fail setuptools
flat-layout auto-discovery (it sees `app/`, `alembic/`, `tests/`). Add:
```toml
[build-system]
requires = ["setuptools>=61"]
build-backend = "setuptools.build_meta"

[tool.setuptools]
packages = ["app"]
```
This packages only `app`; `alembic/` and `tests/` stay as plain files (copied into the
image, not installed).

### 5.2 `backend/docker-entrypoint.sh`
```sh
#!/bin/sh
set -e
alembic upgrade head
exec uvicorn app.main:app --host 0.0.0.0 --port 8000
```
The db is already healthy before this runs (compose `depends_on: condition:
service_healthy`), so no extra wait loop is needed.

### 5.3 `backend/.dockerignore`
Excludes `.venv/`, `__pycache__/`, `.pytest_cache/`, `tests/`, `.env`, `*.pyc`.

### 5.4 `frontend/Dockerfile` (multi-stage)
- Stage `build` (`node:22`): copy `package*.json`, `npm ci`, copy source, `npm run build`
  → `dist/`.
- Stage `runtime` (`nginx:alpine`): copy `dist/` → `/usr/share/nginx/html`, copy
  `nginx.conf` → `/etc/nginx/conf.d/default.conf`. `EXPOSE 80`.

### 5.5 `frontend/nginx.conf`
```nginx
server {
  listen 80;
  client_max_body_size 10m;            # CSV upload headroom

  location /api/ {
    proxy_pass http://backend:8000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }

  location / {
    root /usr/share/nginx/html;
    try_files $uri /index.html;        # SPA fallback
  }
}
```

### 5.6 `frontend/.dockerignore`
Excludes `node_modules/`, `dist/`.

### 5.7 Root `docker-compose.yml`
```yaml
services:
  db:
    image: postgres:18
    environment:
      POSTGRES_USER: ${POSTGRES_USER:-kanban}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-kanban}
      POSTGRES_DB: ${POSTGRES_DB:-kanban}
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER:-kanban}"]
      interval: 5s
      timeout: 3s
      retries: 10

  backend:
    build: ./backend
    environment:
      DATABASE_URL: postgresql+psycopg://${POSTGRES_USER:-kanban}:${POSTGRES_PASSWORD:-kanban}@db:5432/${POSTGRES_DB:-kanban}
    depends_on:
      db:
        condition: service_healthy
    ports:
      - "${BACKEND_PORT:-8000}:8000"
    healthcheck:
      test: ["CMD", "python", "-c", "import urllib.request,sys; sys.exit(0) if urllib.request.urlopen('http://localhost:8000/api/health').status==200 else sys.exit(1)"]
      interval: 5s
      timeout: 3s
      retries: 10

  frontend:
    build: ./frontend
    depends_on:
      backend:
        condition: service_healthy
    ports:
      - "${APP_PORT:-8080}:80"

volumes:
  pgdata:
```
- No explicit `container_name` (compose names them `web-kanban-*-1`), avoiding clashes
  with the running `service-map-*` containers.

### 5.8 Root `.env.example`
```
POSTGRES_USER=kanban
POSTGRES_PASSWORD=kanban
POSTGRES_DB=kanban
APP_PORT=8080
BACKEND_PORT=8000
```

## 6. Verification

- `docker compose up --build -d` from repo root.
- `docker compose ps` shows db healthy, backend healthy, frontend up.
- `curl -fsS localhost:8080/api/health` → `{"status":"ok"}` (proxied path).
- `curl -fsS localhost:8000/api/health` → `{"status":"ok"}` (direct backend).
- `curl -fsS localhost:8080/` returns the SPA HTML.
- End-to-end: open `localhost:8080`, import `Team Planning Q3 26.csv`, confirm the board
  populates.
- `docker compose down` (and `down -v` to drop the data volume).
- Static fallback if the Docker daemon is unavailable in this environment:
  `docker compose config` must parse, and Dockerfiles/nginx.conf are reviewed by build.

## 7. Documentation

Add a "Run with Docker (full stack)" section to `backend/README.md` (or a new root
`README.md`): `cp .env.example .env` (optional) then `docker compose up --build`, app at
`http://localhost:8080`.
