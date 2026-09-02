# Mixing Simulator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an inventory-independent mixing simulator with editable saved recipes, and reuse the same compact-card/detail/editor UX for fully editable kit colors.

**Architecture:** Keep product paints in `catalog_paints`, add independent `mix_recipes` parent/child tables, and continue using the existing kit color tables. A persistence-neutral editor emits a draft to thin standalone and kit adapters; common compact card and detail components render both domains from one shared display shape. Existing `spectral.js`, picker components, SQLite conventions, themes, translations, and backup pipeline are reused without new dependencies.

**Tech Stack:** Expo `~54.0.36`, React Native 0.81, Expo Router, expo-sqlite, TypeScript, Node test runner, existing `spectral.js`.

**Spec:** `docs/superpowers/specs/2026-08-29-mixing-simulator-design.md`

## Global Constraints

- Keep Expo exactly `~54.0.36`; add no dependency.
- Saved recipes, inventory/lists, and kit colors remain separate stores; simulator selection never mutates inventory/lists/kits.
- Catalog metadata and HEX are resolved from the current `catalog_paints` row at read time.
- One mix contains 1–5 unique paints of one `paint_type`, each with a valid six-digit HEX and integer parts from 1 through 9999.
- Existing parts remain unchanged when another paint is added or removed; only a newly added paint starts at 1 part.
- Use TDD for nontrivial logic: run the new test and observe the expected failure before production edits, then run it green.
- Preserve unrelated changes and do not modify any other worktree or branch.
- Required final checks are `npm run test` and `npm run typecheck`.

---

### Task 1: Shared mix domain and draft rules

**Files:**
- Create: `lib/colorMixDraft.ts`
- Create: `lib/colorMixDraft.test.cjs`

**Interfaces:**
- Produces `ColorMixPaint`, `ColorMixSummary`, `MixDraftPaint`, `MixDraft`, `MixDraftError`, `tryAddDraftPaint`, `removeDraftPaint`, `validateMixDraft`, `normalizeDraftPaints`, `normalizedPercent`, and `draftFromSummary`.
- `ColorMixPaint` deliberately uses the current DB row field names (`paint_id`, `name_ja`, `name_en`, `brand`, `series`, `series_en`, `code`, `hex`, `paint_type`, `ratio`, `sort_order`) so both kit and saved-recipe queries are structurally compatible.

- [ ] **Step 1: Write the failing domain tests**

Use the established `typescript.transpileModule` loader pattern and cover the real exported functions. The expected values are hand-derived literals.

```js
test('adding a paint keeps tuned parts and gives only the new paint one part', () => {
  const current = [paint(1, 7), paint(2, 3)];
  assert.deepEqual(api.tryAddDraftPaint(current, paint(3)).paints.map((p) => p.parts), [7, 3, 1]);
});

test('removing a paint does not rebalance remaining parts', () => {
  assert.deepEqual(api.removeDraftPaint([paint(1, 7), paint(2, 3), paint(3, 1)], 2).map((p) => p.parts), [7, 1]);
});

test('normalizes 2 to 1 parts into two thirds and one third', () => {
  assert.deepEqual(api.normalizeDraftPaints([paint(1, 2), paint(2, 1)]), [
    { paintId: 1, ratio: 2 / 3 }, { paintId: 2, ratio: 1 / 3 },
  ]);
});

test('rejects duplicate, sixth, mixed-type, invalid-hex, zero and decimal parts', () => {
  assert.equal(api.tryAddDraftPaint([paint(1)], paint(1)).error, 'duplicate');
  assert.equal(api.tryAddDraftPaint([1, 2, 3, 4, 5].map((id) => paint(id)), paint(6)).error, 'max_paints');
  assert.equal(api.tryAddDraftPaint([paint(1)], paint(2, 1, '水性アクリル塗料')).error, 'paint_type_mismatch');
  assert.equal(api.tryAddDraftPaint([], paint(1, 1, 'ラッカー塗料', 'nope')).error, 'invalid_hex');
  assert.equal(api.validateMixDraft({ name: '', note: '', paints: [paint(1, 0)] }), 'invalid_parts');
  assert.equal(api.validateMixDraft({ name: '', note: '', paints: [paint(1, 1.5)] }), 'invalid_parts');
});
```

- [ ] **Step 2: Run RED**

Run: `node --test lib/colorMixDraft.test.cjs`

Expected: FAIL because `lib/colorMixDraft.ts` does not exist.

- [ ] **Step 3: Implement the minimum shared domain**

Use these exact public shapes and error values:

```ts
export interface ColorMixPaint {
  paint_id: number;
  ratio: number;
  sort_order: number;
  name_ja: string;
  name_en: string | null;
  brand: string;
  series: string;
  series_en: string | null;
  code: string;
  hex: string | null;
  paint_type: string | null;
}

export interface ColorMixSummary { id: number; name: string | null; note: string | null; paints: ColorMixPaint[]; }
export interface MixDraftPaint extends Omit<ColorMixPaint, 'ratio' | 'sort_order'> { parts: number; }
export interface MixDraft { name: string; note: string; paints: MixDraftPaint[]; }
export type MixDraftError = 'empty' | 'duplicate' | 'max_paints' | 'paint_type_mismatch' | 'invalid_hex' | 'invalid_parts';

export function tryAddDraftPaint(current: MixDraftPaint[], paint: Omit<MixDraftPaint, 'parts'> & { parts?: number }): { paints: MixDraftPaint[]; error: MixDraftError | null };
export function removeDraftPaint(current: MixDraftPaint[], paintId: number): MixDraftPaint[];
export function validateMixDraft(draft: MixDraft): MixDraftError | null;
export function normalizeDraftPaints(paints: MixDraftPaint[]): { paintId: number; ratio: number }[];
export function normalizedPercent(paints: MixDraftPaint[], paintId: number): number;
export function draftFromSummary(summary?: ColorMixSummary | null): MixDraft;
```

`draftFromSummary` maps stored ratios to `Math.max(1, Math.round(ratio * 100))`; an empty summary returns `{ name: '', note: '', paints: [] }`. Keep validation linear and dependency-free.

- [ ] **Step 4: Run GREEN**

Run: `node --test lib/colorMixDraft.test.cjs`

Expected: all draft-rule tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/colorMixDraft.ts lib/colorMixDraft.test.cjs
git commit -m "feat: add shared color mix draft rules"
```

---

### Task 2: Recipe persistence, kit full update, and catalog reference protection

**Files:**
- Create: `lib/db/mixRecipes.ts`
- Create: `lib/mixRecipes.test.cjs`
- Create: `lib/catalogReferences.test.cjs`
- Modify: `lib/db/schema.ts`
- Modify: `lib/db/kitColors.ts`
- Modify: `lib/db/catalog.ts`
- Modify: `lib/db/seedCatalog.ts`
- Modify: `lib/db.ts`
- Modify: `app/(tabs)/catalog.tsx`
- Modify: `app/(tabs)/settings.tsx`
- Modify: `translations/ja.json`
- Modify: `translations/en.json`

**Interfaces:**
- Consumes `ColorMixPaint` / `ColorMixSummary` from Task 1.
- Produces `getMixRecipes(): Promise<ColorMixSummary[]>`, `addMixRecipe(name, note, paints): Promise<void>`, `updateMixRecipe(id, name, note, paints): Promise<void>`, `removeMixRecipe(id): Promise<void>`, and `updateKitColor(id, name, note, paints): Promise<void>`.
- `paints` is always `{ paintId: number; ratio: number }[]` normalized by Task 1.
- Produces `PaintReferencedByColorError` with `name === 'PaintReferencedByColorError'`, used by catalog/settings UI to show `t('paintReferencedByColor')`.

- [ ] **Step 1: Write failing persistence and protection tests**

Load the TypeScript modules with mocked `getDB()`. Assert observable SQL transaction behavior:

```js
test('update recipe replaces child rows in the submitted order', async () => {
  await api.updateMixRecipe(9, 'Ocean', 'memo', [{ paintId: 4, ratio: 0.75 }, { paintId: 7, ratio: 0.25 }]);
  assert.deepEqual(insertedChildren, [[9, 4, 0.75, 0], [9, 7, 0.25, 1]]);
});

test('recipe list includes current series, code, name, hex and paint type', async () => {
  const rows = await api.getMixRecipes();
  assert.equal(rows[0].paints[0].series, 'Mr.カラー');
  assert.equal(rows[0].paints[0].code, 'C1');
});

test('deleting a referenced manual paint throws before destructive SQL', async () => {
  await assert.rejects(catalog.deletePaint(4), { name: 'PaintReferencedByColorError' });
  assert.equal(deleteStatements.length, 0);
});
```

Also test `resetCatalogToMaster()` blocks before deletion when any manual paint is referenced, and that no-reference deletion preserves existing inventory/list cleanup behavior.

- [ ] **Step 2: Run RED**

Run: `node --test lib/mixRecipes.test.cjs lib/catalogReferences.test.cjs`

Expected: FAIL because the recipe module and protection behavior are absent.

- [ ] **Step 3: Add tables and recipe CRUD**

Add the two exact CREATE TABLE statements from the spec to `initDB()`. Implement parent/child reads with one parent query plus one joined child query, then group in memory as existing `getKitColors()` does. Add/update/remove must use one SQLite transaction; update performs:

```ts
await db.runAsync("UPDATE mix_recipes SET name = ?, note = ?, updated_at = datetime('now') WHERE id = ?", [name, note, id]);
await db.runAsync('DELETE FROM mix_recipe_paints WHERE mix_recipe_id = ?', [id]);
for (const [index, paint] of paints.entries()) {
  await db.runAsync(
    'INSERT INTO mix_recipe_paints (mix_recipe_id, paint_id, ratio, sort_order) VALUES (?, ?, ?, ?)',
    [id, paint.paintId, paint.ratio, index]
  );
}
```

Normalize blank `name`/`note` to `null`. Query current `catalog_paints` fields including `series`, `series_en`, and `paint_type`.

- [ ] **Step 4: Upgrade kit color persistence to the shared shape**

Make `KitColorPaint` and `KitColorSummary` aliases of the Task 1 types, extend the joined query with current catalog metadata, and add transactional `updateKitColor()` using the same child replacement order. Remove `updateKitColorName` only after all callers are migrated in Task 6; until then keep it as a compatibility wrapper calling only the existing name UPDATE.

- [ ] **Step 5: Protect referenced catalog paints**

Before individual deletion or catalog reset, query both child tables:

```sql
SELECT 1 WHERE EXISTS (SELECT 1 FROM kit_color_paints WHERE paint_id = ?)
  OR EXISTS (SELECT 1 FROM mix_recipe_paints WHERE paint_id = ?)
```

Throw `PaintReferencedByColorError` before any DELETE. Add `mix_recipe_paints` to both official catalog cleanup `NOT IN` clauses in `catalog.ts` and `seedCatalog.ts`. In catalog/settings UI, catch only this named error, show `paintReferencedByColor`, and log/rethrow unrelated errors instead of masking them.

- [ ] **Step 6: Add Japanese and English copy**

Add these exact semantic keys to both JSON files: `mixingSimulator`, `simulator`, `savedMixes`, `mixName`, `mixResult`, `parts`, `otherPaints`, `clearMix`, `editMix`, `deleteMixConfirm`, `emptySavedMixes`, `cannotCalculateMix`, `paintReferencedByColor`, `saveFailed`, `retry`, `moveUp`, `moveDown`. Japanese copy should use 「混色シミュレーター」「保存済み」「比率（parts）」 consistently; English copy should use “Mixing Simulator”, “Saved”, and “Parts”.

- [ ] **Step 7: Run GREEN and typecheck the slice**

Run: `node --test lib/mixRecipes.test.cjs lib/catalogReferences.test.cjs`

Expected: all persistence/protection tests pass.

Run: `npm run typecheck`

Expected: no TypeScript errors.

- [ ] **Step 8: Commit**

```bash
git add lib/db/mixRecipes.ts lib/mixRecipes.test.cjs lib/catalogReferences.test.cjs lib/db/schema.ts lib/db/kitColors.ts lib/db/catalog.ts lib/db/seedCatalog.ts lib/db.ts 'app/(tabs)/catalog.tsx' 'app/(tabs)/settings.tsx' translations/ja.json translations/en.json
git commit -m "feat: persist color mix recipes safely"
```

---

### Task 3: Cloud backup schema v4

**Files:**
- Modify: `lib/cloudBackup.ts`
- Modify: `lib/cloudBackup.test.cjs`

**Interfaces:**
- Consumes the Task 2 tables and current `catalog_code` resolution.
- Extends `BackupSnapshot` with optional `mixRecipes` and `mixRecipePaints`; older versions remain valid.

- [ ] **Step 1: Write failing backup tests**

Add focused tests to the existing real module loader:

```js
test('v4 snapshot stores recipes by local reference and paints by catalog code', async () => {
  const snapshot = await cloudBackup.buildBackupSnapshot();
  assert.equal(snapshot.schemaVersion, 4);
  assert.deepEqual(snapshot.mixRecipes, [{ localRef: 'mixrecipe_3', name: 'Warm gray', note: null, sort_order: 0, added_at: '2026-08-29', updated_at: '2026-08-29' }]);
  assert.deepEqual(snapshot.mixRecipePaints[0], { mixRecipeLocalRef: 'mixrecipe_3', catalog_code: 'brand|series|code', ratio: 1, sort_order: 0 });
});

test('v3 restore succeeds with an empty saved recipe list', async () => {
  await cloudBackup.restoreFromSnapshot(v3Snapshot, 'user-1');
  assert.equal(recipeInsertCalls, 0);
});

test('v4 restore inserts recipe paints only when parent and catalog paint resolve', async () => {
  await cloudBackup.restoreFromSnapshot(v4SnapshotWithOneMissingPaint, 'user-1');
  assert.equal(recipePaintInsertCalls, 1);
});
```

Also assert `isLocalDbEmpty()` includes `(SELECT COUNT(*) FROM mix_recipes)` and restore deletes `mix_recipe_paints` → `mix_recipes` and `kit_color_paints` → `kit_colors` before deleting manual catalog rows.

- [ ] **Step 2: Run RED**

Run: `node --test lib/cloudBackup.test.cjs`

Expected: new v4 assertions fail while existing tests still execute.

- [ ] **Step 3: Implement v4 minimally**

Set `BACKUP_SCHEMA_VERSION = 4`. Add:

```ts
export interface BackupMixRecipe {
  localRef: string; name: string | null; note: string | null; sort_order: number;
  added_at: string | null; updated_at: string | null;
}
export interface BackupMixRecipePaint {
  mixRecipeLocalRef: string; catalog_code: string; ratio: number; sort_order: number;
}
```

Build using `mixrecipe_<id>`. Restore parent rows into `mixRecipeIdByLocalRef`, resolve each child with `resolvePaintId`, and skip unresolved rows with a warning. Move both recipe and existing kit-color child/parent deletion ahead of manual-paint replacement, then rebuild them after catalog-code resolution. Count recipes in `isLocalDbEmpty()`.

- [ ] **Step 4: Run GREEN and regression tests**

Run: `node --test lib/cloudBackup.test.cjs`

Expected: all backup tests pass, including existing schema/user/photo ordering cases.

- [ ] **Step 5: Commit**

```bash
git add lib/cloudBackup.ts lib/cloudBackup.test.cjs
git commit -m "feat: back up saved color mixes"
```

---

### Task 4: Shared editor, compact card, and detail UI

**Files:**
- Create: `components/ColorMixEditor.tsx`
- Create: `components/ColorMixEditorModal.tsx`
- Create: `components/ColorMixCard.tsx`
- Create: `components/ColorMixDetailModal.tsx`

**Interfaces:**
- Consumes Task 1 draft/display types and rules, `mixHexColors`, `HierarchyBrowser`, `ColorMatcher`, existing theme/i18n/modal/swipe utilities.
- `ColorMixEditor` props: `{ initialDraft: MixDraft; onSave: (draft: MixDraft) => Promise<void>; onDirtyChange?: (dirty: boolean) => void; saveLabel?: string }`.
- `ColorMixEditorModal` props: `{ visible: boolean; title: string; initialDraft: MixDraft; onSave: (draft: MixDraft) => Promise<void>; onClose: () => void }`.
- `ColorMixCard` props: `{ color: ColorMixSummary; onPress: () => void; ownedMap?: Map<number, number> }`.
- `ColorMixDetailModal` props: `{ visible: boolean; color: ColorMixSummary | null; editable: boolean; ownedMap?: Map<number, number>; onEdit: () => void; onDelete: () => void; onClose: () => void }`.

- [ ] **Step 1: Implement the persistence-neutral editor**

Keep a local `MixDraft`, selected picker tab, busy/error state, and paint-type choice. Call Task 1 rules for every add/remove/save. Always render result and selected rows; do not use an accordion. Each selected row must render this information order:

```tsx
<View accessibilityLabel={`${brandLabel(p.brand)} ${seriesLabel(p.series, p.series_en)} ${p.code} ${paintName(p.name_ja, p.name_en)}`}>
  <View style={{ backgroundColor: p.hex ?? colors.chip }} />
  <Text>{brandLabel(p.brand)} · {seriesLabel(p.series, p.series_en)}</Text>
  <Text>{p.code} · {paintName(p.name_ja, p.name_en)}</Text>
  <TextInput keyboardType="number-pad" value={String(p.parts)} />
  <Text>{Math.round(normalizedPercent(draft.paints, p.paint_id))}%</Text>
</View>
```

Reject candidate errors with translated feedback, retain the draft on save failure, disable save while busy, and expose dirty state. “Clear mix” resets only this editor draft after confirmation when nonempty.

- [ ] **Step 2: Implement dirty-safe modal wrapper**

`ColorMixEditorModal` owns the dirty flag. Route close, Android `onRequestClose`, header close, and swipe close through one function that shows `t('discardChangesConfirm')` when dirty. A picker-level back action only changes editor step and must not clear selected paints.

- [ ] **Step 3: Implement the compact card**

Use a stable themed background, large result swatch on the left, name and source summary on the right, and a proportional source strip at the bottom. Build the source summary exactly as:

```ts
const visiblePaints = color.paints.slice(0, 2);
const hiddenCount = Math.max(0, color.paints.length - visiblePaints.length);
```

For every visible paint show brand, code, color name, and rounded normalized ratio. When `hiddenCount > 0`, render `t('otherPaints', { count: hiddenCount })`. Strip segment `flex` values use `Math.max(p.ratio, 0.0001)`. The whole card has `accessibilityRole="button"` and no nested tap targets.

- [ ] **Step 4: Implement the full detail modal**

Render result swatch/HEX, name, note, and all source rows with brand, series, code, color name, ratio and optional owned indicator. Render edit/delete actions only when `editable`; all icon buttons require labels and 44px hit areas.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`

Expected: no TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add components/ColorMixEditor.tsx components/ColorMixEditorModal.tsx components/ColorMixCard.tsx components/ColorMixDetailModal.tsx
git commit -m "feat: add shared color mix experience"
```

---

### Task 5: Standalone simulator screen and navigation

**Files:**
- Create: `app/(tabs)/mixing.tsx`
- Modify: `app/(tabs)/_layout.tsx`
- Modify: `components/NavigationDrawer.tsx`

**Interfaces:**
- Consumes Task 2 recipe CRUD and Task 4 UI components.
- The drawer route union gains `'/mixing'`; the item appears immediately after `catalog` and before `settings`.

- [ ] **Step 1: Build the screen state flow**

Use a local segment state `'simulator' | 'saved'`, initial `'simulator'`. Call `useFocusEffect` to refresh recipes. The simulator segment renders `ColorMixEditor` with an empty draft and `addMixRecipe` adapter:

```ts
const saveDraft = async (draft: MixDraft) => {
  await addMixRecipe(draft.name.trim() || null, draft.note.trim() || null, normalizeDraftPaints(draft.paints));
  await loadRecipes();
};
```

The saved segment renders `ColorMixCard` items, an empty state, and retry on load failure. Card tap opens `ColorMixDetailModal`; edit opens `ColorMixEditorModal` seeded with `draftFromSummary(selected)`. Delete uses confirmation and refreshes only after success. Keep the simulator editor mounted while the saved segment is selected (hide its container with `display: 'none'`) so segment switching does not discard an unsaved simulation.

- [ ] **Step 2: Add the accessible segment control**

Both segment buttons have `accessibilityRole="tab"`, `accessibilityState={{ selected: ... }}`, visible active underline, and text weight change. Do not rely only on color.

- [ ] **Step 3: Register and link the route**

Add `<Tabs.Screen name="mixing" options={{ title: t('mixingSimulator') }} />`. Import an existing Tabler flask/palette icon; do not add an icon dependency. Add the drawer item in this exact order:

```tsx
{item(t('catalog'), () => go('/catalog'), ...)}
{item(t('mixingSimulator'), () => go('/mixing'), ...)}
{item(t('settings'), () => go('/settings'), ...)}
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`

Expected: no route or prop errors.

- [ ] **Step 5: Commit**

```bash
git add 'app/(tabs)/mixing.tsx' 'app/(tabs)/_layout.tsx' components/NavigationDrawer.tsx
git commit -m "feat: add standalone mixing simulator"
```

---

### Task 6: Migrate kit colors to compact/detail/full-edit UX

**Files:**
- Modify: `components/KitColorComposerModal.tsx`
- Modify: `components/KitColorRow.tsx`
- Modify: `components/KitDetailModal.tsx`
- Modify: `components/KitDetail/styles.ts`
- Modify: `lib/db/kitColors.ts`
- Modify: `lib/db.ts`

**Interfaces:**
- Consumes Task 2 `updateKitColor`, Task 4 shared UI, and Task 1 `draftFromSummary`/`normalizeDraftPaints`.
- `KitColorComposerModal` remains the public add adapter expected by `KitDetailModal`, but delegates UI to `ColorMixEditorModal`.
- `KitColorRow` remains the public row adapter, but delegates rendering to `ColorMixCard`.

- [ ] **Step 1: Make the existing composer a thin add adapter**

Replace its local picker/mixing form with:

```tsx
<ColorMixEditorModal
  visible={visible}
  title={t('addColor')}
  initialDraft={draftFromSummary()}
  onSave={(draft) => addKitColor(kitId, draft.name.trim() || null, draft.note.trim() || null, normalizeDraftPaints(draft.paints))}
  onClose={onClose}
/>
```

Call `onAdded()` after successful save. Remove duplicated mix/picker/style logic from this file.

- [ ] **Step 2: Make the row a compact-card adapter**

Remove swatch-background text, tooltips, inline name input, and left/right controls. Render `ColorMixCard` with `ownedMap` and `onPress`. Keep ordering and delete outside the compact card/detail content so the card has no nested tap targets.

- [ ] **Step 3: Add kit detail and edit state**

In `KitDetailModal`, track `selectedColor`, `editingColor`, and show `ColorMixDetailModal` plus `ColorMixEditorModal`. Edit adapter:

```ts
await updateKitColor(
  editingColor.id,
  draft.name.trim() || null,
  draft.note.trim() || null,
  normalizeDraftPaints(draft.paints)
);
await load();
```

Use up/down labels and direction against the vertical list. Confirm color deletion. Remove `openTooltipKey`, `changeColorName`, and all now-unused imports/styles.

- [ ] **Step 4: Remove compatibility API after all callers migrate**

Delete `updateKitColorName` from `lib/db/kitColors.ts` and its `lib/db.ts` export after `rg -n "updateKitColorName"` returns only those definitions. Keep `addKitColor`, `removeKitColor`, and `reorderKitColors`.

- [ ] **Step 5: Run focused and full checks**

Run: `node --test lib/colorMixDraft.test.cjs lib/mixRecipes.test.cjs lib/catalogReferences.test.cjs lib/cloudBackup.test.cjs`

Expected: all focused tests pass.

Run: `npm run test`

Expected: all project tests pass.

Run: `npm run typecheck`

Expected: no TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add components/KitColorComposerModal.tsx components/KitColorRow.tsx components/KitDetailModal.tsx components/KitDetail/styles.ts lib/db/kitColors.ts lib/db.ts
git commit -m "feat: make kit colors fully editable"
```

---

### Task 7: Integrated UX verification and cleanup

**Files:**
- Modify only files required by defects reproduced during this task.

**Interfaces:**
- Verifies the complete spec; introduces no new feature or abstraction.

- [ ] **Step 1: Run final automated verification fresh**

Run: `npm run test`

Expected: zero failures.

Run: `npm run typecheck`

Expected: exit code 0.

Run: `git diff --check`

Expected: no whitespace errors.

- [ ] **Step 2: Verify the main UI states**

On web or Expo Go, verify Japanese and English plus light and dark themes:

1. Drawer order is Paints → Mixing Simulator → Settings in both app modes.
2. Simulator opens first, can preview 1–5 same-type colors without saving, keeps tuned parts when adding/removing, and blocks invalid/duplicate/sixth/mixed-type choices.
3. Saving creates a compact card; two-color cards identify both sources, three-to-five-color cards show two sources + `ほかN色`, and every source appears in the proportional strip.
4. Card tap opens full details; edit persists name, note, paints, order, and parts-derived ratios; delete confirms.
5. Kit colors use the same card/detail/editor flow and retain up/down ordering.
6. Dirty close/back/swipe confirms; save errors retain the draft; empty and retry states are usable.
7. Referenced manual paints and catalog reset are blocked without deleting recipe/kit color data.

- [ ] **Step 3: Capture screenshots for review**

Capture at least the simulator with two selected colors, saved compact cards including a 3+ color card, a full detail view, and the updated kit color section. Store screenshots outside source directories or in the existing visualization output location; do not add them to the app bundle.

- [ ] **Step 4: Fix only reproduced defects using TDD where logic changes**

For every logic defect, add a failing test, observe RED, make the minimum fix, and re-run GREEN. Visual-only corrections need fresh typecheck and screenshot verification.

- [ ] **Step 5: Final commit if this task changed source**

```bash
git add <only-files-changed-by-verified-fixes>
git commit -m "fix: polish mixing simulator integration"
```

## Self-Review

- Spec coverage: independent storage, navigation, simulator-first flow, save/list/detail/edit/delete, compact 2-color and 3–5-color summaries, current catalog metadata, kit full editing, deletion protection, backup v4, dirty/error/accessibility states, tests and screenshots all map to Tasks 1–7.
- Placeholder scan: no unresolved implementation markers remain; every behavior-changing task names concrete APIs, values, commands, and expected outcomes.
- Type consistency: Task 1 shared types feed Task 2 DB results, Task 3 only serializes DB rows, Task 4 consumes the shared shape, and Tasks 5–6 provide persistence adapters with the same `{ paintId, ratio }[]` output.
- Scope: no new package, no saved-recipe/kit linkage, no inventory mutation, and no global theme redesign.
