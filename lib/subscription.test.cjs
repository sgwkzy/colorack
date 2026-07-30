const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const ts = require('typescript');

function loadSubscription({ getSetting, setSetting, runAsync, customerInfo, logIn, logOut, getAppUserID, isAnonymous, presentPaywall }) {
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
    async getAppUserID() {
      return getAppUserID ? getAppUserID() : '$RCAnonymousID:test';
    },
    async isAnonymous() {
      return isAnonymous ? isAnonymous() : true;
    },
    async logIn(uid) {
      if (logIn) return logIn(uid);
      return { customerInfo };
    },
    async logOut() {
      if (logOut) return logOut();
      return customerInfo;
    },
  };
  const mocks = {
    react: { useEffect() {}, useReducer: () => [0, () => {}] },
    'react-native': { Platform: { OS: 'android' } },
    'expo-constants': { __esModule: true, default: { appOwnership: 'standalone' } },
    'react-native-purchases': { default: purchases },
    'react-native-purchases-ui': { default: { presentPaywall } },
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

test('RevenueCat identity changes are serialized across Firebase users', async () => {
  process.env.EXPO_PUBLIC_REVENUECAT_API_KEY_ANDROID = 'test-key';
  const customerInfo = {
    entitlements: { active: { backup: {} } },
  };
  let releaseFirst;
  const calls = [];
  const subscription = loadSubscription({
    getSetting: async () => null,
    setSetting: async () => {},
    runAsync: async () => {},
    customerInfo,
    logIn: async (uid) => {
      calls.push(uid);
      if (uid === 'user-1') {
        await new Promise((resolve) => {
          releaseFirst = resolve;
        });
      }
      return { customerInfo };
    },
  });

  await subscription.initSubscription();
  const first = subscription.linkSubscriptionUser('user-1');
  const second = subscription.linkSubscriptionUser('user-2');
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, ['user-1']);
  releaseFirst();
  await Promise.all([first, second]);

  assert.deepEqual(calls, ['user-1', 'user-2']);
});

test('paywall is blocked when the RevenueCat user does not match Firebase', async () => {
  process.env.EXPO_PUBLIC_REVENUECAT_API_KEY_ANDROID = 'test-key';
  let presented = false;
  const subscription = loadSubscription({
    getSetting: async () => null,
    setSetting: async () => {},
    runAsync: async () => {},
    customerInfo: { entitlements: { active: {} } },
    getAppUserID: () => 'user-2',
    isAnonymous: () => false,
    presentPaywall: async () => { presented = true; },
  });

  await subscription.initSubscription();
  await assert.rejects(subscription.presentPaywall('user-1'), /RevenueCat user changed/);
  assert.equal(presented, false);
});

test('account deletion logs out the matching RevenueCat user', async () => {
  process.env.EXPO_PUBLIC_REVENUECAT_API_KEY_ANDROID = 'test-key';
  let loggedOut = false;
  const customerInfo = { entitlements: { active: {} } };
  const subscription = loadSubscription({
    getSetting: async () => null,
    setSetting: async () => {},
    runAsync: async () => {},
    customerInfo,
    getAppUserID: () => 'user-1',
    isAnonymous: () => false,
    logOut: async () => {
      loggedOut = true;
      return customerInfo;
    },
  });

  await subscription.initSubscription();
  await subscription.logOutSubscriptionUser('user-1');

  assert.equal(loggedOut, true);
});
