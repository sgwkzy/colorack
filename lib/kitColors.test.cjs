const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const ts = require('typescript');

function loadKitColors(db) {
  const source = fs.readFileSync(require.resolve('./db/kitColors.ts'), 'utf8');
  const code = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
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

test('update kit color replaces its metadata and child rows transactionally', async () => {
  const statements = [];
  let transactionCalls = 0;
  const db = {
    async withTransactionAsync(fn) {
      transactionCalls++;
      await fn();
    },
    async runAsync(sql, args) {
      statements.push([sql, args]);
      return { lastInsertRowId: 0 };
    },
  };
  const api = loadKitColors(db);

  await api.updateKitColor(5, '   ', '', [
    { paintId: 4, ratio: 0.75 },
    { paintId: 7, ratio: 0.25 },
  ]);

  assert.equal(transactionCalls, 1);
  assert.deepEqual(statements, [
    ['UPDATE kit_colors SET name = ?, note = ? WHERE id = ?', [null, null, 5]],
    ['DELETE FROM kit_color_paints WHERE kit_color_id = ?', [5]],
    ['INSERT INTO kit_color_paints (kit_color_id, paint_id, ratio, sort_order) VALUES (?, ?, ?, ?)', [5, 4, 0.75, 0]],
    ['INSERT INTO kit_color_paints (kit_color_id, paint_id, ratio, sort_order) VALUES (?, ?, ?, ?)', [5, 7, 0.25, 1]],
  ]);
});
