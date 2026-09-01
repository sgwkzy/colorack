import { getDB } from './connection';
import type { SQLiteDatabase } from 'expo-sqlite';

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

export interface KitWishlistPhoto {
  id: number;
  uri: string;
  sort_order: number;
  synced_at: string | null;
  storage_path: string | null;
}

export interface KitWishlistColorPaintSnapshot {
  paint_id: number;
  ratio: number;
  sort_order: number;
}

export interface KitWishlistColorSnapshot {
  id: number;
  name: string | null;
  note: string | null;
  sort_order: number;
  added_at: string | null;
  paints: KitWishlistColorPaintSnapshot[];
}

export interface KitWishlistSnapshot {
  item: KitWishlistItem;
  photos: KitWishlistPhoto[];
  colors: KitWishlistColorSnapshot[];
}

export type KitWishlistDraft = Omit<KitWishlistItem, 'id' | 'added_at'>;

const values = (item: KitWishlistDraft) => [
  item.name.trim(), item.maker.trim(), item.series?.trim() || null,
  item.category?.trim() || null, item.scale?.trim() || null,
  item.price, item.note?.trim() || null,
];

async function getWishlistColorSnapshots(
  tx: SQLiteDatabase,
  wishlistId: number,
): Promise<KitWishlistColorSnapshot[]> {
  const colorRows = await tx.getAllAsync<Omit<KitWishlistColorSnapshot, 'paints'>>(
    'SELECT id, name, note, sort_order, added_at FROM kit_wishlist_colors WHERE wishlist_id = ? ORDER BY sort_order, id',
    [wishlistId],
  );
  const paintRows = await tx.getAllAsync<KitWishlistColorPaintSnapshot & { wishlist_color_id: number }>(
    'SELECT wishlist_color_id, paint_id, ratio, sort_order FROM kit_wishlist_color_paints WHERE wishlist_color_id IN (SELECT id FROM kit_wishlist_colors WHERE wishlist_id = ?) ORDER BY sort_order, id',
    [wishlistId],
  );
  return colorRows.map((color) => ({
    ...color,
    paints: paintRows
      .filter((paint) => paint.wishlist_color_id === color.id)
      .map(({ wishlist_color_id: _wishlistColorId, ...paint }) => paint),
  }));
}

async function insertWishlistColors(
  tx: SQLiteDatabase,
  wishlistId: number,
  colors: KitWishlistColorSnapshot[],
): Promise<void> {
  for (const color of colors) {
    const result = await tx.runAsync(
      'INSERT INTO kit_wishlist_colors (wishlist_id, name, note, sort_order, added_at) VALUES (?, ?, ?, ?, ?)',
      [wishlistId, color.name, color.note, color.sort_order, color.added_at],
    );
    for (const paint of color.paints) {
      await tx.runAsync(
        'INSERT INTO kit_wishlist_color_paints (wishlist_color_id, paint_id, ratio, sort_order) VALUES (?, ?, ?, ?)',
        [result.lastInsertRowId, paint.paint_id, paint.ratio, paint.sort_order],
      );
    }
  }
}

async function insertKitColors(
  tx: SQLiteDatabase,
  kitId: number,
  colors: KitWishlistColorSnapshot[],
): Promise<void> {
  for (const color of colors) {
    const result = await tx.runAsync(
      'INSERT INTO kit_colors (kit_id, name, note, sort_order, added_at) VALUES (?, ?, ?, ?, ?)',
      [kitId, color.name, color.note, color.sort_order, color.added_at],
    );
    for (const paint of color.paints) {
      await tx.runAsync(
        'INSERT INTO kit_color_paints (kit_color_id, paint_id, ratio, sort_order) VALUES (?, ?, ?, ?)',
        [result.lastInsertRowId, paint.paint_id, paint.ratio, paint.sort_order],
      );
    }
  }
}

export async function getKitWishlistPhotos(wishlistId: number): Promise<KitWishlistPhoto[]> {
  return getDB().getAllAsync<KitWishlistPhoto>(
    'SELECT id, uri, sort_order, synced_at, storage_path FROM kit_wishlist_photos WHERE wishlist_id = ? ORDER BY sort_order, id',
    [wishlistId],
  );
}

export async function getKitWishlistItem(id: number): Promise<KitWishlistItem | null> {
  const row = await getDB().getFirstAsync<KitWishlistItem>(
    'SELECT id, name, maker, series, category, scale, price, note, added_at FROM kit_wishlist WHERE id = ?',
    [id],
  );
  return row ?? null;
}

export async function saveKitWishlistItem(
  id: number | null,
  item: KitWishlistDraft,
  photoUris: readonly string[],
): Promise<{ id: number; removedPhotoUris: string[] }> {
  const db = getDB();
  let savedId = id ?? 0;
  let removedPhotoUris: string[] = [];
  await db.withExclusiveTransactionAsync(async (tx) => {
    if (id === null) {
      const result = await tx.runAsync(
        'INSERT INTO kit_wishlist (name, maker, series, category, scale, price, note) VALUES (?, ?, ?, ?, ?, ?, ?)',
        values(item)
      );
      savedId = result.lastInsertRowId;
    } else {
      await tx.runAsync(
        'UPDATE kit_wishlist SET name = ?, maker = ?, series = ?, category = ?, scale = ?, price = ?, note = ? WHERE id = ?',
        [...values(item), id]
      );
    }

    const existing = await tx.getAllAsync<KitWishlistPhoto>(
      'SELECT id, uri, sort_order, synced_at, storage_path FROM kit_wishlist_photos WHERE wishlist_id = ? ORDER BY sort_order, id',
      [savedId]
    );
    const existingByUri = new Map(existing.map((row) => [row.uri, row]));
    const nextUris = new Set(photoUris);
    removedPhotoUris = existing.filter((row) => !nextUris.has(row.uri)).map((row) => row.uri);

    await tx.runAsync('DELETE FROM kit_wishlist_photos WHERE wishlist_id = ?', [savedId]);
    for (const [sortOrder, uri] of photoUris.entries()) {
      const previous = existingByUri.get(uri);
      await tx.runAsync(
        'INSERT INTO kit_wishlist_photos (wishlist_id, uri, sort_order, synced_at, storage_path) VALUES (?, ?, ?, ?, ?)',
        [savedId, uri, sortOrder, previous?.synced_at ?? null, previous?.storage_path ?? null]
      );
    }
  });
  return { id: savedId, removedPhotoUris };
}

export async function addKitWishlistItem(item: KitWishlistDraft): Promise<number> {
  return (await saveKitWishlistItem(null, item, [])).id;
}

export async function moveKitWishlistItemToBox(
  id: number,
  boxId: number,
): Promise<{ kitId: number; snapshot: KitWishlistSnapshot }> {
  const db = getDB();
  let moved!: { kitId: number; snapshot: KitWishlistSnapshot };
  await db.withExclusiveTransactionAsync(async (tx) => {
    const box = await tx.getFirstAsync<{ id: number }>('SELECT id FROM kit_boxes WHERE id = ?', [boxId]);
    if (!box) throw new Error('Box not found');
    const item = await tx.getFirstAsync<KitWishlistItem>('SELECT * FROM kit_wishlist WHERE id = ?', [id]);
    if (!item) throw new Error('Wishlist item not found');
    const photos = await tx.getAllAsync<KitWishlistPhoto>(
      'SELECT id, uri, sort_order, synced_at, storage_path FROM kit_wishlist_photos WHERE wishlist_id = ? ORDER BY sort_order, id',
      [id],
    );
    const colors = await getWishlistColorSnapshots(tx, id);
    const result = await tx.runAsync(
      'INSERT INTO kits (box_id, name, maker, series, category, scale, price, note, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [boxId, item.name, item.maker, item.series, item.category, item.scale, item.price, item.note, 'not_started']
    );
    for (const photo of photos) {
      await tx.runAsync(
        'INSERT INTO kit_photos (kit_id, uri, sort_order, synced_at, storage_path) VALUES (?, ?, ?, ?, ?)',
        [result.lastInsertRowId, photo.uri, photo.sort_order, photo.synced_at, photo.storage_path]
      );
    }
    await insertKitColors(tx, result.lastInsertRowId, colors);
    await tx.runAsync('DELETE FROM kit_wishlist_color_paints WHERE wishlist_color_id IN (SELECT id FROM kit_wishlist_colors WHERE wishlist_id = ?)', [id]);
    await tx.runAsync('DELETE FROM kit_wishlist_colors WHERE wishlist_id = ?', [id]);
    await tx.runAsync('DELETE FROM kit_wishlist_photos WHERE wishlist_id = ?', [id]);
    await tx.runAsync('DELETE FROM kit_wishlist WHERE id = ?', [id]);
    moved = { kitId: result.lastInsertRowId, snapshot: { item, photos, colors } };
  });
  return moved;
}

export async function removeKitWishlistItem(id: number): Promise<KitWishlistSnapshot | null> {
  const db = getDB();
  let removed: KitWishlistSnapshot | null = null;
  await db.withExclusiveTransactionAsync(async (tx) => {
    const item = await tx.getFirstAsync<KitWishlistItem>('SELECT * FROM kit_wishlist WHERE id = ?', [id]);
    if (!item) return;
    const photos = await tx.getAllAsync<KitWishlistPhoto>(
      'SELECT id, uri, sort_order, synced_at, storage_path FROM kit_wishlist_photos WHERE wishlist_id = ? ORDER BY sort_order, id',
      [id],
    );
    const colors = await getWishlistColorSnapshots(tx, id);
    await tx.runAsync('DELETE FROM kit_wishlist_color_paints WHERE wishlist_color_id IN (SELECT id FROM kit_wishlist_colors WHERE wishlist_id = ?)', [id]);
    await tx.runAsync('DELETE FROM kit_wishlist_colors WHERE wishlist_id = ?', [id]);
    await tx.runAsync('DELETE FROM kit_wishlist_photos WHERE wishlist_id = ?', [id]);
    await tx.runAsync('DELETE FROM kit_wishlist WHERE id = ?', [id]);
    removed = { item, photos, colors };
  });
  return removed;
}

export async function restoreKitWishlistItem(snapshot: KitWishlistSnapshot): Promise<number> {
  let restoredId = 0;
  await getDB().withExclusiveTransactionAsync(async (tx) => {
    const result = await tx.runAsync(
      'INSERT INTO kit_wishlist (name, maker, series, category, scale, price, note, added_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [snapshot.item.name, snapshot.item.maker, snapshot.item.series, snapshot.item.category, snapshot.item.scale, snapshot.item.price, snapshot.item.note, snapshot.item.added_at]
    );
    restoredId = result.lastInsertRowId;
    for (const photo of snapshot.photos) {
      await tx.runAsync(
        'INSERT INTO kit_wishlist_photos (wishlist_id, uri, sort_order, synced_at, storage_path) VALUES (?, ?, ?, ?, ?)',
        [restoredId, photo.uri, photo.sort_order, photo.synced_at, photo.storage_path]
      );
    }
    await insertWishlistColors(tx, restoredId, snapshot.colors);
  });
  return restoredId;
}

export async function undoKitWishlistMove(kitId: number, snapshot: KitWishlistSnapshot): Promise<void> {
  await getDB().withExclusiveTransactionAsync(async (tx) => {
    await tx.runAsync('DELETE FROM kit_color_paints WHERE kit_color_id IN (SELECT id FROM kit_colors WHERE kit_id = ?)', [kitId]);
    await tx.runAsync('DELETE FROM kit_colors WHERE kit_id = ?', [kitId]);
    await tx.runAsync('DELETE FROM kit_photos WHERE kit_id = ?', [kitId]);
    await tx.runAsync('DELETE FROM kits WHERE id = ?', [kitId]);
    const result = await tx.runAsync(
      'INSERT INTO kit_wishlist (name, maker, series, category, scale, price, note, added_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [snapshot.item.name, snapshot.item.maker, snapshot.item.series, snapshot.item.category, snapshot.item.scale, snapshot.item.price, snapshot.item.note, snapshot.item.added_at]
    );
    for (const photo of snapshot.photos) {
      await tx.runAsync(
        'INSERT INTO kit_wishlist_photos (wishlist_id, uri, sort_order, synced_at, storage_path) VALUES (?, ?, ?, ?, ?)',
        [result.lastInsertRowId, photo.uri, photo.sort_order, photo.synced_at, photo.storage_path]
      );
    }
    await insertWishlistColors(tx, result.lastInsertRowId, snapshot.colors);
  });
}
