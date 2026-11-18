#!/bin/bash
# Build and start the hub (deploy/compose.yaml) with the licensed animal models packed for it.
#
# The models are paid assets that may only be used built into the viewer. As in the publish step, they are packed
# into the viewer's encrypted format under a key made for this build and compiled into the web app; the server
# serves the packed files at /models from PORTAL_HUB_MODELS (default ~/.cache/biologger-portal/hub-models, outside
# the repository and the image). Without the source folder the 3D view and the physics inspector draw a plain
# marker.
#
# Usage: deploy/hub.sh [services...]   (default: portal; PORTAL_MODELS_DIR overrides the source folder,
#                                       ~/Projects/whoi-mpg/models/cgtrader)
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
SRC="${PORTAL_MODELS_DIR:-$HOME/Projects/whoi-mpg/models/cgtrader}"
OUT="${PORTAL_HUB_MODELS:-$HOME/.cache/biologger-portal/hub-models}"
export PORTAL_HUB_MODELS="$OUT"
services=("$@")
[ ${#services[@]} -gt 0 ] || services=(portal)
mkdir -p "$OUT"
packed="$(mktemp -d)"
trap 'rm -rf "$packed"' EXIT

if [ -d "$SRC" ]; then
  cd "$HERE/models"
  [ node_modules/.package-lock.json -nt package-lock.json ] || npm ci --no-audit --no-fund
  MODEL_KEY="$(openssl rand -hex 32)"
  export MODEL_KEY PORTAL_MODEL_KEY="$MODEL_KEY" # the packer and the image build read the key from the environment
  node pack-models.mjs --src "$SRC" --out "$packed"
else
  echo "no animal models at $SRC: the 3D view will draw a plain marker"
  export PORTAL_MODEL_KEY=""
fi

# Build first, then swap the packed files and restart, so the running hub never pairs a key with other files.
docker compose -f "$HERE/compose.yaml" build "${services[@]}"
rm -f "$OUT"/*.blgm "$OUT"/models.json
if [ -f "$packed/models.json" ]; then cp "$packed"/*.blgm "$packed"/models.json "$OUT"/; fi
docker compose -f "$HERE/compose.yaml" up -d --no-build "${services[@]}"
