# 公式カタログのリモート配信手順

アプリを再ビルドせずに公式カタログ(塗料マスターデータ)を更新するための手順。CI/CDは未構築のため、すべて手動で行う。

## 前提

- `data/official_catalog.sqlite3`(gitignore対象)が最新の状態であること。カタログの追加・修正自体は `scripts/crawl_official_catalog.py` 等の既存フローに従う。
- `gh` CLI がログイン済みであること。
- 配布するバージョン番号は、**その時点でアプリにバンドルされている `lib/db.ts` の `SEED_VERSION` より必ず大きい値**にすること(端末側は `新バージョン > 端末の適用済みバージョン` で更新要否を判定するため、逆転させると永久に配信されなくなる)。

## 公開

次の1コマンドでSQLite生成・GitHub Release公開・`latest.json`更新・commit/pushまで実行する。

```
python scripts/publish_catalog_release.py --version 20 --notes "変更内容の概要"
```

`data/official_catalog.sqlite3` はGit管理外のローカルソースのため、GitHub Actionsではなくこのスクリプトを使う。

## 手動手順(障害時のみ)

1. 配布用の軽量SQLiteファイルを生成する(バージョン番号は連番でインクリメント):

   ```
   python scripts/generate_catalog_release_db.py --version 19
   ```

   標準出力に `version` / `row_count` / `size_bytes` / `md5` / `path` のJSONが出る。この値を次の手順で使う。

2. 生成された `dist/catalog_release.sqlite3` をGitHub Releaseのアセットとしてアップロードする(タグは `catalog-v<version>` の形式で統一):

   ```
   gh release create catalog-v19 dist/catalog_release.sqlite3 --title "Catalog v19" --notes "変更内容の概要"
   ```

3. アセットのダウンロードURLを確認する(通常は次の形式になる):

   ```
   https://github.com/sgwkzy/colorack/releases/download/catalog-v19/catalog_release.sqlite3
   ```

4. `catalog-releases/latest.json` を手順1・3の値で更新する:

   ```json
   {
     "version": 19,
     "sqlite_url": "https://github.com/sgwkzy/colorack/releases/download/catalog-v19/catalog_release.sqlite3",
     "md5": "<手順1の md5>",
     "size_bytes": <手順1の size_bytes>,
     "row_count": <手順1の row_count>,
     "released_at": "<ISO8601形式の現在日時>",
     "notes": "変更内容の概要"
   }
   ```

5. `catalog-releases/latest.json` の変更を `master` ブランチにコミット・プッシュする。これにより `https://raw.githubusercontent.com/sgwkzy/colorack/master/catalog-releases/latest.json` が更新され、アプリからの参照が新しいバージョンを指すようになる。

   **注意**: `raw.githubusercontent.com` はCDNで数分程度キャッシュされることがある。反映確認を急ぐ場合は `?t=<timestamp>` のようなクエリを付けてキャッシュを回避する。

6. アプリの設定画面(またはアプリ再起動後の自動チェック)で「更新を確認」→「今すぐ更新」を実行し、意図した内容が反映されることを実機で確認する。

## ロールバック

誤ったバージョンを配信してしまった場合は、`catalog-releases/latest.json` の `version` を古い値(または以前の正しいリリースの値)に戻してコミット・プッシュすれば、以降の端末は新しい誤配信を取得しなくなる。既に誤ったデータを取り込んでしまった端末を戻すには、正しい内容の新しいバージョン(例: v19が誤りならv20として作り直す)を配信し直す。バージョン番号を後退させて同じ番号を再利用しない。

## 補足: このスクリプトと `generate_seed_catalog.py` の違い

| | `generate_seed_catalog.py` | `generate_catalog_release_db.py` |
|---|---|---|
| 出力 | `assets/seed_catalog.json`(アプリ同梱) | `dist/catalog_release.sqlite3`(配信専用、gitignore対象) |
| 反映方法 | アプリを再ビルド・再配布 | GitHub Releaseへのアップロードのみ、再ビルド不要 |
| バージョン管理 | `lib/db.ts` の `SEED_VERSION` を手動で上げる | `PRAGMA user_version` にCLI引数で埋め込む |

両スクリプトの行選択・変換ロジックは意図的に別々に保持している(どちらかの変更がもう一方に影響しないようにするため)。
