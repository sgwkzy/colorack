const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const pagePath = path.join(__dirname, 'account-deletion.html');

test('account deletion page exposes authenticated Google and Apple self-service flow', () => {
  assert.equal(fs.existsSync(pagePath), true, 'account deletion page is missing');
  const html = fs.readFileSync(pagePath, 'utf8');

  for (const marker of [
    'Firebase',
    'Google',
    'Apple',
    'signInWithPopup',
    'deleteAccount',
    'https://asia-northeast1-colorack-7e436.cloudfunctions.net/deleteAccount',
    'https://sgwkzy.github.io/colorack/privacy.html',
  ]) {
    assert.ok(html.includes(marker), `missing ${marker}`);
  }

  assert.doesNotMatch(html, /REVENUECAT_SECRET|private_key|serviceAccount/i);
});
