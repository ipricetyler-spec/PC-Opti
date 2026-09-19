const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const BENCHMARK_SCHEMA_VERSION = '1.0.0';
const MAX_IMPORT_BYTES = 32 * 1024 * 1024;
const MAX_STORE_BYTES = 2 * 1024 * 1024;
const MAX_RECORDS = 500;
const MAX_CSV_ROWS = 50_000;
const MAX_SAMPLES = 50_000;
const PHASES = new Set(['BASELINE', 'CANDIDATE']);
const DIRECTIONS = new Set(['HIGHER_IS_BETTER', 'LOWER_IS_BETTER']);
const CONDITION_FIELDS = [
  'osBuild', 'powerMode', 'appVersion', 'graphicsPreset', 'resolution', 'scene',
  'duration', 'warmup', 'backgroundWorkload', 'driverVersion', 'ambientNotes',
];

// PresentMon documents one rendered frame per CSV row and millisecond timing columns here:
// https://github.com/GameTechDev/PresentMon/blob/main/README-ConsoleApplication.md#comma-separated-value-csv-file-output
// https://github.com/GameTechDev/PresentMon/blob/main/README-CaptureApplication.md#metric-and-csv-column-definitions
const PRESENTMON_FRAME_TIME_COLUMNS = Object.freeze([
  'FrameTime',
  'MsBetweenPresents',
  'CPUFrameTime',
]);

function benchmarksPath(userDataPath) {
  return path.join(userDataPath, 'benchmarks.json');
}

function boundedString(value, label, max = 160, pattern = null) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || (pattern && !pattern.test(value))) {
    throw new Error(`${label} must be a non-empty string of at most ${max} characters.`);
  }
  return value.trim();
}

function optionalString(value, label, max = 240) {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string' || value.length > max) throw new Error(`${label} must be at most ${max} characters.`);
  return value.trim();
}

function normalizeSamples(value, label) {
  if (!Array.isArray(value) || value.length < 3 || value.length > MAX_SAMPLES) {
    throw new Error(`${label} must contain between 3 and ${MAX_SAMPLES} repeated samples.`);
  }
  return value.map((sample, index) => {
    const number = Number(sample);
    if (!Number.isFinite(number) || number < 0 || Math.abs(number) > 1e12) {
      throw new Error(`${label}[${index}] is not a supported non-negative finite measurement.`);
    }
    return number;
  });
}

function normalizeConditions(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return Object.fromEntries(CONDITION_FIELDS.map((field) => [field, boundedString(value[field], `${label}.${field}`, 240)]));
}

function normalizeRecord(record, index) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Error(`records[${index}] must be an object.`);
  const phase = boundedString(record.phase, `records[${index}].phase`, 16);
  const direction = boundedString(record.direction, `records[${index}].direction`, 32);
  if (!PHASES.has(phase)) throw new Error(`records[${index}].phase must be BASELINE or CANDIDATE.`);
  if (!DIRECTIONS.has(direction)) throw new Error(`records[${index}].direction is not supported.`);
  const capturedAt = boundedString(record.capturedAt, `records[${index}].capturedAt`, 40);
  if (!Number.isFinite(Date.parse(capturedAt))) throw new Error(`records[${index}].capturedAt must be an ISO-compatible timestamp.`);
  return {
    id: crypto.randomUUID(),
    experimentId: boundedString(record.experimentId, `records[${index}].experimentId`, 64, /^[A-Za-z0-9][A-Za-z0-9._-]*$/),
    phase,
    workload: boundedString(record.workload, `records[${index}].workload`, 160),
    tool: boundedString(record.tool, `records[${index}].tool`, 120),
    toolVersion: boundedString(record.toolVersion, `records[${index}].toolVersion`, 80),
    metric: boundedString(record.metric, `records[${index}].metric`, 80),
    unit: boundedString(record.unit, `records[${index}].unit`, 32, /^[A-Za-z0-9%./ _-]+$/),
    direction,
    variant: boundedString(record.variant, `records[${index}].variant`, 160),
    changeDescription: boundedString(record.changeDescription, `records[${index}].changeDescription`, 240),
    capturedAt: new Date(Date.parse(capturedAt)).toISOString(),
    sampleUnit: ['FRAME', 'TRIAL'].includes(record.sampleUnit) ? record.sampleUnit : 'UNKNOWN',
    trialIds: Array.isArray(record.trialIds) ? record.trialIds.map((id) => boundedString(id, 'trial identity', 100)) : [],
    samples: normalizeSamples(record.samples, `records[${index}].samples`),
    conditions: normalizeConditions(record.conditions, `records[${index}].conditions`),
    notes: optionalString(record.notes, `records[${index}].notes`, 500),
    linkedAuditEntryId: record.linkedAuditEntryId
      ? boundedString(record.linkedAuditEntryId, `records[${index}].linkedAuditEntryId`, 36, /^[0-9a-f-]{36}$/i)
      : null,
    importedAt: new Date().toISOString(),
  };
}

function validateRecordSet(records) {
  if (!Array.isArray(records) || records.length === 0 || records.length > MAX_RECORDS) {
    throw new Error(`Benchmark import must contain between 1 and ${MAX_RECORDS} records.`);
  }
  const normalized = records.map(normalizeRecord);
  const keys = new Set();
  for (const record of normalized) {
    if (record.sampleUnit === 'TRIAL' && (record.trialIds.length !== record.samples.length || new Set(record.trialIds).size !== record.trialIds.length)) throw new Error('Independent trial summaries require one unique trial identity per sample.');
    const key = `${record.experimentId}\0${record.phase}`;
    if (keys.has(key)) throw new Error(`Experiment '${record.experimentId}' contains more than one ${record.phase} record.`);
    keys.add(key);
  }
  return normalized;
}

function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') { field += '"'; index += 1; }
      else if (character === '"') quoted = false;
      else field += character;
    } else if (character === '"') quoted = true;
    else if (character === ',') { row.push(field); field = ''; }
    else if (character === '\n') { row.push(field.replace(/\r$/, '')); rows.push(row); row = []; field = ''; }
    else field += character;
  }
  if (quoted) throw new Error('CSV contains an unterminated quoted field.');
  if (field || row.length) { row.push(field.replace(/\r$/, '')); rows.push(row); }
  if (rows.length > MAX_CSV_ROWS + 1) throw new Error(`CSV exceeds the ${MAX_CSV_ROWS}-row limit.`);
  const populated = rows.filter((item) => item.some((value) => value.trim()));
  if (populated[0]?.[0]) populated[0][0] = populated[0][0].replace(/^\uFEFF/, '');
  return populated;
}

function presentMonColumnIndex(headers, candidates) {
  const normalized = headers.map((header) => header.trim().toLowerCase());
  for (const candidate of candidates) {
    const index = normalized.indexOf(candidate.toLowerCase());
    if (index >= 0) return index;
  }
  return -1;
}

function parsePresentMonCsv(text) {
  const rows = parseCsvRows(text);
  if (rows.length < 4) throw new Error('PresentMon CSV must contain a header and at least three frame rows.');
  const headers = rows[0].map((value) => value.trim());
  const applicationIndex = presentMonColumnIndex(headers, ['Application']);
  const processIdIndex = presentMonColumnIndex(headers, ['ProcessID']);
  const metricIndex = presentMonColumnIndex(headers, PRESENTMON_FRAME_TIME_COLUMNS);
  if (applicationIndex < 0 || processIdIndex < 0 || metricIndex < 0) {
    throw new Error(`PresentMon CSV must include Application, ProcessID, and one supported frame-time column (${PRESENTMON_FRAME_TIME_COLUMNS.join(', ')}).`);
  }

  const applications = new Map();
  let unavailableFrameCount = 0;
  for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
    const values = rows[rowIndex];
    if (values.length !== headers.length) {
      throw new Error(`PresentMon CSV row ${rowIndex + 1} has ${values.length} columns; expected ${headers.length}.`);
    }
    const application = String(values[applicationIndex] || '').trim();
    const processId = Number(values[processIdIndex]);
    if (!application || !Number.isInteger(processId) || processId < 0) {
      throw new Error(`PresentMon CSV row ${rowIndex + 1} has an invalid application or process identifier.`);
    }
    const rawFrameTime = String(values[metricIndex] || '').trim();
    if (!rawFrameTime || /^NA$/i.test(rawFrameTime)) {
      unavailableFrameCount += 1;
      continue;
    }
    const frameTime = Number(rawFrameTime);
    if (!Number.isFinite(frameTime) || frameTime <= 0 || frameTime > 60_000) {
      throw new Error(`PresentMon CSV row ${rowIndex + 1} has an invalid positive frame-time measurement.`);
    }
    if (!applications.has(application)) {
      applications.set(application, { application, processIds: new Set(), samples: [] });
    }
    const capture = applications.get(application);
    capture.processIds.add(processId);
    capture.samples.push(frameTime);
  }

  const normalizedApplications = Array.from(applications.values()).map((capture) => {
    if (capture.samples.length < 3) {
      throw new Error(`PresentMon application '${capture.application}' has fewer than three usable frame-time samples.`);
    }
    if (capture.samples.length > MAX_SAMPLES) {
      throw new Error(`PresentMon application '${capture.application}' exceeds the ${MAX_SAMPLES}-sample limit.`);
    }
    return {
      application: capture.application,
      processIds: Array.from(capture.processIds).sort((left, right) => left - right),
      samples: capture.samples,
    };
  });
  if (normalizedApplications.length === 0) {
    throw new Error('PresentMon CSV contains no usable frame-time samples.');
  }
  return {
    format: 'PRESENTMON',
    metric: 'Frame time',
    metricColumn: headers[metricIndex],
    unit: 'ms',
    direction: 'LOWER_IS_BETTER',
    unavailableFrameCount,
    applications: normalizedApplications,
  };
}

function parseCsv(text) {
  const rows = parseCsvRows(text);
  if (rows.length < 2) throw new Error('CSV must contain a header and sample rows.');
  const headers = rows[0].map((value) => value.trim());
  const required = ['experimentId', 'phase', 'workload', 'tool', 'toolVersion', 'metric', 'unit', 'direction', 'variant', 'changeDescription', 'capturedAt', 'sample', ...CONDITION_FIELDS];
  for (const header of required) if (!headers.includes(header)) throw new Error(`CSV is missing required column '${header}'.`);
  const groups = new Map();
  for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
    const values = rows[rowIndex];
    if (values.length !== headers.length) throw new Error(`CSV row ${rowIndex + 1} has ${values.length} columns; expected ${headers.length}.`);
    const item = Object.fromEntries(headers.map((header, index) => [header, values[index]]));
    const key = `${item.experimentId}\0${item.phase}`;
    if (!groups.has(key)) {
      groups.set(key, {
        experimentId: item.experimentId,
        phase: item.phase,
        workload: item.workload,
        tool: item.tool,
        toolVersion: item.toolVersion,
        metric: item.metric,
        unit: item.unit,
        direction: item.direction,
        variant: item.variant,
        changeDescription: item.changeDescription,
        capturedAt: item.capturedAt,
        samples: [],
        sampleUnit: item.sampleUnit || 'UNKNOWN',
        trialIds: [],
        conditions: Object.fromEntries(CONDITION_FIELDS.map((field) => [field, item[field]])),
        notes: item.notes || '',
        linkedAuditEntryId: item.linkedAuditEntryId || null,
      });
    }
    const group = groups.get(key);
    for (const field of ['workload', 'tool', 'toolVersion', 'metric', 'unit', 'direction', 'variant', 'changeDescription', 'capturedAt', 'linkedAuditEntryId', ...CONDITION_FIELDS]) {
      const expected = CONDITION_FIELDS.includes(field) ? group.conditions[field] : group[field];
      const actual = field === 'linkedAuditEntryId' ? item[field] || null : item[field];
      if (actual !== expected) throw new Error(`CSV group '${item.experimentId}' ${item.phase} changes '${field}' between sample rows.`);
    }
    if ((item.sampleUnit || 'UNKNOWN') !== group.sampleUnit) throw new Error('CSV sample units must match within each phase.');
    if (item.trialId) group.trialIds.push(item.trialId);
    group.samples.push(item.sample);
  }
  return Array.from(groups.values());
}

function parseBenchmarkImport(filePath) {
  const source = parseBenchmarkSource(filePath);
  if (source.format !== 'PC_OPTI') {
    throw new Error('Raw PresentMon CSV requires baseline/candidate metadata before import.');
  }
  return source.records;
}

function parseBenchmarkSource(filePath) {
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) throw new Error('Benchmark import requires a main-process-selected absolute path.');
  const extension = path.extname(filePath).toLowerCase();
  if (!['.json', '.csv'].includes(extension)) throw new Error('Benchmark import supports only .json and .csv files.');
  const stat = fs.statSync(filePath);
  if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_IMPORT_BYTES) throw new Error('Benchmark import file must be a non-empty file no larger than 32 MB.');
  const text = fs.readFileSync(filePath, 'utf8');
  if (extension === '.json') {
    const parsed = JSON.parse(text);
    if (parsed?.schemaVersion !== BENCHMARK_SCHEMA_VERSION) throw new Error(`Benchmark JSON schema ${BENCHMARK_SCHEMA_VERSION} is required.`);
    return { format: 'PC_OPTI', records: validateRecordSet(parsed.records) };
  }
  const rows = parseCsvRows(text);
  const headers = rows[0]?.map((value) => value.trim()) || [];
  if (headers.includes('experimentId') && headers.includes('sample')) {
    return { format: 'PC_OPTI', records: validateRecordSet(parseCsv(text)) };
  }
  return {
    ...parsePresentMonCsv(text),
    fileName: path.basename(filePath),
    capturedAt: stat.mtime.toISOString(),
  };
}

function createPresentMonRecords(sources, metadata) {
  if (!Array.isArray(sources) || (sources.length !== 2 && (sources.length < 6 || sources.length > 20)) || sources.some((source) => source?.format !== 'PRESENTMON')) {
    throw new Error('PresentMon import requires a pair or 6 to 20 parsed CSV captures.');
  }
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    throw new Error('PresentMon import metadata must be an object.');
  }
  if (!Array.isArray(metadata.runs) || metadata.runs.length !== sources.length) {
    throw new Error('PresentMon import metadata must describe every selected run.');
  }

  const experimentId = boundedString(metadata.experimentId, 'PresentMon experiment ID', 64, /^[A-Za-z0-9][A-Za-z0-9._-]*$/);
  const workload = boundedString(metadata.workload, 'PresentMon workload', 160);
  const toolVersion = boundedString(metadata.toolVersion, 'PresentMon tool version', 80);
  const nativeToolVersions = [...new Set(sources.filter((source) => source.nativeCaptureId).map((source) => source.toolVersion))];
  if (nativeToolVersions.length > 0 && (nativeToolVersions.length !== 1 || nativeToolVersions[0] !== toolVersion || sources.some((source) => !source.nativeCaptureId))) {
    throw new Error('Native PresentMon captures must use their single verified tool version and cannot be mixed with file-selected captures.');
  }
  const changeDescription = boundedString(metadata.changeDescription, 'PresentMon change description', 240);
  const conditions = normalizeConditions(metadata.conditions, 'PresentMon conditions');
  const sourceById = new Map(sources.map((source) => [source.sourceId, source]));
  if (sourceById.size !== sources.length) throw new Error('PresentMon capture identifiers must be unique.');

  const usedSourceIds = new Set();
  const records = metadata.runs.map((run, index) => {
    const sourceId = boundedString(run?.sourceId, `PresentMon runs[${index}].sourceId`, 36, /^[0-9a-f-]{36}$/i);
    if (usedSourceIds.has(sourceId)) throw new Error('Each PresentMon capture must be assigned exactly once.');
    usedSourceIds.add(sourceId);
    const source = sourceById.get(sourceId);
    if (!source) throw new Error('PresentMon import metadata refers to an unknown capture.');
    const application = boundedString(run.application, `PresentMon runs[${index}].application`, 260);
    const capture = source.applications.find((item) => item.application === application);
    if (!capture) throw new Error(`PresentMon capture '${source.fileName}' does not contain application '${application}'.`);
    return {
      experimentId,
      phase: boundedString(run.phase, `PresentMon runs[${index}].phase`, 16),
      workload,
      tool: 'PresentMon',
      toolVersion,
      metric: `Frame time (${source.metricColumn})`,
      unit: source.unit,
      direction: source.direction,
      variant: boundedString(run.variant, `PresentMon runs[${index}].variant`, 160),
      changeDescription,
      capturedAt: boundedString((source.nativeCaptureId ? source.capturedAt : run.capturedAt || source.capturedAt), `PresentMon runs[${index}].capturedAt`, 40),
      sampleUnit: 'FRAME',
      trialIds: [sourceId],
      samples: capture.samples,
      conditions,
      notes: optionalString(run.notes, `PresentMon runs[${index}].notes`, 500),
      linkedAuditEntryId: run.linkedAuditEntryId || null,
    };
  });
  if (usedSourceIds.size !== sources.length) throw new Error('Each PresentMon capture must be assigned exactly once.');
  const phases = new Set(records.map((record) => record.phase));
  if (phases.size !== 2 || !phases.has('BASELINE') || !phases.has('CANDIDATE')) {
    throw new Error('PresentMon import requires one BASELINE run and one CANDIDATE run.');
  }
  if (new Set(records.map((record) => record.metric)).size !== 1) {
    throw new Error('PresentMon captures must use the same frame-time column for comparison.');
  }
  if (sources.length > 2) {
    if (new Set(metadata.runs.map((run) => run.application)).size !== 1) throw new Error('Repeated trials must use the same application.');
    const grouped = ['BASELINE', 'CANDIDATE'].map((phase) => {
      const trials = records.filter((record) => record.phase === phase);
      if (trials.length < 3) throw new Error('Repeated comparison requires at least three runs per phase.');
      if (new Set(trials.map((record) => record.variant)).size !== 1 || new Set(trials.map((record) => record.linkedAuditEntryId)).size !== 1) throw new Error('Each phase must use one variant and audit identity.');
      const groupingNote = 'One mean frame time per selected capture. Raw native CSV remains in saved captures. Independence and matching conditions are user declarations.';
      const declaredNotes = [...new Set(trials.map((record) => record.notes).filter(Boolean))].join('\n');
      const notes = declaredNotes ? `${declaredNotes}\n${groupingNote}` : groupingNote;
      if (notes.length > 500) throw new Error('Combined repeated-run notes exceed 500 characters. Shorten the notes while retaining the change declaration before importing.');
      return { ...trials[0], sampleUnit: 'TRIAL', trialIds: trials.flatMap((record) => record.trialIds),
        samples: trials.map((record) => record.samples.reduce((sum, value) => sum + value, 0) / record.samples.length),
        notes };
    });
    return validateRecordSet(grouped);
  }
  return validateRecordSet(records);
}

function readBenchmarks(userDataPath) {
  const filePath = benchmarksPath(userDataPath);
  if (!fs.existsSync(filePath)) return [];
  const stat = fs.statSync(filePath);
  if (stat.size > MAX_STORE_BYTES) throw new Error('The local benchmark store exceeds the supported 2 MB limit.');
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (!parsed || parsed.schemaVersion !== BENCHMARK_SCHEMA_VERSION || !Array.isArray(parsed.records) || parsed.records.length > MAX_RECORDS) {
    throw new Error('The local benchmark store schema is not valid.');
  }
  if (parsed.records.length === 0) return [];
  const normalized = validateRecordSet(parsed.records);
  return normalized.map((record, index) => ({
    ...record,
    id: boundedString(parsed.records[index].id, `stored records[${index}].id`, 36, /^[0-9a-f-]{36}$/i),
    importedAt: safeStoredTimestamp(parsed.records[index].importedAt, `stored records[${index}].importedAt`),
  }));
}

function safeStoredTimestamp(value, label) {
  const text = boundedString(value, label, 40);
  const timestamp = Date.parse(text);
  if (!Number.isFinite(timestamp)) throw new Error(`${label} must be an ISO-compatible timestamp.`);
  return new Date(timestamp).toISOString();
}

function writeBenchmarks(userDataPath, records) {
  if (!Array.isArray(records) || records.length > MAX_RECORDS) throw new Error('The local benchmark record count is not valid.');
  fs.mkdirSync(userDataPath, { recursive: true });
  const target = benchmarksPath(userDataPath);
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
  const payload = JSON.stringify({ schemaVersion: BENCHMARK_SCHEMA_VERSION, updatedAt: new Date().toISOString(), records }, null, 2);
  if (Buffer.byteLength(payload, 'utf8') > MAX_STORE_BYTES) throw new Error('The local benchmark store would exceed the supported 2 MB limit.');
  fs.writeFileSync(temporary, payload, 'utf8');
  fs.renameSync(temporary, target);
}

function benchmarkFingerprint(records) {
  return crypto.createHash('sha256').update(JSON.stringify(records), 'utf8').digest('hex');
}

function createImportPreview(existingRecords, importedRecords) {
  const existingKeys = new Set(existingRecords.map((record) => `${record.experimentId}\0${record.phase}`));
  for (const record of importedRecords) {
    if (existingKeys.has(`${record.experimentId}\0${record.phase}`)) throw new Error(`Experiment '${record.experimentId}' already has a stored ${record.phase} record.`);
  }
  if (existingRecords.length + importedRecords.length > MAX_RECORDS) throw new Error(`Import would exceed the ${MAX_RECORDS}-record local limit.`);
  return {
    sourceFingerprint: benchmarkFingerprint(existingRecords),
    records: importedRecords,
    preview: importedRecords.map((record) => ({
      experimentId: record.experimentId,
      phase: record.phase,
      workload: record.workload,
      tool: `${record.tool} ${record.toolVersion}`,
      metric: `${record.metric} (${record.unit})`,
      direction: record.direction,
      variant: record.variant,
      sampleCount: record.samples.length,
      samples: record.samples,
      conditions: record.conditions,
    })),
  };
}

function applyImport(userDataPath, preview) {
  const current = readBenchmarks(userDataPath);
  if (benchmarkFingerprint(current) !== preview?.sourceFingerprint) throw new Error('Benchmark evidence changed after preview. Import and review the file again.');
  const next = [...current, ...preview.records];
  writeBenchmarks(userDataPath, next);
  return next;
}

function statistics(samples) {
  const sorted = [...samples].sort((left, right) => left - right);
  const mean = samples.reduce((sum, value) => sum + value, 0) / samples.length;
  const middle = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  const variance = samples.length > 1
    ? samples.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / (samples.length - 1)
    : 0;
  const standardDeviation = Math.sqrt(variance);
  return {
    count: samples.length,
    mean,
    median,
    minimum: sorted[0],
    maximum: sorted[sorted.length - 1],
    standardDeviation,
    coefficientOfVariationPercent: mean === 0 ? null : (standardDeviation / Math.abs(mean)) * 100,
  };
}

function comparisonKey(record) {
  return [record.workload, record.tool, record.toolVersion, record.metric, record.unit, record.direction, record.changeDescription].join('\0');
}

function compareExperiment(records, experimentId, auditEntries = []) {
  const experiment = records.filter((record) => record.experimentId === experimentId);
  const baseline = experiment.find((record) => record.phase === 'BASELINE');
  const candidate = experiment.find((record) => record.phase === 'CANDIDATE');
  if (!baseline || !candidate) return { experimentId, classification: 'INCOMPLETE', reason: 'Both BASELINE and CANDIDATE records are required.', baseline: baseline || null, candidate: candidate || null };
  const baselineStats = statistics(baseline.samples);
  const candidateStats = statistics(candidate.samples);
  const conditionMismatches = CONDITION_FIELDS.filter((field) => baseline.conditions[field] !== candidate.conditions[field]);
  if (comparisonKey(baseline) !== comparisonKey(candidate) || conditionMismatches.length) {
    return { experimentId, classification: 'INCOMPARABLE', reason: 'Core metric metadata or required test conditions differ.', conditionMismatches, baseline, candidate, baselineStats, candidateStats };
  }
  if (baselineStats.mean === 0) return { experimentId, classification: 'INCOMPARABLE', reason: 'A zero baseline mean cannot produce a meaningful percentage delta.', conditionMismatches: [], baseline, candidate, baselineStats, candidateStats };
  const rawDeltaPercent = ((candidateStats.mean - baselineStats.mean) / Math.abs(baselineStats.mean)) * 100;
  const favorableDeltaPercent = baseline.direction === 'HIGHER_IS_BETTER' ? rawDeltaPercent : -rawDeltaPercent;
  const variabilityPercent = Math.max(baselineStats.coefficientOfVariationPercent || 0, candidateStats.coefficientOfVariationPercent || 0);
  let classification;
  let reason;
  const repeatedTrials = baseline.sampleUnit === 'TRIAL' && candidate.sampleUnit === 'TRIAL'
    && [baseline, candidate].every((record) => record.trialIds?.length === record.samples.length && new Set(record.trialIds).size === record.samples.length)
    && new Set([...baseline.trialIds, ...candidate.trialIds]).size === baseline.trialIds.length + candidate.trialIds.length;
  if (!repeatedTrials) {
    classification = 'INCONCLUSIVE';
    reason = 'Only one recording on each side, so this shows a difference but cannot say whether it is real. Record at least three runs on each side.';
  } else if (variabilityPercent > 5) {
    classification = 'HIGH_VARIANCE';
    reason = 'Your runs varied by more than 5% on their own, so a real difference cannot be told apart from chance.';
  } else if (Math.abs(favorableDeltaPercent) <= variabilityPercent) {
    classification = 'INCONCLUSIVE';
    reason = 'The difference is within the normal run-to-run wobble, so there is no clear effect.';
  } else if (favorableDeltaPercent < 0) {
    classification = 'REGRESSION';
    reason = 'It got worse, by more than the normal wobble. Consider undoing the change.';
  } else {
    classification = 'MEASURED_DIFFERENCE';
    reason = 'It got better, by more than the normal wobble, in this game and scene.';
  }
  const linkedAudit = candidate.linkedAuditEntryId
    ? auditEntries.find((entry) => entry.id === candidate.linkedAuditEntryId)
    : null;
  const rollbackGuidance = classification === 'REGRESSION'
    ? linkedAudit?.status === 'SUCCESS' && linkedAudit?.rollback?.available
      ? { available: true, auditEntryId: linkedAudit.id, capabilityId: linkedAudit.capabilityId || null, reason: 'A linked successful audit entry still reports deterministic rollback available. Review it in Local Audit History; rollback is never automatic.' }
      : { available: false, auditEntryId: null, capabilityId: null, reason: candidate.linkedAuditEntryId ? 'The linked audit entry is missing, unresolved, or no longer has rollback available.' : 'No Local Audit History entry was linked to this candidate record.' }
    : null;
  return {
    experimentId,
    classification,
    reason,
    sampleUnit: repeatedTrials ? 'TRIAL' : baseline.sampleUnit || 'UNKNOWN',
    decisionRule: 'For declared independent run summaries: review CV above 5%; otherwise compare the mean delta with the larger CV. This descriptive heuristic is not a significance test or proof of causation. Trial independence and matching conditions are user declarations.',
    scopeWarning: 'This result is for this PC, game and scene. It is not a universal performance claim.',
    baseline,
    candidate,
    baselineStats,
    candidateStats,
    rawDeltaPercent,
    favorableDeltaPercent,
    variabilityPercent,
    conditionMismatches: [],
    rollbackGuidance,
  };
}

function listBenchmarkEvidence(userDataPath, auditEntries = []) {
  const records = readBenchmarks(userDataPath);
  const experimentIds = [...new Set(records.map((record) => record.experimentId))];
  return { records, comparisons: experimentIds.map((id) => compareExperiment(records, id, auditEntries)) };
}

function createBenchmarkDeletionPreview(records, experimentId) {
  const id = boundedString(experimentId, 'Experiment ID', 64, /^[A-Za-z0-9][A-Za-z0-9._-]*$/);
  const selected = records.filter((record) => record.experimentId === id);
  const deletedCount = selected.length;
  if (!deletedCount) throw new Error('The selected benchmark experiment no longer exists.');
  return {
    sourceFingerprint: benchmarkFingerprint(records),
    experimentId: id,
    deletedCount,
    summary: selected.map((record) => ({
      phase: record.phase,
      workload: record.workload,
      tool: `${record.tool} ${record.toolVersion}`,
      metric: `${record.metric} (${record.unit})`,
      sampleCount: record.samples.length,
    })),
  };
}

function deleteBenchmarkExperiment(userDataPath, preview) {
  if (!preview || typeof preview.sourceFingerprint !== 'string') throw new Error('A valid benchmark deletion preview is required.');
  const current = readBenchmarks(userDataPath);
  if (benchmarkFingerprint(current) !== preview.sourceFingerprint) throw new Error('Benchmark evidence changed after preview. Refresh and review deletion again.');
  const retained = current.filter((record) => record.experimentId !== preview.experimentId);
  const deletedCount = current.length - retained.length;
  if (!deletedCount || deletedCount !== preview.deletedCount) throw new Error('The benchmark deletion selection changed after preview.');
  writeBenchmarks(userDataPath, retained);
  return { deletedCount };
}

module.exports = {
  BENCHMARK_SCHEMA_VERSION,
  CONDITION_FIELDS,
  applyImport,
  compareExperiment,
  createBenchmarkDeletionPreview,
  createImportPreview,
  createPresentMonRecords,
  deleteBenchmarkExperiment,
  listBenchmarkEvidence,
  parseBenchmarkImport,
  parseBenchmarkSource,
  parseCsv,
  parsePresentMonCsv,
  readBenchmarks,
  statistics,
  validateRecordSet,
};
