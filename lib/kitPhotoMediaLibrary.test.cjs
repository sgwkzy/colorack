const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const ts = require('typescript');

function loadKitPhoto(granted, saves) {
  const source = fs.readFileSync(require.resolve('./kitPhoto.ts'), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const module = { exports: {} };
  const modules = {
    'react-native': { Image: {}, Platform: {} },
    'expo-file-system/legacy': { documentDirectory: 'file://documents/' },
    'expo-image-manipulator': {},
    'expo-image-picker': {},
    'expo-media-library': { isAvailableAsync: async () => { throw new Error('SDK 57 legacy API throws'); } },
    'expo-media-library/legacy': {
      isAvailableAsync: async () => true,
      requestPermissionsAsync: async (writeOnly) => { assert.equal(writeOnly, true); return { granted }; },
      saveToLibraryAsync: async (uri) => { saves.push(uri); },
    },
  };
  new Function('require', 'module', 'exports', code)((id) => {
    if (!(id in modules)) throw new Error(`Unexpected module: ${id}`);
    return modules[id];
  }, module, module.exports);
  return module.exports;
}

test('saveKitPhotoToLibrary uses the compatible media API and respects denied permission', async () => {
  const saves = [];
  assert.equal(await loadKitPhoto(true, saves).saveKitPhotoToLibrary('file://photo.jpg'), true);
  assert.deepEqual(saves, ['file://photo.jpg']);
  assert.equal(await loadKitPhoto(false, saves).saveKitPhotoToLibrary('file://private.jpg'), false);
  assert.deepEqual(saves, ['file://photo.jpg']);
});
