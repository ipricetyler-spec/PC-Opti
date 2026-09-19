const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const optionalApps = require('../src/main/optional-apps/index.cjs');
const journal = require('../src/main/journal/index.cjs');
const capabilities = require('../src/main/capabilities/index.cjs');

function packageFixture(overrides = {}) {
  return {
    name: 'Microsoft.BingNews',
    packageFullName: 'Microsoft.BingNews_4.0.0.0_x64__8wekyb3d8bbwe',
    packageFamilyName: 'Microsoft.BingNews_8wekyb3d8bbwe',
    version: '4.0.0.0',
    architecture: 'X64',
    publisher: 'CN=Microsoft Corporation',
    nonRemovable: false,
    isFramework: false,
    signatureKind: 'Store',
    ...overrides,
  };
}

function listAdapter(packages) {
  return async () => ({ stdout: JSON.stringify(packages), stderr: '', exitCode: 0 });
}

test('optional app inventory shows only exact reviewed removable current-user packages', async () => {
  const inventory = await optionalApps.listOptionalAppCandidates({ runPowerShell: listAdapter([
    packageFixture(),
    packageFixture({ name: 'Microsoft.BingWeather', packageFullName: 'Microsoft.BingWeather_4.0.0.0_x64__8wekyb3d8bbwe', packageFamilyName: 'Microsoft.BingWeather_8wekyb3d8bbwe', nonRemovable: true }),
    packageFixture({ name: 'Microsoft.GetHelp', packageFullName: 'Microsoft.GetHelp_1.0.0.0_x64__8wekyb3d8bbwe', packageFamilyName: 'Microsoft.GetHelp_8wekyb3d8bbwe', isFramework: true }),
    packageFixture({ name: 'Microsoft.GamingServices', packageFullName: 'Microsoft.GamingServices_1.0.0.0_x64__8wekyb3d8bbwe', packageFamilyName: 'Microsoft.GamingServices_8wekyb3d8bbwe' }),
  ]) });
  assert.equal(inventory.items.length, 1);
  assert.equal(inventory.items[0].id, 'microsoft-news');
  assert.equal(inventory.items[0].scope, 'CURRENT_USER');
  assert.match(inventory.items[0].recovery, /Exact rollback is unavailable/);
  assert.match(inventory.limitations, /gaming services/);
  assert.equal(inventory.items[0].fingerprint.length, 64);
});

test('optional app preview is exact and rejects unreviewed or absent ids', async () => {
  const dependencies = { runPowerShell: listAdapter([packageFixture()]) };
  const preview = await optionalApps.previewOptionalAppRemoval('microsoft-news', dependencies);
  assert.equal(preview.packageFullName, packageFixture().packageFullName);
  assert.deepEqual(preview.changes, [`Remove exactly ${packageFixture().packageFullName} from the current Windows account.`]);
  assert.ok(preview.exclusions.some((value) => /No -AllUsers/.test(value)));
  await assert.rejects(optionalApps.previewOptionalAppRemoval('gaming-services', dependencies), /reviewed allowlist/);
  await assert.rejects(optionalApps.previewOptionalAppRemoval('microsoft-weather', dependencies), /no longer an eligible/);
});

test('optional app inventory excludes ambiguous duplicate Main or Bundle identities', async () => {
  const inventory = await optionalApps.listOptionalAppCandidates({ runPowerShell: listAdapter([
    packageFixture(),
    packageFixture({ packageFullName: 'Microsoft.BingNews_5.0.0.0_x64__8wekyb3d8bbwe', version: '5.0.0.0' }),
  ]) });
  assert.equal(inventory.items.length, 0);
  assert.match(inventory.limitations, /Duplicate identities/);
});

test('optional app eligibility requires the exact reviewed publisher-derived package family', async () => {
  const inventory = await optionalApps.listOptionalAppCandidates({ runPowerShell: listAdapter([
    packageFixture({ packageFamilyName: 'Microsoft.BingNews_unreviewed123' }),
  ]) });
  assert.equal(inventory.items.length, 0);
  assert.match(inventory.limitations, /publisher-derived family identity/);

  const clipchamp = packageFixture({
    name: 'Clipchamp.Clipchamp',
    packageFullName: 'Clipchamp.Clipchamp_3.1.10920.0_neutral__yxz26nhyzhsrt',
    packageFamilyName: 'Clipchamp.Clipchamp_yxz26nhyzhsrt',
    publisher: 'CN=Clipchamp Pty Ltd',
  });
  const clipchampInventory = await optionalApps.listOptionalAppCandidates({ runPowerShell: listAdapter([clipchamp]) });
  assert.equal(clipchampInventory.items.length, 1);
  assert.equal(clipchampInventory.items[0].id, 'clipchamp');
});

test('optional app inventory accepts valid Windows bundle separators but still rejects unsafe identities', async () => {
  const bundle = packageFixture({
    packageFullName: 'Microsoft.BingNews_4.0.0.0_neutral_~_8wekyb3d8bbwe',
    architecture: 'Neutral',
  });
  const inventory = await optionalApps.listOptionalAppCandidates({ runPowerShell: listAdapter([bundle]) });
  assert.equal(inventory.items.length, 1);
  assert.equal(inventory.items[0].packageFullName, bundle.packageFullName);

  for (const packageFullName of [
    'Microsoft.BingNews_4.0.0.0_x64__8wekyb3d8bbwe;Remove-AppxPackage',
    'Microsoft.BingNews_4.0.0.0_x64__8wekyb3d8bbwe$bad',
    'Microsoft.BingNews_4.0.0.0_x64__8wekyb3d8bbwe\nnext',
  ]) {
    assert.throws(() => optionalApps.normalizePackages([packageFixture({ packageFullName })]), /unsupported characters/);
  }
});

test('optional app removal command is exact current-user only and has no provisioned or all-user path', async () => {
  const preview = await optionalApps.previewOptionalAppRemoval('microsoft-news', { runPowerShell: listAdapter([packageFixture()]) });
  let script = '';
  const result = await optionalApps.removeOptionalAppPackage(preview, {
    runPowerShell: async (value) => {
      script = value;
      return { stdout: JSON.stringify({ packageFullName: preview.packageFullName, scope: 'CURRENT_USER', allUsers: false, provisionedImageChanged: false }), stderr: '', exitCode: 0 };
    },
  });
  assert.match(script, /Remove-AppxPackage -Package \$package/);
  assert.doesNotMatch(script, /Remove-AppxProvisionedPackage|-AllUsers/);
  assert.doesNotMatch(script, new RegExp(preview.packageFullName.replaceAll('.', '\\.')));
  assert.equal(result.output.allUsers, false);
  assert.equal(result.output.provisionedImageChanged, false);
});

test('optional bundle removal preserves the exact safe tilde identity through the encoded command path', async () => {
  const bundle = packageFixture({
    packageFullName: 'Microsoft.BingNews_4.0.0.0_neutral_~_8wekyb3d8bbwe',
    architecture: 'Neutral',
  });
  const preview = await optionalApps.previewOptionalAppRemoval('microsoft-news', { runPowerShell: listAdapter([bundle]) });
  let script = '';
  await optionalApps.removeOptionalAppPackage(preview, {
    runPowerShell: async (value) => {
      script = value;
      return { stdout: JSON.stringify({ packageFullName: preview.packageFullName, scope: 'CURRENT_USER' }), stderr: '', exitCode: 0 };
    },
  });
  assert.match(script, /A-Za-z0-9\._~-/);
  assert.doesNotMatch(script, new RegExp(bundle.packageFullName.replaceAll('.', '\\.')));
});

test('optional app journal records verified removal and refuses stale preview before mutation', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dialed-optional-app-'));
  const preview = await optionalApps.previewOptionalAppRemoval('microsoft-news', { runPowerShell: listAdapter([packageFixture()]) });
  const inventory = { scannedAt: new Date().toISOString(), items: [preview], limitations: 'fixture' };
  let removals = 0;
  const result = await journal.executeOptionalAppRemoval(directory, preview, {
    listOptionalAppCandidates: async () => inventory,
    removeOptionalAppPackage: async () => { removals += 1; return { stdout: 'removed', stderr: '', exitCode: 0, output: { packageFullName: preview.packageFullName, scope: 'CURRENT_USER' } }; },
    listCurrentUserPackages: async () => [],
  });
  assert.equal(result.success, true);
  assert.equal(removals, 1);
  assert.equal(result.entry.status, 'SUCCESS');
  assert.equal(result.entry.rollback.available, false);
  assert.equal(result.entry.resultingState.verifiedAbsent, true);
  assert.equal(capabilities.capabilityForAction(result.entry.actionId).id, 'windows:optional-app-remove-current-user');
  assert.equal(journal.readJournal(directory).length, 1);

  await assert.rejects(journal.executeOptionalAppRemoval(directory, { ...preview, fingerprint: '0'.repeat(64) }, {
    listOptionalAppCandidates: async () => inventory,
    removeOptionalAppPackage: async () => { removals += 1; },
  }), /changed after preview/);
  assert.equal(removals, 1);
  assert.equal(journal.readJournal(directory).length, 1);
});

test('optional app and Windows Settings IPC accept reviewed ids/tokens rather than commands or URIs', () => {
  const root = path.join(__dirname, '..');
  const mainSource = fs.readFileSync(path.join(root, 'electron', 'main.cjs'), 'utf8');
  const preloadSource = fs.readFileSync(path.join(root, 'electron', 'preload.cjs'), 'utf8');
  const componentSource = fs.readFileSync(path.join(root, 'src', 'components', 'WindowsControlsCenter.tsx'), 'utf8');
  assert.match(mainSource, /WINDOWS_SETTINGS_PAGES = Object\.freeze/);
  assert.match(mainSource, /previewOptionalAppRemoval\(appId\)/);
  assert.match(mainSource, /executeOptionalAppRemoval\(app\.getPath\('userData'\), pending\.preview\)/);
  assert.match(preloadSource, /previewOptionalAppRemoval: \(appId\)/);
  assert.match(preloadSource, /applyOptionalAppRemoval: \(token\)/);
  assert.match(preloadSource, /openWindowsSettings: \(pageId\)/);
  assert.doesNotMatch(preloadSource, /Remove-AppxPackage|ms-settings:|packageFullName/);
  assert.match(componentSource, /Dialed cannot undo a removal/);
  assert.match(componentSource, /No performance improvement is claimed/);
});
