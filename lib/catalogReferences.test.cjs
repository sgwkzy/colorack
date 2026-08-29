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
  const db = {
    async getFirstAsync(sql) {
      return sql.includes('EXISTS') ? { referenced: 1 } : null;
    },
    async withTransactionAsync(fn) {
      await fn();
    },
    async runAsync(sql) {
      if (sql.startsWith('DELETE')) deleteStatements.push(sql);
      return { lastInsertRowId: 0 };
    },
  };
  const catalog = loadCatalog(db);

  await assert.rejects(catalog.deletePaint(4), { name: 'PaintReferencedByColorError' });
  assert.equal(deleteStatements.length, 0);
});

test('resetting the catalog blocks before deleting a referenced manual paint', async () => {
  const deleteStatements = [];
  const db = {
    async getAllAsync(sql) {
      return sql.includes('source = \'manual\'') ? [{ id: 4 }] : [];
    },
    async getFirstAsync(sql) {
      return sql.includes('EXISTS') ? { referenced: 1 } : null;
    },
    async withTransactionAsync(fn) {
      await fn();
    },
    async runAsync(sql) {
      if (sql.startsWith('DELETE')) deleteStatements.push(sql);
      return { lastInsertRowId: 0 };
    },
  };
  const catalog = loadCatalog(db);

  await assert.rejects(catalog.resetCatalogToMaster(), { name: 'PaintReferencedByColorError' });
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
