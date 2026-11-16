#!/bin/bash
# The daily run on the fleet host (launchd: deploy/launchd/io.lhzn.biologger-portal-daily.plist).
#
# 1. Scans the datasets folder in the hub container, so files copied in by rsync reach the catalog, and copies
#    new rows of the live viewer's visit log into the catalog.
# 2. Republishes the viewer (deploy/cloudflare/publish.sh) only when the snapshot's content or the checked-out
#    commit changed since the last publish; otherwise it does nothing.
#
# Usage: deploy/daily.sh [--force]
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$HOME/.orbstack/bin"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
STATE_DIR="$HOME/.config/biologger-portal"
STATE="$STATE_DIR/last-publish"
ENV_FILE="$STATE_DIR/env"
if [ -f "$ENV_FILE" ]; then set -a; . "$ENV_FILE"; set +a; fi
export PORTAL_DATASETS_ROOT="${PORTAL_DATASETS_ROOT:-$HOME/Projects/whoi-mpg/datasets}"

echo "== $(date -u +%Y-%m-%dT%H:%M:%SZ) daily run"
docker exec biologger-portal /app/server/.venv/bin/biologger-portal scan
# The live viewer's visit log, for the hub's Visitors page (skipped until the Access service token is set).
docker exec biologger-portal /app/server/.venv/bin/biologger-portal pull-visits || echo "visit log not pulled"

SNAP="$(mktemp -d)"
trap 'rm -rf "$SNAP"' EXIT
(cd "$REPO/server" && uv run --quiet biologger-portal publish --out "$SNAP" >/dev/null)
content="$(sed -n 's/.*"content_sha256": *"\([0-9a-f]*\)".*/\1/p' "$SNAP/data/v1/snapshot.json" | head -1)"
commit="$(git -C "$REPO" rev-parse HEAD)"
current="$content $commit"
if [ "${1:-}" != "--force" ] && [ -f "$STATE" ] && [ "$(cat "$STATE")" = "$current" ]; then
  echo "unchanged (snapshot ${content:0:12}, commit ${commit:0:7}): not publishing"
  exit 0
fi
"$REPO/deploy/cloudflare/publish.sh"
mkdir -p "$STATE_DIR"
echo "$current" >"$STATE"
echo "published snapshot ${content:0:12} at commit ${commit:0:7}"
