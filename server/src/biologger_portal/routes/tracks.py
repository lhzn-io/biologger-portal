# Copyright (c) 2026 Long Horizon Observatory
# Licensed under the Apache License, Version 2.0. See LICENSE file for details.

"""Track bundles (``track-bundle-v1`` from ``biologger-sim export-track``).

``/tracks/{deployment}/{run}/track.json|track.f32|track.geojson`` serves only files of a bundle the
catalog knows, so no other path under the datasets folder is reachable.
"""

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel

from ..auth import User, require_editor, require_user
from ..db import loads, utcnow

router = APIRouter(tags=["tracks"])
Reader = Annotated[User, Depends(require_user)]
Editor = Annotated[User, Depends(require_editor)]

BUNDLE_FILES = {
    "track.json": "application/json",
    "track.f32": "application/octet-stream",
    "track.geojson": "application/geo+json",
}


@router.get("/api/tracks")
def list_tracks(request: Request, _: Reader) -> list[dict[str, Any]]:
    rows = request.app.state.catalog.query(
        """SELECT t.*, d.species, d.common_name FROM track t JOIN deployment d ON d.id = t.deployment_id
           ORDER BY t.deployment_id, t.run_id DESC"""
    )
    return [
        {**r, "bounds": loads(r["bounds"]), "url": f"/tracks/{r['deployment_id']}/{r['run_id']}/"}
        for r in rows
    ]


class PublishWrite(BaseModel):
    run_id: str


@router.put("/api/deployments/{dep_id}/published-track")
def publish_track(dep_id: str, body: PublishWrite, request: Request, user: Editor) -> dict[str, Any]:
    """Marks one run as the reviewed track of a deployment (and unmarks the others)."""
    cat = request.app.state.catalog
    if cat.one("SELECT 1 FROM track WHERE deployment_id=? AND run_id=?", (dep_id, body.run_id)) is None:
        raise HTTPException(status_code=404, detail=f"no track {body.run_id} for {dep_id}")
    now = utcnow()
    with cat.tx() as conn:
        old = conn.execute(
            "SELECT run_id FROM track WHERE deployment_id=? AND published=1", (dep_id,)
        ).fetchone()
        conn.execute("UPDATE track SET published = (run_id = ?) WHERE deployment_id=?", (body.run_id, dep_id))
        conn.execute(
            """INSERT INTO audit (at_utc, actor, entity, entity_id, field, old_value, new_value)
               VALUES (?, ?, 'deployment', ?, 'published_track', ?, ?)""",
            (now, user.email, dep_id, old["run_id"] if old else None, body.run_id),
        )
    return {"deployment_id": dep_id, "published": body.run_id}


@router.get("/tracks/{dep_id}/{run_id}/{name}", include_in_schema=False)
def bundle_file(dep_id: str, run_id: str, name: str, request: Request, _: Reader) -> FileResponse:
    if name not in BUNDLE_FILES:
        raise HTTPException(status_code=404)
    row = request.app.state.catalog.one(
        "SELECT path FROM track WHERE deployment_id=? AND run_id=?", (dep_id, run_id)
    )
    if row is None:
        raise HTTPException(status_code=404, detail=f"no track {run_id} for {dep_id}")
    root = request.app.state.settings.datasets_root.resolve()
    path = (root / row["path"] / name).resolve()
    if not path.is_relative_to(root) or not path.is_file():
        raise HTTPException(status_code=404)
    # Bundles never change once written (a re-export is a new run), so browsers may cache them.
    return FileResponse(
        path, media_type=BUNDLE_FILES[name], headers={"Cache-Control": "private, max-age=86400"}
    )
