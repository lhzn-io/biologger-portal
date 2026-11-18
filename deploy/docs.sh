#!/bin/bash
# Build the documentation the hub serves at /docs (deploy/compose.yaml mounts PORTAL_HUB_DOCS read-only).
#
#   /docs/guide/  this repository's user guide (docs/src), built here
#   /docs/sim/    biologger-sim's documentation, built where its golden copy lives and copied in:
#                 rsync -a --delete <biologger-sim>/docs/build/html/ garnet:.local/share/biologger-portal/docs/sim/
#
# Both use the house theme (lhzn-sphinx-theme). The hub serves new files at once; no restart is needed. The
# published viewer (whoi-mpg.lhzn.io) takes them at its next publish (deploy/cloudflare/publish.sh).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="${PORTAL_HUB_DOCS:-$HOME/.local/share/biologger-portal/docs}"
mkdir -p "$OUT/guide" "$OUT/sim"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
uvx --from "sphinx>=8" --with "lhzn-sphinx-theme>=0.1.1,<0.2" sphinx-build -b html -q "$HERE/../docs/src" "$tmp/guide"
rsync -a --delete "$tmp/guide/" "$OUT/guide/"
echo "guide built into $OUT/guide; sim docs present: $([ -f "$OUT/sim/index.html" ] && echo yes || echo no)"
