#!/usr/bin/env python3
"""
Fetch official paint product pages into a separate SQLite database.

This intentionally keeps raw pages and extracted product candidates together.
The app catalog can later be generated from this database after manual review.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import html
import json
import re
import sqlite3
import time
from dataclasses import dataclass
from html.parser import HTMLParser
from pathlib import Path
from typing import Iterable
from urllib.parse import parse_qs, urlencode, urlunparse, urldefrag, urljoin, urlparse
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CONFIG = ROOT / "scripts" / "official_catalog_sources.json"
DEFAULT_DB = ROOT / "data" / "official_catalog.sqlite3"
USER_AGENT = "ColorackCatalogBot/0.1 (+local data preparation)"


class TextAndLinksParser(HTMLParser):
    def __init__(self, base_url: str) -> None:
        super().__init__(convert_charrefs=True)
        self.base_url = base_url
        self.parts: list[str] = []
        self.links: set[str] = set()
        self.skip_depth = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.lower() in {"script", "style"}:
            self.skip_depth += 1
            return
        attrs_dict = {k.lower(): v for k, v in attrs if v}
        if tag.lower() == "a" and attrs_dict.get("href"):
            self.links.add(urljoin(self.base_url, attrs_dict["href"]))
        if tag.lower() in {"br", "p", "div", "li", "tr", "h1", "h2", "h3", "dt", "dd"}:
            self.parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() in {"script", "style"} and self.skip_depth:
            self.skip_depth -= 1

    def handle_data(self, data: str) -> None:
        if self.skip_depth:
            return
        text = data.strip()
        if text:
            self.parts.append(text)

    def text(self) -> str:
        lines = []
        for line in "\n".join(self.parts).splitlines():
            cleaned = re.sub(r"\s+", " ", html.unescape(line)).strip()
            if cleaned:
                lines.append(cleaned)
        return "\n".join(lines)


@dataclass(frozen=True)
class Source:
    brand: str
    brand_prefix: str
    start_urls: list[str]
    allowed_hosts: set[str]
    include_url_patterns: list[str]
    max_depth: int

    @property
    def start_category_paths(self) -> set[str]:
        return {urlparse(url).path for url in self.start_urls if "/category/" in urlparse(url).path}

    @property
    def start_group_ids(self) -> set[str]:
        ids: set[str] = set()
        for url in self.start_urls:
            query = parse_qs(urlparse(url).query)
            for gid in query.get("gid", []):
                ids.add(gid)
        return ids


def connect(db_path: Path) -> sqlite3.Connection:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.executescript(
        """
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS crawl_pages (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          brand TEXT NOT NULL,
          url TEXT NOT NULL UNIQUE,
          status_code INTEGER NOT NULL,
          fetched_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          content_hash TEXT NOT NULL,
          html TEXT NOT NULL,
          text TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS official_products (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          brand TEXT NOT NULL,
          brand_prefix TEXT NOT NULL,
          source_url TEXT NOT NULL,
          catalog_code TEXT NOT NULL UNIQUE,
          item_code TEXT,
          product_no TEXT,
          name_ja TEXT,
          name_en TEXT,
          series TEXT,
          product_kind TEXT,
          paint_type TEXT,
          capacity TEXT,
          price_text TEXT,
          price_jpy INTEGER,
          tax_included INTEGER,
          hex TEXT,
          gloss TEXT,
          raw_text TEXT NOT NULL,
          extracted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          reviewed INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_official_products_brand ON official_products(brand);
        CREATE INDEX IF NOT EXISTS idx_official_products_product_no ON official_products(product_no);
        CREATE TABLE IF NOT EXISTS official_series (
          brand TEXT NOT NULL,
          series_ja TEXT NOT NULL,
          series_en TEXT,
          source TEXT,
          review_note TEXT,
          product_count INTEGER NOT NULL DEFAULT 0,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (brand, series_ja)
        );
        CREATE INDEX IF NOT EXISTS idx_official_series_brand ON official_series(brand);
        """
    )
    try:
        conn.execute("ALTER TABLE official_products ADD COLUMN item_code TEXT")
    except sqlite3.OperationalError:
        pass
    try:
        conn.execute("ALTER TABLE official_products ADD COLUMN gloss TEXT")
    except sqlite3.OperationalError:
        pass
    try:
        conn.execute("ALTER TABLE official_products ADD COLUMN paint_type TEXT")
    except sqlite3.OperationalError:
        pass
    return conn


def load_sources(path: Path) -> list[Source]:
    data = json.loads(path.read_text(encoding="utf-8"))
    return [
        Source(
            brand=item["brand"],
            brand_prefix=item["brand_prefix"],
            start_urls=item["start_urls"],
            allowed_hosts=set(item["allowed_hosts"]),
            include_url_patterns=item.get("include_url_patterns", []),
            max_depth=int(item.get("max_depth", 1)),
        )
        for item in data["sources"]
    ]


def fetch_url(url: str, timeout: int = 30) -> tuple[int, str]:
    req = Request(url, headers={"User-Agent": USER_AGENT})
    with urlopen(req, timeout=timeout) as res:
        raw = res.read()
        charset = res.headers.get_content_charset()
        candidates = [charset] if charset else []
        candidates.extend(["utf-8", "cp932", "shift_jis", "euc_jp"])
        body = decode_body(raw, candidates)
        return int(res.status), body


def decode_body(raw: bytes, candidates: Iterable[str | None]) -> str:
    best = ""
    best_score = None
    for charset in candidates:
        if not charset:
            continue
        try:
            text = raw.decode(charset, errors="replace")
        except LookupError:
            continue
        japanese_chars = len(re.findall(r"[\u3040-\u30ff\u3400-\u9fff]", text))
        replacement_chars = text.count("�")
        mojibake_markers = len(re.findall(r"[�縺繧逕蜷譁]", text))
        score = japanese_chars - (replacement_chars * 100) - (mojibake_markers * 5)
        if best_score is None or score > best_score:
            best = text
            best_score = score
    return best or raw.decode("utf-8", errors="replace")


def parse_page(url: str, body: str) -> tuple[str, set[str]]:
    parser = TextAndLinksParser(url)
    parser.feed(body)
    return parser.text(), parser.links


def allowed_link(source: Source, url: str) -> bool:
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"}:
        return False
    if parsed.netloc not in source.allowed_hosts:
        return False
    if not source.include_url_patterns:
        return True
    if source.start_category_paths and "/category/" in parsed.path:
        return parsed.path in source.start_category_paths
    haystack = f"{parsed.path}?{parsed.query}" if parsed.query else parsed.path
    if source.start_group_ids and parsed.netloc == "finishers.shop-pro.jp":
        query = parse_qs(parsed.query)
        if "pid" in query:
            return True
        return bool(set(query.get("gid", [])) & source.start_group_ids)
    return any(pattern in haystack for pattern in source.include_url_patterns)


def canonical_url(url: str) -> str:
    url = urldefrag(url)[0]
    parsed = urlparse(url)
    if parsed.netloc == "finishers.shop-pro.jp":
        query = parse_qs(parsed.query, keep_blank_values=True)
        keep_keys = ["mode", "gid", "sort", "page", "pid"]
        kept: list[tuple[str, str]] = []
        for key in keep_keys:
            for value in query.get(key, []):
                kept.append((key, value))
        return urlunparse((parsed.scheme, parsed.netloc, parsed.path, "", urlencode(kept), ""))
    return url


def normalize_product_no(product_no: str) -> str:
    value = product_no.strip().upper()
    value = re.sub(r"^(NO\.?|品番|製品番号)[:：]?\s*", "", value, flags=re.IGNORECASE)
    value = re.sub(r"([A-Z]+)\s+([0-9])", r"\1-\2", value)
    value = re.sub(r"([0-9])\s+([A-Z]+)", r"\1-\2", value)
    value = re.sub(r"\s+", "", value)
    value = value.replace("_", "-")
    value = re.sub(r"[^0-9A-Z-]+", "-", value)
    value = re.sub(r"-{2,}", "-", value).strip("-")
    return value


def catalog_code(brand_prefix: str, product_no: str) -> str:
    return f"{brand_prefix.upper()}_{normalize_product_no(product_no)}"


def find_first(patterns: Iterable[str], text: str) -> str | None:
    for pattern in patterns:
        match = re.search(pattern, text, flags=re.IGNORECASE | re.MULTILINE)
        if match:
            return match.group(1).strip()
    return None


def parse_price(price_text: str | None) -> tuple[int | None, int | None]:
    if not price_text:
        return None, None
    normalized = price_text.translate(str.maketrans("０１２３４５６７８９，￥", "0123456789,¥")).replace(",", "")
    amount = re.search(r"(?:¥\s*)?([0-9]{2,6})\s*(?:円)?", normalized)
    tax_included = 1 if re.search(r"税込|税込み", price_text) else 0 if "税抜" in price_text else None
    return (int(amount.group(1)) if amount else None, tax_included)


def label_value(text: str, labels: Iterable[str]) -> str | None:
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    normalized_labels = {re.sub(r"\s+", "", label) for label in labels}
    for i, line in enumerate(lines):
        clean = re.sub(r"\s+", "", line)
        for label in normalized_labels:
            if clean == label:
                return lines[i + 1] if i + 1 < len(lines) else None
            if clean.startswith(label) and len(clean) > len(label):
                return line[len(line) - (len(clean) - len(label)):].strip(" ：:")
    return None


def guess_name(text: str) -> str | None:
    for line in text.splitlines():
        if len(line) < 2:
            continue
        if re.search(r"^(品番|製品番号|価格|内容量|容量|JAN|発売)", line):
            continue
        if re.search(r"(カラー|うすめ液|溶剤|サーフェイサー|プライマー|クリアー|塗料|Mr\.|ガイア)", line, re.IGNORECASE):
            return line[:120]
    return None


def strip_tags(fragment: str, base_url: str) -> str:
    return parse_page(base_url, fragment)[0]


def page_series(text: str) -> str | None:
    first = next((line.strip() for line in text.splitlines() if line.strip()), "")
    if " - " in first:
        return first.split(" - ", 1)[1].strip()
    return None


def html_blocks_with_product_detail(body: str) -> list[str]:
    blocks: list[str] = []
    li_blocks = re.findall(r"<li\b[^>]*>.*?</li>", body, flags=re.IGNORECASE | re.DOTALL)
    blocks.extend(block for block in li_blocks if "product_detail" in block)

    class_patterns = [
        "product_wrap_one3",
        "product_wrap_one2",
        "product_wrap_one",
        "product_wrap_3column",
        "product_wrap_4column",
        "left_wrap",
        "right_wrap",
    ]
    for class_name in class_patterns:
        pattern = rf"<div\b[^>]*class=[\"'][^\"']*\b{re.escape(class_name)}\b[^\"']*[\"'][^>]*>.*?(?=<div\b[^>]*class=[\"'][^\"']*\b(?:{'|'.join(map(re.escape, class_patterns))})\b|</div>\s*</div>\s*<div\b[^>]*class=[\"'][^\"']*\bsetcolor_|</div>\s*</div>\s*<div id=\"footer|$)"
        blocks.extend(
            block
            for block in re.findall(pattern, body, flags=re.IGNORECASE | re.DOTALL)
            if "product_detail" in block
        )

    # Keep order and remove duplicate fragments.
    seen: set[str] = set()
    unique: list[str] = []
    for block in blocks:
        key = hashlib.sha1(block.encode("utf-8", errors="replace")).hexdigest()
        if key not in seen:
            seen.add(key)
            unique.append(block)
    return unique


def component_blocks_with_positions(body: str) -> list[tuple[int, str]]:
    blocks: list[tuple[int, str]] = []
    pattern = r"<div\b[^>]*class=[\"'][^\"']*\b(?:left_wrap|right_wrap)\b[^\"']*[\"'][^>]*>.*?</div>\s*</div>"
    for match in re.finditer(pattern, body, flags=re.IGNORECASE | re.DOTALL):
        block = match.group(0)
        if "product_detail" in block:
            blocks.append((match.start(), block))
    return blocks


def clean_title_line(line: str) -> str:
    line = re.sub(r"^(NEW|生産終了|廃番|販売終了)\s+", "", line, flags=re.IGNORECASE).strip()
    line = re.sub(r"^(NEW|生産終了|廃番|販売終了)$", "", line, flags=re.IGNORECASE).strip()
    return line


def title_from_block(block: str, block_text: str) -> str | None:
    h2_match = re.search(r"<h2\b[^>]*>(.*?)</h2>", block, flags=re.IGNORECASE | re.DOTALL)
    if h2_match:
        title = strip_tags(h2_match.group(1), "")
        title = " ".join(clean_title_line(line) for line in title.splitlines()).strip()
        if title:
            return title
    for line in block_text.splitlines():
        title = clean_title_line(line.strip())
        if title and not re.search(r"^(購入する|品番|内容量|価格|備考)$", title):
            return title
    return None


def split_item_code_and_name(title: str, product_no: str) -> tuple[str, str]:
    code_match = re.match(r"^((?:[A-Za-z]+-\d+[A-Za-z]?|\d{3,4}|[A-Za-z]-\d+[A-Za-z]?))\s+(.+)$", title)
    if code_match:
        return normalize_product_no(code_match.group(1)), code_match.group(2).strip()

    trailing_number = re.search(r"カラー\s*([0-9]{3,4})$", title)
    if trailing_number:
        return normalize_product_no(trailing_number.group(1)), title.strip()

    return normalize_product_no(product_no), title.strip()


def last_product_no_before(body: str, pos: int) -> str | None:
    prefix = strip_tags(body[:pos], "")
    matches = re.findall(r"(?:品番|製品番号|商品番号)\s*[:：]?\s*([A-Za-z0-9][A-Za-z0-9_\- ]{0,24})", prefix)
    if not matches:
        return None
    return normalize_product_no(matches[-1])


def split_gaianotes_products(source: Source, url: str, body: str, page_text: str) -> list[dict[str, object]]:
    if source.brand != "gaianotes":
        return []

    products: list[dict[str, object]] = []
    series = page_series(page_text)
    blocks = html_blocks_with_product_detail(body)
    for block in blocks:
        if "product_detail" not in block:
            continue

        block_text = strip_tags(block, url)
        product_no = find_first([r"(?:品番|製品番号|商品番号)\s*[:：]?\s*([A-Za-z0-9][A-Za-z0-9_\- ]{0,24})"], block_text)
        if not product_no:
            continue
        title = title_from_block(block, block_text)
        if not title:
            continue

        item_code, name_ja = split_item_code_and_name(title, product_no)

        price_text = find_first(
            [
                r"(?:価格|希望小売価格|メーカー希望小売価格)(?:\s*\([^)]*\))?\s*[:：]?\s*([￥¥]?\s*[0-9０-９,，]+\s*(?:円)?[^\n]*)",
                r"([￥¥]\s*[0-9０-９,，]+[^\n]*)",
                r"([0-9０-９,，]+\s*円\s*(?:税込|税込み|税抜)?[^\n]*)",
            ],
            block_text,
        )
        price_jpy, tax_included = parse_price(price_text)
        capacity = find_first(
            [
                r"(?:内容量|容量)\s*[:：]?\s*([0-9.]+\s*(?:ml|mL|ML|g|G|本)[^\n]*)",
                r"\b([0-9.]+\s*(?:ml|mL|ML|g|G))\b",
            ],
            block_text,
        )
        gloss = find_first([r"^(光沢|半光沢|つや消し|メタリック|パール|蛍光)$"], block_text)
        product_kind = "solvent" if re.search(r"うすめ液|溶剤|ツールクリーナー|リターダー", block_text) else "paint"

        products.append(
            {
                "brand": source.brand,
                "brand_prefix": source.brand_prefix,
                "source_url": url,
                "catalog_code": catalog_code(source.brand_prefix, item_code),
                "item_code": item_code,
                "product_no": normalize_product_no(product_no),
                "name_ja": name_ja,
                "name_en": None,
                "series": series,
                "product_kind": product_kind,
                "capacity": capacity,
                "price_text": price_text,
                "price_jpy": price_jpy,
                "tax_included": tax_included,
                "hex": None,
                "gloss": gloss,
                "raw_text": block_text,
            }
        )

    existing_codes = {str(product["catalog_code"]) for product in products}
    component_counts: dict[str, int] = {}
    for pos, block in component_blocks_with_positions(body):
        block_text = strip_tags(block, url)
        if find_first([r"(?:品番|製品番号|商品番号)\s*[:：]?\s*([A-Za-z0-9][A-Za-z0-9_\- ]{0,24})"], block_text):
            continue
        capacity = find_first(
            [
                r"(?:内容量|容量)\s*[:：]?\s*([0-9.]+\s*(?:ml|mL|ML|g|G|本)[^\n]*)",
                r"\b([0-9.]+\s*(?:ml|mL|ML|g|G))\b",
            ],
            block_text,
        )
        if not capacity:
            continue
        parent_no = last_product_no_before(body, pos)
        title = title_from_block(block, block_text)
        if not parent_no or not title:
            continue
        component_counts[parent_no] = component_counts.get(parent_no, 0) + 1
        item_code = f"{parent_no}-{component_counts[parent_no]}"
        code = catalog_code(source.brand_prefix, item_code)
        if code in existing_codes:
            continue
        existing_codes.add(code)
        gloss = find_first([r"^(光沢|半光沢|つや消し|メタリック|パール|蛍光)$"], block_text)
        products.append(
            {
                "brand": source.brand,
                "brand_prefix": source.brand_prefix,
                "source_url": url,
                "catalog_code": code,
                "item_code": item_code,
                "product_no": parent_no,
                "name_ja": title,
                "name_en": None,
                "series": series,
                "product_kind": "paint_component",
                "capacity": capacity,
                "price_text": None,
                "price_jpy": None,
                "tax_included": None,
                "hex": None,
                "gloss": gloss,
                "raw_text": block_text,
            }
        )

    return products


def split_bornpaint_products(source: Source, url: str, body: str, text: str) -> list[dict[str, object]]:
    if source.brand != "bornpaint":
        return []
    parsed = urlparse(url)
    if not re.fullmatch(r"/product/\d+/\d+/?", parsed.path):
        return []

    lines = [line.strip() for line in text.splitlines() if line.strip()]
    title = None
    for line in lines:
        if line in {"PRODUCT INFORMATION", "商品情報"}:
            continue
        if line.endswith("｜BORN PAINT（ボーンペイント）"):
            title = line.split("｜", 1)[0].strip()
            break
    if not title:
        for line in lines:
            if line not in {"PRODUCT INFORMATION", "商品情報"}:
                title = line
                break
    if not title:
        return []

    path_numbers = re.findall(r"\d+", parsed.path)
    item_code = "-".join(path_numbers[:2]) if len(path_numbers) >= 2 else path_numbers[0] if path_numbers else normalize_product_no(title)
    product_no = item_code
    capacity = label_value(text, ["内容量"])
    price_text = label_value(text, ["価格", "価 格"])
    price_jpy, tax_included = parse_price(price_text)
    series = label_value(text, ["系統"])
    product_kind = "solvent" if re.search(r"うすめ液|専用うすめ液|クリーナー|ツール|リムーバー|シンナー", title) else "paint"

    return [
        {
            "brand": source.brand,
            "brand_prefix": source.brand_prefix,
            "source_url": url,
            "catalog_code": catalog_code(source.brand_prefix, item_code),
            "item_code": item_code,
            "product_no": product_no,
            "name_ja": title,
            "name_en": None,
            "series": series,
            "product_kind": product_kind,
            "capacity": capacity,
            "price_text": price_text,
            "price_jpy": price_jpy,
            "tax_included": tax_included,
            "hex": None,
            "gloss": None,
            "raw_text": text,
        }
    ]


def split_finishers_products(source: Source, url: str, body: str, text: str) -> list[dict[str, object]]:
    if source.brand != "finishers":
        return []
    parsed = urlparse(url)
    query = parse_qs(parsed.query)
    pid = next(iter(query.get("pid", [])), None)
    if not pid:
        return []

    lines = [line.strip() for line in text.splitlines() if line.strip()]
    title = None
    for line in lines:
        if " - Finisher" in line:
            title = line.split(" - ", 1)[0].strip()
            break
    if not title:
        title = guess_name(text)
    if not title:
        return []

    capacity = find_first([r"内容量\s*([0-9.]+\s*(?:ml|mL|ML|g|G|本)[^\n]*)"], text)
    price_text = find_first([r"([0-9０-９,，]+\s*円\s*\(税[0-9０-９,，]+円\))"], text)
    price_jpy, tax_included = parse_price(price_text)
    series = "Finisher'sカラー"
    product_kind = "solvent" if re.search(r"シンナー|溶剤|クリーナー|研磨|コート|コンパウンド", title) else "paint"

    return [
        {
            "brand": source.brand,
            "brand_prefix": source.brand_prefix,
            "source_url": url,
            "catalog_code": catalog_code(source.brand_prefix, pid),
            "item_code": pid,
            "product_no": pid,
            "name_ja": title,
            "name_en": None,
            "series": series,
            "product_kind": product_kind,
            "capacity": capacity,
            "price_text": price_text,
            "price_jpy": price_jpy,
            "tax_included": tax_included,
            "hex": None,
            "gloss": None,
            "raw_text": text,
        }
    ]


def split_modelkasten_products(source: Source, url: str, body: str, text: str) -> list[dict[str, object]]:
    if source.brand != "modelkasten":
        return []
    parsed = urlparse(url)
    match = re.match(r"^/shopdetail/(\d+)/", parsed.path)
    if not match:
        return []
    item_id = match.group(1)

    lines = [line.strip() for line in text.splitlines() if line.strip()]
    title = lines[0] if lines else None
    if title and " - MODELKASTEN" in title:
        title = title.split(" - MODELKASTEN", 1)[0].strip()
    if not title:
        return []
    if "セット" in title:
        return []

    product_no = find_first([r"品番\s*[:：]\s*([A-Za-z0-9][A-Za-z0-9_\- ]{0,24})"], text) or item_id

    capacity = find_first(
        [
            r"正味量\s*[:：]\s*([0-9.]+\s*(?:ml|mL|ML|g|G))",
            r"([0-9.]+\s*(?:ml|mL|ML|g|G))\s*入",
            r"([0-9.]+)\s*(?:ミリリットル|mリットル)",
        ],
        text,
    )
    if capacity and "ミリリットル" not in capacity and re.fullmatch(r"[0-9.]+", capacity):
        capacity = f"{capacity}ml"
    paint_type = find_first(
        [
            r"^([^\n]*系塗料)$",
            r"((?:ラッカー|エナメル|水性アクリル|溶剤系アクリル|アクリル)(?:（ラッカー）)?系塗料)",
        ],
        text,
    )
    price_text = find_first([r"([0-9０-９,，]+\s*円\s*\(税抜[0-9０-９,，]+円\))"], text)
    price_jpy, tax_included = parse_price(price_text)
    tax_included = 1
    product_kind = "solvent" if re.search(r"うすめ液|溶剤|シンナー|クリーナー", title) else "paint"
    series = "エナメルカラー" if re.match(r"^ME-", normalize_product_no(product_no)) else "大瓶タイプ"

    return [
        {
            "brand": source.brand,
            "brand_prefix": source.brand_prefix,
            "source_url": url,
            "catalog_code": catalog_code(source.brand_prefix, product_no),
            "item_code": normalize_product_no(product_no),
            "product_no": normalize_product_no(product_no),
            "name_ja": title,
            "name_en": None,
            "series": series,
            "product_kind": product_kind,
            "paint_type": paint_type,
            "capacity": capacity,
            "price_text": price_text,
            "price_jpy": price_jpy,
            "tax_included": tax_included,
            "hex": None,
            "gloss": None,
            "raw_text": text,
        }
    ]


def vallejo_article_blocks(body: str) -> list[str]:
    return re.findall(r"<article\b[^>]*class=[\"'][^\"']*\bitemDtl\b[^\"']*[\"'][^>]*>.*?</article>", body, flags=re.IGNORECASE | re.DOTALL)


def vallejo_section_price_and_capacity(section_id: str, series: str, article_text: str) -> tuple[str | None, str | None]:
    if "18ml" in article_text or section_id in {"mc", "mc_mtl"}:
        return "18ml", "¥385（税込）"
    if section_id == "mc_fluorescence":
        return "17ml", "¥319（税込）"
    if section_id == "mc_metalAL":
        return "17ml", "¥982（税込）"
    if "オリジナルカラー" in series:
        return "17ml", "¥385（税込）"
    if "17ml" in article_text or "17ml" in series:
        return "17ml", "¥319〜¥385（税込）"
    return None, None


def split_vallejo_products(source: Source, url: str, body: str, text: str) -> list[dict[str, object]]:
    if source.brand != "vallejo":
        return []

    products: list[dict[str, object]] = []
    for article in vallejo_article_blocks(body):
        heading_match = re.search(r"<h2\b([^>]*)>(.*?)</h2>", article, flags=re.IGNORECASE | re.DOTALL)
        if not heading_match:
            continue
        heading_attrs, heading_html = heading_match.groups()
        section_id = find_first([r"\bid=[\"']([^\"']+)[\"']"], heading_attrs) or ""
        series = strip_tags(heading_html, url)
        article_text = strip_tags(article, url)
        capacity, price_text = vallejo_section_price_and_capacity(section_id, series, article_text)
        price_jpy, tax_included = parse_price(price_text)

        for card in re.findall(r"<li\b[^>]*class=[\"'][^\"']*\bcard\b[^\"']*[\"'][^>]*>.*?</li>", article, flags=re.IGNORECASE | re.DOTALL):
            dt_match = re.search(r"<dt\b[^>]*>\s*([0-9A-Za-z-]+)\s*<span\b[^>]*class=[\"']cCode[\"'][^>]*>(.*?)</span>", card, flags=re.IGNORECASE | re.DOTALL)
            name_match = re.search(r"<dd\b[^>]*>(.*?)</dd>", card, flags=re.IGNORECASE | re.DOTALL)
            if not dt_match or not name_match:
                continue

            product_no = normalize_product_no(strip_tags(dt_match.group(1), url))
            item_code = normalize_product_no(strip_tags(dt_match.group(2), url))
            name_ja = strip_tags(name_match.group(1), url)
            color_match = re.search(r"background\s*:\s*(#[0-9A-Fa-f]{3,6})", card)
            color_hex = color_match.group(1).lower() if color_match else None

            products.append(
                {
                    "brand": source.brand,
                    "brand_prefix": source.brand_prefix,
                    "source_url": url,
                    "catalog_code": "",
                    "_catalog_seed": product_no,
                    "_section_id": section_id,
                    "item_code": item_code,
                    "product_no": product_no,
                    "name_ja": name_ja,
                    "name_en": None,
                    "series": series,
                    "product_kind": "paint",
                    "paint_type": "水性アクリル塗料",
                    "capacity": capacity,
                    "price_text": price_text,
                    "price_jpy": price_jpy,
                    "tax_included": tax_included,
                    "hex": color_hex,
                    "gloss": None,
                    "raw_text": strip_tags(card, url),
                }
            )

    product_no_counts: dict[str, int] = {}
    for product in products:
        product_no = str(product["product_no"])
        product_no_counts[product_no] = product_no_counts.get(product_no, 0) + 1

    used_codes: set[str] = set()
    for product in products:
        seed = str(product.pop("_catalog_seed"))
        section_id = str(product.pop("_section_id") or "")
        if product_no_counts[str(product["product_no"])] > 1:
            suffix = normalize_product_no(str(product.get("capacity") or section_id or "ALT"))
            seed = f"{seed}-{suffix}"
        code = catalog_code(source.brand_prefix, seed)
        if code in used_codes:
            code = catalog_code(source.brand_prefix, f"{seed}-{len(used_codes) + 1}")
        used_codes.add(code)
        product["catalog_code"] = code

    return products


def split_tamiya_products(source: Source, url: str, body: str, text: str) -> list[dict[str, object]]:
    if source.brand != "tamiya":
        return []
    if "genre_item=504005" in url:
        series = "ラッカー塗料"
        product_code_pattern = r"LP-\d+"
        paint_type = "ラッカー塗料"
        solvent_type = "ラッカー溶剤"
        title_prefix_pattern = r"^タミヤカラー\s+ラッカー塗料\s+"
    elif "genre_item=504010" in url:
        series = "アクリル塗料ミニ"
        product_code_pattern = r"XF-\d+|X-?\d+A?"
        paint_type = "水性アクリル塗料"
        solvent_type = "アクリル溶剤"
        title_prefix_pattern = r"^アクリルミニ\s+"
    elif "genre_item=504020" in url:
        series = "エナメル塗料"
        product_code_pattern = r"XF-\d+|X-\d+"
        paint_type = "エナメル塗料"
        solvent_type = "エナメル溶剤"
        title_prefix_pattern = r"^エナメル\s+"
    elif "genre_item=504030" in url:
        series = "タミヤスプレー"
        product_code_pattern = r"TS-\d+"
        paint_type = "ラッカー系スプレー塗料"
        solvent_type = "ラッカー溶剤"
        title_prefix_pattern = r"(?!)"
    elif "genre_item=504050" in url:
        series = "エアーモデルスプレー"
        product_code_pattern = r"AS-\d+"
        paint_type = "ラッカー系スプレー塗料"
        solvent_type = "ラッカー溶剤"
        title_prefix_pattern = r"(?!)"
    else:
        return []

    products: list[dict[str, object]] = []
    pattern = re.compile(
        rf"{re.escape(series)}\s*\nITEM\s+([0-9A-Za-z]{{5}})\s*\n(.+?)\s*\n([0-9,]+)円\s*\n\(税込\)",
        flags=re.MULTILINE,
    )
    for match in pattern.finditer(text):
        title = match.group(2).strip()
        item_match = re.search(rf"\b({product_code_pattern})\b\s*(.*)", title)
        if series == "アクリル塗料ミニ" and not item_match:
            item_match = re.search(r"\b(X20A)\b\s*(.*)", title)
        is_solvent = bool(re.search(r"溶剤|リターダー", title))
        if series == "アクリル塗料ミニ" and re.search(r"\bX-?20A\b", title):
            is_solvent = True
        if not match.group(1).isdigit():
            continue
        if not item_match and not is_solvent:
            continue
        item_code = normalize_product_no(item_match.group(1)) if item_match else normalize_product_no(match.group(1))
        if item_code == "X20A":
            item_code = "X-20A"
        catalog_seed = match.group(1) if series == "アクリル塗料ミニ" and is_solvent else item_code
        if series == "エナメル塗料":
            catalog_seed = f"ENAMEL-{item_code}"
        if series == "アクリル塗料ミニ" and is_solvent and item_code == "X-20A":
            name_ja = re.sub(title_prefix_pattern, "", title).strip().replace("X20A", "X-20A")
        name_ja = item_match.group(2).strip() if item_match else title
        if item_match and not name_ja:
            name_ja = title
        name_ja = re.sub(title_prefix_pattern, "", name_ja).strip()
        capacity = find_first([r"([0-9.]+\s*(?:ml|mL|ML))"], title)
        if match.group(1) == "81030":
            capacity = "40ml"
            name_ja = "X-20A (大徳用)"
        elif match.group(1) == "81520":
            capacity = "10ml"
            name_ja = "X-20A 溶剤"
        elif match.group(1) == "81040":
            capacity = "250ml"
            name_ja = "アクリル溶剤特大 (X-20A 250ml)"
        if not capacity and item_match:
            capacity = "10ml"
        price_text = f"{match.group(3)}円"
        price_jpy, _ = parse_price(price_text)
        products.append(
            {
                "brand": source.brand,
                "brand_prefix": source.brand_prefix,
                "source_url": url,
                "catalog_code": catalog_code(source.brand_prefix, catalog_seed),
                "item_code": item_code,
                "product_no": match.group(1),
                "name_ja": name_ja,
                "name_en": None,
                "series": series,
                "product_kind": "solvent" if is_solvent else "paint",
                "paint_type": solvent_type if is_solvent else paint_type,
                "capacity": capacity,
                "price_text": price_text,
                "price_jpy": price_jpy,
                "tax_included": 1,
                "hex": None,
                "gloss": None,
                "raw_text": "\n".join(match.group(0).splitlines()),
            }
        )
    return products


GSI_DETAIL_11_LINEUP = [
    ("GX-1", "クールホワイト", "#ffffff"),
    ("GX-2", "ウイノーブラック", "#000000"),
    ("GX-3", "ハーマンレッド", "#e50113"),
    ("GX-4", "キアライエロー", "#fcdf02"),
    ("GX-5", "スージーブルー", "#0450a1"),
    ("GX-6", "モウリーグリーン", "#066a35"),
    ("GX-100", "スーパークリアーIII", "#fdfdfd"),
]


GSI_DETAIL_13_LINEUP = [
    ("GX-112", "スーパークリアーIIIUVカット光沢", "#ffffff", "18ml", "253円", "光沢"),
]


GSI_DETAIL_14_LINEUP = [
    ("GX-113", "スーパークリアーIII UVカットつや消し", "#ffffff", "18ml", "253円", "つや消し"),
]


GSI_DETAIL_15_LINEUP = [
    ("GX-114", "スーパースムースクリアー つや消し", "#ffffff", "18ml", "319円", "つや消し"),
]


GSI_DETAIL_4_LINEUP = [
    ("C601", "呉海軍工廠標準色", "#8b8e93", "10ml", "253円", "つや消し"),
    ("C602", "佐世保海軍工廠標準色", "#6e706d", "10ml", "253円", "つや消し"),
    ("C603", "舞鶴海軍工廠標準色", "#7b7c76", "10ml", "253円", "つや消し"),
    ("C604", "外舷21号色", "#527e3f", "10ml", "253円", "つや消し"),
    ("C605", "外舷22号色", "#84ae6c", "10ml", "253円", "つや消し"),
    ("C606", "リノリウム色", "#6e4c40", "10ml", "253円", "つや消し"),
    ("C607", "灰色2704(N5)", "#7c8184", "10ml", "253円", "半光沢"),
    ("C608", "暗灰色2705(N4)", "#595d60", "10ml", "253円", "つや消し"),
    ("C609", "濃ロイヤル色塗装部色", "#424345", "10ml", "253円", "つや消し"),
]


GSI_DETAIL_3_LINEUP = [
    ("C511", "ロシアングリーン4BO WWII", "#6a5e2a", "10ml", "253円", "つや消し"),
    ("C512", "ロシアングリーン4BO 1947以降", "#5a6030", "10ml", "253円", "つや消し"),
    ("C513", "ジャーマングレー/グラウ H513", "#3e4f5f", "10ml", "253円", "つや消し"),
    ("C514", "ジャーマングレー/グラウ H514", "#4e7280", "10ml", "253円", "つや消し"),
    ("C515", "ジャーマングレー/グラウ(退色) H515", "#5b7b86", "10ml", "253円", "つや消し"),
    ("C516", "濃緑色 3414", "#404737", "10ml", "253円", "つや消し"),
    ("C517", "茶色 3606", "#4e3b2a", "10ml", "253円", "つや消し"),
    ("C518", "OD色 2314", "#3a341c", "10ml", "253円", "半光沢"),
    ("C519", "ブロッキグリュン RAL6031", "#3b4d37", "10ml", "253円", "つや消し"),
    ("C520", "レーダブラウン RAL8027", "#543924", "10ml", "253円", "つや消し"),
    ("C521", "テーアシュバルツ RAL9021", "#232929", "10ml", "253円", "つや消し"),
    ("C522", "土地色", "#4d4845", "10ml", "253円", "つや消し"),
    ("C523", "草色", "#4e5d46", "10ml", "253円", "つや消し"),
    ("C524", "枯草色", "#87793c", "10ml", "253円", "つや消し"),
    ("C525", "緑色", "#1b4a38", "10ml", "253円", "つや消し"),
    ("C526", "茶色", "#8a594b", "10ml", "253円", "つや消し"),
    ("C527", "陸軍カーキ", "#aa7553", "10ml", "253円", "つや消し"),
    ("C528", "IDFグレー1(-1981シナイ半島)", "#c9b384", "10ml", "253円", "つや消し"),
    ("C529", "IDFグレー2(-1981シナイ以降)", "#867e69", "10ml", "253円", "つや消し"),
    ("C530", "IDFグレー3(現用)", "#7b7458", "10ml", "253円", "つや消し"),
]


GSI_DETAIL_2_LINEUP = [
    ("C301", "グレー FS36081", "#4f4a46", "10ml", "253円", "半光沢"),
    ("C302", "グリーン FS34092", "#32493f", "10ml", "253円", "半光沢"),
    ("C303", "グリーン FS34102", "#685a33", "10ml", "253円", "半光沢"),
    ("C304", "オリーブドラブ FS34087", "#735a31", "10ml", "253円", "半光沢"),
    ("C305", "グレー FS36118", "#626f68", "10ml", "253円", "半光沢"),
    ("C306", "グレー FS36270", "#8f96a0", "10ml", "253円", "半光沢"),
    ("C307", "グレー FS36320", "#67888f", "10ml", "253円", "半光沢"),
    ("C308", "グレー FS36375", "#8ea3a8", "10ml", "253円", "半光沢"),
    ("C309", "グリーン FS34079", "#504a34", "10ml", "253円", "半光沢"),
    ("C310", "ブラウン FS30219", "#aa7553", "10ml", "253円", "半光沢"),
    ("C311", "グレー FS36622", "#ebead5", "10ml", "253円", "半光沢"),
    ("C312", "グリーン FS34227", "#759975", "10ml", "253円", "半光沢"),
    ("C313", "イエロー FS33531", "#eacfa0", "10ml", "253円", "半光沢"),
    ("C314", "ブルー FS35622", "#eaf4eb", "10ml", "253円", "半光沢"),
    ("C315", "グレー FS16440", "#c9c5aa", "10ml", "253円", "半光沢"),
    ("C316", "ホワイト FS17875", "#fffdee", "10ml", "253円", "半光沢"),
    ("C317", "グレー FS36231", "#877e79", "10ml", "253円", "半光沢"),
    ("C318", "レドーム", "#fcd68d", "10ml", "253円", "半光沢"),
    ("C319", "薄松葉色", "#527249", "10ml", "253円", "半光沢"),
    ("C320", "濃松葉色", "#72694a", "10ml", "253円", "半光沢"),
    ("C321", "黄土色", "#b4936a", "10ml", "253円", "半光沢"),
    ("C322", "フタロシアニンブルー", "#173551", "10ml", "253円", "光沢"),
    ("C323", "ライトブルー", "#00b0ec", "10ml", "253円", "光沢"),
    ("C324", "ライトグレー", "#9ba698", "10ml", "253円", "つや消し"),
    ("C325", "グレー FS26440", "#a6b0a5", "10ml", "253円", "半光沢"),
    ("C326", "ブルー FS15044", "#1e3046", "10ml", "253円", "光沢"),
    ("C327", "レッド FS11136", "#9f2427", "10ml", "253円", "光沢"),
    ("C328", "ブルー FS15050", "#173551", "10ml", "253円", "光沢"),
    ("C329", "イエロー FS13538", "#f7b500", "10ml", "253円", "光沢"),
    ("C330", "ダークグリーン BS381C/641", "#504a34", "10ml", "253円", "半光沢"),
    ("C331", "ダークシーグレー BS381C/638", "#4a585b", "10ml", "253円", "半光沢"),
    ("C332", "ライトエアクラフトグレー BS381C/627", "#c0c0b8", "10ml", "253円", "半光沢"),
    ("C333", "エクストラダークシーグレー BS381C/640", "#58535a", "10ml", "253円", "半光沢"),
    ("C334", "バーリーグレー BS4800/18B21", "#a6bab1", "10ml", "253円", "半光沢"),
    ("C335", "ミディアムシーグレー BS381C/637", "#5e7678", "10ml", "253円", "半光沢"),
    ("C336", "ヘンプ BS4800/10B21", "#698e6c", "10ml", "253円", "半光沢"),
    ("C337", "グレイッシュブルー FS35237", "#90928f", "10ml", "253円", "半光沢"),
    ("C338", "ライトグレー FS36495", "#bdc2c5", "10ml", "253円", "半光沢"),
    ("C339", "エンジングレー FS16081", "#5b4645", "10ml", "253円", "光沢"),
    ("C340", "フィールドグリーン FS34097", "#5b5839", "10ml", "253円", "半光沢"),
    ("C351", "ジンク・クロメイト タイプI FS34151", "#787846", "10ml", "253円", "つや消し"),
    ("C352", "クロメイトイエロープライマー FS33481", "#bca312", "10ml", "253円", "つや消し"),
    ("C361", "ダークグリーン BS641", "#3b3e35", "10ml", "253円", "つや消し"),
    ("C362", "オーシャングレー", "#5b696c", "10ml", "253円", "つや消し"),
    ("C363", "ミディアムシーグレー BS637", "#81949b", "10ml", "253円", "つや消し"),
    ("C364", "エアクラフトグレーグリーン BS283", "#68825f", "10ml", "253円", "つや消し"),
    ("C365", "グロスシーブルー FS15042", "#00011f", "10ml", "253円", "光沢"),
    ("C366", "インターミディエイトブルー FS35164", "#5e798c", "10ml", "253円", "つや消し"),
    ("C367", "ブルーグレー FS35189", "#70929b", "10ml", "253円", "つや消し"),
    ("C368", "スカイ BS381C/210", "#acbd99", "10ml", "253円", "つや消し"),
    ("C369", "ダークアース BS381C/450", "#615233", "10ml", "253円", "つや消し"),
    ("C370", "エイザーブルー", "#5685b1", "10ml", "253円", "つや消し"),
    ("C374", "ダックエッググリーンブルー", "#4f80a9", "10ml", "253円", "半光沢"),
    ("C375", "ディープオーシャンブルー", "#252b45", "10ml", "253円", "半光沢"),
    ("C376", "レドームグレー", "#b6bcb8", "10ml", "253円", "半光沢"),
    ("C383", "暗緑色(川西系)", "#07463d", "10ml", "253円", "半光沢"),
    ("C384", "コクピット色(川西系)", "#7d7f3e", "10ml", "253円", "半光沢"),
    ("C385", "紅色(日本海軍機用)", "#b6000d", "10ml", "253円", "半光沢"),
    ("C391", "機体内部色ターコイズグリーン(ソビエト)", "#01a38b", "10ml", "253円", "半光沢"),
    ("C392", "機体内部色ブルー(ソビエト)", "#159bbe", "10ml", "253円", "半光沢"),
    ("C393", "ロシアンエアクラフトブルー(2)", "#0b0008", "10ml", "253円", "半光沢"),
    ("C394", "ダークグレー FS36176", "#5d616a", "10ml", "253円", "半光沢"),
    ("C395", "ミディアムグレー FS36251", "#919296", "10ml", "253円", "半光沢"),
]


GSI_DETAIL_1_LINEUP = [
    ("C1", None, "#fbfafb"),
    ("C2", None, "#241a18"),
    ("C3", None, "#e30215"),
    ("C4", None, "#fade02"),
    ("C5", None, "#024e9f"),
    ("C6", None, "#0e6f3b"),
    ("C7", None, "#c94435"),
    ("C8", None, "#d0cfce"),
    ("C9", None, "#e5c588"),
    ("C10", None, "#d8ad94"),
    ("C11", None, "#bcafa7"),
    ("C12", None, "#6a4a32"),
    ("C13", None, "#72828a"),
    ("C14", None, "#344142"),
    ("C15", None, "#023920"),
    ("C16", None, "#4d4634"),
    ("C17", None, "#5d5f53"),
    ("C18", None, "#564b48"),
    ("C19", None, "#cf9b5e"),
    ("C20", None, "#a5cebc"),
    ("C21", None, "#b29142"),
    ("C22", None, "#936b4f"),
    ("C23", None, "#897854"),
    ("C25", None, "#9e9b88"),
    ("C26", None, "#d5dfab"),
    ("C27", None, "#b6a819"),
    ("C28", None, "#44383a"),
    ("C29", None, "#5a343b"),
    ("C30", None, "#fbfbfb"),
    ("C31", None, "#9c9794"),
    ("C32", None, "#6c5d56"),
    ("C33", None, "#231917"),
    ("C34", None, "#008cd7"),
    ("C35", None, "#a6b4b5"),
    ("C36", None, "#585a4d"),
    ("C37", None, "#6a5f63"),
    ("C38", None, "#604f38"),
    ("C39", None, "#bf9e5f"),
    ("C40", None, "#19423b"),
    ("C41", None, "#4e3438"),
    ("C42", None, "#3c3034"),
    ("C43", None, "#6a4a31"),
    ("C44", None, "#caa966"),
    ("C45", None, "#ddcd9c"),
    ("C46", None, "#ffffff"),
    ("C47", None, "#e96b4d"),
    ("C48", None, "#fbe374"),
    ("C49", None, "#f1a461"),
    ("C50", None, "#7bcdf1"),
    ("C51", None, "#e6cfb4"),
    ("C52", None, "#65684b"),
    ("C54", None, "#414934"),
    ("C55", None, "#7e5c2e"),
    ("C56", None, "#798a68"),
    ("C57", None, "#53ada5"),
    ("C58", None, "#ee8e03"),
    ("C59", None, "#e64c0b"),
    ("C60", None, "#9d9b8e"),
    ("C61", None, "#a4938b"),
    ("C62", None, "#fbfbfb"),
    ("C63", None, "#ea6e96"),
    ("C64", None, "#15a43b"),
    ("C65", None, "#004098"),
    ("C66", None, "#006e3f"),
    ("C67", None, "#3c2381"),
    ("C68", None, "#d4101b"),
    ("C69", None, "#f4f3f0"),
    ("C70", None, "#5b4d2b"),
    ("C71", None, "#204246"),
    ("C72", None, "#4e678c"),
    ("C73", None, "#8ea3a8"),
    ("C74", None, "#8ca2b9"),
    ("C75", None, "#c37068"),
    ("C76", None, "#6183c0"),
    ("C77", None, "#58ac83"),
    ("C78", None, "#231917"),
    ("C79", None, "#e50215"),
    ("C80", None, "#1e2189"),
    ("C81", None, "#772b33"),
    ("C90", None, "#e9e9e9"),
    ("C92", None, "#231917"),
    ("C97", None, "#d4dccf"),
    ("C100", None, "#8b0e2c"),
    ("C101", None, "#3c2f1f"),
    ("C104", None, "#ebebeb"),
    ("C107", None, "#f3f4f1"),
    ("C108", None, "#ca161f"),
    ("C109", None, "#f18200"),
    ("C110", None, "#004098"),
    ("C111", None, "#fce4d7"),
    ("C112", None, "#f6c0b9"),
    ("C113", None, "#f6ab00"),
    ("C114", None, "#bc121b"),
    ("C115", None, "#8eaea1"),
    ("C116", None, "#403a3a"),
    ("C117", None, "#a7b9b9"),
    ("C118", None, "#81a6b8"),
    ("C119", None, "#936f55"),
    ("C120", None, "#4e411f"),
    ("C121", None, "#585a4d"),
    ("C122", None, "#5c8452"),
    ("C123", None, "#5a5849"),
    ("C124", None, "#014e20"),
    ("C125", None, "#000a23"),
    ("C126", None, "#456442"),
    ("C127", None, "#9d9a55"),
    ("C128", None, "#b2b6a7"),
    ("C129", None, "#44644d"),
    ("C130", None, "#495d42"),
    ("C131", None, "#511d10"),
    ("C132", None, "#685a33"),
    ("C135", None, "#20944b"),
    ("C136", None, "#60603e"),
    ("C137", None, "#4d494a"),
    ("C138", None, "#3fb473"),
    ("C151", None, "#f6f6f1"),
    ("C156", None, "#fffdee"),
    ("C158", None, "#d70d19"),
    ("C159", None, "#efefef"),
    ("C171", None, "#e84a1a"),
    ("C172", None, "#fef001"),
    ("C173", None, "#ed6f35"),
    ("C174", None, "#ee86ab"),
    ("C175", None, "#8bc463"),
    ("C181", None, "#bfd2e6"),
    ("C182", None, "#fdfdfd"),
    ("C183", None, "#fdfdfd"),
    ("C188", None, "#f2f3f5"),
    ("C189", None, "#fdfdfd"),
]


GSI_DETAIL_12_LINEUP = [
    ("GX-101", "GXクリアブラック", "#545c6a"),
    ("GX-102", "GXディープクリアレッド", "#a12a2d"),
    ("GX-103", "GXディープクリアブルー", "#065ba1"),
    ("GX-104", "GXクリアグリーン", "#0b8d49"),
    ("GX-105", "GXクリアピンク", "#cf2f7d"),
    ("GX-106", "GXクリアオレンジ", "#d75314"),
    ("GX-107", "GXクリアパープル", "#55408e"),
    ("GX-108", "GXクリアバイオレット", "#3c2b63"),
    ("GX-109", "GXクリアブラウン", "#a47336"),
    ("GX-110", "GXクリアシルバー", "#c9c8c3"),
    ("GX-111", "GXクリアゴールド", "#c4a560"),
    ("GX-121", "GXクリアルージュ", "#760301"),
    ("GX-122", "GXクリアピーコックグリーン", "#007065"),
]


GSI_DETAIL_21_LINEUP = [
    ("SM-201", "スーパーファインシルバー2", "#dbdadb"),
    ("SM-202", "スーパーゴールド2", "#d3b875"),
    ("SM-203", "スーパーアイアン2", "#c7c7c7"),
    ("SM-204", "スーパーステンレス2", "#cfcfcf"),
    ("SM-205", "スーパーチタン2", "#e1dfe0"),
    ("SM-206", "クロームシルバー2", "#dbdbdb"),
    ("SM-207", "スーパーリッチゴールド", "#e5c115"),
    ("SM-208", "スーパージュラルミン", "#e3e3e3"),
    ("SM-209", "スーパーカッパー", "#d37655"),
    ("SM-210", "スーパーピンクゴールド", "#e0aaaa"),
    ("SM-211", "スーパーレッドゴールド", "#e2a918"),
    ("SM-212", "スーパーマットアルミ", "#e3e3e3"),
]


GSI_DETAIL_102_LINEUP = [
    ("WC09", "シェードブルー", None, "40ml", "528円（税込）"),
    ("WC10", "スポットイエロー", None, "40ml", "528円（税込）"),
    ("WC11", "レイヤーバイオレット", None, "40ml", "528円（税込）"),
    ("WC12", "フェイスグリーン", None, "40ml", "528円（税込）"),
    ("WC13", "グレーズレッド", None, "40ml", "418円（税込）"),
]


GSI_DETAIL_101_LINEUP = [
    ("WC01", "マルチブラック", None, "40ml", "528円（税込）"),
    ("WC02", "グランドブラウン", None, "40ml", "528円（税込）"),
    ("WC03", "ステインブラウン", None, "40ml", "528円（税込）"),
    ("WC04", "サンディウォッシュ", None, "40ml", "528円（税込）"),
    ("WC05", "マルチホワイト", None, "40ml", "528円（税込）"),
    ("WC06", "マルチグレー", None, "40ml", "528円（税込）"),
    ("WC07", "グレイッシュブラウン", None, "40ml", "528円（税込）"),
    ("WC08", "ラストオレンジ", None, "40ml", "528円（税込）"),
    ("WC14", "ホワイトダスト", None, "40ml", "528円（税込）"),
    ("WC15", "ライトグレイッシュ", None, "40ml", "528円（税込）"),
    ("WC16", "オーカーソイル", None, "40ml", "528円（税込）"),
    ("WC17", "マットアンバー", None, "40ml", "528円（税込）"),
    ("WC18", "シェイドブラウン", None, "40ml", "528円（税込）"),
]


GSI_DETAIL_7_LINEUP = [
    ("CR1", "シアン", "#009fe9", "18ml", "264円（税込）", "光沢"),
    ("CR2", "マゼンタ", "#e5007f", "18ml", "264円（税込）", "光沢"),
    ("CR3", "イエロー", "#fff100", "18ml", "264円（税込）", "光沢"),
]


GSI_DETAIL_2877_LINEUP = [
    ("XUC01", "シルバーガルシルバー", "#a1aa9e", "18ml", "418円（税込）", "メタリック"),
    ("XUC02", "シルバーガルレッド", "#a73633", "18ml", "418円（税込）", "半光沢"),
    ("XUC03", "シルバーガルブルー", "#314a63", "18ml", "418円（税込）", "半光沢"),
]


GSI_DETAIL_2504_LINEUP = [
    ("CV01", "ベルベットレッド", "#b44836", "18ml", "660円（税込）", "メタリック"),
    ("CV02", "ベルベットブルー", "#12578c", "18ml", "660円（税込）", "メタリック"),
    ("CV03", "ベルベットグリーン", "#1f826b", "18ml", "660円（税込）", "メタリック"),
]


GSI_DETAIL_111_LINEUP = [
    ("NF01", "ストロベリーピンク", "#e8b0b7", "10ml", "308円（税込）", "つや消し"),
    ("NF02", "ミルキーコーラル", "#eccdc5", "10ml", "308円（税込）", "つや消し"),
    ("NF03", "クリーミーベージュ", "#eadcbf", "10ml", "308円（税込）", "つや消し"),
    ("NF04", "グラスグリーン", "#a8d29f", "10ml", "308円（税込）", "つや消し"),
    ("NF05", "ミントブルー", "#bedecf", "10ml", "308円（税込）", "つや消し"),
    ("NF06", "カシスピンク", "#8f556d", "10ml", "308円（税込）", "つや消し"),
    ("NF07", "ワインレッド", "#a5375c", "10ml", "308円（税込）", "つや消し"),
    ("NF08", "グレイッシュパープル", "#87678d", "10ml", "308円（税込）", "つや消し"),
    ("NF09", "アンティークゴールド", "#7d7341", "10ml", "308円（税込）", "つや消し"),
]


GSI_DETAIL_109_LINEUP = [
    ("BN01", "ベースホワイト", "#ffffff", "18ml", "330円（税込）", "つや消し"),
    ("BN02", "ベースグレー", "#56656c", "18ml", "330円（税込）", "つや消し"),
    ("BN03", "ベースレッド", "#b4293c", "18ml", "330円（税込）", "つや消し"),
    ("BN04", "ベースイエロー", "#f6c03a", "18ml", "330円（税込）", "つや消し"),
    ("BN05", "ベースブルー", "#0076c0", "18ml", "330円（税込）", "つや消し"),
    ("BN06", "ベースグリーン", "#006962", "18ml", "330円（税込）", "つや消し"),
]


GSI_DETAIL_2597_LINEUP = [
    ("NGA01", "ホワイト", "#f0f5f9", "10ml", "385円（税込）", "つや消し"),
    ("NGA02", "ブルー", "#00489c", "10ml", "385円（税込）", "つや消し"),
    ("NGA03", "イエロー", "#fcd35c", "10ml", "385円（税込）", "つや消し"),
    ("NGA04", "レッド", "#ca2222", "10ml", "385円（税込）", "つや消し"),
    ("NGA05", "ブラック", "#585a69", "10ml", "385円（税込）", "つや消し"),
    ("NGA06", "シャアピンク", "#dd6b69", "10ml", "385円（税込）", "つや消し"),
    ("NGA07", "シャアレッド", "#872446", "10ml", "385円（税込）", "つや消し"),
    ("NGA08", "ライトグリーン", "#bfbe8c", "10ml", "385円（税込）", "つや消し"),
    ("NGA09", "グリーン", "#436b4f", "10ml", "385円（税込）", "つや消し"),
    ("NGA10", "ライトグレー", "#d3d3d3", "10ml", "385円（税込）", "つや消し"),
    ("NGA11", "パープル", "#363290", "10ml", "385円（税込）", "つや消し"),
    ("NGA12", "シルバー", "#d9d9d7", "10ml", "385円（税込）", "メタリック"),
    ("NGA13", "ゴールド", "#e4d0a2", "10ml", "385円（税込）", "メタリック"),
    ("NGA14", "グレー", "#74716a", "10ml", "385円（税込）", "つや消し"),
    ("NGA15", "サンドイエロー", "#f2da9b", "10ml", "385円（税込）", "つや消し"),
    ("NGA16", "グランドブラウン", "#85572c", "10ml", "385円（税込）", "つや消し"),
    ("NGA17", "グレイッシュブルー", "#3c769f", "10ml", "385円（税込）", "つや消し"),
    ("NGA18", "コーラルピンク", "#da587a", "10ml", "385円（税込）", "つや消し"),
    ("NGA19", "オレンジ", "#e85b20", "10ml", "385円（税込）", "つや消し"),
    ("NGA20", "エメラルドグリーン", "#17a49c", "10ml", "385円（税込）", "つや消し"),
    ("NGA201", "シェイドブラック", "#231917", "10ml", "385円（税込）", "光沢"),
    ("NGA202", "シェイドブラウン", "#452109", "10ml", "385円（税込）", "光沢"),
    ("NGA203", "シェイドブルー", "#0e6db7", "10ml", "385円（税込）", "光沢"),
    ("NGA204", "シェイドパープル", "#611985", "10ml", "385円（税込）", "光沢"),
]


GSI_DETAIL_2740_LINEUP = [
    ("HM01", "ライトニンググレー1", "#7f8285", "10ml", "308円（税込）", "半光沢"),
    ("HM02", "ライトニンググレー2", "#818489", "10ml", "385円（税込）", "メタリック"),
]


GSI_DETAIL_2596_LINEUP = [
    ("HV01", "ATグリーン", "#79774d", "10ml", "330円（税込）", "半光沢"),
    ("HV02", "ATライトグリーン", "#bebe8b", "10ml", "330円（税込）", "半光沢"),
    ("HV03", "ATブルーグレー", "#68715d", "10ml", "330円（税込）", "半光沢"),
    ("HV04", "ATライトグレー", "#7a7e8b", "10ml", "330円（税込）", "半光沢"),
    ("HV05", "ATダークブルー", "#2a3c51", "10ml", "330円（税込）", "半光沢"),
]


GSI_DETAIL_41_LINEUP = [
    ("HSM01", "スーパーファインシルバー", "#e2e2e4", "10ml", "440円（税込）", "メタリック"),
    ("HSM02", "スーパーファインゴールド", "#d3b875", "10ml", "440円（税込）", "メタリック"),
]


GSI_DETAIL_38_LINEUP = [
    ("HCR1", "シアン", "#00a1e9", "18ml", "330円（税込）", "光沢"),
    ("HCR2", "マゼンタ", "#e5007f", "18ml", "330円（税込）", "光沢"),
    ("HCR3", "イエロー", "#fff100", "18ml", "330円（税込）", "光沢"),
]


GSI_DETAIL_94_LINEUP = [
    ("XHUG01", "ガンダムエアリアル ブルー", "#4f78ba", "10ml", "253円（税込）"),
    ("XHUG02", "ガンダムエアリアル ホワイト", "#fbfcfe", "10ml", "253円（税込）"),
    ("XHUG03", "ガンダムエアリアル グレー", "#898989", "10ml", "253円（税込）"),
    ("XHUG04", "ガンダムルブリス ピンク", "#b21b78", "10ml", "253円（税込）"),
    ("XHUG05", "ガンダムルブリス グレー", "#887f84", "10ml", "253円（税込）"),
    ("XHUG06", "デミトレーナー(チュチュ専用機) イエロー", "#d2d39a", "10ml", "253円（税込）"),
    ("XHUG07", "ダリルバルデ レッド", "#a2362c", "10ml", "253円（税込）"),
    ("XHUG08", "ガンダムファラクト グレー", "#5c6272", "10ml", "253円（税込）"),
    ("XHUG09", "ミカエリス パープル", "#aaa5c3", "10ml", "253円（税込）"),
    ("XHUG10", "ベギルペンデ バイオレット", "#4d4670", "10ml", "253円（税込）"),
    ("XHUG11", "ガンダムルブリスウル グリーン", "#207b77", "10ml", "253円（税込）"),
    ("XHUG12", "ガンダムルブリスソーン ブラウン", "#948475", "10ml", "253円（税込）"),
    ("XHUG13", "ガンダムエアリアル(改修型) ブルー", "#2d486d", "10ml", "253円（税込）"),
]


GSI_DETAIL_2713_LINEUP = [
    ("HLP101", "ステライエロー", "#fcdcaa", "18ml", "440円（税込）", "パール"),
    ("HLP102", "ステラグリーン", "#add6a1", "18ml", "440円（税込）", "パール"),
    ("HLP103", "ステラターコイズ", "#b9e0de", "18ml", "440円（税込）", "パール"),
    ("HLP104", "ステラオレンジ", "#f3caa1", "18ml", "440円（税込）", "パール"),
    ("HLP105", "ステラワインレッド", "#d197a7", "18ml", "440円（税込）", "パール"),
    ("HLP106", "ステラレモンイエロー", "#fef7d6", "18ml", "440円（税込）", "パール"),
    ("HLP107", "ステラローズピンク", "#f0c4cd", "18ml", "440円（税込）", "パール"),
    ("HLP108", "ステラスカイブルー", "#b5dfe6", "18ml", "440円（税込）", "パール"),
    ("HLP109", "ステラジャジーブルー", "#8481b0", "18ml", "440円（税込）", "パール"),
    ("HLP110", "ステラトリリアントパール", "#f6f5ec", "18ml", "440円（税込）", "パール"),
    ("HLP111", "ステラベビーブルー", "#d9e8f1", "18ml", "440円（税込）", "パール"),
    ("HLP112", "ステラパープル", "#c1a6c8", "18ml", "440円（税込）", "パール"),
    ("HLP113", "ステラワカクサグリーン", "#d1e7c4", "18ml", "440円（税込）", "パール"),
    ("HLP114", "ステラアマゾナイト", "#8ecbc8", "18ml", "440円（税込）", "パール"),
    ("HLP115", "ステラカームブルー", "#8d9bc7", "18ml", "440円（税込）", "パール"),
    ("HLP116", "ステラビザンティウム", "#b296af", "18ml", "440円（税込）", "パール"),
    ("HLP117", "ステラピンク", "#e9c6d8", "18ml", "440円（税込）", "パール"),
    ("HLP118", "ステラレッド", "#e79a97", "18ml", "440円（税込）", "パール"),
]


GSI_DETAIL_2595_LINEUP = [
    ("HGQ01", "GQuuuuuuXホワイト", "#e8eef2", "10ml", "308円（税込）", "半光沢"),
    ("HGQ02", "GQuuuuuuXブルー", "#5087a5", "10ml", "308円（税込）", "半光沢"),
    ("HGQ03", "GQuuuuuuXイエロー", "#f39839", "10ml", "308円（税込）", "半光沢"),
    ("HGQ04", "GQuuuuuuXレッド", "#bb0712", "10ml", "308円（税込）", "半光沢"),
    ("HGQ05", "GQuuuuuuXダークグレー", "#49413e", "10ml", "308円（税込）", "半光沢"),
    ("HGQ06", "赤いガンダムピンク", "#dd6b6a", "10ml", "308円（税込）", "半光沢"),
    ("HGQ07", "赤いガンダムレッド", "#9d1e23", "10ml", "308円（税込）", "半光沢"),
]


GSI_DETAIL_88_LINEUP = [
    ("HUG301", "ライジングフリーダムブルー", "#225991", "10ml", "308円（税込）"),
    ("HUG302", "イモータルジャスティスレッド", "#a43440", "10ml", "308円（税込）"),
    ("HUG303", "ブラックナイトスコードブラック", "#161616", "10ml", "308円（税込）"),
    ("HUG304", "ギャンシュトローム(アグネス機)ブルー", "#5069a2", "10ml", "308円（税込）"),
    ("HUG305", "マイティーストライクフリーダムダークブルー", "#1b2046", "10ml", "308円（税込）"),
    ("HUG306", "インフィニットジャスティス弐式ピンク", "#c85171", "10ml", "308円（税込）"),
    ("HUG307", "デュエルブリッツブルーグレー", "#7884ac", "10ml", "308円（税込）"),
    ("HUG308", "ライトニングバスターホワイト", "#f5e8df", "10ml", "308円（税込）"),
    ("HUG309", "デスティニーSpecIIライトグレー", "#aaa8a9", "10ml", "308円（税込）"),
    ("HUG310", "ブラックナイトスコードカルラライトブルー", "#d6e2f0", "10ml", "308円（税込）"),
    ("HUG311", "ゼウスシルエットゴールド", "#c4ba42", "10ml", "440円（税込）", "メタリック"),
]


GSI_DETAIL_87_LINEUP = [
    ("HUG201", "ソードインパルスレッド", "#d61518", "10ml", "253円（税込）"),
    ("HUG202", "ブラストインパルスグリーン", "#2f582c", "10ml", "253円（税込）"),
    ("HUG203", "イザーク専用機スカイブルー", "#70b4b3", "10ml", "253円（税込）"),
    ("HUG204", "ルナマリア専用機ピンク", "#cd1547", "10ml", "253円（税込）"),
    ("HUG205", "レイ専用機パープル", "#ca9fc7", "10ml", "253円（税込）"),
    ("HUG206", "デスティニーレッド", "#c5123a", "10ml", "253円（税込）"),
    ("HUG207", "ライブコンサートピンク", "#ee87b1", "10ml", "253円（税込）"),
    ("HUG208", "ハイネ専用機オレンジ", "#ef7e20", "10ml", "253円（税込）"),
]


GSI_DETAIL_86_LINEUP = [
    ("HUG101", "ソードストライクブルー", "#9aa5d2", "10ml", "253円（税込）"),
    ("HUG102", "ランチャーストライクグリーン", "#12562d", "10ml", "253円（税込）"),
    ("HUG103", "ストライクルージュピンク", "#e1bbd5", "10ml", "253円（税込）"),
    ("HUG104", "ディアクティブホワイト", "#d9d9d9", "10ml", "253円（税込）"),
    ("HUG105", "ディアクティブグレー", "#babbb6", "10ml", "253円（税込）"),
    ("HUG106", "ディアクティブブラック", "#201f1f", "10ml", "253円（税込）"),
    ("HUG107", "フリーダムブルー", "#4574b5", "10ml", "253円（税込）"),
    ("HUG108", "ジャスティスピンク", "#c16b7e", "10ml", "253円（税込）"),
]


GSI_DETAIL_118_LINEUP = [
    ("HMS01", "ボディカラーA", "#f3d6b6", "10ml", "253円（税込）"),
    ("HMS02", "ボディカラーB", "#f9e7cf", "10ml", "253円（税込）"),
    ("HMS03", "ボディカラーC", "#e4ae8a", "10ml", "253円（税込）"),
    ("HMS04", "ペールクリアーレッド", "#fadad3", "10ml", "253円（税込）"),
    ("HMS05", "ペールクリアーオレンジ", "#fbdab2", "10ml", "253円（税込）"),
    ("HMS06", "ペールクリアーブラウン", "#f6b47f", "10ml", "253円（税込）"),
    ("HMS07", "クリアーホワイト", None, "10ml", "253円（税込）"),
    ("HMS08", "スムースパールコート", None, "10ml", "253円（税込）"),
]


GSI_DETAIL_85_LINEUP = [
    ("HUG01", "RX-78-2ガンダムホワイト", "#eef2f7", "10ml", "253円（税込）"),
    ("HUG02", "RX-78-2ガンダムブルー", "#104591", "10ml", "253円（税込）"),
    ("HUG03", "RX-78-2ガンダムイエロー", "#f0ba1a", "10ml", "253円（税込）"),
    ("HUG04", "RX-78-2ガンダムレッド", "#bd2124", "10ml", "253円（税込）"),
    ("HUG05", "シャア専用機ピンク", "#d36868", "10ml", "253円（税込）"),
    ("HUG06", "シャア専用機レッド", "#802345", "10ml", "253円（税込）"),
    ("HUG07", "ファントムグレー", "#06050e", "10ml", "253円（税込）"),
    ("HUG08", "ティターンズブルー1", "#0c0a14", "10ml", "253円（税込）"),
    ("HUG09", "ティターンズブルー2", "#182548", "10ml", "253円（税込）"),
]


GSI_DETAIL_2817_LINEUP = [
    ("HDQ01", "スライムブルー", "#3f98cd", "10ml", "385円（税込）", "光沢"),
    ("HDQ02", "スライムベスオレンジ", "#f39800", "10ml", "385円（税込）", "光沢"),
    ("HDQ03", "ライムスライムグリーン", "#8dc556", "10ml", "385円（税込）", "光沢"),
    ("HDQ04", "ドラキーダークブルー", "#02428e", "10ml", "385円（税込）", "光沢"),
    ("HDQ101", "メタルスライムシルバー", "#e5e6e6", "10ml", "495円（税込）", "メタリック"),
    ("HDQ102", "キラーマシンメタリックライトブルー", "#5bc5e7", "10ml", "440円（税込）", "メタリック"),
    ("HDQ103", "キラーマシンメタリックダークブルー", "#8b80ba", "10ml", "440円（税込）", "メタリック"),
]


GSI_DETAIL_33_LINEUP = [
    ("XC01", "ダイヤモンドシルバー", "#98acbf", "18ml", "330円（税込）", "パール"),
    ("XC02", "トパーズゴールド", "#b0b690", "18ml", "330円（税込）", "パール"),
    ("XC03", "ルビーレッド", "#a26b6e", "18ml", "330円（税込）", "パール"),
    ("XC04", "アメジストパープル", "#7d529d", "18ml", "330円（税込）", "パール"),
    ("XC05", "サファイアブルー", "#3e77ba", "18ml", "330円（税込）", "パール"),
    ("XC06", "トルマリングリーン", "#4fa4a3", "18ml", "330円（税込）", "パール"),
    ("XC07", "ターコイズグリーン", "#1393bb", "18ml", "330円（税込）", "パール"),
    ("XC08", "ムーンストーンパール", "#afbdd0", "18ml", "330円（税込）", "パール"),
]


GSI_DETAIL_2828_LINEUP = [
    ("XAC01", "スティールヘイズ ダークブルー", "#1c357e", "18ml", "495円（税込）", "半光沢"),
    ("XAC02", "スティールヘイズ ダークブラウン", "#231100", "18ml", "495円（税込）", "半光沢"),
]


GSI_DETAIL_16_LINEUP = [
    ("GX201", "GXメタルブラック", "#62646b", "18ml", "308円（税込）", "メタリック"),
    ("GX202", "GXメタルレッド", "#cc6367", "18ml", "308円（税込）", "メタリック"),
    ("GX203", "GXメタルイエロー", "#a49a5e", "18ml", "308円（税込）", "メタリック"),
    ("GX204", "GXメタルブルー", "#3b7db5", "18ml", "308円（税込）", "メタリック"),
    ("GX205", "GXメタルグリーン", "#40a79f", "18ml", "308円（税込）", "メタリック"),
    ("GX206", "GXメタルパープル", "#94749e", "18ml", "308円（税込）", "メタリック"),
    ("GX207", "GXメタルバイオレット", "#7362a5", "18ml", "308円（税込）", "メタリック"),
    ("GX208", "GXラフシルバー", "#a5a6ab", "18ml", "308円（税込）", "メタリック"),
    ("GX209", "GXレッドゴールド", "#af886f", "18ml", "308円（税込）", "メタリック"),
    ("GX210", "GXブルーゴールド", "#a68c69", "18ml", "308円（税込）", "メタリック"),
    ("GX211", "GXメタルイエローグリーン", "#849075", "18ml", "308円（税込）", "メタリック"),
    ("GX212", "GXメタルピーチ", "#975e67", "18ml", "308円（税込）", "メタリック"),
    ("GX213", "GXホワイトシルバー", "#9290a0", "18ml", "308円（税込）", "メタリック"),
    ("GX214", "GXアイスシルバー", "#727990", "18ml", "308円（税込）", "メタリック"),
    ("GX215", "GXメタルブラッディレッド", "#5f2a37", "18ml", "308円（税込）", "メタリック"),
    ("GX216", "GXメタルダークブルー", "#3e4a76", "18ml", "308円（税込）", "メタリック"),
    ("GX217", "GXラフゴールド", "#a5885d", "18ml", "308円（税込）", "メタリック"),
]


GSI_DETAIL_18_LINEUP = [
    ("LG1", "GGXホワイト", "#ffffff", "60ml", "770円（税込）", "光沢"),
    ("LG2", "GGXブラック", "#231916", "60ml", "770円（税込）", "光沢"),
    ("LG112", "GGXクリアーUVカット光沢", "#ffffff", "60ml", "935円（税込）", "光沢"),
    ("LG113", "GGXクリアーUVカットつや消し", "#ffffff", "60ml", "935円（税込）", "つや消し"),
]


GSI_DETAIL_17_LINEUP = [
    ("LAC101", "アルマイトブラック", None, "18ml", "352円（税込）", "半光沢"),
    ("LAC102", "パーカーガンメタリック", None, "18ml", "352円（税込）", "メタリック"),
    ("LAC103", "ステンレスシルバー", None, "18ml", "352円（税込）", "メタリック"),
    ("LAC104", "ガンブルーメタリック", None, "18ml", "440円（税込）", "メタリック"),
    ("LAC105", "フラットダークアース1", None, "18ml", "352円（税込）", "つや消し"),
    ("LAC106", "フラットダークアース2", None, "18ml", "352円（税込）", "つや消し"),
]


GSI_DETAIL_5_LINEUP = [
    ("CL-01", "ホワイトピーチ", "#fbd7bd", "18ml", "264円", "光沢"),
    ("CL-02", "ココアミルク", "#a97f71", "18ml", "264円", "光沢"),
    ("CL-03", "クリアーペールレッド", "#fbdcd5", "10ml", "220円", "光沢"),
    ("CL-04", "クリアーペールオレンジ", "#fcdcb5", "10ml", "220円", "光沢"),
    ("CL-05", "クリアーペールブラウン", "#f6b682", "10ml", "220円", "光沢"),
    ("CL-06", "クリアーホワイト", "#ffffff", "18ml", "264円", "光沢"),
    ("CL-07", "鴇羽色(ときはいろ)", "#f7bcb4", "18ml", "264円", "光沢"),
    ("CL-08", "ナッツホワイト", "#fffcf7", "18ml", "264円", "光沢"),
    ("CL-09", "スムースパールコート", "#ffffff", "18ml", "264円", "パール"),
]


GSI_DETAIL_6_LINEUP = [
    ("CL-101", "ブロンド", "#f3f298"),
    ("CL-102", "栗毛色", "#c4532b"),
    ("CL-103", "濡烏(ぬれがらす)", "#3c3c3e"),
    ("CL-104", "ピンクパープル", "#e799c0"),
    ("CL-105", "ライラック", "#c9a0ca"),
    ("CL-106", "白雪色", "#ffffff"),
    ("CL-107", "亜麻色", "#aba692"),
    ("CL-108", "浅葱色", "#009fad"),
    ("CL-109", "ライムグリーン", "#9ccb61"),
    ("CL-110", "緋色", "#e82663"),
    ("CL-111", "空色", "#6ec2ee"),
]


GSI_DETAIL_2925_LINEUP = [
    ("CL-200", "ゴールドパールベース", "#f6f5ae", "10ml", "260円（税込）", "パール添加剤"),
    ("CL-201", "ストッキングブラック", "#4c4c4c", "10ml", "260円（税込）", "光沢"),
    ("CL-202", "ストッキングブラウン", "#745751", "10ml", "260円（税込）", "光沢"),
    ("CL-203", "ストッキングホワイト", "#f6f6f6", "10ml", "260円（税込）", "光沢"),
]


GSI_DETAIL_2947_LINEUP = [
    ("GGX-1", "ホワイト", "#ffffff", "18ml", "385円", "光沢"),
    ("GGX-2", "ブラック", "#231916", "18ml", "385円", "光沢"),
    ("GGX-3", "ハーマンレッド", "#e60013", "18ml", "385円", "光沢"),
    ("GGX-4", "キアライエロー", "#ffe100", "18ml", "385円", "光沢"),
    ("GGX-5", "スージーブルー", "#004ea2", "18ml", "385円", "光沢"),
    ("GGX-6", "モウリーグリーン", "#006831", "18ml", "385円", "光沢"),
    ("GGX-100", "スーパークリアーIV", "#ffffff", "18ml", "385円", "光沢"),
]


GSI_DETAIL_LINEUPS = {
    "/ja/products/detail/1": GSI_DETAIL_1_LINEUP,
    "/ja/products/detail/2": GSI_DETAIL_2_LINEUP,
    "/ja/products/detail/3": GSI_DETAIL_3_LINEUP,
    "/ja/products/detail/4": GSI_DETAIL_4_LINEUP,
    "/ja/products/detail/5": GSI_DETAIL_5_LINEUP,
    "/ja/products/detail/6": GSI_DETAIL_6_LINEUP,
    "/ja/products/detail/11": GSI_DETAIL_11_LINEUP,
    "/ja/products/detail/13": GSI_DETAIL_13_LINEUP,
    "/ja/products/detail/14": GSI_DETAIL_14_LINEUP,
    "/ja/products/detail/15": GSI_DETAIL_15_LINEUP,
    "/ja/products/detail/16": GSI_DETAIL_16_LINEUP,
    "/ja/products/detail/85": GSI_DETAIL_85_LINEUP,
    "/ja/products/detail/118": GSI_DETAIL_118_LINEUP,
    "/ja/products/detail/86": GSI_DETAIL_86_LINEUP,
    "/ja/products/detail/87": GSI_DETAIL_87_LINEUP,
    "/ja/products/detail/88": GSI_DETAIL_88_LINEUP,
    "/ja/products/detail/2595": GSI_DETAIL_2595_LINEUP,
    "/ja/products/detail/2713": GSI_DETAIL_2713_LINEUP,
    "/ja/products/detail/94": GSI_DETAIL_94_LINEUP,
    "/ja/products/detail/38": GSI_DETAIL_38_LINEUP,
    "/ja/products/detail/41": GSI_DETAIL_41_LINEUP,
    "/ja/products/detail/2596": GSI_DETAIL_2596_LINEUP,
    "/ja/products/detail/2740": GSI_DETAIL_2740_LINEUP,
    "/ja/products/detail/2597": GSI_DETAIL_2597_LINEUP,
    "/ja/products/detail/109": GSI_DETAIL_109_LINEUP,
    "/ja/products/detail/111": GSI_DETAIL_111_LINEUP,
    "/ja/products/detail/2504": GSI_DETAIL_2504_LINEUP,
    "/ja/products/detail/2877": GSI_DETAIL_2877_LINEUP,
    "/ja/products/detail/7": GSI_DETAIL_7_LINEUP,
    "/ja/products/detail/101": GSI_DETAIL_101_LINEUP,
    "/ja/products/detail/102": GSI_DETAIL_102_LINEUP,
    "/ja/products/detail/2817": GSI_DETAIL_2817_LINEUP,
    "/ja/products/detail/33": GSI_DETAIL_33_LINEUP,
    "/ja/products/detail/2828": GSI_DETAIL_2828_LINEUP,
    "/ja/products/detail/17": GSI_DETAIL_17_LINEUP,
    "/ja/products/detail/18": GSI_DETAIL_18_LINEUP,
    "/ja/products/detail/12": GSI_DETAIL_12_LINEUP,
    "/ja/products/detail/21": GSI_DETAIL_21_LINEUP,
    "/ja/products/detail/2925": GSI_DETAIL_2925_LINEUP,
    "/ja/products/detail/2947": GSI_DETAIL_2947_LINEUP,
}


def load_gsi_csv_lineup(filename: str) -> list[tuple[str, str | None, str | None, str | None, str | None, str | None]]:
    path = ROOT / "data" / filename
    if not path.exists():
        return []
    rows = []
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        for row in csv.DictReader(handle):
            rows.append(
                (
                    row.get("code", "").strip(),
                    row.get("name_ja", "").strip() or None,
                    row.get("hex", "").strip() or None,
                    row.get("capacity", "").strip() or None,
                    row.get("price_text", "").strip() or None,
                    row.get("gloss", "").strip() or None,
                )
            )
    return [row for row in rows if row[0]]


def load_gsi_ocr_review_map(filename: str) -> dict[str, tuple[str | None, str | None]]:
    path = ROOT / "data" / filename
    if not path.exists():
        return {}
    rows = {}
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        for row in csv.DictReader(handle):
            item_code = row.get("item_code", "").strip()
            if not item_code:
                continue
            rows[item_code] = (
                row.get("ocr_name_ja", "").strip() or None,
                row.get("ocr_gloss", "").strip() or None,
            )
    return rows


def gsi_product_page_title(text: str) -> str | None:
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    for i, line in enumerate(lines):
        if line == "製品情報":
            for candidate in lines[i + 1 :]:
                if candidate in {"play_circle", "NEW"}:
                    continue
                return candidate
    return None


def split_gsi_creos_products(source: Source, url: str, body: str, text: str) -> list[dict[str, object]]:
    if source.brand != "gsi_creos":
        return []
    parsed_path = urlparse(url).path.rstrip("/")
    lineup = GSI_DETAIL_LINEUPS.get(parsed_path)
    if parsed_path == "/ja/products/detail/35":
        lineup = load_gsi_csv_lineup("gsi_detail_35_review.csv")
    elif parsed_path == "/ja/products/detail/110":
        lineup = load_gsi_csv_lineup("gsi_detail_110_review.csv")
    elif parsed_path == "/ja/products/detail/1" and lineup:
        ocr_review = load_gsi_ocr_review_map("gsi_detail_1_ocr_review.csv")
        lineup = [
            (
                product_no,
                ocr_review.get(product_no, (name_ja, None))[0] or name_ja,
                color_hex,
                capacity,
                price_text,
                ocr_review.get(product_no, (None, gloss))[1] or gloss,
            )
            for product_no, name_ja, color_hex, *rest in lineup
            for capacity, price_text, gloss in [tuple(rest + [None, None, None])[:3]]
        ]
    if not lineup:
        return []

    series = gsi_product_page_title(text) or "Mr.カラーGX"
    paint_type = find_first([r"^((?:溶剤系|水溶性)アクリル樹脂塗料|エマルジョン系水性塗料)$"], text)
    if not paint_type and "Mr.カラー" in series:
        paint_type = "溶剤系アクリル樹脂塗料"
    if not paint_type and parsed_path in {"/ja/products/detail/2817", "/ja/products/detail/85", "/ja/products/detail/118", "/ja/products/detail/86", "/ja/products/detail/87", "/ja/products/detail/88", "/ja/products/detail/2595", "/ja/products/detail/94", "/ja/products/detail/38", "/ja/products/detail/2596"}:
        paint_type = "水性アクリル塗料"
    if not paint_type and parsed_path == "/ja/products/detail/2597":
        paint_type = "エマルジョン系水性塗料"
    price_text = find_first([r"価格(?:（税込み）)?\s*[:：]\s*([0-9０-９,，]+\s*円)"], text)
    price_jpy, tax_included = parse_price(price_text)
    tax_included = 1 if price_text and "円" in price_text else tax_included
    capacity = find_first([r"容量\s*[:：]\s*([0-9.]+\s*(?:ml|mL|ML|g|G))"], text)
    if parsed_path == "/ja/products/detail/12" and not capacity:
        capacity = "18ml"

    products: list[dict[str, object]] = []
    for entry in lineup:
        product_no, name_ja, color_hex = entry[:3]
        item_capacity = (entry[3] if len(entry) > 3 else None) or capacity
        item_price_text = (entry[4] if len(entry) > 4 else None) or price_text
        item_price_jpy, item_tax_included = parse_price(item_price_text)
        item_gloss = (
            entry[5]
            if len(entry) > 5 and entry[5]
            else None if parsed_path == "/ja/products/detail/1" else "光沢"
        )
        products.append(
            {
                "brand": source.brand,
                "brand_prefix": source.brand_prefix,
                "source_url": url,
                "catalog_code": catalog_code(source.brand_prefix, product_no),
                "item_code": product_no,
                "product_no": product_no,
                "name_ja": name_ja,
                "name_en": None,
                "series": series,
                "product_kind": "paint",
                "paint_type": paint_type,
                "capacity": item_capacity,
                "price_text": item_price_text,
                "price_jpy": item_price_jpy if item_price_jpy is not None else price_jpy,
                "tax_included": 1 if item_price_text and "円" in item_price_text else tax_included or item_tax_included,
                "hex": color_hex,
                "gloss": item_gloss,
                "raw_text": f"{product_no}\n({item_gloss or ''})\n{name_ja or ''}",
            }
        )
    return products


def product_from_text(source: Source, url: str, text: str) -> dict[str, object] | None:
    explicit_product_no = find_first(
        [
            r"(?:品番|製品番号|商品番号)\s*[:：]?\s*([A-Za-z0-9][A-Za-z0-9_\- ]{0,24})",
        ],
        text,
    )
    if source.brand == "gaianotes" and not explicit_product_no:
        return None

    product_no = explicit_product_no or find_first(
        [
            r"\b((?:GX|C|H|SM|UG|XGM|T|M|P|E)-?\d{1,4}[A-Za-z]?)\b",
            r"\b([0-9]{3,4})\b",
        ],
        text,
    )
    if not product_no:
        return None

    code = catalog_code(source.brand_prefix, product_no)
    price_text = find_first(
        [
            r"(?:価格|希望小売価格|メーカー希望小売価格)(?:\s*\([^)]*\))?\s*[:：]?\s*([￥¥]?\s*[0-9０-９,，]+\s*(?:円)?[^\n]*)",
            r"([￥¥]\s*[0-9０-９,，]+[^\n]*)",
            r"([0-9０-９,，]+\s*円\s*(?:税込|税込み|税抜)?[^\n]*)",
        ],
        text,
    )
    price_jpy, tax_included = parse_price(price_text)
    capacity = find_first(
        [
            r"(?:内容量|容量)\s*[:：]?\s*([0-9.]+\s*(?:ml|mL|ML|g|G|本)[^\n]*)",
            r"\b([0-9.]+\s*(?:ml|mL|ML|g|G))\b",
        ],
        text,
    )
    product_kind = "solvent" if re.search(r"うすめ液|溶剤|ツールクリーナー|リターダー", text) else "paint"

    return {
        "brand": source.brand,
        "brand_prefix": source.brand_prefix,
        "source_url": url,
        "catalog_code": code,
        "item_code": None,
        "product_no": normalize_product_no(product_no),
        "name_ja": guess_name(text),
        "name_en": None,
        "series": page_series(text),
        "product_kind": product_kind,
        "capacity": capacity,
        "price_text": price_text,
        "price_jpy": price_jpy,
        "tax_included": tax_included,
        "hex": None,
        "gloss": None,
        "raw_text": text,
    }


def products_from_page(source: Source, url: str, body: str, text: str) -> list[dict[str, object]]:
    brand_products = split_gsi_creos_products(source, url, body, text)
    if brand_products:
        return brand_products
    brand_products = split_bornpaint_products(source, url, body, text)
    if brand_products:
        return brand_products
    brand_products = split_finishers_products(source, url, body, text)
    if brand_products:
        return brand_products
    brand_products = split_vallejo_products(source, url, body, text)
    if brand_products:
        return brand_products
    brand_products = split_tamiya_products(source, url, body, text)
    if brand_products:
        return brand_products
    brand_products = split_modelkasten_products(source, url, body, text)
    if brand_products:
        return brand_products
    if source.brand in {"bornpaint", "finishers", "vallejo", "tamiya", "modelkasten"}:
        return []
    split_products = split_gaianotes_products(source, url, body, text)
    if split_products:
        return split_products
    product = product_from_text(source, url, text)
    return [product] if product else []


def upsert_page(conn: sqlite3.Connection, source: Source, url: str, status: int, body: str, text: str) -> None:
    digest = hashlib.sha256(body.encode("utf-8", errors="replace")).hexdigest()
    conn.execute(
        """
        INSERT INTO crawl_pages (brand, url, status_code, content_hash, html, text)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(url) DO UPDATE SET
          brand=excluded.brand,
          status_code=excluded.status_code,
          fetched_at=CURRENT_TIMESTAMP,
          content_hash=excluded.content_hash,
          html=excluded.html,
          text=excluded.text
        """,
        (source.brand, url, status, digest, body, text),
    )


def upsert_product(conn: sqlite3.Connection, product: dict[str, object]) -> None:
    fields = list(product.keys())
    placeholders = ", ".join("?" for _ in fields)
    updates = ", ".join(f"{field}=excluded.{field}" for field in fields if field != "catalog_code")
    conn.execute(
        f"""
        INSERT INTO official_products ({", ".join(fields)})
        VALUES ({placeholders})
        ON CONFLICT(catalog_code) DO UPDATE SET {updates}, extracted_at=CURRENT_TIMESTAMP
        """,
        tuple(product[field] for field in fields),
    )


def crawl_source(conn: sqlite3.Connection, source: Source, sleep_seconds: float) -> tuple[int, int]:
    queued: list[tuple[str, int]] = [(url, 0) for url in source.start_urls]
    seen: set[str] = set()
    page_count = 0
    product_count = 0
    conn.execute("DELETE FROM official_products WHERE brand = ?", (source.brand,))
    conn.execute("DELETE FROM crawl_pages WHERE brand = ?", (source.brand,))
    conn.commit()

    while queued:
        url, depth = queued.pop(0)
        url = canonical_url(url)
        if url in seen:
            continue
        seen.add(url)
        if not allowed_link(source, url):
            continue

        print(f"[{source.brand}] fetch {url}")
        try:
            status, body = fetch_url(url)
        except Exception as exc:
            print(f"[{source.brand}] failed {url}: {exc}")
            continue

        text, links = parse_page(url, body)
        upsert_page(conn, source, url, status, body, text)
        page_count += 1

        products = products_from_page(source, url, body, text)
        for product in products:
            upsert_product(conn, product)
            product_count += 1

        if depth < source.max_depth:
            for link in sorted(links):
                link = canonical_url(link)
                if link not in seen and allowed_link(source, link):
                    queued.append((link, depth + 1))

        conn.commit()
        time.sleep(sleep_seconds)

    return page_count, product_count


def extract_cached_source(conn: sqlite3.Connection, source: Source) -> tuple[int, int]:
    conn.execute("DELETE FROM official_products WHERE brand = ?", (source.brand,))
    rows = conn.execute(
        "SELECT url, html, text FROM crawl_pages WHERE brand = ? ORDER BY url",
        (source.brand,),
    ).fetchall()
    product_count = 0
    for row in rows:
        products = products_from_page(source, row["url"], row["html"], row["text"])
        for product in products:
            upsert_product(conn, product)
            product_count += 1
    conn.commit()
    return len(rows), product_count


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    parser.add_argument("--db", type=Path, default=DEFAULT_DB)
    parser.add_argument("--brand", choices=["gsi_creos", "gaianotes", "finishers", "bornpaint", "vallejo", "tamiya", "modelkasten"])
    parser.add_argument("--sleep", type=float, default=1.0)
    parser.add_argument("--extract-only", action="store_true", help="rebuild official_products from saved crawl_pages without fetching")
    args = parser.parse_args()

    sources = load_sources(args.config)
    if args.brand:
        sources = [source for source in sources if source.brand == args.brand]

    conn = connect(args.db)
    total_pages = 0
    total_products = 0
    for source in sources:
        if args.extract_only:
            pages, products = extract_cached_source(conn, source)
        else:
            pages, products = crawl_source(conn, source, args.sleep)
        total_pages += pages
        total_products += products

    print(f"saved pages={total_pages} product_candidates={total_products} db={args.db}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
