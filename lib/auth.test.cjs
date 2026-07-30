const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const ts = require('typescript');

function loadAuth({
  linkSubscriptionUser,
  entitlements = { hasBackup: false, hasPhotoBackup: false },
  getIdTokenResult = async () => ({ claims: {} }),
}) {
  const source = fs.readFileSync(require.resolve('./auth.ts'), 'utf8');
  const code = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const firebaseUser = {
    uid: 'user-1',
    async getIdToken() {
      return 'firebase-token';
    },
    getIdTokenResult,
  };
  const authInstance = {
    currentUser: firebaseUser,
    async signInWithCredential() {
      return { user: firebaseUser };
    },
  };
  const auth = Object.assign(
    () => authInstance,
    { GoogleAuthProvider: { credential: (token) => ({ token }) } }
  );
  const googleSignin = {
    configure() {},
    async hasPlayServices() {},
    async signIn() {},
    async getTokens() {
      return { idToken: 'id-token' };
    },
  };
  const mocks = {
    react: { useEffect() {}, useReducer: () => [0, () => {}] },
    'expo-constants': { __esModule: true, default: { appOwnership: 'standalone' } },
    './accountOperation': { runAccountOperation: (operation) => operation() },
    '@react-native-firebase/auth': { default: auth },
    '@react-native-google-signin/google-signin': { GoogleSignin: googleSignin },
    './subscription': {
      getEntitlements: () => entitlements,
      initSubscription: async () => {},
      linkSubscriptionUser,
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

test('Google sign-in waits for RevenueCat identity before returning', async () => {
  let releaseLink;
  let linkCalls = 0;
  let signInResolved = false;
  const auth = loadAuth({
    linkSubscriptionUser: async (uid) => {
      assert.equal(uid, 'user-1');
      linkCalls++;
      await new Promise((resolve) => {
        releaseLink = resolve;
      });
    },
  });

  const signIn = auth.signInWithGoogle().then(() => {
    signInResolved = true;
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(linkCalls, 1);
  assert.equal(signInResolved, false);
  releaseLink();
  await signIn;
  assert.equal(signInResolved, true);
});

test('permission denial waits for RevenueCat claims and retries once', async () => {
  const auth = loadAuth({
    linkSubscriptionUser: async () => {},
    entitlements: { hasBackup: true, hasPhotoBackup: false },
    getIdTokenResult: async () => ({ claims: { revenueCatEntitlements: ['backup'] } }),
  });
  let attempts = 0;
  const result = await auth.withFreshFirebaseTokenRetry(async () => {
    attempts++;
    if (attempts === 1) throw { code: 'firestore/permission-denied' };
    return 'ok';
  });

  assert.equal(result, 'ok');
  assert.equal(attempts, 2);
});
