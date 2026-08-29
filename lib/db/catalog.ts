import { getDB } from './connection';
import { getSetting, setSetting } from './settings';
import { getMasterCatalogPaint, upsertCatalogFromSeed } from './seedCatalog';
import { catalogCode, SEED_VERSION, type SeedRow } from './types';
import { validateManualPaint } from '../manualPaint';

export class PaintReferencedByColorError extends Error {
  constructor() {
    super('Paint is referenced by a kit color or mix recipe');
    this.name = 'PaintReferencedByColorError';
  }
}

async function assertPaintNotReferenced(paintId: number): Promise<void> {
  const reference = await getDB().getFirstAsync(
    'SELECT 1 WHERE EXISTS (SELECT 1 FROM kit_color_paints WHERE paint_id = ?) OR EXISTS (SELECT 1 FROM mix_recipe_paints WHERE paint_id = ?)',
    [paintId, paintId]
  );
  if (reference) throw new PaintReferencedByColorError();
}

// 設定画面の「塗料一覧を初期化」: 手動塗料を在庫/リストごと削除し、
// 公式カタログはシードの内容(未編集の状態)へ戻す。
export async function resetCatalogToMaster(): Promise<void> {
  const db = getDB();
  const reference = await db.getFirstAsync(
    "SELECT 1 WHERE EXISTS (SELECT 1 FROM kit_color_paints WHERE paint_id IN (SELECT id FROM catalog_paints WHERE source = 'manual')) OR EXISTS (SELECT 1 FROM mix_recipe_paints WHERE paint_id IN (SELECT id FROM catalog_paints WHERE source = 'manual'))"
  );
  if (reference) throw new PaintReferencedByColorError();

  await db.withTransactionAsync(async () => {
    await db.runAsync("DELETE FROM inventory WHERE paint_id IN (SELECT id FROM catalog_paints WHERE source = 'manual')");
    await db.runAsync("DELETE FROM lists WHERE paint_id IN (SELECT id FROM catalog_paints WHERE source = 'manual')");
    await db.runAsync("DELETE FROM kit_color_paints WHERE paint_id IN (SELECT id FROM catalog_paints WHERE source = 'manual')");
    await db.runAsync('DELETE FROM kit_colors WHERE id NOT IN (SELECT DISTINCT kit_color_id FROM kit_color_paints)');
    await db.runAsync("DELETE FROM catalog_paints WHERE source = 'manual'");
  });
  await upsertCatalogFromSeed(db);
}

export async function getCatalogAppliedVersion(): Promise<number> {
  return Number(await getSetting('catalog_applied_version')) || SEED_VERSION;
}

export async function applyCatalogUpdate(rows: SeedRow[], version: number): Promise<void> {
  const db = getDB();
  await db.withTransactionAsync(async () => {
    await db.execAsync('CREATE TEMP TABLE IF NOT EXISTS catalog_update_codes (catalog_code TEXT PRIMARY KEY)');
    await db.runAsync('DELETE FROM catalog_update_codes');
    for (const p of rows) {
      const code = catalogCode(p.brand, p.series, p.code);
      await db.runAsync(
        'INSERT INTO catalog_paints (catalog_code,brand,series,series_en,code,name_ja,name_en,hex,r,g,b,l,a_star,b_star,barcode,gloss,paint_type,source) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(catalog_code) DO UPDATE SET brand=excluded.brand,series=excluded.series,series_en=excluded.series_en,code=excluded.code,name_ja=excluded.name_ja,name_en=excluded.name_en,hex=excluded.hex,r=excluded.r,g=excluded.g,b=excluded.b,l=excluded.l,a_star=excluded.a_star,b_star=excluded.b_star,barcode=excluded.barcode,gloss=excluded.gloss,paint_type=excluded.paint_type,source=excluded.source',
        [code, p.brand, p.series, p.series_en, p.code, p.name_ja, p.name_en, p.hex, p.rgb_r, p.rgb_g, p.rgb_b, p.lab_l, p.lab_a, p.lab_b, p.barcode, p.gloss, p.paint_type, 'catalog']
      );
      await db.runAsync('INSERT INTO catalog_update_codes (catalog_code) VALUES (?)', [code]);
    }
    await db.execAsync("DELETE FROM catalog_paints WHERE source = 'catalog' AND catalog_code NOT IN (SELECT catalog_code FROM catalog_update_codes) AND id NOT IN (SELECT paint_id FROM inventory) AND id NOT IN (SELECT paint_id FROM lists) AND id NOT IN (SELECT paint_id FROM kit_color_paints) AND id NOT IN (SELECT paint_id FROM mix_recipe_paints)");
    await setSetting('catalog_applied_version', String(version));
    await db.execAsync(`PRAGMA user_version = ${version}`);
  });
}

// 塗料削除時は、参照中のキット色/混色レシピを保護し、在庫・リストを掃除する。
export async function deletePaint(paintId: number): Promise<void> {
  const db = getDB();
  await assertPaintNotReferenced(paintId);

  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM inventory WHERE paint_id = ?', [paintId]);
    await db.runAsync('DELETE FROM lists WHERE paint_id = ?', [paintId]);
    await db.runAsync('DELETE FROM kit_color_paints WHERE paint_id = ?', [paintId]);
    await db.runAsync('DELETE FROM kit_colors WHERE id NOT IN (SELECT DISTINCT kit_color_id FROM kit_color_paints)');
    await db.runAsync('DELETE FROM catalog_paints WHERE id = ?', [paintId]);
  });
}

export interface CatalogPaintDetail {
  id: number;
  catalog_code: string;
  brand: string;
  series: string;
  series_en: string | null;
  code: string;
  name_ja: string;
  name_en: string | null;
  hex: string | null;
  gloss: string | null;
  paint_type: string | null;
  source: string;
  notes: string | null;
}

export async function getCatalogPaintDetail(paintId: number): Promise<CatalogPaintDetail | null> {
  const row = await getDB().getFirstAsync<CatalogPaintDetail>(
    'SELECT id, catalog_code, brand, series, series_en, code, name_ja, name_en, hex, gloss, paint_type, source, notes'
    + ' FROM catalog_paints WHERE id = ?',
    [paintId]
  );
  return row ?? null;
}

// 塗料メモ(塗料そのものに紐づくメモ。編集は色詳細の編集画面からのみ)。
export async function updateCatalogPaintNotes(paintId: number, notes: string): Promise<void> {
  const normalized = notes.trim() === '' ? null : notes;
  await getDB().runAsync('UPDATE catalog_paints SET notes = ? WHERE id = ?', [normalized, paintId]);
}

export interface CatalogPaintContentEdit {
  nameJa: string;
  nameEn?: string;
  hex: string;
  gloss: string | null;
  paintType: string | null;
}

export async function updateCatalogPaintContent(paintId: number, edit: CatalogPaintContentEdit): Promise<void> {
  const current = await getCatalogPaintDetail(paintId);
  if (!current) return;
  const normalized = validateManualPaint({
    nameJa: edit.nameJa,
    brand: current.brand,
    series: current.series,
    code: current.code,
    hex: edit.hex,
    gloss: edit.gloss,
    paintType: edit.paintType,
  });
  if (!normalized) return;
  await getDB().runAsync(
    'UPDATE catalog_paints SET name_ja=?, name_en=?, hex=?, r=?, g=?, b=?, l=?, a_star=?, b_star=?, gloss=?, paint_type=? WHERE id=?',
    [normalized.nameJa, edit.nameEn ?? current.name_en, normalized.normalizedHex,
     normalized.rgb?.r ?? null, normalized.rgb?.g ?? null, normalized.rgb?.b ?? null,
     normalized.lab?.L ?? null, normalized.lab?.a ?? null, normalized.lab?.b ?? null,
     normalized.gloss, normalized.paintType, paintId]
  );
}

export interface ManualPaintEdit {
  nameJa: string;
  nameEn?: string;
  brand: string;
  series: string;
  code: string;
  hex: string;
  gloss: string | null;
  paintType: string | null;
}

export async function updateManualPaint(paintId: number, edit: ManualPaintEdit): Promise<void> {
  const normalized = validateManualPaint(edit);
  if (!normalized) return;
  const catCode = catalogCode(normalized.brand, normalized.series, normalized.code);
  await getDB().runAsync(
    'UPDATE catalog_paints SET catalog_code=?, brand=?, series=?, code=?, name_ja=?, name_en=?, hex=?, r=?, g=?, b=?, l=?, a_star=?, b_star=?, gloss=?, paint_type=? WHERE id=?',
    [catCode, normalized.brand, normalized.series, normalized.code, normalized.nameJa, edit.nameEn ?? null, normalized.normalizedHex,
     normalized.rgb?.r ?? null, normalized.rgb?.g ?? null, normalized.rgb?.b ?? null,
     normalized.lab?.L ?? null, normalized.lab?.a ?? null, normalized.lab?.b ?? null,
     normalized.gloss, normalized.paintType, paintId]
  );
}

export async function resetCatalogPaintToMaster(paintId: number, catalogCodeValue: string): Promise<void> {
  const master = getMasterCatalogPaint(catalogCodeValue);
  if (!master) return;
  const normalized = validateManualPaint({
    nameJa: master.name_ja,
    brand: master.brand,
    series: master.series,
    code: master.code,
    hex: master.hex ?? '',
    gloss: master.gloss,
    paintType: master.paint_type,
  });
  if (!normalized) return;
  await getDB().runAsync(
    'UPDATE catalog_paints SET name_ja=?, hex=?, r=?, g=?, b=?, l=?, a_star=?, b_star=?, gloss=?, paint_type=? WHERE id=?',
    [normalized.nameJa, normalized.normalizedHex,
     normalized.rgb?.r ?? null, normalized.rgb?.g ?? null, normalized.rgb?.b ?? null,
     normalized.lab?.L ?? null, normalized.lab?.a ?? null, normalized.lab?.b ?? null,
     normalized.gloss, normalized.paintType, paintId]
  );
}
