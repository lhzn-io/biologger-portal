# Copyright (c) 2026 Long Horizon Observatory
# Licensed under the Apache License, Version 2.0. See LICENSE file for details.

"""The runners' side of the simulation queue (see sim_jobs.py), reached over the lab VPN.

Each runner has a bearer token; the hub keeps only its SHA-256, as ``name:hexdigest`` entries in
``PORTAL_RUNNER_TOKENS``. A bundle is track.json, track.f32, track.geojson and the run's resolved
config.yaml (see sim_jobs.check_bundle). A runner may read and update only the job it holds: once a job is
canceled, requeued or finished, its calls get 409 and it should stop.
"""

import hashlib
import hmac
import shutil
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import FileResponse, PlainTextResponse
from pydantic import BaseModel, Field

from ..db import Catalog
from ..scanner import scan
from ..sim_config import input_name
from ..sim_jobs import (
    BUNDLE_FILES,
    BundleError,
    active_job,
    claim,
    fail,
    heartbeat,
    land_bundle,
    staging_dir,
)

router = APIRouter(prefix="/api/runner", tags=["runner"])
BUNDLE_MAX_BYTES = 512 * 1024 * 1024


def runner_name(request: Request) -> str:
    """The runner named by the request's bearer token, or 401."""
    header = request.headers.get("authorization", "")
    token = header[7:].strip() if header.lower().startswith("bearer ") else ""
    if token:
        digest = hashlib.sha256(token.encode()).hexdigest()
        for entry in request.app.state.settings.runner_tokens:
            name, _, expected = entry.partition(":")
            if name and expected and hmac.compare_digest(digest, expected.strip().lower()):
                return str(name).strip()
    raise HTTPException(status_code=401, detail="runner token missing or not recognized")


Runner = Annotated[str, Depends(runner_name)]


def held(request: Request, job_id: int, runner: str) -> dict[str, Any]:
    job = active_job(request.app.state.catalog, job_id, runner)
    if job is None:
        raise HTTPException(
            status_code=409, detail="this runner does not hold the job (canceled, requeued or done)"
        )
    return job


class ClaimBody(BaseModel):
    backends: list[str] = Field(min_length=1)


class HeartbeatBody(BaseModel):
    backend: str = ""
    sim_commit: str = ""
    sim_dirty: bool = False
    log_tail: str = ""


class FailBody(BaseModel):
    error: str
    log_tail: str = ""


class FinishBody(BaseModel):
    log_tail: str = ""


@router.post("/claim", response_model=None)
def post_claim(body: ClaimBody, request: Request, runner: Runner) -> dict[str, Any] | Response:
    job = claim(request.app.state.catalog, runner, body.backends)
    if job is None:
        return Response(status_code=204)
    shutil.rmtree(staging_dir(request.app.state.settings.portal_dir, int(job["id"])), ignore_errors=True)
    return {
        "id": job["id"],
        "deployment_id": job["deployment_id"],
        "profile": job["profile"],
        "config_name": job["config_name"],
        "input_name": input_name(job["input_path"]),
        "input_size": job["input_size"],
        "rate_hz": job["rate_hz"],
        "backend_pref": job["backend_pref"],
        "attempt": job["attempts"],
    }


@router.get("/jobs/{job_id}/config", response_class=PlainTextResponse)
def get_config(job_id: int, request: Request, runner: Runner) -> str:
    return str(held(request, job_id, runner)["config_yaml"])


@router.get("/jobs/{job_id}/meta.csv", response_class=PlainTextResponse)
def get_meta(job_id: int, request: Request, runner: Runner) -> str:
    return str(held(request, job_id, runner)["meta_csv"])


@router.get("/jobs/{job_id}/input")
def get_input(job_id: int, request: Request, runner: Runner) -> FileResponse:
    """The input file; Range requests are honored, so a dropped download resumes."""
    job = held(request, job_id, runner)
    path = request.app.state.settings.datasets_root / job["input_path"]
    if not path.is_file():
        raise HTTPException(status_code=410, detail=f"{job['input_path']} is no longer on the server")
    return FileResponse(path, filename=input_name(job["input_path"]))


@router.post("/jobs/{job_id}/heartbeat")
def post_heartbeat(job_id: int, body: HeartbeatBody, request: Request, runner: Runner) -> dict[str, bool]:
    ok = heartbeat(
        request.app.state.catalog,
        job_id,
        runner,
        log_tail=body.log_tail,
        backend=body.backend,
        sim_commit=body.sim_commit,
        sim_dirty=body.sim_dirty,
    )
    if not ok:
        raise HTTPException(
            status_code=409, detail="this runner does not hold the job (canceled, requeued or done)"
        )
    return {"ok": True}


@router.put("/jobs/{job_id}/bundle/{name}")
async def put_bundle_file(job_id: int, name: str, request: Request, runner: Runner) -> dict[str, Any]:
    if name not in BUNDLE_FILES:
        raise HTTPException(status_code=422, detail=f"bundle files are {', '.join(BUNDLE_FILES)}")
    held(request, job_id, runner)
    folder = staging_dir(request.app.state.settings.portal_dir, job_id)
    folder.mkdir(parents=True, exist_ok=True)
    size = 0
    with (folder / f"{name}.part").open("wb") as out:
        async for chunk in request.stream():
            size += len(chunk)
            if size > BUNDLE_MAX_BYTES:
                raise HTTPException(status_code=413, detail="bundle file too large")
            out.write(chunk)
    (folder / f"{name}.part").replace(folder / name)
    return {"name": name, "bytes": size}


@router.post("/jobs/{job_id}/finish")
def post_finish(job_id: int, body: FinishBody, request: Request, runner: Runner) -> dict[str, Any]:
    """Checks the uploaded bundle against the job, lands it in the tracks folder and indexes it."""
    settings = request.app.state.settings
    catalog: Catalog = request.app.state.catalog
    job = held(request, job_id, runner)
    try:
        run_id = land_bundle(catalog, settings.datasets_root, settings.portal_dir, job)
    except BundleError as exc:
        fail(catalog, job_id, runner, error=f"bundle rejected: {exc}", log_tail=body.log_tail)
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    with catalog.tx() as conn:
        conn.execute("UPDATE sim_job SET log_tail=? WHERE id=?", (body.log_tail[-8000:], job_id))
    scan(catalog, settings.datasets_root, hash_files=False)
    request.app.state.jobs.prefetch_terrain_soon()
    return {"run_id": run_id, "track": f"/deployments/{job['deployment_id']}/track/{run_id}"}


@router.post("/jobs/{job_id}/fail")
def post_fail(job_id: int, body: FailBody, request: Request, runner: Runner) -> dict[str, bool]:
    if not fail(request.app.state.catalog, job_id, runner, error=body.error, log_tail=body.log_tail):
        raise HTTPException(
            status_code=409, detail="this runner does not hold the job (canceled, requeued or done)"
        )
    return {"ok": True}
