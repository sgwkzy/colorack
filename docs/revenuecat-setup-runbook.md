# RevenueCatセットアップランブック

キット写真バックアップのサブスク化(フェーズ1)に必要な、コード外の手動セットアップ手順。

## 1. App Store Connect / Google Play Consoleでの商品作成

- App Store Connect: サブスクリプショングループを作成し、`light_monthly`・`standard_monthly`の2商品を登録する。
- Google Play Console: 定期購入商品として同名の2商品を登録する。
- 価格は叩き台としてライト¥300/月・スタンダード¥600/月(仕様書 `docs/superpowers/specs/2026-07-15-backup-subscription-design.md` 参照。市場調査の上で確定させる)。

## 2. RevenueCatプロジェクト作成

1. https://app.revenuecat.com/ でプロジェクトを作成。
2. iOS/Androidそれぞれのアプリを追加し、上記App Store Connect/Play Consoleの商品と紐付ける。
3. エンタイトルメントを2つ作成する:
   - `backup`: `light_monthly`と`standard_monthly`の両方を紐付ける。
   - `backup_photos`: `standard_monthly`のみを紐付ける(フェーズ2で使用。フェーズ1でも先に作成しておいて問題ない)。
4. 「API keys」画面からiOS/Android向けのPublic SDK Keyをそれぞれ取得する。

## 3. アプリ側への設定値反映

取得したPublic SDK KeyをEASプロジェクトの`production` Environment Variablesへ
`Sensitive`な文字列として登録する。Firebase設定ファイルは`Secret`なFile変数として
登録する。ローカル開発時は`.env`ファイル(gitignore対象)に同名の環境変数を設定する。

```
EXPO_PUBLIC_REVENUECAT_API_KEY_IOS=<iOS Public SDK Key>
EXPO_PUBLIC_REVENUECAT_API_KEY_ANDROID=<Android Public SDK Key>
EXPO_PUBLIC_FIREBASE_WEB_CLIENT_ID=<Firebase Web client ID>
GOOGLE_SERVICE_INFO_PLIST=<GoogleService-Info.plist file>
GOOGLE_SERVICES_JSON=<google-services.json file>
```

## 4. Paywall UIの作成

RevenueCatダッシュボードの「Paywalls」機能でライト/スタンダードの2商品を提示するPaywallを作成する(コード変更不要、`lib/subscription.ts`の`presentPaywall()`が自動的にダッシュボード側の最新Paywallを表示する)。

## 5. サンドボックス検証

- iOS: TestFlight配布 or Xcodeのsandboxアカウントで購入・復元フローを確認する。
- Android: Google Playの内部テストトラック + ライセンステスターアカウントで確認する。
- 購入・復元の前にGoogleサインインし、Firebase UIDとRevenueCat App User IDが一致する状態で試す。
- 確認項目: 購入成功時に`hasBackup`が`true`になり広告が消えること、設定画面のバックアップUIが表示されること、「購入を復元」で別端末でも復元できること。

## 6. RevenueCat Firebase ExtensionとSecurity Rules

Firebase RulesだけでRevenueCatの購入状態を検証するため、公式Extension
`revenuecat/firestore-revenuecat-purchases@0.1.18`を使用する。Firebaseプロジェクトは
Blazeプランが必要。

1. RevenueCatの「Integrations」→「Firebase」でShared Secretを生成する。
2. `firebase deploy --only extensions`でExtensionをインストールする。SecretはCLIの
   プロンプトへ入力し、ファイルやGitへ保存しない。
3. Firebaseの「Functions」でExtensionのTrigger URLを確認し、RevenueCatのFirebase
   Integrationへ貼り付けて保存する。
4. RevenueCatからテストイベントを送り、Firebase Authユーザーのcustom claim
   `revenueCatEntitlements`へ`backup`/`backup_photos`が反映されることを確認する。
5. 確認後に限り、`firebase deploy --only firestore:rules,storage`でRulesを反映する。

RulesはFirestoreバックアップに`backup`、Storage写真に`backup_photos`を要求する。
StorageへのアップロードはJPEGかつ5MB以下に限定する。Extension設定前にRulesだけを
デプロイすると全ユーザーのバックアップが拒否されるため、順序を入れ替えない。

Firebase Extensionsは2027年3月31日に終了予定。Firebaseが移行手段を公開後、
同等のWebhook/Cloud Functionsへ移行する。

## 7. Storage孤児オブジェクトの扱い(既知の制限)

キット写真の削除は、ユーザーが写真を個別に削除した場合のみFirebase Storage側の実体も削除する。キット/キットボックスの一括削除・全リセット・クラウド復元時のローカルデータ一掃では、Storage側のクリーンアップを行わない(復元直後に復元元のデータを消してしまう事故を避けるため)。また、スタンダードプランを解約したユーザーの写真も、猶予期間後の自動削除(Cloud Functions、未実装)が無い限りStorageに残り続ける。

これらは全て「定期的なサーバーサイド整理ジョブ(Cloud Functions)」で解決すべき問題であり、このリポジトリ(Expo Reactネイティブアプリ)側の実装対象ではない。将来Cloud Functionsを実装する際は、この2点をまとめて対応すること。

将来Cloud Functionsによる定期整理を実装する際は、Storage側の孤児オブジェクトと
Firestore参照の不整合をあわせて棚卸しすること。
