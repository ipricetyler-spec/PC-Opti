'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Ajv2020 = require('ajv/dist/2020');

const deviceCapabilitySchema = require('./schemas/device-capability.schema.json');

const EVIDENCE_FIELDS = Object.freeze([
  'configuredEvidence',
  'driverSessionEvidence',
  'windowsDeliveryEvidence',
  'usbBusEvidence',
  'latencyEvidence',
]);

const REQUIRED_SUPPORTED_EVIDENCE = Object.freeze([
  'configuredEvidence',
  'driverSessionEvidence',
  'usbBusEvidence',
]);

const MATERIAL_CHANGE_TRIGGERS = Object.freeze([
  'DEVICE_FIRMWARE',
  'DEVICE_HARDWARE_REVISION',
  'FILTER_VERSION',
  'HELPER_VERSION',
  'WINDOWS_BUILD',
  'USB_CONTROLLER_OR_DRIVER',
  'WDK_OR_KMDF_VERSION',
  'MEASUREMENT_METHOD',
]);

const MEASURED_EVIDENCE_STATUSES = new Set(['PASS', 'FAIL', 'INCONCLUSIVE']);
const DOCUMENTED_SCHEDULE_MECHANISMS = new Set(['DOCUMENTED_WDF', 'DOCUMENTED_DEVICE_VENDOR']);
const RATE_RESULTS = new Set(['UNVERIFIED', 'SUPPORTED', 'UNSUPPORTED', 'BLOCKED']);
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const ENDPOINT_KEY_PATTERN = /^if([0-9]{1,3})-ep([0-9A-F]{2})$/;
const PROVENANCE_LEDGER_PATH = path.join(__dirname, 'PROVENANCE_LEDGER.md');
const PROVENANCE_LEDGER_ROW_PATTERN = /^\|\s*(P-[0-9]{3})\s*\|/;

const schemaValidator = new Ajv2020({ allErrors: true, strict: true })
  .compile(deviceCapabilitySchema);

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

function validateDeviceCapabilityStructure(record) {
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

  errors.sort((left, right) => (
    compareStrings(left.path, right.path)
    || compareStrings(left.code, right.code)
    || compareStrings(left.message, right.message)
  ));

  return { valid: false, errors };
}

/**
 * Derive the one canonical record status without implying that every rate has
 * that result. A supported rate wins; otherwise unresolved work wins; otherwise
 * a hard-blocked rate wins; only an all-unsupported record is UNSUPPORTED.
 */
function deriveCapabilityStatus(rateCapabilities) {
  if (!Array.isArray(rateCapabilities) || rateCapabilities.length === 0) return null;

  const results = rateCapabilities.map((rate) => rate?.result);
  if (results.some((result) => !RATE_RESULTS.has(result))) return null;
  if (results.includes('SUPPORTED')) return 'SUPPORTED';
  if (results.includes('UNVERIFIED')) return 'UNVERIFIED';
  if (results.includes('BLOCKED')) return 'BLOCKED';
  return 'UNSUPPORTED';
}

/**
 * Documented Windows polling period for an interrupt endpoint.
 *
 * Full speed is measured in 1 ms frames and the documented mapping floors
 * bInterval to a power of two, capped at 32 frames (P-010, P-024). High speed
 * is measured in 125 us microframes with period 2 ** (bInterval - 1), which
 * Microsoft documents as capped at 32 microframes. SuperSpeed is not covered by
 * those Microsoft tables, so the unclamped USB 3.2 service-interval formula is
 * used (P-029); that is the stricter of the two readings and fails closed.
 *
 * A naive 1 / bInterval reading understates the achievable rate for
 * non-power-of-two full-speed intervals and would reject a truthful record.
 */
function getDocumentedPollingPeriod(negotiatedSpeed, bInterval) {
  if (!Number.isInteger(bInterval)) return null;

  if (negotiatedSpeed === 'FULL') {
    if (bInterval < 1 || bInterval > 255) return null;
    return { unit: 'FRAME', period: Math.min(2 ** (31 - Math.clz32(bInterval)), 32) };
  }

  if (negotiatedSpeed === 'HIGH') {
    if (bInterval < 1 || bInterval > 16) return null;
    return { unit: 'MICROFRAME', period: Math.min(2 ** (bInterval - 1), 32) };
  }

  if (negotiatedSpeed === 'SUPER' || negotiatedSpeed === 'SUPER_PLUS') {
    if (bInterval < 1 || bInterval > 16) return null;
    return { unit: 'MICROFRAME', period: 2 ** (bInterval - 1) };
  }

  return null;
}

function getInterruptCeilingHz(negotiatedSpeed, bInterval) {
  const documented = getDocumentedPollingPeriod(negotiatedSpeed, bInterval);
  if (documented === null) return null;
  return (documented.unit === 'FRAME' ? 1000 : 8000) / documented.period;
}

function validateDeviceCapabilitySemantics(record) {
  const errors = [];
  const rateCapabilities = Array.isArray(record?.rateCapabilities) ? record.rateCapabilities : [];
  const endpoints = Array.isArray(record?.deviceMatch?.endpoints) ? record.deviceMatch.endpoints : [];
  const interfaces = Array.isArray(record?.deviceMatch?.interfaces) ? record.deviceMatch.interfaces : [];
  const negotiatedSpeed = record?.topology?.negotiatedSpeed;

  const declaredProvenanceRefs = new Set(
    Array.isArray(record?.provenanceRefs) ? record.provenanceRefs : [],
  );

  const derivedStatus = deriveCapabilityStatus(rateCapabilities);
  if (derivedStatus !== null && record?.status !== derivedStatus) {
    errors.push(makeError(
      'STATUS_MISMATCH',
      'status',
      `Record status ${JSON.stringify(record?.status)} does not match canonical aggregate ${derivedStatus}.`,
    ));
  }

  const firstRateIndexByHz = new Map();
  for (const [rateIndex, rate] of rateCapabilities.entries()) {
    const ratePath = `rateCapabilities[${rateIndex}]`;
    if (firstRateIndexByHz.has(rate?.requestedHz)) {
      errors.push(makeError(
        'DUPLICATE_RATE',
        `${ratePath}.requestedHz`,
        `requestedHz ${JSON.stringify(rate?.requestedHz)} duplicates rateCapabilities[${firstRateIndexByHz.get(rate?.requestedHz)}].requestedHz.`,
      ));
    } else {
      firstRateIndexByHz.set(rate?.requestedHz, rateIndex);
    }

    if (rate?.result === 'UNVERIFIED') {
      if (rate.blockReason !== null) {
        errors.push(makeError(
          'BLOCK_REASON_FORBIDDEN',
          `${ratePath}.blockReason`,
          'Only a BLOCKED rate may carry blockReason.',
        ));
      }
      if (rate.scheduleMechanism !== 'UNRESOLVED') {
        errors.push(makeError(
          'UNVERIFIED_SCHEDULE_MUST_BE_UNRESOLVED',
          `${ratePath}.scheduleMechanism`,
          'An UNVERIFIED rate must keep scheduleMechanism UNRESOLVED.',
        ));
      }
      for (const evidenceField of EVIDENCE_FIELDS) {
        if (rate?.[evidenceField]?.status !== 'NOT_MEASURED') {
          errors.push(makeError(
            'UNVERIFIED_EVIDENCE_MUST_BE_NOT_MEASURED',
            `${ratePath}.${evidenceField}.status`,
            'An UNVERIFIED rate cannot contain measured evidence.',
          ));
        }
      }
    } else if (rate?.result === 'SUPPORTED') {
      if (rate.blockReason !== null) {
        errors.push(makeError(
          'BLOCK_REASON_FORBIDDEN',
          `${ratePath}.blockReason`,
          'Only a BLOCKED rate may carry blockReason.',
        ));
      }
      if (!DOCUMENTED_SCHEDULE_MECHANISMS.has(rate.scheduleMechanism)) {
        errors.push(makeError(
          'SUPPORTED_SCHEDULE_MUST_BE_DOCUMENTED',
          `${ratePath}.scheduleMechanism`,
          'A SUPPORTED rate requires a documented scheduling mechanism.',
        ));
      }
      for (const evidenceField of REQUIRED_SUPPORTED_EVIDENCE) {
        if (rate?.[evidenceField]?.status !== 'PASS') {
          errors.push(makeError(
            'SUPPORTED_EVIDENCE_MUST_PASS',
            `${ratePath}.${evidenceField}.status`,
            `A SUPPORTED rate requires ${evidenceField} to PASS.`,
          ));
        }
      }
    } else if (rate?.result === 'UNSUPPORTED') {
      if (rate.blockReason !== null) {
        errors.push(makeError(
          'BLOCK_REASON_FORBIDDEN',
          `${ratePath}.blockReason`,
          'Only a BLOCKED rate may carry blockReason.',
        ));
      }
    } else if (rate?.result === 'BLOCKED') {
      if (typeof rate.blockReason !== 'string' || rate.blockReason.trim().length === 0) {
        errors.push(makeError(
          'BLOCK_REASON_REQUIRED',
          `${ratePath}.blockReason`,
          'A BLOCKED rate requires a non-empty blockReason.',
        ));
      }
    }

    const mechanismRefs = Array.isArray(rate?.scheduleMechanismRefs) ? rate.scheduleMechanismRefs : [];
    if (rate?.scheduleMechanism === 'UNRESOLVED') {
      if (mechanismRefs.length > 0) {
        errors.push(makeError(
          'SCHEDULE_MECHANISM_REFS_FORBIDDEN',
          `${ratePath}.scheduleMechanismRefs`,
          'An UNRESOLVED schedule mechanism cannot cite documented-interface provenance.',
        ));
      }
    } else if (DOCUMENTED_SCHEDULE_MECHANISMS.has(rate?.scheduleMechanism)) {
      if (mechanismRefs.length === 0) {
        errors.push(makeError(
          'SCHEDULE_MECHANISM_REFS_REQUIRED',
          `${ratePath}.scheduleMechanismRefs`,
          `Schedule mechanism ${JSON.stringify(rate.scheduleMechanism)} requires at least one provenance reference.`,
        ));
      }
      for (const [referenceIndex, mechanismRef] of mechanismRefs.entries()) {
        if (!declaredProvenanceRefs.has(mechanismRef)) {
          errors.push(makeError(
            'SCHEDULE_MECHANISM_REF_NOT_DECLARED',
            `${ratePath}.scheduleMechanismRefs[${referenceIndex}]`,
            `Provenance reference ${JSON.stringify(mechanismRef)} is not listed in provenanceRefs.`,
          ));
        }
      }
    }

    for (const evidenceField of EVIDENCE_FIELDS) {
      const evidence = rate?.[evidenceField];
      if (!evidence || typeof evidence !== 'object') continue;

      const evidencePath = `${ratePath}.${evidenceField}.artifactSha256`;
      if (MEASURED_EVIDENCE_STATUSES.has(evidence.status)) {
        if (typeof evidence.artifactSha256 !== 'string' || !SHA256_PATTERN.test(evidence.artifactSha256)) {
          errors.push(makeError(
            'MEASURED_EVIDENCE_ARTIFACT_REQUIRED',
            evidencePath,
            `${evidence.status} evidence requires a lowercase SHA-256 artifact hash.`,
          ));
        }
      } else if (evidence.status === 'NOT_MEASURED' && evidence.artifactSha256 !== null) {
        errors.push(makeError(
          'UNMEASURED_EVIDENCE_ARTIFACT_FORBIDDEN',
          evidencePath,
          'NOT_MEASURED evidence must use a null artifactSha256.',
        ));
      }
    }
  }

  const endpointByKey = new Map();
  for (const [endpointIndex, endpoint] of endpoints.entries()) {
    const endpointPath = `deviceMatch.endpoints[${endpointIndex}]`;
    const parsedKey = typeof endpoint?.key === 'string'
      ? ENDPOINT_KEY_PATTERN.exec(endpoint.key)
      : null;
    const addressValue = typeof endpoint?.address === 'string' && /^[A-F0-9]{2}$/.test(endpoint.address)
      ? Number.parseInt(endpoint.address, 16)
      : null;

    if (parsedKey && Number(parsedKey[1]) !== endpoint.interfaceNumber) {
      errors.push(makeError(
        'ENDPOINT_KEY_INTERFACE_MISMATCH',
        `${endpointPath}.key`,
        `Endpoint key ${JSON.stringify(endpoint.key)} does not encode interfaceNumber ${JSON.stringify(endpoint.interfaceNumber)}.`,
      ));
    }
    if (parsedKey && parsedKey[2] !== endpoint.address) {
      errors.push(makeError(
        'ENDPOINT_KEY_ADDRESS_MISMATCH',
        `${endpointPath}.key`,
        `Endpoint key ${JSON.stringify(endpoint.key)} does not encode address ${JSON.stringify(endpoint.address)}.`,
      ));
    }
    if (addressValue !== null) {
      if ((addressValue & 0x0f) === 0) {
        errors.push(makeError(
          'ENDPOINT_ZERO_NOT_INTERRUPT_CAPABLE',
          `${endpointPath}.address`,
          `Endpoint address ${endpoint.address} names endpoint zero, which cannot be an interrupt endpoint.`,
        ));
      }
      if ((addressValue & 0x70) !== 0) {
        errors.push(makeError(
          'ENDPOINT_ADDRESS_RESERVED_BITS_SET',
          `${endpointPath}.address`,
          `Endpoint address ${endpoint.address} sets reserved bEndpointAddress bits 4 through 6.`,
        ));
      }
      const encodedDirection = (addressValue & 0x80) === 0x80 ? 'IN' : 'OUT';
      if (endpoint.direction !== encodedDirection) {
        errors.push(makeError(
          'ENDPOINT_ADDRESS_DIRECTION_MISMATCH',
          `${endpointPath}.direction`,
          `Endpoint address ${endpoint.address} encodes ${encodedDirection}, not ${JSON.stringify(endpoint.direction)}.`,
        ));
      }
    }

    if (endpointByKey.has(endpoint?.key)) {
      errors.push(makeError(
        'DUPLICATE_ENDPOINT_KEY',
        `deviceMatch.endpoints[${endpointIndex}].key`,
        `Endpoint key ${JSON.stringify(endpoint?.key)} must resolve uniquely.`,
      ));
    } else {
      endpointByKey.set(endpoint?.key, { endpoint, endpointIndex });
    }

    if (getInterruptCeilingHz(negotiatedSpeed, endpoint?.bInterval) === null) {
      const expectedRange = negotiatedSpeed === 'FULL' ? '1..255' : '1..16';
      errors.push(makeError(
        'BINTERVAL_OUT_OF_RANGE',
        `deviceMatch.endpoints[${endpointIndex}].bInterval`,
        `${negotiatedSpeed || 'Unknown-speed'} interrupt bInterval must be ${expectedRange}.`,
      ));
    }
  }

  const interfaceNumbers = new Set(interfaces.map((entry) => entry?.number));
  for (const [rateIndex, rate] of rateCapabilities.entries()) {
    const requiredEndpointKeys = Array.isArray(rate?.requiredEndpointKeys) ? rate.requiredEndpointKeys : [];
    for (const [referenceIndex, endpointKey] of requiredEndpointKeys.entries()) {
      const referencePath = `rateCapabilities[${rateIndex}].requiredEndpointKeys[${referenceIndex}]`;
      const resolved = endpointByKey.get(endpointKey);
      if (!resolved) {
        errors.push(makeError(
          'ENDPOINT_REFERENCE_NOT_FOUND',
          referencePath,
          `Required endpoint ${JSON.stringify(endpointKey)} is not declared in deviceMatch.endpoints.`,
        ));
        continue;
      }

      const { endpoint, endpointIndex } = resolved;
      if (endpoint.transferType !== 'INTERRUPT' || endpoint.direction !== 'IN') {
        errors.push(makeError(
          'ENDPOINT_REFERENCE_NOT_INTERRUPT_IN',
          referencePath,
          `Required endpoint ${JSON.stringify(endpointKey)} must resolve to an INTERRUPT IN endpoint.`,
        ));
      }
      if (!interfaceNumbers.has(endpoint.interfaceNumber)) {
        errors.push(makeError(
          'ENDPOINT_INTERFACE_NOT_FOUND',
          `deviceMatch.endpoints[${endpointIndex}].interfaceNumber`,
          `Endpoint ${JSON.stringify(endpointKey)} references an undeclared interface number.`,
        ));
      }

      const ceilingHz = getInterruptCeilingHz(negotiatedSpeed, endpoint.bInterval);
      if (ceilingHz !== null && Number.isFinite(rate?.requestedHz) && rate.requestedHz > ceilingHz) {
        errors.push(makeError(
          'RATE_EXCEEDS_ENDPOINT_CEILING',
          `rateCapabilities[${rateIndex}].requestedHz`,
          `requestedHz ${rate.requestedHz} exceeds ${negotiatedSpeed} endpoint ${JSON.stringify(endpointKey)} documented ceiling ${ceilingHz} Hz for bInterval ${endpoint.bInterval}.`,
        ));
      }
    }
  }

  const configuredTriggers = new Set(Array.isArray(record?.materialChangeTriggers) ? record.materialChangeTriggers : []);
  for (const trigger of MATERIAL_CHANGE_TRIGGERS) {
    if (!configuredTriggers.has(trigger)) {
      errors.push(makeError(
        'MATERIAL_CHANGE_TRIGGER_REQUIRED',
        'materialChangeTriggers',
        `Missing mandatory invalidation trigger ${trigger}.`,
      ));
    }
  }

  errors.sort((left, right) => (
    compareStrings(left.path, right.path)
    || compareStrings(left.code, right.code)
    || compareStrings(left.message, right.message)
  ));

  return { valid: errors.length === 0, derivedStatus, errors };
}

/**
 * Read the declared provenance identifiers from the clean-room ledger. A record
 * may cite only sources the ledger actually records, so an unreadable or empty
 * ledger fails closed instead of silently accepting every reference.
 */
function readProvenanceLedgerIds(ledgerPath = PROVENANCE_LEDGER_PATH) {
  const identifiers = new Set();
  for (const line of fs.readFileSync(ledgerPath, 'utf8').split(/\r?\n/)) {
    const match = PROVENANCE_LEDGER_ROW_PATTERN.exec(line.trim());
    if (match !== null) identifiers.add(match[1]);
  }
  if (identifiers.size === 0) {
    throw new Error(`Provenance ledger ${ledgerPath} declares no P-### entries.`);
  }
  return identifiers;
}

/**
 * Resolve every record-level and schedule-mechanism provenance reference against
 * ledger identifiers supplied by the caller. This stays separate from the pure
 * validator so structural and semantic validation remain I/O-free.
 */
function validateProvenanceRefsResolve(record, ledgerIds) {
  const known = ledgerIds instanceof Set ? ledgerIds : new Set(ledgerIds || []);
  const errors = [];

  const recordRefs = Array.isArray(record?.provenanceRefs) ? record.provenanceRefs : [];
  for (const [referenceIndex, reference] of recordRefs.entries()) {
    if (!known.has(reference)) {
      errors.push(makeError(
        'PROVENANCE_REF_NOT_IN_LEDGER',
        `provenanceRefs[${referenceIndex}]`,
        `Provenance reference ${JSON.stringify(reference)} does not resolve to a ledger entry.`,
      ));
    }
  }

  const rateCapabilities = Array.isArray(record?.rateCapabilities) ? record.rateCapabilities : [];
  for (const [rateIndex, rate] of rateCapabilities.entries()) {
    const mechanismRefs = Array.isArray(rate?.scheduleMechanismRefs) ? rate.scheduleMechanismRefs : [];
    for (const [referenceIndex, reference] of mechanismRefs.entries()) {
      if (!known.has(reference)) {
        errors.push(makeError(
          'PROVENANCE_REF_NOT_IN_LEDGER',
          `rateCapabilities[${rateIndex}].scheduleMechanismRefs[${referenceIndex}]`,
          `Provenance reference ${JSON.stringify(reference)} does not resolve to a ledger entry.`,
        ));
      }
    }
  }

  errors.sort((left, right) => (
    compareStrings(left.path, right.path)
    || compareStrings(left.code, right.code)
    || compareStrings(left.message, right.message)
  ));

  return { valid: errors.length === 0, errors };
}

function validateDeviceCapabilityRecord(record) {
  const structural = validateDeviceCapabilityStructure(record);
  if (!structural.valid) {
    return { valid: false, derivedStatus: null, errors: structural.errors };
  }
  return validateDeviceCapabilitySemantics(record);
}

function assertDeviceCapabilitySemantics(record) {
  const validation = validateDeviceCapabilityRecord(record);
  if (!validation.valid) {
    const summary = validation.errors
      .map((error) => `${error.code} at ${error.path}: ${error.message}`)
      .join('\n');
    const error = new TypeError(`Invalid device-capability semantics:\n${summary}`);
    error.validationErrors = validation.errors;
    throw error;
  }
  return record;
}

function runCli(fileNames) {
  if (fileNames.length === 0) {
    process.stderr.write('Usage: node device-capability-validator.cjs <record.json> [...]\n');
    return 2;
  }

  let exitCode = 0;
  for (const fileName of fileNames) {
    const resolvedPath = path.resolve(fileName);
    try {
      const record = JSON.parse(fs.readFileSync(resolvedPath, 'utf8'));
      const validation = validateDeviceCapabilityRecord(record);
      if (validation.valid) {
        const ledgerValidation = validateProvenanceRefsResolve(record, readProvenanceLedgerIds());
        if (ledgerValidation.valid) {
          process.stdout.write(`${resolvedPath}: valid (${validation.derivedStatus})\n`);
        } else {
          exitCode = 1;
          for (const error of ledgerValidation.errors) {
            process.stderr.write(`${resolvedPath}: ${error.code} at ${error.path}: ${error.message}\n`);
          }
        }
      } else {
        exitCode = 1;
        for (const error of validation.errors) {
          process.stderr.write(`${resolvedPath}: ${error.code} at ${error.path}: ${error.message}\n`);
        }
      }
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
  EVIDENCE_FIELDS,
  MATERIAL_CHANGE_TRIGGERS,
  PROVENANCE_LEDGER_PATH,
  assertDeviceCapabilitySemantics,
  deriveCapabilityStatus,
  getDocumentedPollingPeriod,
  getInterruptCeilingHz,
  readProvenanceLedgerIds,
  validateProvenanceRefsResolve,
  validateDeviceCapabilityRecord,
  validateDeviceCapabilitySemantics,
  validateDeviceCapabilityStructure,
};
