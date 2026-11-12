# Copyright (c) 2026 Long Horizon Observatory
# Licensed under the Apache License, Version 2.0. See LICENSE file for details.

"""Liveness and configuration summary."""

from typing import Any

from fastapi import APIRouter, Request

from .. import __version__

router = APIRouter(tags=["health"])


@router.get("/health")
def health(request: Request) -> dict[str, Any]:
    settings = request.app.state.settings
    return {
        "status": "ok",
        "version": __version__,
        "datasets_root_present": settings.datasets_root.is_dir(),
    }
