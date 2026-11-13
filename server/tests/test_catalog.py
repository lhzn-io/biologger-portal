# Copyright (c) 2026 Long Horizon Observatory
# Licensed under the Apache License, Version 2.0. See LICENSE file for details.

import shutil
from pathlib import Path

from conftest import write_track

from biologger_portal.db import Catalog, loads, utcnow
from biologger_portal.importers import import_all
from biologger_portal.scanner import classify, scan


def test_import_merges_sheets_and_flags_prototype_records(datasets: Path) -> None:
    cat = Catalog(datasets / ".portal" / "catalog.db")
    report = import_all(cat, datasets, actor="test")
    assert sorted(report.deployments) == ["19A0900_20250723", "RED900_20220101", "WHOI.900_20250101"]

    red = cat.one("SELECT * FROM deployment WHERE id='RED900_20220101'")
    assert red is not None
    fields = loads(red["fields"])
    # Primary sheet wins where it has a value; the legacy sheet fills the blanks.
    assert fields["location_name"] == "Shelf Canyons"
    assert fields["notes"] == "legacy note"
    assert fields["attachment_method"] == "intramuscular darts"
    assert red["common_name"] == "swordfish"
    assert red["time_start_utc"] == 1735693200.0

    shark = cat.one("SELECT * FROM deployment WHERE id='19A0900_20250723'")
    assert shark is not None and shark["common_name"] == "whale shark" and shark["end_lat"] is None

    runs = cat.query("SELECT * FROM validation_run")
    assert len(runs) == 1 and runs[0]["unverified"] == 1 and runs[0]["tool_version"] == "prototype-v0"
    # Importing again does not duplicate the prototype records.
    import_all(cat, datasets, actor="test")
    assert len(cat.query("SELECT * FROM validation_run")) == 1


def test_reimport_keeps_portal_edits(datasets: Path) -> None:
    from biologger_portal.metadata import upsert_deployment

    cat = Catalog(datasets / ".portal" / "catalog.db")
    import_all(cat, datasets, actor="test")
    upsert_deployment(
        cat,
        {"deployment_id": "RED900_20220101", "notes": "edited in portal"},
        source="portal",
        actor="editor@example.org",
    )
    import_all(cat, datasets, actor="test")
    red = cat.one("SELECT fields FROM deployment WHERE id='RED900_20220101'")
    assert red is not None and loads(red["fields"])["notes"] == "edited in portal"
    audit = cat.query("SELECT * FROM audit WHERE field='notes'")
    assert audit[-1]["actor"] == "editor@example.org" and audit[-1]["new_value"] == "edited in portal"


def test_classify() -> None:
    assert classify("WHOI.001_20250827-standard.csv") == "standard"
    assert classify("x/WHOI.001_20250827-standard-rot-sep.csv") == "standard_rot_sep"
    assert classify("x/WHOI.001_20250827-magHeading.csv") == "mag_heading"
    assert classify("WHOI.001_20250827-standard.feather") == "cache"
    assert classify("porbeagle-ir/test 88-20241121-001430-000-00006.mov") == "video"
    assert classify("WHOI.001_20250827/tracks/run/track.f32") == "track"
    assert classify("README.md:Zone.Identifier") is None
    assert classify("datasets_registry.json") is None


def test_scan_attributes_hashes_once_and_marks_missing(datasets: Path) -> None:
    cat = Catalog(datasets / ".portal" / "catalog.db")
    import_all(cat, datasets, actor="test")
    from biologger_portal.metadata import add_alias

    add_alias(cat, "WhaleShark-RED900_20250723_19A0900", "19A0900_20250723")
    first = scan(cat, datasets)
    files = {f["path"]: f for f in cat.query("SELECT * FROM file")}
    assert files["WHOI.900_20250101-standard.csv"]["deployment_id"] == "WHOI.900_20250101"
    assert (
        files["WhaleShark-RED900_20250723_19A0900/19A0900_20250723_TDR.csv"]["deployment_id"]
        == "19A0900_20250723"
    )
    assert files["stray.bin"]["deployment_id"] is None and "stray.bin" in first.unattributed
    assert all(f["sha256"] for f in files.values())
    info = loads(files["WHOI.900_20250101-standard.csv"]["info"])
    assert info["first_time"].endswith("Z") and "accelX_total_raw" in info["columns"]
    assert first.tracks == 1
    track = cat.one("SELECT * FROM track")
    assert track is not None and track["run_id"] == "run-1" and track["count"] == 4

    second = scan(cat, datasets)
    assert second.hashed_bytes == 0 and second.added == 0

    (datasets / "stray.bin").unlink()
    third = scan(cat, datasets)
    assert third.missing == 1
    assert cat.one("SELECT missing FROM file WHERE path='stray.bin'") == {"missing": 1}


def test_reexport_carries_the_review_to_the_new_run(datasets: Path) -> None:
    cat = Catalog(datasets / ".portal" / "catalog.db")
    import_all(cat, datasets, actor="test")
    dep = "WHOI.900_20250101"
    assert scan(cat, datasets).reviews_carried == []  # never reviewed: nothing to carry
    with cat.tx() as conn:
        conn.execute("UPDATE track SET published=1 WHERE run_id='run-1'")
        conn.execute(
            """INSERT INTO audit (at_utc, actor, entity, entity_id, field, old_value, new_value)
               VALUES (?, 'editor@example.org', 'deployment', ?, 'published_track', NULL, 'run-1')""",
            (utcnow(), dep),
        )
    tracks = datasets / dep / "tracks"
    shutil.rmtree(tracks / "run-1")
    write_track(tracks / "run-2", dep, "run-2")
    report = scan(cat, datasets)
    assert report.reviews_carried == [dep]
    assert cat.query("SELECT run_id, published FROM track") == [{"run_id": "run-2", "published": 1}]
    audit = cat.one(
        "SELECT actor, old_value, new_value FROM audit WHERE field='published_track' ORDER BY id DESC"
    )
    assert audit == {"actor": "scan", "old_value": "run-1", "new_value": "run-2"}
    assert scan(cat, datasets).reviews_carried == []  # settled
