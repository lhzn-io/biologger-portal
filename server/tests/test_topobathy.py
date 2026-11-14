# Copyright (c) 2026 Long Horizon Observatory
# Licensed under the Apache License, Version 2.0. See LICENSE file for details.

import json

import httpx
from fastapi.testclient import TestClient

from biologger_portal.app import create_app
from biologger_portal.importers import import_all
from biologger_portal.settings import Settings
from biologger_portal.topobathy import track_bbox


class FakeTopobathykit:
    def __init__(self) -> None:
        self.calls: list[str] = []
        self.fail_next = False

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.calls.append(str(request.url))
        if self.fail_next:
            self.fail_next = False
            return httpx.Response(500, text="mosaic build failed")
        if request.url.path.endswith("/meta"):
            return httpx.Response(
                200, json={"width": 2, "height": 2, "bounds": [-45.59, 35.43, -45.39, 35.53]}
            )
        return httpx.Response(200, content=b"\x00" * 16)


def make_client(settings: Settings, fake: FakeTopobathykit, prefetch: bool = False) -> TestClient:
    s = settings.model_copy(update={"topobathy_prefetch": prefetch, "topobathykit_url": "http://tbk.test"})
    app = create_app(s, topobathy_transport=httpx.MockTransport(fake))
    import_all(app.state.catalog, s.datasets_root, actor="test")
    with app.state.catalog.tx() as conn:
        conn.execute("UPDATE deployment SET dem_dataset='112bafb5_30m' WHERE id='WHOI.900_20250101'")
    app.state.jobs.run_scan_now(hash_files=False)
    return TestClient(app)


def test_track_bbox_has_a_margin() -> None:
    assert track_bbox({"lat": [35.51, 35.52], "lon": [-45.52, -45.51]}) == (-45.57, 35.46, -45.46, 35.57)
    assert track_bbox({}) is None


def test_terrain_is_fetched_once_and_cached(settings: Settings) -> None:
    fake = FakeTopobathykit()
    client = make_client(settings, fake)
    terrain = client.get("/api/tracks/WHOI.900_20250101/run-1/terrain").json()
    assert terrain["dataset"] == "112bafb5_30m" and terrain["max_dim"] == 1024
    assert "bbox=-45.5700,35.4600,-45.4600,35.5700" in terrain["meta_url"]

    first = client.get(terrain["meta_url"])
    second = client.get(terrain["meta_url"])
    assert first.json()["width"] == 2 and second.json() == first.json()
    assert len(client.get(terrain["elevation_url"]).content) == 16
    assert len(fake.calls) == 2  # one meta, one elevation; the repeat came from the cache
    assert "max_dim=1024" in fake.calls[0] and fake.calls[0].startswith(
        "http://tbk.test/api/v1/dem/datasets/"
    )


def test_errors_are_not_cached_and_inputs_are_checked(settings: Settings) -> None:
    fake = FakeTopobathykit()
    client = make_client(settings, fake)
    fake.fail_next = True
    url = "/topobathy/dem/112bafb5_30m/meta?bbox=-45.59,35.43,-45.39,35.53&max_dim=512"
    assert client.get(url).status_code == 502
    assert client.get(url).status_code == 200
    assert client.get("/topobathy/dem/../meta").status_code == 404
    assert client.get("/topobathy/dem/x/meta?bbox=1,2,3").status_code == 422
    assert client.get("/topobathy/dem/x/meta?max_dim=10").status_code == 422
    assert client.get("/topobathy/dem/x/tiles").status_code == 404


def test_deployment_without_dem_has_no_terrain(settings: Settings, datasets: object) -> None:
    fake = FakeTopobathykit()
    client = make_client(settings, fake)
    with client.app.state.catalog.tx() as conn:  # type: ignore[attr-defined]
        conn.execute("UPDATE deployment SET dem_dataset='' WHERE id='WHOI.900_20250101'")
    assert client.get("/api/tracks/WHOI.900_20250101/run-1/terrain").status_code == 404


def test_browsers_revalidate_and_see_a_rebuilt_dem(settings: Settings) -> None:
    fake = FakeTopobathykit()
    client = make_client(settings, fake)
    url = client.get("/api/tracks/WHOI.900_20250101/run-1/terrain").json()["meta_url"]
    first = client.get(url)
    assert first.headers["cache-control"] == "private, no-cache"
    etag = first.headers["etag"]
    assert client.get(url, headers={"If-None-Match": etag}).status_code == 304
    # The DEM is rebuilt and the portal's cache cleared: the next request fetches again and the tag changes.
    for f in (settings.portal_dir / "topobathy-cache").iterdir():
        f.unlink()
    again = client.get(url, headers={"If-None-Match": etag})
    assert again.status_code == 200 and again.headers["etag"] != etag and len(fake.calls) == 2


def test_overview_covers_every_track(settings: Settings) -> None:
    client = make_client(settings, FakeTopobathykit())
    overview = client.get("/api/terrain/overview").json()
    single = client.get("/api/tracks/WHOI.900_20250101/run-1/terrain").json()
    assert overview["bbox"] == single["bbox"] and overview["dataset"] == "112bafb5_30m"


def test_scan_prefetches_terrain(settings: Settings) -> None:
    fake = FakeTopobathykit()
    client = make_client(settings, fake, prefetch=True)
    state = client.app.state.jobs.scan_state  # type: ignore[attr-defined]
    assert state["terrain_ready"] == ["WHOI.900_20250101/run-1"]
    assert len(fake.calls) == 2
    meta = json.loads(
        client.get(client.get("/api/tracks/WHOI.900_20250101/run-1/terrain").json()["meta_url"]).text
    )
    assert meta["height"] == 2 and len(fake.calls) == 2
