# Copyright (c) 2026 Long Horizon Observatory
# Licensed under the Apache License, Version 2.0. See LICENSE file for details.

"""The live viewer's visit log, for the hub's Visitors page. Never part of the published snapshot."""

import time
from typing import Annotated, Any

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Request

from ..auth import User, require_user
from ..visits import VisitsNotConfigured, configured, pull_visits, summary

router = APIRouter(tags=["visits"])
Reader = Annotated[User, Depends(require_user)]
REFRESH_EVERY_S = 60


@router.get("/visits")
def get_visits(request: Request, user: Reader, days: int = Query(30, ge=1, le=180)) -> dict[str, Any]:
    return {"configured": configured(request.app.state.settings), **summary(request.app.state.catalog, days)}


@router.post("/visits/refresh")
def refresh_visits(request: Request, user: Reader) -> dict[str, Any]:
    state = request.app.state
    last = getattr(state, "visits_refreshed_at", 0.0)
    if time.monotonic() - last < REFRESH_EVERY_S:
        raise HTTPException(status_code=429, detail="pulled less than a minute ago")
    state.visits_refreshed_at = time.monotonic()
    try:
        return pull_visits(state.catalog, state.settings, transport=getattr(state, "visits_transport", None))
    except VisitsNotConfigured as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=502, detail=f"the live viewer's log could not be read: {exc}"
        ) from exc
