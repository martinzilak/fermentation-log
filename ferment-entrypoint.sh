#!/bin/sh
# Starts as root so Unraid's Tailscale hook can install and run tailscaled
# first, then drops to PUID:PGID (Unraid's nobody:users by default).
set -eu

mkdir -p "$DATA_DIR"

if [ "$(id -u)" = 0 ]; then
  # Only touch files with the wrong owner; leave Tailscale's state alone.
  find "$DATA_DIR" -path "$DATA_DIR/.tailscale_state" -prune -o \
    \( \! -user "$PUID" -o \! -group "$PGID" \) -exec chown "$PUID:$PGID" {} +
  exec setpriv --reuid="$PUID" --regid="$PGID" --clear-groups node /app/dist/server/index.js
fi

exec node /app/dist/server/index.js
