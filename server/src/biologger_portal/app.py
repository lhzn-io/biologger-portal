# Copyright (c) 2026 Long Horizon Observatory
# Licensed under the Apache License, Version 2.0. See LICENSE file for details.

"""FastAPI application: the JSON API under /api, track bundles under /tracks, the web app at /."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, RedirectResponse

from . import __version__
from .db import Catalog
from .jobs import Jobs
from .routes import agent, catalog, health, runner, sheets, sim, topobathy, tracks, uploads, visits
from .settings import Settings, get_settings
from .topobathy import TopobathyProxy

API_PREFIXES = ("api/", "tracks/", "topobathy/", "models/", "docs")
MODEL_SUFFIXES = (".blgm", ".json")


def create_app(
    settings: Settings | None = None, topobathy_transport: httpx.BaseTransport | None = None
) -> FastAPI:
    settings = settings or get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        yield
        app.state.jobs.shutdown()
        app.state.topobathy.close()
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
    app.state.topobathy = TopobathyProxy(
        settings.topobathykit_url, settings.portal_dir / "topobathy-cache", transport=topobathy_transport
    )
    app.state.jobs = Jobs(app.state.catalog, settings.datasets_root)
    if settings.topobathy_prefetch:
        app.state.jobs.attach_topobathy(app.state.topobathy, settings.topobathy_max_dim)
    app.include_router(health.router, prefix="/api")
    app.include_router(topobathy.router)
    app.include_router(catalog.router, prefix="/api")
    app.include_router(tracks.router)
    app.include_router(uploads.router)
    app.include_router(sheets.router)
    app.include_router(visits.router, prefix="/api")
    app.include_router(sim.router)
    app.include_router(runner.router)
    app.include_router(agent.router)
    _mount_models(app, settings.packed_models_dir)
    _mount_docs(app, settings.docs_dir)

    dist = settings.web_dist
    if dist is not None and (dist / "index.html").is_file():
        _mount_web(app, dist)
    return app


def _mount_models(app: FastAPI, packed: Path | None) -> None:
    """Serve the packed animal models (models.json and *.blgm, encrypted under the build's key) at /models."""

    @app.get("/models/{name}", include_in_schema=False)
    def model(name: str) -> FileResponse:
        if packed is None:
            raise HTTPException(status_code=404)
        root = packed.resolve()
        candidate = (root / name).resolve()
        if candidate.parent != root or candidate.suffix not in MODEL_SUFFIXES or not candidate.is_file():
            raise HTTPException(status_code=404)
        # Each hub build packs them under a new key, so a browser revalidates instead of keeping an old copy.
        return FileResponse(candidate, headers={"Cache-Control": "no-cache"})


def _mount_docs(app: FastAPI, docs: Path | None) -> None:
    """Serve the built documentation at /docs (biologger-sim's at /docs/sim/, this user guide at /docs/guide/).

    The HTML is built outside the image and mounted read-only. Through the tunnel it sits behind Cloudflare Access
    like the rest of the hub; it is never part of the published snapshot.
    """

    @app.get("/docs", include_in_schema=False, response_model=None)
    @app.get("/docs/{path:path}", include_in_schema=False, response_model=None)
    def doc(path: str = "") -> FileResponse | RedirectResponse:
        if docs is None:
            raise HTTPException(status_code=404)
        root = docs.resolve()
        candidate = (root / path).resolve()
        if not candidate.is_relative_to(root):
            raise HTTPException(status_code=404)
        if candidate.is_dir():
            if path and not path.endswith("/"):
                # Sphinx pages link relative to their folder, so a folder needs its trailing slash.
                return RedirectResponse(f"/docs/{path}/", status_code=308)
            candidate = candidate / "index.html"
        if not candidate.is_file():
            raise HTTPException(status_code=404)
        return FileResponse(candidate, headers={"Cache-Control": "no-cache"})


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
