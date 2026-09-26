const assert = require('node:assert/strict');
const { tempDir } = require('./helpers/temp-dir.cjs');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { afterEach, test } = require('node:test');

const scanner = require('../src/main/scanner/index.cjs');
const acceptanceUserData = require('../src/main/acceptance-user-data/index.cjs');
const journal = require('../src/main/journal/index.cjs');
const {
  EXECUTION_AUTHORITY_MODES,
  assertCurrentProcessAdministrator,
  capabilityForAction,
  listCapabilities,
  requireCapability,
  resolveRuntimeProfile,
} = require('../src/main/capabilities/index.cjs');
const { buildLocalRecommendations } = require('../src/main/recommendations/index.cjs');
const drift = require('../src/main/drift/index.cjs');
const { legacyDiagnostics, migrateSystemScanSnapshot, validateSystemScanSnapshot } = require('../src/main/snapshot/index.cjs');
const { createAcceptanceRecord, resolveOutput } = require('../scripts/collect-acceptance-baseline.cjs');
const benchmarks = require('../src/main/benchmarks/index.cjs');
const maintenance = require('../src/main/maintenance/index.cjs');
const licenseInventory = require('../scripts/generate-license-inventory.cjs');
const publicExperience = require('../src/lib/publicExperience.js');
const windowsSigning = require('../scripts/windows-signing.cjs');
const windowsElevation = require('../src/main/shared/windows-elevation.cjs');

const temporaryDirectories = [];

function createJournal(entries) {
  const directory = tempDir('pc-opti-test-');
  temporaryDirectories.push(directory);
  fs.writeFileSync(path.join(directory, 'journal.json'), JSON.stringify(entries), 'utf8');
  return directory;
}

afterEach(() => {
  while (temporaryDirectories.length) {
    fs.rmSync(temporaryDirectories.pop(), { recursive: true, force: true });
  }
});

test('release signing is opt-in, fail-closed, SHA-256 only, and avoids shell command interpolation', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  const signingSource = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'windows-signing.cjs'), 'utf8');
  const hookSource = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'electron-builder-sign.cjs'), 'utf8');

  assert.equal(packageJson.build.win.signtoolOptions.sign, './scripts/electron-builder-sign.cjs');
  assert.deepEqual(packageJson.build.win.signtoolOptions.signingHashAlgorithms, ['sha256']);
  assert.match(hookSource, /exports\.sign/);
  assert.match(signingSource, /spawnSync\(configuration\.signToolPath, args/);
  assert.doesNotMatch(signingSource, /execSync|shell:\s*true/);
  assert.match(signingSource, /timestamp\.acs\.microsoft\.com/);
  assert.match(signingSource, /'\/dlib'/);
  assert.match(signingSource, /'\/dmdf'/);
  assert.match(signingSource, /'SHA256'/);

  const disabled = windowsSigning.resolveSigningConfiguration({
    LOCALAPPDATA: 'C:\\fixture',
    'ProgramFiles(x86)': 'C:\\fixture',
  });
  assert.equal(disabled.requested, false);
  assert.equal(disabled.provider, 'none');
  assert.throws(
    () => windowsSigning.assertSigningReady({ ...disabled, required: true }),
    /required but DIALED_ENABLE_SIGNING/,
  );

  const artifactSigning = windowsSigning.resolveSigningConfiguration({
    DIALED_ENABLE_SIGNING: '1',
    DIALED_SIGNING_REQUIRED: '1',
    DIALED_ARTIFACT_SIGNING_ENDPOINT: 'https://eus.codesigning.azure.net/',
    DIALED_ARTIFACT_SIGNING_ACCOUNT: 'fixture-account',
    DIALED_ARTIFACT_SIGNING_PROFILE: 'fixture-profile',
    DIALED_ARTIFACT_SIGNING_TENANT_ID: '12345678-1234-4123-8123-123456789abc',
    DIALED_ARTIFACT_SIGNING_DLIB_PATH: 'C:\\fixture\\Azure.CodeSigning.Dlib.dll',
    DIALED_CODESIGN_TOOL_PATH: 'C:\\fixture\\signtool.exe',
  });
  assert.equal(artifactSigning.provider, 'azure-artifact-signing');
  assert.equal(artifactSigning.tenantId, '12345678-1234-4123-8123-123456789abc');
  assert.equal(artifactSigning.timeoutMs, 180000);
  assert.deepEqual(
    windowsSigning.parseExcludedCredentials('SharedTokenCacheCredential,AzureCliCredential'),
    ['SharedTokenCacheCredential', 'AzureCliCredential'],
  );
  assert.throws(
    () => windowsSigning.parseExcludedCredentials('InventedCredential'),
    /Unsupported Artifact Signing credential exclusion/,
  );
  assert.throws(
    () => windowsSigning.resolveSigningConfiguration({
      DIALED_ARTIFACT_SIGNING_ENDPOINT: 'https://127.0.0.1/',
      DIALED_ARTIFACT_SIGNING_ACCOUNT: 'fixture-account',
      DIALED_ARTIFACT_SIGNING_PROFILE: 'fixture-profile',
    }),
    /codesigning\.azure\.net/,
  );
  assert.throws(
    () => windowsSigning.resolveSigningConfiguration({
      DIALED_ARTIFACT_SIGNING_TENANT_ID: 'not-a-tenant-id',
    }),
    /tenant ID must be a valid UUID/,
  );
  assert.throws(
    () => windowsSigning.resolveSigningConfiguration({
      DIALED_CODESIGN_TIMEOUT_MS: '1000',
    }),
    /timeout must be between 30000 and 900000/,
  );
});

test('excludes core Windows processes from EcoQoS management', () => {
  assert.equal(scanner.isManageableProcess({ pid: 99, name: 'explorer' }), false);
  assert.equal(scanner.isManageableProcess({ pid: 100, name: 'LSASS' }), false);
  assert.equal(scanner.isManageableProcess({ pid: 4, name: 'third-party-app' }), false);
  assert.equal(scanner.isManageableProcess({ pid: 101, name: 'third-party-app' }), true);
});

test('excludes known anti-cheat processes from EcoQoS management', () => {
  const antiCheatProcessNames = [
    'vgc',
    'vgk',
    'vgtray',
    'easyanticheat',
    'easyanticheat_eos',
    'beservice',
    'bedaisy',
    'denuvo-anti-cheat',
    'denuvo-anti-cheat-crash-report',
    'denuvo-anti-cheat-update-service',
    'ricochet',
  ];
  for (const name of antiCheatProcessNames) {
    assert.equal(scanner.isManageableProcess({ pid: 200, name }), false, name);
  }
});

test('detects installed anti-cheats through injected service and driver inventories', async () => {
  let serviceReads = 0;
  let driverReads = 0;
  const detections = await scanner.detectInstalledAntiCheats({
    listWindowsServices: async () => {
      serviceReads++;
      return [
        { name: 'vgc', displayName: 'vgc', state: 'Running' },
        { name: 'EasyAntiCheat_EOS', displayName: 'Easy Anti-Cheat (EOS)', state: 'Stopped' },
        { name: 'BEService', displayName: 'BattlEye Service', state: 'Running' },
        { name: 'DenuvoAntiCheat_Example', displayName: 'Denuvo Anti-Cheat', state: 'Stopped' },
        { name: 'ordinary-service', displayName: 'Ordinary Service', state: 'Running' },
      ];
    },
    listWindowsDrivers: async () => {
      driverReads++;
      return [
        { name: 'vgk', displayName: 'vgk', state: 'Running' },
        { name: 'EasyAntiCheat_EOS', displayName: 'Easy Anti-Cheat', state: 'Stopped' },
        { name: 'BEDaisy', displayName: 'BattlEye Driver', state: 'Running' },
        { name: 'DenuvoAntiCheat_Example', displayName: 'Denuvo Anti-Cheat Driver', state: 'Stopped' },
        { name: 'atvi-randgrid_sr', displayName: 'System Driver', state: 'Stopped' },
      ];
    },
  });

  assert.equal(serviceReads, 1);
  assert.equal(driverReads, 1);
  assert.deepEqual(detections, [
    { product: 'Vanguard', serviceName: 'vgc', state: 'Running', driverPresent: true },
    { product: 'Easy Anti-Cheat', serviceName: 'EasyAntiCheat_EOS', state: 'Stopped', driverPresent: true },
    { product: 'BattlEye', serviceName: 'BEService', state: 'Running', driverPresent: true },
    { product: 'Denuvo', serviceName: 'DenuvoAntiCheat_Example', state: 'Stopped', driverPresent: true },
    { product: 'Ricochet', serviceName: '', state: 'Unknown', driverPresent: true },
  ]);
});

test('matches the installed Denuvo service, driver, and executable names', async () => {
  const detections = await scanner.detectInstalledAntiCheats({
    listWindowsServices: async () => [{
      name: 'Denuvo Anti-Cheat Update Service',
      displayName: 'Denuvo Anti-Cheat Update Service',
      state: 'Stopped',
    }],
    listWindowsDrivers: async () => [{
      name: 'Denuvo Anti-Cheat',
      displayName: 'Denuvo Anti-Cheat',
      state: 'Stopped',
    }],
  });

  assert.deepEqual(detections, [{
    product: 'Denuvo',
    serviceName: 'Denuvo Anti-Cheat Update Service',
    state: 'Stopped',
    driverPresent: true,
  }]);
  assert.equal(scanner.isManageableProcess({ pid: 200, name: 'denuvo-anti-cheat-update-service' }), false);

  const directory = createJournal([]);
  await assert.rejects(journal.enableProcessEcoQos(directory, {
    pid: 5002,
    name: 'denuvo-anti-cheat-update-service',
    cpuPercent: 0,
    workingSetBytes: 1,
    efficiencyMode: false,
  }), /Denuvo anti-cheat/);
  assert.deepEqual(journal.readJournal(directory), []);
});

test('initializes the versioned Windows power-throttling structure before reading EcoQoS', () => {
  const script = scanner.createEcoQosPowerShellScript('');
  const encodedDefinition = script.match(/FromBase64String\('([^']+)'\)/)?.[1];
  assert.ok(encodedDefinition, 'Expected the generated EcoQoS script to contain its encoded C# definition.');
  const definition = Buffer.from(encodedDefinition, 'base64').toString('utf8');
  assert.match(definition, /ref PROCESS_POWER_THROTTLING_STATE processInformation/);
  assert.match(definition, /Version = PROCESS_POWER_THROTTLING_CURRENT_VERSION/);
  assert.match(definition, /GetProcessInformation\(handle, ProcessPowerThrottling, ref state/);
});

test('acceptance recovery user data is explicit, home-bounded, marker-gated, and fail closed', () => {
  const homePath = path.resolve('C:\\Users\\fixture');
  const fixturePath = path.join(homePath, 'PCOpti-RecoveryFixture', 'pc-opti');
  const marker = JSON.stringify({
    schemaVersion: '1.0.0',
    purpose: acceptanceUserData.FIXTURE_PURPOSE,
    disposable: true,
  });
  const options = {
    argv: [`${acceptanceUserData.ACCEPTANCE_SWITCH}${fixturePath}`],
    environment: { PC_OPTI_DISPOSABLE_TEST_ENV: acceptanceUserData.DISPOSABLE_DECLARATION },
    homePath,
    readFile: (filePath) => {
      assert.equal(filePath, path.join(fixturePath, acceptanceUserData.FIXTURE_MARKER));
      return marker;
    },
  };
  assert.equal(acceptanceUserData.resolveAcceptanceUserDataPath(options), path.resolve(fixturePath));
  let configured = null;
  acceptanceUserData.configureAcceptanceUserDataPath({
    getPath: () => homePath,
    setPath: (name, value) => { configured = { name, value }; },
  }, options);
  assert.deepEqual(configured, { name: 'userData', value: path.resolve(fixturePath) });
  assert.equal(acceptanceUserData.resolveAcceptanceUserDataPath({ argv: [], environment: {}, homePath }), null);
  assert.throws(() => acceptanceUserData.resolveAcceptanceUserDataPath({ ...options, environment: {} }), /disposable-environment declaration/);
  assert.throws(() => acceptanceUserData.resolveAcceptanceUserDataPath({ ...options, argv: [`${acceptanceUserData.ACCEPTANCE_SWITCH}relative`] }), /absolute path/);
  assert.throws(() => acceptanceUserData.resolveAcceptanceUserDataPath({ ...options, argv: [`${acceptanceUserData.ACCEPTANCE_SWITCH}${path.resolve(homePath, '..', 'outside')}`] }), /inside the current test user home/);
  assert.throws(() => acceptanceUserData.resolveAcceptanceUserDataPath({ ...options, readFile: () => '{}' }), /does not authorize/);
});

test('rollback failures are rendered on Local Audit History instead of Startup Center', () => {
  const appSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'App.tsx'), 'utf8');
  const historySource = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'LocalAuditHistory.tsx'), 'utf8');
  const rollbackHandler = appSource.slice(appSource.indexOf('const rollbackAuditEntry'), appSource.indexOf('const exportAuditHistory'));
  assert.match(rollbackHandler, /setHistoryActionError\(null\)/);
  assert.match(rollbackHandler, /setHistoryActionError\(/);
  assert.doesNotMatch(rollbackHandler, /setStartupActionError\(/);
  assert.match(appSource, /<LocalAuditHistory[^>]+actionError=\{historyActionError\}/);
  assert.match(historySource, /role="alert"/);
  assert.match(historySource, /\{actionError\}/);
});

test('startup inventory uses an injected reader and preserves distinct logical Registry views', async () => {
  let reads = 0;
  const inventory = await scanner.listStartupItems({
    readStartupInventory: async () => {
      reads += 1;
      return [
        {
          name: 'CurrentUserEntry',
          path: 'current-user.exe',
          source: 'Registry',
          enabled: true,
          scope: 'Current user',
          canDisable: true,
          registryPath: 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run',
          registryView: 'Registry64',
          valueName: 'CurrentUserEntry',
          value: 'current-user.exe',
          registryValueKind: 'String',
        },
        ...['Registry64', 'Registry32'].map((registryView) => ({
          name: 'MachineEntry',
          path: 'machine.exe',
          source: 'Registry',
          enabled: true,
          scope: registryView === 'Registry64' ? 'All users (64-bit)' : 'All users (32-bit)',
          canDisable: true,
          registryPath: 'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run',
          registryView,
          valueName: 'MachineEntry',
          value: 'machine.exe',
          registryValueKind: 'ExpandString',
        })),
        {
          name: '\\Fixture\\LogonTask',
          path: 'task.exe',
          source: 'TaskScheduler',
          enabled: true,
          scope: 'Scheduled task',
          canDisable: false,
          taskPath: '\\Fixture\\',
          taskName: 'LogonTask',
        },
      ];
    },
  });

  assert.equal(reads, 1);
  assert.deepEqual(inventory.errors, []);
  assert.equal(inventory.items.length, 4);
  const currentUser = inventory.items.find((item) => item.name === 'CurrentUserEntry');
  const machine = inventory.items.filter((item) => item.name === 'MachineEntry');
  const task = inventory.items.find((item) => item.source === 'TaskScheduler');
  assert.equal(currentUser.canDisable, true);
  assert.deepEqual(new Set(machine.map((item) => item.registryView)), new Set(['Registry64', 'Registry32']));
  assert.equal(new Set(machine.map((item) => item.id)).size, 2);
  assert.ok(machine.every((item) => item.canDisable === true));
  assert.equal(task.canDisable, false);
});

test('rejects startup changes outside the documented persistent Run keys', async () => {
  await assert.rejects(
    journal.disableStartupItem(createJournal([]), {
      source: 'Registry',
      canDisable: true,
      registryPath: 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\RunOnce',
      registryView: 'Registry64',
      valueName: 'TransientEntry',
      value: 'example.exe',
      registryValueKind: 'String',
    }),
    /outside Dialed’s supported Registry scope/
  );
});

test('refuses rollback types that are not explicitly supported', async () => {
  const directory = createJournal([{
    id: 'unknown-rollback',
    status: 'SUCCESS',
    preAction: {},
    rollback: { available: true, kind: 'arbitrary-command', reason: 'unsafe test state' },
  }]);

  await assert.rejects(
    journal.rollbackAuditEntry(directory, 'unknown-rollback'),
    /does not have a supported deterministic rollback/
  );
});

test('refuses an unsafe Registry rollback before it can invoke PowerShell', async () => {
  const directory = createJournal([{
    id: 'machine-wide-rollback',
    status: 'SUCCESS',
    preAction: {
      source: 'Registry',
      registryPath: 'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run',
      registryView: 'UntrustedView',
      valueName: 'UnsafeMachineWideEntry',
      value: 'example.exe',
      registryValueKind: 'String',
    },
    rollback: { available: true, kind: 'restore-registry-run-value', reason: 'unsafe test state' },
  }]);

  await assert.rejects(
    journal.rollbackAuditEntry(directory, 'machine-wide-rollback'),
    /does not identify a supported Windows Registry view/
  );
});

test('refuses a forged journal rollback before it can invoke PowerShell', async () => {
  // The journal lives in per-user app data, so a process running as the same user
  // without elevation can append to it. None of these forged shapes may reach a
  // privileged Registry write.
  const startupPreAction = {
    source: 'Registry',
    registryPath: 'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run',
    registryView: 'Registry64',
    valueName: 'ForgedEntry',
    value: 'C:\\Users\\Public\\payload.exe',
    registryValueKind: 'String',
  };
  const forged = [
    {
      name: 'rollback kind Dialed never writes',
      entry: { preAction: startupPreAction, rollback: { available: true, kind: 'restore-arbitrary-registry-value', reason: 'forged' } },
      expected: /does not have a supported deterministic rollback/,
    },
    {
      name: 'control characters in the value name',
      entry: { preAction: { ...startupPreAction, valueName: 'Forged\u0000Entry' }, rollback: { available: true, kind: 'restore-registry-run-value', reason: 'forged' } },
      expected: /control characters/,
    },
    {
      name: 'control characters in the restored command',
      entry: { preAction: { ...startupPreAction, value: 'payload.exe\r\nsecond-command.exe' }, rollback: { available: true, kind: 'restore-registry-run-value', reason: 'forged' } },
      expected: /control characters/,
    },
    {
      name: 'oversized restored command',
      entry: { preAction: { ...startupPreAction, value: 'a'.repeat(8 * 1024 + 1) }, rollback: { available: true, kind: 'restore-registry-run-value', reason: 'forged' } },
      expected: /does not record a restorable startup command/,
    },
    {
      name: 'unsupported Registry value kind',
      entry: { preAction: { ...startupPreAction, registryValueKind: 'Binary' }, rollback: { available: true, kind: 'restore-registry-run-value', reason: 'forged' } },
      expected: /is not supported for reversible startup management/,
    },
    {
      name: 'a Registry path outside the supported scope',
      entry: { preAction: { ...startupPreAction, registryPath: 'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\RunOnce' }, rollback: { available: true, kind: 'restore-registry-run-value', reason: 'forged' } },
      expected: /outside Dialed’s supported Registry scope/,
    },
  ];

  for (const testCase of forged) {
    const directory = createJournal([{ id: 'forged', status: 'SUCCESS', title: 'Forged entry', ...testCase.entry }]);
    let restoreCalled = false;
    await assert.rejects(
      journal.rollbackAuditEntry(directory, 'forged', {
        restoreRegistryRunValue: async () => { restoreCalled = true; return nativeResult({}); },
        isCurrentProcessElevated: async () => true,
      }),
      testCase.expected,
      `expected refusal for ${testCase.name}`
    );
    assert.equal(restoreCalled, false, `${testCase.name} must be refused before any Registry write`);
  }
});

test('journal rollback does not force canDisable onto a stored pre-action', () => {
  // A stored pre-action never carries canDisable; forcing it would also mean the
  // stored shape was never independently validated on the rollback path.
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'journal', 'index.cjs'), 'utf8');
  assert.doesNotMatch(source, /assertManageableStartupItem\(\{ \.\.\.original\.preAction/);
  assert.match(source, /assertRestorableStartupPreAction\(original\.preAction\)/);
});

test('capability registry uniquely classifies every executable action family', () => {
  const capabilities = listCapabilities();
  assert.equal(new Set(capabilities.map((item) => item.id)).size, capabilities.length);
  for (const item of capabilities) {
    assert.match(item.safetyClass, /^S[0-5]$/);
    assert.ok(item.verificationMethod);
    assert.ok(item.measurableSuccessCriteria);
    assert.ok(item.privilegeRequirement);
    assert.match(item.executionAuthority.mode, /^(STANDARD_USER|CURRENT_PROCESS_ADMIN|SIGNED_HELPER_UAC|OS_PERMISSION|INSTALLER_UAC|MANUAL_OUTSIDE_APP)$/);
    assert.ok(item.executionAuthority.enforcement);
    assert.match(item.publicAvailability, /^(ENABLED|CANDIDATE|DISABLED)$/);
  }
  assert.equal(capabilityForAction('clear-temp-files').id, 'maintenance:clear-temp-files');
  assert.equal(capabilityForAction('retrim-drive:C').id, 'maintenance:retrim-drive');
  assert.equal(capabilityForAction('startup:disable-machine:abcdefabcdefabcdefabcdef').id, 'startup:disable-machine-run');
  assert.equal(capabilityForAction('arbitrary-command'), null);
});

test('every privileged capability has an explicit authority contract wired to its mutation boundary', () => {
  const capabilities = listCapabilities();
  const currentProcessAdminIds = capabilities
    .filter((item) => item.executionAuthority.mode === EXECUTION_AUTHORITY_MODES.CURRENT_PROCESS_ADMIN)
    .map((item) => item.id)
    .sort();
  assert.deepEqual(currentProcessAdminIds, [
    'graphics:hardware-gpu-scheduling',
    'graphics:multiplane-overlay',
    'input:polling-rate',
    'input:xhci-tier',
    'policy:block-background-apps',
    'policy:disable-windows-consumer-features',
    'policy:exclude-windows-update-drivers',
    'policy:no-auto-restart-signed-in',
    'startup:disable-machine-run',
    'timing:disable-dynamic-tick',
    'timing:global-timer-resolution',
    'timing:restore-automatic-clock-source',
    'timing:restore-default-dynamic-tick',
  ]);

  for (const capability of capabilities.filter((item) => /administrator|elevated|\bUAC\b/i.test(item.privilegeRequirement))) {
    assert.notEqual(capability.executionAuthority.mode, EXECUTION_AUTHORITY_MODES.STANDARD_USER, capability.id);
  }
  for (const capabilityId of currentProcessAdminIds) {
    assert.throws(() => assertCurrentProcessAdministrator(capabilityId, false), /running as administrator/);
    assert.equal(assertCurrentProcessAdministrator(capabilityId, true).mode, EXECUTION_AUTHORITY_MODES.CURRENT_PROCESS_ADMIN);
  }

  const inputSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'input-devices', 'index.cjs'), 'utf8');
  const journalSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'journal', 'index.cjs'), 'utf8');
  for (const capabilityId of ['input:polling-rate', 'input:xhci-tier']) {
    assert.ok([...inputSource.matchAll(new RegExp(`assertCurrentProcessAdministrator\\('${capabilityId}'`, 'g'))].length >= 2, capabilityId);
  }
  for (const capabilityId of ['policy:disable-windows-consumer-features', 'startup:disable-machine-run']) {
    assert.ok([...journalSource.matchAll(new RegExp(`'${capabilityId}'`, 'g'))].length >= 2, capabilityId);
  }
  for (const capabilityId of ['timing:disable-dynamic-tick', 'timing:restore-automatic-clock-source', 'timing:restore-default-dynamic-tick']) {
    assert.match(journalSource, new RegExp(`'${capabilityId}'`), capabilityId);
  }
  // Machine-scope Windows settings: every one is an administrator capability, and both the
  // apply and the rollback check elevation for machine scope.
  const { USER_SETTINGS } = require('../src/main/user-settings/index.cjs');
  for (const setting of Object.values(USER_SETTINGS)) {
    assert.equal(currentProcessAdminIds.includes(setting.capabilityId), setting.scope === 'machine', setting.capabilityId);
  }
  assert.equal([...journalSource.matchAll(/if \(setting\.scope === 'machine'\) \{\s*assertCurrentProcessAdministrator\(\s*setting\.capabilityId/g)].length, 2);

  const lifecycle = capabilities.find((item) => item.id === 'input:driver-lifecycle');
  assert.equal(lifecycle.executionAuthority.mode, EXECUTION_AUTHORITY_MODES.SIGNED_HELPER_UAC);
  assert.deepEqual(lifecycle.profiles, []);
  const lifecycleSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'input-driver-lifecycle', 'index.cjs'), 'utf8');
  assert.match(lifecycleSource, /ELEVATION_CANCELLED/);
  assert.match(lifecycleSource, /TRUSTED_ADAPTER_KIND/);
});

test('Windows elevation uses one shared query plus an independent native mutation-boundary check', async () => {
  assert.equal(windowsElevation.parseWindowsElevation('{"elevated":true}'), true);
  assert.equal(windowsElevation.parseWindowsElevation('{"elevated":false}'), false);
  assert.throws(() => windowsElevation.parseWindowsElevation('{"elevated":"yes"}'), /invalid elevation result/);
  assert.equal(await windowsElevation.queryCurrentProcessElevation(async (script) => {
    assert.equal(script, windowsElevation.WINDOWS_ELEVATION_POWERSHELL);
    return { stdout: '{"elevated":true}' };
  }), true);

  const journalSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'journal', 'index.cjs'), 'utf8');
  const scannerSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'scanner', 'index.cjs'), 'utf8');
  const nativeSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'input-devices', 'native.ps1'), 'utf8');
  assert.match(journalSource, /queryCurrentProcessElevation\(runPowerShell\)/);
  assert.match(scannerSource, /WINDOWS_ELEVATION_POWERSHELL/);
  assert.doesNotMatch(`${journalSource}\n${scannerSource}`, /New-Object Security\.Principal\.WindowsPrincipal/);
  // The native process deliberately retains its own check because it is the
  // final mutation boundary and must not trust renderer or parent-process state.
  assert.match(nativeSource, /\$admin = \(\[Security\.Principal\.WindowsPrincipal\]/);
  assert.match(nativeSource, /WindowsBuiltInRole\]::Administrator/);
});

test('runtime profile resolution is packaged-main-owned while monetization deferral keeps implemented capabilities available', () => {
  assert.equal(resolveRuntimeProfile({ packageDefault: 'owner', environmentOverride: 'public', isPackaged: true }), 'owner');
  assert.equal(resolveRuntimeProfile({ packageDefault: 'owner', environmentOverride: 'public', isPackaged: false }), 'public');
  assert.throws(() => resolveRuntimeProfile({ packageDefault: 'unexpected' }), /must be one of/);

  const publicCapabilities = listCapabilities('public');
  const publicIds = new Set(publicCapabilities.map((item) => item.id));
  const ownerIds = new Set(listCapabilities('owner').map((item) => item.id));
  const driverLifecycleCandidate = listCapabilities().find((item) => item.id === 'input:driver-lifecycle');
  assert.ok(publicCapabilities.every((item) => item.publicAvailability === 'ENABLED'));
  assert.equal(driverLifecycleCandidate.publicAvailability, 'CANDIDATE');
  assert.deepEqual(driverLifecycleCandidate.profiles, []);
  assert.equal(publicIds.has('input:driver-lifecycle'), false);
  assert.equal(ownerIds.has('input:driver-lifecycle'), false);
  assert.throws(() => requireCapability('input:driver-lifecycle', 'owner'), /unavailable/);
  assert.ok(publicIds.has('diagnostic:system-scan'));
  assert.ok(publicIds.has('startup:disable-current-user-run'));
  assert.ok(publicIds.has('startup:disable-machine-run'));
  assert.ok(ownerIds.has('startup:disable-machine-run'));
  assert.ok(publicIds.has('history:view-local'));
  assert.ok(publicIds.has('history:recover-corrupt'));
  assert.ok(publicIds.has('process:enable-ecoqos'));
  assert.ok(publicIds.has('maintenance:clear-temp-files'));
  assert.ok(publicIds.has('benchmark:import-compare'));
  assert.ok(publicIds.has('benchmark:delete-experiment'));
  assert.equal(requireCapability('process:enable-ecoqos', 'public').id, 'process:enable-ecoqos');
  assert.equal(requireCapability('startup:disable-machine-run', 'public').id, 'startup:disable-machine-run');
  assert.equal(requireCapability('process:enable-ecoqos', 'owner').id, 'process:enable-ecoqos');
  const premiumIds = new Set(listCapabilities('consumer-premium').map((item) => item.id));
  assert.deepEqual([...publicIds].sort(), [...ownerIds].sort());
  assert.deepEqual([...publicIds].sort(), [...premiumIds].sort());
});

test('navigation shows eight sections over the ten workspaces and keeps detailed tools in scoped subtabs', () => {
  const appSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'App.tsx'), 'utf8');
  const sidebarSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'Sidebar.tsx'), 'utf8');
  assert.match(appSource, /\['readiness', 'overview', 'startup', 'game-settings', 'gpu', 'network-quality', 'input-devices', 'performance-lab', 'drift', 'workload-profiles'\]/);
  for (const label of ['Home', 'Tweaks', 'Games', 'GPU', 'Measure', 'Input devices', 'Restore', 'Settings']) assert.match(sidebarSource, new RegExp(`label: '${label}'`));
  // Scan and the network test stay reachable, inside Home and Measure.
  assert.match(sidebarSource, /includes: \[\{ id: 'overview'/);
  assert.match(sidebarSource, /includes: \[\{ id: 'network-quality'/);
  assert.match(appSource, /ariaLabel="Home views" items=\{\[\{ id: 'readiness', label: 'Summary' \}, \{ id: 'overview', label: 'Scan details' \}\]\}/);
  // Measure has one guided way in. Every recording stays reachable, from a finished result
  // rather than as a second doorway that looked like a separate kind of benchmarking.
  assert.match(appSource, /ariaLabel="Measure views" items=\{\[\{ id: 'test', label: 'Test a change' \}, \{ id: 'network-quality', label: 'Network' \}\]\}/);
  assert.match(appSource, /onOpenRecordings=\{\(\) => setMeasureView\('results'\)\}/);
  assert.match(appSource, /measureView === 'results' && <Suspense[^\n]*<BenchmarkEvidence/);
  assert.doesNotMatch(sidebarSource, /Clean-room parity|Plan composer|Game & Network|Performance Lab/);
  assert.match(appSource, /activeTab === 'startup' && optimizeView === 'timing' && <Suspense[^\n]*<PerformanceLab/);
  // The goal picker was removed: it only reordered a short list and read as more than it did.
  assert.doesNotMatch(appSource, /WorkloadProfiles|orderRecommendationsForGoal/);
});

test('readiness is discrete and treats unstable or regressed benchmark evidence as review', () => {
  const base = {
    hasSnapshot: true,
    unresolvedHistory: 0,
    antiCheatStatus: 'PASS',
    reviewRecommendations: 0,
    benchmarkComparisons: [],
  };
  assert.equal(publicExperience.computeReadinessState(base).state, 'Ready');
  assert.equal(publicExperience.computeReadinessState({ ...base, hasSnapshot: false }).state, 'Blocked');
  for (const classification of ['INCOMPLETE', 'INCOMPARABLE', 'HIGH_VARIANCE', 'INCONCLUSIVE', 'REGRESSION']) {
    assert.equal(publicExperience.computeReadinessState({ ...base, benchmarkComparisons: [{ classification }] }).state, 'Review', classification);
  }
  assert.equal(publicExperience.computeReadinessState({ ...base, benchmarkComparisons: [{ classification: 'MEASURED_DIFFERENCE' }] }).state, 'Ready');
  const readinessSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'ReadinessCenter.tsx'), 'utf8');
  assert.doesNotMatch(readinessSource, /Outcome score|readinessScore|percent aligned/i);
});

test('the verified system scan has one canonical page and secondary views route to it', () => {
  const root = path.join(__dirname, '..', 'src', 'components');
  const dashboard = fs.readFileSync(path.join(root, 'DashboardOverview.tsx'), 'utf8');
  const readiness = fs.readFileSync(path.join(root, 'ReadinessCenter.tsx'), 'utf8');
  const insights = fs.readFileSync(path.join(root, 'SystemInsightCenters.tsx'), 'utf8');
  const network = fs.readFileSync(path.join(root, 'NetworkQualityLab.tsx'), 'utf8');
  const drift = fs.readFileSync(path.join(root, 'DriftMonitor.tsx'), 'utf8');
  assert.match(dashboard, /Scan this PC/);
  assert.match(dashboard, /Scan finished/);
  for (const source of [readiness, insights, network, drift]) {
    assert.doesNotMatch(source, />Run verified scan</);
    assert.doesNotMatch(source, />Refresh verified scan</);
    assert.doesNotMatch(source, />Rescan and compare</);
  }
  assert.match(readiness, /Scan details/);
  assert.match(network, /Open Scan/);
  assert.match(drift, /Scan details/);
});

test('public commerce is absent from active source and the historical prototype is explicitly parked', () => {
  const appSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'App.tsx'), 'utf8');
  const mainSource = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8');
  const preloadSource = fs.readFileSync(path.join(__dirname, '..', 'electron', 'preload.cjs'), 'utf8');
  const parkedRoot = path.join(__dirname, '..', 'parked', 'monetization');
  const parkedReadme = fs.readFileSync(path.join(parkedRoot, 'README.md'), 'utf8');
  const monetizationSource = fs.readFileSync(path.join(parkedRoot, 'src', 'lib', 'consumerMonetization.ts'), 'utf8');
  const parkedLicenseSource = fs.readFileSync(path.join(parkedRoot, 'src', 'main', 'license', 'index.cjs'), 'utf8');
  const tsconfig = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'tsconfig.json'), 'utf8'));
  const publicBranch = appSource.slice(appSource.indexOf("if (runtimeProfile.profile !== 'owner')"), appSource.indexOf('const tabs: AppTab[] = [];', appSource.indexOf("if (runtimeProfile.profile !== 'owner')")));
  assert.doesNotMatch(publicBranch, /tabs\.push\('upgrade'\)/);
  assert.equal(fs.existsSync(path.join(__dirname, '..', 'src', 'lib', 'consumerMonetization.ts')), false);
  assert.equal(fs.existsSync(path.join(__dirname, '..', 'src', 'components', 'ConsumerUpgradeCenter.tsx')), false);
  assert.equal(fs.existsSync(path.join(__dirname, '..', 'src', 'main', 'license', 'index.cjs')), false);
  assert.match(parkedReadme, /inactive, unreachable, and excluded/);
  assert.ok(tsconfig.exclude.includes('parked'));
  assert.match(monetizationSource, /parsed\.protocol !== 'https:'/);
  assert.match(monetizationSource, /TODO\|your-domain\|example\|placeholder\|custom-hosted-checkout/);
  assert.match(monetizationSource, /isConsumerCommerceConfigured/);
  assert.match(parkedLicenseSource, /ACTIVATION_CODE_MAP = Object\.freeze\(\{\}\)/);
  assert.doesNotMatch(parkedLicenseSource, /PCOPTI-PRO-LIFE|PCOPTI-PRO-ANNUAL/);
  assert.doesNotMatch(appSource, /ConsumerUpgradeCenter|startConsumerTrial|redeemConsumerLicense/);
  assert.doesNotMatch(mainSource, /start-consumer-trial|redeem-consumer-license|readLicenseState|hasPremiumEntitlement/);
  assert.doesNotMatch(preloadSource, /startConsumerTrial|redeemConsumerLicense/);
});

test('startup mutation scope stays main-owned and renderer receives no Registry mutation coordinates', () => {
  const mainSource = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8');
  const preloadSource = fs.readFileSync(path.join(__dirname, '..', 'electron', 'preload.cjs'), 'utf8');
  const appSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'App.tsx'), 'utf8');
  const typesSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'types.ts'), 'utf8');
  const startupSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'StartupCenter.tsx'), 'utf8');
  const handler = mainSource.slice(
    mainSource.indexOf("ipcMain.handle('pc-opti:disable-startup-item'"),
    mainSource.indexOf("ipcMain.handle('pc-opti:list-manageable-processes'")
  );
  const rendererType = typesSource.slice(
    typesSource.indexOf('export interface StartupManagementItem'),
    typesSource.indexOf('export interface ManageableProcess')
  );

  assert.match(preloadSource, /disableStartupItem: \(itemId\) => ipcRenderer\.invoke\('pc-opti:disable-startup-item', itemId\)/);
  assert.match(appSource, /disableStartupItem\(item\.id\)/);
  assert.match(handler, /latestStartupItems\.get\(itemId\)/);
  assert.match(handler, /startsWith\('HKLM:\\\\'\)/);
  assert.match(handler, /assertCapabilityAvailable\(capabilityId\)/);
  assert.ok(handler.indexOf('latestStartupItems.get(itemId)') < handler.indexOf('assertCapabilityAvailable(capabilityId)'));
  assert.doesNotMatch(rendererType, /registryPath|registryView|valueName|registryValueKind/);
  assert.match(startupSource, /scheduled tasks remain visible and read-only/);
  assert.match(appSource, /Dialed must be running as administrator/);
  assert.match(appSource, /Security impact: \$\{securityImplications\}/);
  assert.match(appSource, /capability\.id === capabilityId\)\?\.securityImplications/);
});

test('renderer cannot select or elevate the main-owned runtime profile', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  const preloadSource = fs.readFileSync(path.join(__dirname, '..', 'electron', 'preload.cjs'), 'utf8');
  const mainSource = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8');
  assert.equal(packageJson.build.productName, 'Dialed');
  assert.equal(packageJson.dialed.defaultProfile, 'public');
  assert.equal(packageJson.name, packageJson.dialed.legacyPackageName);
  assert.equal(packageJson.build.appId, packageJson.dialed.legacyAppId);
  assert.equal(packageJson.dialed.legacyUserDataDirectory, 'pc-opti');
  assert.match(preloadSource, /getRuntimeProfile: \(\) =>/);
  assert.doesNotMatch(preloadSource, /getRuntimeProfile: \([^)]*profile/i);
  assert.match(mainSource, /packageDefault: packageJson\.dialed\?\.defaultProfile/);
  assert.match(mainSource, /isPackaged: app\.isPackaged/);
  assert.match(mainSource, /assertCapabilityAvailable\(capabilityId\)/);
  assert.match(mainSource, /assertCapabilityAvailable\('benchmark:import-compare'\)/);
});

test('grounded AI is parked and absent from the v0.1 runtime surface', () => {
  const repositoryRoot = path.join(__dirname, '..');
  const parkedSource = fs.readFileSync(path.join(repositoryRoot, 'parked', 'ai-audit', 'index.cjs'), 'utf8');
  const liveSources = [
    'electron/main.cjs',
    'electron/preload.cjs',
    'src/App.tsx',
    'src/components/DashboardOverview.tsx',
    'src/electron.d.ts',
    'src/types.ts',
    'src/main/capabilities/index.cjs',
    '.env.example',
  ].map((file) => fs.readFileSync(path.join(repositoryRoot, file), 'utf8')).join('\n');
  const packageJson = JSON.parse(fs.readFileSync(path.join(repositoryRoot, 'package.json'), 'utf8'));

  assert.match(parkedSource, /GoogleGenAI/);
  assert.equal(packageJson.dependencies['@google/genai'], undefined);
  assert.equal(listCapabilities().some((item) => item.id === 'ai:external-redacted-audit'), false);
  assert.doesNotMatch(liveSources, /ai-audit|grounded ai|gemini|runAiAudit|getAiAuditPreview|@google\/genai/i);
});

test('interrupted unknown actions become review-only instead of assumed successful', async () => {
  const directory = createJournal([{
    id: 'pending-unknown',
    actionId: 'unknown-action',
    title: 'Unknown interrupted action',
    status: 'PENDING',
    preAction: {},
    rollback: { available: false, reason: 'Unknown action' },
  }]);
  const result = await journal.reconcilePendingEntries(directory);
  assert.equal(result.reconciled, 1);
  const [entry] = journal.readJournal(directory);
  assert.equal(entry.status, 'NEEDS_REVIEW');
  assert.equal(entry.reconciliation.classification, 'UNKNOWN');
  assert.equal(entry.rollback.available, false);
});

test('audit journal rejects a BOM-prefixed fixture without rewriting its evidence', () => {
  const directory = tempDir('pc-opti-test-');
  temporaryDirectories.push(directory);
  const filePath = path.join(directory, 'journal.json');
  const bytes = Buffer.concat([
    Buffer.from([0xef, 0xbb, 0xbf]),
    Buffer.from(JSON.stringify([{ id: 'bom-fixture', status: 'PENDING' }]), 'utf8'),
  ]);
  fs.writeFileSync(filePath, bytes);
  assert.throws(() => journal.readJournal(directory), /Could not read the local audit journal/);
  assert.deepEqual(fs.readFileSync(filePath), bytes);
});

test('packaging preserves the owner-selected administrator launch and rejects a fixed loopback UI', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  const mainSource = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8');
  assert.equal(packageJson.build.win.requestedExecutionLevel, 'requireAdministrator');
  assert.deepEqual(packageJson.build.win.target, ['nsis']);
  assert.equal(packageJson.build.portable, undefined);
  assert.doesNotMatch(mainSource, /loadURL\(['"]http:\/\/127\.0\.0\.1/);
  assert.match(mainSource, /loadFile\(/);
});

test('completion and release-safety documents are present', () => {
  const required = [
    'README.md', 'PROJECT_HANDOFF.md', 'DECISIONS.md', 'VERIFICATION.md',
    'ROADMAP.md', 'CHANGELOG.md', 'SECURITY.md', 'CONTRIBUTING.md',
    'docs/ARCHITECTURE.md', 'docs/HIDUSBF_INTEGRATION.md',
    'docs/DECISION_LOG.md', 'docs/APPROVAL_QUEUE.md', 'docs/SAFETY_MODEL.md',
    'docs/CAPABILITY_MATRIX.md', 'docs/PRIVACY_DATA_FLOW.md', 'docs/BENCHMARK_METHODOLOGY.md',
    'docs/LEGAL_CONSUMER_RELEASE_REVIEW.md', 'docs/OWNER_ACCEPTANCE_TEST.md',
    'docs/PUBLIC_RELEASE_CHECKLIST.md', 'docs/THIRD_PARTY_INVENTORY.md',
  ];
  for (const relativePath of required) {
    const filePath = path.join(__dirname, '..', relativePath);
    assert.ok(fs.existsSync(filePath), `${relativePath} must exist`);
    assert.ok(fs.statSync(filePath).size > 100, `${relativePath} must not be an empty placeholder`);
  }
});

function legacySnapshot(overrides = {}) {
  return {
    schemaVersion: '1.0.0',
    timestamp: '2026-08-15T00:00:00.000Z',
    deviceHash: 'local-only-hash',
    metrics: {
      os: { caption: 'Windows', version: '10.0', build: '26100', architecture: '64-bit' },
      cpu: { name: 'CPU', cores: 8, logicalProcessors: 16, maxClockSpeedMhz: 4000 },
      memory: { totalBytes: 32_000, freeBytes: 8_000, loadPercentage: 75 },
      storage: [{ driveLetter: 'C', label: 'Private', totalBytes: 100_000, freeBytes: 5_000, isSSD: true, trimEnabled: true }],
      startupItems: [{ name: 'App', path: 'private.exe', source: 'Registry', enabled: true }],
      tempFiles: { totalSizeBytes: 1_024, pathCount: 2 },
      ...overrides,
    },
    metadata: { executionTimeMs: 1, elevated: false, errors: [] },
  };
}

test('snapshot schema migrates 1.0.0 additively with explicit unavailable evidence', () => {
  const migrated = migrateSystemScanSnapshot(legacySnapshot());
  assert.equal(migrated.schemaVersion, '1.3.0');
  assert.equal(migrated.metrics.cpu.status, 'AVAILABLE');
  assert.equal(migrated.metrics.cpu.value.name, 'CPU');
  assert.equal(migrated.metadata.migratedFromSchemaVersion, '1.0.0');
  assert.equal(migrated.diagnostics.graphics.status, 'UNKNOWN');
  assert.equal(migrated.diagnostics.antiCheat.status, 'UNKNOWN');
  assert.equal(Object.prototype.hasOwnProperty.call(migrated.diagnostics.graphics, 'value'), false);
  assert.equal(validateSystemScanSnapshot(migrated), true);
});

test('snapshot schema migrates 1.1.0 by adding explicit unavailable anti-cheat evidence', () => {
  const migrated = migrateSystemScanSnapshot({
    ...legacySnapshot(),
    schemaVersion: '1.1.0',
    diagnostics: legacyDiagnostics(),
  });
  assert.equal(migrated.schemaVersion, '1.3.0');
  assert.equal(migrated.metadata.migratedFromSchemaVersion, '1.1.0');
  assert.equal(migrated.diagnostics.antiCheat.status, 'UNKNOWN');
  assert.equal(Object.prototype.hasOwnProperty.call(migrated.diagnostics.antiCheat, 'value'), false);
  assert.equal(validateSystemScanSnapshot(migrated), true);
});

test('snapshot schema rejects false or zero substitutes for unavailable diagnostics', () => {
  const migrated = migrateSystemScanSnapshot(legacySnapshot());
  migrated.diagnostics.secureBoot = {
    status: 'UNKNOWN',
    value: false,
    reason: 'Not available',
    source: 'test',
  };
  assert.throws(() => validateSystemScanSnapshot(migrated), /cannot substitute a value when unavailable/);
});

test('snapshot schema converts failed legacy hardware metrics to unavailable evidence without substitute values', () => {
  const migrated = migrateSystemScanSnapshot({
    ...legacySnapshot(),
    schemaVersion: '1.2.0',
    diagnostics: { ...legacyDiagnostics(), antiCheat: { status: 'UNKNOWN', reason: 'Not collected', source: 'test' } },
    metadata: {
      executionTimeMs: 1,
      elevated: false,
      errors: [
        { component: 'system', message: 'memory query failed' },
        { component: 'cpu', message: 'processor query failed' },
        { component: 'storage', message: 'volume query failed' },
      ],
    },
  });
  for (const field of ['cpu', 'memory', 'storage']) {
    assert.equal(migrated.metrics[field].status, 'UNKNOWN');
    assert.equal(Object.prototype.hasOwnProperty.call(migrated.metrics[field], 'value'), false);
  }
  assert.equal(validateSystemScanSnapshot(migrated), true);
});

test('snapshot schema rejects substitute values for unavailable hardware metrics', () => {
  const migrated = migrateSystemScanSnapshot(legacySnapshot());
  migrated.metrics.memory = {
    status: 'UNKNOWN',
    value: { totalBytes: 0, freeBytes: 0, loadPercentage: 0 },
    reason: 'Not available',
    source: 'test',
  };
  assert.throws(() => validateSystemScanSnapshot(migrated), /metrics\.memory cannot substitute a value when unavailable/);
});

test('scanner evidence collection reports query failure without a synthetic value', async () => {
  const errors = [];
  const evidence = await scanner.collectEvidence('cpu', 'fixture', async () => {
    throw new Error('fixture query failed');
  }, (value) => value, errors);
  assert.deepEqual(evidence, {
    status: 'UNKNOWN',
    reason: 'cpu: fixture query failed',
    source: 'fixture',
  });
  assert.deepEqual(errors, [{ component: 'cpu', message: 'fixture query failed' }]);
});

test('unavailable hardware metrics cannot create recommendations and remain explicit in drift', () => {
  const availableSnapshot = migrateSystemScanSnapshot(legacySnapshot());
  const unavailableSnapshot = structuredClone(availableSnapshot);
  unavailableSnapshot.timestamp = '2026-08-15T01:00:00.000Z';
  unavailableSnapshot.metrics.cpu = { status: 'UNKNOWN', reason: 'Processor query failed.', source: 'test' };
  unavailableSnapshot.metrics.memory = { status: 'UNKNOWN', reason: 'Memory query failed.', source: 'test' };
  unavailableSnapshot.metrics.storage = { status: 'UNKNOWN', reason: 'Storage query failed.', source: 'test' };
  assert.equal(validateSystemScanSnapshot(unavailableSnapshot), true);

  const recommendations = buildLocalRecommendations(unavailableSnapshot);
  assert.equal(recommendations.some((item) => item.id === 'memory-pressure-review'), false);
  assert.equal(recommendations.some((item) => item.id.startsWith('low-storage-') || item.id.startsWith('retrim-')), false);

  const directory = tempDir('pc-opti-drift-');
  temporaryDirectories.push(directory);
  drift.setDriftBaseline(directory, availableSnapshot);
  const report = drift.buildDriftReport(directory, unavailableSnapshot);
  const hardwareChanges = report.changes.filter((item) => ['metrics.cpu', 'metrics.memory.totalBytes', 'metrics.storage'].includes(item.path));
  assert.deepEqual(hardwareChanges.map((item) => item.path), ['metrics.cpu', 'metrics.memory.totalBytes', 'metrics.storage']);
  assert.ok(hardwareChanges.every((item) => item.after.status === 'UNKNOWN'));
});

test('local recommendations cite evidence and capability metadata without automatic apply', () => {
  const snapshot = migrateSystemScanSnapshot(legacySnapshot());
  snapshot.diagnostics.pageFile = {
    status: 'AVAILABLE',
    source: 'test',
    value: { mode: 'Disabled', automaticManaged: false, settings: [], usage: [] },
  };
  const recommendations = buildLocalRecommendations(snapshot);
  const cleanup = recommendations.find((item) => item.actionId === 'clear-temp-files');
  const pageFile = recommendations.find((item) => item.id === 'page-file-disabled');
  assert.equal(cleanup.actionStatus, 'OPTIONAL_ACTION');
  assert.equal(cleanup.capabilityId, 'maintenance:clear-temp-files');
  assert.deepEqual(cleanup.targetPanel, { id: 'maintenance', label: 'Open maintenance', sectionId: null });
  assert.ok(cleanup.evidence.paths.length > 0);
  assert.ok(cleanup.rollback.method);
  assert.equal(pageFile.actionStatus, 'GUIDANCE_ONLY');
  assert.equal(pageFile.actionId, null);
  assert.equal(pageFile.capabilityId, 'guidance:observed-system-state');
  assert.deepEqual(pageFile.targetPanel, { id: 'overview', label: 'See details', sectionId: 'expanded-diagnostics' });
});

test('local recommendation thresholds and panel targets remain fixed', () => {
  const below = migrateSystemScanSnapshot(legacySnapshot());
  below.metrics.memory.value.loadPercentage = 79;
  below.metrics.storage.value = [{ driveLetter: 'C', label: 'System', totalBytes: 1000, freeBytes: 110, isSSD: false, trimEnabled: false }];
  below.metrics.startupItems = [];
  below.metrics.tempFiles = { pathCount: 0, totalSizeBytes: 0 };
  const belowRecommendations = buildLocalRecommendations(below);
  assert.equal(belowRecommendations.some((item) => item.id === 'memory-pressure-review'), false);
  assert.equal(belowRecommendations.some((item) => item.id === 'low-storage-C'), false);

  const atThreshold = structuredClone(below);
  atThreshold.metrics.memory.value.loadPercentage = 80;
  atThreshold.metrics.storage.value[0].freeBytes = 100;
  atThreshold.metrics.startupItems = [{ enabled: true }];
  const recommendations = buildLocalRecommendations(atThreshold);
  assert.equal(recommendations.find((item) => item.id === 'memory-pressure-review').targetPanel.id, 'balancer');
  assert.equal(recommendations.find((item) => item.id === 'startup-review').targetPanel.id, 'startup');
  assert.deepEqual(recommendations.find((item) => item.id === 'low-storage-C').targetPanel, { id: 'overview', label: 'See drives', sectionId: 'storage-volumes' });
});

test('full local build recommendations expose implemented maintenance actions', () => {
  const snapshot = migrateSystemScanSnapshot(legacySnapshot());
  snapshot.metrics.tempFiles = { pathCount: 4, totalSizeBytes: 4096 };
  snapshot.metrics.storage.value = [{
    driveLetter: 'C',
    label: 'System',
    totalBytes: 100000,
    freeBytes: 50000,
    isSSD: true,
    trimEnabled: true,
  }];
  const recommendations = buildLocalRecommendations(snapshot, 'public');
  assert.ok(recommendations.some((item) => item.actionId === 'clear-temp-files'));
  assert.ok(recommendations.some((item) => item.actionId === 'retrim-drive:C'));
});

test('public-profile recommendation panel links never point at a tab hidden in that profile', () => {
  // The full local build exposes EcoQoS and groups it under Optimize, so the
  // recommendation can retain its specific target while App.tsx maps it to the
  // customer-facing section.
  const snapshot = migrateSystemScanSnapshot(legacySnapshot());
  snapshot.metrics.memory.value.loadPercentage = 90;
  const publicIds = new Set(listCapabilities('public').map((item) => item.id));
  const recommendations = buildLocalRecommendations(snapshot, 'public');
  const memoryPressure = recommendations.find((item) => item.id === 'memory-pressure-review');
  assert.ok(memoryPressure, 'memory-pressure-review should still be generated in the public profile');
  assert.equal(memoryPressure.targetPanel.id, 'balancer');
  const panelCapability = { overview: 'diagnostic:system-scan', startup: 'startup:disable-current-user-run', balancer: 'process:enable-ecoqos', maintenance: 'maintenance:clear-temp-files' };
  for (const item of recommendations) {
    assert.ok(publicIds.has(panelCapability[item.targetPanel.id]), `${item.id} links to an unreachable public-profile tab: ${item.targetPanel.id}`);
  }
});

test('manual drift baseline reports stable changes and excludes volatile scan values', () => {
  const directory = tempDir('pc-opti-drift-');
  temporaryDirectories.push(directory);
  const baselineSnapshot = migrateSystemScanSnapshot(legacySnapshot());
  baselineSnapshot.timestamp = '2026-08-16T12:00:00.000Z';
  baselineSnapshot.diagnostics.powerScheme = { status: 'AVAILABLE', source: 'test', value: { guid: 'balanced-guid', name: 'Balanced' } };
  baselineSnapshot.diagnostics.pageFile = {
    status: 'AVAILABLE',
    source: 'test',
    value: { mode: 'Automatic', automaticManaged: true, settings: [], usage: [{ name: 'C:\\pagefile.sys', allocatedBaseSizeMb: 1024, currentUsageMb: 100, peakUsageMb: 200 }] },
  };
  baselineSnapshot.diagnostics.networkAdapters = {
    status: 'AVAILABLE',
    source: 'test',
    value: [{ name: 'Ethernet', interfaceDescription: 'Test adapter', status: 'Up', linkSpeed: '1 Gbps' }],
  };

  assert.equal(drift.buildDriftReport(directory, baselineSnapshot).baseline, null);
  const saved = drift.setDriftBaseline(directory, baselineSnapshot, new Date('2026-08-16T12:01:00.000Z'));
  assert.equal(saved.changes.length, 0);
  assert.equal(saved.baseline.createdAt, '2026-08-16T12:01:00.000Z');

  const volatileOnly = structuredClone(baselineSnapshot);
  volatileOnly.timestamp = '2026-08-16T13:00:00.000Z';
  volatileOnly.metrics.memory.value.freeBytes = 1;
  volatileOnly.metrics.memory.value.loadPercentage = 99;
  volatileOnly.metrics.storage.value[0].freeBytes = 1;
  volatileOnly.metrics.tempFiles = { totalSizeBytes: 999999, pathCount: 999 };
  volatileOnly.diagnostics.pageFile.value.usage[0].currentUsageMb = 900;
  volatileOnly.diagnostics.networkAdapters.value[0].status = 'Disconnected';
  volatileOnly.diagnostics.networkAdapters.value[0].linkSpeed = '0 bps';
  assert.equal(drift.buildDriftReport(directory, volatileOnly).changes.length, 0);

  const changed = structuredClone(volatileOnly);
  changed.metrics.startupItems[0].path = 'changed.exe';
  changed.diagnostics.powerScheme.value = { guid: 'performance-guid', name: 'High performance' };
  const report = drift.buildDriftReport(directory, changed);
  assert.deepEqual(report.changes.map((item) => item.path), ['diagnostics.powerScheme', 'metrics.startupItems']);
  assert.ok(report.changes.every((item) => item.kind === 'CHANGED'));

  const stored = fs.readFileSync(path.join(directory, drift.BASELINE_FILE_NAME), 'utf8');
  assert.doesNotMatch(stored, /freeBytes|loadPercentage|currentUsageMb|peakUsageMb|linkSpeed/);
});

test('drift baseline stays main-owned, manual, local, and device-bound', () => {
  const directory = tempDir('pc-opti-drift-');
  temporaryDirectories.push(directory);
  const snapshot = migrateSystemScanSnapshot(legacySnapshot());
  drift.setDriftBaseline(directory, snapshot);
  const otherDevice = structuredClone(snapshot);
  otherDevice.deviceHash = 'different-device-hash';
  assert.throws(() => drift.buildDriftReport(directory, otherDevice), /different Windows device/);

  const preloadSource = fs.readFileSync(path.join(__dirname, '..', 'electron', 'preload.cjs'), 'utf8');
  const mainSource = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8');
  assert.match(preloadSource, /getDriftReport: \(\) => ipcRenderer\.invoke\('pc-opti:get-drift-report'\)/);
  assert.match(preloadSource, /setDriftBaseline: \(\) => ipcRenderer\.invoke\('pc-opti:set-drift-baseline'\)/);
  const handler = mainSource.slice(mainSource.indexOf("ipcMain.handle('pc-opti:get-drift-report'"), mainSource.indexOf("ipcMain.handle('pc-opti:list-startup-items'"));
  assert.match(handler, /latestVerifiedSnapshot/);
  assert.doesNotMatch(handler, /setInterval|setTimeout|schedule|rendererSnapshot/i);
});

function startupFixture(overrides = {}) {
  return {
    id: '1234567890abcdef12345678',
    name: 'Fixture startup item',
    source: 'Registry',
    canDisable: true,
    registryPath: 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run',
    registryView: 'Registry64',
    valueName: 'FixtureItem',
    value: 'C:\\Fixture\\fixture.exe',
    registryValueKind: 'String',
    ...overrides,
  };
}

function nativeResult(output) {
  return { output, stdout: JSON.stringify(output), stderr: '', exitCode: 0 };
}

test('startup transaction succeeds only after fresh-state and post-action verification', async () => {
  const directory = createJournal([]);
  const item = startupFixture();
  let reads = 0;
  const result = await journal.disableStartupItem(directory, item, {
    readRegistryRunValue: async () => (++reads === 1 ? { ...item, exists: true } : { ...item, exists: false, value: null, registryValueKind: null }),
    removeRegistryRunValue: async () => nativeResult({ enabled: false }),
  });
  assert.equal(result.success, true);
  assert.equal(reads, 2);
  const [entry] = journal.readJournal(directory);
  assert.equal(entry.status, 'SUCCESS');
  assert.equal(entry.resultingState.verified.exists, false);
});

test('machine-wide startup disable refuses before inventory or journaling unless deliberately elevated', async () => {
  const directory = createJournal([]);
  let readCalled = false;
  let writeCalled = false;
  await assert.rejects(journal.disableStartupItem(directory, startupFixture({
    registryPath: 'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run',
    registryView: 'Registry32',
    scope: 'All users (32-bit)',
  }), {
    isCurrentProcessElevated: async () => false,
    readRegistryRunValue: async () => { readCalled = true; return {}; },
    removeRegistryRunValue: async () => { writeCalled = true; return nativeResult({}); },
  }), /running as administrator/);
  assert.equal(readCalled, false);
  assert.equal(writeCalled, false);
  assert.deepEqual(journal.readJournal(directory), []);
});

test('machine-wide startup disable and rollback preserve the exact logical view and Registry kind', async () => {
  const directory = createJournal([]);
  const item = startupFixture({
    registryPath: 'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run',
    registryView: 'Registry32',
    scope: 'All users (32-bit)',
    value: '%ProgramFiles(x86)%\\Fixture\\fixture.exe',
    registryValueKind: 'ExpandString',
  });
  let state = { ...item, exists: true };
  // In-memory stand-in for the administrator-only protected copy (never the real registry).
  const protectedCopies = new Map();
  const protectedStore = {
    writeProtectedStartupBackup: async (id, pre) => { protectedCopies.set(id, { exists: true, registryPath: pre.registryPath, registryView: pre.registryView, valueName: pre.valueName, value: pre.value, registryValueKind: pre.registryValueKind }); return nativeResult({}); },
    readProtectedStartupBackup: async (id) => protectedCopies.get(id) || { exists: false },
    removeProtectedStartupBackup: async (id) => { protectedCopies.delete(id); return nativeResult({}); },
  };
  const applied = await journal.disableStartupItem(directory, item, {
    ...protectedStore,
    isCurrentProcessElevated: async () => true,
    readRegistryRunValue: async () => structuredClone(state),
    removeRegistryRunValue: async (target) => {
      assert.equal(target.registryView, 'Registry32');
      state = { ...target, exists: false, value: null, registryValueKind: null };
      return nativeResult({ registryPath: target.registryPath, registryView: target.registryView, enabled: false });
    },
  });
  assert.equal(applied.success, true);
  assert.match(applied.entry.actionId, /^startup:disable-machine:/);
  assert.equal(applied.entry.capabilityId, 'startup:disable-machine-run');
  assert.equal(applied.entry.preAction.registryView, 'Registry32');
  assert.equal(applied.entry.preAction.registryValueKind, 'ExpandString');
  assert.equal(applied.entry.preAction.value, item.value);

  let restoreCalled = false;
  await assert.rejects(journal.rollbackAuditEntry(directory, applied.entry.id, {
    isCurrentProcessElevated: async () => false,
    restoreRegistryRunValue: async () => { restoreCalled = true; return nativeResult({}); },
  }), /running as administrator/);
  assert.equal(restoreCalled, false);
  assert.equal(journal.readJournal(directory).length, 1);

  assert.equal(protectedCopies.size, 1, 'a machine-wide removal saves a protected copy first');
  const restored = await journal.rollbackAuditEntry(directory, applied.entry.id, {
    ...protectedStore,
    isCurrentProcessElevated: async () => true,
    restoreRegistryRunValue: async (preAction) => {
      assert.equal(preAction.registryView, 'Registry32');
      assert.equal(preAction.registryValueKind, 'ExpandString');
      assert.equal(preAction.value, item.value);
      if (state.exists) throw new Error('conflict');
      state = { ...preAction, exists: true };
      return nativeResult({ registryPath: preAction.registryPath, registryView: preAction.registryView, enabled: true, verified: state });
    },
  });
  assert.equal(restored.success, true);
  assert.equal(state.exists, true);
  assert.equal(state.registryView, 'Registry32');
  assert.equal(state.registryValueKind, 'ExpandString');
  assert.equal(state.value, item.value);
});

test('startup stale state is refused before a journal entry or native write', async () => {
  const directory = createJournal([]);
  let writeCalled = false;
  await assert.rejects(journal.disableStartupItem(directory, startupFixture(), {
    readRegistryRunValue: async () => ({ ...startupFixture(), exists: true, value: 'changed.exe' }),
    removeRegistryRunValue: async () => { writeCalled = true; return nativeResult({}); },
  }), /changed after inventory/);
  assert.equal(writeCalled, false);
  assert.deepEqual(journal.readJournal(directory), []);
});

test('native timeout after a mutation starts becomes review-only with rollback disabled', async () => {
  const directory = createJournal([]);
  const item = startupFixture();
  const timeout = Object.assign(new Error('PowerShell query exceeded 30 seconds.'), { stdout: '', stderr: 'timeout' });
  const result = await journal.disableStartupItem(directory, item, {
    readRegistryRunValue: async () => ({ ...item, exists: true }),
    removeRegistryRunValue: async () => { throw timeout; },
  });
  assert.equal(result.success, false);
  assert.equal(result.entry.status, 'NEEDS_REVIEW');
  assert.equal(result.entry.rollback.available, false);
  assert.match(result.entry.rollback.reason, /did not reach a verified final state/);
});

test('EcoQoS transaction rejects reused identity and verifies successful apply', async () => {
  const directory = createJournal([]);
  const process = { pid: 4242, name: 'fixture-app', creationTime: '133000000000000000', cpuPercent: 0, workingSetBytes: 1, efficiencyMode: false };
  await assert.rejects(journal.enableProcessEcoQos(directory, process, {
    readRunningProcess: async () => ({ pid: 4242, name: 'different-app' }),
  }), /identifier was reused/);
  assert.deepEqual(journal.readJournal(directory), []);

  let stateReads = 0;
  const result = await journal.enableProcessEcoQos(directory, process, {
    readRunningProcess: async () => ({ pid: 4242, name: 'fixture-app', creationTime: '133000000000000000' }),
    detectInstalledAntiCheats: async () => [],
    getProcessEcoQos: async () => ({ pid: 4242, efficiencyMode: ++stateReads > 1 }),
    setProcessEcoQos: async () => nativeResult({ pid: 4242, efficiencyMode: true }),
  });
  assert.equal(result.success, true);
  assert.equal(result.entry.resultingState.verified.efficiencyMode, true);
});

test('Dynamic Eco-Balance verifies Notepad apply and restore and refuses lsass before mutation', async () => {
  const directory = createJournal([]);
  const notepad = { pid: 4242, name: 'notepad', creationTime: '133000000000000000', cpuPercent: 0, workingSetBytes: 1, efficiencyMode: false };
  let efficiencyMode = false;
  const adapters = {
    readRunningProcess: async () => ({ pid: notepad.pid, name: notepad.name, creationTime: '133000000000000000', parentPid: 1000, parentName: 'explorer' }),
    detectInstalledAntiCheats: async () => [],
    getProcessEcoQos: async () => ({ pid: notepad.pid, efficiencyMode }),
    setProcessEcoQos: async (_pid, enabled) => {
      efficiencyMode = enabled;
      return nativeResult({ pid: notepad.pid, efficiencyMode });
    },
  };

  const applied = await journal.enableProcessEcoQos(directory, notepad, adapters);
  assert.equal(applied.success, true);
  assert.equal(applied.entry.resultingState.verified.efficiencyMode, true);

  const restored = await journal.rollbackAuditEntry(directory, applied.entry.id, adapters);
  assert.equal(restored.success, true);
  assert.equal(restored.entry.resultingState.verified.efficiencyMode, false);
  assert.equal(journal.readJournal(directory).find((entry) => entry.id === applied.entry.id).rollback.available, false);

  let lsassWriteCalled = false;
  await assert.rejects(journal.enableProcessEcoQos(directory, {
    pid: 500,
    name: 'lsass',
    cpuPercent: 0,
    workingSetBytes: 1,
    efficiencyMode: false,
  }, {
    setProcessEcoQos: async () => {
      lsassWriteCalled = true;
      return nativeResult({});
    },
  }), /protected process-management scope/);
  assert.equal(lsassWriteCalled, false);
});

test('Dynamic Eco-Balance visibly warns against throttling games and launchers', () => {
  const appSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'App.tsx'), 'utf8');
  const componentSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'ProcessBalancer.tsx'), 'utf8');
  assert.match(appSource, /If this is a game or launcher, cancel — slowing a game is usually backwards/);
  assert.match(componentSource, /Never use this on a game or launcher/);
  assert.match(componentSource, /it would slow the game down/);
  assert.match(componentSource, /Windows itself, input, audio and anti-cheat programs are never offered/);
  assert.match(componentSource, /Security software may not all be on that list/);
  assert.doesNotMatch(componentSource, /audio, security, and core-system processes are excluded/);
});

test('EcoQoS apply and rollback refuse anti-cheat processes and their children before mutation', async () => {
  const directDirectory = createJournal([]);
  await assert.rejects(journal.enableProcessEcoQos(directDirectory, {
    pid: 5000,
    name: 'vgc',
    cpuPercent: 0,
    workingSetBytes: 1,
    efficiencyMode: false,
  }), /vgc is part of Vanguard anti-cheat/);
  assert.deepEqual(journal.readJournal(directDirectory), []);

  const child = { pid: 5001, name: 'game-helper', creationTime: '133000000000000000', cpuPercent: 0, workingSetBytes: 1, efficiencyMode: false };
  const detections = [{ product: 'Vanguard', serviceName: 'vgc', state: 'Running', driverPresent: true }];
  let applyWriteCalled = false;
  const childDirectory = createJournal([]);
  await assert.rejects(journal.enableProcessEcoQos(childDirectory, child, {
    readRunningProcess: async () => ({ pid: child.pid, name: child.name, creationTime: '133000000000000000', parentPid: 5000, parentName: 'vgc' }),
    detectInstalledAntiCheats: async () => detections,
    getProcessEcoQos: async () => ({ pid: child.pid, efficiencyMode: false }),
    setProcessEcoQos: async () => { applyWriteCalled = true; return nativeResult({}); },
  }), /parent process vgc belongs to detected Vanguard anti-cheat/);
  assert.equal(applyWriteCalled, false);
  assert.deepEqual(journal.readJournal(childDirectory), []);

  const rollbackDirectory = createJournal([{
    id: 'anti-cheat-child-rollback',
    status: 'SUCCESS',
    title: 'EcoQoS child fixture',
    preAction: { pid: child.pid, name: child.name, creationTime: '133000000000000000', efficiencyMode: false },
    rollback: { available: true, kind: 'disable-process-ecoqos', reason: 'restore fixture' },
  }]);
  let rollbackWriteCalled = false;
  await assert.rejects(journal.rollbackAuditEntry(rollbackDirectory, 'anti-cheat-child-rollback', {
    readRunningProcess: async () => ({ pid: child.pid, name: child.name, creationTime: '133000000000000000', parentPid: 5000, parentName: 'vgc' }),
    detectInstalledAntiCheats: async () => detections,
    getProcessEcoQos: async () => ({ pid: child.pid, efficiencyMode: true }),
    setProcessEcoQos: async () => { rollbackWriteCalled = true; return nativeResult({}); },
  }), /parent process vgc belongs to detected Vanguard anti-cheat/);
  assert.equal(rollbackWriteCalled, false);
});

test('consumer policy fails closed before journaling when not deliberately elevated', async () => {
  const directory = createJournal([]);
  let policyRead = false;
  await assert.rejects(journal.enableConsumerFeaturesPolicy(directory, {
    isCurrentProcessElevated: async () => false,
    readConsumerFeaturesPolicy: async () => { policyRead = true; return {}; },
  }), /running as administrator/);
  assert.equal(policyRead, false);
  assert.deepEqual(journal.readJournal(directory), []);
});

test('consumer policy rollback also refuses before journaling or mutation when not elevated', async () => {
  const directory = createJournal([{
    id: 'policy-rollback-elevation-fixture',
    actionId: 'policy:disable-windows-consumer-features',
    status: 'SUCCESS',
    title: 'Consumer policy fixture',
    preAction: {
      registryPath: 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\CloudContent',
      valueName: 'DisableWindowsConsumerFeatures',
      valueExists: false,
      value: null,
      valueKind: 'Missing',
    },
    rollback: { available: true, kind: 'restore-consumer-features-policy', reason: 'restore fixture' },
  }]);
  let restoreCalled = false;
  await assert.rejects(journal.rollbackAuditEntry(directory, 'policy-rollback-elevation-fixture', {
    isCurrentProcessElevated: async () => false,
    restoreConsumerFeaturesPolicy: async () => { restoreCalled = true; return nativeResult({}); },
  }), /running as administrator/);
  assert.equal(restoreCalled, false);
  assert.equal(journal.readJournal(directory).length, 1);
});

test('maintenance revalidates ReTRIM targets and accounts only reported temp deletions', async () => {
  const retrimDirectory = createJournal([]);
  let retrimCalled = false;
  await assert.rejects(journal.executeMaintenanceAction(retrimDirectory, 'retrim-drive:C', {
    isCurrentProcessElevated: async () => true,
    listStorageVolumes: async () => ({ items: [{ driveLetter: 'C', isSSD: false, trimEnabled: true }], errors: [] }),
    retrimDrive: async () => { retrimCalled = true; return nativeResult({}); },
  }), /no longer an observed SSD/);
  assert.equal(retrimCalled, false);

  const tempDirectory = createJournal([]);
  const cleanup = await journal.executeMaintenanceAction(tempDirectory, 'clear-temp-files', {
    prepareTempState: async () => ({ paths: ['fixture'], totalSizeBytes: 500, pathCount: 3 }),
    clearTempFiles: async () => nativeResult({ deletedFileCount: 2, reclaimedBytes: 300 }),
  });
  assert.equal(cleanup.success, true);
  assert.equal(cleanup.entry.resultingState.deletedFileCount, 2);
  assert.equal(cleanup.entry.resultingState.reclaimedBytes, 300);
  assert.equal(cleanup.entry.resultingState.observedFreeSpaceChangeBytes, null);
  assert.equal(cleanup.entry.preAction.pathCount, 3);

  const retrimSuccessDirectory = createJournal([]);
  let completedDrive = null;
  const retrim = await journal.executeMaintenanceAction(retrimSuccessDirectory, 'retrim-drive:C', {
    isCurrentProcessElevated: async () => true,
    listStorageVolumes: async () => ({ items: [{ driveLetter: 'C', isSSD: true, trimEnabled: true }], errors: [] }),
    retrimDrive: async (driveLetter) => {
      completedDrive = driveLetter;
      return nativeResult({ driveLetter, message: 'ReTRIM completed.' });
    },
  });
  assert.equal(retrim.success, true);
  assert.equal(completedDrive, 'C');
});

test('temp cleanup selects only old in-scope regular files and skips locked files cleanly through fakes', async () => {
  const now = Date.parse('2026-08-16T12:00:00.000Z');
  const roots = ['C:\\Users\\fixture\\AppData\\Local\\Temp', 'C:\\Windows\\Temp'];
  const planted = [
    { path: `${roots[0]}\\old.tmp`, length: 100, lastWriteTimeUtc: '2026-08-08T11:59:59.000Z' },
    { path: `${roots[0]}\\recent.tmp`, length: 200, lastWriteTimeUtc: '2026-08-15T12:00:00.000Z' },
    { path: `${roots[1]}\\locked.tmp`, length: 300, lastWriteTimeUtc: '2026-08-01T12:00:00.000Z', locked: true },
    { path: `${roots[0]}\\link.tmp`, length: 400, lastWriteTimeUtc: '2026-08-01T12:00:00.000Z', isReparsePoint: true },
    { path: 'C:\\Outside\\escape.tmp', length: 500, lastWriteTimeUtc: '2026-08-01T12:00:00.000Z' },
  ];
  const selection = maintenance.selectEligibleTempCandidates(planted, roots, now);
  assert.deepEqual(selection.selected.map((item) => item.path), [
    `${roots[0]}\\old.tmp`,
    `${roots[1]}\\locked.tmp`,
  ]);
  assert.deepEqual(selection.skipped, { recent: 1, reparsePoint: 1, outOfScope: 1, directory: 0, invalid: 0 });

  const deleted = [];
  const directory = createJournal([]);
  const result = await journal.executeMaintenanceAction(directory, 'clear-temp-files', {
    prepareTempState: async () => ({
      paths: roots,
      cutoffUtc: selection.cutoffUtc,
      totalSizeBytes: 400,
      pathCount: selection.selected.length,
    }),
    clearTempFiles: async () => {
      for (const candidate of selection.selected) {
        if (!planted.find((item) => item.path === candidate.path)?.locked) deleted.push(candidate.path);
      }
      return nativeResult({ deletedFileCount: deleted.length, reclaimedBytes: 100, skippedFileCount: 1 });
    },
  });
  assert.equal(result.success, true);
  assert.deepEqual(deleted, [`${roots[0]}\\old.tmp`]);
  assert.equal(result.result.skippedFileCount, 1);
  assert.ok(planted.some((item) => item.path.endsWith('recent.tmp') && !deleted.includes(item.path)));
  assert.ok(planted.some((item) => item.path.endsWith('locked.tmp') && !deleted.includes(item.path)));
});

test('temp maintenance PowerShell is fixed-root, age-gated, link-safe, and literal-path only', () => {
  const inventoryScript = maintenance.createTempMaintenancePowerShellScript(false);
  const deletionScript = maintenance.createTempMaintenancePowerShellScript(true);
  const appSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'App.tsx'), 'utf8');
  for (const script of [inventoryScript, deletionScript]) {
    assert.match(script, /@\(\$env:TEMP, \(Join-Path \$env:WINDIR 'Temp'\)\)/);
    assert.match(script, /AddDays\(-7\)/);
    assert.match(script, /FileAttributes\]::ReparsePoint/);
    assert.match(script, /StartsWith\(\$rootPrefix, \[StringComparison\]::OrdinalIgnoreCase\)/);
    assert.doesNotMatch(script, /Get-ChildItem[^\n]*-Recurse/);
  }
  assert.match(inventoryScript, /\$deleteEligible = \$false/);
  assert.match(deletionScript, /\$deleteEligible = \$true/);
  assert.match(deletionScript, /Remove-Item -LiteralPath \$currentFullName/);
  assert.doesNotMatch(deletionScript, /Remove-Item[^\n]*-Recurse/);
  assert.match(appSource, /Deleted temporary files cannot be restored/);
  assert.match(appSource, /cannot offer rollback/);
});

test('interrupted startup transactions classify intended, pre-action, and diverged states', async () => {
  const base = startupFixture();
  const entries = ['intended', 'pre-action', 'diverged'].map((kind) => ({
    id: kind,
    actionId: `startup:disable:${base.id}`,
    title: kind,
    status: 'PENDING',
    preAction: { ...base, valueName: kind },
    rollback: { available: true, reason: 'fixture' },
  }));
  const directory = createJournal(entries);
  await journal.reconcilePendingEntries(directory, {
    readRegistryRunValue: async (preAction) => {
      if (preAction.valueName === 'intended') return { ...preAction, exists: false };
      if (preAction.valueName === 'pre-action') return { ...preAction, exists: true };
      return { ...preAction, exists: true, value: 'externally-changed.exe' };
    },
  });
  const byId = new Map(journal.readJournal(directory).map((entry) => [entry.id, entry]));
  assert.equal(byId.get('intended').reconciliation.classification, 'INTENDED_STATE');
  assert.equal(byId.get('pre-action').reconciliation.classification, 'PRE_ACTION_STATE');
  assert.equal(byId.get('diverged').reconciliation.classification, 'DIVERGED');
  assert.equal(byId.get('diverged').rollback.available, false);
});

test('journal recovery preserves corrupt bytes and refuses valid interrupted history', () => {
  const interruptedDirectory = createJournal([
    { id: 'pending-one', status: 'PENDING' },
    { id: 'pending-two', status: 'PENDING' },
    { id: 'complete', status: 'SUCCESS' },
  ]);
  const interruptedPath = path.join(interruptedDirectory, 'journal.json');
  const interruptedBytes = fs.readFileSync(interruptedPath);
  assert.deepEqual(journal.inspectJournalRecovery(interruptedDirectory).recovery, {
    kind: 'INTERRUPTED',
    pendingCount: 2,
    reason: '',
    recoverable: false,
    issueCode: 'INTERRUPTED',
  });
  assert.throws(() => journal.recoverCorruptJournal(interruptedDirectory), /Only a structurally corrupt or bounded-overflow journal/);
  assert.deepEqual(fs.readFileSync(interruptedPath), interruptedBytes);

  const corruptDirectory = tempDir('pc-opti-test-');
  temporaryDirectories.push(corruptDirectory);
  const corruptPath = path.join(corruptDirectory, 'journal.json');
  const corruptBytes = Buffer.from('{not valid json', 'utf8');
  fs.writeFileSync(corruptPath, corruptBytes);
  const corrupt = journal.inspectJournalRecovery(corruptDirectory);
  assert.equal(corrupt.entries.length, 0);
  assert.equal(corrupt.recovery.kind, 'CORRUPT');
  assert.equal(corrupt.recovery.pendingCount, null);
  assert.equal(corrupt.recovery.recoverable, true);
  assert.equal(corrupt.recovery.issueCode, 'INVALID_JSON');
  assert.match(corrupt.recovery.reason, /Could not read the local audit journal/);
  const recovered = journal.recoverCorruptJournal(corruptDirectory);
  assert.deepEqual(recovered.entries, []);
  assert.equal(recovered.recovery, null);
  assert.match(recovered.quarantine.fileName, /^journal\.corrupt\.[A-Za-z0-9-]+\.[0-9a-f-]+\.json$/);
  assert.equal(recovered.quarantine.bytes, corruptBytes.length);
  assert.equal(recovered.quarantine.sha256, require('node:crypto').createHash('sha256').update(corruptBytes).digest('hex'));
  assert.deepEqual(fs.readFileSync(path.join(corruptDirectory, recovered.quarantine.fileName)), corruptBytes);
  assert.deepEqual(JSON.parse(fs.readFileSync(corruptPath, 'utf8')), []);
});

test('journal recovery classifies bounded overflow and inaccessible paths without silent truncation', () => {
  const overflowDirectory = createJournal(Array.from({ length: 1_001 }, (_, index) => ({ id: `entry-${index}`, status: 'SUCCESS' })));
  const overflow = journal.inspectJournalRecovery(overflowDirectory);
  assert.equal(overflow.recovery.kind, 'CORRUPT');
  assert.equal(overflow.recovery.issueCode, 'TOO_MANY_ENTRIES');
  assert.throws(() => journal.readJournal(overflowDirectory), /1,000 entry limit/);
  const recovered = journal.recoverCorruptJournal(overflowDirectory);
  assert.equal(JSON.parse(fs.readFileSync(path.join(overflowDirectory, recovered.quarantine.fileName), 'utf8')).length, 1_001);
  assert.deepEqual(journal.readJournal(overflowDirectory), []);

  const inaccessibleDirectory = tempDir('pc-opti-test-');
  temporaryDirectories.push(inaccessibleDirectory);
  const unsafeJournalPath = path.join(inaccessibleDirectory, 'journal.json');
  fs.mkdirSync(unsafeJournalPath);
  const inaccessible = journal.inspectJournalRecovery(inaccessibleDirectory);
  assert.equal(inaccessible.recovery.kind, 'INACCESSIBLE');
  assert.equal(inaccessible.recovery.recoverable, false);
  assert.equal(inaccessible.recovery.issueCode, 'UNSAFE_PATH');
  assert.throws(() => journal.recoverCorruptJournal(inaccessibleDirectory), /Only a structurally corrupt or bounded-overflow journal/);
  assert.equal(fs.statSync(unsafeJournalPath).isDirectory(), true);
});

test('journal recovery flushes the preserved copy before activating an empty journal', () => {
  const directory = tempDir('pc-opti-test-');
  temporaryDirectories.push(directory);
  fs.writeFileSync(path.join(directory, 'journal.json'), '{durability fixture', 'utf8');
  const originalOpen = fs.openSync;
  const originalClose = fs.closeSync;
  const originalFsync = fs.fsyncSync;
  const descriptorPaths = new Map();
  let preservedFlushed = false;
  fs.openSync = function trackedOpen(filePath, flags, ...args) {
    if (path.basename(String(filePath)) === 'journal.json' && flags === 'wx') {
      assert.equal(preservedFlushed, true, 'the preserved original must be fsynced before empty-journal activation');
    }
    const descriptor = originalOpen.call(fs, filePath, flags, ...args);
    descriptorPaths.set(descriptor, String(filePath));
    return descriptor;
  };
  fs.fsyncSync = function trackedFsync(descriptor) {
    if (/journal\.corrupt\..+\.json$/.test(descriptorPaths.get(descriptor) || '')) preservedFlushed = true;
    return originalFsync.call(fs, descriptor);
  };
  fs.closeSync = function trackedClose(descriptor) {
    descriptorPaths.delete(descriptor);
    return originalClose.call(fs, descriptor);
  };
  try {
    const result = journal.recoverCorruptJournal(directory);
    assert.equal(preservedFlushed, true);
    assert.deepEqual(journal.readJournal(directory), []);
    assert.equal(fs.existsSync(path.join(directory, result.quarantine.fileName)), true);
  } finally {
    fs.openSync = originalOpen;
    fs.closeSync = originalClose;
    fs.fsyncSync = originalFsync;
  }
});

test('journal recovery never overwrites concurrently created valid or interrupted history', () => {
  const directory = tempDir('pc-opti-test-');
  temporaryDirectories.push(directory);
  const corruptBytes = Buffer.from('{concurrent fixture', 'utf8');
  const concurrentEntries = [{ id: 'new-pending', status: 'PENDING', rollback: { available: true } }];
  const concurrentBytes = Buffer.from(JSON.stringify(concurrentEntries), 'utf8');
  fs.writeFileSync(path.join(directory, 'journal.json'), corruptBytes);
  const originalCopy = fs.copyFileSync;
  fs.copyFileSync = function copyThenRace(source, destination, mode) {
    const result = originalCopy.call(fs, source, destination, mode);
    if (/journal\.corrupt\..+\.json$/.test(String(destination))) {
      fs.writeFileSync(path.join(directory, 'journal.json'), concurrentBytes);
    }
    return result;
  };
  try {
    assert.throws(() => journal.recoverCorruptJournal(directory), /New or inaccessible audit history appeared during recovery/);
  } finally {
    fs.copyFileSync = originalCopy;
  }
  assert.deepEqual(fs.readFileSync(path.join(directory, 'journal.json')), concurrentBytes);
  const state = journal.inspectJournalRecovery(directory);
  assert.equal(state.recovery.kind, 'INACCESSIBLE');
  assert.equal(state.recovery.issueCode, 'RECOVERY_TARGET_CONFLICT');
  const preserved = fs.readdirSync(directory).find((name) => /^journal\.corrupt\..+\.json$/.test(name));
  assert.ok(preserved);
  assert.deepEqual(fs.readFileSync(path.join(directory, preserved)), corruptBytes);
});

test('exclusive journal activation never deletes a concurrent EEXIST winner', () => {
  const directory = tempDir('pc-opti-test-');
  temporaryDirectories.push(directory);
  const corruptBytes = Buffer.from('{exclusive race fixture', 'utf8');
  const concurrentEntries = [{ id: 'exclusive-winner', status: 'PENDING', rollback: { available: true } }];
  const concurrentBytes = Buffer.from(JSON.stringify(concurrentEntries), 'utf8');
  const target = path.join(directory, 'journal.json');
  fs.writeFileSync(target, corruptBytes);
  const originalOpen = fs.openSync;
  const originalClose = fs.closeSync;
  let injected = false;
  fs.openSync = function createBeforeExclusiveOpen(filePath, flags, ...args) {
    if (!injected && path.resolve(String(filePath)) === path.resolve(target) && flags === 'wx') {
      injected = true;
      const competingDescriptor = originalOpen.call(fs, target, 'wx', 0o600);
      try {
        fs.writeFileSync(competingDescriptor, concurrentBytes);
        fs.fsyncSync(competingDescriptor);
      } finally {
        originalClose.call(fs, competingDescriptor);
      }
    }
    return originalOpen.call(fs, filePath, flags, ...args);
  };
  try {
    assert.throws(() => journal.recoverCorruptJournal(directory), /EEXIST/);
  } finally {
    fs.openSync = originalOpen;
  }
  assert.equal(injected, true);
  assert.deepEqual(fs.readFileSync(target), concurrentBytes);
  const state = journal.inspectJournalRecovery(directory);
  assert.equal(state.recovery.kind, 'INACCESSIBLE');
  assert.equal(state.recovery.issueCode, 'RECOVERY_TARGET_CONFLICT');
  const preserved = fs.readdirSync(directory).find((name) => /^journal\.corrupt\..+\.json$/.test(name));
  assert.ok(preserved);
  assert.deepEqual(fs.readFileSync(path.join(directory, preserved)), corruptBytes);
});

test('interrupted corrupt-journal recovery remains visible and resumes without losing the original', () => {
  const directory = tempDir('pc-opti-test-');
  temporaryDirectories.push(directory);
  const corruptBytes = Buffer.from('{resume fixture', 'utf8');
  fs.writeFileSync(path.join(directory, 'journal.json'), corruptBytes);
  const originalOpen = fs.openSync;
  let refusedActivation = false;
  fs.openSync = function refuseFirstActivation(filePath, flags, ...args) {
    if (!refusedActivation && path.basename(String(filePath)) === 'journal.json' && flags === 'wx') {
      refusedActivation = true;
      const error = new Error('fixture activation interruption');
      error.code = 'EACCES';
      throw error;
    }
    return originalOpen.call(fs, filePath, flags, ...args);
  };
  try {
    assert.throws(() => journal.recoverCorruptJournal(directory), /fixture activation interruption/);
  } finally {
    fs.openSync = originalOpen;
  }
  const interrupted = journal.inspectJournalRecovery(directory);
  assert.equal(interrupted.recovery.kind, 'CORRUPT');
  assert.equal(interrupted.recovery.issueCode, 'RECOVERY_INCOMPLETE');
  assert.equal(interrupted.recovery.recoverable, true);
  const result = journal.recoverCorruptJournal(directory);
  assert.deepEqual(journal.readJournal(directory), []);
  assert.deepEqual(fs.readFileSync(path.join(directory, result.quarantine.fileName)), corruptBytes);
  assert.equal(fs.readdirSync(directory).some((name) => name.endsWith('.pending')), false);
});

test('audit recovery stays user-directed and exposes no renderer-controlled recovery target', () => {
  const preloadSource = fs.readFileSync(path.join(__dirname, '..', 'electron', 'preload.cjs'), 'utf8');
  const mainSource = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8');
  const appSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'App.tsx'), 'utf8');
  const historySource = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'LocalAuditHistory.tsx'), 'utf8');

  assert.match(preloadSource, /retryAuditVerification: \(\) =>/);
  assert.match(preloadSource, /recoverCorruptAuditJournal: \(\) =>/);
  assert.doesNotMatch(preloadSource, /(retryAuditVerification|recoverCorruptAuditJournal): \([^)]*(path|entries|ids)/i);
  assert.doesNotMatch(preloadSource, /discardAuditJournal|pc-opti:discard-audit-journal/);
  assert.match(mainSource, /pc-opti:retry-audit-verification/);
  assert.match(mainSource, /pc-opti:recover-corrupt-audit-journal/);
  assert.match(mainSource, /assertCapabilityAvailable\('history:recover-corrupt'\)/);
  assert.match(mainSource, /app\.requestSingleInstanceLock\(\)/);
  assert.match(mainSource, /app\.on\('second-instance'/);
  assert.doesNotMatch(mainSource, /discardJournal|pc-opti:discard-audit-journal/);
  assert.doesNotMatch(mainSource, /app\.whenReady\(\)\.then\(async \(\) => \{\s*await reconcilePendingEntries/);
  assert.match(appSource, /retryAuditVerification\(\)/);
  assert.match(appSource, /recoverCorruptAuditJournal\(\)/);
  assert.doesNotMatch(appSource, /discardAuditJournal\(\)/);
  assert.match(historySource, /did not finish\./);
  assert.match(historySource, /Check again<\/button>/);
  assert.match(historySource, /Preserve and start fresh<\/button>/);
  assert.match(historySource, /recovery\.kind === 'INTERRUPTED' && <button/);
  assert.match(historySource, /recovery\.kind === 'CORRUPT' && recovery\.recoverable && <button/);
  assert.doesNotMatch(historySource, /Discard journal|onDiscardJournal/);
  assert.match(historySource, /entry\.status === 'NEEDS_REVIEW'.*border-amber-500\/40/);
  assert.match(historySource, /entry\.status === 'NEEDS_REVIEW'.*text-amber-100/);
});

test('post-action mismatch is not reported as failure-safe success or reversible state', async () => {
  const directory = createJournal([]);
  const item = startupFixture();
  let reads = 0;
  const result = await journal.disableStartupItem(directory, item, {
    readRegistryRunValue: async () => {
      reads += 1;
      return { ...item, exists: true };
    },
    removeRegistryRunValue: async () => nativeResult({ enabled: false }),
  });
  assert.equal(reads, 2);
  assert.equal(result.success, false);
  assert.equal(result.entry.status, 'NEEDS_REVIEW');
  assert.equal(result.entry.rollback.available, false);
  assert.match(result.error, /still reports the startup value/);
});

test('startup rollback succeeds once and conflict refusal preserves the original rollback', async () => {
  const item = startupFixture();
  const original = {
    id: 'startup-original',
    status: 'SUCCESS',
    title: 'Startup fixture',
    preAction: { ...item, enabled: true },
    rollback: { available: true, kind: 'restore-registry-run-value', reason: 'restore fixture' },
  };
  const successDirectory = createJournal([structuredClone(original)]);
  const restored = await journal.rollbackAuditEntry(successDirectory, original.id, {
    restoreRegistryRunValue: async () => nativeResult({ restored: true, verified: { ...item, exists: true } }),
  });
  assert.equal(restored.success, true);
  const successEntries = journal.readJournal(successDirectory);
  assert.equal(successEntries.find((entry) => entry.id === original.id).rollback.available, false);

  const conflictDirectory = createJournal([structuredClone(original)]);
  const conflict = await journal.rollbackAuditEntry(conflictDirectory, original.id, {
    restoreRegistryRunValue: async () => { throw new Error('A Registry value now occupies the original startup name.'); },
  });
  assert.equal(conflict.success, false);
  assert.match(conflict.error, /now occupies/);
  assert.equal(journal.readJournal(conflictDirectory).find((entry) => entry.id === original.id).rollback.available, true);
});

test('policy checkpoint refusal prevents the policy write without creating an unresolved journal entry', async () => {
  const directory = createJournal([]);
  let writeCalled = false;
  const preAction = {
    registryPath: 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\CloudContent',
    valueName: 'DisableWindowsConsumerFeatures',
    keyExists: false,
    valueExists: false,
    value: null,
    valueKind: null,
  };
  const result = await journal.enableConsumerFeaturesPolicy(directory, {
    isCurrentProcessElevated: async () => true,
    readConsumerFeaturesPolicy: async () => preAction,
    createSafetyCheckpoint: async () => { throw new Error('System Restore is unavailable.'); },
    writeConsumerFeaturesPolicy: async () => { writeCalled = true; return nativeResult({}); },
  });
  assert.equal(writeCalled, false);
  assert.equal(result.success, false);
  assert.match(result.error, /policy was not changed.*checkpoint could not be created and verified/i);
  assert.deepEqual(journal.readJournal(directory), []);
});

test('policy checkpoint verifies readback without changing the Windows restore-point frequency', () => {
  const script = journal.createSafetyCheckpointPowerShellScript();
  assert.match(script, /Checkpoint-Computer -Description \$description -RestorePointType MODIFY_SETTINGS/);
  assert.ok((script.match(/Get-ComputerRestorePoint/g) || []).length >= 2);
  assert.match(script, /status = 'VERIFIED'/);
  assert.match(script, /status = 'THROTTLED'/);
  assert.match(script, /within the past 24 hours/);
  assert.doesNotMatch(script, /SystemRestorePointCreationFrequency/);
  assert.doesNotMatch(script, /New-ItemProperty[^\n]*SystemRestore/i);
  assert.doesNotMatch(script, /Remove-ItemProperty[^\n]*SystemRestore/i);
});

test('verified policy checkpoint gates apply and exact rollback through injected adapters', async () => {
  const directory = createJournal([]);
  const preAction = {
    registryPath: 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\CloudContent',
    valueName: 'DisableWindowsConsumerFeatures',
    keyExists: false,
    valueExists: false,
    value: null,
    valueKind: null,
  };
  let policyState = structuredClone(preAction);
  let policyWrites = 0;
  const checkpoint = {
    status: 'VERIFIED',
    description: 'Dialed pre-policy safety state',
    sequenceNumber: 42,
    creationTime: '20260816120000.000000-000',
    message: 'Windows reported the new restore point through Get-ComputerRestorePoint.',
  };
  const applied = await journal.enableConsumerFeaturesPolicy(directory, {
    isCurrentProcessElevated: async () => true,
    readConsumerFeaturesPolicy: async () => structuredClone(policyState),
    createSafetyCheckpoint: async () => nativeResult(checkpoint),
    writeConsumerFeaturesPolicy: async () => {
      policyWrites++;
      policyState = { ...preAction, keyExists: true, valueExists: true, value: 1, valueKind: 'DWord' };
      return nativeResult({ registryPath: preAction.registryPath, valueName: preAction.valueName, value: 1, enabled: true });
    },
  });
  assert.equal(applied.success, true);
  assert.equal(policyWrites, 1);
  assert.deepEqual(applied.entry.resultingState.verified, policyState);
  assert.deepEqual(applied.entry.resultingState.safetyCheckpoint, { ...checkpoint, proceededAfterThrottle: false });

  const restored = await journal.rollbackAuditEntry(directory, applied.entry.id, {
    isCurrentProcessElevated: async () => true,
    restoreConsumerFeaturesPolicy: async (captured) => {
      assert.equal(policyState.value, 1);
      assert.equal(captured.valueExists, false);
      policyState = structuredClone(preAction);
      return nativeResult({ restored: true, verified: structuredClone(policyState) });
    },
  });
  assert.equal(restored.success, true);
  assert.deepEqual(restored.entry.resultingState.verified, preAction);
  assert.equal(journal.readJournal(directory).find((entry) => entry.id === applied.entry.id).rollback.available, false);
});

test('24-hour checkpoint throttle stops before mutation and proceeds only after explicit authorization', async () => {
  const directory = createJournal([]);
  const preAction = {
    registryPath: 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\CloudContent',
    valueName: 'DisableWindowsConsumerFeatures',
    keyExists: false,
    valueExists: false,
    value: null,
    valueKind: null,
  };
  const checkpoint = {
    status: 'THROTTLED',
    description: 'Dialed pre-policy safety state',
    sequenceNumber: 41,
    creationTime: '20260816080000.000000-000',
    message: 'Windows did not create a new restore point because another restore point was created within the past 24 hours.',
  };
  let policyState = structuredClone(preAction);
  let writeCalled = false;
  const adapters = {
    isCurrentProcessElevated: async () => true,
    readConsumerFeaturesPolicy: async () => structuredClone(policyState),
    createSafetyCheckpoint: async () => nativeResult(checkpoint),
    writeConsumerFeaturesPolicy: async () => {
      writeCalled = true;
      policyState = { ...preAction, keyExists: true, valueExists: true, value: 1, valueKind: 'DWord' };
      return nativeResult({ value: 1, enabled: true });
    },
  };

  const stopped = await journal.enableConsumerFeaturesPolicy(directory, adapters);
  assert.equal(stopped.success, false);
  assert.equal(stopped.requiresThrottleConfirmation, true);
  assert.match(stopped.error, /within the past 24 hours/);
  assert.equal(writeCalled, false);
  assert.deepEqual(journal.readJournal(directory), []);

  const proceeded = await journal.enableConsumerFeaturesPolicy(directory, adapters, { allowThrottledCheckpoint: true });
  assert.equal(proceeded.success, true);
  assert.equal(writeCalled, true);
  assert.equal(proceeded.entry.resultingState.safetyCheckpoint.status, 'THROTTLED');
  assert.equal(proceeded.entry.resultingState.safetyCheckpoint.proceededAfterThrottle, true);
});

test('policy rollback conflict preserves the original rollback instead of overwriting drift', async () => {
  const directory = createJournal([{
    id: 'policy-original',
    status: 'SUCCESS',
    title: 'Consumer policy fixture',
    preAction: {
      registryPath: 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\CloudContent',
      valueName: 'DisableWindowsConsumerFeatures',
      valueExists: false,
      value: null,
      valueKind: null,
    },
    rollback: { available: true, kind: 'restore-consumer-features-policy', reason: 'restore fixture' },
  }]);
  const conflict = await journal.rollbackAuditEntry(directory, 'policy-original', {
    isCurrentProcessElevated: async () => true,
    restoreConsumerFeaturesPolicy: async () => {
      throw new Error('The policy no longer matches the state Dialed applied.');
    },
  });
  assert.equal(conflict.success, false);
  assert.match(conflict.error, /no longer matches/);
  assert.equal(journal.readJournal(directory).find((entry) => entry.id === 'policy-original').rollback.available, true);
});

test('renderer receives only a one-time token for throttled policy continuation', () => {
  const preloadSource = fs.readFileSync(path.join(__dirname, '..', 'electron', 'preload.cjs'), 'utf8');
  const mainSource = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8');
  const appSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'App.tsx'), 'utf8');
  const policySource = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'SafePolicies.tsx'), 'utf8');
  assert.match(preloadSource, /confirmConsumerFeaturesPolicy: \(throttleToken\) =>/);
  assert.doesNotMatch(preloadSource, /confirmConsumerFeaturesPolicy: \([^)]*(path|policy|checkpoint|allow)/i);
  assert.match(mainSource, /const policyThrottleContinuations = createMainPreviewStore\([^\n]+5 \* 60 \* 1000\)/);
  assert.match(mainSource, /const continuation = policyThrottleContinuations\.take\(throttleToken\)/);
  assert.match(mainSource, /policyThrottleContinuations\.assertFresh\(continuation\)/);
  assert.match(appSource, /Dialed has not changed the policy/);
  assert.match(appSource, /Continue with existing restore point/);
  assert.match(policySource, /Windows allows one restore point a day; if one was made recently, Dialed asks you before going ahead/);
});

test('EcoQoS rollback refuses reused process identity before changing state', async () => {
  const directory = createJournal([{
    id: 'ecoqos-original',
    status: 'SUCCESS',
    title: 'EcoQoS fixture',
    preAction: { pid: 4242, name: 'fixture-app', creationTime: '133000000000000000', efficiencyMode: false },
    rollback: { available: true, kind: 'disable-process-ecoqos', reason: 'restore fixture' },
  }]);
  let writeCalled = false;
  await assert.rejects(journal.rollbackAuditEntry(directory, 'ecoqos-original', {
    readRunningProcess: async () => ({ pid: 4242, name: 'reused-process' }),
    setProcessEcoQos: async () => { writeCalled = true; return nativeResult({}); },
  }), /identifier was reused/);
  assert.equal(writeCalled, false);
});

test('EcoQoS rollback refuses state drift before changing state or consuming rollback', async () => {
  const directory = createJournal([]);
  const process = { pid: 4242, name: 'fixture-app', creationTime: '133000000000000000', cpuPercent: 0, workingSetBytes: 1, efficiencyMode: false };
  let efficiencyMode = false;
  let rollbackWriteCalled = false;
  const adapters = {
    readRunningProcess: async () => ({ pid: process.pid, name: process.name, creationTime: '133000000000000000', parentPid: 1000, parentName: 'explorer' }),
    detectInstalledAntiCheats: async () => [],
    getProcessEcoQos: async () => ({ pid: process.pid, efficiencyMode }),
    setProcessEcoQos: async (_pid, enabled) => {
      if (!enabled) rollbackWriteCalled = true;
      efficiencyMode = enabled;
      return nativeResult({ pid: process.pid, efficiencyMode });
    },
  };
  const applied = await journal.enableProcessEcoQos(directory, process, adapters);
  assert.equal(applied.success, true);

  efficiencyMode = false;
  const beforeRollback = journal.readJournal(directory);
  await assert.rejects(
    journal.rollbackAuditEntry(directory, applied.entry.id, adapters),
    /no longer matches the state Dialed applied/,
  );
  assert.equal(rollbackWriteCalled, false);
  assert.deepEqual(journal.readJournal(directory), beforeRollback);
  assert.equal(journal.readJournal(directory)[0].rollback.available, true);
});

test('acceptance baseline cannot claim mutation or test completion', () => {
  const record = createAcceptanceRecord({
    packageVersion: 'test',
    windows: { build: 'test', elevated: false },
    artifacts: [],
    disposableDeclaration: 'fixture',
  });
  assert.equal(record.mutationAuthorizationRecorded, false);
  assert.ok(Object.values(record.acceptanceCases).every((status) => status === 'NOT_RUN'));
  assert.match(record.guardrail, /does not launch artifacts, install software, or execute a Windows mutation/);
  assert.throws(() => resolveOutput(process.cwd(), '..\\outside.json'), /inside the repository/);
});

test('audit export removes action targets, stable IDs, paths, names, and raw native output', () => {
  const preview = journal.createAuditExportPreview([{
    id: 'PRIVATE-STABLE-ID',
    timestamp: '2026-08-15T00:00:00.000Z',
    updatedAt: '2026-08-15T00:01:00.000Z',
    actionId: 'startup:disable:abcdefabcdefabcdefabcdef',
    capabilityId: 'PRIVATE-CAPABILITY',
    title: 'Disable startup item: PRIVATE-APP-NAME',
    category: 'PRIVATE-CATEGORY',
    safetyClass: 'PRIVATE-SAFETY',
    riskLevel: 'PRIVATE-RISK',
    status: 'NEEDS_REVIEW',
    exitCode: 1,
    preAction: { registryPath: 'HKCU:\\PRIVATE-PATH', valueName: 'PRIVATE-VALUE', value: 'C:\\Users\\Private\\app.exe', pid: 4242 },
    resultingState: { path: 'C:\\PRIVATE-RESULT' },
    stdout: 'PRIVATE-STDOUT',
    stderr: 'PRIVATE-STDERR',
    rollback: { available: false, reason: 'PRIVATE-ROLLBACK-REASON' },
    reconciliation: { classification: 'UNAVAILABLE', message: 'PRIVATE-RECONCILIATION' },
  }], '2026-08-15T01:00:00.000Z');
  assert.equal(journal.assertValidAuditExport(preview.payload), true);
  const serialized = JSON.stringify(preview.payload);
  assert.doesNotMatch(serialized, /PRIVATE|abcdefabcdef|4242|Users/);
  assert.match(serialized, /"actionFamily":"startup:disable"/);
  assert.match(serialized, /"errorEvidencePresent":true/);
});

test('audit export writes only a new absolute JSON target after schema validation', () => {
  const directory = createJournal([]);
  const target = path.join(directory, 'redacted.json');
  const preview = journal.createAuditExportPreview([]);
  const result = journal.writeAuditExport(target, preview.payload);
  assert.equal(result.fileName, 'redacted.json');
  assert.equal(JSON.parse(fs.readFileSync(target, 'utf8')).schemaVersion, '1.0.0-redacted-audit-export');
  assert.throws(() => journal.writeAuditExport(target, preview.payload), /already exists/);
  assert.throws(() => journal.writeAuditExport('relative.json', preview.payload), /absolute .json/);
});

test('retention deletion protects unresolved and rollback-capable audit evidence', () => {
  const old = '2025-01-01T00:00:00.000Z';
  const recent = '2026-08-14T00:00:00.000Z';
  const entries = [
    { id: 'delete-success', timestamp: old, status: 'SUCCESS', actionId: 'clear-temp-files', rollback: { available: false } },
    { id: 'delete-failed', timestamp: old, status: 'FAILED', actionId: 'clear-temp-files', rollback: { available: false } },
    { id: 'retain-recent', timestamp: recent, status: 'SUCCESS', actionId: 'clear-temp-files', rollback: { available: false } },
    { id: 'retain-pending', timestamp: old, status: 'PENDING', actionId: 'clear-temp-files', rollback: { available: false } },
    { id: 'retain-review', timestamp: old, status: 'NEEDS_REVIEW', actionId: 'clear-temp-files', rollback: { available: false } },
    { id: 'retain-rollback', timestamp: old, status: 'SUCCESS', actionId: 'startup:disable:abcdefabcdefabcdefabcdef', rollback: { available: true } },
  ];
  const preview = journal.createJournalDeletionPreview(entries, 'COMPLETED_90_DAYS', Date.parse('2026-08-15T00:00:00.000Z'));
  assert.equal(preview.deleteCount, 2);
  assert.equal(preview.retainCount, 4);
  assert.deepEqual(preview.protectedCounts, { unresolved: 2, rollbackAvailable: 1, invalidOrUnclassified: 0 });
  const directory = createJournal(entries);
  const result = journal.applyJournalDeletion(directory, preview);
  assert.equal(result.deletedCount, 2);
  assert.deepEqual(result.entries.map((entry) => entry.id), ['retain-recent', 'retain-pending', 'retain-review', 'retain-rollback']);
});

test('retention deletion refuses a stale preview after any journal change', () => {
  const entries = [{ id: 'delete-me', timestamp: '2025-01-01T00:00:00.000Z', status: 'FAILED', actionId: 'clear-temp-files', rollback: { available: false } }];
  const directory = createJournal(entries);
  const preview = journal.createJournalDeletionPreview(entries, 'ALL_DELETABLE');
  fs.writeFileSync(path.join(directory, 'journal.json'), JSON.stringify([{ ...entries[0], updatedAt: 'changed' }]), 'utf8');
  assert.throws(() => journal.applyJournalDeletion(directory, preview), /changed after preview/);
});

test('renderer never supplies an audit export path or deletion entry IDs', () => {
  const preloadSource = fs.readFileSync(path.join(__dirname, '..', 'electron', 'preload.cjs'), 'utf8');
  const mainSource = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8');
  assert.match(preloadSource, /exportAuditHistory: \(\) =>/);
  assert.doesNotMatch(preloadSource, /exportAuditHistory: \([^)]*(path|file)/i);
  assert.match(mainSource, /dialog\.showSaveDialog/);
  assert.match(preloadSource, /deleteAuditHistory: \(token\) =>/);
  assert.doesNotMatch(preloadSource, /deleteAuditHistory: \([^)]*(ids|entries)/i);
});

function benchmarkFixture(phase, samples, overrides = {}) {
  return {
    experimentId: 'fixture-experiment',
    phase,
    workload: 'Fixture deterministic replay',
    tool: 'FixtureBench',
    toolVersion: '1.0',
    metric: 'Average FPS',
    unit: 'fps',
    direction: 'HIGHER_IS_BETTER',
    variant: phase === 'BASELINE' ? 'Before' : 'After',
    changeDescription: 'Fixture controlled change',
    capturedAt: phase === 'BASELINE' ? '2026-08-15T00:00:00.000Z' : '2026-08-15T01:00:00.000Z',
    samples,
    sampleUnit: 'TRIAL',
    trialIds: samples.map((_, index) => `${phase}-${index}`),
    conditions: Object.fromEntries(benchmarks.CONDITION_FIELDS.map((field) => [field, `fixture-${field}`])),
    notes: '',
    ...overrides,
  };
}

test('benchmark schema requires bounded repeated numeric samples and complete conditions', () => {
  assert.throws(() => benchmarks.validateRecordSet([benchmarkFixture('BASELINE', [100, 101])]), /between 3 and/);
  assert.throws(() => benchmarks.validateRecordSet([benchmarkFixture('BASELINE', [100, Number.NaN, 101])]), /finite measurement/);
  const normalized = benchmarks.validateRecordSet([benchmarkFixture('BASELINE', [100, 101, 99])]);
  assert.equal(normalized[0].samples.length, 3);
  assert.match(normalized[0].id, /^[0-9a-f-]{36}$/i);
});

test('benchmark comparison reports transparent statistics and conservative classifications', () => {
  const measured = benchmarks.validateRecordSet([
    benchmarkFixture('BASELINE', [100, 101, 99]),
    benchmarkFixture('CANDIDATE', [110, 111, 109]),
  ]);
  const comparison = benchmarks.compareExperiment(measured, 'fixture-experiment');
  assert.equal(comparison.classification, 'MEASURED_DIFFERENCE');
  assert.equal(Math.round(comparison.favorableDeltaPercent), 10);
  assert.equal(comparison.baselineStats.count, 3);
  assert.match(comparison.scopeWarning, /not a universal performance claim/);

  const regression = benchmarks.validateRecordSet([
    benchmarkFixture('BASELINE', [100, 101, 99]),
    benchmarkFixture('CANDIDATE', [90, 91, 89]),
  ]);
  assert.equal(benchmarks.compareExperiment(regression, 'fixture-experiment').classification, 'REGRESSION');

  const noisy = benchmarks.validateRecordSet([
    benchmarkFixture('BASELINE', [80, 100, 120]),
    benchmarkFixture('CANDIDATE', [85, 105, 125]),
  ]);
  assert.equal(benchmarks.compareExperiment(noisy, 'fixture-experiment').classification, 'HIGH_VARIANCE');

  const mismatched = benchmarks.validateRecordSet([
    benchmarkFixture('BASELINE', [100, 101, 99]),
    benchmarkFixture('CANDIDATE', [110, 111, 109], { conditions: { ...benchmarkFixture('CANDIDATE', [1, 2, 3]).conditions, resolution: 'different' } }),
  ]);
  const mismatch = benchmarks.compareExperiment(mismatched, 'fixture-experiment');
  assert.equal(mismatch.classification, 'INCOMPARABLE');
  assert.deepEqual(mismatch.conditionMismatches, ['resolution']);
});

test('benchmark JSON and CSV import use strict main-process file parsing', () => {
  const directory = createJournal([]);
  const jsonPath = path.join(directory, 'benchmark.json');
  fs.writeFileSync(jsonPath, JSON.stringify({ schemaVersion: '1.0.0', records: [benchmarkFixture('BASELINE', [100, 101, 99])] }), 'utf8');
  assert.equal(benchmarks.parseBenchmarkImport(jsonPath).length, 1);
  assert.throws(() => benchmarks.parseBenchmarkImport(path.join(directory, 'unsupported.txt')), /only .json and .csv/);

  const headers = ['experimentId', 'phase', 'workload', 'tool', 'toolVersion', 'metric', 'unit', 'direction', 'variant', 'changeDescription', 'capturedAt', 'sample', ...benchmarks.CONDITION_FIELDS, 'notes'];
  const source = benchmarkFixture('BASELINE', [100, 101, 99]);
  const rows = source.samples.map((sample) => headers.map((header) => {
    if (header === 'sample') return String(sample);
    if (benchmarks.CONDITION_FIELDS.includes(header)) return source.conditions[header];
    return source[header] ?? '';
  }).join(','));
  const csvPath = path.join(directory, 'benchmark.csv');
  fs.writeFileSync(csvPath, `${headers.join(',')}\n${rows.join('\n')}`, 'utf8');
  const parsed = benchmarks.parseBenchmarkImport(csvPath);
  assert.equal(parsed[0].samples.length, 3);
});

test('raw PresentMon CSV parsing retains exact supported frame-time samples without Windows calls', () => {
  const capture = benchmarks.parsePresentMonCsv([
    'Application,ProcessID,SwapChainAddress,FrameTime',
    'fixture.exe,4242,0x1,16.6',
    'fixture.exe,4242,0x1,NA',
    'fixture.exe,4242,0x1,16.7',
    'fixture.exe,4243,0x2,16.5',
  ].join('\n'));
  assert.equal(capture.format, 'PRESENTMON');
  assert.equal(capture.metricColumn, 'FrameTime');
  assert.equal(capture.direction, 'LOWER_IS_BETTER');
  assert.equal(capture.unavailableFrameCount, 1);
  assert.deepEqual(capture.applications, [{
    application: 'fixture.exe',
    processIds: [4242, 4243],
    samples: [16.6, 16.7, 16.5],
  }]);

  const consoleCapture = benchmarks.parsePresentMonCsv([
    '\uFEFFApplication,ProcessID,MsBetweenPresents',
    'fixture.exe,4242,10.0',
    'fixture.exe,4242,10.1',
    'fixture.exe,4242,9.9',
  ].join('\r\n'));
  assert.equal(consoleCapture.metricColumn, 'MsBetweenPresents');
  assert.deepEqual(consoleCapture.applications[0].samples, [10, 10.1, 9.9]);
});

test('PresentMon metadata creates one reviewed baseline and candidate without renderer file paths', () => {
  const sourceIds = [
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
  ];
  const sources = sourceIds.map((sourceId, index) => ({
    sourceId,
    format: 'PRESENTMON',
    fileName: index === 0 ? 'baseline.csv' : 'candidate.csv',
    capturedAt: `2026-08-1${index + 5}T00:00:00.000Z`,
    metricColumn: 'FrameTime',
    unit: 'ms',
    direction: 'LOWER_IS_BETTER',
    applications: [{ application: 'fixture.exe', processIds: [4242 + index], samples: index === 0 ? [10, 10.1, 9.9] : [10.01, 10.11, 9.91] }],
  }));
  const records = benchmarks.createPresentMonRecords(sources, {
    experimentId: 'presentmon-fixture',
    workload: 'Fixture replay',
    toolVersion: '2.4.1',
    changeDescription: 'Fixture controlled change',
    conditions: Object.fromEntries(benchmarks.CONDITION_FIELDS.map((field) => [field, `fixture-${field}`])),
    runs: sourceIds.map((sourceId, index) => ({
      sourceId,
      phase: index === 0 ? 'BASELINE' : 'CANDIDATE',
      application: 'fixture.exe',
      variant: index === 0 ? 'Before' : 'After',
      capturedAt: `2026-08-1${index + 5}T00:00:00.000Z`,
      notes: '',
    })),
  });
  assert.deepEqual(records.map((record) => record.phase), ['BASELINE', 'CANDIDATE']);
  assert.deepEqual(records[0].samples, [10, 10.1, 9.9]);
  assert.equal(records[0].tool, 'PresentMon');
  assert.throws(() => benchmarks.createPresentMonRecords(sources, {
    experimentId: 'presentmon-fixture',
    workload: 'Fixture replay',
    toolVersion: '2.4.1',
    changeDescription: 'Fixture controlled change',
    conditions: Object.fromEntries(benchmarks.CONDITION_FIELDS.map((field) => [field, `fixture-${field}`])),
    runs: sourceIds.map((sourceId) => ({ sourceId, phase: 'BASELINE', application: 'fixture.exe', variant: 'Before' })),
  }), /one BASELINE run and one CANDIDATE run/);

  const preloadSource = fs.readFileSync(path.join(__dirname, '..', 'electron', 'preload.cjs'), 'utf8');
  assert.doesNotMatch(preloadSource, /preparePresentMonImport: \([^)]*(path|file)/i);
});

test('two raw PresentMon CSV runs import with exact samples and preserve a low-delta INCONCLUSIVE result', () => {
  const directory = createJournal([]);
  const baselinePath = path.join(directory, 'presentmon-baseline.csv');
  const candidatePath = path.join(directory, 'presentmon-candidate.csv');
  fs.writeFileSync(baselinePath, [
    'Application,ProcessID,FrameTime',
    'fixture.exe,4242,10.0',
    'fixture.exe,4242,10.1',
    'fixture.exe,4242,9.9',
  ].join('\n'), 'utf8');
  fs.writeFileSync(candidatePath, [
    'Application,ProcessID,FrameTime',
    'fixture.exe,4343,10.01',
    'fixture.exe,4343,10.11',
    'fixture.exe,4343,9.91',
  ].join('\n'), 'utf8');

  const sourceIds = [
    '33333333-3333-4333-8333-333333333333',
    '44444444-4444-4444-8444-444444444444',
  ];
  const sources = [baselinePath, candidatePath].map((filePath, index) => ({
    ...benchmarks.parseBenchmarkSource(filePath),
    sourceId: sourceIds[index],
  }));
  const records = benchmarks.createPresentMonRecords(sources, {
    experimentId: 'presentmon-low-delta',
    workload: 'Fixture deterministic replay',
    toolVersion: '2.4.1',
    changeDescription: 'Fixture controlled change',
    conditions: Object.fromEntries(benchmarks.CONDITION_FIELDS.map((field) => [field, `fixture-${field}`])),
    runs: sourceIds.map((sourceId, index) => ({
      sourceId,
      phase: index === 0 ? 'BASELINE' : 'CANDIDATE',
      application: 'fixture.exe',
      variant: index === 0 ? 'Before' : 'After',
      capturedAt: index === 0 ? '2026-08-15T00:00:00.000Z' : '2026-08-15T01:00:00.000Z',
      notes: '',
    })),
  });
  benchmarks.applyImport(directory, benchmarks.createImportPreview([], records));
  const evidence = benchmarks.listBenchmarkEvidence(directory);
  assert.deepEqual(evidence.records.map((record) => record.samples), [
    [10, 10.1, 9.9],
    [10.01, 10.11, 9.91],
  ]);
  assert.equal(evidence.comparisons[0].classification, 'INCONCLUSIVE');
  assert.match(evidence.comparisons[0].reason, /cannot say whether it is real/);
});

test('benchmark import is previewed, stale-safe, locally bounded, and explicitly deletable', () => {
  const directory = createJournal([]);
  const records = benchmarks.validateRecordSet([
    benchmarkFixture('BASELINE', [100, 101, 99]),
    benchmarkFixture('CANDIDATE', [110, 111, 109]),
  ]);
  const preview = benchmarks.createImportPreview([], records);
  const stored = benchmarks.applyImport(directory, preview);
  assert.equal(stored.length, 2);
  assert.equal(benchmarks.listBenchmarkEvidence(directory).comparisons[0].classification, 'MEASURED_DIFFERENCE');
  assert.throws(() => benchmarks.applyImport(directory, preview), /changed after preview/);
  const deletionPreview = benchmarks.createBenchmarkDeletionPreview(benchmarks.readBenchmarks(directory), 'fixture-experiment');
  const deleted = benchmarks.deleteBenchmarkExperiment(directory, deletionPreview);
  assert.equal(deleted.deletedCount, 2);
  assert.deepEqual(benchmarks.listBenchmarkEvidence(directory).records, []);
});

test('benchmark regression guidance links only to verified available rollback evidence', () => {
  const auditId = '11111111-1111-4111-8111-111111111111';
  const records = benchmarks.validateRecordSet([
    benchmarkFixture('BASELINE', [100, 101, 99]),
    benchmarkFixture('CANDIDATE', [90, 91, 89], { linkedAuditEntryId: auditId }),
  ]);
  const available = benchmarks.compareExperiment(records, 'fixture-experiment', [{
    id: auditId,
    status: 'SUCCESS',
    capabilityId: 'process:enable-ecoqos',
    rollback: { available: true },
  }]);
  assert.equal(available.classification, 'REGRESSION');
  assert.equal(available.rollbackGuidance.available, true);
  assert.match(available.rollbackGuidance.reason, /never automatic/);
  const unavailable = benchmarks.compareExperiment(records, 'fixture-experiment', []);
  assert.equal(unavailable.rollbackGuidance.available, false);
});

test('benchmark deletion refuses stale preview after local evidence changes', () => {
  const directory = createJournal([]);
  const initial = benchmarks.validateRecordSet([benchmarkFixture('BASELINE', [100, 101, 99])]);
  benchmarks.applyImport(directory, benchmarks.createImportPreview([], initial));
  const deletion = benchmarks.createBenchmarkDeletionPreview(benchmarks.readBenchmarks(directory), 'fixture-experiment');
  const additional = benchmarks.validateRecordSet([benchmarkFixture('BASELINE', [50, 51, 49], { experimentId: 'second-experiment' })]);
  benchmarks.applyImport(directory, benchmarks.createImportPreview(benchmarks.readBenchmarks(directory), additional));
  assert.throws(() => benchmarks.deleteBenchmarkExperiment(directory, deletion), /changed after preview/);
});

test('renderer cannot supply benchmark import paths or raw stored records', () => {
  const preloadSource = fs.readFileSync(path.join(__dirname, '..', 'electron', 'preload.cjs'), 'utf8');
  const mainSource = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8');
  assert.match(preloadSource, /previewBenchmarkImport: \(\) =>/);
  assert.doesNotMatch(preloadSource, /previewBenchmarkImport: \([^)]*(path|file)/i);
  assert.match(mainSource, /dialog\.showOpenDialog/);
  assert.match(mainSource, /selection\.filePaths\.map\(parseBenchmarkSource\)/);
  assert.match(preloadSource, /preparePresentMonImport: \(token, metadata\) =>/);
  assert.doesNotMatch(preloadSource, /preparePresentMonImport: \([^)]*(path|file)/i);
  assert.match(preloadSource, /deleteBenchmarkExperiment: \(token\) =>/);
  assert.doesNotMatch(preloadSource, /deleteBenchmarkExperiment: \(experimentId\) =>/);
});

test('declared-license inventory covers direct Bun dependencies with deterministic bounded output', () => {
  const root = path.join(__dirname, '..');
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const first = licenseInventory.buildInventory(root);
  const second = licenseInventory.buildInventory(root);
  assert.deepEqual(first, second);
  assert.equal(first.summary.directProductionCount, Object.keys(packageJson.dependencies).length);
  assert.equal(first.summary.directDevelopmentCount, Object.keys(packageJson.devDependencies).length);
  assert.ok(first.packages.length > first.summary.directProductionCount + first.summary.directDevelopmentCount);
  assert.ok(first.packages.every((record, index, records) => index === 0 ||
    records[index - 1].name.localeCompare(record.name) < 0 ||
    (records[index - 1].name === record.name && records[index - 1].version.localeCompare(record.version) <= 0)));
  const serialized = JSON.stringify(first);
  assert.ok(Buffer.byteLength(serialized) < 2 * 1024 * 1024);
  assert.ok(!serialized.toLowerCase().includes(path.resolve(root).toLowerCase()));
  assert.match(first.disclaimer, /not legal advice, license clearance/);
});

test('declared-license inventory makes missing and unsafe metadata explicit', () => {
  assert.equal(licenseInventory.normalizeLicense({}), 'UNKNOWN');
  assert.equal(licenseInventory.normalizeLicense({ licenses: [{ type: 'MIT' }, { type: 'Apache-2.0' }] }), 'Apache-2.0 OR MIT');
  assert.equal(licenseInventory.normalizeSource('C:\\private\\package'), 'UNKNOWN');
  assert.equal(licenseInventory.normalizeSource('file:///private/package'), 'UNKNOWN');
  const review = licenseInventory.renderReview({
    disclaimer: licenseInventory.DISCLAIMER,
    source: { lockfile: 'bun.lock', lockfileSha256: 'a'.repeat(64) },
    summary: { packageCount: 1, directProductionCount: 1, directDevelopmentCount: 0, unknownLicenseCount: 1, notInstalledCount: 1 },
    packages: [{ name: 'fixture', version: '1.0.0', relationship: 'DIRECT_PRODUCTION', declaredLicense: 'UNKNOWN', metadataStatus: 'NOT_INSTALLED' }],
  });
  assert.match(review, /Requires human review/);
  assert.match(review, /not legal advice, license clearance/);
  assert.match(review, /Electron\/Chromium obligations/);
});
