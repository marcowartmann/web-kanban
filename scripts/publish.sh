#!/usr/bin/env bash
# Build the production frontend + backend images for linux/amd64 and push them
# to Docker Hub under marcowartmannmw. Cross-builds from an arm64 Mac via QEMU
# emulation (provided by Docker Desktop / `docker buildx`).
#
# Prerequisites:
#   - docker login          (authenticate to Docker Hub as marcowartmannmw)
#   - frontend/.fa-token     (FontAwesome Pro package token, gitignored)
#
# Usage:
#   scripts/publish.sh [TAG]     # TAG defaults to "latest"
#   scripts/publish.sh v1.2.0    # also tags :latest
set -euo pipefail

REGISTRY="marcowartmannmw"
PLATFORM="linux/amd64"
TAG="${1:-latest}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# FontAwesome Pro token for the frontend build — passed as a BuildKit secret so
# it is never written into an image layer.
FA_TOKEN_FILE="$ROOT/frontend/.fa-token"
if [ ! -f "$FA_TOKEN_FILE" ]; then
  echo "error: $FA_TOKEN_FILE not found (required for the frontend build)" >&2
  exit 1
fi
export FONTAWESOME_PACKAGE_TOKEN="$(tr -d '\n' < "$FA_TOKEN_FILE")"

# Emit `-t repo:TAG` plus `-t repo:latest` (unless TAG already is latest).
tag_args() {
  local img="$1"
  printf -- '-t %s:%s ' "$img" "$TAG"
  [ "$TAG" != "latest" ] && printf -- '-t %s:latest ' "$img"
}

echo "==> backend  $REGISTRY/jamra-backend:$TAG  ($PLATFORM)"
# shellcheck disable=SC2046
docker buildx build --platform "$PLATFORM" \
  $(tag_args "$REGISTRY/jamra-backend") \
  --push "$ROOT/backend"

echo "==> frontend $REGISTRY/jamra-frontend:$TAG  ($PLATFORM)"
# shellcheck disable=SC2046
docker buildx build --platform "$PLATFORM" \
  --secret id=fa_token,env=FONTAWESOME_PACKAGE_TOKEN \
  $(tag_args "$REGISTRY/jamra-frontend") \
  --push "$ROOT/frontend"

echo "==> pushed. On the server:"
echo "    docker compose -f docker-compose.prod.yml pull"
echo "    docker compose -f docker-compose.prod.yml up -d"
