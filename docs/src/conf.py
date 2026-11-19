# Sphinx configuration for the biologger-portal user guide (served by the hub at /docs/guide/; deploy/docs.sh).
import subprocess
from pathlib import Path

project = "biologger-portal"
author = "Long Horizon Observatory"
copyright = "2026, Long Horizon Observatory"

extensions: list[str] = ["sphinx.ext.extlinks"]
exclude_patterns = ["_build"]
html_theme = "lhzn"
html_title = "biologger-portal user guide"


def _git_commit() -> str:
    """The commit the guide is built from, so code links match the code it describes."""
    try:
        return subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=Path(__file__).parent,
            capture_output=True,
            text=True,
            check=True,
        ).stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        return "main"


# :src:`web/src/viewer/current.ts` links a file in lhzn-io/biologger-portal at the build commit.
extlinks = {
    "src": (
        f"https://github.com/lhzn-io/biologger-portal/blob/{_git_commit()}/%s",
        "%s",
    ),
}
