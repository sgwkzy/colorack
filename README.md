# Colorack

模型塗料の在庫を管理する Expo (React Native) 製の iOS / Android アプリ。

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

`catalog_paints` の内部一意キーは `catalog_code`(= `brand|series|code`)。品番(`code`)は
ブランドをまたいで重複する上、同一ブランド内でもシリーズをまたいで再利用される
(例: タミヤ `X-1` はエナメル/アクリルミニ両方に存在)ため、表示用の `code` 単体では
一意にならない。手動登録・編集フォームも `catalogCode()` で同じキーを書き込んでおり、
重複時は UNIQUE 制約違反を「同じブランド内に同じ品番が既に登録されています」として表示する。

## ディレクトリ構成

- `app/` — expo-router の画面(タブ: 保管箱/お気に入り/買い物リスト/設定)
- `components/` — 塗料追加フロー(手動登録/バーコード/近似色検索/カメラ)、各種モーダル
- `lib/` — DB(`db.ts`)、色変換(`color.ts`)、i18n(`i18n.ts`)、ラベル表示ヘルパー
- `scripts/` — カタログクロール・シード生成用の Python スクリプト
- `data/` — クロール生成物(git管理外)
- `docs/privacy.html` — ストア掲載用プライバシーポリシー(GitHub Pagesで公開: https://sgwkzy.github.io/colorack/privacy.html)

## Android ビルド・ストア公開

パッケージ名・AdMob ID は `.env`(git管理外)で管理し、`app.config.js` が読み込む。
EAS のクラウドビルドはローカルの `.env` を見ないため、同じ値を EAS 側にも登録済み
(`eas env:create --scope project ...`、environment=production)。

```powershell
. $PROFILE; $env:Path = "$env:APPDATA\npm;$env:Path"
npx eas-cli build --platform android --profile production --non-interactive
```

`eas.json` の `cli.appVersionSource` は `local` とし、`app.config.js` の
`android.versionCode` を手動でインクリメントする運用(EAS のリモート自動採番は
対話コマンドが必須で自動化しづらいため見送った)。ビルドごとに `versionCode` を
1つ上げてから実行すること。

ストア掲載アセット(`assets/store-icon-512.png` / `assets/store-feature-graphic.png`)は
`assets/icon.png` から生成したもの。

Google Play は個人開発者アカウントに「クローズドテストを12人以上・14日間」の
実施を義務付けており、これを満たすまで本番トラックへは公開できない。
