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

function loadKitWishlistScreen() {
  const source = fs.readFileSync(require.resolve('../app/(tabs)/kit-wishlist.tsx'), 'utf8');
  const code = ts.transpileModule(source, {
    compilerOptions: { esModuleInterop: true, jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', `${code}\nmodule.exports.kitWishlistActionForOpenedSide = kitWishlistActionForOpenedSide;`)(() => ({}), module, module.exports);
  return module.exports;
}

const snapshot = {
  item: { id: 3, name: 'MG Zaku', maker: 'Bandai', series: null, category: null, scale: null, price: null, note: null, added_at: '2026-08-31' },
  photos: [{ id: 9, uri: 'file:///kit-photos/front.jpg', sort_order: 0, synced_at: 'now', storage_path: 'users/u/kit-photos/front.jpg' }],
  colors: [
    { id: 12, name: 'Armor Blue', note: null, sort_order: 0, added_at: '2026-08-31T10:00:00Z', paints: [
      { paint_id: 4, ratio: 1, sort_order: 0 },
    ] },
    { id: 13, name: 'Shadow Mix', note: 'panel shade', sort_order: 2, added_at: '2026-08-31T10:01:00Z', paints: [
      { paint_id: 8, ratio: 0.25, sort_order: 0 },
      { paint_id: 9, ratio: 0.75, sort_order: 1 },
    ] },
  ],
};

const candidateColorRows = [
  { id: 12, name: 'Armor Blue', note: null, sort_order: 0, added_at: '2026-08-31T10:00:00Z' },
  { id: 13, name: 'Shadow Mix', note: 'panel shade', sort_order: 2, added_at: '2026-08-31T10:01:00Z' },
];

const candidateColorPaintRows = [
  { wishlist_color_id: 12, paint_id: 4, ratio: 1, sort_order: 0 },
  { wishlist_color_id: 13, paint_id: 8, ratio: 0.25, sort_order: 0 },
  { wishlist_color_id: 13, paint_id: 9, ratio: 0.75, sort_order: 1 },
];

function makeTransactionalFailureDb(initialState, failWhen) {
  let state = structuredClone(initialState);
  let committed = 0;
  let nextOwnedColorId = 61;
  let nextWishlistColorId = 71;

  const db = {
    get state() { return state; },
    get committed() { return committed; },
    async withExclusiveTransactionAsync(fn) {
      const working = structuredClone(state);
      const tx = {
        async getFirstAsync(sql) {
          return sql.includes('FROM kit_boxes') ? { id: 8 } : snapshot.item;
        },
        async getAllAsync(sql) {
          if (sql.includes('kit_wishlist_photos')) return snapshot.photos;
          if (sql.includes('kit_wishlist_color_paints')) return candidateColorPaintRows;
          if (sql.includes('kit_wishlist_colors')) return candidateColorRows;
          return [];
        },
        async runAsync(sql, args) {
          if (failWhen(sql, args)) throw new Error('color insert failed');
          if (sql.startsWith('INSERT INTO kits')) {
            working.owned.kits += 1;
            return { lastInsertRowId: 21 };
          }
          if (sql.startsWith('INSERT INTO kit_photos')) working.owned.photos += 1;
          if (sql.startsWith('INSERT INTO kit_colors')) {
            working.owned.colors += 1;
            return { lastInsertRowId: nextOwnedColorId++ };
          }
          if (sql.startsWith('INSERT INTO kit_color_paints')) working.owned.paints += 1;
          if (sql.startsWith('DELETE FROM kit_color_paints')) working.owned.paints = 0;
          if (sql.startsWith('DELETE FROM kit_colors')) working.owned.colors = 0;
          if (sql.startsWith('DELETE FROM kit_photos')) working.owned.photos = 0;
          if (sql.startsWith('DELETE FROM kits')) working.owned.kits = 0;
          if (sql.startsWith('INSERT INTO kit_wishlist_color_paints')) working.candidate.paints += 1;
          if (sql.startsWith('INSERT INTO kit_wishlist_colors')) {
            working.candidate.colors += 1;
            return { lastInsertRowId: nextWishlistColorId++ };
          }
          if (sql.startsWith('INSERT INTO kit_wishlist_photos')) working.candidate.photos += 1;
          if (sql.startsWith('INSERT INTO kit_wishlist (')) {
            working.candidate.item = true;
            return { lastInsertRowId: 31 };
          }
          if (sql.startsWith('DELETE FROM kit_wishlist_color_paints')) working.candidate.paints = 0;
          if (sql.startsWith('DELETE FROM kit_wishlist_colors')) working.candidate.colors = 0;
          if (sql.startsWith('DELETE FROM kit_wishlist_photos')) working.candidate.photos = 0;
          if (sql.startsWith('DELETE FROM kit_wishlist WHERE')) working.candidate.item = false;
          return { lastInsertRowId: 0 };
        },
      };
      await fn(tx).then(() => {
        state = working;
        committed += 1;
      });
    },
  };
  return db;
}

test('moving a purchase candidate creates one owned kit and removes the candidate atomically', async () => {
  const statements = [];
  let transactionCalls = 0;
  let dbDirectAccess = false;
  const tx = {
    async getFirstAsync(sql) {
      if (sql.includes('FROM kit_boxes')) return { id: 8 };
      return snapshot.item;
    },
    async getAllAsync(sql, args) {
      assert.deepEqual(args, [3]);
      if (sql.includes('kit_wishlist_photos')) return snapshot.photos;
      if (sql.includes('kit_wishlist_color_paints')) return candidateColorPaintRows;
      return candidateColorRows;
    },
    async runAsync(sql, args) {
      statements.push([sql, args]);
      if (sql.startsWith('INSERT INTO kits')) return { lastInsertRowId: 21 };
      if (sql.startsWith('INSERT INTO kit_colors')) return { lastInsertRowId: 61 + statements.filter(([statement]) => statement.startsWith('INSERT INTO kit_colors')).length - 1 };
      return { lastInsertRowId: 0 };
    },
  };
  const db = {
    async withExclusiveTransactionAsync(fn) { transactionCalls++; await fn(tx); },
    getFirstAsync() { dbDirectAccess = true; throw new Error('direct DB read'); },
    runAsync() { dbDirectAccess = true; throw new Error('direct DB write'); },
  };
  const api = loadKitWishlist(db);

  const result = await api.moveKitWishlistItemToBox(3, 8);

  assert.deepEqual(result, { kitId: 21, snapshot });
  assert.equal(transactionCalls, 1);
  assert.equal(dbDirectAccess, false);
  assert.match(statements[0][0], /INSERT INTO kits/);
  assert.deepEqual(statements[0][1], [8, 'MG Zaku', 'Bandai', null, null, null, null, null, 'not_started']);
  assert.ok(statements.some(([sql]) => sql.startsWith('INSERT INTO kit_photos')));
  const photoInsert = statements.find(([sql]) => sql.startsWith('INSERT INTO kit_photos'));
  assert.deepEqual(photoInsert[1], [21, 'file:///kit-photos/front.jpg', 0, 'now', 'users/u/kit-photos/front.jpg']);
  assert.deepEqual(statements.filter(([sql]) => sql.startsWith('INSERT INTO kit_colors')), [
    ['INSERT INTO kit_colors (kit_id, name, note, sort_order, added_at) VALUES (?, ?, ?, ?, ?)', [21, 'Armor Blue', null, 0, '2026-08-31T10:00:00Z']],
    ['INSERT INTO kit_colors (kit_id, name, note, sort_order, added_at) VALUES (?, ?, ?, ?, ?)', [21, 'Shadow Mix', 'panel shade', 2, '2026-08-31T10:01:00Z']],
  ]);
  assert.deepEqual(statements.filter(([sql]) => sql.startsWith('INSERT INTO kit_color_paints')), [
    ['INSERT INTO kit_color_paints (kit_color_id, paint_id, ratio, sort_order) VALUES (?, ?, ?, ?)', [61, 4, 1, 0]],
    ['INSERT INTO kit_color_paints (kit_color_id, paint_id, ratio, sort_order) VALUES (?, ?, ?, ?)', [62, 8, 0.25, 0]],
    ['INSERT INTO kit_color_paints (kit_color_id, paint_id, ratio, sort_order) VALUES (?, ?, ?, ?)', [62, 9, 0.75, 1]],
  ]);
  assert.ok(statements.some(([sql]) => sql === 'DELETE FROM kit_wishlist_photos WHERE wishlist_id = ?'));
  assert.deepEqual(statements.at(-1), ['DELETE FROM kit_wishlist WHERE id = ?', [3]]);
  assert.deepEqual(statements.slice(-4), [
    ['DELETE FROM kit_wishlist_color_paints WHERE wishlist_color_id IN (SELECT id FROM kit_wishlist_colors WHERE wishlist_id = ?)', [3]],
    ['DELETE FROM kit_wishlist_colors WHERE wishlist_id = ?', [3]],
    ['DELETE FROM kit_wishlist_photos WHERE wishlist_id = ?', [3]],
    ['DELETE FROM kit_wishlist WHERE id = ?', [3]],
  ]);
  assert.ok(statements.findIndex(([sql]) => sql.startsWith('INSERT INTO kit_photos')) < statements.findIndex(([sql]) => sql === 'DELETE FROM kit_wishlist_photos WHERE wishlist_id = ?'));
  assert.deepEqual(result.snapshot.photos[0].uri, 'file:///kit-photos/front.jpg');
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

test('undo removes the created owned row and restores candidate photos without deleting files', async () => {
  const statements = [];
  const reads = [];
  let committed = false;
  let nextColorId = 71;
  const deletedPhotos = [];
  const db = {
    async withExclusiveTransactionAsync(fn) {
      await fn({
        async getAllAsync(sql, args) {
          reads.push([sql, args]);
          return [];
        },
        async runAsync(sql, args) {
          statements.push([sql, args]);
          if (sql.startsWith('INSERT INTO kit_wishlist (')) return { lastInsertRowId: 31 };
          if (sql.startsWith('INSERT INTO kit_wishlist_colors')) return { lastInsertRowId: nextColorId++ };
          return { lastInsertRowId: 0 };
        },
      });
      committed = true;
    },
  };
  const api = loadKitWishlist(db, async (uri) => deletedPhotos.push(uri));

  await api.undoKitWishlistMove(21, snapshot);

  assert.deepEqual(reads, []);
  assert.deepEqual(statements.slice(0, 4), [
    ['DELETE FROM kit_color_paints WHERE kit_color_id IN (SELECT id FROM kit_colors WHERE kit_id = ?)', [21]],
    ['DELETE FROM kit_colors WHERE kit_id = ?', [21]],
    ['DELETE FROM kit_photos WHERE kit_id = ?', [21]],
    ['DELETE FROM kits WHERE id = ?', [21]],
  ]);
  assert.deepEqual(statements[4], ['INSERT INTO kit_wishlist (name, maker, series, category, scale, price, note, added_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', ['MG Zaku', 'Bandai', null, null, null, null, null, '2026-08-31']]);
  assert.deepEqual(statements[5], ['INSERT INTO kit_wishlist_photos (wishlist_id, uri, sort_order, synced_at, storage_path) VALUES (?, ?, ?, ?, ?)', [31, 'file:///kit-photos/front.jpg', 0, 'now', 'users/u/kit-photos/front.jpg']]);
  assert.deepEqual(statements.filter(([sql]) => sql.startsWith('INSERT INTO kit_wishlist_colors')), [
    ['INSERT INTO kit_wishlist_colors (wishlist_id, name, note, sort_order, added_at) VALUES (?, ?, ?, ?, ?)', [31, 'Armor Blue', null, 0, '2026-08-31T10:00:00Z']],
    ['INSERT INTO kit_wishlist_colors (wishlist_id, name, note, sort_order, added_at) VALUES (?, ?, ?, ?, ?)', [31, 'Shadow Mix', 'panel shade', 2, '2026-08-31T10:01:00Z']],
  ]);
  assert.deepEqual(statements.filter(([sql]) => sql.startsWith('INSERT INTO kit_wishlist_color_paints')), [
    ['INSERT INTO kit_wishlist_color_paints (wishlist_color_id, paint_id, ratio, sort_order) VALUES (?, ?, ?, ?)', [71, 4, 1, 0]],
    ['INSERT INTO kit_wishlist_color_paints (wishlist_color_id, paint_id, ratio, sort_order) VALUES (?, ?, ?, ?)', [72, 8, 0.25, 0]],
    ['INSERT INTO kit_wishlist_color_paints (wishlist_color_id, paint_id, ratio, sort_order) VALUES (?, ?, ?, ?)', [72, 9, 0.75, 1]],
  ]);
  assert.equal(deletedPhotos.length, 0);
  assert.equal(committed, true);
});

test('deleting and restoring a purchase candidate preserve its photo snapshot in exclusive transactions', async () => {
  const statements = [];
  let transactionCalls = 0;
  let nextColorId = 81;
  const db = {
    async withExclusiveTransactionAsync(fn) {
      transactionCalls++;
      await fn({
        async getFirstAsync() { return snapshot.item; },
        async getAllAsync(sql, args) {
          assert.deepEqual(args, [3]);
          if (sql.includes('kit_wishlist_photos')) return snapshot.photos;
          if (sql.includes('kit_wishlist_color_paints')) return candidateColorPaintRows;
          return candidateColorRows;
        },
        async runAsync(sql, args) {
          statements.push([sql, args]);
          if (sql.startsWith('INSERT INTO kit_wishlist (')) return { lastInsertRowId: 31 };
          if (sql.startsWith('INSERT INTO kit_wishlist_colors')) return { lastInsertRowId: nextColorId++ };
          return { lastInsertRowId: 0 };
        },
      });
    },
  };
  const api = loadKitWishlist(db);

  assert.deepEqual(await api.removeKitWishlistItem(3), snapshot);
  assert.equal(await api.restoreKitWishlistItem(snapshot), 31);
  assert.equal(transactionCalls, 2);
  assert.deepEqual(statements.slice(0, 4), [
    ['DELETE FROM kit_wishlist_color_paints WHERE wishlist_color_id IN (SELECT id FROM kit_wishlist_colors WHERE wishlist_id = ?)', [3]],
    ['DELETE FROM kit_wishlist_colors WHERE wishlist_id = ?', [3]],
    ['DELETE FROM kit_wishlist_photos WHERE wishlist_id = ?', [3]],
    ['DELETE FROM kit_wishlist WHERE id = ?', [3]],
  ]);
  assert.deepEqual(statements[4], ['INSERT INTO kit_wishlist (name, maker, series, category, scale, price, note, added_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', ['MG Zaku', 'Bandai', null, null, null, null, null, '2026-08-31']]);
  assert.deepEqual(statements[5], ['INSERT INTO kit_wishlist_photos (wishlist_id, uri, sort_order, synced_at, storage_path) VALUES (?, ?, ?, ?, ?)', [31, 'file:///kit-photos/front.jpg', 0, 'now', 'users/u/kit-photos/front.jpg']]);
  assert.deepEqual(statements.filter(([sql]) => sql.startsWith('INSERT INTO kit_wishlist_colors')), [
    ['INSERT INTO kit_wishlist_colors (wishlist_id, name, note, sort_order, added_at) VALUES (?, ?, ?, ?, ?)', [31, 'Armor Blue', null, 0, '2026-08-31T10:00:00Z']],
    ['INSERT INTO kit_wishlist_colors (wishlist_id, name, note, sort_order, added_at) VALUES (?, ?, ?, ?, ?)', [31, 'Shadow Mix', 'panel shade', 2, '2026-08-31T10:01:00Z']],
  ]);
  assert.deepEqual(statements.filter(([sql]) => sql.startsWith('INSERT INTO kit_wishlist_color_paints')), [
    ['INSERT INTO kit_wishlist_color_paints (wishlist_color_id, paint_id, ratio, sort_order) VALUES (?, ?, ?, ?)', [81, 4, 1, 0]],
    ['INSERT INTO kit_wishlist_color_paints (wishlist_color_id, paint_id, ratio, sort_order) VALUES (?, ?, ?, ?)', [82, 8, 0.25, 0]],
    ['INSERT INTO kit_wishlist_color_paints (wishlist_color_id, paint_id, ratio, sort_order) VALUES (?, ?, ?, ?)', [82, 9, 0.75, 1]],
  ]);
});

test('moving a purchase candidate rolls back owned and candidate rows when a color paint insert fails', async () => {
  const db = makeTransactionalFailureDb({
    candidate: { item: true, photos: 1, colors: 2, paints: 3 },
    owned: { kits: 0, photos: 0, colors: 0, paints: 0 },
  }, (sql) => sql.startsWith('INSERT INTO kit_color_paints'));
  const before = structuredClone(db.state);

  await assert.rejects(() => loadKitWishlist(db).moveKitWishlistItemToBox(3, 8), /color insert failed/);

  assert.deepEqual(db.state, before);
  assert.equal(db.committed, 0);
});

test('restoring a deleted purchase candidate rolls back candidate rows when a color paint insert fails', async () => {
  const db = makeTransactionalFailureDb({
    candidate: { item: false, photos: 0, colors: 0, paints: 0 },
    owned: { kits: 0, photos: 0, colors: 0, paints: 0 },
  }, (sql) => sql.startsWith('INSERT INTO kit_wishlist_color_paints'));
  const before = structuredClone(db.state);

  await assert.rejects(() => loadKitWishlist(db).restoreKitWishlistItem(snapshot), /color insert failed/);

  assert.deepEqual(db.state, before);
  assert.equal(db.committed, 0);
});

test('undoing a move rolls back owned deletion and candidate restoration when a color paint insert fails', async () => {
  const db = makeTransactionalFailureDb({
    candidate: { item: false, photos: 0, colors: 0, paints: 0 },
    owned: { kits: 1, photos: 1, colors: 2, paints: 3 },
  }, (sql) => sql.startsWith('INSERT INTO kit_wishlist_color_paints'));
  const before = structuredClone(db.state);

  await assert.rejects(() => loadKitWishlist(db).undoKitWishlistMove(21, snapshot), /color insert failed/);

  assert.deepEqual(db.state, before);
  assert.equal(db.committed, 0);
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

test('purchase-candidate reset removes rows before cleaning every photo file', () => {
  const source = fs.readFileSync(require.resolve('../app/(tabs)/settings.tsx'), 'utf8');
  const start = source.indexOf('const resetKitWishlist =');
  const end = source.indexOf('  // クラウド復元', start);
  assert.ok(start >= 0 && end >= 0);
  const reset = source.slice(start, end);

  assert.match(reset, /const photos = await db\.getAllAsync<\{ uri: string \}>\('SELECT uri FROM kit_wishlist_photos'\);/);
  assert.match(reset, /await db\.withTransactionAsync\(async \(\) => \{/);
  const deleteCandidatePaints = reset.indexOf("await db.runAsync('DELETE FROM kit_wishlist_color_paints')");
  const deleteCandidateColors = reset.indexOf("await db.runAsync('DELETE FROM kit_wishlist_colors')");
  const deletePhotos = reset.indexOf("await db.runAsync('DELETE FROM kit_wishlist_photos')");
  const deleteCandidates = reset.indexOf("await db.runAsync('DELETE FROM kit_wishlist')");
  const cleanup = reset.indexOf('await deleteKitPhoto(uri)');
  assert.ok(deleteCandidatePaints >= 0 && deleteCandidatePaints < deleteCandidateColors);
  assert.ok(deleteCandidateColors < deletePhotos && deletePhotos < deleteCandidates);
  assert.ok(deleteCandidates < cleanup);
  assert.match(reset, /for \(const \{ uri \} of photos\) \{[\s\S]*?try \{[\s\S]*?await deleteKitPhoto\(uri\);[\s\S]*?\} catch \(error\) \{/);
});

test('owned-kit reset does not touch candidate color tables', () => {
  const source = fs.readFileSync(require.resolve('../app/(tabs)/settings.tsx'), 'utf8');
  const start = source.indexOf('const resetKits =');
  const end = source.indexOf('  const resetFavorites =', start);
  assert.ok(start >= 0 && end >= 0);

  assert.doesNotMatch(source.slice(start, end), /kit_wishlist_color/);
});

test('kit shopping list reads independent candidates instead of owned kits', () => {
  const source = fs.readFileSync(require.resolve('../app/(tabs)/kit-wishlist.tsx'), 'utf8');
  assert.match(source, /FROM kit_wishlist/);
  assert.match(source, /saveTarget="wishlist"/);
  assert.doesNotMatch(source, /KitsScreen|KitStatus|statusNotStarted|statusBuilding|KitDetailModal/);
});

test('kit shopping list shows candidate thumbnails and opens saved candidates in detail', () => {
  const source = fs.readFileSync(require.resolve('../app/(tabs)/kit-wishlist.tsx'), 'utf8');
  const editor = fs.readFileSync(require.resolve('../components/AddKitModal.tsx'), 'utf8');
  assert.match(source, /FROM kit_wishlist_photos/);
  assert.match(source, /AS thumb_uri/);
  assert.match(source, /const \[detailId, setDetailId\]/);
  assert.match(source, /setDetailId\(item\.id\)/);
  assert.match(source, /<KitWishlistDetailModal[\s\S]*?wishlistId=\{detailId\}/);
  assert.match(source, /<AddKitModal[\s\S]*?visible=\{showAdd\}/);
  assert.doesNotMatch(source, /setEditItem|editWishlistItem=|onEditAction=/);
  assert.doesNotMatch(editor, /editWishlistItem|onEditAction|editingWishlist/);
});

test('kit shopping list is independent and selects a Box only when needed', () => {
  const source = fs.readFileSync(require.resolve('../app/(tabs)/kit-wishlist.tsx'), 'utf8');
  assert.match(source, /boxes\.length === 1/);
  assert.match(source, /moveKitWishlistItemToBox/);
  assert.match(source, /<ActionSheet/);
  assert.match(source, /<Toast/);
});

test('kit wishlist matches other lists: left swipe deletes and right swipe moves to Box', () => {
  const api = loadKitWishlistScreen();
  const source = fs.readFileSync(require.resolve('../app/(tabs)/kit-wishlist.tsx'), 'utf8');
  const leftActions = source.match(/renderLeftActions=\{\(\) =>([\s\S]*?)\n\s+renderRightActions/)?.[1] ?? '';
  const rightActions = source.match(/renderRightActions=\{\(\) =>([\s\S]*?)\n\s+onSwipeableOpen/)?.[1] ?? '';

  assert.equal(api.kitWishlistActionForOpenedSide('right'), 'delete');
  assert.equal(api.kitWishlistActionForOpenedSide('left'), 'move');
  assert.match(leftActions, /t\('moveToBox'\)/);
  assert.match(rightActions, /t\('delete'\)/);
  assert.match(source, /onSwipeableOpen=\{\(direction\) => \{ const action = kitWishlistActionForOpenedSide\(direction\); if \(action === 'delete'\) void deleteItem\(item\); else void requestMove\(item\); \}\}/);
});

test('purchase candidate detail routes Box move and delete to the existing list actions', () => {
  const screen = fs.readFileSync(require.resolve('../app/(tabs)/kit-wishlist.tsx'), 'utf8');

  assert.match(screen, /onMove=\{\(item\) => \{[\s\S]*?setDetailId\(null\)[\s\S]*?requestMove\(item\)/);
  assert.match(screen, /onDelete=\{\(item\) => \{[\s\S]*?setDetailId\(null\)[\s\S]*?deleteItem\(item\)/);
});

test('all Kitrack swipe rows paint an opaque surface', () => {
  const kits = fs.readFileSync(require.resolve('../app/(tabs)/kits.tsx'), 'utf8');
  const wishlist = fs.readFileSync(require.resolve('../app/(tabs)/kit-wishlist.tsx'), 'utf8');
  assert.match(kits, /row: \{[^}]*backgroundColor: colors\.surface/);
  assert.match(wishlist, /row: \{[^}]*backgroundColor: colors\.surface/);
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

  assert.match(source, /disabled=\{busyId != null\}/);
  assert.match(source, /onPress=\{\(\) => \{ if \(busyIdRef\.current == null\) setDetailId\(item\.id\); \}\}/);
  assert.match(source, /accessibilityState=\{\{ busy: busyId === item\.id, disabled: busyId != null \}\}/);
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
  const source = fs.readFileSync(require.resolve('../app/(tabs)/kit-wishlist.tsx'), 'utf8').replace(/\r\n/g, '\n');
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
  assert.match(source, /showToast\([\s\S]*?t\('undo'\)[\s\S]*?try \{[\s\S]*?restoreKitWishlistItem\(removedSnapshot\)[\s\S]*?catch \(error\)[\s\S]*?t\('saveFailed'\)/);
  assert.match(source, /showToast\([\s\S]*?t\('undo'\)[\s\S]*?\}\);[\s\S]*?try \{[\s\S]*?await reload\(\)[\s\S]*?catch \(error\)[\s\S]*?t\('loadFailed'\)/);
});

test('candidate deletion defers photo cleanup until toast expiry and clears it before Undo', () => {
  const source = fs.readFileSync(require.resolve('../app/(tabs)/kit-wishlist.tsx'), 'utf8');
  assert.match(source, /import \{ deleteKitPhoto \} from '..\/..\/lib\/kitPhoto'/);
  assert.match(source, /const toastCleanupRef = useRef<\(\(\) => void \| Promise<void>\) \| null>\(null\);/);

  const clearToast = source.match(/const clearToast = \(runCleanup: boolean\) => \{[\s\S]*?\n  \};/)?.[0] ?? '';
  assert.match(clearToast, /const cleanup = toastCleanupRef\.current;/);
  assert.match(clearToast, /toastCleanupRef\.current = null;/);
  assert.match(clearToast, /if \(runCleanup && cleanup\) void cleanup\(\);/);

  const showToast = source.match(/const showToast = \([\s\S]*?\n  \};/)?.[0] ?? '';
  assert.match(showToast, /onExpire/);
  assert.match(showToast, /clearToast\(true\)/);
  assert.match(showToast, /toastCleanupRef\.current = onExpire \?\? null;/);
  assert.match(showToast, /setTimeout\(\(\) => clearToast\(true\)/);

  const deleteToastStart = source.indexOf("showToast(item.name + t('removedToast')");
  const deleteToast = source.slice(deleteToastStart, source.indexOf('\n      });', deleteToastStart) + 8);
  const expiryCallback = deleteToast.indexOf('}, async () => {');
  assert.ok(expiryCallback >= 0);
  assert.ok(deleteToast.indexOf('deleteKitPhoto(photo.uri)') > expiryCallback);
  assert.ok(deleteToast.indexOf('clearToast(false)') < deleteToast.indexOf('restoreKitWishlistItem'));
});

test('wishlist toast rejects stale actions synchronously before cleanup can delete files', () => {
  const source = fs.readFileSync(require.resolve('../app/(tabs)/kit-wishlist.tsx'), 'utf8');
  assert.match(source, /const toastGenerationRef = useRef\(0\);/);

  const clearToast = source.match(/const clearToast = \(runCleanup: boolean\) => \{[\s\S]*?\n  \};/)?.[0] ?? '';
  const invalidation = clearToast.indexOf('toastGenerationRef.current += 1;');
  const cleanup = clearToast.indexOf('const cleanup = toastCleanupRef.current;');
  assert.ok(invalidation >= 0 && invalidation < cleanup);

  const showToast = source.match(/const showToast = \([\s\S]*?\n  \};/)?.[0] ?? '';
  const staleCheck = showToast.indexOf('if (generation !== toastGenerationRef.current) return;');
  const consume = showToast.indexOf('toastGenerationRef.current += 1;', staleCheck);
  const action = showToast.indexOf('onAction();', staleCheck);
  assert.match(showToast, /const generation = toastGenerationRef\.current;/);
  assert.ok(staleCheck >= 0 && staleCheck < consume && consume < action);
});

test('public DB barrel exports the purchase-candidate snapshot type', () => {
  const source = fs.readFileSync(require.resolve('./db.ts'), 'utf8');
  assert.match(source, /type KitWishlistSnapshot/);
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

test('purchase candidates have independent color tables', () => {
  const schema = fs.readFileSync(require.resolve('./db/schema.ts'), 'utf8');
  assert.match(schema, /CREATE TABLE IF NOT EXISTS kit_wishlist_colors/);
  assert.match(schema, /wishlist_id INTEGER NOT NULL/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS kit_wishlist_color_paints/);
  assert.match(schema, /wishlist_color_id INTEGER NOT NULL/);
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

test('getKitWishlistItem reads the requested purchase candidate by id', async () => {
  const reads = [];
  const db = {
    async getFirstAsync(sql, args) {
      reads.push([sql, args]);
      return snapshot.item;
    },
  };
  const api = loadKitWishlist(db);

  assert.deepEqual(await api.getKitWishlistItem(3), snapshot.item);
  assert.equal(reads.length, 1);
  assert.match(reads[0][0], /FROM kit_wishlist WHERE id = \?/);
  assert.deepEqual(reads[0][1], [3]);
});
