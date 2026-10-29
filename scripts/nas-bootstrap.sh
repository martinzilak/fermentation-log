#!/bin/bash
# Install once on the NAS as an Unraid User Script (see README → Deploying).
# Clones the branch fresh and runs the deploy script from that clone, so this
# file never needs to change when the deploy logic does.
set -euo pipefail

REPO_URL="${FERMENT_REPO:-https://github.com/martinzilak/fermentation-log.git}"
BRANCH="${FERMENT_BRANCH:-main}"
BUILD="${FERMENT_BUILD:-/tmp/ferment-log-build}" # RAM-backed on Unraid; nothing lands on the array

echo "==> Fetching $BRANCH from $REPO_URL"
rm -rf "$BUILD"
git clone --quiet --depth 1 --branch "$BRANCH" "$REPO_URL" "$BUILD"
git -C "$BUILD" log -1 --format='==> %h %s (%cr)'

bash "$BUILD/scripts/deploy-nas.sh"
