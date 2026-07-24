# クラウドバックアップ サブスク化(フェーズ1: サブスク基盤とゲーティング) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** RevenueCatベースの2段階サブスク(ライト/スタンダード)を導入し、既存のクラウドバックアップ(塗料/キットのメタデータ)を`hasBackup`エンタイトルメント保有者のみに制限し、加入者には広告を非表示にする。

**Architecture:** 既存の`lib/auth.ts`/`lib/analytics.ts`/`lib/cloudBackup.ts`と同じ「`Constants.appOwnership === 'expo'`で判定し、Expo Go実行時はネイティブモジュールをrequireせずnullにフォールバックする」パターンを`lib/subscription.ts`(新規)にも適用する。`lib/auth.ts`のGoogleサインイン状態変化にRevenueCatのユーザーID紐付けを連動させ、`lib/cloudBackup.ts`・`components/AdBanner.tsx`は`lib/subscription.ts`が公開するエンタイトルメント判定関数を参照するだけの薄いゲートにする。

**Tech Stack:** React Native Firebase(既存)、RevenueCat(`react-native-purchases`, `react-native-purchases-ui`)、Expo SDK 54、TypeScript。

## Global Constraints

- 対象プラットフォーム: Android・iOS両方。片方専用にしか動かない実装をしない。
- Git運用: メインブランチに直接コミットしない。本計画は`feature/cloud-backup`から分岐した`feature/backup-subscription`ブランチ(ワークツリー: `.worktrees/feature-backup-subscription`)で作業する。
- Expo Go互換性: 新規に追加するネイティブモジュール(RevenueCat)は、`lib/mobileAds.native.ts`と同じ`Constants.appOwnership === 'expo'`ガードパターンを適用し、Expo Go実行時はrequireせずnullにフォールバックする。
- 検証方法: `node node_modules/typescript/bin/tsc --noEmit`(`npx tsc --noEmit`がPATH未解決で失敗する場合のフォールバック)。このプロジェクトにはユニットテストフレームワークが存在しないため、新規にJest等を導入しない。各タスクの検証はtsc + 手動コードレビュー + (可能な場合)実機/Expo Go確認とする。
- ファイル整合性: 編集したファイル(特に`translations/*.json`)にUTF-8 BOMを混入させない。
- エンタイトルメント名は仕様書で確定済みの`backup`(ライト・スタンダード共通)、`backup_photos`(スタンダードのみ、フェーズ2で使用)を使う。本計画(フェーズ1)では`backup`のみ実際に判定に使う。
- フェーズ2(キット写真バックアップ)は本計画のスコープ外。

---

### Task 1: `lib/subscription.ts` — RevenueCat SDK 統合とエンタイトルメント状態管理

**Files:**
- Modify: `package.json`(`react-native-purchases`, `react-native-purchases-ui`を追加)
- Modify: `app.config.js`(必要であればconfig plugin登録。要確認、下記Step 2参照)
- Create: `lib/subscription.ts`

**Interfaces:**
- Produces:
  - `initSubscription(): Promise<void>` — RevenueCat SDKの初期化(`Purchases.configure()`)。冪等(2回目以降は何もしない)。
  - `linkSubscriptionUser(uid: string | null): Promise<void>` — RevenueCat側のユーザーIDをFirebase AuthのUIDに紐付ける(`uid=null`でログアウト相当)。
  - `useEntitlements(): Entitlements` — Reactコンポーネント用フック。
  - `getEntitlements(): Entitlements` — Reactコンポーネント外(AppStateリスナー等)から同期的に読むためのgetter。
  - `presentPaywall(): Promise<void>` — RevenueCat標準のPaywall UIを表示する。
  - `restorePurchases(): Promise<void>` — 購入復元。
  - `export interface Entitlements { hasBackup: boolean; hasPhotoBackup: boolean; }`

- [ ] **Step 1: RevenueCat依存を追加**

```bash
npx expo install react-native-purchases react-native-purchases-ui
```

Expected: `package.json`の`dependencies`に`react-native-purchases`と`react-native-purchases-ui`がExpo SDK 54互換のバージョンで追加される。

- [ ] **Step 2: config pluginの要否を確認**

AGENTS.mdの指示(Expo HAS CHANGED、コードを書く前に実際のドキュメント/パッケージを確認する)に従い、インストールされたパッケージが実際にExpo config pluginを持つか確認する。

```bash
ls node_modules/react-native-purchases/app.plugin.js 2>&1
ls node_modules/react-native-purchases-ui/app.plugin.js 2>&1
```

- 存在する場合: `app.config.js`の`plugins`配列に、既存の`'@react-native-google-signin/google-signin'`の次の行として`'react-native-purchases'`(および`react-native-purchases-ui`が別途plugin持ちなら同様に)を追加する。
- 存在しない場合: `app.config.js`は変更しない(RevenueCatはランタイムの`Purchases.configure({ apiKey })`呼び出しのみで動作するため)。

いずれの場合も、このステップの結果(pluginを追加したか否かとその理由)をコミットメッセージまたはPRの説明に一言残す。

- [ ] **Step 3: `lib/subscription.ts`を作成**

```ts
// lib/subscription.ts
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
const RevenueCatUI: typeof import('react-native-purchases-ui').default | null = isExpoGo
  ? null
  : (require('react-native-purchases-ui').default as typeof import('react-native-purchases-ui').default);

const REVENUECAT_API_KEY_IOS = process.env.EXPO_PUBLIC_REVENUECAT_API_KEY_IOS;
const REVENUECAT_API_KEY_ANDROID = process.env.EXPO_PUBLIC_REVENUECAT_API_KEY_ANDROID;

export interface Entitlements {
  hasBackup: boolean;
  hasPhotoBackup: boolean;
}

const NO_ENTITLEMENTS: Entitlements = { hasBackup: false, hasPhotoBackup: false };

const listeners = new Set<() => void>();
let entitlements: Entitlements = NO_ENTITLEMENTS;
let configured = false;

function toEntitlements(active: Record<string, unknown>): Entitlements {
  return {
    hasBackup: 'backup' in active,
    hasPhotoBackup: 'backup_photos' in active,
  };
}

function notify(): void {
  listeners.forEach((l) => l());
}

// アプリ起動時に一度だけ呼ぶ。RevenueCatのデフォルトの匿名IDで設定するため、
// Googleサインインしていなくても「購入済みなら広告非表示」は即座に有効になる。
export async function initSubscription(): Promise<void> {
  if (!Purchases || configured) return;
  const apiKey = Platform.OS === 'ios' ? REVENUECAT_API_KEY_IOS : REVENUECAT_API_KEY_ANDROID;
  if (!apiKey) {
    console.warn('initSubscription: no RevenueCat API key configured for this platform');
    return;
  }
  Purchases.configure({ apiKey });
  configured = true;
  Purchases.addCustomerInfoUpdateListener((info) => {
    entitlements = toEntitlements(info.entitlements.active);
    notify();
  });
  try {
    const info = await Purchases.getCustomerInfo();
    entitlements = toEntitlements(info.entitlements.active);
    notify();
  } catch (e) {
    console.error('initSubscription: failed to load customer info', e);
  }
}

// Googleサインイン/サインアウトに合わせてRevenueCat側のユーザーIDを紐付け直す。
// uid=nullでサインアウト相当(匿名IDに戻す)。configure前(Expo Go含む)は何もしない。
export async function linkSubscriptionUser(uid: string | null): Promise<void> {
  if (!Purchases || !configured) return;
  try {
    if (uid) {
      const { customerInfo } = await Purchases.logIn(uid);
      entitlements = toEntitlements(customerInfo.entitlements.active);
    } else {
      const customerInfo = await Purchases.logOut();
      entitlements = toEntitlements(customerInfo.entitlements.active);
    }
    notify();
  } catch (e) {
    console.error('linkSubscriptionUser: failed', e);
  }
}

export function useEntitlements(): Entitlements {
  const [, force] = useReducer((x) => x + 1, 0);
  useEffect(() => {
    listeners.add(force);
    return () => { listeners.delete(force); };
  }, []);
  return entitlements;
}

// Reactコンポーネント外(lib/cloudBackup.tsのAppStateリスナー等)から同期的に読むためのgetter。
export function getEntitlements(): Entitlements {
  return entitlements;
}

export async function presentPaywall(): Promise<void> {
  if (!RevenueCatUI) {
    throw new Error('Subscriptions are not available in Expo Go. Use a development build.');
  }
  await RevenueCatUI.presentPaywall();
}

export async function restorePurchases(): Promise<void> {
  if (!Purchases) return;
  const info = await Purchases.restorePurchases();
  entitlements = toEntitlements(info.entitlements.active);
  notify();
}
```

- [ ] **Step 4: 型チェック**

```bash
node node_modules/typescript/bin/tsc --noEmit
```

Expected: `lib/subscription.ts`起因のエラーが出ないこと(この時点では他ファイルから未参照なので、`react-native-purchases`/`react-native-purchases-ui`の型定義に対する型エラーのみが対象)。

- [ ] **Step 5: BOM確認とコミット**

```bash
head -c 3 lib/subscription.ts | od -An -tx1
git add package.json package-lock.json lib/subscription.ts app.config.js
git commit -m "feat: add RevenueCat subscription module with Expo Go guard"
```

Expected: BOMが無いこと(`ef bb bf`が出ないこと)。

---

### Task 2: サブスク初期化とGoogleサインイン連動(`lib/auth.ts`)

**Files:**
- Modify: `lib/auth.ts`

**Interfaces:**
- Consumes: Task 1の`initSubscription(): Promise<void>`、`linkSubscriptionUser(uid: string | null): Promise<void>`
- Produces: 変更なし(`lib/auth.ts`の公開関数シグネチャは維持)

`app/_layout.tsx`は変更しない。既存の起動シーケンスは`Promise.all([..., initAuth(), ...])`で`initAuth()`を必ず呼んでいるため、`initSubscription()`を`initAuth()`の内部から呼ぶことで、`app/_layout.tsx`に新たな行を追加せずに済む(変更箇所を最小化)。

- [ ] **Step 1: `initAuth()`の先頭で`initSubscription()`を呼ぶ**

`lib/auth.ts`の`import`に追加:

```ts
import { initSubscription, linkSubscriptionUser } from './subscription';
```

`initAuth()`の現在の実装:

```ts
export async function initAuth(): Promise<void> {
  if (initialAuthResolved) return;
  if (initPromise) return initPromise;

  // signInWithGoogle() を一度も呼ばずに直接サインアウトした場合でも
  // GoogleSignin.signOut() がネイティブ側の設定不足で失敗しないよう、
  // 起動時にも設定しておく。
  configureGoogleSignin();

  if (!auth) {
    initialAuthResolved = true;
    return;
  }

  initPromise = new Promise((resolve) => {
    auth!().onAuthStateChanged((user) => {
      currentUser = toAuthUser(user);
      notify();
      if (!initialAuthResolved) {
        initialAuthResolved = true;
        resolve();
      }
    });
  });

  return initPromise;
}
```

これを以下に置き換える(`initSubscription()`の呼び出し追加と、`onAuthStateChanged`内での`linkSubscriptionUser()`呼び出し追加):

```ts
export async function initAuth(): Promise<void> {
  if (initialAuthResolved) return;
  if (initPromise) return initPromise;

  // 広告非表示判定はGoogleサインイン状態に依存しないため、authの可否に関わらず
  // 先にRevenueCatを初期化する(Expo Go/未設定時は内部で何もしない)。
  await initSubscription();

  // signInWithGoogle() を一度も呼ばずに直接サインアウトした場合でも
  // GoogleSignin.signOut() がネイティブ側の設定不足で失敗しないよう、
  // 起動時にも設定しておく。
  configureGoogleSignin();

  if (!auth) {
    initialAuthResolved = true;
    return;
  }

  initPromise = new Promise((resolve) => {
    auth!().onAuthStateChanged((user) => {
      currentUser = toAuthUser(user);
      notify();
      linkSubscriptionUser(user?.uid ?? null).catch((e) => console.error('initAuth: failed to link subscription user', e));
      if (!initialAuthResolved) {
        initialAuthResolved = true;
        resolve();
      }
    });
  });

  return initPromise;
}
```

- [ ] **Step 2: 型チェック**

```bash
node node_modules/typescript/bin/tsc --noEmit
```

Expected: エラーなし。

- [ ] **Step 3: BOM確認とコミット**

```bash
head -c 3 lib/auth.ts | od -An -tx1
git add lib/auth.ts
git commit -m "feat: link RevenueCat identity to Google sign-in state"
```

---

### Task 3: 既存クラウドバックアップのゲーティング(`lib/cloudBackup.ts`)

**Files:**
- Modify: `lib/cloudBackup.ts`

**Interfaces:**
- Consumes: Task 1の`getEntitlements(): Entitlements`
- Produces: 変更なし(`pushBackupToFirestore`/`runRestoreDecision`の公開シグネチャは維持。動作のみ変更)

`pushBackupToFirestore()`は自動バックアップ(`initAutoBackup()`のAppStateリスナー)と手動バックアップ(`settings.tsx`の`handleBackupNow`)の両方から呼ばれる唯一の書き込み経路であり、`runRestoreDecision()`はサインイン直後の自動復元/コンフリクト判定の唯一の入口(`settings.tsx`の`restoreCloudBackup()`はconflict alert経由でのみ到達する)。この2箇所にガードを置くことで、呼び出し元を個別に変更せずに済む。

- [ ] **Step 1: import追加とガード追加**

`lib/cloudBackup.ts`の`import`に追加:

```ts
import { getEntitlements } from './subscription';
```

`pushBackupToFirestore()`の先頭(既存の`if (!auth || !firestore) return;`の直後)に追加:

```ts
export async function pushBackupToFirestore(): Promise<void> {
  if (!auth || !firestore) return;
  if (!getEntitlements().hasBackup) return;
  if (pushInFlight) return pushInFlight;
  // ...(以下既存のまま)
```

`runRestoreDecision()`の先頭に追加:

```ts
export async function runRestoreDecision(): Promise<'restored' | 'conflict' | 'none'> {
  if (!getEntitlements().hasBackup) return 'none';
  const snapshot = await fetchBackupSnapshot();
  // ...(以下既存のまま)
```

- [ ] **Step 2: 型チェック**

```bash
node node_modules/typescript/bin/tsc --noEmit
```

Expected: エラーなし。

- [ ] **Step 3: BOM確認とコミット**

```bash
head -c 3 lib/cloudBackup.ts | od -An -tx1
git add lib/cloudBackup.ts
git commit -m "feat: gate cloud backup push/restore behind backup entitlement"
```

---

### Task 4: 広告非表示ゲーティング(`components/AdBanner.tsx`)

**Files:**
- Modify: `components/AdBanner.tsx`

**Interfaces:**
- Consumes: Task 1の`useEntitlements(): Entitlements`

- [ ] **Step 1: `useEntitlements`を使った早期return追加**

現在の実装:

```tsx
export default function AdBanner() {
  if (isExpoGo || !Ads) {
    return null;
  }

  const adUnitId = __DEV__ ? Ads.TestIds.BANNER : productionAdUnitId;
  // ...
```

これを以下に変更(importの追加含む):

```tsx
import Constants from 'expo-constants';
import { Platform, StyleSheet, View } from 'react-native';
import { useEntitlements } from '../lib/subscription';

// ... (既存のproductionAdUnitId/isExpoGo/Ads定義はそのまま)

export default function AdBanner() {
  const { hasBackup } = useEntitlements();
  if (hasBackup || isExpoGo || !Ads) {
    return null;
  }

  const adUnitId = __DEV__ ? Ads.TestIds.BANNER : productionAdUnitId;
  // ...(以下既存のまま)
```

- [ ] **Step 2: 型チェック**

```bash
node node_modules/typescript/bin/tsc --noEmit
```

Expected: エラーなし。

- [ ] **Step 3: BOM確認とコミット**

```bash
head -c 3 components/AdBanner.tsx | od -An -tx1
git add components/AdBanner.tsx
git commit -m "feat: hide ads for paying subscribers"
```

---

### Task 5: 設定画面のプラン表示・アップグレード導線(`app/(tabs)/settings.tsx`)

**Files:**
- Modify: `app/(tabs)/settings.tsx`
- Modify: `translations/en.json`
- Modify: `translations/ja.json`

**Interfaces:**
- Consumes: Task 1の`useEntitlements()`, `presentPaywall()`, `restorePurchases()`

- [ ] **Step 1: 翻訳キーを追加**

`translations/en.json`は1行のJSONファイル。末尾付近の以下の部分:

```
"cloudBackupPhotosNote":"Cloud backup does not include kit photos.","cloudBackupError":"Something went wrong. Please try again."}
```

を、次のように書き換える(末尾の`}`の直前に新規キーを追加):

```
"cloudBackupPhotosNote":"Cloud backup does not include kit photos.","cloudBackupError":"Something went wrong. Please try again.","currentPlan":"Current plan","planFree":"Free","planLight":"Light","planStandard":"Standard","backupRequiresSubscription":"Cloud backup requires a subscription.","viewPlans":"View plans","restorePurchases":"Restore purchases","purchaseError":"Something went wrong with your subscription. Please try again."}
```

`translations/ja.json`は同じく1行のJSONファイル。末尾付近の以下の部分:

```
"cloudBackupPhotosNote":"クラウドバックアップにはキットの写真は含まれません。","cloudBackupError":"操作に失敗しました。もう一度お試しください。"}
```

を、次のように書き換える:

```
"cloudBackupPhotosNote":"クラウドバックアップにはキットの写真は含まれません。","cloudBackupError":"操作に失敗しました。もう一度お試しください。","currentPlan":"現在のプラン","planFree":"無料","planLight":"ライト","planStandard":"スタンダード","backupRequiresSubscription":"クラウドバックアップの利用には有料プランへの加入が必要です。","viewPlans":"プランを見る","restorePurchases":"購入を復元","purchaseError":"購入処理に失敗しました。もう一度お試しください。"}
```

- [ ] **Step 2: `settings.tsx`にプラン表示・アップグレード導線を追加**

`app/(tabs)/settings.tsx`の`import`に追加:

```ts
import { presentPaywall, restorePurchases, useEntitlements } from '../../lib/subscription';
```

`SettingsScreen`関数内、`const authUser = useAuthUser();`の直後に追加:

```ts
  const { hasBackup } = useEntitlements();
  const [purchaseBusy, setPurchaseBusy] = useState(false);
```

同じ関数内、既存の`handleSignOut`の直後に新規ハンドラを追加:

```ts
  const handleViewPlans = async () => {
    if (purchaseBusy) return;
    setPurchaseBusy(true);
    try {
      await presentPaywall();
    } catch (e) {
      console.error('handleViewPlans: failed', e);
      Alert.alert(t('error'), t('purchaseError'));
    } finally {
      setPurchaseBusy(false);
    }
  };

  const handleRestorePurchases = async () => {
    if (purchaseBusy) return;
    setPurchaseBusy(true);
    try {
      await restorePurchases();
    } catch (e) {
      console.error('handleRestorePurchases: failed', e);
      Alert.alert(t('error'), t('purchaseError'));
    } finally {
      setPurchaseBusy(false);
    }
  };
```

Accountセクションの現在のJSX:

```tsx
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t('account')}</Text>
        <Text style={styles.accountSubText}>{t('cloudBackupPhotosNote')}</Text>
        {authUser ? (
          <>
            <Text style={styles.accountText}>{authUser.displayName ?? authUser.email ?? authUser.uid}</Text>
            {authUser.email ? <Text style={styles.accountSubText}>{authUser.email}</Text> : null}
            <Text style={styles.accountSubText}>{t('lastBackupAt')}: {lastBackupAt ?? t('lastBackupNever')}</Text>
            <TouchableOpacity style={[styles.accountBtn, accountBusy && styles.accountBtnDisabled]} onPress={handleBackupNow} disabled={accountBusy}>
              <Text style={styles.accountBtnText}>{t('backupNow')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.resetBtn, accountBusy && styles.accountBtnDisabled]} onPress={handleSignOut} disabled={accountBusy}>
              <Text style={styles.resetBtnText}>{t('signOut')}</Text>
            </TouchableOpacity>
          </>
        ) : (
          <TouchableOpacity style={[styles.accountBtn, accountBusy && styles.accountBtnDisabled]} onPress={handleGoogleSignIn} disabled={accountBusy}>
            <Text style={styles.accountBtnText}>{t('signInWithGoogle')}</Text>
          </TouchableOpacity>
        )}
      </View>
```

これを以下に置き換える(`hasBackup`が`false`のときはサインイン導線ではなくアップグレード導線を表示し、プラン表示と「購入を復元」ボタンを常時追加):

```tsx
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t('account')}</Text>
        <Text style={styles.accountSubText}>
          {t('currentPlan')}: {hasBackup ? t('planStandard') : t('planFree')}
        </Text>
        {hasBackup ? (
          <>
            <Text style={styles.accountSubText}>{t('cloudBackupPhotosNote')}</Text>
            {authUser ? (
              <>
                <Text style={styles.accountText}>{authUser.displayName ?? authUser.email ?? authUser.uid}</Text>
                {authUser.email ? <Text style={styles.accountSubText}>{authUser.email}</Text> : null}
                <Text style={styles.accountSubText}>{t('lastBackupAt')}: {lastBackupAt ?? t('lastBackupNever')}</Text>
                <TouchableOpacity style={[styles.accountBtn, accountBusy && styles.accountBtnDisabled]} onPress={handleBackupNow} disabled={accountBusy}>
                  <Text style={styles.accountBtnText}>{t('backupNow')}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.resetBtn, accountBusy && styles.accountBtnDisabled]} onPress={handleSignOut} disabled={accountBusy}>
                  <Text style={styles.resetBtnText}>{t('signOut')}</Text>
                </TouchableOpacity>
              </>
            ) : (
              <TouchableOpacity style={[styles.accountBtn, accountBusy && styles.accountBtnDisabled]} onPress={handleGoogleSignIn} disabled={accountBusy}>
                <Text style={styles.accountBtnText}>{t('signInWithGoogle')}</Text>
              </TouchableOpacity>
            )}
          </>
        ) : (
          <>
            <Text style={styles.accountSubText}>{t('backupRequiresSubscription')}</Text>
            <TouchableOpacity style={[styles.accountBtn, purchaseBusy && styles.accountBtnDisabled]} onPress={handleViewPlans} disabled={purchaseBusy}>
              <Text style={styles.accountBtnText}>{t('viewPlans')}</Text>
            </TouchableOpacity>
          </>
        )}
        <TouchableOpacity style={[styles.resetBtn, purchaseBusy && styles.accountBtnDisabled]} onPress={handleRestorePurchases} disabled={purchaseBusy}>
          <Text style={styles.resetBtnText}>{t('restorePurchases')}</Text>
        </TouchableOpacity>
      </View>
```

注: `hasBackup`は「ライト/スタンダードどちらでも真」のため、上記の`t('planStandard')`表示はフェーズ1時点では簡易表現(スタンダードのみを想定した文言)。ライト/スタンダードを正しく判別する表示は`hasPhotoBackup`も使えるフェーズ2で`t('planLight')`との出し分けに直す(フェーズ1では`hasPhotoBackup`が常に`false`になる想定のため、ここでは`hasBackup`のみで判定する暫定仕様とする)。

- [ ] **Step 3: 型チェック**

```bash
node node_modules/typescript/bin/tsc --noEmit
```

Expected: エラーなし。

- [ ] **Step 4: BOM確認とコミット**

```bash
head -c 3 app/\(tabs\)/settings.tsx | od -An -tx1
head -c 3 translations/en.json | od -An -tx1
head -c 3 translations/ja.json | od -An -tx1
git add app/\(tabs\)/settings.tsx translations/en.json translations/ja.json
git commit -m "feat: add plan status and upgrade CTA to settings screen"
```

---

### Task 6: RevenueCat/ストア設定ランブック + eas.json環境変数

**Files:**
- Create: `docs/revenuecat-setup-runbook.md`
- Modify: `eas.json`

コード変更を伴わない、外部サービス(RevenueCat・App Store Connect・Google Play Console)側の手動セットアップ手順を明文化する。既存の`docs/catalog-release-runbook.md`(GitHub Releasesベースのカタログ配信手順)と同じ位置づけのドキュメント。

- [ ] **Step 1: ランブックを作成**

```markdown
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

取得したAPI Keyを`eas.json`の`build.production.env`に追加する(既存のAdMob設定と同じ場所)。ローカル開発時は`.env`ファイル(gitignore対象)に同名の環境変数を設定する。

```
EXPO_PUBLIC_REVENUECAT_API_KEY_IOS=<iOS Public SDK Key>
EXPO_PUBLIC_REVENUECAT_API_KEY_ANDROID=<Android Public SDK Key>
```

## 4. Paywall UIの作成

RevenueCatダッシュボードの「Paywalls」機能でライト/スタンダードの2商品を提示するPaywallを作成する(コード変更不要、`lib/subscription.ts`の`presentPaywall()`が自動的にダッシュボード側の最新Paywallを表示する)。

## 5. サンドボックス検証

- iOS: TestFlight配布 or Xcodeのsandboxアカウントで購入・復元フローを確認する。
- Android: Google Playの内部テストトラック + ライセンステスターアカウントで確認する。
- 確認項目: 購入成功時に`hasBackup`が`true`になり広告が消えること、設定画面のバックアップUIが表示されること、「購入を復元」で別端末でも復元できること。
```

このファイルを`docs/revenuecat-setup-runbook.md`として保存する。

- [ ] **Step 2: `eas.json`に環境変数キーを追加**

現在の`eas.json`の`build.production.env`:

```json
    "production": {
      "env": {
        "EXPO_PUBLIC_ADMOB_APP_ID_IOS": "ca-app-pub-9724024455959596~5547441344",
        "EXPO_PUBLIC_ADMOB_BANNER_AD_UNIT_ID_IOS": "ca-app-pub-9724024455959596/1879659076",
        "EXPO_PUBLIC_ADMOB_APP_ID_ANDROID": "ca-app-pub-9724024455959596~9119854843",
        "EXPO_PUBLIC_ADMOB_BANNER_AD_UNIT_ID_ANDROID": "ca-app-pub-9724024455959596/4831492561",
        "EXPO_PUBLIC_IOS_BUNDLE_IDENTIFIER": "com.sugawalabo.colorack",
        "EXPO_PUBLIC_ANDROID_PACKAGE": "com.sugawalabo.colorack"
      },
      "ios": {
        "autoIncrement": true
      }
    }
```

これを以下に変更する(RevenueCat用の2キーを追加。値はランブックのStep 3で取得したものをユーザーが後から埋める):

```json
    "production": {
      "env": {
        "EXPO_PUBLIC_ADMOB_APP_ID_IOS": "ca-app-pub-9724024455959596~5547441344",
        "EXPO_PUBLIC_ADMOB_BANNER_AD_UNIT_ID_IOS": "ca-app-pub-9724024455959596/1879659076",
        "EXPO_PUBLIC_ADMOB_APP_ID_ANDROID": "ca-app-pub-9724024455959596~9119854843",
        "EXPO_PUBLIC_ADMOB_BANNER_AD_UNIT_ID_ANDROID": "ca-app-pub-9724024455959596/4831492561",
        "EXPO_PUBLIC_IOS_BUNDLE_IDENTIFIER": "com.sugawalabo.colorack",
        "EXPO_PUBLIC_ANDROID_PACKAGE": "com.sugawalabo.colorack",
        "EXPO_PUBLIC_REVENUECAT_API_KEY_IOS": "",
        "EXPO_PUBLIC_REVENUECAT_API_KEY_ANDROID": ""
      },
      "ios": {
        "autoIncrement": true
      }
    }
```

空文字列のままではPhase1の`initSubscription()`が`console.warn`を出して何もしない安全な状態になる(Task 1 Step 3の実装を参照)。RevenueCatプロジェクト作成後、ランブックの手順に沿って実際のキーに置き換える。

- [ ] **Step 3: コミット**

```bash
git add docs/revenuecat-setup-runbook.md eas.json
git commit -m "docs: add RevenueCat setup runbook and eas.json env keys"
```

---

## 完了確認(全タスク後)

- [ ] `node node_modules/typescript/bin/tsc --noEmit`がエラーなしで完走する
- [ ] 変更した全ファイルにUTF-8 BOMが混入していない
- [ ] `EXPO_PUBLIC_REVENUECAT_API_KEY_*`が未設定の状態でアプリを起動しても、`initSubscription()`が警告ログを出すのみでクラッシュしないこと(コードレビューで確認。実機起動は本セッションでは不可)
- [ ] Expo Go(`expo start`)実行時に`lib/subscription.ts`起因のクラッシュが起きない設計になっていること(コードレビューで確認)
- [ ] `origin/feature/backup-subscription`へpush
