# Kit Management (キットボックス) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "kit box" system (parallel to the existing paint "box" system) so users can manage plastic model kits they own, and for each kit maintain a list of catalog paints used to build it (with a memo per color).

**Architecture:** Mirrors the existing paint-box architecture exactly, as a fully separate set of tables/screens/components. `kit_boxes` mirrors `boxes`. `kits` mirrors `inventory` but is self-contained (no separate "catalog" table for kits — manual entry only, per spec). `kit_paints` is a new join table linking a kit to `catalog_paints` rows (reused from the existing paint catalog) with a per-link memo.

**Tech Stack:** Expo SDK ~54 / React Native / expo-router / expo-sqlite. New deps: `expo-image-picker` (camera/gallery selection), `expo-file-system` (persist picked photos into the app's document directory).

**Note on verification:** This project has no test framework (`grep` confirms no jest/testing-library in `package.json`, no `*.test.ts` files exist). Every task's existing convention is `npx tsc --noEmit` + manual verification via Expo Go on a real device. This plan follows that same convention instead of inventing a test framework — each task's "verify" step is a `tsc` run plus a concrete manual check to perform in the running app.

## Global Constraints

- Every new/modified `.ts`/`.tsx`/`.json` file must have no UTF-8 BOM (verify with `head -c 3 <file> | od -An -tx1 | grep -q "ef bb bf"` — must NOT match) and must use the codebase's existing styling convention: `const { colors } = useTheme(); const styles = useMemo(() => makeStyles(colors), [colors]);`
- All user-facing strings go through `t('key')` from `lib/i18n.ts`; add matching keys to both `translations/ja.json` and `translations/en.json` in the same task, and re-verify key-parity after (`Object.keys(ja)` vs `Object.keys(en)` must match exactly).
- Follow the mandatory branch+PR workflow already established in this repo: this plan assumes it is executed on branch `feature/model-management` (already created from `master`). Do not commit to `master` directly.
- Reuse existing components/patterns instead of reimplementing them: `ActionSheet` (components/ActionSheet.tsx) for option menus, `SwipeDownHeader`/`SwipeDownScrollView` for modal headers/bodies, `ClearableInput` for text inputs, `EmptyState` for empty lists, `useModalLock` for any full-screen `Modal`.
- Explicitly out of scope for this plan (per the approved spec at `docs/superpowers/specs/2026-07-12-kit-management-design.md`): kit catalog/product database, barcode scanning for kits, Amazon product lookup, kit favorites/wishlist, elaborate "used colors" visual presentation, color-mixing registration.

---

### Task 1: Database schema, types, and query helpers

**Files:**
- Modify: `lib/db.ts`

**Interfaces:**
- Produces: `KitStatus` type, `KitDetail` interface, `KitPaintRow` interface, and functions `getKitDetail(kitId: number): Promise<KitDetail | null>`, `getKitPaints(kitId: number): Promise<KitPaintRow[]>`, `updateKitNote(kitId: number, note: string): Promise<void>`, `updateKitBox(kitId: number, boxId: number): Promise<void>`, `setKitStatus(kitId: number, status: KitStatus): Promise<void>`, `updateKitPhoto(kitId: number, photoUri: string | null): Promise<void>`, `addKitPaint(kitId: number, paintId: number): Promise<void>`, `updateKitPaintNote(kitPaintId: number, note: string): Promise<void>`, `removeKitPaint(kitPaintId: number): Promise<void>`, `deleteKit(kitId: number): Promise<void>` — all later tasks import these from `../../lib/db` (screens) or `../lib/db` (components).

- [ ] **Step 1: Add the `KitStatus` type next to `PaintStatus`**

Open `lib/db.ts`. Find line 6 (`export type PaintStatus = 'owned' | 'in_use' | 'used_up';`) and add directly below it:

```ts
export type KitStatus = 'not_started' | 'building' | 'completed';
```

- [ ] **Step 2: Add the three new tables to `initDB()`**

Find the `execAsync` call in `initDB()` that creates `app_settings` (around line 67-69):

```ts
    'CREATE TABLE IF NOT EXISTS app_settings (' +
    '  key TEXT PRIMARY KEY, value TEXT' +
    ');'
```

Change it to add three more `CREATE TABLE IF NOT EXISTS` statements right after (still inside the same string-concatenated `execAsync` call, before the closing `);` that ends the `db.execAsync(...)` call):

```ts
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

- [ ] **Step 3: Add `KitDetail`/`getKitDetail`/`updateKitNote`/`updateKitBox`/`setKitStatus`/`updateKitPhoto`/`deleteKit`**

Find `setInventoryStatus` (ends around line 325 with its closing `}`). Immediately after that function's closing brace, insert:

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

export async function updateKitNote(kitId: number, note: string): Promise<void> {
  const normalized = note.trim() === '' ? null : note;
  await getDB().runAsync(
    "UPDATE kits SET note = ?, status_changed_at = datetime('now') WHERE id = ?",
    [normalized, kitId]
  );
}

export async function updateKitBox(kitId: number, boxId: number): Promise<void> {
  await getDB().runAsync(
    "UPDATE kits SET box_id = ?, status_changed_at = datetime('now') WHERE id = ?",
    [boxId, kitId]
  );
}

export async function setKitStatus(kitId: number, status: KitStatus): Promise<void> {
  await getDB().runAsync(
    "UPDATE kits SET status = ?, status_changed_at = datetime('now') WHERE id = ?",
    [status, kitId]
  );
}

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

export interface KitPaintRow {
  id: number;
  paint_id: number;
  note: string | null;
  name_ja: string;
  name_en: string | null;
  code: string;
  brand: string;
  hex: string | null;
  gloss: string | null;
  paint_type: string | null;
}

export async function getKitPaints(kitId: number): Promise<KitPaintRow[]> {
  return getDB().getAllAsync<KitPaintRow>(
    'SELECT kp.id, kp.paint_id, kp.note, c.name_ja, c.name_en, c.code, c.brand, c.hex, c.gloss, c.paint_type'
    + ' FROM kit_paints kp JOIN catalog_paints c ON kp.paint_id = c.id'
    + ' WHERE kp.kit_id = ? ORDER BY kp.added_at',
    [kitId]
  );
}

export async function addKitPaint(kitId: number, paintId: number): Promise<void> {
  await getDB().runAsync(
    'INSERT INTO kit_paints (kit_id, paint_id) VALUES (?, ?)',
    [kitId, paintId]
  );
}

export async function updateKitPaintNote(kitPaintId: number, note: string): Promise<void> {
  const normalized = note.trim() === '' ? null : note;
  await getDB().runAsync('UPDATE kit_paints SET note = ? WHERE id = ?', [normalized, kitPaintId]);
}

export async function removeKitPaint(kitPaintId: number): Promise<void> {
  await getDB().runAsync('DELETE FROM kit_paints WHERE id = ?', [kitPaintId]);
}
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add lib/db.ts
git commit -m "feat: add kit_boxes/kits/kit_paints schema and query helpers"
```

---

### Task 2: Active kit box state (`lib/activeKitBox.ts`)

**Files:**
- Create: `lib/activeKitBox.ts`

**Interfaces:**
- Consumes: nothing (module-scope state, no imports from other new files)
- Produces: `ActiveKitBox` type (`number | 'all'`), `setActiveKitBox(next: ActiveKitBox): void`, `useActiveKitBox(): ActiveKitBox`, `notifyKitBoxesChanged(): void`, `useKitBoxesVersion(): number` — used by Task 5 (`KitBoxTitlePicker`/`KitBoxOptions`), Task 10 (`app/(tabs)/kits.tsx`), and Task 12 (`NavigationDrawer.tsx`).

- [ ] **Step 1: Create the file**

This is an exact structural mirror of `lib/activeBox.ts` (already in the codebase), renamed for kit boxes:

```ts
import { useEffect, useReducer } from 'react';

export type ActiveKitBox = number | 'all';

let activeKitBox: ActiveKitBox = 'all';
const listeners = new Set<() => void>();
let kitBoxesVersion = 0;
const kitBoxListeners = new Set<() => void>();

export function setActiveKitBox(next: ActiveKitBox): void {
  if (activeKitBox === next) return;
  activeKitBox = next;
  listeners.forEach((listener) => listener());
}

export function useActiveKitBox(): ActiveKitBox {
  const [, force] = useReducer((value) => value + 1, 0);
  useEffect(() => { listeners.add(force); return () => { listeners.delete(force); }; }, []);
  return activeKitBox;
}

export function notifyKitBoxesChanged(): void {
  kitBoxesVersion += 1;
  kitBoxListeners.forEach((listener) => listener());
}

export function useKitBoxesVersion(): number {
  const [, force] = useReducer((value) => value + 1, 0);
  useEffect(() => { kitBoxListeners.add(force); return () => { kitBoxListeners.delete(force); }; }, []);
  return kitBoxesVersion;
}
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: no errors (this file has no consumers yet, so it just needs to type-check standalone).

- [ ] **Step 3: Commit**

```bash
git add lib/activeKitBox.ts
git commit -m "feat: add active-kit-box state module"
```

---

### Task 3: Kit photo persistence (`lib/kitPhoto.ts`) + dependencies

**Files:**
- Modify: `package.json` (adds `expo-image-picker`, `expo-file-system`)
- Create: `lib/kitPhoto.ts`

**Interfaces:**
- Produces: `pickKitPhotoFromCamera(): Promise<string | null>`, `pickKitPhotoFromLibrary(): Promise<string | null>`, `deleteKitPhoto(photoUri: string | null): Promise<void>` — consumed by Task 6 (`KitPhotoPicker`).

- [ ] **Step 1: Install dependencies**

Run: `npx expo install expo-image-picker expo-file-system`
Expected: adds both packages at Expo-SDK-54-compatible versions to `package.json`/`package-lock.json`. No manual version pinning needed — `expo install` resolves the correct version automatically.

- [ ] **Step 2: Create `lib/kitPhoto.ts`**

Note: `expo-image-picker`'s `mediaTypes` option takes an array of string literals (`'images'`), NOT the deprecated `MediaTypeOptions` enum — do not use `MediaTypeOptions.Images`, it is deprecated in the installed SDK-54-era version.

```ts
// lib/kitPhoto.ts
// キット写真の選択・永続化。ImagePickerが返す一時URIは端末側のキャッシュ整理で
// 消える可能性があるため、documentDirectory配下にコピーしてから保存する。
import * as FileSystem from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';

const KIT_PHOTO_DIR = `${FileSystem.documentDirectory}kit-photos/`;

async function ensureDir(): Promise<void> {
  const info = await FileSystem.getInfoAsync(KIT_PHOTO_DIR);
  if (!info.exists) await FileSystem.makeDirectoryAsync(KIT_PHOTO_DIR, { intermediates: true });
}

async function persist(sourceUri: string): Promise<string> {
  await ensureDir();
  const dest = `${KIT_PHOTO_DIR}${Date.now()}.jpg`;
  await FileSystem.copyAsync({ from: sourceUri, to: dest });
  return dest;
}

export async function pickKitPhotoFromCamera(): Promise<string | null> {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) return null;
  const result = await ImagePicker.launchCameraAsync({ quality: 0.7 });
  if (result.canceled || !result.assets[0]) return null;
  return persist(result.assets[0].uri);
}

export async function pickKitPhotoFromLibrary(): Promise<string | null> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) return null;
  const result = await ImagePicker.launchImageLibraryAsync({ quality: 0.7, mediaTypes: ['images'] });
  if (result.canceled || !result.assets[0]) return null;
  return persist(result.assets[0].uri);
}

export async function deleteKitPhoto(photoUri: string | null): Promise<void> {
  if (!photoUri || !photoUri.startsWith(KIT_PHOTO_DIR)) return;
  await FileSystem.deleteAsync(photoUri, { idempotent: true });
}
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json lib/kitPhoto.ts
git commit -m "feat: add kit photo capture/persistence helper"
```

---

### Task 4: Translations

**Files:**
- Modify: `translations/ja.json`
- Modify: `translations/en.json`

**Interfaces:**
- Produces: translation keys consumed via `t('key')` by every component task below. Exact key list: `kits`, `allKitBoxes`, `addKit`, `addKitBox`, `kitDetailTitle`, `maker`, `scale`, `statusNotStarted`, `statusBuilding`, `statusCompleted`, `usedPaints`, `addColor`, `emptyKits`, `deleteKitConfirm`, `deleteKitBoxConfirm`, `kitPhoto`, `takePhoto`, `chooseFromLibrary`, `removePhoto`.

- [ ] **Step 1: Add keys to `translations/ja.json`**

This file is single-line JSON (one object, no pretty-printing). Open it, and before the final closing `}`, add the new keys (comma-separated, matching the existing flat-key style):

```json
"kits":"キット","allKitBoxes":"すべてのキットボックス","addKit":"キットを追加","addKitBox":"キットボックスを追加","kitDetailTitle":"キット詳細","maker":"メーカー","scale":"スケール","statusNotStarted":"未着手","statusBuilding":"制作中","statusCompleted":"完成","usedPaints":"使用する色","addColor":"色を追加","emptyKits":"キットがありません","deleteKitConfirm":"このキットを削除しますか？この操作は元に戻せません。","deleteKitBoxConfirm":"このキットボックスを削除しますか？登録されているキットもすべて削除され、この操作は元に戻せません。","kitPhoto":"写真","takePhoto":"カメラで撮影","chooseFromLibrary":"ギャラリーから選択","removePhoto":"写真を削除"
```

- [ ] **Step 2: Add keys to `translations/en.json`**

Same insertion point, English values:

```json
"kits":"Kits","allKitBoxes":"All Kit Boxes","addKit":"Add Kit","addKitBox":"Add Kit Box","kitDetailTitle":"Kit Detail","maker":"Maker","scale":"Scale","statusNotStarted":"Not Started","statusBuilding":"Building","statusCompleted":"Completed","usedPaints":"Colors Used","addColor":"Add Color","emptyKits":"No kits yet","deleteKitConfirm":"Delete this kit? This cannot be undone.","deleteKitBoxConfirm":"Delete this kit box? All kits in it will also be deleted. This cannot be undone.","kitPhoto":"Photo","takePhoto":"Take Photo","chooseFromLibrary":"Choose from Library","removePhoto":"Remove Photo"
```

- [ ] **Step 3: Verify JSON validity and key parity**

Run:
```bash
node -e "
const ja = require('./translations/ja.json');
const en = require('./translations/en.json');
const jaKeys = Object.keys(ja).sort();
const enKeys = Object.keys(en).sort();
console.log('ja:', jaKeys.length, 'en:', enKeys.length);
console.log('missing in en:', jaKeys.filter(k => !enKeys.includes(k)));
console.log('missing in ja:', enKeys.filter(k => !jaKeys.includes(k)));
"
```
Expected: `ja:` and `en:` counts equal (135), both "missing in" arrays empty.

Also verify no BOM: `head -c 3 translations/ja.json | od -An -tx1 | grep -q "ef bb bf"` and same for `en.json` — both must NOT match (exit non-zero).

- [ ] **Step 4: Commit**

```bash
git add translations/ja.json translations/en.json
git commit -m "feat: add translation keys for kit management"
```

---

### Task 5: Kit box header components (`KitBoxTitlePicker`, `KitBoxOptions`)

**Files:**
- Create: `components/KitBoxTitlePicker.tsx`
- Create: `components/KitBoxOptions.tsx`

**Interfaces:**
- Consumes: `useActiveKitBox`/`setActiveKitBox`/`useKitBoxesVersion` from `../lib/activeKitBox` (Task 2), `ActionSheet`/`ActionSheetButton` from `./ActionSheet`, `BoxEditorModal`/`BoxDraft`/`BoxIcon` from `./BoxEditorModal` (existing, generic — reused as-is since its props are just `{name, icon, color}` with no paint-specific fields), `BoxOrderModal` from `./BoxOrderModal` (existing, generic).
- Produces: default-exported `KitBoxTitlePicker` (no props) and `KitBoxOptions` (no props), used by Task 11 (`app/(tabs)/_layout.tsx`).

- [ ] **Step 1: Create `components/KitBoxTitlePicker.tsx`**

Exact mirror of `components/BoxTitlePicker.tsx`, retargeted at `kit_boxes` and the `/kits` route:

```tsx
import { useEffect, useState } from 'react';
import { Text, TouchableOpacity } from 'react-native';
import { IconChevronDown } from '@tabler/icons-react-native';
import { router } from 'expo-router';
import { useActiveKitBox, setActiveKitBox, useKitBoxesVersion } from '../lib/activeKitBox';
import { getDB } from '../lib/db';
import { useLocale } from '../lib/i18n';
import { useTheme } from '../lib/theme';
import ActionSheet, { ActionSheetButton } from './ActionSheet';

interface Box { id: number; name: string; }

export default function KitBoxTitlePicker() {
  const { colors } = useTheme();
  const locale = useLocale();
  const activeBox = useActiveKitBox();
  const boxesVersion = useKitBoxesVersion();
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [open, setOpen] = useState(false);
  useEffect(() => { getDB().getAllAsync<Box>('SELECT id, name FROM kit_boxes ORDER BY sort_order, id').then(setBoxes); }, [open, boxesVersion]);
  const allLabel = locale === 'ja' ? 'すべてのキットボックス' : 'All Kit Boxes';
  const label = activeBox === 'all' ? allLabel : boxes.find((box) => box.id === activeBox)?.name ?? '';
  const choose = (boxId: number | 'all') => {
    setActiveKitBox(boxId);
    router.navigate({ pathname: '/kits', params: { boxId: String(boxId), boxName: boxId === 'all' ? allLabel : boxes.find((box) => box.id === boxId)?.name ?? '' } });
  };
  const buttons: ActionSheetButton[] = [
    { text: `${activeBox === 'all' ? '✓ ' : ''}${allLabel}`, onPress: () => choose('all') },
    ...boxes.map((box) => ({ text: `${activeBox === box.id ? '✓ ' : ''}${box.name}`, onPress: () => choose(box.id) })),
    { text: locale === 'ja' ? 'キャンセル' : 'Cancel', style: 'cancel' },
  ];
  return <><TouchableOpacity onPress={() => setOpen(true)} style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }} accessibilityRole="button" accessibilityLabel={label}>
    <Text style={{ color: colors.text, fontSize: 17, fontWeight: '600' }} numberOfLines={1}>{label}</Text><IconChevronDown color={colors.textMuted} size={18} />
  </TouchableOpacity><ActionSheet visible={open} buttons={buttons} onClose={() => setOpen(false)} /></>;
}
```

- [ ] **Step 2: Create `components/KitBoxOptions.tsx`**

Mirror of `components/BoxOptions.tsx`, simplified: kits have no "default box" concept (not part of the spec), so the "make default" menu item and `getDefaultBoxId`/`setSetting` calls are dropped. Deleting a kit box cascade-deletes its kits' `kit_paints` rows too (kits table has no FK constraint enforcement in SQLite by default, so this must be explicit).

```tsx
import { useEffect, useState } from 'react';
import { Alert, TouchableOpacity } from 'react-native';
import { IconDotsVertical } from '@tabler/icons-react-native';
import { router } from 'expo-router';
import { useActiveKitBox, notifyKitBoxesChanged, setActiveKitBox, useKitBoxesVersion } from '../lib/activeKitBox';
import { getDB } from '../lib/db';
import { t, useLocale } from '../lib/i18n';
import { useTheme } from '../lib/theme';
import ActionSheet, { ActionSheetButton } from './ActionSheet';
import BoxEditorModal, { BoxDraft, BoxIcon } from './BoxEditorModal';
import BoxOrderModal from './BoxOrderModal';

interface Box { id: number; name: string; icon: BoxIcon | null; icon_color: string | null; }

export default function KitBoxOptions() {
  const { colors } = useTheme();
  const locale = useLocale();
  const activeBox = useActiveKitBox();
  const boxesVersion = useKitBoxesVersion();
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [ordering, setOrdering] = useState(false);
  const box = activeBox === 'all' ? null : boxes.find((item) => item.id === activeBox) ?? null;
  const editLabel = locale === 'ja' ? 'ボックスを編集' : 'Edit Box';

  useEffect(() => {
    getDB().getAllAsync<Box>('SELECT id, name, icon, icon_color FROM kit_boxes ORDER BY sort_order, id').then(setBoxes);
  }, [activeBox, boxesVersion]);

  if (!box) return null;

  const save = async ({ name, icon, color }: BoxDraft) => {
    await getDB().runAsync('UPDATE kit_boxes SET name = ?, icon = ?, icon_color = ? WHERE id = ?', [name, icon, color, box.id]);
    notifyKitBoxesChanged();
  };

  const remove = async () => {
    const remaining = boxes.filter((item) => item.id !== box.id);
    const db = getDB();
    await db.withTransactionAsync(async () => {
      await db.runAsync('DELETE FROM kit_paints WHERE kit_id IN (SELECT id FROM kits WHERE box_id = ?)', [box.id]);
      await db.runAsync('DELETE FROM kits WHERE box_id = ?', [box.id]);
      await db.runAsync('DELETE FROM kit_boxes WHERE id = ?', [box.id]);
    });
    notifyKitBoxesChanged();
    const next = remaining[0];
    setActiveKitBox(next ? next.id : 'all');
    router.navigate({ pathname: '/kits', params: { boxId: next ? String(next.id) : 'all', boxName: next ? next.name : (locale === 'ja' ? 'すべてのキットボックス' : 'All Kit Boxes') } });
  };

  const confirmDelete = () => Alert.alert(box.name, t('deleteKitBoxConfirm'), [
    { text: t('cancel'), style: 'cancel' },
    { text: t('delete'), style: 'destructive', onPress: remove },
  ]);

  const saveOrder = async (ids: number[]) => {
    await getDB().withTransactionAsync(async () => {
      for (const [index, id] of ids.entries()) await getDB().runAsync('UPDATE kit_boxes SET sort_order = ? WHERE id = ?', [index, id]);
    });
    setBoxes((current) => ids.map((id) => current.find((item) => item.id === id)!).filter(Boolean));
    notifyKitBoxesChanged();
  };

  const buttons: ActionSheetButton[] = [
    { text: locale === 'ja' ? 'ボックスを並び替え' : 'Reorder Boxes', onPress: () => setOrdering(true) },
    { text: editLabel, onPress: () => setEditing(true) },
    ...(boxes.length > 1 ? [{ text: t('delete'), style: 'destructive' as const, onPress: confirmDelete }] : []),
    { text: t('cancel'), style: 'cancel' },
  ];

  return <>
    <TouchableOpacity onPress={() => setOptionsOpen(true)} accessibilityRole="button" accessibilityLabel="Kit box options" hitSlop={12} style={{ marginRight: 16 }}>
      <IconDotsVertical color={colors.text} size={24} />
    </TouchableOpacity>
    <ActionSheet visible={optionsOpen} title={box.name} buttons={buttons} onClose={() => setOptionsOpen(false)} />
    <BoxEditorModal visible={editing} title={editLabel} initial={{ name: box.name, icon: box.icon ?? 'box', color: box.icon_color ?? colors.primary }} onSave={save} onClose={() => setEditing(false)} />
    <BoxOrderModal visible={ordering} boxes={boxes} onSave={saveOrder} onClose={() => setOrdering(false)} />
  </>;
}
```

Note: unlike `BoxOptions.tsx`, `remove` here does not early-return when `remaining.length === 0` — deleting the last kit box is allowed (falls back to `'all'`), since kits have no "must always have one default box" requirement the way paints do.

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: no errors. (These two files have no consumers yet — they'll be wired into the tab layout in Task 11 — so this only checks standalone type correctness.)

- [ ] **Step 3: Commit**

```bash
git add components/KitBoxTitlePicker.tsx components/KitBoxOptions.tsx
git commit -m "feat: add kit box header title picker and options menu"
```

---

### Task 6: Kit photo picker UI (`components/KitPhotoPicker.tsx`)

**Files:**
- Create: `components/KitPhotoPicker.tsx`

**Interfaces:**
- Consumes: `pickKitPhotoFromCamera`/`pickKitPhotoFromLibrary` from `../lib/kitPhoto` (Task 3).
- Produces: default-exported `KitPhotoPicker({ photoUri, onChange }: { photoUri: string | null; onChange: (uri: string | null) => void })` — consumed by Task 7 (`AddKitModal`) and Task 9 (`KitDetailModal`).

- [ ] **Step 1: Create the component**

A square tappable area: shows the photo if set, otherwise a placeholder icon. Tapping opens an `ActionSheet` with take-photo / choose-from-library / remove-photo (remove only shown when a photo exists).

```tsx
// components/KitPhotoPicker.tsx
import { useMemo, useState } from 'react';
import { Image, StyleSheet, TouchableOpacity, View } from 'react-native';
import { IconCamera } from '@tabler/icons-react-native';
import { pickKitPhotoFromCamera, pickKitPhotoFromLibrary } from '../lib/kitPhoto';
import { t } from '../lib/i18n';
import { lightColors, radius, useTheme } from '../lib/theme';
import ActionSheet, { ActionSheetButton } from './ActionSheet';

interface Props {
  photoUri: string | null;
  onChange: (uri: string | null) => void;
}

export default function KitPhotoPicker({ photoUri, onChange }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [open, setOpen] = useState(false);

  const takePhoto = async () => {
    const uri = await pickKitPhotoFromCamera();
    if (uri) onChange(uri);
  };
  const chooseFromLibrary = async () => {
    const uri = await pickKitPhotoFromLibrary();
    if (uri) onChange(uri);
  };

  const buttons: ActionSheetButton[] = [
    { text: t('takePhoto'), onPress: takePhoto },
    { text: t('chooseFromLibrary'), onPress: chooseFromLibrary },
    ...(photoUri ? [{ text: t('removePhoto'), style: 'destructive' as const, onPress: () => onChange(null) }] : []),
    { text: t('cancel'), style: 'cancel' },
  ];

  return (
    <>
      <TouchableOpacity style={styles.box} onPress={() => setOpen(true)} accessibilityRole="button" accessibilityLabel={t('kitPhoto')}>
        {photoUri ? (
          <Image source={{ uri: photoUri }} style={styles.image} resizeMode="cover" />
        ) : (
          <View style={styles.placeholder}><IconCamera color={colors.textFaint} size={32} /></View>
        )}
      </TouchableOpacity>
      <ActionSheet visible={open} title={t('kitPhoto')} buttons={buttons} onClose={() => setOpen(false)} />
    </>
  );
}

const makeStyles = (colors: typeof lightColors) => StyleSheet.create({
  box: { width: 96, height: 96, borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.borderLight },
  image: { width: '100%', height: '100%' },
  placeholder: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/KitPhotoPicker.tsx
git commit -m "feat: add kit photo picker component"
```

---

### Task 7: Add-kit modal (`components/AddKitModal.tsx`)

**Files:**
- Create: `components/AddKitModal.tsx`

**Interfaces:**
- Consumes: `KitPhotoPicker` (Task 6), `getDB` from `../lib/db` (Task 1 schema), `notifyKitBoxesChanged` is NOT needed here (adding a kit doesn't change box list) but the caller needs a refresh callback.
- Produces: default-exported `AddKitModal({ visible, defaultBoxId, onClose }: { visible: boolean; defaultBoxId: number | null; onClose: () => void })`. `onClose` is called both on cancel and after a successful save (mirrors how `AddPaintModal`'s `onClose` doubles as "closed, please reload" signal in `owned.tsx`) — consumed by Task 10 (`app/(tabs)/kits.tsx`).

- [ ] **Step 1: Create the component**

A single manual-entry form (no tabs — per spec, kits are manual-entry only). Required fields: name, maker. Optional: scale, note, photo. Status defaults to `not_started`. Box defaults to whatever box is currently active (or none, for "all boxes" view).

```tsx
// components/AddKitModal.tsx
import { useEffect, useState } from 'react';
import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { IconX } from '@tabler/icons-react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { getDB } from '../lib/db';
import { t } from '../lib/i18n';
import { useModalLock } from '../lib/modalLock';
import { lightColors, radius, spacing, useTheme } from '../lib/theme';
import ClearableInput from './ClearableInput';
import KitPhotoPicker from './KitPhotoPicker';
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
  const [scale, setScale] = useState('');
  const [note, setNote] = useState('');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const canSave = name.trim() !== '' && maker.trim() !== '';

  useEffect(() => {
    if (visible) { setName(''); setMaker(''); setScale(''); setNote(''); setPhotoUri(null); }
  }, [visible]);

  const save = async () => {
    if (!canSave) return;
    await getDB().runAsync(
      'INSERT INTO kits (box_id, name, maker, scale, note, photo_uri, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [defaultBoxId, name.trim(), maker.trim(), scale.trim() || null, note.trim() || null, photoUri, 'not_started']
    );
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
            <KitPhotoPicker photoUri={photoUri} onChange={setPhotoUri} />
            <View style={styles.field}>
              <Text style={styles.label}>{t('name')}*</Text>
              <ClearableInput style={styles.input} value={name} onChangeText={setName} />
            </View>
            <View style={styles.field}>
              <Text style={styles.label}>{t('maker')}*</Text>
              <ClearableInput style={styles.input} value={maker} onChangeText={setMaker} />
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

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/AddKitModal.tsx
git commit -m "feat: add manual kit entry modal"
```

---

### Task 8: Paint picker + row for kit colors (`KitPaintPickerModal`, `KitPaintRow`)

**Files:**
- Create: `components/KitPaintPickerModal.tsx`
- Create: `components/KitPaintRow.tsx`

**Interfaces:**
- Consumes: `addKitPaint` from `../lib/db` (Task 1), `getDB` for the search query.
- Produces: default-exported `KitPaintPickerModal({ visible, kitId, onClose, onAdded }: { visible: boolean; kitId: number; onClose: () => void; onAdded: () => void })` and `KitPaintRow({ row, onNoteChange, onRemove }: { row: KitPaintRow; onNoteChange: (note: string) => void; onRemove: () => void })` (the `row` prop's type is the `KitPaintRow` interface from `lib/db.ts`, Task 1 — note the component and the interface share a name but live in different modules, matching the existing codebase convention e.g. `PaintRow` component vs no naming clash here since `lib/db.ts`'s export is `KitPaintRow` the interface and this file's default export is `KitPaintRow` the component; import the interface as `KitPaintRow as KitPaintRowData` in the component's own file to avoid a naming collision) — consumed by Task 9 (`KitDetailModal`).

- [ ] **Step 1: Create `components/KitPaintPickerModal.tsx`**

Search-and-tap-to-add, mirroring `components/AddPaint/TextSearch.tsx`'s search pattern but simplified (no owned-count badge, since that's paint-inventory-specific and irrelevant here). Adding is immediate (empty note; the note is edited afterward inline on the row) with toast feedback, and the modal stays open so multiple colors can be added in one session.

```tsx
// components/KitPaintPickerModal.tsx
import { useState } from 'react';
import { FlatList, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { IconPlus, IconX } from '@tabler/icons-react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { addKitPaint, getDB } from '../lib/db';
import { t } from '../lib/i18n';
import { paintName } from '../lib/paintLabel';
import { useModalLock } from '../lib/modalLock';
import { lightColors, radius, spacing, touch, useTheme } from '../lib/theme';
import ClearableInput from './ClearableInput';
import PaintRow from './PaintRow';
import SwipeDownHeader from './SwipeDownHeader';
import Toast from './Toast';

interface Paint {
  id: number;
  name_ja: string;
  name_en: string | null;
  code: string;
  brand: string;
  hex: string;
  gloss: string | null;
  paint_type: string | null;
}

interface Props {
  visible: boolean;
  kitId: number;
  onClose: () => void;
  onAdded: () => void;
}

export default function KitPaintPickerModal({ visible, kitId, onClose, onAdded }: Props) {
  useModalLock(visible);
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Paint[]>([]);
  const [toast, setToast] = useState('');

  const search = async (q: string) => {
    setQuery(q);
    if (!q.trim()) { setResults([]); return; }
    const rows = await getDB().getAllAsync<Paint>(
      'SELECT id, name_ja, name_en, code, brand, hex, gloss, paint_type FROM catalog_paints'
      + ' WHERE name_ja LIKE ? OR name_en LIKE ? OR brand LIKE ? OR series LIKE ?'
      + ' LIMIT 50',
      [`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`]
    );
    setResults(rows);
  };

  const add = async (paint: Paint) => {
    await addKitPaint(kitId, paint.id);
    onAdded();
    setToast(paintName(paint.name_ja, paint.name_en) + t('addedToast'));
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaProvider>
        <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
          <SwipeDownHeader onClose={onClose}>
            <View style={styles.header}>
              <Text style={styles.title}>{t('addColor')}</Text>
              <TouchableOpacity onPress={onClose} hitSlop={8}>
                <IconX color={colors.text} size={24} />
              </TouchableOpacity>
            </View>
          </SwipeDownHeader>
          <ClearableInput style={styles.input} placeholder={t('searchPlaceholder')} value={query} onChangeText={search} />
          <FlatList
            data={results}
            keyExtractor={(item) => String(item.id)}
            keyboardDismissMode="on-drag"
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => (
              <PaintRow paint={item}>
                <TouchableOpacity style={styles.addBtn} onPress={() => add(item)}>
                  <IconPlus color={colors.onPrimary} size={22} />
                </TouchableOpacity>
              </PaintRow>
            )}
          />
          <Toast message={toast} />
        </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
}

const makeStyles = (colors: typeof lightColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.xl, paddingVertical: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.borderLight },
  title: { fontSize: 18, fontWeight: 'bold', color: colors.text },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: 10, margin: spacing.lg, color: colors.text },
  addBtn: { width: touch.min, height: touch.min, borderRadius: 22, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', marginLeft: spacing.md },
});
```

Note: `PaintRow` (existing component) expects a paint object with `id/name_ja/name_en/code/brand/hex/gloss/paint_type` — the local `Paint` interface above matches that shape exactly (same fields `TextSearch.tsx` uses), so no adapter is needed.

- [ ] **Step 2: Create `components/KitPaintRow.tsx`**

A single row: color swatch, name/brand, an inline-editable memo (saves on blur, mirrors `InventoryDetailModal`'s note field), and a delete button.

```tsx
// components/KitPaintRow.tsx
import { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { IconTrash } from '@tabler/icons-react-native';
import { KitPaintRow as KitPaintRowData } from '../lib/db';
import { brandLabel } from '../lib/brands';
import { t } from '../lib/i18n';
import { paintName } from '../lib/paintLabel';
import { lightColors, radius, spacing, touch, useTheme } from '../lib/theme';
import ClearableInput from './ClearableInput';

interface Props {
  row: KitPaintRowData;
  onNoteChange: (note: string) => void;
  onRemove: () => void;
}

export default function KitPaintRow({ row, onNoteChange, onRemove }: Props) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const [note, setNote] = useState(row.note ?? '');

  return (
    <View style={styles.row}>
      <View style={styles.top}>
        <View style={[styles.swatch, { backgroundColor: row.hex ?? colors.transparent }]} />
        <View style={styles.info}>
          <Text numberOfLines={1} style={styles.name}>{paintName(row.name_ja, row.name_en)}</Text>
          <Text numberOfLines={1} style={styles.sub}>{brandLabel(row.brand)}{row.code ? ` · ${row.code}` : ''}</Text>
        </View>
        <TouchableOpacity onPress={onRemove} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('delete')}>
          <IconTrash color={colors.danger} size={20} />
        </TouchableOpacity>
      </View>
      <ClearableInput
        style={styles.noteInput}
        value={note}
        onChangeText={setNote}
        onBlur={() => onNoteChange(note)}
        placeholder={t('note')}
      />
    </View>
  );
}

const makeStyles = (colors: typeof lightColors) => StyleSheet.create({
  row: { borderWidth: 1, borderColor: colors.borderLight, borderRadius: radius.md, padding: spacing.md, gap: spacing.sm },
  top: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  swatch: { width: 32, height: 32, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border },
  info: { flex: 1 },
  name: { fontSize: 15, fontWeight: '600', color: colors.text },
  sub: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  noteInput: { minHeight: touch.min, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: 10, color: colors.text, fontSize: 13 },
});
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: no errors. Pay attention to the `KitPaintRow as KitPaintRowData` import alias in `components/KitPaintRow.tsx` — if it's missing or misspelled, `tsc` will report the component's own `Props.row` type as unresolved.

- [ ] **Step 4: Commit**

```bash
git add components/KitPaintPickerModal.tsx components/KitPaintRow.tsx
git commit -m "feat: add kit-paint search picker and row components"
```

---

### Task 9: Kit detail modal (`components/KitDetailModal.tsx`)

**Files:**
- Create: `components/KitDetailModal.tsx`

**Interfaces:**
- Consumes: `getKitDetail`, `getKitPaints`, `updateKitNote`, `updateKitBox`, `setKitStatus`, `updateKitPhoto`, `updateKitPaintNote`, `removeKitPaint`, `deleteKit`, `KitDetail`, `KitStatus` from `../lib/db` (Task 1); `KitPhotoPicker` (Task 6); `KitPaintPickerModal`, `KitPaintRow` (Task 8); `deleteKitPhoto` from `../lib/kitPhoto` (Task 3, called when the user replaces/removes a photo so orphaned files don't accumulate).
- Produces: default-exported `KitDetailModal({ visible, kitId, onClose, onChanged }: { visible: boolean; kitId: number | null; onClose: () => void; onChanged?: () => void })` — consumed by Task 10 (`app/(tabs)/kits.tsx`).

- [ ] **Step 1: Create the component**

Structurally mirrors `components/InventoryDetailModal.tsx` (header with `SwipeDownHeader`, `SwipeDownScrollView` body, `ActionSheet`-based box/status pickers) but without the elaborate color-swatch/tone-rail treatment (kits have no comparable "color" of their own — a photo fills that visual role) and with the new "used colors" section appended at the bottom.

```tsx
// components/KitDetailModal.tsx
import { useCallback, useEffect, useState } from 'react';
import { Alert, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { IconChevronDown, IconDotsVertical, IconX } from '@tabler/icons-react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import {
  deleteKit,
  getKitDetail,
  getKitPaints,
  KitDetail,
  KitPaintRow as KitPaintRowData,
  KitStatus,
  removeKitPaint,
  setKitStatus,
  updateKitBox,
  updateKitNote,
  updateKitPaintNote,
  updateKitPhoto,
} from '../lib/db';
import { deleteKitPhoto } from '../lib/kitPhoto';
import { getDB } from '../lib/db';
import { t } from '../lib/i18n';
import { useModalLock } from '../lib/modalLock';
import { lightColors, radius, spacing, useTheme } from '../lib/theme';
import ActionSheet from './ActionSheet';
import ClearableInput from './ClearableInput';
import KitPaintPickerModal from './KitPaintPickerModal';
import KitPaintRow from './KitPaintRow';
import KitPhotoPicker from './KitPhotoPicker';
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
  const [note, setNote] = useState('');
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [boxPickerOpen, setBoxPickerOpen] = useState(false);
  const [statusPickerOpen, setStatusPickerOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const load = useCallback(async () => {
    if (kitId == null) return;
    const [row, paintRows] = await Promise.all([getKitDetail(kitId), getKitPaints(kitId)]);
    setDetail(row);
    setPaints(paintRows);
    setNote(row?.note ?? '');
  }, [kitId]);

  useEffect(() => {
    if (visible) {
      load();
      getDB().getAllAsync<Box>('SELECT id, name FROM kit_boxes ORDER BY sort_order, id').then(setBoxes);
    } else {
      setDetail(null);
      setPaints([]);
      setNote('');
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

  const closeAfterSavingNote = async () => {
    if (detail && note !== (detail.note ?? '')) {
      await updateKitNote(detail.id, note);
      onChanged?.();
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

  const changePhoto = async (uri: string | null) => {
    if (!detail) return;
    const previous = detail.photo_uri;
    await updateKitPhoto(detail.id, uri);
    if (previous && previous !== uri) await deleteKitPhoto(previous);
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
          if (detail.photo_uri) await deleteKitPhoto(detail.photo_uri);
          onChanged?.();
          onClose();
        },
      },
    ]);
  };

  const boxName = boxes.find((b) => b.id === detail?.box_id)?.name ?? t('unassigned');

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={closeAfterSavingNote}>
      <SafeAreaProvider>
        <SwipeBack enabled={visible} onBack={closeAfterSavingNote}>
        <SafeAreaView style={styles.container} edges={['top']}>
          <SwipeDownHeader onClose={closeAfterSavingNote}>
            <View style={styles.header}>
              <Text style={styles.title}>{t('kitDetailTitle')}</Text>
              <View style={styles.headerActions}>
                <TouchableOpacity onPress={() => setMenuOpen(true)} hitSlop={8}>
                  <IconDotsVertical color={colors.text} size={22} />
                </TouchableOpacity>
                <TouchableOpacity onPress={closeAfterSavingNote} hitSlop={8}>
                  <IconX color={colors.text} size={24} />
                </TouchableOpacity>
              </View>
            </View>
          </SwipeDownHeader>

          {!detail ? (
            <Text style={styles.empty}>{t('noResults')}</Text>
          ) : (
            <SwipeDownScrollView style={styles.scroll} onClose={closeAfterSavingNote} contentContainerStyle={styles.content} keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled">
              <View style={styles.topRow}>
                <KitPhotoPicker photoUri={detail.photo_uri} onChange={changePhoto} />
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
  topRow: { flexDirection: 'row', gap: spacing.lg, alignItems: 'center' },
  titleBlock: { flex: 1, gap: spacing.xs },
  name: { fontSize: 20, fontWeight: '700', color: colors.text },
  maker: { fontSize: 14, color: colors.textMuted },
  controlCard: { flexDirection: 'row', backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.borderLight, borderRadius: radius.md, padding: spacing.lg, gap: spacing.lg },
  control: { flex: 1, gap: spacing.sm },
  divider: { width: StyleSheet.hairlineWidth, backgroundColor: colors.borderLight },
  picker: { minHeight: 32, flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  pickerText: { flex: 1, color: colors.text, fontSize: 14, fontWeight: '600' },
  card: { backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.borderLight, borderRadius: radius.md, padding: spacing.lg, gap: spacing.md },
  sectionTitle: { fontSize: 12, color: colors.textMuted, fontWeight: '600' },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: 10, color: colors.text },
  noteInput: { minHeight: 72, alignItems: 'flex-start' },
  paintsSection: { gap: spacing.md },
  paintsHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  addLink: { color: colors.primary, fontWeight: '700', fontSize: 14 },
  empty: { textAlign: 'center', marginTop: 40, color: colors.textPlaceholder },
});
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/KitDetailModal.tsx
git commit -m "feat: add kit detail modal with used-colors section"
```

---

### Task 10: Kit list screen (`app/(tabs)/kits.tsx`)

**Files:**
- Create: `app/(tabs)/kits.tsx`

**Interfaces:**
- Consumes: `useActiveKitBox`/`setActiveKitBox` (Task 2), `AddKitModal` (Task 7), `KitDetailModal` (Task 9), `KitStatus` type + raw SQL against `kits`/`kit_boxes` (Task 1 schema).
- Produces: default-exported screen component registered as the `/kits` route by Task 11.

- [ ] **Step 1: Create the screen**

Deliberately simpler than `app/(tabs)/owned.tsx`: no swipe-to-delete/swipe-to-status gestures (not requested in the spec — deletion lives in `KitDetailModal`'s menu), no sort/filter modal (not requested). Box switching follows the same `useLocalSearchParams`/`navigation.setOptions` pattern as `owned.tsx` so `KitBoxTitlePicker`'s `router.navigate({ pathname: '/kits', params: {...} })` calls land correctly. A simple 3-way status filter (all three statuses shown by default, tap a chip to toggle) sits above the list.

```tsx
// app/(tabs)/kits.tsx
import { useCallback, useEffect, useState } from 'react';
import { FlatList, Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { IconBox, IconPlus } from '@tabler/icons-react-native';
import { useFocusEffect, useLocalSearchParams, useNavigation } from 'expo-router';
import { getDB, KitStatus } from '../../lib/db';
import { setActiveKitBox } from '../../lib/activeKitBox';
import { t, useLocale } from '../../lib/i18n';
import { lightColors, radius, spacing, touch, useTheme } from '../../lib/theme';
import AddKitModal from '../../components/AddKitModal';
import EmptyState from '../../components/EmptyState';
import KitDetailModal from '../../components/KitDetailModal';

interface KitListItem {
  id: number;
  name: string;
  maker: string;
  scale: string | null;
  photo_uri: string | null;
  status: KitStatus;
}

type Selected = 'all' | number;

const STATUS_CHIPS: { key: KitStatus; labelKey: string }[] = [
  { key: 'not_started', labelKey: 'statusNotStarted' },
  { key: 'building', labelKey: 'statusBuilding' },
  { key: 'completed', labelKey: 'statusCompleted' },
];

export default function KitsScreen() {
  const locale = useLocale();
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const navigation = useNavigation();
  const { boxId } = useLocalSearchParams<{ boxId?: string }>();
  const [selected, setSelected] = useState<Selected>('all');
  const [statuses, setStatuses] = useState<KitStatus[]>(['not_started', 'building', 'completed']);
  const [items, setItems] = useState<KitListItem[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [detailKitId, setDetailKitId] = useState<number | null>(null);

  useEffect(() => {
    const requested = boxId === 'all' ? 'all' : Number(boxId);
    if (requested === 'all' || (Number.isInteger(requested) && requested > 0)) setSelected(requested);
  }, [boxId]);

  useEffect(() => { setActiveKitBox(selected); }, [selected]);

  useEffect(() => {
    if (selected === 'all') {
      const title = locale === 'ja' ? 'すべてのキットボックス' : 'All Kit Boxes';
      navigation.setOptions({ title });
      return;
    }
    getDB().getFirstAsync<{ name: string }>('SELECT name FROM kit_boxes WHERE id = ?', [selected]).then((box) => {
      if (box) navigation.setOptions({ title: box.name });
    });
  }, [locale, navigation, selected]);

  const load = useCallback(async (sel: Selected, sf: KitStatus[]) => {
    if (sf.length === 0) { setItems([]); return; }
    const where: string[] = [`status IN (${sf.map(() => '?').join(',')})`];
    const args: (string | number)[] = [...sf];
    if (sel !== 'all') { where.push('box_id = ?'); args.push(sel); }
    const rows = await getDB().getAllAsync<KitListItem>(
      'SELECT id, name, maker, scale, photo_uri, status FROM kits WHERE ' + where.join(' AND ') + ' ORDER BY added_at DESC',
      args
    );
    setItems(rows);
  }, []);

  useFocusEffect(useCallback(() => { load(selected, statuses); }, [load, selected, statuses]));

  const reload = () => load(selected, statuses);
  const toggleStatus = (s: KitStatus) => {
    const next = statuses.includes(s) ? statuses.filter((x) => x !== s) : [...statuses, s];
    setStatuses(next);
  };

  return (
    <View style={styles.container}>
      <View style={styles.chipRow}>
        {STATUS_CHIPS.map((chip) => {
          const active = statuses.includes(chip.key);
          return (
            <TouchableOpacity key={chip.key} style={[styles.chip, active && styles.chipActive]} onPress={() => toggleStatus(chip.key)}>
              <Text style={[styles.chipText, active && styles.chipTextActive]}>{t(chip.labelKey)}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <FlatList
        data={items}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.row} onPress={() => setDetailKitId(item.id)}>
            {item.photo_uri ? (
              <Image source={{ uri: item.photo_uri }} style={styles.thumb} resizeMode="cover" />
            ) : (
              <View style={styles.thumbPlaceholder}><IconBox color={colors.textFaint} size={22} /></View>
            )}
            <View style={styles.rowInfo}>
              <Text numberOfLines={1} style={styles.rowName}>{item.name}</Text>
              <Text numberOfLines={1} style={styles.rowSub}>{item.maker}{item.scale ? ` · ${item.scale}` : ''}</Text>
            </View>
            <Text style={styles.rowStatus}>{t(STATUS_CHIPS.find((c) => c.key === item.status)?.labelKey ?? 'status')}</Text>
          </TouchableOpacity>
        )}
        ListEmptyComponent={(
          <EmptyState icon={IconBox} title={t('emptyKits')} actionLabel={t('addKit')} onAction={() => setShowAdd(true)} />
        )}
      />

      <TouchableOpacity style={styles.fab} onPress={() => setShowAdd(true)} accessibilityRole="button" accessibilityLabel={t('addKit')}>
        <IconPlus color={colors.onPrimary} size={26} />
      </TouchableOpacity>

      <AddKitModal
        visible={showAdd}
        defaultBoxId={selected === 'all' ? null : selected}
        onClose={() => { setShowAdd(false); reload(); }}
      />
      <KitDetailModal
        visible={detailKitId != null}
        kitId={detailKitId}
        onClose={() => setDetailKitId(null)}
        onChanged={reload}
      />
    </View>
  );
}

const makeStyles = (colors: typeof lightColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  chipRow: { flexDirection: 'row', gap: spacing.sm, padding: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.borderLight },
  chip: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.pill, backgroundColor: colors.chip },
  chipActive: { backgroundColor: colors.primary },
  chipText: { fontSize: 13, color: colors.text },
  chipTextActive: { color: colors.onPrimary, fontWeight: '700' },
  list: { paddingBottom: 96 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.xl, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.borderLight },
  thumb: { width: 48, height: 48, borderRadius: radius.sm },
  thumbPlaceholder: { width: 48, height: 48, borderRadius: radius.sm, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  rowInfo: { flex: 1 },
  rowName: { fontSize: 15, fontWeight: '600', color: colors.text },
  rowSub: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  rowStatus: { fontSize: 12, color: colors.textFaint },
  fab: { position: 'absolute', right: spacing.xl, bottom: spacing.xl, width: 56, height: 56, borderRadius: radius.fab, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
});
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: no errors. Note: this route is not reachable yet (not registered in `_layout.tsx`) — full manual verification happens after Task 11.

- [ ] **Step 3: Commit**

```bash
git add "app/(tabs)/kits.tsx"
git commit -m "feat: add kit list screen"
```

---

### Task 11: Register the `/kits` tab route

**Files:**
- Modify: `app/(tabs)/_layout.tsx`

**Interfaces:**
- Consumes: `KitBoxTitlePicker`, `KitBoxOptions` (Task 5).

- [ ] **Step 1: Add the imports**

In `app/(tabs)/_layout.tsx`, add alongside the existing `BoxTitlePicker`/`BoxOptions` imports:

```ts
import KitBoxTitlePicker from '../../components/KitBoxTitlePicker';
import KitBoxOptions from '../../components/KitBoxOptions';
```

- [ ] **Step 2: Register the tab screen**

Find the `<Tabs.Screen name="owned" .../>` line and add a new screen entry right after it:

```tsx
      <Tabs.Screen name="owned" options={{ headerTitle: () => <BoxTitlePicker />, headerRight: () => <BoxOptions /> }} />
      <Tabs.Screen name="kits" options={{ headerTitle: () => <KitBoxTitlePicker />, headerRight: () => <KitBoxOptions /> }} />
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: no errors.

Manual check (Expo Go, since routing/navigation cannot be verified by `tsc`): navigate to `/kits` directly is not yet possible from the UI (drawer entry point comes in Task 12) — confirm no red-screen crash by checking Metro logs after this change, full navigation check happens after Task 12.

- [ ] **Step 4: Commit**

```bash
git add "app/(tabs)/_layout.tsx"
git commit -m "feat: register /kits tab route"
```

---

### Task 12: Navigation drawer entry point

**Files:**
- Modify: `components/NavigationDrawer.tsx`

**Interfaces:**
- Consumes: `useActiveKitBox`, `setActiveKitBox`, `notifyKitBoxesChanged` (Task 2); `kit_boxes`/`kits` tables (Task 1).

- [ ] **Step 1: Add kit-box state alongside the existing paint-box state**

In `components/NavigationDrawer.tsx`, add to the imports:

```ts
import { notifyKitBoxesChanged, setActiveKitBox, useActiveKitBox } from '../lib/activeKitBox';
```

Add a `Box`-like interface reuse (the existing `Box` interface already matches `{id, name, icon, icon_color}` shape — reuse it as-is) and new state, next to the existing `boxes`/`boxCounts` state declarations:

```ts
  const activeKitBoxId = useActiveKitBox();
  const [kitBoxes, setKitBoxes] = useState<Box[]>([]);
  const [kitCounts, setKitCounts] = useState<Map<number | null, number>>(new Map());
  const [editingKitBox, setEditingKitBox] = useState<'new' | null>(null);
```

- [ ] **Step 2: Load kit boxes alongside paint boxes**

In `loadBoxes` (the existing `useCallback`), add two more queries to the `Promise.all` and two more `set...` calls after it. The function becomes:

```ts
  const loadBoxes = useCallback(async () => {
    const db = getDB();
    const [boxRows, countRows, favoriteRow, wishlistRow, usedRow, kitBoxRows, kitCountRows] = await Promise.all([
      db.getAllAsync<Box>('SELECT id, name, icon, icon_color FROM boxes ORDER BY sort_order, id'),
      db.getAllAsync<CountRow>("SELECT box_id, COUNT(*) AS n FROM inventory WHERE status IN ('owned', 'in_use') GROUP BY box_id"),
      db.getFirstAsync<TotalRow>("SELECT COUNT(*) AS n FROM lists WHERE type = 'favorites'"),
      db.getFirstAsync<TotalRow>("SELECT COUNT(*) AS n FROM lists WHERE type = 'wishlist'"),
      db.getFirstAsync<TotalRow>("SELECT COUNT(*) AS n FROM inventory WHERE status = 'used_up'"),
      db.getAllAsync<Box>('SELECT id, name, icon, icon_color FROM kit_boxes ORDER BY sort_order, id'),
      db.getAllAsync<CountRow>('SELECT box_id, COUNT(*) AS n FROM kits GROUP BY box_id'),
    ]);
    setBoxes(boxRows);
    setBoxCounts(new Map(countRows.map((row) => [row.box_id, row.n])));
    setFavoriteCount(favoriteRow?.n ?? 0);
    setWishlistCount(wishlistRow?.n ?? 0);
    setUsedCount(usedRow?.n ?? 0);
    setKitBoxes(kitBoxRows);
    setKitCounts(new Map(kitCountRows.map((row) => [row.box_id, row.n])));
  }, []);
```

(`CountRow`/`TotalRow` interfaces already exist in this file — no new interfaces needed, `box_id` is a generic enough field name to reuse.)

- [ ] **Step 3: Add a kit-box save handler and a kit-aware `go` helper**

Add next to the existing `saveBox` function:

```ts
  const saveKitBox = async ({ name, icon, color }: BoxDraft) => {
    const db = getDB();
    if (editingKitBox === 'new') await db.runAsync('INSERT INTO kit_boxes (name, icon, icon_color, sort_order) VALUES (?, ?, ?, COALESCE((SELECT MAX(sort_order) + 1 FROM kit_boxes), 0))', [name, icon, color]);
    notifyKitBoxesChanged();
    await loadBoxes();
  };
```

The existing `go` function only knows about paint-tab pathnames. Add a second, kit-specific navigation helper right after it:

```ts
  const goKits = (boxId: number | 'all') => {
    setActiveKitBox(boxId);
    onClose();
    router.navigate({ pathname: '/kits', params: { boxId: String(boxId) } });
  };
```

- [ ] **Step 4: Render the new drawer section**

Find the existing render block (the `return (...)` in `NavigationDrawer`). After the existing catalog/settings section (the last two `item(...)` calls before the closing `</ScrollView>`), add a new section:

```tsx
            <View style={styles.divider} />
            <Text style={styles.sectionLabel}>{t('kits')}</Text>
            {item(allKitBoxesLabel, () => goKits('all'), <IconBox color={colors.textMuted} size={22} />, pathname.endsWith('/kits') && activeKitBoxId === 'all', kitTotalCount)}
            {kitBoxes.map((box) => item(box.name, () => goKits(box.id), boxIcon(box), pathname.endsWith('/kits') && activeKitBoxId === box.id, kitCounts.get(box.id) ?? 0, `kitbox-${box.id}`))}
            {kitBoxes.length < 8 ? item(t('addKitBox'), () => setEditingKitBox('new'), <IconPlus color={colors.primary} size={22} />) : null}
```

Add the two label/count values it references, next to the existing `allBoxesLabel`/`totalCount` computations:

```ts
  const allKitBoxesLabel = locale === 'ja' ? 'すべてのキットボックス' : 'All Kit Boxes';
  const kitTotalCount = Array.from(kitCounts.values()).reduce((sum, count) => sum + count, 0);
```

Finally, render the kit-box editor modal next to the existing `<BoxEditorModal .../>` at the bottom of the JSX:

```tsx
          <BoxEditorModal visible={editingBox === 'new'} title={t('addBox')} onSave={saveBox} onClose={() => setEditingBox(null)} />
          <BoxEditorModal visible={editingKitBox === 'new'} title={t('addKitBox')} onSave={saveKitBox} onClose={() => setEditingKitBox(null)} />
```

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit`
Expected: no errors.

Manual check (Expo Go — this is a UI/navigation change, so `tsc` alone doesn't confirm it works):
1. Open the app, open the drawer (hamburger icon top-left).
2. Confirm a new "キット" section appears below the existing 使用済/お気に入り/買い物リスト section, with "すべてのキットボックス" (count 0) and a "＋ キットボックスを追加" row.
3. Tap "＋ キットボックスを追加", create a box (e.g. name "1/144"), confirm it appears in the drawer and navigates to the kit list screen (empty state, "キットを追加" button visible).
4. Tap "キットを追加" (or the FAB), fill in name+maker, save — confirm it appears in the list with the correct status chip.
5. Tap the kit row — confirm `KitDetailModal` opens, shows name/maker/scale, and box/status pickers work.
6. In the detail modal, tap "色を追加", search for an existing catalog paint (e.g. by brand name), tap it — confirm a toast appears and the color shows up in the "使用する色" list on closing the picker.
7. Edit that color's memo field, tap elsewhere to blur — reopen the kit and confirm the memo persisted.
8. Tap the photo area — confirm the camera/gallery ActionSheet opens and a selected photo displays and persists after closing/reopening the kit.
9. From the header "⋮" menu in the detail modal, delete the kit — confirm it disappears from the list and the drawer's kit-box count decrements.

- [ ] **Step 6: Commit**

```bash
git add components/NavigationDrawer.tsx
git commit -m "feat: add kit boxes section to navigation drawer"
```

---

## Self-Review Notes

- **Spec coverage:** kit box CRUD (Tasks 1, 5, 12) ✓; kit manual entry with name/maker/scale/note/photo/status/box (Tasks 1, 3, 6, 7) ✓; not_started/building/completed status (Tasks 1, 9, 10) ✓; kit detail page as the per-kit destination (Task 9) ✓; colors-used section sourced from the full paint catalog with per-color memo (Tasks 1, 8, 9) ✓; drawer integration (Task 12) ✓. Explicitly-deferred items (kit catalog DB, Amazon lookup, barcode scan, kit favorites/wishlist, elaborate color presentation, color mixing) are not implemented anywhere in this plan, matching the spec's scope boundary.
- **Type consistency:** `KitStatus`, `KitDetail`, `KitPaintRow` (interface) are defined once in Task 1 and imported by name everywhere else (Tasks 9, 10 double-check this — Task 9 aliases the interface import to `KitPaintRowData` specifically to avoid colliding with the `KitPaintRow` *component* from Task 8, which is imported unaliased in the same file). `ActiveKitBox`/`setActiveKitBox`/`useActiveKitBox`/`notifyKitBoxesChanged`/`useKitBoxesVersion` from Task 2 are used with matching names in Tasks 5, 10, 12.
- **No placeholders:** every step has complete, runnable code — none of the "TBD"/"add validation"/"similar to Task N" patterns appear.
