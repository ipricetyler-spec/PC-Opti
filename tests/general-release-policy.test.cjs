const test = require('node:test');
const { tempDir } = require('./helpers/temp-dir.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { verifyPolicy } = require('../src/main/input-driver-lifecycle/native-broker.cjs');
const { parseGeneralPolicy, parsePolicy, isGeneralRelease } = require('../src/main/input-driver-lifecycle/release-policy-contract.cjs');
const workflow = require('../scripts/native-release-policy.cjs');

// Schema 2: the general release policy. Ephemeral test keys only.
const root = path.resolve(__dirname, '..');
const temporary = tempDir('dialed-general-policy-');
const pair = crypto.generateKeyPairSync('rsa', { modulusLength: 3072 });
const pem = pair.publicKey.export({ type: 'spki', format: 'pem' });
const fingerprint = crypto.createHash('sha256').update(pair.publicKey.export({ type: 'spki', format: 'der' })).digest('hex');
const identity = workflow.publicIdentity(pem, fingerprint);
const secretFile = path.join(temporary, 'ephemeral-test-key.pem');
fs.writeFileSync(secretFile, pair.privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
const candidate = path.join(temporary, 'candidate');
fs.mkdirSync(candidate);
const broker = Buffer.from('inert broker fixture, never executable');
const helper = Buffer.from('inert helper fixture, never executable');
fs.writeFileSync(path.join(candidate, 'Dialed.HidusbfBroker.exe'), broker);
fs.writeFileSync(path.join(candidate, 'Dialed.HidusbfHost.exe'), helper);
const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const days = (count) => new Date(Date.now() + count * 86400000).toISOString();
const general = {
  SchemaVersion: 2, ExpiresAt: days(90), BrokerSha256: sha(broker), HelperSha256: sha(helper), PublisherThumbprint: 'c'.repeat(40),
  Purpose: 'ACCEPTED_RELEASE', DeviceClasses: ['MOUSE', 'KEYBOARD', 'GAMEPAD'], SpeedClasses: ['HIGH', 'FULL'], MinimumWindowsBuild: 19045, DeniedDevices: [],
};
const raw = (value) => Buffer.from(JSON.stringify(value));
const sign = (bytes) => crypto.sign('sha256', bytes, { key: pair.privateKey, padding: crypto.constants.RSA_PKCS1_PSS_PADDING, saltLength: 32 });

const BAD = {
  'validation-purpose': { Purpose: 'VALIDATION_ONLY' },
  'unknown-device-class': { DeviceClasses: ['MOUSE', 'PRINTER'] },
  'no-device-class': { DeviceClasses: [] },
  'duplicate-device-class': { DeviceClasses: ['MOUSE', 'MOUSE'] },
  'low-speed': { SpeedClasses: ['LOW'] },
  'ancient-windows': { MinimumWindowsBuild: 1 },
  'fractional-build': { MinimumWindowsBuild: 19045.5 },
  'bad-denied-id': { DeniedDevices: ['not-an-id'] },
  'lowercase-denied-id': { DeniedDevices: ['abcd:1234'] },
  'too-long-lifetime': { ExpiresAt: days(500) },
  expired: { ExpiresAt: days(-1) },
  'listed-devices-mixed-in': { AuthorizedDeviceDigests: ['e'.repeat(64)] },
  extra: { Extra: true },
};

test('a general release policy is accepted and every bad variant refused', () => {
  assert.equal(parseGeneralPolicy(raw(general)).MinimumWindowsBuild, 19045);
  assert.ok(isGeneralRelease(raw(general)));
  for (const [name, change] of Object.entries(BAD)) assert.throws(() => parseGeneralPolicy(raw({ ...general, ...change })), undefined, name);
  const missing = { ...general }; delete missing.DeniedDevices;
  assert.throws(() => parseGeneralPolicy(raw(missing)));
  // The schema 1 parser never accepts schema 2, and schema 2 never accepts schema 1.
  assert.throws(() => parsePolicy(raw(general)));
  assert.ok(!isGeneralRelease(raw({ ...general, SchemaVersion: 1 })));
});

test('the app verifies a signed general release like any other policy', () => {
  const bytes = raw(general);
  assert.equal(verifyPolicy(bytes, sign(bytes), pem).Purpose, 'ACCEPTED_RELEASE');
  assert.throws(() => verifyPolicy(raw({ ...general, DeviceClasses: ['MOUSE'] }), sign(bytes), pem), /signature|invalid/i);
});

test('release tooling prepares canonical bytes, binds the executables, and keeps the validation path separate', () => {
  const prepared = workflow.prepareGeneralPolicy(raw({ ...general, DeviceClasses: ['GAMEPAD', 'MOUSE', 'KEYBOARD'] }), candidate);
  const parsed = JSON.parse(prepared);
  assert.deepEqual(Object.keys(parsed), ['SchemaVersion', 'ExpiresAt', 'BrokerSha256', 'HelperSha256', 'PublisherThumbprint', 'Purpose', 'DeviceClasses', 'SpeedClasses', 'MinimumWindowsBuild', 'DeniedDevices']);
  assert.deepEqual(parsed.DeviceClasses, ['GAMEPAD', 'KEYBOARD', 'MOUSE']);
  assert.throws(() => workflow.prepareGeneralPolicy(raw({ ...general, BrokerSha256: 'a'.repeat(64) }), candidate), /hash differs/);
  const signature = workflow.signGeneralPolicy(prepared, identity, secretFile);
  assert.equal(workflow.verifyPreparedGeneral(prepared, signature, identity, raw(general), candidate).SchemaVersion, 2);
  // The validation commands refuse a release, and the release commands refuse validation bytes.
  assert.throws(() => workflow.signPolicy(prepared, identity, secretFile));
  assert.throws(() => workflow.prepareGeneralPolicy(raw({ ...general, SchemaVersion: 1 }), candidate), /only prepares schema 2/);
  assert.throws(() => workflow.argumentsFor(['sign-release', '--write']));
});

test('JavaScript and the compiled C# helper agree on every general-release verdict', { timeout: 120000 }, () => {
  const corpus = [];
  const add = (name, bytes, accepted, signature = sign(bytes)) => {
    if (accepted) assert.doesNotThrow(() => verifyPolicy(bytes, signature, pem), name);
    else assert.throws(() => verifyPolicy(bytes, signature, pem), undefined, name);
    corpus.push({ name, bytes: bytes.toString('base64'), signature: signature.toString('base64'), publicKey: pem, accepted });
  };
  add('general-valid', raw(general), true);
  add('general-prepared', workflow.prepareGeneralPolicy(raw(general), candidate), true);
  for (const [name, change] of Object.entries(BAD)) add(name, raw({ ...general, ...change }), false);
  add('general-tampered', raw({ ...general, MinimumWindowsBuild: 17763 }), false, sign(raw(general)));
  add('general-duplicate-field', Buffer.from(raw(general).toString().replace('"SchemaVersion":2', '"SchemaVersion":2,"SchemaVersion":2')), false);
  const file = path.join(temporary, 'general-corpus.json');
  fs.writeFileSync(file, JSON.stringify(corpus));
  const result = execFileSync('dotnet', ['run', '--project', path.join(root, 'native/hidusbf-helper-fixture/Dialed.HidusbfProtocolFixture.csproj'), '--configuration', 'Release', '--verbosity', 'quiet', '--', '--verify-policy-corpus', file], { encoding: 'utf8', windowsHide: true });
  assert.ok(result.includes(`closed-policy-corpus-pass:${corpus.length}`), result);
});
