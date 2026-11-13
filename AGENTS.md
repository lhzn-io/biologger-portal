# biologger-portal: agent context

Repository context and rules for AI developer agents. The design and phase plan live in the agent lab: `whoi-mpg-uplift-agent-lab/docs/planning/biologger-portal/implementation_plan.md`.

## Execution rules

- **Commits:** present the full diff and the exact commit message to the user before every `git commit`. Never `git push` (including tags) without the user's explicit go-ahead.
- **Attribution:** commits are authored as the human contributor (`git var GIT_AUTHOR_IDENT`). No `Co-Authored-By` trailers; record the agent in the body as plain text (for example, "Collaborated with Claude Code (Opus 5.5).").
- **Golden copy:** `garnet:/Users/lhzn/Projects/whoi-mpg/biologger-portal`. Do not create other checkouts.

## Style

1. No emojis in code, comments, commits, docs or UI text.
2. No em dashes; use parentheses, colons, semicolons, or separate sentences.
3. Grounded language: quantities over adjectives; no sales or urgency vocabulary.
4. The organization is "Long Horizon Observatory".

## Architecture

- `web/`: React 19, Vite, strict TypeScript, Tailwind 4, React Router, TanStack Query, Vitest. Commands: `npm run dev | build | typecheck | lint | test`.
- `server/`: FastAPI under uv, package `biologger_portal` in `server/src/`. Commands: `uv run biologger-portal serve [--reload]`, `uv run pytest`, `uv run ruff check`, `uv run mypy`.
- Settings are `PORTAL_*` environment variables (`server/src/biologger_portal/settings.py`): `PORTAL_DATASETS_ROOT`, `PORTAL_WEB_DIST`, `PORTAL_TOPOBATHYKIT_URL`, `PORTAL_ACCESS_TEAM_DOMAIN`, `PORTAL_ACCESS_AUD`, `PORTAL_EDITORS`.
- The dev server binds `127.0.0.1:8797`. In production the hub container publishes 8797 to the lab network and VPN (`garnet.internal:8797`, no internet route, anonymous read-only); the published viewer is a static snapshot on a Cloudflare Worker at `whoi-mpg.lhzn.io` behind Cloudflare Access (`deploy/cloudflare/publish.sh`, daily via `deploy/daily.sh`). Editors are recognized only from the `Cf-Access-Jwt-Assertion` header. See `docs/src/deploy.rst`.
- Proxy targets and server URLs use `127.0.0.1`, never `localhost` (Node 17+ resolves localhost to `::1`).

## Data

- The canonical datasets folder is `garnet:/Users/lhzn/Projects/whoi-mpg/datasets`; the coriolis WSL copy is a pulled mirror. The portal keeps its own state in `datasets/.portal/` (SQLite catalog in `journal_mode=DELETE`, because WAL fails on macOS host-shared mounts).
- Layout: `<deployment_id>/{standard,derived,raw,media,tracks}/`, sheets in `_metadata/`, the prototype's registries in `_metadata/prototype/`. Move files only with `biologger-portal layout plan`, review `.portal/layout-plan.json`, then `layout apply` (renames in place, recorded in `.portal/moves-*.json`, undone by `layout revert <record>`).
- Never commit telemetry, CSV or Feather files.
- Validation results come only from reading the files. Never synthesize a result when a file is missing or unreadable; fail the run with the reason.

## AI

- No embedded chatbot and no model or gateway dependency. "Ask your AI" builds a prompt and an image from what the user collected; the prompt is built from the same values the page renders, and the image is never the source of a number.
- Prompt templates are files in `configs/prompts/`, imported with Vite's `?raw`.

## Topobathymetry

- topobathykit (`garnet.internal:9595`) has one worker and no CORS. Reach it only through the server's `/topobathy/*` proxy, which caches DEM crops (`meta` and `elevation.bin` with `bbox`, 14 to 28 s each when uncached) on disk and sends one request at a time with timeouts. The viewer requests no map tiles: an uncached tile makes topobathykit fuse it on its single worker.
