# Copyright (c) 2026 Long Horizon Observatory
# Licensed under the Apache License, Version 2.0. See LICENSE file for details.

import time
from typing import Any

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient

from biologger_portal import auth
from biologger_portal.app import create_app
from biologger_portal.settings import Settings
from biologger_portal.sim_jobs import cancel, claim

TEAM = "https://t.cloudflareaccess.com"
DEP = "WHOI.900_20250101"
KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)


class _Key:
    key = KEY.public_key()


class _Jwks:
    def get_signing_key_from_jwt(self, token: str) -> _Key:
        return _Key()


def token(**claims: Any) -> dict[str, str]:
    body = {"aud": "aud", "iss": TEAM, "exp": int(time.time()) + 300, **claims}
    return {"Cf-Access-Jwt-Assertion": jwt.encode(body, KEY, algorithm="RS256")}


SCRIPT = token(common_name="0123abcd.access", type="app")


@pytest.fixture
def hub(client: TestClient, settings: Settings, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    """An app with Access configured, over the catalog the client fixture imported."""
    monkeypatch.setattr(auth, "_jwks_client", lambda team_domain: _Jwks())
    app = create_app(
        Settings(
            datasets_root=settings.datasets_root,
            access_team_domain=TEAM,
            access_aud="aud",
            editors=["editor@example.org"],
            agents=["script:0123abcd.access"],
            topobathy_prefetch=False,
        )
    )
    return TestClient(app)


def test_service_tokens_are_named_agents(hub: TestClient) -> None:
    assert hub.get("/api/me", headers=SCRIPT).json()["email"] == "agent:script"
    assert hub.get("/api/me", headers=SCRIPT).json()["editor"] is True
    # A service token Access lets through but the hub does not list may not act.
    stranger = token(common_name="ffff.access", type="app")
    assert hub.get("/api/agent/status", headers=stranger).status_code == 403
    # People still sign in by email; tokens from another audience are refused.
    assert hub.get("/api/me", headers=token(email="Editor@example.org")).json()["editor"] is True
    assert hub.get("/api/me", headers=token(email="reader@example.org")).json()["editor"] is False
    assert hub.get("/api/me", headers=token(email="editor@example.org", aud="other")).status_code == 401
    # Without a token (the VPN) the agent API is closed.
    assert hub.get("/api/agent/status").status_code == 403


def test_queue_runs_and_wait_for_them(hub: TestClient) -> None:
    made = hub.post(
        "/api/agent/runs",
        json={"deployment_ids": [DEP, "RED900_20220101"], "profile": "axy-standard"},
        headers=SCRIPT,
    ).json()
    assert len(made["job_ids"]) == 1 and [s["deployment_id"] for s in made["skipped"]] == ["RED900_20220101"]
    jid = made["job_ids"][0]
    job = hub.get(f"/api/sim/jobs/{jid}", headers=SCRIPT).json()
    assert job["created_by"] == "agent:script" and job["status"] == "queued"

    started = time.monotonic()
    still = hub.get(f"/api/agent/runs/{jid}", params={"wait": 0.3}, headers=SCRIPT).json()
    assert still["status"] == "queued" and time.monotonic() - started >= 0.3

    catalog = hub.app.state.catalog  # type: ignore[attr-defined]
    assert claim(catalog, "garnet", ["cpu"]) is not None
    status = hub.get("/api/agent/status", headers=SCRIPT).json()
    assert status["queue"] == {"claimed": 1} and status["deployments"] >= 2
    assert status["runners"][0]["runner"] == "garnet" and status["runners"][0]["running_job"] == jid

    cancel(catalog, jid)
    started = time.monotonic()
    over = hub.get(f"/api/agent/runs/{jid}", params={"wait": 30}, headers=SCRIPT).json()
    assert over["status"] == "canceled" and time.monotonic() - started < 5
    assert hub.get("/api/agent/runs/9999", headers=SCRIPT).status_code == 404
