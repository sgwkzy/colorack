import { useCallback } from 'react';
import Constants from 'expo-constants';
import { useFocusEffect } from 'expo-router';
import { getSetting, setSetting } from './db';

// Expo Goのバイナリにはネイティブモジュールが含まれないため、
// import(=require)時点でクラッシュする。mobileAds.native.tsと同じパターンで
// Expo Go実行時はrequireせずnullにフォールバックする。
const analytics: typeof import('@react-native-firebase/analytics').default | null =
  Constants.appOwnership === 'expo'
    ? null
    : (require('@react-native-firebase/analytics').default as typeof import('@react-native-firebase/analytics').default);

const ANALYTICS_ENABLED_KEY = 'analytics_enabled';
let analyticsEnabled = true;

export async function initAnalytics(): Promise<void> {
  if (!analytics) return;
  const saved = await getSetting(ANALYTICS_ENABLED_KEY);
  analyticsEnabled = saved !== '0';
  await analytics().setAnalyticsCollectionEnabled(analyticsEnabled);
}

export function logEvent(name: string, params?: Record<string, string | number>): void {
  if (__DEV__) {
    console.log('analytics:logEvent', name, params);
    return;
  }
  if (!analytics) return;
  try {
    analytics().logEvent(name, params).catch((e: unknown) => console.error('logEvent: failed', e));
  } catch (e) {
    console.error('logEvent: failed', e);
  }
}

export function logScreenView(screenName: string): void {
  if (__DEV__) {
    console.log('analytics:logScreenView', screenName);
    return;
  }
  if (!analytics) return;
  try {
    analytics().logScreenView({ screen_name: screenName, screen_class: screenName }).catch((e: unknown) => console.error('logScreenView: failed', e));
  } catch (e) {
    console.error('logScreenView: failed', e);
  }
}

export function useScreenView(screenName: string): void {
  useFocusEffect(useCallback(() => {
    logScreenView(screenName);
  }, [screenName]));
}

export async function setAnalyticsEnabled(enabled: boolean): Promise<void> {
  await setSetting(ANALYTICS_ENABLED_KEY, enabled ? '1' : '0');
  analyticsEnabled = enabled;
  if (!analytics) return;
  await analytics().setAnalyticsCollectionEnabled(enabled);
}

export function isAnalyticsEnabled(): boolean {
  return analyticsEnabled;
}
