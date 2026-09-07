# Photo Metadata Authority Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Prevent deleted kit and shopping-candidate photos from reappearing after a Standard-to-Light downgrade, while preventing a fresh Light device from erasing valid cloud photo references.

**Architecture:** Add one UID-scoped `app_settings` value that identifies the device whose local photo metadata is authoritative for that Firebase account. Standard pushes and successful Standard restores establish authority. A successful Light restore clears it. `buildBackupSnapshot` includes photo metadata when the current entitlement permits photo backup or the current UID owns the authority marker; otherwise it keeps omitting the fields so Firestore `merge: true` preserves cloud references. Photo binaries remain Standard-only.

**Tech Stack:** TypeScript, Expo SQLite settings, Firebase Firestore/Storage, Node's built-in test runner, existing transpile-based `cloudBackup.test.cjs` harness.

**Spec:** `docs/superpowers/specs/2026-09-01-photo-metadata-authority-design.md`

## Global Constraints

- Modify only `lib/cloudBackup.ts` and `lib/cloudBackup.test.cjs` in this plan.
- Keep `BACKUP_SCHEMA_VERSION` at `7`; do not add a SQLite table, backup field, tombstone, or Storage deletion.
- Keep photo upload/download behavior Standard-only.
- Capture `hasPhotoBackup` once per push/restore operation; do not mix entitlement reads across one operation.
- Preserve account UID checks, `runAccountOperation`, the existing transaction/cleanup behavior, and Firestore `{ merge: true }`.
- Preserve existing user changes and do not touch the separate catalog, release, or other worktrees.
- Follow test-first development: add a failing regression test before the production change, then run the narrow test and the required repository checks.

---

## Task 1: Add regression coverage for authority-aware snapshots and transitions

**Files:** `lib/cloudBackup.test.cjs`

- [x] Extend `loadCloudBackup` with an optional `getEntitlements` factory and use it in the `./subscription` mock. Keep the current Standard/backup-enabled defaults so existing tests remain unchanged.
- [x] Extend `backupReadDb` with optional `kitPhotos` rows and return them for `FROM kit_photos` queries. Keep candidate-photo rows joined through `kit_wishlist` as the existing helper does.
- [x] Add tests that fail against the current implementation:

```js
test('Light authority device includes current synced photo metadata', async () => {
  const backup = loadCloudBackup({
    db: backupReadDb({
      kitPhotos: [{ kit_id: 1, storage_path: 'users/u/kit-photos/owned.jpg', sort_order: 0 }],
      kitWishlistPhotos: [{ wishlist_id: 2, storage_path: 'users/u/kit-photos/candidate.jpg', sort_order: 1 }],
    }),
    appOwnership: 'standalone',
    getEntitlements: () => ({ hasBackup: true, hasPhotoBackup: false }),
    getSetting: async (key) => key === 'cloud_backup_ready_uid' || key === 'cloud_backup_photo_metadata_authority_uid'
      ? 'user-1'
      : null,
    downloadKitPhotosForRestore: async () => new Map(),
    deleteKitPhoto: async () => {},
  });

  const snapshot = await backup.buildBackupSnapshot();

  assert.deepEqual(snapshot.kitPhotos, [{
    kitLocalRef: 'kit_1',
    storagePath: 'users/u/kit-photos/owned.jpg',
    sort_order: 0,
  }]);
  assert.deepEqual(snapshot.kitWishlistPhotos, [{
    wishlistLocalRef: 'kit_wishlist_2',
    storagePath: 'users/u/kit-photos/candidate.jpg',
    sort_order: 1,
  }]);
});
```

- [x] Add a Light, non-authoritative snapshot test asserting both photo fields are `undefined`.
- [x] Add a Standard push success test that records `setSetting` calls and asserts `cloud_backup_photo_metadata_authority_uid` is saved as the current UID after Firestore succeeds.
- [x] Add a Firestore failure test asserting the authority key is not saved.
- [x] Add Standard and Light restore-success tests asserting the authority key becomes the expected UID or an empty string respectively.
- [x] Add a restore-failure assertion that the authority key is unchanged.
- [x] Run `node --test lib/cloudBackup.test.cjs` and confirm the new tests fail for the missing behavior before editing `cloudBackup.ts`.

## Task 2: Implement the smallest authority state machine

**Files:** `lib/cloudBackup.ts`

- [x] Add `const PHOTO_METADATA_AUTHORITY_UID_KEY = 'cloud_backup_photo_metadata_authority_uid';` beside the existing backup setting keys.
- [x] Change `buildBackupSnapshot` to accept one optional captured entitlement argument:

```ts
export async function buildBackupSnapshot(photoBackupEntitled = getEntitlements().hasPhotoBackup): Promise<BackupSnapshot>
```

- [x] At the start of snapshot construction, read the authority setting only for a signed-in UID and derive one boolean:

```ts
const uid = auth?.().currentUser?.uid ?? null;
const photoMetadataAuthorityUid = uid ? await getSetting(PHOTO_METADATA_AUTHORITY_UID_KEY) : null;
const includePhotoMetadata = !!uid && (photoBackupEntitled || photoMetadataAuthorityUid === uid);
```

- [x] Use `includePhotoMetadata` for both photo-row queries and the returned `kitPhotos`/`kitWishlistPhotos` fields. When true, always return both arrays, including empty arrays. When false, omit both fields exactly as today.
- [x] In `pushBackupToFirestore`, capture `const hasPhotoBackup = getEntitlements().hasPhotoBackup` once inside the serialized operation, use it for the upload guard, and pass it to `buildBackupSnapshot(hasPhotoBackup)`.
- [x] After Firestore write and `assertCurrentUser(user.uid)` succeed, save the authority UID only when the captured value is true. Do not save it before Firestore succeeds and do not change it on any error.
- [x] In `restoreFromSnapshotUnlocked`, capture entitlements once after the backup entitlement guard. Use the captured `hasPhotoBackup` for both photo restore selection and the final authority transition.
- [x] After the DB transaction and best-effort orphan-file cleanup complete successfully, save `expectedUid` when the captured value is true and `''` when false. Leave the setting untouched when preflight, transaction, account validation, or cleanup code throws before that point.
- [x] Keep `runRestoreDecision` behavior unchanged; it will inherit the transition through `restoreFromSnapshotUnlocked`.
- [x] Run `node --test lib/cloudBackup.test.cjs` and confirm all existing and new tests pass.

## Task 3: Verify the release-critical regression surface

**Files:** no additional files.

- [x] Run `npm run test`.
- [x] Run `npm run typecheck`.
- [x] Run `git diff --check`.
- [x] Review the final diff to confirm no schema version change, no Storage deletion, no entitlement widening, and no changes outside the two implementation/test files (plus this plan).
- [x] Report the concrete test counts and any remaining separately planned review findings; do not claim the broader release is ready based on unit tests alone.

## Definition of Done

- [x] A Light device that previously synchronized photo metadata can delete a local photo and push an empty/current array, so a later Standard restore cannot resurrect it.
- [x] A fresh/non-authoritative Light device cannot overwrite cloud photo metadata with omitted or empty arrays.
- [x] Standard photo upload/download permissions remain unchanged.
- [x] Account switching and failed push/restore operations do not incorrectly transfer or establish authority.
- [x] All required checks pass.
