import { AppState, AppStateStatus } from 'react-native';
import Constants from 'expo-constants';
import { catalogCode, getDB, getSetting, KitStatus, PaintStatus, setSetting } from './db';
import { deleteKitPhoto } from './kitPhoto';
import { BackupKitPhoto, downloadKitPhotosForRestore, kitPhotoStoragePath, uploadPendingKitPhotos } from './kitPhotoBackup';
import { getEntitlements } from './subscription';

const isExpoGo = Constants.appOwnership === 'expo';

// Expo Goのバイナリにはネイティブモジュールが含まれないため、
// import(=require)時点でクラッシュする。mobileAds.native.tsと同じパターンで
// Expo Go実行時はrequireせずnullにフォールバックする。
const auth: typeof import('@react-native-firebase/auth').default | null = isExpoGo
  ? null
  : (require('@react-native-firebase/auth').default as typeof import('@react-native-firebase/auth').default);
const firestore: typeof import('@react-native-firebase/firestore').default | null = isExpoGo
  ? null
  : (require('@react-native-firebase/firestore').default as typeof import('@react-native-firebase/firestore').default);

// v2: kit_boxes/kits/kit_colors/kit_color_paints(キット管理機能)を追加。
// v3: kitPhotos(スタンダードプラン限定のキット写真)を追加。
// v1/v2スナップショットにはこれらのフィールドが無いため、復元側は `?? []` で
// optional に扱い、無い部分が空のまま復元されても壊れないようにする。
const BACKUP_SCHEMA_VERSION = 3;
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

interface KitBoxRow {
  id: number;
  name: string;
  icon: string;
  icon_color: string;
  sort_order: number;
}

interface KitRow {
  id: number;
  box_id: number | null;
  name: string;
  maker: string;
  series: string | null;
  category: string | null;
  scale: string | null;
  note: string | null;
  price: number | null;
  status: KitStatus;
  added_at: string | null;
  status_changed_at: string | null;
}

interface KitColorRow {
  id: number;
  kit_id: number;
  name: string | null;
  note: string | null;
  sort_order: number;
  added_at: string | null;
}

interface KitColorPaintRow {
  kit_color_id: number;
  catalog_code: string | null;
  brand: string;
  series: string;
  code: string;
  ratio: number;
  sort_order: number;
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

export interface BackupKitBox {
  localRef: string;
  name: string;
  icon: string;
  icon_color: string;
  sort_order: number;
}

export interface BackupKit {
  localRef: string;
  kitBoxLocalRef: string | null;
  name: string;
  maker: string;
  series: string | null;
  category: string | null;
  scale: string | null;
  note: string | null;
  price: number | null;
  status: KitStatus;
  added_at: string | null;
  status_changed_at: string | null;
}

export interface BackupKitColor {
  localRef: string;
  kitLocalRef: string;
  name: string | null;
  note: string | null;
  sort_order: number;
  added_at: string | null;
}

export interface BackupKitColorPaint {
  kitColorLocalRef: string;
  catalog_code: string;
  ratio: number;
  sort_order: number;
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
  // v2で追加。v1スナップショットには存在しないため optional。
  kitBoxes?: BackupKitBox[];
  kits?: BackupKit[];
  kitColors?: BackupKitColor[];
  kitColorPaints?: BackupKitColorPaint[];
  defaultKitBoxLocalRef?: string | null;
  // v3で追加。スタンダードプラン(hasPhotoBackup)加入者のみ書き込まれる。
  kitPhotos?: BackupKitPhoto[];
}

function paintCatalogCode(row: { catalog_code: string | null; brand: string; series: string; code: string }): string {
  return row.catalog_code ?? catalogCode(row.brand, row.series, row.code);
}

function boxLocalRef(id: number): string {
  return `box_${id}`;
}

// 塗料ボックスの box_<id> と衝突しない接頭辞にする(別体系のため)。
function kitBoxLocalRef(id: number): string {
  return `kitbox_${id}`;
}

function kitLocalRef(id: number): string {
  return `kit_${id}`;
}

function kitColorLocalRef(id: number): string {
  return `kitcolor_${id}`;
}

async function resolvePaintId(catalog_code: string): Promise<number | null> {
  const row = await getDB().getFirstAsync<{ id: number }>(
    'SELECT id FROM catalog_paints WHERE catalog_code = ?',
    [catalog_code]
  );
  return row?.id ?? null;
}

export async function isLocalDbEmpty(): Promise<boolean> {
  // boxes/kit_boxes は initDB() が0件の時に「Box」を1件自動作成するため、
  // 単純な COUNT(*) では常に1以上になり判定が壊れる。ユーザーが実際に
  // 追加ボックスを作っている(2件以上)場合だけ「空ではない」とみなす。
  const row = await getDB().getFirstAsync<{ n: number }>(
    "SELECT (SELECT COUNT(*) FROM inventory)" +
    " + (SELECT COUNT(*) FROM lists)" +
    " + (SELECT COUNT(*) FROM catalog_paints WHERE source = 'manual')" +
    " + (SELECT COUNT(*) FROM catalog_paints WHERE source = 'catalog' AND notes IS NOT NULL AND notes <> '')" +
    " + (SELECT COUNT(*) FROM kits)" +
    " + (SELECT CASE WHEN (SELECT COUNT(*) FROM boxes) > 1 THEN 1 ELSE 0 END)" +
    " + (SELECT CASE WHEN (SELECT COUNT(*) FROM kit_boxes) > 1 THEN 1 ELSE 0 END)" +
    " AS n"
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

  const kitBoxRows = await db.getAllAsync<KitBoxRow>('SELECT id, name, icon, icon_color, sort_order FROM kit_boxes ORDER BY sort_order, id');
  const kitRows = await db.getAllAsync<KitRow>(
    'SELECT id, box_id, name, maker, series, category, scale, note, price, status, added_at, status_changed_at FROM kits ORDER BY id'
  );
  const kitColorRows = await db.getAllAsync<KitColorRow>('SELECT id, kit_id, name, note, sort_order, added_at FROM kit_colors ORDER BY sort_order, id');
  const kitColorPaintRows = await db.getAllAsync<KitColorPaintRow>(
    'SELECT kcp.kit_color_id, c.catalog_code, c.brand, c.series, c.code, kcp.ratio, kcp.sort_order' +
    ' FROM kit_color_paints kcp JOIN catalog_paints c ON kcp.paint_id = c.id ORDER BY kcp.sort_order, kcp.id'
  );
  const defaultKitBoxId = await getSetting('default_kit_box_id');
  const defaultKitBoxExists = defaultKitBoxId ? kitBoxRows.some((b) => b.id === Number(defaultKitBoxId)) : false;

  // アップロード済み(synced_at確定済み)の写真だけをスナップショットに含める。
  // アップロード前の行を含めるとStorage側に実体が無いパスを参照してしまい、
  // 復元時のダウンロードが失敗する。
  const uid = auth?.().currentUser?.uid ?? null;
  const kitPhotoRows = uid && getEntitlements().hasPhotoBackup
    ? await db.getAllAsync<{ kit_id: number; uri: string; sort_order: number }>(
        'SELECT kit_id, uri, sort_order FROM kit_photos WHERE synced_at IS NOT NULL ORDER BY sort_order, id'
      )
    : [];

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
    kitBoxes: kitBoxRows.map((b) => ({ localRef: kitBoxLocalRef(b.id), name: b.name, icon: b.icon, icon_color: b.icon_color, sort_order: b.sort_order })),
    kits: kitRows.map((k) => ({
      localRef: kitLocalRef(k.id),
      kitBoxLocalRef: k.box_id ? kitBoxLocalRef(k.box_id) : null,
      name: k.name,
      maker: k.maker,
      series: k.series,
      category: k.category,
      scale: k.scale,
      note: k.note,
      price: k.price,
      status: k.status,
      added_at: k.added_at,
      status_changed_at: k.status_changed_at,
    })),
    kitColors: kitColorRows.map((c) => ({
      localRef: kitColorLocalRef(c.id),
      kitLocalRef: kitLocalRef(c.kit_id),
      name: c.name,
      note: c.note,
      sort_order: c.sort_order,
      added_at: c.added_at,
    })),
    kitColorPaints: kitColorPaintRows.map((cp) => ({
      kitColorLocalRef: kitColorLocalRef(cp.kit_color_id),
      catalog_code: paintCatalogCode(cp),
      ratio: cp.ratio,
      sort_order: cp.sort_order,
    })),
    defaultKitBoxLocalRef: defaultKitBoxExists && defaultKitBoxId ? kitBoxLocalRef(Number(defaultKitBoxId)) : null,
    // v3: hasPhotoBackup(スタンダードプラン)加入者のみ、アップロード済みの
    // キット写真をStorageパス参照として含める。ライトプラン/未加入時は空配列。
    kitPhotos: uid
      ? kitPhotoRows
          .map((p) => {
            const storagePath = kitPhotoStoragePath(uid, p.uri);
            return storagePath ? { kitLocalRef: kitLocalRef(p.kit_id), storagePath, sort_order: p.sort_order } : null;
          })
          .filter((p): p is BackupKitPhoto => p !== null)
      : [],
  };
}

// 連打やバックグラウンド/フォアグラウンドの素早い切り替えで複数の push が
// 同時に走ると、後から完了した方が新しい内容を古い内容で上書きしかねない。
// 実行中は同じ Promise を返して重複起動を防ぐ。
let pushInFlight: Promise<void> | null = null;

export async function pushBackupToFirestore(): Promise<void> {
  if (!auth || !firestore) return;
  if (!getEntitlements().hasBackup) return;
  if (pushInFlight) return pushInFlight;

  const user = auth().currentUser;
  if (!user) return;

  pushInFlight = (async () => {
    if (getEntitlements().hasPhotoBackup) {
      await uploadPendingKitPhotos().catch((e) => console.error('pushBackupToFirestore: failed to upload kit photos', e));
    }
    const snapshot = await buildBackupSnapshot();
    const now = new Date().toISOString();
    await firestore!().collection('backups').doc(user.uid).set({
      ...snapshot,
      updatedAt: firestore!.FieldValue.serverTimestamp(),
    });
    await setSetting(LAST_BACKUP_AT_KEY, now);
  })();

  try {
    await pushInFlight;
  } finally {
    pushInFlight = null;
  }
}

export async function fetchBackupSnapshot(): Promise<BackupSnapshot | null> {
  if (!auth || !firestore) return null;
  const user = auth().currentUser;
  if (!user) return null;

  const doc = await firestore().collection('backups').doc(user.uid).get();
  if (!doc.exists()) return null;
  return doc.data() as BackupSnapshot;
}

export async function restoreFromSnapshot(snapshot: BackupSnapshot): Promise<void> {
  const db = getDB();
  let orphanedKitPhotoUris: string[] = [];
  const kitIdByLocalRef = new Map<string, number>();

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

    // キット関連は塗料ボックスと独立した体系のため、常に全消去して再構築する
    // (settings.tsx の resetKits() と同じ完全リセット方式)。kit_photos は
    // バックアップ対象外だが、古い写真ファイルが端末に残り続けないよう
    // ここで削除する(実ファイル削除はトランザクション外で行う)。
    orphanedKitPhotoUris = (await db.getAllAsync<{ uri: string }>('SELECT uri FROM kit_photos')).map((r) => r.uri);
    await db.runAsync('DELETE FROM kit_color_paints');
    await db.runAsync('DELETE FROM kit_colors');
    await db.runAsync('DELETE FROM kit_photos');
    await db.runAsync('DELETE FROM kits');
    await db.runAsync('DELETE FROM kit_boxes');

    const kitBoxIdByLocalRef = new Map<string, number>();
    for (const box of snapshot.kitBoxes ?? []) {
      const result = await db.runAsync(
        'INSERT INTO kit_boxes (name, icon, icon_color, sort_order) VALUES (?, ?, ?, ?)',
        [box.name, box.icon, box.icon_color, box.sort_order]
      );
      kitBoxIdByLocalRef.set(box.localRef, result.lastInsertRowId);
    }

    for (const kit of snapshot.kits ?? []) {
      const kitBoxId = kit.kitBoxLocalRef ? kitBoxIdByLocalRef.get(kit.kitBoxLocalRef) ?? null : null;
      const result = await db.runAsync(
        'INSERT INTO kits (box_id, name, maker, series, category, scale, note, price, status, added_at, status_changed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [kitBoxId, kit.name, kit.maker, kit.series, kit.category, kit.scale, kit.note, kit.price, kit.status, kit.added_at, kit.status_changed_at]
      );
      kitIdByLocalRef.set(kit.localRef, result.lastInsertRowId);
    }

    const kitColorIdByLocalRef = new Map<string, number>();
    for (const color of snapshot.kitColors ?? []) {
      const kitId = kitIdByLocalRef.get(color.kitLocalRef);
      if (!kitId) {
        console.warn('restoreFromSnapshot: skipping kit color for missing kit', color.kitLocalRef);
        continue;
      }
      const result = await db.runAsync(
        'INSERT INTO kit_colors (kit_id, name, note, sort_order, added_at) VALUES (?, ?, ?, ?, ?)',
        [kitId, color.name, color.note, color.sort_order, color.added_at]
      );
      kitColorIdByLocalRef.set(color.localRef, result.lastInsertRowId);
    }

    for (const cp of snapshot.kitColorPaints ?? []) {
      const kitColorId = kitColorIdByLocalRef.get(cp.kitColorLocalRef);
      const paintId = await resolvePaintId(cp.catalog_code);
      if (!kitColorId || !paintId) {
        console.warn('restoreFromSnapshot: skipping kit color paint for missing kit color or catalog_code', cp.kitColorLocalRef, cp.catalog_code);
        continue;
      }
      await db.runAsync(
        'INSERT INTO kit_color_paints (kit_color_id, paint_id, ratio, sort_order) VALUES (?, ?, ?, ?)',
        [kitColorId, paintId, cp.ratio, cp.sort_order]
      );
    }

    const defaultKitBoxId = snapshot.defaultKitBoxLocalRef ? kitBoxIdByLocalRef.get(snapshot.defaultKitBoxLocalRef) ?? null : null;
    if (defaultKitBoxId) {
      await db.runAsync(
        'INSERT INTO app_settings (key, value) VALUES (?, ?)' +
        ' ON CONFLICT(key) DO UPDATE SET value = excluded.value',
        ['default_kit_box_id', String(defaultKitBoxId)]
      );
    }
  });

  // 写真ファイルの実削除はベストエフォート。DB行は既にトランザクション内で
  // 削除済みのため、1件の削除失敗で残り全部を諦めない(ログだけ残して続行)。
  for (const uri of orphanedKitPhotoUris) {
    try {
      await deleteKitPhoto(uri);
    } catch (e) {
      console.error('restoreFromSnapshot: failed to delete orphaned kit photo', uri, e);
    }
  }

  // キット写真のダウンロードはネットワークI/Oのため、SQLiteトランザクションの
  // 外で行う。ダウンロード成功分だけkit_photos行を再構築する(ベストエフォート)。
  if (getEntitlements().hasPhotoBackup && (snapshot.kitPhotos?.length ?? 0) > 0) {
    const localUriByStoragePath = await downloadKitPhotosForRestore(snapshot.kitPhotos ?? []);
    for (const photo of snapshot.kitPhotos ?? []) {
      const kitId = kitIdByLocalRef.get(photo.kitLocalRef);
      const localUri = localUriByStoragePath.get(photo.storagePath);
      if (!kitId || !localUri) {
        console.warn('restoreFromSnapshot: skipping kit photo for missing kit or failed download', photo.kitLocalRef, photo.storagePath);
        continue;
      }
      try {
        await db.runAsync(
          "INSERT INTO kit_photos (kit_id, uri, sort_order, synced_at) VALUES (?, ?, ?, datetime('now'))",
          [kitId, localUri, photo.sort_order]
        );
      } catch (e) {
        console.error('restoreFromSnapshot: failed to insert restored kit photo', photo.storagePath, e);
      }
    }
  }
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
  if (!getEntitlements().hasBackup) return 'none';
  const snapshot = await fetchBackupSnapshot();
  if (!snapshot) return 'none';
  if (await isLocalDbEmpty()) {
    await restoreFromSnapshot(snapshot);
    return 'restored';
  }
  return 'conflict';
}

