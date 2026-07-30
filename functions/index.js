const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');
const { getStorage } = require('firebase-admin/storage');
const { defineSecret } = require('firebase-functions/params');
const { onRequest } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { deleteAccountData } = require('./accountDeletion');

initializeApp();

const REGION = 'asia-northeast1';
const revenueCatSecretApiKey = defineSecret('REVENUECAT_SECRET_API_KEY');

exports.deleteAccount = onRequest(
  {
    region: REGION,
    secrets: [revenueCatSecretApiKey],
    timeoutSeconds: 120,
  },
  async (request, response) => {
    if (request.method !== 'POST') {
      response.status(405).json({ error: 'method-not-allowed' });
      return;
    }
    const match = /^Bearer (.+)$/.exec(request.get('authorization') ?? '');
    if (!match) {
      response.status(401).json({ error: 'authentication-required' });
      return;
    }
    try {
      const token = await getAuth().verifyIdToken(match[1]);
      if (!token.auth_time || Date.now() / 1000 - token.auth_time > 5 * 60) {
        response.status(401).json({ error: 'recent-authentication-required' });
        return;
      }
      await deleteAccountData({
        uid: token.uid,
        db: getFirestore(),
        bucket: getStorage().bucket(),
        auth: getAuth(),
        revenueCatApiKey: revenueCatSecretApiKey.value(),
      });
      response.status(200).json({ deleted: true });
    } catch (error) {
      console.error('deleteAccount failed', error);
      response.status(500).json({ error: 'account-deletion-failed' });
    }
  }
);

exports.cleanupAccountDeletionTombstones = onSchedule(
  {
    schedule: 'every 60 minutes',
    region: REGION,
  },
  async () => {
    const db = getFirestore();
    const snapshot = await db
      .collection('accountDeletions')
      .where('expiresAt', '<=', new Date())
      .limit(500)
      .get();
    if (snapshot.empty) return;
    const batch = db.batch();
    snapshot.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
  }
);
