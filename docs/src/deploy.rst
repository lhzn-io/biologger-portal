Deployment
==========

The portal runs in two parts on garnet, the fleet host that holds the canonical datasets folder:

- **The hub** is the full app, with the catalog, registration and validation. It runs as one
  container. On the lab network and over the WireGuard VPN, it is reached at
  ``http://garnet.internal:8797``, anonymous and read-only. Editors and agent scripts reach it at
  ``https://whoi-mpg-hub.lhzn.io`` through a Cloudflare Tunnel, behind Cloudflare Access. The
  tunnel connects outward from garnet, so garnet opens no inbound port to the internet, and Access
  admits only the listed emails and service tokens.
- **The published viewer** is a static snapshot of the reviewed tracks and of the runs shared beside
  them. It is a separate Cloudflare Worker, not the hub. Cloudflare serves it as Workers static
  assets at ``https://whoi-mpg.lhzn.io``, behind Cloudflare Access (one-time PIN login, lab
  allow-list). Worker code runs only for ``/api/*``, which holds the visit log. The
  viewer writes the visit log, and the hub reads it with a service token that is allowed only on
  ``/api/admin/*``.

The hub
-------

1. Settings: copy ``deploy/portal.env.example`` to ``~/.config/biologger-portal/portal.env``
   (outside the repo, ``chmod 600``) and fill it in. It holds the Access service token that reads
   the visit log.
2. Container (OrbStack): run ``deploy/hub.sh``, then check it with
   ``curl -s http://garnet.internal:8797/api/health``. The container restarts with OrbStack. The
   script first packs the licensed animal models (``~/Projects/whoi-mpg/models/cgtrader``, or
   ``PORTAL_MODELS_DIR``) into ``~/.cache/biologger-portal/hub-models``, under a key made for the
   build, as the publish step does. The hub serves that folder at ``/models``. The script then runs
   ``docker compose build`` and ``up``. A plain
   ``docker compose -f deploy/compose.yaml up -d --build`` also works, but then the 3D view and the
   physics inspector draw a plain marker instead of the species model. When you run the script over
   a non-interactive ``ssh`` session, put OrbStack's ``docker`` on the path first:
   ``PATH=/usr/local/bin:$PATH deploy/hub.sh``.
3. Catalog: ``docker exec biologger-portal /app/server/.venv/bin/biologger-portal import`` reads the
   metadata sheets and scans the datasets folder. It also fetches each track's terrain from
   topobathykit, which takes about 30 to 60 s per new track. Later, ``... biologger-portal scan``
   picks up files copied in with rsync.

Editors sign in through the hub's tunnel hostname, behind Cloudflare Access. The signed
``Cf-Access-Jwt-Assertion`` header names the editor, and ``PORTAL_EDITORS`` lists who may edit.
Reading the hub directly on the VPN (``garnet.internal:8797``) is anonymous and read-only, with no
registration, uploads, simulation runs or visitor log. Simulation runners use their own tokens (see
below). The hub refuses a token that fails verification.

Tunnel and Access
-----------------

The ``cloudflared`` service in ``deploy/compose.yaml`` connects garnet to a Cloudflare Tunnel that
is managed in the dashboard. The connection runs outward from garnet, so garnet opens no inbound
port. One-time setup, in Cloudflare Zero Trust:

1. Networks > Tunnels > Create a tunnel (Cloudflared), named ``biologger-portal-hub``. Copy its token
   into ``~/.config/biologger-portal/tunnel.env`` as ``TUNNEL_TOKEN=`` (start from
   ``deploy/tunnel.env.example``, and ``chmod 600`` the file). Add the public hostname
   ``whoi-mpg-hub.lhzn.io`` with service ``http://portal:8797``. This also creates the DNS record.
2. Access > Applications > Add a self-hosted application on ``whoi-mpg-hub.lhzn.io`` with two policies: Allow,
   for the maintainers' emails, and Service Auth, for the agent scripts' service tokens.
3. In ``portal.env``, set ``PORTAL_ACCESS_TEAM_DOMAIN`` (``https://<team>.cloudflareaccess.com``),
   ``PORTAL_ACCESS_AUD`` (the application's audience tag), ``PORTAL_EDITORS``, ``PORTAL_SIGNIN_URL``
   (``https://whoi-mpg-hub.lhzn.io``) and ``PORTAL_AGENTS`` (see Agent API below). Then run
   ``deploy/hub.sh portal cloudflared``.

To check the setup, run ``curl -m 15 -sI https://whoi-mpg-hub.lhzn.io`` without signing in. It answers
with a redirect to the Access login. On the VPN, ``curl -m 15 http://garnet.internal:8797/api/me`` says
``anonymous``.

Agent API
---------

Scripts drive the hub as editors through the tunnel hostname. Each script has its own Cloudflare
Access service token (Access > Service credentials). The secret stays on the machine that runs the
script. The hub lists only the client ID, in ``PORTAL_AGENTS`` as ``["<name>:<client id>"]``, and
records the script's actions as ``agent:<name>``. The hub refuses a service token that it does not
list, even when Access lets the token through.

``/api/agent`` has the calls that a script needs most. Everything else is the API that the web app
uses, listed at ``https://whoi-mpg-hub.lhzn.io/api/docs``::

    H="https://whoi-mpg-hub.lhzn.io"
    AUTH=(-H "CF-Access-Client-Id: $CF_ACCESS_CLIENT_ID" -H "CF-Access-Client-Secret: $CF_ACCESS_CLIENT_SECRET")

    # The catalog's size, the run queue by status, and when each runner last reported.
    curl -m 30 -s "${AUTH[@]}" "$H/api/agent/status"

    # Queue a run for each deployment that can run; the others come back with their reasons.
    curl -m 30 -s "${AUTH[@]}" -H "Content-Type: application/json" \
      -d '{"deployment_ids": ["<deployment id>"], "rate_hz": 1}' "$H/api/agent/runs"

    # A run, waiting up to 120 s for it to finish.
    curl -m 150 -s "${AUTH[@]}" "$H/api/agent/runs/<job id>?wait=120"

Check a batch first with ``POST /api/sim/batches`` and ``"dry_run": true``. To cancel or retry a job,
use ``POST /api/sim/jobs/<id>/cancel`` or ``/retry``.

Simulation runners
------------------

Editors queue biologger-sim runs on the hub's Runs page (one deployment, or a batch over many), or
with Run simulation on a deployment's page. Runners do the work. Each runner claims the oldest job it
can take, runs ``biologger-sim export-track`` on the job's config, and sends the track bundle back.
Before the bundle lands in ``<deployment>/tracks/<run_id>/``, the hub checks that the bundle came
from the config that the hub stored.

Runners reach the hub at ``garnet.internal:8797`` (or ``127.0.0.1:8797`` on garnet), never through the
tunnel. Each runner has its own token, and the hub keeps only the token's SHA-256 hash.

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

The runner logs to ``~/Library/Logs/biologger-portal-runner.log``. A runner that stops mid-job does not
report the stop. The hub puts the job back in the queue after 3 minutes without heartbeats, and gives
up after 2 attempts. Failed and canceled jobs can be retried from the Runs page with the same config.

``export-track`` runs biologger-sim's lab mode, which computes on the CPU whatever the config's
``simulation.backend`` says. Runners therefore offer ``cpu``, and a job's backend preference only
decides which runners may take the job.

The published viewer
--------------------

``deploy/cloudflare/publish.sh`` builds and deploys the published viewer. It writes the snapshot from
the catalog, packs the licensed animal models under a key made for that build, builds the web app in
published mode, copies in the built documentation (from ``deploy/docs.sh``, served at ``/docs``), and
deploys the result with wrangler. The script refuses to deploy unless the host already answers with an
Access login, so data never goes up unprotected.

- Settings in ``~/.config/biologger-portal/env`` (never committed): ``CLOUDFLARE_ACCOUNT_ID``, and optionally
  ``PORTAL_DATASETS_ROOT`` and ``PORTAL_MODELS_DIR``.
- wrangler needs a one-time ``npx wrangler@4 login`` on the host.
- ``--dry-run`` assembles ``web/dist-published/`` without deploying.

The daily run
-------------

``deploy/daily.sh`` scans the datasets folder in the hub container. It then pulls the live viewer's
visit log for the Visitors page (``pull-visits``, skipped until the Access service token is set). Last,
it runs ``publish.sh``, but only when the snapshot's content or the checked-out commit has changed since
the last publish (``--force`` publishes regardless). ``deploy/launchd/io.lhzn.biologger-portal-daily.plist``
runs the script at 04:15 each day and logs to ``~/Library/Logs/biologger-portal-daily.log``::

    cp deploy/launchd/io.lhzn.biologger-portal-daily.plist ~/Library/LaunchAgents/
    launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/io.lhzn.biologger-portal-daily.plist

Limits
------

- Access is free for up to 50 users.
- topobathykit serves one request at a time. The portal caches every DEM crop on disk and never
  requests map tiles. Clear ``.portal/topobathy-cache/`` after a DEM dataset is rebuilt.
- Copy files of several GB to the host with rsync and register them with a scan, rather than uploading
  them.
