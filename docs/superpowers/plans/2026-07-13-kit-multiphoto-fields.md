# Kit Series/Category Fields + Multi-Photo Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the just-built kit management feature (PR #22, unmerged) with two additions: (1) `series`/`category` free-text fields on a kit, and (2) multi-photo support (up to 10 photos per kit, first photo = thumbnail) replacing the current single-photo model.

**Architecture:** `kits.photo_uri` (single column) is replaced by a new one-to-many `kit_photos` table (mirrors the existing `kit_paints` child-table pattern). A single new `KitPhotoGrid` component replaces `KitPhotoPicker` and is reused, unmodified, by both the add-kit form (local-only photo list, not yet persisted) and the kit detail modal (DB-backed photo list). Because this feature has never shipped in any build, the schema change needs no data migration.

**Tech Stack:** Same as the prior kit-management plan — Expo SDK ~54 / React Native / expo-sqlite / expo-image-picker / expo-file-system (all already installed, no new dependencies).

**Note on verification:** Same as the prior plan — no test framework exists in this project. Every task's verification is `npx tsc --noEmit` plus a documented manual Expo Go check in the final task.

## Global Constraints

- Every new/modified `.ts`/`.tsx`/`.json` file must have no UTF-8 BOM (verify with `head -c 3 <file> | od -An -tx1 | grep -q "ef bb bf"` — must NOT match) and must use the codebase's styling convention: `const { colors } = useTheme(); const styles = useMemo(() => makeStyles(colors), [colors]);` where the file being touched already uses that pattern — some kit files (e.g. `AddKitModal.tsx`, `KitDetailModal.tsx`) call `makeStyles(colors)` directly without `useMemo`; when editing those files, preserve their EXISTING convention rather than introducing a mix (do not "fix" this in passing — it's out of scope for this plan).
- All user-facing strings go through `t('key')` from `lib/i18n.ts`. This plan needs exactly ONE new translation key (`category`) — `series` already exists and must be reused, not duplicated.
- Follow the mandatory branch+PR workflow: this plan is executed on the existing branch `feature/model-management` (PR #22, already open). Do not commit to `master` directly.
- Reuse existing components/patterns instead of reimplementing: `ActionSheet`, `ClearableInput`, `SwipeDownHeader`, `SwipeDownScrollView`, `useModalLock` stay as-is. `lib/kitPhoto.ts`'s `pickKitPhotoFromCamera`/`pickKitPhotoFromLibrary`/`deleteKitPhoto` are reused unmodified — do not touch that file.
- No data migration logic needed: this feature has not shipped in any release build (TestFlight or Google Play), so the schema can be changed directly in the `CREATE TABLE IF NOT EXISTS` definition without an `ALTER TABLE`/backfill step.
- Explicitly out of scope (per `docs/superpowers/specs/2026-07-13-kit-multiphoto-fields-design.md`): photo reordering UI (delete + re-add is the intended workaround), fixed/enum `category` values (stays free text).

---

### Task 1: Database schema and query functions

**Files:**
- Modify: `lib/db.ts`

**Interfaces:**
- Produces: updated `KitDetail` interface (drops `photo_uri`, adds `series`/`category`), `KitPhoto` interface, functions `updateKitSeries(kitId: number, series: string): Promise<void>`, `updateKitCategory(kitId: number, category: string): Promise<void>`, `getKitPhotos(kitId: number): Promise<KitPhoto[]>`, `addKitPhoto(kitId: number, uri: string): Promise<void>`, `removeKitPhoto(photoId: number): Promise<void>`. Removes the now-obsolete `updateKitPhoto` function (no longer callable after this task — later tasks that used it are updated in Tasks 4/5). Modifies `deleteKit` to also cascade-delete `kit_photos`.
- Consumed by: Task 4 (`AddKitModal.tsx`), Task 5 (`KitDetailModal.tsx`), Task 6 (`kits.tsx`, via the `kit_photos` table directly in a subquery), Task 7 (`KitBoxOptions.tsx`, via `kit_photos` directly).

- [ ] **Step 1: Replace the `kits` table definition and add `kit_photos`**

Open `lib/db.ts`. Find this block inside `initDB()`'s `execAsync` call (currently reads, in order: `kit_boxes` table, then `kits` table, then `kit_paints` table, ending the whole `execAsync` string):

```ts
    'CREATE TABLE IF NOT EXISTS kits (' +
    '  id INTEGER PRIMARY KEY AUTOINCREMENT,' +
    '  box_id INTEGER,' +
    '  name TEXT NOT NULL, maker TEXT NOT NULL, scale TEXT, note TEXT, photo_uri TEXT,' +
    "  status TEXT NOT NULL DEFAULT 'not_started' CHECK(status IN ('not_started','building','completed'))," +
    "  added_at TEXT DEFAULT (datetime('now')), status_changed_at TEXT DEFAULT (datetime('now'))" +
    ');' +
    'CREATE TABLE IF NOT EXISTS kit_paints (' +
    '  id INTEGER PRIMARY KEY AUTOINCREMENT,' +
    '  kit_id INTEGER NOT NULL, paint_id INTEGER NOT NULL, note TEXT,' +
    "  added_at TEXT DEFAULT (datetime('now'))" +
    ');'
```

Replace it with (removes `photo_uri` from `kits`, adds `series`/`category`, adds the new `kit_photos` table after `kit_paints`):

```ts
    'CREATE TABLE IF NOT EXISTS kits (' +
    '  id INTEGER PRIMARY KEY AUTOINCREMENT,' +
    '  box_id INTEGER,' +
    '  name TEXT NOT NULL, maker TEXT NOT NULL, series TEXT, category TEXT, scale TEXT, note TEXT,' +
    "  status TEXT NOT NULL DEFAULT 'not_started' CHECK(status IN ('not_started','building','completed'))," +
    "  added_at TEXT DEFAULT (datetime('now')), status_changed_at TEXT DEFAULT (datetime('now'))" +
    ');' +
    'CREATE TABLE IF NOT EXISTS kit_paints (' +
    '  id INTEGER PRIMARY KEY AUTOINCREMENT,' +
    '  kit_id INTEGER NOT NULL, paint_id INTEGER NOT NULL, note TEXT,' +
    "  added_at TEXT DEFAULT (datetime('now'))" +
    ');' +
    'CREATE TABLE IF NOT EXISTS kit_photos (' +
    '  id INTEGER PRIMARY KEY AUTOINCREMENT,' +
    '  kit_id INTEGER NOT NULL, uri TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0,' +
    "  added_at TEXT DEFAULT (datetime('now'))" +
    ');'
```

- [ ] **Step 2: Replace `KitDetail` and `getKitDetail`**

Find:

```ts
export interface KitDetail {
  id: number;
  box_id: number | null;
  box_name: string | null;
  name: string;
  maker: string;
  scale: string | null;
  note: string | null;
  photo_uri: string | null;
  status: KitStatus;
  added_at: string | null;
  status_changed_at: string | null;
}

export async function getKitDetail(kitId: number): Promise<KitDetail | null> {
  const row = await getDB().getFirstAsync<KitDetail>(
    'SELECT k.id, k.box_id, b.name AS box_name, k.name, k.maker, k.scale, k.note, k.photo_uri, k.status, k.added_at, k.status_changed_at'
    + ' FROM kits k LEFT JOIN kit_boxes b ON k.box_id = b.id'
    + ' WHERE k.id = ?',
    [kitId]
  );
  return row ?? null;
}
```

Replace with:

```ts
export interface KitDetail {
  id: number;
  box_id: number | null;
  box_name: string | null;
  name: string;
  maker: string;
  series: string | null;
  category: string | null;
  scale: string | null;
  note: string | null;
  status: KitStatus;
  added_at: string | null;
  status_changed_at: string | null;
}

export async function getKitDetail(kitId: number): Promise<KitDetail | null> {
  const row = await getDB().getFirstAsync<KitDetail>(
    'SELECT k.id, k.box_id, b.name AS box_name, k.name, k.maker, k.series, k.category, k.scale, k.note, k.status, k.added_at, k.status_changed_at'
    + ' FROM kits k LEFT JOIN kit_boxes b ON k.box_id = b.id'
    + ' WHERE k.id = ?',
    [kitId]
  );
  return row ?? null;
}
```

- [ ] **Step 3: Add `updateKitSeries`/`updateKitCategory` next to `updateKitNote`**

Find `updateKitNote` (unchanged, do not modify it) and insert two new functions immediately after its closing brace, before `updateKitBox`:

```ts
export async function updateKitSeries(kitId: number, series: string): Promise<void> {
  const normalized = series.trim() === '' ? null : series;
  await getDB().runAsync(
    "UPDATE kits SET series = ?, status_changed_at = datetime('now') WHERE id = ?",
    [normalized, kitId]
  );
}

export async function updateKitCategory(kitId: number, category: string): Promise<void> {
  const normalized = category.trim() === '' ? null : category;
  await getDB().runAsync(
    "UPDATE kits SET category = ?, status_changed_at = datetime('now') WHERE id = ?",
    [normalized, kitId]
  );
}
```

- [ ] **Step 4: Remove `updateKitPhoto`, add `KitPhoto`/`getKitPhotos`/`addKitPhoto`/`removeKitPhoto`, update `deleteKit`**

Find this block (the single-photo setter and the delete function):

```ts
export async function updateKitPhoto(kitId: number, photoUri: string | null): Promise<void> {
  await getDB().runAsync(
    "UPDATE kits SET photo_uri = ?, status_changed_at = datetime('now') WHERE id = ?",
    [photoUri, kitId]
  );
}

export async function deleteKit(kitId: number): Promise<void> {
  const db = getDB();
  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM kit_paints WHERE kit_id = ?', [kitId]);
    await db.runAsync('DELETE FROM kits WHERE id = ?', [kitId]);
  });
}
```

Replace it entirely with (deletes `updateKitPhoto`, adds the new multi-photo functions, and adds a `kit_photos` cleanup line to `deleteKit`'s transaction):

```ts
export interface KitPhoto {
  id: number;
  uri: string;
  sort_order: number;
}

export async function getKitPhotos(kitId: number): Promise<KitPhoto[]> {
  return getDB().getAllAsync<KitPhoto>(
    'SELECT id, uri, sort_order FROM kit_photos WHERE kit_id = ? ORDER BY sort_order, id',
    [kitId]
  );
}

export async function addKitPhoto(kitId: number, uri: string): Promise<void> {
  const row = await getDB().getFirstAsync<{ n: number }>(
    'SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM kit_photos WHERE kit_id = ?',
    [kitId]
  );
  await getDB().runAsync(
    'INSERT INTO kit_photos (kit_id, uri, sort_order) VALUES (?, ?, ?)',
    [kitId, uri, row?.n ?? 0]
  );
}

export async function removeKitPhoto(photoId: number): Promise<void> {
  await getDB().runAsync('DELETE FROM kit_photos WHERE id = ?', [photoId]);
}

export async function deleteKit(kitId: number): Promise<void> {
  const db = getDB();
  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM kit_paints WHERE kit_id = ?', [kitId]);
    await db.runAsync('DELETE FROM kit_photos WHERE kit_id = ?', [kitId]);
    await db.runAsync('DELETE FROM kits WHERE id = ?', [kitId]);
  });
}
```

`addKitPhoto` computes the next `sort_order` as `MAX(sort_order) + 1` for that kit (starting at 0 for the first photo), so it is safe to call repeatedly — including from a brand-new kit that has zero existing photos (Task 4 relies on this).

Note: `KitPaintRow` interface and its associated functions (`getKitPaints`, `addKitPaint`, `updateKitPaintNote`, `removeKitPaint`), which appear immediately after this block in the file, are NOT touched by this task — leave them exactly as they are.

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit`
Expected: errors WILL appear at this point — `components/AddKitModal.tsx`, `components/KitDetailModal.tsx`, `components/KitPhotoPicker.tsx`, `app/(tabs)/kits.tsx`, and `components/KitBoxOptions.tsx` all still reference the now-removed `photo_uri` column/`updateKitPhoto` function. This is expected and will be resolved by Tasks 3-7. For THIS task, confirm the errors are ONLY in those 5 files (not in `lib/db.ts` itself) — that confirms `lib/db.ts` itself is internally consistent and correctly typed; the "spillover" errors in dependent files are next tasks' job to fix.

- [ ] **Step 6: Commit**

```bash
git add lib/db.ts
git commit -m "feat: replace kits.photo_uri with kit_photos table, add series/category columns"
```

---

### Task 2: Translation key

**Files:**
- Modify: `translations/ja.json`
- Modify: `translations/en.json`

**Interfaces:**
- Produces: the `category` key, consumed via `t('category')` by Task 4 (`AddKitModal.tsx`) and Task 5 (`KitDetailModal.tsx`). The `series` key already exists (added for the paint feature) and is reused as-is — no change needed to it.

- [ ] **Step 1: Add `category` to `translations/ja.json`**

Both files are single-line, flat JSON. Insert before the final closing `}`:

```json
,"category":"種別"
```

- [ ] **Step 2: Add `category` to `translations/en.json`**

Same insertion point:

```json
,"category":"Category"
```

- [ ] **Step 3: Verify**

```bash
node -e "
const ja = require('./translations/ja.json');
const en = require('./translations/en.json');
const jaKeys = Object.keys(ja).sort();
const enKeys = Object.keys(en).sort();
console.log('ja:', jaKeys.length, 'en:', enKeys.length);
console.log('missing in en:', jaKeys.filter(k => !enKeys.includes(k)));
console.log('missing in ja:', enKeys.filter(k => !jaKeys.includes(k)));
console.log('series ja:', ja.series, '| en:', en.series);
"
```
Expected: `ja: 136 en: 136`, both "missing in" arrays empty, `series ja: シリーズ | en: Series` (confirms the pre-existing key was not accidentally duplicated or altered).

Also verify no BOM in either file.

- [ ] **Step 4: Commit**

```bash
git add translations/ja.json translations/en.json
git commit -m "feat: add category translation key"
```

---

### Task 3: Multi-photo grid component

**Files:**
- Create: `components/KitPhotoGrid.tsx`

**Interfaces:**
- Consumes: `pickKitPhotoFromCamera`/`pickKitPhotoFromLibrary` from `../lib/kitPhoto` (unchanged, already exists); `ActionSheet`/`ActionSheetButton` from `./ActionSheet`.
- Produces: exported interface `KitPhotoGridItem { key: string | number; uri: string }` and default-exported `KitPhotoGrid({ photos, onAdd, onRemove }: { photos: KitPhotoGridItem[]; onAdd: (uri: string) => void; onRemove: (key: string | number) => void })`. The `key` field is intentionally generic (`string | number`) so callers can pass either a DB row id (kit detail — already persisted photos) or the URI itself as a stand-in key (add-kit form — not yet persisted, no id exists yet). Consumed by Task 4 (`AddKitModal.tsx`) and Task 5 (`KitDetailModal.tsx`).

- [ ] **Step 1: Create the component**

```tsx
// components/KitPhotoGrid.tsx
// 複数枚(最大10枚)の写真グリッド。1枚目はサムネイル扱いのため枠線で強調する。
// 並び替えUIは持たない(削除して撮り直す運用を想定)。
import { useMemo, useState } from 'react';
import { Image, StyleSheet, TouchableOpacity, View } from 'react-native';
import { IconPlus, IconX } from '@tabler/icons-react-native';
import { pickKitPhotoFromCamera, pickKitPhotoFromLibrary } from '../lib/kitPhoto';
import { t } from '../lib/i18n';
import { lightColors, radius, spacing, useTheme } from '../lib/theme';
import ActionSheet, { ActionSheetButton } from './ActionSheet';

export interface KitPhotoGridItem {
  key: string | number;
  uri: string;
}

interface Props {
  photos: KitPhotoGridItem[];
  onAdd: (uri: string) => void;
  onRemove: (key: string | number) => void;
}

const MAX_PHOTOS = 10;

export default function KitPhotoGrid({ photos, onAdd, onRemove }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const canAddMore = photos.length < MAX_PHOTOS;

  const takePhoto = async () => {
    const uri = await pickKitPhotoFromCamera();
    if (uri) onAdd(uri);
  };
  const chooseFromLibrary = async () => {
    const uri = await pickKitPhotoFromLibrary();
    if (uri) onAdd(uri);
  };

  const buttons: ActionSheetButton[] = [
    { text: t('takePhoto'), onPress: takePhoto },
    { text: t('chooseFromLibrary'), onPress: chooseFromLibrary },
    { text: t('cancel'), style: 'cancel' },
  ];

  return (
    <View style={styles.grid}>
      {photos.map((photo, index) => (
        <View key={photo.key} style={[styles.tile, index === 0 && styles.thumbnailTile]}>
          <Image source={{ uri: photo.uri }} style={styles.image} resizeMode="cover" />
          <TouchableOpacity
            style={styles.removeBtn}
            onPress={() => onRemove(photo.key)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={t('removePhoto')}
          >
            <IconX color="#fff" size={14} />
          </TouchableOpacity>
        </View>
      ))}
      {canAddMore ? (
        <TouchableOpacity
          style={styles.tile}
          onPress={() => setPickerOpen(true)}
          accessibilityRole="button"
          accessibilityLabel={t('kitPhoto')}
        >
          <View style={styles.placeholder}><IconPlus color={colors.textFaint} size={28} /></View>
        </TouchableOpacity>
      ) : null}
      <ActionSheet visible={pickerOpen} title={t('kitPhoto')} buttons={buttons} onClose={() => setPickerOpen(false)} />
    </View>
  );
}

const makeStyles = (colors: typeof lightColors) => StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  tile: { width: 72, height: 72, borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.borderLight },
  thumbnailTile: { borderWidth: 2, borderColor: colors.primary },
  image: { width: '100%', height: '100%' },
  placeholder: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  removeBtn: { position: 'absolute', top: 2, right: 2, width: 20, height: 20, borderRadius: 10, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' },
});
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: no NEW errors attributable to this file (the pre-existing errors from Task 1's schema change in OTHER files are still expected at this point — this file itself, standalone, must type-check cleanly since nothing imports it yet).

- [ ] **Step 3: Commit**

```bash
git add components/KitPhotoGrid.tsx
git commit -m "feat: add multi-photo grid component for kits"
```

---

### Task 4: Add-kit modal — series/category fields + multi-photo

**Files:**
- Modify: `components/AddKitModal.tsx`

**Interfaces:**
- Consumes: `addKitPhoto` from `../lib/db` (Task 1); `KitPhotoGrid`/`KitPhotoGridItem` from `./KitPhotoGrid` (Task 3); `t('category')` (Task 2).
- No change to this component's own exported `Props` shape (`{ visible, defaultBoxId, onClose }`) — callers (Task 6's `kits.tsx`) need no changes for this task.

- [ ] **Step 1: Replace the entire file**

The current file no longer type-checks (Task 1 removed the `photo_uri` column it references). Replace `components/AddKitModal.tsx` in full with:

```tsx
// components/AddKitModal.tsx
import { useEffect, useState } from 'react';
import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { IconX } from '@tabler/icons-react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { addKitPhoto, getDB } from '../lib/db';
import { t } from '../lib/i18n';
import { useModalLock } from '../lib/modalLock';
import { lightColors, radius, spacing, useTheme } from '../lib/theme';
import ClearableInput from './ClearableInput';
import KitPhotoGrid from './KitPhotoGrid';
import SwipeDownHeader from './SwipeDownHeader';
import SwipeDownScrollView from './SwipeDownScrollView';

interface Props {
  visible: boolean;
  defaultBoxId: number | null;
  onClose: () => void;
}

export default function AddKitModal({ visible, defaultBoxId, onClose }: Props) {
  useModalLock(visible);
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const [name, setName] = useState('');
  const [maker, setMaker] = useState('');
  const [series, setSeries] = useState('');
  const [category, setCategory] = useState('');
  const [scale, setScale] = useState('');
  const [note, setNote] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const canSave = name.trim() !== '' && maker.trim() !== '';

  useEffect(() => {
    if (visible) { setName(''); setMaker(''); setSeries(''); setCategory(''); setScale(''); setNote(''); setPhotos([]); }
  }, [visible]);

  const save = async () => {
    if (!canSave) return;
    const result = await getDB().runAsync(
      'INSERT INTO kits (box_id, name, maker, series, category, scale, note, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [defaultBoxId, name.trim(), maker.trim(), series.trim() || null, category.trim() || null, scale.trim() || null, note.trim() || null, 'not_started']
    );
    const kitId = result.lastInsertRowId;
    for (const uri of photos) await addKitPhoto(kitId, uri);
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaProvider>
        <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
          <SwipeDownHeader onClose={onClose}>
            <View style={styles.header}>
              <Text style={styles.title}>{t('addKit')}</Text>
              <TouchableOpacity onPress={onClose} hitSlop={8}>
                <IconX color={colors.text} size={24} />
              </TouchableOpacity>
            </View>
          </SwipeDownHeader>
          <SwipeDownScrollView onClose={onClose} style={{ flex: 1 }} contentContainerStyle={styles.content} keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled">
            <KitPhotoGrid
              photos={photos.map((uri) => ({ key: uri, uri }))}
              onAdd={(uri) => setPhotos((current) => [...current, uri])}
              onRemove={(key) => setPhotos((current) => current.filter((uri) => uri !== key))}
            />
            <View style={styles.field}>
              <Text style={styles.label}>{t('name')}*</Text>
              <ClearableInput style={styles.input} value={name} onChangeText={setName} />
            </View>
            <View style={styles.field}>
              <Text style={styles.label}>{t('maker')}*</Text>
              <ClearableInput style={styles.input} value={maker} onChangeText={setMaker} />
            </View>
            <View style={styles.field}>
              <Text style={styles.label}>{t('series')}</Text>
              <ClearableInput style={styles.input} value={series} onChangeText={setSeries} />
            </View>
            <View style={styles.field}>
              <Text style={styles.label}>{t('category')}</Text>
              <ClearableInput style={styles.input} value={category} onChangeText={setCategory} />
            </View>
            <View style={styles.field}>
              <Text style={styles.label}>{t('scale')}</Text>
              <ClearableInput style={styles.input} value={scale} onChangeText={setScale} placeholder="1/144" />
            </View>
            <View style={styles.field}>
              <Text style={styles.label}>{t('note')}</Text>
              <ClearableInput style={[styles.input, styles.noteInput]} value={note} onChangeText={setNote} multiline textAlignVertical="top" />
            </View>
          </SwipeDownScrollView>
          <TouchableOpacity style={[styles.saveBtn, !canSave && styles.saveBtnDisabled]} onPress={save} disabled={!canSave}>
            <Text style={styles.saveBtnText}>{t('save')}</Text>
          </TouchableOpacity>
        </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
}

const makeStyles = (colors: typeof lightColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.xl, paddingVertical: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.borderLight },
  title: { fontSize: 18, fontWeight: 'bold', color: colors.text },
  content: { padding: spacing.xl, gap: spacing.lg },
  field: { gap: spacing.xs },
  label: { fontSize: 12, color: colors.textMuted, fontWeight: '600' },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: 10, color: colors.text },
  noteInput: { minHeight: 72, alignItems: 'flex-start' },
  saveBtn: { minHeight: 48, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary, margin: spacing.xl, borderRadius: radius.md },
  saveBtnDisabled: { backgroundColor: colors.primaryDisabled },
  saveBtnText: { color: colors.onPrimary, fontWeight: '700', fontSize: 16 },
});
```

Note: `photos` here is a plain `string[]` of URIs (not yet in the DB — the kit doesn't exist until `save()` runs), so `KitPhotoGridItem.key` is set to the URI itself (URIs are unique timestamped file paths from `lib/kitPhoto.ts`'s `persist()`, so this is safe as a React key and as a removal-lookup key).

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: no errors attributable to `components/AddKitModal.tsx`.

- [ ] **Step 3: Commit**

```bash
git add components/AddKitModal.tsx
git commit -m "feat: add series/category fields and multi-photo grid to add-kit form"
```

---

### Task 5: Kit detail modal — series/category fields + multi-photo

**Files:**
- Modify: `components/KitDetailModal.tsx`

**Interfaces:**
- Consumes: `getKitPhotos`, `addKitPhoto`, `removeKitPhoto`, `KitPhoto`, `updateKitSeries`, `updateKitCategory` from `../lib/db` (Task 1, new); `KitPhotoGrid`/`KitPhotoGridItem` from `./KitPhotoGrid` (Task 3) replacing `KitPhotoPicker`; `t('category')` (Task 2). No longer imports `updateKitPhoto` (removed in Task 1).
- No change to this component's own exported `Props` shape (`{ visible, kitId, onClose, onChanged }`).

- [ ] **Step 1: Replace the entire file**

The current file no longer type-checks (Task 1 removed `photo_uri`/`updateKitPhoto`). Replace `components/KitDetailModal.tsx` in full with:

```tsx
// components/KitDetailModal.tsx
import { useCallback, useEffect, useState } from 'react';
import { Alert, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { IconChevronDown, IconDotsVertical, IconX } from '@tabler/icons-react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import {
  addKitPhoto,
  deleteKit,
  getDB,
  getKitDetail,
  getKitPaints,
  getKitPhotos,
  KitDetail,
  KitPaintRow as KitPaintRowData,
  KitPhoto,
  KitStatus,
  removeKitPaint,
  removeKitPhoto,
  setKitStatus,
  updateKitBox,
  updateKitCategory,
  updateKitNote,
  updateKitPaintNote,
  updateKitSeries,
} from '../lib/db';
import { deleteKitPhoto } from '../lib/kitPhoto';
import { t } from '../lib/i18n';
import { useModalLock } from '../lib/modalLock';
import { lightColors, radius, spacing, useTheme } from '../lib/theme';
import ActionSheet from './ActionSheet';
import ClearableInput from './ClearableInput';
import KitPaintPickerModal from './KitPaintPickerModal';
import KitPaintRow from './KitPaintRow';
import KitPhotoGrid from './KitPhotoGrid';
import SwipeBack from './SwipeBack';
import SwipeDownHeader from './SwipeDownHeader';
import SwipeDownScrollView from './SwipeDownScrollView';

interface Box { id: number; name: string; }

const STATUS_OPTIONS: { value: KitStatus; labelKey: string }[] = [
  { value: 'not_started', labelKey: 'statusNotStarted' },
  { value: 'building', labelKey: 'statusBuilding' },
  { value: 'completed', labelKey: 'statusCompleted' },
];

interface Props {
  visible: boolean;
  kitId: number | null;
  onClose: () => void;
  onChanged?: () => void;
}

export default function KitDetailModal({ visible, kitId, onClose, onChanged }: Props) {
  useModalLock(visible);
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const [detail, setDetail] = useState<KitDetail | null>(null);
  const [paints, setPaints] = useState<KitPaintRowData[]>([]);
  const [photos, setPhotos] = useState<KitPhoto[]>([]);
  const [note, setNote] = useState('');
  const [series, setSeries] = useState('');
  const [category, setCategory] = useState('');
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [boxPickerOpen, setBoxPickerOpen] = useState(false);
  const [statusPickerOpen, setStatusPickerOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const load = useCallback(async () => {
    if (kitId == null) return;
    const [row, paintRows, photoRows] = await Promise.all([getKitDetail(kitId), getKitPaints(kitId), getKitPhotos(kitId)]);
    setDetail(row);
    setPaints(paintRows);
    setPhotos(photoRows);
    setNote(row?.note ?? '');
    setSeries(row?.series ?? '');
    setCategory(row?.category ?? '');
  }, [kitId]);

  useEffect(() => {
    if (visible) {
      load();
      getDB().getAllAsync<Box>('SELECT id, name FROM kit_boxes ORDER BY sort_order, id').then(setBoxes);
    } else {
      setDetail(null);
      setPaints([]);
      setPhotos([]);
      setNote('');
      setSeries('');
      setCategory('');
      setBoxPickerOpen(false);
      setStatusPickerOpen(false);
      setPickerOpen(false);
      setMenuOpen(false);
    }
  }, [visible, load]);

  const saveNote = async () => {
    if (!detail) return;
    if (note === (detail.note ?? '')) return;
    await updateKitNote(detail.id, note);
    await load();
    onChanged?.();
  };

  const saveSeries = async () => {
    if (!detail) return;
    if (series === (detail.series ?? '')) return;
    await updateKitSeries(detail.id, series);
    await load();
    onChanged?.();
  };

  const saveCategory = async () => {
    if (!detail) return;
    if (category === (detail.category ?? '')) return;
    await updateKitCategory(detail.id, category);
    await load();
    onChanged?.();
  };

  const closeAfterSavingFields = async () => {
    if (detail) {
      if (note !== (detail.note ?? '')) { await updateKitNote(detail.id, note); onChanged?.(); }
      if (series !== (detail.series ?? '')) { await updateKitSeries(detail.id, series); onChanged?.(); }
      if (category !== (detail.category ?? '')) { await updateKitCategory(detail.id, category); onChanged?.(); }
    }
    onClose();
  };

  const changeBox = async (boxId: number) => {
    if (!detail) return;
    setBoxPickerOpen(false);
    await updateKitBox(detail.id, boxId);
    await load();
    onChanged?.();
  };

  const changeStatus = async (status: KitStatus) => {
    if (!detail || detail.status === status) return;
    setStatusPickerOpen(false);
    await setKitStatus(detail.id, status);
    await load();
    onChanged?.();
  };

  const addPhoto = async (uri: string) => {
    if (!detail) return;
    await addKitPhoto(detail.id, uri);
    await load();
    onChanged?.();
  };

  const removePhoto = async (photoId: number, uri: string) => {
    await removeKitPhoto(photoId);
    await deleteKitPhoto(uri);
    await load();
    onChanged?.();
  };

  const removePaint = async (kitPaintId: number) => {
    await removeKitPaint(kitPaintId);
    await load();
  };

  const changePaintNote = async (kitPaintId: number, next: string) => {
    await updateKitPaintNote(kitPaintId, next);
    await load();
  };

  const confirmDelete = () => {
    if (!detail) return;
    setMenuOpen(false);
    Alert.alert(detail.name, t('deleteKitConfirm'), [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('delete'), style: 'destructive',
        onPress: async () => {
          await deleteKit(detail.id);
          for (const photo of photos) await deleteKitPhoto(photo.uri);
          onChanged?.();
          onClose();
        },
      },
    ]);
  };

  const boxName = boxes.find((b) => b.id === detail?.box_id)?.name ?? t('unassigned');

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={closeAfterSavingFields}>
      <SafeAreaProvider>
        <SwipeBack enabled={visible} onBack={closeAfterSavingFields}>
        <SafeAreaView style={styles.container} edges={['top']}>
          <SwipeDownHeader onClose={closeAfterSavingFields}>
            <View style={styles.header}>
              <Text style={styles.title}>{t('kitDetailTitle')}</Text>
              <View style={styles.headerActions}>
                <TouchableOpacity onPress={() => setMenuOpen(true)} hitSlop={8}>
                  <IconDotsVertical color={colors.text} size={22} />
                </TouchableOpacity>
                <TouchableOpacity onPress={closeAfterSavingFields} hitSlop={8}>
                  <IconX color={colors.text} size={24} />
                </TouchableOpacity>
              </View>
            </View>
          </SwipeDownHeader>

          {!detail ? (
            <Text style={styles.empty}>{t('noResults')}</Text>
          ) : (
            <SwipeDownScrollView style={styles.scroll} onClose={closeAfterSavingFields} contentContainerStyle={styles.content} keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled">
              <View style={styles.topRow}>
                <KitPhotoGrid
                  photos={photos.map((p) => ({ key: p.id, uri: p.uri }))}
                  onAdd={addPhoto}
                  onRemove={(key) => {
                    const photo = photos.find((p) => p.id === key);
                    if (photo) removePhoto(photo.id, photo.uri);
                  }}
                />
                <View style={styles.titleBlock}>
                  <Text style={styles.name}>{detail.name}</Text>
                  <Text style={styles.maker}>{detail.maker}{detail.scale ? ` · ${detail.scale}` : ''}</Text>
                </View>
              </View>

              <View style={styles.controlCard}>
                <View style={styles.control}>
                  <Text style={styles.sectionTitle}>{t('box')}</Text>
                  <TouchableOpacity style={styles.picker} onPress={() => setBoxPickerOpen(true)}>
                    <Text numberOfLines={1} style={styles.pickerText}>{boxName}</Text>
                    <IconChevronDown size={16} color={colors.textMuted} />
                  </TouchableOpacity>
                </View>
                <View style={styles.divider} />
                <View style={styles.control}>
                  <Text style={styles.sectionTitle}>{t('status')}</Text>
                  <TouchableOpacity style={styles.picker} onPress={() => setStatusPickerOpen(true)}>
                    <Text numberOfLines={1} style={styles.pickerText}>{t(STATUS_OPTIONS.find((o) => o.value === detail.status)?.labelKey ?? 'status')}</Text>
                    <IconChevronDown size={16} color={colors.textMuted} />
                  </TouchableOpacity>
                </View>
              </View>

              <View style={styles.card}>
                <View style={styles.field}>
                  <Text style={styles.sectionTitle}>{t('series')}</Text>
                  <ClearableInput style={styles.input} value={series} onChangeText={setSeries} onBlur={saveSeries} />
                </View>
                <View style={styles.field}>
                  <Text style={styles.sectionTitle}>{t('category')}</Text>
                  <ClearableInput style={styles.input} value={category} onChangeText={setCategory} onBlur={saveCategory} />
                </View>
              </View>

              <View style={styles.card}>
                <Text style={styles.sectionTitle}>{t('note')}</Text>
                <ClearableInput
                  style={[styles.input, styles.noteInput]}
                  value={note}
                  onChangeText={setNote}
                  multiline
                  textAlignVertical="top"
                  onBlur={saveNote}
                />
              </View>

              <View style={styles.paintsSection}>
                <View style={styles.paintsHeader}>
                  <Text style={styles.sectionTitle}>{t('usedPaints')}</Text>
                  <TouchableOpacity onPress={() => setPickerOpen(true)}>
                    <Text style={styles.addLink}>{t('addColor')}</Text>
                  </TouchableOpacity>
                </View>
                {paints.map((row) => (
                  <KitPaintRow
                    key={row.id}
                    row={row}
                    onNoteChange={(next) => changePaintNote(row.id, next)}
                    onRemove={() => removePaint(row.id)}
                  />
                ))}
              </View>
            </SwipeDownScrollView>
          )}

          <ActionSheet
            visible={boxPickerOpen}
            title={t('box')}
            buttons={[
              ...boxes.map((b) => ({ text: `${b.id === detail?.box_id ? '✓ ' : ''}${b.name}`, onPress: () => changeBox(b.id) })),
              { text: t('cancel'), style: 'cancel' },
            ]}
            onClose={() => setBoxPickerOpen(false)}
          />
          <ActionSheet
            visible={statusPickerOpen}
            title={t('status')}
            buttons={[
              ...STATUS_OPTIONS.map((o) => ({ text: `${o.value === detail?.status ? '✓ ' : ''}${t(o.labelKey)}`, onPress: () => changeStatus(o.value) })),
              { text: t('cancel'), style: 'cancel' },
            ]}
            onClose={() => setStatusPickerOpen(false)}
          />
          <ActionSheet
            visible={menuOpen}
            buttons={[
              { text: t('delete'), style: 'destructive', onPress: confirmDelete },
              { text: t('cancel'), style: 'cancel' },
            ]}
            onClose={() => setMenuOpen(false)}
          />
          {detail ? (
            <KitPaintPickerModal
              visible={pickerOpen}
              kitId={detail.id}
              onClose={() => setPickerOpen(false)}
              onAdded={load}
            />
          ) : null}
        </SafeAreaView>
        </SwipeBack>
      </SafeAreaProvider>
    </Modal>
  );
}

const makeStyles = (colors: typeof lightColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.xl, paddingVertical: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.borderLight },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  title: { fontSize: 18, fontWeight: 'bold', color: colors.text },
  scroll: { flex: 1 },
  content: { padding: spacing.xl, gap: spacing.lg },
  topRow: { flexDirection: 'row', gap: spacing.lg, alignItems: 'flex-start' },
  titleBlock: { flex: 1, gap: spacing.xs },
  name: { fontSize: 20, fontWeight: '700', color: colors.text },
  maker: { fontSize: 14, color: colors.textMuted },
  controlCard: { flexDirection: 'row', backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.borderLight, borderRadius: radius.md, padding: spacing.lg, gap: spacing.lg },
  control: { flex: 1, gap: spacing.sm },
  divider: { width: StyleSheet.hairlineWidth, backgroundColor: colors.borderLight },
  picker: { minHeight: 32, flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  pickerText: { flex: 1, color: colors.text, fontSize: 14, fontWeight: '600' },
  card: { backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.borderLight, borderRadius: radius.md, padding: spacing.lg, gap: spacing.md },
  field: { gap: spacing.xs },
  sectionTitle: { fontSize: 12, color: colors.textMuted, fontWeight: '600' },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: 10, color: colors.text },
  noteInput: { minHeight: 72, alignItems: 'flex-start' },
  paintsSection: { gap: spacing.md },
  paintsHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  addLink: { color: colors.primary, fontWeight: '700', fontSize: 14 },
  empty: { textAlign: 'center', marginTop: 40, color: colors.textPlaceholder },
});
```

Notable changes from the previous version, called out explicitly so a reviewer can check them:
- `changePhoto` (single-photo setter) is replaced by `addPhoto`/`removePhoto` (multi-photo).
- `closeAfterSavingNote` is renamed to `closeAfterSavingFields` and now also persists `series`/`category` if changed, in addition to `note` — updated at all 3 call sites (`onRequestClose` on the `Modal`, `SwipeDownHeader`'s `onClose`, `SwipeDownScrollView`'s `onClose`, and the header's X button `onPress`).
- `confirmDelete` now loops over ALL `photos` (not a single `detail.photo_uri`) when cleaning up files after `deleteKit`.
- Two new `field` blocks (series, category) added in a new `card` section between `controlCard` and the existing `note` card. A `field` style is added to `makeStyles` (did not exist before in this file).
- `topRow`'s `alignItems` changed from `'center'` to `'flex-start'` since the photo grid can now wrap to multiple rows and no longer has a fixed single-photo height to vertically center against.

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: no errors attributable to `components/KitDetailModal.tsx`.

- [ ] **Step 3: Commit**

```bash
git add components/KitDetailModal.tsx
git commit -m "feat: add series/category fields and multi-photo grid to kit detail modal"
```

---

### Task 6: Kit list screen — thumbnail query

**Files:**
- Modify: `app/(tabs)/kits.tsx`

**Interfaces:**
- Consumes: `kit_photos` table (Task 1) via a raw SQL subquery — no new `lib/db.ts` function needed for this (matches the existing pattern of this file already writing its own list-query SQL directly rather than going through a shared helper).

- [ ] **Step 1: Update `KitListItem` and the list query**

Find:

```ts
interface KitListItem {
  id: number;
  name: string;
  maker: string;
  scale: string | null;
  photo_uri: string | null;
  status: KitStatus;
}
```

Replace with:

```ts
interface KitListItem {
  id: number;
  name: string;
  maker: string;
  scale: string | null;
  thumb_uri: string | null;
  status: KitStatus;
}
```

Find, inside `load`:

```ts
    const rows = await getDB().getAllAsync<KitListItem>(
      'SELECT id, name, maker, scale, photo_uri, status FROM kits WHERE ' + where.join(' AND ') + ' ORDER BY added_at DESC',
      args
    );
```

Replace with:

```ts
    const rows = await getDB().getAllAsync<KitListItem>(
      'SELECT id, name, maker, scale, status,'
      + ' (SELECT uri FROM kit_photos WHERE kit_id = kits.id ORDER BY sort_order, id LIMIT 1) AS thumb_uri'
      + ' FROM kits WHERE ' + where.join(' AND ') + ' ORDER BY added_at DESC',
      args
    );
```

- [ ] **Step 2: Update the thumbnail rendering**

Find, inside the `FlatList`'s `renderItem`:

```tsx
            {item.photo_uri ? (
              <Image source={{ uri: item.photo_uri }} style={styles.thumb} resizeMode="cover" />
            ) : (
```

Replace with:

```tsx
            {item.thumb_uri ? (
              <Image source={{ uri: item.thumb_uri }} style={styles.thumb} resizeMode="cover" />
            ) : (
```

(Only the two `photo_uri` → `thumb_uri` occurrences change; the surrounding `View`/`IconBox` placeholder branch is unchanged.)

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: no errors attributable to `app/(tabs)/kits.tsx`.

- [ ] **Step 4: Commit**

```bash
git add "app/(tabs)/kits.tsx"
git commit -m "feat: show first kit photo as list thumbnail"
```

---

### Task 7: Kit box options — cascade-delete cleanup query

**Files:**
- Modify: `components/KitBoxOptions.tsx`

**Interfaces:**
- Consumes: `kit_photos` table (Task 1) via raw SQL, and the already-imported `deleteKitPhoto` from `../lib/kitPhoto` (no import change needed — it's already imported in this file from the prior plan's final-review fix).

- [ ] **Step 1: Update the photo cleanup query and add `kit_photos` to the cascade transaction**

Find the `remove` function's current body:

```ts
  const remove = async () => {
    const remaining = boxes.filter((item) => item.id !== box.id);
    const db = getDB();
    const photos = await db.getAllAsync<{ photo_uri: string }>('SELECT photo_uri FROM kits WHERE box_id = ? AND photo_uri IS NOT NULL', [box.id]);
    await db.withTransactionAsync(async () => {
      await db.runAsync('DELETE FROM kit_paints WHERE kit_id IN (SELECT id FROM kits WHERE box_id = ?)', [box.id]);
      await db.runAsync('DELETE FROM kits WHERE box_id = ?', [box.id]);
      await db.runAsync('DELETE FROM kit_boxes WHERE id = ?', [box.id]);
    });
    for (const { photo_uri } of photos) await deleteKitPhoto(photo_uri);
    notifyKitBoxesChanged();
    const next = remaining[0];
    setActiveKitBox(next ? next.id : 'all');
    router.navigate({ pathname: '/kits', params: { boxId: next ? String(next.id) : 'all', boxName: next ? next.name : (locale === 'ja' ? 'すべてのキットボックス' : 'All Kit Boxes') } });
  };
```

Replace with:

```ts
  const remove = async () => {
    const remaining = boxes.filter((item) => item.id !== box.id);
    const db = getDB();
    const photos = await db.getAllAsync<{ uri: string }>('SELECT uri FROM kit_photos WHERE kit_id IN (SELECT id FROM kits WHERE box_id = ?)', [box.id]);
    await db.withTransactionAsync(async () => {
      await db.runAsync('DELETE FROM kit_paints WHERE kit_id IN (SELECT id FROM kits WHERE box_id = ?)', [box.id]);
      await db.runAsync('DELETE FROM kit_photos WHERE kit_id IN (SELECT id FROM kits WHERE box_id = ?)', [box.id]);
      await db.runAsync('DELETE FROM kits WHERE box_id = ?', [box.id]);
      await db.runAsync('DELETE FROM kit_boxes WHERE id = ?', [box.id]);
    });
    for (const { uri } of photos) await deleteKitPhoto(uri);
    notifyKitBoxesChanged();
    const next = remaining[0];
    setActiveKitBox(next ? next.id : 'all');
    router.navigate({ pathname: '/kits', params: { boxId: next ? String(next.id) : 'all', boxName: next ? next.name : (locale === 'ja' ? 'すべてのキットボックス' : 'All Kit Boxes') } });
  };
```

The photo-URI query still runs BEFORE the transaction (reads while the kits/photos still exist), and `deleteKitPhoto` calls still happen AFTER the transaction commits (same ordering as the prior plan's final-review fix — do not change that ordering).

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: no errors attributable to `components/KitBoxOptions.tsx`.

- [ ] **Step 3: Commit**

```bash
git add components/KitBoxOptions.tsx
git commit -m "fix: clean up kit_photos (not just kits.photo_uri) on kit box deletion"
```

---

### Task 8: Remove the obsolete single-photo picker

**Files:**
- Delete: `components/KitPhotoPicker.tsx`

**Interfaces:**
- None — by this point (after Tasks 4 and 5), nothing imports `KitPhotoPicker` anymore. This task's job is to confirm that and remove the dead file.

- [ ] **Step 1: Confirm nothing still imports it**

Run: `grep -rn "KitPhotoPicker" --include="*.tsx" --include="*.ts" app components lib`
Expected: no matches (Tasks 4 and 5 already replaced both of its call sites with `KitPhotoGrid`). If any match appears, STOP — a caller was missed in an earlier task; report this rather than deleting the file out from under a live import.

- [ ] **Step 2: Delete the file**

```bash
git rm components/KitPhotoPicker.tsx
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: zero errors across the whole project — this is the first point since Task 1 where the FULL project (not just individual files) should be error-free, since every dependent file has now been updated.

- [ ] **Step 4: Commit**

```bash
git commit -m "chore: remove obsolete single-photo KitPhotoPicker component"
```

- [ ] **Step 5: Manual verification checklist (Expo Go)**

This is the final task of the plan — after this, the feature addition is complete. Perform these checks on a real device:

1. Open the app, navigate to the kit feature (drawer → a kit box, or "all kit boxes").
2. Tap "add kit" (FAB or empty-state button). Confirm the form now shows, in order: photo grid, name*, maker*, series, category, scale, note.
3. Add 3 photos via the "+" tile (mix of camera and gallery if possible). Confirm all 3 appear, the first one has a visibly different (colored) border.
4. Fill in name/maker (required) plus series="MG", category="ガンプラ", save.
5. Confirm the new kit appears in the list with the first photo as its thumbnail.
6. Tap the kit to open its detail page. Confirm series="MG" and category="ガンプラ" are shown in editable fields, and the photo grid shows the same 3 photos with the same first-photo border.
7. In the detail page, add a 4th photo. Confirm it's appended (not replacing anything).
8. Remove the 2nd photo (not the first). Confirm the remaining 3 photos display correctly and the ORIGINAL first photo is still the bordered/thumbnail one (i.e. removing a middle photo doesn't change which one is "first").
9. Add photos up to 10 total. Confirm the "+" add tile disappears once at 10.
10. Edit the series/category fields to new values, tap elsewhere to blur, close the modal, reopen — confirm the new values persisted.
11. Delete the kit via the "⋮" menu. Confirm it disappears from the list.
12. Create a new kit box, add a kit with 2 photos inside it, then delete the whole kit box from its "⋮" menu. Confirm no crash and the box disappears from the drawer/list (photo file cleanup itself can't be visually confirmed on-device without file system access, but no error should occur).

## Self-Review Notes

- **Spec coverage:** series/category fields on add + detail (Tasks 2, 4, 5) ✓; multi-photo up to 10 with first-photo-as-thumbnail (Tasks 1, 3, 4, 5, 6) ✓; add/remove only, no reorder UI (Task 3 deliberately has no drag/reorder controls) ✓; box-delete cascade updated for the new photo table (Task 7) ✓; obsolete component removed (Task 8) ✓.
- **Type consistency:** `KitPhoto` (Task 1) is imported by name, unaliased, in Task 5 (`KitDetailModal.tsx`) — no collision with anything else in that file (unlike the pre-existing `KitPaintRow` interface/component collision, which already has its established `KitPaintRowData` alias and is untouched by this plan). `KitPhotoGridItem` (Task 3) is used consistently by both Task 4 and Task 5's `.map()` calls into the same shape.
- **No placeholders:** every step has complete, runnable code.
