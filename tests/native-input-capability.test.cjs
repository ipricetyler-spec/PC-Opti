const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const schema = require('../native/dialed-input-filter/schemas/device-capability.schema.json');
const {
  EVIDENCE_FIELDS,
  MATERIAL_CHANGE_TRIGGERS,
  PROVENANCE_LEDGER_PATH,
  assertDeviceCapabilitySemantics,
  deriveCapabilityStatus,
  getDocumentedPollingPeriod,
  getInterruptCeilingHz,
  readProvenanceLedgerIds,
  validateDeviceCapabilityRecord,
  validateDeviceCapabilitySemantics,
  validateDeviceCapabilityStructure,
  validateProvenanceRefsResolve,
} = require('../native/dialed-input-filter/device-capability-validator.cjs');

const FIXTURE_PATH = path.join(
  __dirname,
  '..',
  'native',
  'dialed-input-filter',
  'fixtures',
  'device-capability.high-speed.example.json',
);
const HASHES = Object.freeze({
  PASS: 'a'.repeat(64),
  FAIL: 'b'.repeat(64),
  INCONCLUSIVE: 'c'.repeat(64),
});
const VALIDATOR_PATH = path.join(
  __dirname,
  '..',
  'native',
  'dialed-input-filter',
  'device-capability-validator.cjs',
);

function fixture() {
  return JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8'));
}

function setEvidence(evidence, status) {
  evidence.status = status;
  evidence.artifactSha256 = status === 'NOT_MEASURED' ? null : HASHES[status];
}

function setRateResult(record, rateIndex, result) {
  const rate = record.rateCapabilities[rateIndex];
  rate.result = result;
  rate.blockReason = result === 'BLOCKED' ? 'Synthetic hard-stop evidence.' : null;
  rate.scheduleMechanism = result === 'SUPPORTED' ? 'DOCUMENTED_WDF' : 'UNRESOLVED';
  rate.scheduleMechanismRefs = result === 'SUPPORTED' ? ['P-010'] : [];
  for (const evidenceField of EVIDENCE_FIELDS) {
    setEvidence(rate[evidenceField], 'NOT_MEASURED');
  }
  if (result === 'SUPPORTED') {
    setEvidence(rate.configuredEvidence, 'PASS');
    setEvidence(rate.driverSessionEvidence, 'PASS');
    setEvidence(rate.usbBusEvidence, 'PASS');
  }
  record.status = deriveCapabilityStatus(record.rateCapabilities);
  return record;
}

function oneRateRecord({ speed, bInterval, requestedHz }) {
  const record = fixture();
  record.topology.negotiatedSpeed = speed;
  record.deviceMatch.endpoints[0].bInterval = bInterval;
  record.rateCapabilities = [record.rateCapabilities[0]];
  record.rateCapabilities[0].requestedHz = requestedHz;
  record.status = 'UNVERIFIED';
  return record;
}

function assertRejected(record, code, expectedPath = null) {
  const result = validateDeviceCapabilitySemantics(record);
  assert.equal(result.valid, false, `Expected ${code}, received ${JSON.stringify(result.errors)}`);
  const error = result.errors.find((candidate) => candidate.code === code);
  assert.ok(error, `Expected ${code}, received ${JSON.stringify(result.errors)}`);
  if (expectedPath !== null) assert.equal(error.path, expectedPath);
  return result;
}

test('synthetic UNVERIFIED fixture passes the semantic validator', () => {
  const record = fixture();
  const result = validateDeviceCapabilitySemantics(record);

  assert.deepEqual(result, { valid: true, derivedStatus: 'UNVERIFIED', errors: [] });
  assert.equal(assertDeviceCapabilitySemantics(record), record);
});

test('combined validator and assertion fail closed on structurally incomplete records', () => {
  const record = { materialChangeTriggers: [...MATERIAL_CHANGE_TRIGGERS] };
  const structural = validateDeviceCapabilityStructure(record);
  const combined = validateDeviceCapabilityRecord(record);

  assert.equal(structural.valid, false);
  assert.ok(structural.errors.some((error) => error.code === 'SCHEMA_REQUIRED'));
  assert.equal(combined.valid, false);
  assert.equal(combined.derivedStatus, null);
  assert.ok(combined.errors.some((error) => error.path === 'rateCapabilities'));
  assert.throws(
    () => assertDeviceCapabilitySemantics(record),
    /SCHEMA_REQUIRED at rateCapabilities/,
  );
});

test('CLI fails closed instead of reporting a structurally incomplete record as valid', () => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'dialed-capability-'));
  const recordPath = path.join(temporaryDirectory, 'incomplete.json');
  try {
    fs.writeFileSync(
      recordPath,
      `${JSON.stringify({ materialChangeTriggers: [...MATERIAL_CHANGE_TRIGGERS] })}\n`,
      'utf8',
    );
    const result = spawnSync(process.execPath, [VALIDATOR_PATH, recordPath], { encoding: 'utf8' });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /SCHEMA_REQUIRED at rateCapabilities/);
    assert.doesNotMatch(result.stdout, /valid/);
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test('schema carries the locally expressible semantic constraints', () => {
  const evidenceSchema = schema.$defs.evidence;
  const rateSchema = schema.properties.rateCapabilities;
  const triggerSchema = schema.properties.materialChangeTriggers;

  assert.equal(evidenceSchema.allOf.length, 1);
  assert.equal(rateSchema.allOf.length, 7);
  assert.deepEqual(
    rateSchema.allOf.map((constraint) => constraint.maxContains),
    [1, 1, 1, 1, 1, 1, 1],
  );
  assert.equal(triggerSchema.minItems, MATERIAL_CHANGE_TRIGGERS.length);
  assert.equal(triggerSchema.maxItems, MATERIAL_CHANGE_TRIGGERS.length);
  assert.equal(schema.allOf.length, 5);
});

test('record status uses the exported canonical precedence without claiming every rate', () => {
  const cases = [
    {
      expected: 'SUPPORTED',
      build() {
        const record = fixture();
        return setRateResult(record, 0, 'SUPPORTED');
      },
    },
    {
      expected: 'UNVERIFIED',
      build() {
        const record = fixture();
        return setRateResult(record, 0, 'BLOCKED');
      },
    },
    {
      expected: 'BLOCKED',
      build() {
        const record = fixture();
        setRateResult(record, 0, 'BLOCKED');
        return setRateResult(record, 1, 'UNSUPPORTED');
      },
    },
    {
      expected: 'UNSUPPORTED',
      build() {
        const record = fixture();
        setRateResult(record, 0, 'UNSUPPORTED');
        return setRateResult(record, 1, 'UNSUPPORTED');
      },
    },
  ];

  for (const scenario of cases) {
    const record = scenario.build();
    assert.equal(deriveCapabilityStatus(record.rateCapabilities), scenario.expected);
    assert.equal(validateDeviceCapabilitySemantics(record).valid, true);
  }
});

test('every non-canonical top-level status is rejected for each aggregate', () => {
  const statuses = ['UNVERIFIED', 'SUPPORTED', 'UNSUPPORTED', 'BLOCKED'];
  const records = new Map();

  records.set('UNVERIFIED', fixture());

  const supported = fixture();
  setRateResult(supported, 0, 'SUPPORTED');
  records.set('SUPPORTED', supported);

  const unsupported = fixture();
  setRateResult(unsupported, 0, 'UNSUPPORTED');
  setRateResult(unsupported, 1, 'UNSUPPORTED');
  records.set('UNSUPPORTED', unsupported);

  const blocked = fixture();
  setRateResult(blocked, 0, 'BLOCKED');
  setRateResult(blocked, 1, 'UNSUPPORTED');
  records.set('BLOCKED', blocked);

  for (const [expected, baseRecord] of records) {
    for (const wrongStatus of statuses.filter((status) => status !== expected)) {
      const record = structuredClone(baseRecord);
      record.status = wrongStatus;
      assertRejected(record, 'STATUS_MISMATCH', 'status');
    }
  }
});

test('duplicate requested rates are rejected even when the rate objects differ', () => {
  const record = fixture();
  record.rateCapabilities[1].requestedHz = record.rateCapabilities[0].requestedHz;

  assertRejected(record, 'DUPLICATE_RATE', 'rateCapabilities[1].requestedHz');
});

test('only BLOCKED rates may carry a block reason', () => {
  for (const result of ['UNVERIFIED', 'SUPPORTED', 'UNSUPPORTED']) {
    const record = fixture();
    setRateResult(record, 0, result);
    record.rateCapabilities[0].blockReason = 'Not allowed for this result.';
    assertRejected(record, 'BLOCK_REASON_FORBIDDEN', 'rateCapabilities[0].blockReason');
  }
});

test('BLOCKED rates require a non-empty reason', () => {
  for (const invalidReason of [null, '', '   ']) {
    const record = fixture();
    setRateResult(record, 0, 'BLOCKED');
    record.rateCapabilities[0].blockReason = invalidReason;
    assertRejected(record, 'BLOCK_REASON_REQUIRED', 'rateCapabilities[0].blockReason');
  }
});

test('UNVERIFIED rates must keep their schedule unresolved', () => {
  for (const mechanism of ['DOCUMENTED_WDF', 'DOCUMENTED_DEVICE_VENDOR']) {
    const record = fixture();
    record.rateCapabilities[0].scheduleMechanism = mechanism;
    assertRejected(
      record,
      'UNVERIFIED_SCHEDULE_MUST_BE_UNRESOLVED',
      'rateCapabilities[0].scheduleMechanism',
    );
  }
});

test('UNVERIFIED rates reject measured state in every evidence level', () => {
  for (const evidenceField of EVIDENCE_FIELDS) {
    const record = fixture();
    setEvidence(record.rateCapabilities[0][evidenceField], 'PASS');
    assertRejected(
      record,
      'UNVERIFIED_EVIDENCE_MUST_BE_NOT_MEASURED',
      `rateCapabilities[0].${evidenceField}.status`,
    );
  }
});

test('SUPPORTED rates require a documented scheduling mechanism', () => {
  const record = fixture();
  setRateResult(record, 0, 'SUPPORTED');
  record.rateCapabilities[0].scheduleMechanism = 'UNRESOLVED';

  assertRejected(
    record,
    'SUPPORTED_SCHEDULE_MUST_BE_DOCUMENTED',
    'rateCapabilities[0].scheduleMechanism',
  );
});

test('SUPPORTED rates require configured, driver-session, and USB-bus PASS evidence', () => {
  for (const evidenceField of ['configuredEvidence', 'driverSessionEvidence', 'usbBusEvidence']) {
    const record = fixture();
    setRateResult(record, 0, 'SUPPORTED');
    setEvidence(record.rateCapabilities[0][evidenceField], 'FAIL');
    assertRejected(
      record,
      'SUPPORTED_EVIDENCE_MUST_PASS',
      `rateCapabilities[0].${evidenceField}.status`,
    );
  }
});

test('every measured status at every evidence level requires an artifact hash', () => {
  for (const status of ['PASS', 'FAIL', 'INCONCLUSIVE']) {
    for (const evidenceField of EVIDENCE_FIELDS) {
      const record = fixture();
      setRateResult(record, 0, 'UNSUPPORTED');
      record.rateCapabilities[0][evidenceField].status = status;
      record.rateCapabilities[0][evidenceField].artifactSha256 = null;
      assertRejected(
        record,
        'MEASURED_EVIDENCE_ARTIFACT_REQUIRED',
        `rateCapabilities[0].${evidenceField}.artifactSha256`,
      );
    }
  }
});

test('measured evidence rejects a non-SHA-256 artifact value', () => {
  const record = fixture();
  setRateResult(record, 0, 'UNSUPPORTED');
  record.rateCapabilities[0].windowsDeliveryEvidence.status = 'INCONCLUSIVE';
  record.rateCapabilities[0].windowsDeliveryEvidence.artifactSha256 = 'not-a-sha256';

  assertRejected(
    record,
    'MEASURED_EVIDENCE_ARTIFACT_REQUIRED',
    'rateCapabilities[0].windowsDeliveryEvidence.artifactSha256',
  );
});

test('NOT_MEASURED evidence requires a null artifact hash at every level', () => {
  for (const evidenceField of EVIDENCE_FIELDS) {
    const record = fixture();
    record.rateCapabilities[0][evidenceField].artifactSha256 = 'd'.repeat(64);
    assertRejected(
      record,
      'UNMEASURED_EVIDENCE_ARTIFACT_FORBIDDEN',
      `rateCapabilities[0].${evidenceField}.artifactSha256`,
    );
  }
});

test('endpoint keys must resolve uniquely', () => {
  const record = fixture();
  record.deviceMatch.endpoints.push(structuredClone(record.deviceMatch.endpoints[0]));

  assertRejected(record, 'DUPLICATE_ENDPOINT_KEY', 'deviceMatch.endpoints[1].key');
});

test('every required endpoint reference must resolve', () => {
  const record = fixture();
  record.rateCapabilities[0].requiredEndpointKeys[0] = 'if0-ep82';

  assertRejected(record, 'ENDPOINT_REFERENCE_NOT_FOUND', 'rateCapabilities[0].requiredEndpointKeys[0]');
});

test('every required endpoint must be INTERRUPT IN', () => {
  const invalidEndpointKinds = [
    { transferType: 'INTERRUPT', direction: 'OUT' },
    { transferType: 'BULK', direction: 'IN' },
    { transferType: 'BULK', direction: 'OUT' },
  ];

  for (const invalidKind of invalidEndpointKinds) {
    const record = fixture();
    Object.assign(record.deviceMatch.endpoints[0], invalidKind);
    assertRejected(
      record,
      'ENDPOINT_REFERENCE_NOT_INTERRUPT_IN',
      'rateCapabilities[0].requiredEndpointKeys[0]',
    );
  }
});

test('endpoint address direction bit must agree with the declared direction', () => {
  const record = fixture();
  record.deviceMatch.endpoints[0].key = 'if0-ep01';
  record.deviceMatch.endpoints[0].address = '01';

  assertRejected(
    record,
    'ENDPOINT_ADDRESS_DIRECTION_MISMATCH',
    'deviceMatch.endpoints[0].direction',
  );
});

test('interrupt endpoints reject endpoint zero and reserved bEndpointAddress bits', () => {
  const invalidCases = [
    {
      address: '00',
      direction: 'OUT',
      code: 'ENDPOINT_ZERO_NOT_INTERRUPT_CAPABLE',
    },
    {
      address: '80',
      direction: 'IN',
      code: 'ENDPOINT_ZERO_NOT_INTERRUPT_CAPABLE',
    },
    {
      address: 'F1',
      direction: 'IN',
      code: 'ENDPOINT_ADDRESS_RESERVED_BITS_SET',
    },
  ];

  for (const invalidCase of invalidCases) {
    const record = fixture();
    record.deviceMatch.endpoints[0].address = invalidCase.address;
    record.deviceMatch.endpoints[0].key = `if0-ep${invalidCase.address}`;
    record.deviceMatch.endpoints[0].direction = invalidCase.direction;
    for (const rate of record.rateCapabilities) {
      rate.requiredEndpointKeys = [`if0-ep${invalidCase.address}`];
    }

    assertRejected(
      record,
      invalidCase.code,
      'deviceMatch.endpoints[0].address',
    );
    const combined = validateDeviceCapabilityRecord(record);
    assert.equal(combined.valid, false);
    assert.ok(combined.errors.some((error) => error.code === 'SCHEMA_PATTERN'));
  }
});

test('endpoint keys must encode the exact interface and endpoint address tuple', () => {
  const interfaceMismatch = fixture();
  interfaceMismatch.deviceMatch.endpoints[0].key = 'if1-ep81';
  assertRejected(
    interfaceMismatch,
    'ENDPOINT_KEY_INTERFACE_MISMATCH',
    'deviceMatch.endpoints[0].key',
  );

  const addressMismatch = fixture();
  addressMismatch.deviceMatch.endpoints[0].key = 'if0-ep82';
  assertRejected(
    addressMismatch,
    'ENDPOINT_KEY_ADDRESS_MISMATCH',
    'deviceMatch.endpoints[0].key',
  );
});

test('every required endpoint must reference a declared interface', () => {
  const record = fixture();
  record.deviceMatch.endpoints[0].interfaceNumber = 7;

  assertRejected(record, 'ENDPOINT_INTERFACE_NOT_FOUND', 'deviceMatch.endpoints[0].interfaceNumber');
});

test('USB speed-specific bInterval ranges are enforced', () => {
  const invalidCases = [
    { speed: 'FULL', bInterval: 0 },
    { speed: 'FULL', bInterval: 256 },
    { speed: 'HIGH', bInterval: 0 },
    { speed: 'HIGH', bInterval: 17 },
    { speed: 'SUPER', bInterval: 0 },
    { speed: 'SUPER', bInterval: 17 },
    { speed: 'SUPER_PLUS', bInterval: 0 },
    { speed: 'SUPER_PLUS', bInterval: 17 },
  ];

  for (const invalidCase of invalidCases) {
    const record = oneRateRecord({ ...invalidCase, requestedHz: 125 });
    assertRejected(record, 'BINTERVAL_OUT_OF_RANGE', 'deviceMatch.endpoints[0].bInterval');
  }
});

test('requested rates above each speed/bInterval ceiling are rejected', () => {
  const invalidCases = [
    { speed: 'FULL', bInterval: 1, requestedHz: 2000 },
    { speed: 'FULL', bInterval: 2, requestedHz: 1000 },
    { speed: 'HIGH', bInterval: 2, requestedHz: 8000 },
    { speed: 'SUPER', bInterval: 3, requestedHz: 4000 },
    { speed: 'SUPER_PLUS', bInterval: 4, requestedHz: 2000 },
  ];

  for (const invalidCase of invalidCases) {
    const record = oneRateRecord(invalidCase);
    assertRejected(record, 'RATE_EXCEEDS_ENDPOINT_CEILING', 'rateCapabilities[0].requestedHz');
  }
});

test('rates at the speed/bInterval ceiling remain valid', () => {
  const validCases = [
    { speed: 'FULL', bInterval: 1, requestedHz: 1000 },
    { speed: 'FULL', bInterval: 2, requestedHz: 500 },
    { speed: 'HIGH', bInterval: 1, requestedHz: 8000 },
    { speed: 'HIGH', bInterval: 2, requestedHz: 4000 },
    { speed: 'SUPER', bInterval: 3, requestedHz: 2000 },
    { speed: 'SUPER_PLUS', bInterval: 4, requestedHz: 1000 },
  ];

  for (const validCase of validCases) {
    assert.equal(getInterruptCeilingHz(validCase.speed, validCase.bInterval), validCase.requestedHz);
    const result = validateDeviceCapabilitySemantics(oneRateRecord(validCase));
    assert.equal(result.valid, true, JSON.stringify(result.errors));
  }
});

test('every material change trigger is mandatory', () => {
  for (const trigger of MATERIAL_CHANGE_TRIGGERS) {
    const record = fixture();
    record.materialChangeTriggers = record.materialChangeTriggers.filter((candidate) => candidate !== trigger);
    const result = assertRejected(record, 'MATERIAL_CHANGE_TRIGGER_REQUIRED', 'materialChangeTriggers');
    assert.ok(result.errors.some((error) => error.message.includes(trigger)));
  }
});

test('semantic error ordering is deterministic', () => {
  const record = fixture();
  record.status = 'SUPPORTED';
  record.rateCapabilities[1].requestedHz = 1000;
  record.rateCapabilities[0].requiredEndpointKeys[0] = 'if0-ep82';
  record.materialChangeTriggers = [];

  const first = validateDeviceCapabilitySemantics(record);
  const second = validateDeviceCapabilitySemantics(structuredClone(record));
  assert.deepEqual(second, first);
  assert.equal(first.valid, false);
});

test('assertion helper exposes deterministic validation errors', () => {
  const record = oneRateRecord({ speed: 'FULL', bInterval: 1, requestedHz: 8000 });

  assert.throws(
    () => assertDeviceCapabilitySemantics(record),
    (error) => {
      assert.equal(error instanceof TypeError, true);
      assert.ok(error.validationErrors.some((entry) => entry.code === 'RATE_EXCEEDS_ENDPOINT_CEILING'));
      return true;
    },
  );
});

test('full-speed polling periods follow the documented Windows mapping, not 1/bInterval', () => {
  const documentedFullSpeedPeriods = [
    { bInterval: 1, period: 1, ceilingHz: 1000 },
    { bInterval: 2, period: 2, ceilingHz: 500 },
    { bInterval: 3, period: 2, ceilingHz: 500 },
    { bInterval: 4, period: 4, ceilingHz: 250 },
    { bInterval: 7, period: 4, ceilingHz: 250 },
    { bInterval: 8, period: 8, ceilingHz: 125 },
    { bInterval: 15, period: 8, ceilingHz: 125 },
    { bInterval: 16, period: 16, ceilingHz: 62.5 },
    { bInterval: 31, period: 16, ceilingHz: 62.5 },
    { bInterval: 32, period: 32, ceilingHz: 31.25 },
    { bInterval: 255, period: 32, ceilingHz: 31.25 },
  ];

  for (const expected of documentedFullSpeedPeriods) {
    assert.deepEqual(
      getDocumentedPollingPeriod('FULL', expected.bInterval),
      { unit: 'FRAME', period: expected.period },
      `FULL bInterval ${expected.bInterval}`,
    );
    assert.equal(getInterruptCeilingHz('FULL', expected.bInterval), expected.ceilingHz);
  }

  const record = oneRateRecord({ speed: 'FULL', bInterval: 3, requestedHz: 500 });
  assert.equal(validateDeviceCapabilitySemantics(record).valid, true);
});

test('high-speed polling periods stop at the documented 32-microframe cap', () => {
  const documentedHighSpeedPeriods = [
    { bInterval: 1, period: 1, ceilingHz: 8000 },
    { bInterval: 2, period: 2, ceilingHz: 4000 },
    { bInterval: 3, period: 4, ceilingHz: 2000 },
    { bInterval: 4, period: 8, ceilingHz: 1000 },
    { bInterval: 5, period: 16, ceilingHz: 500 },
    { bInterval: 6, period: 32, ceilingHz: 250 },
    { bInterval: 7, period: 32, ceilingHz: 250 },
    { bInterval: 16, period: 32, ceilingHz: 250 },
  ];

  for (const expected of documentedHighSpeedPeriods) {
    assert.deepEqual(
      getDocumentedPollingPeriod('HIGH', expected.bInterval),
      { unit: 'MICROFRAME', period: expected.period },
      `HIGH bInterval ${expected.bInterval}`,
    );
    assert.equal(getInterruptCeilingHz('HIGH', expected.bInterval), expected.ceilingHz);
  }

  assert.equal(validateDeviceCapabilitySemantics(
    oneRateRecord({ speed: 'HIGH', bInterval: 16, requestedHz: 250 }),
  ).valid, true);
  assertRejected(
    oneRateRecord({ speed: 'HIGH', bInterval: 16, requestedHz: 500 }),
    'RATE_EXCEEDS_ENDPOINT_CEILING',
    'rateCapabilities[0].requestedHz',
  );
});

test('SuperSpeed keeps the stricter unclamped service-interval formula', () => {
  for (const speed of ['SUPER', 'SUPER_PLUS']) {
    assert.deepEqual(getDocumentedPollingPeriod(speed, 6), { unit: 'MICROFRAME', period: 32 });
    assert.deepEqual(getDocumentedPollingPeriod(speed, 7), { unit: 'MICROFRAME', period: 64 });
    assert.equal(getInterruptCeilingHz(speed, 7), 125);
    assertRejected(
      oneRateRecord({ speed, bInterval: 7, requestedHz: 250 }),
      'RATE_EXCEEDS_ENDPOINT_CEILING',
      'rateCapabilities[0].requestedHz',
    );
  }
});

test('out-of-range and non-integer intervals resolve to no documented period', () => {
  const invalidCases = [
    ['FULL', 0],
    ['FULL', 256],
    ['HIGH', 0],
    ['HIGH', 17],
    ['SUPER', 17],
    ['SUPER_PLUS', 17],
    ['LOW', 1],
    ['FULL', 1.5],
    ['HIGH', null],
  ];

  for (const [speed, bInterval] of invalidCases) {
    assert.equal(getDocumentedPollingPeriod(speed, bInterval), null, `${speed} ${bInterval}`);
    assert.equal(getInterruptCeilingHz(speed, bInterval), null);
  }
});

test('an unresolved schedule mechanism cannot cite documented-interface provenance', () => {
  const record = fixture();
  record.rateCapabilities[0].scheduleMechanismRefs = ['P-010'];

  assertRejected(
    record,
    'SCHEDULE_MECHANISM_REFS_FORBIDDEN',
    'rateCapabilities[0].scheduleMechanismRefs',
  );
  const combined = validateDeviceCapabilityRecord(record);
  assert.equal(combined.valid, false);
  assert.ok(combined.errors.some((error) => error.code === 'SCHEMA_MAXITEMS'));
});

test('a documented schedule mechanism requires declared provenance references', () => {
  for (const mechanism of ['DOCUMENTED_WDF', 'DOCUMENTED_DEVICE_VENDOR']) {
    const missing = fixture();
    setRateResult(missing, 0, 'SUPPORTED');
    missing.rateCapabilities[0].scheduleMechanism = mechanism;
    missing.rateCapabilities[0].scheduleMechanismRefs = [];
    assertRejected(
      missing,
      'SCHEDULE_MECHANISM_REFS_REQUIRED',
      'rateCapabilities[0].scheduleMechanismRefs',
    );

    const undeclared = fixture();
    setRateResult(undeclared, 0, 'SUPPORTED');
    undeclared.rateCapabilities[0].scheduleMechanism = mechanism;
    undeclared.rateCapabilities[0].scheduleMechanismRefs = ['P-024'];
    assertRejected(
      undeclared,
      'SCHEDULE_MECHANISM_REF_NOT_DECLARED',
      'rateCapabilities[0].scheduleMechanismRefs[0]',
    );
  }
});

test('provenance references must resolve against the clean-room ledger', () => {
  const ledgerIds = readProvenanceLedgerIds();

  assert.ok(ledgerIds.has('P-001'));
  assert.ok(ledgerIds.has('P-024'));
  assert.equal(ledgerIds.has('P-999'), false);

  const record = fixture();
  setRateResult(record, 0, 'SUPPORTED');
  assert.deepEqual(validateProvenanceRefsResolve(record, ledgerIds), { valid: true, errors: [] });

  const unknownRecordRef = fixture();
  unknownRecordRef.provenanceRefs = [...unknownRecordRef.provenanceRefs, 'P-999'];
  const recordResult = validateProvenanceRefsResolve(unknownRecordRef, ledgerIds);
  assert.equal(recordResult.valid, false);
  assert.equal(recordResult.errors[0].code, 'PROVENANCE_REF_NOT_IN_LEDGER');
  assert.equal(recordResult.errors[0].path, 'provenanceRefs[5]');

  const unknownMechanismRef = fixture();
  setRateResult(unknownMechanismRef, 0, 'SUPPORTED');
  unknownMechanismRef.provenanceRefs = [...unknownMechanismRef.provenanceRefs, 'P-998'];
  unknownMechanismRef.rateCapabilities[0].scheduleMechanismRefs = ['P-998'];
  const mechanismResult = validateProvenanceRefsResolve(unknownMechanismRef, ledgerIds);
  assert.equal(mechanismResult.valid, false);
  assert.ok(mechanismResult.errors.some(
    (error) => error.path === 'rateCapabilities[0].scheduleMechanismRefs[0]',
  ));
});

test('an empty or unreadable provenance ledger fails closed', () => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'dialed-ledger-'));
  const emptyLedgerPath = path.join(temporaryDirectory, 'EMPTY_LEDGER.md');
  try {
    fs.writeFileSync(emptyLedgerPath, '# No entries\n', 'utf8');
    assert.throws(
      () => readProvenanceLedgerIds(emptyLedgerPath),
      /declares no P-### entries/,
    );
    assert.throws(
      () => readProvenanceLedgerIds(path.join(temporaryDirectory, 'missing.md')),
      (error) => error.code === 'ENOENT',
    );
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
  assert.equal(path.basename(PROVENANCE_LEDGER_PATH), 'PROVENANCE_LEDGER.md');
});

test('the validator CLI rejects a record citing an unledgered source', () => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'dialed-capability-ledger-'));
  const recordPath = path.join(temporaryDirectory, 'unledgered.json');
  try {
    const record = fixture();
    record.provenanceRefs = [...record.provenanceRefs, 'P-997'];
    fs.writeFileSync(recordPath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
    const result = spawnSync(process.execPath, [VALIDATOR_PATH, recordPath], { encoding: 'utf8' });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /PROVENANCE_REF_NOT_IN_LEDGER at provenanceRefs/);
    assert.doesNotMatch(result.stdout, /valid/);
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test('low-speed devices are explicitly out of scope rather than silently unrecordable', () => {
  const speedSchema = schema.properties.topology.properties.negotiatedSpeed;

  assert.deepEqual(speedSchema.enum, ['FULL', 'HIGH', 'SUPER', 'SUPER_PLUS']);
  assert.match(speedSchema.description, /Low-speed devices are deliberately out of scope/);
  assert.match(speedSchema.description, /P-010 and P-024/);

  const record = fixture();
  record.topology.negotiatedSpeed = 'LOW';
  const structural = validateDeviceCapabilityStructure(record);

  assert.equal(structural.valid, false);
  assert.ok(structural.errors.some(
    (error) => error.code === 'SCHEMA_ENUM' && error.path === 'topology.negotiatedSpeed',
  ));
  assert.equal(getDocumentedPollingPeriod('LOW', 1), null);
});
