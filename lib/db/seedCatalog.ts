import * as SQLite from 'expo-sqlite';
import seedData from '../../assets/seed_catalog.json';
import { catalogCode, type SeedRow } from './types';

let masterCatalogMap: Map<string, SeedRow> | null = null;

// brand+series+code(catalog_code) をキーに、公式カタログ(source='catalog')をシードの内容でUPSERT。
// 既存行は id を保ったまま更新するので inventory/lists の paint_id 参照を壊さない。
// initDB()のシード更新と、設定画面からの「塗料一覧を初期化」の両方から呼ばれる。
export async function upsertCatalogFromSeed(db: SQLite.SQLiteDatabase): Promise<void> {
  const seed = seedData as SeedRow[];
  await db.withTransactionAsync(async () => {
    for (const p of seed) {
      await db.runAsync(
        'INSERT INTO catalog_paints' +
        ' (catalog_code,brand,series,series_en,code,name_ja,name_en,hex,r,g,b,l,a_star,b_star,barcode,gloss,paint_type,source)' +
        ' VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)' +
        ' ON CONFLICT(catalog_code) DO UPDATE SET' +
        '  brand=excluded.brand, series=excluded.series, series_en=excluded.series_en,' +
        '  name_ja=excluded.name_ja, name_en=excluded.name_en, hex=excluded.hex,' +
        '  r=excluded.r, g=excluded.g, b=excluded.b,' +
        '  l=excluded.l, a_star=excluded.a_star, b_star=excluded.b_star,' +
        '  gloss=excluded.gloss, paint_type=excluded.paint_type, source=excluded.source',
        [catalogCode(p.brand, p.series, p.code), p.brand, p.series, p.series_en, p.code, p.name_ja, p.name_en, p.hex,
         p.rgb_r, p.rgb_g, p.rgb_b, p.lab_l, p.lab_a, p.lab_b, p.barcode ?? null, p.gloss ?? null, p.paint_type ?? null, 'catalog']
      );
    }
    // 洗い替え: 新シードに無い旧カタログ行のうち、在庫/リストから参照されていない
    // ものを掃除する(参照中の行は id を壊さないため残す)。
    await db.execAsync('CREATE TEMP TABLE IF NOT EXISTS seed_catalog_codes (catalog_code TEXT PRIMARY KEY)');
    await db.runAsync('DELETE FROM seed_catalog_codes');
    for (const paint of seed) await db.runAsync(
      'INSERT INTO seed_catalog_codes (catalog_code) VALUES (?)',
      [catalogCode(paint.brand, paint.series, paint.code)]
    );
    await db.runAsync(
      // source = 'catalog' の絞り込みは必須。これが無いとユーザーが手動追加した塗料
      // (source='manual')までシードに無い行として削除され、在庫/リスト/配合から
      // 参照されていないものが SEED_VERSION 更新時に警告なく消える。
      // applyCatalogUpdate 側の同処理と条件を揃えている。
      "DELETE FROM catalog_paints WHERE source = 'catalog'" +
      ' AND catalog_code NOT IN (SELECT catalog_code FROM seed_catalog_codes)' +
      ' AND id NOT IN (SELECT paint_id FROM inventory)' +
      ' AND id NOT IN (SELECT paint_id FROM lists)' +
      ' AND id NOT IN (SELECT paint_id FROM kit_color_paints)' +
      ' AND id NOT IN (SELECT paint_id FROM mix_recipe_paints)',
    );
  });
}

export function getMasterCatalogPaint(catalogCodeValue: string): SeedRow | null {
  if (!masterCatalogMap) {
    masterCatalogMap = new Map(
      (seedData as SeedRow[]).map((p) => [catalogCode(p.brand, p.series, p.code), p])
    );
  }
  return masterCatalogMap.get(catalogCodeValue) ?? null;
}
