const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const ts = require('typescript');

function read(path) {
  return fs.readFileSync(require.resolve(path), 'utf8');
}

function loadKitDetailSafety() {
  const source = read('../components/KitDetailModal.tsx');
  const code = ts.transpileModule(source, {
    compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const module = { exports: {} };
  const stub = new Proxy({}, { get: () => () => {} });
  new Function('require', 'module', 'exports', code)((id) => id === 'react/jsx-runtime' ? stub : {}, module, module.exports);
  return module.exports;
}

test('kit price validation rejects malformed values before the database normalizes them away', () => {
  const { parseKitPrice } = loadKitDetailSafety();

  assert.equal(typeof parseKitPrice, 'function');
  assert.equal(parseKitPrice(''), null);
  assert.equal(parseKitPrice('1200'), 1200);
  assert.equal(parseKitPrice('-1'), undefined);
  assert.equal(parseKitPrice('12.5'), undefined);
  assert.equal(parseKitPrice('not-a-price'), undefined);
});

test('kit detail routes back gestures and Android back to edit exit while X closes the modal', () => {
  const detail = read('../components/KitDetailModal.tsx');

  assert.match(detail, /import \{ useAndroidBack \} from '\.\.\/lib\/androidBack';/);
  assert.match(detail, /const exitEditMode = async \(\) => \{[\s\S]*?if \(!\(await flushPendingFields\(\)\)\) return;[\s\S]*?setEditMode\(false\);/);
  assert.match(detail, /const closeAfterSavingFields = async \(\) => \{[\s\S]*?if \(editMode\) \{[\s\S]*?await exitEditMode\(\)/);
  assert.match(detail, /useAndroidBack\(visible && !viewerOpen, \(\) => \{/);
  assert.match(detail, /onRequestClose=\{childOverlayOpen \? \(\) => childRequestCloseRef\.current\(\) : closeAfterSavingFields\}/);
  assert.match(detail, /<SwipeBack enabled=\{visible && !viewerOpen && !childOverlayOpen\} onBack=\{closeAfterSavingFields\}>/);
  assert.match(detail, /<SwipeDownHeader onClose=\{closeAfterSavingFields\} enabled=/);
  assert.match(detail, /<TouchableOpacity[^>]*onPress=\{closeModal\}[^>]*style=\{styles\.headerButton\}/);
});

test('kit detail load ignores stale requests and exposes loading, error, and retry states', () => {
  const detail = read('../components/KitDetailModal.tsx');

  assert.match(detail, /const loadVersionRef = useRef\(0\)/);
  assert.match(detail, /const \[loadState, setLoadState\] = useState<'loading' \| 'ready' \| 'error'>\('loading'\)/);
  assert.match(detail, /const load = useCallback\(async \(seedEditFields = false\): Promise<boolean> => \{/);
  assert.match(detail, /const loadVersion = \+\+loadVersionRef\.current/);
  assert.match(detail, /if \(loadVersion !== loadVersionRef\.current\) return false;/);
  assert.match(detail, /setLoadState\('error'\)/);
  assert.match(detail, /loadState === 'loading'/);
  assert.match(detail, /loadState === 'error'/);
  assert.match(detail, /<ActivityIndicator/);
  assert.match(detail, /t\('retry'\)/);
  assert.match(detail, /loadVersionRef\.current \+= 1/);
});

test('kit color composer awaits the parent refresh before it can close', () => {
  const detail = read('../components/KitDetailModal.tsx');

  assert.match(detail, /onAdded=\{async \(\) => \{\s*await load\(\);\s*\}\}/);
  assert.doesNotMatch(detail, /onAdded=\{\(\) => \{\s*void load\(\);\s*\}\}/);
});

test('kit refresh keeps existing detail visible and reports a refresh failure', () => {
  const detail = read('../components/KitDetailModal.tsx');
  const loadFlow = detail.slice(detail.indexOf('const load = useCallback'), detail.indexOf('useEffect(() =>'));

  assert.match(loadFlow, /if \(seedEditFields\) setLoadState\('loading'\)/);
  assert.doesNotMatch(loadFlow, /const loadVersion = \+\+loadVersionRef\.current;\s*setLoadState\('loading'\)/);
  assert.match(loadFlow, /if \(seedEditFields\) setLoadState\('error'\);\s*else Alert\.alert\(t\('error'\), t\('loadFailed'\)\)/);
  assert.match(detail, /if \(visible && kitId != null\) \{\s*void load\(true\)/);
  assert.match(detail, /onPress=\{\(\) => \{ void load\(true\); \}\}/);
});

test('kit initial load error is announced to assistive technology', () => {
  const detail = read('../components/KitDetailModal.tsx');

  assert.match(detail, /<Text accessibilityRole="alert" style=\{styles\.empty\}>\{t\('loadFailed'\)\}<\/Text>/);
});

test('kit detail refuses invalid required fields and keeps save failures visible', () => {
  const detail = read('../components/KitDetailModal.tsx');
  const saveFlow = detail.slice(detail.indexOf('const validateFields'), detail.indexOf('const changeBox'));

  assert.match(saveFlow, /if \(name\.trim\(\) === ''\)[\s\S]*?return false/);
  assert.match(saveFlow, /if \(maker\.trim\(\) === ''\)[\s\S]*?return false/);
  assert.match(saveFlow, /parseKitPrice\(price\) === undefined/);
  assert.match(saveFlow, /try \{/);
  assert.match(saveFlow, /catch \(error\)[\s\S]*?reportSaveFailure\(error\)/);
  assert.match(detail, /const reportSaveFailure = \(error: unknown\) => \{[\s\S]*?Alert\.alert\(t\('error'\), t\('saveFailed'\)\)/);
  assert.match(detail, /const savePrice = async \(\) => \{[\s\S]*?parseKitPrice\(price\) === undefined/);
  assert.match(detail, /<SafeAreaView edges=\{\['bottom'\]\} style=\{styles\.editBar\}>/);
});

test('SwipeBack accepts only gestures that begin at the left edge', () => {
  const swipe = read('../components/SwipeBack.tsx');

  assert.match(swipe, /hitSlop=\{\{ left: 0, width: 32 \}\}/);
  assert.doesNotMatch(swipe, /left:\s*-32/);
});

test('photo viewer derives flexible header and footer sizes from safe-area insets', () => {
  const photo = read('../components/PhotoViewerModal.tsx');

  assert.match(photo, /SafeAreaProvider/);
  assert.match(photo, /useSafeAreaInsets\(\)/);
  assert.match(photo, /insets\.top/);
  assert.match(photo, /insets\.bottom/);
  assert.match(photo, /minHeight:/);
  assert.doesNotMatch(photo, /height:\s*116/);
  assert.doesNotMatch(photo, /height:\s*160/);
});

test('color detail accepts caller titles and hides mix balance for a single paint', () => {
  const detail = read('../components/ColorMixDetailModal.tsx');
  const kit = read('../components/KitDetailModal.tsx');
  const mixing = read('../app/(tabs)/mixing.tsx');

  assert.match(detail, /title\?: string/);
  assert.match(detail, /const headerTitle = title \?\? t\('mixResult'\)/);
  assert.match(detail, /<Text style=\{styles\.title\}>\{headerTitle\}<\/Text>/);
  assert.match(detail, /const showMixBalance = \(color\?\.paints\.length \?\? 0\) > 1/);
  assert.match(detail, /\{showMixBalance \?/);
  assert.match(kit, /<ColorMixDetailModal[\s\S]*?title=\{t\('colorInfo'\)\}/);
  assert.doesNotMatch(mixing, /title=\{t\('colorInfo'\)\}/);
});

test('kit used-color editing uses color-information copy without renaming saved-mix editing', () => {
  const detail = read('../components/KitDetailModal.tsx');
  const mixing = read('../app/(tabs)/mixing.tsx');

  assert.match(detail, /title=\{t\('editColorInfo'\)\}/);
  assert.doesNotMatch(detail, /title=\{t\('editMix'\)\}/);
  assert.match(mixing, /title=\{t\('editMix'\)\}/);
});
