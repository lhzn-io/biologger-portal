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


def test_packed_models_are_served_at_models(tmp_path: Path) -> None:
    packed = tmp_path / "packed"
    packed.mkdir()
    (packed / "models.json").write_text('{"version": 1}')
    (packed / "swordfish.blgm").write_bytes(b"BLGM\x01")
    (packed / "notes.txt").write_text("not a model")
    (tmp_path / "secret.json").write_text("secret")
    dist = tmp_path / "dist"
    dist.mkdir()
    (dist / "index.html").write_text("index")
    client = TestClient(create_app(Settings(datasets_root=tmp_path, web_dist=dist, packed_models_dir=packed)))

    r = client.get("/models/models.json")
    assert r.json() == {"version": 1}
    assert r.headers["cache-control"] == "no-cache"
    assert client.get("/models/swordfish.blgm").content == b"BLGM\x01"
    assert client.get("/models/notes.txt").status_code == 404
    assert client.get("/models/missing.blgm").status_code == 404  # not the web app's index.html
    assert client.get("/models/..%2Fsecret.json").status_code == 404


def test_models_are_absent_without_a_packed_folder(tmp_path: Path) -> None:
    dist = tmp_path / "dist"
    dist.mkdir()
    (dist / "index.html").write_text("index")
    client = TestClient(create_app(Settings(datasets_root=tmp_path, web_dist=dist)))
    assert client.get("/models/models.json").status_code == 404


def test_docs_are_served_at_docs(tmp_path: Path) -> None:
    docs = tmp_path / "docs"
    (docs / "sim" / "_static").mkdir(parents=True)
    (docs / "sim" / "index.html").write_text("<html>sim docs</html>")
    (docs / "sim" / "_static" / "lhzn.css").write_text("body {}")
    dist = tmp_path / "dist"
    dist.mkdir()
    (dist / "index.html").write_text("<html>app</html>")
    client = TestClient(create_app(Settings(datasets_root=tmp_path, web_dist=dist, docs_dir=docs)))
    assert client.get("/docs/sim/").text == "<html>sim docs</html>"
    assert client.get("/docs/sim/_static/lhzn.css").text == "body {}"
    r = client.get("/docs/sim", follow_redirects=False)
    assert r.status_code == 308 and r.headers["location"] == "/docs/sim/"
    assert client.get("/docs/sim/missing.html").status_code == 404
    assert client.get("/docs/%2e%2e/dist/index.html").status_code == 404


def test_docs_are_absent_without_a_docs_folder(tmp_path: Path) -> None:
    dist = tmp_path / "dist"
    dist.mkdir()
    (dist / "index.html").write_text("<html>app</html>")
    client = TestClient(create_app(Settings(datasets_root=tmp_path, web_dist=dist)))
    assert client.get("/docs/sim/").status_code == 404
    assert client.get("/docs").status_code == 404
