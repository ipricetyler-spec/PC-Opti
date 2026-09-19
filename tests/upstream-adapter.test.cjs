const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  DRIVER_VARIANT_ROLES,
  FORBIDDEN_HELPER_ROLES,
  assertNotUpstreamSetupTooling,
  evaluateUpstreamRoutes,
  matchObservedPackage,
  validateAllowlist,
  validateObservedPackage,
  validateSecurityState,
} = require('../src/main/input-driver-lifecycle/upstream-adapter.cjs');
const { validateUpstreamEvidence } = require('../src/main/input-driver-lifecycle/upstream-package-evidence.cjs');

const EXAMPLE_PATH = path.join(__dirname, '..', 'src', 'main', 'input-driver-lifecycle', 'upstream-package-evidence.example.json');

const NOPATCH_SHA = '2f82cdeb36bdaa42ea1933a9b11f3b8e1bdb28e6d3e3da7e65b4631b3375412d';
const PATCHING_SHA = 'db73a8c259e16a0d02f138650497c1bdec81add66d928f3cf3ff39fad4eb421b';
const INF_SHA = '48c3a0055070b9a66c239ffc3d068b39aafe7a14554984268acc6da1492759e6';

function rawEvidence(mutate = () => {}) {
  const raw = JSON.parse(fs.readFileSync(EXAMPLE_PATH, 'utf8'));
  mutate(raw);
  return validateUpstreamEvidence(raw).evidence;
}

function rawAllowlist(mutate = () => {}) {
  const raw = {
    schemaVersion: '1.0.0',
    packageId: 'hidusbf-upstream-exact',
    sourceUrl: 'https://github.com/LordOfMice/hidusbf',
    upstreamVersion: '994259a8de31b35d2d44dc800368d9418dd3eb04',
    archiveSha256: 'bd8d1fb0545d8df88d9cef0c67682daef7d304561bc64acfee5c0d8c12d0f797',
    serviceName: 'hidusbf',
    signerSubject: 'Microsoft Windows Hardware Compatibility Publisher',
    files: [
      { role: 'INF', path: 'DRIVER/HIDUSBF_AS.INF', bytes: 4096, sha256: INF_SHA },
      { role: 'SYS_NOPATCH', path: 'DRIVER/AMD64_AS/hidusbf.sys', bytes: 32768, sha256: NOPATCH_SHA },
      { role: 'SYS_PATCHING_4_8KHZ', path: 'DRIVER/AMD64_AS/hidusbf.sys', bytes: 33792, sha256: PATCHING_SHA },
    ],
  };
  mutate(raw);
  return raw;
}

function allowlist(mutate) {
  return validateAllowlist(rawAllowlist(mutate)).allowlist;
}

function observed(mutate = () => {}) {
  const raw = {
    present: true,
    serviceName: 'hidusbf',
    imagePath: 'C:\\Windows\\System32\\drivers\\hidusbf.sys',
    binarySha256: NOPATCH_SHA,
    binaryBytes: 32768,
    embeddedSignatureValid: true,
    signerSubject: 'Microsoft Windows Hardware Compatibility Publisher',
    installedByDialed: false,
    oemInfName: null,
    extraFiles: [],
    missingFiles: [],
  };
  mutate(raw);
  return validateObservedPackage(raw);
}

function absentPackage() {
  return validateObservedPackage({
    present: false,
    serviceName: null,
    imagePath: null,
    binarySha256: null,
    binaryBytes: null,
    embeddedSignatureValid: false,
    signerSubject: null,
    installedByDialed: false,
    oemInfName: null,
    extraFiles: [],
    missingFiles: [],
  });
}

function security(mutate = () => {}) {
  const raw = { secureBoot: 'ENABLED', memoryIntegrity: 'ENABLED', driverSignatureEnforcement: 'ENABLED' };
  mutate(raw);
  return validateSecurityState(raw);
}

function routes(overrides = {}) {
  return evaluateUpstreamRoutes({
    evidence: overrides.evidence || rawEvidence(),
    allowlist: overrides.allowlist || allowlist(),
    observed: overrides.observed || observed(),
    security: overrides.security || security(),
  });
}

function adoptionReadyEvidence() {
  return rawEvidence((raw) => {
    raw.rights.brandingWording = 'GRANTED';
    raw.rights.automation = 'GRANTED';
  });
}

function codes(entry) {
  return entry.blockers.map((blocker) => blocker.code).sort();
}

test('the allowlist pins exact roles, paths, sizes and hashes', () => {
  const { allowlist: list, allowlistSha256 } = validateAllowlist(rawAllowlist());

  assert.equal(list.packageId, 'hidusbf-upstream-exact');
  assert.equal(list.sourceUrl, 'https://github.com/LordOfMice/hidusbf');
  assert.equal(list.serviceName, 'hidusbf');
  assert.equal(list.files.length, 3);
  assert.match(allowlistSha256, /^[a-f0-9]{64}$/);
  assert.equal(Object.isFrozen(list), true);
  assert.deepEqual(validateAllowlist(rawAllowlist()).allowlistSha256, allowlistSha256);
});

test('the allowlist refuses upstream Setup tooling by role, not by signature', () => {
  for (const role of FORBIDDEN_HELPER_ROLES) {
    assert.throws(
      () => validateAllowlist(rawAllowlist((raw) => { raw.files.push({ role, path: 'Setup.exe', bytes: 1024, sha256: 'a'.repeat(64) }); })),
      /upstream Setup tooling and must never be allowlisted/,
    );
    assert.throws(() => assertNotUpstreamSetupTooling(role), /can never act as the Dialed privileged helper/);
  }
  assert.equal(assertNotUpstreamSetupTooling('SYS_NOPATCH'), 'SYS_NOPATCH');
});

test('the allowlist refuses unpinned, oversized, escaping and duplicate entries', () => {
  assert.throws(() => validateAllowlist(rawAllowlist((raw) => { raw.files[1].sha256 = null; })), /sha256 is not valid/);
  assert.throws(() => validateAllowlist(rawAllowlist((raw) => { raw.files[1].bytes = 0; })), /bytes is not valid/);
  assert.throws(() => validateAllowlist(rawAllowlist((raw) => { raw.files[1].path = '../escape.sys'; })), /contained relative path/);
  assert.throws(() => validateAllowlist(rawAllowlist((raw) => { raw.files[1].path = 'C:\\\\Windows\\\\hidusbf.sys'; })), /contained relative path/);
  assert.throws(() => validateAllowlist(rawAllowlist((raw) => { raw.files.push({ ...raw.files[1] }); })), /roles must be unique/);
  assert.throws(() => validateAllowlist(rawAllowlist((raw) => { raw.files = [raw.files[0]]; })), /at least one reviewed driver variant/);
  assert.throws(() => validateAllowlist(rawAllowlist((raw) => { raw.unexpected = true; })), /unsupported fields/);
});

test('an installed binary resolves only on an exact hash and size match', () => {
  const exact = matchObservedPackage(allowlist(), observed());
  assert.equal(exact.matched, true);
  assert.equal(exact.variantRole, 'SYS_NOPATCH');
  assert.deepEqual(exact.blockers, []);

  const patching = matchObservedPackage(allowlist(), observed((raw) => { raw.binarySha256 = PATCHING_SHA; raw.binaryBytes = 33792; }));
  assert.equal(patching.variantRole, 'SYS_PATCHING_4_8KHZ');

  assert.deepEqual(codes(matchObservedPackage(allowlist(), observed((raw) => { raw.binarySha256 = 'c'.repeat(64); }))), ['UPSTREAM_BINARY_NOT_ALLOWLISTED']);
  assert.deepEqual(codes(matchObservedPackage(allowlist(), observed((raw) => { raw.binaryBytes = 4096; }))), ['UPSTREAM_BINARY_SIZE_MISMATCH']);
  assert.deepEqual(codes(matchObservedPackage(allowlist(), observed((raw) => { raw.embeddedSignatureValid = false; }))), ['UPSTREAM_BINARY_SIGNATURE_INVALID']);
  assert.deepEqual(codes(matchObservedPackage(allowlist(), observed((raw) => { raw.signerSubject = 'Anything'; }))), ['UPSTREAM_BINARY_SIGNER_MISMATCH']);
  assert.deepEqual(codes(matchObservedPackage(allowlist(), observed((raw) => { raw.serviceName = 'anything'; }))), ['UPSTREAM_SERVICE_NAME_MISMATCH']);
  assert.deepEqual(codes(matchObservedPackage(allowlist(), observed((raw) => { raw.imagePath = 'C:\\Windows\\System32\\drivers\\anything.sys'; }))), ['UPSTREAM_IMAGE_NAME_MISMATCH']);
  assert.deepEqual(codes(matchObservedPackage(allowlist(), observed((raw) => { raw.extraFiles = ['DRIVER/extra.dll']; }))), ['UPSTREAM_PACKAGE_HAS_EXTRA_FILES']);
  assert.deepEqual(codes(matchObservedPackage(allowlist(), observed((raw) => { raw.missingFiles = ['DRIVER/HIDUSBF_AS.INF']; }))), ['UPSTREAM_PACKAGE_INCOMPLETE']);
  assert.deepEqual(codes(matchObservedPackage(allowlist(), absentPackage())), ['UPSTREAM_PACKAGE_NOT_PRESENT']);
});

test('an absent-package observation must be structurally complete', () => {
  assert.throws(() => validateObservedPackage({ present: false, serviceName: 'hidusbf', imagePath: null, binarySha256: null, binaryBytes: null, embeddedSignatureValid: false, signerSubject: null, installedByDialed: false, oemInfName: null, extraFiles: [], missingFiles: [] }), /must be null when the package is absent/);
  assert.throws(() => validateObservedPackage({ present: true, serviceName: 'hidusbf', imagePath: 'not-a-windows-path', binarySha256: NOPATCH_SHA, binaryBytes: 1, embeddedSignatureValid: true, signerSubject: 'x', installedByDialed: false, oemInfName: null, extraFiles: [], missingFiles: [] }), /imagePath is not valid/);
});

test('adoption is available for the exact NoPatch installation while installation stays blocked', () => {
  const report = routes({ evidence: adoptionReadyEvidence() });

  assert.equal(report.capabilities.adopt.available, true);
  assert.equal(report.capabilities.adopt.route, 'ADOPT_EXISTING_EXACT_PACKAGE');
  assert.equal(report.capabilities.install.available, false);
  assert.equal(report.recommendedRoute, 'ADOPT_EXISTING_EXACT_PACKAGE');
  assert.equal(report.productionManifestReady, false);

  const installCodes = codes(report.capabilities.install);
  assert.ok(installCodes.includes('MICROSOFT_SIGNATURE_REQUIRED_FOR_INSTALLABLE_PACKAGE'));
  assert.ok(installCodes.includes('COMMERCIAL_REDISTRIBUTION_RIGHTS_UNRESOLVED'));
});

test('installation and adoption never share a verdict', () => {
  const report = routes({ evidence: adoptionReadyEvidence() });
  const adoptCodes = new Set(codes(report.capabilities.adopt));

  for (const code of ['NO_CATALOG_FILE', 'MICROSOFT_SIGNATURE_REQUIRED_FOR_INSTALLABLE_PACKAGE', 'SUBMISSION_SYMBOLS_UNAVAILABLE', 'SUBMISSION_WOULD_ALTER_REVIEWED_BINARY', 'COMMERCIAL_REDISTRIBUTION_RIGHTS_UNRESOLVED']) {
    assert.equal(adoptCodes.has(code), false, code);
  }
});

test('a patching variant that needs Memory Integrity disabled is refused for adoption', () => {
  const report = routes({ evidence: adoptionReadyEvidence(), observed: observed((raw) => { raw.binarySha256 = PATCHING_SHA; raw.binaryBytes = 33792; }) });

  assert.equal(report.match.variantRole, 'SYS_PATCHING_4_8KHZ');
  assert.equal(report.capabilities.adopt.available, false);
  assert.ok(codes(report.capabilities.adopt).includes('MEMORY_INTEGRITY_INCOMPATIBLE_PATCHING_VARIANT'));
});

test('any Windows protection that is not confirmed enabled blocks every route', () => {
  for (const [key, code] of [['secureBoot', 'SECURE_BOOT_NOT_ENABLED'], ['memoryIntegrity', 'MEMORY_INTEGRITY_NOT_ENABLED'], ['driverSignatureEnforcement', 'DRIVER_SIGNATURE_ENFORCEMENT_NOT_ENABLED']]) {
    for (const value of ['DISABLED', 'UNKNOWN']) {
      const report = routes({ evidence: adoptionReadyEvidence(), security: security((raw) => { raw[key] = value; }) });
      assert.equal(report.capabilities.adopt.available, false, `${key}=${value}`);
      assert.equal(report.capabilities.install.available, false, `${key}=${value}`);
      assert.ok(codes(report.capabilities.adopt).includes(code));
    }
  }
  assert.throws(() => validateSecurityState({ secureBoot: 'OFF', memoryIntegrity: 'ENABLED', driverSignatureEnforcement: 'ENABLED' }), /must be one of/);
});

test('an externally installed package is never repaired, upgraded or removed by Dialed', () => {
  const report = routes({ evidence: adoptionReadyEvidence() });

  assert.equal(report.capabilities.adopt.available, true);
  for (const capability of ['repair', 'upgrade', 'removePackage']) {
    assert.equal(report.capabilities[capability].available, false, capability);
    assert.ok(codes(report.capabilities[capability]).includes('EXTERNAL_PACKAGE_NOT_DIALED_OWNED'), capability);
  }
});

test('installation is not offered while a package is already present', () => {
  const report = routes({ evidence: adoptionReadyEvidence() });
  assert.ok(codes(report.capabilities.install).includes('UPSTREAM_PACKAGE_ALREADY_PRESENT'));

  const clean = routes({ evidence: adoptionReadyEvidence(), observed: absentPackage() });
  assert.equal(clean.capabilities.install.available, false);
  assert.equal(codes(clean.capabilities.install).includes('UPSTREAM_PACKAGE_ALREADY_PRESENT'), false);
  assert.equal(clean.capabilities.adopt.available, false);
  assert.ok(codes(clean.capabilities.adopt).includes('UPSTREAM_PACKAGE_NOT_PRESENT'));
  assert.equal(clean.recommendedRoute, null);
});

test('maintenance capabilities require a package Dialed itself installed', () => {
  const report = routes({ evidence: adoptionReadyEvidence(), observed: observed((raw) => { raw.installedByDialed = true; }) });

  for (const capability of ['repair', 'upgrade', 'removePackage']) {
    assert.equal(codes(report.capabilities[capability]).includes('EXTERNAL_PACKAGE_NOT_DIALED_OWNED'), false, capability);
    // They remain unavailable, because the installation gate itself is still closed.
    assert.equal(report.capabilities[capability].available, false, capability);
  }
});

test('detach follows the adoption gate, because removing a Dialed attachment ships nothing', () => {
  const report = routes({ evidence: adoptionReadyEvidence() });
  assert.equal(report.capabilities.detach.available, true);
  assert.equal(report.capabilities.detach.route, 'ADOPT_EXISTING_EXACT_PACKAGE');
  assert.deepEqual(codes(report.capabilities.detach), codes(report.capabilities.adopt));
});

test('the checked-in evidence keeps adoption unavailable until attribution and automation are resolved', () => {
  const report = routes();
  assert.equal(report.capabilities.adopt.available, false);
  assert.deepEqual(codes(report.capabilities.adopt), ['ATTRIBUTION_WORDING_UNRESOLVED', 'AUTOMATION_RIGHTS_UNRESOLVED']);
  assert.equal(report.recommendedRoute, null);
});

test('evidence, allowlist and observed identity are one fail-closed trust chain', () => {
  for (const changed of [
    allowlist((raw) => { raw.sourceUrl = 'https://example.com/hidusbf'; }),
    allowlist((raw) => { raw.upstreamVersion = 'different-version'; }),
    allowlist((raw) => { raw.archiveSha256 = 'a'.repeat(64); }),
    allowlist((raw) => { raw.files[1].sha256 = 'a'.repeat(64); }),
    allowlist((raw) => { raw.signerSubject = 'Anything'; }),
  ]) {
    const report = routes({ evidence: adoptionReadyEvidence(), allowlist: changed });
    assert.equal(report.capabilities.adopt.available, false);
    assert.equal(report.recommendedRoute, null);
  }
});

test('the adapter refuses inputs that did not come from its own validators', () => {
  assert.throws(() => evaluateUpstreamRoutes({ evidence: rawEvidence(), allowlist: rawAllowlist(), observed: observed(), security: security() }), /validated upstream allowlist is required/);
  assert.throws(() => evaluateUpstreamRoutes({ evidence: rawEvidence(), allowlist: allowlist(), observed: { present: false }, security: security() }), /validated observed package record is required/);
  assert.throws(() => evaluateUpstreamRoutes({ evidence: rawEvidence(), allowlist: allowlist(), observed: observed(), security: { secureBoot: 'ENABLED' } }), /validated security state is required/);
  assert.throws(() => evaluateUpstreamRoutes({ evidence: rawEvidence(), allowlist: allowlist(), observed: observed() }), /missing required fields/);
  assert.throws(() => evaluateUpstreamRoutes({ evidence: rawEvidence(), allowlist: Object.freeze({ ...allowlist() }), observed: observed(), security: security() }), /validated upstream allowlist is required/);
  assert.throws(() => evaluateUpstreamRoutes({ evidence: rawEvidence(), allowlist: allowlist(), observed: Object.freeze({ ...observed() }), security: security() }), /validated observed package record is required/);
  assert.throws(() => evaluateUpstreamRoutes({ evidence: rawEvidence(), allowlist: allowlist(), observed: observed(), security: Object.freeze({ ...security() }) }), /validated security state is required/);
});

test('every reported route and capability is deep-frozen', () => {
  const report = routes();
  assert.equal(Object.isFrozen(report), true);
  assert.equal(Object.isFrozen(report.capabilities.adopt), true);
  assert.equal(Object.isFrozen(report.capabilities.adopt.blockers), true);
  assert.deepEqual(DRIVER_VARIANT_ROLES, ['SYS_NOPATCH', 'SYS_PATCHING_1KHZ', 'SYS_PATCHING_4_8KHZ']);
});
