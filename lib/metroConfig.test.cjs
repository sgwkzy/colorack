const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const config = require('../metro.config.js');

function isBlocked(filePath) {
  const patterns = Array.isArray(config.resolver.blockList)
    ? config.resolver.blockList
    : [config.resolver.blockList];

  return patterns.some((pattern) => pattern.test(filePath));
}

test('Metro excludes non-JavaScript native trees that exhaust Windows file handles', () => {
  const root = path.resolve(__dirname, '..');

  for (const directory of ['android', 'ios', 'windows', 'macos']) {
    assert.equal(
      isBlocked(path.join(root, 'node_modules', 'example-package', directory, 'src', 'native.cpp')),
      true,
      `${directory} should not be watched by Metro`,
    );
  }

  assert.equal(isBlocked(path.join(root, '.superpowers', 'sdd', 'task-brief.md')), true);
  assert.equal(
    isBlocked(path.join(root, 'node_modules', 'react-native', 'Libraries', 'ReactNative', 'AppRegistry.js')),
    false,
  );
});
