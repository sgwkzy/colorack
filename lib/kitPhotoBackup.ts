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
