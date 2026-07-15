// lib/appMode.ts
// ドロワーのColorack/Kitrackモード。lib/activeBox.ts と同じ購読パターンに、
// app_settings 経由の永続化(起動時復元)を加えたもの。
import { useEffect, useReducer } from 'react';
import { getSetting, setSetting } from './db';

export type AppMode = 'colorack' | 'kitrack';

let appMode: AppMode = 'colorack';
const listeners = new Set<() => void>();

export async function initAppMode(): Promise<void> {
  const saved = await getSetting('appMode');
  if (saved === 'kitrack') appMode = 'kitrack';
}

export function setAppMode(next: AppMode): void {
  if (appMode === next) return;
  appMode = next;
  listeners.forEach((listener) => listener());
  setSetting('appMode', next);
}

export function useAppMode(): AppMode {
  const [, force] = useReducer((value) => value + 1, 0);
  useEffect(() => { listeners.add(force); return () => { listeners.delete(force); }; }, []);
  return appMode;
}
