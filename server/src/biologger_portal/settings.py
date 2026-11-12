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
    # Emails allowed to edit metadata and register files; everyone admitted by Access can read.
    editors: list[str] = []

    @property
    def portal_dir(self) -> Path:
        """The portal's own state (catalog, caches, move records) inside the datasets folder."""
        return self.datasets_root / ".portal"


@lru_cache
def get_settings() -> Settings:
    return Settings()
