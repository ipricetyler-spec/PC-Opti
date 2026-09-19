const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { afterEach, test } = require('node:test');

const capabilities = require('../src/main/capabilities/index.cjs');
const gameSettings = require('../src/main/game-settings/index.cjs');
const journal = require('../src/main/journal/index.cjs');
const timing = require('../src/main/timing/index.cjs');

const temporaryDirectories = [];

function createUserData(entries = []) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-opti-timing-test-'));
  temporaryDirectories.push(directory);
  fs.writeFileSync(path.join(directory, 'journal.json'), JSON.stringify(entries), 'utf8');
  return directory;
}

function bootState(overrides = {}) {
  return {
    source: 'bcdedit /enum ACTIVE',
    usePlatformClock: null,
    disableDynamicTick: null,
    ...overrides,
  };
}

function backupEvidence() {
  return {
    relativePath: path.join('safety-backups', 'bcd', 'fixture.bcd'),
    bytes: 12,
    sha256: 'a'.repeat(64),
    createdAt: '2026-08-17T00:00:00.000Z',
  };
}

function pendingTimingEntry(actionId, state) {
  return {
    schemaVersion: '1.1.0',
    id: crypto.randomUUID(),
    timestamp: '2026-08-17T00:00:00.000Z',
    updatedAt: '2026-08-17T00:00:00.000Z',
    actionId,
    capabilityId: actionId,
    safetyClass: 'S3',
    riskLevel: 'Medium',
    title: 'Fixture timing experiment',
    category: 'Timing experiment',
    preAction: { actionId, state, bcdBackup: backupEvidence() },
    resultingState: null,
    status: 'PENDING',
    exitCode: null,
    stdout: '',
    stderr: '',
    rollback: {
      available: true,
      kind: 'restore-boot-timing-setting',
      reason: 'Fixture exact rollback',
    },
  };
}

afterEach(() => {
  while (temporaryDirectories.length) {
    fs.rmSync(temporaryDirectories.pop(), { recursive: true, force: true });
  }
});

test('boot timing parser accepts supported values amid localized headings and rejects unsupported values', () => {
  const parsed = timing.parseBootTimingState([
    'Gestionnaire de démarrage Windows',
    '-----------------------------------',
    'identificateur              {current}',
    'path                        \\Windows\\system32\\winload.efi',
    'useplatformclock            Yes',
    'disabledynamictick          no',
  ].join('\r\n'));
  assert.deepEqual(parsed, bootState({ usePlatformClock: 'YES', disableDynamicTick: 'NO' }));

  assert.deepEqual(timing.parseBootTimingState('identifier {current}\r\npath \\Windows\\system32\\winload.efi\r\n'), bootState());
  assert.throws(() => timing.parseBootTimingState('path \\Windows\\system32\\winload.efi\r\nuseplatformclock Maybe'), /unsupported useplatformclock value/);
  assert.throws(() => timing.parseBootTimingState(''), /no active-entry data/);
  assert.throws(() => timing.parseBootTimingState('identifier {bootmgr}'), /unambiguous active Windows loader/);
});

test('timing applicability exposes only bounded executable actions and keeps precision timer research-only', () => {
  const items = timing.timingExperimentsForState(bootState({ usePlatformClock: 'YES' }));
  assert.equal(items[0].availability, 'APPLICABLE');
  assert.equal(items[0].actionId, timing.TIMING_ACTIONS.RESTORE_AUTOMATIC_CLOCK_SOURCE);
  assert.equal(items[1].availability, 'APPLICABLE');
  assert.equal(items[2].availability, 'RESEARCH_ONLY');
  assert.equal(items[2].actionId, null);
  assert.match(items[2].framing, /Dialed asking for it would not help your game/);
  assert.match(items[2].limitations, /A finer timer can cost performance and power/);

  const defaults = timing.timingExperimentsForState(bootState({ disableDynamicTick: 'YES' }));
  assert.equal(defaults[0].actionId, null);
  assert.equal(defaults[1].actionId, null);
});

test('targeted timing comparisons ignore unrelated settings but reject unknown actions', () => {
  assert.equal(timing.timingTargetStateEquals(
    timing.TIMING_ACTIONS.RESTORE_AUTOMATIC_CLOCK_SOURCE,
    bootState({ usePlatformClock: 'YES', disableDynamicTick: null }),
    bootState({ usePlatformClock: 'YES', disableDynamicTick: 'YES' })
  ), true);
  assert.equal(timing.timingTargetStateEquals(
    timing.TIMING_ACTIONS.DISABLE_DYNAMIC_TICK,
    bootState({ usePlatformClock: null, disableDynamicTick: 'NO' }),
    bootState({ usePlatformClock: 'YES', disableDynamicTick: 'NO' })
  ), true);
  assert.throws(() => timing.timingTargetStateEquals('timing:unknown', bootState(), bootState()), /not recognized/);
  assert.equal(timing.assertBootTimingState(bootState({ source: 'bcdedit /enum {current}' })), true);
});

test('BCD backup stays under user data and records exact byte and hash evidence without a Windows call', async () => {
  const directory = createUserData();
  const content = Buffer.from('fixture-bcd-store', 'utf8');
  let exportedPath = null;
  const evidence = await timing.createBcdBackup(
    directory,
    timing.TIMING_ACTIONS.DISABLE_DYNAMIC_TICK,
    {
      now: () => 123456789,
      randomBytes: () => Buffer.from('01020304', 'hex'),
      runPowerShell: async (script) => {
        const encodedPath = script.match(/FromBase64String\('([^']+)'\)/)?.[1];
        assert.ok(encodedPath);
        exportedPath = Buffer.from(encodedPath, 'base64').toString('utf8');
        assert.equal(path.relative(directory, exportedPath).startsWith('..'), false);
        fs.writeFileSync(exportedPath, content);
        return { stdout: '', stderr: '', exitCode: 0 };
      },
    }
  );

  assert.equal(exportedPath, path.join(directory, evidence.relativePath));
  assert.equal(evidence.bytes, content.length);
  assert.equal(evidence.sha256, crypto.createHash('sha256').update(content).digest('hex'));
  assert.match(evidence.relativePath, /^safety-backups[\\/]bcd[\\/]timing-disable-dynamic-tick-123456789-01020304\.bcd$/);
});

test('timing execution refuses non-elevated and incomplete-backup paths before mutation or journal creation', async () => {
  const directory = createUserData();
  let reads = 0;
  let backups = 0;
  let writes = 0;
  await assert.rejects(journal.executeTimingAction(directory, timing.TIMING_ACTIONS.DISABLE_DYNAMIC_TICK, {
    isCurrentProcessElevated: async () => false,
    readBootTimingState: async () => { reads += 1; return bootState(); },
    createBcdBackup: async () => { backups += 1; return backupEvidence(); },
    applyBootTimingAction: async () => { writes += 1; },
  }), /running as administrator/);
  assert.deepEqual({ reads, backups, writes }, { reads: 0, backups: 0, writes: 0 });

  await assert.rejects(journal.executeTimingAction(directory, timing.TIMING_ACTIONS.DISABLE_DYNAMIC_TICK, {
    isCurrentProcessElevated: async () => true,
    readBootTimingState: async () => { reads += 1; return bootState(); },
    createBcdBackup: async () => { backups += 1; return { bytes: 0, sha256: 'bad' }; },
    applyBootTimingAction: async () => { writes += 1; },
  }), /backup evidence is not complete/);
  assert.deepEqual({ reads, backups, writes }, { reads: 1, backups: 1, writes: 0 });
  assert.deepEqual(journal.readJournal(directory), []);
});

test('timing execution persists PENDING before write and records verified configured state separately from performance', async () => {
  const directory = createUserData();
  const before = bootState({ usePlatformClock: 'YES' });
  const after = bootState();
  let readCount = 0;
  const result = await journal.executeTimingAction(directory, timing.TIMING_ACTIONS.RESTORE_AUTOMATIC_CLOCK_SOURCE, {
    isCurrentProcessElevated: async () => true,
    readBootTimingState: async () => (++readCount === 1 ? before : after),
    createBcdBackup: async () => backupEvidence(),
    applyBootTimingAction: async (actionId) => {
      assert.equal(actionId, timing.TIMING_ACTIONS.RESTORE_AUTOMATIC_CLOCK_SOURCE);
      const pending = journal.readJournal(directory);
      assert.equal(pending.length, 1);
      assert.equal(pending[0].status, 'PENDING');
      assert.deepEqual(pending[0].preAction.state, before);
      assert.equal(pending[0].preAction.bcdBackup.sha256, 'a'.repeat(64));
      return { output: { configured: true }, stdout: 'configured', stderr: '', exitCode: 0 };
    },
  });

  assert.equal(result.success, true);
  assert.equal(result.entry.status, 'SUCCESS');
  assert.equal(result.entry.resultingState.effectiveState, 'PENDING_REBOOT');
  assert.equal(result.entry.resultingState.performanceOutcome, 'UNVERIFIED');
  assert.equal(result.entry.rollback.kind, 'restore-boot-timing-setting');
  assert.equal(result.entry.rollback.available, true);
});

test('timing execution retains honest NEEDS_REVIEW evidence on write failure or readback divergence', async () => {
  for (const mode of ['execution-failure', 'readback-divergence']) {
    const directory = createUserData();
    let readCount = 0;
    const result = await journal.executeTimingAction(directory, timing.TIMING_ACTIONS.DISABLE_DYNAMIC_TICK, {
      isCurrentProcessElevated: async () => true,
      readBootTimingState: async () => {
        readCount += 1;
        return mode === 'readback-divergence' && readCount > 1
          ? bootState({ disableDynamicTick: 'NO' })
          : bootState();
      },
      createBcdBackup: async () => backupEvidence(),
      applyBootTimingAction: async () => {
        if (mode === 'execution-failure') {
          const error = new Error('fixture write failed');
          error.exitCode = 5;
          error.stderr = 'fixture write failed';
          throw error;
        }
        return { output: { configured: true }, stdout: 'configured', stderr: '', exitCode: 0 };
      },
    });
    assert.equal(result.success, false, mode);
    assert.equal(result.entry.status, 'NEEDS_REVIEW', mode);
    assert.equal(result.entry.rollback.available, false, mode);
    assert.match(result.error, mode === 'execution-failure' ? /fixture write failed/ : /intended boot timing value/, mode);
  }
});

test('interrupted timing reconciliation distinguishes intended, pre-action, divergent, and unavailable states', async () => {
  const actionId = timing.TIMING_ACTIONS.RESTORE_AUTOMATIC_CLOCK_SOURCE;
  const before = bootState({ usePlatformClock: 'YES' });
  const scenarios = [
    { actual: bootState(), status: 'SUCCESS', classification: 'INTENDED_STATE', rollback: true },
    { actual: bootState({ usePlatformClock: 'YES', disableDynamicTick: 'YES' }), status: 'FAILED', classification: 'PRE_ACTION_STATE', rollback: false },
    { actual: bootState({ usePlatformClock: 'NO' }), status: 'NEEDS_REVIEW', classification: 'DIVERGED', rollback: false },
  ];
  for (const scenario of scenarios) {
    const directory = createUserData([pendingTimingEntry(actionId, before)]);
    const result = await journal.reconcilePendingEntries(directory, {
      readBootTimingState: async () => scenario.actual,
    });
    const entry = result.entries[0];
    assert.equal(entry.status, scenario.status);
    assert.equal(entry.reconciliation.classification, scenario.classification);
    assert.equal(entry.rollback.available, scenario.rollback);
  }

  const unavailableDirectory = createUserData([pendingTimingEntry(actionId, before)]);
  const unavailable = await journal.reconcilePendingEntries(unavailableDirectory, {
    readBootTimingState: async () => { throw new Error('fixture state unavailable'); },
  });
  assert.equal(unavailable.entries[0].status, 'NEEDS_REVIEW');
  assert.equal(unavailable.entries[0].reconciliation.classification, 'UNAVAILABLE');
  assert.equal(unavailable.entries[0].rollback.available, false);
});

test('timing rollback restores prior present or absent target values and ignores unrelated target-independent changes', async () => {
  const scenarios = [
    {
      actionId: timing.TIMING_ACTIONS.RESTORE_AUTOMATIC_CLOCK_SOURCE,
      before: bootState({ usePlatformClock: 'YES' }),
      applied: bootState({ disableDynamicTick: 'YES' }),
      restored: bootState({ usePlatformClock: 'YES', disableDynamicTick: 'YES' }),
    },
    {
      actionId: timing.TIMING_ACTIONS.DISABLE_DYNAMIC_TICK,
      before: bootState(),
      applied: bootState({ usePlatformClock: 'NO', disableDynamicTick: 'YES' }),
      restored: bootState({ usePlatformClock: 'NO' }),
    },
  ];

  for (const scenario of scenarios) {
    const original = pendingTimingEntry(scenario.actionId, scenario.before);
    original.status = 'SUCCESS';
    const directory = createUserData([original]);
    let reads = 0;
    let restoredPreAction = null;
    const result = await journal.rollbackAuditEntry(directory, original.id, {
      isCurrentProcessElevated: async () => true,
      readBootTimingState: async () => (++reads === 1 ? scenario.applied : scenario.restored),
      restoreBootTimingAction: async (preAction) => {
        restoredPreAction = preAction;
        return { output: { configured: true }, stdout: 'restored', stderr: '', exitCode: 0 };
      },
    });
    assert.equal(result.success, true);
    assert.deepEqual(restoredPreAction.state, scenario.before);
    const entries = journal.readJournal(directory);
    assert.equal(entries.length, 2);
    assert.equal(entries.find((entry) => entry.id === original.id).rollback.available, false);
    assert.equal(result.entry.resultingState.performanceOutcome, 'UNVERIFIED');
  }
});

test('timing rollback refuses elevation and target conflicts before invoking restore', async () => {
  const original = pendingTimingEntry(
    timing.TIMING_ACTIONS.RESTORE_AUTOMATIC_CLOCK_SOURCE,
    bootState({ usePlatformClock: 'YES' })
  );
  original.status = 'SUCCESS';
  const directory = createUserData([original]);
  let restores = 0;
  await assert.rejects(journal.rollbackAuditEntry(directory, original.id, {
    isCurrentProcessElevated: async () => false,
    restoreBootTimingAction: async () => { restores += 1; },
  }), /running as administrator/);
  await assert.rejects(journal.rollbackAuditEntry(directory, original.id, {
    isCurrentProcessElevated: async () => true,
    readBootTimingState: async () => bootState({ usePlatformClock: 'NO' }),
    restoreBootTimingAction: async () => { restores += 1; },
  }), /Rollback was refused/);
  assert.equal(restores, 0);
  assert.equal(journal.readJournal(directory).length, 1);
});

test('game guidance catalog is deeply immutable, clone-safe, source-linked, and guidance-only', () => {
  const catalog = gameSettings.GAME_SETTINGS_GUIDES;
  assert.equal(Object.isFrozen(catalog), true);
  assert.equal(Object.isFrozen(catalog[0]), true);
  assert.equal(Object.isFrozen(catalog[0].settings), true);
  assert.equal(Object.isFrozen(catalog[0].settings[0]), true);

  const first = gameSettings.listGameSettingsGuides();
  first[0].settings[0].recommendation = 'mutated fixture';
  const second = gameSettings.listGameSettingsGuides();
  assert.notEqual(second[0].settings[0].recommendation, 'mutated fixture');
  assert.ok(second.length >= 5);
  assert.equal(new Set(second.map((guide) => guide.id)).size, second.length);
  assert.equal(new Set(second.map((guide) => guide.game)).size, second.length);
  const allowedFirstPartyHosts = new Set(['www.epicgames.com', 'help.ea.com', 'help.steampowered.com', 'playvalorant.com', 'support.riotgames.com', 'us.support.blizzard.com', 'www.callofduty.com', 'support.activision.com', 'www.nvidia.com']);
  for (const guide of second) {
    assert.equal(guide.automation, 'GUIDANCE_ONLY');
    assert.ok(guide.settings.length >= 3);
    for (const setting of guide.settings) {
      assert.ok(setting.recommendation);
      assert.ok(setting.rationale);
      assert.ok(setting.tradeoff);
      assert.ok(setting.verification);
    }
    assert.ok(guide.sources.length > 0);
    assert.ok(guide.sources.every((source) => {
      const url = new URL(source.url);
      return url.protocol === 'https:' && allowedFirstPartyHosts.has(url.hostname);
    }));
  }
  assert.equal(second.find((guide) => guide.game === 'Fortnite').settings.length, 5);
  for (const game of ['Rocket League', 'League of Legends', 'Overwatch 2']) assert.ok(second.some((guide) => guide.game === game));
});

test('Black Ops 7 guidance stays manual, version-scoped and refuses copied templates or universal caps', () => {
  const guide = gameSettings.listGameSettingsGuides().find((item) => item.game === 'Call of Duty: Black Ops 7');
  assert.ok(guide);
  assert.equal(guide.automation, 'GUIDANCE_ONLY');
  assert.match(guide.applicability, /does not copy template files/i);
  assert.match(guide.applicability, /does not .*write versioned cod25 files/i);
  assert.match(guide.settings.find((item) => item.id === 'cap-sync-latency').recommendation, /instead of treating Off, 300 or 600 FPS as universal/i);
  assert.match(guide.settings.find((item) => item.id === 'input-audio-boundary').recommendation, /do not copy another player’s sensitivity, polling rate or audio mix/i);
});

test('normal local UI exposes persisted themes and a real sequential optimization runner', () => {
  const root = path.join(__dirname, '..');
  const themesSource = fs.readFileSync(path.join(root, 'src', 'lib', 'themes.ts'), 'utf8');
  const appSource = fs.readFileSync(path.join(root, 'src', 'App.tsx'), 'utf8');
  const catalogSource = fs.readFileSync(path.join(root, 'src', 'components', 'OptimizationCatalog.tsx'), 'utf8');
  for (const theme of ['console', 'instrument']) assert.match(themesSource, new RegExp(`id: '${theme}'`));
  assert.match(appSource, /pcopti-theme:v1/);
  assert.match(appSource, /document\.documentElement\.dataset\.theme = appTheme/);
  assert.match(appSource, /<ThemePicker activeTheme=\{appTheme\}/);
  assert.match(appSource, /dialed-technical-details:v1/);
  assert.match(appSource, /document\.documentElement\.dataset\.technicalDetails/);
  assert.match(appSource, /<TechnicalDetailsSetting enabled=\{technicalDetails\}/);
  assert.match(appSource, /<OptimizationCatalog items=\{batchOptimizationItems\}/);
  assert.match(appSource, /for \(const item of items\)/);
  assert.match(appSource, /disableStartupItem\(item\.targetId\)/);
  assert.match(appSource, /enableProcessEcoQos\(Number\(item\.targetId\),/);
  assert.match(appSource, /executeMaintenance\(item\.targetId\)/);
  assert.match(appSource, /executeTimingExperiment\(item\.targetId/);
  assert.match(appSource, /activeTab === 'startup' \|\| activeTab === 'performance-lab'\) void loadTimingExperiments\(\)/);
  assert.match(appSource, /timingExperiments\.filter\(\(experiment\) => experiment\.actionId\)\.forEach/);
  assert.match(appSource, /category: 'Experimental timing'/);
  assert.match(appSource, /selectable: Boolean\(experiment\.actionId && experiment\.availability === 'APPLICABLE'\)/);
  assert.match(catalogSource, /Not available now/);
  assert.match(catalogSource, /Select all shown/);
  assert.match(appSource, /Open boot timing/);
  assert.match(appSource, /\['timing', 'Boot timing'\]/);
  assert.doesNotMatch(appSource, /\['timing', 'Windows timing'\]/);
  assert.match(catalogSource, /Run selected \(\$\{selectedItems\.length\}\)/);
  assert.match(catalogSource, /optimization-run-log-heading[^>]*>Results</);
  for (const field of ['What changes:', 'Why this appeared:', 'Expected:', 'Undo:', 'How to verify:']) assert.match(catalogSource, new RegExp(field));
  assert.match(appSource, /rollbackMethod/);
  assert.match(appSource, /verificationMethod/);
  assert.match(appSource, /measurableSuccessCriteria/);
  assert.match(catalogSource, /min-w-0 overflow-hidden rounded-xl/);
  assert.match(catalogSource, /\[overflow-wrap:anywhere\]/);
  for (const status of ['RUNNING', 'SUCCESS', 'SKIPPED', 'FAILED', 'NEEDS_REVIEW']) assert.match(catalogSource, new RegExp(`'${status}'`));
  assert.doesNotMatch(catalogSource, /reg\.exe|powershell|bcdedit|Optimize-Volume/i);
});

test('optimization run summaries never report clean completion for partial or mixed outcomes', async () => {
  const { summarizeOptimizationRun } = await import('../src/lib/optimizationRun.js');
  const entry = (status) => ({ status });

  assert.deepEqual(
    summarizeOptimizationRun([entry('SUCCESS'), entry('SUCCESS')], false),
    {
      code: 'SUCCESS', label: 'RUN COMPLETE', tone: 'success', total: 2, finished: 2, unfinished: 0,
      counts: { queued: 0, running: 0, success: 2, skipped: 0, failed: 0, needsReview: 0 },
    }
  );

  const warning = summarizeOptimizationRun([entry('SUCCESS'), entry('SKIPPED'), entry('NEEDS_REVIEW')], false);
  assert.equal(warning.code, 'WARNINGS');
  assert.equal(warning.label, 'COMPLETED WITH WARNINGS');
  assert.equal(warning.counts.skipped, 1);
  assert.equal(warning.counts.needsReview, 1);

  const failed = summarizeOptimizationRun([entry('SUCCESS'), entry('FAILED')], false);
  assert.equal(failed.code, 'FAILURES');
  assert.equal(failed.label, 'COMPLETED WITH FAILURES');
  assert.equal(failed.tone, 'failure');

  const interrupted = summarizeOptimizationRun([entry('SUCCESS'), entry('QUEUED')], false);
  assert.equal(interrupted.code, 'INTERRUPTED');
  assert.equal(interrupted.label, 'RUN INTERRUPTED');
  assert.equal(interrupted.finished, 1);
  assert.equal(interrupted.unfinished, 1);

  const active = summarizeOptimizationRun([entry('RUNNING'), entry('QUEUED')], true);
  assert.equal(active.code, 'RUNNING');
  assert.equal(active.label, 'RUNNING');
});

test('capability and IPC boundaries keep commands main-owned while exposing the full local feature set', () => {
  assert.equal(capabilities.capabilityForAction(timing.TIMING_ACTIONS.RESTORE_AUTOMATIC_CLOCK_SOURCE).id, timing.TIMING_ACTIONS.RESTORE_AUTOMATIC_CLOCK_SOURCE);
  assert.equal(capabilities.capabilityForAction(timing.TIMING_ACTIONS.DISABLE_DYNAMIC_TICK).id, timing.TIMING_ACTIONS.DISABLE_DYNAMIC_TICK);
  assert.equal(capabilities.requireCapability('game:settings-guidance', 'public').id, 'game:settings-guidance');
  assert.equal(capabilities.requireCapability('timing:view-performance-lab', 'public').id, 'timing:view-performance-lab');

  const root = path.join(__dirname, '..');
  const mainSource = fs.readFileSync(path.join(root, 'electron', 'main.cjs'), 'utf8');
  const preloadSource = fs.readFileSync(path.join(root, 'electron', 'preload.cjs'), 'utf8');
  const appSource = fs.readFileSync(path.join(root, 'src', 'App.tsx'), 'utf8');
  const sidebarSource = fs.readFileSync(path.join(root, 'src', 'components', 'Sidebar.tsx'), 'utf8');
  const timingSource = fs.readFileSync(path.join(root, 'src', 'main', 'timing', 'index.cjs'), 'utf8');

  assert.match(mainSource, /assertShortString\(actionId, 'Timing experiment action id', \/\^timing:/);
  assert.match(mainSource, /executeTimingAction\(app\.getPath\('userData'\), actionId\)/);
  assert.match(preloadSource, /executeTimingExperiment: \(actionId\) => ipcRenderer\.invoke\('pc-opti:execute-timing-experiment', actionId\)/);
  assert.doesNotMatch(preloadSource, /useplatformclock|disabledynamictick|bcdedit/i);
  assert.match(timingSource, /\/deletevalue '\{current\}' useplatformclock/);
  assert.match(timingSource, /\/set '\{current\}' disabledynamictick yes/);
  assert.match(appSource, /activeTab === 'startup' && optimizeView === 'timing' && <Suspense[^\n]*<PerformanceLab/);
  assert.doesNotMatch(appSource, /activeTab === 'performance-lab'[^\n]*<PerformanceLab/);
  assert.match(appSource, /capabilityIds\.has\('game:settings-guidance'\)/);
  assert.match(sidebarSource, /label: 'Measure'/);
  assert.match(sidebarSource, /label: 'Games'/);
});
