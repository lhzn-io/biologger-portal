# Copyright (c) 2026 Long Horizon Observatory
# Licensed under the Apache License, Version 2.0. See LICENSE file for details.

"""Topobathymetry for the viewer: which DEM crop a track uses, and the cached crop itself."""

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response

from ..auth import User, require_user
from ..db import loads
from ..topobathy import TopobathyError, TopobathyProxy, bbox_param, overview_area, track_bbox

router = APIRouter(tags=["bathymetry"])
Reader = Annotated[User, Depends(require_user)]


def terrain_for(request: Request, dep_id: str, run_id: str) -> dict[str, Any]:
    cat = request.app.state.catalog
    row = cat.one(
        """SELECT t.bounds, d.dem_dataset, d.dem_policy FROM track t JOIN deployment d ON d.id = t.deployment_id
           WHERE t.deployment_id=? AND t.run_id=?""",
        (dep_id, run_id),
    )
    if row is None:
        raise HTTPException(status_code=404, detail=f"no track {run_id} for {dep_id}")
    if not row["dem_dataset"]:
        raise HTTPException(status_code=404, detail=f"{dep_id} has no DEM dataset assigned")
    bbox = track_bbox(loads(row["bounds"]))
    if bbox is None:
        raise HTTPException(status_code=422, detail="the track bundle has no lat/lon bounds")
    return _terrain(row["dem_dataset"], row["dem_policy"], bbox, request.app.state.settings.topobathy_max_dim)


def _terrain(
    dataset: str, policy: str, bbox: tuple[float, float, float, float], max_dim: int
) -> dict[str, Any]:
    query = f"bbox={bbox_param(bbox)}&max_dim={max_dim}"
    base = f"/topobathy/dem/{dataset}"
    return {
        "dataset": dataset,
        "policy": policy,
        "bbox": list(bbox),
        "max_dim": max_dim,
        "meta_url": f"{base}/meta?{query}",
        "elevation_url": f"{base}/elevation.bin?{query}",
    }


@router.get("/api/tracks/{dep_id}/{run_id}/terrain")
def track_terrain(dep_id: str, run_id: str, request: Request, _: Reader) -> dict[str, Any]:
    return terrain_for(request, dep_id, run_id)


@router.get("/api/terrain/overview")
def overview_terrain(request: Request, _: Reader) -> dict[str, Any]:
    """One crop around every track on the most used DEM, for the landing page's map."""
    area = overview_area(request.app.state.catalog)
    if area is None:
        raise HTTPException(status_code=404, detail="no tracks with a DEM dataset yet")
    return _terrain(area[0], area[1], area[2], request.app.state.settings.topobathy_max_dim)


@router.get("/topobathy/dem/{dataset}/{product}", include_in_schema=False)
def dem(
    dataset: str,
    product: str,
    request: Request,
    _: Reader,
    bbox: str | None = None,
    max_dim: int | None = None,
) -> Response:
    proxy: TopobathyProxy = request.app.state.topobathy
    try:
        cached = proxy.dem(dataset, product, bbox, max_dim)
    except TopobathyError as exc:
        raise HTTPException(status_code=exc.status, detail=exc.detail) from exc
    return Response(
        cached.body, media_type=cached.content_type, headers={"Cache-Control": "private, max-age=86400"}
    )
