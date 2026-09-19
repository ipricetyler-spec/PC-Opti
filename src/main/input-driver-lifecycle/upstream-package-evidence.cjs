// Read-only evidence model for one exact publicly published upstream driver archive
// (currently the official HIDUSBF distribution). This is deliberately separate from
// driver-package-manifest.schema.json / validateManifest in index.cjs: that schema is
// the production install contract and requires resolved commercial/automation rights
// and a catalog-signed package. Today's exact upstream archive has neither, so a
// manifest built from it could only satisfy the production schema by fabricating
// grants or inventing a CAT file that does not exist. This module instead records what
// was actually observed and computes an honest, always-fail-closed eligibility verdict.
//
// Two verdicts are produced, and they must never be collapsed into one:
//   * evaluateEligibility         - may Dialed REDISTRIBUTE AND INSTALL this package?
//   * evaluateAdoptionEligibility - may Dialed MANAGE an installation the user already
//                                   has, shipping no payload and installing nothing?
// The second is a strictly narrower question. It does not depend on redistribution
// rights or on a catalog, because Dialed neither ships nor stages any file in that mode.
//
// Nothing here reads, verifies, or bundles the actual upstream payload; it only
// validates a small evidence record against exact pinned values reviewed by the owner.

const crypto = require('node:crypto');

const EVIDENCE_SCHEMA_VERSION = '1.1.0';
const RIGHTS_STATUSES = Object.freeze(['GRANTED', 'DENIED', 'UNRESOLVED']);
const REQUIRED_FILE_ROLES = Object.freeze(['INF', 'SYS_NOPATCH', 'SYS_PATCHING_1KHZ', 'SYS_PATCHING_4_8KHZ', 'SETUP_EXE', 'SX64_EXE']);
const PATCHING_ROLES = Object.freeze(['SYS_PATCHING_1KHZ', 'SYS_PATCHING_4_8KHZ']);
const ADOPTABLE_VARIANT_ROLES = Object.freeze(['SYS_NOPATCH', ...PATCHING_ROLES]);
const AUTHENTICODE_STATUSES = Object.freeze(['VALID_EMBEDDED_SIGNATURE_NOT_CATALOG_MEMBER', 'SELF_SIGNED_UNTRUSTED_CHAIN', 'NOT_APPLICABLE']);
const PERMISSION_SCOPES = Object.freeze([
  // The 2026-07-22 maintainer reply. It is a general statement about the binaries, but
  // it was written to a different requester about a different, free product, so the
  // model records both the statement and who actually asked.
  'PUBLIC_DOMAIN_BINARIES_UNMODIFIED_NAME_PRESERVED',
  'FREE_UNMODIFIED_BUNDLING_ONLY',
]);
const RIGHTS_KEYS = Object.freeze([
  'freeUnmodifiedBundling',
  'commercialRedistribution',
  'automation',
  'modification',
  'brandingWording',
  'derivativePackagingAroundExactBinary',
  'microsoftSignatureSubmission',
]);
const VALIDATED_EVIDENCE = new WeakSet();

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
  const missing = allowed.filter((key) => !Object.prototype.hasOwnProperty.call(value, key));
  if (missing.length) throw new Error(`${label} is missing required fields: ${missing.join(', ')}.`);
}

function assertRightsStatus(value, label) {
  if (!RIGHTS_STATUSES.includes(value)) throw new Error(`${label} must be one of ${RIGHTS_STATUSES.join(', ')}.`);
  return value;
}

function assertBoolean(value, label) {
  if (typeof value !== 'boolean') throw new Error(`${label} must be explicit.`);
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

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function validateFileEntry(raw, index) {
  assertExactKeys(raw, ['role', 'path', 'sha256', 'catalogFileDirective', 'authenticode'], `files[${index}]`);
  if (!REQUIRED_FILE_ROLES.includes(raw.role)) throw new Error(`files[${index}].role is not a recognized upstream artifact role.`);
  assertString(raw.path, `files[${index}].path`, null, 200);
  if (raw.sha256 !== null) assertString(raw.sha256, `files[${index}].sha256`, /^[a-f0-9]{64}$/);
  if (typeof raw.catalogFileDirective !== 'boolean') throw new Error(`files[${index}].catalogFileDirective must be explicit.`);
  assertExactKeys(raw.authenticode, ['status', 'subject'], `files[${index}].authenticode`);
  if (!AUTHENTICODE_STATUSES.includes(raw.authenticode.status)) throw new Error(`files[${index}].authenticode.status is not recognized.`);
  if (typeof raw.authenticode.subject !== 'string' || raw.authenticode.subject.length > 300) throw new Error(`files[${index}].authenticode.subject is not valid.`);
  return {
    role: raw.role,
    path: raw.path,
    sha256: raw.sha256,
    catalogFileDirective: raw.catalogFileDirective,
    authenticode: { status: raw.authenticode.status, subject: raw.authenticode.subject },
  };
}

// Validates one upstream-package evidence record against exact structural rules and
// returns a normalized, deep-frozen copy plus its content digest. This never asserts
// that the evidence is eligible for production use; call evaluateEligibility for that.
function validateUpstreamEvidence(raw) {
  if (!isPlainObject(raw)) throw new Error('Upstream package evidence must be an object.');
  assertExactKeys(raw, ['schemaVersion', 'archive', 'maintainerPermission', 'rights', 'files', 'signers', 'compatibility', 'packageRoute'], 'Upstream package evidence');
  if (raw.schemaVersion !== EVIDENCE_SCHEMA_VERSION) throw new Error(`Upstream package evidence schemaVersion must be ${EVIDENCE_SCHEMA_VERSION}.`);

  assertExactKeys(raw.archive, ['sourceUrl', 'fileName', 'sha256', 'commitReference', 'retrievedAt'], 'archive');
  assertString(raw.archive.sourceUrl, 'archive.sourceUrl', /^https:\/\//i);
  assertString(raw.archive.fileName, 'archive.fileName', /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/);
  assertString(raw.archive.sha256, 'archive.sha256', /^[a-f0-9]{64}$/);
  if (raw.archive.commitReference !== null) assertString(raw.archive.commitReference, 'archive.commitReference', /^[a-f0-9]{7,40}$/);
  assertString(raw.archive.retrievedAt, 'archive.retrievedAt', /^\d{4}-\d{2}-\d{2}$/);
  if (Number.isNaN(Date.parse(raw.archive.retrievedAt))) throw new Error('archive.retrievedAt is not a valid date.');

  assertExactKeys(raw.maintainerPermission, ['issueUrl', 'statement', 'scope', 'grantedTo', 'grantedToProject'], 'maintainerPermission');
  assertString(raw.maintainerPermission.issueUrl, 'maintainerPermission.issueUrl', /^https:\/\//i);
  assertString(raw.maintainerPermission.statement, 'maintainerPermission.statement', null, 800);
  if (!PERMISSION_SCOPES.includes(raw.maintainerPermission.scope)) throw new Error('maintainerPermission.scope is not recognized.');
  // The explicit reply ran to a named third party about a named third-party product.
  // Recording that keeps Dialed from silently treating someone else's answer as its own.
  assertString(raw.maintainerPermission.grantedTo, 'maintainerPermission.grantedTo', null, 120);
  assertString(raw.maintainerPermission.grantedToProject, 'maintainerPermission.grantedToProject', null, 200);

  assertExactKeys(raw.rights, [...RIGHTS_KEYS], 'rights');
  const rights = {};
  for (const key of RIGHTS_KEYS) rights[key] = assertRightsStatus(raw.rights[key], `rights.${key}`);

  if (!Array.isArray(raw.files) || raw.files.length !== REQUIRED_FILE_ROLES.length) throw new Error(`files must list exactly the ${REQUIRED_FILE_ROLES.length} reviewed upstream artifacts.`);
  const files = raw.files.map(validateFileEntry);
  const roles = new Set(files.map((file) => file.role));
  if (roles.size !== files.length) throw new Error('files must not contain duplicate roles.');
  for (const role of REQUIRED_FILE_ROLES) if (!roles.has(role)) throw new Error(`files is missing the reviewed ${role} artifact.`);
  const fileByRole = new Map(files.map((file) => [file.role, file]));
  for (const role of ['SYS_NOPATCH', 'SYS_PATCHING_1KHZ', 'SYS_PATCHING_4_8KHZ']) {
    if (fileByRole.get(role).sha256 === null) throw new Error(`files[${role}].sha256 must be pinned for a reviewed SYS variant.`);
  }

  assertExactKeys(raw.signers, ['systemBinary', 'setupTools'], 'signers');
  assertExactKeys(raw.signers.systemBinary, ['subject', 'status'], 'signers.systemBinary');
  assertString(raw.signers.systemBinary.subject, 'signers.systemBinary.subject', null, 300);
  if (raw.signers.systemBinary.status !== 'VALID_EMBEDDED_SIGNATURE_NOT_CATALOG_MEMBER') throw new Error('signers.systemBinary.status is not recognized.');
  assertExactKeys(raw.signers.setupTools, ['status'], 'signers.setupTools');
  if (!['SELF_SIGNED_UNTRUSTED_CHAIN', 'VALID_EMBEDDED_SIGNATURE_NOT_CATALOG_MEMBER'].includes(raw.signers.setupTools.status)) throw new Error('signers.setupTools.status is not recognized.');
  for (const role of ADOPTABLE_VARIANT_ROLES) {
    const file = fileByRole.get(role);
    if (file.authenticode.status !== raw.signers.systemBinary.status || file.authenticode.subject !== raw.signers.systemBinary.subject) {
      throw new Error(`files[${role}].authenticode must match the reviewed systemBinary signer.`);
    }
  }
  for (const role of ['SETUP_EXE', 'SX64_EXE']) {
    if (fileByRole.get(role).authenticode.status !== raw.signers.setupTools.status) throw new Error(`files[${role}].authenticode must match the reviewed setupTools status.`);
  }

  assertExactKeys(raw.compatibility, ['memoryIntegrityRequiredDisabledForPatchingVariant'], 'compatibility');
  assertBoolean(raw.compatibility.memoryIntegrityRequiredDisabledForPatchingVariant, 'compatibility.memoryIntegrityRequiredDisabledForPatchingVariant');

  // Current Microsoft package/signing facts that decide whether Dialed could ever ship
  // an installable package around this exact binary. These are platform facts, not
  // permissions, and they are recorded apart so neither can be mistaken for the other.
  assertExactKeys(raw.packageRoute, ['thirdPartyCatalogSigningAvailable', 'microsoftSoleProviderOfProductionKernelSignatures', 'resubmissionAltersReviewedBinary', 'symbolFileAvailableForSubmission'], 'packageRoute');
  const packageRoute = {
    thirdPartyCatalogSigningAvailable: assertBoolean(raw.packageRoute.thirdPartyCatalogSigningAvailable, 'packageRoute.thirdPartyCatalogSigningAvailable'),
    microsoftSoleProviderOfProductionKernelSignatures: assertBoolean(raw.packageRoute.microsoftSoleProviderOfProductionKernelSignatures, 'packageRoute.microsoftSoleProviderOfProductionKernelSignatures'),
    resubmissionAltersReviewedBinary: assertBoolean(raw.packageRoute.resubmissionAltersReviewedBinary, 'packageRoute.resubmissionAltersReviewedBinary'),
    symbolFileAvailableForSubmission: assertBoolean(raw.packageRoute.symbolFileAvailableForSubmission, 'packageRoute.symbolFileAvailableForSubmission'),
  };

  const evidence = {
    schemaVersion: EVIDENCE_SCHEMA_VERSION,
    archive: clone(raw.archive),
    maintainerPermission: clone(raw.maintainerPermission),
    rights,
    files: [...files].sort((left, right) => left.role.localeCompare(right.role)),
    signers: { systemBinary: clone(raw.signers.systemBinary), setupTools: clone(raw.signers.setupTools) },
    compatibility: { memoryIntegrityRequiredDisabledForPatchingVariant: raw.compatibility.memoryIntegrityRequiredDisabledForPatchingVariant },
    packageRoute,
  };
  const frozenEvidence = deepFreeze(evidence);
  VALIDATED_EVIDENCE.add(frozenEvidence);
  return deepFreeze({ evidence: frozenEvidence, evidenceSha256: sha256Hex(stableJson(frozenEvidence)) });
}

function blocker(code, message) { return deepFreeze({ code, message }); }

function assertValidatedEvidence(evidence) {
  if (!isPlainObject(evidence) || !VALIDATED_EVIDENCE.has(evidence)) throw new Error('Validated upstream package evidence is required.');
  return new Map(evidence.files.map((file) => [file.role, file]));
}

function dedupeBlockers(blockers) {
  const seen = new Set();
  return blockers.filter((entry) => (seen.has(entry.code) ? false : (seen.add(entry.code), true)));
}

// Computes an honest, fail-closed verdict for the REDISTRIBUTE-AND-INSTALL route from
// validated evidence. This never configures or unblocks anything by itself; it only
// names, from the evidence actually recorded, which explicit gates in
// docs/HIDUSBF_INTEGRATION.md remain open.
function evaluateEligibility(evidence) {
  const fileByRole = assertValidatedEvidence(evidence);
  const blockers = [];

  if (evidence.rights.freeUnmodifiedBundling !== 'GRANTED') blockers.push(blocker('FREE_UNMODIFIED_BUNDLING_NOT_ESTABLISHED', 'The maintainer has not established permission to bundle the unmodified binaries and INF for this exact use.'));
  if (fileByRole.get('INF').catalogFileDirective !== true) blockers.push(blocker('NO_CATALOG_FILE', 'The reviewed INF has no CatalogFile directive, so it is not a signed PnP package even though the SYS carries an embedded signature.'));
  for (const role of ['SETUP_EXE', 'SX64_EXE']) {
    if (fileByRole.get(role).authenticode.status !== 'VALID_EMBEDDED_SIGNATURE_NOT_CATALOG_MEMBER') blockers.push(blocker('UNTRUSTED_SETUP_TOOLING', 'The upstream Setup tooling is self-signed and not trusted by the current Windows trust chain; it must never be treated as a privileged Dialed helper.'));
  }
  if (evidence.compatibility.memoryIntegrityRequiredDisabledForPatchingVariant === true && PATCHING_ROLES.some((role) => fileByRole.has(role))) {
    blockers.push(blocker('MEMORY_INTEGRITY_INCOMPATIBLE_PATCHING_VARIANT', 'The patching SYS variants require Memory Integrity to be disabled per upstream documentation. Dialed will never disable or tell a customer to disable that protection.'));
  }
  if (evidence.rights.commercialRedistribution !== 'GRANTED') blockers.push(blocker('COMMERCIAL_REDISTRIBUTION_RIGHTS_UNRESOLVED', 'Paid commercial redistribution rights for this package are not yet resolved.'));
  if (evidence.rights.automation !== 'GRANTED') blockers.push(blocker('AUTOMATION_RIGHTS_UNRESOLVED', 'Automated-installation rights for this package are not yet resolved.'));
  if (evidence.rights.brandingWording !== 'GRANTED') blockers.push(blocker('BRANDING_WORDING_RIGHTS_UNRESOLVED', 'Dialed attribution/branding wording for this package is not yet resolved.'));

  // Platform gates. A driver package that Dialed stages must carry a signature Windows
  // accepts, and only Microsoft issues production kernel-mode signatures. No permission
  // the maintainer could give closes either of these.
  if (evidence.packageRoute.microsoftSoleProviderOfProductionKernelSignatures === true && evidence.packageRoute.thirdPartyCatalogSigningAvailable !== true) {
    blockers.push(blocker('MICROSOFT_SIGNATURE_REQUIRED_FOR_INSTALLABLE_PACKAGE', 'Microsoft is the sole provider of production kernel-mode driver signatures, and third-party release certificates can no longer sign a driver package catalog, so Dialed cannot produce an installable package for this binary on its own.'));
  }
  if (evidence.packageRoute.resubmissionAltersReviewedBinary === true) {
    blockers.push(blocker('SUBMISSION_WOULD_ALTER_REVIEWED_BINARY', 'A Microsoft submission regenerates the catalog and overwrites embedded signatures, so the returned driver would no longer be the exact reviewed upstream file.'));
  }
  if (evidence.packageRoute.symbolFileAvailableForSubmission !== true) {
    blockers.push(blocker('SUBMISSION_SYMBOLS_UNAVAILABLE', 'Attestation submission requires the driver symbol file for Microsoft crash analysis, and no upstream symbol file is published for this binary.'));
  }
  if (evidence.rights.microsoftSignatureSubmission !== 'GRANTED') {
    blockers.push(blocker('SUBMISSION_RIGHTS_UNRESOLVED', 'Permission for Dialed to submit this third-party kernel binary for a Microsoft signature under its own account is not resolved.'));
  }

  const deduped = dedupeBlockers(blockers);
  return deepFreeze({ eligibleForProductionLifecycle: deduped.length === 0, blockers: deduped });
}

// Computes the separate, strictly narrower verdict for the ADOPT-EXISTING route, in
// which Dialed ships no upstream file, stages no driver package, and installs nothing.
// Redistribution, catalog and submission gates therefore do not apply. What still
// applies is the safety of managing the exact installed binary: it must be a reviewed
// variant whose signature Windows already accepts, Dialed must never drive the upstream
// Setup tooling, and a variant that needs a Windows protection disabled stays refused.
function evaluateAdoptionEligibility(evidence, options = {}) {
  const fileByRole = assertValidatedEvidence(evidence);
  const blockers = [];
  // Adoption manages one exact installed variant, so the Memory Integrity question is
  // answered per variant rather than for the archive as a whole. An unknown variant is
  // treated as if it were a patching build, which is the conservative direction.
  const observedVariantRole = Object.prototype.hasOwnProperty.call(options, 'observedVariantRole') ? options.observedVariantRole : null;
  if (observedVariantRole !== null && !ADOPTABLE_VARIANT_ROLES.includes(observedVariantRole)) throw new Error('observedVariantRole is not a recognized adoptable driver variant role.');
  const variantIsPatching = observedVariantRole === null
    ? PATCHING_ROLES.some((role) => fileByRole.has(role))
    : PATCHING_ROLES.includes(observedVariantRole);

  if (evidence.signers.systemBinary.status !== 'VALID_EMBEDDED_SIGNATURE_NOT_CATALOG_MEMBER') {
    blockers.push(blocker('ADOPTED_BINARY_SIGNATURE_NOT_ESTABLISHED', 'The installed driver binary does not carry the reviewed Microsoft-issued embedded signature.'));
  }
  if (evidence.compatibility.memoryIntegrityRequiredDisabledForPatchingVariant === true && variantIsPatching) {
    blockers.push(blocker('MEMORY_INTEGRITY_INCOMPATIBLE_PATCHING_VARIANT', 'The patching SYS variants require Memory Integrity to be disabled per upstream documentation. Dialed will never disable or tell a customer to disable that protection, and will not manage a scope that depends on it.'));
  }
  if (evidence.rights.brandingWording !== 'GRANTED') {
    blockers.push(blocker('ATTRIBUTION_WORDING_UNRESOLVED', 'The exact upstream attribution wording Dialed shows for an adopted package is not yet confirmed.'));
  }
  if (evidence.rights.automation !== 'GRANTED') {
    blockers.push(blocker('AUTOMATION_RIGHTS_UNRESOLVED', 'Permission for Dialed to automate selected-device filter attachment is not yet resolved.'));
  }

  const deduped = dedupeBlockers(blockers);
  return deepFreeze({
    eligibleForAdoption: deduped.length === 0,
    blockers: deduped,
    observedVariantRole,
    // Recorded so no caller can mistake an adoption verdict for an install verdict.
    shipsUpstreamPayload: false,
    stagesDriverPackage: false,
  });
}

module.exports = {
  EVIDENCE_SCHEMA_VERSION,
  RIGHTS_STATUSES,
  RIGHTS_KEYS,
  REQUIRED_FILE_ROLES,
  AUTHENTICODE_STATUSES,
  PERMISSION_SCOPES,
  validateUpstreamEvidence,
  evaluateEligibility,
  evaluateAdoptionEligibility,
};
