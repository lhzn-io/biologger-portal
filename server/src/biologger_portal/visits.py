# Copyright (c) 2026 Long Horizon Observatory
# Licensed under the Apache License, Version 2.0. See LICENSE file for details.

"""The live viewer's visit log, mirrored into the catalog for the hub's Visitors page.

The published viewer's Worker (deploy/cloudflare/worker) records each page opened and a few actions with the
visitor's Cloudflare Access email in its D1 database. The hub pulls new rows through the Worker's admin read,
which Access guards with a service token, and keeps the same 180 days. Nothing here is ever published.
"""

import json
import re
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx

from .db import Catalog, utcnow
from .settings import Settings

RETENTION_DAYS = 180
PAGE = 1000
TIMEOUT = httpx.Timeout(connect=10.0, read=30.0, write=10.0, pool=30.0)
TRACK_PATH = re.compile(r"^/deployments/([^/?#]+)/track/([^/?#]+)")


class VisitsNotConfigured(Exception):
    """The hub has no Access service token for the Worker's admin read."""


def configured(settings: Settings) -> bool:
    return bool(settings.cf_access_client_id and settings.cf_access_client_secret)


def _cutoff(now: datetime, days: int) -> str:
    return (now - timedelta(days=days)).strftime("%Y-%m-%dT%H:%M:%SZ")


def pull_visits(
    catalog: Catalog, settings: Settings, transport: httpx.BaseTransport | None = None
) -> dict[str, Any]:
    """Fetch rows newer than the newest held, page by page, then drop rows past retention."""
    if not configured(settings):
        raise VisitsNotConfigured("set PORTAL_CF_ACCESS_CLIENT_ID and PORTAL_CF_ACCESS_CLIENT_SECRET")
    row = catalog.one(
        "SELECT MAX((SELECT COALESCE(MAX(id), 0) FROM site_visit),"
        " (SELECT COALESCE(MAX(latest_id), 0) FROM site_visit_pull)) AS m"
    )
    after = int(row["m"]) if row else 0
    fetched = 0
    headers = {
        "CF-Access-Client-Id": settings.cf_access_client_id,
        "CF-Access-Client-Secret": settings.cf_access_client_secret,
    }
    with httpx.Client(
        timeout=TIMEOUT, transport=transport, headers=headers, follow_redirects=False
    ) as client:
        while True:
            r = client.get(settings.visits_url, params={"after_id": after, "limit": PAGE})
            r.raise_for_status()  # a redirect to the Access login means the token was not accepted
            rows = r.json()["visits"]
            with catalog.tx() as conn:
                conn.executemany(
                    "INSERT OR IGNORE INTO site_visit (id, at_utc, email, country, kind, path, action, detail)"
                    " VALUES (:id, :at_utc, :email, :country, :kind, :path, :action, :detail)",
                    rows,
                )
            fetched += len(rows)
            if rows:
                after = max(int(v["id"]) for v in rows)
            if len(rows) < PAGE:
                break
    with catalog.tx() as conn:
        purged = conn.execute(
            "DELETE FROM site_visit WHERE at_utc < ?", (_cutoff(datetime.now(UTC), RETENTION_DAYS),)
        ).rowcount
        conn.execute(
            "INSERT INTO site_visit_pull (at_utc, fetched, latest_id) VALUES (?, ?, ?)",
            (utcnow(), fetched, after),
        )
    return {"fetched": fetched, "latest_id": after, "purged": purged}


def summary(catalog: Catalog, days: int, now: datetime | None = None, recent: int = 200) -> dict[str, Any]:
    """Per person over the last `days`: first and last seen, pages, tracks opened, action counts; and the latest rows."""
    since = _cutoff(now or datetime.now(UTC), days)
    rows = catalog.query("SELECT * FROM site_visit WHERE at_utc >= ? ORDER BY id DESC", (since,))
    people: dict[str, dict[str, Any]] = {}
    for r in rows:
        p = people.setdefault(
            r["email"],
            {
                "email": r["email"],
                "first_seen": r["at_utc"],
                "last_seen": r["at_utc"],
                "pages": 0,
                "tracks": [],
                "actions": {},
            },
        )
        p["first_seen"] = min(p["first_seen"], r["at_utc"])
        p["last_seen"] = max(p["last_seen"], r["at_utc"])
        if r["kind"] == "page":
            p["pages"] += 1
            m = TRACK_PATH.match(r["path"])
            if m and m.group(1) not in p["tracks"]:
                p["tracks"].append(m.group(1))
        elif r["action"]:
            p["actions"][r["action"]] = p["actions"].get(r["action"], 0) + 1
    last = catalog.one("SELECT at_utc FROM site_visit_pull ORDER BY rowid DESC LIMIT 1")
    return {
        "days": days,
        "last_pull_utc": last["at_utc"] if last else None,
        "people": sorted(people.values(), key=lambda p: p["last_seen"], reverse=True),
        "recent": [{**r, "detail": json.loads(r["detail"] or "{}")} for r in rows[:recent]],
    }
