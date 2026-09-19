const assert = require('node:assert/strict');
const { tempDir } = require('./helpers/temp-dir.cjs');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  ALLOWED_DELTA_BY_OPERATION,
  ALLOWED_TRANSITIONS,
  MUTATING_OPERATIONS,
  assertTargetBindingChain,
  assertTargetBindingRecord,
  validateTargetBindingAgainstCapability,
  validateTargetBindingChain,
  validateTargetBindingRecord,
  validateTargetBindingSemantics,
  validateTargetBindingStructure,
} = require('../native/dialed-input-filter/target-binding-validator.cjs');

const BOUNDARY = path.join(__dirname, '..', 'native', 'dialed-input-filter');
const FIXTURE_PATH = path.join(BOUNDARY, 'fixtures', 'target-binding.attach.example.json');
const CAPABILITY_FIXTURE_PATH = path.join(
  BOUNDARY,
  'fixtures',
  'device-capability.high-speed.example.json',
);
const VALIDATOR_PATH = path.join(BOUNDARY, 'target-binding-validator.cjs');

const OPERATION_LIFECYCLE = Object.freeze({
  OBSERVE_STATE: { previousState: 'FILTER_ATTACHED', state: 'FILTER_ATTACHED' },
  PREVIEW: { previousState: 'PACKAGE_INSTALLED', state: 'PREVIEW_ISSUED' },
  RECONCILE_AFTER_RESTART: { previousState: 'RESTART_REQUIRED', state: 'FILTER_ATTACHED' },
  INSTALL_PACKAGE: { previousState: 'PREVIEW_ISSUED', state: 'PACKAGE_INSTALLED' },
  ATTACH_SELECTED_DEVICE: { previousState: 'PACKAGE_INSTALLED', state: 'FILTER_ATTACHED' },
  DETACH_SELECTED_DEVICE: { previousState: 'FILTER_ATTACHED', state: 'DETACH_VERIFIED' },
  REPAIR_EXACT_PACKAGE: { previousState: 'PACKAGE_INSTALLED', state: 'PACKAGE_INSTALLED' },
  UPGRADE_EXACT_PREDECESSOR: { previousState: 'PACKAGE_INSTALLED', state: 'PACKAGE_INSTALLED' },
  REMOVE_DETACHED_PACKAGE: { previousState: 'DETACH_VERIFIED', state: 'PACKAGE_REMOVED' },
});

function binding() {
  return JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8'));
}

function capabilityRecord() {
  return JSON.parse(fs.readFileSync(CAPABILITY_FIXTURE_PATH, 'utf8'));
}

function supportedCapability() {
  const capability = capabilityRecord();
  const rate = capability.rateCapabilities[0];
  const artifactSha256 = '7'.repeat(64);

  capability.status = 'SUPPORTED';
  capability.provenanceRefs = [...capability.provenanceRefs, 'P-025'];
  rate.result = 'SUPPORTED';
  rate.scheduleMechanism = 'DOCUMENTED_WDF';
  rate.scheduleMechanismRefs = ['P-025'];
  for (const evidenceField of ['configuredEvidence', 'driverSessionEvidence', 'usbBusEvidence']) {
    rate[evidenceField] = {
      status: 'PASS',
      method: 'Synthetic supported-capability fixture only',
      artifactSha256,
    };
  }

  return capability;
}

function forOperation(operation) {
  const record = binding();
  record.operation = operation;
  record.lifecycle.previousState = OPERATION_LIFECYCLE[operation].previousState;
  record.lifecycle.state = OPERATION_LIFECYCLE[operation].state;
  record.declaredDelta = ALLOWED_DELTA_BY_OPERATION[operation];
  return record;
}

function assertRejected(record, code, expectedPath = null) {
  const result = validateTargetBindingSemantics(record);
  assert.equal(result.valid, false, `Expected ${code}, received ${JSON.stringify(result.errors)}`);
  const error = result.errors.find((candidate) => candidate.code === code);
  assert.ok(error, `Expected ${code}, received ${JSON.stringify(result.errors)}`);
  if (expectedPath !== null) assert.equal(error.path, expectedPath);
  return result;
}

test('the synthetic attach fixture satisfies structure and semantics', () => {
  const record = binding();

  assert.deepEqual(validateTargetBindingStructure(record), { valid: true, errors: [] });
  assert.deepEqual(validateTargetBindingSemantics(record), { valid: true, errors: [] });
  assert.equal(assertTargetBindingRecord(record), record);
  assert.equal(record.schedule.status, 'BLOCKED_PENDING_DOCUMENTED_INTERFACE');
});

test('every documented operation has a valid representative record', () => {
  for (const operation of Object.keys(ALLOWED_TRANSITIONS)) {
    const result = validateTargetBindingRecord(forOperation(operation));
    assert.equal(result.valid, true, `${operation}: ${JSON.stringify(result.errors)}`);
  }
});

test('structural validation fails closed on an incomplete record', () => {
  const structural = validateTargetBindingStructure({ recordKind: 'TARGET_BINDING' });
  const combined = validateTargetBindingRecord({ recordKind: 'TARGET_BINDING' });

  assert.equal(structural.valid, false);
  assert.ok(structural.errors.some((error) => error.code === 'SCHEMA_REQUIRED'));
  assert.equal(combined.valid, false);
  assert.throws(() => assertTargetBindingRecord({ recordKind: 'TARGET_BINDING' }), TypeError);
});

test('durable NEEDS_REVIEW never resumes a partial operation', () => {
  for (const operation of MUTATING_OPERATIONS) {
    const record = forOperation(operation);
    record.lifecycle.previousState = 'NEEDS_REVIEW';
    assertRejected(record, 'NEEDS_REVIEW_IS_DURABLE', 'operation');
  }

  const observed = forOperation('OBSERVE_STATE');
  observed.lifecycle.previousState = 'NEEDS_REVIEW';
  observed.lifecycle.state = 'NEEDS_REVIEW';
  assert.equal(validateTargetBindingSemantics(observed).valid, true);
});

test('observation may not change lifecycle state', () => {
  const record = forOperation('OBSERVE_STATE');
  record.lifecycle.state = 'PACKAGE_INSTALLED';

  assertRejected(record, 'OBSERVATION_MUST_NOT_CHANGE_STATE', 'lifecycle.state');
});

test('RESTART_REQUIRED is left only by explicit reconciliation', () => {
  for (const operation of ['ATTACH_SELECTED_DEVICE', 'DETACH_SELECTED_DEVICE', 'REMOVE_DETACHED_PACKAGE']) {
    const record = forOperation(operation);
    record.lifecycle.previousState = 'RESTART_REQUIRED';
    assertRejected(record, 'LIFECYCLE_TRANSITION_NOT_ALLOWED', 'lifecycle.previousState');
  }

  assert.equal(validateTargetBindingSemantics(forOperation('RECONCILE_AFTER_RESTART')).valid, true);
});

test('each operation refuses an out-of-order start and an impossible outcome', () => {
  const record = forOperation('INSTALL_PACKAGE');
  record.lifecycle.previousState = 'DETACH_VERIFIED';
  assertRejected(record, 'LIFECYCLE_TRANSITION_NOT_ALLOWED', 'lifecycle.previousState');

  const outcome = forOperation('ATTACH_SELECTED_DEVICE');
  outcome.lifecycle.state = 'PACKAGE_REMOVED';
  assertRejected(outcome, 'LIFECYCLE_TRANSITION_NOT_ALLOWED', 'lifecycle.state');

  for (const terminalState of ['NEEDS_REVIEW', 'NOT_APPLIED']) {
    const terminal = forOperation('ATTACH_SELECTED_DEVICE');
    terminal.lifecycle.state = terminalState;
    assert.equal(validateTargetBindingSemantics(terminal).valid, true, terminalState);
  }
});

test('every operation declares exactly one allowed semantic delta', () => {
  const deltas = new Set(Object.values(ALLOWED_DELTA_BY_OPERATION));

  for (const operation of Object.keys(ALLOWED_DELTA_BY_OPERATION)) {
    for (const delta of deltas) {
      if (delta === ALLOWED_DELTA_BY_OPERATION[operation]) continue;
      const record = forOperation(operation);
      record.declaredDelta = delta;
      assertRejected(record, 'UNEXPECTED_DELTA', 'declaredDelta');
    }
  }
});

test('mutations are refused outside a started device', () => {
  const blockingStates = [
    'D3_SUSPENDED',
    'QUERY_REMOVE_PENDING',
    'SURPRISE_REMOVAL',
    'REMOVED',
    'RESTART_PENDING_FAST_STARTUP',
  ];

  for (const operation of MUTATING_OPERATIONS) {
    for (const pnpPowerState of blockingStates) {
      const record = forOperation(operation);
      record.lifecycle.pnpPowerState = pnpPowerState;
      assertRejected(record, 'PNP_POWER_STATE_BLOCKS_MUTATION', 'lifecycle.pnpPowerState');
    }
  }

  const observed = forOperation('OBSERVE_STATE');
  observed.lifecycle.pnpPowerState = 'SURPRISE_REMOVAL';
  assert.equal(validateTargetBindingSemantics(observed).valid, true);
});

test('an incomplete inventory blocks every mutation but not observation', () => {
  for (const operation of MUTATING_OPERATIONS) {
    const record = forOperation(operation);
    record.inventory.completeness = 'INCOMPLETE';
    assertRejected(record, 'INCOMPLETE_INVENTORY_BLOCKS_MUTATION', 'inventory.completeness');
  }

  const observed = forOperation('OBSERVE_STATE');
  observed.inventory.completeness = 'INCOMPLETE';
  assert.equal(validateTargetBindingSemantics(observed).valid, true);
});

test('exactly one inventory entry may be the selected target', () => {
  const none = binding();
  none.inventory.entries[0].selected = false;
  assertRejected(none, 'SELECTED_ENTRY_NOT_UNIQUE', 'inventory.entries');

  const two = binding();
  two.inventory.entries[1].selected = true;
  assertRejected(two, 'SELECTED_ENTRY_NOT_UNIQUE', 'inventory.entries');
});

test('the selected entry must match the bound identity and declared scope', () => {
  const mismatch = binding();
  mismatch.selectedTarget.deviceInstanceIdDigest = 'e'.repeat(64);
  assertRejected(mismatch, 'SELECTED_ENTRY_IDENTITY_MISMATCH', 'inventory.entries[0]');

  const container = binding();
  container.selectedTarget.containerIdDigest = 'f'.repeat(64);
  assertRejected(container, 'SELECTED_ENTRY_IDENTITY_MISMATCH', 'inventory.entries[0]');

  const outOfScope = binding();
  outOfScope.inventory.entries[0].inSelectedScope = false;
  assertRejected(outOfScope, 'SELECTED_ENTRY_OUT_OF_SCOPE', 'inventory.entries[0].inSelectedScope');
});

test('attach and detach require a present selected device', () => {
  for (const operation of ['ATTACH_SELECTED_DEVICE', 'DETACH_SELECTED_DEVICE']) {
    for (const presence of ['NOT_PRESENT', 'PHANTOM']) {
      const record = forOperation(operation);
      record.inventory.entries[0].presence = presence;
      assertRejected(record, 'SELECTED_TARGET_NOT_PRESENT', 'inventory.entries[0].presence');
    }
  }

  const install = forOperation('INSTALL_PACKAGE');
  install.inventory.entries[0].presence = 'NOT_PRESENT';
  assert.equal(validateTargetBindingSemantics(install).valid, true);
});

test('two entries may not resolve to the same device instance identity', () => {
  const record = binding();
  record.inventory.entries[1].deviceInstanceIdDigest = record.inventory.entries[0].deviceInstanceIdDigest;

  assertRejected(
    record,
    'AMBIGUOUS_INVENTORY_IDENTITY',
    'inventory.entries[1].deviceInstanceIdDigest',
  );
});

test('a scope may never cross into another physical device container', () => {
  const record = binding();
  record.inventory.entries[2].inSelectedScope = true;

  assertRejected(record, 'SCOPE_CROSSES_PHYSICAL_DEVICE', 'inventory.entries[2].inSelectedScope');
});

test('each composite scope requires an unambiguous interface set', () => {
  const single = binding();
  single.inventory.entries[1].inSelectedScope = true;
  assertRejected(single, 'AMBIGUOUS_COMPOSITE_SCOPE', 'selectedTarget.compositeScope');

  const multiTooFew = binding();
  multiTooFew.selectedTarget.compositeScope = 'MULTI_INTERFACE';
  assertRejected(multiTooFew, 'AMBIGUOUS_COMPOSITE_SCOPE', 'selectedTarget.compositeScope');

  const multiValid = binding();
  multiValid.selectedTarget.compositeScope = 'MULTI_INTERFACE';
  multiValid.inventory.entries[1].inSelectedScope = true;
  assert.equal(validateTargetBindingSemantics(multiValid).valid, true);

  const wholeIncomplete = binding();
  wholeIncomplete.selectedTarget.compositeScope = 'WHOLE_PHYSICAL_DEVICE';
  wholeIncomplete.selectedTarget.hardwareIds = ['USB\\VID_FFFE&PID_0001'];
  assertRejected(wholeIncomplete, 'AMBIGUOUS_COMPOSITE_SCOPE', 'selectedTarget.compositeScope');

  const wholeValid = binding();
  wholeValid.selectedTarget.compositeScope = 'WHOLE_PHYSICAL_DEVICE';
  wholeValid.selectedTarget.hardwareIds = ['USB\\VID_FFFE&PID_0001'];
  wholeValid.inventory.entries[1].inSelectedScope = true;
  assert.equal(validateTargetBindingSemantics(wholeValid).valid, true);
});

test('over-broad hardware identifiers are refused', () => {
  const broadIdentifiers = [
    'USB\\Class_03&SubClass_01',
    'USB\\VID_FFFE&PID_*',
    'HID_DEVICE_SYSTEM_MOUSE',
    'USB\\COMPOSITE',
  ];

  for (const identifier of broadIdentifiers) {
    const record = binding();
    record.selectedTarget.hardwareIds = [identifier];
    assertRejected(record, 'HARDWARE_ID_NOT_DEVICE_SPECIFIC', 'selectedTarget.hardwareIds[0]');
  }

  const nonUsb = binding();
  nonUsb.selectedTarget.hardwareIds = ['BTHENUM\\VID_FFFE&PID_0001&MI_00'];
  assertRejected(nonUsb, 'HARDWARE_ID_NOT_DEVICE_SPECIFIC', 'selectedTarget.hardwareIds[0]');

  const missingProduct = binding();
  missingProduct.selectedTarget.hardwareIds = ['USB\\VID_FFFE&MI_00&REV_0100'];
  assertRejected(missingProduct, 'HARDWARE_ID_NOT_DEVICE_SPECIFIC', 'selectedTarget.hardwareIds[0]');
});

test('an interface-scoped binding requires an interface-specific identifier', () => {
  for (const compositeScope of ['SINGLE_INTERFACE', 'MULTI_INTERFACE']) {
    const record = binding();
    record.selectedTarget.compositeScope = compositeScope;
    record.selectedTarget.hardwareIds = ['USB\\VID_FFFE&PID_0001&REV_0100'];
    assertRejected(record, 'HARDWARE_ID_MISSING_INTERFACE_SCOPE', 'selectedTarget.hardwareIds[0]');
  }
});

test('endpoint keys must be unique and belong to the bound interface', () => {
  const duplicate = binding();
  duplicate.selectedTarget.endpointKeys = ['if0-ep81', 'if0-ep81'];
  assertRejected(duplicate, 'DUPLICATE_ENDPOINT_KEY', 'selectedTarget.endpointKeys[1]');
  assert.equal(validateTargetBindingStructure(duplicate).valid, false);

  const otherInterface = binding();
  otherInterface.selectedTarget.endpointKeys = ['if1-ep81'];
  assertRejected(otherInterface, 'ENDPOINT_KEY_INTERFACE_MISMATCH', 'selectedTarget.endpointKeys[0]');
});

test('mutations require a sealed and current preimage', () => {
  for (const operation of MUTATING_OPERATIONS) {
    const unsealed = forOperation(operation);
    unsealed.recovery.sealed = false;
    assertRejected(unsealed, 'RECOVERY_PREIMAGE_NOT_SEALED', 'recovery.sealed');

    const stale = forOperation(operation);
    stale.recovery.observedStateDigest = '9'.repeat(64);
    assertRejected(stale, 'STALE_PREIMAGE_REFUSED', 'recovery.observedStateDigest');
  }

  const observed = forOperation('OBSERVE_STATE');
  observed.recovery.sealed = false;
  observed.recovery.observedStateDigest = '9'.repeat(64);
  assert.equal(validateTargetBindingSemantics(observed).valid, true);
});

test('the recovery checkpoint chain must be exact in both directions', () => {
  const firstWithPredecessor = binding();
  firstWithPredecessor.recovery.checkpointIndex = 0;
  assertRejected(firstWithPredecessor, 'CHECKPOINT_CHAIN_BROKEN', 'recovery.previousCheckpointDigest');

  const continuedWithoutPredecessor = binding();
  continuedWithoutPredecessor.recovery.previousCheckpointDigest = null;
  assertRejected(
    continuedWithoutPredecessor,
    'CHECKPOINT_CHAIN_BROKEN',
    'recovery.previousCheckpointDigest',
  );

  const firstCheckpoint = binding();
  firstCheckpoint.recovery.checkpointIndex = 0;
  firstCheckpoint.recovery.previousCheckpointDigest = null;
  assert.equal(validateTargetBindingSemantics(firstCheckpoint).valid, true);
});

test('no schedule may be requested while the documented-interface gate is blocked', () => {
  const requested = binding();
  requested.schedule.requestedHz = 8000;
  assertRejected(requested, 'SCHEDULE_REQUEST_WHILE_BLOCKED', 'schedule');
  assert.equal(validateTargetBindingStructure(requested).valid, false);

  const mechanism = binding();
  mechanism.schedule.mechanism = 'DOCUMENTED_WDF';
  assertRejected(mechanism, 'SCHEDULE_REQUEST_WHILE_BLOCKED', 'schedule');

  const refs = binding();
  refs.schedule.mechanismRefs = ['P-024'];
  assertRejected(refs, 'SCHEDULE_REQUEST_WHILE_BLOCKED', 'schedule');
});

test('an approved schedule must carry a documented mechanism, provenance and rate', () => {
  const incomplete = binding();
  incomplete.schedule.status = 'DOCUMENTED_MECHANISM_APPROVED';
  assertRejected(incomplete, 'SCHEDULE_APPROVAL_INCOMPLETE', 'schedule');

  const missingRefs = binding();
  missingRefs.schedule = {
    status: 'DOCUMENTED_MECHANISM_APPROVED',
    mechanism: 'DOCUMENTED_WDF',
    mechanismRefs: [],
    requestedHz: 1000,
  };
  assertRejected(missingRefs, 'SCHEDULE_APPROVAL_INCOMPLETE', 'schedule');

  const complete = binding();
  complete.schedule = {
    status: 'DOCUMENTED_MECHANISM_APPROVED',
    mechanism: 'DOCUMENTED_DEVICE_VENDOR',
    mechanismRefs: ['P-024'],
    requestedHz: 1000,
  };
  assert.equal(validateTargetBindingRecord(complete).valid, true);
});

test('package removal requires every managed attachment, including phantom scope, to be absent', () => {
  for (const presence of ['PRESENT', 'NOT_PRESENT', 'PHANTOM']) {
    const record = forOperation('REMOVE_DETACHED_PACKAGE');
    record.inventory.entries[2].presence = presence;
    record.inventory.entries[2].dialedManaged = true;
    record.inventory.entries[2].filterAttached = true;
    assertRejected(
      record,
      'REMOVE_REQUIRES_NO_MANAGED_ATTACHMENT',
      'inventory.entries[2].filterAttached',
    );
  }

  const clean = forOperation('REMOVE_DETACHED_PACKAGE');
  assert.equal(validateTargetBindingSemantics(clean).valid, true);
});

test('a binding is cross-checked against its compatibility-class record', () => {
  const record = binding();
  const capability = capabilityRecord();

  assert.deepEqual(
    validateTargetBindingAgainstCapability(record, capability),
    { valid: true, errors: [] },
  );

  const otherClass = binding();
  otherClass.selectedTarget.compatibilityClassId = 'fixture-other-class-v1';
  assert.equal(
    validateTargetBindingAgainstCapability(otherClass, capability).errors[0].code,
    'COMPATIBILITY_CLASS_MISMATCH',
  );

  const unknownEndpoint = binding();
  unknownEndpoint.selectedTarget.endpointKeys = ['if0-ep82'];
  assert.equal(
    validateTargetBindingAgainstCapability(unknownEndpoint, capability).errors[0].code,
    'ENDPOINT_NOT_IN_CAPABILITY_RECORD',
  );

  const outEndpoint = capabilityRecord();
  outEndpoint.deviceMatch.endpoints[0].direction = 'OUT';
  assert.ok(validateTargetBindingAgainstCapability(record, outEndpoint).errors.some(
    (error) => error.code === 'ENDPOINT_NOT_INTERRUPT_IN',
  ));
});

test('a binding must match the capability hardware identity, interface, and composite scope', () => {
  const wrongHardware = binding();
  wrongHardware.selectedTarget.hardwareIds = ['USB\\VID_ABCD&PID_0001&MI_00'];
  assert.ok(validateTargetBindingAgainstCapability(wrongHardware, capabilityRecord()).errors.some(
    (error) => error.code === 'HARDWARE_ID_NOT_IN_CAPABILITY_RECORD',
  ));

  const wrongScope = capabilityRecord();
  wrongScope.deviceMatch.compositeScope = 'MULTI_INTERFACE';
  assert.ok(validateTargetBindingAgainstCapability(binding(), wrongScope).errors.some(
    (error) => error.code === 'COMPOSITE_SCOPE_MISMATCH',
  ));

  const wrongInterface = binding();
  wrongInterface.selectedTarget.interfaceNumber = 1;
  wrongInterface.selectedTarget.hardwareIds = ['USB\\VID_FFFE&PID_0001&MI_01'];
  wrongInterface.selectedTarget.endpointKeys = ['if1-ep81'];
  const interfaceResult = validateTargetBindingAgainstCapability(wrongInterface, capabilityRecord());
  assert.ok(interfaceResult.errors.some(
    (error) => error.code === 'INTERFACE_NOT_IN_CAPABILITY_RECORD',
  ));
});

test('an approved binding must reuse the capability rate mechanism, provenance, and endpoint set', () => {
  const capability = supportedCapability();
  const record = binding();
  record.schedule = {
    status: 'DOCUMENTED_MECHANISM_APPROVED',
    mechanism: 'DOCUMENTED_WDF',
    mechanismRefs: ['P-025'],
    requestedHz: 1000,
  };

  assert.deepEqual(
    validateTargetBindingAgainstCapability(record, capability),
    { valid: true, errors: [] },
  );

  const wrongMechanism = structuredClone(record);
  wrongMechanism.schedule.mechanism = 'DOCUMENTED_DEVICE_VENDOR';
  assert.ok(validateTargetBindingAgainstCapability(wrongMechanism, capability).errors.some(
    (error) => error.code === 'SCHEDULE_MECHANISM_MISMATCH',
  ));

  const wrongProvenance = structuredClone(record);
  wrongProvenance.schedule.mechanismRefs = ['P-010'];
  assert.ok(validateTargetBindingAgainstCapability(wrongProvenance, capability).errors.some(
    (error) => error.code === 'SCHEDULE_PROVENANCE_MISMATCH',
  ));

  const wrongEndpoints = structuredClone(record);
  wrongEndpoints.selectedTarget.endpointKeys = ['if0-ep82'];
  assert.ok(validateTargetBindingAgainstCapability(wrongEndpoints, capability).errors.some(
    (error) => error.code === 'RATE_ENDPOINT_SCOPE_MISMATCH',
  ));
});

test('an unverified compatibility class cannot authorise a rate request', () => {
  const record = binding();
  record.schedule = {
    status: 'DOCUMENTED_MECHANISM_APPROVED',
    mechanism: 'DOCUMENTED_DEVICE_VENDOR',
    mechanismRefs: ['P-024'],
    requestedHz: 8000,
  };

  const result = validateTargetBindingAgainstCapability(record, capabilityRecord());
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.code === 'RATE_NOT_SUPPORTED_BY_CAPABILITY'));
});

test('semantic error ordering is deterministic', () => {
  const record = binding();
  record.inventory.completeness = 'INCOMPLETE';
  record.declaredDelta = 'PACKAGE_REMOVED';
  record.selectedTarget.hardwareIds = ['USB\\Class_03'];
  record.recovery.sealed = false;

  const first = validateTargetBindingSemantics(record);
  const second = validateTargetBindingSemantics(structuredClone(record));

  assert.deepEqual(second, first);
  assert.equal(first.valid, false);
  assert.ok(first.errors.length >= 4);
});

test('the assertion helper exposes deterministic validation errors', () => {
  const record = binding();
  record.recovery.sealed = false;

  assert.throws(
    () => assertTargetBindingRecord(record),
    (error) => {
      assert.equal(error instanceof TypeError, true);
      assert.ok(error.validationErrors.some((entry) => entry.code === 'RECOVERY_PREIMAGE_NOT_SEALED'));
      return true;
    },
  );
});

test('the CLI reports the fixture as valid and fails closed on a rejected record', () => {
  const valid = spawnSync(process.execPath, [VALIDATOR_PATH, FIXTURE_PATH], { encoding: 'utf8' });
  assert.equal(valid.status, 0);
  assert.match(valid.stdout, /valid \(ATTACH_SELECTED_DEVICE\)/);

  const temporaryDirectory = tempDir('dialed-binding-');
  const recordPath = path.join(temporaryDirectory, 'blocked.json');
  try {
    const record = binding();
    record.schedule.requestedHz = 4000;
    fs.writeFileSync(recordPath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
    const result = spawnSync(process.execPath, [VALIDATOR_PATH, recordPath], { encoding: 'utf8' });

    assert.equal(result.status, 1);
    assert.doesNotMatch(result.stdout, /valid/);
    assert.match(result.stderr, /SCHEMA_/);
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test('the binding boundary holds no installable payload', () => {
  const forbidden = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (/\.(?:inf|sys|cat|dll|exe)$/i.test(entry.name)) forbidden.push(absolute);
    }
  };
  visit(BOUNDARY);

  assert.deepEqual(forbidden, []);
});

const CHAIN_FIXTURE_PATH = path.join(
  BOUNDARY,
  'fixtures',
  'target-binding.lifecycle-chain.example.json',
);

function chain() {
  return JSON.parse(fs.readFileSync(CHAIN_FIXTURE_PATH, 'utf8'));
}

function assertChainRejected(records, code, expectedPath = null) {
  const result = validateTargetBindingChain(records);
  assert.equal(result.valid, false, `Expected ${code}, received ${JSON.stringify(result.errors)}`);
  const error = result.errors.find((candidate) => candidate.code === code);
  assert.ok(error, `Expected ${code}, received ${JSON.stringify(result.errors)}`);
  if (expectedPath !== null) assert.equal(error.path, expectedPath);
  return result;
}

test('the synthetic lifecycle chain covers preview through package removal', () => {
  const records = chain();

  assert.deepEqual(records.map((record) => record.operation), [
    'PREVIEW',
    'INSTALL_PACKAGE',
    'ATTACH_SELECTED_DEVICE',
    'RECONCILE_AFTER_RESTART',
    'DETACH_SELECTED_DEVICE',
    'REMOVE_DETACHED_PACKAGE',
  ]);
  assert.deepEqual(validateTargetBindingChain(records), { valid: true, errors: [] });
  assert.equal(assertTargetBindingChain(records), records);

  for (const record of records) {
    assert.equal(record.schedule.status, 'BLOCKED_PENDING_DOCUMENTED_INTERFACE');
    assert.equal(record.schedule.requestedHz, null);
  }
});

test('an empty chain is refused', () => {
  assert.equal(validateTargetBindingChain([]).errors[0].code, 'CHAIN_EMPTY');
  assert.equal(validateTargetBindingChain(null).errors[0].code, 'CHAIN_EMPTY');
});

test('a chain surfaces per-step errors with their step index', () => {
  const records = chain();
  records[2].recovery.sealed = false;

  assertChainRejected(records, 'RECOVERY_PREIMAGE_NOT_SEALED', 'records[2].recovery.sealed');
});

test('checkpoint indexes must be sequential and digests must link exactly', () => {
  const skipped = chain();
  skipped.splice(2, 1);
  assertChainRejected(skipped, 'CHECKPOINT_INDEX_NOT_SEQUENTIAL', 'records[2].recovery.checkpointIndex');

  const relinked = chain();
  relinked[3].recovery.previousCheckpointDigest = '7'.repeat(64);
  assertChainRejected(
    relinked,
    'CHECKPOINT_CHAIN_BROKEN',
    'records[3].recovery.previousCheckpointDigest',
  );

  const replayed = chain();
  replayed[4] = structuredClone(replayed[3]);
  assertChainRejected(replayed, 'CHECKPOINT_INDEX_NOT_SEQUENTIAL', 'records[4].recovery.checkpointIndex');
});

test('a reordered chain breaks lifecycle continuity', () => {
  const records = chain();
  const swapped = [records[0], records[2], records[1], records[3], records[4], records[5]];

  assertChainRejected(swapped, 'LIFECYCLE_STATE_NOT_CONTINUOUS', 'records[1].lifecycle.previousState');
});

test('a chain may not change the bound target identity', () => {
  const changedBinding = chain();
  changedBinding[3].bindingId = 'fixture-target-binding-other-v1';
  assertChainRejected(changedBinding, 'CHAIN_BINDING_ID_CHANGED', 'records[3].bindingId');

  for (const identityField of [
    'physicalDeviceDigest',
    'containerIdDigest',
    'deviceInstanceIdDigest',
    'compatibilityClassId',
  ]) {
    const records = chain();
    records[4].selectedTarget[identityField] = identityField === 'compatibilityClassId'
      ? 'fixture-other-class-v1'
      : '8'.repeat(64);
    const result = validateChainIdentity(records, identityField);
    assert.equal(result, `records[4].selectedTarget.${identityField}`);
  }
});

function validateChainIdentity(records, identityField) {
  const result = validateTargetBindingChain(records);
  const error = result.errors.find((candidate) => candidate.code === 'CHAIN_TARGET_IDENTITY_CHANGED');
  assert.ok(error, `Expected CHAIN_TARGET_IDENTITY_CHANGED for ${identityField}`);
  return error.path;
}

test('a new boot session is entered only through explicit reconciliation', () => {
  const silentRestart = chain();
  silentRestart[4].lifecycle.bootSessionDigest = '6'.repeat(64);
  silentRestart[5].lifecycle.bootSessionDigest = '6'.repeat(64);
  assertChainRejected(
    silentRestart,
    'BOOT_SESSION_CHANGED_WITHOUT_RECONCILE',
    'records[4].lifecycle.bootSessionDigest',
  );

  const reconcileWithoutRestart = chain();
  reconcileWithoutRestart[3].lifecycle.bootSessionDigest = reconcileWithoutRestart[2].lifecycle.bootSessionDigest;
  assertChainRejected(
    reconcileWithoutRestart,
    'RECONCILE_WITHOUT_BOOT_SESSION_CHANGE',
    'records[3].lifecycle.bootSessionDigest',
  );
});

test('a checkpoint may not reuse its predecessor digest', () => {
  const record = binding();
  record.recovery.checkpointDigest = record.recovery.previousCheckpointDigest;

  assertRejected(record, 'CHECKPOINT_CHAIN_BROKEN', 'recovery.checkpointDigest');
});

test('the CLI validates chains and cross-checks a capability record', () => {
  const chainResult = spawnSync(
    process.execPath,
    [VALIDATOR_PATH, '--chain', CHAIN_FIXTURE_PATH],
    { encoding: 'utf8' },
  );
  assert.equal(chainResult.status, 0);
  assert.match(chainResult.stdout, /valid \(chain of 6 steps\)/);

  const crossChecked = spawnSync(
    process.execPath,
    [VALIDATOR_PATH, '--capability', CAPABILITY_FIXTURE_PATH, FIXTURE_PATH],
    { encoding: 'utf8' },
  );
  assert.equal(crossChecked.status, 0);
  assert.match(crossChecked.stdout, /valid \(ATTACH_SELECTED_DEVICE\)/);

  const usage = spawnSync(process.execPath, [VALIDATOR_PATH, '--unknown'], { encoding: 'utf8' });
  assert.equal(usage.status, 2);
  assert.match(usage.stderr, /Unknown option --unknown/);

  const temporaryDirectory = tempDir('dialed-chain-');
  const recordPath = path.join(temporaryDirectory, 'mismatched.json');
  try {
    const record = binding();
    record.selectedTarget.compatibilityClassId = 'fixture-other-class-v1';
    fs.writeFileSync(recordPath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
    const result = spawnSync(
      process.execPath,
      [VALIDATOR_PATH, '--capability', CAPABILITY_FIXTURE_PATH, recordPath],
      { encoding: 'utf8' },
    );

    assert.equal(result.status, 1);
    assert.match(result.stderr, /COMPATIBILITY_CLASS_MISMATCH/);
    assert.doesNotMatch(result.stdout, /valid/);
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test('the CLI refuses an invalid or unledgered capability before cross-checking a binding', () => {
  const temporaryDirectory = tempDir('dialed-capability-crosscheck-');
  const invalidCapabilityPath = path.join(temporaryDirectory, 'invalid-capability.json');
  const unledgeredCapabilityPath = path.join(temporaryDirectory, 'unledgered-capability.json');

  try {
    fs.writeFileSync(invalidCapabilityPath, '{"schemaVersion":"1.0.0"}\n', 'utf8');
    const invalid = spawnSync(
      process.execPath,
      [VALIDATOR_PATH, '--capability', invalidCapabilityPath, FIXTURE_PATH],
      { encoding: 'utf8' },
    );
    assert.equal(invalid.status, 1);
    assert.match(invalid.stderr, /SCHEMA_REQUIRED/);
    assert.doesNotMatch(invalid.stdout, /valid/);

    const unledgered = capabilityRecord();
    unledgered.provenanceRefs.push('P-999');
    fs.writeFileSync(unledgeredCapabilityPath, `${JSON.stringify(unledgered, null, 2)}\n`, 'utf8');
    const unresolved = spawnSync(
      process.execPath,
      [VALIDATOR_PATH, '--capability', unledgeredCapabilityPath, FIXTURE_PATH],
      { encoding: 'utf8' },
    );
    assert.equal(unresolved.status, 1);
    assert.match(unresolved.stderr, /PROVENANCE_REF_NOT_IN_LEDGER/);
    assert.doesNotMatch(unresolved.stdout, /valid/);
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});
