const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const telemetry = require('../src/main/telemetry/index.cjs');

const LUID = '0x00000000_0x0000d1a3';
const LUID_B = '0x00000000_0x0000e2b4';

function header(adapters = [{ luid: LUID, description: 'Fixture RTX', vendorId: 4318, deviceId: 10000, subSysId: 1, dedicatedVideoMemory: 17179869184, software: false, pnpMatches: 1 }]) {
  return { type: 'header', adapters };
}

function counter(items, st = '0x0') {
  return { st, items };
}

function sample(i, overrides = {}) {
  return {
    type: 'sample',
    i,
    tMs: i * 1000,
    target: overrides.target || 'OK',
    c: {
      cpuUtility: counter([['_Total', 0, 40 + i]]),
      cpuPerformance: counter([['_Total', 0, 110]]),
      cpuFrequency: counter([['_Total', 0, 4700]]),
      cpuLimit: counter([['_Total', 0, 100]]),
      memAvailable: counter([['', 0, 8e9]]),
      gpuEngine: counter(overrides.engines || [
        [`pid_100_luid_${LUID}_phys_0_eng_0_engtype_3D`, 0, 50],
        [`pid_200_luid_${LUID}_phys_0_eng_0_engtype_3D`, 0, 70],
        [`pid_100_luid_${LUID}_phys_0_eng_3_engtype_VideoDecode`, 0, 90],
      ]),
      gpuDedicated: counter([[`luid_${LUID}_phys_0`, 0, 4e9]]),
      gpuShared: counter([[`luid_${LUID}_phys_0`, 0, 2e8]]),
      gpuProcessDedicated: counter([[`pid_100_luid_${LUID}_phys_0`, 0, 3e9]]),
      ...overrides.counters,
    },
  };
}

test('instance names parse into process, adapter LUID, physical adapter and engine', () => {
  assert.deepEqual(telemetry.parseEngineInstance(`pid_4242_luid_0x00000000_0x0000D1A3_phys_1_eng_12_engtype_3D`), { pid: 4242, luid: LUID, phys: 1, eng: 12, engtype: '3D' });
  assert.deepEqual(telemetry.parseAdapterMemoryInstance(`luid_${LUID}_phys_0`), { luid: LUID, phys: 0 });
  assert.deepEqual(telemetry.parseProcessMemoryInstance(`pid_7_luid_${LUID}_phys_0`), { pid: 7, luid: LUID, phys: 0 });
  assert.equal(telemetry.parseEngineInstance('garbage'), null);
});

test('the first sample warms up rate counters, engines sum per engine clamped to 100, and engines are never summed together', () => {
  const aggregator = telemetry.createTelemetryAggregator({ targetPid: 100 });
  aggregator.ingest(header());
  aggregator.ingest(sample(0));
  aggregator.ingest(sample(1));
  const series = aggregator.finish('COMPLETE');
  const [first, second] = series.points;
  assert.equal(first.cpu.utilityPercent.s, 'WARMING_UP');
  assert.equal(first.cpu.frequencyMhz.s, 'OK');
  assert.equal(first.gpu.gpu0.threeDPercent.s, 'WARMING_UP');
  assert.equal(first.gpu.gpu0.dedicatedUsageBytes.s, 'OK');
  assert.deepEqual(second.gpu.gpu0.threeDPercent, { s: 'OK', v: 100 }, '50 + 70 on the same 3D engine clamps to 100');
  assert.deepEqual(second.gpu.gpu0.busiestEnginePercent, { s: 'OK', v: 100 }, 'busiest is the max engine, not 100 + 90');
  assert.equal(second.cpu.performancePercent.v, 110, 'values above 100 are kept');
  assert.deepEqual(second.gpu.gpu0.targetDedicatedBytes, { s: 'OK', v: 3e9 });
  assert.equal(series.adapters[0].identity, 'VERIFIED');
  assert.equal(series.adapters[0].label, 'Fixture RTX');
  assert.equal(series.status, 'RECORDED');
});

test('GPU engines that need a second collection are counted as warm-up, not missing, but only at the start', () => {
  const invalid = [[`pid_100_luid_${LUID}_phys_0_eng_0_engtype_3D`, -1073738810, 0]];
  const valid = [[`pid_100_luid_${LUID}_phys_0_eng_0_engtype_3D`, 0, 30]];
  const aggregator = telemetry.createTelemetryAggregator();
  aggregator.ingest(header());
  aggregator.ingest(sample(0, { engines: invalid }));
  aggregator.ingest(sample(1, { engines: invalid }));
  aggregator.ingest(sample(2, { engines: valid }));
  aggregator.ingest(sample(3, { engines: invalid }));
  const series = aggregator.finish('COMPLETE');
  assert.deepEqual(series.points.map((point) => point.gpu.gpu0.threeDPercent.s), ['WARMING_UP', 'WARMING_UP', 'OK', 'STALE']);
  const stat = series.summary.metrics['gpu.gpu0.threeDPercent'];
  assert.deepEqual([stat.count, stat.warmup, stat.stale, stat.unavailable], [1, 2, 1, 0]);

  const neverValid = telemetry.createTelemetryAggregator();
  neverValid.ingest(header());
  for (let i = 0; i < 5; i += 1) neverValid.ingest(sample(i, { engines: invalid }));
  assert.deepEqual(neverValid.finish('COMPLETE').points.map((point) => point.gpu.gpu0.threeDPercent.s), ['WARMING_UP', 'WARMING_UP', 'WARMING_UP', 'UNAVAILABLE', 'UNAVAILABLE']);
});

test('a newly appearing process instance is excluded for its first interval', () => {
  const aggregator = telemetry.createTelemetryAggregator();
  aggregator.ingest(header());
  aggregator.ingest(sample(0, { engines: [[`pid_100_luid_${LUID}_phys_0_eng_0_engtype_3D`, 0, 20]] }));
  aggregator.ingest(sample(1, { engines: [[`pid_100_luid_${LUID}_phys_0_eng_0_engtype_3D`, 0, 20], [`pid_300_luid_${LUID}_phys_0_eng_0_engtype_3D`, 0, 60]] }));
  aggregator.ingest(sample(2, { engines: [[`pid_100_luid_${LUID}_phys_0_eng_0_engtype_3D`, 0, 20], [`pid_300_luid_${LUID}_phys_0_eng_0_engtype_3D`, 0, 60]] }));
  const { points } = aggregator.finish('COMPLETE');
  assert.equal(points[1].gpu.gpu0.threeDPercent.v, 20);
  assert.equal(points[2].gpu.gpu0.threeDPercent.v, 80);
});

test('invalid or missing reads become STALE with the last good value, or UNAVAILABLE without one, and never enter aggregates', () => {
  const aggregator = telemetry.createTelemetryAggregator();
  aggregator.ingest(header());
  aggregator.ingest(sample(0));
  aggregator.ingest(sample(1));
  aggregator.ingest(sample(2, { counters: { cpuUtility: counter([['_Total', -2147481648, 99]]), memAvailable: counter([], '0xc0000bc6') } }));
  aggregator.ingest(sample(3, { counters: { cpuFrequency: counter([], '0xc0000bb8') } }));
  const series = aggregator.finish('COMPLETE');
  assert.deepEqual(series.points[2].cpu.utilityPercent, { s: 'STALE', v: 41 });
  assert.equal(series.points[2].memory.availableBytes.s, 'STALE');
  const utility = series.summary.metrics['cpu.utilityPercent'];
  assert.equal(utility.count, 2);
  assert.equal(utility.stale, 1);
  assert.equal(utility.warmup, 1);
  assert.equal(utility.max, 43, 'the stale 41 and the rejected 99 are not counted');
  assert.equal(Math.round(utility.coveragePercent), 67);

  const empty = telemetry.createTelemetryAggregator();
  empty.ingest(header());
  empty.ingest(sample(0, { counters: { cpuFrequency: counter([], '0xc0000bb8') } }));
  assert.deepEqual(empty.finish('COMPLETE').points[0].cpu.frequencyMhz, { s: 'UNAVAILABLE', v: null });
});

test('a target process identity change stops attribution for the rest of the run', () => {
  const aggregator = telemetry.createTelemetryAggregator({ targetPid: 100 });
  aggregator.ingest(header());
  aggregator.ingest(sample(0));
  aggregator.ingest(sample(1, { target: 'CHANGED' }));
  aggregator.ingest(sample(2, { target: 'OK' }));
  const series = aggregator.finish('COMPLETE');
  assert.equal(series.points[0].gpu.gpu0.targetDedicatedBytes.s, 'OK');
  assert.deepEqual(series.points[1].gpu.gpu0.targetDedicatedBytes, { s: 'UNAVAILABLE', v: null });
  assert.deepEqual(series.points[2].gpu.gpu0.targetDedicatedBytes, { s: 'UNAVAILABLE', v: null });
  assert.equal(series.targetChanged, true);
});

test('adapter identity is unavailable for identical GPUs, unmatched PnP records and unknown LUIDs; software adapters are skipped', () => {
  const twin = { description: 'Twin GPU', vendorId: 1, deviceId: 2, subSysId: 3, dedicatedVideoMemory: 8e9, software: false, pnpMatches: 2 };
  const aggregator = telemetry.createTelemetryAggregator();
  aggregator.ingest(header([{ ...twin, luid: LUID }, { ...twin, luid: LUID_B }, { luid: '0x00000000_0x00000001', description: 'Microsoft Basic Render Driver', vendorId: 5140, deviceId: 140, subSysId: 0, dedicatedVideoMemory: 0, software: true, pnpMatches: 0 }]));
  const engines = [[`pid_1_luid_${LUID}_phys_0_eng_0_engtype_3D`, 0, 5], [`pid_1_luid_${LUID_B}_phys_0_eng_0_engtype_3D`, 0, 5], ['pid_1_luid_0x00000000_0x00000001_phys_0_eng_0_engtype_3D', 0, 5], ['pid_1_luid_0x00000000_0x0000ffff_phys_0_eng_0_engtype_3D', 0, 5]];
  aggregator.ingest(sample(0, { engines, counters: { gpuDedicated: counter([]), gpuShared: counter([]), gpuProcessDedicated: counter([]) } }));
  const series = aggregator.finish('SAMPLER_EXITED');
  assert.deepEqual(series.adapters.map((item) => [item.identity, item.label, item.dedicatedCapacityBytes]), [['UNAVAILABLE', 'GPU 1', null], ['UNAVAILABLE', 'GPU 2', null], ['UNAVAILABLE', 'Unidentified GPU 3', null]]);
  assert.equal(series.status, 'FAILED', 'one reading is not a usable series');
  const publicView = telemetry.publicTelemetry(series);
  assert.equal(JSON.stringify(publicView).includes('0x0000'), false, 'no LUID reaches the renderer');
});

test('series are bounded, validate cleanly, and reject tampered values', () => {
  const aggregator = telemetry.createTelemetryAggregator({ maxSamples: 3 });
  aggregator.ingest(header());
  for (let i = 0; i < 10; i += 1) aggregator.ingest(sample(i));
  const series = aggregator.finish('COMPLETE');
  assert.equal(series.points.length, 3);
  assert.doesNotThrow(() => telemetry.validateTelemetrySeries(JSON.parse(JSON.stringify(series))));
  const tampered = JSON.parse(JSON.stringify(series));
  tampered.points[1].cpu.utilityPercent = { s: 'OK', v: null };
  assert.throws(() => telemetry.validateTelemetrySeries(tampered), /missing its value/);
  tampered.points[1].cpu.utilityPercent = { s: 'OK', v: -5 };
  assert.throws(() => telemetry.validateTelemetrySeries(tampered), /invalid value/);
  assert.throws(() => telemetry.validateTelemetrySeries({ ...series, schemaVersion: 'x' }), /unsupported schema/);
  assert.equal(telemetry.createTelemetryAggregator({ maxSamples: 5000 }) && telemetry.MAX_TELEMETRY_SAMPLES, 600);
});

test('the sampler script is read-only, English-counter based and embeds a bounded sample count', () => {
  const script = telemetry.createTelemetrySamplerScript({ samples: 99999, targetPid: 4242 });
  assert.match(script, /\[DialedTelemetry\]::Run\(600, 4242, \$nvmlPath, \$nvmlStatus\)/);
  assert.match(script, /\$nvmlStatus = 'DISABLED'\r?\nif \(\$false\)/, 'NVIDIA sensors are off unless requested');
  const source = Buffer.from(/FromBase64String\('([A-Za-z0-9+/=]+)'\)/.exec(script)[1], 'base64').toString('utf8');
  assert.match(source, /PdhAddEnglishCounter/);
  assert.match(source, /PDH_FMT_NOCAP100|0x00008000/);
  assert.doesNotMatch(`${script}\n${source}`, /PdhSetCounterScaleFactor|logman|Set-Counter|New-Service|reg add|ChangeDisplaySettings|Add-LocalGroupMember/i);
  assert.match(telemetry.createTelemetrySamplerScript({ samples: 3, targetPid: 2 }), /Run\(3, 0, /, 'system PIDs are never targeted');
  // Found on a real Windows PowerShell 5.1 host: enumerating @(... | ConvertFrom-Json) yields the whole array as one item.
  assert.doesNotMatch(script, /@\(\[DialedTelemetry\]::AdaptersJson\(\) \| ConvertFrom-Json\)/);
  assert.match(script, /\$parsedAdapters = \[DialedTelemetry\]::AdaptersJson\(\) \| ConvertFrom-Json[\s\S]*foreach \(\$adapter in \$parsedAdapters\)/);
  assert.match(script, /try \{[\s\S]*AdaptersJson[\s\S]*\} catch \{\s*\$adapters = @\(\)\s*\}[\s\S]*\[DialedTelemetry\]::Run/, 'adapter identity failure cannot stop the readings');
});

test('NVIDIA sensors load only a signature-checked driver nvml.dll from standard paths and declare query functions only', () => {
  const script = telemetry.createTelemetrySamplerScript({ samples: 3, targetPid: 0, vendorSensors: true });
  assert.match(script, /if \(\$true\)/);
  assert.match(script, /Join-Path \$env:SystemRoot 'System32\\nvml\.dll'/);
  assert.match(script, /Join-Path \$env:ProgramFiles 'NVIDIA Corporation\\NVSMI\\nvml\.dll'/);
  assert.match(script, /Get-AuthenticodeSignature -LiteralPath \$item\.FullName/);
  assert.match(script, /\$signature\.Status -eq 'Valid'/);
  assert.match(script, /O=NVIDIA Corporation/);
  assert.match(script, /CN=Microsoft Windows Hardware Compatibility Publisher/);
  assert.match(script, /ReparsePoint/);
  assert.doesNotMatch(script, /nvml[^'\n]*\.dll'[^\n]*(Temp|AppData|Downloads|\$PSScriptRoot)/i);
  const source = Buffer.from(/FromBase64String\('([A-Za-z0-9+/=]+)'\)/.exec(script)[1], 'base64').toString('utf8');
  assert.match(source, /LoadLibraryExW\(path, IntPtr\.Zero, LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR \| LOAD_LIBRARY_SEARCH_SYSTEM32\)/);
  const nvmlImports = [...source.matchAll(/static extern int (nvml\w+)/g)].map((match) => match[1]);
  assert.ok(nvmlImports.length >= 10);
  for (const name of nvmlImports) assert.match(name, /^nvml(Init_v2|Shutdown|SystemGet\w+|DeviceGet\w+)$/, `${name} must be a query`);
  assert.doesNotMatch(source, /nvml\w*(Set|Clear|Reset|Validate|Register)\w*\(/);
});

const NVML_PCI_DEVICE_ID = (10000 * 65536) + 4318;

function nvmlLine(devices = [{ index: 0, name: 'NVIDIA Fixture', pciDeviceId: NVML_PCI_DEVICE_ID, pciSubSystemId: 1 }], status = 'OK') {
  return { type: 'nvml', status, driverVersion: status === 'OK' ? '581.29' : undefined, devices };
}

function nvmlRow(index, { temp = [0, 65], power = [0, 250000], limit = [0, 320000], clock = [0, 2100], memClock = [0, 10500], fan = [3, null], reasons = [0, '0x0'] } = {}) {
  return [index, ...temp, ...power, ...limit, ...clock, ...memClock, ...fan, ...reasons];
}

test('NVIDIA sensors attach to the one matching verified adapter, keep unsupported fields unavailable, and decode slowdown reasons', () => {
  const aggregator = telemetry.createTelemetryAggregator();
  aggregator.ingest(header());
  aggregator.ingest(nvmlLine());
  aggregator.ingest({ ...sample(0), g: [nvmlRow(0, { reasons: [0, '0x60'] })] });
  aggregator.ingest({ ...sample(1), g: [nvmlRow(0, { reasons: [0, '0x4'] })] });
  aggregator.ingest({ ...sample(2), g: [nvmlRow(0, { temp: [999, null], reasons: [0, '0x8'] })] });
  const series = aggregator.finish('COMPLETE');
  assert.equal(series.adapters.length, 1, 'sensors join the Windows adapter instead of adding a second one');
  const [first, second, third] = series.points.map((point) => point.gpu.gpu0);
  assert.deepEqual(first.temperatureC, { s: 'OK', v: 65 });
  assert.deepEqual(first.powerWatts, { s: 'OK', v: 250 });
  assert.deepEqual(first.powerLimitWatts, { s: 'OK', v: 320 });
  assert.deepEqual(first.clockMhz, { s: 'OK', v: 2100 });
  assert.deepEqual(first.fanPercent, { s: 'UNAVAILABLE', v: null }, 'NVML_ERROR_NOT_SUPPORTED is never zero');
  assert.deepEqual([first.thermalSlowdown.v, first.powerLimited.v, first.hardwareSlowdown.v], [1, 0, 0]);
  assert.deepEqual([second.thermalSlowdown.v, second.powerLimited.v], [0, 1]);
  assert.deepEqual(third.temperatureC, { s: 'STALE', v: 65 });
  assert.equal(third.hardwareSlowdown.v, 1);
  assert.equal(series.summary.metrics['gpu.gpu0.thermalSlowdown'].mean, 1 / 3);
  assert.doesNotThrow(() => telemetry.validateTelemetrySeries(JSON.parse(JSON.stringify(series))));
  const publicView = telemetry.publicTelemetry(series);
  assert.deepEqual(publicView.sensors, { source: 'NVML', status: 'OK', driverVersion: '581.29' });
  assert.equal(JSON.stringify(publicView).includes(String(NVML_PCI_DEVICE_ID)), false, 'PCI identifiers are not exposed');
});

test('identical NVIDIA GPUs keep sensors separate, and disabled or old samplers report sensor status without values', () => {
  const twin = { description: 'Twin GPU', vendorId: 4318, deviceId: 10000, subSysId: 1, dedicatedVideoMemory: 8e9, software: false, pnpMatches: 2 };
  const aggregator = telemetry.createTelemetryAggregator();
  aggregator.ingest(header([{ ...twin, luid: LUID }, { ...twin, luid: LUID_B }]));
  aggregator.ingest(nvmlLine([{ index: 0, name: 'NVIDIA Twin', pciDeviceId: NVML_PCI_DEVICE_ID, pciSubSystemId: 1 }, { index: 1, name: 'NVIDIA Twin', pciDeviceId: NVML_PCI_DEVICE_ID, pciSubSystemId: 1 }]));
  const engines = [[`pid_1_luid_${LUID}_phys_0_eng_0_engtype_3D`, 0, 5]];
  aggregator.ingest({ ...sample(0, { engines, counters: { gpuDedicated: counter([]), gpuShared: counter([]), gpuProcessDedicated: counter([]) } }), g: [nvmlRow(0), nvmlRow(1)] });
  aggregator.ingest({ ...sample(1, { engines, counters: { gpuDedicated: counter([]), gpuShared: counter([]), gpuProcessDedicated: counter([]) } }), g: [nvmlRow(0), nvmlRow(1)] });
  const series = aggregator.finish('COMPLETE');
  const sensorAdapters = series.adapters.filter((adapter) => adapter.sensorsOnly);
  assert.deepEqual(sensorAdapters.map((adapter) => [adapter.label, adapter.identity]), [['NVIDIA sensors 1', 'UNAVAILABLE'], ['NVIDIA sensors 2', 'UNAVAILABLE']]);
  const pdhAdapter = series.adapters.find((adapter) => !adapter.sensorsOnly);
  assert.equal('temperatureC' in series.points[1].gpu[pdhAdapter.id], false, 'unmatched sensors never attach to a guessed Windows adapter');
  const sensorPoint = series.points[1].gpu[sensorAdapters[0].id];
  assert.deepEqual(Object.keys(sensorPoint).sort(), ['clockMhz', 'fanPercent', 'hardwareSlowdown', 'memoryClockMhz', 'powerLimitWatts', 'powerLimited', 'powerWatts', 'temperatureC', 'thermalSlowdown']);

  for (const [lines, expected] of [[[nvmlLine([], 'DISABLED')], 'DISABLED'], [[nvmlLine([], 'SIGNATURE_REJECTED')], 'SIGNATURE_REJECTED'], [[], 'NOT_REPORTED']]) {
    const plain = telemetry.createTelemetryAggregator();
    plain.ingest(header());
    for (const line of lines) plain.ingest(line);
    plain.ingest(sample(0));
    plain.ingest(sample(1));
    const result = plain.finish('COMPLETE');
    assert.equal(result.sensors.status, expected);
    assert.equal('temperatureC' in result.points[1].gpu.gpu0, false);
  }
});

function samplerFixture() {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.killed = false;
  child.kill = () => { child.killed = true; return true; };
  return child;
}

test('a session streams lines, stops at its sample count, and always resolves even when the sampler fails', async () => {
  let child;
  const session = telemetry.startTelemetrySession({ samples: 3, targetPid: 100 }, { spawnProcess: () => { child = samplerFixture(); return child; } });
  child.stdout.write(`${JSON.stringify(header())}\n${JSON.stringify(sample(0))}\n`);
  child.stdout.write(`${JSON.stringify(sample(1)).slice(0, 20)}`);
  child.stdout.write(`${JSON.stringify(sample(1)).slice(20)}\nnot json\n${JSON.stringify(sample(2))}\n`);
  const series = await session.result;
  assert.equal(series.points.length, 3);
  assert.equal(series.stopReason, 'COMPLETE');
  assert.equal(child.killed, true);
  assert.equal(series.errors.length, 1);

  const stopped = telemetry.startTelemetrySession({ samples: 30 }, { spawnProcess: () => { child = samplerFixture(); return child; } });
  child.stdout.write(`${JSON.stringify(header())}\n${JSON.stringify(sample(0))}\n${JSON.stringify(sample(1))}\n`);
  await new Promise((resolve) => setImmediate(resolve));
  stopped.stop('CAPTURE_FINISHED');
  const partial = await stopped.result;
  assert.equal(partial.status, 'RECORDED');
  assert.equal(partial.stopReason, 'CAPTURE_FINISHED');

  const failed = telemetry.startTelemetrySession({ samples: 5 }, { spawnProcess: () => { throw new Error('spawn blocked'); } });
  const failure = await failed.result;
  assert.equal(failure.status, 'FAILED');
  assert.match(failure.errors[0], /spawn blocked/);

  const exited = telemetry.startTelemetrySession({ samples: 5 }, { spawnProcess: () => { child = samplerFixture(); return child; } });
  child.emit('close', 1);
  assert.equal((await exited.result).stopReason, 'SAMPLER_EXITED');
});

test('live hardware reading returns a redacted summary and the latest reading', async () => {
  const reading = await telemetry.readLiveHardware({
    startTelemetrySession: ({ samples, targetPid }) => {
      assert.equal(samples, telemetry.LIVE_READING_SAMPLES);
      assert.equal(targetPid, 0);
      const aggregator = telemetry.createTelemetryAggregator();
      aggregator.ingest(header());
      for (let i = 0; i < samples; i += 1) aggregator.ingest(sample(i));
      return { stop: () => undefined, result: Promise.resolve(aggregator.finish('COMPLETE')) };
    },
  });
  assert.equal(reading.status, 'RECORDED');
  assert.equal(reading.summary.samples, 6);
  assert.equal(reading.latest.cpu.utilityPercent.v, 45);
  assert.equal(reading.adapters[0].label, 'Fixture RTX');
  assert.equal('luid' in reading.adapters[0], false);
});

test('CPU speed is base clock times performance, for the all-core average and the fastest core', () => {
  // Processor Frequency is the rated base clock and never moves; Task Manager's speed is
  // base x % Processor Performance. A game's main thread sees the fastest core, which an
  // all-core average hides.
  const aggregator = telemetry.createTelemetryAggregator();
  aggregator.ingest(header());
  const perCore = counter([['_Total', 0, 100], ['0,0', 0, 95], ['0,1', 0, 110], ['0,_Total', 0, 100], ['0,2', 1, 90]]);
  aggregator.ingest(sample(0, { counters: { cpuPerformance: perCore } }));
  aggregator.ingest(sample(1, { counters: { cpuPerformance: perCore } }));
  const [first, second] = aggregator.finish('COMPLETE').points;
  assert.equal(first.cpu.effectiveMhz.s, 'WARMING_UP', 'a rate counter needs two readings');
  assert.equal(first.cpu.fastestCoreMhz.s, 'WARMING_UP');
  assert.deepEqual(second.cpu.effectiveMhz, { s: 'OK', v: 4700 }, '4700 base x 100%');
  assert.deepEqual(second.cpu.fastestCoreMhz, { s: 'OK', v: 5170 }, 'fastest real core is 110%, and _Total rows are never counted as a core');
});

test('without per-core readings, the fastest core is unavailable rather than guessed', () => {
  const aggregator = telemetry.createTelemetryAggregator();
  aggregator.ingest(header());
  aggregator.ingest(sample(0));
  aggregator.ingest(sample(1));
  assert.equal(aggregator.finish('COMPLETE').points[1].cpu.fastestCoreMhz.s, 'UNAVAILABLE');
});

test('a live reading accepts only the offered lengths', async () => {
  const lengths = [];
  const fake = (seconds) => telemetry.readLiveHardware({
    startTelemetrySession: ({ samples }) => { lengths.push(samples); return { result: Promise.resolve({ schemaVersion: telemetry.TELEMETRY_SCHEMA_VERSION, status: 'FAILED', points: [], adapters: [], errors: ['fixture'], sensors: null }) }; },
  }, { seconds });
  for (const seconds of [5, 15, 30, 999, undefined]) { try { await fake(seconds); } catch { /* the fixture series is empty */ } }
  assert.deepEqual(lengths, [telemetry.LIVE_READING_SAMPLES, 16, 31, telemetry.LIVE_READING_SAMPLES, telemetry.LIVE_READING_SAMPLES]);
});
