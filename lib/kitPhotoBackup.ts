// lib/kitPhotoBackup.ts
// キット写真本体(バイナリ)のFirebase Storageアップロード/ダウンロード。
// メタデータ(kit_photosのDB行)の同期はlib/cloudBackup.tsが担当し、
// このファイルは実ファイルの転送だけを受け持つ。
import * as FileSystem from 'expo-file-system/legacy';
import Constants from 'expo-constants';
import { getDB } from './db';
import { getEntitlements } from './subscription';
import { withFreshFirebaseTokenRetry } from './auth';

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

type PendingPhotoTarget = 'kit_photos' | 'kit_wishlist_photos';
type PendingPhotoRow = { target: PendingPhotoTarget; id: number; uri: string };

// バックグラウンド遷移のたびに全量アップロードすると、未変更の写真まで毎回
// 再送してしまい通信量・書き込み回数コストが無視できなくなる。synced_atが
// NULLの(未アップロードの)行だけを対象にする差分方式。
function assertCurrentUser(expectedUid: string): void {
  if (auth?.().currentUser?.uid !== expectedUid) {
    throw new Error('Firebase user changed during kit photo upload.');
  }
}

export async function uploadPendingKitPhotos(expectedUid: string): Promise<void> {
  if (!auth || !storage) return;
  if (!getEntitlements().hasPhotoBackup) return;
  assertCurrentUser(expectedUid);

  const db = getDB();
  const kitPhotos = await db.getAllAsync<{ id: number; uri: string }>('SELECT id, uri FROM kit_photos WHERE synced_at IS NULL');
  const kitWishlistPhotos = await db.getAllAsync<{ id: number; uri: string }>('SELECT id, uri FROM kit_wishlist_photos WHERE synced_at IS NULL');
  const pending: PendingPhotoRow[] = [
    ...kitPhotos.map((photo): PendingPhotoRow => ({ target: 'kit_photos', ...photo })),
    ...kitWishlistPhotos.map((photo): PendingPhotoRow => ({ target: 'kit_wishlist_photos', ...photo })),
  ];
  for (const photo of pending) {
    assertCurrentUser(expectedUid);
    const path = kitPhotoStoragePath(expectedUid, generatePhotoFilename());
    try {
      await withFreshFirebaseTokenRetry(() =>
        storage().ref(path).putFile(photo.uri, { contentType: 'image/jpeg' })
      );
      assertCurrentUser(expectedUid);
      await db.withExclusiveTransactionAsync(async (tx) => {
        assertCurrentUser(expectedUid);
        const updateSql = photo.target === 'kit_photos'
          ? "UPDATE kit_photos SET synced_at = datetime('now'), storage_path = ? WHERE id = ?"
          : "UPDATE kit_wishlist_photos SET synced_at = datetime('now'), storage_path = ? WHERE id = ?";
        await tx.runAsync(updateSql, [path, photo.id]);
        assertCurrentUser(expectedUid);
      });
    } catch (e) {
      if (auth().currentUser?.uid !== expectedUid) throw e;
      console.error('uploadPendingKitPhotos: failed to upload', photo.uri, e);
    }
  }
}

export async function downloadKitPhotosForRestore(photos: { storagePath: string }[]): Promise<Map<string, string>> {
  const localUriByStoragePath = new Map<string, string>();
  if (!getEntitlements().hasPhotoBackup) return localUriByStoragePath;
  if (!storage || photos.length === 0) return localUriByStoragePath;

  const info = await FileSystem.getInfoAsync(KIT_PHOTO_DIR);
  if (!info.exists) await FileSystem.makeDirectoryAsync(KIT_PHOTO_DIR, { intermediates: true });

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
        const url = await withFreshFirebaseTokenRetry(() => storage().ref(photo.storagePath).getDownloadURL());
        await FileSystem.downloadAsync(url, dest);
        localUriByStoragePath.set(photo.storagePath, dest);
        succeeded = true;
      } catch (e) {
        if (attempt === 1) console.error('downloadKitPhotosForRestore: failed to download after retry', photo.storagePath, e);
      }
    }
  }
  return localUriByStoragePath;
}
