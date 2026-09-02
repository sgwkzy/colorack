# Kitrack Shopping List Ownership Separation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Separate Kitrack purchase candidates from owned kits, move a candidate into a user-selected Box exactly once, and preserve the independent list through resets and cloud backup.

**Architecture:** Add an independent `kit_wishlist` SQLite table and a focused DB module for its lifecycle. Replace the reused owned-kit screen with a dedicated shopping-list screen; its move action transactionally creates one `kits` row and deletes the candidate. Extend cloud backup to schema v5 and remove every owned-kit-to-shopping-list coupling.

**Tech Stack:** Expo SDK `~54.0.36`, React Native 0.81, Expo Router, expo-sqlite, react-native-gesture-handler, TypeScript 5.9, Node `node:test` CommonJS tests.

**Spec:** `docs/superpowers/specs/2026-08-31-kit-wishlist-ownership-separation-design.md`

## Global Constraints

- Preserve Expo SDK `~54.0.36`; add no dependency.
- A purchase candidate has no Box, production status, photo, or used-color relation.
- Moving succeeds atomically: create one `not_started` owned kit in the selected Box, then remove the candidate.
- One Box skips selection; multiple Boxes require selection; cancel changes nothing.
- Do not keep or duplicate a candidate after a successful move.
- Existing owned `kits` rows must never be guessed away during legacy migration.
- Kitrack used-color editing says `色情報を編集`; saved mixes retain `配合を編集`.
- Preserve unrelated local changes, including the untracked `.superpowers/` directory.
- Every task must pass its narrow test before commit; final verification runs `npm run test` and `npm run typecheck`.

---

## File Structure

- Create `lib/db/kitWishlist.ts`: purchase-candidate CRUD, transactional move, and Undo restoration.
- Create `lib/kitWishlist.test.cjs`: executable DB behavior and source-boundary tests.
- Modify `lib/db/schema.ts`: independent table plus atomic legacy `kit_lists` migration.
- Modify `lib/db.ts`: export the focused purchase-candidate API.
- Modify `components/AddKitModal.tsx`: save directly to either owned kits or purchase candidates; hide photos for candidates.
- Replace `app/(tabs)/kit-wishlist.tsx`: dedicated list, conditional Box selection, swipe actions, and Undo toast.
- Modify owned-kit files (`app/(tabs)/kits.tsx`, `components/KitDetailModal.tsx`, `components/KitBoxOptions.tsx`, `lib/db/kits.ts`, `app/(tabs)/settings.tsx`, `components/NavigationDrawer.tsx`): remove all legacy coupling.
- Modify `lib/cloudBackup.ts` and `lib/cloudBackup.test.cjs`: schema v5 round-trip for purchase candidates.
- Modify `translations/ja.json` and `translations/en.json`: precise move, empty-state, and used-color edit copy.
- Modify `lib/formSafety.test.cjs`, `lib/detailUxSafety.test.cjs`, and `lib/modalFlowSafety.test.cjs` only where existing source-contract assertions cover the changed components.

---

### Task 1: Independent Purchase-Candidate Storage and Atomic Move

**Files:**
- Create: `lib/db/kitWishlist.ts`
- Create: `lib/kitWishlist.test.cjs`
- Modify: `lib/db/schema.ts`
- Modify: `lib/db.ts`

**Interfaces:**
- Produces: `KitWishlistItem`, `KitWishlistDraft`.
- Produces: `addKitWishlistItem(draft): Promise<number>`.
- Produces: `removeKitWishlistItem(id): Promise<KitWishlistItem | null>`.
- Produces: `restoreKitWishlistItem(item): Promise<number>`.
- Produces: `moveKitWishlistItemToBox(id, boxId): Promise<{ kitId: number; item: KitWishlistItem }>`.
- Produces: `undoKitWishlistMove(kitId, item): Promise<void>`.
- Consumes: the existing `getDB()` connection and `kits` schema.

- [ ] **Step 1: Write failing DB lifecycle and schema-boundary tests**

Create `lib/kitWishlist.test.cjs` with the same TypeScript transpile harness used by `lib/kitColors.test.cjs`. The core tests must assert exact transaction behavior:

```js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const ts = require('typescript');

function loadKitWishlist(db) {
  const source = fs.readFileSync(require.resolve('./db/kitWishlist.ts'), 'utf8');
  const code = ts.transpileModule(source, {
    compilerOptions: { esModuleInterop: true, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(
    (id) => {
      if (id === './connection') return { getDB: () => db };
      throw new Error(`Unexpected require: ${id}`);
    },
    module,
    module.exports
  );
  return module.exports;
}

test('moving a purchase candidate creates one owned kit and removes the candidate atomically', async () => {
  const statements = [];
  const db = {
    async withTransactionAsync(fn) { await fn(); },
    async getFirstAsync(sql) {
      if (sql.includes('FROM kit_boxes')) return { id: 8 };
      return { id: 3, name: 'MG Zaku', maker: 'Bandai', series: 'MG', category: 'Plastic model', scale: '1/100', price: 4500, note: '再販待ち', added_at: '2026-08-31' };
    },
    async runAsync(sql, args) {
      statements.push([sql, args]);
      return { lastInsertRowId: sql.startsWith('INSERT INTO kits') ? 21 : 0 };
    },
  };
  const api = loadKitWishlist(db);

  const result = await api.moveKitWishlistItemToBox(3, 8);

  assert.equal(result.kitId, 21);
  assert.match(statements[0][0], /INSERT INTO kits/);
  assert.deepEqual(statements[0][1], [8, 'MG Zaku', 'Bandai', 'MG', 'Plastic model', '1\/100', 4500, '再販待ち', 'not_started']);
  assert.deepEqual(statements[1], ['DELETE FROM kit_wishlist WHERE id = ?', [3]]);
});

test('moving to a missing Box leaves the candidate untouched', async () => {
  let writes = 0;
  const api = loadKitWishlist({
    async withTransactionAsync(fn) { await fn(); },
    async getFirstAsync(sql) { return sql.includes('FROM kit_boxes') ? null : { id: 3 }; },
    async runAsync() { writes++; return { lastInsertRowId: 0 }; },
  });
  await assert.rejects(() => api.moveKitWishlistItemToBox(3, 99), /Box not found/);
  assert.equal(writes, 0);
});

test('undo removes only the created owned row and restores the original candidate', async () => {
  const statements = [];
  const db = {
    async withTransactionAsync(fn) { await fn(); },
    async runAsync(sql, args) { statements.push([sql, args]); return { lastInsertRowId: 31 }; },
  };
  const api = loadKitWishlist(db);
  const item = { id: 3, name: 'MG Zaku', maker: 'Bandai', series: null, category: null, scale: null, price: null, note: null, added_at: '2026-08-31' };

  await api.undoKitWishlistMove(21, item);

  assert.deepEqual(statements[0], ['DELETE FROM kits WHERE id = ?', [21]]);
  assert.match(statements[1][0], /INSERT INTO kit_wishlist/);
  assert.equal(statements[1][1].at(-1), '2026-08-31');
});

test('legacy schema migrates linked kit data without deleting owned kits', () => {
  const schema = fs.readFileSync(require.resolve('./db/schema.ts'), 'utf8');
  assert.match(schema, /CREATE TABLE IF NOT EXISTS kit_wishlist/);
  assert.match(schema, /INSERT INTO kit_wishlist[\s\S]*FROM kit_lists[\s\S]*JOIN kits/);
  assert.match(schema, /DROP TABLE kit_lists/);
  assert.doesNotMatch(schema, /DELETE FROM kits[\s\S]*kit_lists/);
});
```

- [ ] **Step 2: Run the narrow test and verify failure**

Run: `node --test lib/kitWishlist.test.cjs`

Expected: FAIL because `lib/db/kitWishlist.ts` and the independent schema do not exist.

- [ ] **Step 3: Add the independent table and atomic legacy migration**

In `lib/db/schema.ts`, create the table in the main schema batch:

```ts
'CREATE TABLE IF NOT EXISTS kit_wishlist (' +
'  id INTEGER PRIMARY KEY AUTOINCREMENT,' +
'  name TEXT NOT NULL, maker TEXT NOT NULL, series TEXT, category TEXT, scale TEXT, note TEXT, price INTEGER,' +
"  added_at TEXT DEFAULT (datetime('now'))" +
');'
```

Remove fresh-schema creation and unique-index maintenance for `kit_lists`. After the main schema exists, detect the legacy table and migrate inside one transaction:

```ts
const hasLegacyKitLists = await db.getFirstAsync<{ name: string }>(
  "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'kit_lists'"
);
if (hasLegacyKitLists) {
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      'INSERT INTO kit_wishlist (name, maker, series, category, scale, note, price, added_at)' +
      ' SELECT k.name, k.maker, k.series, k.category, k.scale, k.note, k.price, l.added_at' +
      ' FROM kit_lists l JOIN kits k ON k.id = l.kit_id'
    );
    await db.execAsync('DROP TABLE kit_lists');
  });
}
```

The migration copies candidate metadata and leaves every `kits` row untouched.

- [ ] **Step 4: Implement the focused DB module**

Create `lib/db/kitWishlist.ts` with normalized writes and transactional move/Undo:

```ts
import { getDB } from './connection';

export interface KitWishlistItem {
  id: number;
  name: string;
  maker: string;
  series: string | null;
  category: string | null;
  scale: string | null;
  price: number | null;
  note: string | null;
  added_at: string | null;
}

export type KitWishlistDraft = Omit<KitWishlistItem, 'id' | 'added_at'>;

const values = (item: KitWishlistDraft) => [
  item.name.trim(), item.maker.trim(), item.series?.trim() || null,
  item.category?.trim() || null, item.scale?.trim() || null,
  item.price, item.note?.trim() || null,
];

export async function addKitWishlistItem(item: KitWishlistDraft): Promise<number> {
  const result = await getDB().runAsync(
    'INSERT INTO kit_wishlist (name, maker, series, category, scale, price, note) VALUES (?, ?, ?, ?, ?, ?, ?)',
    values(item)
  );
  return result.lastInsertRowId;
}

export async function moveKitWishlistItemToBox(id: number, boxId: number): Promise<{ kitId: number; item: KitWishlistItem }> {
  const db = getDB();
  let moved!: { kitId: number; item: KitWishlistItem };
  await db.withTransactionAsync(async () => {
    const box = await db.getFirstAsync<{ id: number }>('SELECT id FROM kit_boxes WHERE id = ?', [boxId]);
    if (!box) throw new Error('Box not found');
    const item = await db.getFirstAsync<KitWishlistItem>('SELECT * FROM kit_wishlist WHERE id = ?', [id]);
    if (!item) throw new Error('Wishlist item not found');
    const result = await db.runAsync(
      'INSERT INTO kits (box_id, name, maker, series, category, scale, price, note, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [boxId, item.name, item.maker, item.series, item.category, item.scale, item.price, item.note, 'not_started']
    );
    await db.runAsync('DELETE FROM kit_wishlist WHERE id = ?', [id]);
    moved = { kitId: result.lastInsertRowId, item };
  });
  return moved;
}

export async function removeKitWishlistItem(id: number): Promise<KitWishlistItem | null> {
  const db = getDB();
  let removed: KitWishlistItem | null = null;
  await db.withTransactionAsync(async () => {
    removed = await db.getFirstAsync<KitWishlistItem>('SELECT * FROM kit_wishlist WHERE id = ?', [id]);
    if (removed) await db.runAsync('DELETE FROM kit_wishlist WHERE id = ?', [id]);
  });
  return removed;
}

export async function restoreKitWishlistItem(item: KitWishlistItem): Promise<number> {
  const result = await getDB().runAsync(
    'INSERT INTO kit_wishlist (name, maker, series, category, scale, price, note, added_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [item.name, item.maker, item.series, item.category, item.scale, item.price, item.note, item.added_at]
  );
  return result.lastInsertRowId;
}

export async function undoKitWishlistMove(kitId: number, item: KitWishlistItem): Promise<void> {
  const db = getDB();
  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM kits WHERE id = ?', [kitId]);
    await db.runAsync(
      'INSERT INTO kit_wishlist (name, maker, series, category, scale, price, note, added_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [item.name, item.maker, item.series, item.category, item.scale, item.price, item.note, item.added_at]
    );
  });
}
```

Undo deletes only the returned `kitId` and restores the original item in one transaction.

- [ ] **Step 5: Export the API and run the test**

Add to `lib/db.ts`:

```ts
export {
  type KitWishlistItem, type KitWishlistDraft, addKitWishlistItem,
  removeKitWishlistItem, restoreKitWishlistItem,
  moveKitWishlistItemToBox, undoKitWishlistMove,
} from './db/kitWishlist';
```

Run: `node --test lib/kitWishlist.test.cjs`

Expected: PASS for move atomicity, missing-Box safety, removal/restore, Undo, and legacy migration boundaries.

- [ ] **Step 6: Commit the storage boundary**

```bash
git add lib/db/schema.ts lib/db/kitWishlist.ts lib/db.ts lib/kitWishlist.test.cjs
git commit -m "feat: separate kit purchase candidates from owned kits"
```

---

### Task 2: Save New Candidates Without Creating Owned Kits

**Files:**
- Modify: `components/AddKitModal.tsx`
- Replace: `app/(tabs)/kit-wishlist.tsx`
- Modify: `lib/formSafety.test.cjs`
- Modify: `lib/kitWishlist.test.cjs`

**Interfaces:**
- Consumes: `addKitWishlistItem(draft)` from Task 1.
- Produces: `saveTarget?: 'owned' | 'wishlist'` on `AddKitModal`, defaulting to `'owned'`.
- Produces: a minimal dedicated shopping-list screen that reads and deletes `kit_wishlist` rows and opens candidate-mode `AddKitModal`.
- Removes: `addToWishlist?: boolean`.

- [ ] **Step 1: Add failing source-contract tests**

In `lib/formSafety.test.cjs`, assert that wishlist saves bypass `kits` and candidate mode has no photo UI:

```js
test('kit wishlist form saves an independent candidate and hides owned-kit photos', () => {
  const source = fs.readFileSync(require.resolve('../components/AddKitModal.tsx'), 'utf8');
  assert.match(source, /saveTarget\?: 'owned' \| 'wishlist'/);
  assert.match(source, /saveTarget === 'wishlist'[\s\S]*addKitWishlistItem/);
  assert.match(source, /saveTarget === 'owned'[\s\S]*<KitPhotoGrid/);
  assert.doesNotMatch(source, /addToWishlist|INSERT INTO kit_lists/);
});
```

Add to `lib/kitWishlist.test.cjs`:

```js
test('kit shopping list reads independent candidates instead of owned kits', () => {
  const source = fs.readFileSync(require.resolve('../app/(tabs)/kit-wishlist.tsx'), 'utf8');
  assert.match(source, /FROM kit_wishlist/);
  assert.match(source, /saveTarget="wishlist"/);
  assert.doesNotMatch(source, /KitsScreen|KitStatus|statusNotStarted|statusBuilding|KitDetailModal/);
});
```

- [ ] **Step 2: Run the narrow test and verify failure**

Run: `node --test lib/formSafety.test.cjs lib/kitWishlist.test.cjs`

Expected: FAIL because `AddKitModal` still creates a `kits` row plus `kit_lists`, and the route still wraps `KitsScreen`.

- [ ] **Step 3: Replace the target prop and branch only at persistence**

Change the props and import:

```ts
import { addKitPhoto, addKitWishlistItem, getDB } from '../lib/db';

interface Props {
  visible: boolean;
  defaultBoxId: number | null;
  saveTarget?: 'owned' | 'wishlist';
  onClose: () => void;
}
```

In `save()`, keep shared validation, then branch:

```ts
if (saveTarget === 'wishlist') {
  await addKitWishlistItem({
    name: name.trim(), maker: maker.trim(), series: series.trim() || null,
    category: category.trim() || null, scale: scale.trim() || null,
    price: normalizedPrice, note: note.trim() || null,
  });
} else {
  const result = await getDB().runAsync(
    'INSERT INTO kits (box_id, name, maker, series, category, scale, price, note, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [defaultBoxId, name.trim(), maker.trim(), series.trim() || null, category.trim() || null, scale.trim() || null, normalizedPrice, note.trim() || null, 'not_started']
  );
  for (const uri of photos) await addKitPhoto(result.lastInsertRowId, uri);
}
```

Render `KitPhotoGrid` only for `saveTarget === 'owned'`. Candidate mode must not collect temporary photo URIs, so dirty/discard behavior remains unchanged without a second cleanup path.

- [ ] **Step 4: Replace the route with the minimal independent list**

Replace `app/(tabs)/kit-wishlist.tsx` with a dedicated screen. Its load query must be based only on `kit_wishlist`:

```ts
type KitWishlistSort = 'added' | 'name' | 'maker';

const SORT_SQL: Record<KitWishlistSort, string> = {
  added: 'added_at DESC',
  name: 'name COLLATE NOCASE ASC',
  maker: 'maker COLLATE NOCASE ASC, name COLLATE NOCASE ASC',
};

const sql =
  'SELECT id, name, maker, series, category, scale, price, note, added_at FROM kit_wishlist' +
  (where.length ? ' WHERE ' + where.join(' AND ') : '') +
  ' ORDER BY ' + SORT_SQL[sort];
```

Use existing `KitFilterModal`, `ListToolbar`, `ListActionBar`, `EmptyState`, `AdBanner`, and `Swipeable`. At this task boundary, right swipe deletes with `removeKitWishlistItem` plus Undo through `restoreKitWishlistItem`; left-swipe Box transfer is added in Task 3. Render concise text only:

```tsx
<View style={styles.row}>
  <View style={styles.rowInfo}>
    <Text numberOfLines={1} style={styles.rowName}>{item.name}</Text>
    <Text numberOfLines={1} style={styles.rowSub}>
      {[item.maker, item.series, item.scale].filter(Boolean).join(' · ')}
    </Text>
  </View>
</View>
```

Use the existing fixed overlay Toast without shifting list layout:

```ts
const showToast = (message: string, actionLabel?: string, onAction?: () => void) => {
  setToast(message);
  setToastAction(actionLabel && onAction ? { label: actionLabel, onPress: onAction } : null);
  if (toastTimer.current) clearTimeout(toastTimer.current);
  toastTimer.current = setTimeout(() => {
    setToast('');
    setToastAction(null);
  }, actionLabel ? 3000 : 1800);
};
```

Open the form with:

```tsx
<AddKitModal
  visible={showAdd}
  defaultBoxId={null}
  saveTarget="wishlist"
  onClose={() => { setShowAdd(false); reload(); }}
/>
```

- [ ] **Step 5: Run form, wishlist, and type checks**

Run: `node --test lib/formSafety.test.cjs lib/kitWishlist.test.cjs`

Expected: PASS.

Run: `npm run typecheck`

Expected: PASS because the old wrapper and `addToWishlist` caller no longer exist.

- [ ] **Step 6: Commit candidate creation and independent listing**

```bash
git add -- components/AddKitModal.tsx 'app/(tabs)/kit-wishlist.tsx' lib/formSafety.test.cjs lib/kitWishlist.test.cjs
git commit -m "feat: save kit shopping candidates independently"
```

---

### Task 3: Dedicated Shopping List and Conditional Box Selection

**Files:**
- Modify: `app/(tabs)/kit-wishlist.tsx`
- Modify: `lib/kitWishlist.test.cjs`
- Modify: `translations/ja.json`
- Modify: `translations/en.json`

**Interfaces:**
- Consumes: all Task 1 DB functions and Task 2 `AddKitModal saveTarget="wishlist"`.
- Consumes: existing `KitFilterModal`, `ListActionBar`, `ActionSheet`, `Toast`, `EmptyState`, `AdBanner`, and `Swipeable`.
- Produces: one-Box direct move and multi-Box selection on the independent screen from Task 2.

- [ ] **Step 1: Add failing UI-boundary assertions**

Extend `lib/kitWishlist.test.cjs`:

```js
test('kit shopping list is independent and selects a Box only when needed', () => {
  const source = fs.readFileSync(require.resolve('../app/(tabs)/kit-wishlist.tsx'), 'utf8');
  assert.match(source, /boxes\.length === 1/);
  assert.match(source, /moveKitWishlistItemToBox/);
  assert.match(source, /<ActionSheet/);
  assert.match(source, /<Toast/);
});
```

- [ ] **Step 2: Run the narrow test and verify failure**

Run: `node --test lib/kitWishlist.test.cjs`

Expected: FAIL because the dedicated route does not yet implement Box transfer.

- [ ] **Step 3: Add the Box-choice state without changing candidate queries**

Keep Task 2's candidate query and add only the Box-choice type:

```ts
interface KitBoxChoice { id: number; name: string; }
```

Do not add status, Box, photo, or detail data to the candidate query or row. Continue using `KitFilterModal` without `statusOptions`.

- [ ] **Step 4: Implement one-Box direct move and multi-Box selection**

Use one function for both paths:

```ts
const requestMove = async (item: KitWishlistItem) => {
  if (busyId != null) return;
  const boxes = await getDB().getAllAsync<KitBoxChoice>('SELECT id, name FROM kit_boxes ORDER BY sort_order, id');
  if (boxes.length === 0) {
    Alert.alert(t('error'), t('noKitBoxAvailable'));
    return;
  }
  if (boxes.length === 1) {
    await moveToBox(item, boxes[0].id);
    return;
  }
  setActionSheet({
    title: t('targetBox'),
    buttons: [
      ...boxes.map((box) => ({ text: box.name, onPress: () => moveToBox(item, box.id) })),
      { text: t('cancel'), style: 'cancel' as const },
    ],
  });
};
```

`moveToBox` sets `busyId`, calls `moveKitWishlistItemToBox`, reloads, and shows a Toast with Undo calling `undoKitWishlistMove`. Always clear `busyId` in `finally`; failures show `saveFailed` and retain the candidate because the DB helper is transactional.

```ts
const moveToBox = async (item: KitWishlistItem, boxId: number) => {
  if (busyId != null) return;
  setBusyId(item.id);
  try {
    const moved = await moveKitWishlistItemToBox(item.id, boxId);
    await reload();
    showToast(t('kitMovedToBoxToast'), t('undo'), async () => {
      await undoKitWishlistMove(moved.kitId, moved.item);
      await reload();
    });
  } catch (error) {
    console.error('KitWishlistScreen: failed to move candidate', error);
    Alert.alert(t('error'), t('saveFailed'));
  } finally {
    setBusyId(null);
  }
};
```

- [ ] **Step 5: Implement delete, add, and translated copy**

Use left swipe for `moveToBox` with visible label `t('moveToBox')`, and right swipe for delete with Undo. Give the move action enough width and keep its clickable label on one line:

```tsx
const renderMoveAction = () => (
  <View style={styles.moveAction}>
    <Text numberOfLines={1} style={styles.swipeActionText}>{t('moveToBox')}</Text>
  </View>
);
```

Render:

```tsx
<AddKitModal
  visible={showAdd}
  defaultBoxId={null}
  saveTarget="wishlist"
  onClose={() => { setShowAdd(false); reload(); }}
/>
```

Add exact translation keys:

In `translations/ja.json`:

```json
"moveToBox":"Boxへ移動",
"kitMovedToBoxToast":"キットをBoxへ移動しました",
"emptyKitWishlist":"＋ボタンから購入候補を追加できます",
"noKitBoxAvailable":"移動先のBoxがありません"
```

In `translations/en.json`:

```json
"moveToBox":"Move to Box",
"kitMovedToBoxToast":"Moved kit to Box",
"emptyKitWishlist":"Add a kit you want to buy with the + button",
"noKitBoxAvailable":"There is no Box to move this kit to"
```

- [ ] **Step 6: Run the dedicated tests and typecheck**

Run: `node --test lib/kitWishlist.test.cjs`

Expected: PASS.

Run: `npm run typecheck`

Expected: PASS after Task 3 removes the old wishlist caller; any remaining `wishlistScreen` branch in `kits.tsx` is cleaned in Task 4 but must still typecheck.

- [ ] **Step 7: Commit the dedicated screen**

```bash
git add -- 'app/(tabs)/kit-wishlist.tsx' lib/kitWishlist.test.cjs translations/ja.json translations/en.json
git commit -m "feat: move kit shopping candidates into a selected Box"
```

---

### Task 4: Remove Owned-Kit Coupling and Correct Used-Color Copy

**Files:**
- Modify: `app/(tabs)/kits.tsx`
- Modify: `components/KitDetailModal.tsx`
- Modify: `components/KitBoxOptions.tsx`
- Modify: `lib/db/kits.ts`
- Modify: `app/(tabs)/settings.tsx`
- Modify: `components/NavigationDrawer.tsx`
- Modify: `translations/ja.json`
- Modify: `translations/en.json`
- Modify: `lib/detailUxSafety.test.cjs`
- Modify: `lib/kitWishlist.test.cjs`

**Interfaces:**
- Removes: `KitsScreen({ wishlistScreen })`; keeps `KitsScreen({ completedScreen })`.
- Removes: every `kit_lists` read/write and every owned-kit wishlist toggle.
- Produces: `t('editColorInfo')` only for Kitrack used-color editing.

- [ ] **Step 1: Add failing boundary and copy tests**

Add assertions:

```js
test('owned kit lifecycle never mutates the shopping list', () => {
  for (const path of [
    './db/kits.ts', '../components/KitBoxOptions.tsx', '../components/KitDetailModal.tsx',
    '../app/(tabs)/kits.tsx', '../app/(tabs)/settings.tsx', '../components/NavigationDrawer.tsx',
  ]) {
    const source = fs.readFileSync(require.resolve(path), 'utf8');
    assert.doesNotMatch(source, /kit_lists/);
  }
});
```

In `lib/detailUxSafety.test.cjs`:

```js
test('kit used-color editing uses color-information copy without renaming saved-mix editing', () => {
  const detail = fs.readFileSync(require.resolve('../components/KitDetailModal.tsx'), 'utf8');
  const mixing = fs.readFileSync(require.resolve('../app/(tabs)/mixing.tsx'), 'utf8');
  assert.match(detail, /title=\{t\('editColorInfo'\)\}/);
  assert.doesNotMatch(detail, /title=\{t\('editMix'\)\}/);
  assert.match(mixing, /title=\{t\('editMix'\)\}/);
});
```

- [ ] **Step 2: Run tests and verify failure**

Run: `node --test lib/kitWishlist.test.cjs lib/detailUxSafety.test.cjs`

Expected: FAIL on current legacy reads, writes, and `editMix` title.

- [ ] **Step 3: Simplify the owned-kit screen and detail**

In `kits.tsx`, remove `wishlistScreen`, all wishlist SQL branches, `removeWishlistItem`, and wishlist-specific AddKit behavior. Keep completed and active-kit behavior unchanged.

In `KitDetailModal.tsx`, remove `inWishlist`, the fifth Promise item loading `kit_lists`, `toggleWishlist`, the shopping-cart icon button, and its icon import. Keep the edit icon and all kit detail fields.

Change only the Kitrack color editor title:

```tsx
<ColorMixEditorModal
  visible={editingColor}
  embedded
  requestCloseRef={childRequestCloseRef}
  title={t('editColorInfo')}
  initialDraft={draftFromSummary(selectedColor)}
  onSave={saveColor}
  onClose={() => setEditingColor(false)}
/>
```

- [ ] **Step 4: Decouple delete, reset, and drawer counts**

Delete all `DELETE FROM kit_lists` statements. Change the shopping-list reset and count only:

```ts
await getDB().runAsync('DELETE FROM kit_wishlist');
```

```ts
db.getFirstAsync<TotalRow>('SELECT COUNT(*) AS n FROM kit_wishlist')
```

`resetKits` must leave `kit_wishlist` untouched; `resetKitWishlist` must leave `kits`, `kit_boxes`, photos, and colors untouched.

- [ ] **Step 5: Add precise edit translations**

Add:

In `translations/ja.json`:

```json
"editColorInfo":"色情報を編集"
```

In `translations/en.json`:

```json
"editColorInfo":"Edit color information"
```

Do not change `editMix`.

- [ ] **Step 6: Run targeted tests and typecheck**

Run: `node --test lib/kitWishlist.test.cjs lib/detailUxSafety.test.cjs`

Expected: PASS.

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 7: Commit decoupling and copy**

```bash
git add -- 'app/(tabs)/kits.tsx' components/KitDetailModal.tsx components/KitBoxOptions.tsx lib/db/kits.ts 'app/(tabs)/settings.tsx' components/NavigationDrawer.tsx translations/ja.json translations/en.json lib/detailUxSafety.test.cjs lib/kitWishlist.test.cjs
git commit -m "fix: decouple kit shopping list from owned kit actions"
```

---

### Task 5: Cloud Backup Schema v5

**Files:**
- Modify: `lib/cloudBackup.ts`
- Modify: `lib/cloudBackup.test.cjs`

**Interfaces:**
- Produces: optional `kitWishlist?: BackupKitWishlistItem[]` in `BackupSnapshot`.
- Changes: `BACKUP_SCHEMA_VERSION` from `4` to `5`.
- Consumes: `kit_wishlist` table from Task 1.

- [ ] **Step 1: Write failing v5 snapshot, restore, and emptiness tests**

Add to `lib/cloudBackup.test.cjs`:

```js
function backupReadDb({ kitWishlist = [] } = {}) {
  return {
    async getAllAsync(sql) {
      if (sql.includes('FROM kit_wishlist')) return kitWishlist;
      return [];
    },
    async getFirstAsync() { return null; },
  };
}

function restoreDb(statements) {
  return {
    async withExclusiveTransactionAsync(fn) { await fn(this); },
    async getAllAsync() { return []; },
    async getFirstAsync() { return null; },
    async runAsync(sql, args) {
      statements.push([sql, args]);
      return { lastInsertRowId: statements.length };
    },
  };
}

test('v5 snapshot stores independent kit shopping candidates', async () => {
  const db = backupReadDb({
    kitWishlist: [{ id: 4, name: 'RX-78', maker: 'Bandai', series: 'HG', category: null, scale: '1/144', note: null, price: 2200, added_at: '2026-08-31' }],
  });
  const backup = loadCloudBackup({ db, appOwnership: 'standalone', downloadKitPhotosForRestore: async () => new Map(), deleteKitPhoto: async () => {} });
  const snapshot = await backup.buildBackupSnapshot();
  assert.equal(snapshot.schemaVersion, 5);
  assert.deepEqual(snapshot.kitWishlist, [{ name: 'RX-78', maker: 'Bandai', series: 'HG', category: null, scale: '1/144', note: null, price: 2200, added_at: '2026-08-31' }]);
});

test('v5 restore replaces local kit shopping candidates', async () => {
  const statements = [];
  const db = restoreDb(statements);
  const backup = loadCloudBackup({ db, appOwnership: 'standalone', downloadKitPhotosForRestore: async () => new Map(), deleteKitPhoto: async () => {} });
  await backup.restoreFromSnapshot({ ...emptySnapshot(5), kitWishlist: [{ name: 'RX-78', maker: 'Bandai', series: null, category: null, scale: null, note: null, price: null, added_at: '2026-08-31' }] }, 'user-1');
  assert.ok(statements.some(([sql]) => sql === 'DELETE FROM kit_wishlist'));
  assert.ok(statements.some(([sql]) => sql.startsWith('INSERT INTO kit_wishlist')));
});

test('local-empty detection counts kit shopping candidates', async () => {
  let capturedSql = '';
  const db = {
    async getFirstAsync(sql) {
      capturedSql = sql;
      return { n: 1 };
    },
  };
  const backup = loadCloudBackup({ db, downloadKitPhotosForRestore: async () => new Map(), deleteKitPhoto: async () => {} });
  assert.equal(await backup.isLocalDbEmpty(), false);
  assert.match(capturedSql, /COUNT\(\*\) FROM kit_wishlist/);
});
```

Reuse or extend the test file's existing DB stubs rather than introducing a test framework.
Rename the existing `v4 snapshot stores recipes...` test to `v5 snapshot stores recipes...` and change its schema assertion from `4` to `5`; keep the v3 and v4 restore compatibility tests unchanged.

- [ ] **Step 2: Run the cloud test and verify failure**

Run: `node --test lib/cloudBackup.test.cjs`

Expected: FAIL because the schema is v4 and purchase candidates are not serialized.

- [ ] **Step 3: Extend snapshot types and serialization**

Add:

```ts
interface KitWishlistRow {
  name: string;
  maker: string;
  series: string | null;
  category: string | null;
  scale: string | null;
  note: string | null;
  price: number | null;
  added_at: string | null;
}

export type BackupKitWishlistItem = KitWishlistRow;
```

Set `BACKUP_SCHEMA_VERSION = 5`, add `kitWishlist?: BackupKitWishlistItem[]`, query `kit_wishlist ORDER BY id`, and include the rows in `buildBackupSnapshot()` without local IDs.

Add `(SELECT COUNT(*) FROM kit_wishlist)` to `isLocalDbEmpty()`.

- [ ] **Step 4: Restore candidates safely**

Inside the existing exclusive restore transaction, before rebuilding candidates:

```ts
await tx.runAsync('DELETE FROM kit_wishlist');
for (const item of snapshot.kitWishlist ?? []) {
  await tx.runAsync(
    'INSERT INTO kit_wishlist (name, maker, series, category, scale, note, price, added_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [item.name, item.maker, item.series, item.category, item.scale, item.note, item.price, item.added_at]
  );
}
```

Snapshots v1–v4 supply no field and therefore restore an empty candidate list; no inference from `kits` is allowed.

- [ ] **Step 5: Run cloud and full tests**

Run: `node --test lib/cloudBackup.test.cjs`

Expected: PASS for v1–v5 compatibility, v5 round-trip, restore replacement, and local-empty detection.

Run: `npm run test`

Expected: all repository tests PASS.

- [ ] **Step 6: Commit backup v5**

```bash
git add lib/cloudBackup.ts lib/cloudBackup.test.cjs
git commit -m "feat: back up independent kit shopping candidates"
```

---

### Task 6: Regression Verification and Device-Flow Check

**Files:**
- Modify only if a verification failure identifies a scoped defect.

**Interfaces:**
- Consumes: completed Tasks 1–5.
- Produces: verified Expo Go-compatible implementation with no legacy `kit_lists` runtime references.

- [ ] **Step 1: Run static legacy-reference and translation checks**

Run:

```powershell
rg -n "kit_lists|wishlistScreen" app components lib --glob '!*.test.cjs' --glob '!schema.ts'
rg -n "addToWishlist|inWishlist" components/KitDetailModal.tsx components/AddKitModal.tsx 'app/(tabs)/kits.tsx'
rg -n '"editColorInfo"|"editMix"|"moveToBox"|"emptyKitWishlist"' translations/ja.json translations/en.json components/KitDetailModal.tsx 'app/(tabs)/mixing.tsx' 'app/(tabs)/kit-wishlist.tsx'
```

Expected: the first two commands return no runtime references; the translation command shows both languages and preserves `editMix` in saved-mix flows.

- [ ] **Step 2: Run the complete automated suite**

Run: `npm run test`

Expected: every test passes.

Run: `npm run typecheck`

Expected: exit code 0.

Run: `git diff --check`

Expected: no whitespace errors.

- [ ] **Step 3: Verify the Expo bundle**

With the existing Expo server, request the iOS bundle URL used by the current session; if no server is active, run:

```powershell
npx expo start --go --lan --port 8083
```

Expected: Metro starts under Expo SDK `54.0.36` and the iOS bundle returns HTTP 200 without module-resolution errors.

- [ ] **Step 4: Perform the device-flow checklist**

In Expo Go verify, in order:

1. Add a purchase candidate and confirm it appears only in Kitrack shopping list.
2. With one Box, swipe `Boxへ移動`; confirm no selector, candidate disappears, and an owned `未着手` kit appears.
3. Undo; confirm the exact owned row disappears and the candidate returns.
4. Create a second Box, move again, choose the second Box, and confirm placement.
5. Cancel the multi-Box selector and confirm the candidate remains.
6. Delete an owned kit and a Box; confirm unrelated purchase candidates remain.
7. Open Kitrack used-color editing and confirm `色情報を編集`; open a saved mix and confirm `配合を編集`.
8. Trigger backup/restore in the approved non-production target and confirm candidates round-trip.

- [ ] **Step 5: Stop on any verification failure**

If a check fails, identify which of Tasks 1–5 owns the defect, add a failing regression assertion to that task's test file, and return to its red-green cycle before claiming completion. If every check passes, do not create an empty commit.
