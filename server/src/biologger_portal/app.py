# Copyright (c) 2026 Long Horizon Observatory
# Licensed under the Apache License, Version 2.0. See LICENSE file for details.

"""FastAPI application: the JSON API under /api, track bundles under /tracks, the web app at /."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse

from . import __version__
from .db import Catalog
from .jobs import Jobs
from .routes import catalog, health, sheets, tracks, uploads
from .settings import Settings, get_settings

API_PREFIXES = ("api/", "tracks/", "bathy/")


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        yield
        app.state.jobs.shutdown()
        app.state.catalog.close()

    app = FastAPI(
        title="biologger-portal",
        version=__version__,
        docs_url="/api/docs",
        openapi_url="/api/openapi.json",
        lifespan=lifespan,
    )
    app.state.settings = settings
    app.state.catalog = Catalog(settings.portal_dir / "catalog.db")
    app.state.jobs = Jobs(app.state.catalog, settings.datasets_root)
    app.include_router(health.router, prefix="/api")
    app.include_router(catalog.router, prefix="/api")
    app.include_router(tracks.router)
    app.include_router(uploads.router)
    app.include_router(sheets.router)

    dist = settings.web_dist
    if dist is not None and (dist / "index.html").is_file():
        _mount_web(app, dist)
    return app


def _mount_web(app: FastAPI, dist: Path) -> None:
    """Serve files from the build, and index.html for client-side routes (no file of their own)."""
    root = dist.resolve()

    @app.get("/{path:path}", include_in_schema=False)
    def web(path: str) -> FileResponse:
        if path.startswith(API_PREFIXES):
            raise HTTPException(status_code=404)
        candidate = (root / path).resolve()
        if path and candidate.is_file() and candidate.is_relative_to(root):
            return FileResponse(candidate)
        return FileResponse(root / "index.html", headers={"Cache-Control": "no-cache"})
