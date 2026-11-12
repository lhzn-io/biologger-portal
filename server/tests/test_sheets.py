# Copyright (c) 2026 Long Horizon Observatory
# Licensed under the Apache License, Version 2.0. See LICENSE file for details.

import csv
import io

from fastapi.testclient import TestClient

SHEET = (
    "deployment_id,species,location_name,notes\n"
    "RED900_20220101,Xiphias gladius,Shelf Canyons,new note\n"
    "WHOI.950_20260101,Xiphias gladius,Shelf Canyons,\n"
)


def test_preview_lists_changes_and_files_without_writing(client: TestClient) -> None:
    rows = {r["deployment_id"]: r for r in client.post("/api/sheets/preview", json={"text": SHEET}).json()}
    red = rows["RED900_20220101"]
    assert red["new"] is False and red["files_on_disk"] == 1
    assert {"field": "notes", "old": "legacy note", "new": "new note"} in red["changes"]
    assert rows["WHOI.950_20260101"]["new"] is True and rows["WHOI.950_20260101"]["files_on_disk"] == 0
    assert client.get("/api/deployments/WHOI.950_20260101").status_code == 404


def test_apply_takes_only_selected_rows(client: TestClient) -> None:
    r = client.post("/api/sheets/apply", json={"text": SHEET, "take": ["RED900_20220101"]}).json()
    assert r["applied"] == ["RED900_20220101"]
    assert client.get("/api/deployments/RED900_20220101").json()["fields"]["notes"] == "new note"
    assert client.get("/api/deployments/WHOI.950_20260101").status_code == 404


def test_export_round_trips(client: TestClient) -> None:
    text = client.get("/api/sheets/export.csv").text
    rows = list(csv.DictReader(io.StringIO(text)))
    assert {r["deployment_id"] for r in rows} >= {"RED900_20220101", "WHOI.900_20250101"}
    assert client.post("/api/sheets/preview", json={"text": "a,b\n1,2\n"}).status_code == 422
