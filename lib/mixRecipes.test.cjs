const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const ts = require('typescript');

function loadMixRecipes(db) {
  const source = fs.readFileSync(require.resolve('./db/mixRecipes.ts'), 'utf8');
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

test('update recipe replaces child rows in the submitted order', async () => {
  const statements = [];
  let transactionCalls = 0;
  const db = {
    async withTransactionAsync(fn) {
      transactionCalls++;
      await fn();
    },
    async runAsync(sql, args) {
      statements.push([sql, args]);
      return { lastInsertRowId: 9 };
    },
  };
  const api = loadMixRecipes(db);

  await api.updateMixRecipe(9, 'Ocean', 'memo', [
    { paintId: 4, ratio: 0.75 },
    { paintId: 7, ratio: 0.25 },
  ]);

  assert.equal(transactionCalls, 1);
  assert.deepEqual(statements, [
    ["UPDATE mix_recipes SET name = ?, note = ?, updated_at = datetime('now') WHERE id = ?", ['Ocean', 'memo', 9]],
    ['DELETE FROM mix_recipe_paints WHERE mix_recipe_id = ?', [9]],
    ['INSERT INTO mix_recipe_paints (mix_recipe_id, paint_id, ratio, sort_order) VALUES (?, ?, ?, ?)', [9, 4, 0.75, 0]],
    ['INSERT INTO mix_recipe_paints (mix_recipe_id, paint_id, ratio, sort_order) VALUES (?, ?, ?, ?)', [9, 7, 0.25, 1]],
  ]);
});

test('adding a recipe normalizes blank fields and stores its children transactionally', async () => {
  const statements = [];
  let transactionCalls = 0;
  const db = {
    async withTransactionAsync(fn) {
      transactionCalls++;
      await fn();
    },
    async runAsync(sql, args) {
      statements.push([sql, args]);
      return { lastInsertRowId: 12 };
    },
  };
  const api = loadMixRecipes(db);

  await api.addMixRecipe('', '', [{ paintId: 3, ratio: 1 }]);

  assert.equal(transactionCalls, 1);
  assert.deepEqual(statements[0][1], [null, null, 0]);
  assert.deepEqual(statements[1][1], [12, 3, 1, 0]);
});

test('recipe list includes current series, code, name, hex and paint type', async () => {
  const db = {
    async getAllAsync(sql) {
      if (sql.includes('FROM mix_recipes')) {
        return [{ id: 9, name: 'Ocean', note: 'memo' }];
      }
      return [{
        mix_recipe_id: 9,
        paint_id: 4,
        ratio: 1,
        sort_order: 0,
        name_ja: 'C1 ホワイト',
        name_en: 'C1 White',
        brand: 'GSI Creos',
        series: 'Mr.カラー',
        series_en: 'Mr. Color',
        code: 'C1',
        hex: '#FFFFFF',
        paint_type: 'ラッカー塗料',
      }];
    },
  };
  const api = loadMixRecipes(db);

  const rows = await api.getMixRecipes();

  assert.equal(rows[0].paints[0].series, 'Mr.カラー');
  assert.equal(rows[0].paints[0].code, 'C1');
  assert.equal(rows[0].paints[0].name_ja, 'C1 ホワイト');
  assert.equal(rows[0].paints[0].hex, '#FFFFFF');
  assert.equal(rows[0].paints[0].paint_type, 'ラッカー塗料');
});

test('removing a recipe deletes child rows before the parent in one transaction', async () => {
  const statements = [];
  let transactionCalls = 0;
  const db = {
    async withTransactionAsync(fn) {
      transactionCalls++;
      await fn();
    },
    async runAsync(sql) {
      statements.push(sql);
      return { lastInsertRowId: 0 };
    },
  };
  const api = loadMixRecipes(db);

  await api.removeMixRecipe(12);

  assert.equal(transactionCalls, 1);
  assert.deepEqual(statements, [
    'DELETE FROM mix_recipe_paints WHERE mix_recipe_id = ?',
    'DELETE FROM mix_recipes WHERE id = ?',
  ]);
});
