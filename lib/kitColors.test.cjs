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

function loadUsedColorOperations() {
  const source = fs.readFileSync(require.resolve('./usedColorOperations.ts'), 'utf8');
  const code = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(
    (id) => { throw new Error(`Unexpected require: ${id}`); },
    module,
    module.exports,
  );
  return module.exports;
}

function createUsedColorRepository(overrides = {}) {
  return {
    async load() { return []; },
    async add() {},
    async update() {},
    async remove() {},
    async reorder() {},
    ...overrides,
  };
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

test('used-color mutations persist before reloading fresh rows', async (t) => {
  const api = loadUsedColorOperations();
  const paints = [{ paintId: 4, ratio: 1 }];
  const cases = [
    {
      name: 'add',
      run: (repository) => api.addUsedColor(repository, 'Primer', null, paints),
      expectedEvents: [['add', 'Primer', null, [{ paintId: 4, ratio: 1 }]], ['load']],
    },
    {
      name: 'update',
      run: (repository) => api.updateUsedColor(repository, 7, 'Primer', 'note', paints),
      expectedEvents: [['update', 7, 'Primer', 'note', [{ paintId: 4, ratio: 1 }]], ['load']],
    },
    {
      name: 'remove',
      run: (repository, onRemoved) => api.removeUsedColor(repository, 7, onRemoved),
      expectedEvents: [['remove', 7], ['removed'], ['load']],
    },
  ];

  for (const testCase of cases) {
    await t.test(testCase.name, async () => {
      const events = [];
      const repository = createUsedColorRepository({
        async load() {
          events.push(['load']);
          return [{ id: 9, name: 'Fresh', note: null, paints: [] }];
        },
        async add(...args) { events.push(['add', ...args]); },
        async update(...args) { events.push(['update', ...args]); },
        async remove(...args) { events.push(['remove', ...args]); },
      });

      const result = await testCase.run(repository, () => events.push(['removed']));

      assert.deepEqual(events, testCase.expectedEvents);
      assert.deepEqual(result, {
        ok: true,
        colors: [{ id: 9, name: 'Fresh', note: null, paints: [] }],
      });
    });
  }
});

test('used-color load failure returns an executable error state', async () => {
  const api = loadUsedColorOperations();
  const failure = new Error('load failed');
  const repository = createUsedColorRepository({
    async load() { throw failure; },
  });

  const result = await api.loadUsedColors(repository);

  assert.equal(result.ok, false);
  assert.equal(result.error, failure);
});

test('used-color reorder failure returns the previous order for rollback', async () => {
  const api = loadUsedColorOperations();
  const failure = new Error('reorder failed');
  const persistedIds = [];
  const repository = createUsedColorRepository({
    async reorder(ids) {
      persistedIds.push(...ids);
      throw failure;
    },
  });

  const result = await api.reorderUsedColors(
    repository,
    [{ id: 1, name: 'A', note: null, paints: [] }, { id: 2, name: 'B', note: null, paints: [] }],
    [{ id: 2, name: 'B', note: null, paints: [] }, { id: 1, name: 'A', note: null, paints: [] }],
  );

  assert.deepEqual(persistedIds, [2, 1]);
  assert.equal(result.ok, false);
  assert.deepEqual(result.colors, [
    { id: 1, name: 'A', note: null, paints: [] },
    { id: 2, name: 'B', note: null, paints: [] },
  ]);
  assert.equal(result.error, failure);
});

test('kit color composer stays inside the kit modal without adding a native modal layer', () => {
  const detail = fs.readFileSync(require.resolve('../components/KitDetailModal.tsx'), 'utf8');
  const panel = fs.readFileSync(require.resolve('../components/KitUsedColorsPanel.tsx'), 'utf8');
  const composer = fs.readFileSync(require.resolve('../components/KitColorComposerModal.tsx'), 'utf8');
  const editorModal = fs.readFileSync(require.resolve('../components/ColorMixEditorModal.tsx'), 'utf8');
  const paintPicker = fs.readFileSync(require.resolve('../components/ColorMixPaintPickerModal.tsx'), 'utf8');
  const detailModal = detail.slice(detail.indexOf('<Modal visible={visible}'), detail.indexOf('</Modal>'));

  assert.match(detail, /<Modal visible=\{visible\}/);
  assert.match(detail, /<KitUsedColorsPanel[\s\S]*?repository=\{usedColorRepository\}/);
  assert.doesNotMatch(detail, /<Sortable\.Grid/);
  assert.match(composer, /<TouchableOpacity[\s\S]*?onPress=\{\(\) => addSavedMix\(item\)\}/);
  assert.match(detailModal, /<KitUsedColorsPanel/);
  assert.match(panel, /<KitColorComposerModal/);
  assert.match(panel, /<ColorMixDetailModal[\s\S]*?\n\s+editable\n/);
  assert.doesNotMatch(composer, /<Modal\b/);
  assert.match(composer, /StyleSheet\.absoluteFillObject/);
  assert.match(panel, /<ColorMixEditorModal[\s\S]*?\n\s+embedded\n/);
  assert.match(composer, /<ColorMixPaintPickerModal[\s\S]*?\n\s+embedded\n/);
  assert.match(editorModal, /embedded\?: boolean/);
  assert.match(editorModal, /embedded: \{ \.\.\.StyleSheet\.absoluteFillObject/);
  assert.match(paintPicker, /embedded\?: boolean/);
  assert.match(panel, /const childOverlayOpen = pickerOpen \|\| editingColor/);
  assert.match(detail, /onRequestClose=\{childOverlayOpen \? \(\) => childRequestCloseRef\.current\(\) : closeAfterSavingFields\}/);
  assert.match(detail, /SwipeBack enabled=\{visible && !viewerOpen && !childOverlayOpen\}/);
  assert.match(detail, /SwipeDownHeader onClose=\{closeAfterSavingFields\} enabled=\{!viewerOpen && !childOverlayOpen\}/);
  assert.match(detail, /closeEnabled=\{!viewerOpen && !childOverlayOpen\}/);
  assert.match(panel, /<KitColorComposerModal[\s\S]*?requestCloseRef=\{requestCloseRef\}/);
  assert.match(panel, /<ColorMixEditorModal[\s\S]*?visible=\{editingColor\}[\s\S]*?\n\s+embedded\n[\s\S]*?requestCloseRef=\{requestCloseRef\}/);
});

test('full-screen embedded overlays apply known safe-area insets on their first frame', () => {
  const detail = fs.readFileSync(require.resolve('../components/KitDetailModal.tsx'), 'utf8');
  const composer = fs.readFileSync(require.resolve('../components/KitColorComposerModal.tsx'), 'utf8');
  const editor = fs.readFileSync(require.resolve('../components/ColorMixEditorModal.tsx'), 'utf8');
  const paintPicker = fs.readFileSync(require.resolve('../components/ColorMixPaintPickerModal.tsx'), 'utf8');

  for (const overlay of [composer, editor, paintPicker]) {
    assert.match(overlay, /useSafeAreaInsets\(\)/);
    assert.match(overlay, /paddingTop: insets\.top, paddingBottom: insets\.bottom/);
  }
  assert.doesNotMatch(editor, /embeddedSafeArea/);
  assert.doesNotMatch(detail, /embeddedSafeArea/);
});

test('camera controls stay inside the device safe area', () => {
  const camera = fs.readFileSync(require.resolve('../components/ColorCameraPicker.tsx'), 'utf8');

  assert.match(camera, /<SafeAreaProvider>[\s\S]*?<SafeAreaView[^>]*edges=\{\['top', 'bottom'\]\}/);
  assert.doesNotMatch(camera, /top: 48|bottom: 42/);
});

test('all kit color source flows distinguish back from closing the whole flow', () => {
  const panel = fs.readFileSync(require.resolve('../components/KitUsedColorsPanel.tsx'), 'utf8');
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
  assert.match(panel, /onOverlayChange\(childOverlayOpen\)/);
  assert.match(panel, /requestCloseRef=\{requestCloseRef\}/);
});

test('kit color composer serializes callback saves before closing', () => {
  const composer = fs.readFileSync(require.resolve('../components/KitColorComposerModal.tsx'), 'utf8');
  const saveFlow = composer.slice(composer.indexOf('const saveColor'), composer.indexOf('const displayName'));

  assert.doesNotMatch(composer, /kitId/);
  assert.doesNotMatch(composer, /onAdded/);
  assert.doesNotMatch(composer, /addKitColor(?:FromSummary)?/);
  assert.match(composer, /const savingRef = useRef\(false\)/);
  assert.match(composer, /if \(savingRef\.current\) return/);
  assert.match(composer, /savingRef\.current = true/);
  assert.match(composer, /savingRef\.current = false/);
  assert.match(saveFlow, /await onSaveColor\(/);
  assert.ok(saveFlow.indexOf('await onSaveColor(') < saveFlow.indexOf('onClose()'));
});

test('used-color mutation failures stay visible to the user', () => {
  const panel = fs.readFileSync(require.resolve('../components/KitUsedColorsPanel.tsx'), 'utf8');
  const removeColor = panel.slice(panel.indexOf('const removeColor'), panel.indexOf('const confirmRemoveColor'));
  const saveColorOrder = panel.slice(panel.indexOf('const saveColorOrder'), panel.indexOf('const moveColor'));

  assert.match(removeColor, /try \{/);
  assert.match(removeColor, /catch \(error\)[\s\S]*?Alert\.alert\(t\('error'\), t\('saveFailed'\)\)/);
  assert.match(saveColorOrder, /if \(!result\.ok\)[\s\S]*?Alert\.alert\(t\('error'\), t\('saveFailed'\)\)/);
});

test('shared used-color panel keeps the overlays, drag settings, and accessibility wiring', () => {
  const panel = fs.readFileSync(require.resolve('../components/KitUsedColorsPanel.tsx'), 'utf8');

  assert.match(panel, /from '\.\.\/lib\/usedColorOperations'/);
  assert.match(panel, /runAndApply\(\(\) => addUsedColor\(repository/);
  assert.match(panel, /runAndApply\(\(\) => updateUsedColor\(/);
  assert.match(panel, /runAndApply\(\(\) => removeUsedColor\(repository/);
  assert.match(panel, /reorderUsedColors\(repository, previous, next\)/);
  assert.match(panel, /<Sortable\.Grid[\s\S]*?dragActivationDelay=\{180\}[\s\S]*?dragActivationFailOffset=\{8\}[\s\S]*?reorderTriggerOrigin="touch"[\s\S]*?overDrag="vertical"[\s\S]*?autoScrollActivationOffset=\{80\}[\s\S]*?autoScrollMaxVelocity=\{500\}/);
  assert.match(panel, /accessibilityActions=\{\[/);
  assert.match(panel, /onAccessibilityAction=\{\(\{ nativeEvent \}\) => \{/);
  assert.match(panel, /Alert\.alert\(color\.name \|\| t\('mixResult'\), t\('deleteMixConfirm'\)/);
  assert.match(panel, /t\('retry'\)/);
  assert.doesNotMatch(panel, /getKitColors|addKitColor|updateKitColor|removeKitColor|reorderKitColors/);
});
