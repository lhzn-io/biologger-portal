Deployment
==========

The portal runs in two halves on the fleet host that holds the canonical datasets folder (garnet):

- **The hub**, the full app with the catalog, registration and validation, runs as one container and is reached
  on the lab network and over the WireGuard VPN at ``http://garnet.internal:8797``. Nothing routes to it from the
  internet.
- **The published viewer** is a static snapshot of the reviewed tracks, served by Cloudflare as Workers static
  assets at ``https://whoi-mpg.lhzn.io`` behind Cloudflare Access (one-time PIN login, lab allow-list). Worker
  code runs only for ``/api/*``: the visit log, written by the viewer and read by the hub with a service token
  allowed only on ``/api/admin/*``.

The hub
-------

1. Settings: copy ``deploy/portal.env.example`` to ``~/.config/biologger-portal/portal.env`` (outside the
   repo, ``chmod 600``) and fill it in. It holds the Access service token that reads the visit log.
2. Container (OrbStack): ``docker compose -f deploy/compose.yaml up -d --build``. Check
   ``curl -s http://garnet.internal:8797/api/health``. The container restarts with OrbStack.
3. Catalog: ``docker exec biologger-portal /app/server/.venv/bin/biologger-portal import`` reads the metadata
   sheets and scans the datasets folder; it also fetches each track's terrain from topobathykit, which takes about
   30 to 60 s per new track. Later, ``... biologger-portal scan`` picks up files copied in with rsync.

Editors sign in through the hub's tunnel hostname, behind Cloudflare Access: the signed
``Cf-Access-Jwt-Assertion`` header names them, and ``PORTAL_EDITORS`` lists who may edit. Reading the hub
directly on the VPN (``garnet.internal:8797``) is anonymous and read-only: no registration, uploads,
simulation runs or visitor log. Simulation runners use tokens of their own (see below). A token that fails verification is refused.

Simulation runners
------------------

Editors queue biologger-sim runs on the hub's Runs page (one deployment, or a batch over many), or with Run
simulation on a deployment's page. Runners do the work: each claims the oldest job it can take, runs
``biologger-sim export-track`` on the job's config, and sends the track bundle back. The hub checks that the
bundle came from the config it stored before it lands in ``<deployment>/tracks/<run_id>/``.

Runners reach the hub at ``garnet.internal:8797`` (or ``127.0.0.1:8797`` on garnet), never through the tunnel.
Each has a token of its own; the hub keeps only the token's SHA-256.

1. Token, on the runner's host (the value never leaves that host)::

       mkdir -p ~/.config/biologger-portal
       (umask 077; openssl rand -hex 32 > ~/.config/biologger-portal/runner.token)

2. Hub: add ``<name>:<sha256>`` to ``PORTAL_RUNNER_TOKENS`` in ``portal.env`` and restart the container. The
   hash is ``printf %s "$(cat ~/.config/biologger-portal/runner.token)" | shasum -a 256``.
3. Settings: copy ``deploy/runner/runner.env.example`` to ``~/.config/biologger-portal/runner.env``.

garnet runs the runner natively under launchd, with biologger-sim installed beside it at the commit pinned in
``runner/pyproject.toml`` (an installed package, not a second checkout)::

    cd runner && uv sync --extra sim --no-dev
    .venv/bin/biologger-portal-runner --env-file ~/.config/biologger-portal/runner.env --once   # one job, by hand
    cp ../deploy/launchd/io.lhzn.biologger-portal-runner.plist ~/Library/LaunchAgents/
    launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/io.lhzn.biologger-portal-runner.plist

It logs to ``~/Library/Logs/biologger-portal-runner.log``. A runner stopped mid-job does not report it: the
hub puts the job back in the queue once its heartbeats stop for 3 minutes, and gives up after 2 attempts.
Failed and canceled jobs can be retried from the Runs page with the same config.

biologger-sim's lab mode, which ``export-track`` runs, computes on the CPU whatever the config's
``simulation.backend`` says, so runners offer ``cpu``. A job's backend preference only decides which runners
may take it.

The published viewer
--------------------

``deploy/cloudflare/publish.sh`` writes the snapshot from the catalog, packs the licensed animal models under a
key made for that build, builds the web app in published mode and deploys it with wrangler. It refuses to deploy
unless the host already answers with an Access login, so data never goes up unprotected.

- Settings in ``~/.config/biologger-portal/env`` (never committed): ``CLOUDFLARE_ACCOUNT_ID``, and optionally
  ``PORTAL_DATASETS_ROOT`` and ``PORTAL_MODELS_DIR``.
- wrangler needs a one-time ``npx wrangler@4 login`` on the host.
- ``--dry-run`` assembles ``web/dist-published/`` without deploying.

The daily run
-------------

``deploy/daily.sh`` scans the datasets folder in the hub container, then runs ``publish.sh`` only when the
snapshot's content or the checked-out commit changed since the last publish (``--force`` publishes regardless).
``deploy/launchd/io.lhzn.biologger-portal-daily.plist`` runs it at 04:15 each day, logging to
``~/Library/Logs/biologger-portal-daily.log``::

    cp deploy/launchd/io.lhzn.biologger-portal-daily.plist ~/Library/LaunchAgents/
    launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/io.lhzn.biologger-portal-daily.plist

Limits
------

- Access is free for up to 50 users.
- topobathykit serves one request at a time. The portal caches every DEM crop on disk and never requests map
  tiles; clear ``.portal/topobathy-cache/`` after a DEM dataset is rebuilt.
- Files of several GB are better copied to the host with rsync and registered by a scan than uploaded.
