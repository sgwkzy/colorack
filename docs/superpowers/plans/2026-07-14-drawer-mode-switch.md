# Colorack/Kitrack Drawer Mode Switch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Colorack/Kitrack mode switch to the navigation drawer, and bring kit boxes to full behavioral parity with paint boxes (default box, completed-kit exclusion from box views, minimum-1 delete guard).

**Architecture:** A new `lib/appMode.ts` module (mirroring the existing `lib/activeBox.ts` subscribe pattern) tracks the drawer's current mode, persisted via the existing `app_settings` key-value store. `NavigationDrawer.tsx` reads this mode and renders either the Colorack section or the Kitrack section, with `塗料一覧`/`設定` shared between both. Kit boxes gain a `default_kit_box_id` setting and a `kits.status = 'completed'` → `box_id = NULL` cascade, mirroring the existing `default_box_id`/`inventory.status = 'used_up'` behavior exactly. A new `/completed` route mirrors the existing `/used` route's "thin wrapper around a shared screen component" pattern.

**Tech Stack:** Same as prior kit plans (Expo SDK ~54 / React Native / expo-sqlite / expo-router). No new dependencies.

## Global Constraints

- No test framework exists in this project. Verification is `npx tsc --noEmit` plus documented manual Expo Go checks.
- No UTF-8 BOM in any modified file.
- New files use the mandatory styling convention `const { colors } = useTheme(); const styles = useMemo(() => makeStyles(colors), [colors]);`. `NavigationDrawer.tsx` already uses this convention — preserve it.
- UI-facing labels for kit boxes must reuse the SAME strings as paint boxes ("すべてのボックス"/`t('addBox')`) inside the drawer — do not introduce "キットボックス"-worded labels there. This is a drawer-only wording change; other screens (`kits.tsx`'s own title, `KitBoxOptions.tsx`'s delete-confirm dialog) keep their existing "キットボックス" wording, since only the drawer was asked to unify terminology.
- This is an addendum to the unmerged `feature/model-management` branch (PR #22) — the branch was just merged with the latest `master` (commit `c9880f6`, "Fix splash icon transparency") before this plan was written; no further merge is needed mid-plan.

---

### Task 1: Default kit box + completed-kit box_id cascade

**Files:**
- Modify: `lib/db.ts`

**Interfaces:**
- Produces: `getDefaultKitBoxId(): Promise<number | null>`, modified `setKitStatus(kitId: number, status: KitStatus): Promise<void>` (now clears `box_id` on completion and restores a default box when leaving completion), a new `kit_boxes` auto-create-if-empty block in `initDB()`, and a one-time migration clearing `box_id` for any kits already marked `completed` before this change.
- Consumed by: Task 4 (`kits.tsx`), Task 6 (`KitBoxOptions.tsx`), Task 7 (`NavigationDrawer.tsx`, indirectly via the schema).

- [ ] **Step 1: Add the kit_boxes auto-create block to `initDB()`**

Find (the existing paint-boxes auto-create block, followed by the seed-version check):

```ts
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
```

Replace with:

```ts
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

  // この仕様導入前に完成(completed)になっていたキットのbox_idを一度だけクリアする。
  // 塗料の使用済み(used_up)がボックスから外れているのと同じ扱いにするため。
  await db.runAsync("UPDATE kits SET box_id = NULL WHERE status = 'completed'");

  // シードバージョンが古い端末は catalog_paints をシードの内容へ更新。
```

- [ ] **Step 2: Add `getDefaultKitBoxId()` next to `getDefaultBoxId()`**

Find:

```ts
export async function getDefaultBoxId(): Promise<number | null> {
  const v = await getSetting('default_box_id');
  if (!v) return null;
  const id = Number(v);
  const exists = await getDB().getFirstAsync('SELECT id FROM boxes WHERE id = ?', [id]);
  return exists ? id : null;
}
```

Replace with:

```ts
export async function getDefaultBoxId(): Promise<number | null> {
  const v = await getSetting('default_box_id');
  if (!v) return null;
  const id = Number(v);
  const exists = await getDB().getFirstAsync('SELECT id FROM boxes WHERE id = ?', [id]);
  return exists ? id : null;
}

export async function getDefaultKitBoxId(): Promise<number | null> {
  const v = await getSetting('default_kit_box_id');
  if (!v) return null;
  const id = Number(v);
  const exists = await getDB().getFirstAsync('SELECT id FROM kit_boxes WHERE id = ?', [id]);
  return exists ? id : null;
}
```

- [ ] **Step 3: Replace `setKitStatus` with the box_id-cascading version**

Find:

```ts
export async function setKitStatus(kitId: number, status: KitStatus): Promise<void> {
  await getDB().runAsync(
    "UPDATE kits SET status = ?, status_changed_at = datetime('now') WHERE id = ?",
    [status, kitId]
  );
}
```

Replace with:

```ts
export async function setKitStatus(kitId: number, status: KitStatus): Promise<void> {
  const defaultBoxId = status === 'completed' ? null : await getDefaultKitBoxId();
  await getDB().runAsync(
    "UPDATE kits SET status = ?, box_id = CASE WHEN ? = 'completed' THEN NULL WHEN box_id IS NULL THEN ? ELSE box_id END, status_changed_at = datetime('now') WHERE id = ?",
    [status, status, defaultBoxId, kitId]
  );
}
```

This exactly mirrors `setInventoryStatus`'s existing CASE pattern (lines ~375-381 of this same file): completing a kit clears its box, and un-completing a kit (from a NULL box_id) assigns it to the default kit box; a kit that already has a real box_id keeps it.

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit`
Expected: no errors attributable to `lib/db.ts`.

Also verify no BOM: `head -c 3 lib/db.ts | od -An -tx1` must not show `ef bb bf`.

- [ ] **Step 5: Commit**

```bash
git add lib/db.ts
git commit -m "feat: add default kit box concept and completed-kit box_id cascade"
```

---

### Task 2: Drawer mode persistence (`lib/appMode.ts`)

**Files:**
- Create: `lib/appMode.ts`
- Modify: `app/_layout.tsx`

**Interfaces:**
- Produces: `AppMode` type (`'colorack' | 'kitrack'`), `initAppMode(): Promise<void>`, `setAppMode(next: AppMode): void`, `useAppMode(): AppMode`.
- Consumed by: Task 7 (`NavigationDrawer.tsx`).

- [ ] **Step 1: Create `lib/appMode.ts`**

```ts
// lib/appMode.ts
// ドロワーのColorack/Kitrackモード。lib/activeBox.ts と同じ購読パターンに、
// app_settings 経由の永続化(起動時復元)を加えたもの。
import { useEffect, useReducer } from 'react';
import { getSetting, setSetting } from './db';

export type AppMode = 'colorack' | 'kitrack';

let appMode: AppMode = 'colorack';
const listeners = new Set<() => void>();

export async function initAppMode(): Promise<void> {
  const saved = await getSetting('appMode');
  if (saved === 'kitrack') appMode = 'kitrack';
}

export function setAppMode(next: AppMode): void {
  if (appMode === next) return;
  appMode = next;
  listeners.forEach((listener) => listener());
  setSetting('appMode', next);
}

export function useAppMode(): AppMode {
  const [, force] = useReducer((value) => value + 1, 0);
  useEffect(() => { listeners.add(force); return () => { listeners.delete(force); }; }, []);
  return appMode;
}
```

- [ ] **Step 2: Wire `initAppMode()` into the app's startup sequence**

Find, in `app/_layout.tsx`:

```tsx
import { initDB } from '../lib/db';
import { initTheme, useTheme } from '../lib/theme';
import { initLocale } from '../lib/i18n';
import { initUiPrefs } from '../lib/uiPrefs';
```

Replace with:

```tsx
import { initAppMode } from '../lib/appMode';
import { initDB } from '../lib/db';
import { initTheme, useTheme } from '../lib/theme';
import { initLocale } from '../lib/i18n';
import { initUiPrefs } from '../lib/uiPrefs';
```

Find:

```tsx
        await initDB();
        await Promise.all([initTheme(), initLocale(), initUiPrefs()]);
```

Replace with:

```tsx
        await initDB();
        await Promise.all([initTheme(), initLocale(), initUiPrefs(), initAppMode()]);
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: no errors attributable to `lib/appMode.ts` or `app/_layout.tsx`.

Also verify no BOM in `lib/appMode.ts`.

- [ ] **Step 4: Commit**

```bash
git add lib/appMode.ts app/_layout.tsx
git commit -m "feat: add persisted Colorack/Kitrack drawer mode"
```

---

### Task 3: Translation key

**Files:**
- Modify: `translations/ja.json`
- Modify: `translations/en.json`

**Interfaces:**
- Produces: `completedKits` key, consumed via `t()` by Task 4 (`app/(tabs)/kits.tsx`) and Task 7 (`NavigationDrawer.tsx`).

- [ ] **Step 1: Add `completedKits` to `translations/ja.json`**

Both files are single-line flat JSON. Insert before the final closing `}`:

```json
,"completedKits":"完成品"
```

- [ ] **Step 2: Add the same key to `translations/en.json`**

```json
,"completedKits":"Completed"
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
console.log('statusCompleted:', ja.statusCompleted);
"
```
Expected: `ja`/`en` counts equal, both "missing" arrays empty, `statusCompleted: 完成` (confirms the pre-existing, similarly-named key is untouched).

Also verify no BOM in either file.

- [ ] **Step 4: Commit**

```bash
git add translations/ja.json translations/en.json
git commit -m "feat: add completedKits translation key"
```

---

### Task 4: `kits.tsx` refactor for reuse by a completed-kits screen

**Files:**
- Modify: `app/(tabs)/kits.tsx`

**Interfaces:**
- Consumes: `getDefaultKitBoxId` from `../../lib/db` (Task 1); `t('completedKits')` (Task 3).
- Produces: named export `KitsScreen({ completedScreen }: { completedScreen?: boolean })`, consumed by Task 5 (`app/(tabs)/completed.tsx`). Default export stays `KitsScreen` rendered with no props (the existing `/kits` route behavior, unchanged).

This mirrors `app/(tabs)/used.tsx`'s existing "thin wrapper reusing `owned.tsx`'s exported `InventoryScreen`" pattern.

- [ ] **Step 1: Replace the entire file**

```tsx
// app/(tabs)/kits.tsx
import { useCallback, useEffect, useState } from 'react';
import { FlatList, Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { IconBox, IconPlus } from '@tabler/icons-react-native';
import { useFocusEffect, useLocalSearchParams, useNavigation } from 'expo-router';
import { getDB, getDefaultKitBoxId, KitStatus } from '../../lib/db';
import { setActiveKitBox } from '../../lib/activeKitBox';
import { t, useLocale } from '../../lib/i18n';
import { lightColors, radius, spacing, useTheme } from '../../lib/theme';
import AddKitModal from '../../components/AddKitModal';
import EmptyState from '../../components/EmptyState';
import KitDetailModal from '../../components/KitDetailModal';

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
const STATUS_CHIPS: { key: KitStatus; labelKey: string }[] = [
  { key: 'not_started', labelKey: 'statusNotStarted' },
  { key: 'building', labelKey: 'statusBuilding' },
];

const STATUS_LABEL_KEYS: Record<KitStatus, string> = {
  not_started: 'statusNotStarted',
  building: 'statusBuilding',
  completed: 'statusCompleted',
};

export function KitsScreen({ completedScreen = false }: { completedScreen?: boolean }) {
  const locale = useLocale();
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const navigation = useNavigation();
  const { boxId } = useLocalSearchParams<{ boxId?: string }>();
  const [selected, setSelected] = useState<Selected>('all');
  const [statuses, setStatuses] = useState<KitStatus[]>(completedScreen ? ['completed'] : ['not_started', 'building']);
  const [items, setItems] = useState<KitListItem[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [detailKitId, setDetailKitId] = useState<number | null>(null);
  const [defaultBoxId, setDefaultBoxId] = useState<number | null>(null);

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
      const title = locale === 'ja' ? 'すべてのキットボックス' : 'All Kit Boxes';
      navigation.setOptions({ title });
      return;
    }
    getDB().getFirstAsync<{ name: string }>('SELECT name FROM kit_boxes WHERE id = ?', [selected]).then((box) => {
      if (box) navigation.setOptions({ title: box.name });
    });
  }, [completedScreen, locale, navigation, selected]);

  useEffect(() => { getDefaultKitBoxId().then(setDefaultBoxId); }, []);

  const load = useCallback(async (sel: Selected, sf: KitStatus[]) => {
    if (sf.length === 0) { setItems([]); return; }
    const where: string[] = [`status IN (${sf.map(() => '?').join(',')})`];
    const args: (string | number)[] = [...sf];
    if (!completedScreen && sel !== 'all') { where.push('box_id = ?'); args.push(sel); }
    const rows = await getDB().getAllAsync<KitListItem>(
      'SELECT id, name, maker, scale, status,'
      + ' (SELECT uri FROM kit_photos WHERE kit_id = kits.id ORDER BY sort_order, id LIMIT 1) AS thumb_uri'
      + ' FROM kits WHERE ' + where.join(' AND ') + ' ORDER BY added_at DESC',
      args
    );
    setItems(rows);
  }, [completedScreen]);

  useFocusEffect(useCallback(() => { load(selected, statuses); }, [load, selected, statuses]));

  const reload = () => load(selected, statuses);
  const toggleStatus = (s: KitStatus) => {
    const next = statuses.includes(s) ? statuses.filter((x) => x !== s) : [...statuses, s];
    setStatuses(next);
  };

  return (
    <View style={styles.container}>
      {!completedScreen ? (
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
      ) : null}

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
          <EmptyState icon={IconBox} title={t('emptyKits')} actionLabel={t('addKit')} onAction={() => setShowAdd(true)} />
        )}
      />

      <TouchableOpacity style={styles.fab} onPress={() => setShowAdd(true)} accessibilityRole="button" accessibilityLabel={t('addKit')}>
        <IconPlus color={colors.onPrimary} size={26} />
      </TouchableOpacity>

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
    </View>
  );
}

export default function KitsRouteScreen() {
  return <KitsScreen />;
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

Notable changes from the previous version, called out for the reviewer:
- `STATUS_CHIPS` dropped `completed` (2 entries now, not 3) — matches `owned.tsx`'s `STATUS_TOGGLES` only ever offering `owned`/`in_use`, never `used_up`.
- Default `statuses` state is `['not_started', 'building']` in normal mode (was `[..., 'completed']`), or `['completed']` when `completedScreen` — completed kits are never mixed into the normal toggle set.
- New `STATUS_LABEL_KEYS` map replaces the old `STATUS_CHIPS.find(...)` lookup for the row's status label text, since `STATUS_CHIPS` no longer contains a `completed` entry and the row list (in `completedScreen` mode) still needs to render "完成" correctly.
- `load()`'s box_id filter is skipped entirely when `completedScreen` (always cross-box).
- The box_id-from-URL-param effect and the `setActiveKitBox` sync effect are both no-ops when `completedScreen` (matching `owned.tsx`'s `isUsedScreen` early-returns).
- `AddKitModal`'s `defaultBoxId` now resolves to `getDefaultKitBoxId()`'s result (not `null`) when viewing "all kit boxes" or the completed screen, matching how `owned.tsx` passes `defaultBoxId` (the fetched default) to `AddPaintModal` when `selected === 'all'`.

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: no errors attributable to `app/(tabs)/kits.tsx`.

- [ ] **Step 3: Commit**

```bash
git add "app/(tabs)/kits.tsx"
git commit -m "refactor: make kits.tsx's screen reusable for a completed-kits view"
```

---

### Task 5: `/completed` route

**Files:**
- Create: `app/(tabs)/completed.tsx`

**Interfaces:**
- Consumes: `KitsScreen` named export from `./kits` (Task 4).

- [ ] **Step 1: Create the file**

```tsx
// app/(tabs)/completed.tsx
import { KitsScreen } from './kits';

export default function CompletedKitsScreen() {
  return <KitsScreen completedScreen />;
}
```

This mirrors `app/(tabs)/used.tsx` exactly:

```tsx
import { InventoryScreen } from './owned';

export default function UsedScreen() {
  return <InventoryScreen usedScreen />;
}
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: no errors attributable to `app/(tabs)/completed.tsx`.

- [ ] **Step 3: Commit**

```bash
git add "app/(tabs)/completed.tsx"
git commit -m "feat: add /completed route for viewing completed kits"
```

---

### Task 6: `KitBoxOptions.tsx` parity with `BoxOptions.tsx`

**Files:**
- Modify: `components/KitBoxOptions.tsx`

**Interfaces:**
- Consumes: `getDefaultKitBoxId`, `setSetting` from `../lib/db` (Task 1 for the former; `setSetting` already exists).
- No change to this component's own exported shape (no props, same as today).

This is a full-file replacement mirroring `components/BoxOptions.tsx`'s structure exactly (adds the "make default" menu action, the `boxes.length > 1` delete guard, and default-box reassignment when the deleted box was the current default).

- [ ] **Step 1: Replace the entire file**

```tsx
// components/KitBoxOptions.tsx
import { useEffect, useState } from 'react';
import { Alert, TouchableOpacity } from 'react-native';
import { IconDotsVertical } from '@tabler/icons-react-native';
import { router } from 'expo-router';
import { useActiveKitBox, notifyKitBoxesChanged, setActiveKitBox, useKitBoxesVersion } from '../lib/activeKitBox';
import { getDB, getDefaultKitBoxId, setSetting } from '../lib/db';
import { t, useLocale } from '../lib/i18n';
import { deleteKitPhoto } from '../lib/kitPhoto';
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
  const [defaultBoxId, setDefaultBoxId] = useState<number | null>(null);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [ordering, setOrdering] = useState(false);
  const box = activeBox === 'all' ? null : boxes.find((item) => item.id === activeBox) ?? null;
  const editLabel = locale === 'ja' ? 'ボックスを編集' : 'Edit Box';

  useEffect(() => {
    Promise.all([
      getDB().getAllAsync<Box>('SELECT id, name, icon, icon_color FROM kit_boxes ORDER BY sort_order, id'),
      getDefaultKitBoxId(),
    ]).then(([items, defaultId]) => { setBoxes(items); setDefaultBoxId(defaultId); });
  }, [activeBox, boxesVersion]);

  if (!box) return null;

  const save = async ({ name, icon, color }: BoxDraft) => {
    await getDB().runAsync('UPDATE kit_boxes SET name = ?, icon = ?, icon_color = ? WHERE id = ?', [name, icon, color, box.id]);
    notifyKitBoxesChanged();
  };

  const remove = async () => {
    const remaining = boxes.filter((item) => item.id !== box.id);
    if (remaining.length === 0) return;
    const nextDefault = remaining[0];
    const db = getDB();
    const currentDefaultId = await getDefaultKitBoxId();
    const photos = await db.getAllAsync<{ uri: string }>('SELECT uri FROM kit_photos WHERE kit_id IN (SELECT id FROM kits WHERE box_id = ?)', [box.id]);
    await db.withTransactionAsync(async () => {
      await db.runAsync('DELETE FROM kit_color_paints WHERE kit_color_id IN (SELECT id FROM kit_colors WHERE kit_id IN (SELECT id FROM kits WHERE box_id = ?))', [box.id]);
      await db.runAsync('DELETE FROM kit_colors WHERE kit_id IN (SELECT id FROM kits WHERE box_id = ?)', [box.id]);
      await db.runAsync('DELETE FROM kit_photos WHERE kit_id IN (SELECT id FROM kits WHERE box_id = ?)', [box.id]);
      await db.runAsync('DELETE FROM kits WHERE box_id = ?', [box.id]);
      await db.runAsync('DELETE FROM kit_boxes WHERE id = ?', [box.id]);
      if (currentDefaultId === box.id) {
        await db.runAsync(
          'INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
          ['default_kit_box_id', String(nextDefault.id)]
        );
      }
    });
    for (const { uri } of photos) await deleteKitPhoto(uri);
    notifyKitBoxesChanged();
    setActiveKitBox(nextDefault.id);
    router.navigate({ pathname: '/kits', params: { boxId: String(nextDefault.id), boxName: nextDefault.name } });
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

  const makeDefault = async () => {
    await setSetting('default_kit_box_id', String(box.id));
    setDefaultBoxId(box.id);
  };

  const buttons: ActionSheetButton[] = [
    { text: locale === 'ja' ? 'このボックスをデフォルトにする' : 'Make this the default box', onPress: makeDefault, disabled: defaultBoxId === box.id },
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

Notable changes from the previous version:
- `defaultBoxId` state + `getDefaultKitBoxId()` fetch, "このボックスをデフォルトにする" menu action (new — `BoxOptions.tsx` already has this, `KitBoxOptions.tsx` didn't).
- `remove()` now early-returns if `remaining.length === 0` (defense-in-depth; the delete button is already hidden at `boxes.length <= 1`) and reassigns `default_kit_box_id` to the next remaining box inside the same transaction if the deleted box was the current default.
- The delete button in `buttons` is now conditionally included only when `boxes.length > 1` (was unconditional before) — this is the deliberate re-introduction of the minimum-1 guard that this addendum's earlier design explicitly removed; it is being restored here per updated direction to match paint boxes' behavior exactly.

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: no errors attributable to `components/KitBoxOptions.tsx`.

- [ ] **Step 3: Commit**

```bash
git add components/KitBoxOptions.tsx
git commit -m "feat: bring kit box options to parity with paint box options (default box, delete guard)"
```

---

### Task 7: `NavigationDrawer.tsx` mode switch

**Files:**
- Modify: `components/NavigationDrawer.tsx`

**Interfaces:**
- Consumes: `AppMode`, `setAppMode`, `useAppMode` from `../lib/appMode` (Task 2); `t('completedKits')` (Task 3).
- No change to this component's own exported `Props` shape (`{ visible, onClose }`).

- [ ] **Step 1: Replace the entire file**

```tsx
// components/NavigationDrawer.tsx
import { ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { IconArchive, IconBox, IconBriefcase, IconBuildingWarehouse, IconCircleCheck, IconFlask, IconHistory, IconHeart, IconPackage, IconPalette, IconPlus, IconSettings, IconShoppingCartPlus, IconStack } from '@tabler/icons-react-native';
import { router, usePathname } from 'expo-router';
import { AppMode, setAppMode, useAppMode } from '../lib/appMode';
import { notifyBoxesChanged, setActiveBox, useActiveBox } from '../lib/activeBox';
import { notifyKitBoxesChanged, setActiveKitBox, useActiveKitBox } from '../lib/activeKitBox';
import { getDB } from '../lib/db';
import { t, useLocale } from '../lib/i18n';
import { lightColors, spacing, touch, useTheme } from '../lib/theme';
import BoxEditorModal, { BoxDraft, BoxIcon } from './BoxEditorModal';

interface Box { id: number; name: string; icon: BoxIcon | null; icon_color: string | null; }
interface CountRow { box_id: number | null; n: number; }
interface TotalRow { n: number; }
interface Props { visible: boolean; onClose: () => void; }

export default function NavigationDrawer({ visible, onClose }: Props) {
  const { colors } = useTheme();
  const locale = useLocale();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const pathname = usePathname();
  const mode = useAppMode();
  const activeBoxId = useActiveBox();
  const allBoxesLabel = locale === 'ja' ? 'すべてのボックス' : 'All Boxes';
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [boxCounts, setBoxCounts] = useState<Map<number | null, number>>(new Map());
  const [favoriteCount, setFavoriteCount] = useState(0);
  const [wishlistCount, setWishlistCount] = useState(0);
  const [usedCount, setUsedCount] = useState(0);
  const [editingBox, setEditingBox] = useState<'new' | null>(null);
  const activeKitBoxId = useActiveKitBox();
  const [kitBoxes, setKitBoxes] = useState<Box[]>([]);
  const [kitCounts, setKitCounts] = useState<Map<number | null, number>>(new Map());
  const [completedCount, setCompletedCount] = useState(0);
  const [editingKitBox, setEditingKitBox] = useState<'new' | null>(null);

  const loadBoxes = useCallback(async () => {
    const db = getDB();
    const [boxRows, countRows, favoriteRow, wishlistRow, usedRow, kitBoxRows, kitCountRows, completedRow] = await Promise.all([
      db.getAllAsync<Box>('SELECT id, name, icon, icon_color FROM boxes ORDER BY sort_order, id'),
      db.getAllAsync<CountRow>("SELECT box_id, COUNT(*) AS n FROM inventory WHERE status IN ('owned', 'in_use') GROUP BY box_id"),
      db.getFirstAsync<TotalRow>("SELECT COUNT(*) AS n FROM lists WHERE type = 'favorites'"),
      db.getFirstAsync<TotalRow>("SELECT COUNT(*) AS n FROM lists WHERE type = 'wishlist'"),
      db.getFirstAsync<TotalRow>("SELECT COUNT(*) AS n FROM inventory WHERE status = 'used_up'"),
      db.getAllAsync<Box>('SELECT id, name, icon, icon_color FROM kit_boxes ORDER BY sort_order, id'),
      db.getAllAsync<CountRow>("SELECT box_id, COUNT(*) AS n FROM kits WHERE status != 'completed' GROUP BY box_id"),
      db.getFirstAsync<TotalRow>("SELECT COUNT(*) AS n FROM kits WHERE status = 'completed'"),
    ]);
    setBoxes(boxRows);
    setBoxCounts(new Map(countRows.map((row) => [row.box_id, row.n])));
    setFavoriteCount(favoriteRow?.n ?? 0);
    setWishlistCount(wishlistRow?.n ?? 0);
    setUsedCount(usedRow?.n ?? 0);
    setKitBoxes(kitBoxRows);
    setKitCounts(new Map(kitCountRows.map((row) => [row.box_id, row.n])));
    setCompletedCount(completedRow?.n ?? 0);
  }, []);
  useEffect(() => { if (visible) loadBoxes(); }, [visible, loadBoxes]);
  const saveBox = async ({ name, icon, color }: BoxDraft) => {
    const db = getDB();
    if (editingBox === 'new') await db.runAsync('INSERT INTO boxes (name, icon, icon_color, sort_order) VALUES (?, ?, ?, COALESCE((SELECT MAX(sort_order) + 1 FROM boxes), 0))', [name, icon, color]);
    notifyBoxesChanged();
    await loadBoxes();
  };
  const saveKitBox = async ({ name, icon, color }: BoxDraft) => {
    const db = getDB();
    if (editingKitBox === 'new') await db.runAsync('INSERT INTO kit_boxes (name, icon, icon_color, sort_order) VALUES (?, ?, ?, COALESCE((SELECT MAX(sort_order) + 1 FROM kit_boxes), 0))', [name, icon, color]);
    notifyKitBoxesChanged();
    await loadBoxes();
  };
  const go = (pathname: '/owned' | '/used' | '/favorites' | '/wishlist' | '/catalog' | '/settings', boxId?: number | 'all') => {
    if (pathname === '/owned' && boxId !== undefined) setActiveBox(boxId);
    onClose();
    if (boxId !== undefined) router.navigate({ pathname, params: { boxId: String(boxId) } });
    else router.navigate(pathname);
  };
  const goKits = (boxId: number | 'all') => {
    setActiveKitBox(boxId);
    onClose();
    router.navigate({ pathname: '/kits', params: { boxId: String(boxId) } });
  };
  const goCompleted = () => {
    onClose();
    router.navigate('/completed');
  };
  const item = (label: string, onPress: () => void, icon: ReactNode, active = false, count?: number, key?: string) => (
    <TouchableOpacity key={key} style={[styles.item, active && styles.activeItem]} onPress={onPress} accessibilityRole="button">
      <View style={styles.icon}>{icon}</View><Text style={[styles.itemText, active && styles.activeText]}>{label}</Text>
      {count !== undefined ? <Text style={styles.count}>{count}</Text> : null}
    </TouchableOpacity>
  );
  const boxIcon = (box: Box) => {
    const color = box.icon_color ?? colors.primary;
    if (box.icon === 'archive') return <IconArchive color={color} size={22} />;
    if (box.icon === 'briefcase') return <IconBriefcase color={color} size={22} />;
    if (box.icon === 'warehouse') return <IconBuildingWarehouse color={color} size={22} />;
    if (box.icon === 'package') return <IconPackage color={color} size={22} />;
    if (box.icon === 'flask') return <IconFlask color={color} size={22} />;
    if (box.icon === 'stack') return <IconStack color={color} size={22} />;
    return <IconBox color={color} size={22} />;
  };
  const totalCount = Array.from(boxCounts.values()).reduce((sum, count) => sum + count, 0);
  const kitTotalCount = Array.from(kitCounts.values()).reduce((sum, count) => sum + count, 0);
  const otherMode: AppMode = mode === 'colorack' ? 'kitrack' : 'colorack';
  const otherModeLabel = otherMode === 'colorack' ? 'Colorack' : 'Kitrack';

  return (
        <SafeAreaView edges={['top', 'bottom']} style={styles.drawerContent}>
          <ScrollView contentContainerStyle={styles.content}>
            <View style={styles.titleRow}>
              <Text style={styles.title}>{mode === 'colorack' ? 'Colorack' : 'Kitrack'}</Text>
              <TouchableOpacity onPress={() => setAppMode(otherMode)} hitSlop={8} accessibilityRole="button" accessibilityLabel={otherModeLabel}>
                <Text style={styles.modeSwitchText}>{otherModeLabel}</Text>
              </TouchableOpacity>
            </View>
            {mode === 'colorack' ? (
              <>
                {item(allBoxesLabel, () => go('/owned', 'all'), <IconBox color={colors.textMuted} size={22} />, pathname.endsWith('/owned') && activeBoxId === 'all', totalCount)}
                <View style={styles.divider} />
                {boxes.map((box) => item(box.name, () => go('/owned', box.id), boxIcon(box), pathname.endsWith('/owned') && activeBoxId === box.id, boxCounts.get(box.id) ?? 0, `box-${box.id}`))}
                {boxes.length < 8 ? item(t('addBox'), () => setEditingBox('new'), <IconPlus color={colors.primary} size={22} />) : null}
                <View style={styles.divider} />
                {item(t('statusUsedUp'), () => go('/used'), <IconHistory color={colors.textMuted} size={22} />, pathname.endsWith('/used'), usedCount)}
                {item(t('favorites'), () => go('/favorites'), <IconHeart color={colors.textMuted} size={22} />, pathname.endsWith('/favorites'), favoriteCount)}
                {item(t('wishlist'), () => go('/wishlist'), <IconShoppingCartPlus color={colors.textMuted} size={22} />, pathname.endsWith('/wishlist'), wishlistCount)}
              </>
            ) : (
              <>
                {item(allBoxesLabel, () => goKits('all'), <IconBox color={colors.textMuted} size={22} />, pathname.endsWith('/kits') && activeKitBoxId === 'all', kitTotalCount)}
                <View style={styles.divider} />
                {kitBoxes.map((box) => item(box.name, () => goKits(box.id), boxIcon(box), pathname.endsWith('/kits') && activeKitBoxId === box.id, kitCounts.get(box.id) ?? 0, `kitbox-${box.id}`))}
                {kitBoxes.length < 8 ? item(t('addBox'), () => setEditingKitBox('new'), <IconPlus color={colors.primary} size={22} />) : null}
                <View style={styles.divider} />
                {item(t('completedKits'), goCompleted, <IconCircleCheck color={colors.textMuted} size={22} />, pathname.endsWith('/completed'), completedCount)}
              </>
            )}
            <View style={styles.divider} />
            {item(t('catalog'), () => go('/catalog'), <IconPalette color={colors.textMuted} size={22} />, pathname.endsWith('/catalog'))}
            {item(t('settings'), () => go('/settings'), <IconSettings color={colors.textMuted} size={22} />, pathname.endsWith('/settings'))}
          </ScrollView>
          <BoxEditorModal visible={editingBox === 'new'} title={t('addBox')} onSave={saveBox} onClose={() => setEditingBox(null)} />
          <BoxEditorModal visible={editingKitBox === 'new'} title={t('addBox')} onSave={saveKitBox} onClose={() => setEditingKitBox(null)} />
        </SafeAreaView>
  );
}

const makeStyles = (colors: typeof lightColors) => StyleSheet.create({
  drawerContent: { flex: 1, backgroundColor: colors.surface },
  content: { paddingBottom: spacing.xxl },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.xxl, paddingBottom: spacing.xl },
  title: { fontSize: 22, fontWeight: '700', color: colors.text },
  modeSwitchText: { fontSize: 14, fontWeight: '700', color: colors.primary },
  item: { minHeight: touch.min, flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.xl, paddingVertical: spacing.md },
  activeItem: { backgroundColor: colors.primarySoft },
  icon: { width: 32, alignItems: 'center' },
  itemText: { marginLeft: spacing.md, color: colors.text, fontSize: 16 },
  count: { marginLeft: 'auto', color: colors.textFaint, fontSize: 14, fontVariant: ['tabular-nums'] },
  activeText: { color: colors.primary, fontWeight: '700' },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.borderLight, marginVertical: spacing.sm, marginHorizontal: spacing.xl },
});
```

Notable changes from the previous version:
- `title`/`sectionLabel`(old "キット" section header) removed; replaced by the `titleRow` (brand name + mode-switch link) and a mode-conditional block.
- `allKitBoxesLabel`(old, hardcoded "すべてのキットボックス") no longer used in the drawer — replaced by the SAME `allBoxesLabel` used for paint boxes, per the terminology-unification requirement. `t('addKitBox')` similarly replaced by `t('addBox')` for the kit "add box" link.
- Kit box count query now excludes `completed` kits (`WHERE status != 'completed'`) — without this, a completed kit's `box_id = NULL` row would still land in the count map under a `null` key and inflate `kitTotalCount` ("all kit boxes" total), even though it's supposed to be invisible from normal kit-box browsing.
- New `completedCount` state + query, new `完成品` item navigating to `/completed` (added in Task 5).
- `塗料一覧`/`設定` moved outside the mode-conditional block (both modes render them, at the end of the list).

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: zero errors project-wide (this is the last task in the plan; no other file is left mid-migration).

- [ ] **Step 3: Commit**

```bash
git add components/NavigationDrawer.tsx
git commit -m "feat: add Colorack/Kitrack mode switch to the navigation drawer"
```

- [ ] **Step 4: Manual verification checklist (Expo Go)**

This is the final task — after this, the feature is complete. On a real device (reload the app fully first, since `initDB()`'s schema/migration changed):

1. Open the drawer. Confirm it shows "Colorack" with a "Kitrack" link at the top-right, and the normal paint-box content below (すべてのボックス/個別/追加/使用済み/お気に入り/買い物リスト/塗料一覧/設定) — no "キット"/kit-box content visible.
2. Tap "Kitrack". Confirm the title becomes "Kitrack" with a "Colorack" link, and the content switches to: すべてのボックス/個別キットボックス(labeled "ボックス", not "キットボックス")/追加/完成品/塗料一覧/設定.
3. Close and reopen the app entirely. Open the drawer again — confirm it's still in Kitrack mode (persisted).
4. Switch back to Colorack, add a new kit box from the drawer ("ボックスを追加"), confirm it appears using the same flow as adding a paint box.
5. Go to a kit, mark it "完成" via its status picker. Confirm it disappears from its kit box's list and from "すべてのボックス" (Kitrack). Confirm it now appears under 完成品 (drawer link), with the correct thumbnail/name.
6. Change that kit's status back to 未着手 or 制作中. Confirm it reappears in the box list, now inside whichever box is currently set as default (check via a kit box's "⋮" menu → "このボックスをデフォルトにする" state).
7. Reduce kit boxes down to 1 (delete others via "⋮" → 削除). Confirm the delete option disappears from the "⋮" menu once only 1 box remains.
8. Set a non-default kit box as default via "⋮" → "このボックスをデフォルトにする", then delete a DIFFERENT box that isn't the default — confirm the default selection is unaffected. Then delete the box that currently IS the default (with 2+ boxes still existing before deletion) — confirm another box automatically becomes the new default (check via the menu on a remaining box).

## Self-Review Notes

- **Spec coverage:** モード切り替え+永続化(Tasks 2, 7)✓; Kitrackドロワーの構成(ボックス一覧+完成品+塗料一覧+設定、Task 7)✓; 「ボックス」表記統一(Task 7's reuse of `allBoxesLabel`/`t('addBox')`)✓; `/completed`画面(Tasks 4, 5)✓; 完成品のbox_id除外(Task 1)✓; デフォルトキットボックス+0件時自動作成(Task 1)✓; キットボックス削除の下限1(Task 6)✓.
- **Type consistency:** `AppMode`(Task 2)は`'colorack' | 'kitrack'`のみで、Task 7の`mode === 'colorack' ? ... : ...`分岐と完全に一致。`KitsScreen`(Task 4)の`completedScreen?: boolean`はTask 5の呼び出し側と一致。`getDefaultKitBoxId`(Task 1)の戻り値型`Promise<number | null>`は、Task 4/6双方の`defaultBoxId`ステート型`number | null`と一致。
- **No placeholders:** every step has complete, runnable code.
