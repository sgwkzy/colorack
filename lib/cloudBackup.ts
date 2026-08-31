import { AppState, AppStateStatus } from 'react-native';
import Constants from 'expo-constants';
import { catalogCode, getDB, getSetting, KitStatus, PaintStatus, setSetting } from './db';
import { deleteKitPhoto } from './kitPhoto';
import { BackupKitPhoto, downloadKitPhotosForRestore, uploadPendingKitPhotos } from './kitPhotoBackup';
import { getEntitlements } from './subscription';
import { withFreshFirebaseTokenRetry } from './auth';
import { runAccountOperation } from './accountOperation';

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
// v4: mix_recipes/mix_recipe_paints(保存した色レシピ)を追加。
// v5: kit_wishlist(購入候補)を追加。
// v6: kit_wishlist_photos(購入候補の写真)を追加。
// v1/v2スナップショットにはこれらのフィールドが無いため、復元側は `?? []` で
// optional に扱い、無い部分が空のまま復元されても壊れないようにする。
const BACKUP_SCHEMA_VERSION = 6;
const LAST_BACKUP_AT_KEY = 'last_backup_at';
const LAST_BACKUP_AT_UID_KEY = 'last_backup_at_uid';
const BACKUP_READY_UID_KEY = 'cloud_backup_ready_uid';
const LOCAL_DATA_OWNER_UID_KEY = 'cloud_backup_data_owner_uid';

function assertCurrentUser(expectedUid: string): void {
  if (auth?.().currentUser?.uid !== expectedUid) {
    throw new Error('Firebase user changed during cloud backup operation.');
  }
}

async function getLocalDataOwnerUid(): Promise<string | null> {
  return await getSetting(LOCAL_DATA_OWNER_UID_KEY)
    ?? await getSetting(BACKUP_READY_UID_KEY);
}

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

interface KitWishlistRow {
  id: number;
  name: string;
  maker: string;
  series: string | null;
  category: string | null;
  scale: string | null;
  note: string | null;
  price: number | null;
  added_at: string | null;
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

interface MixRecipeRow {
  id: number;
  name: string | null;
  note: string | null;
  sort_order: number;
  added_at: string | null;
  updated_at: string | null;
}

interface MixRecipePaintRow {
  mix_recipe_id: number;
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

export type BackupKitWishlistItem = Omit<KitWishlistRow, 'id'> & { localRef: string };

export interface BackupKitWishlistPhoto {
  wishlistLocalRef: string;
  storagePath: string;
  sort_order: number;
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

export interface BackupMixRecipe {
  localRef: string;
  name: string | null;
  note: string | null;
  sort_order: number;
  added_at: string | null;
  updated_at: string | null;
}

export interface BackupMixRecipePaint {
  mixRecipeLocalRef: string;
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
  // v4で追加。旧スナップショットには存在しないため optional。
  mixRecipes?: BackupMixRecipe[];
  mixRecipePaints?: BackupMixRecipePaint[];
  // v5で追加。旧スナップショットには存在しないため optional。
  kitWishlist?: BackupKitWishlistItem[];
  // v6で追加。旧スナップショットには存在しないため optional。
  kitWishlistPhotos?: BackupKitWishlistPhoto[];
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

function kitWishlistLocalRef(id: number): string {
  return `kit_wishlist_${id}`;
}

function kitColorLocalRef(id: number): string {
  return `kitcolor_${id}`;
}

function mixRecipeLocalRef(id: number): string {
  return 'mixrecipe_' + id;
}

async function resolvePaintId(catalog_code: string, database = getDB()): Promise<number | null> {
  const row = await database.getFirstAsync<{ id: number }>(
    'SELECT id FROM catalog_paints WHERE catalog_code = ?',
    [catalog_code]
  );
  return row?.id ?? null;
}

export async function isLocalDbEmpty(): Promise<boolean> {
  // boxes/kit_boxes は initDB() が0件の時に「Box」を1件自動作成するため、
  // 単純な COUNT(*) では常に1以上になり判定が壊れる。一方、初期ボックスを
  // 名前変更・メモ追加・並べ替えした場合は、1件でもユーザーデータとして扱う。
  const row = await getDB().getFirstAsync<{ n: number }>(
    "SELECT (SELECT COUNT(*) FROM inventory)" +
    " + (SELECT COUNT(*) FROM lists)" +
    " + (SELECT COUNT(*) FROM catalog_paints WHERE source = 'manual')" +
    " + (SELECT COUNT(*) FROM catalog_paints WHERE source = 'catalog' AND notes IS NOT NULL AND notes <> '')" +
    " + (SELECT COUNT(*) FROM kits)" +
    " + (SELECT COUNT(*) FROM kit_wishlist)" +
    " + (SELECT COUNT(*) FROM mix_recipes)" +
    " + (SELECT CASE WHEN (SELECT COUNT(*) FROM boxes) > 1 OR EXISTS (" +
    "SELECT 1 FROM boxes WHERE id = (SELECT CAST(value AS INTEGER) FROM app_settings WHERE key = 'default_box_id')" +
    " AND (name <> 'Box' OR location IS NOT NULL OR note IS NOT NULL OR icon <> 'box' OR icon_color <> '#4a90d9')" +
    ") THEN 1 ELSE 0 END)" +
    " + (SELECT CASE WHEN (SELECT COUNT(*) FROM kit_boxes) > 1 OR EXISTS (" +
    "SELECT 1 FROM kit_boxes WHERE id = (SELECT CAST(value AS INTEGER) FROM app_settings WHERE key = 'default_kit_box_id')" +
    " AND (name <> 'Box' OR icon <> 'box' OR icon_color <> '#4a90d9')" +
    ") THEN 1 ELSE 0 END)" +
    " AS n"
  );
  return (row?.n ?? 0) === 0;
}

export async function buildBackupSnapshot(): Promise<BackupSnapshot> {
  const db = getDB();
  const uid = auth?.().currentUser?.uid ?? null;
  const hasPhotoBackup = !!uid && getEntitlements().hasPhotoBackup;
  let boxes!: BoxRow[];
  let manualPaintRows!: PaintRow[];
  let officialPaintNoteRows!: { catalog_code: string | null; brand: string; series: string; code: string; notes: string }[];
  let inventoryRows!: InventoryRow[];
  let listRows!: ListRow[];
  let defaultBoxId: string | null = null;
  let kitBoxRows!: KitBoxRow[];
  let kitRows!: KitRow[];
  let kitWishlistRows!: KitWishlistRow[];
  let kitColorRows!: KitColorRow[];
  let kitColorPaintRows!: KitColorPaintRow[];
  let mixRecipeRows!: MixRecipeRow[];
  let mixRecipePaintRows!: MixRecipePaintRow[];
  let defaultKitBoxId: string | null = null;
  let kitPhotoRows: { kit_id: number; storage_path: string; sort_order: number }[] = [];
  let kitWishlistPhotoRows: { wishlist_id: number; storage_path: string; sort_order: number }[] = [];

  await db.withExclusiveTransactionAsync(async (tx) => {
    boxes = await tx.getAllAsync<BoxRow>('SELECT id, name, location, note FROM boxes ORDER BY id');
    manualPaintRows = await tx.getAllAsync<PaintRow>(
      "SELECT id, catalog_code, brand, series, series_en, code, name_ja, name_en, hex, r, g, b, l, a_star, b_star, barcode, gloss, paint_type, notes FROM catalog_paints WHERE source = 'manual' ORDER BY id"
    );
    officialPaintNoteRows = await tx.getAllAsync<{ catalog_code: string | null; brand: string; series: string; code: string; notes: string }>(
      "SELECT catalog_code, brand, series, code, notes FROM catalog_paints WHERE source = 'catalog' AND notes IS NOT NULL AND notes <> '' ORDER BY id"
    );
    inventoryRows = await tx.getAllAsync<InventoryRow>(
      'SELECT c.catalog_code, c.brand, c.series, c.code, i.box_id, i.status, i.note, i.added_at, i.status_changed_at' +
      ' FROM inventory i JOIN catalog_paints c ON i.paint_id = c.id ORDER BY i.id'
    );
    listRows = await tx.getAllAsync<ListRow>(
      "SELECT c.catalog_code, c.brand, c.series, c.code, l.type, l.note, l.added_at" +
      " FROM lists l JOIN catalog_paints c ON l.paint_id = c.id WHERE l.type IN ('favorites','wishlist') ORDER BY l.id"
    );
    defaultBoxId = (await tx.getFirstAsync<{ value: string }>(
      'SELECT value FROM app_settings WHERE key = ?', ['default_box_id']
    ))?.value ?? null;

    kitBoxRows = await tx.getAllAsync<KitBoxRow>('SELECT id, name, icon, icon_color, sort_order FROM kit_boxes ORDER BY sort_order, id');
    kitRows = await tx.getAllAsync<KitRow>(
      'SELECT id, box_id, name, maker, series, category, scale, note, price, status, added_at, status_changed_at FROM kits ORDER BY id'
    );
    kitWishlistRows = await tx.getAllAsync<KitWishlistRow>(
      'SELECT id, name, maker, series, category, scale, note, price, added_at FROM kit_wishlist ORDER BY id'
    );
    kitColorRows = await tx.getAllAsync<KitColorRow>('SELECT id, kit_id, name, note, sort_order, added_at FROM kit_colors ORDER BY sort_order, id');
    kitColorPaintRows = await tx.getAllAsync<KitColorPaintRow>(
      'SELECT kcp.kit_color_id, c.catalog_code, c.brand, c.series, c.code, kcp.ratio, kcp.sort_order' +
      ' FROM kit_color_paints kcp JOIN catalog_paints c ON kcp.paint_id = c.id ORDER BY kcp.sort_order, kcp.id'
    );
    mixRecipeRows = await tx.getAllAsync<MixRecipeRow>(
      'SELECT id, name, note, sort_order, added_at, updated_at FROM mix_recipes ORDER BY sort_order, id'
    );
    mixRecipePaintRows = await tx.getAllAsync<MixRecipePaintRow>(
      'SELECT mrp.mix_recipe_id, c.catalog_code, c.brand, c.series, c.code, mrp.ratio, mrp.sort_order' +
      ' FROM mix_recipe_paints mrp JOIN catalog_paints c ON mrp.paint_id = c.id ORDER BY mrp.sort_order, mrp.id'
    );
    defaultKitBoxId = (await tx.getFirstAsync<{ value: string }>(
      'SELECT value FROM app_settings WHERE key = ?', ['default_kit_box_id']
    ))?.value ?? null;

    // アップロード済み(synced_at確定済み・storage_path確定済み)の写真だけを
    // スナップショットに含める。アップロード前の行を含めるとStorage側に実体が
    // 無いパスを参照してしまい、復元時のダウンロードが失敗する。
    if (hasPhotoBackup) {
      kitPhotoRows = await tx.getAllAsync<{ kit_id: number; storage_path: string; sort_order: number }>(
        'SELECT kit_id, storage_path, sort_order FROM kit_photos WHERE synced_at IS NOT NULL AND storage_path IS NOT NULL ORDER BY sort_order, id'
      );
      kitWishlistPhotoRows = await tx.getAllAsync<{ wishlist_id: number; storage_path: string; sort_order: number }>(
        'SELECT p.wishlist_id, p.storage_path, p.sort_order FROM kit_wishlist_photos p' +
        ' JOIN kit_wishlist w ON w.id = p.wishlist_id' +
        ' WHERE p.synced_at IS NOT NULL AND p.storage_path IS NOT NULL ORDER BY p.sort_order, p.id'
      );
    }
  });

  const defaultBoxExists = defaultBoxId ? boxes.some((b) => b.id === Number(defaultBoxId)) : false;
  const defaultKitBoxExists = defaultKitBoxId ? kitBoxRows.some((b) => b.id === Number(defaultKitBoxId)) : false;

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
    mixRecipes: mixRecipeRows.map((recipe) => ({
      localRef: mixRecipeLocalRef(recipe.id),
      name: recipe.name,
      note: recipe.note,
      sort_order: recipe.sort_order,
      added_at: recipe.added_at,
      updated_at: recipe.updated_at,
    })),
    mixRecipePaints: mixRecipePaintRows.map((cp) => ({
      mixRecipeLocalRef: mixRecipeLocalRef(cp.mix_recipe_id),
      catalog_code: paintCatalogCode(cp),
      ratio: cp.ratio,
      sort_order: cp.sort_order,
    })),
    kitWishlist: kitWishlistRows.map((item) => ({
      localRef: kitWishlistLocalRef(item.id),
      name: item.name,
      maker: item.maker,
      series: item.series,
      category: item.category,
      scale: item.scale,
      note: item.note,
      price: item.price,
      added_at: item.added_at,
    })),
    defaultKitBoxLocalRef: defaultKitBoxExists && defaultKitBoxId ? kitBoxLocalRef(Number(defaultKitBoxId)) : null,
    // v3: hasPhotoBackup(スタンダードプラン)加入者のみ、アップロード済みの
    // キット写真をStorageパス参照として含める。ライトプラン/未加入時は含めない。
    // (Firestore側の既存kitPhotosを保護するため、merge: trueと併用)
    ...(hasPhotoBackup
      ? {
          kitPhotos: kitPhotoRows.map((p) => ({
            kitLocalRef: kitLocalRef(p.kit_id),
            storagePath: p.storage_path,
            sort_order: p.sort_order,
          })),
          kitWishlistPhotos: kitWishlistPhotoRows.map((p) => ({
            wishlistLocalRef: kitWishlistLocalRef(p.wishlist_id),
            storagePath: p.storage_path,
            sort_order: p.sort_order,
          })),
        }
      : {}),
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
  // 初回サインイン時の復元判定が終わる前にローカル状態をpushすると、別端末の
  // バックアップを上書きし得る。復元または「端末データを保持」が確定するまで禁止。
  if (await getSetting(BACKUP_READY_UID_KEY) !== user.uid) return;
  // 同じ端末で別のFirebaseユーザーに切り替えた場合、端末内データを
  // 新しいユーザーへ自動移送しない。明示的な引き継ぎで所有者を更新する。
  const localOwnerUid = await getLocalDataOwnerUid();
  if (localOwnerUid !== user.uid) return;

  pushInFlight = runAccountOperation(async () => {
    assertCurrentUser(user.uid);
    if (getEntitlements().hasPhotoBackup) {
      await uploadPendingKitPhotos(user.uid);
      assertCurrentUser(user.uid);
    }
    const snapshot = await buildBackupSnapshot();
    const now = new Date().toISOString();
    // merge: true を指定して、既存フィールド(特にプラン降格時の kitPhotos 参照)を保護する。
    // buildBackupSnapshot() が hasPhotoBackup=false 時に kitPhotos を含めないため、
    // set({...snapshot}, {merge: true}) により、Firestore上の既存 kitPhotos は上書きされない。
    await withFreshFirebaseTokenRetry(() =>
      firestore!().collection('backups').doc(user.uid).set({
        ...snapshot,
        updatedAt: firestore!.FieldValue.serverTimestamp(),
      }, { merge: true })
    );
    assertCurrentUser(user.uid);
    await setSetting(LAST_BACKUP_AT_KEY, now);
    await setSetting(LAST_BACKUP_AT_UID_KEY, user.uid);
  });

  try {
    await pushInFlight;
  } finally {
    pushInFlight = null;
  }
}

export async function fetchBackupSnapshot(expectedUid: string): Promise<BackupSnapshot | null> {
  if (!auth || !firestore) return null;
  const user = auth().currentUser;
  if (!user) return null;
  assertCurrentUser(expectedUid);

  const doc = await withFreshFirebaseTokenRetry(() =>
    firestore().collection('backups').doc(expectedUid).get()
  );
  if (!doc.exists()) return null;
  return doc.data() as BackupSnapshot;
}

export async function restoreFromSnapshot(snapshot: BackupSnapshot, expectedUid: string): Promise<void> {
  return runAccountOperation(() => restoreFromSnapshotUnlocked(snapshot, expectedUid));
}

async function restoreFromSnapshotUnlocked(snapshot: BackupSnapshot, expectedUid: string): Promise<void> {
  assertCurrentUser(expectedUid);
  if (!getEntitlements().hasBackup) return;
  if (!Number.isInteger(snapshot.schemaVersion)
    || snapshot.schemaVersion < 1
    || snapshot.schemaVersion > BACKUP_SCHEMA_VERSION) {
    throw new Error(`Unsupported backup schema version: ${snapshot.schemaVersion}`);
  }
  const db = getDB();
  let orphanedKitPhotoUris: string[] = [];
  const kitIdByLocalRef = new Map<string, number>();
  const kitWishlistIdByLocalRef = new Map<string, number>();
  const mixRecipeIdByLocalRef = new Map<string, number>();
  const kitPhotosToRestore = getEntitlements().hasPhotoBackup ? snapshot.kitPhotos ?? [] : [];
  const kitWishlistPhotosToRestore = getEntitlements().hasPhotoBackup && snapshot.schemaVersion >= 6
    ? snapshot.kitWishlistPhotos ?? []
    : [];
  const photosToRestore = [...kitPhotosToRestore, ...kitWishlistPhotosToRestore];
  const kitRefs = new Set((snapshot.kits ?? []).map((kit) => kit.localRef));
  const invalidPhoto = kitPhotosToRestore.find((photo) => !kitRefs.has(photo.kitLocalRef));
  if (invalidPhoto) throw new Error(`Kit photo references missing kit: ${invalidPhoto.kitLocalRef}`);
  const kitWishlistRefs = new Set((snapshot.kitWishlist ?? []).map((item) => item.localRef));
  const invalidKitWishlistPhoto = kitWishlistPhotosToRestore.find((photo) => !kitWishlistRefs.has(photo.wishlistLocalRef));
  if (invalidKitWishlistPhoto) {
    throw new Error(`Candidate photo references missing candidate: ${invalidKitWishlistPhoto.wishlistLocalRef}`);
  }

  const localUriByStoragePath = photosToRestore.length > 0
    ? await downloadKitPhotosForRestore(photosToRestore)
    : new Map<string, string>();
  const missingDownloads = photosToRestore.filter((photo) => !localUriByStoragePath.has(photo.storagePath));
  if (missingDownloads.length > 0) {
    for (const uri of localUriByStoragePath.values()) {
      await deleteKitPhoto(uri).catch((e) =>
        console.error('restoreFromSnapshot: failed to clean up partial photo download', uri, e)
      );
    }
    throw new Error(`Failed to download ${missingDownloads.length} kit photo(s)`);
  }

  try {
    assertCurrentUser(expectedUid);
    await db.withExclusiveTransactionAsync(async (tx) => {
      assertCurrentUser(expectedUid);
      await tx.runAsync('DELETE FROM inventory');
      await tx.runAsync('DELETE FROM lists');
      await tx.runAsync('DELETE FROM mix_recipe_paints');
      await tx.runAsync('DELETE FROM mix_recipes');
      await tx.runAsync('DELETE FROM kit_color_paints');
      await tx.runAsync('DELETE FROM kit_colors');
      await tx.runAsync("DELETE FROM catalog_paints WHERE source = 'manual'");
      await tx.runAsync("UPDATE catalog_paints SET notes = NULL WHERE source = 'catalog'");

    for (const p of snapshot.manualPaints ?? []) {
      await tx.runAsync(
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
      const paintId = await resolvePaintId(note.catalog_code, tx);
      if (!paintId) {
        console.warn('restoreFromSnapshot: skipping official note for missing catalog_code', note.catalog_code);
        continue;
      }
      await tx.runAsync('UPDATE catalog_paints SET notes = ? WHERE id = ?', [note.notes, paintId]);
    }

    await tx.runAsync('DELETE FROM boxes WHERE id NOT IN (SELECT DISTINCT box_id FROM inventory WHERE box_id IS NOT NULL)');
    const boxIdByLocalRef = new Map<string, number>();
    for (const box of snapshot.boxes ?? []) {
      const result = await tx.runAsync(
        'INSERT INTO boxes (name, location, note) VALUES (?, ?, ?)',
        [box.name, box.location, box.note]
      );
      boxIdByLocalRef.set(box.localRef, result.lastInsertRowId);
    }

    for (const item of snapshot.inventory ?? []) {
      const paintId = await resolvePaintId(item.catalog_code, tx);
      if (!paintId) {
        console.warn('restoreFromSnapshot: skipping inventory for missing catalog_code', item.catalog_code);
        continue;
      }
      const boxId = item.boxLocalRef ? boxIdByLocalRef.get(item.boxLocalRef) ?? null : null;
      await tx.runAsync(
        'INSERT INTO inventory (paint_id, box_id, status, note, added_at, status_changed_at) VALUES (?, ?, ?, ?, ?, ?)',
        [paintId, boxId, item.status, item.note, item.added_at, item.status_changed_at]
      );
    }

    for (const item of snapshot.favorites ?? []) {
      const paintId = await resolvePaintId(item.catalog_code, tx);
      if (!paintId) {
        console.warn('restoreFromSnapshot: skipping favorite for missing catalog_code', item.catalog_code);
        continue;
      }
      await tx.runAsync(
        "INSERT INTO lists (name, type, paint_id, note, added_at) VALUES (NULL, 'favorites', ?, ?, ?)",
        [paintId, item.note, item.added_at]
      );
    }

    for (const item of snapshot.wishlist ?? []) {
      const paintId = await resolvePaintId(item.catalog_code, tx);
      if (!paintId) {
        console.warn('restoreFromSnapshot: skipping wishlist for missing catalog_code', item.catalog_code);
        continue;
      }
      await tx.runAsync(
        "INSERT INTO lists (name, type, paint_id, note, added_at) VALUES (NULL, 'wishlist', ?, ?, ?)",
        [paintId, item.note, item.added_at]
      );
    }

    const defaultBoxId = snapshot.defaultBoxLocalRef ? boxIdByLocalRef.get(snapshot.defaultBoxLocalRef) ?? null : null;
    if (defaultBoxId) {
      await tx.runAsync(
        'INSERT INTO app_settings (key, value) VALUES (?, ?)' +
        ' ON CONFLICT(key) DO UPDATE SET value = excluded.value',
        ['default_box_id', String(defaultBoxId)]
      );
    }

    for (const recipe of snapshot.mixRecipes ?? []) {
      const result = await tx.runAsync(
        'INSERT INTO mix_recipes (name, note, sort_order, added_at, updated_at) VALUES (?, ?, ?, ?, ?)',
        [recipe.name, recipe.note, recipe.sort_order, recipe.added_at, recipe.updated_at]
      );
      mixRecipeIdByLocalRef.set(recipe.localRef, result.lastInsertRowId);
    }

    for (const cp of snapshot.mixRecipePaints ?? []) {
      const mixRecipeId = mixRecipeIdByLocalRef.get(cp.mixRecipeLocalRef);
      const paintId = await resolvePaintId(cp.catalog_code, tx);
      if (!mixRecipeId || !paintId) {
        console.warn('restoreFromSnapshot: skipping mix recipe paint for missing mix recipe or catalog_code', cp.mixRecipeLocalRef, cp.catalog_code);
        continue;
      }
      await tx.runAsync(
        'INSERT INTO mix_recipe_paints (mix_recipe_id, paint_id, ratio, sort_order) VALUES (?, ?, ?, ?)',
        [mixRecipeId, paintId, cp.ratio, cp.sort_order]
      );
    }

    orphanedKitPhotoUris.push(...(await tx.getAllAsync<{ uri: string }>('SELECT uri FROM kit_wishlist_photos')).map((r) => r.uri));
    await tx.runAsync('DELETE FROM kit_wishlist_photos');
    await tx.runAsync('DELETE FROM kit_wishlist');
    for (const item of snapshot.kitWishlist ?? []) {
      const result = await tx.runAsync(
        'INSERT INTO kit_wishlist (name, maker, series, category, scale, note, price, added_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [item.name, item.maker, item.series, item.category, item.scale, item.note, item.price, item.added_at]
      );
      kitWishlistIdByLocalRef.set(item.localRef, result.lastInsertRowId);
    }

    for (const photo of kitWishlistPhotosToRestore) {
      await tx.runAsync(
        "INSERT INTO kit_wishlist_photos (wishlist_id, uri, sort_order, synced_at, storage_path) VALUES (?, ?, ?, datetime('now'), ?)",
        [kitWishlistIdByLocalRef.get(photo.wishlistLocalRef)!, localUriByStoragePath.get(photo.storagePath)!, photo.sort_order, photo.storagePath]
      );
    }

    // キット関連は塗料ボックスと独立した体系のため、常に全消去して再構築する。
    // 写真は事前ダウンロードが全件成功した場合だけDB行を入れ替え、
    // 古い実ファイルはトランザクション成功後に削除する。
    orphanedKitPhotoUris.push(...(await tx.getAllAsync<{ uri: string }>('SELECT uri FROM kit_photos')).map((r) => r.uri));
    await tx.runAsync('DELETE FROM kit_photos');
    await tx.runAsync('DELETE FROM kits');
    await tx.runAsync('DELETE FROM kit_boxes');

    const kitBoxIdByLocalRef = new Map<string, number>();
    for (const box of snapshot.kitBoxes ?? []) {
      const result = await tx.runAsync(
        'INSERT INTO kit_boxes (name, icon, icon_color, sort_order) VALUES (?, ?, ?, ?)',
        [box.name, box.icon, box.icon_color, box.sort_order]
      );
      kitBoxIdByLocalRef.set(box.localRef, result.lastInsertRowId);
    }

    for (const kit of snapshot.kits ?? []) {
      const kitBoxId = kit.kitBoxLocalRef ? kitBoxIdByLocalRef.get(kit.kitBoxLocalRef) ?? null : null;
      const result = await tx.runAsync(
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
      const result = await tx.runAsync(
        'INSERT INTO kit_colors (kit_id, name, note, sort_order, added_at) VALUES (?, ?, ?, ?, ?)',
        [kitId, color.name, color.note, color.sort_order, color.added_at]
      );
      kitColorIdByLocalRef.set(color.localRef, result.lastInsertRowId);
    }

    for (const cp of snapshot.kitColorPaints ?? []) {
      const kitColorId = kitColorIdByLocalRef.get(cp.kitColorLocalRef);
      const paintId = await resolvePaintId(cp.catalog_code, tx);
      if (!kitColorId || !paintId) {
        console.warn('restoreFromSnapshot: skipping kit color paint for missing kit color or catalog_code', cp.kitColorLocalRef, cp.catalog_code);
        continue;
      }
      await tx.runAsync(
        'INSERT INTO kit_color_paints (kit_color_id, paint_id, ratio, sort_order) VALUES (?, ?, ?, ?)',
        [kitColorId, paintId, cp.ratio, cp.sort_order]
      );
    }

      for (const photo of kitPhotosToRestore) {
        await tx.runAsync(
          "INSERT INTO kit_photos (kit_id, uri, sort_order, synced_at, storage_path) VALUES (?, ?, ?, datetime('now'), ?)",
          [kitIdByLocalRef.get(photo.kitLocalRef)!, localUriByStoragePath.get(photo.storagePath)!, photo.sort_order, photo.storagePath]
        );
      }

      const defaultKitBoxId = snapshot.defaultKitBoxLocalRef ? kitBoxIdByLocalRef.get(snapshot.defaultKitBoxLocalRef) ?? null : null;
      if (defaultKitBoxId) {
        await tx.runAsync(
          'INSERT INTO app_settings (key, value) VALUES (?, ?)' +
          ' ON CONFLICT(key) DO UPDATE SET value = excluded.value',
          ['default_kit_box_id', String(defaultKitBoxId)]
        );
      }
      assertCurrentUser(expectedUid);
    });
  } catch (e) {
    for (const uri of localUriByStoragePath.values()) {
      await deleteKitPhoto(uri).catch((cleanupError) =>
        console.error('restoreFromSnapshot: failed to clean up rolled-back photo download', uri, cleanupError)
      );
    }
    throw e;
  }

  // 写真ファイルの実削除はベストエフォート。DB行は既にトランザクション内で
  // 削除済みのため、1件の削除失敗で残り全部を諦めない(ログだけ残して続行)。
  for (const uri of orphanedKitPhotoUris) {
    try {
      await deleteKitPhoto(uri);
    } catch (e) {
      console.error('restoreFromSnapshot: failed to delete orphaned kit photo', uri, e);
    }
  }

}

let autoBackupInitialized = false;
let lastAppState: AppStateStatus = AppState.currentState;

function retryAutoBackup(context: string): void {
  pushBackupToFirestore().catch((e) => console.error(`${context}: failed to push backup`, e));
}

export function initAutoBackup(): void {
  if (autoBackupInitialized) return;
  autoBackupInitialized = true;
  // ponytail: OSによるバックグラウンド停止は防げないため、起動・復帰時にも再試行する。
  retryAutoBackup('initAutoBackup');
  AppState.addEventListener('change', (nextState) => {
    const shouldBackup = (lastAppState === 'active' && (nextState === 'background' || nextState === 'inactive'))
      || (lastAppState !== 'active' && nextState === 'active');
    lastAppState = nextState;
    if (!shouldBackup) return;

    retryAutoBackup('initAutoBackup');
  });
}

export async function runRestoreDecision(): Promise<'restored' | 'conflict' | 'account_conflict' | 'none'> {
  const expectedUid = auth?.().currentUser?.uid;
  if (!expectedUid) return 'none';
  return runAccountOperation(async () => {
    assertCurrentUser(expectedUid);
    if (!getEntitlements().hasBackup || await isCloudBackupReady(expectedUid)) return 'none';
    const localDbEmpty = await isLocalDbEmpty();
    const localOwnerUid = await getLocalDataOwnerUid();
    if (!localDbEmpty && localOwnerUid !== expectedUid) return 'account_conflict';
    const snapshot = await fetchBackupSnapshot(expectedUid);
    if (!snapshot) {
      await markCloudBackupReady(expectedUid);
      return 'none';
    }
    if (localDbEmpty) {
      await restoreFromSnapshotUnlocked(snapshot, expectedUid);
      await markCloudBackupReady(expectedUid);
      return 'restored';
    }
    return 'conflict';
  });
}

export async function markCloudBackupReady(expectedUid: string): Promise<void> {
  assertCurrentUser(expectedUid);
  await setSetting(LOCAL_DATA_OWNER_UID_KEY, expectedUid);
  await setSetting(BACKUP_READY_UID_KEY, expectedUid);
}

export async function isCloudBackupReady(expectedUid: string): Promise<boolean> {
  assertCurrentUser(expectedUid);
  return await getSetting(BACKUP_READY_UID_KEY) === expectedUid
    && await getLocalDataOwnerUid() === expectedUid;
}
