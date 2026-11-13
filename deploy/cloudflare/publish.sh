#!/bin/bash
# Publish the viewer: write the snapshot from the catalog, build the web app in published mode, assemble
# web/dist-published/ (build + data/v1/ + _headers) and deploy it as the whoi-mpg-portal Worker.
#
# Usage: deploy/cloudflare/publish.sh [--dry-run] [--first]
#   --dry-run  assemble web/dist-published/ and stop before deploying (needs no Cloudflare login)
#   --first    the first deploy, before the host name exists: deploys the app shell without data/, waits
#              for the host to answer with a Cloudflare Access login, and only then deploys the data.
#              Every later deploy requires that Access already answers, so data never goes up unprotected.
#              The Access application for the host must exist before either.
#
# Settings come from ~/.config/biologger-portal/env (never committed):
#   CLOUDFLARE_ACCOUNT_ID   the account that holds the lhzn.io zone
#   PORTAL_DATASETS_ROOT    defaults to ~/Projects/whoi-mpg/datasets
# Authentication: `npx wrangler@4 login` once on this machine.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
HOST="whoi-mpg.lhzn.io"
WRANGLER="wrangler@4.161.0"
export WRANGLER_SEND_METRICS=false # no usage telemetry from this machine

DRY_RUN=0
FIRST=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --first) FIRST=1 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

ENV_FILE="$HOME/.config/biologger-portal/env"
if [ -f "$ENV_FILE" ]; then set -a; . "$ENV_FILE"; set +a; fi
export PORTAL_DATASETS_ROOT="${PORTAL_DATASETS_ROOT:-$HOME/Projects/whoi-mpg/datasets}"
SNAPSHOT="$PORTAL_DATASETS_ROOT/.portal/publish"

# Answers with a redirect to <team>.cloudflareaccess.com when Access protects the host.
access_protects_host() {
  local loc
  loc="$(curl -s -m 15 -o /dev/null -w '%{redirect_url}' "https://$HOST/data/v1/snapshot.json" || true)"
  [[ "$loc" == https://*.cloudflareaccess.com/* ]]
}

if [ "$DRY_RUN" = 0 ]; then
  : "${CLOUDFLARE_ACCOUNT_ID:?set CLOUDFLARE_ACCOUNT_ID in $ENV_FILE}"
  if [ "$FIRST" = 0 ] && ! access_protects_host; then
    echo "https://$HOST does not answer with a Cloudflare Access login; not deploying." >&2
    echo "Create the Access application for $HOST first (or pass --first for the very first deploy)." >&2
    exit 1
  fi
fi

# 1. The snapshot, from the catalog (read only; never calls topobathykit).
cd "$REPO/server"
uv run --quiet biologger-portal publish --out "$SNAPSHOT"

# 2. The web app in published mode.
cd "$REPO/web"
[ node_modules/.package-lock.json -nt package-lock.json ] || npm ci --no-audit --no-fund
npm run -s build:published

# 3. Assemble: build + snapshot + headers.
cp -R "$SNAPSHOT/data" dist-published/
cp "$REPO/deploy/cloudflare/_headers" dist-published/_headers
echo "assembled $(du -sh dist-published | cut -f1) in web/dist-published"

if [ "$DRY_RUN" = 1 ]; then
  echo "dry run: not deploying"
  exit 0
fi

# 4. Deploy. On the first deploy, the shell goes up alone until Access is seen answering for the new domain.
cd "$REPO/deploy/cloudflare"
if [ "$FIRST" = 1 ]; then
  HELD="$(mktemp -d)"
  mv "$REPO/web/dist-published/data" "$HELD/data"
  npx --yes "$WRANGLER" deploy
  echo "waiting for https://$HOST to answer with an Access login (DNS and certificate can take minutes)..."
  for _ in $(seq 1 40); do
    access_protects_host && break
    sleep 15
  done
  mv "$HELD/data" "$REPO/web/dist-published/data"
  rmdir "$HELD"
  if ! access_protects_host; then
    echo "https://$HOST does not answer with an Access login after 10 minutes; the data was not deployed." >&2
    exit 1
  fi
fi
npx --yes "$WRANGLER" deploy
if ! access_protects_host; then
  echo "WARNING: https://$HOST does not answer with a Cloudflare Access login after the deploy." >&2
  echo "Fix the Access application now, or remove the custom domain in the dashboard." >&2
  exit 1
fi
echo "published to https://$HOST (behind Cloudflare Access)"
