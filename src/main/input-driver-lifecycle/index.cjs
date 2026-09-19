const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { createPreviewStore } = require('../shared/preview-store.cjs');

const MANIFEST_SCHEMA_VERSION = '2.0.0';
const STORE_SCHEMA_VERSION = '2.0.0';
const TRUSTED_ADAPTER_KIND = 'DIALED_TRUSTED_WINDOWS_DRIVER_ADAPTER_V1';
const STORE_CONTRACT_KIND = 'DIALED_PROTECTED_MACHINE_STORE_V1';
const REQUIRED_PAYLOAD_ROLES = Object.freeze(['INF', 'SYS', 'CAT', 'HELPER']);
const ALLOWED_POLLING_RATES = Object.freeze([125, 250, 500, 1000, 2000, 4000, 8000]);
const TOKEN_TTL_MS = 2 * 60 * 1000;
const DEVICE_DIGEST_PATTERN = /^[a-f0-9]{64}$/;
const OPERATION_ID_PATTERN = /^[A-Za-z0-9_-]{20,80}$/;
const CHECKPOINT_ID_PATTERN = /^[A-Za-z0-9_-]{20,80}$/;
const NATIVE_PREIMAGE_SCHEMA = 'DIALED_NATIVE_PREIMAGE_V1';
// The helper-owned digest is required to cover this complete native preimage. None of
// these native values cross the service boundary or enter the renderer-visible API.
const NATIVE_PREIMAGE_BINDINGS = Object.freeze([
  'LOWER_FILTERS_ORDERED_WITH_ABSENCE',
  'USB_BINTERVAL_REQUEST',
  'FILTER_SERVICE_AND_OEM_INF_IDENTITY',
  'PACKAGE_IDENTITY_AND_DRIVER_SHA256',
  'MEMORY_INTEGRITY_AND_SECURE_BOOT',
  'PRESENT_NON_PRESENT_PHANTOM_ATTACHMENTS_AND_COMPLETENESS',
  'BOOT_ID_AND_DRIVER_SESSION',
]);
const NATIVE_PREIMAGE_BINDINGS_SHA256 = sha256(stableJson(NATIVE_PREIMAGE_BINDINGS));
const trustedAdapterAttestations = new WeakMap();
const trustedStoreAttestations = new WeakMap();
const fixtureFileStores = new WeakSet();

const LIFECYCLE_STATES = Object.freeze([
  'UNAVAILABLE', 'READY_FOR_PREFLIGHT', 'EXTERNAL_PACKAGE_PRESENT', 'INSTALL_PREVIEWED',
  'INSTALLING_PACKAGE', 'PACKAGE_INSTALLED', 'ATTACHING_FILTER', 'FILTER_ATTACHED',
  'RESTART_REQUIRED', 'ACTIVE', 'REPAIR_PREVIEWED', 'REPAIRING_PACKAGE',
  'UPGRADE_PREVIEWED', 'UPGRADING_PACKAGE', 'DETACH_PREVIEWED', 'DETACHING_FILTER',
  'FILTER_DETACHED', 'PACKAGE_REMOVAL_PREVIEWED', 'REMOVING_PACKAGE', 'REMOVED', 'NOT_APPLIED', 'NEEDS_REVIEW',
]);

const TRANSITIONS = Object.freeze({
  READY_FOR_PREFLIGHT: Object.freeze({ PREVIEW_INSTALL: 'INSTALL_PREVIEWED' }),
  EXTERNAL_PACKAGE_PRESENT: Object.freeze({ PREVIEW_ADOPTION: 'INSTALL_PREVIEWED' }),
  INSTALL_PREVIEWED: Object.freeze({ INSTALL_PACKAGE: 'INSTALLING_PACKAGE', ATTACH_FILTER: 'ATTACHING_FILTER', CANCEL: 'READY_FOR_PREFLIGHT', FAIL: 'NEEDS_REVIEW' }),
  INSTALLING_PACKAGE: Object.freeze({ PACKAGE_INSTALLED: 'PACKAGE_INSTALLED', FAIL: 'NEEDS_REVIEW' }),
  PACKAGE_INSTALLED: Object.freeze({ ATTACH_FILTER: 'ATTACHING_FILTER', FAIL: 'NEEDS_REVIEW' }),
  ATTACHING_FILTER: Object.freeze({ FILTER_ATTACHED: 'FILTER_ATTACHED', FAIL: 'NEEDS_REVIEW' }),
  FILTER_ATTACHED: Object.freeze({ REQUIRE_RESTART: 'RESTART_REQUIRED', VERIFY_ACTIVE: 'ACTIVE', PREVIEW_DETACH: 'DETACH_PREVIEWED', PREVIEW_REPAIR: 'REPAIR_PREVIEWED', PREVIEW_UPGRADE: 'UPGRADE_PREVIEWED', FAIL: 'NEEDS_REVIEW' }),
  RESTART_REQUIRED: Object.freeze({ VERIFY_ACTIVE: 'ACTIVE', FAIL: 'NEEDS_REVIEW' }),
  ACTIVE: Object.freeze({ PREVIEW_DETACH: 'DETACH_PREVIEWED', PREVIEW_REPAIR: 'REPAIR_PREVIEWED', PREVIEW_UPGRADE: 'UPGRADE_PREVIEWED', FAIL: 'NEEDS_REVIEW' }),
  REPAIR_PREVIEWED: Object.freeze({ REPAIR_PACKAGE: 'REPAIRING_PACKAGE', FAIL: 'NEEDS_REVIEW' }),
  REPAIRING_PACKAGE: Object.freeze({ FILTER_ATTACHED: 'FILTER_ATTACHED', FILTER_DETACHED: 'FILTER_DETACHED', FAIL: 'NEEDS_REVIEW' }),
  UPGRADE_PREVIEWED: Object.freeze({ UPGRADE_PACKAGE: 'UPGRADING_PACKAGE', FAIL: 'NEEDS_REVIEW' }),
  UPGRADING_PACKAGE: Object.freeze({ FILTER_ATTACHED: 'FILTER_ATTACHED', FILTER_DETACHED: 'FILTER_DETACHED', FAIL: 'NEEDS_REVIEW' }),
  DETACH_PREVIEWED: Object.freeze({ DETACH_FILTER: 'DETACHING_FILTER', FAIL: 'NEEDS_REVIEW' }),
  DETACHING_FILTER: Object.freeze({ FILTER_ATTACHED: 'FILTER_ATTACHED', FILTER_DETACHED: 'FILTER_DETACHED', FAIL: 'NEEDS_REVIEW' }),
  FILTER_DETACHED: Object.freeze({ PREVIEW_REPAIR: 'REPAIR_PREVIEWED', PREVIEW_UPGRADE: 'UPGRADE_PREVIEWED', PREVIEW_REMOVE_PACKAGE: 'PACKAGE_REMOVAL_PREVIEWED', PREVIEW_INSTALL: 'INSTALL_PREVIEWED', FAIL: 'NEEDS_REVIEW' }),
  PACKAGE_REMOVAL_PREVIEWED: Object.freeze({ REMOVE_PACKAGE: 'REMOVING_PACKAGE', FAIL: 'NEEDS_REVIEW' }),
  REMOVING_PACKAGE: Object.freeze({ REMOVED: 'REMOVED', FAIL: 'NEEDS_REVIEW' }),
  REMOVED: Object.freeze({ PREVIEW_INSTALL: 'INSTALL_PREVIEWED' }),
  NOT_APPLIED: Object.freeze({ PREVIEW_INSTALL: 'INSTALL_PREVIEWED' }),
  NEEDS_REVIEW: Object.freeze({ REVIEW_RESOLVED: 'READY_FOR_PREFLIGHT' }),
});

class LifecycleError extends Error {
  constructor(code, message, operationId) {
    super(message);
    this.name = 'LifecycleError';
    this.code = code;
    if (operationId) this.operationId = operationId;
  }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function assertString(value, label, pattern, maximum = 500) {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum || (pattern && !pattern.test(value))) throw new Error(`${label} is not valid.`);
  return value;
}

function assertExactKeys(value, allowed, label) {
  if (!isPlainObject(value)) throw new Error(`${label} must be an object.`);
  const unexpected = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unexpected.length) throw new Error(`${label} contains unsupported fields: ${unexpected.join(', ')}.`);
}

function isSafeRelativePath(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 180 || /[\x00-\x1f\x7f]/.test(value)) return false;
  const normalized = value.replace(/\\/g, '/');
  if (path.win32.isAbsolute(value) || path.posix.isAbsolute(normalized)) return false;
  if (normalized.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')) return false;
  return normalized === path.posix.normalize(normalized);
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (isPlainObject(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

// These production attesters deliberately remain module-private. A future signed-
// helper client factory must perform native signature/identity verification before
// calling them; arbitrary callers cannot promote a plain object into production.
function attestSignedHelperAdapter(adapter, attestation) {
  if (!isPlainObject(adapter) || !isPlainObject(attestation)) throw new Error('A signed narrow helper adapter attestation is required.');
  assertExactKeys(attestation, ['kind', 'signed', 'narrowInterface', 'helperThumbprint', 'helperSha256'], 'helper adapter attestation');
  if (attestation.kind !== 'SIGNED_NARROW_HELPER_ATTESTATION_V1' || attestation.signed !== true || attestation.narrowInterface !== true) throw new Error('Helper adapter attestation is not trusted.');
  assertString(attestation.helperThumbprint, 'helper adapter attestation.helperThumbprint', /^[A-Fa-f0-9]{40,128}$/);
  assertString(attestation.helperSha256, 'helper adapter attestation.helperSha256', /^[a-f0-9]{64}$/);
  trustedAdapterAttestations.set(adapter, deepFreeze({ ...clone(attestation), helperThumbprint: attestation.helperThumbprint.toUpperCase(), testOnly: false }));
  return adapter;
}

function attestProtectedHelperStore(store, attestation) {
  if (!isPlainObject(store) || fixtureFileStores.has(store) || !isPlainObject(attestation)) throw new Error('A helper-owned protected store client is required.');
  assertExactKeys(attestation, ['kind', 'identity', 'protectedMachineDirectory', 'crossProcessCas', 'appendOnlyJournal'], 'protected store attestation');
  if (attestation.kind !== 'SIGNED_HELPER_PROTECTED_STORE_V1' || attestation.protectedMachineDirectory !== true || attestation.crossProcessCas !== true || attestation.appendOnlyJournal !== true) throw new Error('Protected store attestation is not trusted.');
  assertString(attestation.identity, 'protected store attestation.identity', /^[a-f0-9]{64}$/);
  trustedStoreAttestations.set(store, deepFreeze({ ...clone(attestation), testOnly: false }));
  return store;
}

function attestTestOnlyAdapter(adapter) {
  if (!isPlainObject(adapter)) throw new Error('A test adapter object is required.');
  trustedAdapterAttestations.set(adapter, deepFreeze({ kind: 'TEST_ONLY_FIXTURE', testOnly: true }));
  return adapter;
}

function attestTestOnlyStore(store, identity = 'f'.repeat(64)) {
  if (!isPlainObject(store)) throw new Error('A test store object is required.');
  assertString(identity, 'test store identity', /^[a-f0-9]{64}$/);
  trustedStoreAttestations.set(store, deepFreeze({ kind: 'TEST_ONLY_FIXTURE', identity, protectedMachineDirectory: true, crossProcessCas: true, appendOnlyJournal: true, testOnly: true }));
  return store;
}

function validateDeviceDigest(value) {
  if (typeof value !== 'string' || !DEVICE_DIGEST_PATTERN.test(value)) throw new LifecycleError('INVALID_DEVICE_SCOPE', 'The selected device could not be matched to a trusted local scan.');
  return value;
}

function validateRequestedHz(value, manifest) {
  if (!Number.isSafeInteger(value) || !manifest.polling.requestsHz.includes(value)) throw new LifecycleError('UNSUPPORTED_POLLING_REQUEST', 'The selected polling request is not supported by this reviewed package.');
  return value;
}

function validateEkuOids(value, label) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 12) throw new Error(`${label} is not valid.`);
  const normalized = value.map((oid, index) => assertString(oid, `${label}[${index}]`, /^\d+(?:\.\d+){2,15}$/, 120)).sort();
  if (new Set(normalized).size !== normalized.length) throw new Error(`${label} must not contain duplicates.`);
  return normalized;
}

function validateSignerPolicy(value, label) {
  assertExactKeys(value, ['subject', 'thumbprint', 'requiredEkuOids'], label);
  return {
    subject: assertString(value.subject, `${label}.subject`, null, 300),
    thumbprint: assertString(value.thumbprint, `${label}.thumbprint`, /^[A-Fa-f0-9]{40,128}$/).toUpperCase(),
    requiredEkuOids: validateEkuOids(value.requiredEkuOids, `${label}.requiredEkuOids`),
  };
}

function validateInfContract(value) {
  assertExactKeys(value, ['provider', 'class', 'classGuid', 'catalogName', 'driverVersion', 'installModel', 'service'], 'driverPackage.inf');
  assertExactKeys(value.service, ['name', 'startType', 'imagePath'], 'driverPackage.inf.service');
  const contract = {
    provider: assertString(value.provider, 'driverPackage.inf.provider', null, 200),
    class: assertString(value.class, 'driverPackage.inf.class', /^[A-Za-z][A-Za-z0-9._ -]{0,79}$/),
    classGuid: assertString(value.classGuid, 'driverPackage.inf.classGuid', /^\{[A-Fa-f0-9]{8}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{12}\}$/).toUpperCase(),
    catalogName: assertString(value.catalogName, 'driverPackage.inf.catalogName', /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}\.cat$/i),
    driverVersion: assertString(value.driverVersion, 'driverPackage.inf.driverVersion', /^(0[1-9]|1[0-2])\/(0[1-9]|[12]\d|3[01])\/(19|20)\d{2},\d{1,5}(?:\.\d{1,5}){3}$/),
    installModel: value.installModel,
    service: {
      name: assertString(value.service.name, 'driverPackage.inf.service.name', /^[A-Za-z][A-Za-z0-9._-]{0,79}$/),
      startType: value.service.startType,
      imagePath: assertString(value.service.imagePath, 'driverPackage.inf.service.imagePath', /^\\SystemRoot\\System32\\drivers\\[A-Za-z0-9][A-Za-z0-9._-]{0,119}\.sys$/i),
    },
  };
  if (contract.installModel !== 'PNP_FILTER') throw new Error('driverPackage.inf.installModel must be PNP_FILTER.');
  if (contract.service.startType !== 'DEMAND_START') throw new Error('driverPackage.inf.service.startType must be DEMAND_START.');
  return contract;
}

function validateManifest(raw) {
  if (!isPlainObject(raw)) throw new Error('Driver package manifest must be an object.');
  assertExactKeys(raw, ['schemaVersion', 'packageId', 'version', 'architecture', 'upstream', 'redistributionPermission', 'publisher', 'driverPackage', 'signingPolicy', 'compatibility', 'polling', 'upgradePredecessors', 'files'], 'Driver package manifest');
  if (raw.schemaVersion !== MANIFEST_SCHEMA_VERSION) throw new Error(`Driver package manifest schemaVersion must be ${MANIFEST_SCHEMA_VERSION}.`);
  assertString(raw.packageId, 'packageId', /^[a-z0-9][a-z0-9.-]{2,79}$/);
  assertString(raw.version, 'version', /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/);
  if (raw.architecture !== 'x64') throw new Error('Only the reviewed x64 driver package architecture is supported.');

  assertExactKeys(raw.upstream, ['name', 'sourceUrl', 'version'], 'upstream');
  assertString(raw.upstream.name, 'upstream.name', null, 120);
  assertString(raw.upstream.sourceUrl, 'upstream.sourceUrl', /^https:\/\//i);
  assertString(raw.upstream.version, 'upstream.version', null, 80);

  assertExactKeys(raw.redistributionPermission, ['packageRoute', 'evidence', 'attribution', 'grants'], 'redistributionPermission');
  if (!['UNMODIFIED_RIGHTS_HOLDER', 'AUTHORIZED_DERIVATIVE'].includes(raw.redistributionPermission.packageRoute)) throw new Error('redistributionPermission.packageRoute is not supported.');
  assertString(raw.redistributionPermission.evidence, 'redistributionPermission.evidence', /^(?:https:\/\/[^\s]+|sha256:[a-f0-9]{64})$/i);
  assertString(raw.redistributionPermission.attribution, 'redistributionPermission.attribution', null, 500);
  assertExactKeys(raw.redistributionPermission.grants, ['commercialRedistribution', 'bundling', 'automation', 'modification'], 'redistributionPermission.grants');
  for (const grant of ['commercialRedistribution', 'bundling', 'automation']) if (raw.redistributionPermission.grants[grant] !== true) throw new Error(`redistributionPermission.grants.${grant} must be explicitly approved.`);
  if (typeof raw.redistributionPermission.grants.modification !== 'boolean') throw new Error('redistributionPermission.grants.modification must be explicit.');
  if (raw.redistributionPermission.packageRoute === 'AUTHORIZED_DERIVATIVE' && raw.redistributionPermission.grants.modification !== true) throw new Error('Derivative packages require explicit modification permission.');

  assertExactKeys(raw.publisher, ['subject', 'thumbprint'], 'publisher');
  assertString(raw.publisher.subject, 'publisher.subject', null, 300);
  assertString(raw.publisher.thumbprint, 'publisher.thumbprint', /^[A-Fa-f0-9]{40,128}$/);

  assertExactKeys(raw.driverPackage, ['inf'], 'driverPackage');
  const infContract = validateInfContract(raw.driverPackage.inf);

  assertExactKeys(raw.signingPolicy, ['catalogRequiredEkuOids', 'systemBinary', 'helper', 'application', 'revocation'], 'signingPolicy');
  const catalogRequiredEkuOids = validateEkuOids(raw.signingPolicy.catalogRequiredEkuOids, 'signingPolicy.catalogRequiredEkuOids');
  const systemBinarySigner = validateSignerPolicy(raw.signingPolicy.systemBinary, 'signingPolicy.systemBinary');
  const helperSigner = validateSignerPolicy(raw.signingPolicy.helper, 'signingPolicy.helper');
  const applicationSigner = validateSignerPolicy(raw.signingPolicy.application, 'signingPolicy.application');
  assertExactKeys(raw.signingPolicy.revocation, ['mode', 'failClosed', 'maximumEvidenceAgeHours', 'requireTimestamp'], 'signingPolicy.revocation');
  if (raw.signingPolicy.revocation.mode !== 'ONLINE_REQUIRED' || raw.signingPolicy.revocation.failClosed !== true || raw.signingPolicy.revocation.requireTimestamp !== true) throw new Error('Runtime signature revocation and timestamp checks must fail closed.');
  if (!Number.isSafeInteger(raw.signingPolicy.revocation.maximumEvidenceAgeHours) || raw.signingPolicy.revocation.maximumEvidenceAgeHours < 1 || raw.signingPolicy.revocation.maximumEvidenceAgeHours > 168) throw new Error('signingPolicy.revocation.maximumEvidenceAgeHours is not valid.');

  assertExactKeys(raw.compatibility, ['windows', 'memoryIntegrity', 'secureBoot'], 'compatibility');
  assertExactKeys(raw.compatibility.windows, ['minimumBuild', 'maximumBuild'], 'compatibility.windows');
  const minimumBuild = raw.compatibility.windows.minimumBuild;
  const maximumBuild = raw.compatibility.windows.maximumBuild;
  if (!Number.isSafeInteger(minimumBuild) || minimumBuild < 17763) throw new Error('compatibility.windows.minimumBuild is not valid.');
  if (maximumBuild !== null && (!Number.isSafeInteger(maximumBuild) || maximumBuild < minimumBuild)) throw new Error('compatibility.windows.maximumBuild is not valid.');
  if (raw.compatibility.memoryIntegrity !== 'SUPPORTED') throw new Error('The package must support Memory Integrity without changing Windows security policy.');
  if (raw.compatibility.secureBoot !== 'SUPPORTED') throw new Error('The package must support Secure Boot without changing Windows security policy.');

  assertExactKeys(raw.polling, ['requestsHz', 'maximumRequestHz'], 'polling');
  if (!Array.isArray(raw.polling.requestsHz) || raw.polling.requestsHz.length === 0) throw new Error('polling.requestsHz is not valid.');
  const requestsHz = [...raw.polling.requestsHz];
  if (requestsHz.some((rate) => !ALLOWED_POLLING_RATES.includes(rate)) || new Set(requestsHz).size !== requestsHz.length) throw new Error('polling.requestsHz contains unsupported or duplicate rates.');
  requestsHz.sort((left, right) => left - right);
  if (raw.polling.maximumRequestHz !== requestsHz[requestsHz.length - 1]) throw new Error('polling.maximumRequestHz must equal the highest reviewed request.');

  if (!Array.isArray(raw.upgradePredecessors) || raw.upgradePredecessors.length > 24) throw new Error('upgradePredecessors is not valid.');
  const predecessorKeys = new Set();
  const upgradePredecessors = raw.upgradePredecessors.map((predecessor, index) => {
    assertExactKeys(predecessor, ['packageId', 'version', 'manifestSha256', 'publisherSubject', 'publisherThumbprint'], `upgradePredecessors[${index}]`);
    const normalized = {
      packageId: assertString(predecessor.packageId, `upgradePredecessors[${index}].packageId`, /^[a-z0-9][a-z0-9.-]{2,79}$/),
      version: assertString(predecessor.version, `upgradePredecessors[${index}].version`, /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/),
      manifestSha256: assertString(predecessor.manifestSha256, `upgradePredecessors[${index}].manifestSha256`, /^[a-f0-9]{64}$/),
      publisherSubject: assertString(predecessor.publisherSubject, `upgradePredecessors[${index}].publisherSubject`, null, 300),
      publisherThumbprint: assertString(predecessor.publisherThumbprint, `upgradePredecessors[${index}].publisherThumbprint`, /^[A-Fa-f0-9]{40,128}$/).toUpperCase(),
    };
    const key = stableJson(normalized);
    if (predecessorKeys.has(key)) throw new Error('upgradePredecessors must not contain duplicates.');
    predecessorKeys.add(key);
    return normalized;
  });

  if (!Array.isArray(raw.files) || raw.files.length === 0 || raw.files.length > 12) throw new Error('Driver payload file list is missing or too large.');
  const paths = new Set();
  const roles = new Set();
  const files = raw.files.map((file, index) => {
    assertExactKeys(file, ['role', 'path', 'bytes', 'sha256', 'catalogMembership'], `files[${index}]`);
    if (!REQUIRED_PAYLOAD_ROLES.includes(file.role)) throw new Error(`files[${index}].role is not supported.`);
    if (!isSafeRelativePath(file.path)) throw new Error(`files[${index}].path is not a safe relative path.`);
    const normalizedPath = file.path.replace(/\\/g, '/');
    if (paths.has(normalizedPath.toLowerCase())) throw new Error('Driver payload paths must be unique.');
    if (roles.has(file.role)) throw new Error('Driver payload roles must be unique.');
    if (!Number.isSafeInteger(file.bytes) || file.bytes <= 0) throw new Error(`files[${index}].bytes is not valid.`);
    assertString(file.sha256, `files[${index}].sha256`, /^[a-f0-9]{64}$/);
    const requiredMembership = ['INF', 'SYS'].includes(file.role) ? 'REQUIRED' : 'NOT_APPLICABLE';
    if (file.catalogMembership !== requiredMembership) throw new Error(`files[${index}].catalogMembership must be ${requiredMembership} for ${file.role}.`);
    paths.add(normalizedPath.toLowerCase());
    roles.add(file.role);
    return { role: file.role, path: normalizedPath, bytes: file.bytes, sha256: file.sha256, catalogMembership: file.catalogMembership };
  });
  for (const role of REQUIRED_PAYLOAD_ROLES) if (!roles.has(role)) throw new Error(`Driver payload is missing its ${role} file.`);
  const fileByRole = new Map(files.map((file) => [file.role, file]));
  if (path.posix.basename(fileByRole.get('CAT').path).toLowerCase() !== infContract.catalogName.toLowerCase()) throw new Error('INF catalogName must exactly name the reviewed CAT payload.');
  if (path.win32.basename(infContract.service.imagePath).toLowerCase() !== path.posix.basename(fileByRole.get('SYS').path).toLowerCase()) throw new Error('INF service imagePath must exactly name the reviewed SYS payload.');

  const manifest = {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    packageId: raw.packageId,
    version: raw.version,
    architecture: raw.architecture,
    upstream: clone(raw.upstream),
    redistributionPermission: { packageRoute: raw.redistributionPermission.packageRoute, evidence: raw.redistributionPermission.evidence, attribution: raw.redistributionPermission.attribution, grants: clone(raw.redistributionPermission.grants) },
    publisher: { subject: raw.publisher.subject, thumbprint: raw.publisher.thumbprint.toUpperCase() },
    driverPackage: { inf: infContract },
    signingPolicy: {
      catalogRequiredEkuOids,
      systemBinary: systemBinarySigner,
      helper: helperSigner,
      application: applicationSigner,
      revocation: clone(raw.signingPolicy.revocation),
    },
    compatibility: { windows: { minimumBuild, maximumBuild }, memoryIntegrity: 'SUPPORTED', secureBoot: 'SUPPORTED' },
    polling: { requestsHz, maximumRequestHz: raw.polling.maximumRequestHz },
    upgradePredecessors: upgradePredecessors.sort((left, right) => stableJson(left).localeCompare(stableJson(right))),
    files: files.sort((left, right) => left.role.localeCompare(right.role)),
  };
  return deepFreeze({ manifest, manifestSha256: sha256(stableJson(manifest)) });
}

function verifyPayload(manifest, payloadRoot, readFile = fs.readFileSync) {
  const resolvedRoot = path.resolve(payloadRoot);
  const physicalRoot = fs.realpathSync(resolvedRoot);
  return manifest.files.map((file) => {
    const resolved = path.resolve(resolvedRoot, file.path);
    if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) throw new Error('A payload path escaped its package root.');
    const stat = fs.lstatSync(resolved);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('A payload entry was not an immutable regular file.');
    const physicalFile = fs.realpathSync(resolved);
    if (!physicalFile.startsWith(`${physicalRoot}${path.sep}`)) throw new Error('A payload entry escaped its physical package root.');
    const content = readFile(resolved);
    if (!Buffer.isBuffer(content) && !(content instanceof Uint8Array)) throw new Error('A payload file could not be read as bytes.');
    if (content.length !== file.bytes) throw new Error('A payload byte count did not match the immutable manifest.');
    if (sha256(content) !== file.sha256) throw new Error('A payload hash did not match the immutable manifest.');
    return deepFreeze({ ...file, absolutePath: resolved, verified: true });
  });
}

function transitionLifecycle(currentState, event) {
  if (!LIFECYCLE_STATES.includes(currentState)) throw new Error('Unknown input-driver lifecycle state.');
  const next = TRANSITIONS[currentState]?.[event];
  if (!next) throw new Error(`Input-driver lifecycle event ${event} is not allowed from ${currentState}.`);
  return next;
}

function compareExactState(expected, observed) {
  const differences = [];
  function visit(left, right, label) {
    if (Array.isArray(left) || Array.isArray(right)) {
      if (!Array.isArray(left) || !Array.isArray(right) || stableJson(left) !== stableJson(right)) differences.push(label || 'state');
      return;
    }
    if (isPlainObject(left) || isPlainObject(right)) {
      if (!isPlainObject(left) || !isPlainObject(right)) { differences.push(label || 'state'); return; }
      for (const key of [...new Set([...Object.keys(left), ...Object.keys(right)])].sort()) visit(left[key], right[key], label ? `${label}.${key}` : key);
      return;
    }
    if (left !== right) differences.push(label || 'state');
  }
  visit(expected, observed, '');
  return deepFreeze({ matches: differences.length === 0, differences: [...new Set(differences)] });
}

function comparableSealedState(observation, options = {}) {
  const value = clone(observation);
  const checkpoint = value.nativeCheckpoint;
  value.nativeCheckpoint = {
    digest: options.ignoreDigest ? '<reviewed-transition>' : checkpoint.digest,
    journalIdentity: checkpoint.journalIdentity,
    bootId: options.ignoreBootId ? '<reviewed-boot-transition>' : checkpoint.bootId,
    preimageSchema: checkpoint.preimageSchema,
    preimageBindingsSha256: checkpoint.preimageBindingsSha256,
    immutablePreimage: checkpoint.immutablePreimage,
    appendOnlyJournal: checkpoint.appendOnlyJournal,
    helperAttested: checkpoint.helperAttested,
  };
  return value;
}

function compareSealedState(expected, observed, options = {}) {
  return compareExactState(comparableSealedState(expected, options), comparableSealedState(observed, options));
}

function normalizePackageIdentity(value) {
  if (value === null) return null;
  assertExactKeys(value, ['packageId', 'version', 'manifestSha256', 'publisherSubject', 'publisherThumbprint'], 'observed package');
  return {
    packageId: assertString(value.packageId, 'observed package.packageId', /^[a-z0-9][a-z0-9.-]{2,79}$/),
    version: assertString(value.version, 'observed package.version', /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/),
    manifestSha256: assertString(value.manifestSha256, 'observed package.manifestSha256', /^[a-f0-9]{64}$/),
    publisherSubject: assertString(value.publisherSubject, 'observed package.publisherSubject', null, 300),
    publisherThumbprint: assertString(value.publisherThumbprint, 'observed package.publisherThumbprint', /^[A-Fa-f0-9]{40,128}$/).toUpperCase(),
  };
}

function normalizeNativeCheckpoint(value) {
  assertExactKeys(value, ['kind', 'id', 'digest', 'journalIdentity', 'bootId', 'sequence', 'previousId', 'operationId', 'sealedAt', 'preimageSchema', 'preimageBindingsSha256', 'immutablePreimage', 'appendOnlyJournal', 'helperAttested'], 'adapter observation.nativeCheckpoint');
  const checkpoint = {
    kind: value.kind,
    id: assertString(value.id, 'nativeCheckpoint.id', CHECKPOINT_ID_PATTERN),
    digest: assertString(value.digest, 'nativeCheckpoint.digest', /^[a-f0-9]{64}$/),
    journalIdentity: assertString(value.journalIdentity, 'nativeCheckpoint.journalIdentity', /^[a-f0-9]{64}$/),
    bootId: assertString(value.bootId, 'nativeCheckpoint.bootId', /^[a-f0-9]{64}$/),
    sequence: value.sequence,
    previousId: value.previousId,
    operationId: value.operationId,
    sealedAt: value.sealedAt,
    preimageSchema: value.preimageSchema,
    preimageBindingsSha256: value.preimageBindingsSha256,
    immutablePreimage: value.immutablePreimage,
    appendOnlyJournal: value.appendOnlyJournal,
    helperAttested: value.helperAttested,
  };
  if (!['STATE_ATTESTATION', 'RECOVERY_CHECKPOINT'].includes(checkpoint.kind)) throw new Error('nativeCheckpoint.kind is not valid.');
  if (!Number.isSafeInteger(checkpoint.sequence) || checkpoint.sequence < 1) throw new Error('nativeCheckpoint.sequence is not valid.');
  if (checkpoint.previousId !== null && (typeof checkpoint.previousId !== 'string' || !CHECKPOINT_ID_PATTERN.test(checkpoint.previousId))) throw new Error('nativeCheckpoint.previousId is not valid.');
  if (checkpoint.operationId !== null && (typeof checkpoint.operationId !== 'string' || !OPERATION_ID_PATTERN.test(checkpoint.operationId))) throw new Error('nativeCheckpoint.operationId is not valid.');
  if (typeof checkpoint.sealedAt !== 'string' || Number.isNaN(Date.parse(checkpoint.sealedAt))) throw new Error('nativeCheckpoint.sealedAt is not valid.');
  if (checkpoint.preimageSchema !== NATIVE_PREIMAGE_SCHEMA || checkpoint.preimageBindingsSha256 !== NATIVE_PREIMAGE_BINDINGS_SHA256) throw new Error('Native recovery checkpoint did not bind the complete reviewed preimage schema.');
  if (checkpoint.immutablePreimage !== true || checkpoint.appendOnlyJournal !== true || checkpoint.helperAttested !== true) throw new Error('Native recovery checkpoint attestation is incomplete.');
  return checkpoint;
}

function normalizeObservation(value) {
  assertExactKeys(value, ['package', 'attachments', 'restartRequired', 'inventory', 'nativeCheckpoint'], 'adapter observation');
  assertExactKeys(value.inventory, ['presentComplete', 'nonPresentComplete', 'phantomComplete'], 'adapter observation.inventory');
  if (value.inventory.presentComplete !== true || value.inventory.nonPresentComplete !== true || value.inventory.phantomComplete !== true) throw new LifecycleError('ATTACHMENT_INVENTORY_INCOMPLETE', 'Windows did not provide a complete present, non-present, and phantom filtered-device inventory.');
  if (!Array.isArray(value.attachments) || value.attachments.length > 128) throw new Error('adapter observation.attachments is not valid.');
  const seen = new Set();
  const attachments = value.attachments.map((attachment, index) => {
    assertExactKeys(attachment, ['deviceDigest', 'requestedHz', 'presence'], `adapter observation.attachments[${index}]`);
    const deviceDigest = validateDeviceDigest(attachment.deviceDigest);
    if (seen.has(deviceDigest)) throw new Error('adapter observation contains duplicate attachment scopes.');
    if (attachment.requestedHz !== null && (!Number.isSafeInteger(attachment.requestedHz) || !ALLOWED_POLLING_RATES.includes(attachment.requestedHz))) throw new Error('adapter observation contains an invalid polling request.');
    if (!['PRESENT', 'NON_PRESENT', 'PHANTOM'].includes(attachment.presence)) throw new Error('adapter observation contains an invalid attachment presence.');
    seen.add(deviceDigest);
    return { deviceDigest, requestedHz: attachment.requestedHz, presence: attachment.presence };
  }).sort((left, right) => left.deviceDigest.localeCompare(right.deviceDigest));
  if (typeof value.restartRequired !== 'boolean') throw new Error('adapter observation.restartRequired is not valid.');
  const packageIdentity = normalizePackageIdentity(value.package);
  if (packageIdentity === null && attachments.length) throw new LifecycleError('INCONSISTENT_NATIVE_STATE', 'Windows reported filtered-device attachments without an installed reviewed package.');
  return deepFreeze({ package: packageIdentity, attachments, restartRequired: value.restartRequired, inventory: { presentComplete: true, nonPresentComplete: true, phantomComplete: true }, nativeCheckpoint: normalizeNativeCheckpoint(value.nativeCheckpoint) });
}

function currentPackageIdentity(packageContext) {
  return deepFreeze({ packageId: packageContext.manifest.packageId, version: packageContext.manifest.version, manifestSha256: packageContext.manifestSha256, publisherSubject: packageContext.manifest.publisher.subject, publisherThumbprint: packageContext.manifest.publisher.thumbprint });
}

function samePackage(left, right) {
  return Boolean(left && right && compareExactState(left, right).matches);
}

function validateTrustedAdapter(adapter, allowTestOnly) {
  const methods = ['preflightPackage', 'preflightTarget', 'observe', 'installPackage', 'repairPackage', 'upgradePackage', 'attachFilter', 'detachFilter', 'removePackage'];
  const attestation = adapter && trustedAdapterAttestations.get(adapter);
  return Boolean(adapter && adapter.kind === TRUSTED_ADAPTER_KIND && attestation && (!attestation.testOnly || allowTestOnly === true) && methods.every((method) => typeof adapter[method] === 'function'));
}

function validateSignatureEvidence(value, policy, revocationPolicy, label, nowMs, extraKeys = []) {
  const baseKeys = ['status', 'subject', 'thumbprint', 'ekuOids', 'revocationStatus', 'revocationCheckedAt', 'timestampStatus'];
  assertExactKeys(value, [...extraKeys, ...baseKeys], label);
  if (value.status !== 'VALID' || value.subject !== policy.subject || String(value.thumbprint || '').toUpperCase() !== policy.thumbprint) throw new Error(`${label} identity did not match its immutable signer pin.`);
  if (!Array.isArray(value.ekuOids) || stableJson([...value.ekuOids].sort()) !== stableJson(policy.requiredEkuOids)) throw new Error(`${label} EKUs did not exactly match policy.`);
  if (value.revocationStatus !== 'GOOD' || value.timestampStatus !== 'VALID') throw new Error(`${label} did not pass fail-closed revocation and timestamp checks.`);
  const checkedAt = Date.parse(value.revocationCheckedAt);
  const maximumAgeMs = revocationPolicy.maximumEvidenceAgeHours * 60 * 60 * 1000;
  if (!Number.isFinite(checkedAt) || checkedAt > nowMs + 5 * 60 * 1000 || nowMs - checkedAt > maximumAgeMs) throw new Error(`${label} revocation evidence is stale or invalid.`);
}

function validatePreflight(result, packageContext, nowMs) {
  assertExactKeys(result, ['host', 'compatibility', 'application', 'helper', 'catalog', 'systemBinary', 'inf', 'files'], 'package preflight');
  assertExactKeys(result.host, ['architecture', 'windowsBuild'], 'package preflight.host');
  assertExactKeys(result.compatibility, ['memoryIntegrity', 'secureBoot'], 'package preflight.compatibility');
  const manifest = packageContext.manifest;
  if (result.host.architecture !== manifest.architecture) throw new Error('Host architecture is outside the reviewed package contract.');
  if (!Number.isSafeInteger(result.host.windowsBuild) || result.host.windowsBuild < manifest.compatibility.windows.minimumBuild || (manifest.compatibility.windows.maximumBuild !== null && result.host.windowsBuild > manifest.compatibility.windows.maximumBuild)) throw new Error('Windows build is outside the reviewed package contract.');
  if (result.compatibility.memoryIntegrity !== true || result.compatibility.secureBoot !== true) throw new Error('The package did not pass Windows security compatibility preflight.');
  const revocation = manifest.signingPolicy.revocation;
  const payloadByRole = new Map(manifest.files.map((file) => [file.role, file]));
  const catalogPolicy = { subject: manifest.publisher.subject, thumbprint: manifest.publisher.thumbprint, requiredEkuOids: manifest.signingPolicy.catalogRequiredEkuOids };
  validateSignatureEvidence(result.catalog, catalogPolicy, revocation, 'package preflight.catalog', nowMs, ['fileSha256']);
  if (result.catalog.fileSha256 !== payloadByRole.get('CAT').sha256) throw new Error('The signed catalog evidence was not linked to the reviewed CAT payload.');
  validateSignatureEvidence(result.systemBinary, manifest.signingPolicy.systemBinary, revocation, 'package preflight.systemBinary', nowMs, ['embeddedSignature', 'fileSha256']);
  if (result.systemBinary.embeddedSignature !== true || result.systemBinary.fileSha256 !== payloadByRole.get('SYS').sha256) throw new Error('The SYS embedded signature was not proven for the reviewed binary.');
  validateSignatureEvidence(result.helper, manifest.signingPolicy.helper, revocation, 'package preflight.helper', nowMs, ['packaged', 'fileSha256']);
  if (result.helper.packaged !== true || result.helper.fileSha256 !== payloadByRole.get('HELPER').sha256) throw new Error('The reviewed signed helper is not packaged or did not match its payload hash.');
  validateSignatureEvidence(result.application, manifest.signingPolicy.application, revocation, 'package preflight.application', nowMs, ['packaged']);
  if (result.application.packaged !== true) throw new Error('The running signed Dialed application is not a packaged build.');
  if (stableJson(validateInfContract(result.inf)) !== stableJson(manifest.driverPackage.inf)) throw new Error('Installed INF metadata did not exactly match the reviewed contract.');
  if (!Array.isArray(result.files) || result.files.length !== manifest.files.length) throw new Error('Catalog membership preflight was incomplete.');
  const expectedByRole = payloadByRole;
  const seen = new Set();
  for (const file of result.files) {
    assertExactKeys(file, ['role', 'path', 'bytes', 'sha256', 'catalogMembership', 'catalogMember'], 'package preflight file');
    const expected = expectedByRole.get(file.role);
    const expectedMemberResult = expected?.catalogMembership === 'REQUIRED' ? true : null;
    if (!expected || seen.has(file.role) || file.path !== expected.path || file.bytes !== expected.bytes || file.sha256 !== expected.sha256 || file.catalogMembership !== expected.catalogMembership || file.catalogMember !== expectedMemberResult) throw new Error('Role-specific catalog membership did not exactly match the immutable payload policy.');
    seen.add(file.role);
  }
  return true;
}

function publicPackage(packageContext) {
  return deepFreeze({ packageId: packageContext.manifest.packageId, version: packageContext.manifest.version, publisher: packageContext.manifest.publisher.subject, attribution: packageContext.manifest.redistributionPermission.attribution, supportedPollingHz: [...packageContext.manifest.polling.requestsHz], maximumPollingHz: packageContext.manifest.polling.maximumRequestHz });
}

function reason(code, message) { return deepFreeze({ code, message }); }

function unavailableStatus(reasons) {
  return deepFreeze({ status: 'UNAVAILABLE', installEnabled: false, capabilities: { install: false, repair: false, upgrade: false, detach: false, removePackage: false, adopt: false }, package: null, ownership: 'NONE', managedDeviceCount: 0, operationId: null, lastOutcome: null, reasons });
}

function createFileTransactionStore(options = {}) {
  const filePath = typeof options === 'string' ? options : options.filePath;
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) throw new Error('A trusted absolute transaction-store path is required.');
  const io = isPlainObject(options.fs) ? options.fs : fs;
  function readSync() {
    try {
      const stat = io.lstatSync(filePath);
      if (stat.isSymbolicLink() || !stat.isFile() || stat.size > 1024 * 1024) throw new Error('Transaction store is not a safe regular file.');
      return JSON.parse(io.readFileSync(filePath, 'utf8'));
    } catch (error) {
      if (error && error.code === 'ENOENT') return null;
      throw error;
    }
  }
  const store = Object.freeze({
    durable: true,
    contract: null,
    productionEligible: false,
    async read() { return clone(readSync()); },
    async write(next, expectedRevision) {
      const current = readSync();
      if ((current?.revision || 0) !== expectedRevision) throw new LifecycleError('TRANSACTION_CONFLICT', 'Driver state changed in another local operation. Refresh before continuing.');
      const directory = path.dirname(filePath);
      io.mkdirSync(directory, { recursive: true });
      const temporary = path.join(directory, `.${path.basename(filePath)}.${crypto.randomBytes(12).toString('hex')}.tmp`);
      let descriptor;
      try {
        descriptor = io.openSync(temporary, 'wx', 0o600);
        io.writeFileSync(descriptor, `${JSON.stringify(next)}\n`, 'utf8');
        io.fsyncSync(descriptor);
        io.closeSync(descriptor);
        descriptor = undefined;
        io.renameSync(temporary, filePath);
      } finally {
        if (descriptor !== undefined) io.closeSync(descriptor);
        try { io.unlinkSync(temporary); } catch (error) { if (!error || error.code !== 'ENOENT') throw error; }
      }
    },
  });
  fixtureFileStores.add(store);
  return store;
}

function emptyRecord() {
  return { storeSchemaVersion: STORE_SCHEMA_VERSION, revision: 0, lifecycleState: 'READY_FOR_PREFLIGHT', ownership: null, expected: null, operation: null, lastOperationId: null, lastOutcome: null, review: null, updatedAt: null };
}

function validateRecord(raw) {
  if (raw === null || raw === undefined) return emptyRecord();
  assertExactKeys(raw, ['storeSchemaVersion', 'revision', 'lifecycleState', 'ownership', 'expected', 'operation', 'lastOperationId', 'lastOutcome', 'review', 'updatedAt'], 'transaction record');
  if (raw.storeSchemaVersion !== STORE_SCHEMA_VERSION || !Number.isSafeInteger(raw.revision) || raw.revision < 1 || !LIFECYCLE_STATES.includes(raw.lifecycleState)) throw new Error('Transaction record header is invalid.');
  if (raw.lastOperationId !== null && !OPERATION_ID_PATTERN.test(raw.lastOperationId)) throw new Error('Transaction record operation id is invalid.');
  if (raw.lastOutcome !== null) {
    assertExactKeys(raw.lastOutcome, ['operationId', 'action', 'outcome', 'recordedAt'], 'transaction last outcome');
    if (!OPERATION_ID_PATTERN.test(raw.lastOutcome.operationId) || !['INSTALL', 'ATTACH', 'ADOPT', 'REPAIR', 'UPGRADE', 'DETACH', 'REMOVE_PACKAGE'].includes(raw.lastOutcome.action) || !['APPLIED', 'CANCELLED'].includes(raw.lastOutcome.outcome) || Number.isNaN(Date.parse(raw.lastOutcome.recordedAt))) throw new Error('Transaction last outcome is invalid.');
  }
  if (raw.updatedAt !== null && (typeof raw.updatedAt !== 'string' || Number.isNaN(Date.parse(raw.updatedAt)))) throw new Error('Transaction record timestamp is invalid.');
  if (raw.expected !== null) normalizeObservation(raw.expected);
  if (raw.ownership !== null) {
    assertExactKeys(raw.ownership, ['mode', 'package', 'managedTargets'], 'transaction ownership');
    if (!['DIALED_INSTALLED', 'ADOPTED_EXTERNAL'].includes(raw.ownership.mode)) throw new Error('Transaction ownership mode is invalid.');
    normalizePackageIdentity(raw.ownership.package);
    if (!Array.isArray(raw.ownership.managedTargets) || raw.ownership.managedTargets.length > 128) throw new Error('Transaction managed targets are invalid.');
    const seen = new Set();
    for (const target of raw.ownership.managedTargets) {
      assertExactKeys(target, ['deviceDigest', 'requestedHz'], 'transaction managed target');
      validateDeviceDigest(target.deviceDigest);
      if (seen.has(target.deviceDigest) || (target.requestedHz !== null && !ALLOWED_POLLING_RATES.includes(target.requestedHz))) throw new Error('Transaction managed target is invalid.');
      seen.add(target.deviceDigest);
    }
  }
  if (raw.operation !== null) {
    assertExactKeys(raw.operation, ['id', 'action', 'phase', 'startedAt', 'manifestSha256', 'targetCount'], 'transaction operation');
    if (!OPERATION_ID_PATTERN.test(raw.operation.id) || !['INSTALL', 'ATTACH', 'ADOPT', 'REPAIR', 'UPGRADE', 'DETACH', 'REMOVE_PACKAGE'].includes(raw.operation.action) || typeof raw.operation.phase !== 'string' || !/^[A-Z0-9_]{2,80}$/.test(raw.operation.phase) || Number.isNaN(Date.parse(raw.operation.startedAt)) || !/^[a-f0-9]{64}$/.test(raw.operation.manifestSha256) || !Number.isSafeInteger(raw.operation.targetCount) || raw.operation.targetCount < 0) throw new Error('Transaction operation is invalid.');
  }
  if (raw.review !== null) {
    assertExactKeys(raw.review, ['code', 'operationId', 'recordedAt'], 'transaction review');
    if (typeof raw.review.code !== 'string' || raw.review.code.length > 80 || (raw.review.operationId !== null && !OPERATION_ID_PATTERN.test(raw.review.operationId)) || Number.isNaN(Date.parse(raw.review.recordedAt))) throw new Error('Transaction review is invalid.');
  }
  return clone(raw);
}

function createInputDriverLifecycleService(options = {}) {
  const configuration = isPlainObject(options.configuration) ? options.configuration : {};
  const adapter = options.adapter;
  const transactionStore = options.transactionStore;
  const readFile = options.readFile || fs.readFileSync;
  const now = typeof options.now === 'function' ? options.now : () => Date.now();
  const randomBytes = typeof options.randomBytes === 'function' ? options.randomBytes : crypto.randomBytes;
  const previewTokens = createPreviewStore({
    now,
    ttlMs: Number.isSafeInteger(options.tokenTtlMs) ? options.tokenTtlMs : TOKEN_TTL_MS,
    createToken: () => randomBytes(32).toString('base64url'),
    clone,
    replaceExisting: false,
    makeError: (reason) => reason === 'MISSING_OR_USED'
      ? new LifecycleError('PREVIEW_TOKEN_USED_OR_UNKNOWN', 'The approval preview has already been used or is no longer available.')
      : new LifecycleError('PREVIEW_TOKEN_EXPIRED', 'The approval preview expired. Review the change again.'),
  });
  let mutationTail = Promise.resolve();
  const allowTestOnlyAttestations = options.testOnlyAllowFixtureAttestations === true;

  function staticGateReasons() {
    const reasons = [];
    if (configuration.status !== 'CONFIGURED') reasons.push(reason('LIFECYCLE_NOT_CONFIGURED', 'The production helper and accepted lifecycle route are not configured. Unchanged upstream bundling permission is recorded separately.'));
    if (!configuration.manifestPath) reasons.push(reason('SIGNED_PACKAGE_NOT_CONFIGURED', 'No immutable signed driver package is configured.'));
    if (typeof configuration.manifestSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(configuration.manifestSha256)) reasons.push(reason('MANIFEST_DIGEST_PIN_REQUIRED', 'The exact reviewed manifest digest is not configured.'));
    if (typeof configuration.transactionStoreIdentity !== 'string' || !/^[a-f0-9]{64}$/.test(configuration.transactionStoreIdentity)) reasons.push(reason('TRANSACTION_STORE_IDENTITY_PIN_REQUIRED', 'The protected-machine lifecycle journal identity is not configured.'));
    if (configuration.cleanMachineAcceptance !== 'PASSED') reasons.push(reason('CLEAN_MACHINE_LIFECYCLE_NOT_ACCEPTED', 'Install, repair, upgrade, exact detach, and removal have not passed clean-machine acceptance.'));
    if (!validateTrustedAdapter(adapter, allowTestOnlyAttestations)) reasons.push(reason('TRUSTED_WINDOWS_ADAPTER_REQUIRED', 'The reviewed signed narrow-helper adapter is not available.'));
    if (!transactionStore || transactionStore.durable !== true || typeof transactionStore.read !== 'function' || typeof transactionStore.write !== 'function') reasons.push(reason('DURABLE_TRANSACTION_STORE_REQUIRED', 'Durable recovery journaling is not available.'));
    else {
      const storeAttestation = trustedStoreAttestations.get(transactionStore);
      if (!storeAttestation || (storeAttestation.testOnly && !allowTestOnlyAttestations) || storeAttestation.protectedMachineDirectory !== true || storeAttestation.crossProcessCas !== true || storeAttestation.appendOnlyJournal !== true) reasons.push(reason('PROTECTED_TRANSACTION_STORE_REQUIRED', 'The lifecycle journal lacks signed-helper-owned machine protection, append-only recovery, and cross-process serialization attestation.'));
      else if (storeAttestation.identity !== configuration.transactionStoreIdentity) reasons.push(reason('TRANSACTION_STORE_IDENTITY_MISMATCH', 'The lifecycle journal identity does not match the configured protected-machine pin.'));
    }
    return reasons;
  }

  async function loadPackageContext() {
    if (!isSafeRelativePath(configuration.manifestPath)) throw new Error('Configured manifest path is not a safe package-relative path.');
    const appRoot = path.resolve(options.appRoot || process.cwd());
    const manifestPath = path.resolve(appRoot, configuration.manifestPath);
    if (!manifestPath.startsWith(`${appRoot}${path.sep}`)) throw new Error('Configured manifest path escaped the application root.');
    const parsed = JSON.parse(readFile(manifestPath, 'utf8'));
    const { manifest, manifestSha256 } = validateManifest(parsed);
    if (manifestSha256 !== configuration.manifestSha256) throw new Error('Manifest digest pin mismatch.');
    if (manifest.redistributionPermission.evidence !== configuration.permissionEvidence) throw new Error('Permission evidence pin mismatch.');
    if (manifest.publisher.subject !== configuration.publisherSubject || manifest.publisher.thumbprint !== String(configuration.publisherThumbprint || '').toUpperCase()) throw new Error('Publisher pin mismatch.');
    const payload = verifyPayload(manifest, path.dirname(manifestPath), readFile);
    const packageContext = deepFreeze({ manifest, manifestSha256, payload });
    const adapterAttestation = trustedAdapterAttestations.get(adapter);
    if (!adapterAttestation?.testOnly) {
      const helperFile = manifest.files.find((file) => file.role === 'HELPER');
      if (adapterAttestation.helperThumbprint !== manifest.signingPolicy.helper.thumbprint || adapterAttestation.helperSha256 !== helperFile.sha256) throw new Error('Signed narrow-helper adapter attestation did not match the reviewed helper payload.');
    }
    validatePreflight(await adapter.preflightPackage(packageContext), packageContext, now());
    return packageContext;
  }

  async function readRecord() { return validateRecord(await transactionStore.read()); }

  async function writeRecord(next, previous) {
    const record = clone(next);
    record.storeSchemaVersion = STORE_SCHEMA_VERSION;
    record.revision = previous.revision + 1;
    record.updatedAt = new Date(now()).toISOString();
    validateRecord(record);
    await transactionStore.write(record, previous.revision);
    return record;
  }

  async function observe(packageContext, request = {}) {
    const previous = request.previous ? normalizeObservation(request.previous) : null;
    const extendJournal = request.extendJournal === true;
    const operationId = extendJournal ? request.operationId || null : null;
    const checkpointRequest = deepFreeze({ previousId: extendJournal ? previous?.nativeCheckpoint.id || null : null, operationId, purpose: request.purpose || 'READ', extendJournal });
    const observation = normalizeObservation(await adapter.observe(deepFreeze({ package: packageContext, checkpointRequest })));
    const checkpoint = observation.nativeCheckpoint;
    const storeAttestation = trustedStoreAttestations.get(transactionStore);
    if (!storeAttestation || checkpoint.journalIdentity !== storeAttestation.identity) throw new LifecycleError('NATIVE_CHECKPOINT_JOURNAL_MISMATCH', 'The signed helper checkpoint did not match the protected lifecycle journal.');
    const sealedAt = Date.parse(checkpoint.sealedAt);
    if (sealedAt > now() + 5 * 60 * 1000 || now() - sealedAt > 5 * 60 * 1000) throw new LifecycleError('NATIVE_CHECKPOINT_STALE', 'The signed helper checkpoint was not fresh.');
    if (checkpoint.operationId !== operationId) throw new LifecycleError('NATIVE_CHECKPOINT_OPERATION_MISMATCH', 'The signed helper checkpoint did not match the protected operation.');
    if (!extendJournal && (checkpoint.kind !== 'STATE_ATTESTATION' || checkpoint.previousId !== null)) throw new LifecycleError('NATIVE_STATE_ATTESTATION_INVALID', 'The signed helper returned an invalid read-only state attestation.');
    if (extendJournal && (checkpoint.kind !== 'RECOVERY_CHECKPOINT' || !previous || checkpoint.id === previous.nativeCheckpoint.id || checkpoint.previousId !== previous.nativeCheckpoint.id || checkpoint.sequence <= previous.nativeCheckpoint.sequence)) throw new LifecycleError('NATIVE_CHECKPOINT_CHAIN_INVALID', 'The signed helper checkpoint did not extend the append-only recovery journal.');
    return observation;
  }

  async function preflightSelectedTarget(packageContext, target, observation, purpose, operationId = null) {
    validateDeviceDigest(target.deviceDigest);
    validateRequestedHz(target.requestedHz, packageContext.manifest);
    const result = await adapter.preflightTarget(deepFreeze({
      package: packageContext,
      target: clone(target),
      nativeCheckpointId: observation.nativeCheckpoint.id,
      purpose,
      operationId,
    }));
    assertExactKeys(result, ['known', 'connected', 'compatible', 'rateEligible', 'deviceDigest', 'requestedHz', 'nativeCheckpointId', 'helperAttested'], 'target preflight');
    if (result.helperAttested !== true || result.deviceDigest !== target.deviceDigest || result.requestedHz !== target.requestedHz || result.nativeCheckpointId !== observation.nativeCheckpoint.id) throw new LifecycleError('TARGET_PREFLIGHT_ATTESTATION_INVALID', 'The signed helper did not attest the exact selected device and polling request.');
    if (result.known !== true) throw new LifecycleError('TARGET_UNKNOWN', 'The selected device is no longer known to the signed helper inventory.');
    if (result.connected !== true) throw new LifecycleError('TARGET_DISCONNECTED', 'The selected device is no longer connected.');
    if (result.compatible !== true) throw new LifecycleError('TARGET_INCOMPATIBLE', 'The selected device is not compatible with this reviewed filter package.');
    if (result.rateEligible !== true) throw new LifecycleError('TARGET_RATE_INELIGIBLE', 'The selected device is not eligible for the requested polling rate.');
    return true;
  }

  async function preflightPlanTargets(packageContext, targets, observation, purpose, operationId = null) {
    for (const target of targets || []) await preflightSelectedTarget(packageContext, target, observation, purpose, operationId);
  }

  function makeStatus(statusName, packageContext, record, reasons = [], selectedDeviceDigest, observation) {
    const ownership = record.ownership;
    const isDialed = ownership?.mode === 'DIALED_INSTALLED';
    const isAdopted = ownership?.mode === 'ADOPTED_EXTERNAL';
    const attachedSelected = Boolean(selectedDeviceDigest && observation?.attachments.some((entry) => entry.deviceDigest === selectedDeviceDigest));
    const hasAttachments = Boolean(observation?.attachments.length);
    const actionable = ['READY_FOR_PREFLIGHT', 'REMOVED', 'FILTER_DETACHED', 'ACTIVE', 'FILTER_ATTACHED', 'EXTERNAL_PACKAGE_PRESENT'].includes(statusName) && !record.operation && !record.review;
    const upgrade = Boolean(actionable && isDialed && !samePackage(ownership.package, currentPackageIdentity(packageContext)));
    return deepFreeze({
      status: statusName,
      installEnabled: actionable && statusName !== 'EXTERNAL_PACKAGE_PRESENT',
      capabilities: {
        install: actionable && (!observation?.package || ((isDialed || isAdopted) && samePackage(observation.package, currentPackageIdentity(packageContext)) && !attachedSelected)),
        repair: Boolean(actionable && isDialed && samePackage(observation?.package, currentPackageIdentity(packageContext))),
        upgrade,
        detach: Boolean(actionable && (isDialed || isAdopted) && hasAttachments && (!selectedDeviceDigest || attachedSelected)),
        removePackage: Boolean(actionable && isDialed && !hasAttachments),
        adopt: actionable && statusName === 'EXTERNAL_PACKAGE_PRESENT',
      },
      package: publicPackage(packageContext),
      ownership: isDialed ? 'DIALED' : isAdopted ? 'ADOPTED' : 'NONE',
      managedDeviceCount: ownership?.managedTargets.length || 0,
      operationId: record.operation?.id || record.lastOperationId || null,
      lastOutcome: record.lastOutcome ? { action: record.lastOutcome.action, outcome: record.lastOutcome.outcome, recordedAt: record.lastOutcome.recordedAt } : null,
      reasons,
    });
  }

  async function safeRuntime() {
    const gates = staticGateReasons();
    if (gates.length) return { unavailable: unavailableStatus(gates) };
    try { return { packageContext: await loadPackageContext(), record: await readRecord() }; }
    catch { return { unavailable: unavailableStatus([reason('PACKAGE_OR_STATE_VALIDATION_FAILED', 'The signed package or durable lifecycle record did not pass exact local validation.')]) }; }
  }

  async function status(selectedDeviceDigest) {
    if (selectedDeviceDigest !== undefined && selectedDeviceDigest !== null) validateDeviceDigest(selectedDeviceDigest);
    const runtime = await safeRuntime();
    if (runtime.unavailable) return runtime.unavailable;
    const { packageContext, record } = runtime;
    if (record.operation) return makeStatus('NEEDS_REVIEW', packageContext, record, [reason('INTERRUPTED_OPERATION', 'A prior driver operation did not reach a verified completion boundary. No further change is allowed until it is reviewed.')], selectedDeviceDigest);
    if (record.review) return makeStatus('NEEDS_REVIEW', packageContext, record, [reason(record.review.code, 'Saved driver state requires exact review before another change.')], selectedDeviceDigest);
    let observation;
    try { observation = await observe(packageContext, { previous: record.expected, operationId: record.expected?.nativeCheckpoint.operationId || null, purpose: 'STATUS' }); } catch { return makeStatus('NEEDS_REVIEW', packageContext, record, [reason('OBSERVATION_FAILED', 'Windows driver state could not be read safely.')], selectedDeviceDigest); }
    if (record.expected) {
      const comparison = compareSealedState(normalizeObservation(record.expected), observation);
      const restartCompleted = record.lifecycleState === 'RESTART_REQUIRED' && record.expected.restartRequired === true && observation.restartRequired === false && compareSealedState({ ...record.expected, restartRequired: false }, observation, { ignoreDigest: true, ignoreBootId: true }).matches;
      if (!comparison.matches && !restartCompleted) return makeStatus('NEEDS_REVIEW', packageContext, record, [reason('EXACT_STATE_DRIFT', 'Current Windows driver state does not exactly match Dialed’s saved transaction.')], selectedDeviceDigest, observation);
    }
    if (!record.ownership) {
      if (observation.package === null) return makeStatus(record.lifecycleState === 'REMOVED' ? 'REMOVED' : 'READY_FOR_PREFLIGHT', packageContext, record, [], selectedDeviceDigest, observation);
      if (samePackage(observation.package, currentPackageIdentity(packageContext))) return makeStatus('EXTERNAL_PACKAGE_PRESENT', packageContext, record, [reason('EXPLICIT_ADOPTION_REQUIRED', 'A matching package already exists, but Dialed did not install it. It will not be repaired, upgraded, or removed without explicit adoption.')], selectedDeviceDigest, observation);
      return makeStatus('NEEDS_REVIEW', packageContext, record, [reason('PACKAGE_CONFLICT', 'A different driver package is present and will not be changed by Dialed.')], selectedDeviceDigest, observation);
    }
    if (!samePackage(observation.package, record.ownership.package)) return makeStatus('NEEDS_REVIEW', packageContext, record, [reason('OWNED_PACKAGE_DRIFT', 'The installed package no longer matches Dialed’s exact ownership record.')], selectedDeviceDigest, observation);
    if (record.lifecycleState === 'RESTART_REQUIRED' && observation.restartRequired === false) return makeStatus('RESTART_REQUIRED', packageContext, record, [reason('RECONCILIATION_REQUIRED', 'The restart appears complete. Reconcile the saved operation before another change.')], selectedDeviceDigest, observation);
    const derived = observation.restartRequired ? 'RESTART_REQUIRED' : observation.attachments.length ? 'ACTIVE' : 'FILTER_DETACHED';
    return makeStatus(derived, packageContext, record, [], selectedDeviceDigest, observation);
  }

  function issuePreview(plan, packageContext) {
    const pending = previewTokens.issue(plan);
    return deepFreeze({ action: plan.action, token: pending.token, expiresAt: new Date(pending.expiresAt).toISOString(), operationId: null, requestedHz: plan.publicRequestedHz ?? null, requiresElevation: plan.action !== 'ADOPT', requiresRestart: plan.action !== 'ADOPT', package: publicPackage(packageContext), summary: plan.summary });
  }

  function managedTargetMap(record) { return new Map((record.ownership?.managedTargets || []).map((target) => [target.deviceDigest, clone(target)])); }

  function ensureNoUnmanagedAttachments(record, observation) {
    const managed = managedTargetMap(record);
    if (observation.attachments.some((attachment) => !managed.has(attachment.deviceDigest))) throw new LifecycleError('UNMANAGED_ATTACHMENTS_PRESENT', 'Another device uses this package outside Dialed’s saved scope. Resolve it before package maintenance.');
  }

  async function requireReadyRuntime() {
    const runtime = await safeRuntime();
    if (runtime.unavailable) throw new LifecycleError('LIFECYCLE_UNAVAILABLE', 'The signed driver lifecycle is not available.');
    const { packageContext, record } = runtime;
    if (record.operation) throw new LifecycleError('INTERRUPTED_OPERATION', 'A prior operation requires review.', record.operation.id);
    if (record.review) throw new LifecycleError('NEEDS_REVIEW', 'Saved driver state requires exact review before another change.', record.review.operationId || undefined);
    const observation = await observe(packageContext, { previous: record.expected, operationId: record.expected?.nativeCheckpoint.operationId || null, purpose: 'PREVIEW' });
    if (record.expected && !compareSealedState(normalizeObservation(record.expected), observation).matches) throw new LifecycleError('EXACT_STATE_DRIFT', 'Current Windows driver state does not exactly match Dialed’s saved transaction.');
    return { packageContext, record, observation };
  }

  function requireDialedOwned(record) {
    if (record.ownership?.mode !== 'DIALED_INSTALLED') throw new LifecycleError(record.ownership?.mode === 'ADOPTED_EXTERNAL' ? 'EXTERNAL_PACKAGE_PROTECTED' : 'PACKAGE_NOT_MANAGED', 'Dialed will not repair, upgrade, or remove a package it did not install.');
  }

  async function previewInstall(deviceDigest, requestedHz) {
    deviceDigest = validateDeviceDigest(deviceDigest);
    const { packageContext, record, observation } = await requireReadyRuntime();
    requestedHz = validateRequestedHz(requestedHz, packageContext.manifest);
    const selectedTarget = { deviceDigest, requestedHz };
    await preflightSelectedTarget(packageContext, selectedTarget, observation, 'PREVIEW_INSTALL');
    const current = currentPackageIdentity(packageContext);
    if (!record.ownership) {
      if (observation.package !== null) {
        if (samePackage(observation.package, current)) throw new LifecycleError('EXPLICIT_ADOPTION_REQUIRED', 'Adopt the existing matching package before attaching a device through Dialed.');
        throw new LifecycleError('PACKAGE_CONFLICT', 'A different driver package is present and will not be changed by Dialed.');
      }
      return issuePreview({ action: 'INSTALL', recordRevision: record.revision, target: selectedTarget, preflightTargets: [selectedTarget], publicRequestedHz: requestedHz, before: observation, steps: [{ method: 'installPackage' }, { method: 'attachFilter', target: selectedTarget }], summary: ['Install the reviewed signed package.', 'Attach only the selected device.', 'Verify exact state and request a restart if Windows requires it.'] }, packageContext);
    }
    if (!samePackage(observation.package, current)) throw new LifecycleError('UPGRADE_OR_REVIEW_REQUIRED', 'The installed package is not the reviewed current package. Upgrade or review it before attaching another device.');
    if (observation.attachments.some((attachment) => attachment.deviceDigest === deviceDigest)) throw new LifecycleError('DEVICE_ALREADY_ATTACHED', 'The selected device is already attached to this package.');
    return issuePreview({ action: 'ATTACH', recordRevision: record.revision, target: selectedTarget, preflightTargets: [selectedTarget], publicRequestedHz: requestedHz, before: observation, steps: [{ method: 'attachFilter', target: selectedTarget }], summary: ['Keep the existing reviewed package.', 'Attach only the selected device.', 'Verify exact state and request a restart if Windows requires it.'] }, packageContext);
  }

  async function previewAdoption(deviceDigest, requestedHz) {
    deviceDigest = validateDeviceDigest(deviceDigest);
    const { packageContext, record, observation } = await requireReadyRuntime();
    requestedHz = validateRequestedHz(requestedHz, packageContext.manifest);
    if (record.ownership || !samePackage(observation.package, currentPackageIdentity(packageContext))) throw new LifecycleError('ADOPTION_NOT_AVAILABLE', 'There is no exact unowned package available for adoption.');
    const attached = observation.attachments.find((entry) => entry.deviceDigest === deviceDigest);
    if (!attached) throw new LifecycleError('ADOPTION_SCOPE_NOT_ATTACHED', 'The selected device is not attached to the matching external package.');
    const selectedTarget = { deviceDigest, requestedHz: attached.requestedHz ?? requestedHz };
    await preflightSelectedTarget(packageContext, selectedTarget, observation, 'PREVIEW_ADOPTION');
    return issuePreview({ action: 'ADOPT', recordRevision: record.revision, target: selectedTarget, preflightTargets: [selectedTarget], publicRequestedHz: selectedTarget.requestedHz, before: observation, steps: [], summary: ['Record the exact existing package as externally installed.', 'Manage only the selected attached device.', 'Never repair, upgrade, or remove the external package automatically.'] }, packageContext);
  }

  async function previewRepair(deviceDigest) {
    deviceDigest = validateDeviceDigest(deviceDigest);
    const { packageContext, record, observation } = await requireReadyRuntime();
    requireDialedOwned(record);
    if (!samePackage(observation.package, currentPackageIdentity(packageContext))) throw new LifecycleError('UPGRADE_REQUIRED', 'The installed package version must be upgraded before it can be repaired.');
    ensureNoUnmanagedAttachments(record, observation);
    const managed = [...managedTargetMap(record).values()];
    if (!managed.some((target) => target.deviceDigest === deviceDigest)) throw new LifecycleError('DEVICE_NOT_MANAGED', 'The selected device is not part of Dialed’s saved package scope.');
    await preflightPlanTargets(packageContext, managed, observation, 'PREVIEW_REPAIR');
    const steps = [...managed.map((target) => ({ method: 'detachFilter', target })), { method: 'repairPackage' }, ...managed.map((target) => ({ method: 'attachFilter', target }))];
    return issuePreview({ action: 'REPAIR', recordRevision: record.revision, before: observation, preflightTargets: managed, steps, publicRequestedHz: null, summary: ['Detach only Dialed-managed devices.', 'Repair the exact reviewed package.', 'Restore the saved requests and verify exact state; Windows may require a restart.'] }, packageContext);
  }

  async function previewUpgrade() {
    const { packageContext, record, observation } = await requireReadyRuntime();
    requireDialedOwned(record);
    if (samePackage(record.ownership.package, currentPackageIdentity(packageContext))) throw new LifecycleError('UPGRADE_NOT_REQUIRED', 'The installed package already matches the reviewed current package.');
    if (!samePackage(observation.package, record.ownership.package)) throw new LifecycleError('OWNED_PACKAGE_DRIFT', 'The installed package no longer matches Dialed’s ownership record.');
    if (!packageContext.manifest.upgradePredecessors.some((predecessor) => samePackage(predecessor, record.ownership.package))) throw new LifecycleError('UPGRADE_PREDECESSOR_NOT_ALLOWED', 'The installed package is not in this release’s exact reviewed upgrade-predecessor allowlist.');
    ensureNoUnmanagedAttachments(record, observation);
    const managed = [...managedTargetMap(record).values()];
    await preflightPlanTargets(packageContext, managed, observation, 'PREVIEW_UPGRADE');
    const steps = [...managed.map((target) => ({ method: 'detachFilter', target })), { method: 'upgradePackage' }, ...managed.map((target) => ({ method: 'attachFilter', target }))];
    return issuePreview({ action: 'UPGRADE', recordRevision: record.revision, before: observation, preflightTargets: managed, steps, publicRequestedHz: null, summary: ['Detach only Dialed-managed devices.', 'Upgrade to the reviewed signed package.', 'Restore saved requests and verify exact state; Windows may require a restart.'] }, packageContext);
  }

  async function previewDetach(deviceDigest) {
    deviceDigest = validateDeviceDigest(deviceDigest);
    const { packageContext, record, observation } = await requireReadyRuntime();
    if (!record.ownership) throw new LifecycleError('PACKAGE_NOT_MANAGED', 'Dialed does not manage the installed package.');
    const target = managedTargetMap(record).get(deviceDigest);
    if (!target || !observation.attachments.some((entry) => entry.deviceDigest === deviceDigest)) throw new LifecycleError('DEVICE_NOT_MANAGED', 'The selected device is not attached within Dialed’s saved scope.');
    await preflightSelectedTarget(packageContext, target, observation, 'PREVIEW_DETACH');
    return issuePreview({ action: 'DETACH', recordRevision: record.revision, target, preflightTargets: [target], before: observation, steps: [{ method: 'detachFilter', target }], publicRequestedHz: target.requestedHz, summary: ['Detach only the selected device.', 'Keep the signed package installed.', 'Verify removal of the attachment; Windows may require a restart.'] }, packageContext);
  }

  async function previewRemovePackage() {
    const { packageContext, record, observation } = await requireReadyRuntime();
    requireDialedOwned(record);
    if (observation.attachments.length || record.ownership.managedTargets.length) throw new LifecycleError('FILTER_DETACH_REQUIRED', 'Detach every filtered device before package removal.');
    if (!samePackage(observation.package, record.ownership.package)) throw new LifecycleError('OWNED_PACKAGE_DRIFT', 'The installed package no longer matches Dialed’s ownership record.');
    return issuePreview({ action: 'REMOVE_PACKAGE', recordRevision: record.revision, before: observation, preflightTargets: [], steps: [{ method: 'removePackage' }], publicRequestedHz: null, summary: ['Confirm that no filtered devices remain.', 'Remove only the package installed by Dialed.', 'Verify removal exactly; Windows may require a restart.'] }, packageContext);
  }

  function serializeMutation(work) {
    const result = mutationTail.then(work, work);
    mutationTail = result.catch(() => undefined);
    return result;
  }

  function takeToken(token) {
    if (typeof token !== 'string' || !OPERATION_ID_PATTERN.test(token)) throw new LifecycleError('INVALID_PREVIEW_TOKEN', 'The approval preview is not valid.');
    return previewTokens.take(token);
  }

  function operationState(action, phase) {
    if (phase.startsWith('BEFORE_DETACH')) return 'DETACHING_FILTER';
    if (phase.startsWith('BEFORE_ATTACH')) return 'ATTACHING_FILTER';
    if (phase.startsWith('BEFORE_INSTALL')) return 'INSTALLING_PACKAGE';
    if (phase.startsWith('BEFORE_REPAIR')) return 'REPAIRING_PACKAGE';
    if (phase.startsWith('BEFORE_UPGRADE')) return 'UPGRADING_PACKAGE';
    if (phase.startsWith('BEFORE_REMOVE')) return 'REMOVING_PACKAGE';
    return previewState(action);
  }

  function previewState(action) {
    if (['INSTALL', 'ATTACH', 'ADOPT'].includes(action)) return 'INSTALL_PREVIEWED';
    if (action === 'REMOVE_PACKAGE') return 'PACKAGE_REMOVAL_PREVIEWED';
    return `${action}_PREVIEWED`;
  }

  function mutationContext(packageContext, step, operationId) { return deepFreeze({ package: packageContext, target: step.target ? clone(step.target) : null, operationId }); }

  function semanticMutationState(observation) {
    return {
      package: clone(observation.package),
      attachments: clone(observation.attachments),
      inventory: clone(observation.inventory),
      // A reviewed mutation may cause Windows to set or clear its restart signal;
      // it is still normalized and surfaced, but is not a collateral native delta.
      restartRequired: observation.restartRequired,
    };
  }

  function assertCheckpointContractPreserved(before, after) {
    const select = (checkpoint) => ({
      journalIdentity: checkpoint.journalIdentity,
      bootId: checkpoint.bootId,
      preimageSchema: checkpoint.preimageSchema,
      preimageBindingsSha256: checkpoint.preimageBindingsSha256,
      immutablePreimage: checkpoint.immutablePreimage,
      appendOnlyJournal: checkpoint.appendOnlyJournal,
      helperAttested: checkpoint.helperAttested,
    });
    if (!compareExactState(select(before.nativeCheckpoint), select(after.nativeCheckpoint)).matches) throw new Error('Native checkpoint contract changed during a protected mutation.');
  }

  function assertStepEffect(step, before, after, packageContext) {
    if (before.package === null && before.attachments.length) throw new Error('The pre-mutation state contained attachments without an installed package.');
    assertCheckpointContractPreserved(before, after);
    const targetDigest = step.target?.deviceDigest;
    const expected = semanticMutationState(before);
    // Restart signaling is allowed to change at any reviewed Windows mutation.
    expected.restartRequired = after.restartRequired;

    if (step.method === 'installPackage') {
      if (before.package !== null) throw new Error('Package installation started from an inconsistent pre-state.');
      expected.package = currentPackageIdentity(packageContext);
    } else if (step.method === 'repairPackage') {
      if (before.package === null) throw new Error('Package repair started without an installed package.');
    } else if (step.method === 'upgradePackage') {
      if (before.package === null) throw new Error('Package upgrade started without an installed package.');
      expected.package = currentPackageIdentity(packageContext);
    } else if (step.method === 'attachFilter') {
      if (before.package === null) throw new Error('Filter attachment started without an installed package.');
      expected.attachments = before.attachments.filter((item) => item.deviceDigest !== targetDigest);
      expected.attachments.push({ deviceDigest: targetDigest, requestedHz: step.target.requestedHz, presence: 'PRESENT' });
      expected.attachments.sort((left, right) => left.deviceDigest.localeCompare(right.deviceDigest));
    } else if (step.method === 'detachFilter') {
      if (before.package === null || !before.attachments.some((item) => item.deviceDigest === targetDigest)) throw new Error('Filter detachment started from an inconsistent pre-state.');
      expected.attachments = before.attachments.filter((item) => item.deviceDigest !== targetDigest);
    } else if (step.method === 'removePackage') {
      if (before.package === null || before.attachments.length) throw new Error('Package removal started before every filter was detached.');
      expected.package = null;
      expected.attachments = [];
    } else {
      throw new Error('Unsupported protected mutation step.');
    }

    if (!compareExactState(expected, semanticMutationState(after)).matches) throw new Error('The protected mutation produced an unreviewed collateral state change.');
  }

  function updateOwnershipAfterStep(ownership, action, step, packageContext) {
    let next = ownership ? clone(ownership) : null;
    if (step.method === 'installPackage') next = { mode: 'DIALED_INSTALLED', package: currentPackageIdentity(packageContext), managedTargets: [] };
    if (step.method === 'upgradePackage' && next) next.package = currentPackageIdentity(packageContext);
    if (step.method === 'attachFilter' && next) {
      const targets = new Map(next.managedTargets.map((item) => [item.deviceDigest, item]));
      targets.set(step.target.deviceDigest, clone(step.target));
      next.managedTargets = [...targets.values()].sort((left, right) => left.deviceDigest.localeCompare(right.deviceDigest));
    }
    if (step.method === 'detachFilter' && next && action === 'DETACH') next.managedTargets = next.managedTargets.filter((item) => item.deviceDigest !== step.target.deviceDigest);
    if (step.method === 'removePackage') next = null;
    return next;
  }

  async function markFailure(operationId, code) {
    try {
      const latest = await readRecord();
      if (latest.operation?.id !== operationId) return;
      await writeRecord({ ...latest, lifecycleState: 'NEEDS_REVIEW', review: { code, operationId, recordedAt: new Date(now()).toISOString() } }, latest);
    } catch { /* The durable BEFORE_* journal remains the recovery signal. */ }
  }

  async function apply(token) {
    const pending = takeToken(token);
    return serializeMutation(async () => {
      previewTokens.assertFresh(pending);
      const plan = clone(pending.preview);
      const operationId = randomBytes(24).toString('base64url');
      let runtime;
      try {
        runtime = await requireReadyRuntime();
        let { packageContext, record } = runtime;
        if (record.revision !== plan.recordRevision) throw new LifecycleError('PREVIEW_RECORD_DRIFT', 'Lifecycle state changed after the approval preview. Review the operation again.');
        const approvalObservation = await observe(packageContext, { previous: plan.before, operationId, purpose: 'APPLY_RECHECK', extendJournal: true });
        if (!compareSealedState(plan.before, approvalObservation).matches) throw new LifecycleError('PREVIEW_STATE_DRIFT', 'Driver state changed after the approval preview. Review the operation again.');
        await preflightPlanTargets(packageContext, plan.preflightTargets, approvalObservation, 'APPLY_RECHECK', operationId);
        const operation = { id: operationId, action: plan.action, phase: 'STARTED', startedAt: new Date(now()).toISOString(), manifestSha256: packageContext.manifestSha256, targetCount: plan.steps.filter((step) => step.target).length };
        record = await writeRecord({ ...record, lifecycleState: previewState(plan.action), operation, review: null }, record);
        if (plan.action === 'ADOPT') {
          const ownership = { mode: 'ADOPTED_EXTERNAL', package: currentPackageIdentity(packageContext), managedTargets: [plan.target] };
          const finalState = approvalObservation.restartRequired ? 'RESTART_REQUIRED' : 'ACTIVE';
          record = await writeRecord({ ...record, lifecycleState: finalState, ownership, expected: approvalObservation, operation: null, lastOperationId: operationId, lastOutcome: { operationId, action: plan.action, outcome: 'APPLIED', recordedAt: new Date(now()).toISOString() }, review: null }, record);
          return publicApplyResult(record, packageContext, operationId, approvalObservation, plan.action);
        }
        let expected = approvalObservation;
        let ownership = record.ownership;
        for (let index = 0; index < plan.steps.length; index += 1) {
          const step = plan.steps[index];
          packageContext = await loadPackageContext();
          const immediatelyBefore = await observe(packageContext, { previous: expected, operationId, purpose: `BEFORE_${step.method.toUpperCase()}`, extendJournal: true });
          if (!compareSealedState(expected, immediatelyBefore).matches) throw new LifecycleError('MUTATION_BOUNDARY_DRIFT', 'Driver state changed at a protected mutation boundary.', operationId);
          await preflightPlanTargets(packageContext, plan.preflightTargets, immediatelyBefore, 'MUTATION_BOUNDARY', operationId);
          const phase = `BEFORE_${step.method.replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase()}_${index + 1}`;
          // The fresh signed-helper recovery checkpoint is committed before the
          // mutation. If the helper exits or the following call throws after
          // changing Windows, recovery still has the exact opaque preimage seal.
          record = await writeRecord({ ...record, lifecycleState: operationState(plan.action, phase), operation: { ...operation, phase }, expected: immediatelyBefore, ownership }, record);
          try { await adapter[step.method](mutationContext(packageContext, step, operationId)); }
          catch (error) {
            if (index === 0 && error && error.code === 'ELEVATION_CANCELLED') {
              const afterCancellation = await observe(packageContext, { previous: immediatelyBefore, operationId, purpose: 'ELEVATION_CANCELLED', extendJournal: true });
              if (!compareSealedState(immediatelyBefore, afterCancellation).matches) throw new LifecycleError('CANCELLED_OPERATION_DRIFT', 'Windows state changed despite elevation cancellation. Exact review is required.', operationId);
              record = await writeRecord({ ...record, lifecycleState: 'NOT_APPLIED', expected: afterCancellation, operation: null, lastOperationId: operationId, lastOutcome: { operationId, action: plan.action, outcome: 'CANCELLED', recordedAt: new Date(now()).toISOString() }, review: null }, record);
              return publicCancelledResult(record, packageContext, operationId, afterCancellation, plan.action);
            }
            throw new LifecycleError('DRIVER_MUTATION_FAILED', 'Windows did not complete the protected driver operation. Exact review is required.', operationId);
          }
          const after = await observe(packageContext, { previous: immediatelyBefore, operationId, purpose: `AFTER_${step.method.toUpperCase()}`, extendJournal: true });
          try { assertStepEffect(step, immediatelyBefore, after, packageContext); }
          catch { throw new LifecycleError('POST_MUTATION_VERIFICATION_FAILED', 'Windows did not report the exact expected result. Exact review is required.', operationId); }
          ownership = updateOwnershipAfterStep(ownership, plan.action, step, packageContext);
          expected = after;
          record = await writeRecord({ ...record, ownership, expected, operation: { ...operation, phase: `AFTER_${step.method.replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase()}_${index + 1}` } }, record);
        }
        const finalState = expected.restartRequired ? 'RESTART_REQUIRED' : expected.attachments.length ? 'ACTIVE' : expected.package ? 'FILTER_DETACHED' : 'REMOVED';
        record = await writeRecord({ ...record, lifecycleState: finalState, ownership, expected, operation: null, lastOperationId: operationId, lastOutcome: { operationId, action: plan.action, outcome: 'APPLIED', recordedAt: new Date(now()).toISOString() }, review: null }, record);
        return publicApplyResult(record, packageContext, operationId, expected, plan.action);
      } catch (error) {
        if (runtime) await markFailure(operationId, error instanceof LifecycleError ? error.code : 'OPERATION_FAILED');
        if (error instanceof LifecycleError) throw error;
        throw new LifecycleError('OPERATION_FAILED', 'The driver operation could not complete safely. Exact review is required.', operationId);
      }
    });
  }

  function publicApplyResult(record, packageContext, operationId, observation, action) {
    return deepFreeze({ status: record.lifecycleState, action, operationId, canceled: false, restartRequired: observation.restartRequired, managedDeviceCount: record.ownership?.managedTargets.length || 0, package: publicPackage(packageContext), summary: observation.restartRequired ? 'The protected operation was read back. Restart Windows, then reconcile this operation.' : 'The protected operation was read back exactly.' });
  }

  function publicCancelledResult(record, packageContext, operationId, observation, action) {
    return deepFreeze({ status: 'NOT_APPLIED', action, operationId, canceled: true, restartRequired: false, managedDeviceCount: record.ownership?.managedTargets.length || 0, package: publicPackage(packageContext), summary: 'Administrator approval was canceled before Windows changed driver state. Nothing was applied.' });
  }

  async function reconcile(operationId) {
    if (typeof operationId !== 'string' || !OPERATION_ID_PATTERN.test(operationId)) throw new LifecycleError('INVALID_OPERATION_ID', 'The saved operation identifier is not valid.');
    const runtime = await safeRuntime();
    if (runtime.unavailable) return runtime.unavailable;
    const { packageContext } = runtime;
    let { record } = runtime;
    if (record.operation) {
      if (record.operation.id !== operationId) throw new LifecycleError('OPERATION_ID_MISMATCH', 'The saved operation does not match this review request.');
      if (!record.review) record = await writeRecord({ ...record, lifecycleState: 'NEEDS_REVIEW', review: { code: 'INTERRUPTED_OPERATION', operationId, recordedAt: new Date(now()).toISOString() } }, record);
      return makeStatus('NEEDS_REVIEW', packageContext, record, [reason('INTERRUPTED_OPERATION', 'The operation stopped inside a protected mutation boundary. No automatic continuation or rollback is allowed.')]);
    }
    if (record.lastOperationId !== operationId) throw new LifecycleError('OPERATION_ID_MISMATCH', 'The saved operation does not match this reconciliation request.');
    if (record.review) return makeStatus('NEEDS_REVIEW', packageContext, record, [reason(record.review.code, 'Saved driver state requires exact review before another change.')]);
    let observation;
    try { observation = await observe(packageContext, { previous: record.expected, operationId, purpose: 'RECONCILE', extendJournal: true }); } catch { return makeStatus('NEEDS_REVIEW', packageContext, record, [reason('OBSERVATION_FAILED', 'Windows driver state could not be read safely.')]); }
    const exact = record.expected && compareSealedState(normalizeObservation(record.expected), observation).matches;
    const restartCompleted = record.lifecycleState === 'RESTART_REQUIRED' && record.expected?.restartRequired === true && observation.restartRequired === false && compareSealedState({ ...record.expected, restartRequired: false }, observation, { ignoreDigest: true, ignoreBootId: true }).matches;
    if (!exact && !restartCompleted) {
      record = await writeRecord({ ...record, lifecycleState: 'NEEDS_REVIEW', review: { code: 'EXACT_STATE_DRIFT', operationId, recordedAt: new Date(now()).toISOString() } }, record);
      return makeStatus('NEEDS_REVIEW', packageContext, record, [reason('EXACT_STATE_DRIFT', 'Current Windows driver state does not exactly match the saved operation.')], undefined, observation);
    }
    const finalState = observation.restartRequired ? 'RESTART_REQUIRED' : observation.attachments.length ? 'ACTIVE' : observation.package ? 'FILTER_DETACHED' : 'REMOVED';
    if (restartCompleted || record.lifecycleState !== finalState) record = await writeRecord({ ...record, lifecycleState: finalState, expected: observation }, record);
    return makeStatus(finalState, packageContext, record, [], undefined, observation);
  }

  return Object.freeze({ status, previewInstall, previewAdoption, previewRepair, previewUpgrade, previewDetach, previewRemovePackage, apply, reconcile });
}

module.exports = { ALLOWED_POLLING_RATES, LIFECYCLE_STATES, LifecycleError, MANIFEST_SCHEMA_VERSION, REQUIRED_PAYLOAD_ROLES, STORE_CONTRACT_KIND, STORE_SCHEMA_VERSION, TRUSTED_ADAPTER_KIND, attestTestOnlyAdapter, attestTestOnlyStore, compareExactState, compareSealedState, createFileTransactionStore, createInputDriverLifecycleService, isSafeRelativePath, transitionLifecycle, validateManifest, verifyPayload };
