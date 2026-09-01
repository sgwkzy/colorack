# Colorack アプリリリース手順

Colorack の GitHub `main` にある承認済みコミットから、iOS / Android のストア向けビルドを作成し、各ストアへ提出するための運用手順。

この手順は、バージョン `1.1.9`（iOS build `17` / Android versionCode `17`）を Windows から EAS Build / EAS Submit でリリースした実績を基にしている。

## リリース範囲

- iOS の Submit は App Store Connect / TestFlight へのアップロードまで行う。App Store の審査提出・公開は別承認とする。
- Android の Submit は Google Play の内部テストトラックへのアップロードまで行う。製品版への昇格・公開は別承認とする。
- 公式カタログだけを更新する場合は、この手順ではなく [`catalog-release-runbook.md`](./catalog-release-runbook.md) を使用する。

## 必要な権限と認証情報

- Expo アカウント `sgwkzy` の Colorack プロジェクトへアクセスできること。
- Apple Developer / App Store Connect の Colorack アプリへアクセスできること。
- Google Play Console のデベロッパーアカウント「スガワラボ」へアクセスできること。
- Android Submit 用サービスアカウント `colorack-eas-submit@colorack-7e436.iam.gserviceaccount.com` が、Colorack に対する製品版・テスト版リリース権限を持つこと。
- 上記サービスアカウントの JSON キーが EAS の Android Service Credentials に登録済みであること。
- Production 用の EAS 環境変数・ファイル変数が登録済みであること。少なくとも Firebase 設定、RevenueCat SDK Key、AdMob ID、Bundle ID / Package 名を確認する。

秘密鍵や Firebase 設定ファイルを Git、Issue、チャットへ貼り付けない。JSON キーを一時的にダウンロードした場合は、EAS への登録確認後に安全な保管場所へ移動するか削除する。

Android Service Credentials が未登録の場合だけ、明示的な認証情報変更の承認を得て次を実行する。

```powershell
npx eas-cli@latest credentials --platform android
```

`production` → `Google Service Account` → `Upload a Google Service Account Key` を選び、リポジトリ外に置いた `colorack-eas-submit` の JSON キーを指定する。登録後は EAS Dashboard の Android Service Credentials で対象メールアドレスを確認する。

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
- 未コミット変更がない
- リリース対象として承認されたコミットと `HEAD` が一致する
- バックアップなど未リリース機能を含むブランチではない

## 2. バージョンを準備する（DEV作業）

バージョン変更はアプリ資材の変更なので OPS では行わず、DEV 側で実施して `main` へ反映する。

`app.json` の次の値を更新する。

- `expo.version`: ストア表示用バージョン（例: `1.1.9`）
- `expo.android.versionCode`: 直前の Google Play リリースより大きい整数
- `expo.ios.buildNumber`: EAS の `autoIncrement` で更新される。ビルド後に変更をコミットする

同じ `versionCode` / `buildNumber` は再利用できない。失敗したビルドでも番号が消費されている場合があるため、ストアと EAS の最新値を確認する。

## 3. ビルド前検証

```powershell
npm ci
npx tsc --noEmit
npx expo-doctor
npx expo config --type public --json
npx eas-cli@latest env:list --environment production
```

公開設定で次を確認する。

- iOS Bundle Identifier: `com.sugawalabo.colorack`
- Android Package: `com.sugawalabo.colorack`
- `version` / `buildNumber` / `versionCode` が今回のリリース値
- `expo-doctor` が全項目成功
- Production 環境に必要な変数名が存在する（秘密値そのものは出力・記録しない）

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
- バックアップやサブスクを含まないリリースでは、その機能が誤って有効になっていないことも確認する。

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
