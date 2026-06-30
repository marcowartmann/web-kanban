#!/bin/sh
set -e

# The db is already healthy by the time this runs (compose depends_on:
# condition: service_healthy), so no extra wait loop is needed.
alembic upgrade head

exec uvicorn app.main:app --host 0.0.0.0 --port 8000
