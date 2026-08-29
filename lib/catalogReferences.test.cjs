const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const ts = require('typescript');

function loadCatalog(db, upsertCatalogFromSeed = async () => {}) {
  const source = fs.readFileSync(require.resolve('./db/catalog.ts'), 'utf8');
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
      if (id === './settings') return { getSetting: async () => null, setSetting: async () => {} };
      if (id === './seedCatalog') return { getMasterCatalogPaint: () => null, upsertCatalogFromSeed };
      if (id === './types') return { catalogCode: (brand, series, code) => `${brand}|${series}|${code}`, SEED_VERSION: 1 };
      if (id === '../manualPaint') return { validateManualPaint: () => null };
      throw new Error(`Unexpected require: ${id}`);
    },
    module,
    module.exports
  );
  return module.exports;
}

test('deleting a referenced manual paint throws before destructive SQL', async () => {
  const deleteStatements = [];
  const events = [];
  const referenceCalls = [];
  const db = {
    async getFirstAsync(sql, args) {
      events.push('reference');
      referenceCalls.push({ sql, args });
      return { referenced: 1 };
    },
    async withTransactionAsync(fn) {
      events.push('transaction');
      await fn();
    },
    async runAsync(sql) {
      if (sql.startsWith('DELETE')) deleteStatements.push(sql);
      return { lastInsertRowId: 0 };
    },
  };
  const catalog = loadCatalog(db);

  await assert.rejects(catalog.deletePaint(4), { name: 'PaintReferencedByColorError' });
  assert.equal(referenceCalls.length, 1);
  assert.match(referenceCalls[0].sql, /kit_color_paints/, 'delete reference query must include kit_color_paints');
  assert.match(referenceCalls[0].sql, /mix_recipe_paints/, 'delete reference query must include mix_recipe_paints');
  assert.deepEqual(referenceCalls[0].args, [4, 4]);
  assert.equal(events[0], 'reference');
  assert.equal(events.filter((event) => event === 'transaction').length, 0);
  assert.equal(deleteStatements.length, 0);
});

test('resetting the catalog blocks before deleting a referenced manual paint', async () => {
  const deleteStatements = [];
  const events = [];
  const referenceCalls = [];
  const db = {
    async getAllAsync(sql) {
      return sql.includes('source = \'manual\'') ? [{ id: 4 }] : [];
    },
    async getFirstAsync(sql, args) {
      events.push('reference');
      referenceCalls.push({ sql, args });
      return { referenced: 1 };
    },
    async withTransactionAsync(fn) {
      events.push('transaction');
      await fn();
    },
    async runAsync(sql) {
      if (sql.startsWith('DELETE')) deleteStatements.push(sql);
      return { lastInsertRowId: 0 };
    },
  };
  const catalog = loadCatalog(db);

  await assert.rejects(catalog.resetCatalogToMaster(), { name: 'PaintReferencedByColorError' });
  assert.equal(referenceCalls.length, 1);
  assert.match(referenceCalls[0].sql, /kit_color_paints/, 'reset reference query must include kit_color_paints');
  assert.match(referenceCalls[0].sql, /mix_recipe_paints/, 'reset reference query must include mix_recipe_paints');
  assert.equal(referenceCalls[0].args, undefined);
  assert.equal(events[0], 'reference');
  assert.equal(events.filter((event) => event === 'transaction').length, 0);
  assert.equal(deleteStatements.length, 0);
});

test('deleting an unreferenced paint preserves inventory and list cleanup', async () => {
  const statements = [];
  const db = {
    async getFirstAsync() {
      return null;
    },
    async withTransactionAsync(fn) {
      await fn();
    },
    async runAsync(sql) {
      statements.push(sql);
      return { lastInsertRowId: 0 };
    },
  };
  const catalog = loadCatalog(db);

  await catalog.deletePaint(4);

  assert.deepEqual(statements, [
    'DELETE FROM inventory WHERE paint_id = ?',
    'DELETE FROM lists WHERE paint_id = ?',
    'DELETE FROM kit_color_paints WHERE paint_id = ?',
    'DELETE FROM kit_colors WHERE id NOT IN (SELECT DISTINCT kit_color_id FROM kit_color_paints)',
    'DELETE FROM catalog_paints WHERE id = ?',
  ]);
});
