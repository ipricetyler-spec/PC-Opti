const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readBundledStatus } = require('../src/main/input-driver-lifecycle/bundled-status.cjs');
const { verifyBundledInventory } = require('../src/main/input-driver-lifecycle/bundled-inventory.cjs');
const root = path.resolve(__dirname, '../vendor/hidusbf');
test('bundle status distinguishes inert identity from activation and measured rate', () => {
  const result = readBundledStatus(root);
  assert.equal(result.identity, 'VERIFIED'); assert.equal(result.installEnabled, false);
  assert.deepEqual(result.rates.map(rate => rate.hz), [1000, 2000, 4000, 8000]);
  assert.ok(result.rates.every(rate => rate.state === 'UNTESTED' && !rate.available));
});
test('package verifier accepts exact inert resource set and rejects hidden extra tools', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dialed-packaged-bundle-'));
  try {
    for (const item of ['README.md', 'inventory.json', 'payload']) fs.cpSync(path.join(root, item), path.join(directory, item), { recursive: true });
    assert.equal(verifyBundledInventory(directory, { packaged: true }).selectedFileCount, 10);
    fs.writeFileSync(path.join(directory, 'Setup.exe'), 'unreviewed');
    assert.equal(readBundledStatus(directory, { packaged: true }).identity, 'INVALID_OR_MISSING');
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
test('missing bundle fails closed with no invented inventory', () => {
  const result = readBundledStatus(path.join(root, 'does-not-exist'));
  assert.equal(result.identity, 'INVALID_OR_MISSING'); assert.equal(result.selectedFileCount, 0); assert.equal(result.installEnabled, false);
});
test('verified native availability removes only the unavailable reason, never acceptance gates', () => {
  const nativeBroker = { available: true, code: 'NATIVE_BROKER_READY', message: 'Ready for inspection.' };
  const result = readBundledStatus(root, { nativeBroker });
  assert.deepEqual(result.nativeBroker, nativeBroker);
  assert.deepEqual(result.reasons.map(x => x.code), ['PHYSICAL_ACCEPTANCE_PENDING']);
  assert.equal(result.status, 'UNCONFIGURED'); assert.equal(result.installEnabled, false);
  assert.ok(result.rates.every(x => !x.available && x.state === 'UNTESTED'));
  const invalid = readBundledStatus(path.join(root, 'missing'), { nativeBroker });
  assert.equal(invalid.identity, 'INVALID_OR_MISSING'); assert.equal(invalid.installEnabled, false);
  assert.ok(invalid.reasons.some(x => x.code === 'BUNDLE_IDENTITY_FAILED'));
});
test('absent or expired native policy keeps setup unavailable', () => {
  for (const nativeBroker of [undefined, { available: false, code: 'NATIVE_POLICY_INVALID', message: 'Policy expired.' }]) {
    const result = readBundledStatus(root, { nativeBroker });
    assert.equal(result.nativeBroker, nativeBroker);
    assert.ok(result.reasons.some(x => x.code === 'AUTHENTICATED_NATIVE_HELPER_REQUIRED'));
    assert.ok(result.reasons.some(x => x.code === 'PHYSICAL_ACCEPTANCE_PENDING'));
    assert.equal(result.installEnabled, false);
  }
});
