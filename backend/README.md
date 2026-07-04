# JAMra Backend

## Setup
```bash
cd backend
python -m venv .venv && . .venv/bin/activate
pip install -e ".[dev]"
cp .env.example .env
docker compose up -d db        # Postgres on :5432
alembic upgrade head           # create the items table
uvicorn app.main:app --reload  # API on :8000
```

## Tests
```bash
pytest                         # runs against SQLite in-memory
```

## Import data
`POST /api/import` with the planning CSV as multipart `file` (replace-all).
