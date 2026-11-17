# Copyright (c) 2026 Long Horizon Observatory
# Licensed under the Apache License, Version 2.0. See LICENSE file for details.

import csv
import io
from pathlib import Path

import pytest
import yaml
from biologger_sim.core.georef import georeference_from_row
from biologger_sim.io.data_loader import load_metadata
from fastapi.testclient import TestClient

from biologger_portal.app import create_app
from biologger_portal.settings import Settings
from biologger_portal.sim_config import (
    ProfileError,
    blockers,
    load_profiles,
    meta_csv,
    parse_overrides,
    render,
    suggest,
)

PROFILES = load_profiles(Settings().sim_profiles_dir)

FIELDS = {
    "species": "Xiphias gladius",
    "bodylogger1_type": "big Axy",
    "time_start_utc": "2025-08-27T23:33:00Z",
    "time_end_utc": "8/29/25 19:24",
    "start_lat": "10.5",
    "start_lon": "-20.25",
    "end_lat": "10.0",
    "end_lon": "-20.0",
    "_extra": '{"start_location_time": "2025-08-27T23:30:07Z"}',
}


def entity(text: str) -> dict:
    return yaml.safe_load(text)["simulation"]["entities"][0]  # type: ignore[no-any-return]


def test_profiles_recognize_their_input(tmp_path: Path) -> None:
    wc = tmp_path / "a.csv"
    wc.write_text("; SN 19A0000\n; Mk10 HW 10.5 SW 1.26.w\nTime,Depth\n")
    axy = tmp_path / "b.csv"
    axy.write_text("TagID\tDate\tTime\taccX\n")
    std = tmp_path / "c-standard.csv"
    std.write_text("datetime_utc,depth_m,accelX_total_raw\n")
    assert PROFILES["mk10-negated"].reads(wc)
    assert not PROFILES["mk10-negated"].reads(axy)
    assert PROFILES["axy-standard"].reads(std)
    assert not PROFILES["axy-standard"].reads(tmp_path / "missing.csv")


def test_profiles_load_and_match_tag_types() -> None:
    assert {"axy-standard", "mk10-negated"} <= set(PROFILES)
    assert PROFILES["axy-standard"].accepts == ("standard",)
    assert suggest(PROFILES, FIELDS) == "axy-standard"
    assert suggest(PROFILES, {"bodylogger1_type": "TDR10"}) == "mk10-negated"
    assert suggest(PROFILES, {"bodylogger1_type": "camera"}) is None


def test_render_fills_the_deployment_in() -> None:
    text = render(PROFILES["axy-standard"], "WHOI.001_20250827", FIELDS, "WHOI.001_20250827/a-standard.CSV")
    e = entity(text)
    assert e["sim_id"] == "dep_whoi_001_20250827"
    assert e["tag_id"] == "WHOI.001_20250827"
    assert e["input_file"] == "input.csv"
    assert e["dead_reckoning"]["track_model"] == "fix_pinned"
    assert yaml.safe_load(text)["simulation"]["meta_file"] == "meta.csv"
    assert "${" not in text
    # Same inputs, same text: the bundle's config hash can be checked against the job.
    assert text == render(
        PROFILES["axy-standard"], "WHOI.001_20250827", FIELDS, "WHOI.001_20250827/a-standard.CSV"
    )


def test_render_without_end_fix_dead_reckons_and_merges_overrides() -> None:
    fields = {k: v for k, v in FIELDS.items() if k not in ("end_lat", "end_lon")}
    over = parse_overrides("calibration:\n  sensor_signs: negated\nsampling_rate_hz: 16\n")
    e = entity(render(PROFILES["axy-standard"], "X_1", fields, "X_1/x-standard.csv", over))
    assert e["dead_reckoning"]["track_model"] == "dead_reckoning"
    assert e["calibration"]["sensor_signs"] == "negated"
    assert e["calibration"]["accel_depth_bias"] is True  # the rest of the mapping is kept
    assert e["sampling_rate_hz"] == 16


def test_overrides_are_checked() -> None:
    assert parse_overrides("") == {}
    with pytest.raises(ProfileError):
        parse_overrides("- a list")
    with pytest.raises(ProfileError):
        parse_overrides("input_file: /etc/passwd")
    with pytest.raises(ProfileError):
        parse_overrides("calibration: [unclosed")


def test_blockers() -> None:
    p = PROFILES["axy-standard"]
    assert blockers(p, FIELDS, "standard") == []
    missing = blockers(p, {"start_lat": "1"}, None)
    assert any("time_start_utc" in b for b in missing)
    assert any("time_end_utc" in b for b in missing)
    assert any("start fix" in b for b in missing)
    assert any("no input file" in b for b in missing)
    assert any("raw file" in b for b in blockers(p, FIELDS, "raw"))
    backwards = {**FIELDS, "time_end_utc": "8/27/25 20:00"}
    assert any("not after" in b for b in blockers(p, backwards, "standard"))


def test_meta_csv_reads_back_in_biologger_sim(tmp_path: Path) -> None:
    path = tmp_path / "meta.csv"
    path.write_text(meta_csv("WHOI.001_20250827", FIELDS))
    meta = load_metadata(path, "WHOI.001_20250827")
    assert meta["time_start_utc"].isoformat() == "2025-08-27T23:33:00+00:00"
    assert meta["time_end_utc"].isoformat() == "2025-08-29T19:24:00+00:00"
    row = next(csv.DictReader(io.StringIO(path.read_text())))
    georef = georeference_from_row(row)
    assert georef is not None and georef.end is not None
    assert georef.start.t == pytest.approx(1756337407.0)  # the start fix's own time, to the second


def test_preview_route(client: TestClient, settings: Settings) -> None:
    r = client.post(
        "/api/sim/preview", json={"deployment_id": "WHOI.900_20250101", "profile": "axy-standard"}
    )
    assert r.status_code == 200
    body = r.json()
    assert body["input_path"].endswith("-standard.csv")
    assert body["inputs"][0]["recognized"] is True
    assert body["blockers"] == []
    assert entity(body["config_yaml"])["tag_id"] == "WHOI.900_20250101"
    assert body["meta_csv"].startswith("tag_id,")

    no_end = client.post(
        "/api/sim/preview", json={"deployment_id": "RED900_20220101", "profile": "axy-standard"}
    )
    assert any("time_end_utc" in b for b in no_end.json()["blockers"])
    assert client.post("/api/sim/preview", json={"deployment_id": "nope"}).status_code == 404
    bad = {"deployment_id": "WHOI.900_20250101", "profile": "axy-standard", "overrides": "tag_id: x"}
    assert client.post("/api/sim/preview", json=bad).status_code == 422
    assert [p["name"] for p in client.get("/api/sim/profiles").json()] == sorted(PROFILES)

    anon = TestClient(create_app(Settings(datasets_root=settings.datasets_root)))
    assert anon.get("/api/sim/profiles").status_code == 403
