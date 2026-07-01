#!/usr/bin/env python3
from __future__ import annotations

import re
import sqlite3
from pathlib import Path
from urllib.parse import urljoin
from urllib.request import Request, urlopen

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / "data" / "official_catalog.sqlite3"
IMAGE_DIR = ROOT / "data" / "tamiya_color_images"
USER_AGENT = "ColorackCatalogBot/0.1 (+local data preparation)"


def normalize_src(src: str, base_url: str) -> str:
    src = src.strip()
    if src.startswith("//"):
        return "https:" + src
    return urljoin(base_url, src)


def image_urls_by_item(conn: sqlite3.Connection) -> dict[str, str]:
    urls: dict[str, str] = {}
    rows = conn.execute(
        "SELECT url, html FROM crawl_pages WHERE brand = 'tamiya'"
    ).fetchall()
    for page_url, html in rows:
        for block in re.findall(r"<li\b[^>]*>.*?</li>", html, flags=re.IGNORECASE | re.DOTALL):
            article = re.search(r'data-article="([0-9A-Za-z]+)"', block)
            img = re.search(r"<img\b[^>]*\bsrc=[\"']([^\"']+)[\"']", block, flags=re.IGNORECASE)
            if article and img:
                urls[article.group(1)] = normalize_src(img.group(1), page_url)
    return urls


def download_image(product_no: str, url: str) -> Path:
    IMAGE_DIR.mkdir(parents=True, exist_ok=True)
    suffix = Path(url.split("?", 1)[0]).suffix or ".jpg"
    path = IMAGE_DIR / f"{product_no}{suffix}"
    if not path.exists():
        req = Request(url, headers={"User-Agent": USER_AGENT})
        with urlopen(req, timeout=30) as res:
            path.write_bytes(res.read())
    return path


def sampled_hex(path: Path) -> str | None:
    image = Image.open(path).convert("RGB")
    width, height = image.size
    cx = round(width * 0.35)
    cy = round(height * 0.38)
    radius = max(4, round(min(width, height) * 0.04))
    pixels = [
        image.getpixel((x, y))
        for y in range(max(0, cy - radius), min(height, cy + radius + 1))
        for x in range(max(0, cx - radius), min(width, cx + radius + 1))
    ]
    if not pixels:
        return None

    r = round(sum(pixel[0] for pixel in pixels) / len(pixels))
    g = round(sum(pixel[1] for pixel in pixels) / len(pixels))
    b = round(sum(pixel[2] for pixel in pixels) / len(pixels))
    return f"#{r:02x}{g:02x}{b:02x}"


def main() -> int:
    conn = sqlite3.connect(DB)
    urls = image_urls_by_item(conn)
    rows = conn.execute(
        """
        SELECT catalog_code, product_no
        FROM official_products
        WHERE brand = 'tamiya'
          AND product_kind = 'paint'
          AND product_no IS NOT NULL
        ORDER BY catalog_code
        """
    ).fetchall()

    updated = 0
    missing = []
    for catalog_code, product_no in rows:
        url = urls.get(product_no)
        if not url:
            missing.append(catalog_code)
            continue
        color_hex = sampled_hex(download_image(product_no, url))
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
        print("missing=" + ",".join(missing[:30]))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
