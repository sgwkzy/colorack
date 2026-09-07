import { getDB } from './connection';
import type { ColorMixPaint, ColorMixSummary } from '../colorMixDraft';

export type KitWishlistColorSummary = ColorMixSummary;
export type KitColorPaintInput = { paintId: number; ratio: number };

const normalizeText = (value: string | null): string | null => value?.trim() === '' ? null : value;

export async function getKitWishlistColors(wishlistId: number): Promise<KitWishlistColorSummary[]> {
  const db = getDB();
  const colorRows = await db.getAllAsync<{ id: number; name: string | null; note: string | null }>(
    'SELECT id, name, note FROM kit_wishlist_colors WHERE wishlist_id = ? ORDER BY sort_order, id',
    [wishlistId]
  );
  const paintRows = await db.getAllAsync<ColorMixPaint & { wishlist_color_id: number }>(
    'SELECT kcp.wishlist_color_id, kcp.paint_id, kcp.ratio, kcp.sort_order, c.name_ja, c.name_en, c.code, c.brand, c.series, c.series_en, c.hex, c.paint_type'
    + ' FROM kit_wishlist_color_paints kcp JOIN catalog_paints c ON kcp.paint_id = c.id'
    + ' WHERE kcp.wishlist_color_id IN (SELECT id FROM kit_wishlist_colors WHERE wishlist_id = ?)'
    + ' ORDER BY kcp.sort_order, kcp.id',
    [wishlistId]
  );
  return colorRows.map((color) => ({
    ...color,
    paints: paintRows.filter((paint) => paint.wishlist_color_id === color.id),
  }));
}

export async function addKitWishlistColor(
  wishlistId: number,
  name: string | null,
  note: string | null,
  paints: KitColorPaintInput[],
): Promise<void> {
  const db = getDB();
  await db.withExclusiveTransactionAsync(async (tx) => {
    const candidate = await tx.getFirstAsync<{ id: number }>(
      'SELECT id FROM kit_wishlist WHERE id = ?',
      [wishlistId]
    );
    if (!candidate) throw new Error('Wishlist item not found');
    const row = await tx.getFirstAsync<{ n: number }>(
      'SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM kit_wishlist_colors WHERE wishlist_id = ?',
      [wishlistId]
    );
    const result = await tx.runAsync(
      'INSERT INTO kit_wishlist_colors (wishlist_id, name, note, sort_order) VALUES (?, ?, ?, ?)',
      [wishlistId, normalizeText(name), normalizeText(note), row?.n ?? 0]
    );
    for (const [index, paint] of paints.entries()) {
      await tx.runAsync(
        'INSERT INTO kit_wishlist_color_paints (wishlist_color_id, paint_id, ratio, sort_order) VALUES (?, ?, ?, ?)',
        [result.lastInsertRowId, paint.paintId, paint.ratio, index]
      );
    }
  });
}

export async function updateKitWishlistColor(
  wishlistId: number,
  colorId: number,
  name: string | null,
  note: string | null,
  paints: KitColorPaintInput[],
): Promise<void> {
  const db = getDB();
  await db.withExclusiveTransactionAsync(async (tx) => {
    const ownedColor = await tx.getFirstAsync<{ id: number }>(
      'SELECT id FROM kit_wishlist_colors WHERE id = ? AND wishlist_id = ?',
      [colorId, wishlistId]
    );
    if (!ownedColor) throw new Error('Wishlist color not found');
    await tx.runAsync(
      'UPDATE kit_wishlist_colors SET name = ?, note = ? WHERE id = ?',
      [normalizeText(name), normalizeText(note), colorId]
    );
    await tx.runAsync('DELETE FROM kit_wishlist_color_paints WHERE wishlist_color_id = ?', [colorId]);
    for (const [index, paint] of paints.entries()) {
      await tx.runAsync(
        'INSERT INTO kit_wishlist_color_paints (wishlist_color_id, paint_id, ratio, sort_order) VALUES (?, ?, ?, ?)',
        [colorId, paint.paintId, paint.ratio, index]
      );
    }
  });
}

export async function removeKitWishlistColor(wishlistId: number, colorId: number): Promise<void> {
  const db = getDB();
  await db.withExclusiveTransactionAsync(async (tx) => {
    const ownedColor = await tx.getFirstAsync<{ id: number }>(
      'SELECT id FROM kit_wishlist_colors WHERE id = ? AND wishlist_id = ?',
      [colorId, wishlistId]
    );
    if (!ownedColor) throw new Error('Wishlist color not found');
    await tx.runAsync('DELETE FROM kit_wishlist_color_paints WHERE wishlist_color_id = ?', [colorId]);
    await tx.runAsync('DELETE FROM kit_wishlist_colors WHERE id = ?', [colorId]);
  });
}

export async function reorderKitWishlistColors(wishlistId: number, colorIds: number[]): Promise<void> {
  const db = getDB();
  await db.withExclusiveTransactionAsync(async (tx) => {
    const candidate = await tx.getFirstAsync<{ id: number }>(
      'SELECT id FROM kit_wishlist WHERE id = ?',
      [wishlistId]
    );
    if (!candidate) throw new Error('Wishlist item not found');
    const rows = await tx.getAllAsync<{ id: number }>(
      'SELECT id FROM kit_wishlist_colors WHERE wishlist_id = ?',
      [wishlistId]
    );
    const expected = rows.map((row) => row.id).sort((a, b) => a - b);
    const actual = [...colorIds].sort((a, b) => a - b);
    if (expected.length !== actual.length || expected.some((id, index) => id !== actual[index])) {
      throw new Error('Invalid wishlist color order');
    }
    for (const [index, id] of colorIds.entries()) {
      await tx.runAsync('UPDATE kit_wishlist_colors SET sort_order = ? WHERE id = ?', [index, id]);
    }
  });
}
