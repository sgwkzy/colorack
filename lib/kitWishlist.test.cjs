const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const ts = require('typescript');

function loadKitWishlist(db, deleteKitPhoto = async () => {}) {
  const source = fs.readFileSync(require.resolve('./db/kitWishlist.ts'), 'utf8');
  const code = ts.transpileModule(source, {
    compilerOptions: { esModuleInterop: true, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(
    (id) => {
      if (id === './connection') return { getDB: () => db };
      if (id === '../kitPhoto') return { deleteKitPhoto };
      throw new Error(`Unexpected require: ${id}`);
    },
    module,
    module.exports
  );
  return module.exports;
}

test('moving a purchase candidate creates one owned kit and removes the candidate atomically', async () => {
  const statements = [];
  let transactionCalls = 0;
  let dbDirectAccess = false;
  const tx = {
    async getFirstAsync(sql) {
      if (sql.includes('FROM kit_boxes')) return { id: 8 };
      return { id: 3, name: 'MG Zaku', maker: 'Bandai', series: 'MG', category: 'Plastic model', scale: '1/100', price: 4500, note: '再販待ち', added_at: '2026-08-31' };
    },
    async runAsync(sql, args) {
      statements.push([sql, args]);
      return { lastInsertRowId: sql.startsWith('INSERT INTO kits') ? 21 : 0 };
    },
  };
  const db = {
    async withExclusiveTransactionAsync(fn) { transactionCalls++; await fn(tx); },
    getFirstAsync() { dbDirectAccess = true; throw new Error('direct DB read'); },
    runAsync() { dbDirectAccess = true; throw new Error('direct DB write'); },
  };
  const api = loadKitWishlist(db);

  const result = await api.moveKitWishlistItemToBox(3, 8);

  assert.equal(result.kitId, 21);
  assert.equal(transactionCalls, 1);
  assert.equal(dbDirectAccess, false);
  assert.match(statements[0][0], /INSERT INTO kits/);
  assert.deepEqual(statements[0][1], [8, 'MG Zaku', 'Bandai', 'MG', 'Plastic model', '1/100', 4500, '再販待ち', 'not_started']);
  assert.deepEqual(statements[1], ['DELETE FROM kit_wishlist WHERE id = ?', [3]]);
});

test('moving to a missing Box leaves the candidate untouched', async () => {
  let writes = 0;
  const api = loadKitWishlist({
    async withExclusiveTransactionAsync(fn) {
      await fn({
        async getFirstAsync(sql) { return sql.includes('FROM kit_boxes') ? null : { id: 3 }; },
        async runAsync() { writes++; return { lastInsertRowId: 0 }; },
      });
    },
  });
  await assert.rejects(() => api.moveKitWishlistItemToBox(3, 99), /Box not found/);
  assert.equal(writes, 0);
});

test('undo removes only the created owned row and restores the original candidate', async () => {
  const statements = [];
  const reads = [];
  let committed = false;
  const deletedPhotos = [];
  const db = {
    async withExclusiveTransactionAsync(fn) {
      await fn({
        async getAllAsync(sql, args) {
          reads.push([sql, args]);
          return [{ uri: 'file:///kit-photos/21-front.jpg' }];
        },
        async runAsync(sql, args) { statements.push([sql, args]); return { lastInsertRowId: 31 }; },
      });
      committed = true;
    },
  };
  const api = loadKitWishlist(db, async (uri) => {
    assert.equal(committed, true);
    deletedPhotos.push(uri);
    throw new Error('file cleanup failed');
  });
  const item = { id: 3, name: 'MG Zaku', maker: 'Bandai', series: null, category: null, scale: null, price: null, note: null, added_at: '2026-08-31' };

  const errors = [];
  const originalError = console.error;
  console.error = (...args) => errors.push(args);
  try {
    await api.undoKitWishlistMove(21, item);
  } finally {
    console.error = originalError;
  }

  assert.deepEqual(reads, [['SELECT uri FROM kit_photos WHERE kit_id = ?', [21]]]);
  assert.deepEqual(statements.slice(0, 4), [
    ['DELETE FROM kit_color_paints WHERE kit_color_id IN (SELECT id FROM kit_colors WHERE kit_id = ?)', [21]],
    ['DELETE FROM kit_colors WHERE kit_id = ?', [21]],
    ['DELETE FROM kit_photos WHERE kit_id = ?', [21]],
    ['DELETE FROM kits WHERE id = ?', [21]],
  ]);
  assert.match(statements[4][0], /INSERT INTO kit_wishlist/);
  assert.equal(statements[4][1].at(-1), '2026-08-31');
  assert.deepEqual(deletedPhotos, ['file:///kit-photos/21-front.jpg']);
  assert.equal(errors.length, 1);
});

test('removing and restoring a purchase candidate use exclusive transactions', async () => {
  const statements = [];
  let transactionCalls = 0;
  const item = { id: 3, name: 'MG Zaku', maker: 'Bandai', series: null, category: null, scale: null, price: null, note: null, added_at: '2026-08-31' };
  const db = {
    async withExclusiveTransactionAsync(fn) {
      transactionCalls++;
      await fn({
        async getFirstAsync() { return item; },
        async runAsync(sql, args) { statements.push([sql, args]); return { lastInsertRowId: 31 }; },
      });
    },
  };
  const api = loadKitWishlist(db);

  assert.deepEqual(await api.removeKitWishlistItem(3), item);
  assert.equal(await api.restoreKitWishlistItem(item), 31);
  assert.equal(transactionCalls, 2);
  assert.deepEqual(statements, [
    ['DELETE FROM kit_wishlist WHERE id = ?', [3]],
    ['INSERT INTO kit_wishlist (name, maker, series, category, scale, price, note, added_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', ['MG Zaku', 'Bandai', null, null, null, null, null, '2026-08-31']],
  ]);
});

test('legacy schema migrates linked kit data without deleting owned kits', () => {
  const schema = fs.readFileSync(require.resolve('./db/schema.ts'), 'utf8');
  assert.match(schema, /CREATE TABLE IF NOT EXISTS kit_wishlist/);
  assert.match(schema, /INSERT INTO kit_wishlist[\s\S]*FROM kit_lists[\s\S]*JOIN kits/);
  assert.match(schema, /DROP TABLE kit_lists/);
  assert.doesNotMatch(schema, /DELETE FROM kits[\s\S]*kit_lists/);
});

test('legacy kit wishlist migration runs after the kits columns are added', () => {
  const schema = fs.readFileSync(require.resolve('./db/schema.ts'), 'utf8');
  const legacyMigration = schema.indexOf('const hasLegacyKitLists');

  assert.notEqual(legacyMigration, -1);
  for (const column of ['series', 'category', 'price']) {
    const alter = schema.indexOf(`ALTER TABLE kits ADD COLUMN ${column}`);
    assert.ok(alter !== -1 && alter < legacyMigration, `${column} must be added before the legacy migration`);
  }
});

test('owned kit lifecycle never mutates the shopping list', () => {
  for (const path of [
    './db/kits.ts', '../components/KitBoxOptions.tsx', '../components/KitDetailModal.tsx',
    '../app/(tabs)/kits.tsx', '../app/(tabs)/settings.tsx', '../components/NavigationDrawer.tsx',
  ]) {
    const source = fs.readFileSync(require.resolve(path), 'utf8');
    assert.doesNotMatch(source, /kit_lists/);
  }
});

test('kit shopping list reads independent candidates instead of owned kits', () => {
  const source = fs.readFileSync(require.resolve('../app/(tabs)/kit-wishlist.tsx'), 'utf8');
  assert.match(source, /FROM kit_wishlist/);
  assert.match(source, /saveTarget="wishlist"/);
  assert.doesNotMatch(source, /KitsScreen|KitStatus|statusNotStarted|statusBuilding|KitDetailModal/);
});

test('kit shopping list is independent and selects a Box only when needed', () => {
  const source = fs.readFileSync(require.resolve('../app/(tabs)/kit-wishlist.tsx'), 'utf8');
  assert.match(source, /boxes\.length === 1/);
  assert.match(source, /moveKitWishlistItemToBox/);
  assert.match(source, /<ActionSheet/);
  assert.match(source, /<Toast/);
});

test('kit wishlist maps physical swipe directions to the correct actions', () => {
  const source = fs.readFileSync(require.resolve('../app/(tabs)/kit-wishlist.tsx'), 'utf8');
  const leftActions = source.match(/renderLeftActions=\{\(\) =>([\s\S]*?)\n\s+renderRightActions/)?.[1] ?? '';
  const rightActions = source.match(/renderRightActions=\{\(\) =>([\s\S]*?)\n\s+onSwipeableOpen/)?.[1] ?? '';

  assert.match(leftActions, /t\('delete'\)/);
  assert.match(rightActions, /t\('moveToBox'\)/);
  assert.match(source, /onSwipeableOpen=\{\(direction\) => \{ if \(direction === 'right'\) void requestMove\(item\); if \(direction === 'left'\) void deleteItem\(item\); \}\}/);
});

test('kit wishlist catches list load failures and exposes an inline retry state', () => {
  const source = fs.readFileSync(require.resolve('../app/(tabs)/kit-wishlist.tsx'), 'utf8');
  const loadFlow = source.slice(source.indexOf('const load = useCallback'), source.indexOf('\n  useFocusEffect'));

  assert.match(loadFlow, /try \{[\s\S]*?Promise\.all/);
  assert.match(loadFlow, /catch \(error\)[\s\S]*?setLoadState\('error'\)/);
  assert.match(source, /<Text accessibilityRole="alert"[^>]*>\{t\('loadFailed'\)\}<\/Text>/);
  assert.match(source, /onPress=\{\(\) => void reload\(\)\}/);
  assert.match(source, /\{loadState === 'error' \? null : \(/);
});

test('busy wishlist rows disable and synchronously ignore accessibility actions', () => {
  const source = fs.readFileSync(require.resolve('../app/(tabs)/kit-wishlist.tsx'), 'utf8');

  assert.match(source, /accessibilityState=\{\{ busy: busyId === item\.id, disabled: busyId === item\.id \}\}/);
  assert.match(source, /onAccessibilityAction=\{\(\{ nativeEvent \}\) => \{ if \(busyIdRef\.current != null\) return;[\s\S]*?deleteItem\(item\)[\s\S]*?requestMove\(item\)/);
});

test('kit wishlist move uses a strict busy guard and clears the single-Box reservation first', () => {
  const source = fs.readFileSync(require.resolve('../app/(tabs)/kit-wishlist.tsx'), 'utf8');
  assert.match(source, /const moveToBox = async[\s\S]*?if \(busyIdRef\.current != null\) return;/);
  const singleBox = source.match(/if \(boxes\.length === 1\) \{([\s\S]*?)\n    \}/)?.[1] ?? '';
  assert.match(singleBox, /clearBusy\(item\.id\)/);
  assert.match(singleBox, /await moveToBox\(item, boxes\[0\]\.id\)/);
  assert.ok(singleBox.indexOf('clearBusy(item.id)') < singleBox.indexOf('await moveToBox(item, boxes[0].id)'));
});

test('kit wishlist delete uses the global strict busy guard and always clears it', () => {
  const source = fs.readFileSync(require.resolve('../app/(tabs)/kit-wishlist.tsx'), 'utf8');
  const deleteItem = source.match(/const deleteItem = async[\s\S]*?\n  \};\n\n  const openSort/)?.[0] ?? '';
  assert.match(deleteItem, /const deleteItem = async[\s\S]*?\{\n    if \(busyIdRef\.current != null\) return;\n    busyIdRef\.current = item\.id;\n    setBusyId\(item\.id\);/);
  assert.match(deleteItem, /try \{[\s\S]*?removeKitWishlistItem\(item\.id\)[\s\S]*?if \(!removed\) return;[\s\S]*?finally \{[\s\S]*?clearBusy\(item\.id\)/);
});

test('kit shopping list supports accessible delete and guards delete and undo failures', () => {
  const source = fs.readFileSync(require.resolve('../app/(tabs)/kit-wishlist.tsx'), 'utf8');
  assert.match(source, /import \{ Alert,[^}]*\} from 'react-native'/);
  assert.match(source, /accessibilityActions=\{\[\{ name: 'delete', label: t\('delete'\) \}, \{ name: 'move', label: t\('moveToBox'\) \}\]\}/);
  assert.match(source, /onAccessibilityAction=\{\(\{ nativeEvent \}\) => \{[\s\S]*?actionName === 'delete'[\s\S]*?deleteItem\(item\)[\s\S]*?actionName === 'move'[\s\S]*?requestMove\(item\)/);
  assert.match(source, /renderLeftActions=\{\(\) =>[\s\S]*?t\('moveToBox'\)/);
  assert.match(source, /busyIdRef/);
  assert.match(source, /try \{[\s\S]*?removeKitWishlistItem\(item\.id\)[\s\S]*?catch \(error\)[\s\S]*?t\('saveFailed'\)/);
  assert.match(source, /showToast\([\s\S]*?t\('undo'\)[\s\S]*?try \{[\s\S]*?restoreKitWishlistItem\(removed\)[\s\S]*?catch \(error\)[\s\S]*?t\('saveFailed'\)/);
  assert.match(source, /showToast\([\s\S]*?t\('undo'\)[\s\S]*?\}\);[\s\S]*?try \{[\s\S]*?await reload\(\)[\s\S]*?catch \(error\)[\s\S]*?t\('loadFailed'\)/);
});

test('toast action uses a synchronous one-shot guard for each message and action', () => {
  const source = fs.readFileSync(require.resolve('../components/Toast.tsx'), 'utf8');
  assert.match(source, /const actionConsumedRef = useRef\(false\);/);
  assert.match(source, /useEffect\(\(\) => \{[\s\S]*?actionConsumedRef\.current = false[\s\S]*?\}, \[message, onAction\]\)/);
  assert.match(source, /const handleAction = \(\) => \{[\s\S]*?if \(actionConsumedRef\.current\) return;[\s\S]*?actionConsumedRef\.current = true;[\s\S]*?onAction\(\);/);
  assert.match(source, /<TouchableOpacity onPress=\{handleAction\}/);
});

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
