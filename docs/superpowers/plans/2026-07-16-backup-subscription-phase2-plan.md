# クラウドバックアップ サブスク化(フェーズ2: キット写真のクラウドバックアップ) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** キット写真を圧縮した上でFirebase Storageにバックアップ/復元できるようにし、スタンダードプラン加入者(`hasPhotoBackup`エンタイトルメント保有者)だけがこの機能を使える状態にする。

**Architecture:** 既存の`lib/kitPhoto.ts`(ローカル永続化)の`persist()`に圧縮処理を追加し、新規`lib/kitPhotoBackup.ts`(Firebase Storageアップロード/ダウンロード、Expo Go互換ガード)を`lib/cloudBackup.ts`のバックアップ/復元フローに組み込む。`kit_photos`テーブルに`synced_at`列を追加し、「まだアップロードしていない行だけをアップロードする」差分方式で通信量を抑える。

**Tech Stack:** `expo-image-manipulator`(既存導入済み)、`@react-native-firebase/storage`(新規)、Expo SDK 54、TypeScript。

## Global Constraints

- 対象プラットフォーム: Android・iOS両方。
- Git運用: メインブランチに直接コミットしない。本計画は`feature/backup-subscription`ブランチ(ワークツリー: `.worktrees/feature-backup-subscription`)で作業する。
- Expo Go互換性: 新規に追加するネイティブモジュール(`@react-native-firebase/storage`)は、`lib/mobileAds.native.ts`と同じ`Constants.appOwnership === 'expo'`ガードパターンを適用し、Expo Go実行時はrequireせずnullにフォールバックする。
- 検証方法: `node node_modules/typescript/bin/tsc --noEmit`(`npx tsc --noEmit`がPATH未解決で失敗する場合のフォールバック)。このプロジェクトにはユニットテストフレームワークが存在しないため、新規にJest等を導入しない。各タスクの検証はtsc + 手動コードレビュー + (可能な場合)実機/Expo Go確認とする。
- ファイル整合性: 編集したファイル(特に`translations/*.json`)にUTF-8 BOMを混入させない。
- エンタイトルメント名は`backup`(ライト・スタンダード共通)、`backup_photos`(スタンダードのみ)で固定(フェーズ1で導入済み)。フェーズ2では`backup_photos`(= `hasPhotoBackup`)を実際に判定に使う。
- Firebase Storageの通信量・書き込み回数コストを避けるため、写真アップロードは「まだアップロードしていない行だけ」を対象にする差分方式で行う(全量アップロードを毎回行わない)。
- Cloud Functions(解約時の自動削除等のサーバーサイド処理)のコード実装は本計画のスコープ外。必要な設定手順のみランブックに記載する。

---

### Task 1: キット写真の圧縮(`lib/kitPhoto.ts`)

**Files:**
- Modify: `lib/kitPhoto.ts`

**Interfaces:**
- Produces: `persist()`(既存の内部関数、シグネチャ変更なし)の動作が「圧縮してから保存」に変わる。`pickKitPhotoFromCamera()`/`pickKitPhotosFromLibrary()`の公開シグネチャは変更なし。

- [ ] **Step 1: 圧縮処理を追加**

`lib/kitPhoto.ts`の現在の内容:

```ts
// lib/kitPhoto.ts
// キット写真の選択・永続化。ImagePickerが返す一時URIは端末側のキャッシュ整理で
// 消える可能性があるため、documentDirectory配下にコピーしてから保存する。
import * as FileSystem from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';
import * as MediaLibrary from 'expo-media-library';

const KIT_PHOTO_DIR = `${FileSystem.documentDirectory}kit-photos/`;

async function ensureDir(): Promise<void> {
  const info = await FileSystem.getInfoAsync(KIT_PHOTO_DIR);
  if (!info.exists) await FileSystem.makeDirectoryAsync(KIT_PHOTO_DIR, { intermediates: true });
}

async function persist(sourceUri: string): Promise<string> {
  await ensureDir();
  // 複数枚を続けて保存する際にファイル名が衝突しないよう乱数を添える。
  const dest = `${KIT_PHOTO_DIR}${Date.now()}-${Math.floor(Math.random() * 1e6)}.jpg`;
  await FileSystem.copyAsync({ from: sourceUri, to: dest });
  return dest;
}
```

これを以下に置き換える(import追加・圧縮関数追加・`persist()`の内部実装変更):

```ts
// lib/kitPhoto.ts
// キット写真の選択・永続化。ImagePickerが返す一時URIは端末側のキャッシュ整理で
// 消える可能性があるため、documentDirectory配下にコピーしてから保存する。
import { Image } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import * as MediaLibrary from 'expo-media-library';

const KIT_PHOTO_DIR = `${FileSystem.documentDirectory}kit-photos/`;

// クラウドバックアップ(スタンダードプラン)の通信量・ストレージ容量を抑えるため、
// 保存時点で長辺1600pxまでリサイズ+JPEG品質0.7に圧縮する。
const MAX_DIMENSION = 1600;
const JPEG_QUALITY = 0.7;

async function ensureDir(): Promise<void> {
  const info = await FileSystem.getInfoAsync(KIT_PHOTO_DIR);
  if (!info.exists) await FileSystem.makeDirectoryAsync(KIT_PHOTO_DIR, { intermediates: true });
}

function getImageSize(uri: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    Image.getSize(uri, (width, height) => resolve({ width, height }), reject);
  });
}

async function compress(sourceUri: string): Promise<string> {
  const { width, height } = await getImageSize(sourceUri);
  const resize = width >= height
    ? { width: Math.min(width, MAX_DIMENSION) }
    : { height: Math.min(height, MAX_DIMENSION) };
  const result = await ImageManipulator.manipulateAsync(
    sourceUri,
    [{ resize }],
    { compress: JPEG_QUALITY, format: ImageManipulator.SaveFormat.JPEG }
  );
  return result.uri;
}

async function persist(sourceUri: string): Promise<string> {
  await ensureDir();
  // 複数枚を続けて保存する際にファイル名が衝突しないよう乱数を添える。
  const dest = `${KIT_PHOTO_DIR}${Date.now()}-${Math.floor(Math.random() * 1e6)}.jpg`;
  // 圧縮に失敗しても写真保存自体は失敗させたくないため、失敗時は元画像をそのまま使う。
  const sourceToCopy = await compress(sourceUri).catch((e) => {
    console.error('persist: compression failed, saving original', e);
    return sourceUri;
  });
  await FileSystem.copyAsync({ from: sourceToCopy, to: dest });
  return dest;
}
```

ファイルの残り(`pickKitPhotoFromCamera`/`pickKitPhotosFromLibrary`/`deleteKitPhoto`/`saveKitPhotoToLibrary`)は変更しない。

- [ ] **Step 2: 型チェック**

```bash
node node_modules/typescript/bin/tsc --noEmit
```

Expected: エラーなし。

- [ ] **Step 3: BOM確認とコミット**

```bash
head -c 3 lib/kitPhoto.ts | od -An -tx1
git add lib/kitPhoto.ts
git commit -m "feat: compress kit photos on save (max 1600px, JPEG 0.7)"
```

---

### Task 2: `kit_photos.synced_at`列の追加(`lib/db.ts`)

**Files:**
- Modify: `lib/db.ts`

**Interfaces:**
- Produces: `kit_photos`テーブルに`synced_at TEXT`列(nullable、デフォルトNULL)。Task 3/4がこの列を`WHERE synced_at IS NULL`(未アップロード判定)で参照する。

- [ ] **Step 1: マイグレーション行を追加**

`lib/db.ts`の既存マイグレーションブロック(`initDB()`内、他のALTER TABLE行が並んでいる箇所)に1行追加する。現在の該当箇所:

```ts
  try { await db.execAsync('ALTER TABLE kits ADD COLUMN price INTEGER'); } catch { /* 既にある */ }
  try { await db.execAsync('ALTER TABLE kit_colors ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0'); } catch { /* 既にある */ }
  await db.runAsync(
```

これを以下に変更する(`kit_colors`の行の後、`price`の追加と同じ書式で1行追加):

```ts
  try { await db.execAsync('ALTER TABLE kits ADD COLUMN price INTEGER'); } catch { /* 既にある */ }
  try { await db.execAsync('ALTER TABLE kit_colors ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0'); } catch { /* 既にある */ }
  // クラウドバックアップ(スタンダードプラン)で、アップロード済みかどうかを判定するための列。
  try { await db.execAsync('ALTER TABLE kit_photos ADD COLUMN synced_at TEXT'); } catch { /* 既にある */ }
  await db.runAsync(
```

- [ ] **Step 2: 型チェック**

```bash
node node_modules/typescript/bin/tsc --noEmit
```

Expected: エラーなし。

- [ ] **Step 3: BOM確認とコミット**

```bash
head -c 3 lib/db.ts | od -An -tx1
git add lib/db.ts
git commit -m "feat: add kit_photos.synced_at column for cloud photo backup"
```

---

### Task 3: `lib/kitPhotoBackup.ts`(新規)+ Firebase Storageセキュリティルール

**Files:**
- Modify: `package.json`(`@react-native-firebase/storage`を追加)
- Create: `lib/kitPhotoBackup.ts`
- Create: `storage.rules`

**Interfaces:**
- Consumes: Task 2の`kit_photos.synced_at`列、`lib/subscription.ts`の`getEntitlements(): Entitlements`(既存、フェーズ1で実装済み)
- Produces:
  - `export interface BackupKitPhoto { kitLocalRef: string; storagePath: string; sort_order: number; }`
  - `kitPhotoStoragePath(uid: string, localUri: string): string | null`
  - `uploadPendingKitPhotos(): Promise<void>`
  - `downloadKitPhotosForRestore(photos: BackupKitPhoto[]): Promise<Map<string, string>>`(戻り値: `storagePath → ダウンロード後のローカルuri`のマップ)
  - `deleteUploadedKitPhoto(localUri: string): Promise<void>`

- [ ] **Step 1: `@react-native-firebase/storage`を追加**

```bash
npx expo install @react-native-firebase/storage
```

Expected: `package.json`の`dependencies`に、他の`@react-native-firebase/*`と同じバージョン系列(`^25.1.0`系)で追加される。`npx`がPATHエラーになる場合はPowerShellツールで実行する。

- [ ] **Step 2: `lib/kitPhotoBackup.ts`を作成**

```ts
// lib/kitPhotoBackup.ts
// キット写真本体(バイナリ)のFirebase Storageアップロード/ダウンロード。
// メタデータ(kit_photosのDB行)の同期はlib/cloudBackup.tsが担当し、
// このファイルは実ファイルの転送だけを受け持つ。
import * as FileSystem from 'expo-file-system/legacy';
import Constants from 'expo-constants';
import { getDB } from './db';
import { getEntitlements } from './subscription';

const isExpoGo = Constants.appOwnership === 'expo';

// Expo Goのバイナリにはネイティブモジュールが含まれないため、
// import(=require)時点でクラッシュする。mobileAds.native.tsと同じパターンで
// Expo Go実行時はrequireせずnullにフォールバックする。
const auth: typeof import('@react-native-firebase/auth').default | null = isExpoGo
  ? null
  : (require('@react-native-firebase/auth').default as typeof import('@react-native-firebase/auth').default);
const storage: typeof import('@react-native-firebase/storage').default | null = isExpoGo
  ? null
  : (require('@react-native-firebase/storage').default as typeof import('@react-native-firebase/storage').default);

const KIT_PHOTO_DIR = `${FileSystem.documentDirectory}kit-photos/`;

export interface BackupKitPhoto {
  kitLocalRef: string;
  storagePath: string;
  sort_order: number;
}

function filenameFromUri(uri: string): string | null {
  const name = uri.split('/').pop();
  return name && name.length > 0 ? name : null;
}

// ローカルURIのファイル名(persist()が生成する `${Date.now()}-${random}.jpg`)を
// そのままStorageキーに流用する。kit_photos.idは端末ごとの自動採番で衝突しうるが、
// このファイル名は端末をまたいでも衝突しにくいため安全(cloudBackup.tsのレビューで
// 同じ理由からkit_boxes等のlocalRefにもidではなくこの方式を検討した経緯がある)。
export function kitPhotoStoragePath(uid: string, localUri: string): string | null {
  const filename = filenameFromUri(localUri);
  return filename ? `users/${uid}/kit-photos/${filename}` : null;
}

interface PendingPhotoRow {
  id: number;
  uri: string;
}

// バックグラウンド遷移のたびに全量アップロードすると、未変更の写真まで毎回
// 再送してしまい通信量・書き込み回数コストが無視できなくなる。synced_atが
// NULLの(未アップロードの)行だけを対象にする差分方式。
export async function uploadPendingKitPhotos(): Promise<void> {
  if (!auth || !storage) return;
  if (!getEntitlements().hasPhotoBackup) return;
  const user = auth().currentUser;
  if (!user) return;

  const db = getDB();
  const pending = await db.getAllAsync<PendingPhotoRow>('SELECT id, uri FROM kit_photos WHERE synced_at IS NULL');
  for (const photo of pending) {
    const path = kitPhotoStoragePath(user.uid, photo.uri);
    if (!path) continue;
    try {
      await storage().ref(path).putFile(photo.uri);
      await db.runAsync("UPDATE kit_photos SET synced_at = datetime('now') WHERE id = ?", [photo.id]);
    } catch (e) {
      console.error('uploadPendingKitPhotos: failed to upload', photo.uri, e);
    }
  }
}

export async function downloadKitPhotosForRestore(photos: BackupKitPhoto[]): Promise<Map<string, string>> {
  const localUriByStoragePath = new Map<string, string>();
  if (!storage || photos.length === 0) return localUriByStoragePath;

  const info = await FileSystem.getInfoAsync(KIT_PHOTO_DIR);
  if (!info.exists) await FileSystem.makeDirectoryAsync(KIT_PHOTO_DIR, { intermediates: true });

  for (const photo of photos) {
    const filename = photo.storagePath.split('/').pop();
    if (!filename) continue;
    const dest = `${KIT_PHOTO_DIR}${filename}`;
    try {
      const url = await storage().ref(photo.storagePath).getDownloadURL();
      await FileSystem.downloadAsync(url, dest);
      localUriByStoragePath.set(photo.storagePath, dest);
    } catch (e) {
      console.error('downloadKitPhotosForRestore: failed to download', photo.storagePath, e);
    }
  }
  return localUriByStoragePath;
}

// キット/キットボックスの一括削除やクラウド復元前のローカルデータ一掃では
// 呼ばない(復元直後に復元元のStorageオブジェクトを消してしまう事故を防ぐため)。
// ユーザーが個々の写真を明示的に削除する操作(KitDetailModalの単体削除)からのみ呼ぶ。
// 一括削除経路で生じるStorage上の孤児オブジェクトは、解約時クリーンアップと同じ
// Cloud Functionsの定期整理(本リポジトリのスコープ外)で回収する想定。
export async function deleteUploadedKitPhoto(localUri: string): Promise<void> {
  if (!auth || !storage) return;
  if (!getEntitlements().hasPhotoBackup) return;
  const user = auth().currentUser;
  if (!user) return;
  const path = kitPhotoStoragePath(user.uid, localUri);
  if (!path) return;
  try {
    await storage().ref(path).delete();
  } catch (e) {
    // アップロード前に削除された場合はStorage側に存在せず失敗するのが正常系。
    console.warn('deleteUploadedKitPhoto: delete failed (may not exist)', e);
  }
}
```

- [ ] **Step 3: `storage.rules`を作成**

```
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /users/{uid}/kit-photos/{fileName} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }
  }
}
```

このファイルは`firestore.rules`と同じく、Firebaseコンソールへの手動デプロイを前提とする(このリポジトリに`firebase.json`によるデプロイパイプラインは無い、既存の`firestore.rules`と同じ運用)。

- [ ] **Step 4: 型チェック**

```bash
node node_modules/typescript/bin/tsc --noEmit
```

Expected: `lib/kitPhotoBackup.ts`起因のエラーが出ないこと(この時点では他ファイルから未参照)。

- [ ] **Step 5: BOM確認とコミット**

```bash
head -c 3 lib/kitPhotoBackup.ts | od -An -tx1
head -c 3 storage.rules | od -An -tx1
git add package.json package-lock.json lib/kitPhotoBackup.ts storage.rules
git commit -m "feat: add Firebase Storage upload/download module for kit photos"
```

---

### Task 4: `lib/cloudBackup.ts`拡張(スキーマv3・キット写真対応)

**Files:**
- Modify: `lib/cloudBackup.ts`

**Interfaces:**
- Consumes: Task 3の`BackupKitPhoto`, `kitPhotoStoragePath`, `uploadPendingKitPhotos`, `downloadKitPhotosForRestore`
- Produces: `BackupSnapshot.kitPhotos?: BackupKitPhoto[]`(既存の公開関数`buildBackupSnapshot`/`restoreFromSnapshot`/`pushBackupToFirestore`のシグネチャ自体は変更なし)

- [ ] **Step 1: importとスキーマバージョンコメントを更新**

`lib/cloudBackup.ts`の現在の該当箇所:

```ts
import { AppState, AppStateStatus } from 'react-native';
import Constants from 'expo-constants';
import { catalogCode, getDB, getSetting, KitStatus, PaintStatus, setSetting } from './db';
import { deleteKitPhoto } from './kitPhoto';
import { getEntitlements } from './subscription';
```

これを以下に変更する(1行追加):

```ts
import { AppState, AppStateStatus } from 'react-native';
import Constants from 'expo-constants';
import { catalogCode, getDB, getSetting, KitStatus, PaintStatus, setSetting } from './db';
import { deleteKitPhoto } from './kitPhoto';
import { BackupKitPhoto, downloadKitPhotosForRestore, kitPhotoStoragePath, uploadPendingKitPhotos } from './kitPhotoBackup';
import { getEntitlements } from './subscription';
```

現在の該当箇所:

```ts
// v2: kit_boxes/kits/kit_colors/kit_color_paints(キット管理機能)を追加。
// v1スナップショットにはこれらのフィールドが無いため、復元側は `?? []` で
// optional に扱い、キット部分が空のまま復元されても壊れないようにする。
const BACKUP_SCHEMA_VERSION = 2;
```

これを以下に変更する:

```ts
// v2: kit_boxes/kits/kit_colors/kit_color_paints(キット管理機能)を追加。
// v3: kitPhotos(スタンダードプラン限定のキット写真)を追加。
// v1/v2スナップショットにはこれらのフィールドが無いため、復元側は `?? []` で
// optional に扱い、無い部分が空のまま復元されても壊れないようにする。
const BACKUP_SCHEMA_VERSION = 3;
```

- [ ] **Step 2: `BackupSnapshot`型に`kitPhotos`を追加**

現在の該当箇所:

```ts
export interface BackupSnapshot {
  schemaVersion: number;
  updatedAt?: unknown;
  boxes: BackupBox[];
  manualPaints: BackupPaint[];
  officialPaintNotes: BackupPaintNote[];
  inventory: BackupInventory[];
  favorites: BackupListItem[];
  wishlist: BackupListItem[];
  defaultBoxLocalRef: string | null;
  // v2で追加。v1スナップショットには存在しないため optional。
  kitBoxes?: BackupKitBox[];
  kits?: BackupKit[];
  kitColors?: BackupKitColor[];
  kitColorPaints?: BackupKitColorPaint[];
  defaultKitBoxLocalRef?: string | null;
}
```

これを以下に変更する(`kitPhotos`フィールド追加):

```ts
export interface BackupSnapshot {
  schemaVersion: number;
  updatedAt?: unknown;
  boxes: BackupBox[];
  manualPaints: BackupPaint[];
  officialPaintNotes: BackupPaintNote[];
  inventory: BackupInventory[];
  favorites: BackupListItem[];
  wishlist: BackupListItem[];
  defaultBoxLocalRef: string | null;
  // v2で追加。v1スナップショットには存在しないため optional。
  kitBoxes?: BackupKitBox[];
  kits?: BackupKit[];
  kitColors?: BackupKitColor[];
  kitColorPaints?: BackupKitColorPaint[];
  defaultKitBoxLocalRef?: string | null;
  // v3で追加。スタンダードプラン(hasPhotoBackup)加入者のみ書き込まれる。
  kitPhotos?: BackupKitPhoto[];
}
```

- [ ] **Step 3: `buildBackupSnapshot()`に`kitPhotos`クエリを追加**

現在の該当箇所(関数の末尾、`defaultKitBoxId`取得の直後):

```ts
  const defaultKitBoxId = await getSetting('default_kit_box_id');
  const defaultKitBoxExists = defaultKitBoxId ? kitBoxRows.some((b) => b.id === Number(defaultKitBoxId)) : false;

  return {
```

これを以下に変更する(`kitPhotoRows`取得を追加):

```ts
  const defaultKitBoxId = await getSetting('default_kit_box_id');
  const defaultKitBoxExists = defaultKitBoxId ? kitBoxRows.some((b) => b.id === Number(defaultKitBoxId)) : false;

  // アップロード済み(synced_at確定済み)の写真だけをスナップショットに含める。
  // アップロード前の行を含めるとStorage側に実体が無いパスを参照してしまい、
  // 復元時のダウンロードが失敗する。
  const uid = auth?.().currentUser?.uid ?? null;
  const kitPhotoRows = uid && getEntitlements().hasPhotoBackup
    ? await db.getAllAsync<{ kit_id: number; uri: string; sort_order: number }>(
        'SELECT kit_id, uri, sort_order FROM kit_photos WHERE synced_at IS NOT NULL ORDER BY sort_order, id'
      )
    : [];

  return {
```

現在の`return`ブロック末尾の該当箇所:

```ts
    // kit_photos(写真)はローカル端末のファイルパスであり、複数端末間の
    // バックアップ/復元には対応できない(Firebase Storage連携は未実装)ため、
    // 意図的にバックアップ対象から除外する。設定画面にもその旨の注記がある。
    kitColorPaints: kitColorPaintRows.map((cp) => ({
      kitColorLocalRef: kitColorLocalRef(cp.kit_color_id),
      catalog_code: paintCatalogCode(cp),
      ratio: cp.ratio,
      sort_order: cp.sort_order,
    })),
    defaultKitBoxLocalRef: defaultKitBoxExists && defaultKitBoxId ? kitBoxLocalRef(Number(defaultKitBoxId)) : null,
  };
}
```

これを以下に変更する(コメント更新+`kitPhotos`フィールド追加):

```ts
    kitColorPaints: kitColorPaintRows.map((cp) => ({
      kitColorLocalRef: kitColorLocalRef(cp.kit_color_id),
      catalog_code: paintCatalogCode(cp),
      ratio: cp.ratio,
      sort_order: cp.sort_order,
    })),
    defaultKitBoxLocalRef: defaultKitBoxExists && defaultKitBoxId ? kitBoxLocalRef(Number(defaultKitBoxId)) : null,
    // v3: hasPhotoBackup(スタンダードプラン)加入者のみ、アップロード済みの
    // キット写真をStorageパス参照として含める。ライトプラン/未加入時は空配列。
    kitPhotos: uid
      ? kitPhotoRows
          .map((p) => {
            const storagePath = kitPhotoStoragePath(uid, p.uri);
            return storagePath ? { kitLocalRef: kitLocalRef(p.kit_id), storagePath, sort_order: p.sort_order } : null;
          })
          .filter((p): p is BackupKitPhoto => p !== null)
      : [],
  };
}
```

- [ ] **Step 4: `pushBackupToFirestore()`で写真アップロードを先に実行**

現在の該当箇所:

```ts
  pushInFlight = (async () => {
    const snapshot = await buildBackupSnapshot();
    const now = new Date().toISOString();
```

これを以下に変更する(スナップショット構築より前に写真アップロードを実行し、アップロード済みのものだけがスナップショットに載るようにする):

```ts
  pushInFlight = (async () => {
    if (getEntitlements().hasPhotoBackup) {
      await uploadPendingKitPhotos().catch((e) => console.error('pushBackupToFirestore: failed to upload kit photos', e));
    }
    const snapshot = await buildBackupSnapshot();
    const now = new Date().toISOString();
```

- [ ] **Step 5: `restoreFromSnapshot()`で写真復元を追加**

現在の該当箇所(関数末尾、トランザクション終了後の孤児写真削除ループ):

```ts
  // 写真ファイルの実削除はベストエフォート。DB行は既にトランザクション内で
  // 削除済みのため、1件の削除失敗で残り全部を諦めない(ログだけ残して続行)。
  for (const uri of orphanedKitPhotoUris) {
    try {
      await deleteKitPhoto(uri);
    } catch (e) {
      console.error('restoreFromSnapshot: failed to delete orphaned kit photo', uri, e);
    }
  }
}
```

これを以下に変更する(孤児写真削除の後に、クラウド上の写真ダウンロード・kit_photos行の再構築を追加):

```ts
  // 写真ファイルの実削除はベストエフォート。DB行は既にトランザクション内で
  // 削除済みのため、1件の削除失敗で残り全部を諦めない(ログだけ残して続行)。
  for (const uri of orphanedKitPhotoUris) {
    try {
      await deleteKitPhoto(uri);
    } catch (e) {
      console.error('restoreFromSnapshot: failed to delete orphaned kit photo', uri, e);
    }
  }

  // キット写真のダウンロードはネットワークI/Oのため、SQLiteトランザクションの
  // 外で行う。ダウンロード成功分だけkit_photos行を再構築する(ベストエフォート)。
  if (getEntitlements().hasPhotoBackup && (snapshot.kitPhotos?.length ?? 0) > 0) {
    const localUriByStoragePath = await downloadKitPhotosForRestore(snapshot.kitPhotos ?? []);
    for (const photo of snapshot.kitPhotos ?? []) {
      const kitId = kitIdByLocalRef.get(photo.kitLocalRef);
      const localUri = localUriByStoragePath.get(photo.storagePath);
      if (!kitId || !localUri) {
        console.warn('restoreFromSnapshot: skipping kit photo for missing kit or failed download', photo.kitLocalRef, photo.storagePath);
        continue;
      }
      try {
        await db.runAsync(
          "INSERT INTO kit_photos (kit_id, uri, sort_order, synced_at) VALUES (?, ?, ?, datetime('now'))",
          [kitId, localUri, photo.sort_order]
        );
      } catch (e) {
        console.error('restoreFromSnapshot: failed to insert restored kit photo', photo.storagePath, e);
      }
    }
  }
}
```

上記コードは`kitIdByLocalRef`(現在はトランザクションコールバック内の`const`として宣言されている)をトランザクション外からも参照できる必要がある。関数冒頭を以下のように変更する。

現在の該当箇所:

```ts
export async function restoreFromSnapshot(snapshot: BackupSnapshot): Promise<void> {
  const db = getDB();
  let orphanedKitPhotoUris: string[] = [];

  await db.withTransactionAsync(async () => {
```

これを以下に変更する(`kitIdByLocalRef`を関数スコープに宣言):

```ts
export async function restoreFromSnapshot(snapshot: BackupSnapshot): Promise<void> {
  const db = getDB();
  let orphanedKitPhotoUris: string[] = [];
  const kitIdByLocalRef = new Map<string, number>();

  await db.withTransactionAsync(async () => {
```

そして、トランザクションコールバック内にある現在の該当箇所:

```ts
    const kitIdByLocalRef = new Map<string, number>();
    for (const kit of snapshot.kits ?? []) {
```

これを以下に変更する(`const kitIdByLocalRef = new Map<string, number>();`の行を削除し、外側で宣言したものをそのまま使う):

```ts
    for (const kit of snapshot.kits ?? []) {
```

- [ ] **Step 6: 型チェック**

```bash
node node_modules/typescript/bin/tsc --noEmit
```

Expected: エラーなし。

- [ ] **Step 7: BOM確認とコミット**

```bash
head -c 3 lib/cloudBackup.ts | od -An -tx1
git add lib/cloudBackup.ts
git commit -m "feat: extend cloud backup snapshot to schema v3 with kit photos"
```

---

### Task 5: 個別写真削除時のStorageクリーンアップ(`components/KitDetailModal.tsx`)

**Files:**
- Modify: `components/KitDetailModal.tsx`

**Interfaces:**
- Consumes: Task 3の`deleteUploadedKitPhoto(localUri: string): Promise<void>`

ユーザーがキット写真を個別に削除する唯一の操作(`removePhoto`)にのみStorage削除を追加する。キット削除・キットボックス削除・全リセット・クラウド復元前のローカル一掃といった一括削除経路は、`lib/kitPhotoBackup.ts`のコメントに記載の通り意図的に対象外とする(Cloud Functionsの定期整理で将来的に回収する設計)。

- [ ] **Step 1: importと`removePhoto`を変更**

`components/KitDetailModal.tsx`の現在の該当箇所:

```ts
import { deleteKitPhoto } from '../lib/kitPhoto';
```

これを以下に変更する:

```ts
import { deleteKitPhoto } from '../lib/kitPhoto';
import { deleteUploadedKitPhoto } from '../lib/kitPhotoBackup';
```

現在の該当箇所:

```ts
  const removePhoto = async (photoId: number, uri: string) => {
    await removeKitPhoto(photoId);
    await deleteKitPhoto(uri);
    await load();
    onChanged?.();
  };
```

これを以下に変更する:

```ts
  const removePhoto = async (photoId: number, uri: string) => {
    await removeKitPhoto(photoId);
    await deleteKitPhoto(uri);
    deleteUploadedKitPhoto(uri).catch((e) => console.error('removePhoto: failed to delete uploaded copy', e));
    await load();
    onChanged?.();
  };
```

- [ ] **Step 2: 型チェック**

```bash
node node_modules/typescript/bin/tsc --noEmit
```

Expected: エラーなし。

- [ ] **Step 3: BOM確認とコミット**

```bash
head -c 3 components/KitDetailModal.tsx | od -An -tx1
git add components/KitDetailModal.tsx
git commit -m "feat: delete Storage copy when a kit photo is individually removed"
```

---

### Task 6: 設定画面のプラン表示を正確化(`app/(tabs)/settings.tsx`+翻訳)

**Files:**
- Modify: `app/(tabs)/settings.tsx`
- Modify: `translations/en.json`
- Modify: `translations/ja.json`

**Interfaces:**
- Consumes: `lib/subscription.ts`の`useEntitlements()`が返す`hasPhotoBackup`(フェーズ1で型定義済み、これまで未使用だった)

フェーズ1では`hasPhotoBackup`が常に`false`だったため、プラン表示は`hasBackup`だけで「無料/スタンダード」の2値に簡略化されていた(計画書に暫定仕様と明記済み)。フェーズ2で`hasPhotoBackup`が意味を持つようになったため、ライト/スタンダードを正しく判別する。

- [ ] **Step 1: 翻訳キーを追加**

`translations/en.json`の末尾付近の該当箇所:

```
"backupRequiresSubscription":"Cloud backup requires a subscription.","viewPlans":"View plans","restorePurchases":"Restore purchases","purchaseError":"Something went wrong with your subscription. Please try again."}
```

これを以下に変更する(末尾の`}`の直前に新規キーを追加):

```
"backupRequiresSubscription":"Cloud backup requires a subscription.","viewPlans":"View plans","restorePurchases":"Restore purchases","purchaseError":"Something went wrong with your subscription. Please try again.","cloudBackupPhotosIncluded":"Cloud backup includes kit photos."}
```

`translations/ja.json`の末尾付近の該当箇所:

```
"backupRequiresSubscription":"クラウドバックアップの利用には有料プランへの加入が必要です。","viewPlans":"プランを見る","restorePurchases":"購入を復元","purchaseError":"購入処理に失敗しました。もう一度お試しください。"}
```

これを以下に変更する:

```
"backupRequiresSubscription":"クラウドバックアップの利用には有料プランへの加入が必要です。","viewPlans":"プランを見る","restorePurchases":"購入を復元","purchaseError":"購入処理に失敗しました。もう一度お試しください。","cloudBackupPhotosIncluded":"クラウドバックアップにはキットの写真も含まれます。"}
```

- [ ] **Step 2: プラン表示ロジックを修正**

`app/(tabs)/settings.tsx`の現在の該当箇所:

```tsx
  const authUser = useAuthUser();
  const { hasBackup } = useEntitlements();
  const [purchaseBusy, setPurchaseBusy] = useState(false);
```

これを以下に変更する(`hasPhotoBackup`も取り出す):

```tsx
  const authUser = useAuthUser();
  const { hasBackup, hasPhotoBackup } = useEntitlements();
  const [purchaseBusy, setPurchaseBusy] = useState(false);
```

現在の該当箇所:

```tsx
        <Text style={styles.accountSubText}>
          {t('currentPlan')}: {hasBackup ? t('planStandard') : t('planFree')}
        </Text>
        {hasBackup ? (
          <>
            <Text style={styles.accountSubText}>{t('cloudBackupPhotosNote')}</Text>
```

これを以下に変更する(プラン名の出し分け、写真バックアップ有無の注記を出し分け):

```tsx
        <Text style={styles.accountSubText}>
          {t('currentPlan')}: {hasPhotoBackup ? t('planStandard') : hasBackup ? t('planLight') : t('planFree')}
        </Text>
        {hasBackup ? (
          <>
            <Text style={styles.accountSubText}>{hasPhotoBackup ? t('cloudBackupPhotosIncluded') : t('cloudBackupPhotosNote')}</Text>
```

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
git commit -m "feat: distinguish Light/Standard plan display now that hasPhotoBackup is used"
```

---

### Task 7: RevenueCat/ストア設定ランブックの更新

**Files:**
- Modify: `docs/revenuecat-setup-runbook.md`

コード変更を伴わない。フェーズ2で追加したFirebase Storageのセキュリティルール反映手順と、一括削除経路で生じうるStorage孤児オブジェクトの扱い(将来のCloud Functions整理タスクへの申し送り)を追記する。

- [ ] **Step 1: ランブックにセクションを追加**

`docs/revenuecat-setup-runbook.md`の末尾に以下のセクションを追記する:

```markdown

## 6. Firebase Storageセキュリティルールの反映(フェーズ2で追加)

キット写真バックアップ機能の追加に伴い、リポジトリ直下に`storage.rules`を追加した。`firestore.rules`と同様、このリポジトリには自動デプロイの仕組みが無いため、Firebaseコンソールの「Storage」→「Rules」タブに`storage.rules`の内容を手動で貼り付けてデプロイする。

## 7. Storage孤児オブジェクトの扱い(既知の制限)

キット写真の削除は、ユーザーが写真を個別に削除した場合のみFirebase Storage側の実体も削除する。キット/キットボックスの一括削除・全リセット・クラウド復元時のローカルデータ一掃では、Storage側のクリーンアップを行わない(復元直後に復元元のデータを消してしまう事故を避けるため)。また、スタンダードプランを解約したユーザーの写真も、5.セクションに記載の猶予期間後の自動削除(Cloud Functions、未実装)が無い限りStorageに残り続ける。

これらは全て「定期的なサーバーサイド整理ジョブ(Cloud Functions)」で解決すべき問題であり、このリポジトリ(Expo Reactネイティブアプリ)側の実装対象ではない。将来Cloud Functionsを実装する際は、この2点をまとめて対応すること。
```

- [ ] **Step 2: BOM確認とコミット**

```bash
head -c 3 docs/revenuecat-setup-runbook.md | od -An -tx1
git add docs/revenuecat-setup-runbook.md
git commit -m "docs: document Storage rules deployment and orphan cleanup limitations"
```

---

## 完了確認(全タスク後)

- [ ] `node node_modules/typescript/bin/tsc --noEmit`がエラーなしで完走する
- [ ] 変更した全ファイルにUTF-8 BOMが混入していない
- [ ] `storage.rules`が`firestore.rules`と同じ「自分のuid配下のみ読み書き可」パターンになっている
- [ ] `hasPhotoBackup`が`false`のユーザーでは、キット写真アップロード・ダウンロード・削除のいずれもFirebase Storageに触れない設計になっていること(コードレビューで確認)
- [ ] Expo Go(`expo start`)実行時に`lib/kitPhotoBackup.ts`起因のクラッシュが起きない設計になっていること(コードレビューで確認)
- [ ] `origin/feature/backup-subscription`へpush
