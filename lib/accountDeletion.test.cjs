const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const ts = require('typescript');

function loadAccountDeletion(events) {
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
      deleteFirebaseAccount: async (deleteCloudData) => {
        events.push('reauthenticate');
        await deleteCloudData('user-1');
        events.push('delete-user');
      },
    },
    './cloudBackup': {
      deleteCloudBackup: async (uid) => events.push(`delete-backup:${uid}`),
    },
    './kitPhotoBackup': {
      deleteAllKitPhotoBackups: async (uid) => events.push(`delete-photos:${uid}`),
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

test('account deletion removes cloud photos and backup before the Firebase user', async () => {
  const events = [];
  const accountDeletion = loadAccountDeletion(events);

  await accountDeletion.deleteCurrentAccount();

  assert.deepEqual(events, [
    'reauthenticate',
    'delete-photos:user-1',
    'delete-backup:user-1',
    'delete-user',
  ]);
});
