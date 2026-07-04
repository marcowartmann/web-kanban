#!/usr/bin/env bash
# Restore a full database dump (produced by scripts/db-dump.sh) into a compose
# stack's Postgres.
#
# DESTRUCTIVE: a --clean dump drops and recreates every table, so this REPLACES
# all data in the target database (including the bootstrap admin — afterwards log
# in with the credentials from the source instance). Only run it when seeding a
# fresh deployment or when you intend to overwrite the target.
#
# Usage:
#   scripts/db-restore.sh DUMPFILE [COMPOSE_FILE]
#   scripts/db-restore.sh jamra-db-dump.sql.gz docker-compose.prod.yml
set -euo pipefail

DUMP="${1:?usage: db-restore.sh DUMPFILE [COMPOSE_FILE]}"
COMPOSE_FILE="${2:-docker-compose.prod.yml}"
POSTGRES_USER="${POSTGRES_USER:-kanban}"
POSTGRES_DB="${POSTGRES_DB:-kanban}"

[ -f "$DUMP" ] || { echo "error: dump file '$DUMP' not found" >&2; exit 1; }

# Read gzipped or plain SQL.
case "$DUMP" in
  *.gz) reader=(gzip -dc "$DUMP") ;;
  *)    reader=(cat "$DUMP") ;;
esac

echo "About to restore '$DUMP' into the '$COMPOSE_FILE' database."
echo "This REPLACES ALL DATA in that database. Ctrl-C within 5s to abort."
sleep 5

# Stop the backend so it holds no connections/locks while tables are recreated.
docker compose -f "$COMPOSE_FILE" stop backend
"${reader[@]}" | docker compose -f "$COMPOSE_FILE" exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"
# Backend re-runs `alembic upgrade head` on start; it is a no-op when the dump's
# migration version matches this build.
docker compose -f "$COMPOSE_FILE" start backend

echo "done. Verify with: docker compose -f $COMPOSE_FILE ps"
