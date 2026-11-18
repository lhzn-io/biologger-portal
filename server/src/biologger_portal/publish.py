# Copyright (c) 2026 Long Horizon Observatory
# Licensed under the Apache License, Version 2.0. See LICENSE file for details.

"""The published snapshot: what the lab sees on the Cloudflare viewer, written as static files.

Layout (under the output folder), mirroring the hub's API so the web app reads either::

    data/v1/deployments.json                     /api/deployments
    data/v1/deployments/<id>.json                /api/deployments/<id>
    data/v1/matrix.json                          /api/matrix
    data/v1/tracks.json                          /api/tracks
    data/v1/tracks/<id>/<run>/track.{json,f32,geojson}
    data/v1/terrain/<id>/<run>/terrain.json, meta.json, elevation.bin
    data/v1/terrain/overview/...                 the landing map's crop
    data/v1/snapshot.json                        publish time, versions, a SHA-256 per file

For each deployment the run marked reviewed is published, with any runs an editor shared beside it
(the variants the compare page sets side by side), and only with their terrain already cached on the
hub (publishing never calls topobathykit). The reviewed run keeps ``published: 1`` in the snapshot,
so the viewer's overview still shows that one per deployment; shared runs carry ``published: 0``.
Left out: the change history, people's names, the prototype's unverified validation records, runs
neither reviewed nor shared, and anything about uploads.

Every file except snapshot.json is written deterministically, so an unchanged catalog gives an
unchanged ``content_sha256`` and the daily run can skip the deploy.
"""

import hashlib
import json
import shutil
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from . import __version__
from .db import Catalog, loads, utcnow
from .metadata import PERSON_FIELDS
from .scanner import MATRIX_KINDS, PRODUCT_KINDS
from .topobathy import TopobathyProxy, bbox_param, overview_area, track_bbox

BASE = "data/v1"
BUNDLE_FILES = ("track.json", "track.f32", "track.geojson")


class PublishError(Exception):
    pass


@dataclass
class Snapshot:
    out_dir: Path
    manifest: dict[str, Any]


def _dump(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, sort_keys=True, indent=1, ensure_ascii=False) + "\n")


def _clean(out_dir: Path) -> None:
    """Empties a previous snapshot folder; refuses any other non-empty folder."""
    if out_dir.exists() and any(out_dir.iterdir()):
        if not (out_dir / BASE / "snapshot.json").is_file():
            raise PublishError(f"{out_dir} is not empty and holds no earlier snapshot; choose another folder")
        shutil.rmtree(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)


def _published_tracks(catalog: Catalog) -> list[dict[str, Any]]:
    return catalog.query(
        """SELECT t.*, d.dem_dataset, d.dem_policy, d.species, d.common_name FROM track t
           JOIN deployment d ON d.id = t.deployment_id WHERE t.published = 1 OR t.shared = 1
           ORDER BY t.deployment_id, t.run_id DESC"""
    )


def _public_fields(fields: dict[str, str]) -> dict[str, str]:
    return {k: v for k, v in fields.items() if k not in PERSON_FIELDS and not k.startswith("_")}


def _latest_runs(catalog: Catalog, dep_id: str) -> list[dict[str, Any]]:
    """The newest finished, real validation run for each file of a deployment."""
    rows = catalog.query(
        """SELECT * FROM validation_run WHERE deployment_id=? AND unverified=0
           AND status NOT IN ('queued', 'running') ORDER BY id DESC""",
        (dep_id,),
    )
    seen: set[str] = set()
    out = []
    for r in rows:
        if r["file_path"] in seen:
            continue
        seen.add(r["file_path"])
        out.append(
            {
                "id": r["id"],
                "deployment_id": r["deployment_id"],
                "file_id": r["file_id"],
                "file_path": r["file_path"],
                "mode": r["mode"],
                "status": r["status"],
                "tool_version": r["tool_version"],
                "unverified": False,
                "summary": r["summary"],
                "results": loads(r["results"]),
                "requested_by": "",
                "created_utc": r["created_utc"],
                "started_utc": r["started_utc"],
                "finished_utc": r["finished_utc"],
            }
        )
    return out


def _track_out(t: dict[str, Any]) -> dict[str, Any]:
    keys = ("deployment_id", "run_id", "track_model", "sim_git_commit", "sim_git_dirty", "rate_hz", "count",
            "t0", "duration_s", "species", "common_name")  # fmt: skip
    out = {k: t[k] for k in keys if k in t}
    out.update(id=t["id"], path="", published=t["published"], shared=t["shared"], bounds=loads(t["bounds"]))
    out["url"] = f"/{BASE}/tracks/{t['deployment_id']}/{t['run_id']}/"
    return out


def _terrain_out(
    dep_path: str, dataset: str, policy: str, bbox: tuple[float, ...], max_dim: int
) -> dict[str, Any]:
    base = f"/{BASE}/terrain/{dep_path}"
    return {
        "dataset": dataset,
        "policy": policy,
        "bbox": list(bbox),
        "max_dim": max_dim,
        "meta_url": f"{base}/meta.json",
        "elevation_url": f"{base}/elevation.bin",
    }


def _copy_terrain(proxy: TopobathyProxy, dataset: str, bbox: str, max_dim: int, dest: Path) -> bool:
    meta = proxy.cached(dataset, "meta", bbox, max_dim)
    elev = proxy.cached(dataset, "elevation.bin", bbox, max_dim)
    if meta is None or elev is None:
        return False
    dest.mkdir(parents=True, exist_ok=True)
    (dest / "meta.json").write_bytes(meta.body)
    (dest / "elevation.bin").write_bytes(elev.body)
    return True


def publish(catalog: Catalog, root: Path, out_dir: Path, proxy: TopobathyProxy, max_dim: int) -> Snapshot:
    tracks = _published_tracks(catalog)
    missing_terrain = []
    for t in tracks:
        bbox = track_bbox(loads(t["bounds"]))
        if not t["dem_dataset"]:
            continue  # no topobathykit grid covers the track yet: published without a seafloor
        if bbox is None:
            missing_terrain.append(f"{t['deployment_id']}/{t['run_id']} (no lat/lon bounds)")
        elif not all(
            proxy.cached(t["dem_dataset"], p, bbox_param(bbox), max_dim) for p in ("meta", "elevation.bin")
        ):
            missing_terrain.append(
                f"{t['deployment_id']}/{t['run_id']} (terrain not cached; run a scan on the hub)"
            )
    if missing_terrain:
        raise PublishError("published tracks without terrain: " + "; ".join(missing_terrain))

    _clean(out_dir)
    data = out_dir / BASE
    by_dep: dict[str, list[dict[str, Any]]] = {}
    for t in tracks:
        by_dep.setdefault(t["deployment_id"], []).append(t)

    # Tracks and their terrain.
    for t in tracks:
        dep, run = t["deployment_id"], t["run_id"]
        src = root / t["path"]
        dest = data / "tracks" / dep / run
        dest.mkdir(parents=True, exist_ok=True)
        for name in BUNDLE_FILES:
            if not (src / name).is_file():
                raise PublishError(f"{t['path']}/{name} is missing on disk")
            shutil.copyfile(src / name, dest / name)
        if not t["dem_dataset"]:
            # The viewer reads "detail" as the reason there is no terrain (as the hub's 404 says).
            _dump(
                data / "terrain" / dep / run / "terrain.json",
                {"detail": f"{dep} has no DEM dataset assigned"},
            )
            continue
        bbox = track_bbox(loads(t["bounds"]))
        assert bbox is not None
        _copy_terrain(proxy, t["dem_dataset"], bbox_param(bbox), max_dim, data / "terrain" / dep / run)
        _dump(
            data / "terrain" / dep / run / "terrain.json",
            _terrain_out(f"{dep}/{run}", t["dem_dataset"], t["dem_policy"], bbox, max_dim),
        )
    _dump(data / "tracks.json", [_track_out(t) for t in tracks])

    area = overview_area(catalog)
    if area is not None and len(by_dep) > 1:
        dataset, policy, bbox = area
        if _copy_terrain(proxy, dataset, bbox_param(bbox), max_dim, data / "terrain" / "overview"):
            _dump(
                data / "terrain" / "overview" / "terrain.json",
                _terrain_out("overview", dataset, policy, bbox, max_dim),
            )

    # Deployments.
    summaries = []
    for d in catalog.query("SELECT * FROM deployment ORDER BY time_start_utc, id"):
        dep = d["id"]
        files = [
            {"id": f["id"], "path": f["path"], "deployment_id": dep, "kind": f["kind"], "size": f["size"],
             "mtime": f["mtime"], "sha256": f["sha256"], "info": loads(f["info"]), "missing": 0, "seen_utc": ""}
            for f in catalog.query(
                "SELECT * FROM file WHERE deployment_id=? AND missing=0 AND kind != 'track' ORDER BY kind, path", (dep,)
            )
        ]  # fmt: skip
        runs = _latest_runs(catalog, dep)
        track = [_track_out(t) for t in by_dep.get(dep, [])]
        cols = {k: d[k] for k in ("species", "common_name", "location", "time_start_utc", "time_end_utc",
                                  "start_lat", "start_lon", "end_lat", "end_lon", "dem_dataset")}  # fmt: skip
        summaries.append(
            {**cols, "id": dep, "file_count": len(files), "total_bytes": sum(f["size"] for f in files),
             "track_count": len(track), "last_validation": runs[0]["status"] if runs else None}
        )  # fmt: skip
        aliases = [
            r["alias"]
            for r in catalog.query("SELECT alias FROM deployment_alias WHERE deployment_id=?", (dep,))
        ]
        _dump(
            data / "deployments" / f"{dep}.json",
            {**summaries[-1], "fields": _public_fields(loads(d["fields"])), "dem_policy": d["dem_policy"],
             "drive_link": d["drive_link"], "source": d["source"], "updated_utc": d["updated_utc"],
             "aliases": sorted(aliases), "files": files, "validation_runs": runs, "tracks": track, "audit": []},
        )  # fmt: skip
    _dump(data / "deployments.json", summaries)

    # The file grid (as the hub computes it; tracks counted as published runs only, reviewed or shared).
    rows = []
    for s in summaries:
        dep = s["id"]
        counts = catalog.query(
            """SELECT kind, COUNT(*) AS n, SUM(size) AS bytes FROM file WHERE deployment_id=? AND missing=0
               AND kind != 'track' GROUP BY kind""",
            (dep,),
        )
        present = {c["kind"]: {"count": c["n"], "bytes": c["bytes"]} for c in counts}
        drive = catalog.one("SELECT drive_link FROM deployment WHERE id=?", (dep,))
        cells: dict[str, Any] = {}
        for kind in MATRIX_KINDS:
            if kind == "track" and dep in by_dep:
                cells[kind] = {"state": "present", "count": len(by_dep[dep]), "bytes": 0}
            elif kind in present:
                cells[kind] = {"state": "present", **present[kind]}
            elif kind in PRODUCT_KINDS and drive and drive["drive_link"]:
                cells[kind] = {"state": "remote", "link": drive["drive_link"]}
            else:
                cells[kind] = {"state": "missing"}
        rows.append(
            {"deployment_id": dep, "species": s["species"], "common_name": s["common_name"], "cells": cells}
        )
    _dump(data / "matrix.json", {"kinds": list(MATRIX_KINDS), "rows": rows, "unattributed_files": 0})

    # Manifest: a checksum per file and one over the whole content.
    files_sha: dict[str, dict[str, Any]] = {}
    for p in sorted(data.rglob("*")):
        if p.is_file():
            files_sha[p.relative_to(out_dir).as_posix()] = {
                "sha256": hashlib.sha256(p.read_bytes()).hexdigest(),
                "bytes": p.stat().st_size,
            }
    content = hashlib.sha256(
        "".join(f"{k} {v['sha256']}\n" for k, v in files_sha.items()).encode()
    ).hexdigest()
    manifest = {
        "schema": "portal-snapshot-v1",
        "published_utc": utcnow(),
        "portal_version": __version__,
        "content_sha256": content,
        "deployments": len(summaries),
        "tracks": [
            {
                "deployment_id": t["deployment_id"],
                "run_id": t["run_id"],
                "sim_git_commit": t["sim_git_commit"],
            }
            for t in tracks
        ],  # fmt: skip
        "files": files_sha,
    }
    _dump(data / "snapshot.json", manifest)
    return Snapshot(out_dir, manifest)
