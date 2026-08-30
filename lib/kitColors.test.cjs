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

test('add kit color normalizes blank metadata', async () => {
  const statements = [];
  const db = {
    async withTransactionAsync(fn) { await fn(); },
    async getFirstAsync() { return { n: 0 }; },
    async runAsync(sql, args) {
      statements.push([sql, args]);
      return { lastInsertRowId: 9 };
    },
  };
  const api = loadKitColors(db);

  await api.addKitColor(3, '  ', '', [{ paintId: 4, ratio: 1 }]);

  assert.deepEqual(statements[0], [
    'INSERT INTO kit_colors (kit_id, name, note, sort_order) VALUES (?, ?, ?, ?)',
    [3, null, null, 0],
  ]);
});

test('copying a saved mix to a kit preserves metadata, ratio and paint order', async () => {
  const statements = [];
  const db = {
    async withTransactionAsync(fn) { await fn(); },
    async getFirstAsync() { return { n: 2 }; },
    async runAsync(sql, args) {
      statements.push([sql, args]);
      return { lastInsertRowId: 21 };
    },
  };
  const api = loadKitColors(db);

  await api.addKitColorFromSummary(7, {
    id: 9,
    name: 'Ocean',
    note: 'underside',
    paints: [
      { paint_id: 4, ratio: 0.3333, sort_order: 0 },
      { paint_id: 8, ratio: 0.6667, sort_order: 1 },
    ],
  });

  assert.deepEqual(statements, [
    ['INSERT INTO kit_colors (kit_id, name, note, sort_order) VALUES (?, ?, ?, ?)', [7, 'Ocean', 'underside', 2]],
    ['INSERT INTO kit_color_paints (kit_color_id, paint_id, ratio, sort_order) VALUES (?, ?, ?, ?)', [21, 4, 0.3333, 0]],
    ['INSERT INTO kit_color_paints (kit_color_id, paint_id, ratio, sort_order) VALUES (?, ?, ?, ?)', [21, 8, 0.6667, 1]],
  ]);
});

test('kit color composer stays inside the kit modal without adding a native modal layer', () => {
  const detail = fs.readFileSync(require.resolve('../components/KitDetailModal.tsx'), 'utf8');
  const composer = fs.readFileSync(require.resolve('../components/KitColorComposerModal.tsx'), 'utf8');
  const editorModal = fs.readFileSync(require.resolve('../components/ColorMixEditorModal.tsx'), 'utf8');
  const detailModal = detail.slice(detail.indexOf('<Modal visible={visible}'), detail.indexOf('</Modal>'));

  assert.match(detail, /<Modal visible=\{visible\}/);
  assert.match(detail, /<ColorMixDetailModal[\s\S]*?\n\s+editable\n/);
  assert.match(composer, /<TouchableOpacity[\s\S]*?onPress=\{\(\) => addSavedMix\(item\)\}/);
  assert.match(detailModal, /<KitColorComposerModal/);
  assert.doesNotMatch(composer, /<Modal\b/);
  assert.match(composer, /StyleSheet\.absoluteFillObject/);
  assert.match(composer, /<ColorMixEditorModal[\s\S]*?\n\s+embedded\n/);
  assert.match(editorModal, /embedded\?: boolean/);
  assert.match(detail, /onRequestClose=\{pickerOpen \? \(\) => \{\} : closeAfterSavingFields\}/);
  assert.match(detail, /SwipeBack enabled=\{visible && !viewerOpen && !pickerOpen\}/);
  assert.match(detail, /SwipeDownHeader onClose=\{closeAfterSavingFields\} enabled=\{!viewerOpen && !pickerOpen\}/);
  assert.match(detail, /closeEnabled=\{!viewerOpen && !pickerOpen\}/);
});
