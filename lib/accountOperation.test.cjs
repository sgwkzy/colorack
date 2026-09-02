const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const ts = require('typescript');

function loadAccountOperation() {
  const source = fs.readFileSync(require.resolve('./accountOperation.ts'), 'utf8');
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  new Function('module', 'exports', code)(module, module.exports);
  return module.exports;
}

test('account operations are serialized', async () => {
  const { runAccountOperation } = loadAccountOperation();
  let releaseFirst;
  const events = [];
  const first = runAccountOperation(async () => {
    events.push('first-start');
    await new Promise((resolve) => { releaseFirst = resolve; });
    events.push('first-end');
  });
  const second = runAccountOperation(async () => events.push('second'));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ['first-start']);
  releaseFirst();
  await Promise.all([first, second]);
  assert.deepEqual(events, ['first-start', 'first-end', 'second']);
});
