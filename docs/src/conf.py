# Sphinx configuration for the biologger-portal user guide (served by the hub at /docs/guide/; deploy/docs.sh).
project = "biologger-portal"
author = "Long Horizon Observatory"
copyright = "2026, Long Horizon Observatory"

extensions: list[str] = []
exclude_patterns = ["_build"]
html_theme = "lhzn"
html_title = "biologger-portal user guide"
