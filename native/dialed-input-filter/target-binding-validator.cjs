'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Ajv2020 = require('ajv/dist/2020');

const targetBindingSchema = require('./schemas/target-binding.schema.json');
const {
  readProvenanceLedgerIds,
  validateDeviceCapabilityRecord,
  validateProvenanceRefsResolve,
} = require('./device-capability-validator.cjs');

/**
 * Operations that write native state. Every one of them must present a complete
 * inventory, a sealed and current preimage, a started device and exactly one
 * declared semantic delta before it may be authored.
 */
const MUTATING_OPERATIONS = Object.freeze([
  'INSTALL_PACKAGE',
  'ATTACH_SELECTED_DEVICE',
  'DETACH_SELECTED_DEVICE',
  'REPAIR_EXACT_PACKAGE',
  'UPGRADE_EXACT_PREDECESSOR',
  'REMOVE_DETACHED_PACKAGE',
]);

/** Operations that require the selected devnode to be physically present. */
const PRESENCE_REQUIRING_OPERATIONS = Object.freeze([
  'ATTACH_SELECTED_DEVICE',
  'DETACH_SELECTED_DEVICE',
]);

/** The single semantic delta each operation is allowed to declare. */
const ALLOWED_DELTA_BY_OPERATION = Object.freeze({
  OBSERVE_STATE: 'NONE',
  PREVIEW: 'NONE',
  RECONCILE_AFTER_RESTART: 'NONE',
  INSTALL_PACKAGE: 'PACKAGE_INSTALLED',
  ATTACH_SELECTED_DEVICE: 'SELECTED_ATTACHMENT_ADDED',
  DETACH_SELECTED_DEVICE: 'SELECTED_ATTACHMENT_REMOVED',
  REPAIR_EXACT_PACKAGE: 'PACKAGE_REPAIRED',
  UPGRADE_EXACT_PREDECESSOR: 'PACKAGE_UPGRADED',
  REMOVE_DETACHED_PACKAGE: 'PACKAGE_REMOVED',
});

/**
 * Allowed lifecycle transitions per operation. `RESTART_REQUIRED` is only left
 * through explicit reconciliation, and `NEEDS_REVIEW` is durable: it is left
 * only by observation, never by resuming a partial operation.
 */
const ALLOWED_TRANSITIONS = Object.freeze({
  OBSERVE_STATE: Object.freeze({ from: null, to: null }),
  PREVIEW: Object.freeze({
    from: ['READY_FOR_PREFLIGHT', 'PACKAGE_INSTALLED', 'FILTER_ATTACHED', 'DETACH_VERIFIED'],
    to: ['PREVIEW_ISSUED'],
  }),
  RECONCILE_AFTER_RESTART: Object.freeze({
    from: ['RESTART_REQUIRED'],
    to: ['FILTER_ATTACHED', 'PACKAGE_INSTALLED'],
  }),
  INSTALL_PACKAGE: Object.freeze({ from: ['PREVIEW_ISSUED'], to: ['PACKAGE_INSTALLED'] }),
  ATTACH_SELECTED_DEVICE: Object.freeze({
    from: ['PREVIEW_ISSUED', 'PACKAGE_INSTALLED'],
    to: ['FILTER_ATTACHED', 'RESTART_REQUIRED'],
  }),
  DETACH_SELECTED_DEVICE: Object.freeze({
    from: ['PREVIEW_ISSUED', 'FILTER_ATTACHED'],
    to: ['DETACH_VERIFIED', 'RESTART_REQUIRED'],
  }),
  REPAIR_EXACT_PACKAGE: Object.freeze({
    from: ['PREVIEW_ISSUED', 'PACKAGE_INSTALLED', 'FILTER_ATTACHED'],
    to: ['PACKAGE_INSTALLED', 'FILTER_ATTACHED'],
  }),
  UPGRADE_EXACT_PREDECESSOR: Object.freeze({
    from: ['PREVIEW_ISSUED', 'PACKAGE_INSTALLED', 'FILTER_ATTACHED'],
    to: ['PACKAGE_INSTALLED', 'FILTER_ATTACHED', 'RESTART_REQUIRED'],
  }),
  REMOVE_DETACHED_PACKAGE: Object.freeze({
    from: ['PREVIEW_ISSUED', 'DETACH_VERIFIED', 'PACKAGE_INSTALLED'],
    to: ['PACKAGE_REMOVED'],
  }),
});

/** Terminal outcomes any operation may report instead of its success state. */
const UNIVERSAL_TERMINAL_STATES = Object.freeze(['NEEDS_REVIEW', 'NOT_APPLIED']);

const MUTATION_SAFE_PNP_POWER_STATE = 'D0_STARTED';
const ENDPOINT_KEY_PATTERN = /^if([0-9]{1,3})-ep([0-9A-F]{2})$/;

/**
 * Over-broad match forms that must never target a Dialed filter. Windows
 * documents device identification strings as opaque values that should not be
 * parsed for meaning; these checks never derive device semantics, they only
 * refuse an identifier that is too broad to name one physical interface.
 */
const BROAD_MATCH_PATTERNS = Object.freeze([
  /\*/,
  /(^|\\)USB\\CLASS_/i,
  /(^|\\)HID_DEVICE(_|$)/i,
  /(^|\\)USB\\COMPOSITE\b/i,
]);

const schemaValidator = new Ajv2020({ allErrors: true, strict: true })
  .compile(targetBindingSchema);

function compareStrings(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function makeError(code, errorPath, message) {
  return { code, path: errorPath, message };
}

function pointerToPath(instancePath, propertyName = null) {
  const segments = String(instancePath || '')
    .split('/')
    .slice(1)
    .map((segment) => segment.replace(/~1/g, '/').replace(/~0/g, '~'));

  if (propertyName !== null) segments.push(String(propertyName));
  if (segments.length === 0) return '$';

  return segments.reduce((result, segment) => {
    if (/^(?:0|[1-9][0-9]*)$/.test(segment)) return `${result}[${segment}]`;
    return result.length === 0 ? segment : `${result}.${segment}`;
  }, '');
}

function sortErrors(errors) {
  errors.sort((left, right) => (
    compareStrings(left.path, right.path)
    || compareStrings(left.code, right.code)
    || compareStrings(left.message, right.message)
  ));
  return errors;
}

function validateTargetBindingStructure(record) {
  const valid = schemaValidator(record);
  if (valid) return { valid: true, errors: [] };

  const errors = (schemaValidator.errors || []).map((error) => {
    const propertyName = error.keyword === 'required'
      ? error.params.missingProperty
      : error.keyword === 'additionalProperties'
        ? error.params.additionalProperty
        : null;
    const errorPath = pointerToPath(error.instancePath, propertyName);
    const code = `SCHEMA_${String(error.keyword).replace(/[^A-Za-z0-9]+/g, '_').toUpperCase()}`;
    return makeError(code, errorPath, error.message || 'Schema validation failed.');
  });

  return { valid: false, errors: sortErrors(errors) };
}

function validateLifecycle(record, errors) {
  const operation = record?.operation;
  const previousState = record?.lifecycle?.previousState;
  const state = record?.lifecycle?.state;
  const transition = ALLOWED_TRANSITIONS[operation];

  if (previousState === 'NEEDS_REVIEW' && operation !== 'OBSERVE_STATE') {
    errors.push(makeError(
      'NEEDS_REVIEW_IS_DURABLE',
      'operation',
      'A durable NEEDS_REVIEW state is left only by observation, never by resuming an operation.',
    ));
    return;
  }

  if (transition === undefined) return;

  if (operation === 'OBSERVE_STATE') {
    if (previousState !== state) {
      errors.push(makeError(
        'OBSERVATION_MUST_NOT_CHANGE_STATE',
        'lifecycle.state',
        `Observation reported ${JSON.stringify(previousState)} to ${JSON.stringify(state)}; it may not change lifecycle state.`,
      ));
    }
    return;
  }

  if (!transition.from.includes(previousState)) {
    errors.push(makeError(
      'LIFECYCLE_TRANSITION_NOT_ALLOWED',
      'lifecycle.previousState',
      `Operation ${JSON.stringify(operation)} cannot start from ${JSON.stringify(previousState)}.`,
    ));
  }

  if (!transition.to.includes(state) && !UNIVERSAL_TERMINAL_STATES.includes(state)) {
    errors.push(makeError(
      'LIFECYCLE_TRANSITION_NOT_ALLOWED',
      'lifecycle.state',
      `Operation ${JSON.stringify(operation)} cannot end in ${JSON.stringify(state)}.`,
    ));
  }
}

function validateHardwareIds(record, errors) {
  const hardwareIds = Array.isArray(record?.selectedTarget?.hardwareIds)
    ? record.selectedTarget.hardwareIds
    : [];
  const compositeScope = record?.selectedTarget?.compositeScope;

  for (const [identifierIndex, identifier] of hardwareIds.entries()) {
    const identifierPath = `selectedTarget.hardwareIds[${identifierIndex}]`;
    const text = String(identifier);

    if (BROAD_MATCH_PATTERNS.some((pattern) => pattern.test(text))) {
      errors.push(makeError(
        'HARDWARE_ID_NOT_DEVICE_SPECIFIC',
        identifierPath,
        `Hardware identifier ${JSON.stringify(text)} matches more than one physical device.`,
      ));
      continue;
    }

    if (!/^USB\\/i.test(text) || !/VID_[0-9A-F]{4}/i.test(text) || !/PID_[0-9A-F]{4}/i.test(text)) {
      errors.push(makeError(
        'HARDWARE_ID_NOT_DEVICE_SPECIFIC',
        identifierPath,
        `Hardware identifier ${JSON.stringify(text)} does not name one exact USB device.`,
      ));
      continue;
    }

    if (compositeScope !== 'WHOLE_PHYSICAL_DEVICE' && !/MI_[0-9A-F]{2}/i.test(text)) {
      errors.push(makeError(
        'HARDWARE_ID_MISSING_INTERFACE_SCOPE',
        identifierPath,
        `Interface-scoped binding requires an interface-specific identifier; ${JSON.stringify(text)} is device-wide.`,
      ));
    }
  }
}

function validateEndpointKeys(record, errors) {
  const endpointKeys = Array.isArray(record?.selectedTarget?.endpointKeys)
    ? record.selectedTarget.endpointKeys
    : [];
  const interfaceNumber = record?.selectedTarget?.interfaceNumber;
  const seen = new Set();

  for (const [keyIndex, endpointKey] of endpointKeys.entries()) {
    const keyPath = `selectedTarget.endpointKeys[${keyIndex}]`;
    if (seen.has(endpointKey)) {
      errors.push(makeError(
        'DUPLICATE_ENDPOINT_KEY',
        keyPath,
        `Endpoint key ${JSON.stringify(endpointKey)} must resolve uniquely.`,
      ));
      continue;
    }
    seen.add(endpointKey);

    const parsed = ENDPOINT_KEY_PATTERN.exec(String(endpointKey));
    if (parsed !== null && Number(parsed[1]) !== interfaceNumber) {
      errors.push(makeError(
        'ENDPOINT_KEY_INTERFACE_MISMATCH',
        keyPath,
        `Endpoint key ${JSON.stringify(endpointKey)} does not belong to interface ${JSON.stringify(interfaceNumber)}.`,
      ));
    }
  }
}

function validateInventory(record, errors) {
  const operation = record?.operation;
  const entries = Array.isArray(record?.inventory?.entries) ? record.inventory.entries : [];
  const selectedTarget = record?.selectedTarget || {};
  const compositeScope = selectedTarget.compositeScope;
  const isMutating = MUTATING_OPERATIONS.includes(operation);

  if (isMutating && record?.inventory?.completeness !== 'COMPLETE') {
    errors.push(makeError(
      'INCOMPLETE_INVENTORY_BLOCKS_MUTATION',
      'inventory.completeness',
      'A mutating operation requires a complete present, non-present and phantom inventory.',
    ));
  }

  const seenInstances = new Set();
  const selectedIndexes = [];
  const inScopeIndexes = [];

  for (const [entryIndex, entry] of entries.entries()) {
    if (seenInstances.has(entry?.deviceInstanceIdDigest)) {
      errors.push(makeError(
        'AMBIGUOUS_INVENTORY_IDENTITY',
        `inventory.entries[${entryIndex}].deviceInstanceIdDigest`,
        'Two inventory entries resolve to the same device instance identity.',
      ));
    } else {
      seenInstances.add(entry?.deviceInstanceIdDigest);
    }

    if (entry?.selected === true) selectedIndexes.push(entryIndex);
    if (entry?.inSelectedScope === true) inScopeIndexes.push(entryIndex);
  }

  if (selectedIndexes.length !== 1) {
    errors.push(makeError(
      'SELECTED_ENTRY_NOT_UNIQUE',
      'inventory.entries',
      `Exactly one inventory entry must be the selected target; found ${selectedIndexes.length}.`,
    ));
    return;
  }

  const selectedIndex = selectedIndexes[0];
  const selectedEntry = entries[selectedIndex];

  if (selectedEntry.deviceInstanceIdDigest !== selectedTarget.deviceInstanceIdDigest
    || selectedEntry.containerIdDigest !== selectedTarget.containerIdDigest) {
    errors.push(makeError(
      'SELECTED_ENTRY_IDENTITY_MISMATCH',
      `inventory.entries[${selectedIndex}]`,
      'The selected inventory entry does not match the bound target identity.',
    ));
  }

  if (selectedEntry.inSelectedScope !== true) {
    errors.push(makeError(
      'SELECTED_ENTRY_OUT_OF_SCOPE',
      `inventory.entries[${selectedIndex}].inSelectedScope`,
      'The selected entry must be inside the declared composite scope.',
    ));
  }

  if (PRESENCE_REQUIRING_OPERATIONS.includes(operation) && selectedEntry.presence !== 'PRESENT') {
    errors.push(makeError(
      'SELECTED_TARGET_NOT_PRESENT',
      `inventory.entries[${selectedIndex}].presence`,
      `Operation ${JSON.stringify(operation)} requires a present selected device.`,
    ));
  }

  for (const entryIndex of inScopeIndexes) {
    if (entries[entryIndex].containerIdDigest !== selectedTarget.containerIdDigest) {
      errors.push(makeError(
        'SCOPE_CROSSES_PHYSICAL_DEVICE',
        `inventory.entries[${entryIndex}].inSelectedScope`,
        'A scoped entry belongs to a different physical device container.',
      ));
    }
  }

  const containerIndexes = entries
    .map((entry, entryIndex) => ({ entry, entryIndex }))
    .filter(({ entry }) => entry.containerIdDigest === selectedTarget.containerIdDigest);

  if (compositeScope === 'SINGLE_INTERFACE' && inScopeIndexes.length !== 1) {
    errors.push(makeError(
      'AMBIGUOUS_COMPOSITE_SCOPE',
      'selectedTarget.compositeScope',
      `SINGLE_INTERFACE scope must cover exactly one interface; found ${inScopeIndexes.length}.`,
    ));
  }

  if (compositeScope === 'MULTI_INTERFACE' && inScopeIndexes.length < 2) {
    errors.push(makeError(
      'AMBIGUOUS_COMPOSITE_SCOPE',
      'selectedTarget.compositeScope',
      `MULTI_INTERFACE scope must cover at least two interfaces; found ${inScopeIndexes.length}.`,
    ));
  }

  if (compositeScope === 'WHOLE_PHYSICAL_DEVICE'
    && inScopeIndexes.length !== containerIndexes.length) {
    errors.push(makeError(
      'AMBIGUOUS_COMPOSITE_SCOPE',
      'selectedTarget.compositeScope',
      'WHOLE_PHYSICAL_DEVICE scope must cover every interface of the selected container.',
    ));
  }

  if (operation === 'REMOVE_DETACHED_PACKAGE') {
    for (const [entryIndex, entry] of entries.entries()) {
      if (entry?.dialedManaged === true && entry?.filterAttached === true) {
        errors.push(makeError(
          'REMOVE_REQUIRES_NO_MANAGED_ATTACHMENT',
          `inventory.entries[${entryIndex}].filterAttached`,
          `Package removal requires every managed attachment, including ${entry.presence} scope, to be absent.`,
        ));
      }
    }
  }
}

function validateRecovery(record, errors) {
  const operation = record?.operation;
  const recovery = record?.recovery || {};
  const isMutating = MUTATING_OPERATIONS.includes(operation);

  if (recovery.checkpointIndex === 0 && recovery.previousCheckpointDigest !== null) {
    errors.push(makeError(
      'CHECKPOINT_CHAIN_BROKEN',
      'recovery.previousCheckpointDigest',
      'The first checkpoint cannot reference a predecessor.',
    ));
  }

  if (Number.isInteger(recovery.checkpointIndex)
    && recovery.checkpointIndex > 0
    && recovery.previousCheckpointDigest === null) {
    errors.push(makeError(
      'CHECKPOINT_CHAIN_BROKEN',
      'recovery.previousCheckpointDigest',
      'A continued checkpoint must reference its exact predecessor.',
    ));
  }

  if (!isMutating) return;

  if (recovery.sealed !== true) {
    errors.push(makeError(
      'RECOVERY_PREIMAGE_NOT_SEALED',
      'recovery.sealed',
      'A mutating operation requires a sealed preimage.',
    ));
  }

  if (recovery.preimageStateDigest !== recovery.observedStateDigest) {
    errors.push(makeError(
      'STALE_PREIMAGE_REFUSED',
      'recovery.observedStateDigest',
      'Observed native state no longer matches the sealed preimage.',
    ));
  }

  if (recovery.checkpointDigest === recovery.previousCheckpointDigest) {
    errors.push(makeError(
      'CHECKPOINT_CHAIN_BROKEN',
      'recovery.checkpointDigest',
      'A checkpoint cannot reuse its predecessor digest.',
    ));
  }
}

/**
 * Validate an ordered sequence of steps for one binding. A single step can be
 * individually well formed and still be a replay, a reorder, or a resumption
 * across an unobserved restart, so the chain rules are separate from the
 * per-record rules and both must pass.
 */
function validateTargetBindingChain(records) {
  if (!Array.isArray(records) || records.length === 0) {
    return {
      valid: false,
      errors: [makeError('CHAIN_EMPTY', 'records', 'A binding chain requires at least one step.')],
    };
  }

  const errors = [];

  for (const [stepIndex, record] of records.entries()) {
    const stepValidation = validateTargetBindingRecord(record);
    for (const error of stepValidation.errors) {
      errors.push(makeError(error.code, `records[${stepIndex}].${error.path}`, error.message));
    }
  }

  for (const [stepIndex, record] of records.entries()) {
    if (stepIndex === 0) continue;
    const previous = records[stepIndex - 1];
    const stepPath = `records[${stepIndex}]`;

    if (record?.bindingId !== previous?.bindingId) {
      errors.push(makeError(
        'CHAIN_BINDING_ID_CHANGED',
        `${stepPath}.bindingId`,
        'Every step of one chain must carry the same binding identity.',
      ));
    }

    for (const identityField of ['physicalDeviceDigest', 'containerIdDigest', 'deviceInstanceIdDigest', 'compatibilityClassId']) {
      if (record?.selectedTarget?.[identityField] !== previous?.selectedTarget?.[identityField]) {
        errors.push(makeError(
          'CHAIN_TARGET_IDENTITY_CHANGED',
          `${stepPath}.selectedTarget.${identityField}`,
          `The selected target ${identityField} changed mid-chain.`,
        ));
      }
    }

    if (record?.recovery?.checkpointIndex !== previous?.recovery?.checkpointIndex + 1) {
      errors.push(makeError(
        'CHECKPOINT_INDEX_NOT_SEQUENTIAL',
        `${stepPath}.recovery.checkpointIndex`,
        `Checkpoint ${JSON.stringify(record?.recovery?.checkpointIndex)} does not follow ${JSON.stringify(previous?.recovery?.checkpointIndex)}.`,
      ));
    }

    if (record?.recovery?.previousCheckpointDigest !== previous?.recovery?.checkpointDigest) {
      errors.push(makeError(
        'CHECKPOINT_CHAIN_BROKEN',
        `${stepPath}.recovery.previousCheckpointDigest`,
        'A step must reference the exact preceding checkpoint digest.',
      ));
    }

    if (record?.lifecycle?.previousState !== previous?.lifecycle?.state) {
      errors.push(makeError(
        'LIFECYCLE_STATE_NOT_CONTINUOUS',
        `${stepPath}.lifecycle.previousState`,
        `Step starts from ${JSON.stringify(record?.lifecycle?.previousState)} but the chain left ${JSON.stringify(previous?.lifecycle?.state)}.`,
      ));
    }

    const bootSessionChanged = record?.lifecycle?.bootSessionDigest
      !== previous?.lifecycle?.bootSessionDigest;
    const isReconcile = record?.operation === 'RECONCILE_AFTER_RESTART';

    if (bootSessionChanged && !isReconcile) {
      errors.push(makeError(
        'BOOT_SESSION_CHANGED_WITHOUT_RECONCILE',
        `${stepPath}.lifecycle.bootSessionDigest`,
        'A new boot session may only be entered through explicit reconciliation.',
      ));
    }

    if (isReconcile && !bootSessionChanged) {
      errors.push(makeError(
        'RECONCILE_WITHOUT_BOOT_SESSION_CHANGE',
        `${stepPath}.lifecycle.bootSessionDigest`,
        'Reconciliation must observe a new boot session after the required restart.',
      ));
    }
  }

  return { valid: errors.length === 0, errors: sortErrors(errors) };
}

function validateOperationGuards(record, errors) {
  const operation = record?.operation;
  const isMutating = MUTATING_OPERATIONS.includes(operation);
  const allowedDelta = ALLOWED_DELTA_BY_OPERATION[operation];

  if (allowedDelta !== undefined && record?.declaredDelta !== allowedDelta) {
    errors.push(makeError(
      'UNEXPECTED_DELTA',
      'declaredDelta',
      `Operation ${JSON.stringify(operation)} allows only ${JSON.stringify(allowedDelta)}.`,
    ));
  }

  if (isMutating && record?.lifecycle?.pnpPowerState !== MUTATION_SAFE_PNP_POWER_STATE) {
    errors.push(makeError(
      'PNP_POWER_STATE_BLOCKS_MUTATION',
      'lifecycle.pnpPowerState',
      `A mutating operation requires ${MUTATION_SAFE_PNP_POWER_STATE}, not ${JSON.stringify(record?.lifecycle?.pnpPowerState)}.`,
    ));
  }
}

function validateSchedule(record, errors) {
  const schedule = record?.schedule || {};

  if (schedule.status === 'BLOCKED_PENDING_DOCUMENTED_INTERFACE') {
    if (schedule.requestedHz !== null
      || schedule.mechanism !== 'UNRESOLVED'
      || (Array.isArray(schedule.mechanismRefs) && schedule.mechanismRefs.length > 0)) {
      errors.push(makeError(
        'SCHEDULE_REQUEST_WHILE_BLOCKED',
        'schedule',
        'No schedule may be requested while the documented-interface gate is blocked.',
      ));
    }
    return;
  }

  if (schedule.status === 'DOCUMENTED_MECHANISM_APPROVED') {
    if (schedule.mechanism === 'UNRESOLVED'
      || !Array.isArray(schedule.mechanismRefs)
      || schedule.mechanismRefs.length === 0
      || schedule.requestedHz === null) {
      errors.push(makeError(
        'SCHEDULE_APPROVAL_INCOMPLETE',
        'schedule',
        'An approved schedule requires a documented mechanism, its provenance and an exact rate.',
      ));
    }
  }
}

function validateTargetBindingSemantics(record) {
  const errors = [];

  validateLifecycle(record, errors);
  validateOperationGuards(record, errors);
  validateHardwareIds(record, errors);
  validateEndpointKeys(record, errors);
  validateInventory(record, errors);
  validateRecovery(record, errors);
  validateSchedule(record, errors);

  return { valid: errors.length === 0, errors: sortErrors(errors) };
}

function validateTargetBindingRecord(record) {
  const structural = validateTargetBindingStructure(record);
  if (!structural.valid) return { valid: false, errors: structural.errors };
  return validateTargetBindingSemantics(record);
}

function sameStringSet(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
  const leftSet = new Set(left);
  return leftSet.size === left.length && right.every((value) => leftSet.has(value));
}

function hardwareIdHasToken(hardwareId, tokenName, expectedValue) {
  const text = String(hardwareId);
  if (!/^USB\\/i.test(text)) return false;
  const expectedToken = `${tokenName}_${expectedValue}`.toUpperCase();
  return text
    .slice(4)
    .split('&')
    .some((token) => token.toUpperCase() === expectedToken);
}

/**
 * Cross-check a binding against the compatibility-class record that authorises
 * it. A binding may never name an endpoint, interface or class the capability
 * record does not declare, and it may not request a rate that record has not
 * marked SUPPORTED.
 */
function validateTargetBindingAgainstCapability(record, capabilityRecord) {
  const errors = [];
  const selectedTarget = record?.selectedTarget || {};
  const deviceMatch = capabilityRecord?.deviceMatch || {};
  const endpoints = Array.isArray(capabilityRecord?.deviceMatch?.endpoints)
    ? capabilityRecord.deviceMatch.endpoints
    : [];
  const endpointByKey = new Map(endpoints.map((endpoint) => [endpoint?.key, endpoint]));

  const capabilityValidation = validateDeviceCapabilityRecord(capabilityRecord);
  for (const error of capabilityValidation.errors) {
    errors.push(makeError(
      `CAPABILITY_${error.code}`,
      error.path === '$' ? 'capabilityRecord' : `capabilityRecord.${error.path}`,
      error.message,
    ));
  }

  if (capabilityRecord?.compatibilityClassId !== selectedTarget.compatibilityClassId) {
    errors.push(makeError(
      'COMPATIBILITY_CLASS_MISMATCH',
      'selectedTarget.compatibilityClassId',
      'The binding cites a different compatibility class than the supplied capability record.',
    ));
  }

  if (deviceMatch.compositeScope !== selectedTarget.compositeScope) {
    errors.push(makeError(
      'COMPOSITE_SCOPE_MISMATCH',
      'selectedTarget.compositeScope',
      'The binding scope does not match the supplied compatibility class.',
    ));
  }

  const interfaces = Array.isArray(deviceMatch.interfaces) ? deviceMatch.interfaces : [];
  if (!interfaces.some((entry) => entry?.number === selectedTarget.interfaceNumber)) {
    errors.push(makeError(
      'INTERFACE_NOT_IN_CAPABILITY_RECORD',
      'selectedTarget.interfaceNumber',
      `Interface ${JSON.stringify(selectedTarget.interfaceNumber)} is not declared by the compatibility class.`,
    ));
  }

  const hardwareIds = Array.isArray(selectedTarget.hardwareIds) ? selectedTarget.hardwareIds : [];
  const exactDeviceIds = hardwareIds.filter((hardwareId) => (
    hardwareIdHasToken(hardwareId, 'VID', deviceMatch.vendorId)
    && hardwareIdHasToken(hardwareId, 'PID', deviceMatch.productId)
  ));
  if (exactDeviceIds.length === 0) {
    errors.push(makeError(
      'HARDWARE_ID_NOT_IN_CAPABILITY_RECORD',
      'selectedTarget.hardwareIds',
      'No bound hardware identifier matches the compatibility class VID/PID.',
    ));
  } else if (selectedTarget.compositeScope !== 'WHOLE_PHYSICAL_DEVICE') {
    const interfaceToken = Number.isInteger(selectedTarget.interfaceNumber)
      ? selectedTarget.interfaceNumber.toString(16).toUpperCase().padStart(2, '0')
      : null;
    if (interfaceToken === null
      || !exactDeviceIds.some((hardwareId) => hardwareIdHasToken(hardwareId, 'MI', interfaceToken))) {
      errors.push(makeError(
        'HARDWARE_ID_INTERFACE_NOT_IN_CAPABILITY_RECORD',
        'selectedTarget.hardwareIds',
        'No bound hardware identifier matches the compatibility class interface.',
      ));
    }
  }

  const endpointKeys = Array.isArray(selectedTarget.endpointKeys) ? selectedTarget.endpointKeys : [];
  for (const [keyIndex, endpointKey] of endpointKeys.entries()) {
    const endpoint = endpointByKey.get(endpointKey);
    if (endpoint === undefined) {
      errors.push(makeError(
        'ENDPOINT_NOT_IN_CAPABILITY_RECORD',
        `selectedTarget.endpointKeys[${keyIndex}]`,
        `Endpoint ${JSON.stringify(endpointKey)} is not declared by the capability record.`,
      ));
      continue;
    }
    if (endpoint.transferType !== 'INTERRUPT' || endpoint.direction !== 'IN') {
      errors.push(makeError(
        'ENDPOINT_NOT_INTERRUPT_IN',
        `selectedTarget.endpointKeys[${keyIndex}]`,
        `Endpoint ${JSON.stringify(endpointKey)} is not an INTERRUPT IN endpoint.`,
      ));
    }
    if (endpoint.interfaceNumber !== selectedTarget.interfaceNumber) {
      errors.push(makeError(
        'ENDPOINT_INTERFACE_MISMATCH',
        `selectedTarget.endpointKeys[${keyIndex}]`,
        `Endpoint ${JSON.stringify(endpointKey)} belongs to interface ${JSON.stringify(endpoint.interfaceNumber)}, not the bound interface.`,
      ));
    }
  }

  const requestedHz = record?.schedule?.requestedHz ?? null;
  if (requestedHz !== null) {
    const rates = Array.isArray(capabilityRecord?.rateCapabilities)
      ? capabilityRecord.rateCapabilities
      : [];
    const rate = rates.find((candidate) => candidate?.requestedHz === requestedHz);
    if (rate === undefined || rate.result !== 'SUPPORTED') {
      errors.push(makeError(
        'RATE_NOT_SUPPORTED_BY_CAPABILITY',
        'schedule.requestedHz',
        `Rate ${requestedHz} Hz is not SUPPORTED for this compatibility class.`,
      ));
    } else {
      if (record?.schedule?.mechanism !== rate.scheduleMechanism) {
        errors.push(makeError(
          'SCHEDULE_MECHANISM_MISMATCH',
          'schedule.mechanism',
          'The binding schedule mechanism does not match the supported compatibility-class rate.',
        ));
      }
      if (!sameStringSet(record?.schedule?.mechanismRefs, rate.scheduleMechanismRefs)) {
        errors.push(makeError(
          'SCHEDULE_PROVENANCE_MISMATCH',
          'schedule.mechanismRefs',
          'The binding schedule provenance does not exactly match the supported compatibility-class rate.',
        ));
      }
      if (!sameStringSet(endpointKeys, rate.requiredEndpointKeys)) {
        errors.push(makeError(
          'RATE_ENDPOINT_SCOPE_MISMATCH',
          'selectedTarget.endpointKeys',
          'The bound endpoint set does not exactly match the supported compatibility-class rate.',
        ));
      }
    }
  }

  return { valid: errors.length === 0, errors: sortErrors(errors) };
}

function throwValidationError(label, validation, value) {
  const summary = validation.errors
    .map((error) => `${error.code} at ${error.path}: ${error.message}`)
    .join('\n');
  const error = new TypeError(`${label}:\n${summary}`);
  error.validationErrors = validation.errors;
  throw error;
}

function assertTargetBindingRecord(record) {
  const validation = validateTargetBindingRecord(record);
  if (!validation.valid) throwValidationError('Invalid target binding', validation, record);
  return record;
}

function assertTargetBindingChain(records) {
  const validation = validateTargetBindingChain(records);
  if (!validation.valid) throwValidationError('Invalid target binding chain', validation, records);
  return records;
}

const CLI_USAGE = 'Usage: node target-binding-validator.cjs [--chain] [--capability <record.json>] <binding.json> [...]\n';

function parseCliArguments(argumentList) {
  const fileNames = [];
  let chain = false;
  let capabilityPath = null;

  for (let index = 0; index < argumentList.length; index += 1) {
    const argument = argumentList[index];
    if (argument === '--chain') {
      chain = true;
    } else if (argument === '--capability') {
      capabilityPath = argumentList[index + 1] ?? null;
      index += 1;
      if (capabilityPath === null) return { error: 'The --capability option requires a file path.' };
    } else if (argument.startsWith('--')) {
      return { error: `Unknown option ${argument}.` };
    } else {
      fileNames.push(argument);
    }
  }

  return { chain, capabilityPath, fileNames };
}

function runCli(argumentList) {
  const parsed = parseCliArguments(argumentList);
  if (parsed.error !== undefined || parsed.fileNames.length === 0) {
    if (parsed.error !== undefined) process.stderr.write(`${parsed.error}\n`);
    process.stderr.write(CLI_USAGE);
    return 2;
  }

  let capability = null;
  if (parsed.capabilityPath !== null) {
    try {
      capability = JSON.parse(fs.readFileSync(path.resolve(parsed.capabilityPath), 'utf8'));
    } catch (error) {
      process.stderr.write(`${parsed.capabilityPath}: ${error instanceof Error ? error.message : String(error)}\n`);
      return 1;
    }

    const capabilityValidation = validateDeviceCapabilityRecord(capability);
    if (!capabilityValidation.valid) {
      for (const error of capabilityValidation.errors) {
        process.stderr.write(`${parsed.capabilityPath}: ${error.code} at ${error.path}: ${error.message}\n`);
      }
      return 1;
    }

    try {
      const provenanceValidation = validateProvenanceRefsResolve(
        capability,
        readProvenanceLedgerIds(),
      );
      if (!provenanceValidation.valid) {
        for (const error of provenanceValidation.errors) {
          process.stderr.write(`${parsed.capabilityPath}: ${error.code} at ${error.path}: ${error.message}\n`);
        }
        return 1;
      }
    } catch (error) {
      process.stderr.write(`${parsed.capabilityPath}: ${error instanceof Error ? error.message : String(error)}\n`);
      return 1;
    }
  }

  let exitCode = 0;
  for (const fileName of parsed.fileNames) {
    const resolvedPath = path.resolve(fileName);
    const report = (errors) => {
      exitCode = 1;
      for (const error of errors) {
        process.stderr.write(`${resolvedPath}: ${error.code} at ${error.path}: ${error.message}\n`);
      }
    };

    try {
      const parsedFile = JSON.parse(fs.readFileSync(resolvedPath, 'utf8'));
      const records = parsed.chain ? parsedFile : [parsedFile];
      const validation = parsed.chain
        ? validateTargetBindingChain(parsedFile)
        : validateTargetBindingRecord(parsedFile);

      if (!validation.valid) {
        report(validation.errors);
        continue;
      }

      if (capability !== null) {
        const crossErrors = [];
        for (const [stepIndex, record] of records.entries()) {
          const crossCheck = validateTargetBindingAgainstCapability(record, capability);
          for (const error of crossCheck.errors) {
            crossErrors.push(parsed.chain
              ? makeError(error.code, `records[${stepIndex}].${error.path}`, error.message)
              : error);
          }
        }
        if (crossErrors.length > 0) {
          report(sortErrors(crossErrors));
          continue;
        }
      }

      const summary = parsed.chain
        ? `chain of ${records.length} steps`
        : `${parsedFile.operation}`;
      process.stdout.write(`${resolvedPath}: valid (${summary})\n`);
    } catch (error) {
      exitCode = 1;
      process.stderr.write(`${resolvedPath}: ${error instanceof Error ? error.message : String(error)}\n`);
    }
  }
  return exitCode;
}

if (require.main === module) {
  process.exitCode = runCli(process.argv.slice(2));
}

module.exports = {
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
};
