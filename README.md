# biologger-portal

Dataset hub and track viewer for the Woods Hole Oceanographic Institution Marine Predators Group (WHOI-MPG) biologger deployments.

- **Hub:** a catalog of deployments, their metadata and the files that exist for each, with validation of the tag data (sample rates per channel, gaps, units, time zones, deployment windows).
- **Track viewer:** each deployment's track, reconstructed by [biologger-sim](https://github.com/lhzn-io/biologger-sim), drawn over fused bathymetry from topobathykit, as a 2D map and a 3D view with linked depth and VeDBA charts.
- **Ask your AI:** collect the views you want to ask about and copy an image plus a prompt (with the same numbers as text) into the assistant you already use. The portal has no built-in chatbot.

The prototype that preceded this rebuild is preserved at the tag `prototype-v0`.

## Layout

| Path | Contents |
| :--- | :--- |
| `web/` | React 19, Vite and TypeScript web app |
| `server/` | FastAPI server (uv): the JSON API under `/api`, and the built web app at `/` |
| `configs/prompts/` | The prompt template behind "Ask your AI" |
| `docs/src/` | Sphinx user guide |
| `Dockerfile` | One image: builds `web/`, runs `server/` |

## Development

Prerequisites: Node.js 24 or later, and [uv](https://docs.astral.sh/uv/).

```bash
cd server && uv sync && PORTAL_DATASETS_ROOT=/path/to/datasets uv run biologger-portal serve --reload
```

```bash
cd web && npm install && npm run dev
```

The web dev server (port 5173) proxies `/api` to the server on `127.0.0.1:8797`.

Checks:

```bash
cd web && npm run typecheck && npm run lint && npm test && npm run build
```

```bash
cd server && uv run ruff check && uv run mypy && uv run pytest
```

## Deployment

The image runs on a fleet host with the datasets folder mounted at `/data`, bound to the loopback interface, and is published through a Cloudflare Tunnel behind Cloudflare Access.

```bash
docker build -t biologger-portal .
```

```bash
docker run -d --name biologger-portal -p 127.0.0.1:8797:8797 -v /path/to/datasets:/data biologger-portal
```

Telemetry and datasets never live in this repository.

## Attribution

Contributed by Long Horizon Observatory to accelerate the research of the WHOI Marine Predators Group, in collaboration with PI Dr. Camrin Braun.

## License

Apache License, Version 2.0. See `LICENSE`.
