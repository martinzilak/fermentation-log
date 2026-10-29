#!/usr/bin/env bash
# Runs on the Unraid host from a fresh clone (started by nas-bootstrap.sh).
# Builds the image and recreates the container through Unraid's own updater,
# so the "Use Tailscale" hook and the template settings are kept.
set -euo pipefail

SRC="$(cd "$(dirname "$0")/.." && pwd)"
CONTAINER="${FERMENT_CONTAINER:-ferment-log}"
IMAGE="${FERMENT_IMAGE:-ferment-log:latest}"
REPO="${IMAGE%:*}"
UPDATER="/usr/local/emhttp/plugins/dynamix.docker.manager/scripts/update_container"
REV="$(git -C "$SRC" rev-parse --short HEAD 2>/dev/null || echo unknown)"

echo "==> Building $IMAGE ($REV)"
# Keep the running image as :previous for a manual rollback.
docker image inspect "$IMAGE" >/dev/null 2>&1 && docker tag "$IMAGE" "$REPO:previous"
docker build --label "org.opencontainers.image.revision=$REV" -t "$IMAGE" "$SRC"

if ! docker container inspect "$CONTAINER" >/dev/null 2>&1; then
  echo "==> Image built. No container named $CONTAINER yet: create it once in the Unraid UI (see README), then run this again."
  exit 0
fi

echo "==> Recreating $CONTAINER from its Unraid template (the server takes a VACUUM INTO backup on start)"
/usr/bin/php -q "$UPDATER" "$CONTAINER" >/dev/null || true

echo "==> Checking the container runs the new image"
want=$(docker image inspect -f '{{.Id}}' "$IMAGE")
have=$(docker container inspect -f '{{.Image}}' "$CONTAINER")
if [ "$want" != "$have" ]; then
  echo "!! $CONTAINER still runs the old image. Unraid's updater did not recreate it from the local tag."
  echo "!! See README → Deploying → 'If the updater ignores local images'."
  exit 1
fi

status=unknown
for _ in $(seq 1 60); do
  status=$(docker container inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$CONTAINER")
  case "$status" in
    healthy) echo "==> $CONTAINER is healthy ($REV)"; exit 0 ;;
    exited|dead|unhealthy) break ;;
  esac
  sleep 2
done
echo "!! $CONTAINER did not become healthy (status: $status). Last log lines:"
docker logs --tail 30 "$CONTAINER"
exit 1
