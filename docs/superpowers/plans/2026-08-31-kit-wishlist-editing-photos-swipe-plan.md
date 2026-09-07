# Kitrack Purchase Candidate Editing, Photos, and Swipe Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow Kitrack purchase candidates to be edited with up to ten photos, preserve those photos through Box move/Undo and Standard-plan backup, and remove Kitrack swipe-action visual overlap.

**Architecture:** Keep purchase candidates independent from owned kits by adding `kit_wishlist_photos` beside the existing `kit_photos`. Reuse `AddKitModal`, `KitPhotoGrid`, and the existing persisted photo files; move database references rather than copying files when a candidate moves to a Box. Fix swipe overlap at its shared cause by making both Kitrack row surfaces opaque, matching Colorack's `PaintRow` behavior.

**Tech Stack:** Expo SDK `~54.0.36`, React Native, TypeScript, Expo SQLite, Expo FileSystem, Firebase Storage/Firestore, Node `node:test` static and behavioral tests.

**Spec:** `docs/superpowers/specs/2026-08-31-kit-wishlist-editing-photos-swipe-design.md`

## Global Constraints

- Keep purchase candidates independent from owned kits; do not add Box, production status, or used colors to `kit_wishlist`.
- Preserve installed Expo SDK `~54.0.36`; add no dependency.
- Reuse `KitPhotoGrid` and `lib/kitPhoto.ts`; maximum photos remains 10.
- Moving a candidate to a Box transfers every photo and its order without copying or deleting the physical file.
- Standard-plan photo backup must include purchase-candidate photos; older backup versions remain restorable.
- Preserve unrelated work and do not modify other worktrees or branches.
- Production files are modified in place; no production file is deleted.
- Every task follows red-green-refactor and ends with a focused commit.

---

### Task 1: Add the purchase-candidate photo data seam

**Files:**
- Modify: `lib/db/schema.ts`
- Modify: `lib/db/kitWishlist.ts`
- Modify: `lib/db.ts`
- Modify: `lib/kitPhoto.ts`
- Test: `lib/kitWishlist.test.cjs`

**Interfaces:**
- Produces: `KitWishlistPhoto`, `getKitWishlistPhotos(wishlistId)`, and `saveKitWishlistItem(id, draft, photoUris)`.
- Produces: `cleanupOrphanedKitPhotos(db)` covering both `kit_photos` and `kit_wishlist_photos`.
- Consumes: existing `KitWishlistItem`, `KitWishlistDraft`, and persisted `kit-photos` URIs.

- [ ] **Step 1: Add failing schema and API tests**

Add assertions to `lib/kitWishlist.test.cjs` that require the new table, photo lookup, and atomic save seam:

```js
test('purchase candidates have an independent photo table', () => {
  const schema = fs.readFileSync(require.resolve('./db/schema.ts'), 'utf8');
  assert.match(schema, /CREATE TABLE IF NOT EXISTS kit_wishlist_photos/);
  assert.match(schema, /wishlist_id INTEGER NOT NULL/);
  assert.match(schema, /synced_at TEXT/);
  assert.match(schema, /storage_path TEXT/);
});

test('photo maintenance covers owned and purchase-candidate references', () => {
  const source = fs.readFileSync(require.resolve('./kitPhoto.ts'), 'utf8');
  assert.match(source, /cleanupOrphanedKitPhotos/);
  assert.match(source, /SELECT uri FROM kit_photos/);
  assert.match(source, /SELECT uri FROM kit_wishlist_photos/);
});

test('saving a candidate updates metadata and ordered photos in one exclusive transaction', async () => {
  const statements = [];
  const db = {
    async withExclusiveTransactionAsync(fn) {
      await fn({
        async getAllAsync() {
          return [{ id: 7, uri: 'file:///kit-photos/old.jpg', sort_order: 0, synced_at: 'now', storage_path: 'users/u/kit-photos/old.jpg' }];
        },
        async runAsync(sql, args) {
          statements.push([sql, args]);
          return { lastInsertRowId: 3 };
        },
      });
    },
  };
  const api = loadKitWishlist(db);
  const result = await api.saveKitWishlistItem(
    3,
    { name: 'Zaku', maker: 'Bandai', series: null, category: null, scale: null, price: null, note: null },
    ['file:///kit-photos/old.jpg', 'file:///kit-photos/new.jpg'],
  );

  assert.equal(result.id, 3);
  assert.deepEqual(result.removedPhotoUris, []);
  assert.match(statements[0][0], /UPDATE kit_wishlist/);
  assert.ok(statements.some(([sql]) => sql === 'DELETE FROM kit_wishlist_photos WHERE wishlist_id = ?'));
  assert.equal(statements.filter(([sql]) => sql.startsWith('INSERT INTO kit_wishlist_photos')).length, 2);
});
```

- [ ] **Step 2: Run the focused test and confirm red**

Run: `node --test lib/kitWishlist.test.cjs`

Expected: FAIL because `kit_wishlist_photos` and `saveKitWishlistItem` do not exist.

- [ ] **Step 3: Add the table and photo types**

In `lib/db/schema.ts`, create the table alongside `kit_photos`:

```ts
'CREATE TABLE IF NOT EXISTS kit_wishlist_photos (' +
'  id INTEGER PRIMARY KEY AUTOINCREMENT,' +
'  wishlist_id INTEGER NOT NULL, uri TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0,' +
"  added_at TEXT DEFAULT (datetime('now')), synced_at TEXT, storage_path TEXT" +
');'
```

In `lib/db/kitWishlist.ts`, add:

```ts
export interface KitWishlistPhoto {
  id: number;
  uri: string;
  sort_order: number;
  synced_at: string | null;
  storage_path: string | null;
}

export async function getKitWishlistPhotos(wishlistId: number): Promise<KitWishlistPhoto[]> {
  return getDB().getAllAsync<KitWishlistPhoto>(
    'SELECT id, uri, sort_order, synced_at, storage_path FROM kit_wishlist_photos WHERE wishlist_id = ? ORDER BY sort_order, id',
    [wishlistId],
  );
}
```

Export the new type and functions from `lib/db.ts`.

- [ ] **Step 4: Implement atomic candidate save**

Add this exact public shape in `lib/db/kitWishlist.ts`:

```ts
export async function saveKitWishlistItem(
  id: number | null,
  item: KitWishlistDraft,
  photoUris: readonly string[],
): Promise<{ id: number; removedPhotoUris: string[] }>;
```

Inside one `withExclusiveTransactionAsync` call:

1. Insert or update the `kit_wishlist` row.
2. Read existing `kit_wishlist_photos` rows into `Map<uri, row>`.
3. Delete candidate photo rows.
4. Reinsert `photoUris` in array order.
5. Preserve `synced_at` and `storage_path` when a URI already existed.
6. Return old URIs absent from the new array as `removedPhotoUris`.

Keep `addKitWishlistItem` as a compatibility wrapper:

```ts
export async function addKitWishlistItem(item: KitWishlistDraft): Promise<number> {
  return (await saveKitWishlistItem(null, item, [])).id;
}
```

- [ ] **Step 5: Maintain URIs and clean orphan files across both photo tables**

Refactor `migrateKitPhotoUris` in `lib/kitPhoto.ts` to process both tables without changing existing owned-kit behavior. Add:

```ts
export async function cleanupOrphanedKitPhotos(db: SQLite.SQLiteDatabase): Promise<void>;
```

It must:

1. Return if the `kit-photos` directory does not exist.
2. Read all `uri` values from `kit_photos` and `kit_wishlist_photos`.
3. Delete only files directly inside `KIT_PHOTO_DIR` whose current URI is absent from both sets.
4. Use `deleteKitPhoto` and continue after individual failures.

Call it from `initDB()` after URI migration and after both tables exist.

- [ ] **Step 6: Run focused tests and typecheck**

Run:

```powershell
node --test lib/kitWishlist.test.cjs
npm run typecheck
git diff --check
```

Expected: all pass.

- [ ] **Step 7: Commit**

```powershell
git add -- lib/db/schema.ts lib/db/kitWishlist.ts lib/db.ts lib/kitPhoto.ts lib/kitWishlist.test.cjs
git commit -m "feat: add purchase candidate photo storage"
```

---

### Task 2: Preserve photos through move, delete, restore, and Undo

**Files:**
- Modify: `lib/db/kitWishlist.ts`
- Modify: `app/(tabs)/kit-wishlist.tsx`
- Test: `lib/kitWishlist.test.cjs`

**Interfaces:**
- Consumes: `KitWishlistPhoto` and `saveKitWishlistItem` from Task 1.
- Produces: `KitWishlistSnapshot`, photo-aware `removeKitWishlistItem`, `restoreKitWishlistItem`, `moveKitWishlistItemToBox`, and `undoKitWishlistMove`.

- [ ] **Step 1: Replace lifecycle expectations with failing photo-aware tests**

Define the snapshot shape in tests:

```js
const snapshot = {
  item: { id: 3, name: 'MG Zaku', maker: 'Bandai', series: null, category: null, scale: null, price: null, note: null, added_at: '2026-08-31' },
  photos: [{ id: 9, uri: 'file:///kit-photos/front.jpg', sort_order: 0, synced_at: 'now', storage_path: 'users/u/kit-photos/front.jpg' }],
};
```

Update tests to require:

- Move inserts `kit_photos` from `kit_wishlist_photos` before deleting candidate rows.
- Move returns `{ kitId, snapshot }`.
- Undo recreates candidate and candidate-photo rows without calling `deleteKitPhoto`.
- Delete returns the same snapshot and restore recreates both parent and photos.

Key assertions:

```js
assert.ok(statements.some(([sql]) => sql.startsWith('INSERT INTO kit_photos')));
assert.ok(statements.some(([sql]) => sql === 'DELETE FROM kit_wishlist_photos WHERE wishlist_id = ?'));
assert.deepEqual(result.snapshot.photos[0].uri, 'file:///kit-photos/front.jpg');
assert.equal(deletedPhotos.length, 0);
```

Also assert that the shopping-list screen keeps a pending cleanup callback, clears it before Undo restoration, and calls `deleteKitPhoto` only from the expiry path.

- [ ] **Step 2: Run focused test and confirm red**

Run: `node --test lib/kitWishlist.test.cjs`

Expected: FAIL because lifecycle methods only carry the candidate item.

- [ ] **Step 3: Implement the snapshot lifecycle**

Add:

```ts
export interface KitWishlistSnapshot {
  item: KitWishlistItem;
  photos: KitWishlistPhoto[];
}
```

Use these signatures:

```ts
export async function moveKitWishlistItemToBox(
  id: number,
  boxId: number,
): Promise<{ kitId: number; snapshot: KitWishlistSnapshot }>;

export async function removeKitWishlistItem(id: number): Promise<KitWishlistSnapshot | null>;

export async function restoreKitWishlistItem(snapshot: KitWishlistSnapshot): Promise<number>;

export async function undoKitWishlistMove(kitId: number, snapshot: KitWishlistSnapshot): Promise<void>;
```

All parent/photo writes stay inside one exclusive transaction. Transfer rows with explicit values rather than a file copy. `undoKitWishlistMove` must not invoke `deleteKitPhoto` for transferred photos.

- [ ] **Step 4: Make the screen's Toast own deferred file cleanup**

In `app/(tabs)/kit-wishlist.tsx`, update move and Undo calls to pass snapshots. Extend the screen-local `showToast` helper with an optional `onExpire` callback and a `toastCleanupRef`:

```ts
const toastCleanupRef = useRef<(() => void | Promise<void>) | null>(null);

const clearToast = (runCleanup: boolean) => {
  if (toastTimer.current) clearTimeout(toastTimer.current);
  const cleanup = toastCleanupRef.current;
  toastCleanupRef.current = null;
  setToast('');
  setToastAction(null);
  if (runCleanup && cleanup) void cleanup();
};
```

When a candidate is deleted, pass an expiry callback that calls `deleteKitPhoto` for every snapshot photo. The Undo callback must clear the expiry callback before restoring the snapshot. Replacing an existing toast must first run its pending cleanup because its Undo action is no longer visible.

- [ ] **Step 5: Run focused tests and typecheck**

Run:

```powershell
node --test lib/kitWishlist.test.cjs
npm run typecheck
git diff --check
```

Expected: all pass.

- [ ] **Step 6: Commit**

```powershell
git add -- lib/db/kitWishlist.ts 'app/(tabs)/kit-wishlist.tsx' lib/kitWishlist.test.cjs
git commit -m "feat: preserve candidate photos through lifecycle"
```

---

### Task 3: Add purchase-candidate editing and photo UI

**Files:**
- Modify: `components/AddKitModal.tsx`
- Modify: `app/(tabs)/kit-wishlist.tsx`
- Modify: `translations/ja.json`
- Modify: `translations/en.json`
- Test: `lib/formSafety.test.cjs`
- Test: `lib/kitWishlist.test.cjs`

**Interfaces:**
- Consumes: `getKitWishlistPhotos` and `saveKitWishlistItem` from Task 1.
- Produces: `editWishlistItem?: KitWishlistItem | null` prop on `AddKitModal` and tap-to-edit rows with thumbnails.

- [ ] **Step 1: Write failing form and list tests**

Replace the old assertion that wishlist photos are hidden with:

```js
test('purchase candidate form supports editing and photos', () => {
  const source = readComponent('components/AddKitModal.tsx');
  assert.match(source, /editWishlistItem\?: KitWishlistItem \| null/);
  assert.match(source, /getKitWishlistPhotos/);
  assert.match(source, /saveKitWishlistItem/);
  assert.match(source, /<KitPhotoGrid/);
  assert.doesNotMatch(source, /saveTarget === 'owned' \? <KitPhotoGrid/);
});
```

Add list assertions:

```js
assert.match(source, /FROM kit_wishlist_photos/);
assert.match(source, /AS thumb_uri/);
assert.match(source, /onPress=\{\(\) => setEditItem\(item\)\}/);
assert.match(source, /editWishlistItem=\{editItem\}/);
```

- [ ] **Step 2: Run tests and confirm red**

Run:

```powershell
node --test lib/formSafety.test.cjs lib/kitWishlist.test.cjs
```

Expected: FAIL because editing and candidate photos are not rendered.

- [ ] **Step 3: Extend `AddKitModal` without duplicating a form**

Add to `Props`:

```ts
editWishlistItem?: KitWishlistItem | null;
```

When the modal becomes visible:

- New owned/new wishlist: reset to empty values.
- Editing wishlist: populate all fields and await `getKitWishlistPhotos(editWishlistItem.id)`.
- Guard async load with a version ref so a late result cannot overwrite another item.
- Keep `initialPhotoUrisRef` and delete only newly added URIs on discard.

Render `KitPhotoGrid` for both save targets. On save, keep the existing owned-kit INSERT branch intact and replace only the wishlist branch:

```ts
if (saveTarget === 'wishlist') {
  const result = await saveKitWishlistItem(editWishlistItem?.id ?? null, draft, photos);
  for (const uri of result.removedPhotoUris) {
    await deleteKitPhoto(uri).catch((error) =>
      console.error('AddKitModal: failed to remove detached candidate photo', uri, error)
    );
  }
} else {
  // Keep the current kits INSERT followed by addKitPhoto calls unchanged.
}
```

After successful candidate save, delete `result.removedPhotoUris` best-effort. Keep owned-kit insertion behavior unchanged.

Use `t('editKitWishlistItem')` in edit mode and add translations:

```json
"editKitWishlistItem": "購入候補を編集"
```

```json
"editKitWishlistItem": "Edit Purchase Candidate"
```

- [ ] **Step 4: Make the wishlist row editable and show its thumbnail**

Extend the list query:

```sql
(SELECT uri FROM kit_wishlist_photos
 WHERE wishlist_id = kit_wishlist.id
 ORDER BY sort_order, id LIMIT 1) AS thumb_uri
```

Add a list-row type extending `KitWishlistItem` with `thumb_uri: string | null`. Use the same 48px thumbnail/placeholder presentation as `kits.tsx`. Wrap row content in `TouchableOpacity` and set `editItem` on press. Preserve delete/move accessibility actions on the same pressable row.

Drive the modal with:

```tsx
<AddKitModal
  visible={showAdd || editItem != null}
  defaultBoxId={null}
  saveTarget="wishlist"
  editWishlistItem={editItem}
  onClose={() => {
    setShowAdd(false);
    setEditItem(null);
    void reload();
  }}
/>
```

- [ ] **Step 5: Run focused tests and typecheck**

Run:

```powershell
node --test lib/formSafety.test.cjs lib/kitWishlist.test.cjs
npm run typecheck
git diff --check
```

Expected: all pass.

- [ ] **Step 6: Commit**

```powershell
git add -- components/AddKitModal.tsx 'app/(tabs)/kit-wishlist.tsx' translations/ja.json translations/en.json lib/formSafety.test.cjs lib/kitWishlist.test.cjs
git commit -m "feat: edit purchase candidates with photos"
```

---

### Task 4: Include candidate photos in backup, subscription reset, and list reset

**Files:**
- Modify: `lib/kitPhotoBackup.ts`
- Modify: `lib/cloudBackup.ts`
- Modify: `lib/subscription.ts`
- Modify: `app/(tabs)/settings.tsx`
- Test: `lib/cloudBackup.test.cjs`
- Test: `lib/subscription.test.cjs`
- Test: `lib/kitWishlist.test.cjs`

**Interfaces:**
- Consumes: `kit_wishlist_photos` and candidate `localRef` values.
- Produces: backup schema v6 with `kitWishlistPhotos` and photo-aware reset behavior.

- [ ] **Step 1: Add failing backup and reset tests**

In `lib/cloudBackup.test.cjs`, require:

```js
assert.equal(snapshot.schemaVersion, 6);
assert.deepEqual(snapshot.kitWishlistPhotos, [{
  wishlistLocalRef: 'kit_wishlist_1',
  storagePath: 'users/u/kit-photos/candidate.jpg',
  sort_order: 0,
}]);
```

Add restore assertions that v6 inserts `kit_wishlist_photos`, while a v5 fixture without `kitWishlistPhotos` restores successfully with no candidate-photo insert.

In `lib/subscription.test.cjs`, assert both tables have `synced_at` and `storage_path` reset. In `lib/kitWishlist.test.cjs`, assert settings reset reads candidate photo URIs, deletes candidate photo rows before candidates, then deletes the files after DB success.

- [ ] **Step 2: Run focused tests and confirm red**

Run:

```powershell
node --test lib/cloudBackup.test.cjs lib/subscription.test.cjs lib/kitWishlist.test.cjs
```

Expected: FAIL because backup schema v6 and candidate-photo reset do not exist.

- [ ] **Step 3: Generalize photo upload across the two known tables**

In `lib/kitPhotoBackup.ts`, keep the existing public `uploadPendingKitPhotos(expectedUid)` function. Read pending rows from each known table and carry a literal target discriminator:

```ts
type PendingPhotoTarget = 'kit_photos' | 'kit_wishlist_photos';
type PendingPhotoRow = { target: PendingPhotoTarget; id: number; uri: string };
```

Use an explicit branch for the update SQL; never interpolate an arbitrary table name:

```ts
const updateSql = photo.target === 'kit_photos'
  ? "UPDATE kit_photos SET synced_at = datetime('now'), storage_path = ? WHERE id = ?"
  : "UPDATE kit_wishlist_photos SET synced_at = datetime('now'), storage_path = ? WHERE id = ?";
```

Keep the same Storage directory and download function.

- [ ] **Step 4: Add backup schema v6**

In `lib/cloudBackup.ts`:

- Set `BACKUP_SCHEMA_VERSION = 6`.
- Add `localRef` to each v6 `kitWishlist` item.
- Add `kitWishlistLocalRef(id: number): string` returning `kit_wishlist_${id}` and use that exact format for photo references.
- Add:

```ts
interface BackupKitWishlistPhoto {
  wishlistLocalRef: string;
  storagePath: string;
  sort_order: number;
}
```

- Add optional `kitWishlistPhotos?: BackupKitWishlistPhoto[]` to `BackupSnapshot` for backward compatibility.
- When `hasPhotoBackup`, always emit both `kitPhotos` and `kitWishlistPhotos`, including empty arrays.
- On restore, validate every `wishlistLocalRef`, download owned and candidate photos together, insert candidates first, then insert candidate photo rows using the restored ID map.
- Accept schema versions 1 through 6; versions 1 through 5 treat candidate photos as empty.

- [ ] **Step 5: Extend reset and entitlement cleanup**

In `lib/subscription.ts`, apply synchronization metadata reset to both photo tables.

In `app/(tabs)/settings.tsx`, the purchase-candidate reset must:

1. Read all candidate photo URIs.
2. Delete `kit_wishlist_photos` and `kit_wishlist` in the existing reset transaction/order.
3. Delete physical files only after DB success, continuing after individual file failures.

- [ ] **Step 6: Run focused and full tests**

Run:

```powershell
node --test lib/cloudBackup.test.cjs lib/subscription.test.cjs lib/kitWishlist.test.cjs
npm run test
npm run typecheck
git diff --check
```

Expected: all pass.

- [ ] **Step 7: Commit**

```powershell
git add -- lib/kitPhotoBackup.ts lib/cloudBackup.ts lib/subscription.ts 'app/(tabs)/settings.tsx' lib/cloudBackup.test.cjs lib/subscription.test.cjs lib/kitWishlist.test.cjs
git commit -m "feat: back up purchase candidate photos"
```

---

### Task 5: Fix all Kitrack swipe surfaces and accessibility parity

**Files:**
- Modify: `app/(tabs)/kits.tsx`
- Modify: `app/(tabs)/kit-wishlist.tsx`
- Test: `lib/kitWishlist.test.cjs`
- Test: `lib/detailUxSafety.test.cjs`

**Interfaces:**
- Consumes: existing `Swipeable` actions and theme `colors.surface`.
- Produces: opaque Kitrack rows and non-gesture accessibility actions.

- [ ] **Step 1: Write failing visual-contract tests**

Add static assertions:

```js
test('all Kitrack swipe rows paint an opaque surface', () => {
  const kits = fs.readFileSync(require.resolve('../app/(tabs)/kits.tsx'), 'utf8');
  const wishlist = fs.readFileSync(require.resolve('../app/(tabs)/kit-wishlist.tsx'), 'utf8');
  assert.match(kits, /row: \{[^}]*backgroundColor: colors\.surface/);
  assert.match(wishlist, /row: \{[^}]*backgroundColor: colors\.surface/);
});
```

In `lib/detailUxSafety.test.cjs`, require `kits.tsx` to expose delete and complete accessibility actions and route them to the same handlers as swipe.

- [ ] **Step 2: Run focused tests and confirm red**

Run:

```powershell
node --test lib/kitWishlist.test.cjs lib/detailUxSafety.test.cjs
```

Expected: FAIL because Kitrack rows are transparent and owned-kit swipe actions are gesture-only.

- [ ] **Step 3: Paint the two shared row surfaces**

Add only `backgroundColor: colors.surface` to:

- `styles.row` in `app/(tabs)/kits.tsx`.
- `styles.row` in `app/(tabs)/kit-wishlist.tsx`.

Do not add z-index, opacity, clipping, animation, or a wrapper component.

- [ ] **Step 4: Add owned/completed kit accessibility actions**

On the owned-kit row container, expose:

```tsx
accessibilityActions={[
  { name: 'delete', label: t('delete') },
  ...(!completedScreen ? [{ name: 'complete', label: t('statusCompleted') }] : []),
]}
onAccessibilityAction={({ nativeEvent }) => {
  if (nativeEvent.actionName === 'delete') deleteKitItem(item);
  if (nativeEvent.actionName === 'complete' && !completedScreen) completeKit(item);
}}
```

Preserve existing detail and status button taps.

- [ ] **Step 5: Run focused tests and typecheck**

Run:

```powershell
node --test lib/kitWishlist.test.cjs lib/detailUxSafety.test.cjs
npm run typecheck
git diff --check
```

Expected: all pass.

- [ ] **Step 6: Commit**

```powershell
git add -- 'app/(tabs)/kits.tsx' 'app/(tabs)/kit-wishlist.tsx' lib/kitWishlist.test.cjs lib/detailUxSafety.test.cjs
git commit -m "fix: prevent Kitrack swipe action overlap"
```

---

### Task 6: Integrated regression and platform verification

**Files:**
- Modify only if verification exposes a defect in the files already listed above.
- Test: all `lib/*.test.cjs` through package scripts.

**Interfaces:**
- Consumes: completed Tasks 1 through 5.
- Produces: verified iOS and Android bundles with no dependency or Expo SDK drift.

- [ ] **Step 1: Run the complete automated checks**

Run:

```powershell
npm run test
npm run typecheck
git diff --check
npx expo-doctor
```

Expected:

- All tests pass.
- TypeScript passes.
- Diff check is clean.
- Expo Doctor may report only the repository's deliberate `~54.0.36` patch pin mismatch; no new issue is accepted.

- [ ] **Step 2: Export both platforms**

Use temporary output directories outside the source tree:

```powershell
npx expo export --platform ios --output-dir "$env:TEMP\colorack-wishlist-ios"
npx expo export --platform android --output-dir "$env:TEMP\colorack-wishlist-android"
```

Expected: both exports complete without Metro resolution errors.

- [ ] **Step 3: Review the complete diff against the spec**

Run:

```powershell
git status --short
git diff HEAD~5 --stat
git diff HEAD~5 --check
```

Confirm:

- No unrelated worktree file changed.
- No dependency or Expo version changed.
- No production file was deleted.
- Every spec verification bullet has an automated assertion or an explicit platform check.

If Step 1 or Step 2 exposes a defect, return to the owning task's red-green cycle, stage only that task's listed files, and use `git commit -m "fix: close purchase candidate verification gaps"`. Do not create an empty commit when no correction is needed.
