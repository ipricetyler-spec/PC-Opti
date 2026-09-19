// Dialed fixed-purpose privileged-helper protocol.
//
// The helper is the only component allowed to touch Windows driver state. This module
// defines its entire vocabulary: a finite operation enum, exact typed request and
// response shapes, helper-consumed nonces bound to the calling package identity and to
// one reviewed plan, and a deterministic reference implementation of the operations.
//
// What the protocol deliberately does not have is as important as what it has. There is
// no command, path, argument list, service name, Registry coordinate, INF name or IOCTL
// that a caller can supply. Every operation has an exact payload schema, and the helper
// recomputes the reviewed plan digest before using the payload. The native implementation
// must additionally authenticate the caller through its Windows transport; the identity
// field here is message binding, not a substitute for that OS check.
//
// The reference implementation below is deterministic and in-memory. It is the contract
// under test, and it is what a later signed executable must reproduce exactly. It
// performs no I/O and mutates nothing outside the state object handed to it.

const crypto = require('node:crypto');

const HELPER_PROTOCOL_VERSION = '1.0.0';

/**
 * The complete operation set. Anything not on this list cannot be requested, and the
 * list is closed: adding to it is a reviewed protocol change, not a configuration knob.
 */
const HELPER_OPERATIONS = Object.freeze([
  'PREFLIGHT_PACKAGE',
  'PREFLIGHT_TARGET',
  'OBSERVE_STATE',
  'EXTEND_RECOVERY_CHECKPOINT',
  'INSTALL_PACKAGE',
  'ADOPT_PACKAGE',
  'ATTACH_SELECTED_DEVICE',
  'DETACH_SELECTED_DEVICE',
  'REPAIR_EXACT_PACKAGE',
  'UPGRADE_EXACT_PREDECESSOR',
  'REMOVE_DETACHED_PACKAGE',
]);

/** Operations that change Windows state. Each requires a sealed preimage first. */
const MUTATING_HELPER_OPERATIONS = Object.freeze([
  'INSTALL_PACKAGE',
  'ATTACH_SELECTED_DEVICE',
  'DETACH_SELECTED_DEVICE',
  'REPAIR_EXACT_PACKAGE',
  'UPGRADE_EXACT_PREDECESSOR',
  'REMOVE_DETACHED_PACKAGE',
]);

/** The one semantic delta each operation may produce. */
const HELPER_ALLOWED_DELTA = Object.freeze({
  PREFLIGHT_PACKAGE: 'NONE',
  PREFLIGHT_TARGET: 'NONE',
  OBSERVE_STATE: 'NONE',
  EXTEND_RECOVERY_CHECKPOINT: 'NONE',
  ADOPT_PACKAGE: 'NONE',
  INSTALL_PACKAGE: 'PACKAGE_INSTALLED',
  ATTACH_SELECTED_DEVICE: 'SELECTED_ATTACHMENT_ADDED',
  DETACH_SELECTED_DEVICE: 'SELECTED_ATTACHMENT_REMOVED',
  REPAIR_EXACT_PACKAGE: 'PACKAGE_REPAIRED',
  UPGRADE_EXACT_PREDECESSOR: 'PACKAGE_UPGRADED',
  REMOVE_DETACHED_PACKAGE: 'PACKAGE_REMOVED',
});

const ALLOWED_REQUEST_HZ = Object.freeze([125, 250, 500, 1000, 2000, 4000, 8000]);
const PRESENCE_STATES = Object.freeze(['PRESENT', 'NOT_PRESENT', 'PHANTOM']);
const NONCE_TTL_MS = 2 * 60 * 1000;
const MAX_FUTURE_SKEW_MS = 5 * 1000;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const NONCE_PATTERN = /^[A-Za-z0-9_-]{32,64}$/;

const OPERATION_PAYLOAD_KEYS = Object.freeze({
  PREFLIGHT_PACKAGE: Object.freeze([]),
  PREFLIGHT_TARGET: Object.freeze(['deviceDigest', 'requestedHz']),
  OBSERVE_STATE: Object.freeze([]),
  EXTEND_RECOVERY_CHECKPOINT: Object.freeze([]),
  INSTALL_PACKAGE: Object.freeze(['preimageDigest']),
  ADOPT_PACKAGE: Object.freeze([]),
  ATTACH_SELECTED_DEVICE: Object.freeze(['preimageDigest', 'deviceDigest', 'requestedHz']),
  DETACH_SELECTED_DEVICE: Object.freeze(['preimageDigest', 'deviceDigest']),
  REPAIR_EXACT_PACKAGE: Object.freeze(['preimageDigest']),
  UPGRADE_EXACT_PREDECESSOR: Object.freeze(['preimageDigest', 'predecessorSha256']),
  REMOVE_DETACHED_PACKAGE: Object.freeze(['preimageDigest']),
});

class HelperProtocolError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'HelperProtocolError';
    this.code = code;
  }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function assertExactKeys(value, allowed, label) {
  if (!isPlainObject(value)) throw new HelperProtocolError('MALFORMED_MESSAGE', `${label} must be an object.`);
  const unexpected = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unexpected.length) throw new HelperProtocolError('MALFORMED_MESSAGE', `${label} contains unsupported fields: ${unexpected.join(', ')}.`);
  const missing = allowed.filter((key) => !Object.prototype.hasOwnProperty.call(value, key));
  if (missing.length) throw new HelperProtocolError('MALFORMED_MESSAGE', `${label} is missing required fields: ${missing.join(', ')}.`);
}

function assertDigest(value, label) {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) throw new HelperProtocolError('MALFORMED_MESSAGE', `${label} must be a lowercase SHA-256 digest.`);
  return value;
}

function validateCallerIdentity(identity, label = 'Caller identity') {
  assertExactKeys(identity, ['packageId', 'publisherThumbprint'], label);
  if (typeof identity.packageId !== 'string' || !/^[a-z0-9][a-z0-9.-]{2,79}$/.test(identity.packageId)) throw new HelperProtocolError('MALFORMED_MESSAGE', `${label} packageId is not valid.`);
  if (typeof identity.publisherThumbprint !== 'string' || !/^[A-F0-9]{40,128}$/.test(identity.publisherThumbprint)) throw new HelperProtocolError('MALFORMED_MESSAGE', `${label} publisherThumbprint is not valid.`);
  return deepFreeze(clone(identity));
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (isPlainObject(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function sha256Hex(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

/**
 * The reviewed plan a mutating request is bound to. Binding the nonce to this digest is
 * what stops a replayed or re-aimed request: a captured message cannot be pointed at a
 * different device, rate or package.
 */
function validatePlan(plan) {
  assertExactKeys(plan, ['operation', 'deviceDigest', 'requestedHz', 'packageSha256', 'restartExpected'], 'Plan');
  if (!HELPER_OPERATIONS.includes(plan.operation)) throw new HelperProtocolError('UNKNOWN_OPERATION', `${plan.operation} is not a supported helper operation.`);
  if (plan.deviceDigest !== null) assertDigest(plan.deviceDigest, 'Plan deviceDigest');
  if (plan.requestedHz !== null && !ALLOWED_REQUEST_HZ.includes(plan.requestedHz)) throw new HelperProtocolError('MALFORMED_MESSAGE', 'Plan requestedHz is not a reviewed request.');
  if (plan.packageSha256 !== null) assertDigest(plan.packageSha256, 'Plan packageSha256');
  if (typeof plan.restartExpected !== 'boolean') throw new HelperProtocolError('MALFORMED_MESSAGE', 'Plan restartExpected must be explicit.');

  const deviceOperations = ['PREFLIGHT_TARGET', 'ATTACH_SELECTED_DEVICE', 'DETACH_SELECTED_DEVICE'];
  const rateOperations = ['PREFLIGHT_TARGET', 'ATTACH_SELECTED_DEVICE'];
  const packageOperations = ['INSTALL_PACKAGE', 'ADOPT_PACKAGE', 'ATTACH_SELECTED_DEVICE', 'DETACH_SELECTED_DEVICE', 'REPAIR_EXACT_PACKAGE', 'UPGRADE_EXACT_PREDECESSOR', 'REMOVE_DETACHED_PACKAGE'];
  if (deviceOperations.includes(plan.operation) !== (plan.deviceDigest !== null)) throw new HelperProtocolError('MALFORMED_MESSAGE', `Plan deviceDigest does not match ${plan.operation}.`);
  if (rateOperations.includes(plan.operation) !== (plan.requestedHz !== null)) throw new HelperProtocolError('MALFORMED_MESSAGE', `Plan requestedHz does not match ${plan.operation}.`);
  if (packageOperations.includes(plan.operation) !== (plan.packageSha256 !== null)) throw new HelperProtocolError('MALFORMED_MESSAGE', `Plan packageSha256 does not match ${plan.operation}.`);
  if (plan.restartExpected && plan.operation !== 'ATTACH_SELECTED_DEVICE') throw new HelperProtocolError('MALFORMED_MESSAGE', 'Only an attachment plan may expect a restart.');
  return deepFreeze(clone(plan));
}

function planDigest(plan) {
  return sha256Hex(stableJson(validatePlan(plan)));
}

function validateOperationPayload(operation, payload, plan) {
  assertExactKeys(payload, OPERATION_PAYLOAD_KEYS[operation], `${operation} payload`);
  if (Object.prototype.hasOwnProperty.call(payload, 'preimageDigest')) assertDigest(payload.preimageDigest, `${operation} payload preimageDigest`);
  if (Object.prototype.hasOwnProperty.call(payload, 'deviceDigest')) {
    assertDigest(payload.deviceDigest, `${operation} payload deviceDigest`);
    if (payload.deviceDigest !== plan.deviceDigest) throw new HelperProtocolError('PLAN_PAYLOAD_MISMATCH', 'The payload device does not match the reviewed plan.');
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'requestedHz')) {
    if (!ALLOWED_REQUEST_HZ.includes(payload.requestedHz)) throw new HelperProtocolError('MALFORMED_MESSAGE', 'The payload polling request is not reviewed.');
    if (payload.requestedHz !== plan.requestedHz) throw new HelperProtocolError('PLAN_PAYLOAD_MISMATCH', 'The payload rate does not match the reviewed plan.');
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'predecessorSha256')) assertDigest(payload.predecessorSha256, `${operation} payload predecessorSha256`);
  return deepFreeze(clone(payload));
}

/**
 * A caller-side session. It issues single-use nonces bound to one operation and plan,
 * and refuses any response that does not answer the exact request it issued.
 */
function createHelperSession(options = {}) {
  const callerIdentity = validateCallerIdentity(options.callerIdentity);

  const now = typeof options.now === 'function' ? options.now : () => Date.now();
  const randomBytes = typeof options.randomBytes === 'function' ? options.randomBytes : crypto.randomBytes;
  const ttlMs = Number.isSafeInteger(options.nonceTtlMs) ? options.nonceTtlMs : NONCE_TTL_MS;
  const outstanding = new Map();

  function issueRequest(operation, plan, payload = {}) {
    if (!HELPER_OPERATIONS.includes(operation)) throw new HelperProtocolError('UNKNOWN_OPERATION', `${operation} is not a supported helper operation.`);
    if (plan.operation !== operation) throw new HelperProtocolError('PLAN_OPERATION_MISMATCH', 'The reviewed plan does not describe this operation.');
    const reviewedPlan = validatePlan(plan);
    const reviewedPayload = validateOperationPayload(operation, payload, reviewedPlan);
    const digest = planDigest(reviewedPlan);
    const nonce = randomBytes(32).toString('base64url');
    if (!NONCE_PATTERN.test(nonce)) throw new HelperProtocolError('MALFORMED_MESSAGE', 'Generated nonce is not valid.');
    const issuedAtMs = now();
    const request = deepFreeze({
      protocolVersion: HELPER_PROTOCOL_VERSION,
      operation,
      nonce,
      callerIdentity: clone(callerIdentity),
      plan: reviewedPlan,
      planDigest: digest,
      issuedAtMs,
      payload: reviewedPayload,
    });
    outstanding.set(nonce, { operation, planDigest: digest, issuedAtMs });
    return request;
  }

  function consumeResponse(response) {
    assertExactKeys(response, ['protocolVersion', 'operation', 'nonce', 'planDigest', 'ok', 'result', 'error'], 'Helper response');
    if (response.protocolVersion !== HELPER_PROTOCOL_VERSION) throw new HelperProtocolError('PROTOCOL_VERSION_MISMATCH', 'The helper answered with a different protocol version.');
    if (typeof response.nonce !== 'string' || !outstanding.has(response.nonce)) throw new HelperProtocolError('UNKNOWN_OR_REPLAYED_NONCE', 'The helper answered a request this session did not issue, or answered it twice.');
    const pending = outstanding.get(response.nonce);
    // Single use: the nonce is spent whether the answer is accepted or refused.
    outstanding.delete(response.nonce);
    if (now() - pending.issuedAtMs > ttlMs) throw new HelperProtocolError('RESPONSE_EXPIRED', 'The helper answer arrived after the request expired.');
    if (response.operation !== pending.operation) throw new HelperProtocolError('OPERATION_MISMATCH', 'The helper answered a different operation.');
    if (response.planDigest !== pending.planDigest) throw new HelperProtocolError('PLAN_DIGEST_MISMATCH', 'The helper answered against a different reviewed plan.');
    if (typeof response.ok !== 'boolean') throw new HelperProtocolError('MALFORMED_MESSAGE', 'Helper response ok must be explicit.');
    if (!response.ok) {
      const error = response.error;
      assertExactKeys(error, ['code', 'message'], 'Helper error');
      throw new HelperProtocolError(String(error.code), String(error.message));
    }
    if (response.error !== null) throw new HelperProtocolError('MALFORMED_MESSAGE', 'A successful helper response cannot carry an error.');
    return deepFreeze(clone(response.result));
  }

  return deepFreeze({
    issueRequest,
    consumeResponse,
    get outstandingCount() { return outstanding.size; },
  });
}

/** Validate a request on the helper side before acting on any part of it. */
function validateHelperRequest(raw, expectedCallerIdentity) {
  assertExactKeys(raw, ['protocolVersion', 'operation', 'nonce', 'callerIdentity', 'plan', 'planDigest', 'issuedAtMs', 'payload'], 'Helper request');
  if (raw.protocolVersion !== HELPER_PROTOCOL_VERSION) throw new HelperProtocolError('PROTOCOL_VERSION_MISMATCH', 'Unsupported helper protocol version.');
  if (!HELPER_OPERATIONS.includes(raw.operation)) throw new HelperProtocolError('UNKNOWN_OPERATION', 'Unsupported helper operation.');
  if (typeof raw.nonce !== 'string' || !NONCE_PATTERN.test(raw.nonce)) throw new HelperProtocolError('MALFORMED_MESSAGE', 'Helper request nonce is not valid.');
  const reviewedPlan = validatePlan(raw.plan);
  const expectedPlanDigest = planDigest(reviewedPlan);
  assertDigest(raw.planDigest, 'Helper request planDigest');
  if (raw.planDigest !== expectedPlanDigest) throw new HelperProtocolError('PLAN_DIGEST_MISMATCH', 'The helper request plan digest does not match its reviewed plan.');
  if (reviewedPlan.operation !== raw.operation) throw new HelperProtocolError('PLAN_OPERATION_MISMATCH', 'The helper request plan describes a different operation.');
  if (!Number.isSafeInteger(raw.issuedAtMs) || raw.issuedAtMs <= 0) throw new HelperProtocolError('MALFORMED_MESSAGE', 'Helper request issuedAtMs is not valid.');
  assertExactKeys(raw.callerIdentity, ['packageId', 'publisherThumbprint'], 'Helper request callerIdentity');
  if (expectedCallerIdentity) {
    if (raw.callerIdentity.packageId !== expectedCallerIdentity.packageId || raw.callerIdentity.publisherThumbprint !== expectedCallerIdentity.publisherThumbprint) {
      throw new HelperProtocolError('CALLER_IDENTITY_REJECTED', 'The request did not come from the reviewed Dialed package identity.');
    }
  }
  const reviewedPayload = validateOperationPayload(raw.operation, raw.payload, reviewedPlan);
  return deepFreeze({ ...clone(raw), plan: reviewedPlan, payload: reviewedPayload });
}

function helperResponse(request, result) {
  return deepFreeze({
    protocolVersion: HELPER_PROTOCOL_VERSION,
    operation: request.operation,
    nonce: request.nonce,
    planDigest: request.planDigest,
    ok: true,
    result: clone(result),
    error: null,
  });
}

function helperFailure(request, code, message) {
  return deepFreeze({
    protocolVersion: HELPER_PROTOCOL_VERSION,
    operation: request.operation,
    nonce: request.nonce,
    planDigest: request.planDigest,
    ok: false,
    result: null,
    error: { code, message },
  });
}

/** The native preimage a mutation must seal first. Every field here must be restorable. */
function sealPreimage(state) {
  const preimage = {
    lowerFiltersOrdered: state.attachments.map((entry) => ({
      deviceDigest: entry.deviceDigest,
      presence: entry.presence,
      filters: [...entry.lowerFilters],
      requestedHz: entry.requestedHz,
      dialedManaged: entry.dialedManaged,
      compatible: entry.compatible !== false,
      previousRequest: Object.prototype.hasOwnProperty.call(entry, 'previousRequestedHz')
        ? { present: true, value: entry.previousRequestedHz }
        : { present: false, value: null },
    })),
    packagePresent: state.package.present,
    packageSha256: state.package.binarySha256,
    serviceName: state.package.serviceName,
    oemInfName: state.package.oemInfName,
    installedByDialed: state.package.installedByDialed,
    packageSignatureValid: state.package.signatureValid === true,
    security: { ...state.security },
    bootSessionId: state.bootSessionId,
    driverSessionId: state.driverSessionId,
    inventoryComplete: state.inventoryComplete,
    needsReview: state.needsReview,
    restartRequired: state.restartRequired,
  };
  return deepFreeze({ preimage, preimageDigest: sha256Hex(stableJson(preimage)) });
}

/**
 * Deterministic reference helper. It owns an in-memory model of the exact native state
 * the real helper will own, and enforces the same refusals. Tests drive this to prove
 * the contract; the signed executable must behave identically.
 */
function createDeterministicHelper(options = {}) {
  const callerIdentity = validateCallerIdentity(options.callerIdentity, 'Expected caller identity');
  const now = typeof options.now === 'function' ? options.now : () => Date.now();
  const nonceTtlMs = Number.isSafeInteger(options.nonceTtlMs) ? options.nonceTtlMs : NONCE_TTL_MS;
  const reviewedPackageEntries = options.reviewedPackages || [];
  const reviewedPackages = new Map(reviewedPackageEntries.map((entry) => {
    assertExactKeys(entry, ['sha256', 'serviceName', 'oemInfName'], 'Reviewed package');
    assertDigest(entry.sha256, 'Reviewed package sha256');
    if (typeof entry.serviceName !== 'string' || !/^[A-Za-z0-9_.-]{1,64}$/.test(entry.serviceName)) throw new HelperProtocolError('MALFORMED_MESSAGE', 'Reviewed package serviceName is invalid.');
    if (entry.oemInfName !== null && (typeof entry.oemInfName !== 'string' || !/^[A-Za-z0-9_.-]{1,64}$/.test(entry.oemInfName))) throw new HelperProtocolError('MALFORMED_MESSAGE', 'Reviewed package oemInfName is invalid.');
    return [entry.sha256, deepFreeze(clone(entry))];
  }));
  if (reviewedPackages.size !== reviewedPackageEntries.length) throw new HelperProtocolError('MALFORMED_MESSAGE', 'Reviewed package hashes must be unique.');
  const consumedNonces = new Map();
  const attachRequiresRestart = options.attachRequiresRestart === true;
  const state = {
    package: {
      present: false,
      binarySha256: null,
      serviceName: null,
      oemInfName: null,
      installedByDialed: false,
      ...clone(options.initialPackage || {}),
    },
    attachments: clone(options.initialAttachments || []),
    security: { secureBoot: 'ENABLED', memoryIntegrity: 'ENABLED', driverSignatureEnforcement: 'ENABLED', ...clone(options.initialSecurity || {}) },
    bootSessionId: options.bootSessionId || 'boot-1',
    driverSessionId: options.driverSessionId || null,
    inventoryComplete: options.inventoryComplete !== false,
    needsReview: false,
    restartRequired: false,
    checkpointSequence: 0,
    lastCheckpointDigest: null,
    sealed: null,
    restartExpectation: null,
  };

  // Injected faults let a fixture reproduce an interruption without any real failure.
  const failOperations = new Set(options.failOperations || []);
  const surpriseRemovalBefore = new Set(options.surpriseRemovalBefore || []);

  function findAttachment(deviceDigest) {
    return state.attachments.find((entry) => entry.deviceDigest === deviceDigest) || null;
  }

  function hasServiceFilter(attachment) {
    const serviceName = state.package.serviceName;
    return typeof serviceName === 'string' && attachment.lowerFilters.some((name) => typeof name === 'string' && name.toLowerCase() === serviceName.toLowerCase());
  }

  function attachmentsDigest() {
    return sha256Hex(stableJson(state.attachments));
  }

  function requireReviewedInstalledPackage(packageSha256) {
    if (!state.package.present) throw new HelperProtocolError('PACKAGE_NOT_PRESENT', 'No reviewed driver package is installed.');
    if (packageSha256 !== state.package.binarySha256) throw new HelperProtocolError('PACKAGE_IDENTITY_MISMATCH', 'The installed package does not match the reviewed plan.');
    const reviewedPackage = reviewedPackages.get(packageSha256);
    if (!reviewedPackage) throw new HelperProtocolError('PACKAGE_NOT_REVIEWED', 'The installed package is not in the helper-owned reviewed package set.');
    if (state.package.signatureValid !== true) throw new HelperProtocolError('PACKAGE_SIGNATURE_INVALID', 'The installed package signature is not valid.');
    if (typeof state.package.serviceName !== 'string' || state.package.serviceName.toLowerCase() !== reviewedPackage.serviceName.toLowerCase()) {
      throw new HelperProtocolError('PACKAGE_SERVICE_MISMATCH', 'The installed service identity does not match the reviewed package.');
    }
    return reviewedPackage;
  }

  function requireMutationPreconditions(request) {
    if (state.needsReview) throw new HelperProtocolError('NEEDS_REVIEW_DURABLE', 'A previous operation is unresolved. Recovery must be reviewed before any further change.');
    if (state.restartRequired) throw new HelperProtocolError('RESTART_REQUIRED', 'Windows requires a restart and an exact recheck before another change.');
    for (const [key, code] of [['secureBoot', 'SECURE_BOOT_NOT_ENABLED'], ['memoryIntegrity', 'MEMORY_INTEGRITY_NOT_ENABLED'], ['driverSignatureEnforcement', 'DRIVER_SIGNATURE_ENFORCEMENT_NOT_ENABLED']]) {
      if (state.security[key] !== 'ENABLED') throw new HelperProtocolError(code, 'A required Windows protection is not enabled. Dialed refuses to continue and will never disable one.');
    }
    if (!state.inventoryComplete) throw new HelperProtocolError('INVENTORY_INCOMPLETE', 'The present, non-present and phantom attachment inventory is incomplete.');
    if (state.sealed === null || state.sealed.digest !== request.payload.preimageDigest) {
      throw new HelperProtocolError('PREIMAGE_NOT_SEALED_OR_STALE', 'A mutation requires a freshly sealed preimage that matches current state.');
    }
    const current = sealPreimage(state).preimageDigest;
    if (current !== state.sealed.digest) throw new HelperProtocolError('PREIMAGE_STALE', 'Native state changed after the preimage was sealed.');
    // A seal authorizes one mutation attempt only, including a refused or no-op attempt.
    state.sealed = null;
  }

  function extendCheckpoint() {
    state.checkpointSequence += 1;
    const digest = sha256Hex(`${state.lastCheckpointDigest || ''}:${state.checkpointSequence}:${sealPreimage(state).preimageDigest}`);
    state.lastCheckpointDigest = digest;
    return { sequence: state.checkpointSequence, digest };
  }

  function enterNeedsReview(reason) {
    state.needsReview = true;
    return new HelperProtocolError('OPERATION_FAILED_NEEDS_REVIEW', reason);
  }

  function handle(rawRequest) {
    let request;
    try {
      request = validateHelperRequest(rawRequest, callerIdentity);
    } catch (error) {
      // A malformed or misidentified message never reaches an operation.
      return helperFailure(
        isPlainObject(rawRequest) && typeof rawRequest.operation === 'string' && typeof rawRequest.nonce === 'string' && typeof rawRequest.planDigest === 'string'
          ? rawRequest
          : { operation: 'OBSERVE_STATE', nonce: 'x'.repeat(32), planDigest: '0'.repeat(64) },
        error.code || 'MALFORMED_MESSAGE',
        error.message,
      );
    }

    const helperNow = now();
    for (const [nonce, consumedAt] of consumedNonces) {
      if (helperNow - consumedAt > nonceTtlMs + MAX_FUTURE_SKEW_MS) consumedNonces.delete(nonce);
    }
    if (request.issuedAtMs > helperNow + MAX_FUTURE_SKEW_MS || helperNow - request.issuedAtMs > nonceTtlMs) {
      return helperFailure(request, 'REQUEST_EXPIRED', 'The helper request is outside its permitted time window.');
    }
    if (consumedNonces.has(request.nonce)) return helperFailure(request, 'NONCE_REPLAYED', 'The helper request nonce was already consumed.');
    consumedNonces.set(request.nonce, helperNow);

    try {
      if (surpriseRemovalBefore.has(request.operation)) {
        const attachment = findAttachment(request.payload.deviceDigest);
        if (attachment) attachment.presence = 'NOT_PRESENT';
        surpriseRemovalBefore.delete(request.operation);
      }

      switch (request.operation) {
        case 'OBSERVE_STATE': {
          const { preimage, preimageDigest } = sealPreimage(state);
          return helperResponse(request, {
            kind: 'STATE_ATTESTATION',
            preimageDigest,
            packagePresent: preimage.packagePresent,
            packageSha256: preimage.packageSha256,
            installedByDialed: preimage.installedByDialed,
            attachments: preimage.lowerFiltersOrdered,
            security: preimage.security,
            inventoryComplete: preimage.inventoryComplete,
            bootSessionId: preimage.bootSessionId,
            driverSessionId: preimage.driverSessionId,
            needsReview: state.needsReview,
            restartRequired: state.restartRequired,
          });
        }
        case 'EXTEND_RECOVERY_CHECKPOINT': {
          const { preimageDigest } = sealPreimage(state);
          state.sealed = { digest: preimageDigest, at: request.issuedAtMs };
          const checkpoint = extendCheckpoint();
          return helperResponse(request, { kind: 'RECOVERY_CHECKPOINT', preimageDigest, ...checkpoint });
        }
        case 'PREFLIGHT_PACKAGE': {
          return helperResponse(request, {
            present: state.package.present,
            binarySha256: state.package.binarySha256,
            serviceName: state.package.serviceName,
            installedByDialed: state.package.installedByDialed,
            signatureValid: state.package.present ? state.package.signatureValid !== false : null,
          });
        }
        case 'PREFLIGHT_TARGET': {
          const attachment = findAttachment(request.payload.deviceDigest);
          return helperResponse(request, {
            known: Boolean(attachment),
            connected: Boolean(attachment && attachment.presence === 'PRESENT'),
            compatible: Boolean(attachment && attachment.compatible !== false),
            rateEligible: ALLOWED_REQUEST_HZ.includes(request.payload.requestedHz),
            deviceDigest: request.payload.deviceDigest,
            requestedHz: request.payload.requestedHz,
          });
        }
        case 'ADOPT_PACKAGE': {
          // Adoption records what is already there. It changes no Windows state, so it
          // is not a mutation and takes no preimage lock, but it refuses to claim
          // ownership of a package Dialed did not install.
          requireReviewedInstalledPackage(request.plan.packageSha256);
          return helperResponse(request, { adopted: true, ownership: state.package.installedByDialed ? 'DIALED_INSTALLED' : 'EXTERNAL_OBSERVED_ONLY', binarySha256: state.package.binarySha256 });
        }
        case 'INSTALL_PACKAGE': {
          requireMutationPreconditions(request);
          if (state.package.present) throw new HelperProtocolError('PACKAGE_ALREADY_PRESENT', 'A driver package is already installed.');
          const reviewedPackage = reviewedPackages.get(request.plan.packageSha256);
          if (!reviewedPackage) throw new HelperProtocolError('PACKAGE_NOT_REVIEWED', 'The requested package is not in the helper-owned reviewed package set.');
          if (failOperations.has(request.operation)) throw enterNeedsReview('The package install failed partway and left unresolved state.');
          state.package = { present: true, binarySha256: reviewedPackage.sha256, serviceName: reviewedPackage.serviceName, oemInfName: reviewedPackage.oemInfName, installedByDialed: true, signatureValid: true };
          return helperResponse(request, { delta: HELPER_ALLOWED_DELTA.INSTALL_PACKAGE, checkpoint: extendCheckpoint() });
        }
        case 'ATTACH_SELECTED_DEVICE': {
          requireMutationPreconditions(request);
          requireReviewedInstalledPackage(request.plan.packageSha256);
          if (request.plan.restartExpected !== attachRequiresRestart) throw new HelperProtocolError('RESTART_EXPECTATION_MISMATCH', 'The reviewed restart expectation does not match the helper-owned operation requirement.');
          const attachment = findAttachment(request.payload.deviceDigest);
          if (!attachment) throw new HelperProtocolError('TARGET_UNKNOWN', 'The selected device is not in the attested inventory.');
          if (attachment.presence !== 'PRESENT') throw new HelperProtocolError('TARGET_DISCONNECTED', 'The selected device is not connected.');
          if (attachment.compatible === false) throw new HelperProtocolError('TARGET_INCOMPATIBLE', 'The selected device is not compatible with the reviewed operation.');
          if (hasServiceFilter(attachment) && !attachment.dialedManaged) throw new HelperProtocolError('ATTACHMENT_ALREADY_EXTERNAL', 'The selected device already has an externally managed filter attachment. Dialed will not claim or remove it.');
          if (failOperations.has(request.operation)) throw enterNeedsReview('The attachment failed partway and left unresolved state.');
          if (!hasServiceFilter(attachment)) attachment.lowerFilters.push(state.package.serviceName);
          if (!attachment.dialedManaged || !Object.prototype.hasOwnProperty.call(attachment, 'previousRequestedHz')) attachment.previousRequestedHz = attachment.requestedHz;
          attachment.requestedHz = request.payload.requestedHz;
          attachment.dialedManaged = true;
          state.restartRequired = attachRequiresRestart;
          state.restartExpectation = state.restartRequired ? {
            previousBootSessionId: state.bootSessionId,
            packageSha256: state.package.binarySha256,
            attachmentsDigest: attachmentsDigest(),
            securityDigest: sha256Hex(stableJson(state.security)),
          } : null;
          return helperResponse(request, { delta: HELPER_ALLOWED_DELTA.ATTACH_SELECTED_DEVICE, restartRequired: state.restartRequired, readbackHz: attachment.requestedHz, checkpoint: extendCheckpoint() });
        }
        case 'DETACH_SELECTED_DEVICE': {
          requireMutationPreconditions(request);
          requireReviewedInstalledPackage(request.plan.packageSha256);
          const attachment = findAttachment(request.payload.deviceDigest);
          if (!attachment) throw new HelperProtocolError('TARGET_UNKNOWN', 'The selected device is not in the attested inventory.');
          if (!attachment.dialedManaged) throw new HelperProtocolError('ATTACHMENT_NOT_DIALED_MANAGED', 'Dialed did not make this attachment and will not remove it.');
          if (failOperations.has(request.operation)) throw enterNeedsReview('The detach failed partway and left unresolved state.');
          attachment.lowerFilters = attachment.lowerFilters.filter((name) => name.toLowerCase() !== state.package.serviceName.toLowerCase());
          // Exact restoration: a rate that existed before Dialed touched it is put back,
          // and a rate that did not exist before is removed rather than zeroed.
          attachment.requestedHz = Object.prototype.hasOwnProperty.call(attachment, 'previousRequestedHz') ? attachment.previousRequestedHz : null;
          delete attachment.previousRequestedHz;
          attachment.dialedManaged = false;
          return helperResponse(request, { delta: HELPER_ALLOWED_DELTA.DETACH_SELECTED_DEVICE, restoredHz: attachment.requestedHz, remainingFilters: [...attachment.lowerFilters], checkpoint: extendCheckpoint() });
        }
        case 'REPAIR_EXACT_PACKAGE':
        case 'UPGRADE_EXACT_PREDECESSOR': {
          requireMutationPreconditions(request);
          if (!state.package.present) throw new HelperProtocolError('PACKAGE_NOT_PRESENT', 'No reviewed driver package is installed.');
          if (!state.package.installedByDialed) throw new HelperProtocolError('EXTERNAL_PACKAGE_NOT_DIALED_OWNED', 'Dialed will not repair or upgrade a package it did not install.');
          if (request.operation === 'REPAIR_EXACT_PACKAGE') requireReviewedInstalledPackage(request.plan.packageSha256);
          if (request.operation === 'UPGRADE_EXACT_PREDECESSOR' && request.payload.predecessorSha256 !== state.package.binarySha256) {
            throw new HelperProtocolError('PREDECESSOR_NOT_ALLOWLISTED', 'The installed package is not the exact allowlisted predecessor.');
          }
          if (request.operation === 'UPGRADE_EXACT_PREDECESSOR') {
            requireReviewedInstalledPackage(request.payload.predecessorSha256);
            const target = reviewedPackages.get(request.plan.packageSha256);
            if (!target) throw new HelperProtocolError('PACKAGE_NOT_REVIEWED', 'The upgrade target is not in the helper-owned reviewed package set.');
            if (target.serviceName.toLowerCase() !== state.package.serviceName.toLowerCase()) throw new HelperProtocolError('SERVICE_IDENTITY_CHANGE_UNSUPPORTED', 'An upgrade cannot change the filter service identity in this protocol version.');
          }
          if (failOperations.has(request.operation)) throw enterNeedsReview('The package maintenance failed partway and left unresolved state.');
          const managed = state.attachments.filter((entry) => entry.dialedManaged);
          if (request.operation === 'UPGRADE_EXACT_PREDECESSOR') {
            const target = reviewedPackages.get(request.plan.packageSha256);
            state.package = { present: true, binarySha256: target.sha256, serviceName: target.serviceName, oemInfName: target.oemInfName, installedByDialed: true, signatureValid: true };
          }
          // Every saved attachment is restored, not silently dropped.
          for (const entry of managed) {
            if (!hasServiceFilter(entry)) entry.lowerFilters.push(state.package.serviceName);
          }
          return helperResponse(request, { delta: HELPER_ALLOWED_DELTA[request.operation], restoredAttachments: managed.map((entry) => entry.deviceDigest).sort(), checkpoint: extendCheckpoint() });
        }
        case 'REMOVE_DETACHED_PACKAGE': {
          requireMutationPreconditions(request);
          if (!state.package.present) throw new HelperProtocolError('PACKAGE_NOT_PRESENT', 'No reviewed driver package is installed.');
          if (!state.package.installedByDialed) throw new HelperProtocolError('EXTERNAL_PACKAGE_NOT_DIALED_OWNED', 'Dialed will not remove a package it did not install.');
          requireReviewedInstalledPackage(request.plan.packageSha256);
          // Present, non-present and phantom scope all count. A phantom attachment left
          // behind is exactly how a later reconnect breaks a device.
          const remaining = state.attachments.filter((entry) => entry.dialedManaged || hasServiceFilter(entry));
          if (remaining.length > 0) throw new HelperProtocolError('MANAGED_ATTACHMENT_REMAINS', `Package removal requires every managed attachment to be absent first; ${remaining.length} remain, including ${remaining.map((entry) => entry.presence).join(', ')} scope.`);
          if (failOperations.has(request.operation)) throw enterNeedsReview('The package removal failed partway and left unresolved state.');
          state.package = { present: false, binarySha256: null, serviceName: null, oemInfName: null, installedByDialed: false, signatureValid: false };
          return helperResponse(request, { delta: HELPER_ALLOWED_DELTA.REMOVE_DETACHED_PACKAGE, checkpoint: extendCheckpoint() });
        }
        default:
          return helperFailure(request, 'UNKNOWN_OPERATION', 'Unsupported helper operation.');
      }
    } catch (error) {
      return helperFailure(request, error.code || 'HELPER_FAILED', error.message);
    }
  }

  return deepFreeze({
    handle,
    // Read-only views for assertions. They copy, so a test cannot mutate helper state.
    snapshot() { return clone({ package: state.package, attachments: state.attachments, security: state.security, needsReview: state.needsReview, restartRequired: state.restartRequired, checkpointSequence: state.checkpointSequence, bootSessionId: state.bootSessionId }); },
    // Test hooks model Windows changing boot identity and the native helper subsequently
    // reconciling its own exact post-restart state. Merely supplying a string cannot
    // clear the restart lock.
    simulateRestart(nextBootSessionId) {
      if (!state.restartRequired || !state.restartExpectation) throw new HelperProtocolError('RESTART_NOT_REQUIRED', 'There is no pending restart to simulate.');
      if (typeof nextBootSessionId !== 'string' || nextBootSessionId.length === 0 || nextBootSessionId === state.bootSessionId) throw new HelperProtocolError('RESTART_NOT_OBSERVED', 'A distinct observed boot-session identity is required.');
      state.bootSessionId = nextBootSessionId;
      state.driverSessionId = `session-${nextBootSessionId}`;
      state.sealed = null;
    },
    reconcileRestart() {
      const expected = state.restartExpectation;
      if (!state.restartRequired || !expected) throw new HelperProtocolError('RESTART_NOT_REQUIRED', 'There is no pending restart to reconcile.');
      if (state.bootSessionId === expected.previousBootSessionId) throw new HelperProtocolError('RESTART_NOT_OBSERVED', 'The Windows boot session did not change.');
      if (state.package.binarySha256 !== expected.packageSha256 || attachmentsDigest() !== expected.attachmentsDigest || sha256Hex(stableJson(state.security)) !== expected.securityDigest || !state.inventoryComplete) {
        throw new HelperProtocolError('POST_RESTART_DRIFT', 'Package, attachment, security, or inventory state drifted after restart.');
      }
      state.restartRequired = false;
      state.restartExpectation = null;
      state.sealed = null;
      return { reconciled: true, bootSessionId: state.bootSessionId, driverSessionId: state.driverSessionId };
    },
    setSecurity(next) { Object.assign(state.security, next); state.sealed = null; },
    setInventoryComplete(value) { state.inventoryComplete = value; state.sealed = null; },
  });
}

module.exports = {
  ALLOWED_REQUEST_HZ,
  HELPER_ALLOWED_DELTA,
  HELPER_OPERATIONS,
  HELPER_PROTOCOL_VERSION,
  HelperProtocolError,
  MUTATING_HELPER_OPERATIONS,
  PRESENCE_STATES,
  createDeterministicHelper,
  createHelperSession,
  planDigest,
  sealPreimage,
  validateHelperRequest,
  validateOperationPayload,
  validatePlan,
};
