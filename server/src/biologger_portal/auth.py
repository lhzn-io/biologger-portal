# Copyright (c) 2026 Long Horizon Observatory
# Licensed under the Apache License, Version 2.0. See LICENSE file for details.

"""Who is asking: the Cloudflare Access identity, and whether they may edit.

Editors sign in through the Cloudflare Tunnel, where Access adds a signed ``Cf-Access-Jwt-Assertion``
header. The token is verified against the Access team's public keys and the application's audience
tag; its ``email`` claim is the user, an editor if listed in ``PORTAL_EDITORS``. Scripts come through
with an Access service token instead: its JWT names the token's client ID (``common_name``) and no
email, and a client ID listed in ``PORTAL_AGENTS`` as ``name:client_id`` acts as the editor
``agent:<name>``; other service tokens are refused. A request without a token (the hub read directly
on the lab VPN) is anonymous and read-only; a token that fails verification is refused. Without Access settings (local development) the user is
``PORTAL_DEV_USER`` if set, else anonymous and read-only.
"""

from dataclasses import dataclass
from functools import lru_cache

import jwt
from fastapi import HTTPException, Request

from .settings import Settings


@dataclass(frozen=True)
class User:
    email: str
    editor: bool


@lru_cache(maxsize=4)
def _jwks_client(team_domain: str) -> jwt.PyJWKClient:
    return jwt.PyJWKClient(f"{team_domain.rstrip('/')}/cdn-cgi/access/certs", cache_keys=True, timeout=10)


def identify(request: Request) -> User:
    settings: Settings = request.app.state.settings
    editors = {e.lower() for e in settings.editors}
    if settings.access_team_domain and settings.access_aud:
        token = request.headers.get("cf-access-jwt-assertion") or request.cookies.get("CF_Authorization")
        if not token:
            return User(email="anonymous", editor=False)
        try:
            key = _jwks_client(settings.access_team_domain).get_signing_key_from_jwt(token)
            claims = jwt.decode(
                token,
                key.key,
                algorithms=["RS256"],
                audience=settings.access_aud,
                issuer=settings.access_team_domain.rstrip("/"),
            )
        except jwt.PyJWTError as exc:
            raise HTTPException(status_code=401, detail=f"Cloudflare Access token rejected: {exc}") from exc
        email = str(claims.get("email", "")).lower()
        if email:
            return User(email=email, editor=email in editors)
        client_id = str(claims.get("common_name", ""))
        if client_id:
            return _agent(settings, client_id)
        raise HTTPException(status_code=401, detail="Cloudflare Access token has no email or service token")
    if settings.dev_user:
        return User(email=settings.dev_user, editor=True)
    return User(email="anonymous", editor=False)


def _agent(settings: Settings, client_id: str) -> User:
    """The agent a service token's client ID is listed as, or 403."""
    for entry in settings.agents:
        name, _, listed = entry.partition(":")
        if name.strip() and listed.strip() == client_id:
            return User(email=f"agent:{name.strip()}", editor=True)
    raise HTTPException(status_code=403, detail="this Access service token is not one of the hub's agents")


def require_user(request: Request) -> User:
    return identify(request)


def require_editor(request: Request) -> User:
    user = identify(request)
    if not user.editor:
        raise HTTPException(status_code=403, detail=f"{user.email} may read but not edit")
    return user
