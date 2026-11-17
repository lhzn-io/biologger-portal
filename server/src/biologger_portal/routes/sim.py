# Copyright (c) 2026 Long Horizon Observatory
# Licensed under the Apache License, Version 2.0. See LICENSE file for details.

"""Simulation profiles, the run config a deployment would get, and the run queue. Editors only."""

from pathlib import Path
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field

from ..auth import User, require_editor
from ..db import Catalog, loads
from ..sim_config import (
    Profile,
    ProfileError,
    blockers,
    load_profiles,
    meta_csv,
    parse_overrides,
    render,
    suggest,
)
from ..sim_jobs import BACKENDS, LIST_COLUMNS, cancel, create_batch, create_job, reap

router = APIRouter(prefix="/api/sim", tags=["sim"])
Editor = Annotated[User, Depends(require_editor)]


def profiles(request: Request) -> dict[str, Profile]:
    try:
        return load_profiles(request.app.state.settings.sim_profiles_dir)
    except ProfileError as exc:
        raise HTTPException(status_code=500, detail=f"simulation profile error: {exc}") from exc


def deployment_fields(catalog: Catalog, dep_id: str) -> dict[str, str]:
    row = catalog.one("SELECT fields FROM deployment WHERE id=?", (dep_id,))
    if row is None:
        raise HTTPException(status_code=404, detail=f"no deployment {dep_id}")
    return {str(k): str(v) for k, v in loads(row["fields"]).items()}


def input_candidates(catalog: Catalog, root: Path, dep_id: str, profile: Profile) -> list[dict[str, Any]]:
    """The deployment's files of the kinds a profile reads: those it recognizes first, then newest first."""
    if not profile.accepts:
        return []
    marks = ",".join("?" * len(profile.accepts))
    rows = catalog.query(
        f"""SELECT path, kind, size FROM file WHERE deployment_id=? AND missing=0 AND kind IN ({marks})
            ORDER BY mtime DESC, path""",
        (dep_id, *profile.accepts),
    )
    for row in rows:
        row["recognized"] = profile.reads(root / row["path"])
    return sorted(rows, key=lambda r: not r["recognized"])


class RunSetup(BaseModel):
    deployment_id: str
    profile: str | None = None
    input_path: str | None = None
    overrides: str = ""


def prepare(request: Request, body: RunSetup) -> dict[str, Any]:
    """The profile, input, blockers and rendered config for a deployment; shared with job creation."""
    catalog: Catalog = request.app.state.catalog
    available = profiles(request)
    fields = deployment_fields(catalog, body.deployment_id)
    suggested = suggest(available, fields)
    name = body.profile or suggested
    if name is None:
        return {
            "profile": None,
            "suggested": None,
            "inputs": [],
            "input_path": None,
            "input_size": None,
            "blockers": ["no profile chosen, and none matches the deployment's tag type"],
            "config_yaml": "",
            "meta_csv": "",
        }
    if name not in available:
        raise HTTPException(status_code=422, detail=f"no simulation profile {name}")
    profile = available[name]
    try:
        overrides = parse_overrides(body.overrides)
    except ProfileError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    root: Path = request.app.state.settings.datasets_root
    inputs = input_candidates(catalog, root, body.deployment_id, profile)
    chosen: dict[str, Any] | None
    if body.input_path:
        row = catalog.one(
            "SELECT path, kind, size FROM file WHERE deployment_id=? AND missing=0 AND path=?",
            (body.deployment_id, body.input_path),
        )
        if row is not None:
            row["recognized"] = profile.reads(root / row["path"])
        if row is None:
            raise HTTPException(
                status_code=422, detail=f"{body.input_path} is not a file of {body.deployment_id}"
            )
        chosen = row
    else:
        chosen = inputs[0] if inputs else None
    blocked = blockers(profile, fields, chosen["kind"] if chosen else None)
    if chosen and not chosen["recognized"]:
        blocked.append(
            f"{chosen['path']} does not look like this profile's input (no match for {profile.signature!r})"
        )
    config = render(profile, body.deployment_id, fields, chosen["path"], overrides) if chosen else ""
    return {
        "profile": name,
        "suggested": suggested,
        "inputs": inputs,
        "input_path": chosen["path"] if chosen else None,
        "input_size": chosen["size"] if chosen else None,
        "blockers": blocked,
        "config_yaml": config,
        "meta_csv": meta_csv(body.deployment_id, fields),
    }


@router.get("/profiles")
def list_profiles(request: Request, _: Editor) -> list[dict[str, Any]]:
    return [p.summary() for p in profiles(request).values()]


@router.post("/preview")
def preview(body: RunSetup, request: Request, _: Editor) -> dict[str, Any]:
    return prepare(request, body)


# Jobs and batches ------------------------------------------------------------------------------


class JobCreate(RunSetup):
    rate_hz: float = Field(1.0, gt=0, le=25)
    backend: str = "any"


class BatchCreate(BaseModel):
    deployment_ids: list[str] = Field(min_length=1, max_length=500)
    profile: str | None = None
    rate_hz: float = Field(1.0, gt=0, le=25)
    backend: str = "any"
    label: str = ""
    dry_run: bool = False


def _check_backend(backend: str) -> None:
    if backend not in BACKENDS:
        raise HTTPException(status_code=422, detail=f"backend must be one of {', '.join(BACKENDS)}")


def _job(catalog: Catalog, job_id: int, *, full: bool = True) -> dict[str, Any]:
    cols = "*" if full else LIST_COLUMNS
    row = catalog.one(f"SELECT {cols} FROM sim_job WHERE id=?", (job_id,))
    if row is None:
        raise HTTPException(status_code=404, detail=f"no simulation job {job_id}")
    return row


def _make_job(
    catalog: Catalog,
    setup: dict[str, Any],
    dep_id: str,
    rate_hz: float,
    backend: str,
    actor: str,
    **extra: Any,
) -> int:
    return create_job(
        catalog,
        deployment_id=dep_id,
        profile=setup["profile"],
        config_yaml=setup["config_yaml"],
        meta_csv=setup["meta_csv"],
        input_path=setup["input_path"],
        input_size=int(setup["input_size"]),
        rate_hz=rate_hz,
        backend_pref=backend,
        actor=actor,
        **extra,
    )


@router.post("/jobs", status_code=201)
def post_job(body: JobCreate, request: Request, user: Editor) -> dict[str, Any]:
    _check_backend(body.backend)
    setup = prepare(request, body)
    if setup["blockers"]:
        raise HTTPException(status_code=422, detail="; ".join(setup["blockers"]))
    catalog: Catalog = request.app.state.catalog
    job_id = _make_job(catalog, setup, body.deployment_id, body.rate_hz, body.backend, user.email)
    return _job(catalog, job_id, full=False)


@router.post("/batches")
def post_batch(body: BatchCreate, request: Request, user: Editor) -> dict[str, Any]:
    """One job per deployment that can run; the others come back with their reasons. dry_run makes none."""
    _check_backend(body.backend)
    catalog: Catalog = request.app.state.catalog
    ready: list[tuple[str, dict[str, Any]]] = []
    skipped: list[dict[str, Any]] = []
    for dep_id in dict.fromkeys(body.deployment_ids):
        try:
            setup = prepare(request, RunSetup(deployment_id=dep_id, profile=body.profile))
        except HTTPException as exc:
            skipped.append({"deployment_id": dep_id, "blockers": [str(exc.detail)]})
            continue
        if setup["blockers"]:
            skipped.append({"deployment_id": dep_id, "blockers": setup["blockers"]})
        else:
            ready.append((dep_id, setup))
    planned = [{"deployment_id": d, "profile": s["profile"], "input_path": s["input_path"]} for d, s in ready]
    if body.dry_run or not ready:
        return {"batch_id": None, "jobs": [], "planned": planned, "skipped": skipped}
    batch_id = create_batch(catalog, body.label, user.email)
    ids = [
        _make_job(catalog, s, d, body.rate_hz, body.backend, user.email, batch_id=batch_id) for d, s in ready
    ]
    return {
        "batch_id": batch_id,
        "jobs": [_job(catalog, i, full=False) for i in ids],
        "planned": planned,
        "skipped": skipped,
    }


@router.get("/jobs")
def list_jobs(
    request: Request,
    _: Editor,
    status: str | None = None,
    deployment_id: str | None = None,
    limit: int = Query(200, ge=1, le=1000),
) -> list[dict[str, Any]]:
    catalog: Catalog = request.app.state.catalog
    reap(catalog)
    where, params = [], []
    if status:
        where.append("status=?")
        params.append(status)
    if deployment_id:
        where.append("deployment_id=?")
        params.append(deployment_id)
    clause = f"WHERE {' AND '.join(where)}" if where else ""
    return catalog.query(
        f"SELECT {LIST_COLUMNS} FROM sim_job {clause} ORDER BY id DESC LIMIT ?", (*params, limit)
    )


@router.get("/jobs/{job_id}")
def get_job(job_id: int, request: Request, _: Editor) -> dict[str, Any]:
    return _job(request.app.state.catalog, job_id)


@router.post("/jobs/{job_id}/cancel")
def cancel_job(job_id: int, request: Request, _: Editor) -> dict[str, Any]:
    catalog: Catalog = request.app.state.catalog
    _job(catalog, job_id)
    if not cancel(catalog, job_id):
        raise HTTPException(status_code=409, detail="only queued or running jobs can be canceled")
    return _job(catalog, job_id, full=False)


@router.post("/jobs/{job_id}/retry", status_code=201)
def retry_job(job_id: int, request: Request, user: Editor) -> dict[str, Any]:
    """A new job with the same config, metadata row and input as a failed or canceled one."""
    catalog: Catalog = request.app.state.catalog
    old = _job(catalog, job_id)
    if old["status"] not in ("error", "canceled"):
        raise HTTPException(status_code=409, detail="only failed or canceled jobs can be retried")
    new_id = create_job(
        catalog,
        deployment_id=old["deployment_id"],
        profile=old["profile"],
        config_yaml=old["config_yaml"],
        meta_csv=old["meta_csv"],
        input_path=old["input_path"],
        input_size=old["input_size"],
        rate_hz=old["rate_hz"],
        backend_pref=old["backend_pref"],
        actor=user.email,
        batch_id=old["batch_id"],
        retry_of=job_id,
    )
    return _job(catalog, new_id, full=False)
