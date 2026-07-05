import { AppState, AppStateStatus } from 'react-native';
import auth from '@react-native-firebase/auth';
import firestore from '@react-native-firebase/firestore';
import { catalogCode, getDB, getSetting, PaintStatus, setSetting } from './db';

const BACKUP_SCHEMA_VERSION = 1;
const LAST_BACKUP_AT_KEY = 'last_backup_at';

interface BoxRow {
  id: number;
  name: string;
  location: string | null;
  note: string | null;
}

interface PaintRow {
  id: number;
  catalog_code: string | null;
  brand: string;
  series: string;
  series_en: string | null;
  code: string;
  name_ja: string;
  name_en: string | null;
  hex: string | null;
  r: number | null;
  g: number | null;
  b: number | null;
  l: number | null;
  a_star: number | null;
  b_star: number | null;
  barcode: string | null;
  gloss: string | null;
  paint_type: string | null;
  notes: string | null;
}

interface InventoryRow {
  catalog_code: string | null;
  brand: string;
  series: string;
  code: string;
  box_id: number | null;
  status: PaintStatus;
  note: string | null;
  added_at: string | null;
  status_changed_at: string | null;
}

interface ListRow {
  catalog_code: string | null;
  brand: string;
  series: string;
  code: string;
  type: 'favorites' | 'wishlist';
  note: string | null;
  added_at: string | null;
}

export interface BackupBox {
  localRef: string;
  name: string;
  location: string | null;
  note: string | null;
}

export interface BackupPaint {
  catalog_code: string;
  brand: string;
  series: string;
  series_en: string | null;
  code: string;
  name_ja: string;
  name_en: string | null;
  hex: string | null;
  r: number | null;
  g: number | null;
  b: number | null;
  l: number | null;
  a_star: number | null;
  b_star: number | null;
  barcode: string | null;
  gloss: string | null;
  paint_type: string | null;
  notes: string | null;
}

export interface BackupPaintNote {
  catalog_code: string;
  notes: string;
}

export interface BackupInventory {
  catalog_code: string;
  boxLocalRef: string | null;
  status: PaintStatus;
  note: string | null;
  added_at: string | null;
  status_changed_at: string | null;
}

export interface BackupListItem {
  catalog_code: string;
  note: string | null;
  added_at: string | null;
}

export interface BackupSnapshot {
  schemaVersion: number;
  updatedAt?: unknown;
  boxes: BackupBox[];
  manualPaints: BackupPaint[];
  officialPaintNotes: BackupPaintNote[];
  inventory: BackupInventory[];
  favorites: BackupListItem[];
  wishlist: BackupListItem[];
  defaultBoxLocalRef: string | null;
}

function paintCatalogCode(row: { catalog_code: string | null; brand: string; series: string; code: string }): string {
  return row.catalog_code ?? catalogCode(row.brand, row.series, row.code);
}

function boxLocalRef(id: number): string {
  return `box_${id}`;
}

async function resolvePaintId(catalog_code: string): Promise<number | null> {
  const row = await getDB().getFirstAsync<{ id: number }>(
    'SELECT id FROM catalog_paints WHERE catalog_code = ?',
    [catalog_code]
  );
  return row?.id ?? null;
}

export async function isLocalDbEmpty(): Promise<boolean> {
  const row = await getDB().getFirstAsync<{ n: number }>(
    "SELECT (SELECT COUNT(*) FROM inventory) + (SELECT COUNT(*) FROM lists) + (SELECT COUNT(*) FROM catalog_paints WHERE source = 'manual') AS n"
  );
  return (row?.n ?? 0) === 0;
}

export async function buildBackupSnapshot(): Promise<BackupSnapshot> {
  const db = getDB();
  const boxes = await db.getAllAsync<BoxRow>('SELECT id, name, location, note FROM boxes ORDER BY id');
  const manualPaintRows = await db.getAllAsync<PaintRow>(
    "SELECT id, catalog_code, brand, series, series_en, code, name_ja, name_en, hex, r, g, b, l, a_star, b_star, barcode, gloss, paint_type, notes FROM catalog_paints WHERE source = 'manual' ORDER BY id"
  );
  const officialPaintNoteRows = await db.getAllAsync<{ catalog_code: string | null; brand: string; series: string; code: string; notes: string }>(
    "SELECT catalog_code, brand, series, code, notes FROM catalog_paints WHERE source = 'catalog' AND notes IS NOT NULL AND notes <> '' ORDER BY id"
  );
  const inventoryRows = await db.getAllAsync<InventoryRow>(
    'SELECT c.catalog_code, c.brand, c.series, c.code, i.box_id, i.status, i.note, i.added_at, i.status_changed_at' +
    ' FROM inventory i JOIN catalog_paints c ON i.paint_id = c.id ORDER BY i.id'
  );
  const listRows = await db.getAllAsync<ListRow>(
    "SELECT c.catalog_code, c.brand, c.series, c.code, l.type, l.note, l.added_at" +
    " FROM lists l JOIN catalog_paints c ON l.paint_id = c.id WHERE l.type IN ('favorites','wishlist') ORDER BY l.id"
  );
  const defaultBoxId = await getSetting('default_box_id');
  const defaultBoxExists = defaultBoxId ? boxes.some((b) => b.id === Number(defaultBoxId)) : false;

  return {
    schemaVersion: BACKUP_SCHEMA_VERSION,
    boxes: boxes.map((b) => ({ localRef: boxLocalRef(b.id), name: b.name, location: b.location, note: b.note })),
    manualPaints: manualPaintRows.map((p) => ({
      catalog_code: paintCatalogCode(p),
      brand: p.brand,
      series: p.series,
      series_en: p.series_en,
      code: p.code,
      name_ja: p.name_ja,
      name_en: p.name_en,
      hex: p.hex,
      r: p.r,
      g: p.g,
      b: p.b,
      l: p.l,
      a_star: p.a_star,
      b_star: p.b_star,
      barcode: p.barcode,
      gloss: p.gloss,
      paint_type: p.paint_type,
      notes: p.notes,
    })),
    officialPaintNotes: officialPaintNoteRows.map((p) => ({ catalog_code: paintCatalogCode(p), notes: p.notes })),
    inventory: inventoryRows.map((i) => ({
      catalog_code: paintCatalogCode(i),
      boxLocalRef: i.box_id ? boxLocalRef(i.box_id) : null,
      status: i.status,
      note: i.note,
      added_at: i.added_at,
      status_changed_at: i.status_changed_at,
    })),
    favorites: listRows
      .filter((l) => l.type === 'favorites')
      .map((l) => ({ catalog_code: paintCatalogCode(l), note: l.note, added_at: l.added_at })),
    wishlist: listRows
      .filter((l) => l.type === 'wishlist')
      .map((l) => ({ catalog_code: paintCatalogCode(l), note: l.note, added_at: l.added_at })),
    defaultBoxLocalRef: defaultBoxExists && defaultBoxId ? boxLocalRef(Number(defaultBoxId)) : null,
  };
}

export async function pushBackupToFirestore(): Promise<void> {
  const user = auth().currentUser;
  if (!user) return;

  const snapshot = await buildBackupSnapshot();
  const now = new Date().toISOString();
  await firestore().collection('backups').doc(user.uid).set({
    ...snapshot,
    updatedAt: firestore.FieldValue.serverTimestamp(),
  });
  await setSetting(LAST_BACKUP_AT_KEY, now);
}

export async function fetchBackupSnapshot(): Promise<BackupSnapshot | null> {
  const user = auth().currentUser;
  if (!user) return null;

  const doc = await firestore().collection('backups').doc(user.uid).get();
  if (!doc.exists()) return null;
  return doc.data() as BackupSnapshot;
}

export async function restoreFromSnapshot(snapshot: BackupSnapshot): Promise<void> {
  const db = getDB();

  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM inventory');
    await db.runAsync('DELETE FROM lists');
    await db.runAsync("DELETE FROM catalog_paints WHERE source = 'manual'");
    await db.runAsync("UPDATE catalog_paints SET notes = NULL WHERE source = 'catalog'");

    for (const p of snapshot.manualPaints ?? []) {
      await db.runAsync(
        'INSERT INTO catalog_paints' +
        ' (catalog_code, brand, series, series_en, code, name_ja, name_en, hex, r, g, b, l, a_star, b_star, barcode, gloss, paint_type, source, notes)' +
        ' VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)' +
        ' ON CONFLICT(catalog_code) DO UPDATE SET' +
        '  brand=excluded.brand, series=excluded.series, series_en=excluded.series_en, code=excluded.code,' +
        '  name_ja=excluded.name_ja, name_en=excluded.name_en, hex=excluded.hex,' +
        '  r=excluded.r, g=excluded.g, b=excluded.b, l=excluded.l, a_star=excluded.a_star, b_star=excluded.b_star,' +
        '  barcode=excluded.barcode, gloss=excluded.gloss, paint_type=excluded.paint_type, source=excluded.source, notes=excluded.notes',
        [
          p.catalog_code, p.brand, p.series, p.series_en, p.code, p.name_ja, p.name_en, p.hex,
          p.r, p.g, p.b, p.l, p.a_star, p.b_star, p.barcode, p.gloss, p.paint_type, 'manual', p.notes,
        ]
      );
    }

    for (const note of snapshot.officialPaintNotes ?? []) {
      const paintId = await resolvePaintId(note.catalog_code);
      if (!paintId) {
        console.warn('restoreFromSnapshot: skipping official note for missing catalog_code', note.catalog_code);
        continue;
      }
      await db.runAsync('UPDATE catalog_paints SET notes = ? WHERE id = ?', [note.notes, paintId]);
    }

    await db.runAsync('DELETE FROM boxes WHERE id NOT IN (SELECT DISTINCT box_id FROM inventory WHERE box_id IS NOT NULL)');
    const boxIdByLocalRef = new Map<string, number>();
    for (const box of snapshot.boxes ?? []) {
      const result = await db.runAsync(
        'INSERT INTO boxes (name, location, note) VALUES (?, ?, ?)',
        [box.name, box.location, box.note]
      );
      boxIdByLocalRef.set(box.localRef, result.lastInsertRowId);
    }

    for (const item of snapshot.inventory ?? []) {
      const paintId = await resolvePaintId(item.catalog_code);
      if (!paintId) {
        console.warn('restoreFromSnapshot: skipping inventory for missing catalog_code', item.catalog_code);
        continue;
      }
      const boxId = item.boxLocalRef ? boxIdByLocalRef.get(item.boxLocalRef) ?? null : null;
      await db.runAsync(
        'INSERT INTO inventory (paint_id, box_id, status, note, added_at, status_changed_at) VALUES (?, ?, ?, ?, ?, ?)',
        [paintId, boxId, item.status, item.note, item.added_at, item.status_changed_at]
      );
    }

    for (const item of snapshot.favorites ?? []) {
      const paintId = await resolvePaintId(item.catalog_code);
      if (!paintId) {
        console.warn('restoreFromSnapshot: skipping favorite for missing catalog_code', item.catalog_code);
        continue;
      }
      await db.runAsync(
        "INSERT INTO lists (name, type, paint_id, note, added_at) VALUES (NULL, 'favorites', ?, ?, ?)",
        [paintId, item.note, item.added_at]
      );
    }

    for (const item of snapshot.wishlist ?? []) {
      const paintId = await resolvePaintId(item.catalog_code);
      if (!paintId) {
        console.warn('restoreFromSnapshot: skipping wishlist for missing catalog_code', item.catalog_code);
        continue;
      }
      await db.runAsync(
        "INSERT INTO lists (name, type, paint_id, note, added_at) VALUES (NULL, 'wishlist', ?, ?, ?)",
        [paintId, item.note, item.added_at]
      );
    }

    const defaultBoxId = snapshot.defaultBoxLocalRef ? boxIdByLocalRef.get(snapshot.defaultBoxLocalRef) ?? null : null;
    if (defaultBoxId) {
      await db.runAsync(
        'INSERT INTO app_settings (key, value) VALUES (?, ?)' +
        ' ON CONFLICT(key) DO UPDATE SET value = excluded.value',
        ['default_box_id', String(defaultBoxId)]
      );
    }
  });
}

let autoBackupInitialized = false;
let lastAppState: AppStateStatus = AppState.currentState;

export function initAutoBackup(): void {
  if (autoBackupInitialized) return;
  autoBackupInitialized = true;
  AppState.addEventListener('change', (nextState) => {
    const shouldBackup = lastAppState === 'active' && (nextState === 'background' || nextState === 'inactive');
    lastAppState = nextState;
    if (!shouldBackup) return;

    pushBackupToFirestore().catch((e) => console.error('initAutoBackup: failed to push backup', e));
  });
}

export async function runRestoreDecision(): Promise<'restored' | 'conflict' | 'none'> {
  const snapshot = await fetchBackupSnapshot();
  if (!snapshot) return 'none';
  if (await isLocalDbEmpty()) {
    await restoreFromSnapshot(snapshot);
    return 'restored';
  }
  return 'conflict';
}

