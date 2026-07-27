import { getDB } from './connection';

export interface KitPhoto {
  id: number;
  uri: string;
  sort_order: number;
}

export async function getKitPhotos(kitId: number): Promise<KitPhoto[]> {
  return getDB().getAllAsync<KitPhoto>(
    'SELECT id, uri, sort_order FROM kit_photos WHERE kit_id = ? ORDER BY sort_order, id',
    [kitId]
  );
}

export async function addKitPhoto(kitId: number, uri: string): Promise<void> {
  const row = await getDB().getFirstAsync<{ n: number }>(
    'SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM kit_photos WHERE kit_id = ?',
    [kitId]
  );
  await getDB().runAsync(
    'INSERT INTO kit_photos (kit_id, uri, sort_order) VALUES (?, ?, ?)',
    [kitId, uri, row?.n ?? 0]
  );
}

export async function removeKitPhoto(photoId: number): Promise<void> {
  await getDB().runAsync('DELETE FROM kit_photos WHERE id = ?', [photoId]);
}

export async function reorderKitPhotos(photoIds: number[]): Promise<void> {
  const db = getDB();
  await db.withTransactionAsync(async () => {
    for (const [index, id] of photoIds.entries()) {
      await db.runAsync('UPDATE kit_photos SET sort_order = ? WHERE id = ?', [index, id]);
    }
  });
}
