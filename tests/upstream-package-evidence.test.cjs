const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const evidenceModule = require('../src/main/input-driver-lifecycle/upstream-package-evidence.cjs');

const { validateUpstreamEvidence, evaluateEligibility, evaluateAdoptionEligibility, REQUIRED_FILE_ROLES } = evidenceModule;

const EXAMPLE_PATH = path.join(__dirname, '..', 'src', 'main', 'input-driver-lifecycle', 'upstream-package-evidence.example.json');

function fixture() {
  return JSON.parse(fs.readFileSync(EXAMPLE_PATH, 'utf8'));
}

test('the checked-in example preserves the 2026-09-04 archive observation and validates', () => {
  const raw = fixture();
  const { evidence, evidenceSha256 } = validateUpstreamEvidence(raw);
  assert.equal(evidence.archive.sha256, 'bd8d1fb0545d8df88d9cef0c67682daef7d304561bc64acfee5c0d8c12d0f797');
  assert.equal(evidence.archive.sourceUrl, 'https://github.com/LordOfMice/hidusbf');
  assert.equal(evidence.rights.freeUnmodifiedBundling, 'GRANTED');
  assert.equal(evidence.rights.commercialRedistribution, 'UNRESOLVED');
  assert.equal(evidence.archive.retrievedAt, '2026-09-04');
  assert.equal(evidence.rights.automation, 'UNRESOLVED');
  assert.equal(evidence.rights.modification, 'DENIED');
  assert.match(evidenceSha256, /^[a-f0-9]{64}$/);
});

test('the recorded permission names the third party it was actually given to', () => {
  const { evidence } = validateUpstreamEvidence(fixture());
  assert.equal(evidence.maintainerPermission.scope, 'PUBLIC_DOMAIN_BINARIES_UNMODIFIED_NAME_PRESERVED');
  assert.equal(evidence.maintainerPermission.grantedTo, 'Jbogert123');
  assert.match(evidence.maintainerPermission.grantedToProject, /CINCH OC/);
  assert.match(evidence.maintainerPermission.grantedToProject, /Dialed was not the requester/);
  assert.match(evidence.maintainerPermission.statement, /Public Domain/);
});

test('the recorded platform facts are kept apart from the recorded permissions', () => {
  const { evidence } = validateUpstreamEvidence(fixture());
  assert.deepEqual(evidence.packageRoute, {
    thirdPartyCatalogSigningAvailable: false,
    microsoftSoleProviderOfProductionKernelSignatures: true,
    resubmissionAltersReviewedBinary: true,
    symbolFileAvailableForSubmission: false,
  });
  assert.equal(Object.prototype.hasOwnProperty.call(evidence.rights, 'thirdPartyCatalogSigningAvailable'), false);
});

test('the reproduced evidence is not eligible to redistribute and install, and names every open gate', () => {
  const { evidence } = validateUpstreamEvidence(fixture());
  const result = evaluateEligibility(evidence);
  assert.equal(result.eligibleForProductionLifecycle, false);
  const codes = result.blockers.map((entry) => entry.code).sort();
  assert.deepEqual(codes, [
    'AUTOMATION_RIGHTS_UNRESOLVED',
    'BRANDING_WORDING_RIGHTS_UNRESOLVED',
    'COMMERCIAL_REDISTRIBUTION_RIGHTS_UNRESOLVED',
    'MEMORY_INTEGRITY_INCOMPATIBLE_PATCHING_VARIANT',
    'MICROSOFT_SIGNATURE_REQUIRED_FOR_INSTALLABLE_PACKAGE',
    'NO_CATALOG_FILE',
    'SUBMISSION_RIGHTS_UNRESOLVED',
    'SUBMISSION_SYMBOLS_UNAVAILABLE',
    'SUBMISSION_WOULD_ALTER_REVIEWED_BINARY',
    'UNTRUSTED_SETUP_TOOLING',
  ]);
});

test('adoption is a separate, strictly narrower verdict than installation', () => {
  const { evidence } = validateUpstreamEvidence(fixture());
  const install = evaluateEligibility(evidence);
  const adoption = evaluateAdoptionEligibility(evidence, { observedVariantRole: 'SYS_NOPATCH' });

  assert.equal(adoption.shipsUpstreamPayload, false);
  assert.equal(adoption.stagesDriverPackage, false);
  assert.equal(adoption.observedVariantRole, 'SYS_NOPATCH');

  const installCodes = new Set(install.blockers.map((entry) => entry.code));
  for (const code of ['MICROSOFT_SIGNATURE_REQUIRED_FOR_INSTALLABLE_PACKAGE', 'NO_CATALOG_FILE', 'COMMERCIAL_REDISTRIBUTION_RIGHTS_UNRESOLVED', 'SUBMISSION_SYMBOLS_UNAVAILABLE']) {
    assert.equal(installCodes.has(code), true, code);
    assert.equal(adoption.blockers.some((entry) => entry.code === code), false, code);
  }
  assert.deepEqual(adoption.blockers.map((entry) => entry.code), ['ATTRIBUTION_WORDING_UNRESOLVED', 'AUTOMATION_RIGHTS_UNRESOLVED']);
});

test('adoption answers the Memory Integrity question per observed variant', () => {
  const { evidence } = validateUpstreamEvidence(fixture());

  for (const role of ['SYS_PATCHING_1KHZ', 'SYS_PATCHING_4_8KHZ']) {
    const patching = evaluateAdoptionEligibility(evidence, { observedVariantRole: role });
    assert.equal(patching.blockers.some((entry) => entry.code === 'MEMORY_INTEGRITY_INCOMPATIBLE_PATCHING_VARIANT'), true, role);
  }

  const noPatch = evaluateAdoptionEligibility(evidence, { observedVariantRole: 'SYS_NOPATCH' });
  assert.equal(noPatch.blockers.some((entry) => entry.code === 'MEMORY_INTEGRITY_INCOMPATIBLE_PATCHING_VARIANT'), false);

  const unknownVariant = evaluateAdoptionEligibility(evidence);
  assert.equal(unknownVariant.blockers.some((entry) => entry.code === 'MEMORY_INTEGRITY_INCOMPATIBLE_PATCHING_VARIANT'), true);
  assert.throws(() => evaluateAdoptionEligibility(evidence, { observedVariantRole: 'NOT_A_ROLE' }), /not a recognized adoptable driver variant role/);
  assert.throws(() => evaluateAdoptionEligibility(evidence, { observedVariantRole: 'SETUP_EXE' }), /not a recognized adoptable driver variant role/);
});

test('adoption still refuses a binary whose reviewed signature is not established', () => {
  const raw = fixture();
  raw.signers.systemBinary.status = 'SELF_SIGNED_UNTRUSTED_CHAIN';
  assert.throws(() => validateUpstreamEvidence(raw), /signers\.systemBinary\.status is not recognized/);
});

test('validation rejects signer summaries that disagree with their file evidence', () => {
  const sysMismatch = fixture();
  sysMismatch.files.find((file) => file.role === 'SYS_NOPATCH').authenticode.subject = 'Anything';
  assert.throws(() => validateUpstreamEvidence(sysMismatch), /must match the reviewed systemBinary signer/);

  const setupMismatch = fixture();
  setupMismatch.files.find((file) => file.role === 'SETUP_EXE').authenticode.status = 'NOT_APPLICABLE';
  assert.throws(() => validateUpstreamEvidence(setupMismatch), /must match the reviewed setupTools status/);
});

test('resolved attribution and automation rights make NoPatch adoption eligible', () => {
  const raw = fixture();
  raw.rights.brandingWording = 'GRANTED';
  raw.rights.automation = 'GRANTED';
  const { evidence } = validateUpstreamEvidence(raw);
  const adoption = evaluateAdoptionEligibility(evidence, { observedVariantRole: 'SYS_NOPATCH' });
  assert.equal(adoption.eligibleForAdoption, true);
  assert.deepEqual(adoption.blockers, []);
  assert.equal(evaluateEligibility(evidence).eligibleForProductionLifecycle, false);
});

test('validation is fail-closed on an unknown top-level field', () => {
  const raw = fixture();
  raw.unexpected = true;
  assert.throws(() => validateUpstreamEvidence(raw), /unsupported fields/);
});

test('validation is fail-closed on an unknown schemaVersion', () => {
  const raw = fixture();
  raw.schemaVersion = '2.0.0';
  assert.throws(() => validateUpstreamEvidence(raw), /schemaVersion must be/);
});

test('validation rejects a wrong-shaped archive sha256', () => {
  const raw = fixture();
  raw.archive.sha256 = 'not-a-hash';
  assert.throws(() => validateUpstreamEvidence(raw), /archive\.sha256 is not valid/);
});

test('validation rejects a missing required file role', () => {
  const raw = fixture();
  raw.files = raw.files.filter((file) => file.role !== 'SYS_PATCHING_4_8KHZ');
  assert.throws(() => validateUpstreamEvidence(raw), /exactly the 6 reviewed upstream artifacts/);
});

test('validation rejects a duplicate file role', () => {
  const raw = fixture();
  raw.files[1] = { ...raw.files[0] };
  assert.throws(() => validateUpstreamEvidence(raw), /exactly the 6 reviewed upstream artifacts|duplicate roles/);
});

test('validation requires a pinned sha256 for every reviewed SYS variant', () => {
  const raw = fixture();
  const sys = raw.files.find((file) => file.role === 'SYS_PATCHING_1KHZ');
  sys.sha256 = null;
  assert.throws(() => validateUpstreamEvidence(raw), /sha256 must be pinned/);
});

test('validation accepts a null sha256 only for the unpinned Setup tooling roles', () => {
  const raw = fixture();
  assert.doesNotThrow(() => validateUpstreamEvidence(raw));
  for (const role of REQUIRED_FILE_ROLES) {
    const file = raw.files.find((entry) => entry.role === role);
    assert.equal(typeof file.sha256 === 'string' || file.sha256 === null, true);
  }
});

test('validation rejects an unrecognized rights status', () => {
  const raw = fixture();
  raw.rights.automation = 'MAYBE';
  assert.throws(() => validateUpstreamEvidence(raw), /rights\.automation must be one of/);
});

test('validation rejects an unrecognized maintainer permission scope', () => {
  const raw = fixture();
  raw.maintainerPermission.scope = 'FULL_COMMERCIAL_RIGHTS';
  assert.throws(() => validateUpstreamEvidence(raw), /scope is not recognized/);
});

test('validation rejects a malformed retrievedAt date', () => {
  const raw = fixture();
  raw.archive.retrievedAt = '2026-13-40';
  assert.throws(() => validateUpstreamEvidence(raw), /not a valid date/);
});

test('a catalog-linked INF removes only the NO_CATALOG_FILE blocker', () => {
  const raw = fixture();
  raw.files.find((file) => file.role === 'INF').catalogFileDirective = true;
  const { evidence } = validateUpstreamEvidence(raw);
  const codes = evaluateEligibility(evidence).blockers.map((entry) => entry.code);
  assert.equal(codes.includes('NO_CATALOG_FILE'), false);
  assert.equal(codes.includes('UNTRUSTED_SETUP_TOOLING'), true);
});

test('trusted Setup tooling removes only the UNTRUSTED_SETUP_TOOLING blocker', () => {
  const raw = fixture();
  raw.signers.setupTools.status = 'VALID_EMBEDDED_SIGNATURE_NOT_CATALOG_MEMBER';
  for (const role of ['SETUP_EXE', 'SX64_EXE']) {
    const file = raw.files.find((entry) => entry.role === role);
    file.authenticode = { status: 'VALID_EMBEDDED_SIGNATURE_NOT_CATALOG_MEMBER', subject: 'Trusted Publisher' };
  }
  const { evidence } = validateUpstreamEvidence(raw);
  const codes = evaluateEligibility(evidence).blockers.map((entry) => entry.code);
  assert.equal(codes.includes('UNTRUSTED_SETUP_TOOLING'), false);
  assert.equal(codes.includes('NO_CATALOG_FILE'), true);
});

test('a package that does not require disabling Memory Integrity removes only that blocker', () => {
  const raw = fixture();
  raw.compatibility.memoryIntegrityRequiredDisabledForPatchingVariant = false;
  const { evidence } = validateUpstreamEvidence(raw);
  const codes = evaluateEligibility(evidence).blockers.map((entry) => entry.code);
  assert.equal(codes.includes('MEMORY_INTEGRITY_INCOMPATIBLE_PATCHING_VARIANT'), false);
});

test('resolved commercial and branding rights each remove exactly their own blocker', () => {
  const raw = fixture();
  raw.rights.commercialRedistribution = 'GRANTED';
  raw.rights.automation = 'GRANTED';
  raw.rights.brandingWording = 'GRANTED';
  const { evidence } = validateUpstreamEvidence(raw);
  const codes = evaluateEligibility(evidence).blockers.map((entry) => entry.code);
  assert.equal(codes.includes('COMMERCIAL_REDISTRIBUTION_RIGHTS_UNRESOLVED'), false);
  assert.equal(codes.includes('AUTOMATION_RIGHTS_UNRESOLVED'), false);
  assert.equal(codes.includes('BRANDING_WORDING_RIGHTS_UNRESOLVED'), false);
});

test('rights grants alone do not close the current Microsoft signing-route gates', () => {
  const raw = fixture();
  for (const key of Object.keys(raw.rights)) raw.rights[key] = 'GRANTED';
  raw.files.find((file) => file.role === 'INF').catalogFileDirective = true;
  raw.compatibility.memoryIntegrityRequiredDisabledForPatchingVariant = false;
  for (const role of ['SETUP_EXE', 'SX64_EXE']) {
    raw.files.find((file) => file.role === role).authenticode = { status: 'VALID_EMBEDDED_SIGNATURE_NOT_CATALOG_MEMBER', subject: 'Trusted Publisher' };
  }
  raw.signers.setupTools.status = 'VALID_EMBEDDED_SIGNATURE_NOT_CATALOG_MEMBER';
  const { evidence } = validateUpstreamEvidence(raw);
  const codes = evaluateEligibility(evidence).blockers.map((entry) => entry.code).sort();
  assert.deepEqual(codes, [
    'MICROSOFT_SIGNATURE_REQUIRED_FOR_INSTALLABLE_PACKAGE',
    'SUBMISSION_SYMBOLS_UNAVAILABLE',
    'SUBMISSION_WOULD_ALTER_REVIEWED_BINARY',
  ]);
});

test('an explicitly DENIED right still blocks eligibility, distinct from GRANTED', () => {
  const raw = fixture();
  raw.rights.commercialRedistribution = 'DENIED';
  const { evidence } = validateUpstreamEvidence(raw);
  const codes = evaluateEligibility(evidence).blockers.map((entry) => entry.code);
  assert.equal(codes.includes('COMMERCIAL_REDISTRIBUTION_RIGHTS_UNRESOLVED'), true);
});

test('a fully resolved, hypothetical package with every gate closed is eligible with zero blockers', () => {
  const raw = fixture();
  raw.rights.commercialRedistribution = 'GRANTED';
  raw.rights.automation = 'GRANTED';
  raw.rights.brandingWording = 'GRANTED';
  raw.rights.microsoftSignatureSubmission = 'GRANTED';
  raw.packageRoute = {
    thirdPartyCatalogSigningAvailable: true,
    microsoftSoleProviderOfProductionKernelSignatures: true,
    resubmissionAltersReviewedBinary: false,
    symbolFileAvailableForSubmission: true,
  };
  raw.files.find((file) => file.role === 'INF').catalogFileDirective = true;
  for (const role of ['SETUP_EXE', 'SX64_EXE']) {
    raw.files.find((file) => file.role === role).authenticode = { status: 'VALID_EMBEDDED_SIGNATURE_NOT_CATALOG_MEMBER', subject: 'Trusted Publisher' };
  }
  raw.signers.setupTools.status = 'VALID_EMBEDDED_SIGNATURE_NOT_CATALOG_MEMBER';
  raw.compatibility.memoryIntegrityRequiredDisabledForPatchingVariant = false;
  const { evidence } = validateUpstreamEvidence(raw);
  const result = evaluateEligibility(evidence);
  assert.equal(result.eligibleForProductionLifecycle, true);
  assert.deepEqual(result.blockers, []);
});

test('evaluateEligibility refuses evidence that was not produced by validateUpstreamEvidence', () => {
  assert.throws(() => evaluateEligibility({ schemaVersion: '1.0.0' }), /Validated upstream package evidence is required/);
  assert.throws(() => evaluateEligibility(fixture()), /Validated upstream package evidence is required/);
  assert.throws(() => evaluateEligibility(Object.freeze({ ...validateUpstreamEvidence(fixture()).evidence })), /Validated upstream package evidence is required/);
});

test('the normalized evidence and its digest are deep-frozen and ignore mutation attempts', () => {
  const { evidence, evidenceSha256 } = validateUpstreamEvidence(fixture());
  assert.equal(Object.isFrozen(evidence), true);
  assert.equal(Object.isFrozen(evidence.rights), true);
  evidence.rights.commercialRedistribution = 'GRANTED';
  assert.equal(evidence.rights.commercialRedistribution, 'UNRESOLVED');
  assert.match(evidenceSha256, /^[a-f0-9]{64}$/);
});

test('the schema file exactly matches this module\'s reviewed roles and rights vocabulary', () => {
  const schemaPath = path.join(__dirname, '..', 'src', 'main', 'input-driver-lifecycle', 'upstream-package-evidence.schema.json');
  const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
  assert.deepEqual(schema.properties.files.items.properties.role.enum.slice().sort(), [...REQUIRED_FILE_ROLES].sort());
  assert.deepEqual(schema.$defs.rightsStatus.enum, evidenceModule.RIGHTS_STATUSES);
});
