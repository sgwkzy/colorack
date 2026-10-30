const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const ts = require('typescript');

function load() {
  const code = ts.transpileModule(fs.readFileSync(require.resolve('./imageColorRegion.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  const module = { exports: {} };
  new Function('exports', code)(module.exports);
  return module.exports;
}

test('the center frame maps to original pixels after zoom and pan', () => {
  const { imageColorRegion } = load();
  assert.deepEqual(imageColorRegion(1000, 800, 0.5, 0, 0, 100), {
    originX: 400, originY: 300, width: 200, height: 200,
  });
  assert.deepEqual(imageColorRegion(1000, 800, 1, 100, -50, 100), {
    originX: 350, originY: 400, width: 100, height: 100,
  });
});

test('pan is limited so the whole sampling frame stays over the image', () => {
  const { constrainImagePosition, imageColorRegion } = load();
  const position = constrainImagePosition(1000, 800, 0.5, 999, -999, 100);
  assert.deepEqual(position, { x: 200, y: -150 });
  assert.deepEqual(imageColorRegion(1000, 800, 0.5, position.x, position.y, 100), {
    originX: 0, originY: 600, width: 200, height: 200,
  });
  assert.deepEqual(imageColorRegion(13, 9, 100 / 9, 0, 0, 100), {
    originX: 2, originY: 0, width: 9, height: 9,
  });
});
