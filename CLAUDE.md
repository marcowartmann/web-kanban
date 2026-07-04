# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

JAMra is a web app for managing SAFe Feature / Story / Risk items on a Kanban board, backed by Postgres, with CSV import of planning data.

## Commands

Run each command from the directory shown — the toolchains are CWD-sensitive (git from repo root, `pytest` from `backend/`, `npm`/`vitest` from `frontend/`).

**Full stack (Docker):** `export FONTAWESOME_PACKAGE_TOKEN=...` first (see FontAwesome below), then `docker compose up --build`. App at http://localhost:8080, API at http://localhost:8000, Postgres published on `DB_BIND:DB_PORT` (default `127.0.0.1:5432`). The backend auto-runs `alembic upgrade head` on start.

**Backend** (`cd backend`):
- Setup: `python -m venv .venv && . .venv/bin/activate && pip install -e ".[dev]"`
- Migrate: `alembic upgrade head` (needs the `db` service up: `docker compose up -d db`)
- Run: `uvicorn app.main:app --reload`
- Test: `pytest` — single test: `pytest tests/test_items.py::test_name -v`

**Frontend** (`cd frontend`):
- Dev: `npm run dev` (http://localhost:5173, proxies `/api` to the backend)
- Build (also typechecks): `npm run build`
- Test: `npm run test` — single file: `npx vitest run src/components/Card.test.tsx`; watch: `npm run test:watch`

**Rebuild one Docker image after changes:** `docker compose build backend` / `docker compose build frontend` (frontend needs the FA token exported), then `docker compose up -d`.

## FontAwesome Pro (required for frontend builds)

Icons install from a private registry. `FONTAWESOME_PACKAGE_TOKEN` must be exported for any `npm ci`/`npm install` or `docker compose build frontend` — `frontend/.npmrc` references it and compose passes it as a BuildKit secret (never written to a layer or committed). The local token lives in gitignored `frontend/.fa-token`; source it inline as `export FONTAWESOME_PACKAGE_TOKEN=$(tr -d '\n' < frontend/.fa-token)` so the literal never appears in the transcript. All icons are FontAwesome Pro **duotone**, centralized in [frontend/src/icons.ts](frontend/src/icons.ts) — add new icons there rather than importing from the FA packages directly.

## Architecture

**Backend** (FastAPI + SQLAlchemy 2.0 + Alembic, Python 3.14) — [backend/app/](backend/app/):
- [main.py](backend/app/main.py) wires the app. Every router except `auth` is mounted under `Depends(require_user)`; admin-only endpoints additionally depend on `require_admin` per-route. Auth is cookie-session based (`kanban_session` cookie, [auth.py](backend/app/auth.py)); users authenticate against local bcrypt hashes or LDAP ([ldap_auth.py](backend/app/ldap_auth.py), off unless `LDAP_ENABLED=true`).
- One router file per resource in [routers/](backend/app/routers/); the ORM models and Pydantic schemas live in the single [models.py](backend/app/models.py) / [schemas.py](backend/app/schemas.py).
- **Domain core:** `Item` is a polymorphic table (`kind` = feature/story/risk); stories are children of features via `parent_id`. `ItemUpdate` uses `extra="forbid"` — only the fields listed there are PATCHable (`type`, `art`, `kind`, `parent_id`, timestamps are read-only). WSJF scoring is in [wsjf.py](backend/app/wsjf.py); `risk_scope` (art/team) is derived from `kategorie` on import.
- **Cross-cutting subsystems:** [audit.py](backend/app/audit.py) (field-level change log), [snapshots.py](backend/app/snapshots.py) (point-in-time JSON exports to the `snapshots` volume), [csv_import.py](backend/app/csv_import.py) (loads `Team Planning Q3 26.csv`), [backup.py](backend/app/backup.py) + [scheduler.py](backend/app/scheduler.py) (APScheduler-driven pg_dump/snapshot export to SFTP; password Fernet-encrypted at rest via [crypto.py](backend/app/crypto.py) keyed on `APP_SECRET`), PI Objectives ([pi_objectives.py](backend/app/pi_objectives.py), team+PI-scoped, links to 0..n features).

**Frontend** (React + Vite + TypeScript + Tailwind v4) — [frontend/src/](frontend/src/):
- [App.tsx](frontend/src/App.tsx) is the shell with five top-level views: Board, Planning, Timeline, Ranking, and Admin (admin-only). All backend calls go through the typed client in [api/client.ts](frontend/src/api/client.ts); shared types in [types.ts](frontend/src/types.ts) mirror the backend schemas.
- Tailwind v4 uses `@import "tailwindcss"` + `@theme` in [index.css](frontend/src/index.css) (no `tailwind.config.js`/`postcss.config.js`) via `@tailwindcss/vite`. Dark theme is semantic CSS-variable tokens plus a gray-ramp override; the FOUC guard + `data-theme` toggle live inline in [index.html](frontend/index.html) and [theme/](frontend/src/theme/).
- Custom dropdown components are deliberate: `PlainSelect` (no search), `SearchableSelect` (filterable), `FilterSelect` (filter bars). These are hand-built Tailwind popovers — do not swap in native `<select>`. Drag-and-drop uses `@dnd-kit`.
- Tests are colocated (`*.test.tsx`/`*.test.ts`) using Vitest + Testing Library; components needing theme/context must be wrapped in their providers in tests.

## Migrations

Alembic migrations in [backend/alembic/versions/](backend/alembic/versions/) (head is `0023`). SQLite unit-test fixtures never exercise the Alembic DDL, so before accepting a migration, dry-run **both** `alembic upgrade head` and `alembic downgrade -1` against the compose Postgres. Postgres is v18 and the backend image ships `postgresql-client-18` so `pg_dump` matches the server.

## Conventions

- The workflow here is TDD + Docker verification: write/adjust tests, get both suites green, rebuild the relevant image, and verify against the running stack before merging.
- `.env` is gitignored and holds real secrets (`LDAP_BIND_PASSWORD`, possibly `DB_BIND=0.0.0.0`) — never commit or echo it. `.env.example` is the committed template.
- Watch for stray screenshots / `.playwright-mcp` artifacts at repo root before `git add -A`.
- Historical design docs and plans live in [docs/superpowers/](docs/superpowers/) (specs/ and plans/).
