const fs = require('node:fs');
const path = require('node:path');
const { migrateSystemScanSnapshot, validateSystemScanSnapshot } = require('../snapshot/index.cjs');

const BASELINE_SCHEMA_VERSION = '1.0.0';
const BASELINE_FILE_NAME = 'drift-baseline.json';
const MAX_BASELINE_BYTES = 1024 * 1024;
const MAX_OBSERVATIONS = 64;

function canonicalize(value) {
  if (Array.isArray(value)) {
    return value
      .map(canonicalize)
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

function stableDiagnostic(evidence, select = (value) => value) {
  if (evidence?.status === 'AVAILABLE') {
    return canonicalize({ status: evidence.status, value: select(evidence.value) });
  }
  return { status: String(evidence?.status || 'UNKNOWN') };
}

function stableMetric(evidence, select = (value) => value) {
  if (evidence?.status === 'AVAILABLE') {
    return canonicalize(select(evidence.value));
  }
  return { status: String(evidence?.status || 'UNKNOWN') };
}

function normalizeSnapshot(inputSnapshot) {
  const snapshot = migrateSystemScanSnapshot(inputSnapshot);
  validateSystemScanSnapshot(snapshot);
  const observations = [
    { path: 'metrics.os', label: 'Operating system', value: snapshot.metrics.os },
    { path: 'metrics.cpu', label: 'Processor', value: stableMetric(snapshot.metrics.cpu) },
    { path: 'metrics.memory.totalBytes', label: 'Installed memory', value: stableMetric(snapshot.metrics.memory, ({ totalBytes }) => totalBytes) },
    {
      path: 'metrics.storage',
      label: 'Storage inventory',
      value: stableMetric(snapshot.metrics.storage, (volumes) => volumes.map(({ driveLetter, label, totalBytes, isSSD, trimEnabled }) => ({ driveLetter, label, totalBytes, isSSD, trimEnabled }))),
    },
    { path: 'metrics.startupItems', label: 'Startup inventory', value: snapshot.metrics.startupItems },
    { path: 'diagnostics.graphics', label: 'Graphics adapters', value: stableDiagnostic(snapshot.diagnostics.graphics) },
    { path: 'diagnostics.motherboard', label: 'Motherboard', value: stableDiagnostic(snapshot.diagnostics.motherboard) },
    { path: 'diagnostics.powerScheme', label: 'Active power scheme', value: stableDiagnostic(snapshot.diagnostics.powerScheme) },
    { path: 'diagnostics.hardwareGpuScheduling', label: 'Hardware GPU scheduling', value: stableDiagnostic(snapshot.diagnostics.hardwareGpuScheduling) },
    { path: 'diagnostics.gameDvr', label: 'Game capture settings', value: stableDiagnostic(snapshot.diagnostics.gameDvr) },
    {
      path: 'diagnostics.pageFile',
      label: 'Page-file configuration',
      value: stableDiagnostic(snapshot.diagnostics.pageFile, ({ mode, automaticManaged, settings }) => ({ mode, automaticManaged, settings })),
    },
    { path: 'diagnostics.storageHealth', label: 'Storage health', value: stableDiagnostic(snapshot.diagnostics.storageHealth) },
    {
      path: 'diagnostics.networkAdapters',
      label: 'Physical network adapters',
      value: stableDiagnostic(snapshot.diagnostics.networkAdapters, (adapters) => adapters.map(({ name, interfaceDescription }) => ({ name, interfaceDescription }))),
    },
    { path: 'diagnostics.secureBoot', label: 'Secure Boot', value: stableDiagnostic(snapshot.diagnostics.secureBoot) },
    { path: 'diagnostics.tpm', label: 'TPM', value: stableDiagnostic(snapshot.diagnostics.tpm) },
    { path: 'diagnostics.virtualization', label: 'Virtualization', value: stableDiagnostic(snapshot.diagnostics.virtualization) },
    { path: 'diagnostics.antiCheat', label: 'Installed anti-cheat', value: stableDiagnostic(snapshot.diagnostics.antiCheat) },
  ].map((item) => ({ ...item, value: canonicalize(item.value) }));

  return {
    snapshotTimestamp: snapshot.timestamp,
    deviceHash: snapshot.deviceHash,
    observations,
  };
}

function baselinePath(userDataPath) {
  if (typeof userDataPath !== 'string' || !path.isAbsolute(userDataPath)) {
    throw new Error('Drift baseline storage requires an absolute application-data path.');
  }
  return path.join(userDataPath, BASELINE_FILE_NAME);
}

function validTimestamp(value) {
  return typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value));
}

function validateBaseline(value) {
  if (!value || value.schemaVersion !== BASELINE_SCHEMA_VERSION || !validTimestamp(value.createdAt) || !validTimestamp(value.snapshotTimestamp)) {
    throw new Error('The local drift baseline schema is not valid.');
  }
  if (typeof value.deviceHash !== 'string' || value.deviceHash.length < 8 || value.deviceHash.length > 256) {
    throw new Error('The local drift baseline device identifier is not valid.');
  }
  if (!Array.isArray(value.observations) || value.observations.length === 0 || value.observations.length > MAX_OBSERVATIONS) {
    throw new Error('The local drift baseline observation count is not valid.');
  }
  const paths = new Set();
  for (const item of value.observations) {
    if (!item || typeof item.path !== 'string' || item.path.length > 100 || !/^[a-zA-Z][a-zA-Z0-9.[\]]*$/.test(item.path)) {
      throw new Error('The local drift baseline contains an invalid observation path.');
    }
    if (paths.has(item.path)) throw new Error('The local drift baseline contains duplicate observation paths.');
    paths.add(item.path);
    if (typeof item.label !== 'string' || item.label.length === 0 || item.label.length > 100 || !Object.prototype.hasOwnProperty.call(item, 'value')) {
      throw new Error('The local drift baseline contains an invalid observation.');
    }
  }
  return {
    schemaVersion: BASELINE_SCHEMA_VERSION,
    createdAt: new Date(value.createdAt).toISOString(),
    snapshotTimestamp: new Date(value.snapshotTimestamp).toISOString(),
    deviceHash: value.deviceHash,
    observations: value.observations.map((item) => ({ path: item.path, label: item.label, value: canonicalize(item.value) })),
  };
}

function readBaseline(userDataPath) {
  const filePath = baselinePath(userDataPath);
  if (!fs.existsSync(filePath)) return null;
  const stat = fs.statSync(filePath);
  if (!stat.isFile() || stat.size > MAX_BASELINE_BYTES) throw new Error('The local drift baseline exceeds the supported 1 MB limit.');
  try {
    return validateBaseline(JSON.parse(fs.readFileSync(filePath, 'utf8')));
  } catch (error) {
    throw new Error(`Could not read the local drift baseline: ${error.message}`);
  }
}

function writeBaseline(userDataPath, baseline) {
  const validated = validateBaseline(baseline);
  fs.mkdirSync(userDataPath, { recursive: true });
  const target = baselinePath(userDataPath);
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
  const payload = JSON.stringify(validated, null, 2);
  if (Buffer.byteLength(payload, 'utf8') > MAX_BASELINE_BYTES) throw new Error('The local drift baseline would exceed the supported 1 MB limit.');
  try {
    fs.writeFileSync(temporary, payload, { encoding: 'utf8', flag: 'wx' });
    fs.renameSync(temporary, target);
  } catch (error) {
    try { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); } catch {}
    throw error;
  }
  return validated;
}

function compareObservations(baseline, current) {
  const previousByPath = new Map(baseline.observations.map((item) => [item.path, item]));
  const currentByPath = new Map(current.observations.map((item) => [item.path, item]));
  return [...new Set([...previousByPath.keys(), ...currentByPath.keys()])].sort().flatMap((observationPath) => {
    const before = previousByPath.get(observationPath);
    const after = currentByPath.get(observationPath);
    if (!before) return [{ path: observationPath, label: after.label, kind: 'ADDED', before: null, after: after.value }];
    if (!after) return [{ path: observationPath, label: before.label, kind: 'REMOVED', before: before.value, after: null }];
    if (JSON.stringify(before.value) === JSON.stringify(after.value)) return [];
    return [{ path: observationPath, label: after.label, kind: 'CHANGED', before: before.value, after: after.value }];
  });
}

function buildDriftReport(userDataPath, inputSnapshot) {
  const current = normalizeSnapshot(inputSnapshot);
  const baseline = readBaseline(userDataPath);
  if (!baseline) {
    return { baseline: null, currentSnapshotTimestamp: current.snapshotTimestamp, changes: [] };
  }
  if (baseline.deviceHash !== current.deviceHash) {
    throw new Error('The saved drift baseline belongs to a different Windows device. Replace it only after reviewing the current scan.');
  }
  return {
    baseline: { createdAt: baseline.createdAt, snapshotTimestamp: baseline.snapshotTimestamp },
    currentSnapshotTimestamp: current.snapshotTimestamp,
    changes: compareObservations(baseline, current),
  };
}

function setDriftBaseline(userDataPath, inputSnapshot, now = new Date()) {
  const current = normalizeSnapshot(inputSnapshot);
  writeBaseline(userDataPath, {
    schemaVersion: BASELINE_SCHEMA_VERSION,
    createdAt: now.toISOString(),
    snapshotTimestamp: current.snapshotTimestamp,
    deviceHash: current.deviceHash,
    observations: current.observations,
  });
  return buildDriftReport(userDataPath, inputSnapshot);
}

module.exports = {
  BASELINE_FILE_NAME,
  BASELINE_SCHEMA_VERSION,
  buildDriftReport,
  normalizeSnapshot,
  readBaseline,
  setDriftBaseline,
  validateBaseline,
};
