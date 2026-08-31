const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const ts = require('typescript');

function transpile(relativePath, requireImpl, footer = '') {
  const source = fs.readFileSync(require.resolve(relativePath), 'utf8');
  const code = ts.transpileModule(source, {
    compilerOptions: { esModuleInterop: true, jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', `${code}\n${footer}`)(requireImpl, module, module.exports);
  return module.exports;
}

test('paint wishlist chooses one Box directly and asks when several exist', () => {
  const api = transpile(
    '../app/(tabs)/wishlist.tsx',
    () => ({}),
    'module.exports.wishlistMovePlan = wishlistMovePlan; module.exports.wishlistActionForOpenedSide = wishlistActionForOpenedSide;'
  );

  assert.deepEqual(api.wishlistMovePlan([]), { kind: 'unavailable' });
  assert.deepEqual(api.wishlistMovePlan([{ id: 4, name: 'Main' }]), { kind: 'direct', boxId: 4 });
  assert.deepEqual(api.wishlistMovePlan([{ id: 4, name: 'Main' }, { id: 9, name: 'Spare' }]), { kind: 'choose' });
  assert.equal(api.wishlistActionForOpenedSide('right'), 'delete');
  assert.equal(api.wishlistActionForOpenedSide('left'), 'move');
});

test('moving a paint to a Box and Undo each update inventory and wishlist atomically', async () => {
  const statements = [];
  let transactions = 0;
  const tx = {
    async runAsync(sql, args) {
      statements.push([sql, args]);
      if (sql.startsWith('INSERT INTO inventory')) return { lastInsertRowId: 41, changes: 1 };
      return { lastInsertRowId: 0, changes: 1 };
    },
  };
  const db = {
    async withExclusiveTransactionAsync(operation) {
      transactions += 1;
      await operation(tx);
    },
  };
  const api = transpile('./db/inventory.ts', (id) => {
    if (id === './connection') return { getDB: () => db };
    if (id === './settings') return { getDefaultBoxId: async () => null };
    throw new Error(`Unexpected require: ${id}`);
  });

  const inventoryId = await api.moveWishlistPaintToBox(7, 12, 3);
  await api.undoWishlistPaintMove(inventoryId, 12);

  assert.equal(inventoryId, 41);
  assert.equal(transactions, 2);
  assert.deepEqual(statements, [
    ["INSERT INTO inventory (paint_id, status, box_id) VALUES (?, 'owned', ?)", [12, 3]],
    ["DELETE FROM lists WHERE id = ? AND type = 'wishlist' AND paint_id = ?", [7, 12]],
    ['DELETE FROM inventory WHERE id = ? AND paint_id = ?', [41, 12]],
    ["INSERT OR IGNORE INTO lists (type, paint_id) VALUES ('wishlist', ?)", [12]],
  ]);
});
