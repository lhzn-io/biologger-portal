# Copyright (c) 2026 Long Horizon Observatory
# Licensed under the Apache License, Version 2.0. See LICENSE file for details.

"""The hub's runner API (/api/runner, see the portal's routes/runner.py), with a timeout on every call."""

import time
from pathlib import Path
from typing import Any

import httpx

TIMEOUT = httpx.Timeout(30.0, connect=10.0)
TRANSFER_TIMEOUT = httpx.Timeout(300.0, connect=10.0)
CHUNK = 1024 * 1024


class JobLost(Exception):
    """The hub says this runner no longer holds the job (canceled, requeued or finished): stop working on it."""


class HubError(Exception):
    pass


class Hub:
    def __init__(self, base_url: str, token: str, transport: httpx.BaseTransport | None = None) -> None:
        self.client = httpx.Client(
            base_url=base_url.rstrip("/") + "/api/runner",
            headers={"Authorization": f"Bearer {token}"},
            timeout=TIMEOUT,
            transport=transport,
        )

    def close(self) -> None:
        self.client.close()

    @staticmethod
    def _check(r: httpx.Response) -> httpx.Response:
        if r.status_code == 409:
            raise JobLost(r.text)
        if r.status_code >= 400:
            raise HubError(f"{r.request.method} {r.request.url.path}: {r.status_code} {r.text[:500]}")
        return r

    def claim(self, backends: list[str]) -> dict[str, Any] | None:
        r = self._check(self.client.post("/claim", json={"backends": backends}))
        if r.status_code == 204:
            return None
        job: dict[str, Any] = r.json()
        return job

    def text(self, job_id: int, name: str) -> str:
        return self._check(self.client.get(f"/jobs/{job_id}/{name}")).text

    def download_input(self, job_id: int, dest: Path, size: int, attempts: int = 5) -> None:
        """Fetches the input to ``dest``, resuming a partial file with a Range request after a dropped transfer."""
        for attempt in range(attempts):
            have = dest.stat().st_size if dest.exists() else 0
            if have == size:
                return
            if have > size:
                dest.unlink()
                have = 0
            headers = {"Range": f"bytes={have}-"} if have else {}
            try:
                with self.client.stream(
                    "GET", f"/jobs/{job_id}/input", headers=headers, timeout=TRANSFER_TIMEOUT
                ) as r:
                    self._check(r)
                    mode = "ab" if have and r.status_code == 206 else "wb"
                    with dest.open(mode) as out:
                        for chunk in r.iter_bytes(CHUNK):
                            out.write(chunk)
            except httpx.TransportError:
                if attempt == attempts - 1:
                    raise
                time.sleep(2**attempt)
        got = dest.stat().st_size if dest.exists() else 0
        if got != size:
            raise HubError(f"input is {got} bytes, the hub said {size}")

    def heartbeat(
        self, job_id: int, *, backend: str, sim_commit: str, sim_dirty: bool, log_tail: str
    ) -> None:
        body = {"backend": backend, "sim_commit": sim_commit, "sim_dirty": sim_dirty, "log_tail": log_tail}
        self._check(self.client.post(f"/jobs/{job_id}/heartbeat", json=body))

    def upload(self, job_id: int, path: Path, attempts: int = 4) -> None:
        for attempt in range(attempts):
            try:
                self._check(
                    self.client.put(
                        f"/jobs/{job_id}/bundle/{path.name}",
                        content=path.read_bytes(),
                        timeout=TRANSFER_TIMEOUT,
                    )
                )
                return
            except httpx.TransportError:
                if attempt == attempts - 1:
                    raise
                time.sleep(2**attempt)

    def finish(self, job_id: int, log_tail: str) -> dict[str, Any]:
        r = self._check(
            self.client.post(f"/jobs/{job_id}/finish", json={"log_tail": log_tail}, timeout=TRANSFER_TIMEOUT)
        )
        out: dict[str, Any] = r.json()
        return out

    def fail(self, job_id: int, error: str, log_tail: str) -> None:
        self._check(self.client.post(f"/jobs/{job_id}/fail", json={"error": error, "log_tail": log_tail}))
