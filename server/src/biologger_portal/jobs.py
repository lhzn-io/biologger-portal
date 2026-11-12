# Copyright (c) 2026 Long Horizon Observatory
# Licensed under the Apache License, Version 2.0. See LICENSE file for details.

"""Background work: deep validation and scans, one at a time on a single worker thread.

Light validation runs inline (seconds). Deep validation and scans can take minutes, so they queue
here; their state lives in the catalog (``validation_run``) or in ``Jobs.scan_state``, so a page can
poll it. Runs left ``queued`` or ``running`` by a restart are marked ``error`` on start-up.
"""

import logging
import threading
import traceback
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict
from pathlib import Path
from typing import Any

from .db import Catalog, dumps, utcnow
from .scanner import scan
from .validation import TOOL_VERSION
from .validation.checks import ValidationError, deep, light

log = logging.getLogger(__name__)


class Jobs:
    def __init__(self, catalog: Catalog, root: Path) -> None:
        self.catalog = catalog
        self.root = root
        self._pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="portal-job")
        self._lock = threading.Lock()
        self.scan_state: dict[str, Any] = {"status": "idle"}
        with catalog.tx() as conn:
            conn.execute(
                """UPDATE validation_run SET status='error', summary='interrupted by a server restart',
                   finished_utc=? WHERE status IN ('queued', 'running')""",
                (utcnow(),),
            )

    def shutdown(self) -> None:
        self._pool.shutdown(wait=False, cancel_futures=True)

    # Validation -------------------------------------------------------------------------------

    def request_validation(self, file_id: int, mode: str, actor: str, *, background: bool = True) -> int:
        """Records a run and executes it: light inline, deep on the worker (or inline if not background)."""
        row = self.catalog.one("SELECT * FROM file WHERE id=?", (file_id,))
        if row is None:
            raise KeyError(file_id)
        now = utcnow()
        with self.catalog.tx() as conn:
            cur = conn.execute(
                """INSERT INTO validation_run (deployment_id, file_id, file_path, mode, status, tool_version,
                   requested_by, created_utc) VALUES (?, ?, ?, ?, 'queued', ?, ?, ?)""",
                (row["deployment_id"], file_id, row["path"], mode, TOOL_VERSION, actor, now),
            )
            run_id = int(cur.lastrowid or 0)
        if mode == "light" or not background:
            self._run_validation(run_id)
        else:
            self._pool.submit(self._run_validation, run_id)
        return run_id

    def _run_validation(self, run_id: int) -> None:
        run = self.catalog.one("SELECT * FROM validation_run WHERE id=?", (run_id,))
        assert run is not None
        with self.catalog.tx() as conn:
            conn.execute(
                "UPDATE validation_run SET status='running', started_utc=? WHERE id=?", (utcnow(), run_id)
            )
        path = self.root / run["file_path"]
        try:
            if run["mode"] == "light":
                result = light(path)
            else:
                window = (None, None)
                if run["deployment_id"]:
                    dep = self.catalog.one(
                        "SELECT time_start_utc, time_end_utc FROM deployment WHERE id=?",
                        (run["deployment_id"],),
                    )
                    if dep:
                        window = (dep["time_start_utc"], dep["time_end_utc"])
                result = deep(path, window)
            status, summary, results = result.status, result.summary(), result.to_json()
        except (ValidationError, OSError, ValueError) as exc:
            status, summary, results = "error", str(exc), {"error": str(exc)}
        except Exception as exc:  # report, never leave a run "running"
            log.exception("validation run %s failed", run_id)
            status, summary, results = (
                "error",
                f"internal error: {exc}",
                {"traceback": traceback.format_exc()},
            )
        with self.catalog.tx() as conn:
            conn.execute(
                "UPDATE validation_run SET status=?, summary=?, results=?, finished_utc=? WHERE id=?",
                (status, summary, dumps(results), utcnow(), run_id),
            )

    # Scans ------------------------------------------------------------------------------------

    def request_scan(self, *, hash_files: bool = True) -> dict[str, Any]:
        with self._lock:
            if self.scan_state.get("status") in ("queued", "running"):
                return self.scan_state
            self.scan_state = {"status": "queued", "requested_utc": utcnow(), "hash_files": hash_files}
        self._pool.submit(self._run_scan, hash_files)
        return self.scan_state

    def run_scan_now(self, *, hash_files: bool = True) -> dict[str, Any]:
        self._run_scan(hash_files)
        return self.scan_state

    def _run_scan(self, hash_files: bool) -> None:
        self.scan_state = {**self.scan_state, "status": "running", "started_utc": utcnow()}
        try:
            report = scan(self.catalog, self.root, hash_files=hash_files)
            self.scan_state = {
                **self.scan_state,
                "status": "done",
                "finished_utc": utcnow(),
                **asdict(report),
            }
        except Exception as exc:
            log.exception("scan failed")
            self.scan_state = {
                **self.scan_state,
                "status": "error",
                "error": str(exc),
                "finished_utc": utcnow(),
            }
