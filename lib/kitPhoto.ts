// lib/kitPhoto.ts
// キット写真の選択・永続化。ImagePickerが返す一時URIは端末側のキャッシュ整理で
// 消える可能性があるため、documentDirectory配下にコピーしてから保存する。
import * as FileSystem from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';

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

export async function pickKitPhotoFromCamera(): Promise<string | null> {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) return null;
  const result = await ImagePicker.launchCameraAsync({ quality: 0.7 });
  if (result.canceled || !result.assets[0]) return null;
  return persist(result.assets[0].uri);
}

// 端末の写真ライブラリから複数枚を一度に選択できる。maxCountで選択可能数をOS側にも伝える。
export async function pickKitPhotosFromLibrary(maxCount: number): Promise<string[]> {
  if (maxCount <= 0) return [];
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) return [];
  const result = await ImagePicker.launchImageLibraryAsync({
    quality: 0.7,
    mediaTypes: ['images'],
    allowsMultipleSelection: true,
    selectionLimit: maxCount,
  });
  if (result.canceled) return [];
  const persisted: string[] = [];
  for (const asset of result.assets) {
    persisted.push(await persist(asset.uri));
  }
  return persisted;
}

export async function deleteKitPhoto(photoUri: string | null): Promise<void> {
  if (!photoUri || !photoUri.startsWith(KIT_PHOTO_DIR)) return;
  await FileSystem.deleteAsync(photoUri, { idempotent: true });
}
