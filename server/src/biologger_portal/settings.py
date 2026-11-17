# Copyright (c) 2026 Long Horizon Observatory
# Licensed under the Apache License, Version 2.0. See LICENSE file for details.

"""Runtime settings, read from ``PORTAL_*`` environment variables."""

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="PORTAL_", env_file=".env", extra="ignore")

    # The canonical datasets folder (garnet: /Users/lhzn/Projects/whoi-mpg/datasets).
    datasets_root: Path = Path("/data")
    # The built web app; served at / when it exists.
    web_dist: Path | None = None
    topobathykit_url: str = "http://garnet.internal:9595"
    # Cloudflare Access: team domain (https://<team>.cloudflareaccess.com) and application audience tag.
    # Both empty means local development, where writes are allowed only from the loopback interface.
    access_team_domain: str = ""
    access_aud: str = ""
    # Emails allowed to edit metadata, register files and run simulations; anyone can read.
    editors: list[str] = []
    # Where editors sign in: the hub's address behind the tunnel and Access (shown to anonymous readers).
    signin_url: str = ""
    # Local development only: act as this user (with edit rights) when Access is not configured.
    dev_user: str = ""
    # Simulation run profiles (configs/sim-profiles in the repo; the container sets its own copy).
    sim_profiles_dir: Path = Path(__file__).resolve().parents[3] / "configs" / "sim-profiles"
    # Simulation runners: "name:sha256-of-token" per runner; the tokens themselves stay on the runners.
    runner_tokens: list[str] = []
    # Largest upload part the server accepts; Cloudflare caps proxied request bodies at 100 MB.
    upload_part_bytes: int = 64 * 1024 * 1024
    # Grid size of a track's terrain crop (the longer side, in cells); 1024 is 4 MB of Float32.
    topobathy_max_dim: int = 1024
    # Fetch every track's terrain after a scan, so the first view does not wait 30 to 60 s.
    topobathy_prefetch: bool = True
    # The live viewer's visit log (its Worker's admin read) and the Access service token that may read it.
    visits_url: str = "https://whoi-mpg.lhzn.io/api/admin/visits"
    cf_access_client_id: str = ""
    cf_access_client_secret: str = ""

    @property
    def portal_dir(self) -> Path:
        """The portal's own state (catalog, caches, move records) inside the datasets folder."""
        return self.datasets_root / ".portal"


@lru_cache
def get_settings() -> Settings:
    return Settings()
