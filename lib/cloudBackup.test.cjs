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
  firestoreGet = async () => ({ exists: () => false }),
  addAppStateListener = () => {},
  getSetting = async (key) => key === 'cloud_backup_ready_uid' ? 'user-1' : null,
  setSetting = async () => {},
  getCurrentUser = () => ({ uid: 'user-1' }),
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
  let operationTail = Promise.resolve();
  const mocks = {
    'react-native': { AppState: { currentState: 'active', addEventListener: addAppStateListener } },
    'expo-constants': { __esModule: true, default: { appOwnership } },
    './accountOperation': {
      runAccountOperation: (operation) => {
        const result = operationTail.then(operation, operation);
        operationTail = result.then(() => undefined, () => undefined);
        return result;
      },
    },
    '@react-native-firebase/auth': {
      default: () => ({ currentUser: getCurrentUser() }),
    },
    '@react-native-firebase/firestore': {
      default: Object.assign(
        () => ({
          collection: () => ({
            doc: () => ({ set: firestoreSet, get: firestoreGet }),
          }),
        }),
        { FieldValue: { serverTimestamp: () => 'server-time' } }
      ),
    },
    './db': {
      catalogCode: (brand, series, code) => `${brand}|${series}|${code}`,
      getDB: () => db,
      getSetting,
      setSetting,
    },
    './kitPhoto': { deleteKitPhoto },
    './kitPhotoBackup': {
      downloadKitPhotosForRestore,
      uploadPendingKitPhotos: async () => {},
    },
    './subscription': {
      getEntitlements: () => ({ hasBackup: true, hasPhotoBackup: true }),
    },
    './auth': {
      withFreshFirebaseTokenRetry: (operation) => operation(),
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

function emptySnapshot(schemaVersion) {
  return {
    schemaVersion,
    boxes: [],
    manualPaints: [],
    officialPaintNotes: [],
    inventory: [],
    favorites: [],
    wishlist: [],
    defaultBoxLocalRef: null,
  };
}

function backupReadDb({ kitWishlist = [] } = {}) {
  return {
    async withExclusiveTransactionAsync(fn) { await fn(this); },
    async getAllAsync(sql) {
      if (sql.includes('FROM kit_wishlist')) return kitWishlist;
      return [];
    },
    async getFirstAsync() { return null; },
  };
}

function restoreDb(statements) {
  return {
    async withExclusiveTransactionAsync(fn) { await fn(this); },
    async getAllAsync() { return []; },
    async getFirstAsync() { return null; },
    async runAsync(sql, args) {
      statements.push([sql, args]);
      return { lastInsertRowId: statements.length };
    },
  };
}

test('v5 snapshot stores independent kit shopping candidates', async () => {
  const db = backupReadDb({
    kitWishlist: [{ id: 4, name: 'RX-78', maker: 'Bandai', series: 'HG', category: null, scale: '1/144', note: null, price: 2200, added_at: '2026-08-31' }],
  });
  const backup = loadCloudBackup({ db, appOwnership: 'standalone', downloadKitPhotosForRestore: async () => new Map(), deleteKitPhoto: async () => {} });
  const snapshot = await backup.buildBackupSnapshot();
  assert.equal(snapshot.schemaVersion, 5);
  assert.deepEqual(snapshot.kitWishlist, [{ name: 'RX-78', maker: 'Bandai', series: 'HG', category: null, scale: '1/144', note: null, price: 2200, added_at: '2026-08-31' }]);
});

test('snapshot reads all SQLite state through one exclusive transaction', async () => {
  let transactionCalls = 0;
  let directRead = false;
  const reads = [];
  const tx = {
    async getAllAsync(sql) { reads.push(sql); return []; },
    async getFirstAsync(sql) { reads.push(sql); return null; },
  };
  const db = {
    async withExclusiveTransactionAsync(fn) { transactionCalls++; await fn(tx); },
    async getAllAsync() { directRead = true; throw new Error('direct DB read'); },
    async getFirstAsync() { directRead = true; throw new Error('direct DB read'); },
  };
  const backup = loadCloudBackup({ db, downloadKitPhotosForRestore: async () => new Map(), deleteKitPhoto: async () => {} });

  await backup.buildBackupSnapshot();

  assert.equal(transactionCalls, 1);
  assert.equal(directRead, false);
  assert.ok(reads.length > 0);
  assert.equal(reads.filter((sql) => sql.includes('FROM app_settings')).length, 2);
});

test('v5 restore replaces local kit shopping candidates', async () => {
  const statements = [];
  const db = restoreDb(statements);
  const backup = loadCloudBackup({ db, appOwnership: 'standalone', downloadKitPhotosForRestore: async () => new Map(), deleteKitPhoto: async () => {} });
  await backup.restoreFromSnapshot({ ...emptySnapshot(5), kitWishlist: [{ name: 'RX-78', maker: 'Bandai', series: null, category: null, scale: null, note: null, price: null, added_at: '2026-08-31' }] }, 'user-1');
  assert.ok(statements.some(([sql]) => sql === 'DELETE FROM kit_wishlist'));
  assert.ok(statements.some(([sql]) => sql.startsWith('INSERT INTO kit_wishlist')));
});

test('local-empty detection counts kit shopping candidates', async () => {
  let capturedSql = '';
  const db = {
    async getFirstAsync(sql) {
      capturedSql = sql;
      return { n: 1 };
    },
  };
  const backup = loadCloudBackup({ db, downloadKitPhotosForRestore: async () => new Map(), deleteKitPhoto: async () => {} });
  assert.equal(await backup.isLocalDbEmpty(), false);
  assert.match(capturedSql, /COUNT\(\*\) FROM kit_wishlist/);
});

test('v5 snapshot stores recipes by local reference and paints by catalog code', async () => {
  const db = {
    async withExclusiveTransactionAsync(fn) { await fn(this); },
    async getAllAsync(sql) {
      if (sql.includes('FROM mix_recipes')) {
        return [{
          id: 3,
          name: 'Warm gray',
          note: null,
          sort_order: 0,
          added_at: '2026-08-29',
          updated_at: '2026-08-29',
        }];
      }
      if (sql.includes('FROM mix_recipe_paints')) {
        return [{
          mix_recipe_id: 3,
          catalog_code: 'brand|series|code',
          brand: 'brand',
          series: 'series',
          code: 'code',
          ratio: 1,
          sort_order: 0,
        }];
      }
      return [];
    },
    async getFirstAsync() { return null; },
  };
  const cloudBackup = loadCloudBackup({
    db,
    appOwnership: 'standalone',
    downloadKitPhotosForRestore: async () => new Map(),
    deleteKitPhoto: async () => {},
  });

  const snapshot = await cloudBackup.buildBackupSnapshot();

  assert.equal(snapshot.schemaVersion, 5);
  assert.deepEqual(snapshot.mixRecipes, [{
    localRef: 'mixrecipe_3',
    name: 'Warm gray',
    note: null,
    sort_order: 0,
    added_at: '2026-08-29',
    updated_at: '2026-08-29',
  }]);
  assert.deepEqual(snapshot.mixRecipePaints[0], {
    mixRecipeLocalRef: 'mixrecipe_3',
    catalog_code: 'brand|series|code',
    ratio: 1,
    sort_order: 0,
  });
});

test('v3 restore succeeds with an empty saved recipe list', async () => {
  let recipeInsertCalls = 0;
  const db = {
    async withExclusiveTransactionAsync(fn) {
      await fn(this);
    },
    async getAllAsync() {
      return [];
    },
    async runAsync(sql) {
      if (sql.startsWith('INSERT INTO mix_recipes')) recipeInsertCalls++;
      return { lastInsertRowId: 0 };
    },
  };
  const cloudBackup = loadCloudBackup({
    db,
    appOwnership: 'standalone',
    downloadKitPhotosForRestore: async () => new Map(),
    deleteKitPhoto: async () => {},
  });

  await cloudBackup.restoreFromSnapshot(emptySnapshot(3), 'user-1');

  assert.equal(recipeInsertCalls, 0);
});

test('v4 restore inserts recipe paints only when parent and catalog paint resolve', async () => {
  let recipePaintInsertCalls = 0;
  const recipePaintInsertArgs = [];
  const db = {
    async withExclusiveTransactionAsync(fn) {
      await fn(this);
    },
    async getAllAsync() {
      return [];
    },
    async getFirstAsync(_sql, params) {
      return params?.[0] === 'brand|series|code' ? { id: 8 } : null;
    },
    async runAsync(sql, params) {
      if (sql.startsWith('INSERT INTO mix_recipes')) return { lastInsertRowId: 12 };
      if (sql.startsWith('INSERT INTO mix_recipe_paints')) {
        recipePaintInsertCalls++;
        recipePaintInsertArgs.push(params);
      }
      return { lastInsertRowId: 0 };
    },
  };
  const cloudBackup = loadCloudBackup({
    db,
    appOwnership: 'standalone',
    downloadKitPhotosForRestore: async () => new Map(),
    deleteKitPhoto: async () => {},
  });

  await cloudBackup.restoreFromSnapshot({
    ...emptySnapshot(4),
    mixRecipes: [{
      localRef: 'mixrecipe_3',
      name: 'Warm gray',
      note: null,
      sort_order: 0,
      added_at: '2026-08-29',
      updated_at: '2026-08-29',
    }],
    mixRecipePaints: [
      { mixRecipeLocalRef: 'mixrecipe_3', catalog_code: 'brand|series|code', ratio: 1, sort_order: 0 },
      { mixRecipeLocalRef: 'mixrecipe_3', catalog_code: 'missing|series|code', ratio: 0.5, sort_order: 1 },
      { mixRecipeLocalRef: 'missing_recipe', catalog_code: 'brand|series|code', ratio: 0.5, sort_order: 2 },
    ],
  }, 'user-1');

  assert.equal(recipePaintInsertCalls, 1);
  assert.deepEqual(recipePaintInsertArgs[0], [12, 8, 1, 0]);
});

test('isLocalDbEmpty counts saved mix recipes', async () => {
  let query;
  const cloudBackup = loadCloudBackup({
    db: {
      async getFirstAsync(sql) {
        query = sql;
        return { n: 0 };
      },
    },
  });

  assert.equal(await cloudBackup.isLocalDbEmpty(), true);
  assert.match(query, /\(SELECT COUNT\(\*\) FROM mix_recipes\)/);
});

test('restore deletes recipe and kit child rows before their parents and manual paints', async () => {
  const sqlCalls = [];
  const db = {
    async withExclusiveTransactionAsync(fn) {
      await fn(this);
    },
    async getAllAsync() {
      return [];
    },
    async runAsync(sql) {
      sqlCalls.push(sql);
      return { lastInsertRowId: 0 };
    },
  };
  const cloudBackup = loadCloudBackup({
    db,
    appOwnership: 'standalone',
    downloadKitPhotosForRestore: async () => new Map(),
    deleteKitPhoto: async () => {},
  });

  await cloudBackup.restoreFromSnapshot(emptySnapshot(3), 'user-1');

  const indexOf = (sql) => sqlCalls.indexOf(sql);
  const recipePaintDelete = indexOf('DELETE FROM mix_recipe_paints');
  const recipeDelete = indexOf('DELETE FROM mix_recipes');
  const kitPaintDelete = indexOf('DELETE FROM kit_color_paints');
  const kitDelete = indexOf('DELETE FROM kit_colors');
  const manualPaintDelete = indexOf("DELETE FROM catalog_paints WHERE source = 'manual'");
  assert.ok(recipePaintDelete >= 0);
  assert.ok(recipeDelete >= 0);
  assert.ok(kitPaintDelete >= 0);
  assert.ok(kitDelete >= 0);
  assert.ok(recipePaintDelete < recipeDelete && recipeDelete < manualPaintDelete);
  assert.ok(kitPaintDelete < kitDelete && kitDelete < manualPaintDelete);
});

test('failed photo preflight leaves existing local backup untouched', async () => {
  let transactionCalls = 0;
  let deletedPhotoCalls = 0;
  const db = {
    async withExclusiveTransactionAsync(fn) {
      transactionCalls++;
      await fn(this);
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
    appOwnership: 'standalone',
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

  await assert.rejects(cloudBackup.restoreFromSnapshot(snapshot, 'user-1'), /download/i);
  assert.equal(transactionCalls, 0);
  assert.equal(deletedPhotoCalls, 0);
});

test('newer backup schema is rejected before touching local data', async () => {
  let transactionCalls = 0;
  const cloudBackup = loadCloudBackup({
    db: {
      async withExclusiveTransactionAsync() {
        transactionCalls++;
      },
    },
    appOwnership: 'standalone',
    downloadKitPhotosForRestore: async () => new Map(),
    deleteKitPhoto: async () => {},
  });
  const snapshot = {
    schemaVersion: 6,
    boxes: [],
    manualPaints: [],
    officialPaintNotes: [],
    inventory: [],
    favorites: [],
    wishlist: [],
    defaultBoxLocalRef: null,
  };

  await assert.rejects(cloudBackup.restoreFromSnapshot(snapshot, 'user-1'), /schema/i);
  assert.equal(transactionCalls, 0);
});

test('push waits until restore photo preflight and transaction finish', async () => {
  let releaseDownload;
  let firestoreSetCalls = 0;
  const downloadBlocked = new Promise((resolve) => {
    releaseDownload = resolve;
  });
  const db = {
    async withExclusiveTransactionAsync(fn) {
      await fn(this);
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

  const restore = cloudBackup.restoreFromSnapshot(snapshot, 'user-1');
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
    async withExclusiveTransactionAsync(fn) { await fn(this); },
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

test('push is blocked until the restore decision is complete', async () => {
  let firestoreSetCalls = 0;
  const cloudBackup = loadCloudBackup({
    db: {
      async getAllAsync() {
        return [];
      },
      async getFirstAsync() {
        return null;
      },
    },
    appOwnership: 'standalone',
    downloadKitPhotosForRestore: async () => new Map(),
    deleteKitPhoto: async () => {},
    getSetting: async () => null,
    firestoreSet: async () => {
      firestoreSetCalls++;
    },
  });

  await cloudBackup.pushBackupToFirestore();
  assert.equal(firestoreSetCalls, 0);
});

test('account switch with no cloud snapshot blocks the new account until local data is explicitly adopted', async () => {
  let firestoreSetCalls = 0;
  const settings = new Map([
    ['cloud_backup_ready_uid', 'user-a'],
    ['cloud_backup_data_owner_uid', 'user-a'],
  ]);
  const cloudBackup = loadCloudBackup({
    db: {
      async getFirstAsync() {
        return { n: 1 };
      },
    },
    appOwnership: 'standalone',
    getCurrentUser: () => ({ uid: 'user-b' }),
    getSetting: async (key) => settings.get(key) ?? null,
    setSetting: async (key, value) => settings.set(key, value),
    firestoreSet: async () => {
      firestoreSetCalls++;
    },
    downloadKitPhotosForRestore: async () => new Map(),
    deleteKitPhoto: async () => {},
  });

  assert.equal(await cloudBackup.runRestoreDecision(), 'account_conflict');
  assert.equal(settings.get('cloud_backup_ready_uid'), 'user-a');

  settings.set('cloud_backup_ready_uid', 'user-b');
  assert.equal(await cloudBackup.isCloudBackupReady('user-b'), false);
  await cloudBackup.pushBackupToFirestore();
  assert.equal(firestoreSetCalls, 0);
});

test('restore aborts before the transaction when the Firebase user changes', async () => {
  let currentUid = 'user-1';
  let releaseDownload;
  let transactionCalls = 0;
  const downloadBlocked = new Promise((resolve) => {
    releaseDownload = resolve;
  });
  const cloudBackup = loadCloudBackup({
    db: {
      async withExclusiveTransactionAsync() {
        transactionCalls++;
      },
    },
    appOwnership: 'standalone',
    getCurrentUser: () => ({ uid: currentUid }),
    deleteKitPhoto: async () => {},
    downloadKitPhotosForRestore: async () => {
      await downloadBlocked;
      return new Map([['users/user-1/kit-photos/photo.jpg', 'file:///restored.jpg']]);
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
    kitPhotos: [{ kitLocalRef: 'kit_1', storagePath: 'users/user-1/kit-photos/photo.jpg', sort_order: 0 }],
  };

  const restore = cloudBackup.restoreFromSnapshot(snapshot, 'user-1');
  await new Promise((resolve) => setImmediate(resolve));
  currentUid = 'user-2';
  releaseDownload();

  await assert.rejects(restore, /user changed/i);
  assert.equal(transactionCalls, 0);
});
