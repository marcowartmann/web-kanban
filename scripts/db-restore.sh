#!/usr/bin/env bash
# Restore a full database dump into a compose stack's Postgres. Works with both
# dump styles this repo produces:
#   - scripts/db-dump.sh output (--clean, all tables)
#   - the in-app Backup feature's kanban-db-*.sql.gz (plain pg_dump, no --clean)
# It recreates the target database empty first, so a plain dump (no DROP
# statements) restores cleanly rather than colliding with the existing schema.
#
# DESTRUCTIVE: this REPLACES ALL DATA in the target database (including the
# bootstrap admin — afterwards log in with the credentials from the dump's
# source instance). Only run it to seed a fresh deployment or to overwrite.
#
# Usage:
#   scripts/db-restore.sh DUMPFILE [COMPOSE_FILE]
#   scripts/db-restore.sh sftp/uploads/kanban-db-20260704T232244Z.sql.gz docker-compose.prod.yml
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

dc() { docker compose -f "$COMPOSE_FILE" "$@"; }

echo "About to restore '$DUMP' into the '$COMPOSE_FILE' database '$POSTGRES_DB'."
echo "This REPLACES ALL DATA in that database. Ctrl-C within 5s to abort."
sleep 5

# Stop the backend so it holds no connections while the DB is recreated.
dc stop backend

# Recreate the target database empty (connect via the default 'postgres' db).
# Terminating stray sessions first so DROP DATABASE can't be blocked.
dc exec -T db psql -U "$POSTGRES_USER" -d postgres -v ON_ERROR_STOP=1 \
  -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='$POSTGRES_DB' AND pid <> pg_backend_pid();" \
  -c "DROP DATABASE IF EXISTS $POSTGRES_DB;" \
  -c "CREATE DATABASE $POSTGRES_DB OWNER $POSTGRES_USER;"

# Load the dump into the fresh database.
"${reader[@]}" | dc exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"

# Backend re-runs `alembic upgrade head` on start; it is a no-op when the dump's
# migration version matches this build.
dc start backend

echo "done. Verify with: docker compose -f $COMPOSE_FILE ps"
