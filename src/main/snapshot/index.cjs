const SNAPSHOT_SCHEMA_VERSION = '1.3.0';
const EVIDENCE_STATUSES = Object.freeze([
  'AVAILABLE',
  'UNKNOWN',
  'UNSUPPORTED',
  'PERMISSION_REQUIRED',
]);

function unavailableEvidence(status, reason, source = '') {
  if (!EVIDENCE_STATUSES.includes(status) || status === 'AVAILABLE') {
    throw new Error(`Invalid unavailable evidence status: ${status}`);
  }
  return {
    status,
    reason: String(reason || 'Windows did not return this evidence.'),
    source: String(source || ''),
  };
}

function availableEvidence(value, source) {
  if (value === undefined || value === null) {
    throw new Error('Available evidence must contain a value.');
  }
  return {
    status: 'AVAILABLE',
    value,
    source: String(source || ''),
  };
}

function legacyDiagnostics() {
  const reason = 'This field was not collected by SystemScanSnapshot schema 1.0.0. Run a new scan.';
  return {
    graphics: unavailableEvidence('UNKNOWN', reason, 'Schema migration'),
    motherboard: unavailableEvidence('UNKNOWN', reason, 'Schema migration'),
    powerScheme: unavailableEvidence('UNKNOWN', reason, 'Schema migration'),
    hardwareGpuScheduling: unavailableEvidence('UNKNOWN', reason, 'Schema migration'),
    gameDvr: unavailableEvidence('UNKNOWN', reason, 'Schema migration'),
    pageFile: unavailableEvidence('UNKNOWN', reason, 'Schema migration'),
    storageHealth: unavailableEvidence('UNKNOWN', reason, 'Schema migration'),
    networkAdapters: unavailableEvidence('UNKNOWN', reason, 'Schema migration'),
    secureBoot: unavailableEvidence('UNKNOWN', reason, 'Schema migration'),
    tpm: unavailableEvidence('UNKNOWN', reason, 'Schema migration'),
    virtualization: unavailableEvidence('UNKNOWN', reason, 'Schema migration'),
  };
}

function legacyAntiCheat(schemaVersion) {
  const reason = `This field was not collected by SystemScanSnapshot schema ${schemaVersion}. Run a new scan.`;
  return unavailableEvidence('UNKNOWN', reason, 'Schema migration');
}

function diagnosticFields() {
  return {
    ...legacyDiagnostics(),
    antiCheat: legacyAntiCheat('1.1.0'),
  };
}

function migrateMetricEvidence(snapshot, field, component, sourceSchemaVersion) {
  const matchingErrors = Array.isArray(snapshot.metadata?.errors)
    ? snapshot.metadata.errors.filter((error) => error?.component === component)
    : [];
  if (matchingErrors.length > 0) {
    return unavailableEvidence(
      'UNKNOWN',
      `The ${component} query failed in SystemScanSnapshot schema ${sourceSchemaVersion}: ${matchingErrors.map((error) => String(error.message || 'unknown error')).join('; ')}`,
      'Schema migration',
    );
  }
  return availableEvidence(snapshot.metrics[field], `SystemScanSnapshot schema ${sourceSchemaVersion}`);
}

function migrateSystemScanSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') {
    throw new Error('SystemScanSnapshot must be an object.');
  }
  if (snapshot.schemaVersion === SNAPSHOT_SCHEMA_VERSION) {
    validateSystemScanSnapshot(snapshot);
    return snapshot;
  }
  const sourceSchemaVersion = snapshot.schemaVersion;
  if (!['1.0.0', '1.1.0', '1.2.0'].includes(sourceSchemaVersion)) {
    throw new Error(`Unsupported SystemScanSnapshot schema: ${String(snapshot.schemaVersion || 'missing')}`);
  }
  const migrated = {
    ...snapshot,
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    metrics: {
      ...snapshot.metrics,
      cpu: migrateMetricEvidence(snapshot, 'cpu', 'cpu', sourceSchemaVersion),
      memory: migrateMetricEvidence(snapshot, 'memory', 'system', sourceSchemaVersion),
      storage: migrateMetricEvidence(snapshot, 'storage', 'storage', sourceSchemaVersion),
    },
    diagnostics: sourceSchemaVersion === '1.0.0'
      ? { ...legacyDiagnostics(), antiCheat: legacyAntiCheat(sourceSchemaVersion) }
      : sourceSchemaVersion === '1.1.0'
        ? { ...snapshot.diagnostics, antiCheat: legacyAntiCheat(sourceSchemaVersion) }
        : snapshot.diagnostics,
    metadata: {
      ...snapshot.metadata,
      migratedFromSchemaVersion: sourceSchemaVersion,
    },
  };
  validateSystemScanSnapshot(migrated);
  return migrated;
}

function assertEvidence(path, evidence) {
  if (!evidence || typeof evidence !== 'object' || !EVIDENCE_STATUSES.includes(evidence.status)) {
    throw new Error(`SystemScanSnapshot ${path} has an invalid evidence status.`);
  }
  if (typeof evidence.source !== 'string') {
    throw new Error(`SystemScanSnapshot ${path} must identify its source.`);
  }
  if (evidence.status === 'AVAILABLE') {
    if (!Object.prototype.hasOwnProperty.call(evidence, 'value') || evidence.value === null || evidence.value === undefined) {
      throw new Error(`SystemScanSnapshot ${path} is available without a value.`);
    }
    if (Object.prototype.hasOwnProperty.call(evidence, 'reason')) {
      throw new Error(`SystemScanSnapshot ${path} cannot include an unavailable reason when available.`);
    }
  } else {
    if (typeof evidence.reason !== 'string' || !evidence.reason.trim()) {
      throw new Error(`SystemScanSnapshot ${path} must explain why evidence is unavailable.`);
    }
    if (Object.prototype.hasOwnProperty.call(evidence, 'value')) {
      throw new Error(`SystemScanSnapshot ${path} cannot substitute a value when unavailable.`);
    }
  }
}

function validateSystemScanSnapshot(snapshot) {
  if (!snapshot || snapshot.schemaVersion !== SNAPSHOT_SCHEMA_VERSION) {
    throw new Error(`SystemScanSnapshot schema ${SNAPSHOT_SCHEMA_VERSION} is required.`);
  }
  if (!snapshot.metrics || !snapshot.metadata || !snapshot.diagnostics) {
    throw new Error('SystemScanSnapshot is missing metrics, diagnostics, or metadata.');
  }
  if (!Array.isArray(snapshot.metadata.errors)) {
    throw new Error('SystemScanSnapshot metadata.errors must be an array.');
  }
  for (const field of ['cpu', 'memory', 'storage']) {
    assertEvidence(`metrics.${field}`, snapshot.metrics[field]);
  }
  for (const field of Object.keys(diagnosticFields())) {
    assertEvidence(`diagnostics.${field}`, snapshot.diagnostics[field]);
  }
  return true;
}

module.exports = {
  EVIDENCE_STATUSES,
  SNAPSHOT_SCHEMA_VERSION,
  availableEvidence,
  legacyDiagnostics,
  migrateSystemScanSnapshot,
  unavailableEvidence,
  validateSystemScanSnapshot,
};
