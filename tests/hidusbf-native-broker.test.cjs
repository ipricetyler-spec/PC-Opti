const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { readNativeBrokerStatus, createNativeBrokerLauncher, verifyPolicy, setupSelectionArguments } = require('../src/main/input-driver-lifecycle/native-broker.cjs');

test('native setup exit emits one refresh signal without inventing an operation result', () => {
  const { EventEmitter } = require('node:events');
  const { observeSetupExit } = require('../src/main/input-driver-lifecycle/native-broker.cjs');
  const child = new EventEmitter(); const signals = [];
  observeSetupExit(child, (...args) => signals.push(args));
  assert.equal(signals.length, 0);
  child.emit('exit', 1); child.emit('exit', 0);
  assert.deepEqual(signals, [[]]);
});

test('native source cannot activate without a compiled release trust anchor', async () => {
  assert.equal(readNativeBrokerStatus('nonexistent').code, 'NATIVE_RELEASE_TRUST_UNCONFIGURED');
  await assert.rejects(createNativeBrokerLauncher('nonexistent')('a'.repeat(64)), /no signed native release/);
});

test('setup accepts only a bounded selection hint and never an operation, path or rate', async () => {
  const id = 'b'.repeat(64);
  assert.deepEqual(setupSelectionArguments(id), ['--select-device', id]);
  for (const value of [undefined, null, '', 'B'.repeat(64), 'g'.repeat(64), 'a'.repeat(63), 'a'.repeat(65),
    '--apply', 'USB\\VID_1234&PID_5678\\DEVICE', 8000, { deviceId: id, action: 'APPLY' }, [id], id + '\n']) {
    assert.throws(() => setupSelectionArguments(value), /valid input device/);
    await assert.rejects(createNativeBrokerLauncher('nonexistent')(value), /valid input device/);
  }
});

test('actual broker launcher passes only the selection digest and keeps launch environment isolated', async () => {
  const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
  const { EventEmitter } = require('node:events');
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 3072 });
  const host = Buffer.from('closed fixture host'), broker = Buffer.from('closed fixture broker');
  const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
  const policy = Buffer.from(JSON.stringify({ SchemaVersion: 1, ExpiresAt: '2099-01-01T00:00:00Z',
    BrokerSha256: hash(broker), HelperSha256: hash(host), PublisherThumbprint: 'C'.repeat(40),
    AcceptedPlatformDigests: ['d'.repeat(64)], Purpose: 'VALIDATION_ONLY', AuthorizedDeviceDigests: ['e'.repeat(64)] }));
  const files = { 'Dialed.HidusbfHost.exe': host, 'Dialed.HidusbfBroker.exe': broker, 'release-policy.json': policy,
    'release-policy.sig': crypto.sign('sha256', policy, { key: privateKey, padding: crypto.constants.RSA_PKCS1_PSS_PADDING, saltLength: 32 }) };
  const spawns = []; let child;
  const module = { exports: {} };
  const source = fs.readFileSync(path.join(__dirname, '../src/main/input-driver-lifecycle/native-broker.cjs'), 'utf8')
    .replace("const RELEASE_PUBLIC_KEY = '';", 'const RELEASE_PUBLIC_KEY = ' + JSON.stringify(publicKey.export({ type: 'spki', format: 'pem' })) + ';');
  vm.runInNewContext(source, { module, Buffer,
    process: { env: { SystemRoot: 'C:\\Windows', NODE_OPTIONS: '--require=unexpected', CORECLR_ENABLE_PROFILING: '1' } },
    require: name => {
      if (name === 'node:crypto') return crypto;
      if (name === 'node:path') return path;
      if (name === 'node:fs') return { lstatSync: () => ({ isSymbolicLink: () => false }),
        statSync: file => ({ size: files[path.basename(file)].length }), readFileSync: file => files[path.basename(file)] };
      if (name === './release-policy-contract.cjs') return require('../src/main/input-driver-lifecycle/release-policy-contract.cjs');
      if (name === 'node:child_process') return { spawn: (file, args, options) => {
        spawns.push({ file, args: Array.from(args), options }); child = new EventEmitter();
        queueMicrotask(() => child.emit('spawn')); return child;
      } };
      throw Error('Unexpected fixture dependency: ' + name);
    }
  });
  let closed = 0;
  const launch = module.exports.createNativeBrokerLauncher(path.resolve('fixture-only'), () => closed++);
  assert.equal(launch.isRunning(), false);
  await launch('a'.repeat(64));
  assert.equal(launch.isRunning(), true);
  assert.deepEqual(spawns[0].args, ['--select-device', 'a'.repeat(64)]);
  assert.equal(spawns[0].options.shell, false);
  assert.equal(spawns[0].options.env.NODE_OPTIONS, undefined);
  assert.equal(spawns[0].options.env.CORECLR_ENABLE_PROFILING, '0');
  await assert.rejects(launch('b'.repeat(64)), /already open/);
  assert.equal(spawns.length, 1);
  child.emit('exit', 0); assert.equal(closed, 1);
  assert.equal(launch.isRunning(), false);
  await launch('b'.repeat(64));
  assert.deepEqual(spawns[1].args, ['--select-device', 'b'.repeat(64)]);
});
test('native release policy verifies exact signature, expiry and bounded identities', () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 3072 });
  const policy = { SchemaVersion: 1, ExpiresAt: '2099-01-01T00:00:00Z', BrokerSha256: 'a'.repeat(64), HelperSha256: 'b'.repeat(64), PublisherThumbprint: 'C'.repeat(40), AcceptedPlatformDigests: ['d'.repeat(64)], Purpose: 'VALIDATION_ONLY', AuthorizedDeviceDigests: ['e'.repeat(64)] };
  const bytes = Buffer.from(JSON.stringify(policy));
  const sign = value => crypto.sign('sha256', value, { key: privateKey, padding: crypto.constants.RSA_PKCS1_PSS_PADDING, saltLength: 32 });
  assert.equal(verifyPolicy(bytes, sign(bytes), publicKey.export({ type: 'spki', format: 'pem' })).SchemaVersion, 1);
  const pem = publicKey.export({ type: 'spki', format: 'pem' });
  assert.throws(() => verifyPolicy(Buffer.from(JSON.stringify({ ...policy, BrokerSha256: 'd'.repeat(64) })), sign(bytes), pem), /signature/);
  assert.throws(() => verifyPolicy(bytes, sign(bytes), pem, Date.parse('2100-01-01')), /expired/);
  const bad = Buffer.from(JSON.stringify({ ...policy, Command: 'execute arbitrary command' }));
  assert.throws(() => verifyPolicy(bad, sign(bad), pem), /invalid/);
});
