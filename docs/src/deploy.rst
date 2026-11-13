Deployment
==========

The portal runs in two halves on the fleet host that holds the canonical datasets folder (garnet):

- **The hub**, the full app with the catalog, registration and validation, runs as one container and is reached
  on the lab network and over the WireGuard VPN at ``http://garnet.internal:8797``. Nothing routes to it from the
  internet.
- **The published viewer** is a static snapshot of the reviewed tracks, served by Cloudflare as Workers static
  assets at ``https://whoi-mpg.lhzn.io`` behind Cloudflare Access (one-time PIN login, lab allow-list). No Worker
  code runs.

The hub
-------

1. Settings: copy ``deploy/portal.env.example`` to ``deploy/portal.env`` and fill it in.
2. Container (OrbStack): ``docker compose -f deploy/compose.yaml up -d --build``. Check
   ``curl -s http://garnet.internal:8797/api/health``. The container restarts with OrbStack.
3. Catalog: ``docker exec biologger-portal /app/server/.venv/bin/biologger-portal import`` reads the metadata
   sheets and scans the datasets folder; it also fetches each track's terrain from topobathykit, which takes about
   30 to 60 s per new track. Later, ``... biologger-portal scan`` picks up files copied in with rsync.

Every visitor to the hub is anonymous and read-only for now: editors are recognized from the signed
``Cf-Access-Jwt-Assertion`` header, which only Cloudflare Access supplies. Editor sign-in on the VPN is planned.

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
