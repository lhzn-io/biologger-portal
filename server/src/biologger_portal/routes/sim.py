# Copyright (c) 2026 Long Horizon Observatory
# Licensed under the Apache License, Version 2.0. See LICENSE file for details.

"""Simulation profiles and the run config a deployment would get. Editors only."""

from pathlib import Path
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

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
