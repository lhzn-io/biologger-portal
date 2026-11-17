# Copyright (c) 2026 Long Horizon Observatory
# Licensed under the Apache License, Version 2.0. See LICENSE file for details.

"""Task-level calls for scripts that run the hub as an editor (see docs/src/deploy.rst, "Agent API").

Scripts reach the hub through its tunnel hostname with a Cloudflare Access service token; the hub
names the token's client ID as ``agent:<name>`` (``PORTAL_AGENTS``) and records that name on what it
does. The rest of the API (metadata, uploads, cancel and retry) is the one the web app uses, listed at
/api/docs.
"""

import asyncio
import time
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel, Field

from .. import __version__
from ..auth import User, require_editor
from ..db import Catalog
from ..sim_jobs import ACTIVE, reap
from .sim import BatchCreate, _job, post_batch

router = APIRouter(prefix="/api/agent", tags=["agent"])
Editor = Annotated[User, Depends(require_editor)]
MAX_WAIT_S = 120


class RunsCreate(BaseModel):
    deployment_ids: list[str] = Field(min_length=1, max_length=500)
    profile: str | None = None
    rate_hz: float = Field(1.0, gt=0, le=25)
    backend: str = "any"
    label: str = ""


@router.get("/status")
def status(request: Request, user: Editor) -> dict[str, Any]:
    """The catalog's size, the run queue by status, and when each runner last reported."""
    catalog: Catalog = request.app.state.catalog
    reap(catalog)
    queue = {
        r["status"]: r["n"]
        for r in catalog.query("SELECT status, COUNT(*) AS n FROM sim_job GROUP BY status")
    }
    marks = ",".join("?" * len(ACTIVE))
    runners = catalog.query(
        f"""SELECT runner, MAX(COALESCE(heartbeat_utc, claimed_utc)) AS last_report_utc,
            MAX(CASE WHEN status IN ({marks}) THEN id END) AS running_job
            FROM sim_job WHERE runner != '' GROUP BY runner ORDER BY runner""",
        ACTIVE,
    )
    counts = catalog.one(
        "SELECT (SELECT COUNT(*) FROM deployment) AS deployments, (SELECT COUNT(*) FROM track) AS tracks"
    )
    return {"version": __version__, "user": user.email, **(counts or {}), "queue": queue, "runners": runners}


@router.post("/runs")
def queue_runs(body: RunsCreate, request: Request, user: Editor) -> dict[str, Any]:
    """One run per deployment that can run (as a batch); the others come back with their reasons."""
    batch = BatchCreate(
        deployment_ids=body.deployment_ids,
        profile=body.profile,
        rate_hz=body.rate_hz,
        backend=body.backend,
        label=body.label or f"{user.email} via the agent API",
    )
    made = post_batch(batch, request, user)
    return {
        "batch_id": made["batch_id"],
        "job_ids": [j["id"] for j in made["jobs"]],
        "skipped": made["skipped"],
    }


@router.get("/runs/{job_id}")
async def get_run(
    job_id: int, request: Request, _: Editor, wait: Annotated[float, Query(ge=0, le=MAX_WAIT_S)] = 0
) -> dict[str, Any]:
    """A run; with ``wait`` (seconds, up to 120), returns once it has finished or the wait is over."""
    catalog: Catalog = request.app.state.catalog
    deadline = time.monotonic() + wait
    while True:
        reap(catalog)
        job = _job(catalog, job_id, full=False)
        if job["status"] not in ("queued", *ACTIVE) or time.monotonic() >= deadline:
            break
        await asyncio.sleep(min(1.0, max(0.0, deadline - time.monotonic())))
    if job["run_id"]:
        job["track"] = f"/deployments/{job['deployment_id']}/track/{job['run_id']}"
    return job
