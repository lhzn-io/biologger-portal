# Copyright (c) 2026 Long Horizon Observatory
# Licensed under the Apache License, Version 2.0. See LICENSE file for details.

"""Command line: ``biologger-portal serve | import | scan | validate | layout | publish | share``."""

import argparse
import getpass
import json
from dataclasses import asdict
from pathlib import Path

import uvicorn

from . import layout, publish
from .db import Catalog
from .importers import import_all
from .jobs import Jobs
from .routes.tracks import set_shared
from .settings import get_settings
from .topobathy import TopobathyProxy
from .visits import pull_visits


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="biologger-portal")
    sub = parser.add_subparsers(dest="command", required=True)
    serve = sub.add_parser("serve", help="Run the API and web app")
    # Loopback by default: in production the only way in is the Cloudflare Tunnel.
    serve.add_argument("--host", default="127.0.0.1")
    serve.add_argument("--port", type=int, default=8797)
    serve.add_argument("--reload", action="store_true", help="Reload on source changes (development)")
    sub.add_parser("import", help="Import the metadata sheets and the prototype registries, then scan")
    scan_p = sub.add_parser("scan", help="Index the datasets folder")
    scan_p.add_argument("--no-hash", action="store_true", help="Skip SHA-256 of new or changed files")
    val = sub.add_parser("validate", help="Validate one cataloged file and print the result")
    val.add_argument("path", help="Path relative to the datasets root")
    val.add_argument("--mode", choices=["light", "deep"], default="light")
    lay = sub.add_parser("layout", help="Move files into per-deployment folders (plan first, then apply)")
    lay.add_argument("action", choices=["plan", "apply", "revert"])
    lay.add_argument(
        "file", nargs="?", help="apply: the plan (default .portal/layout-plan.json); revert: a moves record"
    )
    pub = sub.add_parser(
        "publish", help="Write the published snapshot (reviewed and shared tracks, catalog) as static files"
    )
    pub.add_argument("--out", help="Output folder (default .portal/publish)")
    sub.add_parser("pull-visits", help="Copy new rows of the live viewer's visit log into the catalog")
    share = sub.add_parser(
        "share", help="Share runs on the published viewer beside the reviewed one (or stop, with --off)"
    )
    share.add_argument("deployment")
    share.add_argument("runs", nargs="+", help="Run IDs of that deployment")
    share.add_argument("--off", action="store_true", help="Stop sharing them")
    args = parser.parse_args(argv)

    if args.command == "serve":
        uvicorn.run(
            "biologger_portal.app:create_app",
            factory=True,
            host=args.host,
            port=args.port,
            reload=args.reload,
            proxy_headers=True,
        )
        return

    settings = get_settings()
    catalog = Catalog(settings.portal_dir / "catalog.db")
    jobs = Jobs(catalog, settings.datasets_root)
    topobathy = TopobathyProxy(settings.topobathykit_url, settings.portal_dir / "topobathy-cache")
    if settings.topobathy_prefetch:
        jobs.attach_topobathy(topobathy, settings.topobathy_max_dim)
    actor = f"cli:{getpass.getuser()}"
    try:
        if args.command == "import":
            report = import_all(catalog, settings.datasets_root, actor=actor)
            print(json.dumps(asdict(report), indent=2))
            print(json.dumps(jobs.run_scan_now(hash_files=True), indent=2, default=str))
        elif args.command == "scan":
            print(json.dumps(jobs.run_scan_now(hash_files=not args.no_hash), indent=2, default=str))
        elif args.command == "validate":
            row = catalog.one("SELECT id FROM file WHERE path=?", (args.path,))
            if row is None:
                raise SystemExit(f"not in the catalog (run a scan first): {args.path}")
            run_id = jobs.request_validation(row["id"], args.mode, actor, background=False)
            run = catalog.one("SELECT * FROM validation_run WHERE id=?", (run_id,))
            assert run is not None
            print(json.dumps({**run, "results": json.loads(run["results"])}, indent=2))
        elif args.command == "publish":
            out = Path(args.out) if args.out else settings.portal_dir / "publish"
            snap = publish.publish(
                catalog, settings.datasets_root, out, topobathy, settings.topobathy_max_dim
            )
            m = snap.manifest
            size = sum(f["bytes"] for f in m["files"].values())
            print(
                f"{m['deployments']} deployments, {len(m['tracks'])} tracks, {len(m['files'])} files "
                f"({size / 1e6:.1f} MB) in {out}; content {m['content_sha256'][:12]}"
            )
        elif args.command == "share":
            for run in args.runs:
                try:
                    changed = set_shared(catalog, args.deployment, run, not args.off, actor)
                except LookupError as e:
                    raise SystemExit(str(e)) from e
                state = "not shared" if args.off else "shared"
                print(f"{args.deployment} {run}: {state}{'' if changed else ' (unchanged)'}")
        elif args.command == "pull-visits":
            print(json.dumps(pull_visits(catalog, settings), indent=2))
        elif args.command == "layout":
            root = settings.datasets_root
            if args.action == "plan":
                jobs.run_scan_now(hash_files=False)  # plan from the folder as it is now
                path, p = layout.write_plan(catalog, root)
                print(
                    f"{len(p['moves'])} moves ({p['bytes'] / 1e9:.1f} GB renamed in place), "
                    f"{len(p['unattributed'])} unattributed, {len(p['conflicts'])} conflicts; plan: {path}"
                )
            elif args.action == "apply":
                plan_path = Path(args.file) if args.file else settings.portal_dir / "layout-plan.json"
                print(f"applied; moves recorded in {layout.apply(catalog, root, plan_path)}")
            else:
                if not args.file:
                    raise SystemExit("revert needs the moves record written by apply")
                print(f"moved {layout.revert(catalog, root, Path(args.file))} files back")
    finally:
        jobs.shutdown()
        topobathy.close()
        catalog.close()


if __name__ == "__main__":
    main()
