# Kit List UX Parity + Price Field Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the kit list screen (`app/(tabs)/kits.tsx`) to full UI/UX parity with the paint inventory screen (`app/(tabs)/owned.tsx`) — status summary bar, ad banner, filter, and sort — and add a `price` field to kits.

**Architecture:** `kits.tsx` is rewritten to mirror `owned.tsx`'s established structure exactly: a status-summary bar with a status-picker modal, an `AdBanner`, and a `ListActionBar` (filter/sort/add) at the bottom, replacing the current bare chip row and FAB. A new `KitFilterModal` component (mirroring `FilterModal`) provides maker/series/category/scale filtering. `price` is added to the `kits` table and threaded through `AddKitModal`/`KitDetailModal` the same way `scale`/`series`/`category` already are.

**Tech Stack:** Same as prior plans on this branch (Expo SDK ~54 / React Native / expo-sqlite). No new dependencies.

## Global Constraints

- No test framework exists in this project. Verification is `npx tsc --noEmit` plus documented manual Expo Go checks.
- No UTF-8 BOM in any modified file.
- New files use the mandatory styling convention `const { colors } = useTheme(); const styles = useMemo(() => makeStyles(colors), [colors]);`. `kits.tsx` currently calls `makeStyles(colors)` directly without `useMemo` — preserve that existing convention in `kits.tsx` (don't "fix" it as part of this plan); `KitFilterModal.tsx` is a new file and must use the `useMemo` convention (mirroring `FilterModal.tsx`, which already does).
- Price is stored as `INTEGER` (yen, whole numbers), nullable, with no currency symbol in the UI — display as a plain thousands-separated number via `.toLocaleString()`.
- Price is a detail-only field: it is never shown in the kit list row (`KitListItem`/`renderItem` in `kits.tsx` is not modified to include price), matching how `series`/`category`/`note` are already detail-only.
- The kit filter's 4 fields (maker/series/category/scale) are independent multi-select lists — no brand→series-style cascading between them.
- Any new column added to the `kits` table's `CREATE TABLE` text must also get a corresponding `try { await db.execAsync('ALTER TABLE kits ADD COLUMN ...'); } catch { /* 既にある */ }` line in `initDB()`, matching the existing pattern for `series`/`category` — devices that already ran this branch's earlier builds have a `kits` table without a `price` column.
- Screen title/status-bar count strings follow `owned.tsx`'s established convention of inline `locale === 'ja' ? ... : ...` ternaries (not `t()` keys) for these two specific strings — this is a deliberate mirror of existing precedent, not a gap to fix.

---

### Task 1: `price` column + `KitDetail`/`updateKitPrice` in lib/db.ts

**Files:**
- Modify: `lib/db.ts`

**Interfaces:**
- Produces: `KitDetail.price: number | null` (new field), `updateKitPrice(kitId: number, price: string): Promise<void>`.
- Consumed by: Task 3 (`AddKitModal.tsx`), Task 4 (`KitDetailModal.tsx`).

- [ ] **Step 1: Add `price` to the `kits` table's `CREATE TABLE` column list**

Find:

```ts
    '  name TEXT NOT NULL, maker TEXT NOT NULL, series TEXT, category TEXT, scale TEXT, note TEXT,' +
```

Replace with:

```ts
    '  name TEXT NOT NULL, maker TEXT NOT NULL, series TEXT, category TEXT, scale TEXT, note TEXT, price INTEGER,' +
```

- [ ] **Step 2: Add the `price` migration for existing devices**

Find:

```ts
  try { await db.execAsync('ALTER TABLE kits ADD COLUMN series TEXT'); } catch { /* 既にある */ }
  try { await db.execAsync('ALTER TABLE kits ADD COLUMN category TEXT'); } catch { /* 既にある */ }
```

Replace with:

```ts
  try { await db.execAsync('ALTER TABLE kits ADD COLUMN series TEXT'); } catch { /* 既にある */ }
  try { await db.execAsync('ALTER TABLE kits ADD COLUMN category TEXT'); } catch { /* 既にある */ }
  try { await db.execAsync('ALTER TABLE kits ADD COLUMN price INTEGER'); } catch { /* 既にある */ }
```

- [ ] **Step 3: Add `price` to the `KitDetail` interface**

Find:

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
  price: number | null;
  status: KitStatus;
  added_at: string | null;
  status_changed_at: string | null;
}
```

- [ ] **Step 4: Add `k.price` to `getKitDetail`'s SELECT**

Find:

```ts
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

Replace with:

```ts
export async function getKitDetail(kitId: number): Promise<KitDetail | null> {
  const row = await getDB().getFirstAsync<KitDetail>(
    'SELECT k.id, k.box_id, b.name AS box_name, k.name, k.maker, k.series, k.category, k.scale, k.note, k.price, k.status, k.added_at, k.status_changed_at'
    + ' FROM kits k LEFT JOIN kit_boxes b ON k.box_id = b.id'
    + ' WHERE k.id = ?',
    [kitId]
  );
  return row ?? null;
}
```

- [ ] **Step 5: Add `updateKitPrice` after `updateKitCategory`**

Find:

```ts
export async function updateKitCategory(kitId: number, category: string): Promise<void> {
  const normalized = category.trim() === '' ? null : category;
  await getDB().runAsync(
    "UPDATE kits SET category = ?, status_changed_at = datetime('now') WHERE id = ?",
    [normalized, kitId]
  );
}

export async function updateKitBox(kitId: number, boxId: number): Promise<void> {
```

Replace with:

```ts
export async function updateKitCategory(kitId: number, category: string): Promise<void> {
  const normalized = category.trim() === '' ? null : category;
  await getDB().runAsync(
    "UPDATE kits SET category = ?, status_changed_at = datetime('now') WHERE id = ?",
    [normalized, kitId]
  );
}

export async function updateKitPrice(kitId: number, price: string): Promise<void> {
  const trimmed = price.trim();
  const parsed = trimmed === '' ? null : Number(trimmed);
  const normalized = parsed !== null && Number.isFinite(parsed) ? parsed : null;
  await getDB().runAsync(
    "UPDATE kits SET price = ?, status_changed_at = datetime('now') WHERE id = ?",
    [normalized, kitId]
  );
}

export async function updateKitBox(kitId: number, boxId: number): Promise<void> {
```

- [ ] **Step 6: Verify**

Run: `npx tsc --noEmit`
Expected: no errors attributable to `lib/db.ts`.

Also verify no BOM: `head -c 3 lib/db.ts | od -An -tx1` must not show `ef bb bf`.

- [ ] **Step 7: Commit**

```bash
git add lib/db.ts
git commit -m "feat: add price column and updateKitPrice to kits schema"
```

---

### Task 2: Translation keys (`price`, `sortMaker`)

**Files:**
- Modify: `translations/ja.json`
- Modify: `translations/en.json`

**Interfaces:**
- Produces: `price`, `sortMaker` keys, consumed via `t()` by Task 3/4 (`price`) and Task 6 (`sortMaker`).

- [ ] **Step 1: Add both keys to `translations/ja.json`**

Both files are single-line flat JSON. Insert before the final closing `}`:

```json
,"price":"価格","sortMaker":"メーカー順"
```

- [ ] **Step 2: Add both keys to `translations/en.json`**

```json
,"price":"Price","sortMaker":"By Maker"
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
console.log('price:', ja.price, en.price);
console.log('sortMaker:', ja.sortMaker, en.sortMaker);
"
```
Expected: `ja`/`en` counts equal, both "missing" arrays empty, `price: 価格 Price`, `sortMaker: メーカー順 By Maker`.

Also verify no BOM in either file.

- [ ] **Step 4: Commit**

```bash
git add translations/ja.json translations/en.json
git commit -m "feat: add price and sortMaker translation keys"
```

---

### Task 3: `AddKitModal.tsx` price field

**Files:**
- Modify: `components/AddKitModal.tsx`

**Interfaces:**
- Consumes: `t('price')` (Task 2). No new DB function needed — price is inserted directly in the existing `INSERT INTO kits` statement.

- [ ] **Step 1: Add `price` state**

Find:

```tsx
  const [name, setName] = useState('');
  const [maker, setMaker] = useState('');
  const [series, setSeries] = useState('');
  const [category, setCategory] = useState('');
  const [scale, setScale] = useState('');
  const [note, setNote] = useState('');
```

Replace with:

```tsx
  const [name, setName] = useState('');
  const [maker, setMaker] = useState('');
  const [series, setSeries] = useState('');
  const [category, setCategory] = useState('');
  const [scale, setScale] = useState('');
  const [price, setPrice] = useState('');
  const [note, setNote] = useState('');
```

- [ ] **Step 2: Reset `price` on open, alongside the other fields**

Find:

```tsx
  useEffect(() => {
    if (visible) { setName(''); setMaker(''); setSeries(''); setCategory(''); setScale(''); setNote(''); setPhotos([]); }
  }, [visible]);
```

Replace with:

```tsx
  useEffect(() => {
    if (visible) { setName(''); setMaker(''); setSeries(''); setCategory(''); setScale(''); setPrice(''); setNote(''); setPhotos([]); }
  }, [visible]);
```

- [ ] **Step 3: Include `price` in the INSERT**

Find:

```tsx
  const save = async () => {
    if (!canSave) return;
    const result = await getDB().runAsync(
      'INSERT INTO kits (box_id, name, maker, series, category, scale, note, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [defaultBoxId, name.trim(), maker.trim(), series.trim() || null, category.trim() || null, scale.trim() || null, note.trim() || null, 'not_started']
    );
```

Replace with:

```tsx
  const save = async () => {
    if (!canSave) return;
    const trimmedPrice = price.trim();
    const parsedPrice = trimmedPrice === '' ? null : Number(trimmedPrice);
    const normalizedPrice = parsedPrice !== null && Number.isFinite(parsedPrice) ? parsedPrice : null;
    const result = await getDB().runAsync(
      'INSERT INTO kits (box_id, name, maker, series, category, scale, price, note, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [defaultBoxId, name.trim(), maker.trim(), series.trim() || null, category.trim() || null, scale.trim() || null, normalizedPrice, note.trim() || null, 'not_started']
    );
```

- [ ] **Step 4: Add the price input field to the form, after scale**

Find:

```tsx
            <View style={styles.field}>
              <Text style={styles.label}>{t('scale')}</Text>
              <ClearableInput style={styles.input} value={scale} onChangeText={setScale} placeholder="1/144" />
            </View>
            <View style={styles.field}>
              <Text style={styles.label}>{t('note')}</Text>
```

Replace with:

```tsx
            <View style={styles.field}>
              <Text style={styles.label}>{t('scale')}</Text>
              <ClearableInput style={styles.input} value={scale} onChangeText={setScale} placeholder="1/144" />
            </View>
            <View style={styles.field}>
              <Text style={styles.label}>{t('price')}</Text>
              <ClearableInput style={styles.input} value={price} onChangeText={setPrice} keyboardType="numeric" placeholder="0" />
            </View>
            <View style={styles.field}>
              <Text style={styles.label}>{t('note')}</Text>
```

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit`
Expected: no errors attributable to `components/AddKitModal.tsx`.

- [ ] **Step 6: Commit**

```bash
git add components/AddKitModal.tsx
git commit -m "feat: add price field to AddKitModal"
```

---

### Task 4: `KitDetailModal.tsx` price field

**Files:**
- Modify: `components/KitDetailModal.tsx`

**Interfaces:**
- Consumes: `KitDetail.price`, `updateKitPrice` from `../lib/db` (Task 1); `t('price')` (Task 2).

- [ ] **Step 1: Import `updateKitPrice`**

Find:

```ts
import {
  addKitPhoto,
  deleteKit,
  getDB,
  getKitColors,
  getKitDetail,
  getKitPhotos,
  getOwnedCountMap,
  KitColorSummary,
  KitDetail,
  KitPhoto,
  KitStatus,
  removeKitColor,
  removeKitPhoto,
  reorderKitColors,
  reorderKitPhotos,
  setKitStatus,
  updateKitBox,
  updateKitCategory,
  updateKitColorName,
  updateKitMaker,
  updateKitName,
  updateKitNote,
  updateKitScale,
  updateKitSeries,
} from '../lib/db';
```

Replace with:

```ts
import {
  addKitPhoto,
  deleteKit,
  getDB,
  getKitColors,
  getKitDetail,
  getKitPhotos,
  getOwnedCountMap,
  KitColorSummary,
  KitDetail,
  KitPhoto,
  KitStatus,
  removeKitColor,
  removeKitPhoto,
  reorderKitColors,
  reorderKitPhotos,
  setKitStatus,
  updateKitBox,
  updateKitCategory,
  updateKitColorName,
  updateKitMaker,
  updateKitName,
  updateKitNote,
  updateKitPrice,
  updateKitScale,
  updateKitSeries,
} from '../lib/db';
```

- [ ] **Step 2: Add `price` state**

Find:

```tsx
  const [name, setName] = useState('');
  const [maker, setMaker] = useState('');
  const [scale, setScale] = useState('');
  const [note, setNote] = useState('');
  const [series, setSeries] = useState('');
  const [category, setCategory] = useState('');
```

Replace with:

```tsx
  const [name, setName] = useState('');
  const [maker, setMaker] = useState('');
  const [scale, setScale] = useState('');
  const [price, setPrice] = useState('');
  const [note, setNote] = useState('');
  const [series, setSeries] = useState('');
  const [category, setCategory] = useState('');
```

- [ ] **Step 3: Load/reset `price` alongside the other fields**

Find:

```tsx
    setName(row?.name ?? '');
    setMaker(row?.maker ?? '');
    setScale(row?.scale ?? '');
    setNote(row?.note ?? '');
    setSeries(row?.series ?? '');
    setCategory(row?.category ?? '');
  }, [kitId]);
```

Replace with:

```tsx
    setName(row?.name ?? '');
    setMaker(row?.maker ?? '');
    setScale(row?.scale ?? '');
    setPrice(row?.price != null ? String(row.price) : '');
    setNote(row?.note ?? '');
    setSeries(row?.series ?? '');
    setCategory(row?.category ?? '');
  }, [kitId]);
```

Find:

```tsx
      setName('');
      setMaker('');
      setScale('');
      setNote('');
      setSeries('');
      setCategory('');
```

Replace with:

```tsx
      setName('');
      setMaker('');
      setScale('');
      setPrice('');
      setNote('');
      setSeries('');
      setCategory('');
```

- [ ] **Step 4: Add `savePrice`, after `saveScale`**

Find:

```tsx
  const saveScale = async () => {
    if (!detail) return;
    if (scale === (detail.scale ?? '')) return;
    await updateKitScale(detail.id, scale);
    await load();
    onChanged?.();
  };

  const saveNote = async () => {
```

Replace with:

```tsx
  const saveScale = async () => {
    if (!detail) return;
    if (scale === (detail.scale ?? '')) return;
    await updateKitScale(detail.id, scale);
    await load();
    onChanged?.();
  };

  const savePrice = async () => {
    if (!detail) return;
    const currentPrice = detail.price != null ? String(detail.price) : '';
    if (price === currentPrice) return;
    await updateKitPrice(detail.id, price);
    await load();
    onChanged?.();
  };

  const saveNote = async () => {
```

- [ ] **Step 5: Include `price` in `flushPendingFields`**

Find:

```tsx
  const flushPendingFields = async () => {
    if (!detail) return;
    const trimmedName = name.trim();
    if (trimmedName !== '' && trimmedName !== detail.name) { await updateKitName(detail.id, trimmedName); onChanged?.(); }
    const trimmedMaker = maker.trim();
    if (trimmedMaker !== '' && trimmedMaker !== detail.maker) { await updateKitMaker(detail.id, trimmedMaker); onChanged?.(); }
    if (scale !== (detail.scale ?? '')) { await updateKitScale(detail.id, scale); onChanged?.(); }
    if (note !== (detail.note ?? '')) { await updateKitNote(detail.id, note); onChanged?.(); }
    if (series !== (detail.series ?? '')) { await updateKitSeries(detail.id, series); onChanged?.(); }
    if (category !== (detail.category ?? '')) { await updateKitCategory(detail.id, category); onChanged?.(); }
  };
```

Replace with:

```tsx
  const flushPendingFields = async () => {
    if (!detail) return;
    const trimmedName = name.trim();
    if (trimmedName !== '' && trimmedName !== detail.name) { await updateKitName(detail.id, trimmedName); onChanged?.(); }
    const trimmedMaker = maker.trim();
    if (trimmedMaker !== '' && trimmedMaker !== detail.maker) { await updateKitMaker(detail.id, trimmedMaker); onChanged?.(); }
    if (scale !== (detail.scale ?? '')) { await updateKitScale(detail.id, scale); onChanged?.(); }
    const currentPrice = detail.price != null ? String(detail.price) : '';
    if (price !== currentPrice) { await updateKitPrice(detail.id, price); onChanged?.(); }
    if (note !== (detail.note ?? '')) { await updateKitNote(detail.id, note); onChanged?.(); }
    if (series !== (detail.series ?? '')) { await updateKitSeries(detail.id, series); onChanged?.(); }
    if (category !== (detail.category ?? '')) { await updateKitCategory(detail.id, category); onChanged?.(); }
  };
```

- [ ] **Step 6: Add the price field to the details card, after category**

Find:

```tsx
                    <View style={styles.field}>
                      <Text style={styles.sectionTitle}>{t('category')}</Text>
                      {editMode ? (
                        <ClearableInput style={styles.input} value={category} onChangeText={setCategory} onBlur={saveCategory} />
                      ) : (
                        <Text style={styles.pickerText}>{category || t('unknown')}</Text>
                      )}
                    </View>
                  </View>
```

Replace with:

```tsx
                    <View style={styles.field}>
                      <Text style={styles.sectionTitle}>{t('category')}</Text>
                      {editMode ? (
                        <ClearableInput style={styles.input} value={category} onChangeText={setCategory} onBlur={saveCategory} />
                      ) : (
                        <Text style={styles.pickerText}>{category || t('unknown')}</Text>
                      )}
                    </View>
                    <View style={styles.field}>
                      <Text style={styles.sectionTitle}>{t('price')}</Text>
                      {editMode ? (
                        <ClearableInput style={styles.input} value={price} onChangeText={setPrice} onBlur={savePrice} keyboardType="numeric" placeholder="0" />
                      ) : (
                        <Text style={styles.pickerText}>{detail.price != null ? detail.price.toLocaleString() : t('unknown')}</Text>
                      )}
                    </View>
                  </View>
```

- [ ] **Step 7: Verify**

Run: `npx tsc --noEmit`
Expected: no errors attributable to `components/KitDetailModal.tsx`.

- [ ] **Step 8: Commit**

```bash
git add components/KitDetailModal.tsx
git commit -m "feat: add price field to KitDetailModal"
```

---

### Task 5: `KitFilterModal` (new component)

**Files:**
- Create: `components/KitFilterModal.tsx`

**Interfaces:**
- Produces: `KitFilter` type (`{ makers: string[]; series: string[]; categories: string[]; scales: string[]; search: string }`), default-exported `KitFilterModal({ visible, options, initial, onApply, onClose })` where `options: { maker: string; series: string | null; category: string | null; scale: string | null }[]`.
- Consumed by: Task 6 (`kits.tsx`).

- [ ] **Step 1: Create the file**

```tsx
// components/KitFilterModal.tsx
import { useEffect, useMemo, useState } from 'react';
import {
  Modal, View, Text, TouchableOpacity, StyleSheet,
} from 'react-native';
import { IconChevronDown, IconChevronUp, IconSquare, IconSquareCheck } from '@tabler/icons-react-native';
import ClearableInput from './ClearableInput';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { t } from '../lib/i18n';
import { useTheme, lightColors, radius, spacing, touch } from '../lib/theme';
import { useUiPrefs, type ListFontSize } from '../lib/uiPrefs';
import SwipeDownHeader from './SwipeDownHeader';
import SwipeDownScrollView from './SwipeDownScrollView';
import { useModalLock } from '../lib/modalLock';

export interface KitFilter {
  makers: string[];
  series: string[];
  categories: string[];
  scales: string[];
  search: string;
}

interface Props {
  visible: boolean;
  // 絞り込み候補(登録済みキットの maker/series/category/scale 組)
  options: { maker: string; series: string | null; category: string | null; scale: string | null }[];
  initial: KitFilter;
  onApply: (f: KitFilter) => void;
  onClose: () => void;
}

export default function KitFilterModal({ visible, options, initial, onApply, onClose }: Props) {
  useModalLock(visible);
  const { colors } = useTheme();
  const { listFontSize } = useUiPrefs();
  const styles = useMemo(() => makeStyles(colors, listFontSize), [colors, listFontSize]);
  const [makers, setMakers] = useState<string[]>(initial.makers);
  const [series, setSeries] = useState<string[]>(initial.series);
  const [categories, setCategories] = useState<string[]>(initial.categories);
  const [scales, setScales] = useState<string[]>(initial.scales);
  const [search, setSearch] = useState(initial.search);
  const [makerOpen, setMakerOpen] = useState(false);
  const [seriesOpen, setSeriesOpen] = useState(false);
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [scaleOpen, setScaleOpen] = useState(false);

  // 開くたびに適用済み条件(initial)へ同期。キャンセルで閉じた後に開き直すと
  // 破棄した変更ではなく最後に適用した状態が復活する。
  useEffect(() => {
    if (!visible) return;
    setMakers(initial.makers); setSeries(initial.series);
    setCategories(initial.categories); setScales(initial.scales); setSearch(initial.search);
  }, [visible]);

  const makerOptions = useMemo(
    () => Array.from(new Set(options.map((o) => o.maker).filter(Boolean))).sort(),
    [options]
  );
  const seriesOptions = useMemo(
    () => Array.from(new Set(options.map((o) => o.series).filter((s): s is string => !!s))).sort(),
    [options]
  );
  const categoryOptions = useMemo(
    () => Array.from(new Set(options.map((o) => o.category).filter((c): c is string => !!c))).sort(),
    [options]
  );
  const scaleOptions = useMemo(
    () => Array.from(new Set(options.map((o) => o.scale).filter((s): s is string => !!s))).sort(),
    [options]
  );

  const toggle = (arr: string[], v: string, set: (x: string[]) => void) =>
    set(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

  const clear = () => { setMakers([]); setSeries([]); setCategories([]); setScales([]); setSearch(''); };

  const checkRow = (key: string, label: string, checked: boolean, onPress: () => void) => (
    <TouchableOpacity key={key} style={styles.checkRow} onPress={onPress}>
      {checked
        ? <IconSquareCheck size={20} color={colors.primary} style={styles.checkIcon} />
        : <IconSquare size={20} color={colors.textPlaceholder} style={styles.checkIcon} />}
      <Text style={styles.checkLabel}>{label}</Text>
    </TouchableOpacity>
  );

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaProvider>
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <SwipeDownHeader onClose={onClose}>
          <View style={styles.header}>
            <TouchableOpacity style={styles.headerSide} onPress={onClose}>
              <Text style={[styles.headerBtn, { textAlign: 'left' }]}>{t('cancel')}</Text>
            </TouchableOpacity>
            <Text style={styles.title}>{t('filter')}</Text>
            <TouchableOpacity style={styles.headerSide} onPress={clear}>
              <Text style={[styles.headerBtn, { textAlign: 'right' }]}>{t('clear')}</Text>
            </TouchableOpacity>
          </View>
        </SwipeDownHeader>

        <SwipeDownScrollView onClose={onClose} style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1 }} alwaysBounceVertical>
          {/* キット名検索 */}
          <Text style={styles.sectionTitle}>{t('name')}</Text>
          <ClearableInput
            style={styles.input}
            placeholder={t('searchPlaceholder')}
            value={search}
            onChangeText={setSearch}
          />

          {/* メーカー複数選択 */}
          <TouchableOpacity style={styles.dropdown} onPress={() => setMakerOpen((o) => !o)}>
            <Text style={styles.dropdownLabel}>
              {t('maker')}{makers.length ? ` (${makers.length})` : ''}
            </Text>
            {makerOpen
              ? <IconChevronUp size={16} color={colors.textFaint} />
              : <IconChevronDown size={16} color={colors.textFaint} />}
          </TouchableOpacity>
          {makerOpen && (
            <View style={styles.checkList}>
              {makerOptions.length === 0
                ? <Text style={styles.emptyOpt}>{t('noResults')}</Text>
                : makerOptions.map((m) => checkRow(m, m, makers.includes(m), () => toggle(makers, m, setMakers)))}
            </View>
          )}

          {/* シリーズ複数選択 */}
          <TouchableOpacity style={styles.dropdown} onPress={() => setSeriesOpen((o) => !o)}>
            <Text style={styles.dropdownLabel}>
              {t('series')}{series.length ? ` (${series.length})` : ''}
            </Text>
            {seriesOpen
              ? <IconChevronUp size={16} color={colors.textFaint} />
              : <IconChevronDown size={16} color={colors.textFaint} />}
          </TouchableOpacity>
          {seriesOpen && (
            <View style={styles.checkList}>
              {seriesOptions.length === 0
                ? <Text style={styles.emptyOpt}>{t('noResults')}</Text>
                : seriesOptions.map((s) => checkRow(s, s, series.includes(s), () => toggle(series, s, setSeries)))}
            </View>
          )}

          {/* 種別複数選択 */}
          <TouchableOpacity style={styles.dropdown} onPress={() => setCategoryOpen((o) => !o)}>
            <Text style={styles.dropdownLabel}>
              {t('category')}{categories.length ? ` (${categories.length})` : ''}
            </Text>
            {categoryOpen
              ? <IconChevronUp size={16} color={colors.textFaint} />
              : <IconChevronDown size={16} color={colors.textFaint} />}
          </TouchableOpacity>
          {categoryOpen && (
            <View style={styles.checkList}>
              {categoryOptions.length === 0
                ? <Text style={styles.emptyOpt}>{t('noResults')}</Text>
                : categoryOptions.map((c) => checkRow(c, c, categories.includes(c), () => toggle(categories, c, setCategories)))}
            </View>
          )}

          {/* スケール複数選択 */}
          <TouchableOpacity style={styles.dropdown} onPress={() => setScaleOpen((o) => !o)}>
            <Text style={styles.dropdownLabel}>
              {t('scale')}{scales.length ? ` (${scales.length})` : ''}
            </Text>
            {scaleOpen
              ? <IconChevronUp size={16} color={colors.textFaint} />
              : <IconChevronDown size={16} color={colors.textFaint} />}
          </TouchableOpacity>
          {scaleOpen && (
            <View style={styles.checkList}>
              {scaleOptions.length === 0
                ? <Text style={styles.emptyOpt}>{t('noResults')}</Text>
                : scaleOptions.map((s) => checkRow(s, s, scales.includes(s), () => toggle(scales, s, setScales)))}
            </View>
          )}
        </SwipeDownScrollView>

        <TouchableOpacity
          style={styles.applyBtn}
          onPress={() => onApply({ makers, series, categories, scales, search: search.trim() })}
        >
          <Text style={styles.applyText}>{t('apply')}</Text>
        </TouchableOpacity>
      </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
}

const FILTER_TEXT_SIZE: Record<ListFontSize, { dropdownLabel: number; checkLabel: number }> = {
  small: { dropdownLabel: 14, checkLabel: 13 },
  medium: { dropdownLabel: 16, checkLabel: 15 },
  large: { dropdownLabel: 18, checkLabel: 17 },
};

const makeStyles = (colors: typeof lightColors, listFontSize: ListFontSize) => {
  const sizes = FILTER_TEXT_SIZE[listFontSize];
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.surface },
    header: { flexDirection: 'row', alignItems: 'center', padding: spacing.xl, borderBottomWidth: 1, borderBottomColor: colors.borderLight },
    headerSide: { flex: 1 },
    headerBtn: { color: colors.primary, fontSize: 16 },
    title: { flex: 1, fontSize: 18, fontWeight: 'bold', textAlign: 'center', color: colors.text },
    sectionTitle: { fontSize: 13, color: colors.textFaint, marginTop: spacing.xl, marginHorizontal: spacing.xl, marginBottom: spacing.sm },
    input: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: 10, marginHorizontal: spacing.xl, color: colors.text },
    dropdown: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: spacing.xl, marginTop: spacing.lg, borderTopWidth: 1, borderColor: colors.borderLight },
    dropdownLabel: { fontSize: sizes.dropdownLabel, color: colors.text },
    checkList: { paddingHorizontal: spacing.xl, paddingBottom: spacing.md },
    checkRow: { flexDirection: 'row', alignItems: 'center', minHeight: touch.min },
    checkIcon: { marginRight: 10 },
    checkLabel: { fontSize: sizes.checkLabel, color: colors.text },
    emptyOpt: { color: colors.textPlaceholder, paddingVertical: spacing.md },
    applyBtn: { backgroundColor: colors.primary, padding: spacing.xl, alignItems: 'center' },
    applyText: { color: colors.onPrimary, fontSize: 16, fontWeight: 'bold' },
  });
};
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: no errors attributable to `components/KitFilterModal.tsx`.

Also verify no BOM.

- [ ] **Step 3: Commit**

```bash
git add components/KitFilterModal.tsx
git commit -m "feat: add KitFilterModal (maker/series/category/scale filtering)"
```

---

### Task 6: `kits.tsx` status bar, ad banner, ListActionBar, filter, sort, title fix

**Files:**
- Modify: `app/(tabs)/kits.tsx`

**Interfaces:**
- Consumes: `KitFilter`, `KitFilterModal` from `../../components/KitFilterModal` (Task 5); `t('sortMaker')` (Task 2).
- No change to this file's exported shape (`KitsScreen({ completedScreen })`, default `KitsRouteScreen`) — consumed unchanged by `app/(tabs)/completed.tsx` and the `/kits` route.

This is a full-file replacement.

- [ ] **Step 1: Replace the entire file**

```tsx
// app/(tabs)/kits.tsx
import { useCallback, useEffect, useState } from 'react';
import { FlatList, Image, Modal, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { IconBox, IconChevronDown } from '@tabler/icons-react-native';
import { router, useFocusEffect, useLocalSearchParams, useNavigation } from 'expo-router';
import { getDB, getDefaultKitBoxId, KitStatus } from '../../lib/db';
import { setActiveKitBox } from '../../lib/activeKitBox';
import { t, useLocale } from '../../lib/i18n';
import { lightColors, radius, spacing, touch, useTheme } from '../../lib/theme';
import ActionSheet, { ActionSheetButton } from '../../components/ActionSheet';
import AddKitModal from '../../components/AddKitModal';
import AdBanner from '../../components/AdBanner';
import EmptyState from '../../components/EmptyState';
import KitDetailModal from '../../components/KitDetailModal';
import KitFilterModal, { KitFilter } from '../../components/KitFilterModal';
import ListActionBar from '../../components/ListActionBar';

interface CountRow { n: number; }

interface KitListItem {
  id: number;
  name: string;
  maker: string;
  scale: string | null;
  thumb_uri: string | null;
  status: KitStatus;
}

type Selected = 'all' | number;

// completed は専用画面(完成品)でのみ扱う。塗料の保管箱一覧が used_up を
// STATUS_TOGGLES に含めないのと同じ考え方。
const STATUS_TOGGLES: { key: KitStatus; label: string }[] = [
  { key: 'not_started', label: 'statusNotStarted' },
  { key: 'building', label: 'statusBuilding' },
];

const STATUS_LABEL_KEYS: Record<KitStatus, string> = {
  not_started: 'statusNotStarted',
  building: 'statusBuilding',
  completed: 'statusCompleted',
};

const EMPTY_KIT_FILTER: KitFilter = { makers: [], series: [], categories: [], scales: [], search: '' };

type KitSort = 'added' | 'name' | 'maker';
const KIT_SORT_ORDER: Record<KitSort, string> = {
  added: 'added_at DESC',
  name: 'name COLLATE NOCASE ASC',
  maker: 'maker ASC, name ASC',
};

export function KitsScreen({ completedScreen = false }: { completedScreen?: boolean }) {
  const locale = useLocale();
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const navigation = useNavigation();
  const { boxId } = useLocalSearchParams<{ boxId?: string }>();
  const [kitTotal, setKitTotal] = useState(0);
  const [selected, setSelected] = useState<Selected>('all');
  const [statuses, setStatuses] = useState<KitStatus[]>(completedScreen ? ['completed'] : ['not_started', 'building']);
  const [filter, setFilter] = useState<KitFilter>(EMPTY_KIT_FILTER);
  const [sort, setSort] = useState<KitSort>('added');
  const [filterOptions, setFilterOptions] = useState<{ maker: string; series: string | null; category: string | null; scale: string | null }[]>([]);
  const [items, setItems] = useState<KitListItem[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [showFilter, setShowFilter] = useState(false);
  const [showStatusPicker, setShowStatusPicker] = useState(false);
  const [detailKitId, setDetailKitId] = useState<number | null>(null);
  const [defaultBoxId, setDefaultBoxId] = useState<number | null>(null);
  const [actionSheet, setActionSheet] = useState<{ title?: string; message?: string; buttons: ActionSheetButton[] } | null>(null);

  useEffect(() => {
    if (completedScreen) return;
    const requested = boxId === 'all' ? 'all' : Number(boxId);
    if (requested === 'all' || (Number.isInteger(requested) && requested > 0)) setSelected(requested);
  }, [boxId, completedScreen]);

  useEffect(() => { if (!completedScreen) setActiveKitBox(selected); }, [completedScreen, selected]);

  useEffect(() => {
    if (completedScreen) {
      navigation.setOptions({ title: t('completedKits') });
      return;
    }
    if (selected === 'all') {
      const title = locale === 'ja' ? 'すべてのボックス' : 'All Boxes';
      navigation.setOptions({ title });
      router.setParams({ boxName: title });
      return;
    }
    getDB().getFirstAsync<{ name: string }>('SELECT name FROM kit_boxes WHERE id = ?', [selected]).then((box) => {
      if (box) { navigation.setOptions({ title: box.name }); router.setParams({ boxName: box.name }); }
    });
  }, [completedScreen, locale, navigation, selected]);

  useEffect(() => { getDefaultKitBoxId().then(setDefaultBoxId); }, []);

  const load = useCallback(async (sel: Selected, sf: KitStatus[], f: KitFilter, sortBy: KitSort) => {
    const db = getDB();
    const totalWhere = completedScreen || sel === 'all' ? '' : ' AND box_id = ?';
    const totalArgs = completedScreen || sel === 'all' ? [] : [sel];
    const where: string[] = [];
    const args: (string | number)[] = [];

    if (sf.length === 0) {
      where.push('1 = 0'); // 全OFFなら該当なし
    } else {
      where.push(`status IN (${sf.map(() => '?').join(',')})`);
      args.push(...sf);
    }

    if (!completedScreen && sel !== 'all') { where.push('box_id = ?'); args.push(sel); }

    if (f.makers.length) { where.push(`maker IN (${f.makers.map(() => '?').join(',')})`); args.push(...f.makers); }
    if (f.series.length) { where.push(`series IN (${f.series.map(() => '?').join(',')})`); args.push(...f.series); }
    if (f.categories.length) { where.push(`category IN (${f.categories.map(() => '?').join(',')})`); args.push(...f.categories); }
    if (f.scales.length) { where.push(`scale IN (${f.scales.map(() => '?').join(',')})`); args.push(...f.scales); }
    if (f.search.trim()) { where.push('name LIKE ?'); args.push(`%${f.search.trim()}%`); }

    const sql =
      'SELECT id, name, maker, scale, status,'
      + ' (SELECT uri FROM kit_photos WHERE kit_id = kits.id ORDER BY sort_order, id LIMIT 1) AS thumb_uri'
      + ' FROM kits WHERE ' + where.join(' AND ')
      + ' ORDER BY ' + KIT_SORT_ORDER[sortBy];

    const [totalRow, nextFilterOptions, nextItems] = await Promise.all([
      db.getFirstAsync<CountRow>("SELECT COUNT(*) AS n FROM kits WHERE status IN ('not_started','building')" + totalWhere, totalArgs),
      db.getAllAsync<{ maker: string; series: string | null; category: string | null; scale: string | null }>(
        'SELECT DISTINCT maker, series, category, scale FROM kits'
      ),
      db.getAllAsync<KitListItem>(sql, args),
    ]);
    setKitTotal(totalRow?.n ?? 0);
    setFilterOptions(nextFilterOptions);
    setItems(nextItems);
  }, [completedScreen]);

  useFocusEffect(useCallback(() => { load(selected, statuses, filter, sort); }, [load, selected, statuses, filter, sort]));

  const reload = () => load(selected, statuses, filter, sort);
  const toggleStatus = (s: KitStatus) => {
    const next = statuses.includes(s) ? statuses.filter((x) => x !== s) : [...statuses, s];
    setStatuses(next);
    load(selected, next, filter, sort);
  };

  const filterActive = filter.makers.length > 0 || filter.series.length > 0 || filter.categories.length > 0 || filter.scales.length > 0 || filter.search.trim() !== '';
  const statusDefault = statuses.length === 2 && statuses.includes('not_started') && statuses.includes('building');
  const trulyEmpty = completedScreen ? items.length === 0 : !filterActive && statusDefault && kitTotal === 0;
  const emptyMessage = trulyEmpty ? t('emptyKits') : t('noResults');
  const statusLabel = statusDefault ? (locale === 'ja' ? 'すべてのステータス' : 'All statuses') : statuses.length === 1 ? t(statuses[0] === 'not_started' ? 'statusNotStarted' : 'statusBuilding') : t('statusAll');
  const statusColor = statusDefault ? '#2e7d32' : statuses[0] === 'not_started' ? colors.primary : colors.inUse;

  const openSort = () => {
    const opts: { key: KitSort; label: string }[] = [
      { key: 'added', label: t('sortAdded') },
      { key: 'name', label: t('sortName') },
      { key: 'maker', label: t('sortMaker') },
    ];
    setActionSheet({ title: t('sort'), message: '', buttons: [
      ...opts.map((o) => ({ text: `${sort === o.key ? '✓ ' : ''}${o.label}`, onPress: () => setSort(o.key) })),
      { text: t('cancel'), style: 'cancel' as const },
    ] });
  };

  return (
    <View style={styles.container}>
      <View style={styles.statusBarWrap}>
        <Text style={styles.statusCount}>{locale === 'ja'
          ? `キット数 ${completedScreen ? items.length : kitTotal} ・ 表示数 ${items.length}`
          : `Kits ${completedScreen ? items.length : kitTotal} · Showing ${items.length}`}</Text>
        {!completedScreen ? <TouchableOpacity style={styles.statusSelect} onPress={() => setShowStatusPicker(true)} accessibilityRole="button" accessibilityLabel={statusLabel}>
          <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
          <Text style={styles.statusSelectText}>{statusLabel}</Text><IconChevronDown color={colors.textMuted} size={18} />
        </TouchableOpacity> : null}
      </View>

      <View style={styles.adBar}><AdBanner /></View>

      <FlatList
        data={items}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.row} onPress={() => setDetailKitId(item.id)}>
            {item.thumb_uri ? (
              <Image source={{ uri: item.thumb_uri }} style={styles.thumb} resizeMode="cover" />
            ) : (
              <View style={styles.thumbPlaceholder}><IconBox color={colors.textFaint} size={22} /></View>
            )}
            <View style={styles.rowInfo}>
              <Text numberOfLines={1} style={styles.rowName}>{item.name}</Text>
              <Text numberOfLines={1} style={styles.rowSub}>{item.maker}{item.scale ? ` · ${item.scale}` : ''}</Text>
            </View>
            <Text style={styles.rowStatus}>{t(STATUS_LABEL_KEYS[item.status])}</Text>
          </TouchableOpacity>
        )}
        ListEmptyComponent={(
          <EmptyState
            icon={IconBox}
            title={emptyMessage}
            actionLabel={trulyEmpty ? t('addKit') : undefined}
            onAction={trulyEmpty ? () => setShowAdd(true) : undefined}
          />
        )}
      />

      <ListActionBar onFilter={() => setShowFilter(true)} onSort={openSort} onAdd={() => setShowAdd(true)} filterActive={filterActive} />

      <Modal visible={showStatusPicker} transparent animationType="fade" onRequestClose={() => setShowStatusPicker(false)}>
        <View style={styles.statusModalRoot}>
          <Pressable style={styles.statusModalBackdrop} onPress={() => setShowStatusPicker(false)} />
          <View style={styles.statusModal}>
            {STATUS_TOGGLES.map((option) => {
              const selectedOption = statuses.includes(option.key);
              const optionColor = option.key === 'not_started' ? colors.primary : colors.inUse;
              return <TouchableOpacity key={option.key} style={styles.statusOption} onPress={() => toggleStatus(option.key)}>
                <View style={[styles.statusDot, { backgroundColor: optionColor }]} /><Text style={styles.statusOptionText}>{t(option.label)}</Text>
                <Text style={[styles.statusCheck, selectedOption && { color: optionColor }]}>{selectedOption ? '✓' : ''}</Text>
              </TouchableOpacity>;
            })}
            <TouchableOpacity style={styles.statusDone} onPress={() => setShowStatusPicker(false)}><Text style={styles.statusDoneText}>{t('ok')}</Text></TouchableOpacity>
          </View>
        </View>
      </Modal>

      <KitFilterModal
        visible={showFilter}
        options={filterOptions}
        initial={filter}
        onApply={(f) => { setFilter(f); setShowFilter(false); }}
        onClose={() => setShowFilter(false)}
      />

      <AddKitModal
        visible={showAdd}
        defaultBoxId={completedScreen || selected === 'all' ? defaultBoxId : selected}
        onClose={() => { setShowAdd(false); reload(); }}
      />
      <KitDetailModal
        visible={detailKitId != null}
        kitId={detailKitId}
        onClose={() => setDetailKitId(null)}
        onChanged={reload}
      />
      <ActionSheet
        visible={!!actionSheet}
        title={actionSheet?.title}
        message={actionSheet?.message}
        buttons={actionSheet?.buttons ?? []}
        onClose={() => setActionSheet(null)}
      />
    </View>
  );
}

export default function KitsRouteScreen() {
  return <KitsScreen />;
}

const makeStyles = (colors: typeof lightColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  adBar: { borderTopWidth: 1, borderTopColor: colors.borderLight },
  statusBarWrap: { minHeight: touch.min, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.xl, borderBottomWidth: 1, borderBottomColor: colors.borderLight, backgroundColor: colors.surfaceAlt },
  statusCount: { color: colors.text, fontSize: 15, fontVariant: ['tabular-nums'] },
  statusSelect: { minHeight: touch.min, flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  statusSelectText: { color: colors.text, fontSize: 14 },
  statusDot: { width: 8, height: 8, borderRadius: 4, marginRight: spacing.xs },
  statusModalRoot: { flex: 1, justifyContent: 'center', padding: spacing.xxl },
  statusModalBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.32)' },
  statusModal: { backgroundColor: colors.surface, borderRadius: radius.md, overflow: 'hidden' },
  statusOption: { minHeight: touch.min, flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.xl },
  statusOptionText: { color: colors.text, fontSize: 16 },
  statusCheck: { marginLeft: 'auto', fontSize: 20, fontWeight: '700' },
  statusDone: { minHeight: touch.min, alignItems: 'center', justifyContent: 'center', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.borderLight },
  statusDoneText: { color: colors.primary, fontWeight: '700' },
  list: { paddingBottom: 104 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.xl, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.borderLight },
  thumb: { width: 48, height: 48, borderRadius: radius.sm },
  thumbPlaceholder: { width: 48, height: 48, borderRadius: radius.sm, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  rowInfo: { flex: 1 },
  rowName: { fontSize: 15, fontWeight: '600', color: colors.text },
  rowSub: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  rowStatus: { fontSize: 12, color: colors.textFaint },
});
```

Notable changes from the previous version, called out for the reviewer:
- `STATUS_CHIPS` (chip-row toggle array) renamed to `STATUS_TOGGLES` and repurposed for the new status-picker `Modal`, matching `owned.tsx`'s `STATUS_TOGGLES` naming and shape exactly. The chip-row JSX and its styles (`chipRow`/`chip`/`chipActive`/`chipText`/`chipTextActive`) are removed entirely.
- The bare circular FAB (`styles.fab`, `IconPlus`) is removed and replaced by `ListActionBar`, which renders its own add/filter/sort icons — `IconPlus` is no longer imported.
- New `kitTotal`/`filter`/`sort`/`filterOptions`/`showFilter`/`showStatusPicker`/`actionSheet` state, all mirroring `owned.tsx`'s equivalent state variables one-for-one.
- `load()` gains filter conditions, a fixed-status total count query (independent of the current status-toggle selection, exactly like `owned.tsx`'s `inventoryTotal`), a filter-options query, and sort-order interpolation.
- The title-setting effect for `selected === 'all'` now reads "すべてのボックス"/"All Boxes" (was "すべてのキットボックス"/"All Kit Boxes") and additionally calls `router.setParams({ boxName: title })`, matching `owned.tsx` exactly. The per-box branch also gains the same `router.setParams` call it was previously missing.
- `ListEmptyComponent`'s `actionLabel`/`onAction` are now gated on `trulyEmpty` (previously always present), matching `owned.tsx`'s pattern of only offering the "add" shortcut from the empty state when the box is genuinely empty (not just filtered to nothing).

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: zero errors project-wide (this is the last task in the plan).

- [ ] **Step 3: Commit**

```bash
git add "app/(tabs)/kits.tsx"
git commit -m "feat: bring kits.tsx UI/UX to parity with owned.tsx (status bar, filter, sort)"
```

- [ ] **Step 4: Manual verification checklist (Expo Go)**

This is the final task — after this, the feature is complete. On a real device (reload the app fully first, since the `price` column migration runs in `initDB()`):

1. Open the キット (Kitrack) tab. Confirm the top shows "キット数 N・表示数 M" and a status-selector pill with a colored dot, and an ad banner below it.
2. Tap the status selector — confirm a centered modal with 未着手/制作中 checkboxes and an OK button appears, matching the 保管箱 screen's status picker.
3. Confirm the bottom shows the same three-button floating bar (絞り込み/並び替え/追加) as 保管箱, not a bare circular button.
4. Tap 並び替え — confirm 追加順/名前順/メーカー順 options appear and actually reorder the list.
5. Tap 絞り込み — confirm メーカー/シリーズ/種別/スケールのドロップダウンチェックリストが開き、選択すると一覧が絞られること。検索欄でキット名検索も機能すること。
6. Select "すべてのボックス" from the drawer — confirm the header title reads "すべてのボックス" (not "すべてのキットボックス").
7. Add a new kit — confirm a 価格 field appears in the form, accepts a numeric value, and the kit saves successfully.
8. Open an existing kit's detail, enter edit mode — confirm 価格 appears editable next to 種別, saves on blur, and displays with thousands separators (e.g. `12,000`) when not editing.
