const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const ts = require('typescript');

function transpile(relativePath, requireImpl, footer = '') {
  const source = fs.readFileSync(require.resolve(relativePath), 'utf8');
  const code = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', `${code}\n${footer}`)(requireImpl, module, module.exports);
  return module.exports;
}

test('restoring a completed kit writes its status and selected Box atomically', async () => {
  const statements = [];
  const db = {
    async runAsync(sql, args) {
      statements.push([sql, args]);
      return { changes: 1 };
    },
  };
  const api = transpile('./db/kits.ts', (id) => {
    if (id === './connection') return { getDB: () => db };
    if (id === './settings') return { getDefaultKitBoxId: async () => 2 };
    throw new Error(`Unexpected require: ${id}`);
  });

  await api.setKitStatus(12, 'not_started', 7);

  assert.deepEqual(statements, [[
    "UPDATE kits SET status = ?, box_id = ?, status_changed_at = datetime('now') WHERE id = ?",
    ['not_started', 7, 12],
  ]]);
});

test('completed kits reject direct Box changes at the database boundary', async () => {
  const statements = [];
  const db = {
    async runAsync(sql, args) {
      statements.push([sql, args]);
      return { changes: 0 };
    },
  };
  const api = transpile('./db/kits.ts', (id) => {
    if (id === './connection') return { getDB: () => db };
    if (id === './settings') return { getDefaultKitBoxId: async () => 2 };
    throw new Error(`Unexpected require: ${id}`);
  });

  await api.updateKitBox(12, 7);

  assert.deepEqual(statements, [[
    "UPDATE kits SET box_id = ?, status_changed_at = datetime('now') WHERE id = ? AND status != 'completed'",
    [7, 12],
  ]]);
});

test('completed list rows request a Box while active rows keep their direct status toggle', () => {
  const api = transpile(
    '../app/(tabs)/kits.tsx',
    () => ({}),
    'module.exports.kitListStatusAction = typeof kitListStatusAction === "undefined" ? undefined : kitListStatusAction;'
  );

  assert.equal(typeof api.kitListStatusAction, 'function');
  assert.deepEqual(api.kitListStatusAction('completed'), { kind: 'restore' });
  assert.deepEqual(api.kitListStatusAction('not_started'), { kind: 'update', status: 'building' });
  assert.deepEqual(api.kitListStatusAction('building'), { kind: 'update', status: 'not_started' });
});

test('completed kit details expose state changes but not direct Box changes', () => {
  const api = transpile(
    '../components/KitDetailModal.tsx',
    () => ({}),
    'module.exports.canChangeKitBox = typeof canChangeKitBox === "undefined" ? undefined : canChangeKitBox; module.exports.kitDetailStatusAction = typeof kitDetailStatusAction === "undefined" ? undefined : kitDetailStatusAction;'
  );

  assert.equal(typeof api.canChangeKitBox, 'function');
  assert.equal(api.canChangeKitBox('completed'), false);
  assert.equal(api.canChangeKitBox('not_started'), true);
  assert.equal(api.canChangeKitBox('building'), true);
  assert.equal(typeof api.kitDetailStatusAction, 'function');
  assert.deepEqual(api.kitDetailStatusAction('completed', 'building'), { kind: 'restore', status: 'building' });
  assert.deepEqual(api.kitDetailStatusAction('completed', 'not_started'), { kind: 'restore', status: 'not_started' });
  assert.deepEqual(api.kitDetailStatusAction('building', 'completed'), { kind: 'update', status: 'completed' });
  assert.deepEqual(api.kitDetailStatusAction('building', 'building'), { kind: 'noop' });
});
