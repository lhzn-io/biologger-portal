# Copyright (c) 2026 Long Horizon Observatory
# Licensed under the Apache License, Version 2.0. See LICENSE file for details.

import hashlib
import json
import sys
from pathlib import Path
from typing import Any

import httpx

from biologger_portal_runner.cli import read_env_file
from biologger_portal_runner.hub import Hub
from biologger_portal_runner.work import Options, run_job

CONFIG = "mode: LAB\nsimulation:\n  meta_file: meta.csv\n"
INPUT = bytes(range(256)) * 40
JOB = {
    "id": 7,
    "deployment_id": "DEP.1",
    "profile": "axy-standard",
    "config_name": "DEP.1-axy-standard.yaml",
    "input_name": "input.csv",
    "input_size": len(INPUT),
    "rate_hz": 1.0,
    "backend_pref": "any",
    "attempt": 1,
}

# A stand-in for biologger-sim export-track: checks it runs beside the job's files and writes a bundle.
GOOD_SIM = """
import hashlib, json, sys
from pathlib import Path
args = sys.argv[1:]
config = Path(args[args.index("--config") + 1])
out = Path(args[args.index("--out") + 1])
assert Path("meta.csv").read_text().startswith("tag_id"), "meta.csv not beside the config"
assert Path("input.csv").stat().st_size == {size}
print("processing", flush=True)
# biologger-sim writes the config it resolved into the run folder and hashes that one.
run = Path("pipeline-runs/r1")
run.mkdir(parents=True)
(run / "config.yaml").write_text(config.read_text() + "publish_zmq: false\\n")
out.mkdir()
(out / "track.f32").write_bytes(b"\\0" * 16)
(out / "track.geojson").write_text("{{}}")
# An installed package reads git in whatever repository encloses it: the wrong commit.
prov = {{"config_sha256": hashlib.sha256((run / "config.yaml").read_bytes()).hexdigest(),
        "sim_git_commit": "0123abc", "sim_git_dirty": True}}
(out / "track.json").write_text(json.dumps({{"run_id": "r1", "provenance": prov}}))
print("done", flush=True)
"""


class FakeHub:
    def __init__(self, *, lose_on_heartbeat: bool = False, drop_input_after: int | None = None) -> None:
        self.calls: list[str] = []
        self.uploaded: dict[str, bytes] = {}
        self.failed: dict[str, Any] | None = None
        self.finished: dict[str, Any] | None = None
        self.lose_on_heartbeat = lose_on_heartbeat
        self.drop_input_after = drop_input_after

    def __call__(self, request: httpx.Request) -> httpx.Response:
        assert request.headers["authorization"] == "Bearer tok"
        path = request.url.path.removeprefix("/api/runner")
        self.calls.append(f"{request.method} {path}")
        if path == "/jobs/7/config":
            return httpx.Response(200, text=CONFIG)
        if path == "/jobs/7/meta.csv":
            return httpx.Response(200, text="tag_id,species\nT1,x\n")
        if path == "/jobs/7/input":
            rng = request.headers.get("range")
            start = int(rng.removeprefix("bytes=").rstrip("-")) if rng else 0
            body = INPUT[start:]
            if self.drop_input_after is not None and not rng:
                body = body[: self.drop_input_after]  # a short first transfer
            return httpx.Response(206 if rng else 200, content=body)
        if path == "/jobs/7/heartbeat":
            return (
                httpx.Response(409, text="gone")
                if self.lose_on_heartbeat
                else httpx.Response(200, json={"ok": True})
            )
        if path.startswith("/jobs/7/bundle/"):
            self.uploaded[path.rsplit("/", 1)[1]] = request.content
            return httpx.Response(200, json={})
        if path == "/jobs/7/finish":
            self.finished = json.loads(request.content)
            return httpx.Response(200, json={"run_id": "r1"})
        if path == "/jobs/7/fail":
            self.failed = json.loads(request.content)
            return httpx.Response(200, json={"ok": True})
        return httpx.Response(404)


def setup(tmp_path: Path, script: str, fake: FakeHub) -> tuple[Hub, Options]:
    sim = tmp_path / "fake_sim.py"
    sim.write_text(script)
    hub = Hub("http://hub.test", "tok", transport=httpx.MockTransport(fake))
    opts = Options(
        sim_cmd=[sys.executable, str(sim)], work_dir=tmp_path / "work", sim_commit="abc1234", heartbeat_s=0.2
    )
    opts.work_dir.mkdir()
    return hub, opts


def test_a_job_runs_and_its_bundle_goes_back(tmp_path: Path) -> None:
    fake = FakeHub()
    hub, opts = setup(tmp_path, GOOD_SIM.format(size=len(INPUT)), fake)
    assert run_job(hub, dict(JOB), opts) == "done"
    assert set(fake.uploaded) == {"track.json", "track.f32", "track.geojson", "config.yaml"}
    meta = json.loads(fake.uploaded["track.json"])
    # The resolved config goes with the bundle, and the installed simulator's commit replaces git's guess.
    assert fake.uploaded["config.yaml"].startswith(CONFIG.encode())
    assert meta["provenance"]["config_sha256"] == hashlib.sha256(fake.uploaded["config.yaml"]).hexdigest()
    assert meta["provenance"]["sim_git_commit"] == "abc1234" and meta["provenance"]["sim_git_dirty"] is False
    assert fake.finished is not None and "done" in fake.finished["log_tail"]
    assert "POST /jobs/7/heartbeat" in fake.calls
    assert not (opts.work_dir / "job-7").exists()


def test_a_failed_simulation_is_reported_with_its_log(tmp_path: Path) -> None:
    fake = FakeHub()
    hub, opts = setup(tmp_path, "import sys\nprint('bad calibration')\nsys.exit(3)\n", fake)
    assert run_job(hub, dict(JOB), opts) == "error"
    assert fake.failed is not None and "status 3" in fake.failed["error"]
    assert "bad calibration" in fake.failed["log_tail"]
    assert fake.uploaded == {} and (opts.work_dir / "job-7" / "runner.log").exists()  # kept for a look


def test_a_canceled_job_stops_the_simulator(tmp_path: Path) -> None:
    fake = FakeHub(lose_on_heartbeat=True)
    hub, opts = setup(tmp_path, "import time\ntime.sleep(60)\n", fake)
    assert run_job(hub, dict(JOB), opts) == "lost"
    assert fake.failed is None and fake.uploaded == {}


def test_a_dropped_download_resumes(tmp_path: Path) -> None:
    fake = FakeHub(drop_input_after=1000)
    hub = Hub("http://hub.test", "tok", transport=httpx.MockTransport(fake))
    dest = tmp_path / "input.csv"
    hub.download_input(7, dest, len(INPUT))
    assert dest.read_bytes() == INPUT
    assert fake.calls.count("GET /jobs/7/input") == 2


def test_env_file(tmp_path: Path) -> None:
    f = tmp_path / "runner.env"
    f.write_text("# comment\nPORTAL_RUNNER_HUB=http://x:1\nPORTAL_RUNNER_BACKENDS = 'cpu,mlx'\n\n")
    assert read_env_file(f) == {"PORTAL_RUNNER_HUB": "http://x:1", "PORTAL_RUNNER_BACKENDS": "cpu,mlx"}
