import { deleteFirebaseAccount } from './auth';
import { linkSubscriptionUser, logOutSubscriptionUser } from './subscription';

const REGION = 'asia-northeast1';

export async function deleteCurrentAccount(): Promise<{
  appleManualRevocationRequired: boolean;
}> {
  return deleteFirebaseAccount(async ({ uid, idToken, projectId }) => {
    await logOutSubscriptionUser(uid);
    try {
      const response = await fetch(
        `https://${REGION}-${projectId}.cloudfunctions.net/deleteAccount`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${idToken}` },
        }
      );
      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Account deletion failed (${response.status}): ${body}`);
      }
    } catch (error) {
      await linkSubscriptionUser(uid).catch(() => undefined);
      throw error;
    }
  });
}
