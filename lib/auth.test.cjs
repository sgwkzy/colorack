const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const ts = require('typescript');

function loadAuth({
  linkSubscriptionUser,
  entitlements = { hasBackup: false, hasPhotoBackup: false },
  getIdTokenResult = async () => ({ claims: {} }),
  onCredential = () => {},
  onAppleOptions = () => {},
  initialProviderIds = [],
  linkCredentialError = null,
  platform = 'ios',
  appleAuthorizationCode = 'apple-code',
  onReauthenticate = () => {},
  onRevoke = () => {},
  onDelete = () => {},
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
    displayName: null,
    email: 'user@example.com',
    providerData: initialProviderIds.map((providerId) => ({ providerId })),
    async getIdToken() {
      return 'firebase-token';
    },
    getIdTokenResult,
    async linkWithCredential(credential) {
      onCredential(credential);
      if (linkCredentialError) throw linkCredentialError;
      const providerId = credential.provider === 'apple' ? 'apple.com' : 'google.com';
      if (!this.providerData.some((provider) => provider.providerId === providerId)) {
        this.providerData.push({ providerId });
      }
      return { user: this };
    },
    async reauthenticateWithCredential(credential) {
      onReauthenticate(credential);
      return { user: this };
    },
    async delete() {
      onDelete();
    },
  };
  const authInstance = {
    currentUser: firebaseUser,
    async signInWithCredential(credential) {
      onCredential(credential);
      return { user: firebaseUser };
    },
    async revokeToken(authorizationCode) {
      onRevoke(authorizationCode);
    },
  };
  const auth = Object.assign(
    () => authInstance,
    {
      GoogleAuthProvider: { credential: (token) => ({ provider: 'google', token }) },
      AppleAuthProvider: {
        credential: (token, nonce) => ({ provider: 'apple', token, nonce }),
      },
    }
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
    'react-native': { Platform: { OS: platform } },
    'expo-constants': { __esModule: true, default: { appOwnership: 'standalone' } },
    'expo-apple-authentication': {
      isAvailableAsync: async () => true,
      signInAsync: async (options) => {
        onAppleOptions(options);
        return { identityToken: 'apple-token', authorizationCode: appleAuthorizationCode };
      },
      AppleAuthenticationScope: { FULL_NAME: 0, EMAIL: 1 },
    },
    'expo-crypto': {
      CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
      getRandomBytesAsync: async () => new Uint8Array(32).fill(1),
      digestStringAsync: async () => 'hashed-nonce',
    },
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

test('Apple sign-in waits for RevenueCat identity before returning', async () => {
  let linkedUid = null;
  let firebaseCredential = null;
  let appleOptions = null;
  const auth = loadAuth({
    linkSubscriptionUser: async (uid) => {
      linkedUid = uid;
    },
    onCredential: (credential) => {
      firebaseCredential = credential;
    },
    onAppleOptions: (options) => {
      appleOptions = options;
    },
  });

  await auth.signInWithApple();
  assert.equal(linkedUid, 'user-1');
  assert.equal(appleOptions.nonce, 'hashed-nonce');
  assert.deepEqual(firebaseCredential, {
    provider: 'apple',
    token: 'apple-token',
    nonce: '1'.repeat(32),
  });
});

test('linking Google preserves the Firebase uid and adds the provider', async () => {
  let linkedUid = null;
  const auth = loadAuth({
    initialProviderIds: ['apple.com'],
    linkSubscriptionUser: async (uid) => {
      linkedUid = uid;
    },
  });

  await auth.linkGoogleAccount();
  assert.equal(linkedUid, 'user-1');
  assert.deepEqual(auth.getCurrentAuthUser(), {
    uid: 'user-1',
    displayName: null,
    email: 'user@example.com',
    providerIds: ['apple.com', 'google.com'],
  });
});

test('an existing credential conflict is identified without merging accounts', async () => {
  const conflict = { code: 'auth/credential-already-in-use' };
  const auth = loadAuth({
    initialProviderIds: ['apple.com'],
    linkSubscriptionUser: async () => {
      assert.fail('RevenueCat identity must not change after a link conflict');
    },
    linkCredentialError: conflict,
  });

  await assert.rejects(auth.linkGoogleAccount(), conflict);
  assert.equal(auth.isAccountLinkConflict(conflict), true);
});

test('Apple account deletion reauthenticates before cloud deletion and token revocation', async () => {
  const events = [];
  const auth = loadAuth({
    initialProviderIds: ['apple.com', 'google.com'],
    linkSubscriptionUser: async () => {},
    onReauthenticate: () => events.push('reauthenticate'),
    onRevoke: (code) => events.push(`revoke:${code}`),
    onDelete: () => events.push('delete-user'),
  });

  await auth.deleteFirebaseAccount(async (uid) => {
    assert.equal(uid, 'user-1');
    events.push('delete-cloud');
  });

  assert.deepEqual(events, [
    'reauthenticate',
    'delete-cloud',
    'revoke:apple-code',
    'delete-user',
  ]);
});

test('Apple-linked account deletion is blocked on Android before cloud data changes', async () => {
  const auth = loadAuth({
    platform: 'android',
    initialProviderIds: ['apple.com', 'google.com'],
    linkSubscriptionUser: async () => {},
  });
  let cloudDeleted = false;

  await assert.rejects(
    auth.deleteFirebaseAccount(async () => {
      cloudDeleted = true;
    }),
    (error) => auth.isAppleDeviceRequiredForDeletion(error)
  );
  assert.equal(cloudDeleted, false);
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
