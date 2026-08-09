import { useEffect, useReducer } from 'react';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { getDB, getSetting, setSetting } from './db';

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
const PHOTO_BACKUP_ENTITLED_KEY = 'photo_backup_entitled';

const listeners = new Set<() => void>();
let entitlements: Entitlements = NO_ENTITLEMENTS;
let configured = false;
let entitlementUpdateTail: Promise<void> = Promise.resolve();
let identityUpdateTail: Promise<void> = Promise.resolve();

function toEntitlements(active: Record<string, unknown>): Entitlements {
  return {
    hasBackup: 'backup' in active,
    hasPhotoBackup: 'backup_photos' in active,
  };
}

function notify(): void {
  listeners.forEach((l) => l());
}

function applyEntitlements(active: Record<string, unknown>): Promise<void> {
  const next = toEntitlements(active);
  const update = async () => {
    const previousPhotoBackup = await getSetting(PHOTO_BACKUP_ENTITLED_KEY);
    // 解約中にStorage側が整理されている可能性があるため、再加入時は
    // 古い参照を再利用せずローカル写真をすべて再アップロードする。
    if (previousPhotoBackup === '0' && next.hasPhotoBackup) {
      await getDB().runAsync('UPDATE kit_photos SET synced_at = NULL, storage_path = NULL');
    }
    await setSetting(PHOTO_BACKUP_ENTITLED_KEY, next.hasPhotoBackup ? '1' : '0');
    entitlements = next;
    notify();
  };
  const result = entitlementUpdateTail.then(update, update);
  entitlementUpdateTail = result.then(() => undefined, () => undefined);
  return result;
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
    applyEntitlements(info.entitlements.active)
      .catch((e) => console.error('initSubscription: failed to apply customer info update', e));
  });
  try {
    const info = await Purchases.getCustomerInfo();
    await applyEntitlements(info.entitlements.active);
  } catch (e) {
    console.error('initSubscription: failed to load customer info', e);
  }
}

// Googleサインインに合わせてRevenueCat側のユーザーIDを紐付ける。
// uid=null時はストア購読と広告非表示を維持するためRevenueCat identityを変えない。
// 購入・復元UI側でFirebaseサインインを必須化し、旧UIDのまま購入されるのを防ぐ。
export async function linkSubscriptionUser(uid: string | null): Promise<void> {
  if (!Purchases || !configured) return;
  if (!uid) return;

  const update = async () => {
    const [currentId, anonymous] = await Promise.all([
      Purchases.getAppUserID(),
      Purchases.isAnonymous(),
    ]);
    if (!anonymous && currentId === uid) return;
    const { customerInfo } = await Purchases.logIn(uid);
    await applyEntitlements(customerInfo.entitlements.active);
  };
  const result = identityUpdateTail.then(update, update);
  identityUpdateTail = result.then(() => undefined, () => undefined);
  try {
    await result;
  } catch (e) {
    console.error('linkSubscriptionUser: failed', e);
    throw e;
  }
}

export async function logOutSubscriptionUser(expectedUid: string): Promise<void> {
  if (!Purchases || !configured) return;
  const update = async () => {
    const [currentId, anonymous] = await Promise.all([
      Purchases.getAppUserID(),
      Purchases.isAnonymous(),
    ]);
    if (anonymous) return;
    if (currentId !== expectedUid) {
      throw new Error('RevenueCat user does not match Firebase.');
    }
    const info = await Purchases.logOut();
    await applyEntitlements(info.entitlements.active);
  };
  const result = identityUpdateTail.then(update, update);
  identityUpdateTail = result.then(() => undefined, () => undefined);
  await result;
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

async function assertSubscriptionUser(expectedUid: string): Promise<void> {
  if (!Purchases || !configured) throw new Error('Subscriptions are not configured.');
  const [currentId, anonymous] = await Promise.all([
    Purchases.getAppUserID(),
    Purchases.isAnonymous(),
  ]);
  if (anonymous || currentId !== expectedUid) throw new Error('RevenueCat user changed before subscription operation.');
}

export async function presentPaywall(expectedUid?: string): Promise<void> {
  if (!RevenueCatUI || !configured) {
    throw new Error('Subscriptions are not available in Expo Go. Use a development build.');
  }
  if (expectedUid) await assertSubscriptionUser(expectedUid);
  await RevenueCatUI.presentPaywall();
  const info = await Purchases!.getCustomerInfo();
  await applyEntitlements(info.entitlements.active);
}

export async function restorePurchases(expectedUid?: string): Promise<void> {
  if (!Purchases || !configured) return;
  if (expectedUid) await assertSubscriptionUser(expectedUid);
  const info = await Purchases.restorePurchases();
  await applyEntitlements(info.entitlements.active);
}
