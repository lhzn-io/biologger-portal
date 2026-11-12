# Copyright (c) 2026 Long Horizon Observatory
# Licensed under the Apache License, Version 2.0. See LICENSE file for details.

"""SQLite catalog: connection, migrations and small helpers.

The database lives in ``<datasets>/.portal/catalog.db``. It uses delete-journal mode, not WAL: the
datasets folder is a macOS host-shared mount inside the container, where WAL's shared-memory locking
fails with "disk I/O error" (agent-lab constraint 1).
"""

import json
import sqlite3
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime
from importlib import resources
from pathlib import Path
from typing import Any

_MIGRATIONS = sorted(
    (p for p in resources.files("biologger_portal.migrations").iterdir() if p.name.endswith(".sql")),
    key=lambda p: p.name,
)


def utcnow() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


class Catalog:
    """One connection guarded by a lock: the catalog is small and writes are rare."""

    def __init__(self, path: Path) -> None:
        self.path = path
        path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(path, check_same_thread=False, isolation_level=None)
        self._conn.row_factory = sqlite3.Row
        self._lock = threading.RLock()
        with self._lock:
            self._conn.execute("PRAGMA journal_mode=DELETE")
            self._conn.execute("PRAGMA foreign_keys=ON")
            self._conn.execute("PRAGMA busy_timeout=5000")
            self._migrate()

    def _migrate(self) -> None:
        self._conn.execute("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)")
        row = self._conn.execute("SELECT MAX(version) FROM schema_version").fetchone()
        current = row[0] or 0
        for migration in _MIGRATIONS:
            version = int(migration.name.split("_", 1)[0])
            if version > current:
                self._conn.executescript(
                    "BEGIN;"
                    + migration.read_text()
                    + f"; INSERT INTO schema_version VALUES ({version}); COMMIT;"
                )

    @contextmanager
    def tx(self) -> Iterator[sqlite3.Connection]:
        """A write transaction (or a consistent read); commits on success, rolls back on error."""
        with self._lock:
            self._conn.execute("BEGIN IMMEDIATE")
            try:
                yield self._conn
            except BaseException:
                self._conn.execute("ROLLBACK")
                raise
            self._conn.execute("COMMIT")

    def query(self, sql: str, params: tuple[Any, ...] | dict[str, Any] = ()) -> list[dict[str, Any]]:
        with self._lock:
            return [dict(r) for r in self._conn.execute(sql, params).fetchall()]

    def one(self, sql: str, params: tuple[Any, ...] | dict[str, Any] = ()) -> dict[str, Any] | None:
        rows = self.query(sql, params)
        return rows[0] if rows else None

    def close(self) -> None:
        with self._lock:
            self._conn.close()


def loads(text: str | None) -> Any:
    return json.loads(text) if text else {}


def dumps(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"))
