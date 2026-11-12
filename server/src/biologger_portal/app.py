# Copyright (c) 2026 Long Horizon Observatory
# Licensed under the Apache License, Version 2.0. See LICENSE file for details.

"""FastAPI application: the JSON API under /api and the built web app at /."""

from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse

from . import __version__
from .routes import health
from .settings import Settings, get_settings


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    app = FastAPI(
        title="biologger-portal", version=__version__, docs_url="/api/docs", openapi_url="/api/openapi.json"
    )
    app.state.settings = settings
    app.include_router(health.router, prefix="/api")

    dist = settings.web_dist
    if dist is not None and (dist / "index.html").is_file():
        _mount_web(app, dist)
    return app


def _mount_web(app: FastAPI, dist: Path) -> None:
    """Serve files from the build, and index.html for client-side routes (no file of their own)."""
    root = dist.resolve()

    @app.get("/{path:path}", include_in_schema=False)
    def web(path: str) -> FileResponse:
        if path.startswith("api/"):
            raise HTTPException(status_code=404)
        candidate = (root / path).resolve()
        if path and candidate.is_file() and candidate.is_relative_to(root):
            return FileResponse(candidate)
        return FileResponse(root / "index.html")
