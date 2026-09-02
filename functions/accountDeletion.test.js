const assert = require('node:assert/strict');
const test = require('node:test');
const {
  TOMBSTONE_TTL_MS,
  deleteAccountData,
} = require('./accountDeletion');

test('server blocks writes before deleting every remote account record', async () => {
  const events = [];
  const db = {
    collection(name) {
      return {
        doc(uid) {
          return {
            async set(data) {
              events.push(`block:${uid}:${data.expiresAt.getTime()}`);
            },
            async delete() {
              events.push(`delete-${name}:${uid}`);
            },
          };
        },
      };
    },
  };
  await deleteAccountData({
    uid: 'user-1',
    db,
    bucket: {
      async deleteFiles({ prefix }) {
        events.push(`delete-storage:${prefix}`);
      },
    },
    auth: {
      async deleteUser(uid) {
        events.push(`delete-auth:${uid}`);
      },
    },
    revenueCatApiKey: 'secret',
    fetchImpl: async (url) => {
      events.push(`delete-revenuecat:${url}`);
      return { ok: true, status: 200 };
    },
    now: 1000,
  });

  assert.deepEqual(events, [
    `block:user-1:${1000 + TOMBSTONE_TTL_MS}`,
    'delete-storage:users/user-1/kit-photos/',
    'delete-backups:user-1',
    'delete-revenuecat:https://api.revenuecat.com/v1/subscribers/user-1',
    'delete-auth:user-1',
  ]);
});
