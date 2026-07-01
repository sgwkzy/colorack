#!/usr/bin/env python3
"""
Regenerate assets/seed_catalog.json from data/official_catalog.sqlite3's
official_products table (paint / paint_component rows only; solvents are
app-irrelevant and excluded).

`code` = product_no (already normalized by the crawler), matching the
scheme already used in the existing seed_catalog.json.
"""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / "data" / "official_catalog.sqlite3"
SEED_PATH = ROOT / "assets" / "seed_catalog.json"


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


def main() -> int:
    conn = sqlite3.connect(DB)
    rows = conn.execute(
        "SELECT p.id, p.brand, p.product_no, p.name_ja, p.name_en, p.series, s.series_en, p.hex, p.gloss, p.paint_type"
        " FROM official_products p"
        " LEFT JOIN official_series s ON s.brand = p.brand AND s.series_ja = p.series"
        " WHERE product_kind IN ('paint', 'paint_component')"
        "   AND p.product_no IS NOT NULL AND p.name_ja IS NOT NULL"
        " ORDER BY p.id"
    ).fetchall()

    # 同一 (brand, product_no) が複数ある場合は hex が入っている行を優先する。
    best: dict[tuple[str, str], sqlite3.Row] = {}
    for row in rows:
        _id, brand, product_no, name_ja, name_en, series, series_en, hex_val, gloss, paint_type = row
        key = (brand, product_no)
        current = best.get(key)
        if current is None or (hex_val and not current[7]):
            best[key] = row

    seed = []
    for (brand, product_no), (_id, _brand, code, name_ja, name_en, series, series_en, hex_val, gloss, paint_type) in sorted(best.items()):
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
            "source": "official_catalog",
        })

    SEED_PATH.write_text(
        json.dumps(seed, ensure_ascii=False, indent=1) + "\n",
        encoding="utf-8",
    )
    print(f"wrote {len(seed)} rows to {SEED_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
