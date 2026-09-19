const assert = require('node:assert/strict');
const { test } = require('node:test');

const releaseStatus = require('../src/main/release-status/index.cjs');

test('development release status does not mistake Electron host signing for Dialed release evidence', async () => {
  let calls = 0;
  const result = await releaseStatus.readReleaseStatus({ version: '2.6.1', isPackaged: false, executablePath: 'C:\\Fixture\\electron.exe' }, {
    runPowerShell: async () => { calls += 1; },
  });
  assert.equal(calls, 0);
  assert.equal(result.signature.status, 'NOT_APPLICABLE');
  assert.match(result.signature.statusMessage, /not Dialed release evidence/);
  assert.equal(result.updateCheckAvailable, false);
  assert.equal(result.updateMode, 'VERIFIED_USER_INITIATED');
  assert.equal(result.update.status, 'UNCONFIGURED');
});

test('packaged release status reads Authenticode with a base64 path and preserves signer evidence', async () => {
  const executablePath = "C:\\Program Files\\Dialed\\Dialed's App.exe";
  let script = '';
  const result = await releaseStatus.readReleaseStatus({ version: '2.6.1', isPackaged: true, executablePath }, {
    runPowerShell: async (value) => {
      script = value;
      return { stdout: JSON.stringify({ status: 'Valid', statusMessage: 'Signature verified.', signerSubject: 'CN=Fixture Signer', signerThumbprint: '0011', timestampSubject: 'CN=Fixture Timestamp' }) };
    },
  });
  assert.equal(result.signature.status, 'Valid');
  assert.equal(result.signature.signerSubject, 'CN=Fixture Signer');
  assert.equal(result.signature.signerThumbprint, '0011');
  assert.doesNotMatch(script, /Program Files|Dialed's App/);
  assert.match(script, /FromBase64String/);
});

test('packaged release status reports unavailable without inventing a signature', async () => {
  const result = await releaseStatus.readReleaseStatus({ version: '2.6.1', isPackaged: true, executablePath: 'C:\\Dialed.exe' }, {
    runPowerShell: async () => { throw new Error('fixture unavailable'); },
  });
  assert.equal(result.signature.status, 'UNAVAILABLE');
  assert.match(result.signature.statusMessage, /fixture unavailable/);
  assert.equal(result.signature.signerSubject, '');
});
