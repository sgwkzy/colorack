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
  if (!RevenueCatUI || !configured) {
    throw new Error('Subscriptions are not available in Expo Go. Use a development build.');
  }
  await RevenueCatUI.presentPaywall();
}

export async function restorePurchases(): Promise<void> {
  if (!Purchases || !configured) return;
  const info = await Purchases.restorePurchases();
  entitlements = toEntitlements(info.entitlements.active);
  notify();
}
