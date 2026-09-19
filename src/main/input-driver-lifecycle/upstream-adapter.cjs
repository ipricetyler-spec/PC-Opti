// Offline upstream-package adapter.
//
// This is the boundary that connects reviewed upstream-package evidence to the existing
// payload-agnostic lifecycle service in index.cjs. It decides, per capability and always
// fail-closed, whether a route is available for one exact reviewed upstream package.
//
// Three rules shape everything below.
//
// 1. Installation and adoption are different questions and never share a verdict.
//    Installation means Dialed ships and stages a driver package. Adoption means the
//    user already installed the upstream package themselves and Dialed only manages the
//    selected attachment and request for the exact binary it recognises. Adoption ships
//    no file, so redistribution, catalog and Microsoft-submission gates do not apply to
//    it; they still apply, unchanged, to installation.
// 2. Nothing is synthesised. This module never invents a catalog entry, a signer, a
//    permission or a package identity, and it never upgrades an UNRESOLVED right.
// 3. The upstream Setup tooling can never become the Dialed helper. That is enforced
//    structurally here, not by a signature check, because it would remain wrong even if
//    those tools were validly signed one day.
//
// Nothing in this module reads, executes, copies or installs any real file. It compares
// records that a signed helper produced or that a fixture supplied.

const crypto = require('node:crypto');

const {
  REQUIRED_FILE_ROLES,
  evaluateEligibility,
  evaluateAdoptionEligibility,
} = require('./upstream-package-evidence.cjs');

const ADAPTER_SCHEMA_VERSION = '1.0.0';

/** Routes this adapter can describe. They are evaluated separately and reported separately. */
const UPSTREAM_ROUTES = Object.freeze(['ADOPT_EXISTING_EXACT_PACKAGE', 'INSTALL_REDISTRIBUTED_PACKAGE']);

/** Lifecycle capabilities the adapter can report on. */
const UPSTREAM_CAPABILITIES = Object.freeze(['install', 'adopt', 'repair', 'upgrade', 'detach', 'removePackage']);

/** Upstream roles that may ever be the managed kernel binary. */
const DRIVER_VARIANT_ROLES = Object.freeze(['SYS_NOPATCH', 'SYS_PATCHING_1KHZ', 'SYS_PATCHING_4_8KHZ']);

/** Upstream roles that must never be used as, or driven as, the Dialed privileged helper. */
const FORBIDDEN_HELPER_ROLES = Object.freeze(['SETUP_EXE', 'SX64_EXE']);

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const SERVICE_NAME_PATTERN = /^[A-Za-z0-9_.-]{1,64}$/;
const WINDOWS_PATH_PATTERN = /^[A-Za-z]:\\(?:[^\\/:*?"<>|\r\n]+\\)*[^\\/:*?"<>|\r\n]+$/;
const VALIDATED_ALLOWLISTS = new WeakSet();
const VALIDATED_OBSERVATIONS = new WeakSet();
const VALIDATED_SECURITY_STATES = new WeakSet();

function assertHttpsUrl(value, label) {
  assertString(value, label, null, 300);
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} is not a valid URL.`);
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hash) throw new Error(`${label} must be a credential-free HTTPS URL without a fragment.`);
  return value;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function assertExactKeys(value, allowed, label) {
  if (!isPlainObject(value)) throw new Error(`${label} must be an object.`);
  const unexpected = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unexpected.length) throw new Error(`${label} contains unsupported fields: ${unexpected.join(', ')}.`);
  const missing = allowed.filter((key) => !Object.prototype.hasOwnProperty.call(value, key));
  if (missing.length) throw new Error(`${label} is missing required fields: ${missing.join(', ')}.`);
}

function assertString(value, label, pattern, maximum = 300) {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum || (pattern && !pattern.test(value))) throw new Error(`${label} is not valid.`);
  return value;
}

function assertBoolean(value, label) {
  if (typeof value !== 'boolean') throw new Error(`${label} must be explicit.`);
  return value;
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

function blocker(code, message) {
  return deepFreeze({ code, message });
}

function sortBlockers(blockers) {
  const seen = new Set();
  return blockers
    .filter((entry) => (seen.has(entry.code) ? false : (seen.add(entry.code), true)))
    .sort((left, right) => (left.code < right.code ? -1 : left.code > right.code ? 1 : 0));
}

/**
 * An exact allowlist of the upstream files Dialed is willing to recognise. Every entry
 * pins a role, a normalized relative path, an exact byte count and an exact SHA-256.
 * Anything outside this list is refused, and a null hash is refused outright: an
 * unpinned file can never be an allowlist member even though the evidence model
 * tolerates a null hash for artifacts that were only observed, never approved.
 */
function validateAllowlist(raw) {
  assertExactKeys(raw, ['schemaVersion', 'packageId', 'sourceUrl', 'upstreamVersion', 'archiveSha256', 'serviceName', 'signerSubject', 'files'], 'Upstream allowlist');
  if (raw.schemaVersion !== ADAPTER_SCHEMA_VERSION) throw new Error(`Upstream allowlist schemaVersion must be ${ADAPTER_SCHEMA_VERSION}.`);
  assertString(raw.packageId, 'packageId', /^[a-z0-9][a-z0-9.-]{2,79}$/, 80);
  assertHttpsUrl(raw.sourceUrl, 'sourceUrl');
  assertString(raw.upstreamVersion, 'upstreamVersion', null, 80);
  assertString(raw.archiveSha256, 'archiveSha256', SHA256_PATTERN, 64);
  assertString(raw.serviceName, 'serviceName', SERVICE_NAME_PATTERN, 64);
  assertString(raw.signerSubject, 'signerSubject', null, 300);

  if (!Array.isArray(raw.files) || raw.files.length === 0 || raw.files.length > REQUIRED_FILE_ROLES.length) throw new Error('Upstream allowlist files is not valid.');

  const roles = new Set();
  const files = raw.files.map((file, index) => {
    assertExactKeys(file, ['role', 'path', 'bytes', 'sha256'], `files[${index}]`);
    if (!REQUIRED_FILE_ROLES.includes(file.role)) throw new Error(`files[${index}].role is not a recognized upstream artifact role.`);
    if (FORBIDDEN_HELPER_ROLES.includes(file.role)) throw new Error(`files[${index}].role ${file.role} is upstream Setup tooling and must never be allowlisted for Dialed use.`);
    assertString(file.path, `files[${index}].path`, null, 200);
    const normalizedPath = file.path.replace(/\\/g, '/');
    if (normalizedPath.startsWith('/') || normalizedPath.includes('../') || /^[A-Za-z]:/.test(normalizedPath)) throw new Error(`files[${index}].path must be a contained relative path.`);
    if (!Number.isSafeInteger(file.bytes) || file.bytes <= 0 || file.bytes > 64 * 1024 * 1024) throw new Error(`files[${index}].bytes is not valid.`);
    assertString(file.sha256, `files[${index}].sha256`, SHA256_PATTERN, 64);
    if (roles.has(file.role)) throw new Error('Upstream allowlist roles must be unique.');
    roles.add(file.role);
    return { role: file.role, path: normalizedPath, bytes: file.bytes, sha256: file.sha256 };
  });

  if (!files.some((file) => DRIVER_VARIANT_ROLES.includes(file.role))) throw new Error('Upstream allowlist must contain at least one reviewed driver variant.');

  const allowlist = {
    schemaVersion: ADAPTER_SCHEMA_VERSION,
    packageId: raw.packageId,
    sourceUrl: raw.sourceUrl,
    upstreamVersion: raw.upstreamVersion,
    archiveSha256: raw.archiveSha256,
    serviceName: raw.serviceName,
    signerSubject: raw.signerSubject,
    files: [...files].sort((left, right) => left.role.localeCompare(right.role)),
  };
  const frozenAllowlist = deepFreeze(allowlist);
  VALIDATED_ALLOWLISTS.add(frozenAllowlist);
  return deepFreeze({ allowlist: frozenAllowlist, allowlistSha256: sha256Hex(stableJson(frozenAllowlist)) });
}

/**
 * One helper-observed report about what is actually installed on the machine. Every
 * field is a fact the helper attested; this module never gathers any of it itself.
 */
function validateObservedPackage(raw) {
  assertExactKeys(raw, ['present', 'serviceName', 'imagePath', 'binarySha256', 'binaryBytes', 'embeddedSignatureValid', 'signerSubject', 'installedByDialed', 'oemInfName', 'extraFiles', 'missingFiles'], 'Observed package');
  assertBoolean(raw.present, 'present');
  assertBoolean(raw.embeddedSignatureValid, 'embeddedSignatureValid');
  assertBoolean(raw.installedByDialed, 'installedByDialed');

  if (!raw.present) {
    // An absent package still has to be structurally complete so a caller cannot pass a
    // half-filled record and have it read as "nothing is wrong".
    for (const key of ['serviceName', 'imagePath', 'binarySha256', 'signerSubject', 'oemInfName']) {
      if (raw[key] !== null) throw new Error(`Observed package ${key} must be null when the package is absent.`);
    }
    if (raw.binaryBytes !== null) throw new Error('Observed package binaryBytes must be null when the package is absent.');
  } else {
    assertString(raw.serviceName, 'serviceName', SERVICE_NAME_PATTERN, 64);
    assertString(raw.imagePath, 'imagePath', WINDOWS_PATH_PATTERN, 260);
    assertString(raw.binarySha256, 'binarySha256', SHA256_PATTERN, 64);
    if (!Number.isSafeInteger(raw.binaryBytes) || raw.binaryBytes <= 0) throw new Error('Observed package binaryBytes is not valid.');
    assertString(raw.signerSubject, 'signerSubject', null, 300);
    if (raw.oemInfName !== null) assertString(raw.oemInfName, 'oemInfName', /^[A-Za-z0-9_.-]{1,64}$/, 64);
  }

  for (const key of ['extraFiles', 'missingFiles']) {
    if (!Array.isArray(raw[key]) || raw[key].length > 64) throw new Error(`Observed package ${key} is not valid.`);
    for (const [index, entry] of raw[key].entries()) assertString(entry, `${key}[${index}]`, null, 200);
  }

  const observed = deepFreeze({
    present: raw.present,
    serviceName: raw.serviceName,
    imagePath: raw.imagePath,
    binarySha256: raw.binarySha256,
    binaryBytes: raw.binaryBytes,
    embeddedSignatureValid: raw.embeddedSignatureValid,
    signerSubject: raw.signerSubject,
    installedByDialed: raw.installedByDialed,
    oemInfName: raw.oemInfName,
    extraFiles: [...raw.extraFiles].sort(),
    missingFiles: [...raw.missingFiles].sort(),
  });
  VALIDATED_OBSERVATIONS.add(observed);
  return observed;
}

/** The Windows security state the helper attested. Adoption requires it to be intact. */
function validateSecurityState(raw) {
  assertExactKeys(raw, ['secureBoot', 'memoryIntegrity', 'driverSignatureEnforcement'], 'Security state');
  const states = ['ENABLED', 'DISABLED', 'UNKNOWN'];
  for (const key of ['secureBoot', 'memoryIntegrity', 'driverSignatureEnforcement']) {
    if (!states.includes(raw[key])) throw new Error(`Security state ${key} must be one of ${states.join(', ')}.`);
  }
  const security = deepFreeze({ secureBoot: raw.secureBoot, memoryIntegrity: raw.memoryIntegrity, driverSignatureEnforcement: raw.driverSignatureEnforcement });
  VALIDATED_SECURITY_STATES.add(security);
  return security;
}

/**
 * Match one observed installed binary against the exact allowlist. This is where a
 * substituted, truncated, renamed or modified driver is caught: only an exact
 * hash-and-size match to an allowlisted driver variant resolves.
 */
function matchObservedPackage(allowlist, observed) {
  const blockers = [];
  if (!observed.present) {
    return deepFreeze({ matched: false, variantRole: null, blockers: sortBlockers([blocker('UPSTREAM_PACKAGE_NOT_PRESENT', 'No reviewed upstream driver package is installed on this machine.')]) });
  }

  const variants = allowlist.files.filter((file) => DRIVER_VARIANT_ROLES.includes(file.role));
  const byHash = variants.find((file) => file.sha256 === observed.binarySha256);

  if (!byHash) {
    blockers.push(blocker('UPSTREAM_BINARY_NOT_ALLOWLISTED', 'The installed driver binary does not match any exact reviewed upstream build.'));
  } else if (byHash.bytes !== observed.binaryBytes) {
    // A hash match with a different length cannot happen for an intact file, so this is
    // treated as a corrupt or spoofed observation rather than a match.
    blockers.push(blocker('UPSTREAM_BINARY_SIZE_MISMATCH', 'The installed driver binary size does not match the reviewed build with that hash.'));
  }

  if (observed.embeddedSignatureValid !== true) {
    blockers.push(blocker('UPSTREAM_BINARY_SIGNATURE_INVALID', 'The installed driver binary does not present a valid embedded signature.'));
  }
  if (observed.signerSubject !== allowlist.signerSubject) {
    blockers.push(blocker('UPSTREAM_BINARY_SIGNER_MISMATCH', 'The installed driver signer does not match the exact reviewed signer identity.'));
  }
  if (observed.serviceName.toLowerCase() !== allowlist.serviceName.toLowerCase()) {
    blockers.push(blocker('UPSTREAM_SERVICE_NAME_MISMATCH', 'The installed service name does not match the exact reviewed service identity.'));
  }
  if (byHash && observed.imagePath.split('\\').at(-1).toLowerCase() !== byHash.path.split('/').at(-1).toLowerCase()) {
    blockers.push(blocker('UPSTREAM_IMAGE_NAME_MISMATCH', 'The installed driver image name does not match the reviewed variant path.'));
  }
  if (observed.extraFiles.length > 0) {
    blockers.push(blocker('UPSTREAM_PACKAGE_HAS_EXTRA_FILES', 'The installed package contains files outside the exact reviewed set.'));
  }
  if (observed.missingFiles.length > 0) {
    blockers.push(blocker('UPSTREAM_PACKAGE_INCOMPLETE', 'The installed package is missing files from the exact reviewed set.'));
  }

  const matched = blockers.length === 0;
  return deepFreeze({ matched, variantRole: matched ? byHash.role : null, blockers: sortBlockers(blockers) });
}

/** Bind the policy allowlist to the exact evidence record it claims to represent. */
function evidenceAllowlistBlockers(evidence, allowlist) {
  const blockers = [];
  if (evidence.archive.sourceUrl !== allowlist.sourceUrl) blockers.push(blocker('UPSTREAM_SOURCE_MISMATCH', 'The allowlist source does not match the reviewed evidence source.'));
  if (evidence.archive.commitReference !== allowlist.upstreamVersion) blockers.push(blocker('UPSTREAM_VERSION_MISMATCH', 'The allowlist version does not match the reviewed evidence commit.'));
  if (evidence.archive.sha256 !== allowlist.archiveSha256) blockers.push(blocker('UPSTREAM_ARCHIVE_MISMATCH', 'The allowlist archive hash does not match the reviewed evidence archive.'));

  for (const allowed of allowlist.files) {
    const reviewed = evidence.files.find((file) => file.role === allowed.role);
    if (!reviewed || reviewed.path.replace(/\\/g, '/') !== allowed.path || reviewed.sha256 !== allowed.sha256) {
      blockers.push(blocker('UPSTREAM_ALLOWLIST_FILE_MISMATCH', 'An allowlisted file does not match the reviewed evidence role, path and hash.'));
      break;
    }
  }

  const reviewedSigner = evidence.signers.systemBinary.subject;
  if (reviewedSigner !== allowlist.signerSubject) blockers.push(blocker('UPSTREAM_ALLOWLIST_SIGNER_MISMATCH', 'The allowlisted signer does not match the reviewed evidence signer.'));
  return sortBlockers(blockers);
}

/**
 * The single entry point. Produces one route report per capability, plus the exact
 * inputs that produced it, so a caller can display an honest status without re-deriving
 * anything. Every capability defaults to unavailable and is enabled only by evidence.
 */
function evaluateUpstreamRoutes(input) {
  assertExactKeys(input, ['evidence', 'allowlist', 'observed', 'security'], 'Upstream route input');
  const allowlist = input.allowlist;
  if (!isPlainObject(allowlist) || !VALIDATED_ALLOWLISTS.has(allowlist)) throw new Error('A validated upstream allowlist is required.');
  const observed = input.observed;
  if (!isPlainObject(observed) || !VALIDATED_OBSERVATIONS.has(observed)) throw new Error('A validated observed package record is required.');
  const security = input.security;
  if (!isPlainObject(security) || !VALIDATED_SECURITY_STATES.has(security)) throw new Error('A validated security state is required.');

  const match = matchObservedPackage(allowlist, observed);
  const bindingBlockers = evidenceAllowlistBlockers(input.evidence, allowlist);

  // Installation route: the full redistribution and packaging question, unchanged.
  const installVerdict = evaluateEligibility(input.evidence);
  const installBlockers = [...installVerdict.blockers, ...bindingBlockers];

  // Adoption route: only what managing an existing exact installation requires.
  const adoptionVerdict = evaluateAdoptionEligibility(input.evidence, { observedVariantRole: match.variantRole });
  const adoptBlockers = [...adoptionVerdict.blockers, ...bindingBlockers, ...match.blockers];

  // Windows protections must be intact for either route. Dialed never asks for them off.
  for (const [key, code, message] of [
    ['secureBoot', 'SECURE_BOOT_NOT_ENABLED', 'Secure Boot is not confirmed enabled. Dialed will not manage a kernel filter without it, and will never ask for it to be turned off.'],
    ['memoryIntegrity', 'MEMORY_INTEGRITY_NOT_ENABLED', 'Memory Integrity is not confirmed enabled. Dialed will never disable it or advise disabling it.'],
    ['driverSignatureEnforcement', 'DRIVER_SIGNATURE_ENFORCEMENT_NOT_ENABLED', 'Driver signature enforcement is not confirmed enabled.'],
  ]) {
    if (security[key] !== 'ENABLED') {
      const entry = blocker(code, message);
      installBlockers.push(entry);
      adoptBlockers.push(entry);
    }
  }

  const adoptAvailable = sortBlockers(adoptBlockers).length === 0;
  const installAvailable = sortBlockers(installBlockers).length === 0;

  // Maintenance of an externally installed package is deliberately not offered. Dialed
  // owns only the attachment it made, never the package another installer put there.
  const externalOwnership = observed.present && observed.installedByDialed !== true;
  const dialedOwnedPackage = observed.present && observed.installedByDialed === true;
  const externalOwnershipBlocker = blocker('EXTERNAL_PACKAGE_NOT_DIALED_OWNED', 'This driver package was installed outside Dialed. Dialed can manage only the selected attachment it made, and will not repair, upgrade, or remove someone else\'s package.');

  const maintenanceBlockers = (extra = []) => sortBlockers([
    ...installBlockers,
    ...(externalOwnership ? [externalOwnershipBlocker] : []),
    ...(observed.present ? [] : [blocker('UPSTREAM_PACKAGE_NOT_PRESENT', 'No reviewed upstream driver package is installed on this machine.')]),
    ...extra,
  ]);

  const capabilities = {
    install: deepFreeze({ route: 'INSTALL_REDISTRIBUTED_PACKAGE', available: installAvailable && !observed.present, blockers: sortBlockers(observed.present ? [...installBlockers, blocker('UPSTREAM_PACKAGE_ALREADY_PRESENT', 'A driver package is already installed; review adoption instead of installation.')] : installBlockers) }),
    adopt: deepFreeze({ route: 'ADOPT_EXISTING_EXACT_PACKAGE', available: adoptAvailable, blockers: sortBlockers(adoptBlockers) }),
    repair: deepFreeze({ route: 'INSTALL_REDISTRIBUTED_PACKAGE', available: installAvailable && dialedOwnedPackage, blockers: maintenanceBlockers() }),
    upgrade: deepFreeze({ route: 'INSTALL_REDISTRIBUTED_PACKAGE', available: installAvailable && dialedOwnedPackage, blockers: maintenanceBlockers() }),
    // Detach removes only a Dialed-made attachment and needs no redistribution right,
    // so it follows the adoption gate rather than the installation gate.
    detach: deepFreeze({ route: 'ADOPT_EXISTING_EXACT_PACKAGE', available: adoptAvailable, blockers: sortBlockers(adoptBlockers) }),
    removePackage: deepFreeze({ route: 'INSTALL_REDISTRIBUTED_PACKAGE', available: installAvailable && dialedOwnedPackage, blockers: maintenanceBlockers() }),
  };

  return deepFreeze({
    schemaVersion: ADAPTER_SCHEMA_VERSION,
    packageId: allowlist.packageId,
    upstreamVersion: allowlist.upstreamVersion,
    match,
    capabilities,
    // A convenience summary for status surfaces. It never widens any capability.
    recommendedRoute: capabilities.adopt.available ? 'ADOPT_EXISTING_EXACT_PACKAGE' : capabilities.install.available ? 'INSTALL_REDISTRIBUTED_PACKAGE' : null,
    productionManifestReady: false,
  });
}

/**
 * Guard used wherever a helper identity is chosen. The upstream Setup executables are
 * refused as the Dialed helper by role, not by signature, because using another
 * project's installer as a privileged component would remain wrong even if it were
 * validly signed.
 */
function assertNotUpstreamSetupTooling(role) {
  if (FORBIDDEN_HELPER_ROLES.includes(role)) {
    throw new Error(`${role} is upstream Setup tooling and can never act as the Dialed privileged helper.`);
  }
  return role;
}

module.exports = {
  ADAPTER_SCHEMA_VERSION,
  DRIVER_VARIANT_ROLES,
  FORBIDDEN_HELPER_ROLES,
  UPSTREAM_CAPABILITIES,
  UPSTREAM_ROUTES,
  assertNotUpstreamSetupTooling,
  evidenceAllowlistBlockers,
  evaluateUpstreamRoutes,
  matchObservedPackage,
  validateAllowlist,
  validateObservedPackage,
  validateSecurityState,
};
