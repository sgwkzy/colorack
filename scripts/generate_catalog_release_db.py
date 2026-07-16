#!/usr/bin/env python3
"""
Build a lightweight, distributable SQLite file (dist/catalog_release.sqlite3)
from data/official_catalog.sqlite3's official_products table, for the app's
remote catalog update feature (see docs/catalog-release-runbook.md).

This is a sibling of generate_seed_catalog.py (which produces the bundled
assets/seed_catalog.json). The row-selection/transform logic is intentionally
duplicated rather than shared, so changes to the bundled seed never
accidentally affect release builds (and vice versa).

Usage:
    python scripts/generate_catalog_release_db.py --version 19
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / "data" / "official_catalog.sqlite3"
OUT_PATH = ROOT / "dist" / "catalog_release.sqlite3"


def srgb_to_linear(v: int) -> float:
    c = v / 255
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def rgb_to_lab(r: int, g: int, b: int) -> tuple[float, float, float]:
    rl, gl, bl = srgb_to_linear(r), srgb_to_linear(g), srgb_to_linear(b)
    x = rl * 0.4124 + gl * 0.3576 + bl * 0.1805
    y = rl * 0.2126 + gl * 0.7152 + bl * 0.0722
    z = rl * 0.0193 + gl * 0.1192 + bl * 0.9505
    xn, yn, zn = x / 0.95047, y / 1.0, z / 1.08883

    def f(t: float) -> float:
        return t ** (1 / 3) if t > 0.008856 else 7.787 * t + 16 / 116

    fx, fy, fz = f(xn), f(yn), f(zn)
    return 116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)


def hex_to_rgb(hex_str: str) -> tuple[int, int, int] | None:
    h = hex_str.strip().lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    if len(h) != 6:
        return None
    try:
        return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
    except ValueError:
        return None


def build_rows(conn: sqlite3.Connection) -> list[dict]:
    rows = conn.execute(
        "SELECT p.id, p.brand, p.product_no, p.item_code, p.name_ja, p.name_en, p.series, s.series_en, p.hex, p.gloss, p.paint_type"
        " FROM official_products p"
        " LEFT JOIN official_series s ON s.brand = p.brand AND s.series_ja = p.series"
        " WHERE product_kind IN ('paint', 'paint_component')"
        "   AND p.product_no IS NOT NULL AND p.name_ja IS NOT NULL"
        " ORDER BY p.id"
    ).fetchall()

    best: dict[tuple[str, str], sqlite3.Row] = {}
    for row in rows:
        _id, brand, product_no, item_code, name_ja, name_en, series, series_en, hex_val, gloss, paint_type = row
        key = (brand, product_no)
        current = best.get(key)
        if current is None or (hex_val and not current[8]):
            best[key] = row

    seed = []
    for (brand, product_no), (_id, _brand, _product_no, item_code, name_ja, name_en, series, series_en, hex_val, gloss, paint_type) in sorted(best.items()):
        code = item_code.strip() if item_code and item_code.strip() else product_no
        rgb = hex_to_rgb(hex_val) if hex_val else None
        lab = rgb_to_lab(*rgb) if rgb else None
        seed.append({
            "brand": brand,
            "series": series,
            "series_en": series_en.strip() if series_en and series_en.strip() else None,
            "code": code,
            "name_ja": name_ja,
            "name_en": name_en.strip() if name_en and name_en.strip() else None,
            "hex": f"#{hex_val.lstrip('#').lower()}" if hex_val else None,
            "rgb_r": rgb[0] if rgb else None,
            "rgb_g": rgb[1] if rgb else None,
            "rgb_b": rgb[2] if rgb else None,
            "lab_l": lab[0] if lab else None,
            "lab_a": lab[1] if lab else None,
            "lab_b": lab[2] if lab else None,
            "paint_type": paint_type,
            "gloss": gloss,
            "barcode": None,
        })
    return seed


def write_release_db(rows: list[dict], version: int, out_path: Path) -> None:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    if out_path.exists():
        out_path.unlink()

    conn = sqlite3.connect(out_path)
    conn.execute(
        "CREATE TABLE catalog_paints ("
        " brand TEXT, series TEXT, series_en TEXT, code TEXT,"
        " name_ja TEXT, name_en TEXT, hex TEXT,"
        " rgb_r INTEGER, rgb_g INTEGER, rgb_b INTEGER,"
        " lab_l REAL, lab_a REAL, lab_b REAL,"
        " barcode TEXT, gloss TEXT, paint_type TEXT"
        ")"
    )
    conn.executemany(
        "INSERT INTO catalog_paints"
        " (brand, series, series_en, code, name_ja, name_en, hex,"
        "  rgb_r, rgb_g, rgb_b, lab_l, lab_a, lab_b, barcode, gloss, paint_type)"
        " VALUES (:brand, :series, :series_en, :code, :name_ja, :name_en, :hex,"
        "  :rgb_r, :rgb_g, :rgb_b, :lab_l, :lab_a, :lab_b, :barcode, :gloss, :paint_type)",
        rows,
    )
    conn.execute(f"PRAGMA user_version = {version}")
    conn.commit()
    conn.execute("VACUUM")
    conn.close()


def md5_of(path: Path) -> str:
    h = hashlib.md5()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--version", type=int, required=True, help="Catalog version number (must be greater than the app's current SEED_VERSION)")
    parser.add_argument("--out", type=Path, default=OUT_PATH, help="Output sqlite path")
    args = parser.parse_args()

    conn = sqlite3.connect(DB)
    rows = build_rows(conn)
    conn.close()

    write_release_db(rows, args.version, args.out)

    size_bytes = args.out.stat().st_size
    print(json.dumps({
        "version": args.version,
        "row_count": len(rows),
        "size_bytes": size_bytes,
        "md5": md5_of(args.out),
        "path": str(args.out),
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
