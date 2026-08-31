import { getDB } from './connection';
import { deleteKitPhoto } from '../kitPhoto';

export interface KitWishlistItem {
  id: number;
  name: string;
  maker: string;
  series: string | null;
  category: string | null;
  scale: string | null;
  price: number | null;
  note: string | null;
  added_at: string | null;
}

export type KitWishlistDraft = Omit<KitWishlistItem, 'id' | 'added_at'>;

const values = (item: KitWishlistDraft) => [
  item.name.trim(), item.maker.trim(), item.series?.trim() || null,
  item.category?.trim() || null, item.scale?.trim() || null,
  item.price, item.note?.trim() || null,
];

export async function addKitWishlistItem(item: KitWishlistDraft): Promise<number> {
  const result = await getDB().runAsync(
    'INSERT INTO kit_wishlist (name, maker, series, category, scale, price, note) VALUES (?, ?, ?, ?, ?, ?, ?)',
    values(item)
  );
  return result.lastInsertRowId;
}

export async function moveKitWishlistItemToBox(id: number, boxId: number): Promise<{ kitId: number; item: KitWishlistItem }> {
  const db = getDB();
  let moved!: { kitId: number; item: KitWishlistItem };
  await db.withExclusiveTransactionAsync(async (tx) => {
    const box = await tx.getFirstAsync<{ id: number }>('SELECT id FROM kit_boxes WHERE id = ?', [boxId]);
    if (!box) throw new Error('Box not found');
    const item = await tx.getFirstAsync<KitWishlistItem>('SELECT * FROM kit_wishlist WHERE id = ?', [id]);
    if (!item) throw new Error('Wishlist item not found');
    const result = await tx.runAsync(
      'INSERT INTO kits (box_id, name, maker, series, category, scale, price, note, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [boxId, item.name, item.maker, item.series, item.category, item.scale, item.price, item.note, 'not_started']
    );
    await tx.runAsync('DELETE FROM kit_wishlist WHERE id = ?', [id]);
    moved = { kitId: result.lastInsertRowId, item };
  });
  return moved;
}

export async function removeKitWishlistItem(id: number): Promise<KitWishlistItem | null> {
  const db = getDB();
  let removed: KitWishlistItem | null = null;
  await db.withExclusiveTransactionAsync(async (tx) => {
    removed = await tx.getFirstAsync<KitWishlistItem>('SELECT * FROM kit_wishlist WHERE id = ?', [id]);
    if (removed) await tx.runAsync('DELETE FROM kit_wishlist WHERE id = ?', [id]);
  });
  return removed;
}

export async function restoreKitWishlistItem(item: KitWishlistItem): Promise<number> {
  let restoredId = 0;
  await getDB().withExclusiveTransactionAsync(async (tx) => {
    const result = await tx.runAsync(
      'INSERT INTO kit_wishlist (name, maker, series, category, scale, price, note, added_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [item.name, item.maker, item.series, item.category, item.scale, item.price, item.note, item.added_at]
    );
    restoredId = result.lastInsertRowId;
  });
  return restoredId;
}

export async function undoKitWishlistMove(kitId: number, item: KitWishlistItem): Promise<void> {
  const db = getDB();
  let photoUris: string[] = [];
  await db.withExclusiveTransactionAsync(async (tx) => {
    photoUris = (await tx.getAllAsync<{ uri: string }>('SELECT uri FROM kit_photos WHERE kit_id = ?', [kitId])).map((row) => row.uri);
    await tx.runAsync('DELETE FROM kit_color_paints WHERE kit_color_id IN (SELECT id FROM kit_colors WHERE kit_id = ?)', [kitId]);
    await tx.runAsync('DELETE FROM kit_colors WHERE kit_id = ?', [kitId]);
    await tx.runAsync('DELETE FROM kit_photos WHERE kit_id = ?', [kitId]);
    await tx.runAsync('DELETE FROM kits WHERE id = ?', [kitId]);
    await tx.runAsync(
      'INSERT INTO kit_wishlist (name, maker, series, category, scale, price, note, added_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [item.name, item.maker, item.series, item.category, item.scale, item.price, item.note, item.added_at]
    );
  });
  for (const uri of photoUris) {
    try {
      await deleteKitPhoto(uri);
    } catch (error) {
      console.error('undoKitWishlistMove: failed to delete kit photo', uri, error);
    }
  }
}
