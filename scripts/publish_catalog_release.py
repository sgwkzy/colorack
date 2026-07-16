#!/usr/bin/env python3
"""Generate and publish one catalog release from the local source database."""
from __future__ import annotations

import argparse
import json
import re
import subprocess
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def run(*args: str) -> None:
    subprocess.run(args, cwd=ROOT, check=True)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--version", type=int, required=True)
    parser.add_argument("--notes", required=True)
    args = parser.parse_args()
    if subprocess.run(["git", "diff", "--cached", "--quiet"], cwd=ROOT).returncode:
        raise SystemExit("Stage unrelated changes before publishing the catalog.")
    seed_version = int(re.search(r"SEED_VERSION = (\d+)", (ROOT / "lib" / "db.ts").read_text(encoding="utf-8")).group(1))
    if args.version <= seed_version:
        raise SystemExit(f"version must be greater than bundled seed version {seed_version}")

    generated = subprocess.run(
        ["python", "scripts/generate_catalog_release_db.py", "--version", str(args.version)],
        cwd=ROOT, check=True, capture_output=True, text=True,
    )
    manifest = json.loads(generated.stdout)
    tag = f"catalog-v{args.version}"
    manifest.update({
        "sqlite_url": f"https://github.com/sgwkzy/colorack/releases/download/{tag}/catalog_release.sqlite3",
        "released_at": datetime.now(timezone.utc).isoformat(),
        "notes": args.notes,
    })

    run("gh", "release", "create", tag, "dist/catalog_release.sqlite3", "--title", f"Catalog v{args.version}", "--notes", args.notes)
    (ROOT / "catalog-releases" / "latest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    run("git", "add", "catalog-releases/latest.json")
    run("git", "commit", "-m", f"Publish catalog v{args.version}")
    run("git", "push")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
