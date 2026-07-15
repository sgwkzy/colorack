# Kit Color Mixing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the kit feature's single-paint "used colors" list with a color-mixing composer: each color entry has a user-given name, an optional note, and 1–5 component paints with mix ratios, previewed live via Kubelka-Munk-based spectral mixing (`spectral.js`).

**Architecture:** `kit_paints` (1 row = 1 paint) is replaced by `kit_colors` (a named color entry) + `kit_color_paints` (its component paints and ratios) — the same parent/child table shape already used for `kits`/`kit_photos`. A new `KitColorComposerModal.tsx` replaces `KitPaintPickerModal.tsx`: it reuses the existing `HierarchyBrowser`/`ColorMatcher` paint-picker components unmodified (just rewiring their `onSelect` callback), adds a bottom accordion for the in-progress mix (always-visible preview swatch + collapsible ratio list), and saves via a new `addKitColor` DB function. `KitDetailModal.tsx`'s "used colors" list switches from `KitPaintRow` to a new `KitColorRow` that shows the mixed swatch and a paint breakdown.

**Tech Stack:** Same as prior kit-management plans (Expo SDK ~54 / React Native / expo-sqlite), plus one new dependency: `spectral.js` (npm, MIT license, zero dependencies, pure JS — verified to work correctly for both white-dilution and blue+yellow→green mixing, and confirmed to contain no browser-only APIs).

## Global Constraints

- No test framework exists in this project. Verification is `npx tsc --noEmit` plus documented manual Expo Go checks. Do not write test files or fabricate a TDD cycle.
- Every new/modified file: no UTF-8 BOM, and new files use the mandatory styling convention `const { colors } = useTheme(); const styles = useMemo(() => makeStyles(colors), [colors]);`. Files already established with a different convention (e.g. `KitDetailModal.tsx` calls `makeStyles(colors)` directly without `useMemo`) keep their existing convention — do not "fix" this in passing.
- All user-facing strings go through `t('key')` from `lib/i18n.ts`.
- `spectral.js` has no bundled TypeScript types and no `@types/spectral.js` package exists — this plan adds a local ambient module declaration (`types/spectral.d.ts`).
- Component composition/ratio is immutable after a color is saved (per the approved spec): only the color's name and note can be edited afterward. To change which paints are used, delete the color entry and recreate it.
- This is an addendum to the unmerged `feature/model-management` branch (PR #22) — no data migration concerns for `kit_colors`/`kit_color_paints` themselves (new tables), but `kit_paints` may already contain real rows on a device that tested the kit feature, so a migration path is required (see Task 1).
- Ratio storage: `kit_color_paints.ratio` is a fraction in `[0, 1]`; normalization (making ratios sum to 1) happens in the composer UI at save time, not inside `lib/db.ts`'s `addKitColor`.

---

### Task 1: Database schema, migration, and query functions

**Files:**
- Modify: `lib/db.ts`

**Interfaces:**
- Produces: `KitColorPaint` interface, `KitColorSummary` interface, `getKitColors(kitId: number): Promise<KitColorSummary[]>`, `addKitColor(kitId: number, name: string | null, note: string | null, paints: { paintId: number; ratio: number }[]): Promise<void>`, `updateKitColorName(kitColorId: number, name: string): Promise<void>`, `updateKitColorNote(kitColorId: number, note: string): Promise<void>`, `removeKitColor(kitColorId: number): Promise<void>`. Removes `KitPaintRow` interface, `getKitPaints`, `addKitPaint`, `updateKitPaintNote`, `removeKitPaint`. Modifies `deleteKit` to cascade through `kit_color_paints`/`kit_colors` instead of `kit_paints`.
- Consumed by: Task 4 (`KitColorRow.tsx`), Task 5 (`KitColorComposerModal.tsx`), Task 6 (`KitDetailModal.tsx`), Task 7 (`KitBoxOptions.tsx`, via the new tables directly in SQL).

- [ ] **Step 1: Replace the `kit_paints` table with `kit_colors`/`kit_color_paints`**

Open `lib/db.ts`. Find (inside `initDB()`'s first `execAsync` call):

```ts
    'CREATE TABLE IF NOT EXISTS kit_paints (' +
    '  id INTEGER PRIMARY KEY AUTOINCREMENT,' +
    '  kit_id INTEGER NOT NULL, paint_id INTEGER NOT NULL, note TEXT,' +
    "  added_at TEXT DEFAULT (datetime('now'))" +
    ');' +
    'CREATE TABLE IF NOT EXISTS kit_photos (' +
```

Replace with:

```ts
    'CREATE TABLE IF NOT EXISTS kit_colors (' +
    '  id INTEGER PRIMARY KEY AUTOINCREMENT,' +
    '  kit_id INTEGER NOT NULL, name TEXT, note TEXT,' +
    "  added_at TEXT DEFAULT (datetime('now'))" +
    ');' +
    'CREATE TABLE IF NOT EXISTS kit_color_paints (' +
    '  id INTEGER PRIMARY KEY AUTOINCREMENT,' +
    '  kit_color_id INTEGER NOT NULL, paint_id INTEGER NOT NULL, ratio REAL NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0' +
    ');' +
    'CREATE TABLE IF NOT EXISTS kit_photos (' +
```

- [ ] **Step 2: Add the `kit_paints` → `kit_colors`/`kit_color_paints` migration**

Find this block (the old-schema catalog rebuild migration):

```ts
  // 旧デフォルト名「ボックス」の既存端末を「Box」へ一度だけ移行。
  await db.runAsync("UPDATE boxes SET name = 'Box' WHERE name = 'ボックス'");
```

Insert the following immediately BEFORE it (i.e., right after the `hasCatalogCode` migration block's closing `}`, before the `// 旧デフォルト名` comment):

```ts
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

```

- [ ] **Step 3: Replace `KitPaintRow`/`getKitPaints`/`addKitPaint`/`updateKitPaintNote`/`removeKitPaint` with the new color functions**

Find this block:

```ts
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

Replace it entirely with:

```ts
export interface KitColorPaint {
  paint_id: number;
  ratio: number;
  sort_order: number;
  name_ja: string;
  name_en: string | null;
  code: string;
  brand: string;
  hex: string | null;
}

export interface KitColorSummary {
  id: number;
  name: string | null;
  note: string | null;
  paints: KitColorPaint[];
}

export async function getKitColors(kitId: number): Promise<KitColorSummary[]> {
  const db = getDB();
  const colorRows = await db.getAllAsync<{ id: number; name: string | null; note: string | null }>(
    'SELECT id, name, note FROM kit_colors WHERE kit_id = ? ORDER BY added_at',
    [kitId]
  );
  const paintRows = await db.getAllAsync<KitColorPaint & { kit_color_id: number }>(
    'SELECT kcp.kit_color_id, kcp.paint_id, kcp.ratio, kcp.sort_order, c.name_ja, c.name_en, c.code, c.brand, c.hex'
    + ' FROM kit_color_paints kcp JOIN catalog_paints c ON kcp.paint_id = c.id'
    + ' WHERE kcp.kit_color_id IN (SELECT id FROM kit_colors WHERE kit_id = ?)'
    + ' ORDER BY kcp.sort_order, kcp.id',
    [kitId]
  );
  return colorRows.map((color) => ({
    ...color,
    paints: paintRows.filter((p) => p.kit_color_id === color.id),
  }));
}

export async function addKitColor(
  kitId: number,
  name: string | null,
  note: string | null,
  paints: { paintId: number; ratio: number }[]
): Promise<void> {
  const db = getDB();
  await db.withTransactionAsync(async () => {
    const result = await db.runAsync(
      'INSERT INTO kit_colors (kit_id, name, note) VALUES (?, ?, ?)',
      [kitId, name, note]
    );
    const kitColorId = result.lastInsertRowId;
    for (const [index, p] of paints.entries()) {
      await db.runAsync(
        'INSERT INTO kit_color_paints (kit_color_id, paint_id, ratio, sort_order) VALUES (?, ?, ?, ?)',
        [kitColorId, p.paintId, p.ratio, index]
      );
    }
  });
}

export async function updateKitColorName(kitColorId: number, name: string): Promise<void> {
  const normalized = name.trim() === '' ? null : name;
  await getDB().runAsync('UPDATE kit_colors SET name = ? WHERE id = ?', [normalized, kitColorId]);
}

export async function updateKitColorNote(kitColorId: number, note: string): Promise<void> {
  const normalized = note.trim() === '' ? null : note;
  await getDB().runAsync('UPDATE kit_colors SET note = ? WHERE id = ?', [normalized, kitColorId]);
}

export async function removeKitColor(kitColorId: number): Promise<void> {
  const db = getDB();
  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM kit_color_paints WHERE kit_color_id = ?', [kitColorId]);
    await db.runAsync('DELETE FROM kit_colors WHERE id = ?', [kitColorId]);
  });
}
```

Note: `KitPaintRow` (interface) collides in name with the separate `components/KitPaintRow.tsx` component — that collision goes away entirely once Task 8 deletes `components/KitPaintRow.tsx`. Until then, both still exist; this task does not touch the component file.

- [ ] **Step 4: Update `deleteKit`'s cascade**

Find:

```ts
export async function deleteKit(kitId: number): Promise<void> {
  const db = getDB();
  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM kit_paints WHERE kit_id = ?', [kitId]);
    await db.runAsync('DELETE FROM kit_photos WHERE kit_id = ?', [kitId]);
    await db.runAsync('DELETE FROM kits WHERE id = ?', [kitId]);
  });
}
```

Replace with:

```ts
export async function deleteKit(kitId: number): Promise<void> {
  const db = getDB();
  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM kit_color_paints WHERE kit_color_id IN (SELECT id FROM kit_colors WHERE kit_id = ?)', [kitId]);
    await db.runAsync('DELETE FROM kit_colors WHERE kit_id = ?', [kitId]);
    await db.runAsync('DELETE FROM kit_photos WHERE kit_id = ?', [kitId]);
    await db.runAsync('DELETE FROM kits WHERE id = ?', [kitId]);
  });
}
```

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit`
Expected: errors in `components/KitDetailModal.tsx` (still imports the now-removed `getKitPaints`/`KitPaintRow`/`addKitPaint`/`updateKitPaintNote`/`removeKitPaint`) and possibly `components/KitPaintPickerModal.tsx`/`components/KitPaintRow.tsx` themselves if they reference the removed exports by name. This is expected — Tasks 4–6 fix these. Confirm `lib/db.ts` itself has zero errors attributable to it.

Also verify no BOM: `head -c 3 lib/db.ts | od -An -tx1` must not show `ef bb bf`.

- [ ] **Step 6: Commit**

```bash
git add lib/db.ts
git commit -m "feat: replace kit_paints with kit_colors/kit_color_paints for color mixing"
```

---

### Task 2: `spectral.js` dependency and `lib/colorMix.ts`

**Files:**
- Modify: `package.json`, `package-lock.json` (via `npm install`)
- Create: `types/spectral.d.ts`
- Create: `lib/colorMix.ts`

**Interfaces:**
- Produces: `mixHexColors(paints: { hex: string; ratio: number }[]): string | null`, exported from `lib/colorMix.ts`.
- Consumed by: Task 4 (`KitColorRow.tsx`), Task 5 (`KitColorComposerModal.tsx`).

- [ ] **Step 1: Install the dependency**

```bash
npm install spectral.js
```

Verify `package.json`'s `dependencies` now includes `"spectral.js": "^3.0.0"` (or whatever exact version npm resolves — do not pin manually, use what npm writes).

- [ ] **Step 2: Add the ambient TypeScript module declaration**

`spectral.js` ships no TypeScript types and no `@types/spectral.js` package exists. Create `types/spectral.d.ts`:

```ts
declare module 'spectral.js' {
  export class Color {
    constructor(value: string | number[]);
    tintingStrength: number;
    toString(): string;
  }
  export function mix(...colors: [Color, number][]): Color;
}
```

This declares only the surface this project actually uses (`Color` constructor + `.toString()`, and the variadic `mix` function) — `palette`/`gradient`/GLSL helpers from the library are intentionally left undeclared since nothing here calls them.

- [ ] **Step 3: Create `lib/colorMix.ts`**

```ts
// lib/colorMix.ts
// キットの混色プレビュー計算。npm の spectral.js (MIT, 依存なし) を利用する。
// 自作のチャンネル別Kubelka-Munk近似は、白での希釈が機能しない欠陥が実装前の検算で
// 判明したため不採用。spectral.js は白希釈・補色混色(青+黄→緑)の両方で
// 正しい結果になることを事前に検証済み。
// 検証例: mixHexColors([{hex:'#ffffff',ratio:0.5},{hex:'#ff0000',ratio:0.5}]) → 明るいピンク
//         mixHexColors([{hex:'#0000ff',ratio:0.5},{hex:'#ffff00',ratio:0.5}]) → 緑
import * as spectral from 'spectral.js';

export interface MixInput {
  hex: string;
  ratio: number;
}

// 塗料のHEXと割合(比率。合計が1である必要はなく、spectral.js が内部で正規化する)から
// 混色後のHEXを算出する。有効なHEXが1つもなければ null。
export function mixHexColors(paints: MixInput[]): string | null {
  const valid = paints.filter((p) => /^#?[0-9a-fA-F]{6}$/.test(p.hex.replace(/^#/, '')));
  if (valid.length === 0) return null;
  const colors: [InstanceType<typeof spectral.Color>, number][] = valid.map(
    (p) => [new spectral.Color(p.hex), p.ratio]
  );
  return spectral.mix(...colors).toString();
}
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit`
Expected: no errors attributable to `lib/colorMix.ts` or `types/spectral.d.ts`.

Run a manual sanity check (this project has no test framework, so this is a one-off scratch check, not a committed test file):

```bash
node -e "
const spectral = require('spectral.js');
const mix = spectral.mix([new spectral.Color('#ffffff'), 0.5], [new spectral.Color('#ff0000'), 0.5]);
console.log(mix.toString());
"
```
Expected output: a lightened pink hex (e.g. `#FF424A`), NOT a value close to `#FF0000`/`#FF0101` (which would indicate the white failed to lighten the mix).

Also verify no BOM in `lib/colorMix.ts` and `types/spectral.d.ts`.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json types/spectral.d.ts lib/colorMix.ts
git commit -m "feat: add spectral.js dependency and colorMix wrapper for kit color mixing"
```

---

### Task 3: Translation keys

**Files:**
- Modify: `translations/ja.json`
- Modify: `translations/en.json`

**Interfaces:**
- Produces: `colorNameLabel`, `currentColor` keys, consumed via `t()` by Task 4 and Task 5. Reuses existing keys `hierarchy` ("一覧から"/"From List"), `colorMatch` ("近似色"/"Color Match"), `addColor`, `usedPaints`, `note`, `delete`, `cancel`, `save` — none of those need changes.

- [ ] **Step 1: Add `colorNameLabel` and `currentColor` to `translations/ja.json`**

Both files are single-line flat JSON. Insert before the final closing `}`:

```json
,"colorNameLabel":"色名","currentColor":"現在の色"
```

- [ ] **Step 2: Add the same keys to `translations/en.json`**

```json
,"colorNameLabel":"Color Name","currentColor":"Current Color"
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
console.log('hierarchy:', ja.hierarchy, '| colorMatch:', ja.colorMatch);
"
```
Expected: `ja`/`en` counts equal, both "missing" arrays empty, `hierarchy: 一覧から | colorMatch: 近似色` (confirms the reused keys are unchanged).

Also verify no BOM in either file.

- [ ] **Step 4: Commit**

```bash
git add translations/ja.json translations/en.json
git commit -m "feat: add colorNameLabel and currentColor translation keys"
```

---

### Task 4: `KitColorRow.tsx`

**Files:**
- Create: `components/KitColorRow.tsx`

**Interfaces:**
- Consumes: `KitColorSummary` from `../lib/db` (Task 1), `mixHexColors` from `../lib/colorMix` (Task 2), `paintName` from `../lib/paintLabel` (existing, unchanged).
- Produces: default-exported `KitColorRow({ color, onNameChange, onNoteChange, onRemove }: { color: KitColorSummary; onNameChange: (name: string) => void; onNoteChange: (note: string) => void; onRemove: () => void })`. Consumed by Task 6 (`KitDetailModal.tsx`).

- [ ] **Step 1: Create the component**

This mirrors `components/KitPaintRow.tsx`'s existing structure (swatch + info + delete button + note field), extended with a mixed-color swatch, a breakdown subtitle, and an editable name field.

```tsx
// components/KitColorRow.tsx
import { useMemo, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { IconTrash } from '@tabler/icons-react-native';
import { KitColorSummary } from '../lib/db';
import { mixHexColors } from '../lib/colorMix';
import { t } from '../lib/i18n';
import { paintName } from '../lib/paintLabel';
import { lightColors, radius, spacing, touch, useTheme } from '../lib/theme';
import ClearableInput from './ClearableInput';

interface Props {
  color: KitColorSummary;
  onNameChange: (name: string) => void;
  onNoteChange: (note: string) => void;
  onRemove: () => void;
}

export default function KitColorRow({ color, onNameChange, onNoteChange, onRemove }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [name, setName] = useState(color.name ?? '');
  const [note, setNote] = useState(color.note ?? '');

  const swatchHex = useMemo(() => mixHexColors(
    color.paints.filter((p) => p.hex).map((p) => ({ hex: p.hex as string, ratio: p.ratio }))
  ), [color.paints]);

  const fallbackName = color.paints[0] ? paintName(color.paints[0].name_ja, color.paints[0].name_en) : '';
  const breakdown = color.paints
    .map((p) => `${paintName(p.name_ja, p.name_en)} ${Math.round(p.ratio * 100)}%`)
    .join(' + ');

  return (
    <View style={styles.row}>
      <View style={styles.top}>
        <View style={[styles.swatch, { backgroundColor: swatchHex ?? colors.transparent }]} />
        <Text numberOfLines={1} style={styles.breakdown}>{breakdown}</Text>
        <TouchableOpacity onPress={onRemove} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('delete')}>
          <IconTrash color={colors.danger} size={20} />
        </TouchableOpacity>
      </View>
      <ClearableInput
        style={styles.nameInput}
        value={name}
        onChangeText={setName}
        onBlur={() => onNameChange(name)}
        placeholder={fallbackName || t('colorNameLabel')}
      />
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
  breakdown: { flex: 1, fontSize: 12, color: colors.textMuted },
  nameInput: { minHeight: touch.min, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: 10, color: colors.text, fontSize: 15, fontWeight: '600' },
  noteInput: { minHeight: touch.min, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: 10, color: colors.text, fontSize: 13 },
});
```

Note: `styles.nameInput` sets `fontWeight`/`fontSize` on the wrapper `View` that `ClearableInput` renders — these properties have no visual effect on a `View` (they only affect `Text`/`TextInput`). This mirrors an existing limitation of `ClearableInput`'s `style` prop (it only meaningfully customizes the wrapper's box appearance — border/padding/background — not the inner text's font). The name field will render with the app's default `TextInput` font weight/size, not bold — this is a known, acceptable cosmetic limitation, not a bug to fix in this task (fixing `ClearableInput` itself is out of scope).

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: no errors attributable to `components/KitColorRow.tsx`.

- [ ] **Step 3: Commit**

```bash
git add components/KitColorRow.tsx
git commit -m "feat: add KitColorRow to display mixed kit colors"
```

---

### Task 5: `KitColorComposerModal.tsx`

**Files:**
- Create: `components/KitColorComposerModal.tsx`

**Interfaces:**
- Consumes: `addKitColor` from `../lib/db` (Task 1); `mixHexColors` from `../lib/colorMix` (Task 2); `t('colorNameLabel')`/`t('currentColor')` (Task 3); `HierarchyBrowser` from `./AddPaint/HierarchyBrowser` (existing, unmodified); `ColorMatcher` from `./AddPaint/ColorMatcher` (existing, unmodified); `paintName` from `../lib/paintLabel` (existing).
- Produces: default-exported `KitColorComposerModal({ visible, kitId, onClose, onAdded }: { visible: boolean; kitId: number; onClose: () => void; onAdded: () => void })`. Consumed by Task 6 (`KitDetailModal.tsx`) as a drop-in replacement for `KitPaintPickerModal`'s same prop shape.

- [ ] **Step 1: Create the component**

```tsx
// components/KitColorComposerModal.tsx
import { useEffect, useMemo, useState } from 'react';
import { Modal, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { IconChevronDown, IconChevronUp, IconTrash, IconX } from '@tabler/icons-react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { addKitColor } from '../lib/db';
import { mixHexColors } from '../lib/colorMix';
import { t } from '../lib/i18n';
import { paintName } from '../lib/paintLabel';
import { useModalLock } from '../lib/modalLock';
import { lightColors, radius, spacing, touch, useTheme } from '../lib/theme';
import ClearableInput from './ClearableInput';
import HierarchyBrowser from './AddPaint/HierarchyBrowser';
import ColorMatcher from './AddPaint/ColorMatcher';
import SwipeDownHeader from './SwipeDownHeader';

interface SelectedPaint {
  paintId: number;
  name_ja: string;
  name_en: string | null;
  hex: string;
  ratio: number; // 0-100 (%) while composing; normalized to 0-1 at save time
}

interface Props {
  visible: boolean;
  kitId: number;
  onClose: () => void;
  onAdded: () => void;
}

const MAX_PAINTS = 5;
const TABS = ['hierarchy', 'colorMatch'] as const;

export default function KitColorComposerModal({ visible, kitId, onClose, onAdded }: Props) {
  useModalLock(visible);
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [tab, setTab] = useState<typeof TABS[number]>('hierarchy');
  const [selectedPaints, setSelectedPaints] = useState<SelectedPaint[]>([]);
  const [accordionOpen, setAccordionOpen] = useState(false);
  const canSave = selectedPaints.length > 0;

  useEffect(() => {
    if (visible) {
      setName('');
      setNote('');
      setTab('hierarchy');
      setSelectedPaints([]);
      setAccordionOpen(false);
    }
  }, [visible]);

  const previewHex = useMemo(
    () => mixHexColors(selectedPaints.map((p) => ({ hex: p.hex, ratio: p.ratio }))),
    [selectedPaints]
  );

  const addPaintToMix = (paint: { id: number; name_ja: string; name_en: string | null; hex: string }) => {
    setSelectedPaints((current) => {
      if (current.length >= MAX_PAINTS) return current;
      const next = [...current, { paintId: paint.id, name_ja: paint.name_ja, name_en: paint.name_en, hex: paint.hex, ratio: 0 }];
      const equalShare = 100 / next.length;
      return next.map((p) => ({ ...p, ratio: equalShare }));
    });
  };

  const removePaintFromMix = (index: number) => {
    setSelectedPaints((current) => {
      const next = current.filter((_, i) => i !== index);
      if (next.length === 0) return next;
      const equalShare = 100 / next.length;
      return next.map((p) => ({ ...p, ratio: equalShare }));
    });
  };

  const setRatio = (index: number, value: string) => {
    const parsed = Number(value.replace(/[^0-9.]/g, ''));
    setSelectedPaints((current) => current.map((p, i) => (i === index ? { ...p, ratio: Number.isFinite(parsed) ? parsed : 0 } : p)));
  };

  const save = async () => {
    if (!canSave) return;
    const total = selectedPaints.reduce((sum, p) => sum + p.ratio, 0);
    const normalized = total > 0
      ? selectedPaints.map((p) => ({ paintId: p.paintId, ratio: p.ratio / total }))
      : selectedPaints.map((p) => ({ paintId: p.paintId, ratio: 1 / selectedPaints.length }));
    await addKitColor(kitId, name.trim() || null, note.trim() || null, normalized);
    onAdded();
    onClose();
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

          <View style={styles.nameField}>
            <ClearableInput
              style={styles.nameInput}
              value={name}
              onChangeText={setName}
              placeholder={t('colorNameLabel')}
            />
          </View>

          <View style={styles.tabBar}>
            {TABS.map((tabKey) => (
              <TouchableOpacity
                key={tabKey}
                style={[styles.tabBtn, tab === tabKey && styles.tabBtnActive]}
                onPress={() => setTab(tabKey)}
              >
                <Text style={[styles.tabText, tab === tabKey && styles.tabTextActive]}>{t(tabKey)}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <View style={styles.pickerArea}>
            {tab === 'hierarchy' ? (
              <HierarchyBrowser
                onSelect={(paint) => addPaintToMix({ id: paint.id, name_ja: paint.name_ja, name_en: paint.name_en, hex: paint.hex })}
                onSelectView={(paint) => addPaintToMix({ id: paint.id, name_ja: paint.name_ja, name_en: paint.name_en, hex: paint.hex })}
              />
            ) : (
              <ColorMatcher
                onSelect={(paint) => addPaintToMix({ id: paint.id, name_ja: paint.name_ja, name_en: paint.name_en, hex: paint.hex })}
                onSelectView={(paint) => addPaintToMix({ id: paint.id, name_ja: paint.name_ja, name_en: paint.name_en, hex: paint.hex })}
              />
            )}
          </View>

          <View style={styles.accordion}>
            <TouchableOpacity style={styles.accordionHeader} onPress={() => setAccordionOpen((o) => !o)}>
              <View style={[styles.previewSwatch, { backgroundColor: previewHex ?? colors.chip }]} />
              <Text style={styles.accordionTitle}>{t('currentColor')}</Text>
              {accordionOpen
                ? <IconChevronDown size={18} color={colors.textMuted} />
                : <IconChevronUp size={18} color={colors.textMuted} />}
            </TouchableOpacity>
            {accordionOpen && (
              <View style={styles.paintList}>
                {selectedPaints.map((p, index) => (
                  <View key={index} style={styles.paintRow}>
                    <View style={[styles.miniSwatch, { backgroundColor: p.hex }]} />
                    <Text numberOfLines={1} style={styles.paintName}>{paintName(p.name_ja, p.name_en)}</Text>
                    <TextInput
                      style={styles.ratioInput}
                      keyboardType="numeric"
                      value={String(Math.round(p.ratio))}
                      onChangeText={(v) => setRatio(index, v)}
                    />
                    <Text style={styles.percentSign}>%</Text>
                    <TouchableOpacity onPress={() => removePaintFromMix(index)} hitSlop={8}>
                      <IconTrash color={colors.danger} size={18} />
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}
          </View>

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
  nameField: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg },
  nameInput: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: 10, color: colors.text },
  tabBar: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.borderLight, marginTop: spacing.md },
  tabBtn: { flex: 1, padding: spacing.md, alignItems: 'center' },
  tabBtnActive: { borderBottomWidth: 2, borderBottomColor: colors.primary },
  tabText: { fontSize: 13, color: colors.textPlaceholder },
  tabTextActive: { color: colors.primary, fontWeight: 'bold' },
  pickerArea: { flex: 1 },
  accordion: { borderTopWidth: 1, borderTopColor: colors.borderLight, backgroundColor: colors.surfaceAlt },
  accordionHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg },
  previewSwatch: { width: 28, height: 28, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border },
  accordionTitle: { flex: 1, fontSize: 14, fontWeight: '600', color: colors.text },
  paintList: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg, gap: spacing.sm },
  paintRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  miniSwatch: { width: 22, height: 22, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border },
  paintName: { flex: 1, fontSize: 13, color: colors.text },
  ratioInput: { width: 48, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: 6, paddingVertical: 4, color: colors.text, textAlign: 'right' },
  percentSign: { fontSize: 13, color: colors.textMuted },
  saveBtn: { minHeight: 48, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary, margin: spacing.xl, borderRadius: radius.md },
  saveBtnDisabled: { backgroundColor: colors.primaryDisabled },
  saveBtnText: { color: colors.onPrimary, fontWeight: '700', fontSize: 16 },
});
```

Design notes for the implementer (not literal instructions, context to avoid "fixing" intentional choices):
- `onSelectView` is wired to the SAME handler as `onSelect` (both add the tapped paint to the mix). `HierarchyBrowser`/`ColorMatcher` normally use `onSelectView` to open a separate paint-detail modal (see `components/AddPaint/index.tsx`) — this composer has no such detail modal, so making the whole row (not just the small `+` icon) add-to-mix is a deliberate, larger touch target, not an oversight.
- `onRequestClose` (the optional swipe-down-to-dismiss prop both `HierarchyBrowser` and `ColorMatcher` accept) is deliberately NOT passed — accidentally triggering it while browsing paints would discard the in-progress paint selection with no confirmation, unlike the original single-paint flow where every pick was already committed to the DB immediately.
- The accordion is collapsed by default (`accordionOpen = false`) but the preview swatch (`previewSwatch`) sits in the always-visible `accordionHeader` row, so the current mix color is visible whether or not the ratio list is expanded.
- `ratioInput` is a plain `TextInput` (not `ClearableInput`) since a clear-button on a numeric percent field would be confusing (clearing to empty would need to fall back to some ratio value anyway); `Number(value.replace(/[^0-9.]/g, ''))` strips non-numeric characters defensively since `keyboardType="numeric"` does not fully prevent pasted non-numeric text on all platforms.

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: no errors attributable to `components/KitColorComposerModal.tsx`.

- [ ] **Step 3: Commit**

```bash
git add components/KitColorComposerModal.tsx
git commit -m "feat: add KitColorComposerModal for multi-paint color mixing"
```

---

### Task 6: `KitDetailModal.tsx` wiring

**Files:**
- Modify: `components/KitDetailModal.tsx`

**Interfaces:**
- Consumes: `getKitColors`, `addKitColor` (not called directly here, only via the composer), `updateKitColorName`, `updateKitColorNote`, `removeKitColor`, `KitColorSummary` from `../lib/db` (Task 1); `KitColorRow` (Task 4) replacing `KitPaintRow`; `KitColorComposerModal` (Task 5) replacing `KitPaintPickerModal`.
- No change to this component's own exported `Props` shape.

- [ ] **Step 1: Update imports**

Find:

```ts
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
  KitColorSummary,
  KitDetail,
  KitPhoto,
  KitStatus,
  removeKitColor,
  removeKitPhoto,
  setKitStatus,
  updateKitBox,
  updateKitCategory,
  updateKitColorName,
  updateKitColorNote,
  updateKitNote,
  updateKitSeries,
} from '../lib/db';
import { deleteKitPhoto } from '../lib/kitPhoto';
import { t } from '../lib/i18n';
import { useModalLock } from '../lib/modalLock';
import { lightColors, radius, spacing, useTheme } from '../lib/theme';
import ActionSheet from './ActionSheet';
import ClearableInput from './ClearableInput';
import KitColorComposerModal from './KitColorComposerModal';
import KitColorRow from './KitColorRow';
import KitPhotoGrid from './KitPhotoGrid';
```

- [ ] **Step 2: Update state and `load`**

Find:

```ts
  const [detail, setDetail] = useState<KitDetail | null>(null);
  const [paints, setPaints] = useState<KitPaintRowData[]>([]);
  const [photos, setPhotos] = useState<KitPhoto[]>([]);
```

Replace with:

```ts
  const [detail, setDetail] = useState<KitDetail | null>(null);
  const [kitColors, setKitColors] = useState<KitColorSummary[]>([]);
  const [photos, setPhotos] = useState<KitPhoto[]>([]);
```

Find:

```ts
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
```

Replace with:

```ts
  const load = useCallback(async () => {
    if (kitId == null) return;
    const [row, colorRows, photoRows] = await Promise.all([getKitDetail(kitId), getKitColors(kitId), getKitPhotos(kitId)]);
    setDetail(row);
    setKitColors(colorRows);
    setPhotos(photoRows);
    setNote(row?.note ?? '');
    setSeries(row?.series ?? '');
    setCategory(row?.category ?? '');
  }, [kitId]);
```

Find (inside the `visible` toggle `useEffect`'s `else` branch):

```ts
    } else {
      setDetail(null);
      setPaints([]);
      setPhotos([]);
```

Replace with:

```ts
    } else {
      setDetail(null);
      setKitColors([]);
      setPhotos([]);
```

- [ ] **Step 3: Replace the paint handlers with color handlers**

Find:

```ts
  const removePaint = async (kitPaintId: number) => {
    await removeKitPaint(kitPaintId);
    await load();
  };

  const changePaintNote = async (kitPaintId: number, next: string) => {
    await updateKitPaintNote(kitPaintId, next);
    await load();
  };
```

Replace with:

```ts
  const removeColor = async (kitColorId: number) => {
    await removeKitColor(kitColorId);
    await load();
  };

  const changeColorName = async (kitColorId: number, next: string) => {
    await updateKitColorName(kitColorId, next);
    await load();
  };

  const changeColorNote = async (kitColorId: number, next: string) => {
    await updateKitColorNote(kitColorId, next);
    await load();
  };
```

- [ ] **Step 4: Replace the "used colors" section JSX**

Find:

```tsx
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
```

Replace with:

```tsx
              <View style={styles.paintsSection}>
                <View style={styles.paintsHeader}>
                  <Text style={styles.sectionTitle}>{t('usedPaints')}</Text>
                  <TouchableOpacity onPress={() => setPickerOpen(true)}>
                    <Text style={styles.addLink}>{t('addColor')}</Text>
                  </TouchableOpacity>
                </View>
                {kitColors.map((color) => (
                  <KitColorRow
                    key={color.id}
                    color={color}
                    onNameChange={(next) => changeColorName(color.id, next)}
                    onNoteChange={(next) => changeColorNote(color.id, next)}
                    onRemove={() => removeColor(color.id)}
                  />
                ))}
              </View>
```

- [ ] **Step 5: Replace the picker modal usage**

Find:

```tsx
          {detail ? (
            <KitPaintPickerModal
              visible={pickerOpen}
              kitId={detail.id}
              onClose={() => setPickerOpen(false)}
              onAdded={load}
            />
          ) : null}
```

Replace with:

```tsx
          {detail ? (
            <KitColorComposerModal
              visible={pickerOpen}
              kitId={detail.id}
              onClose={() => setPickerOpen(false)}
              onAdded={load}
            />
          ) : null}
```

- [ ] **Step 6: Verify**

Run: `npx tsc --noEmit`
Expected: no errors attributable to `components/KitDetailModal.tsx`.

- [ ] **Step 7: Commit**

```bash
git add components/KitDetailModal.tsx
git commit -m "feat: wire kit detail modal to KitColorComposerModal and KitColorRow"
```

---

### Task 7: `KitBoxOptions.tsx` cascade update

**Files:**
- Modify: `components/KitBoxOptions.tsx`

**Interfaces:**
- Consumes: `kit_color_paints`/`kit_colors` tables (Task 1) directly via raw SQL — no new `lib/db.ts` function needed (matches this file's existing pattern of writing its own cascade SQL directly).

- [ ] **Step 1: Update the box-delete cascade transaction**

Find:

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
```

Replace with:

```ts
  const remove = async () => {
    const remaining = boxes.filter((item) => item.id !== box.id);
    const db = getDB();
    const photos = await db.getAllAsync<{ uri: string }>('SELECT uri FROM kit_photos WHERE kit_id IN (SELECT id FROM kits WHERE box_id = ?)', [box.id]);
    await db.withTransactionAsync(async () => {
      await db.runAsync('DELETE FROM kit_color_paints WHERE kit_color_id IN (SELECT id FROM kit_colors WHERE kit_id IN (SELECT id FROM kits WHERE box_id = ?))', [box.id]);
      await db.runAsync('DELETE FROM kit_colors WHERE kit_id IN (SELECT id FROM kits WHERE box_id = ?)', [box.id]);
      await db.runAsync('DELETE FROM kit_photos WHERE kit_id IN (SELECT id FROM kits WHERE box_id = ?)', [box.id]);
      await db.runAsync('DELETE FROM kits WHERE box_id = ?', [box.id]);
      await db.runAsync('DELETE FROM kit_boxes WHERE id = ?', [box.id]);
    });
    for (const { uri } of photos) await deleteKitPhoto(uri);
```

(Only the transaction body changes — everything before and after, including the `photos` query and the post-transaction `deleteKitPhoto` loop, stays exactly as-is.)

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: no errors attributable to `components/KitBoxOptions.tsx`.

- [ ] **Step 3: Commit**

```bash
git add components/KitBoxOptions.tsx
git commit -m "fix: cascade kit_color_paints/kit_colors (not kit_paints) on kit box deletion"
```

---

### Task 8: Remove obsolete single-paint components

**Files:**
- Delete: `components/KitPaintRow.tsx`
- Delete: `components/KitPaintPickerModal.tsx`

**Interfaces:**
- None — by this point (after Task 6), nothing imports either file. This task confirms that and removes the dead files.

- [ ] **Step 1: Confirm nothing still imports them**

Run: `grep -rn "KitPaintRow\|KitPaintPickerModal" --include="*.tsx" --include="*.ts" app components lib`
Expected: no matches outside the two files' own definitions. If any match appears, STOP — a caller was missed in Task 6; report this rather than deleting the files out from under a live import.

- [ ] **Step 2: Delete the files**

```bash
git rm components/KitPaintRow.tsx components/KitPaintPickerModal.tsx
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: zero errors across the whole project.

- [ ] **Step 4: Commit**

```bash
git commit -m "chore: remove obsolete single-paint KitPaintRow and KitPaintPickerModal components"
```

- [ ] **Step 5: Manual verification checklist (Expo Go)**

This is the final task — after this, the feature is complete. On a real device (reload the app fully first, since this branch's `lib/db.ts` schema changed and needs `initDB()` to re-run):

1. Open a kit's detail page. Tap "色を追加". Confirm the composer shows: 色名 field, "一覧から"/"近似色" tabs, and a collapsed accordion at the bottom showing an empty/placeholder swatch.
2. In "一覧から", drill into a brand → series → tap a paint. Confirm it's added: the accordion's preview swatch updates to that paint's color, and expanding the accordion shows 1 row at 100%.
3. Tap another paint (same or different series). Confirm both now show ~50%/50% and the preview swatch blends toward a mix of the two.
4. Edit one paint's ratio to e.g. 80, leave the other at 50 (don't manually rebalance) — confirm the preview swatch still updates live even though the raw numbers don't sum to 100 (normalization only happens at save).
5. Switch to "近似色" tab, search by HEX or camera, tap a result — confirm it's added as a 3rd paint and ratios rebalance to ~33/33/33 in the accordion.
6. Add paints up to 5 total — confirm no way to add a 6th (both tabs still allow tapping, but `addPaintToMix` silently ignores it past the cap — verify by checking the accordion still shows exactly 5 rows after a 6th tap).
7. Enter a 色名 (e.g. "コックピット内部"), tap 保存. Confirm the modal closes and the new color appears in "使用する色" with the mixed swatch, the given name, and a breakdown subtitle like "白 33% + 赤 33% + 青 33%".
8. Tap "色を追加" again, pick exactly ONE paint, leave 色名 blank, save. Confirm it appears with the PAINT's own name as a fallback (not blank).
9. In the "使用する色" list, edit a color's name and note inline (blur to save), close and reopen the kit detail modal, confirm both persisted.
10. Delete a color entry via its trash icon. Confirm it disappears from the list immediately.
11. Delete a whole kit (with saved colors) via the kit's "⋮" menu. Confirm no crash.
12. Create a new kit box, add a kit with a saved mixed color inside it, then delete the whole kit box. Confirm no crash (this exercises Task 7's cascade).
13. If the device previously had any single-paint kit colors from testing the OLD flow (before this branch's changes), confirm they appear correctly migrated: each shows up as a color entry named after the original paint, with exactly one component paint at 100%.

## Self-Review Notes

- **Spec coverage:** 色名+メモ入力 (Tasks 1, 5, 6) ✓; 一覧ドリルダウン/近似色検索の両タブ、既存コンポーネント再利用 (Task 5) ✓; 最大5塗料、追加/削除で均等割り (Task 5) ✓; 保存時の自動正規化 (Task 5's `save`) ✓; リアルタイム混色プレビュー、アコーディオン折りたたみでも現在の色は見える (Task 5) ✓; spectral.js 採用、白希釈・青黄混色の両方が動作することを事前検証 (Task 2) ✓; 既存`kit_paints`データの自動移行 (Task 1) ✓; 保存後は色名・メモのみ編集可、構成塗料は削除して作り直し (Task 4/6 — no edit-composition UI exists) ✓; `deleteKit`/`KitBoxOptions`のカスケード更新 (Tasks 1, 7) ✓; 旧コンポーネントの削除 (Task 8) ✓.
- **Type consistency:** `KitColorSummary`/`KitColorPaint` (Task 1) are used identically in Task 4 (`KitColorRow`) and Task 6 (`KitDetailModal`) — field names (`paint_id`, `ratio`, `hex`, `name_ja`, `name_en`) match across all three. `addKitColor`'s `paints: { paintId: number; ratio: number }[]` parameter shape matches exactly what Task 5's `save()` constructs.
- **No placeholders:** every step has complete, runnable code. The one caveat callout in Task 4 (about `ClearableInput`'s `style` prop not affecting font weight) is a documented, intentional cosmetic limitation, not a TODO.
