const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const read = (file) => fs.readFileSync(require.resolve(file), 'utf8');

test('AddPaint routes native modal back through the current child', () => {
  const source = read('../components/AddPaint/index.tsx');

  assert.match(source, /const childRequestCloseRef = useRef/);
  assert.match(source, /const requestClose = \(\) =>/);
  assert.match(source, /<Modal[^>]*onRequestClose=\{requestClose\}/);
  assert.match(source, /<SwipeDownHeader onClose=\{requestClose\}>/);
  assert.match(source, /<TouchableOpacity onPress=\{requestClose\}/);
  assert.match(source, /<HierarchyBrowser[\s\S]*?requestCloseRef=\{childRequestCloseRef\}/);
  assert.match(source, /<ManualEntry[\s\S]*?onRequestClose=\{onClose\}[\s\S]*?visible=\{visible\}[\s\S]*?requestCloseRef=\{childRequestCloseRef\}/);
});

test('ActionSheet defers every iOS button callback until dismiss and keeps Android immediate', () => {
  const sheet = read('../components/ActionSheet.tsx');
  const grid = read('../components/KitPhotoGrid.tsx');
  const boxOptions = read('../components/BoxOptions.tsx');

  assert.match(sheet, /onDismiss\?: \(\) => void/);
  assert.match(sheet, /const pendingActionRef = useRef<\(\(\) => void\) \| null>\(null\)/);
  assert.match(sheet, /if \(Platform\.OS === 'ios'\) \{[\s\S]*?pendingActionRef\.current = btn\.onPress \?\? null;[\s\S]*?onClose\(\);[\s\S]*?return;/);
  assert.match(sheet, /onClose\(\);[\s\S]*?btn\.onPress\?\.\(\);/);
  assert.match(sheet, /const handleDismiss = \(\) => \{[\s\S]*?pendingActionRef\.current = null;[\s\S]*?onDismiss\?\.\(\);[\s\S]*?action\?\.\(\);/);
  assert.match(sheet, /<Modal[\s\S]*?onDismiss=\{handleDismiss\}/);
  assert.match(sheet, /mainButtons\.map[\s\S]*?onPress=\{\(\) => press\(b\)\}/);
  assert.match(sheet, /cancelButtons\.map[\s\S]*?onPress=\{\(\) => press\(b\)\}/);

  assert.doesNotMatch(grid, /pendingAction|handleSheetDismiss|Platform\.OS/);
  assert.match(grid, /onPress: \(\) => runAction\('camera'\)/);
  assert.match(grid, /onPress: \(\) => runAction\('library'\)/);
  assert.doesNotMatch(grid, /onDismiss=/);

  assert.match(boxOptions, /onPress: \(\) => setOrdering\(true\)/);
  assert.match(boxOptions, /<ActionSheet[\s\S]*?buttons=\{buttons\}/);
});

test('HierarchyBrowser exposes its one-level back handler to the parent Modal', () => {
  const source = read('../components/AddPaint/HierarchyBrowser.tsx');

  assert.match(source, /requestCloseRef\?: MutableRefObject<\(\) => void>/);
  assert.match(source, /if \(selectedBrand == null\) \{ onRequestClose\?\.\(\); return; \}/);
  assert.match(source, /if \(selectedSeries != null\) backFromPaints\(\)/);
  assert.match(source, /requestCloseRef\.current = back/);
  assert.match(source, /useAndroidBack\(selectedBrand != null, back\)/);
});

test('AddPaint and Inventory embed PaintDetail without stacking native Modals', () => {
  const addPaint = read('../components/AddPaint/index.tsx');
  const inventory = read('../components/InventoryDetailModal.tsx');
  const paintDetail = read('../components/PaintDetailModal.tsx');

  assert.match(addPaint, /<PaintDetailModal[\s\S]*?embedded[\s\S]*?requestCloseRef=\{detailRequestCloseRef\}/);
  assert.match(inventory, /<PaintDetailModal[\s\S]*?embedded[\s\S]*?requestCloseRef=\{childRequestCloseRef\}/);
  assert.match(inventory, /onRequestClose=\{childOverlayOpen \? \(\) => childRequestCloseRef\.current\(\) : closeAfterSavingNote\}/);
  assert.match(paintDetail, /embedded\?: boolean/);
  assert.match(paintDetail, /requestCloseRef\?: MutableRefObject<\(\) => void>/);
  assert.match(paintDetail, /useModalLock\(visible && !embedded\)/);
  assert.match(paintDetail, /accessibilityViewIsModal=\{embedded\}/);
  assert.match(paintDetail, /if \(embedded\) return visible \? screen : null/);
  assert.match(paintDetail, /return <Modal/);
});

test('InventoryDetail separates loading, ready and retryable error states', () => {
  const source = read('../components/InventoryDetailModal.tsx');

  assert.match(source, /type LoadState = 'loading' \| 'ready' \| 'error'/);
  assert.match(source, /const loadVersionRef = useRef\(0\)/);
  assert.match(source, /const loadVersion = \+\+loadVersionRef\.current/);
  assert.match(source, /if \(loadVersion !== loadVersionRef\.current\) return/);
  assert.match(source, /if \(visible && inventoryId != null\)/);
  assert.match(source, /setLoadState\('error'\)/);
  assert.match(source, /accessibilityRole="alert"/);
  assert.match(source, /onPress=\{\(\) => load\(true\)\}/);
  assert.match(source, /\{t\('note'\)\}/);
});

test('InventoryDetail keeps ready content during refresh and only full-load failures show retry', () => {
  const source = read('../components/InventoryDetailModal.tsx');

  assert.match(source, /const load = useCallback\(async \(fullScreen = false\) =>/);
  assert.match(source, /if \(fullScreen\) \{[\s\S]*?setLoadState\('loading'\);[\s\S]*?setDetail\(null\);[\s\S]*?\}/);
  assert.match(source, /if \(fullScreen\) \{[\s\S]*?setLoadState\('error'\);[\s\S]*?\} else \{[\s\S]*?Alert\.alert\(t\('error'\), t\('loadFailed'\)\);[\s\S]*?\}/);
  assert.match(source, /if \(visible && inventoryId != null\) \{[\s\S]*?load\(true\);/);
  assert.match(source, /onPress=\{\(\) => load\(true\)\}/);
  assert.match(source, /onChanged=\{load\}/);
});

test('InventoryDetail keeps the modal open when saving the note on close fails', () => {
  const source = read('../components/InventoryDetailModal.tsx');
  const closeFlow = source.slice(source.indexOf('const closeAfterSavingNote'), source.indexOf('\n\n  const changeBox'));

  assert.match(closeFlow, /try \{[\s\S]*?await updateInventoryNote/);
  assert.match(closeFlow, /catch \(error\) \{[\s\S]*?Alert\.alert\(t\('error'\), t\('saveFailed'\)\);[\s\S]*?return;/);
  assert.ok(closeFlow.indexOf('onClose();') > closeFlow.indexOf('catch (error)'), 'close must happen only after a successful note save');
});

test('PaintDetail blocks every close path while a save is busy', () => {
  const source = read('../components/PaintDetailModal.tsx');
  const requestClose = source.slice(source.indexOf('const requestClose'), source.indexOf('\n\n  const returnToDetail'));
  const returnToDetail = source.slice(source.indexOf('const returnToDetail'), source.indexOf('\n\n  const back'));

  assert.match(requestClose, /if \(busyRef\.current\) return;/);
  assert.match(returnToDetail, /if \(busyRef\.current\) return;/);
  assert.match(source, /<SwipeBack enabled=\{visible && !busy\}/);
  assert.match(source, /<SwipeDownHeader[\s\S]*?enabled=\{!busy\}/);
  assert.match(source, /onPress=\{returnToDetail\}[\s\S]*?disabled=\{busy\}[\s\S]*?accessibilityRole="button"[\s\S]*?accessibilityState=\{\{ disabled: busy, busy \}\}/);
  assert.match(source, /onPress=\{requestClose\}[\s\S]*?disabled=\{busy\}[\s\S]*?accessibilityRole="button"[\s\S]*?accessibilityState=\{\{ disabled: busy, busy \}\}/);
});

test('AddPaint and PaintDetail use synchronous mutation guards and classify save errors', () => {
  const addPaint = read('../components/AddPaint/index.tsx');
  const paintDetail = read('../components/PaintDetailModal.tsx');

  assert.match(addPaint, /const busyRef = useRef\(false\)/);
  assert.match(addPaint, /if \(busyRef\.current\) return/);
  assert.match(addPaint, /busyRef\.current = true/);
  assert.match(addPaint, /busyRef\.current = false/);
  assert.match(paintDetail, /const busyRef = useRef\(false\)/);
  assert.match(paintDetail, /busyRef\.current\) return/);
  assert.match(paintDetail, /busyRef\.current = true/);
  assert.match(paintDetail, /busyRef\.current = false/);
  assert.match(paintDetail, /UNIQUE constraint failed: catalog_paints\.catalog_code/);
  assert.match(paintDetail, /isDuplicateCodeError\(error\) \? t\('duplicateCodeError'\) : t\('saveFailed'\)/);
});
