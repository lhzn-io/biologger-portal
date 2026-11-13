# Copyright (c) 2026 Long Horizon Observatory
# Licensed under the Apache License, Version 2.0. See LICENSE file for details.

"""The per-deployment folder layout: plan, apply and revert.

Target layout::

    <deployment_id>/standard/   the lab's *-standard.csv exports
    <deployment_id>/derived/    accelRotate, standard-rot-sep, magHeading, and Feather caches
    <deployment_id>/raw/        vendor files (CSV, WCH, BIN, UBX, CFG, TXT), keeping their sub-folders
    <deployment_id>/media/      video
    <deployment_id>/tracks/     track bundles (already in place)
    _metadata/                  the metadata sheets; _metadata/prototype/ the prototype's JSON registries

``plan`` reads the catalog and writes a move list; nothing moves. ``apply`` checks every source still
has the size the plan recorded and that no target exists, renames within the filesystem (no copies),
updates the catalog's paths, and writes ``.portal/moves-<time>.json``, which ``revert`` undoes.
Files that belong to no deployment are listed and left where they are.
"""

import json
import os
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from .db import Catalog, utcnow

KIND_FOLDERS = {
    "standard": "standard",
    "accel_rotate": "derived",
    "standard_rot_sep": "derived",
    "mag_heading": "derived",
    "cache": "derived",
    "raw": "raw",
    "other": "raw",
    "video": "media",
}
PROTOTYPE_FILES = ("datasets_registry.json", "validation_registry.json")
SIDECARS = (":Zone.Identifier",)


class LayoutError(Exception):
    pass


def plan(catalog: Catalog, root: Path) -> dict[str, Any]:
    files = catalog.query("SELECT path, deployment_id, kind, size FROM file WHERE missing=0 ORDER BY path")
    moves: list[dict[str, Any]] = []
    unattributed: list[str] = []
    conflicts: list[str] = []
    taken: set[str] = set()

    def add(src: str, dst: str, dep: str | None, kind: str, size: int) -> None:
        if src == dst:
            return
        if dst in taken or (root / dst).exists():
            conflicts.append(f"{src} -> {dst}")
            return
        taken.add(dst)
        moves.append({"from": src, "to": dst, "deployment": dep, "kind": kind, "size": size})

    for f in files:
        path, dep, kind, size = f["path"], f["deployment_id"], f["kind"], f["size"]
        name = path.rsplit("/", 1)[-1]
        if kind == "metadata_sheet":
            add(path, f"_metadata/{name}", None, kind, size)
            continue
        if kind in ("doc", "track"):
            continue  # the README stays at the root; bundles are already under <deployment>/tracks/
        if dep is None:
            unattributed.append(path)
            continue
        parts = path.split("/")
        if parts[0] == dep:
            continue  # already inside the deployment's folder
        rest = "/".join(parts[1:]) if len(parts) > 1 else name
        add(path, f"{dep}/{KIND_FOLDERS.get(kind, 'raw')}/{rest}", dep, kind, size)

    for name in PROTOTYPE_FILES:
        if (root / name).is_file():
            add(name, f"_metadata/prototype/{name}", None, "prototype_registry", (root / name).stat().st_size)

    legacy_ids = [
        r["id"]
        for r in catalog.query("SELECT id FROM deployment WHERE source != 'Biologger Metadata-Xgladius.csv'")
    ]
    return {
        "generated_utc": utcnow(),
        "root": str(root),
        "moves": moves,
        "bytes": sum(m["size"] for m in moves),
        "unattributed": unattributed,
        "conflicts": conflicts,
        "deployment_ids_to_confirm": legacy_ids,
    }


def write_plan(catalog: Catalog, root: Path) -> tuple[Path, dict[str, Any]]:
    p = plan(catalog, root)
    out = root / ".portal" / "layout-plan.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(p, indent=2))
    return out, p


def apply(catalog: Catalog, root: Path, plan_path: Path) -> Path:
    p = json.loads(plan_path.read_text())
    if p.get("conflicts"):
        raise LayoutError(f"the plan has {len(p['conflicts'])} conflicts; resolve them and plan again")
    for m in p["moves"]:  # check everything before moving anything
        src, dst = root / m["from"], root / m["to"]
        if not src.is_file():
            raise LayoutError(f"source missing: {m['from']} (plan again)")
        if src.stat().st_size != m["size"]:
            raise LayoutError(f"source changed since the plan: {m['from']} (plan again)")
        if dst.exists():
            raise LayoutError(f"target exists: {m['to']}")
    done: list[dict[str, Any]] = []
    try:
        for m in p["moves"]:
            dst = root / m["to"]
            dst.parent.mkdir(parents=True, exist_ok=True)
            os.rename(root / m["from"], dst)
            done.append(m)
            # Sidecars copied over from Windows (":Zone.Identifier") travel with their file.
            for suffix in SIDECARS:
                side_src = root / (m["from"] + suffix)
                side_dst = root / (m["to"] + suffix)
                if side_src.is_file() and not side_dst.exists():
                    os.rename(side_src, side_dst)
                    done.append(
                        {"from": m["from"] + suffix, "to": m["to"] + suffix, "kind": "sidecar", "size": 0}
                    )
    finally:
        record = root / ".portal" / f"moves-{datetime.now(UTC).strftime('%Y%m%dT%H%M%SZ')}.json"
        record.write_text(
            json.dumps({"applied_utc": utcnow(), "plan": str(plan_path), "moves": done}, indent=2)
        )
        _update_catalog(catalog, [(m["from"], m["to"]) for m in done])
        _remove_empty_dirs(root, [m["from"] for m in done])
    return record


def revert(catalog: Catalog, root: Path, record_path: Path) -> int:
    record = json.loads(record_path.read_text())
    moved = []
    for m in reversed(record["moves"]):
        src, dst = root / m["to"], root / m["from"]
        if not src.is_file() or dst.exists():
            raise LayoutError(f"cannot move {m['to']} back to {m['from']}")
        dst.parent.mkdir(parents=True, exist_ok=True)
        os.rename(src, dst)
        moved.append((m["to"], m["from"]))
    _update_catalog(catalog, moved)
    _remove_empty_dirs(root, [m["to"] for m in record["moves"]])
    record_path.rename(record_path.with_suffix(".reverted.json"))
    return len(moved)


def _update_catalog(catalog: Catalog, pairs: list[tuple[str, str]]) -> None:
    with catalog.tx() as conn:
        for old, new in pairs:
            conn.execute("UPDATE file SET path=? WHERE path=?", (new, old))
            conn.execute("UPDATE validation_run SET file_path=? WHERE file_path=?", (new, old))


def _remove_empty_dirs(root: Path, paths: list[str]) -> None:
    parents = sorted({str(Path(p).parent) for p in paths if "/" in p}, key=len, reverse=True)
    for rel in parents:
        d = root / rel
        while d != root and d.is_dir() and not any(d.iterdir()):
            d.rmdir()
            d = d.parent
