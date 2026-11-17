# Copyright (c) 2026 Long Horizon Observatory
# Licensed under the Apache License, Version 2.0. See LICENSE file for details.

"""Catalog API: deployments, files, the file grid, validation runs, scans."""

from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from ..auth import User, require_editor, require_user
from ..db import Catalog, loads
from ..jobs import Jobs
from ..metadata import CANONICAL_FIELDS, add_alias, set_dem, upsert_deployment
from ..scanner import MATRIX_KINDS, PRODUCT_KINDS

router = APIRouter(tags=["catalog"])
Reader = Annotated[User, Depends(require_user)]
Editor = Annotated[User, Depends(require_editor)]


def catalog(request: Request) -> Catalog:
    return request.app.state.catalog  # type: ignore[no-any-return]


def jobs(request: Request) -> Jobs:
    return request.app.state.jobs  # type: ignore[no-any-return]


def _deployment_out(row: dict[str, Any]) -> dict[str, Any]:
    out = dict(row)
    out["fields"] = loads(row["fields"])
    return out


def _run_out(row: dict[str, Any]) -> dict[str, Any]:
    out = dict(row)
    out["results"] = loads(row["results"])
    out["unverified"] = bool(row["unverified"])
    return out


@router.get("/me")
def me(request: Request, user: Reader) -> dict[str, Any]:
    return {"email": user.email, "editor": user.editor, "signin_url": request.app.state.settings.signin_url}


@router.get("/deployments")
def list_deployments(request: Request, _: Reader) -> list[dict[str, Any]]:
    rows = catalog(request).query(
        """SELECT d.id, d.species, d.common_name, d.location, d.time_start_utc, d.time_end_utc,
                  d.start_lat, d.start_lon, d.end_lat, d.end_lon, d.dem_dataset,
                  (SELECT COUNT(*) FROM file f WHERE f.deployment_id = d.id AND f.missing = 0) AS file_count,
                  (SELECT COALESCE(SUM(size), 0) FROM file f WHERE f.deployment_id = d.id AND f.missing = 0)
                      AS total_bytes,
                  (SELECT COUNT(*) FROM track t WHERE t.deployment_id = d.id) AS track_count,
                  (SELECT status FROM validation_run v WHERE v.deployment_id = d.id AND v.unverified = 0
                      AND v.status NOT IN ('queued', 'running') ORDER BY v.id DESC LIMIT 1) AS last_validation
           FROM deployment d ORDER BY d.time_start_utc, d.id"""
    )
    return rows


@router.get("/deployments/{dep_id}")
def get_deployment(dep_id: str, request: Request, _: Reader) -> dict[str, Any]:
    cat = catalog(request)
    row = cat.one("SELECT * FROM deployment WHERE id=?", (dep_id,))
    if row is None:
        raise HTTPException(status_code=404, detail=f"no deployment {dep_id}")
    out = _deployment_out(row)
    out["aliases"] = [
        r["alias"] for r in cat.query("SELECT alias FROM deployment_alias WHERE deployment_id=?", (dep_id,))
    ]
    out["files"] = [
        {**f, "info": loads(f["info"])}
        for f in cat.query("SELECT * FROM file WHERE deployment_id=? ORDER BY kind, path", (dep_id,))
    ]
    out["validation_runs"] = [
        _run_out(r)
        for r in cat.query("SELECT * FROM validation_run WHERE deployment_id=? ORDER BY id DESC", (dep_id,))
    ]
    out["tracks"] = [
        {**t, "bounds": loads(t["bounds"])}
        for t in cat.query("SELECT * FROM track WHERE deployment_id=? ORDER BY run_id DESC", (dep_id,))
    ]
    out["audit"] = cat.query(
        "SELECT * FROM audit WHERE entity='deployment' AND entity_id=? ORDER BY id DESC LIMIT 200", (dep_id,)
    )
    return out


class DeploymentWrite(BaseModel):
    fields: dict[str, str] = Field(description="Canonical sheet fields to set (text values)")


@router.post("/deployments", status_code=201)
def create_deployment(body: DeploymentWrite, request: Request, user: Editor) -> dict[str, Any]:
    dep_id = body.fields.get("deployment_id", "").strip()
    if not dep_id or "/" in dep_id or dep_id.startswith("."):
        raise HTTPException(status_code=422, detail="deployment_id is required and may not contain '/'")
    if catalog(request).one("SELECT 1 FROM deployment WHERE id=?", (dep_id,)):
        raise HTTPException(status_code=409, detail=f"{dep_id} already exists")
    _check_fields(body.fields)
    upsert_deployment(catalog(request), body.fields, source="portal", actor=user.email)
    return get_deployment(dep_id, request, user)


@router.patch("/deployments/{dep_id}")
def update_deployment(dep_id: str, body: DeploymentWrite, request: Request, user: Editor) -> dict[str, Any]:
    if catalog(request).one("SELECT 1 FROM deployment WHERE id=?", (dep_id,)) is None:
        raise HTTPException(status_code=404, detail=f"no deployment {dep_id}")
    _check_fields(body.fields)
    fields = {**body.fields, "deployment_id": dep_id}
    upsert_deployment(catalog(request), fields, source="portal", actor=user.email)
    return get_deployment(dep_id, request, user)


def _check_fields(fields: dict[str, str]) -> None:
    unknown = sorted(set(fields) - set(CANONICAL_FIELDS))
    if unknown:
        raise HTTPException(status_code=422, detail=f"unknown fields: {', '.join(unknown)}")


class DemWrite(BaseModel):
    dataset: str
    policy: str = ""


@router.put("/deployments/{dep_id}/dem")
def put_dem(dep_id: str, body: DemWrite, request: Request, user: Editor) -> dict[str, Any]:
    try:
        set_dem(catalog(request), dep_id, body.dataset, body.policy, user.email)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=f"no deployment {dep_id}") from exc
    return {"deployment_id": dep_id, "dem_dataset": body.dataset, "dem_policy": body.policy}


class AliasWrite(BaseModel):
    alias: str


@router.post("/deployments/{dep_id}/aliases", status_code=201)
def post_alias(dep_id: str, body: AliasWrite, request: Request, _: Editor) -> dict[str, str]:
    if catalog(request).one("SELECT 1 FROM deployment WHERE id=?", (dep_id,)) is None:
        raise HTTPException(status_code=404, detail=f"no deployment {dep_id}")
    add_alias(catalog(request), body.alias, dep_id)
    return {"alias": body.alias.lower(), "deployment_id": dep_id}


@router.get("/fields")
def fields(_: Reader) -> dict[str, Any]:
    return {
        "canonical": list(CANONICAL_FIELDS),
        "products": list(PRODUCT_KINDS),
        "matrix_kinds": list(MATRIX_KINDS),
    }


@router.get("/files")
def list_files(request: Request, _: Reader, unattributed: bool = False) -> list[dict[str, Any]]:
    sql = "SELECT * FROM file WHERE missing=0"
    if unattributed:
        sql += " AND deployment_id IS NULL AND kind NOT IN ('metadata_sheet', 'doc')"
    return [{**f, "info": loads(f["info"])} for f in catalog(request).query(sql + " ORDER BY path")]


@router.get("/files/{file_id}")
def get_file(file_id: int, request: Request, _: Reader) -> dict[str, Any]:
    row = catalog(request).one("SELECT * FROM file WHERE id=?", (file_id,))
    if row is None:
        raise HTTPException(status_code=404, detail=f"no file {file_id}")
    return {**row, "info": loads(row["info"])}


@router.get("/matrix")
def matrix(request: Request, _: Reader) -> dict[str, Any]:
    """Deployments by file kind: present (count, bytes), remote (a Drive folder is listed) or missing."""
    cat = catalog(request)
    counts = cat.query(
        """SELECT deployment_id, kind, COUNT(*) AS n, SUM(size) AS bytes FROM file
           WHERE missing=0 AND deployment_id IS NOT NULL GROUP BY deployment_id, kind"""
    )
    by_dep: dict[str, dict[str, dict[str, int]]] = {}
    for c in counts:
        by_dep.setdefault(c["deployment_id"], {})[c["kind"]] = {"count": c["n"], "bytes": c["bytes"]}
    rows = []
    for d in cat.query("SELECT id, species, common_name, drive_link FROM deployment ORDER BY id"):
        present = by_dep.get(d["id"], {})
        cells = {}
        for kind in MATRIX_KINDS:
            if kind in present:
                cells[kind] = {"state": "present", **present[kind]}
            elif kind in PRODUCT_KINDS and d["drive_link"]:
                cells[kind] = {"state": "remote", "link": d["drive_link"]}
            else:
                cells[kind] = {"state": "missing"}
        rows.append(
            {
                "deployment_id": d["id"],
                "species": d["species"],
                "common_name": d["common_name"],
                "cells": cells,
            }
        )
    unattributed = cat.one(
        """SELECT COUNT(*) AS n FROM file WHERE missing=0 AND deployment_id IS NULL
           AND kind NOT IN ('metadata_sheet', 'doc')"""
    )
    return {
        "kinds": list(MATRIX_KINDS),
        "rows": rows,
        "unattributed_files": unattributed["n"] if unattributed else 0,
    }


class ValidationRequest(BaseModel):
    file_id: int
    mode: Literal["light", "deep"]


@router.post("/validation", status_code=202)
def request_validation(body: ValidationRequest, request: Request, user: Editor) -> dict[str, Any]:
    try:
        run_id = jobs(request).request_validation(body.file_id, body.mode, user.email)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=f"no file {body.file_id}") from exc
    return get_validation(run_id, request, user)


@router.get("/validation/{run_id}")
def get_validation(run_id: int, request: Request, _: Reader) -> dict[str, Any]:
    row = catalog(request).one("SELECT * FROM validation_run WHERE id=?", (run_id,))
    if row is None:
        raise HTTPException(status_code=404, detail=f"no validation run {run_id}")
    return _run_out(row)


@router.post("/scan", status_code=202)
def post_scan(request: Request, _: Editor, hash_files: bool = True) -> dict[str, Any]:
    return jobs(request).request_scan(hash_files=hash_files)


@router.get("/scan")
def get_scan(request: Request, _: Reader) -> dict[str, Any]:
    return jobs(request).scan_state
