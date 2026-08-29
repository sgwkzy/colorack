import { getDB } from './connection';
import type { ColorMixPaint, ColorMixSummary } from '../colorMixDraft';

export type KitColorPaint = ColorMixPaint;
export type KitColorSummary = ColorMixSummary;

export async function getKitColors(kitId: number): Promise<KitColorSummary[]> {
  const db = getDB();
  const colorRows = await db.getAllAsync<{ id: number; name: string | null; note: string | null }>(
    'SELECT id, name, note FROM kit_colors WHERE kit_id = ? ORDER BY sort_order, id',
    [kitId]
  );
  const paintRows = await db.getAllAsync<KitColorPaint & { kit_color_id: number }>(
    'SELECT kcp.kit_color_id, kcp.paint_id, kcp.ratio, kcp.sort_order, c.name_ja, c.name_en, c.code, c.brand, c.series, c.series_en, c.hex, c.paint_type'
    + ' FROM kit_color_paints kcp JOIN catalog_paints c ON kcp.paint_id = c.id'
    + ' WHERE kcp.kit_color_id IN (SELECT id FROM kit_colors WHERE kit_id = ?)'
    + ' ORDER BY kcp.sort_order, kcp.id',
    [kitId]
  );
  return colorRows.map((color) => ({
    ...color,
    paints: paintRows.filter((p) => p.kit_color_id === color.id),
  }));
}

export async function addKitColor(
  kitId: number,
  name: string | null,
  note: string | null,
  paints: { paintId: number; ratio: number }[]
): Promise<void> {
  const db = getDB();
  await db.withTransactionAsync(async () => {
    const row = await db.getFirstAsync<{ n: number }>(
      'SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM kit_colors WHERE kit_id = ?',
      [kitId]
    );
    const result = await db.runAsync(
      'INSERT INTO kit_colors (kit_id, name, note, sort_order) VALUES (?, ?, ?, ?)',
      [kitId, name, note, row?.n ?? 0]
    );
    const kitColorId = result.lastInsertRowId;
    for (const [index, p] of paints.entries()) {
      await db.runAsync(
        'INSERT INTO kit_color_paints (kit_color_id, paint_id, ratio, sort_order) VALUES (?, ?, ?, ?)',
        [kitColorId, p.paintId, p.ratio, index]
      );
    }
  });
}

export async function updateKitColor(
  kitColorId: number,
  name: string | null,
  note: string | null,
  paints: { paintId: number; ratio: number }[],
): Promise<void> {
  const db = getDB();
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      'UPDATE kit_colors SET name = ?, note = ? WHERE id = ?',
      [name?.trim() === '' ? null : name, note?.trim() === '' ? null : note, kitColorId]
    );
    await db.runAsync('DELETE FROM kit_color_paints WHERE kit_color_id = ?', [kitColorId]);
    for (const [index, paint] of paints.entries()) {
      await db.runAsync(
        'INSERT INTO kit_color_paints (kit_color_id, paint_id, ratio, sort_order) VALUES (?, ?, ?, ?)',
        [kitColorId, paint.paintId, paint.ratio, index]
      );
    }
  });
}

export async function updateKitColorName(kitColorId: number, name: string): Promise<void> {
  const normalized = name.trim() === '' ? null : name;
  await getDB().runAsync('UPDATE kit_colors SET name = ? WHERE id = ?', [normalized, kitColorId]);
}

export async function removeKitColor(kitColorId: number): Promise<void> {
  const db = getDB();
  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM kit_color_paints WHERE kit_color_id = ?', [kitColorId]);
    await db.runAsync('DELETE FROM kit_colors WHERE id = ?', [kitColorId]);
  });
}

export async function reorderKitColors(colorIds: number[]): Promise<void> {
  const db = getDB();
  await db.withTransactionAsync(async () => {
    for (const [index, id] of colorIds.entries()) {
      await db.runAsync('UPDATE kit_colors SET sort_order = ? WHERE id = ?', [index, id]);
    }
  });
}
