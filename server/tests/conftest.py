# Copyright (c) 2026 Long Horizon Observatory
# Licensed under the Apache License, Version 2.0. See LICENSE file for details.

"""A small datasets folder with the same shapes as the lab's: two sheets, standard exports in g and
in m/s^2 (one with a sparse depth channel and naive timestamps), a vendor folder, a track bundle and
the prototype's validation registry."""

import csv
import json
from collections.abc import Iterator
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient

from biologger_portal.app import create_app
from biologger_portal.metadata import CANONICAL_FIELDS
from biologger_portal.settings import Settings

T0 = 1735693200.0  # 2025-01-01T01:00:00Z


def _iso(t: float, zone: bool) -> str:
    text = np.datetime_as_string(np.datetime64(round(t * 1000), "ms"), unit="ms")
    return text + "Z" if zone else text.replace("T", " ")


def write_standard(
    path: Path,
    *,
    rows: int,
    rate: float,
    unit: str,
    zone: bool,
    depth_every: int = 1,
    gap_at: int | None = None,
    mag: bool = True,
) -> None:
    g = 1.0 if unit == "g" else 9.80665
    cols = [
        "datetime_utc",
        "depth_m",
        "temperature_c",
        "accelX_total_raw",
        "accelY_total_raw",
        "accelZ_total_raw",
    ]
    if mag:
        cols += ["magX_raw", "magY_raw", "magZ_raw"]
    with path.open("w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(cols)
        t = T0
        for i in range(rows):
            if gap_at is not None and i == gap_at:
                t += 10.0
            depth = f"{10 + i * 0.01:.3f}" if i % depth_every == 0 else ""
            row = [_iso(t, zone), depth, "20.5", f"{0.05 * g:.4f}", f"{-0.1 * g:.4f}", f"{0.99 * g:.4f}"]
            if mag:
                row += ["-30", "600", "-390"]
            w.writerow(row)
            t += 1.0 / rate


def write_sheets(root: Path) -> None:
    primary = [
        {
            "deployment_id": "WHOI.900_20250101",
            "species": "Xiphias gladius",
            "common_name": "swordfish",
            "location_name": "Shelf Canyons",
            "time_start_utc": "1/1/25 01:00",
            "start_lat": "35.51",
            "start_lon": "-45.51",
            "time_end_utc": "1/1/25 01:01",
            "end_lat": "35.48",
            "end_lon": "-45.59",
            "deployment_team": "A. Person",
            "current_link": "https://drive.example/folder",
        },
        {
            "deployment_id": "RED900_20220101",
            "species": "Xiphias gladius",
            "location_name": "Shelf Canyons",
            "time_start_utc": "1/1/25 01:00",
            "start_lat": "35.53",
            "start_lon": "-45.69",
        },
    ]
    with (root / "Biologger Metadata-Xgladius.csv").open("w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(CANONICAL_FIELDS))
        w.writeheader()
        for r in primary:
            w.writerow(r)
    legacy_cols = [
        "time_start_utc",
        "species",
        "sex",
        "start_lat",
        "start_lon",
        "tag_id",
        "spot_ptt",
        "tag_type",
        "time_end_utc",
        "end_lat",
        "end_lon",
        "notes",
        "",
        "attachment type",
    ]
    with (root / "biologger_meta.csv").open("w", newline="") as fh:
        lw = csv.writer(fh)
        lw.writerow(legacy_cols)
        lw.writerow(
            [
                "7/23/25 19:10",
                "Rhincodon typus",
                "unknown",
                "35.534167",
                "-46.290617",
                "19A0900_20250723",
                "TBD",
                "otz biologger",
                "7/26/25 09:24",
                "",
                "",
                "fin clamp test",
                "",
                "fin clamp",
            ]
        )
        lw.writerow(
            [
                "1/1/25 01:00",
                "Xiphias gladius",
                "unknown",
                "35.53",
                "-45.69",
                "RED900_20220101",
                "251946",
                "otz biologger",
                "",
                "",
                "",
                "legacy note",
                "",
                "intramuscular darts",
            ]
        )


def write_track(folder: Path, dep: str, run: str) -> None:
    folder.mkdir(parents=True)
    n = 4
    cols = ["t", "north_m", "east_m", "depth_m", "heading_deg", "pitch_deg", "roll_deg", "vedba"]
    data = np.zeros((len(cols), n), dtype="<f4")
    data[0] = np.arange(n)
    data[1] = [0, 1, 2, 3]
    (folder / "track.f32").write_bytes(data.tobytes())
    meta = {
        "schema": "track-bundle-v1",
        "deployment_id": dep,
        "run_id": run,
        "track_model_used": "fix_pinned",
        "provenance": {"sim_git_commit": "abc123", "sim_git_dirty": False},
        "rate_hz": 1.0,
        "count": n,
        "t0": T0,
        "duration_s": 3.0,
        "origin": {"lat": 35.51, "lon": -45.51},
        "columns": [{"name": c, "offset_bytes": i * n * 4} for i, c in enumerate(cols)],
        "bounds": {"lat": [35.51, 35.52], "lon": [-45.52, -45.51]},
    }
    (folder / "track.json").write_text(json.dumps(meta))
    (folder / "track.geojson").write_text('{"type": "Feature"}')


@pytest.fixture
def datasets(tmp_path: Path) -> Path:
    root = tmp_path / "datasets"
    root.mkdir()
    write_sheets(root)
    write_standard(
        root / "WHOI.900_20250101-standard.csv", rows=2000, rate=25.0, unit="g", zone=True, gap_at=1500
    )
    write_standard(
        root / "RED900_20220101-standard.csv",
        rows=2500,
        rate=25.0,
        unit="ms2",
        zone=False,
        depth_every=25,
        mag=False,
    )
    vendor = root / "WhaleShark-RED900_20250723_19A0900"
    vendor.mkdir()
    (vendor / "19A0900_20250723_TDR.csv").write_text("Date,Depth\n1,2\n")
    (vendor / "19A0900_20250723_TDR.csv:Zone.Identifier").write_text("x")
    (root / "stray.bin").write_bytes(b"\x00" * 10)
    write_track(root / "WHOI.900_20250101" / "tracks" / "run-1", "WHOI.900_20250101", "run-1")
    (root / "validation_registry.json").write_text(
        json.dumps(
            [
                {
                    "deployment_id": "WHOI.900_20250101",
                    "timestamp_utc": "2026-06-08T01:26:41Z",
                    "validation_mode": "deep",
                    "status": "passed",
                    "clock_drift_seconds": 0.031,
                    "notes": "fallback scan",
                },
            ]
        )
    )
    return root


@pytest.fixture
def settings(datasets: Path) -> Settings:
    return Settings(datasets_root=datasets, dev_user="tester@example.org", upload_part_bytes=1024)


@pytest.fixture
def client(settings: Settings) -> Iterator[TestClient]:
    from biologger_portal.importers import SEED_ALIASES, import_all

    SEED_ALIASES["WhaleShark-RED900_20250723_19A0900"] = "19A0900_20250723"
    app = create_app(settings)
    import_all(app.state.catalog, settings.datasets_root, actor="test")
    app.state.jobs.run_scan_now(hash_files=True)
    with TestClient(app) as c:
        yield c
    SEED_ALIASES.pop("WhaleShark-RED900_20250723_19A0900", None)
