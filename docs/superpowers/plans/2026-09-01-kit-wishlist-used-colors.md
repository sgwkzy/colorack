# Kitrack Purchase-Candidate Used Colors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow saved Kitrack purchase candidates to manage used colors with the same add, detail, edit, delete, and drag-reorder experience as owned kits, and preserve those colors through move, Undo, reset, and cloud backup.

**Architecture:** Keep purchase candidates and owned kits as separate aggregates with separate color tables. Extract the existing owned-kit color experience into one callback-driven panel, then bind it to owned-kit and purchase-candidate repositories. Treat candidate metadata, photos, colors, and color paints as one transactional snapshot when moving, deleting, restoring, or backing up.

**Tech Stack:** Expo `~54.0.36`, React Native `0.81.5`, TypeScript `~5.9.2`, Expo SQLite, Expo Router, `react-native-sortables`, Node test runner.

**Spec:** `docs/superpowers/specs/2026-09-01-kit-wishlist-used-colors-design.md`

## Global Constraints

- Preserve the separation defined in `CONTEXT.md`: purchase candidates have no Box or production status, and moving to a Box leaves no persistent candidate-to-owned link.
- Keep `kit_colors` / `kit_color_paints` owned-kit-only; candidate colors use dedicated tables.
- Keep saved mixes independent; copying a mix creates an unlinked used-color record.
- New purchase candidates do not accept used colors before the first save.
- Do not add an external dependency or change Expo from `~54.0.36`.
- Follow `AGENTS.md` by consulting the exact Expo SDK 56 reference before production edits, while retaining the installed SDK required by `AGENTS.override.md`.
- Write a failing behavior test before each production change and preserve unrelated `.superpowers/` files.
- Every task ends with `npm run typecheck` or the narrowest equivalent plus its targeted Node test.

---

### Task 1: Purchase-candidate color persistence

**Files:**
- Create: `lib/db/kitWishlistColors.ts`
- Modify: `lib/db/schema.ts`
- Modify: `lib/db.ts`
- Create: `lib/kitWishlistColors.test.cjs`
- Modify: `lib/kitWishlist.test.cjs`

**Interfaces:**
- Consumes: `ColorMixSummary`, `getDB()`, and the existing candidate row in `kit_wishlist`.
- Produces:

```ts
export type KitWishlistColorSummary = ColorMixSummary;
export type KitColorPaintInput = { paintId: number; ratio: number };

export function getKitWishlistColors(wishlistId: number): Promise<KitWishlistColorSummary[]>;
export function addKitWishlistColor(
  wishlistId: number,
  name: string | null,
  note: string | null,
  paints: KitColorPaintInput[],
): Promise<void>;
export function updateKitWishlistColor(
  wishlistId: number,
  colorId: number,
  name: string | null,
  note: string | null,
  paints: KitColorPaintInput[],
): Promise<void>;
export function removeKitWishlistColor(wishlistId: number, colorId: number): Promise<void>;
export function reorderKitWishlistColors(wishlistId: number, colorIds: number[]): Promise<void>;
```

- [ ] **Step 1: Write failing repository tests**

Add tests that load the real TypeScript module with a fake SQLite boundary and assert literal SQL effects. Cover candidate existence validation, parent/paint insertion order, blank metadata normalization, ownership checks on update/delete, and zero-based reorder values.

```js
test('adds a candidate color only when its candidate exists', async () => {
  const db = fakeDb({ firstRows: [{ id: 7 }, { n: 2 }], insertedId: 31 });
  const api = loadWishlistColors(db);

  await api.addKitWishlistColor(7, ' Ocean ', '', [
    { paintId: 4, ratio: 0.25 },
    { paintId: 8, ratio: 0.75 },
  ]);

  assert.deepEqual(db.statements, [
    ['SELECT id FROM kit_wishlist WHERE id = ?', [7]],
    ['SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM kit_wishlist_colors WHERE wishlist_id = ?', [7]],
    ['INSERT INTO kit_wishlist_colors (wishlist_id, name, note, sort_order) VALUES (?, ?, ?, ?)', [7, ' Ocean ', null, 2]],
    ['INSERT INTO kit_wishlist_color_paints (wishlist_color_id, paint_id, ratio, sort_order) VALUES (?, ?, ?, ?)', [31, 4, 0.25, 0]],
    ['INSERT INTO kit_wishlist_color_paints (wishlist_color_id, paint_id, ratio, sort_order) VALUES (?, ?, ?, ?)', [31, 8, 0.75, 1]],
  ]);
});
```

- [ ] **Step 2: Run tests and confirm the missing module/schema failure**

Run: `node --test lib/kitWishlistColors.test.cjs lib/kitWishlist.test.cjs`

Expected: FAIL because `lib/db/kitWishlistColors.ts` and candidate color table declarations do not exist.

- [ ] **Step 3: Add the two candidate color tables**

Append these tables to the existing schema initialization string, without rebuilding owned-kit tables:

```sql
CREATE TABLE IF NOT EXISTS kit_wishlist_colors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wishlist_id INTEGER NOT NULL,
  name TEXT,
  note TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  added_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS kit_wishlist_color_paints (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wishlist_color_id INTEGER NOT NULL,
  paint_id INTEGER NOT NULL,
  ratio REAL NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);
```

- [ ] **Step 4: Implement the candidate color repository**

Use `withExclusiveTransactionAsync` for mutations. Before mutation, verify the candidate and color ownership with exact IDs; throw on missing rows. Read colors ordered by `sort_order, id`, read paints ordered by `sort_order, id`, and map them to `ColorMixSummary[]` exactly as `getKitColors` does.

```ts
const ownedColor = await tx.getFirstAsync<{ id: number }>(
  'SELECT id FROM kit_wishlist_colors WHERE id = ? AND wishlist_id = ?',
  [colorId, wishlistId],
);
if (!ownedColor) throw new Error('Wishlist color not found');
```

For reorder, reject duplicate or foreign IDs by loading all IDs for the candidate and comparing sorted literal ID sets before issuing updates.

- [ ] **Step 5: Export the repository and verify**

Export all Task 1 interfaces from `lib/db.ts`.

Run:

```bash
node --test lib/kitWishlistColors.test.cjs lib/kitWishlist.test.cjs
npm run typecheck
```

Expected: all targeted tests PASS and TypeScript exits 0.

- [ ] **Step 6: Commit**

```bash
git add lib/db/schema.ts lib/db/kitWishlistColors.ts lib/db.ts lib/kitWishlistColors.test.cjs lib/kitWishlist.test.cjs
git commit -m "feat: store wishlist used colors"
```

---

### Task 2: Transactional move, delete, restore, and Undo

**Files:**
- Modify: `lib/db/kitWishlist.ts`
- Modify: `lib/kitWishlist.test.cjs`

**Interfaces:**
- Consumes: Task 1 tables and existing `KitWishlistItem` / `KitWishlistPhoto` snapshots.
- Produces:

```ts
export interface KitWishlistColorPaintSnapshot {
  paint_id: number;
  ratio: number;
  sort_order: number;
}

export interface KitWishlistColorSnapshot {
  id: number;
  name: string | null;
  note: string | null;
  sort_order: number;
  added_at: string | null;
  paints: KitWishlistColorPaintSnapshot[];
}

export interface KitWishlistSnapshot {
  item: KitWishlistItem;
  photos: KitWishlistPhoto[];
  colors: KitWishlistColorSnapshot[];
}
```

- [ ] **Step 1: Extend move/delete/Undo tests with literal color snapshots**

Add a two-color fixture containing one single paint and one two-paint mix. Assert that move maps each old candidate color ID to its new `kit_colors.id`, preserves both sort orders and ratios, and deletes children before parents.

```js
assert.deepEqual(statements.slice(-4), [
  ['DELETE FROM kit_wishlist_color_paints WHERE wishlist_color_id IN (SELECT id FROM kit_wishlist_colors WHERE wishlist_id = ?)', [7]],
  ['DELETE FROM kit_wishlist_colors WHERE wishlist_id = ?', [7]],
  ['DELETE FROM kit_wishlist_photos WHERE wishlist_id = ?', [7]],
  ['DELETE FROM kit_wishlist WHERE id = ?', [7]],
]);
```

Extend delete/restore and move/Undo tests so all candidate and owned rows roll back together when any color insert throws.

- [ ] **Step 2: Run tests and confirm snapshot/color SQL failures**

Run: `node --test lib/kitWishlist.test.cjs`

Expected: FAIL because snapshots omit colors and transitions do not copy or restore color rows.

- [ ] **Step 3: Add one internal snapshot reader**

Inside `kitWishlist.ts`, add a transaction-scoped helper that reads candidate colors and paints without catalog display joins:

```ts
async function getWishlistColorSnapshots(
  tx: SQLiteDatabase,
  wishlistId: number,
): Promise<KitWishlistColorSnapshot[]>;
```

Build each `paints` array by `wishlist_color_id`, preserving `sort_order` and `added_at`. Use this helper in move and delete so both operations capture the same complete snapshot.

- [ ] **Step 4: Copy candidate colors during Box move**

After creating the owned kit and copying photos, insert each snapshot color into `kit_colors`, capture `lastInsertRowId`, then insert its paint rows into `kit_color_paints`. Only after every insert succeeds, delete candidate color paints, candidate colors, candidate photos, and the candidate row in that order.

```ts
const colorResult = await tx.runAsync(
  'INSERT INTO kit_colors (kit_id, name, note, sort_order, added_at) VALUES (?, ?, ?, ?, ?)',
  [kitId, color.name, color.note, color.sort_order, color.added_at],
);
for (const paint of color.paints) {
  await tx.runAsync(
    'INSERT INTO kit_color_paints (kit_color_id, paint_id, ratio, sort_order) VALUES (?, ?, ?, ?)',
    [colorResult.lastInsertRowId, paint.paint_id, paint.ratio, paint.sort_order],
  );
}
```

- [ ] **Step 5: Restore colors in delete Undo and move Undo**

`restoreKitWishlistItem` recreates the candidate, then each candidate color, then each paint using newly generated IDs. `undoKitWishlistMove` first deletes the exact created owned kit's color paints, colors, and photos, then restores the snapshot. Keep the whole reverse transition inside one exclusive transaction.

- [ ] **Step 6: Verify and commit**

Run:

```bash
node --test lib/kitWishlist.test.cjs
npm run typecheck
```

Expected: all candidate lifecycle tests PASS and TypeScript exits 0.

```bash
git add lib/db/kitWishlist.ts lib/kitWishlist.test.cjs
git commit -m "feat: transfer wishlist colors to Box"
```

---

### Task 3: Reset and catalog-reference safety

**Files:**
- Modify: `lib/db/catalog.ts`
- Modify: `app/(tabs)/settings.tsx`
- Modify: `lib/catalogReferences.test.cjs`
- Modify: `lib/kitWishlist.test.cjs`

**Interfaces:**
- Consumes: `kit_wishlist_colors` and `kit_wishlist_color_paints` from Task 1.
- Produces: Existing paint deletion/reset functions now treat candidate color paints as active references; wishlist reset deletes candidate color children without touching owned colors.

- [ ] **Step 1: Write failing reference and reset tests**

Extend catalog-reference tests so every SQL reference predicate includes `kit_wishlist_color_paints`. Extend wishlist reset assertions to require this order:

```js
[
  'DELETE FROM kit_wishlist_color_paints',
  'DELETE FROM kit_wishlist_colors',
  'DELETE FROM kit_wishlist_photos',
  'DELETE FROM kit_wishlist',
]
```

Also assert that owned-kit reset SQL does not mention candidate color tables.

- [ ] **Step 2: Run tests and confirm missing-reference failures**

Run: `node --test lib/catalogReferences.test.cjs lib/kitWishlist.test.cjs`

Expected: FAIL because candidate color tables are absent from paint reference and wishlist reset paths.

- [ ] **Step 3: Protect candidate-referenced paints**

Update all manual-paint delete, catalog reset, and stale-seed cleanup predicates. The shared existence check must include:

```sql
OR EXISTS (SELECT 1 FROM kit_wishlist_color_paints WHERE paint_id = ?)
```

When intentionally clearing manual catalog data, delete candidate color paints before removing now-empty candidate colors, mirroring the existing owned-color cleanup.

- [ ] **Step 4: Delete candidate children in wishlist reset only**

In `settings.tsx`, prepend candidate color child deletions to the existing wishlist reset transaction. Do not add them to the owned kit/Box reset transaction.

- [ ] **Step 5: Verify and commit**

Run:

```bash
node --test lib/catalogReferences.test.cjs lib/kitWishlist.test.cjs
npm run typecheck
```

```bash
git add lib/db/catalog.ts 'app/(tabs)/settings.tsx' lib/catalogReferences.test.cjs lib/kitWishlist.test.cjs
git commit -m "fix: protect wishlist color references"
```

---

### Task 4: Shared used-color panel

**Files:**
- Create: `components/KitUsedColorsPanel.tsx`
- Modify: `components/KitColorComposerModal.tsx`
- Modify: `components/KitDetailModal.tsx`
- Modify: `components/KitDetail/styles.ts`
- Modify: `lib/kitColors.test.cjs`
- Modify: `lib/detailUxSafety.test.cjs`

**Interfaces:**
- Consumes: existing `ColorMixCard`, `KitColorRow`, `ColorMixDetailModal`, `ColorMixEditorModal`, `KitColorComposerModal`, `moveMixRecipe`, `sameColorOrder`, and a parent scroll ref.
- Produces:

```ts
export interface UsedColorRepository {
  load(): Promise<KitColorSummary[]>;
  add(name: string | null, note: string | null, paints: { paintId: number; ratio: number }[]): Promise<void>;
  update(colorId: number, name: string | null, note: string | null, paints: { paintId: number; ratio: number }[]): Promise<void>;
  remove(colorId: number): Promise<void>;
  reorder(colorIds: number[]): Promise<void>;
}

interface KitUsedColorsPanelProps {
  active: boolean;
  repository: UsedColorRepository;
  ownedMap: Map<number, number>;
  scrollableRef: AnimatedRef<ScrollView>;
  requestCloseRef: MutableRefObject<() => void>;
  onOverlayChange(open: boolean): void;
}
```

`KitColorComposerModal` changes from a hard-coded `kitId` to:

```ts
interface Props {
  visible: boolean;
  requestCloseRef: MutableRefObject<() => void>;
  onClose(): void;
  onSaveColor(
    name: string | null,
    note: string | null,
    paints: { paintId: number; ratio: number }[],
  ): Promise<void>;
}
```

- [ ] **Step 1: Write failing shared-panel contract tests**

Move the existing source-level safety assertions for drag settings, overlay close routing, add-source navigation, error rollback, and accessibility actions from `KitDetailModal` to the expected `KitUsedColorsPanel`. Add an assertion that `KitDetailModal` supplies owned-kit repository callbacks rather than rendering its own `Sortable.Grid`.

- [ ] **Step 2: Run tests and confirm the shared component is missing**

Run: `node --test lib/kitColors.test.cjs lib/detailUxSafety.test.cjs`

Expected: FAIL because `components/KitUsedColorsPanel.tsx` and callback-driven composer props do not exist.

- [ ] **Step 3: Make the composer callback-driven**

Remove `addKitColor`, `addKitColorFromSummary`, and `kitId` from the composer. Normalize all three add paths into `onSaveColor`:

```ts
await onSaveColor(
  recipe.name,
  recipe.note,
  recipe.paints.map((paint) => ({ paintId: paint.paint_id, ratio: paint.ratio })),
);
```

Keep saved-mix loading, paint lookup, embedded back/X behavior, busy guards, and existing copy independent from saved mixes.

- [ ] **Step 4: Implement the shared panel**

Move color loading state, selected color, composer/detail/editor overlays, delete confirmation, optimistic reorder/rollback, drag handle, and accessibility move actions out of `KitDetailModal`. The panel calls only its repository. It reloads after successful add/update/delete and displays retry when `load()` fails.

Use the same drag constants already validated in the saved-mix screen:

```tsx
<Sortable.Grid
  columns={1}
  customHandle
  data={colors}
  onDragEnd={({ data }) => void saveOrder(data)}
  dragActivationDelay={180}
  dragActivationFailOffset={8}
  reorderTriggerOrigin="touch"
  overDrag="vertical"
  autoScrollActivationOffset={80}
  autoScrollMaxVelocity={500}
/>
```

- [ ] **Step 5: Bind the owned-kit repository**

In `KitDetailModal`, memoize callbacks bound to `detail.id`:

```ts
const usedColorRepository = useMemo<UsedColorRepository>(() => ({
  load: () => getKitColors(detail.id),
  add: (name, note, paints) => addKitColor(detail.id, name, note, paints),
  update: (id, name, note, paints) => updateKitColor(id, name, note, paints),
  remove: removeKitColor,
  reorder: reorderKitColors,
}), [detail.id]);
```

Remove duplicated owned-kit color state and handlers only after the shared panel renders the same cards and overlays. Keep detail edit mode restricted to the details tab.

- [ ] **Step 6: Verify and commit**

Run:

```bash
node --test lib/kitColors.test.cjs lib/detailUxSafety.test.cjs
npm run typecheck
```

```bash
git add components/KitUsedColorsPanel.tsx components/KitColorComposerModal.tsx components/KitDetailModal.tsx components/KitDetail/styles.ts lib/kitColors.test.cjs lib/detailUxSafety.test.cjs
git commit -m "refactor: share kit used color UI"
```

---

### Task 5: Purchase-candidate detail and wishlist integration

**Files:**
- Create: `components/KitWishlistDetailModal.tsx`
- Create: `components/KitWishlistDetail/styles.ts`
- Modify: `components/AddKitModal.tsx`
- Modify: `app/(tabs)/kit-wishlist.tsx`
- Modify: `lib/db/kitWishlist.ts`
- Modify: `lib/db.ts`
- Modify: `translations/ja.json`
- Modify: `translations/en.json`
- Modify: `lib/detailUxSafety.test.cjs`
- Modify: `lib/kitWishlist.test.cjs`

**Interfaces:**
- Consumes: `KitUsedColorsPanel`, Task 1 repository functions, existing candidate photo storage, `saveKitWishlistItem`, and parent move/delete callbacks.
- Produces:

```ts
export function getKitWishlistItem(id: number): Promise<KitWishlistItem | null>;

interface KitWishlistDetailModalProps {
  visible: boolean;
  wishlistId: number | null;
  onClose(): void;
  onChanged(): void;
  onMove(item: KitWishlistItem): void;
  onDelete(item: KitWishlistItem): void;
}
```

- [ ] **Step 1: Write failing candidate-detail behavior tests**

Add tests that require row tap to open `KitWishlistDetailModal`, require `AddKitModal` to remain new-entry-only, and require the detail to expose details/colors tabs without Box or status. Add DB behavior coverage for `getKitWishlistItem(id)`.

```js
test('saved candidate opens a detail with used colors but no ownership controls', () => {
  const detail = read('../components/KitWishlistDetailModal.tsx');
  assert.match(detail, /<KitUsedColorsPanel/);
  assert.match(detail, /t\('detailInfo'\)/);
  assert.match(detail, /t\('usedColorsTab'\)/);
  assert.doesNotMatch(detail, /statusPickerOpen|updateKitBox|setKitStatus/);
});
```

- [ ] **Step 2: Run tests and confirm the detail component is missing**

Run: `node --test lib/detailUxSafety.test.cjs lib/kitWishlist.test.cjs`

Expected: FAIL because the candidate detail and `getKitWishlistItem` do not exist.

- [ ] **Step 3: Add the candidate detail data loader**

Implement `getKitWishlistItem` as an ID-bound query and export it. The detail loads item, photos, owned paint counts, and used colors independently. Use a load-version guard so stale async results cannot replace a newly opened candidate.

- [ ] **Step 4: Implement candidate detail/view/edit states**

Follow the owned detail structure: title/photo area, details/colors tabs, edit icon, embedded overlays, Android back, swipe-down close, loading/error/retry, and bottom-safe-area actions. Do not render Box or production status.

During detail edit mode:

- force the details tab and hide the tab bar;
- edit metadata and photos using the existing validation and photo-draft rules from `AddKitModal`;
- save all metadata and ordered photo URIs through `saveKitWishlistItem`;
- remove detached photo files only after the transaction succeeds;
- clean newly added unsaved files when discarding;
- keep move/delete unavailable until edit mode exits.

Outside edit mode, bind candidate colors to the shared panel:

```ts
const repository: UsedColorRepository = {
  load: () => getKitWishlistColors(item.id),
  add: (name, note, paints) => addKitWishlistColor(item.id, name, note, paints),
  update: (colorId, name, note, paints) => updateKitWishlistColor(item.id, colorId, name, note, paints),
  remove: (colorId) => removeKitWishlistColor(item.id, colorId),
  reorder: (ids) => reorderKitWishlistColors(item.id, ids),
};
```

- [ ] **Step 5: Route wishlist row tap and actions**

Keep `AddKitModal` for `showAdd` only and remove its `editWishlistItem` / `onEditAction` branches after the new detail covers them. Replace `editItem` with `detailId`. Candidate detail move/delete calls the existing guarded `requestMove` and `deleteItem` paths after dismissing the native modal, preserving iOS ActionSheet timing.

- [ ] **Step 6: Add copy and verify**

Add only missing Japanese/English copy for purchase-candidate detail and edit titles. Reuse existing `detailInfo`, `usedColorsTab`, `addUsedColor`, `moveToBox`, and delete copy.

Run:

```bash
node --test lib/detailUxSafety.test.cjs lib/kitWishlist.test.cjs lib/kitColors.test.cjs
npm run typecheck
```

- [ ] **Step 7: Commit**

```bash
git add components/KitWishlistDetailModal.tsx components/KitWishlistDetail/styles.ts components/AddKitModal.tsx 'app/(tabs)/kit-wishlist.tsx' lib/db/kitWishlist.ts lib/db.ts translations/ja.json translations/en.json lib/detailUxSafety.test.cjs lib/kitWishlist.test.cjs
git commit -m "feat: manage wishlist used colors"
```

---

### Task 6: Cloud backup schema v7

**Files:**
- Modify: `lib/cloudBackup.ts`
- Modify: `lib/cloudBackup.test.cjs`

**Interfaces:**
- Consumes: candidate color tables from Task 1 and the existing local-reference backup pattern.
- Produces:

```ts
interface BackupKitWishlistColor {
  localRef: string;
  wishlistLocalRef: string;
  name: string | null;
  note: string | null;
  sort_order: number;
  added_at: string | null;
}

interface BackupKitWishlistColorPaint {
  wishlistColorLocalRef: string;
  catalogCode: string;
  ratio: number;
  sort_order: number;
}
```

The snapshot gains optional `kitWishlistColors` and `kitWishlistColorPaints`; `BACKUP_SCHEMA_VERSION` becomes `7`.

- [ ] **Step 1: Write failing v7 backup tests**

Add literal fixtures containing two candidates, two colors, and three paints. Assert local refs, catalog-code mapping, order preservation, and that orphan parent/catalog references are skipped on restore. Add a v6 fixture and assert it restores candidates with an empty used-color list.

- [ ] **Step 2: Run tests and confirm v7 fields are absent**

Run: `node --test lib/cloudBackup.test.cjs`

Expected: FAIL because schema version remains 6 and candidate colors are not serialized.

- [ ] **Step 3: Read candidate colors in the exclusive snapshot transaction**

Query candidate colors ordered by `sort_order, id` and paints ordered by `sort_order, id`. Convert IDs with helpers parallel to the existing kit candidate and owned color local-ref helpers:

```ts
const kitWishlistColorLocalRef = (id: number) => `kitwishlistcolor_${id}`;
```

Store `catalog_code`, never device-local `paint_id`.

- [ ] **Step 4: Restore candidate colors after candidates and before dependent paints**

Build `wishlistIdByLocalRef` and `wishlistColorIdByLocalRef`. Insert a candidate color only when its candidate resolves; insert a paint only when both its candidate color and catalog paint resolve. Log and skip stale references using the existing restore warning style.

- [ ] **Step 5: Include candidate color tables in restore cleanup ordering**

Before replacing local candidates, delete `kit_wishlist_color_paints`, then `kit_wishlist_colors`, then candidate photos and candidates. Keep v1-v6 compatibility by iterating over `snapshot.kitWishlistColors ?? []` and `snapshot.kitWishlistColorPaints ?? []`.

- [ ] **Step 6: Verify and commit**

Run:

```bash
node --test lib/cloudBackup.test.cjs
npm run typecheck
```

```bash
git add lib/cloudBackup.ts lib/cloudBackup.test.cjs
git commit -m "feat: back up wishlist used colors"
```

---

### Task 7: Full regression and device handoff

**Files:**
- Modify only files required by failures found in this task.

**Interfaces:**
- Consumes: all prior task deliverables.
- Produces: a fully verified branch and an Expo Go checklist for the user.

- [ ] **Step 1: Run the full automated suite**

```bash
npm run test
npm run typecheck
git diff --check
```

Expected: all tests PASS, TypeScript exits 0, and diff check reports no whitespace errors.

- [ ] **Step 2: Review data-loss boundaries**

Inspect the final diff and confirm these literal invariants:

- no candidate color deletion occurs before all owned color inserts complete;
- Undo deletes by the exact created `kitId`;
- candidate delete/restore snapshots include photos and colors;
- catalog deletion checks both owned and candidate color paint tables;
- reset child-table order is paint rows, colors, photos, candidate;
- v1-v6 restore uses empty arrays without guessing colors;
- `.superpowers/` remains untouched.

- [ ] **Step 3: Run Expo Go manual checks**

On iOS and Android where available:

1. Create and save a purchase candidate.
2. Open its detail and add one catalog paint, one saved mix, and one new mix.
3. Edit, delete/Undo, and drag-reorder candidate colors.
4. Edit candidate metadata/photos and verify the colors remain.
5. Move to one of multiple Boxes and verify all color names, ratios, and orders.
6. Undo and verify the candidate and colors return.
7. Confirm back/X behavior, long labels, and VoiceOver/TalkBack move actions.

- [ ] **Step 4: Re-run the owning task for any verification fix**

If verification finds a defect, return to the task that owns that file, add a failing regression test, apply the minimal fix, run that task's verification commands, and use that task's explicit `git add` list. If no fixes are needed, do not create an empty commit.
