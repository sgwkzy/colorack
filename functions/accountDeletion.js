const TOMBSTONE_TTL_MS = 2 * 60 * 60 * 1000;

async function deleteRevenueCatCustomer(uid, apiKey, fetchImpl) {
  const response = await fetchImpl(
    `https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(uid)}`,
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${apiKey}` },
    }
  );
  if (!response.ok && response.status !== 404) {
    throw new Error(`RevenueCat customer deletion failed (${response.status}).`);
  }
}

async function deleteAccountData({
  uid,
  db,
  bucket,
  auth,
  revenueCatApiKey,
  fetchImpl = fetch,
  now = Date.now(),
}) {
  const tombstone = db.collection('accountDeletions').doc(uid);
  await tombstone.set({
    expiresAt: new Date(now + TOMBSTONE_TTL_MS),
  });
  await bucket.deleteFiles({ prefix: `users/${uid}/kit-photos/` });
  await db.collection('backups').doc(uid).delete();
  await deleteRevenueCatCustomer(uid, revenueCatApiKey, fetchImpl);
  try {
    await auth.deleteUser(uid);
  } catch (error) {
    if (error?.code !== 'auth/user-not-found') throw error;
  }
}

module.exports = {
  TOMBSTONE_TTL_MS,
  deleteAccountData,
  deleteRevenueCatCustomer,
};
