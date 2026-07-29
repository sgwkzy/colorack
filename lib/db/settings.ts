import { getDB } from './connection';

// --- 設定(キー値) ---
export async function getSetting(key: string): Promise<string | null> {
  const row = await getDB().getFirstAsync<{ value: string }>(
    'SELECT value FROM app_settings WHERE key = ?', [key]
  );
  return row?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await getDB().runAsync(
    'INSERT INTO app_settings (key, value) VALUES (?, ?)'
    + ' ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    [key, value]
  );
}

// 一覧表示時の塗料追加先(デフォルトボックス)。未設定/無効は null。
export async function getDefaultBoxId(): Promise<number | null> {
  const v = await getSetting('default_box_id');
  if (!v) return null;
  const id = Number(v);
  const exists = await getDB().getFirstAsync('SELECT id FROM boxes WHERE id = ?', [id]);
  return exists ? id : null;
}

export async function getDefaultKitBoxId(): Promise<number | null> {
  const v = await getSetting('default_kit_box_id');
  if (!v) return null;
  const id = Number(v);
  const exists = await getDB().getFirstAsync('SELECT id FROM kit_boxes WHERE id = ?', [id]);
  return exists ? id : null;
}
