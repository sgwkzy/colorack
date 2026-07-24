# クラウドバックアップのサブスク化 + キット写真バックアップ 設計

## 背景・目的

`feature/cloud-backup`(未マージ)で実装したクラウドバックアップは、塗料・キットのメタデータのみを対象とし、無料・無制限で利用できる設計だった。今回、以下の要望に対応する:

- キットの写真もクラウドバックアップの対象にしたい(現状は意図的に除外)
- 画像はアップロード前に解像度を落として容量を抑えたい
- 実際の金銭コスト(Firebase課金)・パフォーマンスコストを考慮した設計にしたい
- バックアップ機能自体を、通信・ストレージコストがかかることを踏まえてサブスクリプション(有料)化したい
- 有料プラン加入者には広告を非表示にしたい

この変更により、クラウドバックアップは「無料で誰でも使える機能」から「サブスク収益源」に位置づけが変わる。

## スコープ

### 今回やること

- 2段階のサブスクプラン(ライト/スタンダード)による、バックアップ機能全体のゲーティング
- RevenueCatを用いたサブスク基盤(`lib/subscription.ts`)の新規構築
- 既存のメタデータバックアップ(`lib/cloudBackup.ts`)を、`hasBackup`エンタイトルメントを持つユーザーのみに制限
- キット写真の圧縮(保存時にリサイズ)・Firebase Storageへのアップロード/ダウンロード(`hasBackup_photos`エンタイトルメントを持つユーザーのみ)
- 解約・ダウングレード時の猶予期間付き自動削除(Cloud Functions)
- 有料プラン(ライト・スタンダード共通)加入者への広告非表示

### 今回もやらないこと

- Apple/Googleの年額プラン、トライアル期間などの細かい商品バリエーション設計(RevenueCatダッシュボード側で後から調整可能なため、コードの前提を崩さない範囲で運用時に決める)
- 複数デバイス間でのリアルタイム同時編集・競合解消の高度化(既存のconflictダイアログ方式を踏襲)
- 広告SDK自体の変更(既存の`react-native-google-mobile-ads`をそのまま使う。ゲーティングのみ追加)

## 全体アーキテクチャ

```
[RevenueCat SDK] --entitlements--> [lib/subscription.ts] --hasBackup/hasPhotoBackup--> 各画面・lib/cloudBackup.ts
                                                                                          |
                                                                                          v
                                                              [lib/kitPhoto.ts] --圧縮済みファイル--> [lib/kitPhotoBackup.ts] --> Firebase Storage
```

- サブスク基盤(フェーズ1)と写真バックアップ(フェーズ2)は独立した塊だが、フェーズ2はフェーズ1が提供する`hasPhotoBackup`判定に依存するため、フェーズ1→フェーズ2の順で実装する。
- 作業ブランチ: `feature/cloud-backup`から分岐した`feature/backup-subscription`(本ドキュメントが置かれているブランチ)。

## フェーズ1: サブスク基盤とゲーティング

### プラン・エンタイトルメント設計

| プラン | RevenueCat商品ID(例) | 付与エンタイトルメント |
|---|---|---|
| ライト | `light_monthly` | `backup` |
| スタンダード | `standard_monthly` | `backup`, `backup_photos` |

- 商品自体(価格・年額/月額バリエーション・トライアル)はApp Store Connect / Google Play ConsoleおよびRevenueCatダッシュボードで設定する(コード側は商品IDとエンタイトルメント名にのみ依存し、価格を直接扱わない)。
- 価格の叩き台: ライト¥300/月、スタンダード¥600/月(原価はほぼ¥0のため市場感で決める値。競合アプリの実勢価格の調査を推奨)。

### `lib/subscription.ts`(新規)

既存の`lib/auth.ts`/`lib/analytics.ts`/`lib/cloudBackup.ts`と同じ、Expo Go非対応ネイティブモジュールのガードパターンを踏襲する。

```ts
import { useEffect, useReducer } from 'react';
import { Platform } from 'react-native';
import Constants from 'expo-constants';

const isExpoGo = Constants.appOwnership === 'expo';

// Expo Goのバイナリにはネイティブモジュールが含まれないため、
// import(=require)時点でクラッシュする。mobileAds.native.tsと同じパターンで
// Expo Go実行時はrequireせずnullにフォールバックする。
const Purchases: typeof import('react-native-purchases').default | null = isExpoGo
  ? null
  : (require('react-native-purchases').default as typeof import('react-native-purchases').default);

const REVENUECAT_API_KEY_IOS = process.env.EXPO_PUBLIC_REVENUECAT_API_KEY_IOS;
const REVENUECAT_API_KEY_ANDROID = process.env.EXPO_PUBLIC_REVENUECAT_API_KEY_ANDROID;

export interface Entitlements {
  hasBackup: boolean;
  hasPhotoBackup: boolean;
}

const listeners = new Set<() => void>();
let entitlements: Entitlements = { hasBackup: false, hasPhotoBackup: false };
let initialized = false;

function toEntitlements(active: Record<string, unknown>): Entitlements {
  return {
    hasBackup: 'backup' in active,
    hasPhotoBackup: 'backup_photos' in active,
  };
}

function notify(): void {
  listeners.forEach((l) => l());
}

export async function initSubscription(uid: string | null): Promise<void> {
  if (!Purchases) return;
  if (!initialized) {
    const apiKey = Platform.OS === 'ios' ? REVENUECAT_API_KEY_IOS : REVENUECAT_API_KEY_ANDROID;
    if (!apiKey) return;
    Purchases.configure({ apiKey });
    initialized = true;
    Purchases.addCustomerInfoUpdateListener((info) => {
      entitlements = toEntitlements(info.entitlements.active);
      notify();
    });
  }
  if (uid) await Purchases.logIn(uid);
  const info = await Purchases.getCustomerInfo();
  entitlements = toEntitlements(info.entitlements.active);
  notify();
}

export function useEntitlements(): Entitlements {
  const [, force] = useReducer((x) => x + 1, 0);
  useEffect(() => {
    listeners.add(force);
    return () => { listeners.delete(force); };
  }, []);
  return entitlements;
}

export async function presentPaywall(): Promise<void> {
  if (!Purchases) throw new Error('Subscriptions are not available in Expo Go. Use a development build.');
  // RevenueCatUI.presentPaywall() 等、RevenueCat標準のPaywall UIを呼び出す。
}

export async function restorePurchases(): Promise<void> {
  if (!Purchases) return;
  const info = await Purchases.restorePurchases();
  entitlements = toEntitlements(info.entitlements.active);
  notify();
}
```

- `app/_layout.tsx`の初期化シーケンス(`initAuth`/`initAnalytics`と同じ並び)に`initSubscription(currentUser?.uid ?? null)`を追加。Googleサインイン成功時にも呼び直し、匿名→ログイン後のRevenueCatユーザーIDを紐付ける。

### 既存バックアップのゲーティング

`lib/cloudBackup.ts`の`initAutoBackup()`のリスナー内、および`runRestoreDecision()`の先頭で`hasBackup`をチェックし、`false`なら即returnする。設定画面(`settings.tsx`)のAccountセクションは、`hasBackup`が`false`の場合はバックアップ操作UIの代わりに「アップグレードして有効化」ボタン(`presentPaywall()`呼び出し)を表示する。

### 広告非表示

`components/AdBanner.tsx`の先頭で`useEntitlements().hasBackup`を見て、真なら`null`を返す。呼び出し元6箇所(catalog/favorites/kits/owned/wishlist/AddPaint)は無改修。

```ts
export default function AdBanner() {
  const { hasBackup } = useEntitlements();
  if (hasBackup || isExpoGo || !Ads) {
    return null;
  }
  // ...
}
```

## フェーズ2: キット写真のクラウドバックアップ

### 画像圧縮

`lib/kitPhoto.ts`の`persist()`内で、既存導入済みの`expo-image-manipulator`を使い、保存時点で長辺1600px・JPEG品質0.7にリサイズする。アップロード専用の圧縮工程を別途設けず、ローカル保存分もこの圧縮後ファイルをそのまま使う(ローカルストレージも軽くなる副次効果)。

```ts
import * as ImageManipulator from 'expo-image-manipulator';

async function persist(sourceUri: string): Promise<string> {
  await ensureDir();
  const manipulated = await ImageManipulator.manipulateAsync(
    sourceUri,
    [{ resize: { width: 1600 } }], // 長辺基準。縦長画像はheightを指定する分岐が必要(実装時に画像サイズを事前取得して判定)
    { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG }
  );
  const dest = `${KIT_PHOTO_DIR}${Date.now()}-${Math.floor(Math.random() * 1e6)}.jpg`;
  await FileSystem.copyAsync({ from: manipulated.uri, to: dest });
  return dest;
}
```

### スキーマ変更

`kit_photos`テーブルに`synced_at TEXT NULL`列を追加する(`lib/db.ts`のマイグレーション)。

### `lib/kitPhotoBackup.ts`(新規)

新規依存: `@react-native-firebase/storage`。他のFirebaseモジュールと同じExpo Goガードパターンを適用する。

- `uploadPendingKitPhotos(): Promise<void>` — `hasPhotoBackup`が`false`なら即return。`SELECT * FROM kit_photos WHERE synced_at IS NULL`で未同期分のみ取得し、`users/<uid>/kit-photos/<filename>`にアップロード(`<filename>`は`uri`のベースネーム、例: `1752... -123456.jpg`)、成功ごとに`synced_at`を打刻する。**差分方式にする理由**: 既存のメタデータバックアップと同じ「バックグラウンド遷移のたびに全量アップロード」を写真にも適用すると、未変更の写真を毎回再送することになり通信量・書き込み回数コストが無視できなくなるため。**ストレージパスに`kit_photos.id`ではなく`uri`のベースネームを使う理由**: `id`はSQLiteの自動採番でデバイスごとに独立しており、同一アカウントの別デバイスが偶然同じ`id`を採番すると別々の写真が同じStorageパスに書き込まれ上書き事故になる。`persist()`が生成するファイル名(`${Date.now()}-${random}.jpg`)はデバイスをまたいでも衝突がほぼ起きないため、これをそのままStorageキーとして流用する。
- `downloadKitPhotosForRestore(kitPhotos: BackupKitPhoto[]): Promise<Map<string, string>>` — スナップショットが参照するStorageパスをダウンロードしてローカルファイルに保存し、`kitPhotoLocalRef → ローカルuri`のマップを返す(`restoreFromSnapshot()`が`kit_photos`行を再構築する際に使う)。
- キット写真削除時(既存の`deleteKitPhoto`呼び出し箇所)は、ローカル削除に加えてStorageオブジェクトも削除する。

### バックアップスナップショットの拡張(スキーマv3)

```ts
export interface BackupKitPhoto {
  kitLocalRef: string;
  storagePath: string;
  sort_order: number;
}
// BackupSnapshotに追加(v2からv3へ、既存同様 optional で後方互換):
// kitPhotos?: BackupKitPhoto[];
```

`buildBackupSnapshot()`は`hasPhotoBackup`が`true`のときのみ`kitPhotos`を含める。`restoreFromSnapshot()`は`snapshot.kitPhotos`が存在する場合のみダウンロード処理を行う(存在しない=v1/v2スナップショット、またはスタンダード未加入時の自分自身のバックアップの場合はスキップ)。

### アップロードのトリガー

既存の`initAutoBackup()`のAppStateバックグラウンド遷移フックにそのまま相乗りする(`pushBackupToFirestore()`の中で`uploadPendingKitPhotos()`も呼ぶ)。差分方式のため、変更がない限りほとんどの遷移で実行コストはゼロに近い。

## 解約・ダウングレード時のデータ処理

1. RevenueCatのWebhook(`EXPIRATION`/`CANCELLATION`イベント)を受けるCloud Function`onSubscriptionLapsed`が、該当ユーザーのFirestoreドキュメントに`photoBackupGraceUntil = now + 30日`を書き込む。
2. 1日1回の定期実行Cloud Function`sweepExpiredKitPhotos`が、`photoBackupGraceUntil`を過ぎ、かつ現在も`backup_photos`エンタイトルメントを持たないユーザーの`users/<uid>/kit-photos/`配下を削除し、Firestore側の`kitPhotos`フィールドをクリアする(メタデータ本体は削除しない)。
3. 猶予期間内にスタンダードへ復帰した場合に備え、`backup_photos`エンタイトルメントを再取得したタイミングで端末側の`kit_photos.synced_at`を全行`NULL`に戻し、再アップロードを走らせる。

この処理にはFirebase Blazeプラン(従量課金プラン)への移行とCloud Functionsのデプロイが必要になる。

## コスト試算(2026年7月時点、Web検索で確認した実料金に基づく)

- Firebase Storage(Blazeプラン): $0.026/GB・月(保存)、$0.15/GB(ダウンロード)。Google CloudのAlways Freeの範囲(**5GB・月分の保存 + 月100GBの下り転送**)はBlazeプランでも無料のまま適用される。
- 圧縮後の写真1枚(長辺1600px・JPEG品質0.7)を約150〜300KB(中央値200KBと仮定)とすると、「数百人規模・スタンダード加入率15%(45人)・1人平均30枚」の想定で保存量は約270MB。**5GB無料枠に収まり、実質¥0/月**。
- ダウンロード(復元時のみ発生): 月500回の復元(1回あたり6MB)でも3GB程度で、100GB無料枠の範囲内。
- RevenueCat: 月間追跡売上$2,500まで無料。数百人規模のサブスク収益ではこの閾値に達しない見込み → **¥0/月**。
- Cloud Functions(解約時クリーンアップ用): 無料枠(月200万回呼び出し)の範囲内 → **¥0/月**。
- **結論**: 想定規模ではこの機能追加による運用コストは実質¥0/月に収まる見込み。目安として、スタンダード加入者が約800人(1人30枚換算)を超えたあたりから5GB無料枠を超え始めるため、そのタイミングでコスト構造を再点検する。

## テスト・検証方針

- `npx tsc --noEmit`(フェーズ1・フェーズ2それぞれの完了時)。
- サブスク購入フロー・写真アップロード/ダウンロードの実機検証は本セッションでは実行不可のため、実装完了後にRevenueCatのSandbox環境(iOS TestFlight / Android内部テストトラック)での手動検証が別途必要。
- Cloud Functions(Webhook受信・定期削除)はFirebase Emulator Suiteでのローカル検証を推奨。

## 前提・注意点

- App Store/Google Playの審査ガイドライン(サブスク利用規約リンク・購入復元ボタンの設置等、Apple Guideline 3.1.2相当)への対応が必要。RevenueCat標準のPaywall UIを使うことでこの対応の大部分を吸収できる。
- 本機能は`feature/cloud-backup`自体がまだmasterに未マージの状態の上に積む変更のため、`feature/cloud-backup`のマージ計画とあわせてリリース順序を検討する必要がある。
