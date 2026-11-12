# Copyright (c) 2026 Long Horizon Observatory
# Licensed under the Apache License, Version 2.0. See LICENSE file for details.

"""Chunked, resumable uploads into a deployment's folder.

Cloudflare caps proxied request bodies at 100 MB, so a file goes up in parts of at most
``upload_part_bytes`` (64 MiB): create the upload, PUT each part, then complete it. Parts are kept in
``.portal/uploads/<id>/`` until completion, which assembles them, checks the size (and the SHA-256
when the client sends one), and moves the file to ``<deployment>/<folder>/<name>``. Existing files are
never overwritten. Files of several GB are better copied with rsync and registered by a scan.
"""

import hashlib
import json
import re
import secrets
import shutil
from pathlib import Path
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from ..auth import User, require_editor
from ..db import utcnow
from ..scanner import PRODUCT_KINDS, classify, scan

router = APIRouter(prefix="/api/uploads", tags=["uploads"])
Editor = Annotated[User, Depends(require_editor)]

SAFE_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._ ()+-]{0,200}$")

# Where each kind lands in the per-deployment layout.
KIND_FOLDERS = {"standard": "standard", "video": "media", "track": "tracks", "cache": "derived"}
for _kind in PRODUCT_KINDS:
    KIND_FOLDERS.setdefault(_kind, "derived")


def target_folder(kind: str) -> str:
    return KIND_FOLDERS.get(kind, "raw")


class UploadCreate(BaseModel):
    deployment_id: str
    filename: str
    size: int = Field(gt=0)
    sha256: str | None = None


def _dir(request: Request, upload_id: str) -> Path:
    if not re.fullmatch(r"[a-f0-9]{32}", upload_id):
        raise HTTPException(status_code=404)
    path: Path = request.app.state.settings.portal_dir / "uploads" / upload_id
    if not path.is_dir():
        raise HTTPException(status_code=404, detail="no such upload")
    return path


def _state(path: Path) -> dict[str, Any]:
    return json.loads((path / "upload.json").read_text())  # type: ignore[no-any-return]


@router.post("", status_code=201)
def create_upload(body: UploadCreate, request: Request, user: Editor) -> dict[str, Any]:
    settings = request.app.state.settings
    if not SAFE_NAME.fullmatch(body.filename):
        raise HTTPException(
            status_code=422, detail="file name has characters the datasets folder does not allow"
        )
    if request.app.state.catalog.one("SELECT 1 FROM deployment WHERE id=?", (body.deployment_id,)) is None:
        raise HTTPException(status_code=404, detail=f"no deployment {body.deployment_id}")
    kind = classify(f"{body.deployment_id}/x/{body.filename}") or "other"
    rel = f"{body.deployment_id}/{target_folder(kind)}/{body.filename}"
    if (settings.datasets_root / rel).exists():
        raise HTTPException(status_code=409, detail=f"{rel} already exists")
    upload_id = secrets.token_hex(16)
    path = settings.portal_dir / "uploads" / upload_id
    path.mkdir(parents=True)
    part = settings.upload_part_bytes
    state = {
        "id": upload_id,
        "deployment_id": body.deployment_id,
        "filename": body.filename,
        "size": body.size,
        "sha256": body.sha256,
        "kind": kind,
        "target": rel,
        "part_bytes": part,
        "parts": -(-body.size // part),
        "created_utc": utcnow(),
        "created_by": user.email,
    }
    (path / "upload.json").write_text(json.dumps(state))
    return {**state, "received": []}


@router.get("/{upload_id}")
def get_upload(upload_id: str, request: Request, _: Editor) -> dict[str, Any]:
    path = _dir(request, upload_id)
    received = sorted(int(p.stem) for p in path.glob("*.part"))
    return {**_state(path), "received": received}


@router.put("/{upload_id}/parts/{index}")
async def put_part(upload_id: str, index: int, request: Request, _: Editor) -> dict[str, Any]:
    path = _dir(request, upload_id)
    state = _state(path)
    if not 0 <= index < state["parts"]:
        raise HTTPException(status_code=422, detail=f"part index must be 0 to {state['parts'] - 1}")
    expected = min(state["part_bytes"], state["size"] - index * state["part_bytes"])
    tmp = path / f"{index}.tmp"
    written = 0
    with tmp.open("wb") as fh:
        async for chunk in request.stream():
            written += len(chunk)
            if written > expected:
                fh.close()
                tmp.unlink()
                raise HTTPException(status_code=413, detail=f"part {index} is larger than {expected} bytes")
            fh.write(chunk)
    if written != expected:
        tmp.unlink()
        raise HTTPException(status_code=422, detail=f"part {index} has {written} bytes, expected {expected}")
    tmp.rename(path / f"{index}.part")
    return {"index": index, "bytes": written}


@router.post("/{upload_id}/complete")
def complete_upload(upload_id: str, request: Request, user: Editor) -> dict[str, Any]:
    settings = request.app.state.settings
    path = _dir(request, upload_id)
    state = _state(path)
    missing = [i for i in range(state["parts"]) if not (path / f"{i}.part").is_file()]
    if missing:
        raise HTTPException(status_code=409, detail=f"parts not received: {missing[:20]}")
    target = settings.datasets_root / state["target"]
    if target.exists():
        raise HTTPException(status_code=409, detail=f"{state['target']} already exists")
    assembled = path / "assembled"
    digest = hashlib.sha256()
    with assembled.open("wb") as out:
        for i in range(state["parts"]):
            with (path / f"{i}.part").open("rb") as part:
                while chunk := part.read(8 * 1024 * 1024):
                    digest.update(chunk)
                    out.write(chunk)
    if assembled.stat().st_size != state["size"]:
        raise HTTPException(status_code=422, detail="assembled size does not match the declared size")
    sha = digest.hexdigest()
    if state.get("sha256") and state["sha256"].lower() != sha:
        raise HTTPException(status_code=422, detail="SHA-256 does not match; the upload was kept for retry")
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.move(assembled, target)
    shutil.rmtree(path)

    catalog = request.app.state.catalog
    scan(catalog, settings.datasets_root, hash_files=False)
    with catalog.tx() as conn:
        conn.execute("UPDATE file SET sha256=? WHERE path=?", (sha, state["target"]))
    row = catalog.one("SELECT id FROM file WHERE path=?", (state["target"],))
    result: dict[str, Any] = {"path": state["target"], "sha256": sha, "file_id": row["id"] if row else None}
    if row and state["kind"] == "standard":
        result["validation_run"] = request.app.state.jobs.request_validation(row["id"], "light", user.email)
    return result
