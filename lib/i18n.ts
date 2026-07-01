// lib/i18n.ts
import { useEffect, useReducer } from 'react';
import { getLocales } from 'expo-localization';
import { I18n } from 'i18n-js';
import ja from '../translations/ja.json';
import en from '../translations/en.json';

const i18n = new I18n({ ja, en });

const deviceLocale = getLocales()[0]?.languageCode ?? 'ja';
i18n.locale = deviceLocale;
i18n.enableFallback = true;
i18n.defaultLocale = 'ja';

export function t(key: string): string {
  return i18n.t(key);
}

// ロケール変更を購読して再レンダリングさせる仕組み(タブ名などが即時に切り替わる)。
const listeners = new Set<() => void>();

export function setLocale(locale: string): void {
  i18n.locale = locale;
  listeners.forEach((l) => l());
}

// 呼び出したコンポーネントをロケール変更時に再レンダリングする。
export function useLocale(): string {
  const [, force] = useReducer((x) => x + 1, 0);
  useEffect(() => {
    listeners.add(force);
    return () => { listeners.delete(force); };
  }, []);
  return i18n.locale;
}

export function getLocale(): string {
  return i18n.locale;
}

export default i18n;
