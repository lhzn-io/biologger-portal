# Copyright (c) 2026 Long Horizon Observatory
# Licensed under the Apache License, Version 2.0. See LICENSE file for details.

import hashlib
import time
from pathlib import Path

from fastapi.testclient import TestClient

from biologger_portal.app import create_app
from biologger_portal.settings import Settings


def test_deployments_and_matrix(client: TestClient) -> None:
    deps = {d["id"]: d for d in client.get("/api/deployments").json()}
    assert deps["WHOI.900_20250101"]["track_count"] == 1
    detail = client.get("/api/deployments/WHOI.900_20250101").json()
    assert detail["fields"]["deployment_team"] == "A. Person"
    assert any(f["kind"] == "standard" for f in detail["files"])
    assert detail["validation_runs"][0]["unverified"] is True

    m = client.get("/api/matrix").json()
    rows = {r["deployment_id"]: r["cells"] for r in m["rows"]}
    assert rows["WHOI.900_20250101"]["standard"]["state"] == "present"
    assert rows["WHOI.900_20250101"]["mag_heading"]["state"] == "remote"  # a Drive folder is listed
    assert rows["RED900_20220101"]["mag_heading"]["state"] == "missing"
    assert m["unattributed_files"] == 1  # stray.bin


def test_edit_requires_editor_and_is_audited(client: TestClient, settings: Settings) -> None:
    r = client.patch("/api/deployments/RED900_20220101", json={"fields": {"notes": "checked"}})
    assert r.status_code == 200
    assert r.json()["audit"][0]["actor"] == "tester@example.org"
    assert (
        client.patch("/api/deployments/RED900_20220101", json={"fields": {"bogus": "x"}}).status_code == 422
    )

    anon = TestClient(create_app(Settings(datasets_root=settings.datasets_root)))
    assert anon.get("/api/deployments").status_code == 200
    assert anon.patch("/api/deployments/RED900_20220101", json={"fields": {"notes": "x"}}).status_code == 403


def test_access_token_required_when_configured(settings: Settings) -> None:
    app = create_app(
        Settings(
            datasets_root=settings.datasets_root,
            access_team_domain="https://t.cloudflareaccess.com",
            access_aud="aud",
        )
    )
    assert TestClient(app).get("/api/deployments").status_code == 401


def test_validation_runs_light_inline_and_deep_in_background(client: TestClient) -> None:
    files = {f["path"]: f["id"] for f in client.get("/api/files").json()}
    fid = files["RED900_20220101-standard.csv"]
    light = client.post("/api/validation", json={"file_id": fid, "mode": "light"}).json()
    assert light["status"] == "warning" and light["results"]["facts"]["accel_unit"] == "m/s^2"

    run = client.post("/api/validation", json={"file_id": fid, "mode": "deep"}).json()
    for _ in range(100):
        run = client.get(f"/api/validation/{run['id']}").json()
        if run["status"] not in ("queued", "running"):
            break
        time.sleep(0.05)
    assert run["results"]["facts"]["channels"]["depth_m"]["fill_fraction"] == 0.04


def test_validation_of_a_vanished_file_errors_without_inventing_results(
    client: TestClient, datasets: Path
) -> None:
    fid = {f["path"]: f["id"] for f in client.get("/api/files").json()}["WHOI.900_20250101-standard.csv"]
    (datasets / "WHOI.900_20250101-standard.csv").unlink()
    run = client.post("/api/validation", json={"file_id": fid, "mode": "light"}).json()
    assert run["status"] == "error" and "not found" in run["summary"]


def test_track_files_served_only_from_catalog(client: TestClient) -> None:
    tracks = client.get("/api/tracks").json()
    assert tracks[0]["url"] == "/tracks/WHOI.900_20250101/run-1/"
    assert client.get("/tracks/WHOI.900_20250101/run-1/track.json").json()["count"] == 4
    assert len(client.get("/tracks/WHOI.900_20250101/run-1/track.f32").content) == 8 * 4 * 4
    assert client.get("/tracks/WHOI.900_20250101/run-1/config.yaml").status_code == 404
    assert client.get("/tracks/WHOI.900_20250101/other/track.json").status_code == 404
    r = client.put("/api/deployments/WHOI.900_20250101/published-track", json={"run_id": "run-1"})
    assert r.json()["published"] == "run-1"


def test_chunked_upload(client: TestClient, datasets: Path) -> None:
    payload = (datasets / "WHOI.900_20250101-standard.csv").read_bytes()[:2500]
    payload = payload[: payload.rfind(b"\n") + 1]
    sha = hashlib.sha256(payload).hexdigest()
    up = client.post(
        "/api/uploads",
        json={
            "deployment_id": "RED900_20220101",
            "filename": "RED900_extra-standard.csv",
            "size": len(payload),
            "sha256": sha,
        },
    ).json()
    assert up["parts"] == 3 and up["target"] == "RED900_20220101/standard/RED900_extra-standard.csv"
    for i in range(up["parts"]):
        part = payload[i * 1024 : (i + 1) * 1024]
        assert client.put(f"/api/uploads/{up['id']}/parts/{i}", content=part).status_code == 200
    assert client.put(f"/api/uploads/{up['id']}/parts/0", content=b"x" * 2000).status_code == 413
    done = client.post(f"/api/uploads/{up['id']}/complete").json()
    assert done["sha256"] == sha and (datasets / done["path"]).read_bytes() == payload
    assert done["validation_run"] > 0
    dup = client.post(
        "/api/uploads",
        json={"deployment_id": "RED900_20220101", "filename": "RED900_extra-standard.csv", "size": 10},
    )
    assert dup.status_code == 409
    bad = client.post(
        "/api/uploads", json={"deployment_id": "RED900_20220101", "filename": "../x.csv", "size": 1}
    )
    assert bad.status_code == 422
