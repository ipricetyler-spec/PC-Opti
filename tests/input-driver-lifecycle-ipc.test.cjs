const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const root = path.join(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const handler = (source, channel, nextChannel) => {
  const start = source.indexOf(`ipcMain.handle('${channel}'`);
  const end = nextChannel ? source.indexOf(`ipcMain.handle('${nextChannel}'`, start + 1) : source.indexOf('\n});', start) + 4;
  assert.ok(start >= 0 && end > start, `Missing IPC handler ${channel}.`);
  return source.slice(start, end);
};

test('driver lifecycle IPC remains narrow, selection-bound, capability-gated, and serialized', () => {
  const source = read('electron/main.cjs');
  const status = handler(source, 'pc-opti:get-input-driver-lifecycle-status', 'pc-opti:preview-input-driver-install');
  assert.match(status, /assertCapabilityAvailable\('input:usb-advisor'\)/);
  assert.match(status, /status\(assertInputDriverDeviceDigest\(deviceDigest, true\)\)/);

  const lifecycleChannels = [
    'pc-opti:preview-input-driver-install',
    'pc-opti:preview-input-driver-adoption',
    'pc-opti:preview-input-driver-repair',
    'pc-opti:preview-input-driver-upgrade',
    'pc-opti:preview-input-driver-detach',
    'pc-opti:preview-input-driver-package-removal',
    'pc-opti:apply-input-driver-lifecycle',
    'pc-opti:reconcile-input-driver-lifecycle',
  ];
  lifecycleChannels.forEach((channel, index) => {
    const next = lifecycleChannels[index + 1] || 'pc-opti:label-input-port';
    assert.match(handler(source, channel, next), /assertCapabilityAvailable\('input:driver-lifecycle'\)/, `${channel} must fail closed behind the candidate capability.`);
  });
  assert.match(handler(source, 'pc-opti:apply-input-driver-lifecycle', 'pc-opti:reconcile-input-driver-lifecycle'), /serializeMutation\(\(\) => inputDriverLifecycle\(\)\.apply/);
  assert.match(handler(source, 'pc-opti:reconcile-input-driver-lifecycle', 'pc-opti:label-input-port'), /serializeMutation\(\(\) => inputDriverLifecycle\(\)\.reconcile/);
  assert.match(source, /appRoot: process\.resourcesPath/);
  assert.match(source, /\^\[a-f0-9\]\{64\}\$/);
  assert.match(source, /Object\.freeze\(\[125, 250, 500, 1000, 2000, 4000, 8000\]\)/);
  assert.match(source, /value\.length < 20 \|\| value\.length > 80/);
});

test('preload exposes only device digests, reviewed rates, opaque tokens, and operation ids', () => {
  const source = read('electron/preload.cjs');
  const expected = [
    /getInputDriverLifecycleStatus: \(deviceDigest\) =>/,
    /previewInputDriverInstall: \(deviceDigest, requestedHz\) =>/,
    /previewInputDriverAdoption: \(deviceDigest, requestedHz\) =>/,
    /previewInputDriverRepair: \(deviceDigest\) =>/,
    /previewInputDriverUpgrade: \(\) =>/,
    /previewInputDriverDetach: \(deviceDigest\) =>/,
    /previewInputDriverPackageRemoval: \(\) =>/,
    /applyInputDriverLifecycle: \(token\) =>/,
    /reconcileInputDriverLifecycle: \(operationId\) =>/,
  ];
  expected.forEach((pattern) => assert.match(source, pattern));
  const lifecycleSurface = source.slice(source.indexOf('getInputDriverLifecycleStatus:'), source.indexOf('labelInputPort:'));
  assert.doesNotMatch(lifecycleSurface, /nativeId|devicePath|manifestPath|infPath|registry|serviceName|command|powershell|child_process/i);
});

test('production configuration and capability profiles keep lifecycle mutation unavailable', () => {
  const packageJson = JSON.parse(read('package.json'));
  const configuration = packageJson.dialed.inputDriver;
  assert.equal(configuration.status, 'UNCONFIGURED');
  assert.equal(configuration.manifestPath, '');
  assert.equal(configuration.manifestSha256, '');
  assert.equal(configuration.transactionStoreIdentity, '');
  assert.equal(configuration.cleanMachineAcceptance, 'PENDING');
  assert.equal(packageJson.build.extraResources.some((entry) => /input-driver|\.inf|\.sys|\.cat/i.test(JSON.stringify(entry))), false);

  const { RUNTIME_PROFILES, isCapabilityAvailable, listCapabilities } = require('../src/main/capabilities/index.cjs');
  const capability = listCapabilities().find((entry) => entry.id === 'input:driver-lifecycle');
  assert.ok(capability, 'Missing lifecycle capability record.');
  assert.deepEqual(capability.profiles, []);
  assert.equal(capability.publicAvailability, 'CANDIDATE');
  for (const profile of RUNTIME_PROFILES) {
    assert.equal(isCapabilityAvailable('input:driver-lifecycle', profile), false, `Lifecycle must remain unavailable in ${profile}.`);
    assert.equal(listCapabilities(profile).some((entry) => entry.id === 'input:driver-lifecycle'), false);
  }
});

test('renderer lifecycle affordances use service capabilities and preserve claim limits', () => {
  const source = read('src/components/InputDevicesCenter.tsx');
  assert.match(source, /getInputDriverLifecycleStatus\(selected\.id\)/);
  assert.match(source, /driverLifecycle\.capabilities\.install/);
  assert.match(source, /driverLifecycle\.capabilities\.adopt/);
  assert.match(source, /driverLifecycle\.capabilities\.repair/);
  assert.match(source, /driverLifecycle\.capabilities\.upgrade/);
  assert.match(source, /driverLifecycle\.capabilities\.detach/);
  assert.match(source, /driverLifecycle\.capabilities\.removePackage/);
  assert.match(source, /Nothing was applied\./);
  assert.match(source, /Dialed (?:will )?never restart(?:s)? Windows automatically/);
  assert.match(source, /does not prove USB transactions, fresh hardware reports, or lower latency/);
  assert.match(source, /Signed-package maintenance is currently unavailable/);
  assert.match(source, /This maintenance route has its own package and executor requirements/);
  assert.doesNotMatch(source, /Dialed does not install or bundle it/);
  assert.doesNotMatch(source, /Driver setup is not available inside this Dialed build yet/);
  assert.match(source, /data-technical-detail[^>]*className=.*Signed package evidence/s);
});
