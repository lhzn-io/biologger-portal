# Copyright (c) 2026 Long Horizon Observatory
# Licensed under the Apache License, Version 2.0. See LICENSE file for details.

import hashlib
import json
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest
from conftest import write_track
from fastapi.testclient import TestClient

from biologger_portal.sim_jobs import MAX_ATTEMPTS, STALE_AFTER_S, claim, reap

TOKEN = "runner-secret"
AUTH = {"Authorization": f"Bearer {TOKEN}"}
OTHER = {"Authorization": "Bearer other-secret"}
DEP = "WHOI.900_20250101"


@pytest.fixture
def hub(client: TestClient) -> TestClient:
    settings = client.app.state.settings  # type: ignore[attr-defined]
    client.app.state.settings = settings.model_copy(  # type: ignore[attr-defined]
        update={
            "runner_tokens": [
                f"garnet:{hashlib.sha256(TOKEN.encode()).hexdigest()}",
                f"coriolis:{hashlib.sha256(b'other-secret').hexdigest()}",
            ]
        }
    )
    return client


def new_job(c: TestClient, **extra: Any) -> dict[str, Any]:
    r = c.post("/api/sim/jobs", json={"deployment_id": DEP, "profile": "axy-standard", **extra})
    assert r.status_code == 201, r.text
    return r.json()  # type: ignore[no-any-return]


def bundle(
    tmp_path: Path, job: dict[str, Any], run_id: str, *, config_hash: str | None = None
) -> dict[str, bytes]:
    folder = tmp_path / "out" / run_id
    write_track(folder, job["deployment_id"], run_id)
    meta = json.loads((folder / "track.json").read_text())
    meta["data"] = {"file": "track.f32", "bytes": (folder / "track.f32").stat().st_size}
    meta["provenance"]["config_sha256"] = (
        config_hash or hashlib.sha256(job["config_yaml"].encode()).hexdigest()
    )
    (folder / "track.json").write_text(json.dumps(meta))
    return {n: (folder / n).read_bytes() for n in ("track.json", "track.f32", "track.geojson")}


def upload(c: TestClient, job_id: int, files: dict[str, bytes]) -> None:
    for name, data in files.items():
        assert (
            c.put(f"/api/runner/jobs/{job_id}/bundle/{name}", content=data, headers=AUTH).status_code == 200
        )


def test_jobs_need_a_runnable_setup(hub: TestClient) -> None:
    job = new_job(hub, backend="cpu", rate_hz=2)
    assert job["status"] == "queued" and job["backend_pref"] == "cpu" and job["rate_hz"] == 2
    blocked = hub.post("/api/sim/jobs", json={"deployment_id": "RED900_20220101", "profile": "axy-standard"})
    assert blocked.status_code == 422 and "time_end_utc" in blocked.text
    assert hub.post("/api/sim/jobs", json={"deployment_id": DEP, "backend": "tpu"}).status_code == 422


def test_batch_plans_then_makes_jobs(hub: TestClient) -> None:
    body = {"deployment_ids": [DEP, "RED900_20220101", "nope"], "profile": "axy-standard", "dry_run": True}
    plan = hub.post("/api/sim/batches", json=body).json()
    assert [p["deployment_id"] for p in plan["planned"]] == [DEP]
    assert {s["deployment_id"] for s in plan["skipped"]} == {"RED900_20220101", "nope"}
    assert plan["jobs"] == [] and hub.get("/api/sim/jobs").json() == []

    made = hub.post("/api/sim/batches", json={**body, "dry_run": False, "label": "test"}).json()
    assert made["batch_id"] and [j["deployment_id"] for j in made["jobs"]] == [DEP]
    assert hub.get("/api/sim/jobs").json()[0]["batch_id"] == made["batch_id"]


def test_runner_auth_and_backend_matching(hub: TestClient) -> None:
    new_job(hub, backend="warp")
    assert hub.post("/api/runner/claim", json={"backends": ["cpu"]}).status_code == 401
    assert (
        hub.post(
            "/api/runner/claim", json={"backends": ["cpu"]}, headers={"Authorization": "Bearer x"}
        ).status_code
        == 401
    )
    assert hub.post("/api/runner/claim", json={"backends": ["mlx", "cpu"]}, headers=AUTH).status_code == 204
    got = hub.post("/api/runner/claim", json={"backends": ["warp", "cpu"]}, headers=OTHER)
    assert got.status_code == 200 and got.json()["input_name"] == "input.csv"
    assert got.json()["config_name"] == f"{DEP}-axy-standard.yaml"
    # One claimer per job.
    assert hub.post("/api/runner/claim", json={"backends": ["warp"]}, headers=AUTH).status_code == 204


def test_a_run_lands_as_a_track(hub: TestClient, tmp_path: Path) -> None:
    job = new_job(hub)
    claimed = hub.post("/api/runner/claim", json={"backends": ["cpu"]}, headers=AUTH).json()
    jid = claimed["id"]
    full = hub.get(f"/api/sim/jobs/{jid}").json()
    assert hub.get(f"/api/runner/jobs/{jid}/config", headers=AUTH).text == full["config_yaml"]
    assert hub.get(f"/api/runner/jobs/{jid}/meta.csv", headers=AUTH).text.startswith("tag_id,")
    data = hub.get(f"/api/runner/jobs/{jid}/input", headers=AUTH)
    assert len(data.content) == job["input_size"]
    part = hub.get(f"/api/runner/jobs/{jid}/input", headers={**AUTH, "Range": "bytes=10-19"})
    assert part.status_code == 206 and part.content == data.content[10:20]
    # Another runner cannot touch it.
    assert hub.get(f"/api/runner/jobs/{jid}/config", headers=OTHER).status_code == 409

    hb = {"backend": "cpu", "sim_commit": "af51867", "sim_dirty": False, "log_tail": "line 1\nline 2"}
    assert hub.post(f"/api/runner/jobs/{jid}/heartbeat", json=hb, headers=AUTH).status_code == 200
    assert hub.get(f"/api/sim/jobs/{jid}").json()["status"] == "running"

    upload(hub, jid, bundle(tmp_path, full, "20261117-120000_test-run"))
    done = hub.post(f"/api/runner/jobs/{jid}/finish", json={"log_tail": "finished"}, headers=AUTH)
    assert done.status_code == 200, done.text
    assert done.json()["run_id"] == "20261117-120000_test-run"
    row = hub.get(f"/api/sim/jobs/{jid}").json()
    assert row["status"] == "done" and row["log_tail"] == "finished" and row["backend_used"] == "cpu"
    assert any(t["run_id"] == "20261117-120000_test-run" for t in hub.get("/api/tracks").json())
    # The job is over: the runner's next calls are refused.
    assert hub.post(f"/api/runner/jobs/{jid}/heartbeat", json=hb, headers=AUTH).status_code == 409

    # The same run id again is refused, never overwritten.
    again = new_job(hub)
    jid2 = hub.post("/api/runner/claim", json={"backends": ["cpu"]}, headers=AUTH).json()["id"]
    assert jid2 == again["id"]
    upload(
        hub, jid2, bundle(tmp_path / "2", hub.get(f"/api/sim/jobs/{jid2}").json(), "20261117-120000_test-run")
    )
    clash = hub.post(f"/api/runner/jobs/{jid2}/finish", json={}, headers=AUTH)
    assert clash.status_code == 422 and "already exists" in clash.text
    assert hub.get(f"/api/sim/jobs/{jid2}").json()["status"] == "error"


def test_bundles_are_checked_against_the_job(hub: TestClient, tmp_path: Path) -> None:
    new_job(hub)
    jid = hub.post("/api/runner/claim", json={"backends": ["cpu"]}, headers=AUTH).json()["id"]
    full = hub.get(f"/api/sim/jobs/{jid}").json()
    assert (
        hub.post(f"/api/runner/jobs/{jid}/finish", json={}, headers=AUTH).status_code == 422
    )  # nothing sent
    new_job(hub)
    jid = hub.post("/api/runner/claim", json={"backends": ["cpu"]}, headers=AUTH).json()["id"]
    upload(hub, jid, bundle(tmp_path, full, "run-x", config_hash="0" * 64))
    r = hub.post(f"/api/runner/jobs/{jid}/finish", json={}, headers=AUTH)
    assert r.status_code == 422 and "config_sha256" in r.text
    assert not (hub.app.state.settings.datasets_root / DEP / "tracks" / "run-x").exists()  # type: ignore[attr-defined]
    assert hub.put(f"/api/runner/jobs/{jid}/bundle/evil.sh", content=b"x", headers=AUTH).status_code in (
        409,
        422,
    )


def test_cancel_retry_and_stale_runners(hub: TestClient) -> None:
    catalog = hub.app.state.catalog  # type: ignore[attr-defined]
    job = new_job(hub)
    jid = job["id"]
    claimed = claim(catalog, "garnet", ["cpu"])
    assert claimed is not None and claimed["id"] == jid
    later = datetime.now(UTC) + timedelta(seconds=STALE_AFTER_S + 5)
    assert reap(catalog, later) == 1
    row = hub.get(f"/api/sim/jobs/{jid}").json()
    assert row["status"] == "queued" and "stopped reporting" in row["error"]
    for _ in range(MAX_ATTEMPTS - 1):
        assert claim(catalog, "garnet", ["cpu"]) is not None
    reap(catalog, later + timedelta(seconds=STALE_AFTER_S + 5))
    assert hub.get(f"/api/sim/jobs/{jid}").json()["status"] == "error"

    retried = hub.post(f"/api/sim/jobs/{jid}/retry")
    assert retried.status_code == 201 and retried.json()["retry_of"] == jid
    new_id = retried.json()["id"]
    assert hub.post(f"/api/sim/jobs/{new_id}/retry").status_code == 409
    assert hub.post(f"/api/sim/jobs/{new_id}/cancel").json()["status"] == "canceled"
    assert hub.post(f"/api/sim/jobs/{new_id}/cancel").status_code == 409
    assert hub.get("/api/sim/jobs", params={"status": "canceled"}).json()[0]["id"] == new_id


def test_editor_only(hub: TestClient, settings: Any) -> None:
    from biologger_portal.app import create_app
    from biologger_portal.settings import Settings

    anon = TestClient(create_app(Settings(datasets_root=settings.datasets_root)))
    assert anon.get("/api/sim/jobs").status_code == 403
    assert anon.post("/api/sim/jobs", json={"deployment_id": DEP}).status_code == 403
