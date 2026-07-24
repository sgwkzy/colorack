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
        const url = await storage().ref(photo.storagePath).getDownloadURL();
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
