# Copyright (c) 2026 Long Horizon Observatory
# Licensed under the Apache License, Version 2.0. See LICENSE file for details.

"""Metadata sheet round trip: preview a CSV against the catalog, apply it, or export the catalog.

The preview lists, per deployment, whether it is new and which fields would change, and whether the
deployment has files on disk (the prototype's "colocation check"). Nothing is written until the
same text is posted to ``/apply`` with the deployments to take.
"""

import csv
import io
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel

from ..auth import User, require_editor, require_user
from ..db import loads
from ..metadata import CANONICAL_FIELDS, parse_sheet_text, upsert_deployment

router = APIRouter(prefix="/api/sheets", tags=["sheets"])
Reader = Annotated[User, Depends(require_user)]
Editor = Annotated[User, Depends(require_editor)]


class SheetText(BaseModel):
    text: str
    take: list[str] | None = None  # deployment ids to apply; None applies every row


def _preview(request: Request, text: str) -> list[dict[str, Any]]:
    try:
        records = parse_sheet_text(text)
    except csv.Error as exc:
        raise HTTPException(status_code=422, detail=f"not a readable CSV: {exc}") from exc
    if not records:
        raise HTTPException(status_code=422, detail="no rows with a deployment_id or tag_id column")
    cat = request.app.state.catalog
    out = []
    for rec in records:
        dep_id = rec["deployment_id"]
        row = cat.one("SELECT fields FROM deployment WHERE id=?", (dep_id,))
        current: dict[str, str] = loads(row["fields"]) if row else {}
        changes = [
            {"field": k, "old": current.get(k, ""), "new": v}
            for k, v in rec.items()
            if k in CANONICAL_FIELDS and k != "deployment_id" and v != current.get(k, "")
        ]
        files = cat.one(
            "SELECT COUNT(*) AS n FROM file WHERE missing=0 AND (deployment_id=? OR "
            "deployment_id IN (SELECT deployment_id FROM deployment_alias WHERE alias=?))",
            (dep_id, dep_id.lower()),
        )
        out.append(
            {
                "deployment_id": dep_id,
                "new": row is None,
                "changes": changes,
                "files_on_disk": files["n"] if files else 0,
            }
        )
    return out


@router.post("/preview")
def preview(body: SheetText, request: Request, _: Editor) -> list[dict[str, Any]]:
    return _preview(request, body.text)


@router.post("/apply")
def apply(body: SheetText, request: Request, user: Editor) -> dict[str, Any]:
    records = parse_sheet_text(body.text)
    take = set(body.take) if body.take is not None else None
    applied = []
    for rec in records:
        if take is not None and rec["deployment_id"] not in take:
            continue
        fields = {k: v for k, v in rec.items() if k in CANONICAL_FIELDS}
        upsert_deployment(request.app.state.catalog, fields, source="sheet upload", actor=user.email)
        applied.append(rec["deployment_id"])
    return {"applied": applied}


@router.get("/export.csv")
def export(request: Request, _: Reader) -> Response:
    """The catalog as a sheet with the canonical columns, one row per deployment."""
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=list(CANONICAL_FIELDS), extrasaction="ignore")
    writer.writeheader()
    for row in request.app.state.catalog.query("SELECT id, fields FROM deployment ORDER BY id"):
        fields = loads(row["fields"])
        writer.writerow({**fields, "deployment_id": row["id"]})
    return Response(
        buf.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="biologger-deployments.csv"'},
    )
