const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const ts = require('typescript');

function loadCloudBackup({
  db,
  downloadKitPhotosForRestore,
  deleteKitPhoto,
  appOwnership = 'expo',
  firestoreSet = async () => {},
  addAppStateListener = () => {},
}) {
  const source = fs.readFileSync(require.resolve('./cloudBackup.ts'), 'utf8');
  const code = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const module = { exports: {} };
  const mocks = {
    'react-native': { AppState: { currentState: 'active', addEventListener: addAppStateListener } },
    'expo-constants': { __esModule: true, default: { appOwnership } },
    '@react-native-firebase/auth': {
      default: () => ({ currentUser: { uid: 'user-1' } }),
    },
    '@react-native-firebase/firestore': {
      default: Object.assign(
        () => ({
          collection: () => ({
            doc: () => ({ set: firestoreSet }),
          }),
        }),
        { FieldValue: { serverTimestamp: () => 'server-time' } }
      ),
    },
    './db': {
      catalogCode: (brand, series, code) => `${brand}|${series}|${code}`,
      getDB: () => db,
      getSetting: async () => null,
      setSetting: async () => {},
    },
    './kitPhoto': { deleteKitPhoto },
    './kitPhotoBackup': {
      downloadKitPhotosForRestore,
      uploadPendingKitPhotos: async () => {},
    },
    './subscription': {
      getEntitlements: () => ({ hasBackup: true, hasPhotoBackup: true }),
    },
  };
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

test('failed photo preflight leaves existing local backup untouched', async () => {
  let transactionCalls = 0;
  let deletedPhotoCalls = 0;
  const db = {
    async withTransactionAsync(fn) {
      transactionCalls++;
      await fn();
    },
    async getAllAsync(sql) {
      return sql === 'SELECT uri FROM kit_photos' ? [{ uri: 'file:///old.jpg' }] : [];
    },
    async runAsync(sql) {
      if (sql.startsWith('INSERT INTO kit_boxes')) return { lastInsertRowId: 1 };
      if (sql.startsWith('INSERT INTO kits')) return { lastInsertRowId: 2 };
      return { lastInsertRowId: 0 };
    },
  };
  const cloudBackup = loadCloudBackup({
    db,
    downloadKitPhotosForRestore: async () => new Map(),
    deleteKitPhoto: async () => {
      deletedPhotoCalls++;
    },
  });
  const snapshot = {
    schemaVersion: 3,
    boxes: [],
    manualPaints: [],
    officialPaintNotes: [],
    inventory: [],
    favorites: [],
    wishlist: [],
    defaultBoxLocalRef: null,
    kitBoxes: [{ localRef: 'kitbox_1', name: 'Box', icon: 'box', icon_color: '#000', sort_order: 0 }],
    kits: [{
      localRef: 'kit_1',
      kitBoxLocalRef: 'kitbox_1',
      name: 'Kit',
      maker: 'Maker',
      series: null,
      category: null,
      scale: null,
      note: null,
      price: null,
      status: 'not_started',
      added_at: null,
      status_changed_at: null,
    }],
    kitPhotos: [{ kitLocalRef: 'kit_1', storagePath: 'users/u/kit-photos/photo.jpg', sort_order: 0 }],
  };

  await assert.rejects(cloudBackup.restoreFromSnapshot(snapshot), /download/i);
  assert.equal(transactionCalls, 0);
  assert.equal(deletedPhotoCalls, 0);
});

test('newer backup schema is rejected before touching local data', async () => {
  let transactionCalls = 0;
  const cloudBackup = loadCloudBackup({
    db: {
      async withTransactionAsync() {
        transactionCalls++;
      },
    },
    downloadKitPhotosForRestore: async () => new Map(),
    deleteKitPhoto: async () => {},
  });
  const snapshot = {
    schemaVersion: 4,
    boxes: [],
    manualPaints: [],
    officialPaintNotes: [],
    inventory: [],
    favorites: [],
    wishlist: [],
    defaultBoxLocalRef: null,
  };

  await assert.rejects(cloudBackup.restoreFromSnapshot(snapshot), /schema/i);
  assert.equal(transactionCalls, 0);
});

test('push waits until restore photo preflight and transaction finish', async () => {
  let releaseDownload;
  let firestoreSetCalls = 0;
  const downloadBlocked = new Promise((resolve) => {
    releaseDownload = resolve;
  });
  const db = {
    async withTransactionAsync(fn) {
      await fn();
    },
    async getAllAsync(sql) {
      return sql === 'SELECT uri FROM kit_photos' ? [] : [];
    },
    async getFirstAsync() {
      return null;
    },
    async runAsync(sql) {
      if (sql.startsWith('INSERT INTO kit_boxes')) return { lastInsertRowId: 1 };
      if (sql.startsWith('INSERT INTO kits')) return { lastInsertRowId: 2 };
      return { lastInsertRowId: 0 };
    },
  };
  const cloudBackup = loadCloudBackup({
    db,
    appOwnership: 'standalone',
    deleteKitPhoto: async () => {},
    downloadKitPhotosForRestore: async () => {
      await downloadBlocked;
      return new Map([['users/u/kit-photos/photo.jpg', 'file:///restored.jpg']]);
    },
    firestoreSet: async () => {
      firestoreSetCalls++;
    },
  });
  const snapshot = {
    schemaVersion: 3,
    boxes: [],
    manualPaints: [],
    officialPaintNotes: [],
    inventory: [],
    favorites: [],
    wishlist: [],
    defaultBoxLocalRef: null,
    kitBoxes: [{ localRef: 'kitbox_1', name: 'Box', icon: 'box', icon_color: '#000', sort_order: 0 }],
    kits: [{
      localRef: 'kit_1',
      kitBoxLocalRef: 'kitbox_1',
      name: 'Kit',
      maker: 'Maker',
      series: null,
      category: null,
      scale: null,
      note: null,
      price: null,
      status: 'not_started',
      added_at: null,
      status_changed_at: null,
    }],
    kitPhotos: [{ kitLocalRef: 'kit_1', storagePath: 'users/u/kit-photos/photo.jpg', sort_order: 0 }],
  };

  const restore = cloudBackup.restoreFromSnapshot(snapshot);
  const push = cloudBackup.pushBackupToFirestore();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(firestoreSetCalls, 0);
  releaseDownload();
  await Promise.all([restore, push]);
  assert.equal(firestoreSetCalls, 1);
});

test('auto backup retries on initialization and foreground return', async () => {
  let appStateListener;
  let firestoreSetCalls = 0;
  const db = {
    async getAllAsync() {
      return [];
    },
    async getFirstAsync() {
      return null;
    },
  };
  const cloudBackup = loadCloudBackup({
    db,
    appOwnership: 'standalone',
    downloadKitPhotosForRestore: async () => new Map(),
    deleteKitPhoto: async () => {},
    addAppStateListener: (_event, listener) => {
      appStateListener = listener;
    },
    firestoreSet: async () => {
      firestoreSetCalls++;
    },
  });

  cloudBackup.initAutoBackup();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(firestoreSetCalls, 1);

  appStateListener('background');
  await new Promise((resolve) => setImmediate(resolve));
  appStateListener('active');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(firestoreSetCalls, 3);
});
