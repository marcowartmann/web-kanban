#!/usr/bin/env bash
# Dump the ENTIRE database (all tables — items, users, teams, planning
# intervals, containers, departments, links, comments, …) to a gzipped SQL file
# for migrating a whole instance to another deployment.
#
# Unlike the in-app JSON snapshot (which only covers items/comments/links), this
# is a full pg_dump and carries every config table and foreign key intact.
#
# Usage:
#   scripts/db-dump.sh [OUTFILE] [COMPOSE_FILE]
#   scripts/db-dump.sh                                   # dev stack -> jamra-db-<timestamp>.sql.gz
#   scripts/db-dump.sh dump.sql.gz docker-compose.prod.yml
set -euo pipefail

OUT="${1:-jamra-db-$(date +%Y%m%d-%H%M%S).sql.gz}"
COMPOSE_FILE="${2:-docker-compose.yml}"
POSTGRES_USER="${POSTGRES_USER:-kanban}"
POSTGRES_DB="${POSTGRES_DB:-kanban}"

# --clean --if-exists so the dump can be loaded over an existing schema (it drops
# and recreates each object); --no-owner/--no-privileges so it restores cleanly
# regardless of the target's roles.
docker compose -f "$COMPOSE_FILE" exec -T db \
  pg_dump -U "$POSTGRES_USER" --clean --if-exists --no-owner --no-privileges "$POSTGRES_DB" \
  | gzip > "$OUT"

echo "wrote $OUT ($(du -h "$OUT" | cut -f1))"
echo "restore with: scripts/db-restore.sh $OUT docker-compose.prod.yml"
