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

function loadKitPhotoBackup({
  db,
  putFile,
  getCurrentUser = () => ({ uid: 'user-1' }),
}) {
  const source = fs.readFileSync(require.resolve('./kitPhotoBackup.ts'), 'utf8');
  const code = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const module = { exports: {} };
  const mocks = {
    'expo-file-system/legacy': { documentDirectory: 'file:///documents/' },
    'expo-constants': { __esModule: true, default: { appOwnership: 'standalone' } },
    '@react-native-firebase/auth': {
      default: () => ({ currentUser: getCurrentUser() }),
    },
    '@react-native-firebase/storage': {
      default: () => ({
        ref: (path) => ({ putFile: (uri, metadata) => putFile(path, uri, metadata) }),
      }),
    },
    './db': { getDB: () => db },
    './subscription': { getEntitlements: () => ({ hasPhotoBackup: true }) },
    './auth': { withFreshFirebaseTokenRetry: (operation) => operation() },
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

function backupReadDb({ kitWishlist = [], kitWishlistPhotos = [] } = {}) {
  return {
    async withExclusiveTransactionAsync(fn) { await fn(this); },
    async getAllAsync(sql) {
      if (sql.includes('FROM kit_wishlist_photos')) return kitWishlistPhotos;
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

test('uploads pending candidate photos through the candidate table', async () => {
  const statements = [];
  const uploads = [];
  const reads = [];
  const db = {
    async getAllAsync(sql) {
      reads.push(sql);
      if (sql.includes('FROM kit_photos')) return [{ id: 1, uri: 'file:///owned.jpg' }];
      if (sql.includes('FROM kit_wishlist_photos')) return [{ id: 2, uri: 'file:///candidate.jpg' }];
      return [];
    },
    async withExclusiveTransactionAsync(fn) { await fn(this); },
    async runAsync(sql, args) {
      statements.push([sql, args]);
    },
  };
  const photos = loadKitPhotoBackup({
    db,
    putFile: async (path, uri) => uploads.push({ path, uri }),
  });

  await photos.uploadPendingKitPhotos('user-1');

  assert.equal(uploads.length, 2);
  assert.match(reads.find((sql) => sql.includes('FROM kit_wishlist_photos')), /JOIN kit_wishlist/);
  const candidateUpdate = statements.find(([sql]) => sql.startsWith('UPDATE kit_wishlist_photos'));
  assert.ok(candidateUpdate);
  assert.equal(candidateUpdate[1][1], 2);
  assert.equal(candidateUpdate[1][0], uploads.find(({ uri }) => uri === 'file:///candidate.jpg').path);
});

test('v6 snapshot excludes orphaned candidate-photo rows left by older resets', async () => {
  let photoSql = '';
  const db = {
    async withExclusiveTransactionAsync(fn) { await fn(this); },
    async getAllAsync(sql) {
      if (sql.includes('FROM kit_wishlist_photos')) {
        photoSql = sql;
        return sql.includes('JOIN kit_wishlist')
          ? []
          : [{ wishlist_id: 999, storage_path: 'users/u/kit-photos/orphan.jpg', sort_order: 0 }];
      }
      return [];
    },
    async getFirstAsync() { return null; },
  };
  const backup = loadCloudBackup({ db, appOwnership: 'standalone', downloadKitPhotosForRestore: async () => new Map(), deleteKitPhoto: async () => {} });

  const snapshot = await backup.buildBackupSnapshot();

  assert.match(photoSql, /JOIN kit_wishlist/);
  assert.deepEqual(snapshot.kitWishlistPhotos, []);
});

test('v6 snapshot stores independent kit shopping candidates and photos', async () => {
  const db = backupReadDb({
    kitWishlist: [{ id: 1, name: 'RX-78', maker: 'Bandai', series: 'HG', category: null, scale: '1/144', note: null, price: 2200, added_at: '2026-08-31' }],
    kitWishlistPhotos: [{ wishlist_id: 1, storage_path: 'users/u/kit-photos/candidate.jpg', sort_order: 0 }],
  });
  const backup = loadCloudBackup({ db, appOwnership: 'standalone', downloadKitPhotosForRestore: async () => new Map(), deleteKitPhoto: async () => {} });
  const snapshot = await backup.buildBackupSnapshot();
  assert.equal(snapshot.schemaVersion, 6);
  assert.deepEqual(snapshot.kitWishlist, [{ localRef: 'kit_wishlist_1', name: 'RX-78', maker: 'Bandai', series: 'HG', category: null, scale: '1/144', note: null, price: 2200, added_at: '2026-08-31' }]);
  assert.deepEqual(snapshot.kitWishlistPhotos, [{
    wishlistLocalRef: 'kit_wishlist_1',
    storagePath: 'users/u/kit-photos/candidate.jpg',
    sort_order: 0,
  }]);
});

test('v6 photo backups include empty owned and candidate photo arrays', async () => {
  const backup = loadCloudBackup({
    db: backupReadDb(),
    appOwnership: 'standalone',
    downloadKitPhotosForRestore: async () => new Map(),
    deleteKitPhoto: async () => {},
  });

  const snapshot = await backup.buildBackupSnapshot();

  assert.equal(snapshot.schemaVersion, 6);
  assert.deepEqual(snapshot.kitPhotos, []);
  assert.deepEqual(snapshot.kitWishlistPhotos, []);
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

test('v5 restore replaces local kit shopping candidates without candidate-photo inserts', async () => {
  const statements = [];
  const db = restoreDb(statements);
  const backup = loadCloudBackup({ db, appOwnership: 'standalone', downloadKitPhotosForRestore: async () => new Map(), deleteKitPhoto: async () => {} });
  await backup.restoreFromSnapshot({ ...emptySnapshot(5), kitWishlist: [{ name: 'RX-78', maker: 'Bandai', series: null, category: null, scale: null, note: null, price: null, added_at: '2026-08-31' }] }, 'user-1');
  assert.ok(statements.some(([sql]) => sql === 'DELETE FROM kit_wishlist'));
  assert.ok(statements.some(([sql]) => sql.startsWith('INSERT INTO kit_wishlist')));
  assert.equal(statements.filter(([sql]) => sql.startsWith('INSERT INTO kit_wishlist_photos')).length, 0);
});

test('v6 restore downloads and maps candidate photos to restored candidates', async () => {
  const statements = [];
  const db = {
    async withExclusiveTransactionAsync(fn) { await fn(this); },
    async getAllAsync() { return []; },
    async getFirstAsync() { return null; },
    async runAsync(sql, args) {
      statements.push([sql, args]);
      if (sql.startsWith('INSERT INTO kit_wishlist')) return { lastInsertRowId: 91 };
      if (sql.startsWith('INSERT INTO kits')) return { lastInsertRowId: 17 };
      return { lastInsertRowId: 0 };
    },
  };
  let downloaded = [];
  const backup = loadCloudBackup({
    db,
    appOwnership: 'standalone',
    downloadKitPhotosForRestore: async (photos) => {
      downloaded = photos;
      return new Map([
        ['users/u/kit-photos/owned.jpg', 'file:///owned.jpg'],
        ['users/u/kit-photos/candidate.jpg', 'file:///candidate.jpg'],
      ]);
    },
    deleteKitPhoto: async () => {},
  });
  const ownedPhoto = { kitLocalRef: 'kit_1', storagePath: 'users/u/kit-photos/owned.jpg', sort_order: 0 };
  const candidatePhoto = { wishlistLocalRef: 'kit_wishlist_1', storagePath: 'users/u/kit-photos/candidate.jpg', sort_order: 0 };

  await backup.restoreFromSnapshot({
    ...emptySnapshot(6),
    kitWishlist: [{ localRef: 'kit_wishlist_1', name: 'RX-78', maker: 'Bandai', series: null, category: null, scale: null, note: null, price: null, added_at: '2026-08-31' }],
    kitWishlistPhotos: [candidatePhoto],
    kits: [{ localRef: 'kit_1', kitBoxLocalRef: null, name: 'RX-78', maker: 'Bandai', series: null, category: null, scale: null, note: null, price: null, status: 'not_started', added_at: null, status_changed_at: null }],
    kitPhotos: [ownedPhoto],
  }, 'user-1');

  assert.deepEqual(downloaded, [ownedPhoto, candidatePhoto]);
  const candidateInsertIndex = statements.findIndex(([sql]) => sql.startsWith('INSERT INTO kit_wishlist '));
  const candidatePhotoInsertIndex = statements.findIndex(([sql]) => sql.startsWith('INSERT INTO kit_wishlist_photos'));
  assert.ok(candidateInsertIndex >= 0 && candidateInsertIndex < candidatePhotoInsertIndex);
  assert.deepEqual(statements[candidatePhotoInsertIndex][1], [91, 'file:///candidate.jpg', 0, 'users/u/kit-photos/candidate.jpg']);
  const ownedPhotoInserts = statements.filter(([sql]) => sql.startsWith('INSERT INTO kit_photos'));
  assert.equal(ownedPhotoInserts.length, 1);
  assert.deepEqual(ownedPhotoInserts[0][1], [17, 'file:///owned.jpg', 0, 'users/u/kit-photos/owned.jpg']);
});

test('v6 restore skips stale photo references retained by entitlement-downgrade merges', async () => {
  const statements = [];
  let downloadCalls = 0;
  const backup = loadCloudBackup({
    db: restoreDb(statements),
    appOwnership: 'standalone',
    downloadKitPhotosForRestore: async () => { downloadCalls++; return new Map(); },
    deleteKitPhoto: async () => {},
  });

  await backup.restoreFromSnapshot({
    ...emptySnapshot(6),
    kitPhotos: [{ kitLocalRef: 'missing-kit', storagePath: 'users/u/kit-photos/owned.jpg', sort_order: 0 }],
    kitWishlistPhotos: [{ wishlistLocalRef: 'missing-candidate', storagePath: 'users/u/kit-photos/candidate.jpg', sort_order: 0 }],
  }, 'user-1');

  assert.equal(downloadCalls, 0);
  assert.equal(statements.filter(([sql]) => sql.startsWith('INSERT INTO kit_photos')).length, 0);
  assert.equal(statements.filter(([sql]) => sql.startsWith('INSERT INTO kit_wishlist_photos')).length, 0);
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

test('snapshot stores recipes by local reference and paints by catalog code', async () => {
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

  assert.equal(snapshot.schemaVersion, 6);
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
    schemaVersion: 7,
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
