const assert = require('node:assert/strict');
const test = require('node:test');
const limitMetroCache = require('./limitMetroCache.cjs');

test('limits concurrent cache access and preserves results, errors, and clearing', async () => {
  let active = 0;
  let peak = 0;
  let cleared = false;
  const store = {
    async get(key) {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active--;
      if (key === 3) throw new Error('cache failure');
      return key;
    },
    async set(key, value) { return `${key}:${value}`; },
    clear() { cleared = true; },
  };
  const limited = limitMetroCache(store, 4);
  const results = await Promise.allSettled(Array.from({ length: 20 }, (_, i) => limited.get(i)));
  assert.equal(peak, 4);
  assert.equal(results[3].reason.message, 'cache failure');
  assert.equal(results[19].value, 19);
  assert.equal(await limited.set('a', 'b'), 'a:b');
  limited.clear();
  assert.equal(cleared, true);
});
