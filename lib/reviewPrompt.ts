import * as StoreReview from 'expo-store-review';

import { getSetting, setSetting } from './db';

const LAST_SHOWN_KEY = 'review_prompt_last_shown_at';
const COUNT_KEY = 'review_prompt_count';
const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

export async function maybeRequestStoreReview(): Promise<void> {
  try {
    const [lastShownAt, countValue] = await Promise.all([
      getSetting(LAST_SHOWN_KEY),
      getSetting(COUNT_KEY),
    ]);
    const now = Date.now();
    const count = Number(countValue) || 0;

    // 表示回数の上限と、前回表示から90日未満の場合はリクエストしない。
    if (count >= 3 || (lastShownAt != null && now - Number(lastShownAt) < NINETY_DAYS_MS)) return;
    if (!await StoreReview.hasAction()) return;

    await StoreReview.requestReview();
    // OS側で表示されなかった場合も、リクエスト済みとして頻度を抑える。
    await Promise.all([
      setSetting(LAST_SHOWN_KEY, String(now)),
      setSetting(COUNT_KEY, String(count + 1)),
    ]);
  } catch {
    // レビュー依頼の失敗は本来の操作に影響させない。
  }
}
