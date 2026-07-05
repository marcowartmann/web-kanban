#!/usr/bin/env bash
# Vulnerability / misconfiguration / secret scan with Trivy. Runs Trivy from its
# official Docker image, so nothing needs to be installed locally.
#
# Report-only: it prints findings but never fails (exit code is always 0). To
# turn it into a gate, set FAIL=1 (fails on any finding at $SEVERITY).
#
# Scans:
#   - the repo filesystem: dependency CVEs (pyproject/package-lock),
#     Dockerfile/compose misconfigurations, and committed secrets
#   - the container images you ship
#
# Usage:
#   scripts/scan.sh                          # default images + repo
#   scripts/scan.sh web-kanban-backend web-kanban-frontend   # scan local pre-publish images
#   SEVERITY=CRITICAL scripts/scan.sh        # narrow the report
#   FAIL=1 scripts/scan.sh                   # make it a gate (non-zero on findings)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TRIVY_IMAGE="${TRIVY_IMAGE:-aquasec/trivy:latest}"
SEVERITY="${SEVERITY:-HIGH,CRITICAL}"
TAG="${IMAGE_TAG:-latest}"
EXIT_CODE="0"; [ "${FAIL:-0}" = "1" ] && EXIT_CODE="1"

if [ "$#" -gt 0 ]; then
  IMAGES=("$@")
else
  IMAGES=("marcowartmannmw/jamra-backend:$TAG" "marcowartmannmw/jamra-frontend:$TAG")
fi

# Persistent cache so the vulnerability DB isn't re-downloaded every run.
docker volume create trivy-cache >/dev/null

trivy() { docker run --rm -v trivy-cache:/root/.cache/ "$@"; }

status=0

# Skip local, gitignored artifact dirs: the dev TLS key, SFTP data, installed
# deps and build output aren't part of the repo and only add noise.
SKIP="nginx/certs,sftp/uploads,**/node_modules,**/.venv,**/dist"

echo "==> Filesystem scan (deps, Dockerfile/compose misconfig, secrets) — severity $SEVERITY"
trivy -v "$ROOT:/repo" "$TRIVY_IMAGE" fs \
  --scanners vuln,misconfig,secret --severity "$SEVERITY" --exit-code "$EXIT_CODE" \
  --skip-dirs "$SKIP" /repo || status=$?

for img in "${IMAGES[@]}"; do
  echo "==> Image scan: $img — severity $SEVERITY"
  # Mount the Docker socket so local images resolve; remote images are pulled.
  trivy -v /var/run/docker.sock:/var/run/docker.sock "$TRIVY_IMAGE" image \
    --severity "$SEVERITY" --exit-code "$EXIT_CODE" "$img" || status=$?
done

if [ "$EXIT_CODE" = "1" ] && [ "$status" -ne 0 ]; then
  echo "==> Findings at or above $SEVERITY (FAIL=1)." >&2
  exit 1
fi
echo "==> Scan complete (report-only; set FAIL=1 to gate)."
