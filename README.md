# SAFe Kanban

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

- App (frontend): http://localhost:8080
- Backend API (direct): http://localhost:8000/api/health
- Stop: `docker compose down` (add `-v` to also drop the database volume)

Host ports are overridable in `.env` (`APP_PORT`, `BACKEND_PORT`). Postgres is published
for external clients (psql/DBeaver/pgAdmin) at `DB_PORT` (default `5432`), bound to
`DB_BIND` (default `127.0.0.1` — this host only). Set `DB_BIND=0.0.0.0` to allow LAN
access, and use a strong `POSTGRES_PASSWORD` if you do. You can still inspect it in-container
with `docker compose exec db psql -U kanban`.

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
