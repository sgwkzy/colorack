# Kit Color Composer UX Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure `KitColorComposerModal` into a 2-step flow (name+paint-type first, then paint picking), filter the reused paint pickers by the chosen paint type, and fix the on-screen keyboard covering the ratio inputs.

**Architecture:** `KitColorComposerModal` gains a `step: 'setup' | 'pick'` state. Step 'setup' collects name, note, and a required paint-type choice (4 fixed chips). Step 'pick' is the existing tab+picker+accordion UI, now wrapped in `KeyboardAvoidingView` and passing the chosen paint type down to `HierarchyBrowser`/`ColorMatcher` via two new optional props that don't affect either component's other consumer (`AddPaintModal`).

**Tech Stack:** Same as prior kit plans (Expo SDK ~54 / React Native / expo-sqlite). No new dependencies.

## Global Constraints

- No test framework exists in this project. Verification is `npx tsc --noEmit` plus documented manual Expo Go checks.
- No UTF-8 BOM in any modified file. New styling in `KitColorComposerModal.tsx` keeps its existing file's convention (`useMemo`-wrapped `makeStyles`, already established in Task 5 of the prior plan).
- All user-facing strings go through `t('key')`.
- `HierarchyBrowser.tsx` and `ColorMatcher.tsx` are shared with `components/AddPaint/index.tsx` (the main paint-inventory "add paint" flow) — every change to these two files must be strictly additive via new OPTIONAL props that default to today's behavior when omitted. Do not change either component's existing required props or default behavior.
- Paint-type values are exactly these 4 catalog strings (verified against `assets/seed_catalog.json`): `'ラッカー塗料'`, `'水性アクリル塗料'`, `'エナメル塗料'`, `'エマルジョン系水性塗料'`. Use `paintTypeLabel()` from `lib/paintType.ts` (existing helper) for display text — never hardcode a locale-specific label.
- This is an addendum to the unmerged `feature/model-management` branch (PR #22) — no data migration concerns (UI-only change).

---

### Task 1: Translation keys

**Files:**
- Modify: `translations/ja.json`
- Modify: `translations/en.json`

**Interfaces:**
- Produces: `next`, `back` keys, consumed via `t()` by Task 4. `paintType` (existing, "塗料種別"/"Paint Type") is reused unchanged.

- [ ] **Step 1: Add `next` and `back` to `translations/ja.json`**

Both files are single-line flat JSON. Insert before the final closing `}`:

```json
,"next":"次へ","back":"戻る"
```

- [ ] **Step 2: Add the same keys to `translations/en.json`**

```json
,"next":"Next","back":"Back"
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
console.log('paintType:', ja.paintType);
"
```
Expected: `ja`/`en` counts equal, both "missing" arrays empty, `paintType: 塗料種別` (confirms the reused key is untouched).

Also verify no BOM in either file.

- [ ] **Step 4: Commit**

```bash
git add translations/ja.json translations/en.json
git commit -m "feat: add next/back translation keys for color composer 2-step flow"
```

---

### Task 2: `HierarchyBrowser.tsx` paint-type filter

**Files:**
- Modify: `components/AddPaint/HierarchyBrowser.tsx`

**Interfaces:**
- Produces: new optional prop `paintType?: string` on `HierarchyBrowser`. When set, every level of the brand→series→paint drilldown is filtered to that paint type. When omitted (as in the existing `AddPaintModal` usage), behavior is unchanged.
- Consumed by: Task 4 (`KitColorComposerModal.tsx`).

- [ ] **Step 1: Add the prop to the interface and destructure it**

Find:

```tsx
interface Props {
  onSelect: (paint: Paint) => void;
  onSelectView: (paint: Paint) => void;
  // 一覧を最上部からさらに引っ張って離した時に親モーダルを閉じる
  onRequestClose?: () => void;
}

// 階層を横断して「すべて」を表す番兵。実データと衝突しない値。
const ALL = 'ALL';

export default function HierarchyBrowser({ onSelect, onSelectView, onRequestClose }: Props) {
```

Replace with:

```tsx
interface Props {
  onSelect: (paint: Paint) => void;
  onSelectView: (paint: Paint) => void;
  // 一覧を最上部からさらに引っ張って離した時に親モーダルを閉じる
  onRequestClose?: () => void;
  // 指定時、ブランド/シリーズ/塗料の全階層をこの塗料種別のみに絞り込む
  paintType?: string;
}

// 階層を横断して「すべて」を表す番兵。実データと衝突しない値。
const ALL = 'ALL';

export default function HierarchyBrowser({ onSelect, onSelectView, onRequestClose, paintType }: Props) {
```

- [ ] **Step 2: Filter the brands query**

Find:

```tsx
  useEffect(() => {
    getDB().getAllAsync<{ brand: string }>(
      'SELECT DISTINCT brand FROM catalog_paints ORDER BY brand'
    ).then((rows) => setBrands(rows.map((r) => r.brand)));
  }, []);
```

Replace with:

```tsx
  useEffect(() => {
    const where = paintType ? ' WHERE paint_type = ?' : '';
    const args = paintType ? [paintType] : [];
    getDB().getAllAsync<{ brand: string }>(
      'SELECT DISTINCT brand FROM catalog_paints' + where + ' ORDER BY brand', args
    ).then((rows) => setBrands(rows.map((r) => r.brand)));
  }, [paintType]);
```

- [ ] **Step 3: Filter the series query**

Find:

```tsx
  const selectBrand = async (brand: string) => {
    setSelectedBrand(brand);
    setPaints([]);
    if (brand === ALL) { setSelectedSeries(ALL); loadPaints(ALL, ALL); return; }
    setSelectedSeries(null);
    const rows = await getDB().getAllAsync<{ series: string; series_en: string | null }>(
      'SELECT series, MAX(series_en) AS series_en FROM catalog_paints WHERE brand = ? GROUP BY series ORDER BY series',
      [brand]
    );
    setSeriesList(rows);
  };
```

Replace with:

```tsx
  const selectBrand = async (brand: string) => {
    setSelectedBrand(brand);
    setPaints([]);
    if (brand === ALL) { setSelectedSeries(ALL); loadPaints(ALL, ALL); return; }
    setSelectedSeries(null);
    const where = ['brand = ?'];
    const args: string[] = [brand];
    if (paintType) { where.push('paint_type = ?'); args.push(paintType); }
    const rows = await getDB().getAllAsync<{ series: string; series_en: string | null }>(
      'SELECT series, MAX(series_en) AS series_en FROM catalog_paints WHERE ' + where.join(' AND ') + ' GROUP BY series ORDER BY series',
      args
    );
    setSeriesList(rows);
  };
```

- [ ] **Step 4: Filter the paints query**

Find, inside `loadPaints`:

```tsx
  const loadPaints = async (brand: string, series: string) => {
    const where: string[] = [];
    const args: string[] = [];
    if (brand !== ALL) { where.push('brand = ?'); args.push(brand); }
    if (series !== ALL) { where.push('series = ?'); args.push(series); }
    const sql = 'SELECT id, name_ja, name_en, code, brand, series, series_en, hex, gloss, paint_type FROM catalog_paints'
```

Replace with:

```tsx
  const loadPaints = async (brand: string, series: string) => {
    const where: string[] = [];
    const args: string[] = [];
    if (brand !== ALL) { where.push('brand = ?'); args.push(brand); }
    if (series !== ALL) { where.push('series = ?'); args.push(series); }
    if (paintType) { where.push('paint_type = ?'); args.push(paintType); }
    const sql = 'SELECT id, name_ja, name_en, code, brand, series, series_en, hex, gloss, paint_type FROM catalog_paints'
```

(The rest of `loadPaints` — the `where.length ? ' WHERE ' + where.join(' AND ') : ''` construction and everything after — is unchanged; it already handles an arbitrary-length `where`/`args` pair.)

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit`
Expected: no errors attributable to `components/AddPaint/HierarchyBrowser.tsx`.

Also confirm `components/AddPaint/index.tsx` (the existing `AddPaintModal`, which renders `<HierarchyBrowser onSelect={addToInventory} onSelectView={viewPaintDetail} onRequestClose={onClose} />` with no `paintType` prop) still compiles — since the new prop is optional, this requires no change there and none is made.

- [ ] **Step 6: Commit**

```bash
git add components/AddPaint/HierarchyBrowser.tsx
git commit -m "feat: add optional paintType filter to HierarchyBrowser"
```

---

### Task 3: `ColorMatcher.tsx` locked paint-type filter

**Files:**
- Modify: `components/AddPaint/ColorMatcher.tsx`

**Interfaces:**
- Produces: new optional prop `lockedPaintType?: string` on `ColorMatcher`. When set, the paint-type filter is pre-locked to that single value and its chip-selection UI is hidden. When omitted (as in the existing `AddPaintModal` usage), behavior is unchanged.
- Consumed by: Task 4 (`KitColorComposerModal.tsx`).

- [ ] **Step 1: Add the prop and initialize `selectedTypes` from it**

Find:

```tsx
interface Props {
  onSelect: (paint: Paint) => void;
  onSelectView: (paint: Paint) => void;
  // 一覧を最上部からさらに引っ張って離した時に親モーダルを閉じる
  onRequestClose?: () => void;
}

export default function ColorMatcher({ onSelect, onSelectView, onRequestClose }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const closeProps = onRequestClose ? swipeDownCloseProps(onRequestClose) : undefined;
  const [hex, setHex] = useState('');
  const [results, setResults] = useState<(Paint & { de: number })[]>([]);
  const [ownedCounts, setOwnedCounts] = useState<Map<number, number>>(new Map());
  const [colorPickerVisible, setColorPickerVisible] = useState(false);
  const [glossOptions, setGlossOptions] = useState<string[]>([]);
  const [selectedGloss, setSelectedGloss] = useState<string[]>([]);
  const [typeOptions, setTypeOptions] = useState<string[]>([]);
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
```

Replace with:

```tsx
interface Props {
  onSelect: (paint: Paint) => void;
  onSelectView: (paint: Paint) => void;
  // 一覧を最上部からさらに引っ張って離した時に親モーダルを閉じる
  onRequestClose?: () => void;
  // 指定時、塗料種別フィルタをこの1種類に固定し、種別チップUIを非表示にする
  lockedPaintType?: string;
}

export default function ColorMatcher({ onSelect, onSelectView, onRequestClose, lockedPaintType }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const closeProps = onRequestClose ? swipeDownCloseProps(onRequestClose) : undefined;
  const [hex, setHex] = useState('');
  const [results, setResults] = useState<(Paint & { de: number })[]>([]);
  const [ownedCounts, setOwnedCounts] = useState<Map<number, number>>(new Map());
  const [colorPickerVisible, setColorPickerVisible] = useState(false);
  const [glossOptions, setGlossOptions] = useState<string[]>([]);
  const [selectedGloss, setSelectedGloss] = useState<string[]>([]);
  const [typeOptions, setTypeOptions] = useState<string[]>([]);
  const [selectedTypes, setSelectedTypes] = useState<string[]>(lockedPaintType ? [lockedPaintType] : []);
```

(`useState`'s initializer runs once per mount; `KitColorComposerModal`, Task 4, conditionally renders `ColorMatcher` only while its tab is active, so a fresh mount always picks up the current `lockedPaintType` — no `useEffect` sync is needed.)

- [ ] **Step 2: Hide the type-filter chip UI when locked**

Find:

```tsx
      <TouchableOpacity style={styles.dropdown} onPress={() => setTypeOpen((o) => !o)}>
        <Text style={styles.dropdownLabel}>
          {t('paintType')}{selectedTypes.length ? ` (${selectedTypes.length})` : ''}
        </Text>
        {typeOpen
          ? <IconChevronUp size={16} color={colors.textFaint} />
          : <IconChevronDown size={16} color={colors.textFaint} />}
      </TouchableOpacity>
      {typeOpen && (
        <View style={styles.chipRow}>
          {typeOptions.map((p) => {
            const selected = selectedTypes.includes(p);
            return (
              <TouchableOpacity
                key={p}
                style={[styles.chip, { backgroundColor: selected ? colors.primary : colors.chip }]}
                onPress={() => toggleType(p)}
              >
                <Text style={[styles.chipText, { color: selected ? colors.onPrimary : colors.text }]}>{paintTypeLabel(p)}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}
```

Replace with:

```tsx
      {!lockedPaintType && (
        <TouchableOpacity style={styles.dropdown} onPress={() => setTypeOpen((o) => !o)}>
          <Text style={styles.dropdownLabel}>
            {t('paintType')}{selectedTypes.length ? ` (${selectedTypes.length})` : ''}
          </Text>
          {typeOpen
            ? <IconChevronUp size={16} color={colors.textFaint} />
            : <IconChevronDown size={16} color={colors.textFaint} />}
        </TouchableOpacity>
      )}
      {!lockedPaintType && typeOpen && (
        <View style={styles.chipRow}>
          {typeOptions.map((p) => {
            const selected = selectedTypes.includes(p);
            return (
              <TouchableOpacity
                key={p}
                style={[styles.chip, { backgroundColor: selected ? colors.primary : colors.chip }]}
                onPress={() => toggleType(p)}
              >
                <Text style={[styles.chipText, { color: selected ? colors.onPrimary : colors.text }]}>{paintTypeLabel(p)}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}
```

(The gloss filter dropdown immediately above this block, and the `search`/`matchHex` functions that already read `selectedTypes` into the SQL `WHERE paint_type IN (...)` clause, are untouched — since `selectedTypes` is pre-populated to `[lockedPaintType]` when locked, filtering behaves correctly with no further changes.)

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: no errors attributable to `components/AddPaint/ColorMatcher.tsx`.

Also confirm `components/AddPaint/index.tsx`'s existing `<ColorMatcher onSelect={addToInventory} onSelectView={viewPaintDetail} onRequestClose={onClose} />` (no `lockedPaintType` prop) still compiles unchanged.

- [ ] **Step 4: Commit**

```bash
git add components/AddPaint/ColorMatcher.tsx
git commit -m "feat: add optional lockedPaintType filter to ColorMatcher"
```

---

### Task 4: `KitColorComposerModal.tsx` 2-step flow + keyboard fix

**Files:**
- Modify: `components/KitColorComposerModal.tsx`

**Interfaces:**
- Consumes: `paintType` prop on `HierarchyBrowser` (Task 2), `lockedPaintType` prop on `ColorMatcher` (Task 3), `paintTypeLabel` from `../lib/paintType` (existing, unchanged), `t('next')`/`t('back')` (Task 1).
- No change to this component's own exported `Props` shape (`{ visible, kitId, onClose, onAdded }`) — `KitDetailModal.tsx` (which renders it) needs no changes.
- Also fixes a pre-existing gap: the component already declared `note` state and passed it into `addKitColor`, but never rendered a note input field, so a color's note could never actually be set at creation time (only editable afterward via `KitColorRow`). This task adds the missing note field to the new setup step, since it's a one-line addition to the exact screen already being restructured.

- [ ] **Step 1: Replace the entire file**

```tsx
// components/KitColorComposerModal.tsx
import { useEffect, useMemo, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { IconChevronDown, IconChevronLeft, IconChevronUp, IconTrash, IconX } from '@tabler/icons-react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { addKitColor } from '../lib/db';
import { mixHexColors } from '../lib/colorMix';
import { t } from '../lib/i18n';
import { paintName } from '../lib/paintLabel';
import { paintTypeLabel } from '../lib/paintType';
import { useModalLock } from '../lib/modalLock';
import { lightColors, radius, spacing, useTheme } from '../lib/theme';
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
const PAINT_TYPES = ['ラッカー塗料', '水性アクリル塗料', 'エナメル塗料', 'エマルジョン系水性塗料'];

export default function KitColorComposerModal({ visible, kitId, onClose, onAdded }: Props) {
  useModalLock(visible);
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [step, setStep] = useState<'setup' | 'pick'>('setup');
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [paintType, setPaintType] = useState<string | null>(null);
  const [tab, setTab] = useState<typeof TABS[number]>('hierarchy');
  const [selectedPaints, setSelectedPaints] = useState<SelectedPaint[]>([]);
  const [accordionOpen, setAccordionOpen] = useState(false);
  const canSave = selectedPaints.length > 0;

  useEffect(() => {
    if (visible) {
      setStep('setup');
      setName('');
      setNote('');
      setPaintType(null);
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

  const goToPicker = () => {
    if (!paintType) return;
    setStep('pick');
  };

  const backToSetup = () => {
    setSelectedPaints([]);
    setAccordionOpen(false);
    setStep('setup');
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
              {step === 'pick' ? (
                <TouchableOpacity onPress={backToSetup} hitSlop={8} style={styles.backBtn}>
                  <IconChevronLeft color={colors.primary} size={22} />
                  <Text style={styles.backText}>{t('back')}</Text>
                </TouchableOpacity>
              ) : (
                <Text style={styles.title}>{t('addColor')}</Text>
              )}
              <TouchableOpacity onPress={onClose} hitSlop={8}>
                <IconX color={colors.text} size={24} />
              </TouchableOpacity>
            </View>
          </SwipeDownHeader>

          {step === 'setup' ? (
            <View style={styles.setupContent}>
              <ClearableInput
                style={styles.nameInput}
                value={name}
                onChangeText={setName}
                placeholder={t('colorNameLabel')}
              />
              <ClearableInput
                style={styles.nameInput}
                value={note}
                onChangeText={setNote}
                placeholder={t('note')}
              />
              <Text style={styles.sectionLabel}>{t('paintType')}</Text>
              <View style={styles.typeGrid}>
                {PAINT_TYPES.map((type) => (
                  <TouchableOpacity
                    key={type}
                    style={[styles.typeChip, paintType === type && styles.typeChipActive]}
                    onPress={() => setPaintType(type)}
                  >
                    <Text style={[styles.typeChipText, paintType === type && styles.typeChipTextActive]}>
                      {paintTypeLabel(type)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              <TouchableOpacity
                style={[styles.nextBtn, !paintType && styles.nextBtnDisabled]}
                onPress={goToPicker}
                disabled={!paintType}
              >
                <Text style={styles.nextBtnText}>{t('next')}</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <KeyboardAvoidingView
              style={styles.pickContent}
              behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            >
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
                    paintType={paintType ?? undefined}
                    onSelect={(paint) => addPaintToMix({ id: paint.id, name_ja: paint.name_ja, name_en: paint.name_en, hex: paint.hex })}
                    onSelectView={(paint) => addPaintToMix({ id: paint.id, name_ja: paint.name_ja, name_en: paint.name_en, hex: paint.hex })}
                  />
                ) : (
                  <ColorMatcher
                    lockedPaintType={paintType ?? undefined}
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
            </KeyboardAvoidingView>
          )}
        </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
}

const makeStyles = (colors: typeof lightColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.xl, paddingVertical: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.borderLight },
  title: { fontSize: 18, fontWeight: 'bold', color: colors.text },
  backBtn: { flexDirection: 'row', alignItems: 'center' },
  backText: { fontSize: 15, color: colors.primary, marginLeft: 2 },
  setupContent: { flex: 1, padding: spacing.xl, gap: spacing.lg },
  nameInput: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: 10, color: colors.text },
  sectionLabel: { fontSize: 12, color: colors.textMuted, fontWeight: '600' },
  typeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  typeChip: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.chip },
  typeChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  typeChipText: { fontSize: 14, color: colors.text },
  typeChipTextActive: { color: colors.onPrimary, fontWeight: '700' },
  nextBtn: { minHeight: 48, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary, borderRadius: radius.md, marginTop: 'auto' },
  nextBtnDisabled: { backgroundColor: colors.primaryDisabled },
  nextBtnText: { color: colors.onPrimary, fontWeight: '700', fontSize: 16 },
  pickContent: { flex: 1 },
  tabBar: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.borderLight },
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

Notable changes from the previous version, called out for the reviewer:
- New `step` state gates the whole body between the "setup" view (name + note + paint-type chips + Next button) and the "pick" view (the previously-existing tab/picker/accordion/save UI, now wrapped in `KeyboardAvoidingView`).
- `backToSetup` clears `selectedPaints` (and collapses the accordion) before returning to step 'setup' — prevents a stale paint selection surviving a paint-type change.
- `HierarchyBrowser`/`ColorMatcher` now receive `paintType`/`lockedPaintType` respectively, sourced from the composer's own `paintType` state (converted `null → undefined` since the two components' new props are `string | undefined`, not `string | null`).
- The `note` field is new JSX (`ClearableInput` bound to the pre-existing `note` state) — fixes the previously-described gap where `note` was declared and used in `save()` but never actually editable.
- The `touch` import from `lib/theme` is dropped: the previous version of this file already imported it but never used `touch.min` anywhere in its styles (a pre-existing unused import). This is a one-line cleanup while touching this exact import line, not unrelated scope creep.

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: zero errors project-wide (this plan's changes are the last outstanding piece; no other files were left mid-migration).

- [ ] **Step 3: Commit**

```bash
git add components/KitColorComposerModal.tsx
git commit -m "feat: split color composer into setup/pick steps, filter pickers by paint type, fix keyboard covering ratio inputs"
```

- [ ] **Step 4: Manual verification checklist (Expo Go)**

This is the final task — after this, the addendum is complete. On a real device (reload the app fully first if the dev server session is stale):

1. Open a kit's detail page, tap "色を追加". Confirm the new setup screen shows: 色名 field, メモ field, 4つの塗料種別チップ(ラッカー/水性アクリル/エナメル/エマルジョン), and a disabled "次へ" button.
2. Tap a paint-type chip (e.g. ラッカー塗料). Confirm "次へ" becomes active. Tap it.
3. Confirm the picker screen appears with a "戻る" back button in the header (not the color-name field, which should be gone from this screen).
4. In "一覧から", confirm only ラッカー塗料 brands/series/paints appear — check a brand/series known to have ONLY non-lacquer paints does not appear in the list at all.
5. Switch to "近似色検索" tab. Confirm there is NO paint-type filter chip row visible (since it's locked), but the つや(gloss) filter still works. Search by HEX and confirm only ラッカー塗料 results appear.
6. Add 2-3 paints, expand the "現在の色" accordion, tap into a ratio % input. Confirm the on-screen keyboard does NOT cover the input field (the screen should shift/resize so the field stays visible above the keyboard).
7. Tap "戻る". Confirm it returns to the setup screen, the 色名/メモ you typed earlier are still there, but a re-selected paint type followed by "次へ" shows an EMPTY paint list in the accordion (previously selected paints were cleared).
8. Complete a save with a note filled in; open the resulting color's detail row and confirm the note was actually saved (this exercises the previously-missing note field).
9. Confirm the OTHER, unrelated "add paint to inventory" flow (main tab bar → "＋" → add paint) still works exactly as before: both "一覧から"/"近似色" tabs there show ALL paint types with no filtering, and the近似色 tab's type-filter chips still work as multi-select there (this confirms `AddPaintModal`'s usage of `HierarchyBrowser`/`ColorMatcher` was unaffected by the new optional props).

## Self-Review Notes

- **Spec coverage:** 2段階フロー、色名+メモ+塗料種別を先に決める (Task 4) ✓; 一覧ドリルダウン・近似色検索の両方を選択種別で絞り込み (Tasks 2, 3, 4) ✓; `AddPaintModal`側の既存挙動は無変更 (Tasks 2, 3 — new props default to `undefined`) ✓; キーボードが割合入力を隠す問題の修正 (Task 4's `KeyboardAvoidingView`) ✓; 種別変更時の選択済み塗料クリア (Task 4's `backToSetup`) ✓.
- **Type consistency:** `HierarchyBrowser`'s `paintType?: string` and `ColorMatcher`'s `lockedPaintType?: string` are both consumed identically in Task 4 via `paintType ?? undefined` (converting the composer's `string | null` state to the `string | undefined` the child props expect). `PAINT_TYPES` array values match exactly what Task 2/3's filtering logic passes through as SQL parameters — same literal strings throughout.
- **No placeholders:** every step has complete, runnable code.
