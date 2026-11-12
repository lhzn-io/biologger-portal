# Copyright (c) 2026 Long Horizon Observatory
# Licensed under the Apache License, Version 2.0. See LICENSE file for details.

from pathlib import Path

import pytest

from biologger_portal.db import Catalog
from biologger_portal.importers import import_all
from biologger_portal.layout import LayoutError, apply, revert, write_plan
from biologger_portal.metadata import add_alias
from biologger_portal.scanner import scan


def catalog_for(root: Path) -> Catalog:
    cat = Catalog(root / ".portal" / "catalog.db")
    import_all(cat, root, actor="test")
    add_alias(cat, "WhaleShark-RED900_20250723_19A0900", "19A0900_20250723")
    scan(cat, root, hash_files=False)
    return cat


def test_plan_lists_moves_without_moving(datasets: Path) -> None:
    cat = catalog_for(datasets)
    path, p = write_plan(cat, datasets)
    moves = {m["from"]: m["to"] for m in p["moves"]}
    assert moves["RED900_20220101-standard.csv"] == "RED900_20220101/standard/RED900_20220101-standard.csv"
    assert (
        moves["WhaleShark-RED900_20250723_19A0900/19A0900_20250723_TDR.csv"]
        == "19A0900_20250723/raw/19A0900_20250723_TDR.csv"
    )
    assert moves["Biologger Metadata-Xgladius.csv"] == "_metadata/Biologger Metadata-Xgladius.csv"
    assert moves["validation_registry.json"] == "_metadata/prototype/validation_registry.json"
    assert not any(k.startswith("WHOI.900_20250101/tracks/") for k in moves)  # bundles stay
    assert p["unattributed"] == ["stray.bin"] and p["conflicts"] == []
    assert "19A0900_20250723" in p["deployment_ids_to_confirm"]
    assert (datasets / "RED900_20220101-standard.csv").is_file() and path.is_file()


def test_apply_moves_updates_catalog_and_reverts(datasets: Path) -> None:
    cat = catalog_for(datasets)
    plan_path, _ = write_plan(cat, datasets)
    record = apply(cat, datasets, plan_path)
    assert (datasets / "RED900_20220101/standard/RED900_20220101-standard.csv").is_file()
    assert not (datasets / "WhaleShark-RED900_20250723_19A0900").exists()  # emptied folder removed
    assert cat.one("SELECT 1 FROM file WHERE path='19A0900_20250723/raw/19A0900_20250723_TDR.csv'")
    # A rescan finds every file at its new path: nothing new, nothing missing.
    report = scan(cat, datasets, hash_files=False)
    assert report.added == 0 and report.missing == 0
    # Metadata sheets are still found for re-imports.
    assert import_all(cat, datasets, actor="test").sheets[0].startswith("_metadata/")

    # Two standard exports, one vendor file and its Zone.Identifier sidecar, two sheets, the prototype registry.
    assert revert(cat, datasets, record) == 7
    assert (datasets / "RED900_20220101-standard.csv").is_file()
    assert (datasets / "WhaleShark-RED900_20250723_19A0900/19A0900_20250723_TDR.csv").is_file()
    assert scan(cat, datasets, hash_files=False).missing == 0


def test_apply_refuses_a_stale_plan(datasets: Path) -> None:
    cat = catalog_for(datasets)
    plan_path, _ = write_plan(cat, datasets)
    with (datasets / "RED900_20220101-standard.csv").open("a") as fh:
        fh.write("2022-01-01 00:10:00.000,1,1,1,1,1\n")
    with pytest.raises(LayoutError, match="changed since the plan"):
        apply(cat, datasets, plan_path)
    assert (datasets / "RED900_20220101-standard.csv").is_file()  # nothing moved
