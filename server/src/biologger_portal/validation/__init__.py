# Copyright (c) 2026 Long Horizon Observatory
# Licensed under the Apache License, Version 2.0. See LICENSE file for details.

"""Validation of the lab's standard export (``*-standard.csv``).

Every result comes from reading the file; nothing is estimated or filled in when a file is
missing or unreadable (the run ends with status ``error`` and the reason). Thresholds are fixed
here and returned with every result so the page can state them.
"""

TOOL_VERSION = "portal-validation-1"
