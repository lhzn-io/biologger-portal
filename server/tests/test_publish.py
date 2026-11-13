# Copyright (c) 2026 Long Horizon Observatory
# Licensed under the Apache License, Version 2.0. See LICENSE file for details.

import hashlib
import json
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from test_topobathy import FakeTopobathykit, make_client

from biologger_portal.publish import PublishError, publish
from biologger_portal.settings import Settings


def ready_client(settings: Settings) -> TestClient:
    """The fixture catalog with WHOI.900's run reviewed and its terrain cached, plus a real validation run."""
    client = make_client(settings, FakeTopobathykit())
    terrain = client.get("/api/tracks/WHOI.900_20250101/run-1/terrain").json()
    client.get(terrain["meta_url"])
    client.get(terrain["elevation_url"])
    client.put("/api/deployments/WHOI.900_20250101/published-track", json={"run_id": "run-1"})
    fid = {f["path"]: f["id"] for f in client.get("/api/files").json()}["WHOI.900_20250101-standard.csv"]
    client.post("/api/validation", json={"file_id": fid, "mode": "light"})
    client.patch("/api/deployments/RED900_20220101", json={"fields": {"notes": "edited"}})
    return client


def run_publish(client: TestClient, settings: Settings, out: Path) -> dict:  # type: ignore[type-arg]
    app: Any = client.app
    snap = publish(
        app.state.catalog, settings.datasets_root, out, app.state.topobathy, settings.topobathy_max_dim
    )
    return snap.manifest


def test_snapshot_contents_and_what_is_left_out(settings: Settings, tmp_path: Path) -> None:
    client = ready_client(settings)
    out = tmp_path / "pub"
    m = run_publish(client, settings, out)
    data = out / "data/v1"

    deps = {d["id"]: d for d in json.loads((data / "deployments.json").read_text())}
    assert deps["WHOI.900_20250101"]["track_count"] == 1 and deps["WHOI.900_20250101"]["last_validation"]
    detail = json.loads((data / "deployments/WHOI.900_20250101.json").read_text())
    assert "deployment_team" not in detail["fields"]  # people stay on the hub
    assert detail["audit"] == []  # the change history holds editor emails
    assert all(not r["unverified"] for r in detail["validation_runs"])  # prototype records left out
    assert detail["validation_runs"][0]["requested_by"] == ""
    assert detail["tracks"][0]["url"] == "/data/v1/tracks/WHOI.900_20250101/run-1/"
    assert not any(f["kind"] == "track" for f in detail["files"])

    assert (data / "tracks/WHOI.900_20250101/run-1/track.f32").stat().st_size == 8 * 4 * 4
    terrain = json.loads((data / "terrain/WHOI.900_20250101/run-1/terrain.json").read_text())
    assert terrain["elevation_url"] == "/data/v1/terrain/WHOI.900_20250101/run-1/elevation.bin"
    assert (data / "terrain/WHOI.900_20250101/run-1/elevation.bin").is_file()

    grid = {r["deployment_id"]: r["cells"] for r in json.loads((data / "matrix.json").read_text())["rows"]}
    assert grid["WHOI.900_20250101"]["track"]["state"] == "present"
    assert grid["RED900_20220101"]["track"]["state"] == "missing"

    for rel, info in m["files"].items():  # every checksum matches its file
        assert hashlib.sha256((out / rel).read_bytes()).hexdigest() == info["sha256"]
    assert "data/v1/snapshot.json" not in m["files"]


def test_unreviewed_tracks_are_not_published(settings: Settings, tmp_path: Path) -> None:
    client = make_client(settings, FakeTopobathykit())
    m = run_publish(client, settings, tmp_path / "pub")
    assert m["tracks"] == [] and not (tmp_path / "pub/data/v1/tracks/WHOI.900_20250101").exists()


def test_same_catalog_gives_the_same_content_hash(settings: Settings, tmp_path: Path) -> None:
    client = ready_client(settings)
    first = run_publish(client, settings, tmp_path / "pub")
    second = run_publish(client, settings, tmp_path / "pub")  # republishes over its own earlier snapshot
    assert first["content_sha256"] == second["content_sha256"]
    client.patch("/api/deployments/RED900_20220101", json={"fields": {"notes": "edited again"}})
    assert run_publish(client, settings, tmp_path / "pub")["content_sha256"] != first["content_sha256"]


def test_refuses_without_cached_terrain_or_into_a_foreign_folder(settings: Settings, tmp_path: Path) -> None:
    client = make_client(settings, FakeTopobathykit())
    client.put("/api/deployments/WHOI.900_20250101/published-track", json={"run_id": "run-1"})
    with pytest.raises(PublishError, match="terrain not cached"):
        run_publish(client, settings, tmp_path / "pub")
    client2 = ready_client(settings)
    foreign = tmp_path / "foreign"
    foreign.mkdir()
    (foreign / "keep.txt").write_text("not a snapshot")
    with pytest.raises(PublishError, match="not empty"):
        run_publish(client2, settings, foreign)
    assert (foreign / "keep.txt").is_file()


def test_publishes_a_track_with_no_dem_without_terrain(settings: Settings, tmp_path: Path) -> None:
    client = ready_client(settings)
    app: Any = client.app
    with app.state.catalog.tx() as conn:
        conn.execute("UPDATE deployment SET dem_dataset='', dem_policy='' WHERE id='WHOI.900_20250101'")
    m = run_publish(client, settings, tmp_path / "pub")
    data = tmp_path / "pub" / "data" / "v1"
    assert (data / "tracks/WHOI.900_20250101/run-1/track.f32").is_file()
    terrain = json.loads((data / "terrain/WHOI.900_20250101/run-1/terrain.json").read_text())
    assert terrain == {"detail": "WHOI.900_20250101 has no DEM dataset assigned"}
    assert not (data / "terrain/WHOI.900_20250101/run-1/elevation.bin").exists()
    assert len(m["tracks"]) == 1
