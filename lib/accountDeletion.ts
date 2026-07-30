import { deleteFirebaseAccount } from './auth';
import { deleteCloudBackup } from './cloudBackup';
import { deleteAllKitPhotoBackups } from './kitPhotoBackup';

export async function deleteCurrentAccount(): Promise<void> {
  await deleteFirebaseAccount(async (uid) => {
    await deleteAllKitPhotoBackups(uid);
    await deleteCloudBackup(uid);
  });
}
