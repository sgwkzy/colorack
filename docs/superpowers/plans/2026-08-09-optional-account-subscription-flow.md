# Optional Account Subscription Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Allow anonymous users to view, purchase, and restore Colorack subscriptions while requiring Firebase authentication only for cloud database or photo backup.

**Architecture:** RevenueCat remains the source of subscription entitlements and starts with its persistent anonymous customer ID. Firebase UID is introduced only at the cloud-backup boundary; after login, `linkSubscriptionUser(uid)` associates the RevenueCat customer with that UID. The existing `backup` and `backup_photos` entitlements continue to control plan display, ad suppression, database backup, and photo backup.

**Tech Stack:** Expo SDK 54, React Native 0.81, TypeScript, `react-native-purchases` 10.4.2, `react-native-purchases-ui` 10.4.2, React Native Firebase, Node's built-in test runner, TypeScript transpilation in existing `.test.cjs` tests.

## Global Constraints

- Work only on `fix/testflight-cloud-backup`; never implement, commit, merge, or push directly on `main` or `develop`.
- Preserve the untracked `.codex/` directory and all unrelated working-tree changes.
- Do not add a new dependency or hard-code subscription prices/product periods in application code.
- Both paid plans (`backup`) must suppress ads; only `backup_photos` enables kit-photo Storage backup.
- Firebase UID is mandatory for Firestore/Storage operations; anonymous RevenueCat users must never write cloud data.
- Keep existing account-conflict protection, RevenueCat claims waiting, and the decision not to call RevenueCat logout on Firebase sign-out.
- Use the exact Expo/RN versions already in `package.json`; do not perform an SDK upgrade as part of this change.

---

## File Map

- Modify: `lib/subscription.ts` — make paywall and restore APIs accept an optional Firebase UID while preserving the UID safety check when supplied.
- Test: `lib/subscription.test.cjs` — cover anonymous paywall/restore, optional UID validation, and Light/Standard entitlement mapping.
- Modify: `app/(tabs)/settings.tsx` — remove login gates from plan viewing/restoration and retain login only for cloud operations.
- Modify: `docs/revenuecat-setup-runbook.md` — document optional account registration and the Light/Standard behavior.
- Verify only: `components/AdBanner.tsx`, `lib/cloudBackup.ts`, `lib/kitPhotoBackup.ts` — their existing entitlement and Firebase gates must remain unchanged.

## Task 1: Allow anonymous RevenueCat plan operations

**Files:**
- Modify: `lib/subscription.ts:146-175`
- Test: `lib/subscription.test.cjs:6-160`

**Interfaces:**
- Consumes: existing `Purchases`, `RevenueCatUI`, `configured`, and `assertSubscriptionUser` state.
- Produces: `presentPaywall(expectedUid?: string): Promise<void>` and `restorePurchases(expectedUid?: string): Promise<void>`.

- [ ] **Step 1: Extend the test mock with anonymous restore support.**

Add an optional `restorePurchases` callback to `loadSubscription()` and expose it from the mocked Purchases object:

```js
async restorePurchases() {
  return restorePurchases ? restorePurchases() : customerInfo;
},
```

Keep the default customer info and existing identity mocks unchanged so the current UID-mismatch tests still exercise the same seam.

- [ ] **Step 2: Write failing tests for anonymous paywall and restore.**

Add tests at the public `subscription.presentPaywall()` and `subscription.restorePurchases()` seams:

```js
test('anonymous users can view the paywall', async () => {
  process.env.EXPO_PUBLIC_REVENUECAT_API_KEY_ANDROID = 'test-key';
  let presented = false;
  const customerInfo = { entitlements: { active: {} } };
  const subscription = loadSubscription({
    getSetting: async () => null,
    setSetting: async () => {},
    runAsync: async () => {},
    customerInfo,
    presentPaywall: async () => { presented = true; },
  });

  await subscription.initSubscription();
  await subscription.presentPaywall();

  assert.equal(presented, true);
});

test('anonymous users can restore purchases', async () => {
  process.env.EXPO_PUBLIC_REVENUECAT_API_KEY_ANDROID = 'test-key';
  let restored = false;
  const customerInfo = { entitlements: { active: { backup: {} } } };
  const subscription = loadSubscription({
    getSetting: async () => null,
    setSetting: async () => {},
    runAsync: async () => {},
    customerInfo,
    restorePurchases: async () => { restored = true; return customerInfo; },
  });

  await subscription.initSubscription();
  await subscription.restorePurchases();

  assert.equal(restored, true);
  assert.deepEqual(subscription.getEntitlements(), { hasBackup: true, hasPhotoBackup: false });
});
```

Run: `node --test lib/subscription.test.cjs`

Expected: the new tests fail because the current implementation always calls `assertSubscriptionUser()` and requires a UID.

- [ ] **Step 3: Make UID validation conditional.**

Change the public signatures and only assert identity when a UID is supplied:

```ts
export async function presentPaywall(expectedUid?: string): Promise<void> {
  if (!RevenueCatUI || !configured) {
    throw new Error('Subscriptions are not available in Expo Go. Use a development build.');
  }
  if (expectedUid) await assertSubscriptionUser(expectedUid);
  await RevenueCatUI.presentPaywall();
  const info = await Purchases!.getCustomerInfo();
  await applyEntitlements(info.entitlements.active);
}

export async function restorePurchases(expectedUid?: string): Promise<void> {
  if (!Purchases || !configured) return;
  if (expectedUid) await assertSubscriptionUser(expectedUid);
  const info = await Purchases.restorePurchases();
  await applyEntitlements(info.entitlements.active);
}
```

Do not remove `assertSubscriptionUser`; logged-in operations still need the existing mismatch protection.

- [ ] **Step 4: Add the Light/Standard entitlement regression.**

Use the existing `initSubscription()` seam with `backup` only and with both entitlements, asserting these independent expected values:

```js
assert.deepEqual(subscription.getEntitlements(), { hasBackup: true, hasPhotoBackup: false });
assert.deepEqual(standardSubscription.getEntitlements(), { hasBackup: true, hasPhotoBackup: true });
```

This protects the rule that both paid plans remove ads while only Standard enables photo backup.

- [ ] **Step 5: Run the focused subscription tests.**

Run: `node --test lib/subscription.test.cjs`

Expected: all subscription tests pass, including the existing UID-mismatch rejection and account-deletion logout tests.

- [ ] **Step 6: Commit the vertical slice.**

```powershell
git add -- lib/subscription.ts lib/subscription.test.cjs
git commit -m "fix: allow anonymous subscription operations"
```

## Task 2: Move the login gate to cloud backup operations

**Files:**
- Modify: `app/(tabs)/settings.tsx:260-315,399-435`
- Verify: `components/AdBanner.tsx:17-21`
- Verify: `lib/cloudBackup.ts` and `lib/kitPhotoBackup.ts` Firebase/entitlement guards

**Interfaces:**
- Consumes: `presentPaywall(expectedUid?: string)`, `restorePurchases(expectedUid?: string)`, `getCurrentAuthUser()`, `ensureSubscriptionIdentity()`, `runRestoreDecision()`.
- Produces: settings flows that can purchase/restore anonymously and request login only before cloud operations.

- [ ] **Step 1: Write the settings-flow acceptance checks before editing.**

Record these checks as the implementation seam for manual verification: `handleViewPlans` must not inspect `authUser` before calling `presentPaywall`; `handleRestorePurchases` must not inspect `authUser` before calling `restorePurchases`; `handleBackupNow` and cloud restore must still call `ensureSubscriptionIdentity()` before Firestore/Storage work.

- [ ] **Step 2: Remove the login precondition from plan viewing.**

In `handleViewPlans`, replace the early `!authUser` alert and unconditional `ensureSubscriptionIdentity()` call with the current UID when available:

```ts
const expectedUid = getCurrentAuthUser()?.uid;
await presentPaywall(expectedUid);
if (expectedUid) {
  const result = await runRestoreDecision();
  if (result === 'conflict') showConflictAlert(expectedUid);
  refreshAfterRestore();
  await loadLastBackupAt();
}
```

When there is no UID, do not call `runRestoreDecision()` because cloud restore is not allowed for an anonymous user. Always refresh React entitlement state through `presentPaywall()` and release `purchaseBusy` in the existing `finally` block.

- [ ] **Step 3: Remove the login precondition from purchase restoration.**

In `handleRestorePurchases`, pass `getCurrentAuthUser()?.uid` to `restorePurchases()` without displaying a login alert first. Run `runRestoreDecision()`, conflict handling, and backup timestamp refresh only when a UID exists. A user who restores anonymously must retain the subscription and ad-free state but must still log in before cloud data is touched.

- [ ] **Step 4: Keep login visible only for paid users who want backup.**

In the `hasBackup` branch, retain `signInButtons` for unauthenticated users and the existing backup controls for authenticated users. In the free branch, remove the unconditional `signInButtons` rendering so an unentitled user is not prompted to create an account merely to view or purchase a plan. Keep the current plan label and `viewPlans` button.

- [ ] **Step 5: Verify cloud boundaries were not weakened.**

Confirm `handleBackupNow`, `restoreCloudBackup`, and the conflict-resolution callbacks still receive a Firebase UID and continue through `ensureSubscriptionIdentity()`/ `assertCurrentUser()` before invoking Firestore or Storage. Confirm `AdBanner` still returns `null` for `hasBackup` without checking Firebase authentication.

- [ ] **Step 6: Run TypeScript and focused tests.**

Run:

```powershell
node node_modules/typescript/bin/tsc --noEmit
node --test lib/subscription.test.cjs
git diff --check
```

Expected: TypeScript has no new errors, subscription tests pass, and the diff has no whitespace errors. If the existing `app.config.test.cjs` failure appears, record it separately as the pre-existing missing `EAS_BUILD=true` test setup rather than changing unrelated configuration behavior.

- [ ] **Step 7: Commit the settings slice.**

```powershell
git add -- "app/(tabs)/settings.tsx"
git commit -m "fix: require account only for cloud backup"
```

## Task 3: Align the RevenueCat runbook with the new account policy

**Files:**
- Modify: `docs/revenuecat-setup-runbook.md:1-57`

**Interfaces:**
- Consumes: the approved plan table and anonymous/UID flow from the design spec.
- Produces: an operator checklist that cannot instruct testers to log in before every purchase.

- [ ] **Step 1: Replace the outdated pre-purchase login instruction.**

Change the sandbox section so it states that login is optional for plan viewing, purchase, and restore; login is required before database or photo backup. Keep the Firebase UID and RevenueCat identity matching requirement for cloud operations.

- [ ] **Step 2: Add the exact Light/Standard mapping.**

Document `backup` as the shared Light/Standard entitlement and `backup_photos` as Standard-only. State explicitly that both paid plans suppress ads, while only Standard includes compressed kit-photo Storage backup.

- [ ] **Step 3: Add the manual acceptance sequence.**

List the seven TestFlight checks from the design spec: anonymous plan view, Light purchase/ad suppression, Standard photo entitlement, login prompt at backup time, successful post-login database backup, photo backup/restore, and sign-out behavior.

- [ ] **Step 4: Commit the documentation slice.**

```powershell
git add -- docs/revenuecat-setup-runbook.md
git commit -m "docs: clarify optional account subscription flow"
```

## Task 4: End-to-end verification and handoff

**Files:**
- Verify: `lib/subscription.ts`, `app/(tabs)/settings.tsx`, `components/AdBanner.tsx`, `lib/cloudBackup.ts`, `lib/kitPhotoBackup.ts`, and the runbook.

- [ ] **Step 1: Inspect the final branch and diff.**

Run:

```powershell
git status --short
git log --oneline -5
git diff main...HEAD --stat
git diff --check main...HEAD
```

Expected: only the intended subscription/settings/documentation commits are present; `.codex/` remains untracked and untouched.

- [ ] **Step 2: Run the complete relevant verification.**

Run:

```powershell
node --test lib/subscription.test.cjs
node node_modules/typescript/bin/tsc --noEmit
```

Expected: all subscription tests pass and TypeScript reports no new errors. The unrelated pre-existing `app.config.test.cjs` issue remains documented if encountered.

- [ ] **Step 3: Perform the TestFlight manual matrix.**

Use a fresh TestFlight install and a sandbox tester. Execute the acceptance sequence from Task 3, recording plan, login state, entitlement state, ad visibility, database backup result, and photo backup result for each case. Do not use production purchases.

- [ ] **Step 4: Prepare the release handoff.**

Report the branch, commits, test results, manual TestFlight results, and the required RevenueCat/App Store Connect configuration. Open a pull request to `main` for review; do not merge or push directly to `main` without explicit approval.

