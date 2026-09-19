const assert = require('node:assert/strict');
const { tempDir } = require('./helpers/temp-dir.cjs');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PassThrough } = require('node:stream');
const { test } = require('node:test');

const presentMon = require('../src/main/presentmon/index.cjs');

const ROOT = path.join(__dirname, '..');
const TOOL_OPTIONS = { appRoot: ROOT, isPackaged: false, resourcesPath: '' };
const VERIFIED_DEPENDENCIES = {
  readSignature: async () => ({ status: 'Valid', signerSubject: presentMon.PRESENTMON_RELEASE.signerSubject, timestampSubject: 'CN=Fixture Timestamp' }),
  readVersion: async () => presentMon.PRESENTMON_RELEASE.version,
};

function childProcessFixture() {
  const child = new EventEmitter();
  child.stderr = new PassThrough();
  child.kill = () => true;
  return child;
}

function processInventory() {
  return [{ pid: 4242, name: 'FixtureGame', windowTitle: 'Fixture Game', startedAt: '2026-08-29T12:00:00.000Z', sessionId: 1 }];
}

function csvFixture() {
  return [
    'Application,ProcessID,FrameTime',
    'FixtureGame.exe,4242,10.0',
    'FixtureGame.exe,4242,11.0',
    'FixtureGame.exe,4242,9.0',
    'FixtureGame.exe,4242,10.5',
  ].join('\n');
}

test('vendored PresentMon release and MIT license match pinned hashes and packaging configuration', () => {
  const paths = presentMon.toolPaths(TOOL_OPTIONS);
  assert.equal(presentMon.sha256File(paths.executablePath), presentMon.PRESENTMON_RELEASE.sha256);
  assert.equal(presentMon.sha256File(paths.licensePath), presentMon.PRESENTMON_RELEASE.licenseSha256);
  assert.equal(fs.statSync(paths.executablePath).size, presentMon.PRESENTMON_RELEASE.bytes);
  assert.match(fs.readFileSync(paths.licensePath, 'utf8'), /Permission is hereby granted, free of charge/);
  const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.ok(packageJson.build.files.includes('!src/main/presentmon/vendor/**/*'));
  assert.ok(packageJson.build.extraResources.some((entry) => entry.from === 'src/main/presentmon/vendor' && entry.to === 'presentmon'));
});

test('PresentMon verification requires exact size, SHA-256, license, Intel signature, timestamp, and version', async () => {
  const verified = await presentMon.verifyPresentMonTool(TOOL_OPTIONS, VERIFIED_DEPENDENCIES);
  assert.equal(verified.version, '2.5.1');
  assert.equal(verified.sha256, presentMon.PRESENTMON_RELEASE.sha256);
  assert.equal(verified.signerSubject, presentMon.PRESENTMON_RELEASE.signerSubject);

  await assert.rejects(presentMon.verifyPresentMonTool(TOOL_OPTIONS, {
    ...VERIFIED_DEPENDENCIES,
    readSignature: async () => ({ status: 'Valid', signerSubject: 'CN=Someone Else', timestampSubject: 'CN=Fixture' }),
  }), /expected valid Intel signature/);
  await assert.rejects(presentMon.verifyPresentMonTool(TOOL_OPTIONS, {
    ...VERIFIED_DEPENDENCIES,
    readVersion: async () => '9.9.9',
  }), /does not match/);
});

test('PresentMon verification fails closed for a missing or same-size tampered bundled binary', async (context) => {
  const missingRoot = tempDir('dialed-presentmon-missing-');
  const missingInfo = await presentMon.inspectPresentMonTool({ appRoot: missingRoot, isPackaged: false, resourcesPath: '' }, VERIFIED_DEPENDENCIES);
  assert.equal(missingInfo.status, 'UNAVAILABLE');
  assert.match(missingInfo.reason, /ENOENT|no such file or directory/i);

  const tamperedRoot = tempDir('dialed-presentmon-tampered-');
  context.after(() => {
    fs.rmSync(missingRoot, { recursive: true, force: true });
    fs.rmSync(tamperedRoot, { recursive: true, force: true });
  });
  const tamperedOptions = { appRoot: tamperedRoot, isPackaged: false, resourcesPath: '' };
  const sourcePaths = presentMon.toolPaths(TOOL_OPTIONS);
  const tamperedPaths = presentMon.toolPaths(tamperedOptions);
  fs.mkdirSync(tamperedPaths.vendorRoot, { recursive: true });
  fs.copyFileSync(sourcePaths.executablePath, tamperedPaths.executablePath);
  fs.copyFileSync(sourcePaths.licensePath, tamperedPaths.licensePath);
  const handle = fs.openSync(tamperedPaths.executablePath, 'r+');
  try {
    const firstByte = Buffer.alloc(1);
    fs.readSync(handle, firstByte, 0, 1, 0);
    firstByte[0] ^= 0xff;
    fs.writeSync(handle, firstByte, 0, 1, 0);
  } finally {
    fs.closeSync(handle);
  }
  assert.equal(fs.statSync(tamperedPaths.executablePath).size, presentMon.PRESENTMON_RELEASE.bytes);
  await assert.rejects(
    presentMon.verifyPresentMonTool(tamperedOptions, VERIFIED_DEPENDENCIES),
    /executable SHA-256 does not match/,
  );
});

test('PresentMon targets exclude protected, anti-cheat, malformed, and background processes', () => {
  const items = presentMon.normalizeTargets([
    ...processInventory(),
    { pid: 12, name: 'vgc', windowTitle: 'Anti-cheat', startedAt: '2026-08-29T12:00:00.000Z' },
    { pid: 13, name: 'explorer', windowTitle: 'Explorer', startedAt: '2026-08-29T12:00:00.000Z' },
    { pid: 14, name: 'Background', windowTitle: '', startedAt: '2026-08-29T12:00:00.000Z' },
    { pid: 15, name: 'bad name', windowTitle: 'Bad', startedAt: '2026-08-29T12:00:00.000Z' },
  ]);
  assert.equal(items.length, 1);
  assert.equal(items[0].name, 'FixtureGame');
  assert.match(items[0].targetId, /^[a-f0-9]{32}$/);
});

test('native capture uses main-owned arguments, finalizes bounded CSV evidence, and refuses later tampering', async () => {
  const directory = tempDir('dialed-presentmon-');
  const captureChildren = [];
  let clock = Date.now();
  const dependencies = {
    now: () => clock,
    monotonicNow: () => clock,
    ...VERIFIED_DEPENDENCIES,
    runPowerShell: async () => ({ stdout: JSON.stringify(processInventory()), stderr: '', exitCode: 0 }),
    spawnProcess: (_executable, args) => {
      const child = childProcessFixture();
      captureChildren.push({ child, args });
      return child;
    },
  };
  const service = presentMon.createPresentMonService({ ...TOOL_OPTIONS, userDataPath: directory }, dependencies);
  const targets = await service.targets();
  const started = await service.start(targets.items[0].targetId, 10);
  assert.equal(started.status, 'RECORDING');
  assert.equal(captureChildren.length, 1);
  const args = captureChildren[0].args;
  assert.deepEqual(args.slice(0, 2), ['--process_id', '4242']);
  assert.ok(args.includes('--terminate_after_timed'));
  assert.ok(args.includes('--terminate_on_proc_exit'));
  assert.ok(args.includes('--v1_metrics'));
  assert.doesNotMatch(args.join(' '), /restart_as_admin|output_stdout|hotkey/i);
  const outputPath = args[args.indexOf('--output_file') + 1];
  assert.equal(outputPath, presentMon.capturePaths(directory, started.captureId).csv);
  fs.writeFileSync(outputPath, csvFixture(), 'utf8');
  clock += 10000;
  captureChildren[0].child.emit('close', 0);
  await new Promise((resolve) => setImmediate(resolve));
  const state = service.state();
  assert.equal(state.active, null);
  assert.equal(state.entries[0].status, 'COMPLETE');
  assert.equal(state.entries[0].applications[0].sampleCount, 4);
  assert.equal(state.entries[0].tool.sha256, presentMon.PRESENTMON_RELEASE.sha256);
  assert.equal(state.entries[0].output.sha256, presentMon.sha256File(outputPath));
  const sources = service.prepareSources([started.captureId, duplicateCapture(directory, state.entries[0])]);
  assert.equal(sources.length, 2);
  assert.ok(sources.every((source) => source.toolVersion === presentMon.PRESENTMON_RELEASE.version));
  const secondManifestPath = presentMon.capturePaths(directory, sources[1].sourceId).manifest;
  const secondManifest = JSON.parse(fs.readFileSync(secondManifestPath, 'utf8'));
  fs.writeFileSync(secondManifestPath, JSON.stringify({ ...secondManifest, durationSeconds: 20 }));
  assert.throws(() => service.prepareSources([started.captureId, sources[1].sourceId]), /durations differ/);
  fs.writeFileSync(secondManifestPath, JSON.stringify(secondManifest));

  fs.appendFileSync(outputPath, '\nFixtureGame.exe,4242,12');
  assert.throws(() => service.prepareSources([started.captureId, sources[1].sourceId]), /changed after capture/);
});

test('an immediate normal process exit cannot become a complete timed capture after a wall-clock jump', async () => {
  const directory = tempDir('dialed-presentmon-early-');
  let wallClock = Date.now();
  let captureChild;
  const service = presentMon.createPresentMonService({ ...TOOL_OPTIONS, userDataPath: directory }, {
    ...VERIFIED_DEPENDENCIES,
    now: () => wallClock,
    monotonicNow: () => 1000,
    runPowerShell: async () => ({ stdout: JSON.stringify(processInventory()), stderr: '', exitCode: 0 }),
    spawnProcess: () => { captureChild = childProcessFixture(); return captureChild; },
  });
  const targets = await service.targets();
  const started = await service.start(targets.items[0].targetId, 10);
  fs.writeFileSync(presentMon.capturePaths(directory, started.captureId).csv, csvFixture());
  wallClock += 60000;
  captureChild.emit('close', 0);
  await new Promise((resolve) => setImmediate(resolve));
  const result = service.state().entries[0];
  assert.equal(result.status, 'NEEDS_REVIEW');
  assert.equal(result.stopReason, 'EARLY_EXIT');
  assert.equal(result.observedDurationSeconds, 0);
  assert.equal(result.protocolComplete, false);
  assert.ok(result.output.sha256);
});

test('stop uses the active main-owned session name and no renderer-supplied command flags', async () => {
  const directory = tempDir('dialed-presentmon-stop-');
  const calls = [];
  let captureChild;
  const dependencies = {
    ...VERIFIED_DEPENDENCIES,
    runPowerShell: async () => ({ stdout: JSON.stringify(processInventory()), stderr: '', exitCode: 0 }),
    spawnProcess: (_executable, args) => {
      calls.push(args);
      const child = childProcessFixture();
      if (args.includes('--terminate_existing_session')) setImmediate(() => child.emit('close', 0));
      else captureChild = child;
      return child;
    },
  };
  const service = presentMon.createPresentMonService({ ...TOOL_OPTIONS, userDataPath: directory }, dependencies);
  const target = (await service.targets()).items[0];
  const started = await service.start(target.targetId, 20);
  const result = await service.stop();
  assert.equal(result.stopped, true);
  const stopArgs = calls.find((args) => args.includes('--terminate_existing_session'));
  assert.deepEqual(stopArgs.slice(0, 2), ['--terminate_existing_session', '--session_name']);
  assert.match(stopArgs[2], /^Dialed_[a-f0-9]{32}$/);
  const outputPath = calls[0][calls[0].indexOf('--output_file') + 1];
  fs.writeFileSync(outputPath, csvFixture(), 'utf8');
  captureChild.emit('close', 1);
  await new Promise((resolve) => setImmediate(resolve));
  const stopped = service.state().entries.find((entry) => entry.captureId === started.captureId);
  assert.equal(stopped.status, 'NEEDS_REVIEW');
  assert.equal(stopped.protocolComplete, false);
  assert.equal(stopped.stopReason, 'USER');
  assert.ok(stopped.observedDurationSeconds < 10);
  assert.throws(() => service.prepareSources([started.captureId, duplicateCapture(directory, stopped)]), /complete/);

});

test('a non-user PresentMon process failure remains needs-review even when a partial CSV parses', async () => {
  const directory = tempDir('dialed-presentmon-error-');
  let captureChild;
  const dependencies = {
    ...VERIFIED_DEPENDENCIES,
    runPowerShell: async () => ({ stdout: JSON.stringify(processInventory()), stderr: '', exitCode: 0 }),
    spawnProcess: () => { captureChild = childProcessFixture(); return captureChild; },
  };
  const service = presentMon.createPresentMonService({ ...TOOL_OPTIONS, userDataPath: directory }, dependencies);
  const target = (await service.targets()).items[0];
  const started = await service.start(target.targetId, 10);
  fs.writeFileSync(presentMon.capturePaths(directory, started.captureId).csv, csvFixture(), 'utf8');
  captureChild.stderr.write('fixture process failure');
  captureChild.emit('close', 9);
  await new Promise((resolve) => setImmediate(resolve));
  const result = service.state().entries.find((entry) => entry.captureId === started.captureId);
  assert.equal(result.status, 'NEEDS_REVIEW');
  assert.equal(result.stopReason, 'PROCESS_ERROR');
  assert.match(result.error, /fixture process failure/);
  assert.throws(() => service.prepareSources([started.captureId, '11111111-1111-4111-8111-111111111111']), /verified complete/);
});

test('native capture deletion previews exact local files, refuses drift, and deletes only after a fresh preview', async () => {
  const directory = tempDir('dialed-presentmon-delete-');
  let captureChild;
  const dependencies = {
    ...VERIFIED_DEPENDENCIES,
    runPowerShell: async () => ({ stdout: JSON.stringify(processInventory()), stderr: '', exitCode: 0 }),
    spawnProcess: () => { captureChild = childProcessFixture(); return captureChild; },
  };
  const service = presentMon.createPresentMonService({ ...TOOL_OPTIONS, userDataPath: directory }, dependencies);
  const target = (await service.targets()).items[0];
  const started = await service.start(target.targetId, 10);
  const paths = presentMon.capturePaths(directory, started.captureId);
  fs.writeFileSync(paths.csv, csvFixture(), 'utf8');
  captureChild.emit('close', 0);
  await new Promise((resolve) => setImmediate(resolve));

  const preview = service.previewDeletion(started.captureId);
  assert.equal(preview.files.length, 2);
  assert.match(preview.consequence, /Permanently deletes/);
  fs.appendFileSync(paths.csv, '\nFixtureGame.exe,4242,12');
  assert.throws(() => service.deleteCapture(preview), /changed after preview/);
  assert.equal(fs.existsSync(paths.csv), true);
  assert.equal(fs.existsSync(paths.manifest), true);

  const fresh = service.previewDeletion(started.captureId);
  const result = service.deleteCapture(fresh);
  assert.equal(result.deleted, true);
  assert.equal(result.entries.length, 0);
  assert.equal(fs.existsSync(paths.csv), false);
  assert.equal(fs.existsSync(paths.manifest), false);
});

test('native capture IPC exposes opaque ids and fixed durations, never executable or output paths', () => {
  const mainSource = fs.readFileSync(path.join(ROOT, 'electron', 'main.cjs'), 'utf8');
  const preloadSource = fs.readFileSync(path.join(ROOT, 'electron', 'preload.cjs'), 'utf8');
  assert.match(mainSource, /\[10, 20, 30\]\.includes\(duration\)/);
  assert.match(mainSource, /presentMonCaptureConsentPreviews\.issue\(preview\)/);
  assert.match(mainSource, /presentMonCaptureConsentPreviews\.take\(token\)/);
  assert.match(mainSource, /presentMonCaptureConsentPreviews\.assertFresh\(pending\)/);
  assert.match(mainSource, /presentMonCaptures\(\)\.start\(pending\.preview\.target\.targetId, pending\.preview\.durationSeconds, \{ hardwareReadings: pending\.preview\.hardwareReadings === true, vendorSensors: pending\.preview\.vendorSensors === true \}\)/);
  assert.match(mainSource, /const withVendorSensors = withHardwareReadings && isCapabilityAvailable\('telemetry:nvidia-gpu-sensors'/);
  assert.match(preloadSource, /previewPresentMonCapture: \(targetId, durationSeconds, hardwareReadings\) => ipcRenderer\.invoke\('pc-opti:preview-presentmon-capture', targetId, durationSeconds, hardwareReadings === true\)/);
  assert.match(preloadSource, /startPresentMonCapture: \(token\)/);
  assert.match(preloadSource, /prepareNativePresentMonImport: \(captureIds\)/);
  assert.match(preloadSource, /deletePresentMonCapture: \(token\)/);
  assert.doesNotMatch(preloadSource, /PresentMon-2\.5\.1|\.exe|output_file|session_name|restart_as_admin/i);
});

function telemetrySeriesFixture(samples, status = 'RECORDED') {
  const telemetry = require('../src/main/telemetry/index.cjs');
  const aggregator = telemetry.createTelemetryAggregator({ targetPid: 4242 });
  if (status === 'FAILED') return aggregator.finish('SAMPLER_EXITED', 'Fixture sampler failure');
  const luid = '0x00000000_0x0000d1a3';
  aggregator.ingest({ type: 'header', adapters: [{ luid, description: 'Fixture GPU', vendorId: 1, deviceId: 2, subSysId: 3, dedicatedVideoMemory: 8e9, software: false, pnpMatches: 1 }] });
  for (let i = 0; i < samples; i += 1) {
    aggregator.ingest({ type: 'sample', i, tMs: i * 1000, target: 'OK', c: {
      cpuUtility: { st: '0x0', items: [['_Total', 0, 30]] },
      gpuEngine: { st: '0x0', items: [[`pid_4242_luid_${luid}_phys_0_eng_0_engtype_3D`, 0, 88]] },
      gpuDedicated: { st: '0x0', items: [[`luid_${luid}_phys_0`, 0, 5e9]] },
    } });
  }
  return aggregator.finish('CAPTURE_FINISHED');
}

async function waitForIdle(service) {
  for (let attempt = 0; attempt < 50 && service.state().active; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 5));
}

test('hardware readings run beside a capture, are saved and deleted with it, and never change the capture result', async () => {
  for (const telemetryStatus of ['RECORDED', 'FAILED']) {
    const directory = tempDir(`dialed-presentmon-telemetry-${telemetryStatus}-`);
    let captureChild;
    const sessions = [];
    let clock = 1000;
    const service = presentMon.createPresentMonService({ ...TOOL_OPTIONS, userDataPath: directory }, {
      ...VERIFIED_DEPENDENCIES,
      now: () => clock,
      monotonicNow: () => clock,
      runPowerShell: async () => ({ stdout: JSON.stringify(processInventory()), stderr: '', exitCode: 0 }),
      spawnProcess: () => { captureChild = childProcessFixture(); return captureChild; },
      startTelemetrySession: (options) => {
        let stopReason = null;
        sessions.push({ options, stop: (reason) => { stopReason = reason; } });
        return { stop: (reason) => { stopReason = reason; }, result: Promise.resolve().then(() => ({ ...telemetrySeriesFixture(options.samples, telemetryStatus), stopReason: stopReason || 'CAPTURE_FINISHED' })) };
      },
    });
    const target = (await service.targets()).items[0];
    const started = await service.start(target.targetId, 10, { hardwareReadings: true, vendorSensors: telemetryStatus === 'RECORDED' });
    assert.deepEqual(sessions[0].options, { samples: 11, targetPid: 4242, vendorSensors: telemetryStatus === 'RECORDED' });
    assert.equal(service.state().active.telemetry.status, 'RECORDING');
    const paths = presentMon.capturePaths(directory, started.captureId);
    fs.writeFileSync(paths.csv, csvFixture(), 'utf8');
    clock += 10000;
    captureChild.emit('close', 0);
    await waitForIdle(service);
    const entry = service.state().entries.find((item) => item.captureId === started.captureId);
    assert.equal(entry.status, 'COMPLETE', 'telemetry never changes the capture outcome');
    assert.equal(entry.protocolComplete, true);
    assert.equal(entry.telemetry.status, telemetryStatus);
    if (telemetryStatus === 'RECORDED') {
      assert.equal(entry.telemetry.view.summary.samples, 11);
      assert.equal(entry.telemetry.view.adapters[0].label, 'Fixture GPU');
      assert.equal(JSON.stringify(entry).includes('0x0000d1a3'), false, 'the renderer view is redacted');
      assert.match(fs.readFileSync(paths.telemetry, 'utf8'), /0x0000d1a3/, 'the local file keeps adapter identity');
      const preview = service.previewDeletion(started.captureId);
      assert.deepEqual(preview.files.map((file) => file.kind).sort(), ['hardware-readings', 'manifest', 'raw-csv']);
      service.deleteCapture(preview);
      assert.equal(fs.existsSync(paths.telemetry), false);
    } else {
      assert.equal(entry.telemetry.view.status, 'FAILED');
      assert.match(entry.telemetry.error, /Fixture sampler failure/);
    }
  }

  const directory = tempDir('dialed-presentmon-no-telemetry-');
  let started = 0;
  const service = presentMon.createPresentMonService({ ...TOOL_OPTIONS, userDataPath: directory }, {
    ...VERIFIED_DEPENDENCIES,
    runPowerShell: async () => ({ stdout: JSON.stringify(processInventory()), stderr: '', exitCode: 0 }),
    spawnProcess: () => childProcessFixture(),
    startTelemetrySession: () => { started += 1; return { stop: () => undefined, result: Promise.resolve(null) }; },
  });
  const capture = await service.start((await service.targets()).items[0].targetId, 10);
  assert.equal(started, 0, 'no sampler runs unless the capture preview requested it');
  assert.equal(capture.telemetry, null);
});

function duplicateCapture(directory, original) {
  const duplicateId = '11111111-1111-4111-8111-111111111111';
  const originalPaths = presentMon.capturePaths(directory, original.captureId);
  const duplicatePaths = presentMon.capturePaths(directory, duplicateId);
  fs.copyFileSync(originalPaths.csv, duplicatePaths.csv);
  const manifest = JSON.parse(fs.readFileSync(originalPaths.manifest, 'utf8'));
  fs.writeFileSync(duplicatePaths.manifest, JSON.stringify({ ...manifest, captureId: duplicateId, output: { ...manifest.output, fileName: path.basename(duplicatePaths.csv) } }), 'utf8');
  return duplicateId;
}
