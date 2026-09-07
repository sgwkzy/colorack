const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('deleteAccount allows the public deletion page origin', () => {
  const source = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
  assert.match(source, /cors:\s*\[\s*['"]https:\/\/sgwkzy\.github\.io['"]\s*\]/);
});
