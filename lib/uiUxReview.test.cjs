const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const ts = require('typescript');

const read = (path) => fs.readFileSync(require.resolve(path), 'utf8');
const transpile = (source) => ts.transpileModule(source, {
  compilerOptions: {
    esModuleInterop: true,
    jsx: ts.JsxEmit.React,
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;

function loadInventoryDeleteFlow({ error = null } = {}) {
  const source = read('../app/(tabs)/owned.tsx').replace(/\r\n/g, '\n');
  const start = source.indexOf('  const deleteItem = async');
  const end = source.indexOf('\n  const openSort', start);
  assert.ok(start >= 0 && end > start, 'inventory delete callback must be extractable');
  const code = transpile(source.slice(start, end) + '\nmodule.exports.deleteItem = deleteItem;');
  const module = { exports: {} };
  const events = [];
  const alerts = [];
  const dbCalls = [];
  const deleteBusyRef = { current: false };
  const db = {
    async runAsync(sql, args) {
      events.push({ type: 'db' });
      dbCalls.push([sql, args]);
      if (error) throw error;
    },
  };
  const context = {
    Alert: {
      alert(title, message, buttons, options) {
        alerts.push({ title, message, buttons: buttons ?? [], options });
      },
    },
    LayoutAnimation: { configureNext() {}, Presets: { easeInEaseOut: {} } },
    swipeRefs: { current: { get: () => ({ close() {} }) } },
    deleteBusyRef,
    t: (key) => key,
    getDB: () => db,
    console: { error() {} },
    setDetailInventoryId: (id) => events.push({ type: 'close', id }),
    reload: () => events.push({ type: 'reload' }),
    showToast: (message) => events.push({ type: 'toast', message }),
    paintName: (nameJa, nameEn) => nameJa || nameEn || '',
  };
  new Function(...Object.keys(context), 'module', 'exports', code)(
    ...Object.values(context),
    module,
    module.exports
  );
  return { ...module.exports, alerts, dbCalls, deleteBusyRef, events };
}

function loadSettingsSameAccountConflictFlow() {
  const source = read('../app/(tabs)/settings.tsx').replace(/\r\n/g, '\n');
  const start = source.indexOf('  const showConflictAlert');
  const end = source.indexOf('\n  const showAccountConflictAlert', start);
  assert.ok(start >= 0 && end > start, 'settings same-account conflict callback must be extractable');
  const code = transpile(source.slice(start, end) + '\nmodule.exports.showConflictAlert = showConflictAlert;');
  const module = { exports: {} };
  const alerts = [];
  const operations = { ready: 0, push: 0, restore: 0 };
  const context = {
    Alert: {
      alert(title, message, buttons, options) {
        alerts.push({ title, message, buttons: buttons ?? [], options });
      },
    },
    t: (key) => key,
    setAccountBusy: () => {},
    markCloudBackupReady: async () => { operations.ready += 1; },
    pushBackupToFirestore: async () => { operations.push += 1; },
    restoreCloudBackup: async () => { operations.restore += 1; },
    loadLastBackupAt: async () => {},
  };
  new Function(...Object.keys(context), 'module', 'exports', code)(
    ...Object.values(context),
    module,
    module.exports
  );
  return { ...module.exports, alerts, operations };
}

function loadStartupSameAccountConflictFlow(sourceOverride) {
  const source = (sourceOverride ?? read('../app/_layout.tsx')).replace(/\r\n/g, '\n');
  const start = source.indexOf("    Alert.alert(t('cloudRestoreConflictTitle'");
  const end = source.indexOf("\n  }, [ready", start);
  assert.ok(start >= 0 && end > start, 'startup same-account conflict branch must be extractable');
  const branch = source.slice(start, end);
  const code = transpile(
    "const expectedUid = 'user-1';\n"
    + "const startupConflictKind = 'cloud';\n"
    + "const clearConflict = () => { operations.clear += 1; };\n"
    + "const resolveConflict = async (useCloud) => {\n"
    + "  if (useCloud) operations.restore += 1;\n"
    + "  operations.ready += 1;\n"
    + "  if (!useCloud) operations.push += 1;\n"
    + "};\n"
    + "async function showStartupConflict() {\n"
    + branch
    + "\n}\n"
    + "module.exports.showStartupConflict = showStartupConflict;\n"
  );
  const module = { exports: {} };
  const alerts = [];
  const operations = { ready: 0, push: 0, restore: 0, clear: 0 };
  const context = {
    Alert: {
      alert(title, message, buttons, options) {
        alerts.push({ title, message, buttons: buttons ?? [], options });
      },
    },
    fetchBackupSnapshot: async () => ({ schemaVersion: 7 }),
    getLocale: () => 'en',
    t: (key) => key,
    operations,
  };
  new Function(...Object.keys(context), 'module', 'exports', code)(
    ...Object.values(context),
    module,
    module.exports
  );
  return { ...module.exports, alerts, operations };
}

function loadThemeColors() {
  const source = read('../lib/theme.ts').replace(/\r\n/g, '\n');
  const start = source.indexOf('export const lightColors');
  const end = source.indexOf('\nexport type ThemeMode', start);
  assert.ok(start >= 0 && end > start, 'theme color palettes must be extractable');
  const code = transpile(source.slice(start, end) + '\nmodule.exports = { lightColors, darkColors };');
  const module = { exports: {} };
  new Function('module', 'exports', code)(module, module.exports);
  return module.exports;
}

function contrastRatio(foreground, background) {
  const channel = (value) => {
    const normalized = value / 255;
    return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  };
  const luminance = (hex) => {
    let value = hex.replace('#', '');
    if (value.length === 3) value = value.split('').map((channel) => channel + channel).join('');
    return 0.2126 * channel(parseInt(value.slice(0, 2), 16))
      + 0.7152 * channel(parseInt(value.slice(2, 4), 16))
      + 0.0722 * channel(parseInt(value.slice(4, 6), 16));
  };
  const light = luminance(foreground);
  const dark = luminance(background);
  return (Math.max(light, dark) + 0.05) / (Math.min(light, dark) + 0.05);
}

test('history screens use status totals and do not expose add affordances', () => {
  const owned = read('../app/(tabs)/owned.tsx');
  const kits = read('../app/(tabs)/kits.tsx');

  assert.match(owned, /status = 'used_up'/);
  assert.match(owned, /paintCount', \{ total: inventoryTotal, shown: items\.length \}/);
  assert.match(owned, /const trulyEmpty = !filterActive && inventoryTotal === 0/);
  assert.match(owned, /!isUsedScreen && <ListActionBar/);
  assert.match(owned, /!isUsedScreen \?\s*\(\s*<AddPaintModal/);
  assert.match(kits, /status = 'completed'/);
  assert.match(kits, /kitCount', \{ total: kitTotal, shown: items\.length \}/);
  assert.match(kits, /const trulyEmpty = !filterActive && kitTotal === 0/);
  assert.match(kits, /!completedScreen && <ListActionBar/);
  assert.match(kits, /!completedScreen \?\s*\(\s*<AddKitModal/);
});

test('filled primary actions keep white text at accessible contrast in both themes', () => {
  const { lightColors, darkColors } = loadThemeColors();

  for (const [name, colors] of [['light', lightColors], ['dark', darkColors]]) {
    assert.ok(colors.primaryAction, `${name} theme must define a filled-action color`);
    assert.ok(
      contrastRatio(colors.onPrimary, colors.primaryAction) >= 4.5,
      `${name} primary action contrast must be at least 4.5:1`
    );
  }
});

test('catalog paint search uses the same five searchable fields and placeholder', () => {
  const textSearch = read('../components/AddPaint/TextSearch.tsx');
  const hierarchy = read('../components/AddPaint/HierarchyBrowser.tsx');
  const catalog = read('../app/(tabs)/catalog.tsx');
  const owned = read('../app/(tabs)/owned.tsx');
  const favorites = read('../app/(tabs)/favorites.tsx');
  const wishlist = read('../app/(tabs)/wishlist.tsx');

  assert.match(textSearch, /name_ja LIKE \? OR name_en LIKE \? OR brand LIKE \? OR series LIKE \? OR code LIKE \?/);
  for (const source of [owned, favorites, wishlist]) {
    assert.match(source, /c\.name_ja LIKE \? OR c\.name_en LIKE \? OR c\.brand LIKE \? OR c\.series LIKE \? OR c\.code LIKE \?/);
  }
  for (const source of [hierarchy, catalog]) {
    assert.match(source, /p\.brand\.toLowerCase\(\)\.includes\(q\)/);
    assert.match(source, /p\.series\.toLowerCase\(\)\.includes\(q\)/);
    assert.match(source, /\(p\.code \?\? ''\)\.toLowerCase\(\)\.includes\(q\)/);
    assert.match(source, /placeholder=\{t\('searchPlaceholder'\)\}/);
  }
});

test('owned paint rows and detail share the confirmed delete flow', () => {
  const owned = read('../app/(tabs)/owned.tsx');
  const paintRow = read('../components/PaintRow.tsx');
  const detail = read('../components/InventoryDetailModal.tsx');

  assert.match(paintRow, /accessibilityActions\?: ReadonlyArray<AccessibilityActionInfo>/);
  assert.doesNotMatch(paintRow, /accessibilityLabel\?: string/);
  assert.doesNotMatch(owned, /accessibilityLabel=\{paintName\(item\.name_ja, item\.name_en\)\}/);
  assert.match(owned, /accessibilityActions=\{\[\{ name: 'delete', label: t\('delete'\) \}\]\}/);
  assert.match(owned, /onAccessibilityAction=\{\(\{ nativeEvent \}\) => \{[\s\S]*?deleteItem\(item\)/);
  assert.match(owned, /<InventoryDetailModal[\s\S]*?onDelete=\{\(item\) => deleteItem\(item\)\}/);
  assert.match(detail, /onDelete\?: \(detail: InventoryDetail\) => void/);
  assert.match(detail, /onDelete\(detail\)/);
});

test('inventory delete cancellation and Android dismissal release the shared busy guard without DB work', async () => {
  for (const mode of ['cancel', 'android-dismiss']) {
    const flow = loadInventoryDeleteFlow();
    await flow.deleteItem({ id: 7, name_ja: 'Black', name_en: 'Black' });
    assert.equal(flow.alerts.length, 1);
    assert.equal(flow.deleteBusyRef.current, true);
    if (mode === 'cancel') {
      await flow.alerts[0].buttons[0].onPress?.();
    } else {
      flow.alerts[0].options?.onDismiss?.();
    }
    assert.equal(flow.dbCalls.length, 0);
    assert.equal(flow.deleteBusyRef.current, false);
  }
});

test('inventory delete closes detail and shows success only after DB deletion succeeds', async () => {
  const flow = loadInventoryDeleteFlow();
  await flow.deleteItem({ id: 7, name_ja: 'Black', name_en: 'Black' });
  await flow.alerts[0].buttons[1].onPress();

  assert.deepEqual(flow.dbCalls, [['DELETE FROM inventory WHERE id = ?', [7]]]);
  assert.deepEqual(flow.events.map(({ type }) => type), ['db', 'close', 'reload', 'toast']);
  assert.equal(flow.deleteBusyRef.current, false);
});

test('inventory delete keeps detail and note intact when DB deletion fails', async () => {
  const flow = loadInventoryDeleteFlow({ error: new Error('delete failed') });
  await flow.deleteItem({ id: 7, name_ja: 'Black', name_en: 'Black' });

  await assert.doesNotReject(() => flow.alerts[0].buttons[1].onPress());
  assert.deepEqual(flow.events.map(({ type }) => type), ['db']);
  assert.equal(flow.alerts.length, 2);
  assert.equal(flow.alerts[1].title, 'error');
  assert.equal(flow.deleteBusyRef.current, false);
});

test('inventory delete prevents duplicate confirmation callbacks while busy', async () => {
  const flow = loadInventoryDeleteFlow();
  await flow.deleteItem({ id: 7, name_ja: 'Black', name_en: 'Black' });
  await flow.deleteItem({ id: 7, name_ja: 'Black', name_en: 'Black' });

  assert.equal(flow.alerts.length, 1);
  flow.alerts[0].options?.onDismiss?.();
});

test('same-account conflict cancellation never marks ready, pushes, or restores', async () => {
  const settings = loadSettingsSameAccountConflictFlow();
  settings.showConflictAlert('user-1');
  const settingsAlert = settings.alerts[0];
  const settingsCancel = settingsAlert.buttons.find((button) => button.style === 'cancel');
  assert.ok(settingsCancel, 'settings conflict must expose a cancel action');
  await settingsCancel.onPress?.();
  assert.deepEqual(settings.operations, { ready: 0, push: 0, restore: 0 });

  const layout = loadStartupSameAccountConflictFlow();
  await layout.showStartupConflict();
  const layoutAlert = layout.alerts[0];
  const layoutAdopt = layoutAlert.buttons.find((button) => button.text === 'cloudKeepDeviceData');
  const layoutCancel = layoutAlert.buttons.find((button) => button.style === 'cancel');
  assert.ok(layoutAdopt);
  assert.equal(layoutAdopt.style, 'destructive');
  assert.ok(layoutCancel, 'startup same-account conflict must expose a cancel action');
  await layoutCancel.onPress?.();
  assert.deepEqual(layout.operations, { ready: 0, push: 0, restore: 0, clear: 1 });

  const source = read('../app/_layout.tsx').replace(/\r\n/g, '\n');
  const withoutCancel = source.replace(
    "      { text: t('cancel'), style: 'cancel', onPress: clearConflict },\n    ], { cancelable: false });",
    "    ], { cancelable: false });"
  );
  assert.notEqual(withoutCancel, source, 'same-account cancellation mutation must change the source');
  await assert.rejects(
    (async () => {
      const broken = loadStartupSameAccountConflictFlow(withoutCancel);
      await broken.showStartupConflict();
      const missingCancel = broken.alerts[0].buttons.find((button) => button.style === 'cancel');
      assert.ok(missingCancel, 'same-account startup conflict must expose a cancel action');
    })(),
    /same-account startup conflict must expose a cancel action/
  );
});

test('backup conflicts expose an independent cancel action', () => {
  const layout = read('../app/_layout.tsx');
  const settings = read('../app/(tabs)/settings.tsx');

  assert.match(layout, /text: t\('cancel'\), style: 'cancel', onPress: clearConflict/);
  assert.match(layout, /text: t\('cloudKeepDeviceData'\),\s*style: 'destructive'/);
  assert.match(settings, /text: t\('cancel'\), style: 'cancel'/);
  assert.match(settings, /text: t\('cloudKeepDeviceData'\),\s*style: 'destructive'/);
});

test('history empty-state copy tells users where to change status', () => {
  const ja = read('../translations/ja.json');
  const en = read('../translations/en.json');

  assert.match(ja, /"emptyUsed":"[^"]*\u5728\u5eab\u753b\u9762[^"]*"/);
  assert.match(ja, /"emptyCompletedKits":"[^"]*\u30ad\u30c3\u30c8\u4e00\u89a7[^"]*"/);
  assert.match(en, /"emptyUsed":"[^"]*Storage[^"]*"/);
  assert.match(en, /"emptyCompletedKits":"[^"]*Kits[^"]*"/);
});
