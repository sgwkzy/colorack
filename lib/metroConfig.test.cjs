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
  assert.equal(isBlocked(path.join(root, 'node_modules', 'react-native-screens', 'src', 'components', 'ios', 'Component.ios.tsx')), false);
  assert.equal(isBlocked(path.join(root, 'node_modules', '@scope', 'package', 'ios', 'native.mm')), true);
  assert.equal(isBlocked(path.join(root, 'node_modules', 'react-native', 'ReactAndroid', 'src', 'native.cpp')), true);
  assert.equal(isBlocked(path.join(root, 'node_modules', 'react-native', 'ReactCommon', 'yoga', 'native.cpp')), true);
  assert.equal(isBlocked(path.join(root, 'node_modules', 'firebase', 'compat', 'auth', 'dist', 'esm', 'auth', 'index.d.ts')), true);
  assert.equal(isBlocked(path.join(root, 'node_modules', 'firebase', 'compat', 'auth', 'dist', 'esm', 'index.esm.js')), false);
  assert.equal(isBlocked(path.join(root, 'node_modules', '@firebase', 'auth', 'dist', 'rn', 'index.js')), false);
  assert.equal(
    isBlocked(path.join(root, 'node_modules', 'react-native', 'Libraries', 'ReactNative', 'AppRegistry.js')),
    false,
  );
});
