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

export async function saveKitPhotoToLibrary(uri: string): Promise<boolean> {
  if (!await MediaLibrary.isAvailableAsync()) return false;
  const permission = await MediaLibrary.requestPermissionsAsync(true);
  if (!permission.granted) return false;
  await MediaLibrary.saveToLibraryAsync(uri);
  return true;
}
