# キット写真バックアップ 不具合修正(C-1/I-2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 多エージェントレビューで見つかった2件の設計不具合(C-1: プラン降格でクラウド上の写真参照が消える、I-2: Storageパスが端末間で意図せず共有される)を修正する。

**Architecture:** C-1は`pushBackupToFirestore()`の書き込みを`merge: true`にし、`buildBackupSnapshot()`が`hasPhotoBackup=false`時に`kitPhotos`キー自体を省略するようにする。I-2は`kit_photos`テーブルに`storage_path`列を新設し、Storage上の位置をローカルファイル名から独立した永続識別子として管理する。

**Tech Stack:** Expo SDK 54、TypeScript、`@react-native-firebase/firestore`、`@react-native-firebase/storage`。

## Global Constraints

- 対象プラットフォーム: Android・iOS両方。
- Git運用: メインブランチに直接コミットしない。本計画は`feature/cloud-backup`ブランチ(ワークツリー: `.worktrees/feature-cloud-backup`)で作業する。
- 検証方法: `node node_modules/typescript/bin/tsc --noEmit`(`npx tsc --noEmit`がPATH未解決で失敗する場合のフォールバック)。このプロジェクトにはユニットテストフレームワークが存在しないため、新規にJest等を導入しない。
- ファイル整合性: 編集したファイルにUTF-8 BOMを混入させない。
- この機能は未リリース(RevenueCat未設定)のため、既存データの後方互換移行処理は行わない。

---

### Task 1: C-1修正 — Firestore書き込みのmerge化(`lib/cloudBackup.ts`)

**Files:**
- Modify: `lib/cloudBackup.ts`

**Interfaces:**
- Produces: `buildBackupSnapshot()`/`pushBackupToFirestore()`の公開シグネチャは変更なし。動作のみ変更(`hasPhotoBackup=false`時、返り値オブジェクトに`kitPhotos`キーが存在しなくなる)。

- [ ] **Step 1: `buildBackupSnapshot()`の返り値で`kitPhotos`を条件付きスプレッドにする**

`lib/cloudBackup.ts`の`buildBackupSnapshot()`内、返り値オブジェクトの現在の該当箇所:

```ts
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

これを以下に変更する(`kitPhotos`を空配列で明示的に上書きするのではなく、対象外の場合はキー自体を省略する):

```ts
    defaultKitBoxLocalRef: defaultKitBoxExists && defaultKitBoxId ? kitBoxLocalRef(Number(defaultKitBoxId)) : null,
    // v3: hasPhotoBackup(スタンダードプラン)加入者のみ、アップロード済みの
    // キット写真をStorageパス参照として含める。マージ書き込み(pushBackupToFirestore側)
    // と組み合わせるため、非対象時はキー自体を省略する(空配列で明示的に上書きすると、
    // 降格直後の自動バックアップでクラウド上の既存写真参照を消してしまうため)。
    ...(uid && getEntitlements().hasPhotoBackup
      ? {
          kitPhotos: kitPhotoRows
            .map((p) => {
              const storagePath = kitPhotoStoragePath(uid, p.uri);
              return storagePath ? { kitLocalRef: kitLocalRef(p.kit_id), storagePath, sort_order: p.sort_order } : null;
            })
            .filter((p): p is BackupKitPhoto => p !== null),
        }
      : {}),
  };
}
```

（`kitPhotoRows`のクエリ自体(`const uid = ...`から始まる数行前のブロック)は今回のTaskでは変更しない。Task 4で別途変更する。）

- [ ] **Step 2: `pushBackupToFirestore()`の`.set()`を`merge: true`にする**

現在の該当箇所:

```ts
    await firestore!().collection('backups').doc(user.uid).set({
      ...snapshot,
      updatedAt: firestore!.FieldValue.serverTimestamp(),
    });
```

これを以下に変更する:

```ts
    await firestore!().collection('backups').doc(user.uid).set({
      ...snapshot,
      updatedAt: firestore!.FieldValue.serverTimestamp(),
    }, { merge: true });
```

- [ ] **Step 3: 型チェック**

```bash
node node_modules/typescript/bin/tsc --noEmit
```

Expected: エラーなし。

- [ ] **Step 4: BOM確認とコミット**

```bash
head -c 3 lib/cloudBackup.ts | od -An -tx1
git add lib/cloudBackup.ts
git commit -m "fix: preserve cloud kitPhotos reference on plan downgrade (merge write)"
```

---

### Task 2: I-2スキーマ — `kit_photos.storage_path`列の追加(`lib/db.ts`)

**Files:**
- Modify: `lib/db.ts`

**Interfaces:**
- Produces: `kit_photos.storage_path TEXT`列(nullable)。`KitPhoto`インターフェースに`storage_path: string | null`フィールド追加。`getKitPhotos()`が`storage_path`を含めて返す。

- [ ] **Step 1: マイグレーション行を追加**

`lib/db.ts`の既存マイグレーションブロックの現在の該当箇所:

```ts
  try { await db.execAsync('ALTER TABLE kit_colors ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0'); } catch { /* 既にある */ }
  // クラウドバックアップ(スタンダードプラン)で、アップロード済みかどうかを判定するための列。
  try { await db.execAsync('ALTER TABLE kit_photos ADD COLUMN synced_at TEXT'); } catch { /* 既にある */ }
  await db.runAsync(
```

これを以下に変更する(`synced_at`の行の後に1行追加):

```ts
  try { await db.execAsync('ALTER TABLE kit_colors ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0'); } catch { /* 既にある */ }
  // クラウドバックアップ(スタンダードプラン)で、アップロード済みかどうかを判定するための列。
  try { await db.execAsync('ALTER TABLE kit_photos ADD COLUMN synced_at TEXT'); } catch { /* 既にある */ }
  // Storage上の位置をローカルファイル名から独立した永続識別子として保持する列。
  // ローカルファイル名(uri)から都度導出すると、復元先の端末が同じファイル名を
  // 再利用した際に別端末と同一Storageオブジェクトを指してしまう事故につながるため。
  try { await db.execAsync('ALTER TABLE kit_photos ADD COLUMN storage_path TEXT'); } catch { /* 既にある */ }
  await db.runAsync(
```

- [ ] **Step 2: `KitPhoto`インターフェースと`getKitPhotos()`を更新**

現在の該当箇所:

```ts
export interface KitPhoto {
  id: number;
  uri: string;
  sort_order: number;
}

export async function getKitPhotos(kitId: number): Promise<KitPhoto[]> {
  return getDB().getAllAsync<KitPhoto>(
    'SELECT id, uri, sort_order FROM kit_photos WHERE kit_id = ? ORDER BY sort_order, id',
    [kitId]
  );
}
```

これを以下に変更する:

```ts
export interface KitPhoto {
  id: number;
  uri: string;
  sort_order: number;
  storage_path: string | null;
}

export async function getKitPhotos(kitId: number): Promise<KitPhoto[]> {
  return getDB().getAllAsync<KitPhoto>(
    'SELECT id, uri, sort_order, storage_path FROM kit_photos WHERE kit_id = ? ORDER BY sort_order, id',
    [kitId]
  );
}
```

`addKitPhoto()`は変更しない(新規写真の`storage_path`はアップロード時に別途設定されるため、INSERT時点ではNULLのままでよい)。

- [ ] **Step 3: 型チェック**

```bash
node node_modules/typescript/bin/tsc --noEmit
```

Expected: エラーなし(`KitPhoto`への新規フィールド追加は既存の呼び出し元と互換性があるため、この時点で型エラーは発生しない)。

- [ ] **Step 4: BOM確認とコミット**

```bash
head -c 3 lib/db.ts | od -An -tx1
git add lib/db.ts
git commit -m "feat: add kit_photos.storage_path column decoupled from local filename"
```

---

### Task 3: I-2コアロジック — `lib/kitPhotoBackup.ts`の書き換え

**Files:**
- Modify: `lib/kitPhotoBackup.ts`

**Interfaces:**
- Consumes: Task 2の`kit_photos.storage_path`列
- Produces(シグネチャ変更):
  - `kitPhotoStoragePath(uid: string, filename: string): string`(戻り値が`string | null`から`string`に変更、第2引数の意味が「ローカルURI」から「識別子(ファイル名)」に変更)
  - `deleteUploadedKitPhoto(storagePath: string | null): Promise<void>`(引数が`localUri: string`から`storagePath: string | null`に変更)
  - `uploadPendingKitPhotos(): Promise<void>`(シグネチャ変更なし、内部でアップロードのたびに新規識別子を生成し`storage_path`列に保存するよう変更)
  - `downloadKitPhotosForRestore(photos: BackupKitPhoto[]): Promise<Map<string, string>>`(シグネチャ変更なし、ダウンロード先ローカルファイル名を`storagePath`のベースネームではなく新規生成に変更)
  - `BackupKitPhoto`型は変更なし

- [ ] **Step 1: ファイル全体を書き換える**

`lib/kitPhotoBackup.ts`の現在の内容全体を、以下に置き換える:

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

// アップロード時・復元時のダウンロード先ファイル名生成に共通で使う。
// lib/kitPhoto.tsのpersist()と同じ命名方式(衝突しにくい)。
function generatePhotoFilename(): string {
  return `${Date.now()}-${Math.floor(Math.random() * 1e6)}.jpg`;
}

// filenameはStorage上の識別子(persist()由来のローカルファイル名ではなく、
// アップロード時に生成される専用の識別子)。ローカルファイル名から都度導出しないのは、
// 復元先の端末が同じファイル名を再利用すると別端末と同一Storageオブジェクトを
// 指してしまう事故につながるため(kit_photos.storage_path列に永続化して回避する)。
export function kitPhotoStoragePath(uid: string, filename: string): string {
  return `users/${uid}/kit-photos/${filename}`;
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
    const path = kitPhotoStoragePath(user.uid, generatePhotoFilename());
    try {
      await storage().ref(path).putFile(photo.uri);
      await db.runAsync("UPDATE kit_photos SET synced_at = datetime('now'), storage_path = ? WHERE id = ?", [path, photo.id]);
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
  return localUriByStoragePath;
}

// キット/キットボックスの一括削除やクラウド復元前のローカルデータ一掃では
// 呼ばない(復元直後に復元元のStorageオブジェクトを消してしまう事故を防ぐため)。
// ユーザーが個々の写真を明示的に削除する操作(KitDetailModalの単体削除)からのみ呼ぶ。
// 一括削除経路で生じるStorage上の孤児オブジェクトは、解約時クリーンアップと同じ
// Cloud Functionsの定期整理(本リポジトリのスコープ外)で回収する想定。
export async function deleteUploadedKitPhoto(storagePath: string | null): Promise<void> {
  if (!auth || !storage) return;
  if (!getEntitlements().hasPhotoBackup) return;
  if (!storagePath) return;
  const user = auth().currentUser;
  if (!user) return;
  try {
    await storage().ref(storagePath).delete();
  } catch (e) {
    // アップロード前に削除された場合はStorage側に存在せず失敗するのが正常系。
    console.warn('deleteUploadedKitPhoto: delete failed (may not exist)', e);
  }
}
```

- [ ] **Step 2: 型チェック**

```bash
node node_modules/typescript/bin/tsc --noEmit
```

Expected: エラーなし(`kitPhotoStoragePath`/`deleteUploadedKitPhoto`のシグネチャ変更後も、既存の呼び出し元(`lib/cloudBackup.ts`/`components/KitDetailModal.tsx`)が渡している`string`型の引数はそれぞれ新シグネチャの`string`/`string | null`に代入可能なため、この時点で型エラーは発生しない。呼び出し元の意味的な更新はTask 4で行う)。

- [ ] **Step 3: BOM確認とコミット**

```bash
head -c 3 lib/kitPhotoBackup.ts | od -An -tx1
git add lib/kitPhotoBackup.ts
git commit -m "fix: decouple Storage keys from local filenames to prevent cross-device collisions"
```

---

### Task 4: I-2配線 — `lib/cloudBackup.ts`と`components/KitDetailModal.tsx`の更新

**Files:**
- Modify: `lib/cloudBackup.ts`
- Modify: `components/KitDetailModal.tsx`

**Interfaces:**
- Consumes: Task 2の`KitPhoto.storage_path`、Task 3の`deleteUploadedKitPhoto(storagePath: string | null)`
- Produces: 変更なし(公開関数のシグネチャは維持)

- [ ] **Step 1: importから`kitPhotoStoragePath`を削除**

`lib/cloudBackup.ts`の現在の該当箇所:

```ts
import { BackupKitPhoto, downloadKitPhotosForRestore, kitPhotoStoragePath, uploadPendingKitPhotos } from './kitPhotoBackup';
```

これを以下に変更する(`kitPhotoStoragePath`はこのファイルではもう使わない。Task 3の`uploadPendingKitPhotos`内部に処理が移った):

```ts
import { BackupKitPhoto, downloadKitPhotosForRestore, uploadPendingKitPhotos } from './kitPhotoBackup';
```

- [ ] **Step 2: `buildBackupSnapshot()`のクエリを`storage_path`ベースに変更**

現在の該当箇所:

```ts
  // アップロード済み(synced_at確定済み)の写真だけをスナップショットに含める。
  // アップロード前の行を含めるとStorage側に実体が無いパスを参照してしまい、
  // 復元時のダウンロードが失敗する。
  const uid = auth?.().currentUser?.uid ?? null;
  const kitPhotoRows = uid && getEntitlements().hasPhotoBackup
    ? await db.getAllAsync<{ kit_id: number; uri: string; sort_order: number }>(
        'SELECT kit_id, uri, sort_order FROM kit_photos WHERE synced_at IS NOT NULL ORDER BY sort_order, id'
      )
    : [];
```

これを以下に変更する(`uri`ではなく`storage_path`を取得し、`storage_path IS NOT NULL`条件を追加):

```ts
  // アップロード済み(synced_at確定済み・storage_path確定済み)の写真だけを
  // スナップショットに含める。アップロード前の行を含めるとStorage側に実体が
  // 無いパスを参照してしまい、復元時のダウンロードが失敗する。
  const uid = auth?.().currentUser?.uid ?? null;
  const kitPhotoRows = uid && getEntitlements().hasPhotoBackup
    ? await db.getAllAsync<{ kit_id: number; storage_path: string; sort_order: number }>(
        'SELECT kit_id, storage_path, sort_order FROM kit_photos WHERE synced_at IS NOT NULL AND storage_path IS NOT NULL ORDER BY sort_order, id'
      )
    : [];
```

- [ ] **Step 3: `buildBackupSnapshot()`の返り値(Task 1で条件付きスプレッドにした箇所)を`storage_path`ベースに変更**

Task 1適用後の現在の該当箇所:

```ts
    ...(uid && getEntitlements().hasPhotoBackup
      ? {
          kitPhotos: kitPhotoRows
            .map((p) => {
              const storagePath = kitPhotoStoragePath(uid, p.uri);
              return storagePath ? { kitLocalRef: kitLocalRef(p.kit_id), storagePath, sort_order: p.sort_order } : null;
            })
            .filter((p): p is BackupKitPhoto => p !== null),
        }
      : {}),
  };
}
```

これを以下に変更する(`kitPhotoRows`が既に`storage_path`を保持しているため、変換ロジックが単純化される):

```ts
    ...(uid && getEntitlements().hasPhotoBackup
      ? {
          kitPhotos: kitPhotoRows.map((p) => ({
            kitLocalRef: kitLocalRef(p.kit_id),
            storagePath: p.storage_path,
            sort_order: p.sort_order,
          })),
        }
      : {}),
  };
}
```

- [ ] **Step 4: `restoreFromSnapshot()`のINSERT文に`storage_path`を追加**

現在の該当箇所:

```ts
      try {
        await db.runAsync(
          "INSERT INTO kit_photos (kit_id, uri, sort_order, synced_at) VALUES (?, ?, ?, datetime('now'))",
          [kitId, localUri, photo.sort_order]
        );
      } catch (e) {
        console.error('restoreFromSnapshot: failed to insert restored kit photo', photo.storagePath, e);
      }
```

これを以下に変更する:

```ts
      try {
        await db.runAsync(
          "INSERT INTO kit_photos (kit_id, uri, sort_order, synced_at, storage_path) VALUES (?, ?, ?, datetime('now'), ?)",
          [kitId, localUri, photo.sort_order, photo.storagePath]
        );
      } catch (e) {
        console.error('restoreFromSnapshot: failed to insert restored kit photo', photo.storagePath, e);
      }
```

- [ ] **Step 5: `components/KitDetailModal.tsx`の`removePhoto`を更新**

現在の該当箇所:

```ts
  const removePhoto = async (photoId: number, uri: string) => {
    await removeKitPhoto(photoId);
    await deleteKitPhoto(uri);
    deleteUploadedKitPhoto(uri).catch((e) => console.error('removePhoto: failed to delete uploaded copy', e));
    await load();
    onChanged?.();
  };
```

これを以下に変更する:

```ts
  const removePhoto = async (photoId: number, uri: string, storagePath: string | null) => {
    await removeKitPhoto(photoId);
    await deleteKitPhoto(uri);
    deleteUploadedKitPhoto(storagePath).catch((e) => console.error('removePhoto: failed to delete uploaded copy', e));
    await load();
    onChanged?.();
  };
```

呼び出し箇所の現在の該当箇所:

```tsx
                onRemove={(key) => {
                  const photo = photos.find((p) => p.id === key);
                  if (photo) removePhoto(photo.id, photo.uri);
                }}
```

これを以下に変更する:

```tsx
                onRemove={(key) => {
                  const photo = photos.find((p) => p.id === key);
                  if (photo) removePhoto(photo.id, photo.uri, photo.storage_path);
                }}
```

- [ ] **Step 6: 型チェック**

```bash
node node_modules/typescript/bin/tsc --noEmit
```

Expected: エラーなし(Task 2・3で許容していた型エラーがここで解消される)。

- [ ] **Step 7: BOM確認とコミット**

```bash
head -c 3 lib/cloudBackup.ts | od -An -tx1
head -c 3 components/KitDetailModal.tsx | od -An -tx1
git add lib/cloudBackup.ts components/KitDetailModal.tsx
git commit -m "fix: wire storage_path through backup snapshot and photo deletion"
```

---

## 完了確認(全タスク後)

- [ ] `node node_modules/typescript/bin/tsc --noEmit`がエラーなしで完走する
- [ ] 変更した全ファイルにUTF-8 BOMが混入していない
- [ ] `grep -rn "kitPhotoStoragePath" lib/cloudBackup.ts`が0件(importも呼び出しも削除されていること)
- [ ] スタンダード加入→写真バックアップ→ライトへ降格、というシナリオをコードレビューで再確認し、次回の自動バックアップで`kitPhotos`フィールドがFirestoreドキュメントから消えない(キー自体が書き込まれない)設計になっていること
- [ ] `origin/feature/cloud-backup`へpush
