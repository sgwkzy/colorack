const assert = require('node:assert/strict');
const test = require('node:test');
const catalog = require('../assets/seed_catalog.json');

test('Vallejo water-based series use the emulsion category; alcohol-based metal paints do not', () => {
  const waterBased = ['モデルカラー', 'モデルカラー（17ml）', 'モデルカラー メタリック', '蛍光カラー', 'ボークス オリジナルカラー'];
  for (const series of waterBased) {
    const rows = catalog.filter((paint) => paint.brand === 'vallejo' && paint.series === series);
    assert.ok(rows.length, `missing series: ${series}`);
    for (const row of rows) assert.equal(row.paint_type, 'エマルジョン系水性塗料', `${series} ${row.code}`);
  }
  const alcoholBased = catalog.filter((paint) => paint.brand === 'vallejo' && paint.series === 'メタルカラー（アルコール系）');
  assert.ok(alcoholBased.length);
  for (const row of alcoholBased) assert.notEqual(row.paint_type, 'エマルジョン系水性塗料', row.code);
});
