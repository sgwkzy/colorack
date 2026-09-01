const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const ts = require('typescript');

function loadWishlistColors(db) {
  const source = fs.readFileSync(require.resolve('./db/kitWishlistColors.ts'), 'utf8');
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

function fakeDb({ firstRows = [], insertedId = 0 } = {}) {
  const statements = [];
  const tx = {
    async getFirstAsync(sql, args) {
      statements.push([sql, args]);
      return firstRows.shift() ?? null;
    },
    async getAllAsync() { return []; },
    async runAsync(sql, args) {
      statements.push([sql, args]);
      return { lastInsertRowId: insertedId };
    },
  };
  return {
    statements,
    async withExclusiveTransactionAsync(fn) { await fn(tx); },
  };
}

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

test('adding a color for a missing candidate writes nothing', async () => {
  const db = fakeDb({ firstRows: [null], insertedId: 31 });
  const api = loadWishlistColors(db);

  await assert.rejects(
    () => api.addKitWishlistColor(7, 'Ocean', null, [{ paintId: 4, ratio: 1 }]),
    /Wishlist item not found/
  );
  assert.deepEqual(db.statements, [['SELECT id FROM kit_wishlist WHERE id = ?', [7]]]);
});

test('blank candidate color metadata is stored as null', async () => {
  const db = fakeDb({ firstRows: [{ id: 7 }, { n: 0 }], insertedId: 31 });
  const api = loadWishlistColors(db);

  await api.addKitWishlistColor(7, '  ', '\t', []);

  assert.deepEqual(db.statements, [
    ['SELECT id FROM kit_wishlist WHERE id = ?', [7]],
    ['SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM kit_wishlist_colors WHERE wishlist_id = ?', [7]],
    ['INSERT INTO kit_wishlist_colors (wishlist_id, name, note, sort_order) VALUES (?, ?, ?, ?)', [7, null, null, 0]],
  ]);
});

test('reads candidate colors and paints as ordered color summaries', async () => {
  const calls = [];
  const paints = [{
    wishlist_color_id: 4,
    paint_id: 8,
    ratio: 0.75,
    sort_order: 0,
    name_ja: 'Blue',
    name_en: 'Blue',
    brand: 'Brand',
    series: 'Series',
    series_en: null,
    code: 'B-1',
    hex: '#123456',
    paint_type: 'acrylic',
  }];
  const db = {
    async getAllAsync(sql, args) {
      calls.push([sql, args]);
      return sql.startsWith('SELECT id, name, note FROM kit_wishlist_colors')
        ? [{ id: 4, name: 'Ocean', note: null }]
        : paints;
    },
  };
  const api = loadWishlistColors(db);

  const result = await api.getKitWishlistColors(7);

  assert.deepEqual(result, [{ id: 4, name: 'Ocean', note: null, paints }]);
  assert.deepEqual(calls, [
    ['SELECT id, name, note FROM kit_wishlist_colors WHERE wishlist_id = ? ORDER BY sort_order, id', [7]],
    ['SELECT kcp.wishlist_color_id, kcp.paint_id, kcp.ratio, kcp.sort_order, c.name_ja, c.name_en, c.code, c.brand, c.series, c.series_en, c.hex, c.paint_type FROM kit_wishlist_color_paints kcp JOIN catalog_paints c ON kcp.paint_id = c.id WHERE kcp.wishlist_color_id IN (SELECT id FROM kit_wishlist_colors WHERE wishlist_id = ?) ORDER BY kcp.sort_order, kcp.id', [7]],
  ]);
});

test('updates a candidate color only when it belongs to the candidate', async () => {
  const db = fakeDb({ firstRows: [{ id: 5 }] });
  const api = loadWishlistColors(db);

  await api.updateKitWishlistColor(7, 5, '  ', '', [{ paintId: 4, ratio: 1 }]);

  assert.deepEqual(db.statements, [
    ['SELECT id FROM kit_wishlist_colors WHERE id = ? AND wishlist_id = ?', [5, 7]],
    ['UPDATE kit_wishlist_colors SET name = ?, note = ? WHERE id = ?', [null, null, 5]],
    ['DELETE FROM kit_wishlist_color_paints WHERE wishlist_color_id = ?', [5]],
    ['INSERT INTO kit_wishlist_color_paints (wishlist_color_id, paint_id, ratio, sort_order) VALUES (?, ?, ?, ?)', [5, 4, 1, 0]],
  ]);
});

test('update and delete reject colors owned by another candidate', async () => {
  const updateDb = fakeDb({ firstRows: [null] });
  const deleteDb = fakeDb({ firstRows: [null] });

  await assert.rejects(
    () => loadWishlistColors(updateDb).updateKitWishlistColor(7, 5, null, null, []),
    /Wishlist color not found/
  );
  await assert.rejects(
    () => loadWishlistColors(deleteDb).removeKitWishlistColor(7, 5),
    /Wishlist color not found/
  );
  assert.deepEqual(updateDb.statements, [['SELECT id FROM kit_wishlist_colors WHERE id = ? AND wishlist_id = ?', [5, 7]]]);
  assert.deepEqual(deleteDb.statements, [['SELECT id FROM kit_wishlist_colors WHERE id = ? AND wishlist_id = ?', [5, 7]]]);
});

test('reorders all candidate colors with zero-based sort orders', async () => {
  const statements = [];
  const db = {
    async withExclusiveTransactionAsync(fn) {
      await fn({
        async getFirstAsync(sql, args) {
          assert.equal(sql, 'SELECT id FROM kit_wishlist WHERE id = ?');
          assert.deepEqual(args, [7]);
          return { id: 7 };
        },
        async getAllAsync(sql, args) {
          assert.equal(sql, 'SELECT id FROM kit_wishlist_colors WHERE wishlist_id = ?');
          assert.deepEqual(args, [7]);
          return [{ id: 9 }, { id: 4 }, { id: 7 }];
        },
        async runAsync(sql, args) { statements.push([sql, args]); return { lastInsertRowId: 0 }; },
      });
    },
  };
  const api = loadWishlistColors(db);

  await api.reorderKitWishlistColors(7, [7, 9, 4]);

  assert.deepEqual(statements, [
    ['UPDATE kit_wishlist_colors SET sort_order = ? WHERE id = ?', [0, 7]],
    ['UPDATE kit_wishlist_colors SET sort_order = ? WHERE id = ?', [1, 9]],
    ['UPDATE kit_wishlist_colors SET sort_order = ? WHERE id = ?', [2, 4]],
  ]);
});

test('reorder rejects duplicate or foreign candidate color IDs before writing', async () => {
  for (const colorIds of [[4, 4, 9], [4, 9, 13]]) {
    const statements = [];
    const db = {
      async withExclusiveTransactionAsync(fn) {
        await fn({
          async getFirstAsync() { return { id: 7 }; },
          async getAllAsync() { return [{ id: 4 }, { id: 9 }, { id: 12 }]; },
          async runAsync(sql, args) { statements.push([sql, args]); return { lastInsertRowId: 0 }; },
        });
      },
    };

    await assert.rejects(() => loadWishlistColors(db).reorderKitWishlistColors(7, colorIds));
    assert.deepEqual(statements, []);
  }
});

test('reorder rejects a missing candidate even when its color list is empty', async () => {
  const statements = [];
  let colorRowsRead = false;
  const db = {
    async withExclusiveTransactionAsync(fn) {
      await fn({
        async getFirstAsync(sql, args) {
          statements.push([sql, args]);
          return null;
        },
        async getAllAsync() {
          colorRowsRead = true;
          return [];
        },
        async runAsync(sql, args) {
          statements.push([sql, args]);
          return { lastInsertRowId: 0 };
        },
      });
    },
  };

  await assert.rejects(
    () => loadWishlistColors(db).reorderKitWishlistColors(7, []),
    /Wishlist item not found/
  );
  assert.deepEqual(statements, [['SELECT id FROM kit_wishlist WHERE id = ?', [7]]]);
  assert.equal(colorRowsRead, false);
});
