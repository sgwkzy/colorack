#!/usr/bin/env python3
"""
lib/paintType.ts の paintTypeIcon の判定順を、実カタログの paint_type 全値に対して
検証する。判定は includes の逐次評価なので順序が意味を持つ(エマルジョン系水性塗料は
'水性' も含むため、エマルジョンを先に見ないと Ac に落ちる)。

使い方: python scripts/check_paint_type_badges.py
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SEED = ROOT / "assets" / "seed_catalog.json"
SRC = ROOT / "lib" / "paintType.ts"

EXPECTED = {
    "ラッカー塗料": "La",
    "水性アクリル塗料": "Ac",
    "エマルジョン系水性塗料": "Em",
    "エナメル塗料": "En",
    None: None,
}


def rules_from_source() -> list[tuple[list[str], str]]:
    """paintTypeIcon の if 行を上から読み、(部分文字列群, 略号) の順序付きリストにする。"""
    body = SRC.read_text(encoding="utf-8").split("export function paintTypeIcon")[1]
    body = body.split("return null;\n}")[0]
    rules = []
    for line in body.splitlines():
        m = re.search(r"return '(\w+)';", line)
        if not m or "!pt" in line:
            continue
        rules.append((re.findall(r"pt\.includes\('([^']+)'\)", line), m.group(1)))
    return rules


def icon(pt: str | None, rules) -> str | None:
    if not pt:
        return None
    for needles, code in rules:
        if any(n in pt for n in needles):
            return code
    return None


def main() -> int:
    rules = rules_from_source()
    assert rules, "paintTypeIcon の判定行を読み取れなかった"

    values = {r["paint_type"] for r in json.loads(SEED.read_text(encoding="utf-8"))}
    unknown = values - set(EXPECTED)
    if unknown:
        print(f"NG: カタログに未知の paint_type がある: {sorted(unknown)}")
        print("    EXPECTED とこのスクリプトを更新すること。")
        return 1

    failed = False
    for pt in sorted(values, key=lambda v: (v is None, v)):
        got, want = icon(pt, rules), EXPECTED[pt]
        mark = "ok " if got == want else "NG "
        if got != want:
            failed = True
        print(f"  {mark}{pt or '(なし)':<20} -> {got} (期待 {want})")

    print("NG あり" if failed else "全て期待どおり")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
