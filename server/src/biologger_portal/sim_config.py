# Copyright (c) 2026 Long Horizon Observatory
# Licensed under the Apache License, Version 2.0. See LICENSE file for details.

"""biologger-sim run configs made from a profile and a deployment's catalog record.

A profile (``configs/sim-profiles/<name>.yaml``) holds the processing choices for one kind of tag:
the biologger-sim LAB config for a single entity, with ``${...}`` placeholders for what belongs to
the deployment. ``render`` fills them in and returns the YAML a runner executes unchanged, so the
bundle's ``config_sha256`` is the hash of the text stored on the job.

A runner puts the run's files side by side and runs biologger-sim from that folder: the config,
the metadata sheet as ``meta.csv`` (``meta_csv``, the one row biologger-sim reads fixes and the
deployment window from) and the input as ``input<suffix>``. The config names them by those
relative paths.
"""

import csv
import io
import json
import re
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import yaml

META_NAME = "meta.csv"
INPUT_STEM = "input"
PROFILE_NAME = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")
# Entity keys the hub fills in; overrides may not change them.
FIXED_KEYS = ("sim_id", "tag_id", "input_file")
# biologger-sim reads time_start_utc and time_end_utc in the lab sheet's spreadsheet style only.
SHEET_TIME = "%m/%d/%y %H:%M"
_IN_FORMATS = ("%m/%d/%y %H:%M", "%m/%d/%Y %H:%M", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M")
_PLACEHOLDER = re.compile(r"^\$\{(\w+)\}$")
SIGNATURE_BYTES = 4096


class ProfileError(ValueError):
    pass


@dataclass(frozen=True)
class Profile:
    name: str
    title: str
    description: str
    tag_types: tuple[str, ...]
    accepts: tuple[str, ...]
    config: dict[str, Any]
    signature: str = ""

    def summary(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "title": self.title,
            "description": self.description,
            "tag_types": list(self.tag_types),
            "accepts": list(self.accepts),
        }

    def reads(self, path: Path) -> bool:
        """Whether the file looks like this profile's input (always, for a profile without a signature)."""
        if not self.signature:
            return True
        try:
            with path.open("rb") as fh:
                head = fh.read(SIGNATURE_BYTES).decode("utf-8", "replace")
        except OSError:
            return False
        return re.search(self.signature, head, re.MULTILINE) is not None


def load_profiles(directory: Path) -> dict[str, Profile]:
    """Every ``*.yaml`` profile in the folder, by file name; a malformed one raises ProfileError."""
    out: dict[str, Profile] = {}
    for path in sorted(directory.glob("*.yaml")) if directory.is_dir() else []:
        name = path.stem
        if not PROFILE_NAME.match(name):
            raise ProfileError(f"{path.name}: profile names are lower case letters, digits and dashes")
        doc = yaml.safe_load(path.read_text())
        if not isinstance(doc, dict) or not isinstance(doc.get("config"), dict):
            raise ProfileError(f"{path.name}: needs a config mapping")
        entities = doc["config"].get("simulation", {}).get("entities")
        if not isinstance(entities, list) or len(entities) != 1 or not isinstance(entities[0], dict):
            raise ProfileError(f"{path.name}: config.simulation.entities must hold exactly one entity")
        out[name] = Profile(
            name=name,
            title=str(doc.get("title") or name),
            description=str(doc.get("description") or ""),
            tag_types=tuple(str(t).lower() for t in doc.get("tag_types") or ()),
            accepts=tuple(str(k) for k in doc.get("accepts") or ()),
            config=doc["config"],
            signature=_signature(path, doc.get("signature")),
        )
    return out


def _signature(path: Path, value: Any) -> str:
    text = str(value or "")
    try:
        re.compile(text)
    except re.error as exc:
        raise ProfileError(f"{path.name}: signature is not a regular expression: {exc}") from exc
    return text


def suggest(profiles: dict[str, Profile], fields: dict[str, str]) -> str | None:
    """The profile whose tag types match the deployment's body logger (or TDR) type, if any."""
    for key in ("bodylogger1_type", "tdr_type", "bodylogger2_type"):
        value = (fields.get(key) or "").strip().lower()
        if not value:
            continue
        for p in profiles.values():
            if value in p.tag_types:
                return p.name
    return None


def sim_id_for(dep_id: str) -> str:
    return "dep_" + re.sub(r"[^a-z0-9]+", "_", dep_id.lower()).strip("_")


def parse_time(text: str | None) -> datetime | None:
    """A catalog time (ISO 8601, or the sheet's m/d/yy H:M) as UTC, or None."""
    value = (text or "").strip()
    if not value or value.upper() in ("NA", "TBD", "N/A"):
        return None
    try:
        t = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return t.replace(tzinfo=UTC) if t.tzinfo is None else t.astimezone(UTC)
    except ValueError:
        pass
    for fmt in _IN_FORMATS:
        try:
            return datetime.strptime(value, fmt).replace(tzinfo=UTC)
        except ValueError:
            continue
    return None


def _number(text: str | None) -> float | None:
    try:
        value = float((text or "").strip())
    except ValueError:
        return None
    return value if value == value else None


def _extra(fields: dict[str, str]) -> dict[str, str]:
    try:
        extra = json.loads(fields.get("_extra") or "{}")
    except ValueError:
        return {}
    return {str(k): str(v) for k, v in extra.items()} if isinstance(extra, dict) else {}


def has_end_fix(fields: dict[str, str]) -> bool:
    start = parse_time(fields.get("time_start_utc"))
    end = parse_time(fields.get("time_end_utc"))
    return (
        _number(fields.get("end_lat")) is not None
        and _number(fields.get("end_lon")) is not None
        and start is not None
        and end is not None
        and end > start
    )


def blockers(profile: Profile, fields: dict[str, str], input_kind: str | None) -> list[str]:
    """Why a run of this profile cannot start for the deployment; empty when it can."""
    out: list[str] = []
    start = parse_time(fields.get("time_start_utc"))
    end = parse_time(fields.get("time_end_utc"))
    if start is None:
        out.append("time_start_utc is missing or not a time")
    if end is None:
        out.append("time_end_utc is missing or not a time (it ends the deployment window)")
    if start is not None and end is not None and end <= start:
        out.append("time_end_utc is not after time_start_utc")
    if _number(fields.get("start_lat")) is None or _number(fields.get("start_lon")) is None:
        out.append("the start fix (start_lat, start_lon) is missing")
    if input_kind is None:
        out.append(f"no input file of kind {' or '.join(profile.accepts) or '(none)'}")
    elif input_kind not in profile.accepts:
        out.append(f"the input is a {input_kind} file; this profile reads {', '.join(profile.accepts)}")
    return out


def meta_row(dep_id: str, fields: dict[str, str]) -> dict[str, str]:
    """The deployment as one biologger_meta.csv row, in the formats biologger-sim parses."""

    def sheet(key: str) -> str:
        t = parse_time(fields.get(key))
        return t.strftime(SHEET_TIME) if t else ""

    extra = _extra(fields)
    fix_time = parse_time(extra.get("start_location_time"))
    return {
        "tag_id": dep_id,
        "species": fields.get("species", ""),
        "time_start_utc": sheet("time_start_utc"),
        "time_end_utc": sheet("time_end_utc"),
        "start_lat": fields.get("start_lat", ""),
        "start_lon": fields.get("start_lon", ""),
        "start_location_time": fix_time.strftime("%Y-%m-%dT%H:%M:%SZ") if fix_time else "",
        "end_lat": fields.get("end_lat", ""),
        "end_lon": fields.get("end_lon", ""),
    }


def meta_csv(dep_id: str, fields: dict[str, str]) -> str:
    row = meta_row(dep_id, fields)
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=list(row), lineterminator="\n")
    writer.writeheader()
    writer.writerow(row)
    return buf.getvalue()


def parse_overrides(text: str | None) -> dict[str, Any]:
    """The advanced box: YAML merged into the run's entity (for example ``calibration: {...}``)."""
    if not (text or "").strip():
        return {}
    try:
        doc = yaml.safe_load(text or "")
    except yaml.YAMLError as exc:
        raise ProfileError(f"overrides are not valid YAML: {exc}") from exc
    if not isinstance(doc, dict):
        raise ProfileError("overrides must be a mapping of entity settings")
    fixed = [k for k in FIXED_KEYS if k in doc]
    if fixed:
        raise ProfileError(f"overrides may not set {', '.join(fixed)}")
    return doc


def _merge(base: dict[str, Any], extra: dict[str, Any]) -> dict[str, Any]:
    out = dict(base)
    for key, value in extra.items():
        if isinstance(value, dict) and isinstance(out.get(key), dict):
            out[key] = _merge(out[key], value)
        else:
            out[key] = value
    return out


def _fill(node: Any, values: dict[str, str]) -> Any:
    if isinstance(node, dict):
        return {k: _fill(v, values) for k, v in node.items()}
    if isinstance(node, list):
        return [_fill(v, values) for v in node]
    if isinstance(node, str) and (m := _PLACEHOLDER.match(node)):
        if m.group(1) not in values:
            raise ProfileError(f"unknown placeholder {node}")
        return values[m.group(1)]
    return node


def input_name(input_path: str) -> str:
    """Where the runner stores the input beside the config: ``input`` plus the file's suffix."""
    return INPUT_STEM + "".join(Path(input_path).suffixes[-1:]).lower()


def render(
    profile: Profile,
    dep_id: str,
    fields: dict[str, str],
    input_path: str,
    overrides: dict[str, Any] | None = None,
) -> str:
    """The run's biologger-sim config as YAML text."""
    values = {
        "sim_id": sim_id_for(dep_id),
        "tag_id": dep_id,
        "input_file": input_name(input_path),
        "meta_file": META_NAME,
        "track_model": "fix_pinned" if has_end_fix(fields) else "dead_reckoning",
    }
    config = _fill(profile.config, values)
    entity = config["simulation"]["entities"][0]
    config["simulation"]["entities"][0] = _merge(entity, overrides or {})
    header = (
        f"# biologger-sim config for {dep_id}, made by biologger-portal from profile {profile.name}.\n"
        f"# Input: {input_path} (stored beside this file as {values['input_file']}).\n"
    )
    return header + str(yaml.safe_dump(config, sort_keys=False, default_flow_style=False))
