# Colorack

模型塗料の在庫を管理する Expo (React Native) 製の iOS アプリ。

## 主な機能

- 塗料カタログ(Mr.カラー/ガイアノーツ/タミヤ/ファレホ/フィニッシャーズ/ボーンペイントなど)から在庫を登録
- 保管箱(ボックス)ごとの在庫管理、在庫/使用中/使用済のステータス管理
- お気に入り・買い物リスト
- バーコードスキャン/カメラで色を撮影してHEX値を取得/近似色検索(ΔE)による色マッチング
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

塗料カタログは `data/official_catalog.sqlite3`(クロール結果、git管理外)を元に生成しています。

```bash
python scripts/crawl_official_catalog.py   # 各メーカーサイトをクロールして official_catalog.sqlite3 を更新
python scripts/generate_seed_catalog.py    # official_catalog.sqlite3 から assets/seed_catalog.json を再生成
```

シード内容を変更したら `lib/db.ts` の `SEED_VERSION` を上げてください(既存端末でも再シードされます)。

## ディレクトリ構成

- `app/` — expo-router の画面(タブ: 保管箱/お気に入り/買い物リスト/設定)
- `components/` — 塗料追加フロー(手動登録/バーコード/近似色検索/カメラ)、各種モーダル
- `lib/` — DB(`db.ts`)、色変換(`color.ts`)、i18n(`i18n.ts`)、ラベル表示ヘルパー
- `scripts/` — カタログクロール・シード生成用の Python スクリプト
- `data/` — クロール生成物(git管理外)
