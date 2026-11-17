# Copyright (c) 2026 Long Horizon Observatory
# Licensed under the Apache License, Version 2.0. See LICENSE file for details.

"""The simulation run queue: jobs made by editors, claimed and run by runners, landed as track bundles.

A runner claims the oldest queued job whose backend preference it can meet, downloads the job's
config, metadata row and input, runs ``biologger-sim export-track`` and sends the bundle back file by
file before finishing the job. While it runs it sends a heartbeat with the end of its log; a job
whose heartbeat stops for ``STALE_AFTER_S`` goes back to the queue (``reap``), up to
``MAX_ATTEMPTS`` claims in all. Reaping happens whenever the queue is read or claimed, so no timer
thread is needed.

A finished bundle is checked against its job before it lands in ``<deployment>/tracks/<run_id>/``:
its schema, deployment and data size, and its config. biologger-sim hashes the configuration it
resolved for the run (``pipeline-runs/<run>/config.yaml``: the job's config with every default
filled in), so the runner sends that file with the bundle; ``config_sha256`` must be its hash, and
every setting in the job's config that the resolved config has must hold the same value there
(legacy keys that biologger-sim maps to others are absent from it and are skipped). The resolved
config stays in the track folder. Existing runs are never replaced.
"""

import hashlib
import json
import re
import shutil
import sqlite3
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import yaml

from .db import Catalog, utcnow

BACKENDS = ("any", "warp", "mlx", "cpu")
ACTIVE = ("claimed", "running")
STALE_AFTER_S = 180
MAX_ATTEMPTS = 2
BUNDLE_FILES = ("track.json", "track.f32", "track.geojson", "config.yaml")
REQUIRED_FILES = ("track.json", "track.f32", "config.yaml")
RUN_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._+-]{0,200}$")
LOG_TAIL_CHARS = 8000

# The columns a job list shows; the config, metadata row and log come with a single job.
LIST_COLUMNS = (
    "id, batch_id, deployment_id, profile, input_path, input_size, rate_hz, backend_pref, status, runner, "
    "backend_used, sim_git_commit, sim_git_dirty, run_id, error, attempts, retry_of, created_by, created_utc, "
    "claimed_utc, heartbeat_utc, finished_utc"
)


class BundleError(ValueError):
    pass


def create_batch(catalog: Catalog, label: str, actor: str) -> int:
    with catalog.tx() as conn:
        cur = conn.execute(
            "INSERT INTO sim_batch (label, created_by, created_utc) VALUES (?, ?, ?)",
            (label, actor, utcnow()),
        )
        return int(cur.lastrowid or 0)


def create_job(
    catalog: Catalog,
    *,
    deployment_id: str,
    profile: str,
    config_yaml: str,
    meta_csv: str,
    input_path: str,
    input_size: int,
    rate_hz: float,
    backend_pref: str,
    actor: str,
    batch_id: int | None = None,
    retry_of: int | None = None,
) -> int:
    if backend_pref not in BACKENDS:
        raise ValueError(f"backend must be one of {', '.join(BACKENDS)}")
    config_name = re.sub(r"[^A-Za-z0-9._-]+", "_", f"{deployment_id}-{profile}") + ".yaml"
    with catalog.tx() as conn:
        cur = conn.execute(
            """INSERT INTO sim_job (batch_id, deployment_id, profile, config_name, config_yaml, meta_csv, input_path,
               input_size, rate_hz, backend_pref, created_by, created_utc, retry_of)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                batch_id,
                deployment_id,
                profile,
                config_name,
                config_yaml,
                meta_csv,
                input_path,
                input_size,
                rate_hz,
                backend_pref,
                actor,
                utcnow(),
                retry_of,
            ),
        )
        return int(cur.lastrowid or 0)


def _reap(conn: sqlite3.Connection, now: datetime) -> int:
    cutoff = (now - timedelta(seconds=STALE_AFTER_S)).strftime("%Y-%m-%dT%H:%M:%SZ")
    stamp = now.strftime("%Y-%m-%dT%H:%M:%SZ")
    stale = f"status IN ('claimed', 'running') AND COALESCE(heartbeat_utc, claimed_utc) < '{cutoff}'"
    gave_up = conn.execute(
        f"""UPDATE sim_job SET status='error', finished_utc=?,
            error='the runner stopped reporting (' || runner || '), ' || attempts || ' attempts'
            WHERE {stale} AND attempts >= ?""",
        (stamp, MAX_ATTEMPTS),
    ).rowcount
    requeued = conn.execute(
        f"""UPDATE sim_job SET status='queued', runner='', claimed_utc=NULL, heartbeat_utc=NULL,
            error='requeued: the runner ' || runner || ' stopped reporting'
            WHERE {stale}"""
    ).rowcount
    return int(gave_up + requeued)


def reap(catalog: Catalog, now: datetime | None = None) -> int:
    with catalog.tx() as conn:
        return _reap(conn, now or datetime.now(UTC))


def claim(
    catalog: Catalog, runner: str, backends: list[str], now: datetime | None = None
) -> dict[str, Any] | None:
    """Hands the oldest queued job this runner can run to it, or None. Atomic: one claimer per job."""
    offered = [b for b in backends if b in BACKENDS and b != "any"]
    if not offered:
        return None
    moment = now or datetime.now(UTC)
    stamp = moment.strftime("%Y-%m-%dT%H:%M:%SZ")
    marks = ",".join("?" * len(offered))
    with catalog.tx() as conn:
        _reap(conn, moment)
        row = conn.execute(
            f"""SELECT id FROM sim_job WHERE status='queued' AND (backend_pref='any' OR backend_pref IN ({marks}))
                ORDER BY id LIMIT 1""",
            offered,
        ).fetchone()
        if row is None:
            return None
        conn.execute(
            """UPDATE sim_job SET status='claimed', runner=?, claimed_utc=?, heartbeat_utc=?, attempts=attempts+1,
               error='' WHERE id=?""",
            (runner, stamp, stamp, row["id"]),
        )
        job = dict(conn.execute("SELECT * FROM sim_job WHERE id=?", (row["id"],)).fetchone())
    return job


def active_job(catalog: Catalog, job_id: int, runner: str) -> dict[str, Any] | None:
    """The job if this runner holds it now; None once it was canceled, requeued or finished."""
    return catalog.one(
        "SELECT * FROM sim_job WHERE id=? AND runner=? AND status IN ('claimed', 'running')", (job_id, runner)
    )


def heartbeat(
    catalog: Catalog,
    job_id: int,
    runner: str,
    *,
    log_tail: str,
    backend: str,
    sim_commit: str,
    sim_dirty: bool,
) -> bool:
    with catalog.tx() as conn:
        n = conn.execute(
            """UPDATE sim_job SET status='running', heartbeat_utc=?, log_tail=?, backend_used=?, sim_git_commit=?,
               sim_git_dirty=? WHERE id=? AND runner=? AND status IN ('claimed', 'running')""",
            (
                utcnow(),
                log_tail[-LOG_TAIL_CHARS:],
                backend,
                sim_commit,
                1 if sim_dirty else 0,
                job_id,
                runner,
            ),
        ).rowcount
    return bool(n)


def fail(catalog: Catalog, job_id: int, runner: str, *, error: str, log_tail: str) -> bool:
    with catalog.tx() as conn:
        n = conn.execute(
            """UPDATE sim_job SET status='error', error=?, log_tail=?, finished_utc=?
               WHERE id=? AND runner=? AND status IN ('claimed', 'running')""",
            (error[:2000], log_tail[-LOG_TAIL_CHARS:], utcnow(), job_id, runner),
        ).rowcount
    return bool(n)


def cancel(catalog: Catalog, job_id: int) -> bool:
    with catalog.tx() as conn:
        n = conn.execute(
            """UPDATE sim_job SET status='canceled', finished_utc=? WHERE id=?
               AND status IN ('queued', 'claimed', 'running')""",
            (utcnow(), job_id),
        ).rowcount
    return bool(n)


def staging_dir(portal_dir: Path, job_id: int) -> Path:
    return portal_dir / "sim" / str(job_id)


def check_bundle(job: dict[str, Any], staged: Path) -> dict[str, Any]:
    """The bundle's track.json, after checking the bundle belongs to this job; raises BundleError."""
    missing = [n for n in REQUIRED_FILES if not (staged / n).is_file()]
    if missing:
        raise BundleError(f"bundle files not received: {', '.join(missing)}")
    try:
        meta = json.loads((staged / "track.json").read_text())
    except (OSError, ValueError) as exc:
        raise BundleError(f"track.json is not JSON: {exc}") from exc
    if not isinstance(meta, dict) or meta.get("schema") != "track-bundle-v1":
        raise BundleError("track.json is not a track-bundle-v1")
    if meta.get("deployment_id") != job["deployment_id"]:
        raise BundleError(
            f"the bundle is for {meta.get('deployment_id')!r}, the job for {job['deployment_id']!r}"
        )
    data = meta.get("data") or {}
    if data.get("file") != "track.f32" or data.get("bytes") != (staged / "track.f32").stat().st_size:
        raise BundleError("track.f32 does not have the size track.json gives")
    resolved = (staged / "config.yaml").read_bytes()
    expected = hashlib.sha256(resolved).hexdigest()
    got = (meta.get("provenance") or {}).get("config_sha256")
    if got != expected:
        raise BundleError(f"config_sha256 {got} is not the hash of the run's config.yaml ({expected})")
    check_resolved_config(job["config_yaml"], resolved)
    run_id = str(meta.get("run_id") or "")
    if not RUN_ID.match(run_id):
        raise BundleError(f"run_id {run_id!r} is not a safe folder name")
    return meta


def _differences(asked: Any, ran: Any, path: str) -> Iterator[str]:
    """Paths where ``ran`` holds another value than ``asked``; keys ``ran`` does not have are skipped."""
    if isinstance(asked, dict):
        if not isinstance(ran, dict):
            yield path or "(top)"
            return
        for key, value in asked.items():
            if key in ran:
                yield from _differences(value, ran[key], f"{path}.{key}" if path else str(key))
    elif isinstance(asked, list):
        if not isinstance(ran, list) or len(ran) != len(asked):
            yield path
            return
        for i, (a, r) in enumerate(zip(asked, ran, strict=True)):
            yield from _differences(a, r, f"{path}[{i}]")
    elif asked != ran:  # 16 and 16.0 are the same setting
        yield path


def check_resolved_config(job_yaml: str, resolved: bytes) -> None:
    """Raises BundleError unless the run's resolved config carries the job's settings."""
    try:
        asked = yaml.safe_load(job_yaml)
        ran = yaml.safe_load(resolved)
    except yaml.YAMLError as exc:
        raise BundleError(f"config.yaml is not YAML: {exc}") from exc
    try:
        same_entity = (
            ran["simulation"]["entities"][0]["sim_id"] == asked["simulation"]["entities"][0]["sim_id"]
        )
    except (KeyError, IndexError, TypeError):
        same_entity = False
    if not same_entity:
        raise BundleError("config.yaml is not the resolved config of the job's entity")
    diffs = list(_differences(asked, ran, ""))
    if diffs:
        raise BundleError(f"the run's config.yaml differs from the job's config at {', '.join(diffs[:6])}")


def land_bundle(catalog: Catalog, root: Path, portal_dir: Path, job: dict[str, Any]) -> str:
    """Moves a checked bundle into the deployment's tracks folder and marks the job done; returns the run id."""
    staged = staging_dir(portal_dir, int(job["id"]))
    meta = check_bundle(job, staged)
    run_id = str(meta["run_id"])
    target = root / job["deployment_id"] / "tracks" / run_id
    if target.exists():
        raise BundleError(f"{job['deployment_id']}/tracks/{run_id} already exists")
    target.parent.mkdir(parents=True, exist_ok=True)
    for name in list(staged.iterdir()):
        if name.name not in BUNDLE_FILES:
            name.unlink()
    shutil.move(str(staged), str(target))
    prov = meta.get("provenance") or {}
    with catalog.tx() as conn:
        conn.execute(
            """UPDATE sim_job SET status='done', run_id=?, sim_git_commit=?, sim_git_dirty=?, finished_utc=?, error=''
               WHERE id=?""",
            (
                run_id,
                str(prov.get("sim_git_commit") or ""),
                1 if prov.get("sim_git_dirty") else 0,
                utcnow(),
                job["id"],
            ),
        )
    return run_id
