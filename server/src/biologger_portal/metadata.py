# Copyright (c) 2026 Long Horizon Observatory
# Licensed under the Apache License, Version 2.0. See LICENSE file for details.

"""Deployment metadata: the canonical schema, the lab's two sheets, and writes with an audit trail.

The canonical schema is the 39-column ``Biologger Metadata-Xgladius.csv`` sheet. The older
``biologger_meta.csv`` (keyed by ``tag_id``) is mapped onto it; where both sheets describe one
deployment, the Xgladius sheet wins field by field and the older sheet fills the blanks.
Times are parsed with biologger-sim's ``parse_utc`` so the portal and the simulator agree.
"""

import csv
import io
from pathlib import Path
from typing import Any

from biologger_sim.core.georef import parse_float, parse_utc

from .db import Catalog, dumps, loads, utcnow

CANONICAL_FIELDS: tuple[str, ...] = (
    "deployment_id",
    "species",
    "common_name",
    "location_name",
    "length",
    "length_unit",
    "length_type",
    "sex",
    "time_start_utc",
    "start_lat",
    "start_lon",
    "time_end_utc",
    "time_location_utc",
    "end_lat",
    "end_lon",
    "radio_type",
    "radio_freq",
    "spot_type",
    "spot_hex",
    "spot_sn",
    "bodylogger1_type",
    "bodylogger1_id",
    "bodylogger2_type",
    "bodylogger2_id",
    "camera_type",
    "camera_id",
    "tdr_type",
    "tdr_id",
    "jawtag_type",
    "jawtag_id",
    "package_placement",
    "package_orientation",
    "attachment_method",
    "deployment_team",
    "recovery_team",
    "resulting_paper(s)",
    "short_note",
    "notes",
    "current_link",
)

# biologger_meta.csv column -> canonical field. Columns not listed keep their own name.
LEGACY_SHEET_MAP = {
    "tag_id": "deployment_id",
    "attachment type": "attachment_method",
    "orientation": "package_orientation",
    "tag_type": "bodylogger1_type",
    "spot_ptt": "spot_sn",
}

COMMON_NAMES = {
    "xiphias gladius": "swordfish",
    "rhincodon typus": "whale shark",
    "lamna nasus": "porbeagle",
}

# Fields shown to people as identities; left out of AI prompts unless the user includes them.
PERSON_FIELDS = ("deployment_team", "recovery_team")


def read_sheet(path: Path) -> list[dict[str, str]]:
    """Reads either sheet into canonical field dicts (all values as stripped text)."""
    text = path.read_text(encoding="utf-8-sig")
    return parse_sheet_text(text)


def parse_sheet_text(text: str) -> list[dict[str, str]]:
    rows = list(csv.DictReader(io.StringIO(text)))
    out: list[dict[str, str]] = []
    for row in rows:
        fields: dict[str, str] = {}
        extra: dict[str, str] = {}
        for raw_key, raw_value in row.items():
            if raw_key is None:
                continue
            key = raw_key.strip()
            value = (raw_value or "").strip() if isinstance(raw_value, str) else ""
            if not key:
                continue
            canonical = LEGACY_SHEET_MAP.get(key.lower(), key)
            if canonical in CANONICAL_FIELDS:
                fields[canonical] = value
            elif value:
                extra[key] = value
        if not fields.get("deployment_id"):
            continue
        if extra:
            fields["_extra"] = dumps(extra)
        if not fields.get("common_name"):
            fields["common_name"] = COMMON_NAMES.get(fields.get("species", "").lower(), "")
        out.append(fields)
    return out


def merge_records(
    primary: list[dict[str, str]], secondary: list[dict[str, str]]
) -> dict[str, dict[str, str]]:
    """Merges sheets by deployment_id: primary values win, secondary fills blanks."""
    merged: dict[str, dict[str, str]] = {}
    for record in secondary + primary:  # primary last, so its non-empty values overwrite
        key = record["deployment_id"]
        current = merged.setdefault(key, {})
        for field, value in record.items():
            if value or field not in current:
                current[field] = value
    return merged


def typed_columns(fields: dict[str, str]) -> dict[str, Any]:
    """The queryable columns derived from canonical fields."""
    return {
        "species": fields.get("species", ""),
        "common_name": fields.get("common_name", ""),
        "location": fields.get("location_name", ""),
        "time_start_utc": parse_utc(fields.get("time_start_utc")),
        "time_end_utc": parse_utc(fields.get("time_end_utc")),
        "start_lat": _coord(fields.get("start_lat")),
        "start_lon": _coord(fields.get("start_lon")),
        "end_lat": _coord(fields.get("end_lat")),
        "end_lon": _coord(fields.get("end_lon")),
        "drive_link": fields.get("current_link", ""),
    }


def _coord(text: str | None) -> float | None:
    value = parse_float(text)
    return None if value is None or value == 0.0 else value


def upsert_deployment(
    catalog: Catalog, fields: dict[str, str], *, source: str, actor: str, overwrite: bool = True
) -> str:
    """Creates or updates a deployment from canonical fields, auditing every changed field.

    With ``overwrite`` false, existing non-empty values are kept (used by sheet imports so that
    edits made in the portal are not reverted by re-importing an old sheet).
    """
    dep_id = fields["deployment_id"].strip()
    now = utcnow()
    with catalog.tx() as conn:
        row = conn.execute("SELECT fields FROM deployment WHERE id = ?", (dep_id,)).fetchone()
        old: dict[str, str] = loads(row["fields"]) if row else {}
        new = dict(old)
        for key, value in fields.items():
            if overwrite or not old.get(key):
                new[key] = value
        cols = typed_columns(new)
        if row is None:
            conn.execute(
                """INSERT INTO deployment (id, species, common_name, location, time_start_utc, time_end_utc,
                   start_lat, start_lon, end_lat, end_lon, drive_link, fields, source, updated_utc)
                   VALUES (:id, :species, :common_name, :location, :time_start_utc, :time_end_utc,
                   :start_lat, :start_lon, :end_lat, :end_lon, :drive_link, :fields, :source, :now)""",
                {**cols, "id": dep_id, "fields": dumps(new), "source": source, "now": now},
            )
            _audit(conn, actor, dep_id, "created", None, source, now)
        else:
            conn.execute(
                """UPDATE deployment SET species=:species, common_name=:common_name, location=:location,
                   time_start_utc=:time_start_utc, time_end_utc=:time_end_utc, start_lat=:start_lat,
                   start_lon=:start_lon, end_lat=:end_lat, end_lon=:end_lon, drive_link=:drive_link,
                   fields=:fields, updated_utc=:now WHERE id=:id""",
                {**cols, "id": dep_id, "fields": dumps(new), "now": now},
            )
            for key in sorted(set(old) | set(new)):
                if old.get(key, "") != new.get(key, ""):
                    _audit(conn, actor, dep_id, key, old.get(key), new.get(key), now)
        conn.execute(
            "INSERT OR IGNORE INTO deployment_alias (alias, deployment_id) VALUES (?, ?)",
            (dep_id.lower(), dep_id),
        )
    return dep_id


def set_dem(catalog: Catalog, dep_id: str, dataset: str, policy: str, actor: str) -> None:
    now = utcnow()
    with catalog.tx() as conn:
        row = conn.execute("SELECT dem_dataset, dem_policy FROM deployment WHERE id=?", (dep_id,)).fetchone()
        if row is None:
            raise KeyError(dep_id)
        conn.execute(
            "UPDATE deployment SET dem_dataset=?, dem_policy=?, updated_utc=? WHERE id=?",
            (dataset, policy, now, dep_id),
        )
        if row["dem_dataset"] != dataset:
            _audit(conn, actor, dep_id, "dem_dataset", row["dem_dataset"], dataset, now)
        if row["dem_policy"] != policy:
            _audit(conn, actor, dep_id, "dem_policy", row["dem_policy"], policy, now)


def add_alias(catalog: Catalog, alias: str, dep_id: str) -> None:
    with catalog.tx() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO deployment_alias (alias, deployment_id) VALUES (?, ?)",
            (alias.strip().lower(), dep_id),
        )


def resolve_alias(catalog: Catalog, name: str) -> str | None:
    row = catalog.one("SELECT deployment_id FROM deployment_alias WHERE alias = ?", (name.strip().lower(),))
    return row["deployment_id"] if row else None


def _audit(
    conn: Any, actor: str, dep_id: str, field: str, old: str | None, new: str | None, now: str
) -> None:
    conn.execute(
        """INSERT INTO audit (at_utc, actor, entity, entity_id, field, old_value, new_value)
           VALUES (?, ?, 'deployment', ?, ?, ?, ?)""",
        (now, actor, dep_id, field, old, new),
    )
