const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const ts = require('typescript');

function loadSubscription({ getSetting, setSetting, runAsync, customerInfo }) {
  const source = fs.readFileSync(require.resolve('./subscription.ts'), 'utf8');
  const code = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const purchases = {
    configure() {},
    addCustomerInfoUpdateListener() {},
    async getCustomerInfo() {
      return customerInfo;
    },
  };
  const mocks = {
    react: { useEffect() {}, useReducer: () => [0, () => {}] },
    'react-native': { Platform: { OS: 'android' } },
    'expo-constants': { __esModule: true, default: { appOwnership: 'standalone' } },
    'react-native-purchases': { default: purchases },
    'react-native-purchases-ui': { default: {} },
    './db': {
      getDB: () => ({ runAsync }),
      getSetting,
      setSetting,
    },
  };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(
    (id) => {
      if (id in mocks) return mocks[id];
      throw new Error(`Unexpected require: ${id}`);
    },
    module,
    module.exports
  );
  return module.exports;
}

test('restored photo entitlement marks local photos for re-upload', async () => {
  process.env.EXPO_PUBLIC_REVENUECAT_API_KEY_ANDROID = 'test-key';
  const settings = new Map([['photo_backup_entitled', '0']]);
  let resetCalls = 0;
  const subscription = loadSubscription({
    getSetting: async (key) => settings.get(key) ?? null,
    setSetting: async (key, value) => settings.set(key, value),
    runAsync: async (sql) => {
      if (sql === 'UPDATE kit_photos SET synced_at = NULL, storage_path = NULL') resetCalls++;
    },
    customerInfo: {
      entitlements: { active: { backup: {}, backup_photos: {} } },
    },
  });

  await subscription.initSubscription();

  assert.equal(resetCalls, 1);
  assert.equal(settings.get('photo_backup_entitled'), '1');
  assert.deepEqual(subscription.getEntitlements(), { hasBackup: true, hasPhotoBackup: true });
});
