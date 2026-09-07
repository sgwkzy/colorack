const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');

function readComponent(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8').replace(/\r\n/g, '\n');
}

function loadComponent(relativePath) {
  const source = readComponent(relativePath);
  const code = ts.transpileModule(source, {
    compilerOptions: {
      jsx: ts.JsxEmit.React,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(() => ({}), module, module.exports);
  return module.exports;
}

function assertDirtyForEachField(api, helperName, initial, fields) {
  assert.equal(typeof api[helperName], 'function', `${helperName} must be exported for the form safety seam`);
  assert.equal(api[helperName](initial, initial), false);
  for (const [field, value] of fields) {
    assert.equal(api[helperName]({ ...initial, [field]: value }, initial), true, `${field} must make the form dirty`);
  }
}

test('kit dirty state includes every text field and added photo', () => {
  const api = loadComponent('components/AddKitModal.tsx');
  const initial = { name: '', maker: '', series: '', category: '', scale: '', price: '', note: '', photos: [] };

  assert.equal(typeof api.isKitFormDirty, 'function', 'isKitFormDirty must be exported for the form safety seam');
  assert.equal(api.isKitFormDirty(initial), false);
  for (const [field, value] of [
    ['name', 'Kit'], ['maker', 'Maker'], ['series', 'Series'], ['category', 'Category'],
    ['scale', '1/144'], ['price', '100'], ['note', 'note'], ['photos', ['photo://one']],
  ]) {
    assert.equal(api.isKitFormDirty({ ...initial, [field]: value }), true, `${field} must make the form dirty`);
  }

  const existing = { name: 'Kit', maker: 'Maker', series: 'Series', category: 'Model', scale: '1/144', price: '100', note: 'note', photos: ['photo://one', 'photo://two'] };
  assert.equal(api.isKitFormDirty(existing, existing), false, 'an unchanged purchase candidate must stay clean');
  assert.equal(api.isKitFormDirty({ ...existing, photos: [...existing.photos].reverse() }, existing), true, 'photo order changes must make an edit dirty');
});

test('paint form dirty state includes every editable field', () => {
  const api = loadComponent('components/PaintFormModal.tsx');
  const initial = {
    nameJa: '赤', nameEn: 'Red', brand: 'Brand', series: 'Series', code: 'C-1',
    hex: '#112233', paintType: 'ラッカー塗料', gloss: '光沢',
  };

  assertDirtyForEachField(api, 'isPaintFormDirty', initial, [
    ['nameJa', '青'], ['nameEn', 'Blue'], ['brand', 'Other'], ['series', 'Other series'],
    ['code', 'C-2'], ['hex', '#445566'], ['paintType', 'エナメル塗料'], ['gloss', 'つや消し'],
  ]);
});

test('manual entry dirty state includes inventory choices and exposes a guarded close ref', () => {
  const api = loadComponent('components/AddPaint/ManualEntry.tsx');
  const initial = {
    nameJa: '赤', brand: 'Brand', series: 'Series', code: 'C-1', hex: '#112233',
    paintType: 'ラッカー塗料', gloss: '光沢', status: 'owned', boxId: 1,
  };

  assertDirtyForEachField(api, 'isManualEntryDirty', initial, [
    ['nameJa', '青'], ['brand', 'Other'], ['series', 'Other series'], ['code', 'C-2'],
    ['hex', '#445566'], ['paintType', 'エナメル塗料'], ['gloss', 'つや消し'],
    ['status', 'in_use'], ['boxId', 2],
  ]);

  const source = readComponent('components/AddPaint/ManualEntry.tsx');
  assert.match(source, /visible\?: boolean/);
  assert.match(source, /requestCloseRef\?: MutableRefObject<\(\) => void>/);
  assert.match(source, /requestCloseRef\.current = requestClose/);
});

test('only the catalog code unique constraint gets the duplicate message', () => {
  const api = loadComponent('lib/manualPaint.ts');
  assert.equal(typeof api.isDuplicateCatalogCodeError, 'function', 'manualPaint must expose duplicate classification');
  assert.equal(api.isDuplicateCatalogCodeError({ code: 2067, message: 'UNIQUE constraint failed: catalog_paints.catalog_code' }), true);
  assert.equal(api.isDuplicateCatalogCodeError(new Error('UNIQUE constraint failed: lists.type, lists.paint_id')), false);
  assert.equal(api.isDuplicateCatalogCodeError(new Error('database is unavailable')), false);

  for (const relativePath of ['components/PaintFormModal.tsx', 'components/AddPaint/ManualEntry.tsx']) {
    const source = readComponent(relativePath);
    assert.match(source, /import \{[^}]*isDuplicateCatalogCodeError[^}]*\} from ['"]\.\.\/?(?:\.\.\/)?lib\/manualPaint['"]/);
    assert.doesNotMatch(source, /function isDuplicateCatalogCodeError/);
  }
});

test('manual entry saves the catalog row and downstream selection in one transaction', () => {
  const source = readComponent('components/AddPaint/ManualEntry.tsx');
  assert.match(source, /onSelect: \(paint: Paint, opts\?: \{ status\?: PaintStatus; boxId\?: number \| null \}\) => void \| Promise<void>/);
  assert.match(
    source,
    /await db\.withTransactionAsync\(async \(\) => \{[\s\S]*?await db\.runAsync\([\s\S]*?INSERT INTO catalog_paints[\s\S]*?await onSelect\([\s\S]*?\n\s*\}\);/,
  );
});

test('kit photo interactions receive the synchronous save guard', () => {
  const source = readComponent('components/AddKitModal.tsx');
  const gridStart = source.indexOf('<KitPhotoGrid');
  const gridEnd = source.indexOf('/>', gridStart);
  assert.ok(gridStart >= 0 && gridEnd > gridStart, 'KitPhotoGrid must be rendered');
  assert.match(source.slice(gridStart, gridEnd), /disabled=\{busy\}/);
});

test('purchase candidate detail supports editing and photos while AddKit stays new-only', () => {
  const detail = readComponent('components/KitWishlistDetailModal.tsx');
  const addKit = readComponent('components/AddKitModal.tsx');
  assert.match(detail, /getKitWishlistPhotos/);
  assert.match(detail, /saveKitWishlistItem/);
  assert.match(detail, /<KitPhotoGrid/);
  assert.doesNotMatch(addKit, /editWishlistItem|onEditAction|editingWishlist/);
  assert.match(addKit, /saveKitWishlistItem/);
  assert.match(addKit, /<KitPhotoGrid/);
});

test('forms route every leave action through dirty and busy guards and keep save failures open', () => {
  const forms = [
    ['components/AddKitModal.tsx', ['onRequestClose={requestClose}', 'SwipeDownHeader onClose={requestClose}', 'SwipeDownScrollView onClose={requestClose}']],
    ['components/PaintFormModal.tsx', ['onRequestClose={requestClose}', 'SwipeDownHeader onClose={requestClose}', 'SwipeDownScrollView onClose={requestClose}']],
    ['components/AddPaint/ManualEntry.tsx', ['SwipeDownScrollView onClose={requestClose}']],
  ];

  for (const [relativePath, closeContracts] of forms) {
    const source = readComponent(relativePath);
    assert.match(source, /useLayoutEffect/);
    assert.match(source, /discardChangesConfirm/);
    assert.match(source, /const savingRef = useRef\(false\)/);
    assert.match(source, /if \([^)]*savingRef\.current[^)]*\) return/);
    assert.match(source, /savingRef\.current = true/);
    assert.match(source, /savingRef\.current = false/);
    assert.match(source, /accessibilityState=\{\{ disabled: [^,]+, busy \}\}/);
    assert.match(source, /disabled=\{!canSave \|\| busy\}/);
    for (const contract of closeContracts) assert.match(source, new RegExp(contract.replace(/[{}]/g, '\\$&')));

    const saveStart = source.indexOf('const save');
    const saveEnd = source.indexOf('\n\n  const ', saveStart + 1);
    const save = source.slice(saveStart, saveEnd >= 0 ? saveEnd : source.length);
    const catchIndex = save.indexOf('catch');
    assert.ok(catchIndex >= 0, `${relativePath} must catch save failures`);
    assert.doesNotMatch(save.slice(catchIndex), /onClose\(\)/, `${relativePath} must not close after a failed save`);
    assert.match(save, /Alert\.alert\(t\('error'\),[\s\S]*t\('saveFailed'\)/);
  }

  const paint = readComponent('components/PaintFormModal.tsx');
  const manual = readComponent('components/AddPaint/ManualEntry.tsx');
  assert.match(paint, /isDuplicateCatalogCodeError\(error\) \? t\('duplicateCodeError'\) : t\('saveFailed'\)/);
  assert.match(manual, /isDuplicateCatalogCodeError\(error\) \? t\('duplicateCodeError'\) : t\('saveFailed'\)/);
});
