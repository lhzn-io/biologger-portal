# Copyright (c) 2026 Long Horizon Observatory
# Licensed under the Apache License, Version 2.0. See LICENSE file for details.

"""Topobathymetry from topobathykit, cached on disk.

The viewer draws both its 2D basemap and its 3D terrain from one product: a DEM dataset's mosaic
cropped to a track's bounding box (``/api/v1/dem/datasets/{id}/meta`` and ``elevation.bin`` with
``bbox`` and ``max_dim``). The portal requests no map tiles, because an uncached tile makes
topobathykit fuse it on its single worker, and a meta or elevation request already takes 14 to 28 s.

So every response is cached on disk under ``.portal/topobathy-cache/`` and served from there afterwards;
requests to topobathykit go one at a time with explicit timeouts; identical concurrent requests wait
for the first. Errors are never cached.
"""

import hashlib
import json
import re
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import urlencode

import httpx

from .db import loads

DATASET_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,80}$")
PRODUCTS = {"meta": "application/json", "elevation.bin": "application/octet-stream"}
TIMEOUT = httpx.Timeout(connect=5.0, read=120.0, write=10.0, pool=130.0)

# Track bounding box margin: a fraction of the span on each side, at least this many degrees.
MARGIN_FRACTION = 0.25
MARGIN_MIN_DEG = 0.02


class TopobathyError(Exception):
    def __init__(self, status: int, detail: str) -> None:
        super().__init__(detail)
        self.status = status
        self.detail = detail


@dataclass
class Cached:
    body: bytes
    content_type: str
    # Changes whenever the cached file is replaced (after a DEM rebuild and a cache clear), so browsers
    # revalidate with If-None-Match instead of keeping stale terrain.
    etag: str = ""


def track_bbox(bounds: dict[str, Any]) -> tuple[float, float, float, float] | None:
    """West, south, east, north around a track's lat/lon bounds, with a margin."""
    lat = bounds.get("lat")
    lon = bounds.get("lon")
    if not lat or not lon:
        return None
    lat_pad = max((lat[1] - lat[0]) * MARGIN_FRACTION, MARGIN_MIN_DEG)
    lon_pad = max((lon[1] - lon[0]) * MARGIN_FRACTION, MARGIN_MIN_DEG)
    return (
        round(lon[0] - lon_pad, 4),
        round(lat[0] - lat_pad, 4),
        round(lon[1] + lon_pad, 4),
        round(lat[1] + lat_pad, 4),
    )


def bbox_param(bbox: tuple[float, float, float, float]) -> str:
    return ",".join(f"{v:.4f}" for v in bbox)


def parse_bbox(text: str) -> tuple[float, float, float, float]:
    try:
        w, s, e, n = (float(v) for v in text.split(","))
    except ValueError as exc:
        raise TopobathyError(422, "bbox must be four numbers: west,south,east,north") from exc
    if not (-180 <= w < e <= 180 and -90 <= s < n <= 90):
        raise TopobathyError(422, "bbox must satisfy west < east and south < north, in degrees")
    return (w, s, e, n)


class TopobathyProxy:
    def __init__(self, base_url: str, cache_dir: Path, transport: httpx.BaseTransport | None = None) -> None:
        self.base_url = base_url.rstrip("/")
        self.cache_dir = cache_dir
        self._client = httpx.Client(timeout=TIMEOUT, transport=transport)
        self._upstream = threading.Semaphore(1)  # topobathykit runs one worker
        self._locks: dict[str, threading.Lock] = {}
        self._locks_guard = threading.Lock()

    def close(self) -> None:
        self._client.close()

    def dem(self, dataset: str, product: str, bbox: str | None, max_dim: int | None) -> Cached:
        if not DATASET_ID.fullmatch(dataset):
            raise TopobathyError(422, "invalid dataset id")
        if product not in PRODUCTS:
            raise TopobathyError(404, "unknown product")
        params: dict[str, str] = {}
        if bbox is not None:
            params["bbox"] = bbox_param(parse_bbox(bbox))
        if max_dim is not None:
            if not 64 <= max_dim <= 4096:
                raise TopobathyError(422, "max_dim must be 64 to 4096")
            params["max_dim"] = str(max_dim)
        path = f"/api/v1/dem/datasets/{dataset}/{product}"
        return self._get(path, params, PRODUCTS[product])

    def _get(self, path: str, params: dict[str, str], content_type: str) -> Cached:
        url = path + ("?" + urlencode(sorted(params.items())) if params else "")
        key = hashlib.sha256(url.encode()).hexdigest()[:32]
        body_path = self.cache_dir / f"{key}.bin"
        meta_path = self.cache_dir / f"{key}.json"
        hit = self._read(body_path, meta_path)
        if hit:
            return hit
        with self._key_lock(key):
            hit = self._read(body_path, meta_path)
            if hit:
                return hit
            with self._upstream:
                try:
                    res = self._client.get(self.base_url + url)
                except httpx.TimeoutException as exc:
                    raise TopobathyError(
                        504, "topobathykit did not answer in time; try again shortly"
                    ) from exc
                except httpx.HTTPError as exc:
                    raise TopobathyError(502, f"topobathykit unreachable: {exc}") from exc
            if res.status_code != 200:
                detail = res.text[:300]
                raise TopobathyError(res.status_code if res.status_code in (400, 404, 422) else 502, detail)
            self.cache_dir.mkdir(parents=True, exist_ok=True)
            tmp = body_path.with_suffix(".tmp")
            tmp.write_bytes(res.content)
            tmp.replace(body_path)
            meta_path.write_text(json.dumps({"url": url, "content_type": content_type}))
            return Cached(res.content, content_type, _etag(body_path))

    def _read(self, body_path: Path, meta_path: Path) -> Cached | None:
        if body_path.is_file() and meta_path.is_file():
            info = json.loads(meta_path.read_text())
            return Cached(body_path.read_bytes(), info["content_type"], _etag(body_path))
        return None

    def _key_lock(self, key: str) -> threading.Lock:
        with self._locks_guard:
            return self._locks.setdefault(key, threading.Lock())


def overview_area(catalog: Any) -> tuple[str, str, tuple[float, float, float, float]] | None:
    """The DEM dataset most tracks use, its policy, and the bounding box around all of those tracks."""
    rows = catalog.query(
        """SELECT t.bounds, d.dem_dataset, d.dem_policy FROM track t
           JOIN deployment d ON d.id = t.deployment_id WHERE d.dem_dataset != ''"""
    )
    by_dataset: dict[tuple[str, str], list[tuple[float, float, float, float]]] = {}
    for r in rows:
        bbox = track_bbox(loads(r["bounds"]))
        if bbox is not None:
            by_dataset.setdefault((r["dem_dataset"], r["dem_policy"]), []).append(bbox)
    if not by_dataset:
        return None
    (dataset, policy), boxes = max(by_dataset.items(), key=lambda kv: len(kv[1]))
    union = (
        min(b[0] for b in boxes),
        min(b[1] for b in boxes),
        max(b[2] for b in boxes),
        max(b[3] for b in boxes),
    )
    return dataset, policy, union


def _etag(path: Path) -> str:
    st = path.stat()
    return f'"{path.stem[:16]}-{st.st_size:x}-{st.st_mtime_ns:x}"'


def prefetch_tracks(catalog: Any, proxy: TopobathyProxy, max_dim: int) -> list[str]:
    """Fetches the terrain of every track, and of the overview, whose crop is not cached yet."""
    fetched = []
    rows = catalog.query(
        """SELECT t.deployment_id, t.run_id, t.bounds, d.dem_dataset FROM track t
           JOIN deployment d ON d.id = t.deployment_id WHERE d.dem_dataset != ''"""
    )
    for r in rows:
        bbox = track_bbox(loads(r["bounds"]))
        if bbox is None:
            continue
        for product in ("meta", "elevation.bin"):
            proxy.dem(r["dem_dataset"], product, bbox_param(bbox), max_dim)
        fetched.append(f"{r['deployment_id']}/{r['run_id']}")
    overview = overview_area(catalog)
    if overview is not None and len(rows) > 1:
        for product in ("meta", "elevation.bin"):
            proxy.dem(overview[0], product, bbox_param(overview[2]), max_dim)
        fetched.append("overview")
    return fetched
