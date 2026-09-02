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

function paint(id, percentage = 100, paintType = 'ラッカー塗料', hex = '#112233') {
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
    percentage,
  };
}

function storedPaint(id, ratio, sort_order = id) {
  const { percentage, ...stored } = paint(id);
  return { ...stored, ratio, sort_order };
}

test('adding a paint redistributes the mix into whole percentages totaling 100', () => {
  const api = loadColorMixDraft();
  const one = api.tryAddDraftPaint([], paint(1)).paints;
  const two = api.tryAddDraftPaint(one, paint(2)).paints;
  const three = api.tryAddDraftPaint(two, paint(3)).paints;
  assert.deepEqual(one.map((p) => p.percentage), [100]);
  assert.deepEqual(two.map((p) => p.percentage), [50, 50]);
  assert.deepEqual(three.map((p) => p.percentage), [34, 33, 33]);
});

test('removing a paint redistributes remaining paints to 100 percent', () => {
  const api = loadColorMixDraft();
  assert.deepEqual(api.removeDraftPaint([paint(1, 60), paint(2, 30), paint(3, 10)], 2).map((p) => p.percentage), [50, 50]);
});

test('stores whole percentages as decimal ratios', () => {
  const api = loadColorMixDraft();
  assert.deepEqual(api.normalizeDraftPaints([paint(1, 60), paint(2, 40)]), [
    { paintId: 1, ratio: 0.6 }, { paintId: 2, ratio: 0.4 },
  ]);
});

test('rejects duplicate, sixth, mixed-type, invalid-hex, zero and decimal percentages', () => {
  const api = loadColorMixDraft();
  assert.equal(api.tryAddDraftPaint([paint(1)], paint(1)).error, 'duplicate');
  assert.equal(api.tryAddDraftPaint([1, 2, 3, 4, 5].map((id) => paint(id)), paint(6)).error, 'max_paints');
  assert.equal(api.tryAddDraftPaint([paint(1)], paint(2, 1, '水性アクリル塗料')).error, 'paint_type_mismatch');
  assert.equal(api.tryAddDraftPaint([], paint(1, 1, 'ラッカー塗料', 'nope')).error, 'invalid_hex');
  assert.equal(api.validateMixDraft({ name: '', note: '', paints: [paint(1, 0)] }), 'invalid_percentage');
  assert.equal(api.validateMixDraft({ name: '', note: '', paints: [paint(1, 1.5)] }), 'invalid_percentage');
});

test('rejects percentages above 100 and totals other than 100', () => {
  const api = loadColorMixDraft();
  assert.equal(api.validateMixDraft({ name: '', note: '', paints: [paint(1, 101)] }), 'invalid_percentage');
  assert.equal(api.validateMixDraft({ name: '', note: '', paints: [paint(1, 60), paint(2, 30)] }), 'invalid_percentage_total');
  assert.equal(api.validateMixDraft({ name: '', note: '', paints: [paint(1, 60), paint(2, 50)] }), 'invalid_percentage_total');
});

test('rejects an empty draft', () => {
  const api = loadColorMixDraft();
  assert.equal(api.validateMixDraft({ name: '', note: '', paints: [] }), 'empty');
});

test('returns the total entered percentage', () => {
  const api = loadColorMixDraft();
  assert.equal(api.totalPercentage([paint(1, 25), paint(2, 50)]), 75);
});

test('restores stored ratios as whole percentages totaling 100', () => {
  const api = loadColorMixDraft();
  assert.deepEqual(api.draftFromSummary({
    id: 7,
    name: 'Saved mix',
    note: null,
    paints: [storedPaint(1, 0.625), storedPaint(2, 0.005)],
  }), {
    name: 'Saved mix',
    note: '',
    paints: [paint(1, 99), paint(2, 1)],
  });
});

test('converts stored ratios into stable whole percentages totaling 100', () => {
  const api = loadColorMixDraft();
  assert.deepEqual(api.wholePercentagesFromRatios([1 / 3, 1 / 3, 1 / 3]), [34, 33, 33]);
  assert.deepEqual(api.wholePercentagesFromRatios([0.625, 0.005]), [99, 1]);
});

test('moves a saved mix one position without mutating the current order', () => {
  const api = loadColorMixDraft();
  const recipes = [1, 2, 3].map((id) => ({ id, name: `Mix ${id}`, note: null, paints: [] }));

  assert.deepEqual(api.moveMixRecipe(recipes, 2, -1).map((recipe) => recipe.id), [2, 1, 3]);
  assert.deepEqual(recipes.map((recipe) => recipe.id), [1, 2, 3]);
});

test('keeps the saved mix order when a move would leave the list', () => {
  const api = loadColorMixDraft();
  const recipes = [1, 2].map((id) => ({ id, name: `Mix ${id}`, note: null, paints: [] }));

  assert.strictEqual(api.moveMixRecipe(recipes, 1, -1), recipes);
  assert.strictEqual(api.moveMixRecipe(recipes, 2, 1), recipes);
});

test('detects whether a dragged color order actually changed', () => {
  const api = loadColorMixDraft();
  const current = [{ id: 1 }, { id: 2 }, { id: 3 }];

  assert.equal(api.sameColorOrder(current, [{ id: 1 }, { id: 2 }, { id: 3 }]), true);
  assert.equal(api.sameColorOrder(current, [{ id: 2 }, { id: 1 }, { id: 3 }]), false);
  assert.equal(api.sameColorOrder(current, [{ id: 1 }, { id: 2 }]), false);
});

test('creates an empty draft without a summary', () => {
  const api = loadColorMixDraft();
  assert.deepEqual(api.draftFromSummary(null), { name: '', note: '', paints: [] });
});

test('editor adds a rapidly selected paint against the latest paint list', () => {
  const source = fs.readFileSync(require.resolve('../components/ColorMixEditor.tsx'), 'utf8');
  const addPaint = source.slice(source.indexOf('const addPaint'), source.indexOf('const updatePercentage'));

  assert.match(source, /const paintsRef = useRef/);
  assert.match(addPaint, /tryAddDraftPaint\(paintsRef\.current, candidate\)/);
  assert.doesNotMatch(addPaint, /tryAddDraftPaint\(draft\.paints, candidate\)/);
});

test('paint selection is rendered in a modal instead of inside the editor ScrollView', () => {
  const editor = fs.readFileSync(require.resolve('../components/ColorMixEditor.tsx'), 'utf8');
  const picker = fs.readFileSync(require.resolve('../components/ColorMixPaintPickerModal.tsx'), 'utf8');
  const hierarchy = fs.readFileSync(require.resolve('../components/AddPaint/HierarchyBrowser.tsx'), 'utf8');
  const matcher = fs.readFileSync(require.resolve('../components/AddPaint/ColorMatcher.tsx'), 'utf8');

  assert.match(editor, /<ColorMixPaintPickerModal/);
  assert.doesNotMatch(editor, /<HierarchyBrowser/);
  assert.doesNotMatch(editor, /<ColorMatcher/);
  assert.match(picker, /<Modal/);
  assert.match(picker, /<HierarchyBrowser/);
  assert.match(picker, /<ColorMatcher/);
  assert.match(picker, /selectionOnly/);
  assert.match(picker, /selectingRef/);
  assert.match(hierarchy, /selectionOnly/);
  assert.match(matcher, /selectionOnly/);
});

test('saved mix card and detail use the same whole percentage conversion as the editor', () => {
  const card = fs.readFileSync(require.resolve('../components/ColorMixCard.tsx'), 'utf8');
  const detail = fs.readFileSync(require.resolve('../components/ColorMixDetailModal.tsx'), 'utf8');

  assert.match(card, /wholePercentagesFromRatios/);
  assert.match(detail, /wholePercentagesFromRatios/);
  assert.doesNotMatch(card, /Math\.round\(paint\.ratio \* 100\)/);
  assert.doesNotMatch(detail, /Math\.round\(paint\.ratio \* 100\)/);
});

test('detail presents the result as a labeled color field with an accessible balance bar', () => {
  const source = fs.readFileSync(require.resolve('../components/ColorMixDetailModal.tsx'), 'utf8');

  assert.match(source, /const resultTextColor = resultHex \? readableTextColor\(resultHex\)/);
  assert.match(source, /style=\{\[styles\.resultHero, \{ backgroundColor: resultHex/);
  assert.match(source, /numberOfLines=\{2\} style=\{\[styles\.resultName, \{ color: resultTextColor \}\]\}/);
  assert.match(source, /const mixBalanceLabel =/);
  assert.match(source, /accessibilityLabel=\{mixBalanceLabel\}/);
  assert.match(source, /style=\{styles\.mixBar\}/);
  assert.match(source, /flex: Math\.max\(paint\.ratio, 0\.0001\)/);
});

test('editor keeps the picker open and reports a catalog load failure', () => {
  const source = fs.readFileSync(require.resolve('../components/ColorMixEditor.tsx'), 'utf8');
  const addPaint = source.slice(source.indexOf('const addPaint'), source.indexOf('const updatePercentage'));
  assert.match(addPaint, /catch \(loadError\)/);
  assert.match(addPaint, /return false/);
});

test('editor prioritizes mixing controls and keeps save status in a fixed footer', () => {
  const source = fs.readFileSync(require.resolve('../components/ColorMixEditor.tsx'), 'utf8');
  const ingredients = source.indexOf('<View style={styles.selectedHeader}>');
  const saveDetails = source.indexOf('<View style={styles.saveDetails}>');
  const scrollEnd = source.indexOf('</ScrollView>');
  const footer = source.indexOf('<View style={styles.footer}>');

  assert.match(source, /import ActionSheet/);
  assert.match(source, /IconChevronDown/);
  assert.match(source, /<ActionSheet/);
  assert.ok(ingredients >= 0 && saveDetails > ingredients, 'save details should follow the paint controls');
  assert.ok(scrollEnd >= 0 && footer > scrollEnd, 'the save footer should stay outside the scrolling content');
  assert.match(source, /styles\.footerStatus/);
});

test('mixing screen keeps the fixed editor footer above the bottom safe area', () => {
  const source = fs.readFileSync(require.resolve('../app/(tabs)/mixing.tsx'), 'utf8');
  assert.match(source, /<SafeAreaView style=\{styles\.screen\} edges=\{\['bottom'\]\}>/);
});

test('editor consolidates result and balance into an accurate fixed footer', () => {
  const source = fs.readFileSync(require.resolve('../components/ColorMixEditor.tsx'), 'utf8');
  const footerMessage = source.slice(source.indexOf('const footerMessage'), source.indexOf('const paintTypeButtons'));
  const footerMain = source.indexOf('<View style={styles.footerMain}>');
  const footerBar = source.indexOf('<View style={styles.footerMixBar}');

  assert.doesNotMatch(source, /style=\{styles\.resultCard\}/);
  assert.doesNotMatch(source, /style=\{styles\.percentageSummary\}/);
  assert.ok(footerMain >= 0 && footerBar > footerMain, 'the full-width balance bar should be the footer\'s last row');
  assert.match(source, /const balanceScale = percentageTotal > 100 \? 100 \/ percentageTotal : 1/);
  assert.match(source, /paint\.percentage \* balanceScale/);
  assert.ok(footerMessage.indexOf("draftError === 'invalid_percentage'") < footerMessage.indexOf('percentageTotal === 100'));
  assert.match(source, /accessibilityHint=\{percentageInvalid\s*\?/);
  assert.match(source, /styles\.percentageInputInvalid/);
});
