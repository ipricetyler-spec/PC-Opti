const test = require('node:test');
const { tempDir } = require('./helpers/temp-dir.cjs');
const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { buildScopeEvidence, collect, systemTextJson } = require('../scripts/collect-native-policy-scope.cjs');
const { buildReview } = require('../scripts/prepare-validation-policy-review.cjs');
const { resolveElectronVersion, writeStagedPackageJson } = require('../scripts/prepare-native-policy-package.cjs');
const { writeOrVerifyReport } = require('../scripts/verify-native-policy-package.cjs');

const digest = (value) => crypto.createHash('sha256').update(systemTextJson(value)).digest('hex');
const platform = { machine: 'EXAMPLE-PC', os: '10.0.26200.0', codeIntegrityOptions: 57349, secureBoot: 1, usbXhci: 'a'.repeat(64), usbPort: 'b'.repeat(64) };
const physical = (id, name, speed = 2) => ({ id, parent: 'USB\\ROOT_HUB30\\ROOT', name, location: `PORT:${name}`, inputKind: '', present: true, problem: 0, speed });
const child = (id, parent, kind) => ({ id, parent, name: kind, location: '', inputKind: kind, present: true, problem: 0, speed: -1 });
const controller = 'USB\\VID_054C&PID_0DF2\\EDGE';
const mouse = 'USB\\VID_1532&PID_00A5\\VIPER';
const keyboard = 'USB\\VID_1038&PID_1622\\APEX';
const scan = { nodes: [
  physical(controller, 'DualSense Edge'), child('HID\\VID_054C&PID_0DF2\\PAD', controller, 'GAMEPAD'),
  physical(mouse, 'Razer Viper V2 Pro', 1), child('HID\\VID_1532&PID_00A5\\MOUSE', mouse, 'MOUSE'),
  physical(keyboard, 'SteelSeries Apex 3 TKL', 1), child('HID\\VID_1038&PID_1622\\KEYBOARD', keyboard, 'KEYBOARD'),
] };

test('native digest serialization matches System.Text.Json default bytes', () => {
  const value = { PrintableAscii: Array.from({ length: 95 }, (_, index) => String.fromCharCode(index + 32)).join(''), NonAscii: 'é', Nested: ['USB\\VID_1532&PID_00A5', null, 57349, true] };
  const base64 = Buffer.from(JSON.stringify(value), 'utf8').toString('base64');
  const command = `$raw=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${base64}'));$doc=[System.Text.Json.JsonDocument]::Parse($raw);[Console]::Out.Write([System.Text.Json.JsonSerializer]::Serialize([object]$doc.RootElement,[System.Text.Json.JsonElement],[System.Text.Json.JsonSerializerOptions]::new()))`;
  const actual = childProcess.execFileSync('pwsh.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8', windowsHide: true, timeout: 30000 });
  assert.equal(systemTextJson(value), actual);
});

test('read-only scope binds the complete eligible platform but authorizes only selected devices', () => {
  const result = buildScopeEvidence(scan, platform, ['054C:0DF2', '1532:00A5']);
  assert.equal(result.selectedDevices.length, 2);
  assert.equal(result.eligibleInputScopes.length, 3);
  assert.equal(result.eligibleInputScopes.find((item) => item.productId === '1038:1622').selected, false);
  assert.equal(result.authorizedDeviceDigests.includes(result.eligibleInputScopes.find((item) => item.productId === '1038:1622').interfaceDigest), false);
  assert.equal(result.platformPreimage.Scopes.length, 3);
  assert.equal(result.platformDigest, digest(result.platformPreimage));
  for (const device of result.selectedDevices) assert.equal(device.interfaceDigest, digest(device.preimage));
  for (const device of result.eligibleInputScopes) assert.equal(device.interfaceDigest, digest(device.preimage));
  const apex = result.eligibleInputScopes.find((item) => item.productId === '1038:1622');
  assert.deepEqual(apex.preimage, {
    Device: keyboard, Parent: 'USB\\ROOT_HUB30\\ROOT', Location: 'PORT:SteelSeries Apex 3 TKL', Speed: 'FULL',
    Children: ['HID\\VID_1038&PID_1622\\KEYBOARD', keyboard],
  });
});

test('two-pass collection retains unselected preimages and refuses unselected topology drift', async () => {
  const options = { machine: 'EXAMPLE-PC', devices: ['054C:0DF2', '1532:00A5'] };
  const evidence = await collect(options, { scan: async () => scan, platform: () => platform });
  const apex = evidence.eligibleInputScopes.find((item) => item.productId === '1038:1622');
  assert.equal(digest(apex.preimage), apex.interfaceDigest);
  assert.equal(apex.selected, false);
  assert.equal(evidence.authorizedDeviceDigests.includes(apex.interfaceDigest), false);
  let calls = 0;
  await assert.rejects(() => collect(options, {
    scan: async () => ++calls === 1 ? scan : { nodes: scan.nodes.map((node) => node.id === keyboard ? { ...node, location: 'DIFFERENT_PORT' } : node) },
    platform: () => platform,
  }), /changed between/);
});

test('hubs cannot inherit input eligibility or link speed from downstream devices', () => {
  const hub = 'USB\\VID_174C&PID_2074\\HUB';
  const nested = 'USB\\VID_174C&PID_2074\\NESTED';
  const spare = 'USB\\VID_1C4F&PID_5C44\\SPARE';
  const composite = 'USB\\VID_1C4F&PID_5C44&MI_00\\INTERFACE';
  const hid = 'HID\\VID_1C4F&PID_5C44\\KEYBOARD';
  const original = buildScopeEvidence(scan, platform, ['054C:0DF2']);
  for (const speed of [0, 1, 2, -1]) {
    const nodes = [...scan.nodes,
      physical(hub, 'Hub'), { ...physical(nested, 'Nested hub'), parent: hub },
      { ...physical(spare, 'Spare keyboard', speed), parent: nested },
      child(composite, spare, ''), child(hid, composite, 'KEYBOARD')];
    const result = buildScopeEvidence({ nodes }, platform, ['054C:0DF2']);
    assert.equal(result.eligibleInputScopes.some(x => x.productId === '174C:2074'), false);
    const spareScope = result.eligibleInputScopes.find(x => x.productId === '1C4F:5C44');
    assert.equal(Boolean(spareScope), speed === 1 || speed === 2);
    assert.deepEqual(result.authorizedDeviceDigests, original.authorizedDeviceDigests);
    if (spareScope) {
      assert.deepEqual(spareScope.preimage.Children, [hid, composite, spare].sort());
      assert.equal(spareScope.speed, speed === 1 ? 'FULL' : 'HIGH');
      assert.notEqual(result.platformDigest, original.platformDigest);
    } else assert.equal(result.platformDigest, original.platformDigest);
    assert.throws(() => buildScopeEvidence({ nodes }, platform, ['174C:2074']), /exactly one/);
    const singleHub = nodes.filter(x => x.id !== nested).map(x => x.parent === nested ? { ...x, parent: hub } : x);
    assert.throws(() => buildScopeEvidence({ nodes: singleHub }, platform, ['174C:2074']), /not an eligible/);
    const mixedCase = nodes.map(x => ({ ...x, parent: x.parent.toLowerCase() })).reverse();
    const mixedResult = buildScopeEvidence({ nodes: mixedCase }, platform, ['054C:0DF2']);
    assert.deepEqual(mixedResult.eligibleInputScopes.map(x => x.productId), result.eligibleInputScopes.map(x => x.productId));
  }
});

test('read-only scope refuses a missing or ambiguous selected physical device', () => {
  assert.throws(() => buildScopeEvidence({ nodes: scan.nodes.filter((node) => !node.id.includes('054C')) }, platform, ['054C:0DF2', '1532:00A5']), /exactly one/);
  assert.throws(() => buildScopeEvidence({ nodes: [...scan.nodes, physical('USB\\VID_1532&PID_00A5\\SECOND', 'Second Viper', 1), child('HID\\VID_1532&PID_00A5\\SECOND', 'USB\\VID_1532&PID_00A5\\SECOND', 'MOUSE')] }, platform, ['054C:0DF2', '1532:00A5']), /exactly one/);
});

test('policy review uses final signed hashes and keeps the keyboard outside authorization', () => {
  const scopeResult = buildScopeEvidence(scan, platform, ['054C:0DF2', '1532:00A5']);
  const scope = { schemaVersion: 1, status: 'READ_ONLY_VALIDATION_SCOPE_REVIEWED', readOnly: true, deviceOperationsAuthorized: false, physicalAcceptance: false, observationCount: 2, machine: 'EXAMPLE-PC', selectedProducts: ['054C:0DF2', '1532:00A5'], acceptedPlatformDigests: [scopeResult.platformDigest], authorizedDeviceDigests: scopeResult.authorizedDeviceDigests };
  const artifact = (file, hash) => ({ file, sha256: hash, unsignedSha256: hash === 'c'.repeat(64) ? 'e'.repeat(64) : 'f'.repeat(64), authenticode: 'Valid', timestampPresent: true, signToolExit: 0, executed: false, publisherThumbprint: 'A'.repeat(40), publisher: 'CN=Example Publisher' });
  const signatures = { schemaVersion: 1, status: 'NATIVE_AUTHENTICODE_VERIFIED_POLICY_PENDING', ownerAuthorized: true, policyIssued: false, unsignedBuildPreserved: true, artifacts: [artifact('Dialed.HidusbfHost.exe', 'c'.repeat(64)), artifact('Dialed.HidusbfBroker.exe', 'd'.repeat(64))] };
  const now = Date.parse('2026-09-06T00:00:00.000Z');
  const review = buildReview(scope, signatures, '2026-09-10T00:00:00.000Z', now);
  assert.equal(review.HelperSha256, 'c'.repeat(64));
  assert.equal(review.BrokerSha256, 'd'.repeat(64));
  assert.equal(review.AuthorizedDeviceDigests.length, 2);
  assert.equal(review.Purpose, 'VALIDATION_ONLY');
  assert.throws(() => buildReview({ ...scope, status: 'READ_ONLY_VALIDATION_SCOPE_INCOMPLETE' }, signatures, review.ExpiresAt, now));
  assert.throws(() => buildReview(scope, { ...signatures, artifacts: [signatures.artifacts[0], { ...signatures.artifacts[1], publisherThumbprint: 'B'.repeat(40) }] }, review.ExpiresAt, now));
});

test('candidate packaging copies preserved signed bytes and cannot rebuild, re-sign or launch them', () => {
  const prepare = fs.readFileSync(path.join(__dirname, '../scripts/prepare-native-policy-package.cjs'), 'utf8');
  const verify = fs.readFileSync(path.join(__dirname, '../scripts/verify-native-policy-package.cjs'), 'utf8');
  assert.match(prepare, /path\.join\(candidate, 'signing', name\)/);
  assert.match(prepare, /nativeRebuilt:\s*false/);
  assert.match(prepare, /nativeResigned:\s*false/);
  assert.match(prepare, /productExecutableLaunched:\s*false/);
  assert.match(prepare, /--config\.electronVersion=/);
  assert.doesNotMatch(prepare, /build-hidusbf-native|signFile\(|electron:build/);
  assert.match(verify, /'verify', '\/pa', '\/all', '\/v', '\/tw'/);
  assert.match(verify, /readNativeBrokerStatus\(nativeRoot\)/);
  assert.doesNotMatch(verify, /createNativeBrokerLauncher|spawn\(.*Dialed/);
});

test('candidate packaging pins the installed Electron distribution to bun.lock', () => {
  const electron = resolveElectronVersion();
  assert.match(electron.version, /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/);
  assert.equal(fs.statSync(path.join(electron.distribution, 'electron.exe')).isFile(), true);
  assert.match(fs.readFileSync(path.join(__dirname, '../bun.lock'), 'utf8'), new RegExp(`"electron": \\["electron@${electron.version.replaceAll('.', '\\.')}"`));
});

test('candidate packaging retains administrator manifests while disabling rebuild and signing only in staged config', (context) => {
  const directory = tempDir('dialed-policy-package-');
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const destination = path.join(directory, 'package.json');
  writeStagedPackageJson(destination);
  const staged = JSON.parse(fs.readFileSync(destination, 'utf8'));
  const canonical = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'));
  assert.equal(staged.build.win.signtoolOptions, undefined);
  assert.equal(staged.build.win.signAndEditExecutable, true);
  assert.equal(staged.build.win.signExecutable, false);
  assert.equal(staged.build.win.requestedExecutionLevel, 'requireAdministrator');
  assert.equal(staged.build.portable.requestExecutionLevel, 'admin');
  assert.ok(canonical.build.win.signtoolOptions.sign);
  assert.equal(canonical.build.win.signExecutable, undefined);
  assert.equal(canonical.build.win.signAndEditExecutable, undefined);
  const source = fs.readFileSync(path.join(__dirname, '../scripts/prepare-native-policy-package.cjs'), 'utf8');
  assert.match(source, /--config\.npmRebuild=false/);
  assert.doesNotMatch(source, /--config\.win\.signAndEditExecutable=false/);
  assert.match(source, /--config\.win\.signExecutable=false/);
  assert.match(source, /CSC_IDENTITY_AUTO_DISCOVERY:\s*'false'/);
});

test('package reverification preserves matching immutable evidence and refuses drift', (context) => {
  const directory = tempDir('dialed-policy-verify-');
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const reportFile = path.join(directory, 'report.json');
  const sumsFile = path.join(directory, 'sums.txt');
  const report = { status: 'VERIFIED', verifiedAt: '2026-09-07T00:00:00.000Z', application: { sha256: 'a'.repeat(64) } };
  assert.equal(writeOrVerifyReport(report, reportFile, sumsFile, 'a  app\n'), 'WRITTEN_NEW');
  const reportHash = crypto.createHash('sha256').update(fs.readFileSync(reportFile)).digest('hex');
  assert.equal(writeOrVerifyReport({ ...report, verifiedAt: '2026-09-08T00:00:00.000Z' }, reportFile, sumsFile, 'a  app\n'), 'PRESERVED_AND_MATCHED');
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(reportFile)).digest('hex'), reportHash);
  assert.throws(() => writeOrVerifyReport({ ...report, application: { sha256: 'b'.repeat(64) } }, reportFile, sumsFile, 'a  app\n'), /differs/);
});
