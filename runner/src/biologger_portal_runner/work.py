# Copyright (c) 2026 Long Horizon Observatory
# Licensed under the Apache License, Version 2.0. See LICENSE file for details.

"""Runs one claimed job: fetch its files, run ``biologger-sim export-track``, send the bundle back.

The job's config, metadata row and input are written side by side in a folder of their own, under
the names the hub gives, and the simulator runs from that folder. The config refers to the other two
by those names, so it runs exactly as the hub stored it. biologger-sim hashes the configuration it
resolved for the run (``pipeline-runs/<run>/config.yaml``) into the bundle's ``config_sha256``; the
runner sends that file with the bundle, and the hub checks it against the job's config.
"""

import json
import logging
import shutil
import subprocess
import threading
import time
from collections import deque
from dataclasses import dataclass, field
from importlib import metadata
from pathlib import Path
from typing import Any

from .hub import Hub, HubError, JobLost

log = logging.getLogger(__name__)
TAIL_LINES = 40
BUNDLE = "bundle"
BUNDLE_FILES = ("track.json", "track.f32", "track.geojson", "config.yaml")


@dataclass
class Options:
    sim_cmd: list[str]
    work_dir: Path
    backends: list[str] = field(default_factory=lambda: ["cpu"])
    sim_commit: str = ""
    sim_dirty: bool = False
    heartbeat_s: float = 15.0


def installed_sim_commit() -> str:
    """The commit biologger-sim was installed from (pip's direct_url.json), or '' when unknown."""
    try:
        raw = metadata.distribution("biologger-sim").read_text("direct_url.json")
    except metadata.PackageNotFoundError:
        return ""
    try:
        return str(json.loads(raw or "{}").get("vcs_info", {}).get("commit_id") or "")
    except ValueError:
        return ""


# The backend a run computes on. biologger-sim's LAB mode, which export-track runs, processes each
# entity on the CPU whatever ``simulation.backend`` says (warp and mlx are wired into simulation mode
# only), so every run is a cpu run; a job's backend preference only decides which runner may take it.
LAB_BACKEND = "cpu"


def set_provenance(track_json: Path, commit: str, dirty: bool) -> None:
    """Records the simulator commit the runner knows, when it knows one.

    biologger-sim asks git in the folder above its own package, which for an installed package is
    whatever repository encloses the environment (or none), so its answer is replaced by the commit
    the package was installed from. A runner on a checkout leaves ``commit`` empty and keeps
    biologger-sim's own reading.
    """
    if not commit:
        return
    meta = json.loads(track_json.read_text())
    prov = meta.setdefault("provenance", {})
    prov["sim_git_commit"] = commit
    prov["sim_git_dirty"] = dirty
    track_json.write_text(json.dumps(meta, indent=2) + "\n")


def resolved_config(folder: Path, track_json: Path) -> Path:
    """The configuration biologger-sim resolved for the run, which the bundle's config_sha256 is the hash of."""
    run_id = str(json.loads(track_json.read_text()).get("run_id") or "")
    path = folder / "pipeline-runs" / run_id / "config.yaml"
    if not run_id or not path.is_file():
        raise FileNotFoundError(f"no resolved config at pipeline-runs/{run_id or '?'}/config.yaml")
    return path


class Tail:
    """The last lines of a subprocess's output, read on a thread."""

    def __init__(self, stream: Any, log_file: Path) -> None:
        self.lines: deque[str] = deque(maxlen=TAIL_LINES)
        self._lock = threading.Lock()
        self._thread = threading.Thread(target=self._read, args=(stream, log_file), daemon=True)
        self._thread.start()

    def _read(self, stream: Any, log_file: Path) -> None:
        with log_file.open("a") as out:
            for line in stream:
                out.write(line)
                out.flush()
                with self._lock:
                    self.lines.append(line.rstrip("\n"))

    def text(self) -> str:
        with self._lock:
            return "\n".join(self.lines)

    def join(self) -> None:
        self._thread.join(timeout=10)


def fetch(hub: Hub, job: dict[str, Any], folder: Path) -> None:
    jid = int(job["id"])
    folder.mkdir(parents=True, exist_ok=True)
    (folder / job["config_name"]).write_text(hub.text(jid, "config"))
    (folder / "meta.csv").write_text(hub.text(jid, "meta.csv"))
    hub.download_input(jid, folder / job["input_name"], int(job["input_size"]))


def simulate(hub: Hub, job: dict[str, Any], folder: Path, opts: Options, backend: str) -> tuple[int, str]:
    """Runs the simulator with heartbeats; returns (exit code, log tail). Raises JobLost after stopping it."""
    jid = int(job["id"])
    cmd = [
        *opts.sim_cmd,
        "export-track",
        "--config",
        job["config_name"],
        "--rate",
        str(job["rate_hz"]),
        "--out",
        BUNDLE,
    ]
    log.info("job %s: %s", jid, " ".join(cmd))
    proc = subprocess.Popen(
        cmd, cwd=folder, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1
    )
    tail = Tail(proc.stdout, folder / "runner.log")
    next_beat = 0.0
    try:
        while proc.poll() is None:
            if time.monotonic() >= next_beat:
                try:
                    hub.heartbeat(
                        jid,
                        backend=backend,
                        sim_commit=opts.sim_commit,
                        sim_dirty=opts.sim_dirty,
                        log_tail=tail.text(),
                    )
                except (HubError, OSError) as exc:  # the hub is down: keep running, it requeues if it must
                    log.warning("job %s: heartbeat failed: %s", jid, exc)
                next_beat = time.monotonic() + opts.heartbeat_s
            time.sleep(0.5)
    finally:
        if proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=30)
            except subprocess.TimeoutExpired:
                proc.kill()
        tail.join()
    return int(proc.returncode), tail.text()


def run_job(hub: Hub, job: dict[str, Any], opts: Options) -> str:
    """Runs a claimed job to the end; returns 'done', 'error' or 'lost'. Never raises for the job's own failures."""
    jid = int(job["id"])
    folder = opts.work_dir / f"job-{jid}"
    # A failed job's folder is kept for a look until the next job starts; inputs can be large.
    for old in opts.work_dir.glob("job-*"):
        shutil.rmtree(old, ignore_errors=True)
    backend = LAB_BACKEND
    tail_text = ""
    try:
        fetch(hub, job, folder)
        code, tail_text = simulate(hub, job, folder, opts, backend)
        if code != 0:
            hub.fail(jid, f"biologger-sim exited with status {code}", tail_text)
            return "error"
        bundle = folder / BUNDLE
        if not (bundle / "track.json").is_file():
            hub.fail(jid, "biologger-sim finished but wrote no track bundle", tail_text)
            return "error"
        set_provenance(bundle / "track.json", opts.sim_commit, opts.sim_dirty)
        shutil.copyfile(resolved_config(folder, bundle / "track.json"), bundle / "config.yaml")
        for name in BUNDLE_FILES:
            if (bundle / name).is_file():
                hub.upload(jid, bundle / name)
        landed = hub.finish(jid, tail_text)
        log.info("job %s: landed as %s", jid, landed.get("run_id"))
    except JobLost:
        log.info("job %s: the hub no longer assigns it to this runner; stopped", jid)
        return "lost"
    except Exception as exc:  # report anything else to the hub, so the job does not sit until it is reaped
        log.exception("job %s failed", jid)
        try:
            hub.fail(jid, f"runner: {exc}"[:2000], tail_text)
        except Exception as report:
            log.warning("job %s: could not report the failure: %s", jid, report)
        return "error"
    shutil.rmtree(folder, ignore_errors=True)
    return "done"
