# Copyright (c) 2026 Long Horizon Observatory
# Licensed under the Apache License, Version 2.0. See LICENSE file for details.

"""The live viewer's visit log in the hub: pulling from the Worker, the summary, the routes, and never publishing it."""

import json
from datetime import UTC, datetime, timedelta
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

from biologger_portal.app import create_app
from biologger_portal.db import Catalog
from biologger_portal.settings import Settings
from biologger_portal.visits import VisitsNotConfigured, pull_visits, summary

NOW = datetime.now(UTC)


def iso(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def row(
    i: int, email: str, kind: str, path: str, action: str = "", ago_h: float = 1.0, detail: str = "{}"
) -> dict[str, object]:
    return {
        "id": i,
        "at_utc": iso(NOW - timedelta(hours=ago_h)),
        "email": email,
        "country": "US",
        "kind": kind,
        "path": path,
        "action": action,
        "detail": detail,
    }


class FakeWorker:
    """The Worker's admin read: pages of rows after an id, and only with the service token."""

    def __init__(self, rows: list[dict[str, object]]) -> None:
        self.rows = rows
        self.calls: list[str] = []

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.calls.append(str(request.url))
        if (
            request.headers.get("cf-access-client-id") != "cid"
            or request.headers.get("cf-access-client-secret") != "secret"
        ):
            return httpx.Response(302, headers={"location": "https://lab.cloudflareaccess.com/login"})
        after = int(request.url.params["after_id"])
        limit = int(request.url.params["limit"])
        page = [r for r in self.rows if int(r["id"]) > after][:limit]  # type: ignore[call-overload]
        return httpx.Response(200, json={"visits": page, "retention_days": 180})

    def transport(self) -> httpx.MockTransport:
        return httpx.MockTransport(self.handler)


@pytest.fixture
def token_settings(settings: Settings) -> Settings:
    return settings.model_copy(update={"cf_access_client_id": "cid", "cf_access_client_secret": "secret"})


@pytest.fixture
def catalog(tmp_path: Path) -> Catalog:
    return Catalog(tmp_path / "catalog.db")


def test_pull_pages_resumes_and_purges(
    catalog: Catalog, token_settings: Settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr("biologger_portal.visits.PAGE", 2)
    rows = [row(i, "cam@whoi.edu", "page", f"/p{i}") for i in range(1, 6)]
    rows.append(row(6, "old@whoi.edu", "page", "/old", ago_h=24 * 200))
    worker = FakeWorker(rows)
    first = pull_visits(catalog, token_settings, transport=worker.transport())
    assert first["fetched"] == 6 and first["latest_id"] == 6 and first["purged"] == 1
    assert len(worker.calls) == 4  # pages of 2, 2, 2, then an empty page
    worker.rows.append(row(7, "cam@whoi.edu", "page", "/p7"))
    second = pull_visits(catalog, token_settings, transport=worker.transport())
    assert second["fetched"] == 1
    assert "after_id=6" in worker.calls[4]
    assert [r["id"] for r in catalog.query("SELECT id FROM site_visit ORDER BY id")] == [1, 2, 3, 4, 5, 7]


def test_pull_needs_the_service_token(catalog: Catalog, settings: Settings) -> None:
    with pytest.raises(VisitsNotConfigured):
        pull_visits(catalog, settings)
    wrong = settings.model_copy(update={"cf_access_client_id": "cid", "cf_access_client_secret": "nope"})
    with pytest.raises(httpx.HTTPStatusError):
        pull_visits(catalog, wrong, transport=FakeWorker([]).transport())


def test_summary_counts_pages_tracks_and_actions(catalog: Catalog, token_settings: Settings) -> None:
    rows = [
        row(1, "cam@whoi.edu", "page", "/", ago_h=30),
        row(2, "cam@whoi.edu", "page", "/deployments/RED001_20220812/track/run-a?color=depth", ago_h=29),
        row(
            3,
            "cam@whoi.edu",
            "action",
            "/deployments/RED001_20220812/track/run-a",
            "play",
            ago_h=29,
            detail='{"speed":60}',
        ),
        row(4, "cam@whoi.edu", "action", "/deployments/RED001_20220812/track/run-a", "play", ago_h=28),
        row(5, "kim@whoi.edu", "page", "/deployments/19A0564_20250723/track/run-b", ago_h=2),
        row(6, "cam@whoi.edu", "page", "/deployments/RED001_20220812/track/run-a", ago_h=1),
        row(7, "cam@whoi.edu", "page", "/deployments", ago_h=24 * 40),
    ]
    pull_visits(catalog, token_settings, transport=FakeWorker(rows).transport())
    s = summary(catalog, days=30)
    assert [p["email"] for p in s["people"]] == ["cam@whoi.edu", "kim@whoi.edu"]
    cam = s["people"][0]
    assert cam["pages"] == 3 and cam["tracks"] == ["RED001_20220812"] and cam["actions"] == {"play": 2}
    assert cam["first_seen"] == rows[0]["at_utc"]
    assert s["recent"][0]["id"] == 6 and s["recent"][-1]["detail"] == {}
    assert next(r for r in s["recent"] if r["id"] == 3)["detail"] == {"speed": 60}
    assert s["last_pull_utc"] is not None


def test_routes(token_settings: Settings) -> None:
    worker = FakeWorker([row(1, "cam@whoi.edu", "page", "/deployments")])
    app = create_app(token_settings)
    app.state.visits_transport = worker.transport()
    with TestClient(app) as c:
        before = c.get("/api/visits").json()
        assert before["configured"] is True and before["people"] == []
        assert c.post("/api/visits/refresh").json()["fetched"] == 1
        assert c.post("/api/visits/refresh").status_code == 429  # at most once a minute
        after = c.get("/api/visits?days=7").json()
        assert after["people"][0]["email"] == "cam@whoi.edu" and after["days"] == 7


def test_refresh_without_a_token_is_503(settings: Settings) -> None:
    with TestClient(create_app(settings)) as c:
        assert c.get("/api/visits").json()["configured"] is False
        assert c.post("/api/visits/refresh").status_code == 503


def test_the_snapshot_never_holds_visits(settings: Settings, tmp_path: Path) -> None:
    from test_publish import ready_client, run_publish

    client = ready_client(settings)
    catalog: Catalog = client.app.state.catalog  # type: ignore[attr-defined]
    with catalog.tx() as conn:
        conn.execute(
            "INSERT INTO site_visit (id, at_utc, email, kind, path) VALUES (1, ?, 'secret.visitor@whoi.edu', 'page', '/')",
            (iso(NOW),),
        )
    out = tmp_path / "snap"
    run_publish(client, settings, out)
    text = "".join(p.read_text(errors="ignore") for p in out.rglob("*.json"))
    assert "secret.visitor" not in text and "site_visit" not in text
    assert json.loads((out / "data/v1/snapshot.json").read_text())["schema"]
