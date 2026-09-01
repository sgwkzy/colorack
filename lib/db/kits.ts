import { getDB } from './connection';
import { getDefaultKitBoxId } from './settings';
import type { KitStatus } from './types';

export interface KitDetail {
  id: number;
  box_id: number | null;
  box_name: string | null;
  name: string;
  maker: string;
  series: string | null;
  category: string | null;
  scale: string | null;
  note: string | null;
  price: number | null;
  status: KitStatus;
  added_at: string | null;
  status_changed_at: string | null;
}

export async function getKitDetail(kitId: number): Promise<KitDetail | null> {
  const row = await getDB().getFirstAsync<KitDetail>(
    'SELECT k.id, k.box_id, b.name AS box_name, k.name, k.maker, k.series, k.category, k.scale, k.note, k.price, k.status, k.added_at, k.status_changed_at'
    + ' FROM kits k LEFT JOIN kit_boxes b ON k.box_id = b.id'
    + ' WHERE k.id = ?',
    [kitId]
  );
  return row ?? null;
}

export async function updateKitNote(kitId: number, note: string): Promise<void> {
  const normalized = note.trim() === '' ? null : note;
  await getDB().runAsync(
    "UPDATE kits SET note = ?, status_changed_at = datetime('now') WHERE id = ?",
    [normalized, kitId]
  );
}

// kits.name は NOT NULL のため、空文字を渡さないのは呼び出し側の責務。
export async function updateKitName(kitId: number, name: string): Promise<void> {
  await getDB().runAsync(
    "UPDATE kits SET name = ?, status_changed_at = datetime('now') WHERE id = ?",
    [name, kitId]
  );
}

// kits.maker は NOT NULL のため、空文字を渡さないのは呼び出し側の責務。
export async function updateKitMaker(kitId: number, maker: string): Promise<void> {
  await getDB().runAsync(
    "UPDATE kits SET maker = ?, status_changed_at = datetime('now') WHERE id = ?",
    [maker, kitId]
  );
}

export async function updateKitScale(kitId: number, scale: string): Promise<void> {
  const normalized = scale.trim() === '' ? null : scale;
  await getDB().runAsync(
    "UPDATE kits SET scale = ?, status_changed_at = datetime('now') WHERE id = ?",
    [normalized, kitId]
  );
}

export async function updateKitSeries(kitId: number, series: string): Promise<void> {
  const normalized = series.trim() === '' ? null : series;
  await getDB().runAsync(
    "UPDATE kits SET series = ?, status_changed_at = datetime('now') WHERE id = ?",
    [normalized, kitId]
  );
}

export async function updateKitCategory(kitId: number, category: string): Promise<void> {
  const normalized = category.trim() === '' ? null : category;
  await getDB().runAsync(
    "UPDATE kits SET category = ?, status_changed_at = datetime('now') WHERE id = ?",
    [normalized, kitId]
  );
}

export async function updateKitPrice(kitId: number, price: string): Promise<void> {
  const trimmed = price.trim();
  const parsed = trimmed === '' ? null : Number(trimmed);
  const normalized = parsed !== null && Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
  await getDB().runAsync(
    "UPDATE kits SET price = ?, status_changed_at = datetime('now') WHERE id = ?",
    [normalized, kitId]
  );
}

export async function updateKitBox(kitId: number, boxId: number): Promise<void> {
  await getDB().runAsync(
    "UPDATE kits SET box_id = ?, status_changed_at = datetime('now') WHERE id = ? AND status != 'completed'",
    [boxId, kitId]
  );
}

export async function setKitStatus(kitId: number, status: KitStatus, boxId?: number): Promise<void> {
  if (status !== 'completed' && boxId != null) {
    await getDB().runAsync(
      "UPDATE kits SET status = ?, box_id = ?, status_changed_at = datetime('now') WHERE id = ?",
      [status, boxId, kitId]
    );
    return;
  }
  const defaultBoxId = status === 'completed' ? null : await getDefaultKitBoxId();
  await getDB().runAsync(
    "UPDATE kits SET status = ?, box_id = CASE WHEN ? = 'completed' THEN NULL WHEN box_id IS NULL THEN ? ELSE box_id END, status_changed_at = datetime('now') WHERE id = ?",
    [status, status, defaultBoxId, kitId]
  );
}

export async function deleteKit(kitId: number): Promise<void> {
  const db = getDB();
  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM kit_color_paints WHERE kit_color_id IN (SELECT id FROM kit_colors WHERE kit_id = ?)', [kitId]);
    await db.runAsync('DELETE FROM kit_colors WHERE kit_id = ?', [kitId]);
    await db.runAsync('DELETE FROM kit_photos WHERE kit_id = ?', [kitId]);
    await db.runAsync('DELETE FROM kits WHERE id = ?', [kitId]);
  });
}
