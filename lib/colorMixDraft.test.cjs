const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const ts = require('typescript');

function loadColorMixDraft() {
  const source = fs.readFileSync(require.resolve('./colorMixDraft.ts'), 'utf8');
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  new Function('module', 'exports', code)(module, module.exports);
  return module.exports;
}

function paint(id, parts = 1, paintType = 'ラッカー塗料', hex = '#112233') {
  return {
    paint_id: id,
    name_ja: `色${id}`,
    name_en: `Color ${id}`,
    brand: 'Brand',
    series: 'Series',
    series_en: 'Series',
    code: `C-${id}`,
    hex,
    paint_type: paintType,
    parts,
  };
}

function storedPaint(id, ratio, sort_order = id) {
  const { parts, ...stored } = paint(id);
  return { ...stored, ratio, sort_order };
}

test('adding a paint keeps tuned parts and gives only the new paint one part', () => {
  const api = loadColorMixDraft();
  const current = [paint(1, 7), paint(2, 3)];
  assert.deepEqual(api.tryAddDraftPaint(current, paint(3, 9)).paints.map((p) => p.parts), [7, 3, 1]);
});

test('removing a paint does not rebalance remaining parts', () => {
  const api = loadColorMixDraft();
  assert.deepEqual(api.removeDraftPaint([paint(1, 7), paint(2, 3), paint(3, 1)], 2).map((p) => p.parts), [7, 1]);
});

test('normalizes 2 to 1 parts into two thirds and one third', () => {
  const api = loadColorMixDraft();
  assert.deepEqual(api.normalizeDraftPaints([paint(1, 2), paint(2, 1)]), [
    { paintId: 1, ratio: 2 / 3 }, { paintId: 2, ratio: 1 / 3 },
  ]);
});

test('rejects duplicate, sixth, mixed-type, invalid-hex, zero and decimal parts', () => {
  const api = loadColorMixDraft();
  assert.equal(api.tryAddDraftPaint([paint(1)], paint(1)).error, 'duplicate');
  assert.equal(api.tryAddDraftPaint([1, 2, 3, 4, 5].map((id) => paint(id)), paint(6)).error, 'max_paints');
  assert.equal(api.tryAddDraftPaint([paint(1)], paint(2, 1, '水性アクリル塗料')).error, 'paint_type_mismatch');
  assert.equal(api.tryAddDraftPaint([], paint(1, 1, 'ラッカー塗料', 'nope')).error, 'invalid_hex');
  assert.equal(api.validateMixDraft({ name: '', note: '', paints: [paint(1, 0)] }), 'invalid_parts');
  assert.equal(api.validateMixDraft({ name: '', note: '', paints: [paint(1, 1.5)] }), 'invalid_parts');
});

test('rejects parts above 9999', () => {
  const api = loadColorMixDraft();
  assert.equal(api.validateMixDraft({ name: '', note: '', paints: [paint(1, 10000)] }), 'invalid_parts');
});

test('rejects an empty draft', () => {
  const api = loadColorMixDraft();
  assert.equal(api.validateMixDraft({ name: '', note: '', paints: [] }), 'empty');
});

test('returns a paint percentage from its normalized parts', () => {
  const api = loadColorMixDraft();
  assert.equal(api.normalizedPercent([paint(1, 1), paint(2, 3)], 1), 25);
});

test('restores draft paints from stored ratios and blank metadata', () => {
  const api = loadColorMixDraft();
  assert.deepEqual(api.draftFromSummary({
    id: 7,
    name: 'Saved mix',
    note: null,
    paints: [storedPaint(1, 0.625), storedPaint(2, 0.005)],
  }), {
    name: 'Saved mix',
    note: '',
    paints: [paint(1, 63), paint(2, 1)],
  });
});

test('creates an empty draft without a summary', () => {
  const api = loadColorMixDraft();
  assert.deepEqual(api.draftFromSummary(null), { name: '', note: '', paints: [] });
});

test('editor adds a rapidly selected paint against the latest paint list', () => {
  const source = fs.readFileSync(require.resolve('../components/ColorMixEditor.tsx'), 'utf8');
  const addPaint = source.slice(source.indexOf('const addPaint'), source.indexOf('const updateParts'));

  assert.match(source, /const paintsRef = useRef/);
  assert.match(addPaint, /tryAddDraftPaint\(paintsRef\.current, candidate\)/);
  assert.doesNotMatch(addPaint, /tryAddDraftPaint\(draft\.paints, candidate\)/);
});
