const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const ts = require('typescript');

function loadAuth({ linkSubscriptionUser }) {
  const source = fs.readFileSync(require.resolve('./auth.ts'), 'utf8');
  const code = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const authInstance = {
    async signInWithCredential() {
      return { user: { uid: 'user-1' } };
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
    '@react-native-firebase/auth': { default: auth },
    '@react-native-google-signin/google-signin': { GoogleSignin: googleSignin },
    './subscription': { initSubscription: async () => {}, linkSubscriptionUser },
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
