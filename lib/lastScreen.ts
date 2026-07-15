// lib/lastScreen.ts
// 起動時に「最後に開いていた画面+ボックス」を復元するための永続化。
// lib/appMode.ts と同じく app_settings をバックエンドに使うが、こちらは
// 起動時に一度読み込んで同期的に参照するだけなので、購読フック(useReducer)は不要。
import { getSetting, setSetting } from './db';

export type LastScreen = 'owned' | 'used' | 'kits' | 'completed';

let lastScreen: LastScreen | null = null;
let lastBoxId: string | null = null;
let lastKitBoxId: string | null = null;

export async function initLastScreen(): Promise<void> {
  const [screen, boxId, kitBoxId] = await Promise.all([
    getSetting('last_screen'),
    getSetting('last_box_id'),
    getSetting('last_kit_box_id'),
  ]);
  if (screen === 'owned' || screen === 'used' || screen === 'kits' || screen === 'completed') lastScreen = screen;
  lastBoxId = boxId;
  lastKitBoxId = kitBoxId;
}

export function getRestoreTarget(): { screen: LastScreen; boxId: string | null } | null {
  if (!lastScreen) return null;
  const boxId = lastScreen === 'owned' ? lastBoxId : lastScreen === 'kits' ? lastKitBoxId : null;
  return { screen: lastScreen, boxId };
}

export function setLastScreen(screen: LastScreen): void {
  if (lastScreen === screen) return;
  lastScreen = screen;
  setSetting('last_screen', screen);
}
