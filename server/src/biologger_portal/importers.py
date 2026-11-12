# Copyright (c) 2026 Long Horizon Observatory
# Licensed under the Apache License, Version 2.0. See LICENSE file for details.

"""One-time and repeatable imports: the metadata sheets, the prototype's JSON registries, aliases."""

import json
from dataclasses import dataclass, field
from pathlib import Path

from .db import Catalog, dumps, utcnow
from .metadata import add_alias, merge_records, read_sheet, upsert_deployment

PRIMARY_SHEET = "Biologger Metadata-Xgladius.csv"
LEGACY_SHEET = "biologger_meta.csv"
SHEET_DIRS = ("_metadata", ".")  # after and before the layout reorganization

# Folder and file names that do not match a deployment_id, mapped to the deployment they hold.
SEED_ALIASES = {
    "Swordfish-RED001_20220812_19A0564": "RED001_20220812",
    "RED001_20220812_19A0564": "RED001_20220812",
    "WhaleShark-RED001_20250723_19A0564": "19A0564_20250723",
    "porbeagle-ir": "CC-09-88",
}

# Shelf Canyons fused DEM (biologger-sim config/topobathykit/shelf_canyons.yaml, policy v1.2.0).
SHELF_CANYONS_DEM = ("112bafb5_30m", "OuterShelfandSubmarineCanyonsTopobathy.112bafb5.yaml")


@dataclass
class ImportReport:
    deployments: list[str] = field(default_factory=list)
    aliases: int = 0
    validation_records: int = 0
    sheets: list[str] = field(default_factory=list)


def find_sheet(root: Path, name: str) -> Path | None:
    for folder in SHEET_DIRS:
        path = root / folder / name
        if path.is_file():
            return path
    return None


def import_sheets(catalog: Catalog, root: Path, *, actor: str, overwrite: bool = False) -> ImportReport:
    report = ImportReport()
    primary_path = find_sheet(root, PRIMARY_SHEET)
    legacy_path = find_sheet(root, LEGACY_SHEET)
    primary = read_sheet(primary_path) if primary_path else []
    legacy = read_sheet(legacy_path) if legacy_path else []
    report.sheets = [str(p.relative_to(root)) for p in (primary_path, legacy_path) if p]
    sources = {r["deployment_id"]: PRIMARY_SHEET for r in primary}
    for r in legacy:
        sources.setdefault(r["deployment_id"], LEGACY_SHEET)
    for dep_id, fields in merge_records(primary, legacy).items():
        upsert_deployment(catalog, fields, source=sources[dep_id], actor=actor, overwrite=overwrite)
        report.deployments.append(dep_id)
    for alias, dep_id in SEED_ALIASES.items():
        if catalog.one("SELECT 1 FROM deployment WHERE id=?", (dep_id,)):
            add_alias(catalog, alias, dep_id)
            report.aliases += 1
    _default_dem(catalog)
    return report


def _default_dem(catalog: Catalog) -> None:
    """Deployments in the Shelf Canyons with no DEM yet get the Shelf Canyons fused grid."""
    with catalog.tx() as conn:
        conn.execute(
            """UPDATE deployment SET dem_dataset=?, dem_policy=?
               WHERE dem_dataset='' AND start_lat BETWEEN 34.63 AND 36.23 AND start_lon BETWEEN -47.19 AND -44.69
               AND location LIKE '%Canyon%'""",
            SHELF_CANYONS_DEM,
        )


def import_legacy_validation(catalog: Catalog, root: Path) -> int:
    """Imports the prototype's validation_registry.json once, marked unverified.

    The prototype reported clock drift from a random number and invented results when a file was
    missing, so none of these records can be trusted; they are kept only as history.
    """
    path = root / "validation_registry.json"
    if not path.is_file() or catalog.one("SELECT 1 FROM validation_run WHERE unverified=1"):
        return 0
    records = json.loads(path.read_text())
    known = {r["id"] for r in catalog.query("SELECT id FROM deployment")}
    now = utcnow()
    with catalog.tx() as conn:
        for rec in records:
            dep = rec.get("deployment_id")
            conn.execute(
                """INSERT INTO validation_run (deployment_id, mode, status, tool_version, unverified, summary,
                   results, created_utc, started_utc, finished_utc)
                   VALUES (?, ?, ?, 'prototype-v0', 1, ?, ?, ?, ?, ?)""",
                (
                    dep if dep in known else None,
                    rec.get("validation_mode", "light"),
                    rec.get("status", "failed"),
                    "Imported from the prototype; not trustworthy (synthetic drift values). "
                    + (rec.get("notes") or ""),
                    dumps(rec),
                    now,
                    rec.get("timestamp_utc"),
                    rec.get("timestamp_utc"),
                ),
            )
    return len(records)


def import_all(catalog: Catalog, root: Path, *, actor: str) -> ImportReport:
    report = import_sheets(catalog, root, actor=actor)
    report.validation_records = import_legacy_validation(catalog, root)
    return report
