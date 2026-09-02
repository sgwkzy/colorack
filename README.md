# Colorack

模型塗料の在庫を管理する Expo (React Native) 製の iOS / Android アプリ。

## 主な機能

- 塗料カタログ(Mr.カラー/ガイアノーツ/タミヤ/ファレホ/フィニッシャーズ/ボーンペイントなど)から在庫を登録
- 保管箱(ボックス)ごとの在庫管理、在庫/使用中/使用済のステータス管理
- お気に入り・買い物リスト
- カメラで色を撮影してHEX値を取得/近似色検索(ΔE)による色マッチング
- 日本語/英語ロケール切り替え(塗料名・シリーズ名の英語表示にも対応)
- AdMobバナー広告

## 技術スタック

- Expo SDK ~54 / React Native / expo-router
- expo-sqlite(端末内DB) + `assets/seed_catalog.json`(初期カタログシード)
- expo-camera / expo-image-manipulator(カメラでの色取得)
- i18n-js(日本語/英語)

## セットアップ

```bash
npm install
```

## 起動

Expo Go で動作確認する場合(ネイティブビルド不要):

```bash
npm run start:go
```

dev client(AdMob等のネイティブモジュールを含む本番相当ビルド)で動作確認する場合:

```bash
npm start
```

## カタログデータの更新

塗料カタログの正規データはcatalogプロジェクトで管理します。この開発プロジェクトには、catalogプロジェクトで検証・生成したシードをレビュー済みの変更として取り込みます。

```bash
# catalogプロジェクトのルートで実行
python scripts/validate_catalog.py data/db/official_catalog.sqlite3
python scripts/generate_seed_catalog.py    # dist/seed_catalog.json を生成
```

生成された `dist/seed_catalog.json` は、この開発プロジェクトの `assets/seed_catalog.json` へレビュー済みの変更として取り込みます。配布用DBの公開は [`catalog-release-runbook.md`](docs/catalog-release-runbook.md) に従います。

シード内容を変更したら `lib/db/types.ts` の `SEED_VERSION` を上げてください(既存端末でも再シードされます)。

`catalog_paints` の内部一意キーは `catalog_code`(= `brand|series|code`)。品番(`code`)は
ブランドをまたいで重複する上、同一ブランド内でもシリーズをまたいで再利用される
(例: タミヤ `X-1` はエナメル/アクリルミニ両方に存在)ため、表示用の `code` 単体では
一意にならない。手動登録・編集フォームも `catalogCode()` で同じキーを書き込んでおり、
重複時は UNIQUE 制約違反を「同じブランド内に同じ品番が既に登録されています」として表示する。

## ディレクトリ構成

- `app/` — expo-router の画面(タブ: 保管箱/お気に入り/買い物リスト/設定)
- `components/` — 塗料追加フロー(手動登録/階層ブラウズ/テキスト検索/近似色検索/カメラ)、各種モーダル
- `lib/` — DB(`db/`)、色変換(`color.ts`)、i18n(`i18n.ts`)、ラベル表示ヘルパー
- `scripts/` — カタログクロール・シード生成用の Python スクリプト
- `data/` — カタログ生成時のローカル入力(git管理外)
- `docs/privacy.html` — ストア掲載用プライバシーポリシー(GitHub Pagesで公開: https://sgwkzy.github.io/colorack/privacy.html)

## アプリリリース

バージョン確認、ビルド前検証、既存端末の移行確認、TestFlight／Google Play内部テスト、
ストア公開の承認境界は [アプリリリース手順](docs/app-release-runbook.md) に集約しています。
本番ビルド・ストア提出・公開は、手順書に記載したOPS担当の承認を得て実施してください。
