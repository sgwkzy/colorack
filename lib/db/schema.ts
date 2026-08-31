import * as SQLite from 'expo-sqlite';
import { _setDB } from './connection';
import { SEED_VERSION } from './types';
import { upsertCatalogFromSeed } from './seedCatalog';
import { migrateKitPhotoUris } from '../kitPhoto';

export async function initDB(): Promise<void> {
  const db = await SQLite.openDatabaseAsync('colorack.db');
  _setDB(db);

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
    "  name TEXT NOT NULL, location TEXT, note TEXT, icon TEXT NOT NULL DEFAULT 'box', icon_color TEXT NOT NULL DEFAULT '#4a90d9', sort_order INTEGER NOT NULL DEFAULT 0" +
    ');' +
    'CREATE TABLE IF NOT EXISTS inventory (' +
    '  id INTEGER PRIMARY KEY AUTOINCREMENT,' +
    "  paint_id INTEGER NOT NULL, box_id INTEGER," +
    "  status TEXT NOT NULL DEFAULT 'owned' CHECK(status IN ('owned','in_use','used_up'))," +
    "  note TEXT, added_at TEXT DEFAULT (datetime('now')), status_changed_at TEXT DEFAULT (datetime('now'))" +
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
    ');' +
    'CREATE TABLE IF NOT EXISTS kit_boxes (' +
    '  id INTEGER PRIMARY KEY AUTOINCREMENT,' +
    "  name TEXT NOT NULL, icon TEXT NOT NULL DEFAULT 'box', icon_color TEXT NOT NULL DEFAULT '#4a90d9', sort_order INTEGER NOT NULL DEFAULT 0" +
    ');' +
    'CREATE TABLE IF NOT EXISTS kits (' +
    '  id INTEGER PRIMARY KEY AUTOINCREMENT,' +
    '  box_id INTEGER,' +
    '  name TEXT NOT NULL, maker TEXT NOT NULL, series TEXT, category TEXT, scale TEXT, note TEXT, price INTEGER,' +
    "  status TEXT NOT NULL DEFAULT 'not_started' CHECK(status IN ('not_started','building','completed'))," +
    "  added_at TEXT DEFAULT (datetime('now')), status_changed_at TEXT DEFAULT (datetime('now'))" +
    ');' +
    'CREATE TABLE IF NOT EXISTS kit_wishlist (' +
    '  id INTEGER PRIMARY KEY AUTOINCREMENT,' +
    '  name TEXT NOT NULL, maker TEXT NOT NULL, series TEXT, category TEXT, scale TEXT, note TEXT, price INTEGER,' +
    "  added_at TEXT DEFAULT (datetime('now'))" +
    ');' +
    'CREATE TABLE IF NOT EXISTS kit_colors (' +
    '  id INTEGER PRIMARY KEY AUTOINCREMENT,' +
    '  kit_id INTEGER NOT NULL, name TEXT, note TEXT, sort_order INTEGER NOT NULL DEFAULT 0,' +
    "  added_at TEXT DEFAULT (datetime('now'))" +
    ');' +
    'CREATE TABLE IF NOT EXISTS kit_color_paints (' +
    '  id INTEGER PRIMARY KEY AUTOINCREMENT,' +
    '  kit_color_id INTEGER NOT NULL, paint_id INTEGER NOT NULL, ratio REAL NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0' +
    ');' +
    'CREATE TABLE IF NOT EXISTS mix_recipes (' +
    '  id INTEGER PRIMARY KEY AUTOINCREMENT,' +
    '  name TEXT,' +
    '  note TEXT,' +
    '  sort_order INTEGER NOT NULL DEFAULT 0,' +
    '  added_at TEXT DEFAULT (datetime(\'now\')),' +
    '  updated_at TEXT DEFAULT (datetime(\'now\'))' +
    ');' +
    'CREATE TABLE IF NOT EXISTS mix_recipe_paints (' +
    '  id INTEGER PRIMARY KEY AUTOINCREMENT,' +
    '  mix_recipe_id INTEGER NOT NULL,' +
    '  paint_id INTEGER NOT NULL,' +
    '  ratio REAL NOT NULL,' +
    '  sort_order INTEGER NOT NULL DEFAULT 0' +
    ');' +
    'CREATE TABLE IF NOT EXISTS kit_photos (' +
    '  id INTEGER PRIMARY KEY AUTOINCREMENT,' +
    '  kit_id INTEGER NOT NULL, uri TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0,' +
    "  added_at TEXT DEFAULT (datetime('now'))" +
    ');'
  );
  await db.execAsync(
    'DELETE FROM lists WHERE id NOT IN (SELECT MIN(id) FROM lists GROUP BY type, paint_id);' +
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_lists_type_paint ON lists(type, paint_id);'
  );

  // 既存DBに gloss 列が無ければ追加(SQLiteは IF NOT EXISTS 非対応なので try/catch)
  try { await db.execAsync('ALTER TABLE catalog_paints ADD COLUMN gloss TEXT'); } catch { /* 既にある */ }
  try { await db.execAsync('ALTER TABLE catalog_paints ADD COLUMN paint_type TEXT'); } catch { /* 既にある */ }
  try { await db.execAsync('ALTER TABLE catalog_paints ADD COLUMN source TEXT'); } catch { /* 既にある */ }
  try { await db.execAsync('ALTER TABLE catalog_paints ADD COLUMN series_en TEXT'); } catch { /* 既にある */ }
  try { await db.execAsync('ALTER TABLE catalog_paints ADD COLUMN notes TEXT'); } catch { /* 既にある */ }
  try { await db.execAsync('ALTER TABLE inventory ADD COLUMN status_changed_at TEXT'); } catch { /* 既にある */ }
  try { await db.execAsync('ALTER TABLE kits ADD COLUMN series TEXT'); } catch { /* 既にある */ }
  try { await db.execAsync('ALTER TABLE kits ADD COLUMN category TEXT'); } catch { /* 既にある */ }
  try { await db.execAsync('ALTER TABLE kits ADD COLUMN price INTEGER'); } catch { /* 既にある */ }
  const hasLegacyKitLists = await db.getFirstAsync<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'kit_lists'"
  );
  if (hasLegacyKitLists) {
    await db.withTransactionAsync(async () => {
      await db.runAsync(
        'INSERT INTO kit_wishlist (name, maker, series, category, scale, note, price, added_at)' +
        ' SELECT k.name, k.maker, k.series, k.category, k.scale, k.note, k.price, l.added_at' +
        ' FROM kit_lists l JOIN kits k ON k.id = l.kit_id'
      );
      await db.execAsync('DROP TABLE kit_lists');
    });
  }
  try { await db.execAsync('ALTER TABLE kit_colors ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0'); } catch { /* 既にある */ }
  try { await db.execAsync('ALTER TABLE kit_photos ADD COLUMN synced_at TEXT'); } catch { /* 既にある */ }
  try { await db.execAsync('ALTER TABLE kit_photos ADD COLUMN storage_path TEXT'); } catch { /* 既にある */ }
  await migrateKitPhotoUris(db);
  await db.runAsync(
    'UPDATE inventory SET status_changed_at = added_at WHERE status_changed_at IS NULL OR status_changed_at < added_at'
  );
  try { await db.execAsync("ALTER TABLE boxes ADD COLUMN icon TEXT NOT NULL DEFAULT 'box'"); } catch { /* 既にある */ }
  try { await db.execAsync("ALTER TABLE boxes ADD COLUMN icon_color TEXT NOT NULL DEFAULT '#4a90d9'"); } catch { /* 既にある */ }
  try {
    await db.execAsync('ALTER TABLE boxes ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0');
    await db.runAsync('UPDATE boxes SET sort_order = id');
  } catch { /* 既にある */ }
  // 使用済は共通履歴。ボックスから外しておけば、ボックス削除/変更に影響されない。
  await db.runAsync("UPDATE inventory SET box_id = NULL WHERE status = 'used_up'");

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
      ' (id, catalog_code, brand, series, series_en, code, name_ja, name_en, hex, r, g, b, l, a_star, b_star, barcode, gloss, paint_type, source, notes)' +
      " SELECT id, brand || '|' || series || '|' || code, brand, series, series_en, code, name_ja, name_en, hex, r, g, b, l, a_star, b_star, barcode, gloss, paint_type, source, notes" +
      ' FROM catalog_paints_old;' +
      'DROP TABLE catalog_paints_old;'
    );
  }

  // 旧 kit_paints (1塗料1行) が残っていれば kit_colors/kit_color_paints へ移行して削除。
  const hasKitPaints = await db.getFirstAsync(
    "SELECT 1 FROM sqlite_master WHERE type='table' AND name='kit_paints'"
  );
  if (hasKitPaints) {
    const oldRows = await db.getAllAsync<{ id: number; kit_id: number; paint_id: number; note: string | null }>(
      'SELECT id, kit_id, paint_id, note FROM kit_paints'
    );
    await db.withTransactionAsync(async () => {
      for (const oldRow of oldRows) {
        const paint = await db.getFirstAsync<{ name_ja: string }>(
          'SELECT name_ja FROM catalog_paints WHERE id = ?',
          [oldRow.paint_id]
        );
        const colorResult = await db.runAsync(
          'INSERT INTO kit_colors (kit_id, name, note) VALUES (?, ?, ?)',
          [oldRow.kit_id, paint?.name_ja ?? null, oldRow.note]
        );
        await db.runAsync(
          'INSERT INTO kit_color_paints (kit_color_id, paint_id, ratio, sort_order) VALUES (?, ?, ?, ?)',
          [colorResult.lastInsertRowId, oldRow.paint_id, 1.0, 0]
        );
      }
      await db.execAsync('DROP TABLE kit_paints');
    });
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

  // デフォルトボックスは常に有効な行を指している前提でUIを組んでいるため、起動時に
  // 自己修復する。未設定(この仕組み導入前からボックスがあった端末)と、削除済みの
  // ボックスを指している場合の両方を先頭のボックスへ寄せる。
  await ensureDefaultBox(db, 'default_box_id', 'boxes');

  // 初期キットボックス「Box」を用意し、デフォルトに設定(キットボックスが無い時だけ)。
  // 塗料ボックスと同じ仕組み。
  const kitBoxCount = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM kit_boxes');
  if ((kitBoxCount?.n ?? 0) === 0) {
    const kitRes = await db.runAsync('INSERT INTO kit_boxes (name) VALUES (?)', ['Box']);
    await db.runAsync(
      'INSERT INTO app_settings (key, value) VALUES (?, ?)'
      + ' ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      ['default_kit_box_id', String(kitRes.lastInsertRowId)]
    );
  }

  // 塗料ボックスと同じ理由で自己修復する。
  await ensureDefaultBox(db, 'default_kit_box_id', 'kit_boxes');

  // この仕様導入前に完成(completed)になっていたキットのbox_idを一度だけクリアする。
  // 塗料の使用済み(used_up)がボックスから外れているのと同じ扱いにするため。
  await db.runAsync("UPDATE kits SET box_id = NULL WHERE status = 'completed'");

  // シードバージョンが古い端末は catalog_paints をシードの内容へ更新。
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const current = row?.user_version ?? 0;
  if (current < SEED_VERSION) {
    await upsertCatalogFromSeed(db);
    await db.execAsync(`PRAGMA user_version = ${SEED_VERSION}`);
  }
}

// デフォルトボックス設定が有効な行を指すようにする。未設定、または削除済みの行を
// 指している場合に先頭のボックスへ寄せる。ボックスが1件も無い場合は何もしない。
// table は内部で決め打ちした識別子のみを渡す(SQLへ値として埋め込めないため)。
async function ensureDefaultBox(
  db: SQLite.SQLiteDatabase,
  key: 'default_box_id' | 'default_kit_box_id',
  table: 'boxes' | 'kit_boxes'
): Promise<void> {
  const current = await db.getFirstAsync<{ value: string }>(
    'SELECT value FROM app_settings WHERE key = ?', [key]
  );
  if (current?.value) {
    const exists = await db.getFirstAsync<{ id: number }>(
      `SELECT id FROM ${table} WHERE id = ?`, [Number(current.value)]
    );
    if (exists) return;
  }
  const first = await db.getFirstAsync<{ id: number }>(
    `SELECT id FROM ${table} ORDER BY sort_order, id LIMIT 1`
  );
  if (!first) return;
  await db.runAsync(
    'INSERT INTO app_settings (key, value) VALUES (?, ?)'
    + ' ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    [key, String(first.id)]
  );
}
