const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { windowsPowerShellEnvironment } = require('../shared/windows-powershell-env.cjs');

const TELEMETRY_SCHEMA_VERSION = 'dialed-telemetry-1';
const TELEMETRY_INTERVAL_MS = 1000;
const MAX_TELEMETRY_SAMPLES = 600;
const MAX_TELEMETRY_ADAPTERS = 8;
const MAX_LINE_CHARS = 1024 * 1024;
const LIVE_READING_SAMPLES = 6;
const VALID_CSTATUS = new Set([0, 1]); // PDH_CSTATUS_VALID_DATA, PDH_CSTATUS_NEW_DATA
const VALUE_STATUSES = new Set(['OK', 'WARMING_UP', 'STALE', 'UNAVAILABLE']);
const IDENTITY_STATUSES = new Set(['VERIFIED', 'UNAVAILABLE']);
const LUID_PATTERN = '0x[0-9a-f]{8}_0x[0-9a-f]{8}';

const CPU_METRICS = Object.freeze([
  ['utilityPercent', 'cpuUtility', true],
  ['performancePercent', 'cpuPerformance', true],
  ['frequencyMhz', 'cpuFrequency', false],
  ['performanceLimitPercent', 'cpuLimit', true],
]);
const PDH_GPU_METRICS = Object.freeze(['busiestEnginePercent', 'threeDPercent', 'dedicatedUsageBytes', 'sharedUsageBytes', 'targetDedicatedBytes']);
const SENSOR_METRICS = Object.freeze(['temperatureC', 'powerWatts', 'powerLimitWatts', 'clockMhz', 'memoryClockMhz', 'fanPercent', 'thermalSlowdown', 'powerLimited', 'hardwareSlowdown']);
const GPU_METRICS = Object.freeze([...PDH_GPU_METRICS, ...SENSOR_METRICS]);
const SENSOR_STATUSES = new Set(['DISABLED', 'NOT_PRESENT', 'SIGNATURE_REJECTED', 'UNAVAILABLE', 'OK', 'NOT_REPORTED']);
// nvmlClocksEventReasons bits: SW power cap 0x4, HW slowdown 0x8, SW thermal 0x20, HW thermal 0x40, HW power brake 0x80.
const NVML_THERMAL_MASK = 0x60n;
const NVML_POWER_MASK = 0x84n;
const NVML_HARDWARE_SLOWDOWN_MASK = 0x8n;
const GPU_RATE_METRICS = new Set(['busiestEnginePercent', 'threeDPercent']);

const SAMPLER_SOURCE = fs.readFileSync(path.join(__dirname, 'sampler.cs'), 'utf8');

function createTelemetrySamplerScript({ samples, targetPid = 0, vendorSensors = false }) {
  const count = clampSamples(samples);
  const pid = Number.isInteger(targetPid) && targetPid > 4 ? targetPid : 0;
  const source = Buffer.from(SAMPLER_SOURCE, 'utf8').toString('base64');
  // DXGI supplies LUIDs; Win32_VideoController PNPDeviceID only confirms that exactly
  // one controller carries the same vendor, device and subsystem identifiers.
  return `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -TypeDefinition ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${source}')))
$adapters = @()
# Identity failures only leave adapters unidentified; they never stop the readings.
try {
  $controllers = @(Get-CimInstance -ClassName Win32_VideoController -ErrorAction SilentlyContinue | ForEach-Object { [string]$_.PNPDeviceID })
  # Windows PowerShell 5.1 emits a parsed JSON array as one object, so parse before enumerating.
  $parsedAdapters = [DialedTelemetry]::AdaptersJson() | ConvertFrom-Json
  foreach ($adapter in $parsedAdapters) {
    if ($null -eq $adapter) { continue }
    $ven = '{0:X4}' -f [int64]$adapter.vendorId
    $dev = '{0:X4}' -f [int64]$adapter.deviceId
    $sub = '{0:X8}' -f [int64]$adapter.subSysId
    $pnpCount = @($controllers | Where-Object { $_ -match "VEN_$ven&DEV_$dev&SUBSYS_$sub" }).Count
    $adapters += [pscustomobject]@{ luid = [string]$adapter.luid; description = [string]$adapter.description; vendorId = [int64]$adapter.vendorId; deviceId = [int64]$adapter.deviceId; subSysId = [int64]$adapter.subSysId; dedicatedVideoMemory = [double]$adapter.dedicatedVideoMemory; software = [bool]$adapter.software; pnpMatches = [int]$pnpCount }
  }
} catch {
  $adapters = @()
}
[Console]::Out.WriteLine((ConvertTo-Json -InputObject ([pscustomobject]@{ type = 'header'; adapters = @($adapters) }) -Compress -Depth 4))
[Console]::Out.Flush()
# NVIDIA's NVML ships with the NVIDIA driver and is never bundled. It is loaded only from
# the two standard driver locations, only as a regular file, and only with a valid
# NVIDIA or Microsoft hardware-publisher (WHQL) signature.
$nvmlPath = ''
$nvmlStatus = 'DISABLED'
if (${vendorSensors ? '$true' : '$false'}) {
  $nvmlStatus = 'NOT_PRESENT'
  try {
    foreach ($candidate in @((Join-Path $env:SystemRoot 'System32\\nvml.dll'), (Join-Path $env:ProgramFiles 'NVIDIA Corporation\\NVSMI\\nvml.dll'))) {
      $item = Get-Item -LiteralPath $candidate -Force -ErrorAction SilentlyContinue
      if ($null -eq $item -or $item.PSIsContainer -or (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0)) { continue }
      $signature = Get-AuthenticodeSignature -LiteralPath $item.FullName
      $subject = if ($signature.SignerCertificate) { [string]$signature.SignerCertificate.Subject } else { '' }
      if ($signature.Status -eq 'Valid' -and ($subject -match '(^|,\\s*)O=NVIDIA Corporation(,|$)' -or $subject -match '^CN=Microsoft Windows Hardware Compatibility Publisher,')) {
        $nvmlPath = $item.FullName
        $nvmlStatus = 'VERIFIED'
        break
      }
      $nvmlStatus = 'SIGNATURE_REJECTED'
    }
  } catch {
    $nvmlPath = ''
    $nvmlStatus = 'UNAVAILABLE'
  }
}
[DialedTelemetry]::Run(${count}, ${pid}, $nvmlPath, $nvmlStatus)
`;
}

function clampSamples(value) {
  const number = Math.floor(Number(value));
  if (!Number.isFinite(number)) return 2;
  return Math.min(MAX_TELEMETRY_SAMPLES, Math.max(2, number));
}

function normalizeLuid(value) {
  return String(value || '').toLowerCase();
}

function parseEngineInstance(name) {
  const match = new RegExp(`^pid_(\\d+)_luid_(${LUID_PATTERN})_phys_(\\d+)_eng_(\\d+)_engtype_(.*)$`, 'i').exec(String(name || ''));
  if (!match) return null;
  return { pid: Number(match[1]), luid: normalizeLuid(match[2]), phys: Number(match[3]), eng: Number(match[4]), engtype: match[5] };
}

function parseAdapterMemoryInstance(name) {
  const match = new RegExp(`^luid_(${LUID_PATTERN})_phys_(\\d+)$`, 'i').exec(String(name || ''));
  return match ? { luid: normalizeLuid(match[1]), phys: Number(match[2]) } : null;
}

function parseProcessMemoryInstance(name) {
  const match = new RegExp(`^pid_(\\d+)_luid_(${LUID_PATTERN})_phys_(\\d+)$`, 'i').exec(String(name || ''));
  return match ? { pid: Number(match[1]), luid: normalizeLuid(match[2]), phys: Number(match[3]) } : null;
}

function counterItems(sample, key) {
  const entry = sample?.c?.[key];
  if (!entry || entry.st !== '0x0' || !Array.isArray(entry.items)) return null;
  return entry.items.filter((item) => Array.isArray(item) && item.length === 3);
}

function validItemValue(item) {
  return item && VALID_CSTATUS.has(item[1]) && typeof item[2] === 'number' && Number.isFinite(item[2]) && item[2] >= 0;
}

// Builds per-second readings from raw sampler lines. A value is OK only when Windows
// marked it valid in this sample. A failed read keeps the last good value as STALE;
// with no earlier value it is UNAVAILABLE. Nothing is interpolated or zero-filled.
function createTelemetryAggregator({ targetPid = 0, maxSamples = MAX_TELEMETRY_SAMPLES } = {}) {
  const limit = clampSamples(maxSamples);
  const hardware = new Map();
  const adapters = [];
  const points = [];
  const errors = [];
  const lastGood = new Map();
  const seenEngineInstances = new Set();
  const adaptersWithEngineData = new Set();
  const nvmlTargets = new Map();
  const sensorAdapterIds = new Set();
  let sensors = { source: 'NVML', status: 'NOT_REPORTED', driverVersion: null };
  let headerSeen = false;
  let targetChanged = false;

  function resolve(key, ok, value, warming) {
    if (warming) return { s: 'WARMING_UP', v: null };
    if (ok && Number.isFinite(value)) {
      lastGood.set(key, value);
      return { s: 'OK', v: value };
    }
    if (lastGood.has(key)) return { s: 'STALE', v: lastGood.get(key) };
    return { s: 'UNAVAILABLE', v: null };
  }

  function header(line) {
    headerSeen = true;
    const listed = (Array.isArray(line?.adapters) ? line.adapters : []).slice(0, 16).filter((item) => new RegExp(`^${LUID_PATTERN}$`, 'i').test(String(item?.luid || '')));
    for (const item of listed) {
      const sameModel = listed.filter((other) => other.vendorId === item.vendorId && other.deviceId === item.deviceId && other.subSysId === item.subSysId).length;
      hardware.set(normalizeLuid(item.luid), {
        vendorId: Number(item.vendorId),
        deviceId: Number(item.deviceId),
        subSysId: Number(item.subSysId),
        software: item.software === true,
        verified: item.software !== true && Number(item.pnpMatches) === 1 && sameModel === 1,
        description: String(item.description || '').trim().slice(0, 120),
        dedicatedVideoMemory: Number.isFinite(Number(item.dedicatedVideoMemory)) && Number(item.dedicatedVideoMemory) > 0 ? Number(item.dedicatedVideoMemory) : null,
      });
    }
  }

  // NVIDIA sensors are matched to a Windows adapter only when the PCI vendor, device and
  // subsystem identify exactly one verified DXGI adapter and exactly one NVML device.
  // Anything else stays a separate "NVIDIA sensors N" entry rather than a guessed match.
  function nvml(line) {
    const status = SENSOR_STATUSES.has(line?.status) && line.status !== 'NOT_REPORTED' ? line.status : 'UNAVAILABLE';
    sensors = { source: 'NVML', status, driverVersion: status === 'OK' && typeof line.driverVersion === 'string' ? line.driverVersion.trim().slice(0, 40) || null : null };
    if (status !== 'OK') return;
    const devices = (Array.isArray(line.devices) ? line.devices : []).filter((device) => Number.isInteger(device?.index) && device.index >= 0 && device.index < MAX_TELEMETRY_ADAPTERS);
    const identityOf = (device) => (Number.isInteger(device.pciDeviceId) && Number.isInteger(device.pciSubSystemId) ? `${device.pciDeviceId >>> 0}|${device.pciSubSystemId >>> 0}` : null);
    for (const device of devices) {
      const identity = identityOf(device);
      const vendor = identity ? (device.pciDeviceId >>> 0) & 0xffff : null;
      const model = identity ? ((device.pciDeviceId >>> 0) >>> 16) & 0xffff : null;
      const sameNvml = identity ? devices.filter((other) => identityOf(other) === identity).length : 0;
      const matches = identity ? [...hardware].filter(([, info]) => !info.software && info.vendorId === vendor && info.deviceId === model && (info.subSysId >>> 0) === (device.pciSubSystemId >>> 0)) : [];
      nvmlTargets.set(device.index, matches.length === 1 && sameNvml === 1 && matches[0][1].verified ? { luid: matches[0][0], sensorsOnly: false } : { luid: `nvml_${device.index}`, sensorsOnly: true });
    }
  }

  function adapterFor(luid, phys, options = {}) {
    const existing = adapters.find((item) => item.luid === luid && item.phys === phys);
    if (existing) return existing;
    const info = hardware.get(luid);
    if (info?.software || adapters.length >= MAX_TELEMETRY_ADAPTERS) return null;
    if (options.sensorsOnly) {
      const sensorAdapter = { id: `gpu${adapters.length}`, luid, phys, identity: 'UNAVAILABLE', label: `NVIDIA sensors ${options.sensorIndex + 1}`, dedicatedCapacityBytes: null, sensorsOnly: true };
      adapters.push(sensorAdapter);
      return sensorAdapter;
    }
    const verified = Boolean(info?.verified) && adapters.every((item) => item.luid !== luid);
    const adapter = {
      id: `gpu${adapters.length}`,
      luid,
      phys,
      identity: verified ? 'VERIFIED' : 'UNAVAILABLE',
      label: verified ? info.description || `GPU ${adapters.length + 1}` : info ? `GPU ${adapters.length + 1}` : `Unidentified GPU ${adapters.length + 1}`,
      dedicatedCapacityBytes: verified ? info.dedicatedVideoMemory : null,
    };
    adapters.push(adapter);
    return adapter;
  }

  function sample(line) {
    if (points.length >= limit) return null;
    const warming = points.length === 0;
    if (line?.target === 'CHANGED') targetChanged = true;
    const cpu = {};
    for (const [metric, key, rate] of CPU_METRICS) {
      const items = counterItems(line, key);
      const item = items ? items.find((entry) => entry[0] === '_Total') || items[0] : null;
      cpu[metric] = resolve(`cpu.${metric}`, validItemValue(item), item?.[2], rate && warming);
    }
    // "Processor Frequency" is the processor's rated base clock and never moves. The speed
    // Task Manager shows is that base multiplied by "% Processor Performance", so the real
    // speed is derived here per reading, carrying the weaker of the two statuses.
    cpu.effectiveMhz = effectiveSpeed(cpu.frequencyMhz, cpu.performancePercent);
    // The fastest single core. An all-core average hides a game's main thread running near
    // full boost while other cores idle; this is the figure closest to what that thread gets.
    const coreItems = (counterItems(line, 'cpuPerformance') || []).filter((entry) => !/_total/i.test(String(entry[0])) && validItemValue(entry));
    const fastestCore = coreItems.length ? Math.max(...coreItems.map((entry) => entry[2])) : null;
    cpu.fastestCoreMhz = effectiveSpeed(cpu.frequencyMhz, resolve('cpu.fastestCorePerformance', fastestCore !== null, fastestCore, warming));
    const memoryItems = counterItems(line, 'memAvailable');
    const memoryItem = memoryItems ? memoryItems[0] : null;
    const memory = { availableBytes: resolve('memory.availableBytes', validItemValue(memoryItem), memoryItem?.[2], false) };

    const engines = new Map();
    const touched = new Set();
    for (const item of counterItems(line, 'gpuEngine') || []) {
      const parsed = parseEngineInstance(item[0]);
      if (!parsed) continue;
      const adapter = adapterFor(parsed.luid, parsed.phys);
      if (!adapter) continue;
      touched.add(adapter.id);
      const firstAppearance = !seenEngineInstances.has(item[0]);
      if (seenEngineInstances.size < 20000) seenEngineInstances.add(item[0]);
      const engineKey = `${adapter.id}|${parsed.eng}`;
      const engine = engines.get(engineKey) || { adapterId: adapter.id, threeD: /^3d$/i.test(parsed.engtype), sum: 0, known: false };
      engines.set(engineKey, engine);
      // Process instances time-share one physical engine, so they are summed per engine
      // (never across engines). A newly appeared instance has no complete interval yet.
      if (!firstAppearance && validItemValue(item)) {
        engine.sum += item[2];
        engine.known = true;
      }
    }
    const memoryByAdapter = (key) => {
      const values = new Map();
      for (const item of counterItems(line, key) || []) {
        const parsed = parseAdapterMemoryInstance(item[0]);
        const adapter = parsed && adapterFor(parsed.luid, parsed.phys);
        if (!adapter || !validItemValue(item)) continue;
        touched.add(adapter.id);
        values.set(adapter.id, item[2]);
      }
      return values;
    };
    const dedicated = memoryByAdapter('gpuDedicated');
    const shared = memoryByAdapter('gpuShared');
    const targetMemory = new Map();
    if (targetPid > 0 && !targetChanged && line?.target === 'OK') {
      for (const item of counterItems(line, 'gpuProcessDedicated') || []) {
        const parsed = parseProcessMemoryInstance(item[0]);
        if (!parsed || parsed.pid !== targetPid || !validItemValue(item)) continue;
        const adapter = adapterFor(parsed.luid, parsed.phys);
        if (!adapter) continue;
        targetMemory.set(adapter.id, (targetMemory.get(adapter.id) || 0) + item[2]);
      }
    }

    const sensorReadings = new Map();
    for (const row of Array.isArray(line?.g) ? line.g.slice(0, MAX_TELEMETRY_ADAPTERS) : []) {
      // [index, tempCode, °C, powerCode, mW, limitCode, mW, clockCode, MHz, memClockCode, MHz, fanCode, %, reasonCode, "0x…"]
      if (!Array.isArray(row) || row.length !== 15) continue;
      const target = nvmlTargets.get(row[0]);
      if (!target) continue;
      const adapter = target.sensorsOnly
        ? adapterFor(target.luid, 0, { sensorsOnly: true, sensorIndex: row[0] })
        : adapters.find((item) => item.luid === target.luid && !item.sensorsOnly) || adapterFor(target.luid, 0);
      if (!adapter) continue;
      sensorAdapterIds.add(adapter.id);
      // NVML returns 0 only on success; unsupported or failed fields are never read as zero.
      const value = (codeIndex, scale, maximum) => {
        const raw = row[codeIndex + 1];
        return row[codeIndex] === 0 && typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 && raw / scale <= maximum ? raw / scale : null;
      };
      const reasons = row[13] === 0 && typeof row[14] === 'string' && /^0x[0-9a-f]{1,16}$/i.test(row[14]) ? BigInt(row[14]) : null;
      const flag = (mask) => (reasons === null ? null : (reasons & mask) !== 0n ? 1 : 0);
      sensorReadings.set(adapter.id, {
        temperatureC: value(1, 1, 150),
        powerWatts: value(3, 1000, 2000),
        powerLimitWatts: value(5, 1000, 2000),
        clockMhz: value(7, 1, 100000),
        memoryClockMhz: value(9, 1, 100000),
        fanPercent: value(11, 1, 100),
        thermalSlowdown: flag(NVML_THERMAL_MASK),
        powerLimited: flag(NVML_POWER_MASK),
        hardwareSlowdown: flag(NVML_HARDWARE_SLOWDOWN_MASK),
      });
    }
    const sensorReading = (adapter) => {
      if (!sensorAdapterIds.has(adapter.id)) return {};
      const current = sensorReadings.get(adapter.id);
      return Object.fromEntries(SENSOR_METRICS.map((metric) => [metric, resolve(`gpu.${adapter.id}.${metric}`, current?.[metric] !== null && current?.[metric] !== undefined, current?.[metric], false)]));
    };

    const gpu = {};
    for (const adapter of adapters) {
      if (adapter.sensorsOnly) {
        gpu[adapter.id] = sensorReading(adapter);
        continue;
      }
      const known = [...engines.values()].filter((engine) => engine.adapterId === adapter.id && engine.known);
      const busiest = known.length ? Math.max(...known.map((engine) => Math.min(100, engine.sum))) : null;
      const threeD = known.filter((engine) => engine.threeD);
      // Wildcard GPU Engine instances are expanded on the first collection, so Windows can
      // need one more interval before any engine is valid. Until an adapter has produced
      // engine data once, the first three readings count as warm-up rather than missing.
      if (known.length) adaptersWithEngineData.add(adapter.id);
      const engineWarming = warming || (!adaptersWithEngineData.has(adapter.id) && points.length <= 2);
      const reading = {
        busiestEnginePercent: resolve(`gpu.${adapter.id}.busiestEnginePercent`, busiest !== null, busiest, engineWarming && busiest === null),
        threeDPercent: resolve(`gpu.${adapter.id}.threeDPercent`, threeD.length > 0, threeD.length ? Math.max(...threeD.map((engine) => Math.min(100, engine.sum))) : null, engineWarming && threeD.length === 0),
        dedicatedUsageBytes: resolve(`gpu.${adapter.id}.dedicatedUsageBytes`, dedicated.has(adapter.id), dedicated.get(adapter.id), false),
        sharedUsageBytes: resolve(`gpu.${adapter.id}.sharedUsageBytes`, shared.has(adapter.id), shared.get(adapter.id), false),
      };
      if (targetPid > 0) {
        // After a PID mismatch the target metric is never carried forward as stale.
        reading.targetDedicatedBytes = targetChanged ? { s: 'UNAVAILABLE', v: null } : resolve(`gpu.${adapter.id}.targetDedicatedBytes`, targetMemory.has(adapter.id), targetMemory.get(adapter.id), false);
      }
      gpu[adapter.id] = { ...reading, ...sensorReading(adapter) };
    }
    const point = { t: Number.isFinite(Number(line?.tMs)) ? Math.max(0, Number(line.tMs)) : points.length * TELEMETRY_INTERVAL_MS, cpu, memory, gpu };
    points.push(point);
    return point;
  }

  function ingest(line) {
    if (line?.type === 'header') header(line);
    else if (line?.type === 'nvml') nvml(line);
    else if (line?.type === 'sample') sample(line);
  }

  function noteError(message) {
    if (errors.length < 10) errors.push(String(message).slice(0, 300));
  }

  function finish(stopReason, error = null) {
    if (error) noteError(error);
    const status = headerSeen && points.length >= 2 ? 'RECORDED' : 'FAILED';
    const series = {
      schemaVersion: TELEMETRY_SCHEMA_VERSION,
      status,
      stopReason: String(stopReason || 'STOPPED'),
      intervalMs: TELEMETRY_INTERVAL_MS,
      targetTracked: targetPid > 0,
      targetChanged,
      sensors: { ...sensors },
      adapters: adapters.map((adapter) => ({ ...adapter })),
      points,
      errors: status === 'FAILED' && errors.length === 0 ? ['The hardware-reading sampler did not return enough readings.'] : [...errors],
    };
    return { ...series, summary: summarizeTelemetry(series) };
  }

  return { finish, ingest, noteError, sampleCount: () => points.length };
}

function statistic(values, counts) {
  const sorted = [...values].sort((left, right) => left - right);
  const measured = counts.total - counts.warmup;
  if (!sorted.length) return { count: 0, min: null, mean: null, p95: null, max: null, stale: counts.stale, unavailable: counts.unavailable, warmup: counts.warmup, coveragePercent: measured > 0 ? 0 : null };
  return {
    count: sorted.length,
    min: sorted[0],
    mean: sorted.reduce((sum, value) => sum + value, 0) / sorted.length,
    p95: sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(0.95 * sorted.length) - 1))],
    max: sorted[sorted.length - 1],
    stale: counts.stale,
    unavailable: counts.unavailable,
    warmup: counts.warmup,
    coveragePercent: measured > 0 ? (sorted.length / measured) * 100 : null,
  };
}

const STATUS_RANK = Object.freeze({ OK: 0, STALE: 1, WARMING_UP: 2, UNAVAILABLE: 3 });

function effectiveSpeed(base, performance) {
  if (!base || !performance) return { s: 'UNAVAILABLE', v: null };
  const status = STATUS_RANK[base.s] >= STATUS_RANK[performance.s] ? base.s : performance.s;
  if (status === 'WARMING_UP' || status === 'UNAVAILABLE' || base.v === null || performance.v === null) {
    return { s: status === 'OK' || status === 'STALE' ? 'UNAVAILABLE' : status, v: null };
  }
  return { s: status, v: (base.v * performance.v) / 100 };
}

function metricEntries(point, adapters) {
  const entries = [];
  for (const [metric] of CPU_METRICS) entries.push([`cpu.${metric}`, point.cpu?.[metric]]);
  // Optional so captures saved before it existed still validate.
  if (point.cpu?.effectiveMhz) entries.push(['cpu.effectiveMhz', point.cpu.effectiveMhz]);
  if (point.cpu?.fastestCoreMhz) entries.push(['cpu.fastestCoreMhz', point.cpu.fastestCoreMhz]);
  entries.push(['memory.availableBytes', point.memory?.availableBytes]);
  for (const adapter of adapters) {
    for (const metric of GPU_METRICS) if (point.gpu?.[adapter.id]?.[metric]) entries.push([`gpu.${adapter.id}.${metric}`, point.gpu[adapter.id][metric]]);
  }
  return entries;
}

// Only OK values enter aggregates; stale, unavailable and warm-up readings are counted
// separately so coverage stays visible.
function summarizeTelemetry(series) {
  const buckets = new Map();
  for (const point of series.points || []) {
    for (const [key, value] of metricEntries(point, series.adapters || [])) {
      const bucket = buckets.get(key) || { values: [], counts: { total: 0, stale: 0, unavailable: 0, warmup: 0 } };
      buckets.set(key, bucket);
      bucket.counts.total += 1;
      if (value?.s === 'OK') bucket.values.push(value.v);
      else if (value?.s === 'STALE') bucket.counts.stale += 1;
      else if (value?.s === 'WARMING_UP') bucket.counts.warmup += 1;
      else bucket.counts.unavailable += 1;
    }
  }
  const metrics = Object.fromEntries([...buckets].map(([key, bucket]) => [key, statistic(bucket.values, bucket.counts)]));
  const limitValues = buckets.get('cpu.performanceLimitPercent')?.values || [];
  return {
    samples: (series.points || []).length,
    metrics,
    performanceLimitedShare: limitValues.length ? limitValues.filter((value) => value < 100).length / limitValues.length : null,
  };
}

function assertValue(value, label) {
  if (!value || !VALUE_STATUSES.has(value.s)) throw new Error(`${label} has an invalid reading status.`);
  if (value.v === null) {
    if (value.s === 'OK' || value.s === 'STALE') throw new Error(`${label} is missing its value.`);
  } else if (typeof value.v !== 'number' || !Number.isFinite(value.v) || value.v < 0) {
    throw new Error(`${label} has an invalid value.`);
  }
}

function validateTelemetrySeries(series) {
  if (!series || series.schemaVersion !== TELEMETRY_SCHEMA_VERSION) throw new Error('Hardware readings use an unsupported schema.');
  if (!['RECORDED', 'FAILED'].includes(series.status)) throw new Error('Hardware readings have an invalid status.');
  if (!Array.isArray(series.adapters) || series.adapters.length > MAX_TELEMETRY_ADAPTERS) throw new Error('Hardware readings list too many adapters.');
  for (const adapter of series.adapters) {
    if (!/^gpu[0-7]$/.test(adapter?.id) || !IDENTITY_STATUSES.has(adapter.identity) || typeof adapter.label !== 'string' || adapter.label.length > 120) throw new Error('A hardware-reading adapter entry is invalid.');
  }
  if (series.sensors !== undefined && (series.sensors?.source !== 'NVML' || !SENSOR_STATUSES.has(series.sensors.status))) throw new Error('Hardware readings have an invalid sensor status.');
  if (!Array.isArray(series.points) || series.points.length > MAX_TELEMETRY_SAMPLES) throw new Error('Hardware readings exceed the sample limit.');
  series.points.forEach((point, index) => {
    if (typeof point?.t !== 'number' || !Number.isFinite(point.t) || point.t < 0) throw new Error(`Hardware reading ${index} has an invalid time.`);
    for (const [key, value] of metricEntries(point, series.adapters)) assertValue(value, `Hardware reading ${index} ${key}`);
  });
  return series;
}

// Renderer and export view: no LUIDs, device IDs, paths or process identifiers.
function publicTelemetry(series) {
  if (!series) return null;
  return {
    status: series.status,
    stopReason: series.stopReason,
    errors: (series.errors || []).slice(0, 3),
    targetTracked: series.targetTracked === true,
    targetChanged: series.targetChanged === true,
    sensors: series.sensors ? { source: 'NVML', status: series.sensors.status, driverVersion: series.sensors.driverVersion || null } : { source: 'NVML', status: 'NOT_REPORTED', driverVersion: null },
    adapters: (series.adapters || []).map(({ id, label, identity, dedicatedCapacityBytes, sensorsOnly }) => ({ id, label: identity === 'VERIFIED' ? label : label.replace(/^.*?(GPU \d+)$/, '$1'), identity, dedicatedCapacityBytes: identity === 'VERIFIED' ? dedicatedCapacityBytes : null, sensorsOnly: sensorsOnly === true })),
    summary: series.summary || summarizeTelemetry(series),
  };
}

function powershellPath() {
  return `${process.env.SystemRoot || 'C:\\Windows'}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;
}

// Runs one bounded sampler. It always resolves with a series (never rejects), so a
// telemetry failure cannot fail the capture that requested it.
function startTelemetrySession({ samples, targetPid = 0, vendorSensors = false }, dependencies = {}) {
  const count = clampSamples(samples);
  const aggregator = createTelemetryAggregator({ targetPid, maxSamples: count });
  const spawnProcess = dependencies.spawnProcess || spawn;
  let child = null;
  let buffered = '';
  let settled = false;
  let timer = null;
  let resolveResult;
  const result = new Promise((resolve) => { resolveResult = resolve; });

  const finish = (reason, error = null) => {
    if (settled) return;
    settled = true;
    if (timer) clearTimeout(timer);
    try { child?.kill(); } catch { /* the sampler may already have exited */ }
    let series;
    try { series = aggregator.finish(reason, error); } catch (failure) { series = createTelemetryAggregator().finish('SAMPLER_FAILED', failure instanceof Error ? failure.message : String(failure)); }
    resolveResult(series);
  };

  try {
    child = spawnProcess(powershellPath(), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', createTelemetrySamplerScript({ samples: count, targetPid, vendorSensors: vendorSensors === true })], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: windowsPowerShellEnvironment() });
  } catch (error) {
    finish('SAMPLER_FAILED', error instanceof Error ? error.message : 'The hardware-reading sampler could not start.');
    return { stop: () => undefined, result };
  }

  timer = setTimeout(() => finish('TIMEOUT', 'The hardware-reading sampler exceeded its time limit.'), (count + 45) * 1000);
  child.stdout?.on('data', (chunk) => {
    if (settled) return;
    buffered += chunk.toString('utf8');
    let newline;
    while ((newline = buffered.indexOf('\n')) >= 0) {
      const line = buffered.slice(0, newline).trim();
      buffered = buffered.slice(newline + 1);
      if (!line) continue;
      try { aggregator.ingest(JSON.parse(line)); } catch { aggregator.noteError('The sampler returned an unreadable line.'); }
      if (aggregator.sampleCount() >= count) { finish('COMPLETE'); return; }
    }
    if (buffered.length > MAX_LINE_CHARS) finish('SAMPLER_FAILED', 'The hardware-reading sampler output exceeded its line limit.');
  });
  child.stderr?.on('data', (chunk) => aggregator.noteError(chunk.toString('utf8').trim()));
  child.on?.('error', (error) => finish('SAMPLER_FAILED', error instanceof Error ? error.message : String(error)));
  child.on?.('close', () => finish(aggregator.sampleCount() >= count ? 'COMPLETE' : 'SAMPLER_EXITED'));
  return { stop: (reason = 'STOPPED') => finish(reason), result };
}

// Seconds a person may choose for a live reading. The first reading is a warm-up, so one
// extra sample is taken.
const LIVE_READING_SECONDS = Object.freeze([5, 15, 30]);

async function readLiveHardware(dependencies = {}, options = {}) {
  const seconds = LIVE_READING_SECONDS.includes(options.seconds) ? options.seconds : LIVE_READING_SECONDS[0];
  const samples = seconds === LIVE_READING_SECONDS[0] ? LIVE_READING_SAMPLES : seconds + 1;
  const session = (dependencies.startTelemetrySession || startTelemetrySession)({ samples, targetPid: 0, vendorSensors: options.vendorSensors === true }, dependencies);
  const series = await session.result;
  const latest = series.points.length ? series.points[series.points.length - 1] : null;
  return { collectedAt: new Date().toISOString(), ...publicTelemetry(series), latest };
}

module.exports = {
  LIVE_READING_SAMPLES,
  LIVE_READING_SECONDS,
  MAX_TELEMETRY_ADAPTERS,
  MAX_TELEMETRY_SAMPLES,
  TELEMETRY_INTERVAL_MS,
  TELEMETRY_SCHEMA_VERSION,
  createTelemetryAggregator,
  createTelemetrySamplerScript,
  parseAdapterMemoryInstance,
  parseEngineInstance,
  parseProcessMemoryInstance,
  publicTelemetry,
  readLiveHardware,
  startTelemetrySession,
  summarizeTelemetry,
  validateTelemetrySeries,
};
