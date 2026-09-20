"""Read-only local runtime/site checks. Never print credentials or migrate a DB."""

import importlib
import json
import re
import sys
from pathlib import Path


def check_site(bench, site, importer=importlib.import_module):
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]*", site) or site in {".", ".."}:
        raise ValueError("Invalid site name")
    sites = bench / "sites"
    config_path = sites / site / "site_config.json"
    if not config_path.is_file():
        raise ValueError(f"Missing {config_path}; restore the existing site, do not create a new database")
    config = json.loads(config_path.read_text())
    common_path = sites / "common_site_config.json"
    common = json.loads(common_path.read_text()) if common_path.is_file() else {}
    merged = {**common, **config}
    for key in ("db_name", "db_password"):
        if not merged.get(key):
            raise ValueError(f"Site configuration is missing {key}")
    app_list = sites / "apps.txt"
    registered = set(app_list.read_text().split()) if app_list.is_file() else set()
    for app in ("frappe", "erpnext", "hrms"):
        if app not in registered:
            raise ValueError(f"Application {app} is missing from sites/apps.txt")
        if not (bench / "apps" / app).is_dir():
            raise ValueError(f"Application source is missing: {app}")
        try:
            importer(app)
        except Exception as exc:
            # Exception messages may contain configuration values.
            raise ValueError(f"Cannot import {app} ({type(exc).__name__}); restore its dependencies") from None
    if not merged.get("encryption_key"):
        print("WARNING: original encryption_key is absent; encrypted credentials need separate recovery.", file=sys.stderr)


if __name__ == "__main__":
    try:
        check_site(Path.cwd(), sys.argv[1])
    except (ValueError, OSError, IndexError) as exc:
        print(f"Site preflight failed: {exc}", file=sys.stderr)
        sys.exit(1)
    print("Site configuration and application imports passed; database access is not yet verified.")
