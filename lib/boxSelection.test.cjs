const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const ts = require('typescript');

function loadBoxSelection() {
  const source = fs.readFileSync(require.resolve('./boxSelection.ts'), 'utf8');
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(require, module, module.exports);
  return module.exports;
}

test('Box selection blocks empty lists, skips one choice, and asks for several', () => {
  const { boxSelectionPlan } = loadBoxSelection();
  assert.deepEqual(boxSelectionPlan([]), { kind: 'unavailable' });
  assert.deepEqual(boxSelectionPlan([{ id: 4 }]), { kind: 'direct', boxId: 4 });
  assert.deepEqual(boxSelectionPlan([{ id: 4 }, { id: 9 }]), { kind: 'choose' });
});

test('Box selection reloads choices for every operation', async () => {
  const { loadBoxSelectionPlan } = loadBoxSelection();
  let boxes = [{ id: 4 }];
  let loads = 0;
  const load = async () => { loads += 1; return boxes; };

  assert.deepEqual(await loadBoxSelectionPlan(load), {
    boxes: [{ id: 4 }],
    plan: { kind: 'direct', boxId: 4 },
  });
  boxes = [{ id: 4 }, { id: 9 }];
  assert.deepEqual(await loadBoxSelectionPlan(load), {
    boxes: [{ id: 4 }, { id: 9 }],
    plan: { kind: 'choose' },
  });
  assert.equal(loads, 2);
});

test('Box selection lock rejects a second synchronous operation', () => {
  const { acquireBoxSelectionLock } = loadBoxSelection();
  const lock = { current: false };

  assert.equal(acquireBoxSelectionLock(lock), true);
  assert.equal(acquireBoxSelectionLock(lock), false);
  lock.current = false;
  assert.equal(acquireBoxSelectionLock(lock), true);
});

test('Box selection operation holds its lock across asynchronous loading', async () => {
  const { withBoxSelectionLock } = loadBoxSelection();
  const lock = { current: false };
  let finishLoad;
  let calls = 0;
  const loading = new Promise((resolve) => { finishLoad = resolve; });
  const first = withBoxSelectionLock(lock, async () => { calls += 1; await loading; return 'done'; });

  assert.equal(await withBoxSelectionLock(lock, async () => { calls += 1; return 'duplicate'; }), undefined);
  assert.equal(calls, 1);
  finishLoad();
  assert.equal(await first, 'done');
  assert.equal(lock.current, false);
});
