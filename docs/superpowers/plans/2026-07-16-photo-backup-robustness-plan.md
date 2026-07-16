# キット写真バックアップ 残存指摘対応(I-1/I-3/I-4/I-5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 多エージェントレビューで見つかった残り4件の指摘(I-1: 復元時の一時的ダウンロード失敗、I-3: コンフリクト復元アラートの文言、I-4: エンタイトルメント自己ガードの不統一、I-5: 起動シーケンスの耐障害性)に対応する。

**Architecture:** いずれも既存コードへの局所的な追加で完結する(スキーマ変更・新規ファイル無し)。I-1は`downloadKitPhotosForRestore()`にリトライループを追加、I-3は翻訳文言のみ変更、I-4は関数冒頭にガード文を追加、I-5は`Promise.all`内の該当呼び出しに`.catch()`を追加する。

**Tech Stack:** Expo SDK 54、TypeScript。

## Global Constraints

- 対象プラットフォーム: Android・iOS両方。
- Git運用: メインブランチに直接コミットしない。本計画は`feature/cloud-backup`ブランチ(ワークツリー: `.worktrees/feature-cloud-backup`)で作業する。
- 検証方法: `node node_modules/typescript/bin/tsc --noEmit`(`npx tsc --noEmit`がPATH未解決で失敗する場合のフォールバック)。このプロジェクトにはユニットテストフレームワークが存在しないため、新規にJest等を導入しない。
- ファイル整合性: 編集したファイル(特に`translations/*.json`)にUTF-8 BOMを混入させない。
- I-3では既存の「クラウドから復元すると未バックアップ分は破棄される」という挙動自体は変更しない(他の全データ種別と同じ仕様のため)。文言強化のみ行う。
- I-6(RevenueCat本番APIキー未設定)は本計画のスコープ外。

---

### Task 1: I-1 — 復元時の写真ダウンロードに1回リトライを追加(`lib/kitPhotoBackup.ts`)

**Files:**
- Modify: `lib/kitPhotoBackup.ts`

**Interfaces:**
- Produces: `downloadKitPhotosForRestore(photos: BackupKitPhoto[]): Promise<Map<string, string>>`の公開シグネチャは変更なし。動作のみ変更(1回失敗しても即座に諦めず、もう1回だけ再試行する)。

- [ ] **Step 1: ダウンロードループをリトライ対応にする**

`lib/kitPhotoBackup.ts`の`downloadKitPhotosForRestore()`内、現在の該当箇所:

```ts
  for (const photo of photos) {
    // ダウンロード先のローカルファイル名はStorageパスのベースネームを流用せず、
    // この端末専用に新規生成する(端末間でのファイル名の偶然の一致を避けるため)。
    const dest = `${KIT_PHOTO_DIR}${generatePhotoFilename()}`;
    try {
      const url = await storage().ref(photo.storagePath).getDownloadURL();
      await FileSystem.downloadAsync(url, dest);
      localUriByStoragePath.set(photo.storagePath, dest);
    } catch (e) {
      console.error('downloadKitPhotosForRestore: failed to download', photo.storagePath, e);
    }
  }
```

これを以下に変更する(一時的なネットワーク障害を緩和するため、1回だけ再試行する):

```ts
  for (const photo of photos) {
    // ダウンロード先のローカルファイル名はStorageパスのベースネームを流用せず、
    // この端末専用に新規生成する(端末間でのファイル名の偶然の一致を避けるため)。
    const dest = `${KIT_PHOTO_DIR}${generatePhotoFilename()}`;
    let succeeded = false;
    // 一時的なネットワーク障害を緩和するため最大2回試行する。恒久的な失敗
    // (長時間オフライン等)はリトライしても解決しないため、その場合は
    // 既存通りスキップし、次回ユーザーが「クラウドから復元」を再実行すれば拾える。
    for (let attempt = 0; attempt < 2 && !succeeded; attempt++) {
      try {
        const url = await storage().ref(photo.storagePath).getDownloadURL();
        await FileSystem.downloadAsync(url, dest);
        localUriByStoragePath.set(photo.storagePath, dest);
        succeeded = true;
      } catch (e) {
        if (attempt === 1) console.error('downloadKitPhotosForRestore: failed to download after retry', photo.storagePath, e);
      }
    }
  }
```

- [ ] **Step 2: 型チェック**

```bash
node node_modules/typescript/bin/tsc --noEmit
```

Expected: エラーなし。

- [ ] **Step 3: BOM確認とコミット**

```bash
head -c 3 lib/kitPhotoBackup.ts | od -An -tx1
git add lib/kitPhotoBackup.ts
git commit -m "fix: retry kit photo download once on transient failure during restore"
```

---

### Task 2: I-3 — コンフリクト復元アラートの文言強化(`translations/en.json`/`translations/ja.json`)

**Files:**
- Modify: `translations/en.json`
- Modify: `translations/ja.json`

**Interfaces:**
- Produces: `cloudRestoreConflictMessage`翻訳キーの文言のみ変更。他のキー・コード側の参照は変更なし。

- [ ] **Step 1: `translations/en.json`の該当箇所を変更**

現在の該当箇所(1行JSON内の一部):

```
"cloudRestoreConflictMessage":"This device also has data. Restoring from cloud will replace this device's data."
```

これを以下に変更する:

```
"cloudRestoreConflictMessage":"This device also has data. Restoring from cloud will permanently replace this device's data, including any changes not yet backed up."
```

- [ ] **Step 2: `translations/ja.json`の該当箇所を変更**

現在の該当箇所(1行JSON内の一部):

```
"cloudRestoreConflictMessage":"この端末にもデータがあります。クラウドから復元すると、この端末のデータは置き換えられます。"
```

これを以下に変更する:

```
"cloudRestoreConflictMessage":"この端末にもデータがあります。クラウドから復元すると、この端末のデータ(まだバックアップされていない変更を含む)は失われます。"
```

- [ ] **Step 3: 翻訳ファイルの整合性確認**

```bash
node -e "JSON.parse(require('fs').readFileSync('translations/en.json','utf8')); JSON.parse(require('fs').readFileSync('translations/ja.json','utf8')); console.log('OK')"
```

Expected: `OK`が出力される(JSON構文が壊れていないこと)。

- [ ] **Step 4: 型チェック、BOM確認とコミット**

```bash
node node_modules/typescript/bin/tsc --noEmit
head -c 3 translations/en.json | od -An -tx1
head -c 3 translations/ja.json | od -An -tx1
git add translations/en.json translations/ja.json
git commit -m "fix: clarify that unbacked-up local data is lost on cloud restore"
```

---

### Task 3: I-4 — エンタイトルメント自己ガードの追加(`lib/cloudBackup.ts`/`lib/kitPhotoBackup.ts`)

**Files:**
- Modify: `lib/cloudBackup.ts`
- Modify: `lib/kitPhotoBackup.ts`

**Interfaces:**
- Produces: `restoreFromSnapshot(snapshot: BackupSnapshot): Promise<void>`/`downloadKitPhotosForRestore(photos: BackupKitPhoto[]): Promise<Map<string, string>>`の公開シグネチャは変更なし。動作のみ変更(呼び出し元のゲートが無くても安全になる)。

- [ ] **Step 1: `restoreFromSnapshot()`に自己ガードを追加**

`lib/cloudBackup.ts`の現在の該当箇所:

```ts
export async function restoreFromSnapshot(snapshot: BackupSnapshot): Promise<void> {
  const db = getDB();
  let orphanedKitPhotoUris: string[] = [];
  const kitIdByLocalRef = new Map<string, number>();

  await db.withTransactionAsync(async () => {
```

これを以下に変更する:

```ts
export async function restoreFromSnapshot(snapshot: BackupSnapshot): Promise<void> {
  if (!getEntitlements().hasBackup) return;
  const db = getDB();
  let orphanedKitPhotoUris: string[] = [];
  const kitIdByLocalRef = new Map<string, number>();

  await db.withTransactionAsync(async () => {
```

- [ ] **Step 2: `downloadKitPhotosForRestore()`に自己ガードを追加**

`lib/kitPhotoBackup.ts`の現在の該当箇所:

```ts
export async function downloadKitPhotosForRestore(photos: BackupKitPhoto[]): Promise<Map<string, string>> {
  const localUriByStoragePath = new Map<string, string>();
  if (!storage || photos.length === 0) return localUriByStoragePath;
```

これを以下に変更する:

```ts
export async function downloadKitPhotosForRestore(photos: BackupKitPhoto[]): Promise<Map<string, string>> {
  const localUriByStoragePath = new Map<string, string>();
  if (!getEntitlements().hasPhotoBackup) return localUriByStoragePath;
  if (!storage || photos.length === 0) return localUriByStoragePath;
```

- [ ] **Step 3: 型チェック**

```bash
node node_modules/typescript/bin/tsc --noEmit
```

Expected: エラーなし。

- [ ] **Step 4: BOM確認とコミット**

```bash
head -c 3 lib/cloudBackup.ts | od -An -tx1
head -c 3 lib/kitPhotoBackup.ts | od -An -tx1
git add lib/cloudBackup.ts lib/kitPhotoBackup.ts
git commit -m "fix: add defensive entitlement self-guards to restore functions"
```

---

### Task 4: I-5 — 起動シーケンスの耐障害性回復(`app/_layout.tsx`)

**Files:**
- Modify: `app/_layout.tsx`

**Interfaces:**
- Produces: 起動シーケンスの公開挙動は変更なし(`RootLayout`コンポーネントのpropsやexportは無し)。動作のみ変更(`initAuth`/`initAnalytics`の失敗がアプリ全体の起動を妨げなくなる)。

- [ ] **Step 1: `initAuth()`/`initAnalytics()`呼び出しに`.catch()`を追加**

`app/_layout.tsx`の現在の該当箇所:

```ts
        await Promise.all([initTheme(), initLocale(), initUiPrefs(), initAppMode(), initLastScreen(), initAuth(), initAnalytics()]);
```

これを以下に変更する(可読性のため複数行に整形し、`initAuth`/`initAnalytics`のみ`.catch()`で個別に失敗を握りつぶす):

```ts
        await Promise.all([
          initTheme(),
          initLocale(),
          initUiPrefs(),
          initAppMode(),
          initLastScreen(),
          // Firebase/RevenueCat/Google Play Servicesのネイティブ呼び出しに依存するため、
          // 実機で失敗する可能性がある。失敗してもカタログ閲覧・在庫管理といった
          // 認証と無関係なコア機能まで巻き込んでアプリ全体を起動不能にしないよう、
          // ここで握りつぶす(ready状態には遷移させる)。
          initAuth().catch((e) => console.error('initAuth: failed, continuing without auth', e)),
          initAnalytics().catch((e) => console.error('initAnalytics: failed, continuing without analytics', e)),
        ]);
```

- [ ] **Step 2: 型チェック**

```bash
node node_modules/typescript/bin/tsc --noEmit
```

Expected: エラーなし。

- [ ] **Step 3: BOM確認とコミット**

```bash
head -c 3 app/_layout.tsx | od -An -tx1
git add app/_layout.tsx
git commit -m "fix: prevent initAuth/initAnalytics failures from blocking app boot"
```

---

## 完了確認(全タスク後)

- [ ] `node node_modules/typescript/bin/tsc --noEmit`がエラーなしで完走する
- [ ] 変更した全ファイルにUTF-8 BOMが混入していない
- [ ] `translations/en.json`/`translations/ja.json`がJSON.parseでき、キー集合が引き続き一致していること
- [ ] `origin/feature/cloud-backup`へpush
