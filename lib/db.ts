// lib/db.ts
import * as SQLite from 'expo-sqlite';
import seedData from '../assets/seed_catalog.json';
import { validateManualPaint } from './manualPaint';

export type PaintStatus = 'owned' | 'in_use' | 'used_up';
export type ListType = 'favorites' | 'wishlist';

export type SeedRow = {
  brand: string; series: string; series_en: string | null; code: string;
  name_ja: string; name_en: string | null; hex: string | null;
  rgb_r: number | null; rgb_g: number | null; rgb_b: number | null;
  lab_l: number | null; lab_a: number | null; lab_b: number | null;
  barcode: string | null; gloss: string | null; paint_type: string | null;
};

// シード内容を更新したら上げる。catalog_paints を作り直して再シードする。
// (INSERT OR IGNORE のため既存行は更新されない。過去の壊れた名前を一掃する用途も兼ねる)
const SEED_VERSION = 14;

// 品番(code)はブランドをまたいで重複しうる上、同一ブランド内でもシリーズをまたいで
// 再利用される(例: タミヤ X-1 はエナメル/アクリルミニ両方に存在)ため、
// 内部の一意キーは brand+series+code。
export function catalogCode(brand: string, series: string, code: string): string {
  return `${brand}|${series}|${code}`;
}

let _db: SQLite.SQLiteDatabase | null = null;
let masterCatalogMap: Map<string, SeedRow> | null = null;

export function getDB(): SQLite.SQLiteDatabase {
  if (!_db) throw new Error('DB not initialized. Call initDB() first.');
  return _db;
}

export async function initDB(): Promise<void> {
  const db = await SQLite.openDatabaseAsync('colorack.db');
  _db = db;

  await db.execAsync(
    'PRAGMA journal_mode = WAL;' +
    'CREATE TABLE IF NOT EXISTS catalog_paints (' +
    '  id INTEGER PRIMARY KEY AUTOINCREMENT,' +
    '  catalog_code TEXT UNIQUE,' +
    '  brand TEXT, series TEXT, series_en TEXT, code TEXT,' +
    '  name_ja TEXT, name_en TEXT, hex TEXT,' +
    '  r INTEGER, g INTEGER, b INTEGER,' +
    '  l REAL, a_star REAL, b_star REAL, barcode TEXT, gloss TEXT, paint_type TEXT, source TEXT, notes TEXT' +
    ');' +
    'CREATE TABLE IF NOT EXISTS boxes (' +
    '  id INTEGER PRIMARY KEY AUTOINCREMENT,' +
    '  name TEXT NOT NULL, location TEXT, note TEXT' +
    ');' +
    'CREATE TABLE IF NOT EXISTS inventory (' +
    '  id INTEGER PRIMARY KEY AUTOINCREMENT,' +
    "  paint_id INTEGER NOT NULL, box_id INTEGER," +
    "  status TEXT NOT NULL DEFAULT 'owned' CHECK(status IN ('owned','in_use','used_up'))," +
    "  note TEXT, added_at TEXT DEFAULT (datetime('now'))" +
    ');' +
    'CREATE TABLE IF NOT EXISTS lists (' +
    '  id INTEGER PRIMARY KEY AUTOINCREMENT,' +
    '  name TEXT,' +
    "  type TEXT NOT NULL CHECK(type IN ('favorites','wishlist'))," +
    '  paint_id INTEGER NOT NULL, note TEXT,' +
    "  added_at TEXT DEFAULT (datetime('now'))" +
    ');' +
    'CREATE TABLE IF NOT EXISTS app_settings (' +
    '  key TEXT PRIMARY KEY, value TEXT' +
    ');'
  );

  // 既存DBに gloss 列が無ければ追加(SQLiteは IF NOT EXISTS 非対応なので try/catch)
  try { await db.execAsync('ALTER TABLE catalog_paints ADD COLUMN gloss TEXT'); } catch { /* 既にある */ }
  try { await db.execAsync('ALTER TABLE catalog_paints ADD COLUMN paint_type TEXT'); } catch { /* 既にある */ }
  try { await db.execAsync('ALTER TABLE catalog_paints ADD COLUMN source TEXT'); } catch { /* 既にある */ }
  try { await db.execAsync('ALTER TABLE catalog_paints ADD COLUMN series_en TEXT'); } catch { /* 既にある */ }
  try { await db.execAsync('ALTER TABLE catalog_paints ADD COLUMN notes TEXT'); } catch { /* 既にある */ }
  try { await db.execAsync('ALTER TABLE inventory ADD COLUMN status_changed_at TEXT'); } catch { /* 既にある */ }

  // 旧スキーマ(code が UNIQUE でブランドをまたいで衝突する)の端末はテーブルを作り直す。
  // code 単体の UNIQUE は SQLite の ALTER では外せないため、テーブルごと再構築する。
  const hasCatalogCode = await db.getFirstAsync(
    "SELECT 1 FROM pragma_table_info('catalog_paints') WHERE name='catalog_code'"
  );
  if (!hasCatalogCode) {
    await db.execAsync(
      'ALTER TABLE catalog_paints RENAME TO catalog_paints_old;' +
      'CREATE TABLE catalog_paints (' +
      '  id INTEGER PRIMARY KEY AUTOINCREMENT,' +
      '  catalog_code TEXT UNIQUE,' +
      '  brand TEXT, series TEXT, series_en TEXT, code TEXT,' +
      '  name_ja TEXT, name_en TEXT, hex TEXT,' +
      '  r INTEGER, g INTEGER, b INTEGER,' +
      '  l REAL, a_star REAL, b_star REAL, barcode TEXT, gloss TEXT, paint_type TEXT, source TEXT, notes TEXT' +
      ');' +
      'INSERT INTO catalog_paints' +
      ' (id, catalog_code, brand, series, series_en, code, name_ja, name_en, hex, r, g, b, l, a_star, b_star, barcode, gloss, paint_type, source)' +
      " SELECT id, brand || '|' || series || '|' || code, brand, series, series_en, code, name_ja, name_en, hex, r, g, b, l, a_star, b_star, barcode, gloss, paint_type, source" +
      ' FROM catalog_paints_old;' +
      'DROP TABLE catalog_paints_old;'
    );
  }

  // 旧デフォルト名「ボックス」の既存端末を「Box」へ一度だけ移行。
  await db.runAsync("UPDATE boxes SET name = 'Box' WHERE name = 'ボックス'");

  // 初期ボックス「Box」を用意し、デフォルトに設定(ボックスが無い時だけ)
  const boxCount = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM boxes');
  if ((boxCount?.n ?? 0) === 0) {
    const res = await db.runAsync('INSERT INTO boxes (name) VALUES (?)', ['Box']);
    await db.runAsync(
      'INSERT INTO app_settings (key, value) VALUES (?, ?)'
      + ' ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      ['default_box_id', String(res.lastInsertRowId)]
    );
  }

  // シードバージョンが古い端末は catalog_paints をシードの内容へ更新。
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const current = row?.user_version ?? 0;
  if (current < SEED_VERSION) {
    await upsertCatalogFromSeed(db);
    await db.execAsync(`PRAGMA user_version = ${SEED_VERSION}`);
  }
}

// brand+series+code(catalog_code) をキーに、公式カタログ(source='catalog')をシードの内容でUPSERT。
// 既存行は id を保ったまま更新するので inventory/lists の paint_id 参照を壊さない。
// initDB()のシード更新と、設定画面からの「塗料一覧を初期化」の両方から呼ばれる。
async function upsertCatalogFromSeed(db: SQLite.SQLiteDatabase): Promise<void> {
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
    const catalogCodes = seed.map((p) => catalogCode(p.brand, p.series, p.code));
    const placeholders = catalogCodes.map(() => '?').join(',');
    await db.runAsync(
      `DELETE FROM catalog_paints WHERE catalog_code NOT IN (${placeholders})` +
      ' AND id NOT IN (SELECT paint_id FROM inventory)' +
      ' AND id NOT IN (SELECT paint_id FROM lists)',
      catalogCodes
    );
  });
}

// 設定画面の「塗料一覧を初期化」: 手動塗料を在庫/リストごと削除し、
// 公式カタログはシードの内容(未編集の状態)へ戻す。
export async function resetCatalogToMaster(): Promise<void> {
  const db = getDB();
  await db.runAsync("DELETE FROM inventory WHERE paint_id IN (SELECT id FROM catalog_paints WHERE source = 'manual')");
  await db.runAsync("DELETE FROM lists WHERE paint_id IN (SELECT id FROM catalog_paints WHERE source = 'manual')");
  await db.runAsync("DELETE FROM catalog_paints WHERE source = 'manual'");
  await upsertCatalogFromSeed(db);
}

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

// 一覧表示用: 使用済を除いた所持数を paint_id ごとにまとめる。
export async function getOwnedCountMap(): Promise<Map<number, number>> {
  const rows = await getDB().getAllAsync<{ paint_id: number; n: number }>(
    "SELECT paint_id, COUNT(*) AS n FROM inventory WHERE status IN ('owned','in_use') GROUP BY paint_id"
  );
  return new Map(rows.map((r) => [r.paint_id, r.n]));
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

// 指定した塗料がお気に入り/買い物リストに登録済みかどうか。
export async function getListMembership(paintId: number): Promise<{ favorites: boolean; wishlist: boolean }> {
  const rows = await getDB().getAllAsync<{ type: ListType }>(
    "SELECT DISTINCT type FROM lists WHERE paint_id = ? AND type IN ('favorites','wishlist')",
    [paintId]
  );
  return {
    favorites: rows.some((r) => r.type === 'favorites'),
    wishlist: rows.some((r) => r.type === 'wishlist'),
  };
}

export async function removeFromList(paintId: number, type: ListType): Promise<void> {
  await getDB().runAsync('DELETE FROM lists WHERE paint_id = ? AND type = ?', [paintId, type]);
}

export interface InventoryDetail {
  id: number;
  paint_id: number;
  box_id: number | null;
  box_name: string | null;
  status: PaintStatus;
  note: string | null;
  added_at: string | null;
  status_changed_at: string | null;
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
  paint_notes: string | null;
}

export async function getInventoryDetail(inventoryId: number): Promise<InventoryDetail | null> {
  const row = await getDB().getFirstAsync<InventoryDetail>(
    'SELECT i.id, i.paint_id, i.box_id, b.name AS box_name, i.status, i.note, i.added_at, i.status_changed_at,'
    + ' c.catalog_code, c.brand, c.series, c.series_en, c.code, c.name_ja, c.name_en, c.hex, c.gloss, c.paint_type, c.source, c.notes AS paint_notes'
    + ' FROM inventory i'
    + ' JOIN catalog_paints c ON i.paint_id = c.id'
    + ' LEFT JOIN boxes b ON i.box_id = b.id'
    + ' WHERE i.id = ?',
    [inventoryId]
  );
  return row ?? null;
}

// status_changed_at は「最終更新日時」として、ステータス変更に限らず
// メモ・ボックスの変更でも更新する(在庫1点の最終更新日時という位置づけ)。
export async function updateInventoryNote(inventoryId: number, note: string): Promise<void> {
  const normalized = note.trim() === '' ? null : note;
  await getDB().runAsync(
    "UPDATE inventory SET note = ?, status_changed_at = datetime('now') WHERE id = ?",
    [normalized, inventoryId]
  );
}

export async function updateInventoryBox(inventoryId: number, boxId: number): Promise<void> {
  await getDB().runAsync(
    "UPDATE inventory SET box_id = ?, status_changed_at = datetime('now') WHERE id = ?",
    [boxId, inventoryId]
  );
}

export async function setInventoryStatus(inventoryId: number, status: PaintStatus): Promise<void> {
  await getDB().runAsync(
    "UPDATE inventory SET status = ?, status_changed_at = datetime('now') WHERE id = ?",
    [status, inventoryId]
  );
}

export interface CatalogPaintContentEdit {
  nameJa: string;
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
    'UPDATE catalog_paints SET name_ja=?, hex=?, r=?, g=?, b=?, l=?, a_star=?, b_star=?, gloss=?, paint_type=? WHERE id=?',
    [normalized.nameJa, normalized.normalizedHex,
     normalized.rgb?.r ?? null, normalized.rgb?.g ?? null, normalized.rgb?.b ?? null,
     normalized.lab?.L ?? null, normalized.lab?.a ?? null, normalized.lab?.b ?? null,
     normalized.gloss, normalized.paintType, paintId]
  );
}

export interface ManualPaintEdit {
  nameJa: string;
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
    'UPDATE catalog_paints SET catalog_code=?, brand=?, series=?, code=?, name_ja=?, hex=?, r=?, g=?, b=?, l=?, a_star=?, b_star=?, gloss=?, paint_type=? WHERE id=?',
    [catCode, normalized.brand, normalized.series, normalized.code, normalized.nameJa, normalized.normalizedHex,
     normalized.rgb?.r ?? null, normalized.rgb?.g ?? null, normalized.rgb?.b ?? null,
     normalized.lab?.L ?? null, normalized.lab?.a ?? null, normalized.lab?.b ?? null,
     normalized.gloss, normalized.paintType, paintId]
  );
}

export function getMasterCatalogPaint(catalogCodeValue: string): SeedRow | null {
  if (!masterCatalogMap) {
    masterCatalogMap = new Map(
      (seedData as SeedRow[]).map((p) => [catalogCode(p.brand, p.series, p.code), p])
    );
  }
  return masterCatalogMap.get(catalogCodeValue) ?? null;
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
