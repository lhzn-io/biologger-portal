# Copyright (c) 2026 Long Horizon Observatory
# Licensed under the Apache License, Version 2.0. See LICENSE file for details.

"""Command line: ``biologger-portal serve``."""

import argparse

import uvicorn


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="biologger-portal")
    sub = parser.add_subparsers(dest="command", required=True)
    serve = sub.add_parser("serve", help="Run the API and web app")
    # Loopback by default: in production the only way in is the Cloudflare Tunnel.
    serve.add_argument("--host", default="127.0.0.1")
    serve.add_argument("--port", type=int, default=8797)
    serve.add_argument("--reload", action="store_true", help="Reload on source changes (development)")
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


if __name__ == "__main__":
    main()
