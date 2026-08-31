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
  assert.deepEqual(statements[0][1], [8, 'MG Zaku', 'Bandai', 'MG', 'Plastic model', '1/100', 4500, '再販待ち', 'not_started']);
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

test('legacy kit wishlist migration runs after the kits columns are added', () => {
  const schema = fs.readFileSync(require.resolve('./db/schema.ts'), 'utf8');
  const legacyMigration = schema.indexOf('const hasLegacyKitLists');

  assert.notEqual(legacyMigration, -1);
  for (const column of ['series', 'category', 'price']) {
    const alter = schema.indexOf(`ALTER TABLE kits ADD COLUMN ${column}`);
    assert.ok(alter !== -1 && alter < legacyMigration, `${column} must be added before the legacy migration`);
  }
});

test('kit shopping list reads independent candidates instead of owned kits', () => {
  const source = fs.readFileSync(require.resolve('../app/(tabs)/kit-wishlist.tsx'), 'utf8');
  assert.match(source, /FROM kit_wishlist/);
  assert.match(source, /saveTarget="wishlist"/);
  assert.doesNotMatch(source, /KitsScreen|KitStatus|statusNotStarted|statusBuilding|KitDetailModal/);
});
