#!/usr/bin/env python3
"""Sample an approximate hex color for modelkasten paints from their product
photos. Product photos are not standardized (some show the liquid through
the bottle neck, some through the bottom), so this samples both candidate
regions and picks the one with higher saturation. Values are approximate
reference colors, not exact swatches.
"""
from __future__ import annotations

import colorsys
import re
import sqlite3
from pathlib import Path
from urllib.request import Request, urlopen

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / "data" / "official_catalog.sqlite3"
IMAGE_DIR = ROOT / "data" / "modelkasten_images"
USER_AGENT = "ColorackCatalogBot/0.1 (+local data preparation)"


def download_image(catalog_code: str, url: str) -> Path:
    IMAGE_DIR.mkdir(parents=True, exist_ok=True)
    suffix = Path(url.split("?", 1)[0]).suffix or ".jpg"
    path = IMAGE_DIR / f"{catalog_code}{suffix}"
    if not path.exists():
        req = Request(url, headers={"User-Agent": USER_AGENT})
        with urlopen(req, timeout=30) as res:
            path.write_bytes(res.read())
    return path


def sampled_hex(path: Path) -> str | None:
    image = Image.open(path).convert("RGB")
    import numpy as np

    arr = np.array(image)
    h, w, _ = arr.shape
    candidates = [
        (int(w * 0.42), int(w * 0.58), int(h * 0.29), int(h * 0.36)),
        (int(w * 0.54), int(w * 0.66), int(h * 0.912), int(h * 0.93)),
    ]
    best_hex = None
    best_sat = -1.0
    for x0, x1, y0, y1 in candidates:
        patch = arr[y0:y1, x0:x1]
        if patch.size == 0:
            continue
        avg = patch.reshape(-1, 3).mean(axis=0)
        r, g, b = avg / 255
        _, sat, _ = colorsys.rgb_to_hsv(r, g, b)
        if sat > best_sat:
            best_sat = sat
            best_hex = "#%02x%02x%02x" % tuple(int(v) for v in avg)
    return best_hex


def main() -> int:
    conn = sqlite3.connect(DB)
    rows = conn.execute(
        """
        SELECT op.catalog_code, cp.html
        FROM official_products op
        JOIN crawl_pages cp ON cp.url = op.source_url
        WHERE op.brand = 'modelkasten' AND op.product_kind = 'paint'
        ORDER BY op.catalog_code
        """
    ).fetchall()

    updated = 0
    missing = []
    for catalog_code, html in rows:
        m = re.search(r'og:image"\s+content="([^"]+)"', html)
        if not m:
            missing.append(catalog_code)
            continue
        image_url = m.group(1)
        try:
            path = download_image(catalog_code, image_url)
            color_hex = sampled_hex(path)
        except Exception as exc:
            print(f"failed {catalog_code}: {exc}")
            missing.append(catalog_code)
            continue
        if not color_hex:
            missing.append(catalog_code)
            continue
        conn.execute(
            "UPDATE official_products SET hex = ? WHERE catalog_code = ?",
            (color_hex, catalog_code),
        )
        updated += 1

    conn.commit()
    print(f"updated={updated} missing={len(missing)}")
    if missing:
        print("missing=" + ",".join(missing))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
