# Colorack アプリリリース手順

Colorack の GitHub `main` にある承認済みコミットから、iOS / Android のストア向けビルドを作成し、各ストアへ提出するための運用手順。

直前のリリース実績はバージョン `1.1.9`（iOS build `17` / Android versionCode `17`）です。今回の候補バージョン・ビルド番号は、DEVで承認されたコミットの `app.json` を正として、手順2でリリース直前に確認します。

## リリース範囲

- iOS の Submit は App Store Connect / TestFlight へのアップロードまで行う。App Store の審査提出・公開は別承認とする。
- Android の Submit は Google Play の内部テストトラックへのアップロードまで行う。製品版への昇格・公開は別承認とする。
- 今回の機能には、混色シミュレーター、保存済み混色、キット使用色、購入候補の使用色・写真、クラウドバックアップ、キット写真が含まれる。
- 公式カタログだけを更新する場合は、この手順ではなく [`catalog-release-runbook.md`](./catalog-release-runbook.md) を使用する。

アプリ同梱カタログの現行 `SEED_VERSION` は `21` です。リモートカタログだけを更新する場合は、アプリ同梱シードの更新と混同せず、カタログ用ランブックを使用します。

2026年9月2日時点で `catalog-releases/latest.json` は v18（アプリ同梱シード v21 より古い）を指しています。今回のバイナリは同梱シード v21 を基準にし、リモートカタログを同時公開する場合だけ、カタログプロジェクト／OPSでシード v21 より大きいSQLite、GitHub Releaseの実アセット、MD5・サイズ・行数が一致する `latest.json` を検証してください。この準備では、未検証のカタログデータやマニフェストを変更しません。

## 今回の候補に含まれる機能

- 混色シミュレーター（保存・編集・並び替え）
- Kitrackのキット使用色（買い物リスト候補を含む）
- キット写真の複数管理とクラウドバックアップ
- Firebase認証、Firestoreバックアップ、RevenueCatサブスクリプション
- アプリ内蔵カタログシード `SEED_VERSION = 21`

候補に含めない機能や未承認の変更が混在していないことを、リリース元のコミットと実機確認で確定する。

## 必要な権限と認証情報

- Expo アカウント `sgwkzy` の Colorack プロジェクトへアクセスできること。
- Apple Developer / App Store Connect の Colorack アプリへアクセスできること。
- Google Play Console のデベロッパーアカウント「スガワラボ」へアクセスできること。
- Android Submit 用サービスアカウント `colorack-eas-submit@colorack-7e436.iam.gserviceaccount.com` が、Colorack に対する製品版・テスト版リリース権限を持つこと。
- 上記サービスアカウントの JSON キーが EAS の Android Service Credentials に登録済みであること。
- Production 用の EAS 環境変数・ファイル変数が登録済みであること。少なくとも Firebase 設定、RevenueCat SDK Key、AdMob ID、Bundle ID / Package 名を確認する。

秘密鍵、Firebase設定ファイル、RevenueCatの秘密APIキー、サービスアカウントJSONキーをGit、Issue、チャットへ貼り付けない。EASの値は名前だけ確認し、値を作業記録へ残さない。

Android Service Credentials が未登録の場合だけ、明示的な認証情報変更の承認を得て次を実行する。

```powershell
npx eas-cli@latest credentials --platform android
```

`production` → `Google Service Account` → `Upload a Google Service Account Key` を選び、リポジトリ外に置いた `colorack-eas-submit` のJSONキーを指定する。RevenueCat用サービスアカウントをSubmitに流用しない。

## 1. リリース元を確定する

OPS ワークスペース `F:\ai_works\products\colorack\ops` で、次を確認する。

```powershell
git branch --show-current
git status --short
git pull --ff-only origin main
git rev-parse HEAD
```

次の条件をすべて満たさない場合はビルドしない。

- ブランチが `main`
- アプリ資材・リリース設定に未コミット変更がない
- リリース対象として承認されたコミットと `HEAD` が一致する
- 今回の候補に含めない未承認機能や設定変更が混在していない

OPS 固有のローカルガードである `AGENTS.md` と `.codex/` だけは差分として残る場合がある。内容を破棄せず、それ以外の差分がないことを `git status --short` で確認して作業記録へ残す。

## 2. バージョンを準備する（DEV作業）

バージョン変更はアプリ資材の変更なので OPS では行わず、DEV 側で実施して `main` へ反映する。

このリリース準備では、ストアのビルド番号を消費する変更や値のインクリメントを行わない。ビルド直前に、承認済み候補の `app.json` から次の値を読み取り、直前のストア値と比較する。

`app.json` の次の値を確認する。

- `expo.version`: ストア表示用バージョン
- `expo.android.versionCode`: 直前の Google Play リリースより大きい整数
- `expo.ios.buildNumber`: 直前の App Store Connect ビルドより大きい値。`eas.json` の `autoIncrement` を使う場合はビルド結果も確認する

同じ `versionCode` / `buildNumber` は再利用できない。失敗したビルドでも番号が消費されている場合があるため、ストアと EAS の最新値を確認する。

## 3. ビルド前検証

```powershell
npm ci
npm run test
npm run typecheck
npx expo-doctor
npx expo config --type public --json
npx expo export --platform ios --output-dir .release-check-ios
npx eas-cli@latest env:list --environment production
```

`expo export` 成功後は生成された `.release-check-ios` を削除します。現行のExpo `~54.0.36`固定に対して `expo-doctor` がパッチ差分を報告する場合は、警告として記録し、解消だけを目的にSDKや依存関係を更新しません。

ローカルの非EAS実行では `app.config.js` のフォールバック値（`com.example.*` やテスト用AdMob値）が解決されます。ストア提出物の確認には使わず、EAS `production` 環境で解決された設定を確認します。

公開設定で次を確認する。

- iOS Bundle Identifier: `com.sugawalabo.colorack`
- Android Package: `com.sugawalabo.colorack`
- `version` / `buildNumber` / `versionCode` が今回のリリース値
- `eas.json` の Android Submit 先が `internal`
- `npm audit --omit=dev` のHigh/Criticalは、今回の本番実行経路への影響とリスク受容を確認する。監査のためだけにExpo SDKをメジャー更新しない
- `expo-doctor` の警告は、固定している Expo `~54.0.36` との関係を確認して記録する。2026年9月2日時点では Expo `54.0.37`、`expo-constants` `~18.0.14`、`expo-file-system` `~19.0.24` が推奨されるが、候補は `~54.0.36` 系を維持する。警告を消すためだけにExpoやReact Nativeを自動更新しない
- Production 環境に必要な変数名が存在する（秘密値そのものは出力・記録しない）

## リリース前の手動確認（必須）

本番ビルド・提出へ進む前に、DEVで実施した確認結果と、OPSで確認する結果を分けて記録する。未確認の項目がある場合はリリース候補を承認しない。

### 既存端末の移行

旧バージョンをインストールしたiOS/Androidの検証端末へ、候補ビルドを上書きインストールする。次を移行前後で確認する。

- 既存の塗料、在庫、Box、キット、キット写真
- 買い物リスト候補と候補の使用色
- キットの使用色（塗料、保存済み混色、キット専用の新規混色）
- 保存済み混色、配合率、編集、削除、並び順
- 起動後の初期Box／キットBox、ステータス、戻る操作、モーダル操作
- 移行失敗後の再起動でデータが欠落せず、移行が再実行できること

### カタログとクラウド

- 内蔵カタログの件数、代表色、色形式、シードバージョン21を確認する。
- リモートカタログを同時公開する場合は、`catalog-releases/latest.json` が内蔵シード21より大きいバージョン（次回は22以上）であること、URL、行数、MD5、サイズが実物と一致し、端末から更新・再起動できることを確認する。バイナリだけをリリースする場合は、現在の v18 マニフェストを変更せず、同梱シード v21 と混同しない。
- Firebaseログイン、バックアップ、復元、アカウント切替、アカウント削除を検証する。
- Standardプランのキット写真バックアップと復元、Lightプラン／解約後の写真メタデータ挙動を確認する。
- RevenueCatのエンタイトルメント、Paywall、購入復元、広告非表示の状態をiOS/Androidで確認する。

### 本番設定と配布

値そのものを記録せず、EAS production環境に必要な変数名・ファイル変数が存在することだけ確認する。

- Firebase Web Client ID、iOS/Android Firebase設定ファイル
- iOS/Android RevenueCat Public SDK Key
- iOS/Android AdMob App ID・バナー広告ID
- Bundle Identifier、Android Package、Apple Team/App ID、Android Submit Service Credentials
- iOS TestFlightでの起動・主要操作・データ保持
- Android Google Play内部テストでの起動・主要操作・データ保持

## 4. iOS / Android をビルドする

```powershell
npx eas-cli@latest build --platform all --profile production --non-interactive --wait --message "Colorack <version>"
```

両方が成功したことを確認し、次を作業記録へ残す。

- Git commit SHA
- アプリバージョン
- iOS Build ID / buildNumber / IPA URL
- Android Build ID / versionCode / AAB URL

iOS の `autoIncrement` により `app.json` の `buildNumber` が更新された場合は、DEV 側でその変更だけをコミットして `main` へ Push する。

## 5. iOS をTestFlightへ提出する

```powershell
npx eas-cli@latest submit --platform ios --id <IOS_BUILD_ID> --profile production --non-interactive --wait
```

成功条件は EAS Submission が完了し、App Store Connect の TestFlight に同じバージョン / buildNumber が表示されること。Apple 側の処理には時間がかかる場合がある。

## 6. Androidを内部テストへ提出する

```powershell
npx eas-cli@latest submit --platform android --id <ANDROID_BUILD_ID> --profile production --non-interactive --wait
```

成功条件は EAS Submission が `COMPLETED` となり、Google Play Console の内部テストに同じ versionCode が表示されること。

サービスアカウントエラーの場合は、EAS Dashboard の Colorack → Credentials → Android → Service Credentials を確認する。RevenueCat 用サービスアカウントを Submit に流用しない。

## 7. 提出後確認

- EAS の Build / Submission URLを作業記録へ残す。
- TestFlight で処理完了とインストール可否を確認する。
- Google Play 内部テストでリリース状態と AAB の versionCode を確認する。
- スモーク確認として、起動、主要画面、端末内データ保持、広告表示を実機で確認する。
- リリース範囲外の未承認機能が本番ビルドで有効になっていないことを確認する。

## 承認境界

Production EAS Build、iOS TestFlightへのUpload、Android内部テストへのUpload、ストア審査提出、製品公開はOPS担当の作業とし、それぞれ明示的な承認を得てから実行する。このDEV手順では本番秘密情報の登録・変更、課金設定の変更、ストア公開を行わない。

## 保留中の運用確認

次の作業はこのリポジトリの準備変更に含めず、運用担当が証跡を残して実施する。

- リモートカタログを同時公開する場合は、GitHub Releaseと `catalog-releases/latest.json` を確認する。公開版は内蔵シード `21` より大きいバージョンで、`catalog_release.sqlite3` のURL・MD5・サイズ・行数が実物と一致している必要がある。バイナリだけをリリースする場合は、v18のマニフェストを更新せず、同梱シード v21をリモート更新と取り違えない
- 本番EAS環境変数・Firebaseファイル変数・Android Service Credentialsの存在確認
- RevenueCat商品、entitlement、Paywall、Firebase Extension、Rulesの本番設定確認
- App Store Connect / Google Play Consoleのストア掲載情報、プライバシー申告、年齢区分、データ安全性申告の入力
- プライバシーポリシーの連絡先・事業者情報・保持期間の最終確認
- 実機の既存DB移行、写真復元、アカウント切り替え、課金サンドボックス確認
- Google Play内部テストの公開とテスター要件の確認
- ストア審査提出および製品版公開

## 8. 製品公開

TestFlight / 内部テストで確認後、別途明示的な承認を得てから各ストアで審査提出・製品公開を行う。Submit の成功を製品公開完了として扱わない。

## 障害時の扱い

- Build 失敗: EAS Build URL とログ、commit SHA、platform、失敗箇所を記録し、コードまたは設定の問題はDEVへ戻す。
- Submit 失敗: Build を作り直す前に、ストア権限、サービス資格情報、versionCode / buildNumber の重複を確認する。
- Google Play 権限エラー: `colorack-eas-submit@colorack-7e436.iam.gserviceaccount.com` の Colorack アプリ権限を確認する。
- Apple 認証エラー: App Store Connect アプリID `6789651166` と Apple Team ID `GHHAYQBK58` を確認する。
- 提出後の不具合: 未公開ならリリースを停止する。番号を再利用せず、修正版を新しい buildNumber / versionCode で作成する。

## 1.1.9 実績

| 項目 | 値 |
|---|---|
| Git commit | `1f8165c` |
| iOS | `1.1.9` / build `17` |
| iOS Build ID | `5adad685-eea5-4966-9fb4-1e41f864f1ad` |
| iOS Submission ID | `49158260-ff2d-43c1-a1fd-8142cc760d10` |
| Android | `1.1.9` / versionCode `17` |
| Android Build ID | `ebc50c15-562b-4b6d-83b6-168f99f53556` |
| Android Submission ID | `5a2a27dc-1558-4664-b70e-7619ef47a01b` |
