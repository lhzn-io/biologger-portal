# Copyright (c) 2026 Long Horizon Observatory
# Licensed under the Apache License, Version 2.0. See LICENSE file for details.

"""Dataset hub and track viewer server for biologger deployments."""

from importlib.metadata import PackageNotFoundError, version

try:
    __version__ = version("biologger-portal")
except PackageNotFoundError:  # running from a source tree without an install
    __version__ = "0.0.0"
