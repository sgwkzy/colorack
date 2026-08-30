import { getDB } from './connection';
import type { ColorMixPaint, ColorMixSummary } from '../colorMixDraft';

type MixRecipePaintInput = { paintId: number; ratio: number };

function normalizeText(value: string | null): string | null {
  return value?.trim() === '' ? null : value;
}

export async function getMixRecipes(): Promise<ColorMixSummary[]> {
  const db = getDB();
  const recipeRows = await db.getAllAsync<{ id: number; name: string | null; note: string | null }>(
    'SELECT id, name, note FROM mix_recipes ORDER BY sort_order, id'
  );
  const paintRows = await db.getAllAsync<ColorMixPaint & { mix_recipe_id: number }>(
    'SELECT mrp.mix_recipe_id, mrp.paint_id, mrp.ratio, mrp.sort_order, c.name_ja, c.name_en, c.brand, c.series, c.series_en, c.code, c.hex, c.paint_type'
    + ' FROM mix_recipe_paints mrp JOIN catalog_paints c ON mrp.paint_id = c.id'
    + ' JOIN mix_recipes mr ON mr.id = mrp.mix_recipe_id'
    + ' ORDER BY mrp.sort_order, mrp.id'
  );
  return recipeRows.map((recipe) => ({
    ...recipe,
    paints: paintRows.filter((paint) => paint.mix_recipe_id === recipe.id),
  }));
}

export async function addMixRecipe(
  name: string | null,
  note: string | null,
  paints: MixRecipePaintInput[],
): Promise<void> {
  const db = getDB();
  await db.withTransactionAsync(async () => {
    const row = await db.getFirstAsync<{ n: number }>(
      'SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM mix_recipes'
    );
    const result = await db.runAsync(
      'INSERT INTO mix_recipes (name, note, sort_order) VALUES (?, ?, ?)',
      [normalizeText(name), normalizeText(note), row?.n ?? 0]
    );
    for (const [index, paint] of paints.entries()) {
      await db.runAsync(
        'INSERT INTO mix_recipe_paints (mix_recipe_id, paint_id, ratio, sort_order) VALUES (?, ?, ?, ?)',
        [result.lastInsertRowId, paint.paintId, paint.ratio, index]
      );
    }
  });
}

export async function updateMixRecipe(
  id: number,
  name: string | null,
  note: string | null,
  paints: MixRecipePaintInput[],
): Promise<void> {
  const db = getDB();
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      "UPDATE mix_recipes SET name = ?, note = ?, updated_at = datetime('now') WHERE id = ?",
      [normalizeText(name), normalizeText(note), id]
    );
    await db.runAsync('DELETE FROM mix_recipe_paints WHERE mix_recipe_id = ?', [id]);
    for (const [index, paint] of paints.entries()) {
      await db.runAsync(
        'INSERT INTO mix_recipe_paints (mix_recipe_id, paint_id, ratio, sort_order) VALUES (?, ?, ?, ?)',
        [id, paint.paintId, paint.ratio, index]
      );
    }
  });
}

export async function removeMixRecipe(id: number): Promise<void> {
  const db = getDB();
  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM mix_recipe_paints WHERE mix_recipe_id = ?', [id]);
    await db.runAsync('DELETE FROM mix_recipes WHERE id = ?', [id]);
  });
}

export async function reorderMixRecipes(recipeIds: number[]): Promise<void> {
  const db = getDB();
  await db.withTransactionAsync(async () => {
    for (const [index, id] of recipeIds.entries()) {
      await db.runAsync('UPDATE mix_recipes SET sort_order = ? WHERE id = ?', [index, id]);
    }
  });
}
