The hub for editors
===================

The hub (whoi-mpg-hub.lhzn.io) is where editors register files, edit metadata and start simulation
runs. Its pages keep their text short and link here.

File grid
---------

The file grid (``/matrix``) gives the count and size of the files on the server for each deployment
and kind. "Drive" marks a product that is not on the server while the deployment lists a Google Drive
folder, where it may be; the portal does not check Drive. Files the scan could not assign to a
deployment are counted at the top.

Uploading files
---------------

Files go up in 64 MB parts and land in the deployment's folder by kind (standard, derived, raw,
media). Existing files are never overwritten. For files of several GB, copy them to the server with
rsync and run a scan instead.

Adding a deployment
-------------------

The tag type suggests a simulation profile. A run needs the start fix and both times; the end fix,
when there is one, lets a track be pinned to where the animal was found.

Metadata sheets
---------------

Import either of the lab's metadata sheets, keyed by ``deployment_id`` or ``tag_id``. The preview
shows what would change and whether each deployment has files on the server. Nothing is written until
you apply the selected rows.

Simulation runs
---------------

The backend setting picks which runners may take a job. biologger-sim computes lab runs on the CPU
today, whatever the backend.

Visitors
--------

The Visitors page lists visits to the live viewer (whoi-mpg.lhzn.io) by people signed in through
Cloudflare Access: pages and a few actions, kept 180 days. The hub copies the viewer's log on Refresh,
and on any schedule the deployment sets up. It needs ``PORTAL_CF_ACCESS_CLIENT_ID`` and
``PORTAL_CF_ACCESS_CLIENT_SECRET`` (an Access service token for ``whoi-mpg.lhzn.io/api/admin/*``) in
``deploy/portal.env``; without them the page says it is not configured (see :doc:`deploy`).
