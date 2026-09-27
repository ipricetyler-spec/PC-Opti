const test = require('node:test');
const assert = require('node:assert/strict');
const session = require('../src/main/session-user/index.cjs');

const ME = 'S-1-5-21-1111111111-2222222222-3333333333-1001';
const ADMIN = 'S-1-5-21-1111111111-2222222222-3333333333-500';

test('the account Dialed runs as is compared with the one signed in to its session', () => {
  assert.deepEqual(session.classifySessionIdentity({ processSid: ME, processName: 'PC\\me', sessionSids: [ME], sessionNames: ['PC\\me'] }), { sameUser: true, processName: 'PC\\me', sessionName: 'PC\\me' });
  // Over-the-shoulder elevation: a standard user approved the prompt with another account.
  assert.deepEqual(session.classifySessionIdentity({ processSid: ADMIN, processName: 'PC\\admin', sessionSids: [ME], sessionNames: ['PC\\me'] }), { sameUser: false, processName: 'PC\\admin', sessionName: 'PC\\me' });
  // A single value arrives as a string from ConvertTo-Json.
  assert.equal(session.classifySessionIdentity({ processSid: ME, sessionSids: ME, sessionNames: 'PC\\me' }).sameUser, true);
  // Cannot tell: no Explorer, several owners, or values that are not account SIDs.
  for (const report of [{ processSid: ME, sessionSids: [] }, { processSid: ME, sessionSids: [ME, ADMIN] }, { processSid: 'S-1-5-18', sessionSids: [ME] }, { processSid: ME, sessionSids: ['nonsense'] }, null]) {
    assert.equal(session.classifySessionIdentity(report).sameUser, null, JSON.stringify(report));
  }
});

test('per-user changes are refused only when the accounts are known to differ', () => {
  const other = { sameUser: false, processName: 'PC\\admin', sessionName: 'PC\\me' };
  for (const id of ['graphics:per-app-gpu-preference', 'input:mouse-acceleration', 'windows:optional-app-remove-current-user', 'maintenance:clear-temp-files', 'game:config-restore', 'startup:disable-current-user-run']) {
    assert.throws(() => session.assertPerUserCapabilityAllowed(id, other), /running as a different Windows account \(PC\\admin\) from the one signed in \(PC\\me\)/, id);
    assert.doesNotThrow(() => session.assertPerUserCapabilityAllowed(id, { sameUser: true }));
    assert.doesNotThrow(() => session.assertPerUserCapabilityAllowed(id, { sameUser: null }), 'unknown is not refused');
    assert.doesNotThrow(() => session.assertPerUserCapabilityAllowed(id, null));
  }
  // Machine-wide changes land in the same place whichever administrator makes them.
  for (const id of ['timing:disable-dynamic-tick', 'power:switch-plan', 'startup:disable-machine-run', 'policy:disable-windows-consumer-features']) {
    assert.doesNotThrow(() => session.assertPerUserCapabilityAllowed(id, other), id);
  }
});

test('every per-user capability is registered, and the session is never read inside the test runner', async () => {
  const registered = new Set(require('../src/main/capabilities/index.cjs').listCapabilities().map((item) => item.id));
  for (const id of session.PER_USER_CAPABILITIES) assert.ok(registered.has(id), id);
  await assert.rejects(session.readSessionIdentity(), /not read inside the test runner/);
});

test('startup reads the accounts before the window opens, and every capability check applies it', () => {
  const main = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'electron', 'main.cjs'), 'utf8');
  assert.match(main, /await Promise\.all\(\[prepareProtectedData\(\), prepareSessionIdentity\(\)\]\);\s*createWindow\(\);/);
  assert.match(main, /function assertCapabilityAvailable\(capabilityId\) \{\s*const capability = requireCapability\(capabilityId, resolveRuntimeProfileForApp\(\)\);\s*assertPerUserCapabilityAllowed\(capabilityId, sessionIdentity\);/);
});
