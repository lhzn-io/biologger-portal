#!/bin/bash
# Pack the licensed animal models for the dev server: writes deploy/models/dev-out/ (served at /models by the
# Vite dev server only) and its key to web/.env.development.local (read by `npm run dev`, never by a build).
# Both paths are gitignored. Restart the dev server afterwards so it picks up the key.
#
# Usage: deploy/models/pack-dev.sh   (PORTAL_MODELS_DIR overrides ~/Projects/whoi-mpg/models/cgtrader)
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
SRC="${PORTAL_MODELS_DIR:-$HOME/Projects/whoi-mpg/models/cgtrader}"
cd "$HERE"
[ node_modules/.package-lock.json -nt package-lock.json ] || npm ci --no-audit --no-fund
MODEL_KEY="$(openssl rand -hex 32)"
export MODEL_KEY
rm -rf dev-out
node pack-models.mjs --src "$SRC" --out dev-out
umask 077
printf 'VITE_MODEL_KEY=%s\n' "$MODEL_KEY" >"$REPO/web/.env.development.local"
echo "dev models in $HERE/dev-out; key in web/.env.development.local (restart npm run dev)"
