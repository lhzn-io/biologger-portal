# Copyright (c) 2026 Long Horizon Observatory
# Licensed under the Apache License, Version 2.0. See LICENSE file for details.

from pathlib import Path

from fastapi.testclient import TestClient

from biologger_portal.app import create_app
from biologger_portal.settings import Settings


def test_health_reports_datasets_root(tmp_path: Path) -> None:
    client = TestClient(create_app(Settings(datasets_root=tmp_path)))
    body = client.get("/api/health").json()
    assert body["status"] == "ok"
    assert body["datasets_root_present"] is True


def test_web_routes_fall_back_to_index(tmp_path: Path) -> None:
    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<!doctype html><title>portal</title>")
    (dist / "assets" / "app.js").write_text("console.log(1)")
    client = TestClient(create_app(Settings(datasets_root=tmp_path, web_dist=dist)))

    assert client.get("/assets/app.js").text == "console.log(1)"
    assert "portal" in client.get("/deployments/WHOI.001_20250827").text
    assert client.get("/api/missing").status_code == 404


def test_web_does_not_serve_outside_dist(tmp_path: Path) -> None:
    dist = tmp_path / "dist"
    dist.mkdir()
    (dist / "index.html").write_text("index")
    (tmp_path / "secret.txt").write_text("secret")
    client = TestClient(create_app(Settings(datasets_root=tmp_path, web_dist=dist)))
    assert client.get("/../secret.txt").text != "secret"
