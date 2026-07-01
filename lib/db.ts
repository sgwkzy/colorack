// lib/db.ts
import * as SQLite from 'expo-sqlite';
import seedData from '../assets/seed_catalog.json';

export type PaintStatus = 'owned' | 'in_use' | 'used_up';
export type ListType = 'favorites' | 'wishlist';

// シード内容を更新したら上げる。catalog_paints を作り直して再シードする。
// (INSERT OR IGNORE のため既存行は更新されない。過去の壊れた名前を一掃する用途も兼ねる)
const SEED_VERSION = 7;

let _db: SQLite.SQLiteDatabase | null = null;

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
    '  brand TEXT, series TEXT, code TEXT UNIQUE,' +
    '  name_ja TEXT, name_en TEXT, hex TEXT,' +
    '  r INTEGER, g INTEGER, b INTEGER,' +
    '  l REAL, a_star REAL, b_star REAL, barcode TEXT, gloss TEXT, paint_type TEXT, source TEXT' +
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

  // 初期ボックス「ボックス」を用意し、デフォルトに設定(ボックスが無い時だけ)
  const boxCount = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM boxes');
  if ((boxCount?.n ?? 0) === 0) {
    const res = await db.runAsync('INSERT INTO boxes (name) VALUES (?)', ['ボックス']);
    await db.runAsync(
      'INSERT INTO app_settings (key, value) VALUES (?, ?)'
      + ' ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      ['default_box_id', String(res.lastInsertRowId)]
    );
  }

  type SeedRow = {
    brand: string; series: string; code: string;
    name_ja: string; name_en: string | null; hex: string | null;
    rgb_r: number | null; rgb_g: number | null; rgb_b: number | null;
    lab_l: number | null; lab_a: number | null; lab_b: number | null;
    barcode: string | null; gloss: string | null; paint_type: string | null;
  };

  const seed = seedData as SeedRow[];

  // シードバージョンが古い端末は catalog_paints を作り直して再シード。
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const current = row?.user_version ?? 0;
  if (current >= SEED_VERSION) return;

  await db.withTransactionAsync(async () => {
    // code をキーに UPSERT。既存行は id を保ったまま更新するので
    // inventory/lists の paint_id 参照を壊さない(つや・名前の更新もここで入る)。
    for (const p of seed) {
      await db.runAsync(
        'INSERT INTO catalog_paints' +
        ' (brand,series,code,name_ja,name_en,hex,r,g,b,l,a_star,b_star,barcode,gloss,paint_type,source)' +
        ' VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)' +
        ' ON CONFLICT(code) DO UPDATE SET' +
        '  brand=excluded.brand, series=excluded.series,' +
        '  name_ja=excluded.name_ja, name_en=excluded.name_en, hex=excluded.hex,' +
        '  r=excluded.r, g=excluded.g, b=excluded.b,' +
        '  l=excluded.l, a_star=excluded.a_star, b_star=excluded.b_star,' +
        '  gloss=excluded.gloss, paint_type=excluded.paint_type, source=excluded.source',
        [p.brand, p.series, p.code, p.name_ja, p.name_en, p.hex,
         p.rgb_r, p.rgb_g, p.rgb_b, p.lab_l, p.lab_a, p.lab_b, p.barcode ?? null, p.gloss ?? null, p.paint_type ?? null, 'catalog']
      );
    }
    // 洗い替え: 新シードに無い旧カタログ行のうち、在庫/リストから参照されていない
    // ものを掃除する(参照中の行は id を壊さないため残す)。
    const codes = seed.map((p) => p.code);
    const placeholders = codes.map(() => '?').join(',');
    await db.runAsync(
      `DELETE FROM catalog_paints WHERE code NOT IN (${placeholders})` +
      ' AND id NOT IN (SELECT paint_id FROM inventory)' +
      ' AND id NOT IN (SELECT paint_id FROM lists)',
      codes
    );
    await db.execAsync(`PRAGMA user_version = ${SEED_VERSION}`);
  });
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
