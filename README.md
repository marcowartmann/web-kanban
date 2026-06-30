# SAFe Kanban

Web app for managing SAFe Feature / Story / Risk items on a Kanban board, backed by
Postgres, with CSV import of planning data.

- **Backend:** FastAPI + SQLAlchemy + Alembic ([backend/](backend/))
- **Frontend:** React + Vite + TypeScript + Tailwind ([frontend/](frontend/))

## Run with Docker (full stack)

Runs Postgres, the backend (auto-migrates on start), and the frontend (nginx) together.

```bash
cp .env.example .env        # optional — override credentials/ports
docker compose up --build
```

Then open **http://localhost:8080** and use the **Import CSV** button to load
`Team Planning Q3 26.csv`.

- App (frontend): http://localhost:8080
- Backend API (direct): http://localhost:8000/api/health
- Stop: `docker compose down` (add `-v` to also drop the database volume)

Host ports are overridable in `.env` (`APP_PORT`, `BACKEND_PORT`). The database is not
published to the host; inspect it with `docker compose exec db psql -U kanban`.

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
