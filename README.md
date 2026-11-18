# biologger-portal

Dataset hub and track viewer for the Woods Hole Oceanographic Institution Marine Predators Group (WHOI-MPG) biologger deployments.

The portal runs in two forms from one codebase:

- **Hub:** the full application with the catalog, file registration and validation. It runs on the lab network and the WireGuard VPN.
- **Published viewer:** a read-only static snapshot of the catalog and tracks, served by Cloudflare behind Cloudflare Access to the lab's allow-list.

The prototype that preceded this rebuild is preserved at the tag `prototype-v0`.

## Features

- **Catalog:**
  - The Overview page shows a map of every track beside the deployments table.
  - Each deployment has a page with the animal, the deployment and the tag metadata, imported from the lab's metadata sheets.
  - The Files grid shows which data products exist for each deployment (standard, derived, raw, media, tracks), with counts and sizes.
- **Validation:** checks each tag data file by reading it: sample rates per channel, gaps, units, time zones, and the deployment window. A file that cannot be read fails with the reason; no result is ever filled in.
- **Registration (hub only):** upload a file to a deployment, create a deployment, or import a metadata sheet. Large files are better copied to the host with rsync and picked up by a scan.
- **Simulation runs (hub only):** queue [biologger-sim](https://github.com/lhzn-io/biologger-sim) runs for one deployment or a batch, from a run profile per tag type. Runners on the fleet hosts claim the jobs and send back track bundles, which the hub checks against the config it stored before indexing them.
- **Agent API (hub only):** scripts drive the hub as named editors through the tunnel, each with its own Cloudflare Access service token: queue runs, wait on them, and use the rest of the API listed at `/api/docs`.
- **Track viewer:** each deployment's track as reconstructed by [biologger-sim](https://github.com/lhzn-io/biologger-sim), drawn in 3D over fused bathymetry from topobathykit.
  - The animal is drawn with a model of its species, posed by pitch and roll.
  - Playback runs at 60, 600 or 3600 s of track per second, with a Chase camera that follows the animal's heading or an Orbit camera you steer around it.
  - The track can be colored by depth or by ODBA (overall dynamic body acceleration).
  - Studio mode fills the browser window; Full screen fills the display.
  - The view (time, camera, colors) is kept in the URL, so a link reopens the same view.
- **Linked charts:** depth with the seafloor under the animal, ODBA, roll angle and cumulative roll, on a shared time axis with the 3D view.
  - Scrubbing a chart moves the 3D view to that time.
  - A click on a chart can keep the view locked, turn the camera toward the animal at that time, or move the camera to center it.
- **Ask your AI:** collect the views you want to ask about, then copy an image plus a prompt (with the same numbers as text, and method notes) into the assistant you already use. The portal has no built-in chatbot and no model dependency. Pasting sends those data to the assistant you choose.
- **Visit log:** the published viewer records page views and a few actions (play, camera and color changes, copy) with each visitor's sign-in email. It keeps no IP address or browser details and deletes entries after 180 days. A footer notice tells visitors. The log is shown only on the hub's Visitors page.

## Development

The web app (`web/`) is React 19, Vite and TypeScript; the server (`server/`) is FastAPI under uv, serving the JSON API under `/api` and the built web app at `/`. The `Dockerfile` builds both into one image.

Prerequisites: Node.js 24 or later, Python 3.12 or later, and [uv](https://docs.astral.sh/uv/).

Run the server against a datasets folder:

```bash
cd server && uv sync && PORTAL_DATASETS_ROOT=/path/to/datasets uv run biologger-portal serve --reload
```

Run the web dev server, which proxies `/api` to the server on `127.0.0.1:8797`:

```bash
cd web && npm install && npm run dev
```

Build the published viewer (it reads a static snapshot instead of the API):

```bash
cd web && npm run build:published
```

Settings are `PORTAL_*` environment variables, listed in `server/src/biologger_portal/settings.py` and `deploy/portal.env.example`.

### Command line

The `biologger-portal` command manages the catalog (`uv run biologger-portal --help` in `server/`):

| Command | Purpose |
| :--- | :--- |
| `serve` | Run the API and web app |
| `import` | Import the metadata sheets, then scan |
| `scan` | Index the datasets folder |
| `validate` | Validate one cataloged file and print the result |
| `layout plan`, `layout apply`, `layout revert` | Move files into per-deployment folders: plan first, review, then apply; every move is recorded and can be reverted |
| `publish` | Write the static snapshot for the published viewer |
| `pull-visits` | Copy new rows of the published viewer's visit log into the catalog |

The portal keeps its own state in `<datasets>/.portal/`: the SQLite catalog, layout plans and move records, and the terrain cache.

### Checks

These run in CI (`.github/workflows/ci.yml`) on every pull request:

```bash
cd web && npm run typecheck && npm run lint && npm test && npm run build
```

```bash
cd server && uv run ruff check && uv run ruff format --check && uv run mypy && uv run pytest
```

The simulation runner (`runner/`) has its own:

```bash
cd runner && uv run ruff check && uv run ruff format --check && uv run mypy && uv run pytest
```

The visit-log Worker has its own type check and tests, using the web app's toolchain:

```bash
cd deploy/cloudflare/worker && ../../../web/node_modules/.bin/tsc -p tsconfig.json && ../../../web/node_modules/.bin/vitest run --root .
```

## Deployment

Both forms run from the fleet host that holds the datasets folder:

- **Hub:** the container from `deploy/compose.yaml`, at `http://garnet.internal:8797` on the lab network and the VPN. Read there, it is anonymous and read-only; editors and agent scripts sign in through the Cloudflare Tunnel at `https://whoi-mpg-hub.lhzn.io`, behind Cloudflare Access. Its settings, including the Access service token that reads the visit log, live outside the repository in `~/.config/biologger-portal/portal.env`.
- **Published viewer:** `https://whoi-mpg.lhzn.io`, deployed by `deploy/cloudflare/publish.sh`. The script refuses to deploy unless Cloudflare Access already protects the host. `deploy/daily.sh` scans, pulls the visit log, and republishes when the snapshot or the commit has changed.

```bash
deploy/hub.sh
```

`deploy/hub.sh` packs the licensed animal models for the build, as the publish step does, then builds and starts
the container. A plain `docker compose -f deploy/compose.yaml up -d --build` draws a plain marker instead.

Simulation runners run beside the hub on garnet (launchd) and on other fleet hosts; their setup is in the same guide.

Setup, the daily run and known limits are in [`docs/src/deploy.rst`](docs/src/deploy.rst).

## Data and licensed assets

Telemetry, datasets and the licensed animal models never live in this repository. The models are packed and encrypted per build when the viewer is published, and are never served unencrypted.

## Attribution

Contributed by Long Horizon Observatory to accelerate the research of the WHOI Marine Predators Group, in collaboration with PI Dr. Camrin Braun.

## License

Apache License, Version 2.0. See `LICENSE`.
