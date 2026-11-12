# Copyright (c) 2026 Long Horizon Observatory
# Licensed under the Apache License, Version 2.0. See LICENSE file for details.

from pathlib import Path

from conftest import T0

from biologger_portal.validation.checks import deep, light


def _check(result_json: dict, name: str) -> dict:  # type: ignore[type-arg]
    return next(c for c in result_json["checks"] if c["name"] == name)


def test_light_detects_g_and_zone(datasets: Path) -> None:
    r = light(datasets / "WHOI.900_20250101-standard.csv").to_json()
    assert r["facts"]["accel_unit"] == "g"
    assert r["facts"]["time_format"] == "iso_with_zone"
    assert abs(r["facts"]["rate_hz_estimate"] - 25.0) < 0.01
    assert r["status"] == "passed"


def test_light_flags_naive_times_and_ms2(datasets: Path) -> None:
    r = light(datasets / "RED900_20220101-standard.csv").to_json()
    assert r["facts"]["accel_unit"] == "m/s^2"
    assert _check(r, "time zone")["status"] == "warning"


def test_deep_reports_sparse_depth_as_a_rate_not_nulls(datasets: Path) -> None:
    r = deep(datasets / "RED900_20220101-standard.csv").to_json()
    depth = r["facts"]["channels"]["depth_m"]
    assert depth["fill_fraction"] == 0.04
    assert abs(depth["rate_hz"] - 1.0) < 0.01
    assert r["facts"]["magnetometer_present"] is False
    assert _check(r, "value limits")["status"] == "passed"
    assert r["facts"]["rows"] == 2500


def test_deep_counts_gaps_and_deployment_window(datasets: Path) -> None:
    # The file spans about 90 s from T0; a recovery at T0 + 400 s is well after the data ends.
    r = deep(datasets / "WHOI.900_20250101-standard.csv", (T0 + 10.0, T0 + 400.0)).to_json()
    assert r["facts"]["gaps"] == 1 and r["facts"]["max_gap_s"] > 10
    window = r["facts"]["deployment_window"]
    assert window["pre_release_s"] == 10.0
    assert _check(r, "deployment window")["status"] == "warning"  # the file ends before recovery
    assert r["thresholds"]["gap_factor"] == 2.0


def test_missing_required_column_fails(tmp_path: Path) -> None:
    path = tmp_path / "bad-standard.csv"
    path.write_text("datetime_utc,depth_m\n2025-01-01T00:00:00Z,1\n")
    r = deep(path).to_json()
    assert r["status"] == "failed"
    assert "accelX_total_raw" in _check(r, "required columns")["detail"]
