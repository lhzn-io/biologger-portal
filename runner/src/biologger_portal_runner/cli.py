# Copyright (c) 2026 Long Horizon Observatory
# Licensed under the Apache License, Version 2.0. See LICENSE file for details.

"""biologger-portal-runner: claims simulation jobs from the hub and runs them, one at a time.

Settings come from the environment or an env file (KEY=VALUE lines, see deploy/runner/runner.env.example):

PORTAL_RUNNER_HUB         the hub's base URL (default http://garnet.internal:8797)
PORTAL_RUNNER_TOKEN_FILE  a file holding this runner's token (required; the hub keeps only its SHA-256)
PORTAL_RUNNER_BACKENDS    comma-separated backends this runner offers (default cpu)
PORTAL_RUNNER_SIM         the biologger-sim command (default: biologger-sim beside this program)
PORTAL_RUNNER_WORK        where job folders go (default ~/.cache/biologger-portal-runner)
PORTAL_RUNNER_POLL_S      seconds between claims while the queue is empty (default 30)
PORTAL_RUNNER_SIM_COMMIT  the simulator commit to record, when the installed package does not say

A runner stopped mid-job does not report it: the hub puts the job back in the queue once the
heartbeats stop (3 minutes), so a restarted runner, or another one, picks it up again.
"""

import argparse
import logging
import os
import shlex
import shutil
import signal
import sys
import time
from pathlib import Path
from types import FrameType

import httpx

from .hub import Hub, HubError
from .work import Options, installed_sim_commit, run_job

log = logging.getLogger("biologger_portal_runner")


def read_env_file(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for raw in path.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        values[key.strip()] = value.strip().strip("'\"")
    return values


def default_sim() -> list[str]:
    beside = Path(sys.executable).parent / "biologger-sim"
    if beside.exists():
        return [str(beside)]
    found = shutil.which("biologger-sim")
    return [found] if found else ["biologger-sim"]


def options(env: dict[str, str]) -> tuple[str, str, Options, float]:
    token_file = env.get("PORTAL_RUNNER_TOKEN_FILE", "")
    if not token_file:
        raise SystemExit("PORTAL_RUNNER_TOKEN_FILE is not set")
    token = Path(token_file).expanduser().read_text().strip()
    if not token:
        raise SystemExit(f"{token_file} is empty")
    hub = env.get("PORTAL_RUNNER_HUB", "http://garnet.internal:8797")
    sim = shlex.split(env["PORTAL_RUNNER_SIM"]) if env.get("PORTAL_RUNNER_SIM") else default_sim()
    work = Path(env.get("PORTAL_RUNNER_WORK", "~/.cache/biologger-portal-runner")).expanduser()
    work.mkdir(parents=True, exist_ok=True)
    backends = [b.strip() for b in env.get("PORTAL_RUNNER_BACKENDS", "cpu").split(",") if b.strip()]
    opts = Options(
        sim_cmd=sim,
        work_dir=work,
        backends=backends,
        sim_commit=env.get("PORTAL_RUNNER_SIM_COMMIT") or installed_sim_commit(),
    )
    return hub, token, opts, float(env.get("PORTAL_RUNNER_POLL_S", "30"))


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="biologger-portal-runner", description=__doc__.split("\n\n")[0])
    parser.add_argument("--env-file", type=Path, help="KEY=VALUE settings, read before the environment")
    parser.add_argument("--once", action="store_true", help="run at most one job, then exit")
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

    env = {**(read_env_file(args.env_file) if args.env_file else {}), **os.environ}
    base_url, token, opts, poll_s = options(env)

    def stop(signum: int, frame: FrameType | None) -> None:
        raise KeyboardInterrupt

    signal.signal(signal.SIGTERM, stop)
    hub = Hub(base_url, token)
    log.info(
        "runner for %s: backends %s, simulator %s at %s",
        base_url,
        ",".join(opts.backends),
        " ".join(opts.sim_cmd),
        opts.sim_commit[:7] or "an unknown commit",
    )
    try:
        while True:
            try:
                job = hub.claim(opts.backends)
            except (HubError, httpx.TransportError) as exc:
                log.warning("claim failed: %s", exc)
                job = None
                if args.once:
                    raise SystemExit(1) from exc
            if job is not None:
                log.info(
                    "job %s: %s (%s), attempt %s",
                    job["id"],
                    job["deployment_id"],
                    job["profile"],
                    job["attempt"],
                )
                result = run_job(hub, job, opts)
                log.info("job %s: %s", job["id"], result)
            if args.once:
                return
            if job is None:
                time.sleep(poll_s)
    except KeyboardInterrupt:
        log.info("stopped")
    finally:
        hub.close()


if __name__ == "__main__":
    main()
