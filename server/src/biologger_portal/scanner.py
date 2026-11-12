# Copyright (c) 2026 Long Horizon Observatory
# Licensed under the Apache License, Version 2.0. See LICENSE file for details.

"""Indexes the datasets folder: what each file is, which deployment it belongs to, and its hash.

Files are indexed where they are. A file's deployment comes from the alias table: first the
top-level folder it sits in (``WHOI.001_20250827/``, ``porbeagle-ir/``), then its name with the
product suffix removed (``WHOI.001_20250827-standard.csv``). Hashes are recomputed only when a
file's size or mtime changed, so a 27 GB video folder is read once, not on every scan.
"""

import hashlib
import json
import os
import re
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .db import Catalog, dumps, loads, utcnow

# Product kinds named in datasets/README.md, in pipeline order, and the suffix each file carries.
PRODUCT_SUFFIXES: tuple[tuple[str, str], ...] = (
    ("standard_rot_sep", "-standard-rot-sep.csv"),
    ("standard", "-standard.csv"),
    ("accel_rotate", "-accelRotate.csv"),
    ("mag_heading", "-magHeading.csv"),
)
PRODUCT_KINDS = ("standard", "accel_rotate", "standard_rot_sep", "mag_heading")

# Columns of the file grid, in order.
MATRIX_KINDS = (*PRODUCT_KINDS, "raw", "video", "track", "cache")

RAW_EXTENSIONS = {".csv", ".wch", ".bin", ".ubx", ".cfg", ".txt", ".dat", ".hex", ".ncl"}
VIDEO_EXTENSIONS = {".mov", ".mp4", ".avi", ".mkv"}
SHEET_NAMES = {"biologger metadata-xgladius.csv", "biologger_meta.csv"}
IGNORED_SUFFIXES = (":zone.identifier", ".bak", ".tmp", ".part")
IGNORED_DIRS = {".portal", ".git", "__pycache__"}
REGISTRY_NAMES = {"datasets_registry.json", "validation_registry.json"}

TIMESTAMP_RE = re.compile(r"^\"?(\d{4}-\d{2}-\d{2}[T ][0-9:.]+(?:Z|[+-]\d{2}:?\d{2})?)\"?")


@dataclass
class ScanReport:
    added: int = 0
    updated: int = 0
    unchanged: int = 0
    missing: int = 0
    hashed_bytes: int = 0
    tracks: int = 0
    unattributed: list[str] = field(default_factory=list)


def classify(rel: str) -> str | None:
    """The kind of a file from its path relative to the datasets root, or None to skip it."""
    name = rel.rsplit("/", 1)[-1]
    lower = name.lower()
    if lower.startswith(".") or lower.endswith(IGNORED_SUFFIXES) or lower in REGISTRY_NAMES:
        return None
    parts = rel.split("/")
    if len(parts) >= 3 and "tracks" in parts[:-1] and lower.startswith("track."):
        return "track"
    if lower in SHEET_NAMES:
        return "metadata_sheet"
    if lower == "readme.md":
        return "doc"
    for kind, suffix in PRODUCT_SUFFIXES:
        if lower.endswith(suffix.lower()):
            return kind
    ext = os.path.splitext(lower)[1]
    if ext == ".feather":
        return "cache"
    if ext in VIDEO_EXTENSIONS:
        return "video"
    if ext in RAW_EXTENSIONS:
        return "raw"
    return "other"


def deployment_key_candidates(rel: str) -> list[str]:
    """Names to look up in the alias table, most specific first."""
    parts = rel.split("/")
    name = parts[-1]
    candidates = []
    if len(parts) > 1:
        candidates.append(parts[0])
    stem = name
    for _, suffix in PRODUCT_SUFFIXES:
        if stem.lower().endswith(suffix.lower()):
            stem = stem[: -len(suffix)]
            break
    else:
        stem = os.path.splitext(stem)[0]
    candidates.append(stem)
    return candidates


def file_info(path: Path, kind: str) -> dict[str, Any]:
    """Cheap facts about a file: for tabular products, the header and first and last timestamps."""
    if kind not in PRODUCT_KINDS:
        return {}
    info: dict[str, Any] = {}
    with path.open("rb") as fh:
        header = fh.readline().decode("utf-8-sig", "replace").strip()
        first = fh.readline().decode("utf-8", "replace")
        info["columns"] = [c.strip().strip('"') for c in header.split(",")]
        size = path.stat().st_size
        fh.seek(max(0, size - 65536))
        tail = fh.read().decode("utf-8", "replace").splitlines()
    last = next((line for line in reversed(tail) if line.strip()), "")
    for key, line in (("first_time", first), ("last_time", last)):
        match = TIMESTAMP_RE.match(line.strip())
        if match:
            info[key] = match.group(1)
    return info


def sha256_of(path: Path, progress: Callable[[int], None] | None = None) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        while chunk := fh.read(8 * 1024 * 1024):
            digest.update(chunk)
            if progress:
                progress(len(chunk))
    return digest.hexdigest()


def scan(catalog: Catalog, root: Path, *, hash_files: bool = True) -> ScanReport:
    report = ScanReport()
    aliases = {r["alias"]: r["deployment_id"] for r in catalog.query("SELECT * FROM deployment_alias")}
    known = {r["path"]: r for r in catalog.query("SELECT * FROM file")}
    now = utcnow()
    seen: set[str] = set()

    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = sorted(d for d in dirnames if d not in IGNORED_DIRS and not d.startswith("."))
        for name in sorted(filenames):
            abs_path = Path(dirpath) / name
            rel = abs_path.relative_to(root).as_posix()
            kind = classify(rel)
            if kind is None:
                continue
            seen.add(rel)
            stat = abs_path.stat()
            dep = next(
                (aliases[c.lower()] for c in deployment_key_candidates(rel) if c.lower() in aliases), None
            )
            if dep is None and kind not in ("metadata_sheet", "doc"):
                report.unattributed.append(rel)
            prev = known.get(rel)
            changed = (
                prev is None or prev["size"] != stat.st_size or abs(prev["mtime"] - stat.st_mtime) > 1e-3
            )
            sha = None if changed else prev["sha256"] if prev else None
            if hash_files and sha is None:
                sha = sha256_of(abs_path)
                report.hashed_bytes += stat.st_size
            info = file_info(abs_path, kind) if changed else loads(prev["info"]) if prev else {}
            with catalog.tx() as conn:
                conn.execute(
                    """INSERT INTO file (path, deployment_id, kind, size, mtime, sha256, info, missing, seen_utc)
                       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)
                       ON CONFLICT(path) DO UPDATE SET deployment_id=excluded.deployment_id, kind=excluded.kind,
                       size=excluded.size, mtime=excluded.mtime, sha256=excluded.sha256, info=excluded.info,
                       missing=0, seen_utc=excluded.seen_utc""",
                    (rel, dep, kind, stat.st_size, stat.st_mtime, sha, dumps(info), now),
                )
            if prev is None:
                report.added += 1
            elif changed or (prev["missing"]):
                report.updated += 1
            else:
                report.unchanged += 1
            if kind == "track" and name == "track.json" and dep is not None:
                _index_track(catalog, abs_path, rel, dep, now)
                report.tracks += 1

    gone = [p for p, r in known.items() if p not in seen and not r["missing"]]
    if gone:
        with catalog.tx() as conn:
            conn.executemany("UPDATE file SET missing=1 WHERE path=?", [(p,) for p in gone])
            conn.executemany("DELETE FROM track WHERE path=?", [(p.rsplit("/", 1)[0],) for p in gone])
    report.missing = len(gone)
    return report


def _index_track(catalog: Catalog, manifest_path: Path, rel: str, dep: str, now: str) -> None:
    try:
        meta = json.loads(manifest_path.read_text())
    except (OSError, ValueError):
        return
    if meta.get("schema") != "track-bundle-v1":
        return
    prov = meta.get("provenance", {})
    folder = rel.rsplit("/", 1)[0]
    with catalog.tx() as conn:
        conn.execute(
            """INSERT INTO track (deployment_id, run_id, path, track_model, sim_git_commit, sim_git_dirty,
               rate_hz, count, t0, duration_s, bounds, seen_utc)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(deployment_id, run_id) DO UPDATE SET path=excluded.path,
               track_model=excluded.track_model, sim_git_commit=excluded.sim_git_commit,
               sim_git_dirty=excluded.sim_git_dirty, rate_hz=excluded.rate_hz, count=excluded.count,
               t0=excluded.t0, duration_s=excluded.duration_s, bounds=excluded.bounds, seen_utc=excluded.seen_utc""",
            (
                dep,
                meta.get("run_id") or folder.rsplit("/", 1)[-1],
                folder,
                meta.get("track_model_used", ""),
                prov.get("sim_git_commit", ""),
                1 if prov.get("sim_git_dirty") else 0,
                meta.get("rate_hz"),
                meta.get("count"),
                meta.get("t0"),
                meta.get("duration_s"),
                dumps(meta.get("bounds", {})),
                now,
            ),
        )
