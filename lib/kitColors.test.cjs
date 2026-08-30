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
  const paintPicker = fs.readFileSync(require.resolve('../components/ColorMixPaintPickerModal.tsx'), 'utf8');
  const detailModal = detail.slice(detail.indexOf('<Modal visible={visible}'), detail.indexOf('</Modal>'));

  assert.match(detail, /<Modal visible=\{visible\}/);
  assert.match(detail, /<ColorMixDetailModal[\s\S]*?\n\s+editable\n/);
  assert.match(composer, /<TouchableOpacity[\s\S]*?onPress=\{\(\) => addSavedMix\(item\)\}/);
  assert.match(detailModal, /<KitColorComposerModal/);
  assert.doesNotMatch(composer, /<Modal\b/);
  assert.match(composer, /StyleSheet\.absoluteFillObject/);
  assert.match(composer, /<ColorMixEditorModal[\s\S]*?\n\s+embedded\n/);
  assert.match(composer, /<ColorMixPaintPickerModal[\s\S]*?\n\s+embedded\n/);
  assert.match(editorModal, /embedded\?: boolean/);
  assert.match(editorModal, /embedded: \{ \.\.\.StyleSheet\.absoluteFillObject/);
  assert.match(paintPicker, /embedded\?: boolean/);
  assert.match(detail, /const childOverlayOpen = pickerOpen \|\| editingColor/);
  assert.match(detail, /onRequestClose=\{childOverlayOpen \? \(\) => childRequestCloseRef\.current\(\) : closeAfterSavingFields\}/);
  assert.match(detail, /SwipeBack enabled=\{visible && !viewerOpen && !childOverlayOpen\}/);
  assert.match(detail, /SwipeDownHeader onClose=\{closeAfterSavingFields\} enabled=\{!viewerOpen && !childOverlayOpen\}/);
  assert.match(detail, /closeEnabled=\{!viewerOpen && !childOverlayOpen\}/);
  assert.match(detail, /<KitColorComposerModal[\s\S]*?requestCloseRef=\{childRequestCloseRef\}/);
  assert.match(detail, /<ColorMixEditorModal[\s\S]*?visible=\{editingColor\}[\s\S]*?\n\s+embedded\n[\s\S]*?requestCloseRef=\{childRequestCloseRef\}/);
});

test('full-screen embedded overlays reserve the device safe area', () => {
  const detail = fs.readFileSync(require.resolve('../components/KitDetailModal.tsx'), 'utf8');
  const composer = fs.readFileSync(require.resolve('../components/KitColorComposerModal.tsx'), 'utf8');
  const editor = fs.readFileSync(require.resolve('../components/ColorMixEditorModal.tsx'), 'utf8');
  const paintPicker = fs.readFileSync(require.resolve('../components/ColorMixPaintPickerModal.tsx'), 'utf8');

  assert.match(composer, /<SafeAreaView[^>]*edges=\{\['top', 'bottom'\]\}/);
  assert.match(editor, /<SafeAreaView[^>]*edges=\{\['top', 'bottom'\]\}/);
  assert.match(paintPicker, /<SafeAreaView[^>]*edges=\{\['top', 'bottom'\]\}/);
  assert.doesNotMatch(editor, /embeddedSafeArea/);
  assert.doesNotMatch(detail, /embeddedSafeArea/);
});

test('camera controls stay inside the device safe area', () => {
  const camera = fs.readFileSync(require.resolve('../components/ColorCameraPicker.tsx'), 'utf8');

  assert.match(camera, /<SafeAreaProvider>[\s\S]*?<SafeAreaView[^>]*edges=\{\['top', 'bottom'\]\}/);
  assert.doesNotMatch(camera, /top: 48|bottom: 42/);
});

test('all kit color source flows distinguish back from closing the whole flow', () => {
  const composer = fs.readFileSync(require.resolve('../components/KitColorComposerModal.tsx'), 'utf8');
  const editor = fs.readFileSync(require.resolve('../components/ColorMixEditorModal.tsx'), 'utf8');
  const paintPicker = fs.readFileSync(require.resolve('../components/ColorMixPaintPickerModal.tsx'), 'utf8');

  assert.match(editor, /onBack\?: \(\) => void/);
  assert.match(editor, /useAndroidBack\(visible && embedded, back\)/);
  assert.match(editor, /<SwipeDownHeader onClose=\{close\}>/);
  assert.match(editor, /onPress=\{back\}[\s\S]*?<IconChevronLeft/);
  assert.match(editor, /onPress=\{close\}[\s\S]*?<IconX/);
  assert.match(paintPicker, /onBack\?: \(\) => void/);
  assert.match(paintPicker, /onPress=\{onBack\}[\s\S]*?<IconChevronLeft/);
  assert.match(paintPicker, /onPress=\{onClose\}[\s\S]*?<IconX/);
  assert.match(composer, /<ColorMixEditorModal[\s\S]*?\n\s+onBack=\{back\}[\s\S]*?\n\s+onClose=\{close\}/);
  assert.match(composer, /<ColorMixPaintPickerModal[\s\S]*?\n\s+onBack=\{back\}[\s\S]*?\n\s+onClose=\{close\}/);
});

test('kit color saves are serialized and refresh before closing', () => {
  const composer = fs.readFileSync(require.resolve('../components/KitColorComposerModal.tsx'), 'utf8');
  const finishAdd = composer.slice(composer.indexOf('const finishAdd'), composer.indexOf('const addPaint'));

  assert.match(composer, /const savingRef = useRef\(false\)/);
  assert.match(composer, /if \(savingRef\.current\) return/);
  assert.match(composer, /savingRef\.current = true/);
  assert.match(composer, /savingRef\.current = false/);
  assert.match(finishAdd, /await onAdded\(\)/);
  assert.ok(finishAdd.indexOf('await onAdded()') < finishAdd.indexOf('onClose()'));
  assert.match(finishAdd, /Alert\.alert\(t\('error'\), t\('loadFailed'\)\)/);
});

test('kit color delete and reorder failures stay visible to the user', () => {
  const detail = fs.readFileSync(require.resolve('../components/KitDetailModal.tsx'), 'utf8');
  const removeColor = detail.slice(detail.indexOf('const removeColor'), detail.indexOf('const confirmRemoveColor'));
  const moveColor = detail.slice(detail.indexOf('const moveColor'), detail.indexOf('const confirmDelete'));

  assert.match(removeColor, /try \{/);
  assert.match(removeColor, /setKitColors\(\(current\) => current\.filter/);
  assert.match(removeColor, /catch \(error\)[\s\S]*?Alert\.alert\(t\('error'\), t\('saveFailed'\)\)/);
  assert.match(moveColor, /try \{/);
  assert.match(moveColor, /setKitColors\(next\)/);
  assert.match(moveColor, /catch \(error\)[\s\S]*?Alert\.alert\(t\('error'\), t\('saveFailed'\)\)/);
});
