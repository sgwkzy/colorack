const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const ts = require('typescript');

function loadCatalogUpdate() {
  const source = fs.readFileSync(require.resolve('./catalogUpdate.ts'), 'utf8');
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
      if (id === 'expo-file-system' || id === 'expo-sqlite' || id === './db') return {};
      throw new Error(`Unexpected require: ${id}`);
    },
    module,
    module.exports
  );
  return module.exports;
}

const validManifest = {
  version: 22,
  sqlite_url: 'https://github.com/sgwkzy/colorack/releases/download/catalog-v22/catalog_release.sqlite3',
  md5: 'a'.repeat(32),
  size_bytes: 1024,
  row_count: 100,
  released_at: '2026-09-02T00:00:00Z',
};

test('catalog manifest validation requires all integrity metadata', () => {
  const { validateCatalogManifest } = loadCatalogUpdate();
  assert.deepEqual(validateCatalogManifest(validManifest), validManifest);

  for (const [field, value] of [
    ['md5', 'not-an-md5'],
    ['size_bytes', 0],
    ['row_count', 99],
    ['released_at', 'not-a-date'],
  ]) {
    assert.throws(() => validateCatalogManifest({ ...validManifest, [field]: value }), /manifest format invalid/);
  }
});

test('catalog manifest validation accepts only GitHub HTTPS download URLs', () => {
  const { validateCatalogManifest } = loadCatalogUpdate();
  assert.throws(
    () => validateCatalogManifest({ ...validManifest, sqlite_url: 'https://example.test/catalog.sqlite3' }),
    /manifest format invalid/
  );
});
