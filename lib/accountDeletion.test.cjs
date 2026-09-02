const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const ts = require('typescript');

function loadAccountDeletion(events, fetchImpl) {
  const source = fs.readFileSync(require.resolve('./accountDeletion.ts'), 'utf8');
  const code = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const mocks = {
    './auth': {
      deleteFirebaseAccount: async (deleteAccountOnServer) => {
        events.push('reauthenticate');
        await deleteAccountOnServer({
          uid: 'user-1',
          idToken: 'firebase-token',
          projectId: 'colorack-test',
        });
        return { appleManualRevocationRequired: false };
      },
    },
    './subscription': {
      logOutSubscriptionUser: async (uid) => events.push(`logout:${uid}`),
      linkSubscriptionUser: async (uid) => events.push(`relink:${uid}`),
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
  return {
    accountDeletion: module.exports,
    run: async (operation) => {
      const originalFetch = global.fetch;
      global.fetch = fetchImpl;
      try {
        return await operation(module.exports);
      } finally {
        global.fetch = originalFetch;
      }
    },
  };
}

test('account deletion logs out RevenueCat before calling the trusted server', async () => {
  const events = [];
  const loaded = loadAccountDeletion(events, async (url, options) => {
    events.push(`server:${url}:${options.headers.Authorization}`);
    return { ok: true };
  });

  await loaded.run((accountDeletion) => accountDeletion.deleteCurrentAccount());
  assert.deepEqual(events, [
    'reauthenticate',
    'logout:user-1',
    'server:https://asia-northeast1-colorack-test.cloudfunctions.net/deleteAccount:Bearer firebase-token',
  ]);
});

test('account deletion restores RevenueCat identity after a server failure', async () => {
  const events = [];
  const loaded = loadAccountDeletion(events, async () => ({
    ok: false,
    status: 500,
    text: async () => 'failed',
  }));

  await assert.rejects(
    loaded.run((accountDeletion) => accountDeletion.deleteCurrentAccount()),
    /Account deletion failed/
  );
  assert.deepEqual(events, [
    'reauthenticate',
    'logout:user-1',
    'relink:user-1',
  ]);
});
