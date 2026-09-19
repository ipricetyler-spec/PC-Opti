const assert = require('node:assert/strict');
const { tempDir } = require('./helpers/temp-dir.cjs');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const lifecycle = require('../src/main/input-driver-lifecycle/index.cjs');

const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const DEVICE_A = 'a'.repeat(64);
const DEVICE_B = 'b'.repeat(64);
const DEVICE_C = 'c'.repeat(64);
const STORE_IDENTITY = 'f'.repeat(64);
const NATIVE_PREIMAGE_BINDINGS_SHA256 = hash(JSON.stringify([
  'LOWER_FILTERS_ORDERED_WITH_ABSENCE',
  'USB_BINTERVAL_REQUEST',
  'FILTER_SERVICE_AND_OEM_INF_IDENTITY',
  'PACKAGE_IDENTITY_AND_DRIVER_SHA256',
  'MEMORY_INTEGRITY_AND_SECURE_BOOT',
  'PRESENT_NON_PRESENT_PHANTOM_ATTACHMENTS_AND_COMPLETENESS',
  'BOOT_ID_AND_DRIVER_SESSION',
]));

function validFixture(version = '2.0.0', upgradePredecessors = []) {
  const root = tempDir('dialed-driver-lifecycle-v2-');
  fs.mkdirSync(path.join(root, 'payload'));
  const contents = { INF: Buffer.from(`fixture inf ${version}`), SYS: Buffer.from(`fixture sys ${version}`), CAT: Buffer.from(`fixture cat ${version}`), HELPER: Buffer.from(`fixture helper ${version}`) };
  const files = Object.entries(contents).map(([role, content]) => {
    const extension = role === 'HELPER' ? 'exe' : role.toLowerCase();
    const relative = `payload/fixture.${extension}`;
    fs.writeFileSync(path.join(root, relative), content);
    return { role, path: relative, bytes: content.length, sha256: hash(content), catalogMembership: ['INF', 'SYS'].includes(role) ? 'REQUIRED' : 'NOT_APPLICABLE' };
  });
  const manifest = {
    schemaVersion: '2.0.0', packageId: 'dialed-fixture-driver', version, architecture: 'x64',
    upstream: { name: 'Fixture upstream', sourceUrl: 'https://example.com/upstream', version },
    redistributionPermission: {
      packageRoute: 'UNMODIFIED_RIGHTS_HOLDER',
      evidence: `sha256:${'a'.repeat(64)}`,
      attribution: 'Fixture permission and attribution.',
      grants: { commercialRedistribution: true, bundling: true, automation: true, modification: false },
    },
    publisher: { subject: 'CN=Fixture Publisher', thumbprint: 'B'.repeat(40) },
    driverPackage: {
      inf: {
        provider: 'Fixture Provider', class: 'USB', classGuid: '{36FC9E60-C465-11CF-8056-444553540000}',
        catalogName: 'fixture.cat', driverVersion: '08/30/2026,2.0.0.0', installModel: 'PNP_FILTER',
        service: { name: 'DialedFixtureFilter', startType: 'DEMAND_START', imagePath: '\\SystemRoot\\System32\\drivers\\fixture.sys' },
      },
    },
    signingPolicy: {
      catalogRequiredEkuOids: ['1.3.6.1.5.5.7.3.3'],
      systemBinary: { subject: 'CN=Fixture SYS Publisher', thumbprint: 'C'.repeat(40), requiredEkuOids: ['1.3.6.1.5.5.7.3.3'] },
      helper: { subject: 'CN=Fixture Helper Publisher', thumbprint: 'D'.repeat(40), requiredEkuOids: ['1.3.6.1.5.5.7.3.3'] },
      application: { subject: 'CN=Fixture App Publisher', thumbprint: 'E'.repeat(40), requiredEkuOids: ['1.3.6.1.5.5.7.3.3'] },
      revocation: { mode: 'ONLINE_REQUIRED', failClosed: true, maximumEvidenceAgeHours: 24, requireTimestamp: true },
    },
    compatibility: { windows: { minimumBuild: 19045, maximumBuild: 99999 }, memoryIntegrity: 'SUPPORTED', secureBoot: 'SUPPORTED' },
    polling: { requestsHz: [125, 250, 500, 1000, 2000, 4000, 8000], maximumRequestHz: 8000 },
    upgradePredecessors,
    files,
  };
  fs.writeFileSync(path.join(root, 'manifest.json'), `${JSON.stringify(manifest)}\n`);
  return { root, manifest };
}

function identityFor(manifest) {
  const validated = lifecycle.validateManifest(manifest);
  return {
    packageId: validated.manifest.packageId,
    version: validated.manifest.version,
    manifestSha256: validated.manifestSha256,
    publisherSubject: validated.manifest.publisher.subject,
    publisherThumbprint: validated.manifest.publisher.thumbprint,
  };
}

function createDurableStore(initial = null, options = {}) {
  let record = initial ? structuredClone(initial) : null;
  const writes = [];
  let failWrite = options.failWrite || null;
  const store = {
    durable: true,
    writes,
    set failWrite(value) { failWrite = value; },
    async read() { return record ? structuredClone(record) : null; },
    async write(next, expectedRevision) {
      assert.equal(record?.revision || 0, expectedRevision);
      if (failWrite && failWrite(next, expectedRevision, writes.length)) {
        failWrite = null;
        throw new Error('fixture journal write failure');
      }
      record = structuredClone(next);
      writes.push(structuredClone(next));
    },
    get record() { return record ? structuredClone(record) : null; },
  };
  return options.attested === false ? store : lifecycle.attestTestOnlyStore(store, STORE_IDENTITY);
}

function createFixtureAdapter(options = {}) {
  const state = {
    package: options.package ? structuredClone(options.package) : null,
    attachments: structuredClone(options.attachments || []).map((attachment) => ({ ...attachment, presence: attachment.presence || 'PRESENT' })),
    restartRequired: options.restartRequired || false,
    inventory: structuredClone(options.inventory || { presentComplete: true, nonPresentComplete: true, phantomComplete: true }),
  };
  const calls = [];
  const targetPreflights = [];
  let faultMethod = options.faultMethod || null;
  let faultAfterMutationMethod = options.faultAfterMutationMethod || null;
  let cancelElevationMethod = options.cancelElevationMethod || null;
  let preflightOverride = options.preflightOverride || null;
  let targetPreflightOverride = options.targetPreflightOverride || null;
  let observeOverride = options.observeOverride || null;
  let postMutationHook = options.postMutationHook || null;
  let targetState = structuredClone(options.targetState || { known: true, connected: true, compatible: true, rateEligible: true });
  let installedDriverSha256 = options.driverSha256 || null;
  let activeMutations = 0;
  let maximumConcurrentMutations = 0;
  let checkpointSequence = 1;
  let checkpointHeadId = `checkpoint_${String(checkpointSequence).padStart(20, '0')}`;
  let observationCount = 0;
  const bootId = hash('fixture-boot-id');
  const driverSession = hash('fixture-driver-session');
  const wait = () => options.delayMs ? new Promise((resolve) => setTimeout(resolve, options.delayMs)) : Promise.resolve();

  function nativePreimage(context) {
    const orderedAttachments = structuredClone(state.attachments).sort((left, right) => left.deviceDigest.localeCompare(right.deviceDigest));
    const systemBinary = context.package.manifest.files.find((file) => file.role === 'SYS');
    if (state.package && installedDriverSha256 === null) installedDriverSha256 = systemBinary.sha256;
    return {
      lowerFilters: orderedAttachments.map((entry) => ({ scope: entry.deviceDigest, presence: entry.presence, ordered: state.package ? ['fixture-filter'] : [], absent: state.package === null })),
      usbBIntervalRequests: orderedAttachments.map((entry) => ({ scope: entry.deviceDigest, requestedHz: entry.requestedHz })),
      serviceAndOemInf: { installed: state.package !== null, package: state.package },
      driverSha256: state.package ? installedDriverSha256 : null,
      security: { memoryIntegrity: true, secureBoot: true },
      inventory: state.inventory,
      restartRequired: state.restartRequired,
      bootId,
      driverSession,
    };
  }

  function checkpointFor(context) {
    const request = context.checkpointRequest;
    const digest = hash(JSON.stringify(nativePreimage(context)));
    if (request.extendJournal) {
      if (request.previousId !== checkpointHeadId) throw new Error('fixture rejected a stale recovery-checkpoint branch');
      const previousId = checkpointHeadId;
      checkpointSequence += 1;
      checkpointHeadId = `checkpoint_${String(checkpointSequence).padStart(20, '0')}`;
      return {
        kind: 'RECOVERY_CHECKPOINT', id: checkpointHeadId, digest, journalIdentity: STORE_IDENTITY, bootId,
        sequence: checkpointSequence, previousId, operationId: request.operationId, sealedAt: new Date().toISOString(),
        preimageSchema: 'DIALED_NATIVE_PREIMAGE_V1', preimageBindingsSha256: NATIVE_PREIMAGE_BINDINGS_SHA256,
        immutablePreimage: true, appendOnlyJournal: true, helperAttested: true,
      };
    }
    return {
      kind: 'STATE_ATTESTATION', id: checkpointHeadId, digest, journalIdentity: STORE_IDENTITY, bootId,
      sequence: checkpointSequence, previousId: null, operationId: null, sealedAt: new Date().toISOString(),
      preimageSchema: 'DIALED_NATIVE_PREIMAGE_V1', preimageBindingsSha256: NATIVE_PREIMAGE_BINDINGS_SHA256,
      immutablePreimage: true, appendOnlyJournal: true, helperAttested: true,
    };
  }

  async function mutate(method, context, work) {
    calls.push(method);
    activeMutations += 1;
    maximumConcurrentMutations = Math.max(maximumConcurrentMutations, activeMutations);
    try {
      await wait();
      if (cancelElevationMethod === method) {
        const error = new Error('fixture elevation cancellation');
        error.code = 'ELEVATION_CANCELLED';
        throw error;
      }
      if (faultMethod === method) throw new Error('fixture mutation fault');
      work(context);
      if (postMutationHook) postMutationHook(method, state, structuredClone(context));
      if (faultAfterMutationMethod === method) throw new Error('fixture post-mutation fault');
    } finally {
      activeMutations -= 1;
    }
  }
  const adapter = {
    kind: lifecycle.TRUSTED_ADAPTER_KIND,
    calls,
    targetPreflights,
    state,
    set faultMethod(value) { faultMethod = value; },
    set faultAfterMutationMethod(value) { faultAfterMutationMethod = value; },
    set cancelElevationMethod(value) { cancelElevationMethod = value; },
    set preflightOverride(value) { preflightOverride = value; },
    set targetPreflightOverride(value) { targetPreflightOverride = value; },
    set observeOverride(value) { observeOverride = value; },
    set postMutationHook(value) { postMutationHook = value; },
    set targetState(value) { targetState = structuredClone(value); },
    get maximumConcurrentMutations() { return maximumConcurrentMutations; },
    async preflightPackage(context) {
      const checkedAt = new Date().toISOString();
      const signature = (policy) => ({
        status: 'VALID', subject: policy.subject, thumbprint: policy.thumbprint, ekuOids: [...policy.requiredEkuOids],
        revocationStatus: 'GOOD', revocationCheckedAt: checkedAt, timestampStatus: 'VALID',
      });
      const result = {
        host: { architecture: 'x64', windowsBuild: 26100 },
        compatibility: { memoryIntegrity: true, secureBoot: true },
        application: { packaged: true, ...signature(context.manifest.signingPolicy.application) },
        helper: { packaged: true, fileSha256: context.manifest.files.find((file) => file.role === 'HELPER').sha256, ...signature(context.manifest.signingPolicy.helper) },
        catalog: { fileSha256: context.manifest.files.find((file) => file.role === 'CAT').sha256, ...signature({ subject: context.manifest.publisher.subject, thumbprint: context.manifest.publisher.thumbprint, requiredEkuOids: context.manifest.signingPolicy.catalogRequiredEkuOids }) },
        systemBinary: { embeddedSignature: true, fileSha256: context.manifest.files.find((file) => file.role === 'SYS').sha256, ...signature(context.manifest.signingPolicy.systemBinary) },
        inf: structuredClone(context.manifest.driverPackage.inf),
        files: context.manifest.files.map((file) => ({ ...file, catalogMember: file.catalogMembership === 'REQUIRED' ? true : null })),
      };
      return preflightOverride ? preflightOverride(structuredClone(result)) : result;
    },
    async preflightTarget(context) {
      targetPreflights.push({ purpose: context.purpose, operationId: context.operationId, deviceDigest: context.target.deviceDigest, requestedHz: context.target.requestedHz, nativeCheckpointId: context.nativeCheckpointId });
      const result = { ...structuredClone(targetState), deviceDigest: context.target.deviceDigest, requestedHz: context.target.requestedHz, nativeCheckpointId: context.nativeCheckpointId, helperAttested: true };
      return targetPreflightOverride ? targetPreflightOverride(structuredClone(result), structuredClone(context), targetPreflights.length) : result;
    },
    async observe(context) {
      observationCount += 1;
      const result = { ...structuredClone(state), nativeCheckpoint: checkpointFor(context) };
      return observeOverride ? observeOverride(structuredClone(result), structuredClone(context), observationCount) : result;
    },
    async installPackage(context) { return mutate('installPackage', context, () => { state.package = identityFor(context.package.manifest); installedDriverSha256 = context.package.manifest.files.find((file) => file.role === 'SYS').sha256; }); },
    async repairPackage(context) { return mutate('repairPackage', context, () => {}); },
    async upgradePackage(context) { return mutate('upgradePackage', context, () => { state.package = identityFor(context.package.manifest); installedDriverSha256 = context.package.manifest.files.find((file) => file.role === 'SYS').sha256; }); },
    async attachFilter(context) {
      return mutate('attachFilter', context, () => {
        state.attachments = state.attachments.filter((entry) => entry.deviceDigest !== context.target.deviceDigest);
        state.attachments.push({ ...structuredClone(context.target), presence: 'PRESENT' });
        state.attachments.sort((left, right) => left.deviceDigest.localeCompare(right.deviceDigest));
        state.restartRequired = true;
      });
    },
    async detachFilter(context) {
      return mutate('detachFilter', context, () => {
        state.attachments = state.attachments.filter((entry) => entry.deviceDigest !== context.target.deviceDigest);
        state.restartRequired = false;
      });
    },
    async removePackage(context) { return mutate('removePackage', context, () => { state.package = null; state.attachments = []; state.restartRequired = false; installedDriverSha256 = null; }); },
  };
  return options.attested === false ? adapter : lifecycle.attestTestOnlyAdapter(adapter);
}

function createConfiguredService(fixture, adapter, store, extra = {}) {
  const { configurationOverrides = {}, ...serviceOptions } = extra;
  return lifecycle.createInputDriverLifecycleService({
    appRoot: fixture.root,
    adapter,
    transactionStore: store,
    configuration: {
      status: 'CONFIGURED',
      manifestPath: 'manifest.json',
      manifestSha256: lifecycle.validateManifest(fixture.manifest).manifestSha256,
      transactionStoreIdentity: STORE_IDENTITY,
      cleanMachineAcceptance: 'PASSED',
      permissionEvidence: fixture.manifest.redistributionPermission.evidence,
      publisherSubject: fixture.manifest.publisher.subject,
      publisherThumbprint: fixture.manifest.publisher.thumbprint,
      ...configurationOverrides,
    },
    testOnlyAllowFixtureAttestations: true,
    ...serviceOptions,
  });
}

async function installFixture(service, adapter, device = DEVICE_A, rate = 8000) {
  const preview = await service.previewInstall(device, rate);
  const result = await service.apply(preview.token);
  adapter.state.restartRequired = false;
  await service.reconcile(result.operationId);
  return result;
}

test('production remains fail-closed and names every external/runtime gate', async () => {
  const status = await lifecycle.createInputDriverLifecycleService({ configuration: {} }).status();
  assert.equal(status.status, 'UNAVAILABLE');
  assert.equal(status.installEnabled, false);
  assert.deepEqual(status.reasons.map((item) => item.code), [
    'LIFECYCLE_NOT_CONFIGURED',
    'SIGNED_PACKAGE_NOT_CONFIGURED',
    'MANIFEST_DIGEST_PIN_REQUIRED',
    'TRANSACTION_STORE_IDENTITY_PIN_REQUIRED',
    'CLEAN_MACHINE_LIFECYCLE_NOT_ACCEPTED',
    'TRUSTED_WINDOWS_ADAPTER_REQUIRED',
    'DURABLE_TRANSACTION_STORE_REQUIRED',
  ]);
});

test('v2 manifest pins grants, security compatibility, polling claims, payload hashes, and publisher', () => {
  const fixture = validFixture();
  const validated = lifecycle.validateManifest(fixture.manifest);
  assert.equal(validated.manifest.schemaVersion, '2.0.0');
  assert.match(validated.manifestSha256, /^[a-f0-9]{64}$/);
  assert.equal(lifecycle.verifyPayload(validated.manifest, fixture.root).every((file) => file.verified), true);
  assert.throws(() => lifecycle.validateManifest({ ...fixture.manifest, redistributionPermission: { ...fixture.manifest.redistributionPermission, grants: { ...fixture.manifest.redistributionPermission.grants, bundling: false } } }), /bundling must be explicitly approved/);
  assert.throws(() => lifecycle.validateManifest({ ...fixture.manifest, compatibility: { ...fixture.manifest.compatibility, memoryIntegrity: 'UNVERIFIED' } }), /Memory Integrity/);
  assert.throws(() => lifecycle.validateManifest({ ...fixture.manifest, polling: { requestsHz: [1000, 8000], maximumRequestHz: 1000 } }), /highest reviewed request/);
  assert.throws(() => lifecycle.validateManifest({ ...fixture.manifest, files: fixture.manifest.files.map((file, index) => index === 0 ? { ...file, path: '../escape.inf' } : file) }), /safe relative path/);
  assert.throws(() => lifecycle.validateManifest({ ...fixture.manifest, files: fixture.manifest.files.map((file, index) => index === 1 ? { ...file, role: 'INF' } : file) }), /roles must be unique/);
  assert.throws(() => lifecycle.validateManifest({ ...fixture.manifest, installHelper: 'unexpected' }), /unsupported fields/);
  fs.writeFileSync(path.join(fixture.root, validated.manifest.files[0].path), 'changed');
  assert.throws(() => lifecycle.verifyPayload(validated.manifest, fixture.root), /(byte count|hash)/);
});

test('permission contract requires automation and requires modification only for an authorized derivative', () => {
  const fixture = validFixture();
  assert.equal(lifecycle.validateManifest(fixture.manifest).manifest.redistributionPermission.grants.modification, false);
  assert.throws(() => lifecycle.validateManifest({
    ...fixture.manifest,
    redistributionPermission: {
      ...fixture.manifest.redistributionPermission,
      grants: { ...fixture.manifest.redistributionPermission.grants, automation: false },
    },
  }), /automation must be explicitly approved/);
  assert.throws(() => lifecycle.validateManifest({
    ...fixture.manifest,
    redistributionPermission: {
      ...fixture.manifest.redistributionPermission,
      packageRoute: 'AUTHORIZED_DERIVATIVE',
      grants: { ...fixture.manifest.redistributionPermission.grants, modification: false },
    },
  }), /Derivative packages require explicit modification permission/);
  assert.doesNotThrow(() => lifecycle.validateManifest({
    ...fixture.manifest,
    redistributionPermission: {
      ...fixture.manifest.redistributionPermission,
      packageRoute: 'AUTHORIZED_DERIVATIVE',
      grants: { ...fixture.manifest.redistributionPermission.grants, modification: true },
    },
  }));
});

test('manifest pins exact modern INF, service, catalog, SYS image, signer, revocation, helper, app, and predecessor semantics', () => {
  const fixture = validFixture();
  const changeInf = (changes) => ({ ...fixture.manifest, driverPackage: { inf: { ...fixture.manifest.driverPackage.inf, ...changes } } });
  assert.throws(() => lifecycle.validateManifest(changeInf({ catalogName: 'other.cat' })), /catalogName must exactly name/);
  assert.throws(() => lifecycle.validateManifest(changeInf({ service: { ...fixture.manifest.driverPackage.inf.service, imagePath: '\\SystemRoot\\System32\\drivers\\other.sys' } })), /imagePath must exactly name/);
  assert.throws(() => lifecycle.validateManifest(changeInf({ service: { ...fixture.manifest.driverPackage.inf.service, startType: 'BOOT_START' } })), /DEMAND_START/);
  assert.throws(() => lifecycle.validateManifest({ ...fixture.manifest, signingPolicy: { ...fixture.manifest.signingPolicy, revocation: { ...fixture.manifest.signingPolicy.revocation, failClosed: false } } }), /fail closed/);
  assert.throws(() => lifecycle.validateManifest({ ...fixture.manifest, files: fixture.manifest.files.filter((file) => file.role !== 'HELPER') }), /missing its HELPER/);
  const predecessor = identityFor(fixture.manifest);
  assert.throws(() => lifecycle.validateManifest({ ...fixture.manifest, upgradePredecessors: [predecessor, predecessor] }), /must not contain duplicates/);
});

test('Dialed-owned package contract accepts only PNP_FILTER at runtime and in schema', () => {
  const fixture = validFixture();
  const primitiveFilterManifest = {
    ...fixture.manifest,
    driverPackage: {
      inf: { ...fixture.manifest.driverPackage.inf, installModel: 'PRIMITIVE_FILTER' },
    },
  };
  assert.doesNotThrow(() => lifecycle.validateManifest(fixture.manifest));
  assert.throws(() => lifecycle.validateManifest(primitiveFilterManifest), /installModel must be PNP_FILTER/);

  const schema = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../src/main/input-driver-lifecycle/driver-package-manifest.schema.json'), 'utf8'));
  const installModelSchema = schema.properties.driverPackage.properties.inf.properties.installModel;
  const schemaAllowsInstallModel = (value) => (
    (!Object.hasOwn(installModelSchema, 'const') || installModelSchema.const === value)
    && (!Array.isArray(installModelSchema.enum) || installModelSchema.enum.includes(value))
  );
  assert.equal(schemaAllowsInstallModel(fixture.manifest.driverPackage.inf.installModel), true);
  assert.equal(schemaAllowsInstallModel('PRIMITIVE_FILTER'), false);
});

test('catalog membership policy is immutable by role: INF and SYS required, CAT and standalone helper not applicable', () => {
  const fixture = validFixture();
  for (const [role, wrongValue] of [['INF', 'NOT_APPLICABLE'], ['SYS', 'NOT_APPLICABLE'], ['CAT', 'REQUIRED'], ['HELPER', 'REQUIRED']]) {
    const changed = { ...fixture.manifest, files: fixture.manifest.files.map((file) => file.role === role ? { ...file, catalogMembership: wrongValue } : file) };
    assert.throws(() => lifecycle.validateManifest(changed), new RegExp(`catalogMembership must be .* for ${role}`));
  }
});

test('checked-in manifest example is deliberately invalid until legal, signing, and compatibility pins exist', () => {
  const example = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../src/main/input-driver-lifecycle/driver-package-manifest.example.json'), 'utf8'));
  assert.throws(() => lifecycle.validateManifest(example));
});

test('manifest schema mirrors the runtime requirement for exactly one file in every payload role', () => {
  const schema = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../src/main/input-driver-lifecycle/driver-package-manifest.schema.json'), 'utf8'));
  const files = schema.properties.files;
  assert.equal(files.minItems, 4);
  assert.equal(files.maxItems, 4);
  assert.deepEqual(
    files.allOf.map((constraint) => constraint.contains.properties.role.const).sort(),
    ['CAT', 'HELPER', 'INF', 'SYS'],
  );
  assert.equal(files.allOf.every((constraint) => constraint.minContains === 1 && constraint.maxContains === 1), true);
});

test('manifest schema independently rejects absolute, traversal, empty-segment, and control-character payload paths', () => {
  const schema = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../src/main/input-driver-lifecycle/driver-package-manifest.schema.json'), 'utf8'));
  const pathSchema = schema.properties.files.items.properties.path;
  const schemaAllowsPath = (value) => {
    if (typeof value !== 'string' || value.length < pathSchema.minLength || value.length > pathSchema.maxLength) return false;
    return pathSchema.allOf.every((constraint) => {
      if (constraint.pattern) return new RegExp(constraint.pattern).test(value);
      if (constraint.not?.pattern) return !new RegExp(constraint.not.pattern).test(value);
      return true;
    });
  };

  assert.equal(schemaAllowsPath('payload/fixture.inf'), true);
  assert.equal(schemaAllowsPath('payload\\fixture.inf'), true);
  for (const unsafePath of [
    '../fixture.inf',
    'payload/../fixture.inf',
    'payload/./fixture.inf',
    'C:\\payload\\fixture.inf',
    '/payload/fixture.inf',
    '\\payload\\fixture.inf',
    'payload//fixture.inf',
    'payload\\\\fixture.inf',
    'payload/',
    `payload/${String.fromCharCode(0)}fixture.inf`,
  ]) assert.equal(schemaAllowsPath(unsafePath), false, unsafePath);
});

test('status stays unavailable without both the trusted adapter and durable transaction store', async () => {
  const fixture = validFixture();
  const configuration = {
    status: 'CONFIGURED', manifestPath: 'manifest.json', manifestSha256: lifecycle.validateManifest(fixture.manifest).manifestSha256, transactionStoreIdentity: 'f'.repeat(64), cleanMachineAcceptance: 'PASSED',
    permissionEvidence: fixture.manifest.redistributionPermission.evidence,
    publisherSubject: fixture.manifest.publisher.subject,
    publisherThumbprint: fixture.manifest.publisher.thumbprint,
  };
  const withoutRuntime = await lifecycle.createInputDriverLifecycleService({ appRoot: fixture.root, configuration }).status();
  assert.deepEqual(withoutRuntime.reasons.map((entry) => entry.code), ['TRUSTED_WINDOWS_ADAPTER_REQUIRED', 'DURABLE_TRANSACTION_STORE_REQUIRED']);
});

test('service refuses an unpinned or mismatched manifest digest and an unprotected durable store', async () => {
  const fixture = validFixture();
  const adapter = createFixtureAdapter();
  const protectedStore = createDurableStore();
  const missingPin = await createConfiguredService(fixture, adapter, protectedStore, { configurationOverrides: { manifestSha256: '' } }).status();
  assert.equal(missingPin.reasons[0].code, 'MANIFEST_DIGEST_PIN_REQUIRED');
  const mismatchedPin = await createConfiguredService(fixture, adapter, protectedStore, { configurationOverrides: { manifestSha256: '0'.repeat(64) } }).status();
  assert.equal(mismatchedPin.reasons[0].code, 'PACKAGE_OR_STATE_VALIDATION_FAILED');
  const unprotectedStore = createDurableStore(null, { attested: false });
  const unprotected = await createConfiguredService(fixture, adapter, unprotectedStore).status();
  assert.equal(unprotected.reasons[0].code, 'PROTECTED_TRANSACTION_STORE_REQUIRED');
  const mismatchedStore = await createConfiguredService(fixture, adapter, createDurableStore(), { configurationOverrides: { transactionStoreIdentity: 'e'.repeat(64) } }).status();
  assert.equal(mismatchedStore.reasons[0].code, 'TRANSACTION_STORE_IDENTITY_MISMATCH');

  const kindOnlyAdapter = createFixtureAdapter({ attested: false });
  const kindOnly = await createConfiguredService(fixture, kindOnlyAdapter, protectedStore).status();
  assert.equal(kindOnly.reasons[0].code, 'TRUSTED_WINDOWS_ADAPTER_REQUIRED');
  assert.equal(lifecycle.attestSignedHelperAdapter, undefined);
});

test('packaged app, helper, catalog, embedded SYS, revocation, EKUs, INF metadata, host, and security are rechecked', async () => {
  const fixture = validFixture();
  for (const change of [
    (result) => ({ ...result, catalog: { ...result.catalog, thumbprint: 'C'.repeat(40) } }),
    (result) => ({ ...result, catalog: { ...result.catalog, revocationStatus: 'REVOKED' } }),
    (result) => ({ ...result, catalog: { ...result.catalog, ekuOids: [] } }),
    (result) => ({ ...result, catalog: { ...result.catalog, revocationCheckedAt: '2000-01-01T00:00:00.000Z' } }),
    (result) => ({ ...result, systemBinary: { ...result.systemBinary, embeddedSignature: false } }),
    (result) => ({ ...result, systemBinary: { ...result.systemBinary, fileSha256: '0'.repeat(64) } }),
    (result) => ({ ...result, systemBinary: { ...result.systemBinary, ekuOids: [] } }),
    (result) => ({ ...result, systemBinary: { ...result.systemBinary, revocationStatus: 'UNKNOWN' } }),
    (result) => ({ ...result, helper: { ...result.helper, status: 'INVALID' } }),
    (result) => ({ ...result, helper: { ...result.helper, fileSha256: '0'.repeat(64) } }),
    (result) => ({ ...result, application: { ...result.application, packaged: false } }),
    (result) => ({ ...result, application: { ...result.application, status: 'INVALID' } }),
    (result) => ({ ...result, inf: { ...result.inf, provider: 'Unexpected Provider' } }),
    (result) => ({ ...result, files: result.files.map((file, index) => index === 0 ? { ...file, catalogMember: false } : file) }),
    (result) => ({ ...result, host: { ...result.host, windowsBuild: 18000 } }),
    (result) => ({ ...result, compatibility: { ...result.compatibility, memoryIntegrity: false } }),
  ]) {
    const adapter = createFixtureAdapter({ preflightOverride: change });
    const status = await createConfiguredService(fixture, adapter, createDurableStore()).status();
    assert.equal(status.status, 'UNAVAILABLE');
    assert.equal(status.reasons[0].code, 'PACKAGE_OR_STATE_VALIDATION_FAILED');
  }
});

test('package preflight enforces role-specific catalog results and verifies CAT and helper separately', async () => {
  const fixture = validFixture();
  for (const [role, catalogMembership, catalogMember] of [
    ['INF', 'NOT_APPLICABLE', null],
    ['SYS', 'REQUIRED', false],
    ['CAT', 'REQUIRED', true],
    ['HELPER', 'NOT_APPLICABLE', true],
  ]) {
    const adapter = createFixtureAdapter({
      preflightOverride: (result) => ({
        ...result,
        files: result.files.map((file) => file.role === role ? { ...file, catalogMembership, catalogMember } : file),
      }),
    });
    const status = await createConfiguredService(fixture, adapter, createDurableStore()).status();
    assert.equal(status.status, 'UNAVAILABLE');
    assert.equal(status.reasons[0].code, 'PACKAGE_OR_STATE_VALIDATION_FAILED');
  }
});

test('install uses an opaque expiring single-use token, journals every boundary, and reconciles restart', async () => {
  const fixture = validFixture();
  const adapter = createFixtureAdapter();
  const store = createDurableStore();
  const service = createConfiguredService(fixture, adapter, store);
  const initial = await service.status(DEVICE_A);
  assert.equal(initial.status, 'READY_FOR_PREFLIGHT');
  assert.equal(initial.capabilities.install, true);
  const preview = await service.previewInstall(DEVICE_A, 8000);
  assert.deepEqual(preview.package.supportedPollingHz, [125, 250, 500, 1000, 2000, 4000, 8000]);
  assert.equal(preview.requiresRestart, true);
  assert.match(preview.token, /^[A-Za-z0-9_-]{20,80}$/);
  assert.equal(JSON.stringify(preview).includes(DEVICE_A), false);
  assert.equal(JSON.stringify(preview).includes('payload/'), false);
  const result = await service.apply(preview.token);
  assert.equal(result.status, 'RESTART_REQUIRED');
  assert.deepEqual(adapter.calls, ['installPackage', 'attachFilter']);
  assert.equal(store.writes.some((entry) => entry.operation?.phase === 'BEFORE_INSTALL_PACKAGE_1'), true);
  assert.equal(store.writes.some((entry) => entry.operation?.phase === 'BEFORE_ATTACH_FILTER_2'), true);
  await assert.rejects(() => service.apply(preview.token), (error) => error.code === 'PREVIEW_TOKEN_USED_OR_UNKNOWN');
  adapter.state.restartRequired = false;
  const reconciled = await service.reconcile(result.operationId);
  assert.equal(reconciled.status, 'ACTIVE');
  assert.equal(reconciled.ownership, 'DIALED');
  assert.equal(reconciled.managedDeviceCount, 1);
});

test('repeated concurrent status and preview reads share a non-mutating attestation head and cannot create a stale apply branch', async () => {
  const fixture = validFixture();
  const adapter = createFixtureAdapter();
  const store = createDurableStore();
  const service = createConfiguredService(fixture, adapter, store);
  const [firstStatus, secondStatus, firstPreview, secondPreview] = await Promise.all([
    service.status(DEVICE_A),
    service.status(DEVICE_B),
    service.previewInstall(DEVICE_A, 8000),
    service.previewInstall(DEVICE_B, 4000),
  ]);
  assert.equal(firstStatus.status, 'READY_FOR_PREFLIGHT');
  assert.equal(secondStatus.status, 'READY_FOR_PREFLIGHT');
  assert.equal(store.writes.length, 0);
  assert.equal(new Set(adapter.targetPreflights.map((entry) => entry.nativeCheckpointId)).size, 1);
  const applied = await service.apply(firstPreview.token);
  assert.equal(applied.status, 'RESTART_REQUIRED');
  await assert.rejects(() => service.apply(secondPreview.token), (error) => error.code === 'PREVIEW_RECORD_DRIFT');
  assert.equal(adapter.maximumConcurrentMutations, 1);
});

test('expired previews fail before any durable journal or mutation', async () => {
  const fixture = validFixture();
  const adapter = createFixtureAdapter();
  const store = createDurableStore();
  let clock = Date.now();
  const service = createConfiguredService(fixture, adapter, store, { now: () => clock, tokenTtlMs: 10 });
  const preview = await service.previewInstall(DEVICE_A, 8000);
  clock += 11;
  await assert.rejects(() => service.apply(preview.token), (error) => error.code === 'PREVIEW_TOKEN_EXPIRED');
  assert.equal(store.writes.length, 0);
  assert.equal(adapter.calls.length, 0);
});

test('issuing a new preview prunes expired token material', async () => {
  const fixture = validFixture();
  const adapter = createFixtureAdapter();
  const store = createDurableStore();
  let clock = Date.now();
  const service = createConfiguredService(fixture, adapter, store, { now: () => clock, tokenTtlMs: 10 });
  const expired = await service.previewInstall(DEVICE_A, 8000);
  clock += 11;
  const current = await service.previewInstall(DEVICE_B, 4000);
  await assert.rejects(() => service.apply(expired.token), (error) => error.code === 'PREVIEW_TOKEN_USED_OR_UNKNOWN');
  assert.match(current.token, /^[A-Za-z0-9_-]{20,80}$/);
  assert.equal(store.writes.length, 0);
});

test('elevation cancellation before the first mutation is audited as NOT_APPLIED without NEEDS_REVIEW', async () => {
  const fixture = validFixture();
  const adapter = createFixtureAdapter({ cancelElevationMethod: 'installPackage' });
  const store = createDurableStore();
  const service = createConfiguredService(fixture, adapter, store);
  const result = await service.apply((await service.previewInstall(DEVICE_A, 8000)).token);
  assert.equal(result.status, 'NOT_APPLIED');
  assert.equal(result.canceled, true);
  assert.equal(result.restartRequired, false);
  assert.equal(store.record.operation, null);
  assert.equal(store.record.review, null);
  assert.deepEqual(store.record.lastOutcome, { operationId: result.operationId, action: 'INSTALL', outcome: 'CANCELLED', recordedAt: store.record.lastOutcome.recordedAt });
  assert.equal(adapter.state.package, null);
  const relaunched = createConfiguredService(fixture, adapter, store);
  const persisted = await relaunched.status(DEVICE_A);
  assert.equal(persisted.status, 'READY_FOR_PREFLIGHT');
  assert.deepEqual(persisted.lastOutcome, { action: 'INSTALL', outcome: 'CANCELLED', recordedAt: store.record.lastOutcome.recordedAt });
  assert.equal(persisted.capabilities.install, true);
});

test('elevation cancellation after a completed mutation boundary remains fail-closed for review', async () => {
  const fixture = validFixture();
  const adapter = createFixtureAdapter({ cancelElevationMethod: 'attachFilter' });
  const store = createDurableStore();
  const service = createConfiguredService(fixture, adapter, store);
  let failure;
  try { await service.apply((await service.previewInstall(DEVICE_A, 8000)).token); } catch (error) { failure = error; }
  assert.equal(failure.code, 'DRIVER_MUTATION_FAILED');
  assert.equal(store.record.lifecycleState, 'NEEDS_REVIEW');
  assert.equal(store.record.operation.phase, 'BEFORE_ATTACH_FILTER_2');
});

test('exact drift after preview prevents mutation and queued applies never overlap', async () => {
  const fixture = validFixture();
  const adapter = createFixtureAdapter({ delayMs: 5 });
  const store = createDurableStore();
  const service = createConfiguredService(fixture, adapter, store);
  const first = await service.previewInstall(DEVICE_A, 8000);
  const second = await service.previewInstall(DEVICE_B, 4000);
  const results = await Promise.allSettled([service.apply(first.token), service.apply(second.token)]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter((result) => result.status === 'rejected').length, 1);
  assert.equal(adapter.maximumConcurrentMutations, 1);

  const driftFixture = validFixture();
  const driftAdapter = createFixtureAdapter();
  const driftStore = createDurableStore();
  const driftService = createConfiguredService(driftFixture, driftAdapter, driftStore);
  const preview = await driftService.previewInstall(DEVICE_A, 8000);
  driftAdapter.state.restartRequired = true;
  await assert.rejects(() => driftService.apply(preview.token), (error) => error.code === 'EXACT_STATE_DRIFT' || error.code === 'PREVIEW_STATE_DRIFT');
  assert.equal(driftAdapter.calls.length, 0);
});

test('signed-helper target preflight distinctly refuses unknown, disconnected, incompatible, and rate-ineligible devices', async () => {
  const cases = [
    ['known', 'TARGET_UNKNOWN'],
    ['connected', 'TARGET_DISCONNECTED'],
    ['compatible', 'TARGET_INCOMPATIBLE'],
    ['rateEligible', 'TARGET_RATE_INELIGIBLE'],
  ];
  for (const [flag, code] of cases) {
    const fixture = validFixture();
    const adapter = createFixtureAdapter({ targetState: { known: true, connected: true, compatible: true, rateEligible: true, [flag]: false } });
    const store = createDurableStore();
    const service = createConfiguredService(fixture, adapter, store);
    await assert.rejects(() => service.previewInstall(DEVICE_A, 8000), (error) => error.code === code);
    assert.equal(adapter.calls.length, 0);
    assert.equal(store.writes.length, 0);
  }
});

test('target attestation is rebound at apply and every mutation boundary', async () => {
  const fixture = validFixture();
  const applyAdapter = createFixtureAdapter();
  const applyStore = createDurableStore();
  const applyService = createConfiguredService(fixture, applyAdapter, applyStore);
  const applyPreview = await applyService.previewInstall(DEVICE_A, 8000);
  applyAdapter.targetState = { known: true, connected: false, compatible: true, rateEligible: true };
  await assert.rejects(() => applyService.apply(applyPreview.token), (error) => error.code === 'TARGET_DISCONNECTED');
  assert.equal(applyAdapter.calls.length, 0);
  assert.equal(applyStore.writes.length, 0);

  const boundaryAdapter = createFixtureAdapter({
    targetPreflightOverride: (result, _context, count) => count === 3 ? { ...result, rateEligible: false } : result,
  });
  const boundaryStore = createDurableStore();
  const boundaryService = createConfiguredService(fixture, boundaryAdapter, boundaryStore);
  const boundaryPreview = await boundaryService.previewInstall(DEVICE_A, 8000);
  await assert.rejects(() => boundaryService.apply(boundaryPreview.token), (error) => error.code === 'TARGET_RATE_INELIGIBLE');
  assert.equal(boundaryAdapter.calls.length, 0);
  assert.equal(boundaryStore.record.lifecycleState, 'NEEDS_REVIEW');
  assert.equal(boundaryStore.record.operation.phase, 'STARTED');
});

test('target preflight refuses mismatched scope, rate, checkpoint, or helper attestation without exposing native identity', async () => {
  const fixture = validFixture();
  for (const mutate of [
    (result) => ({ ...result, deviceDigest: DEVICE_B }),
    (result) => ({ ...result, requestedHz: 4000 }),
    (result) => ({ ...result, nativeCheckpointId: 'checkpoint_99999999999999999999' }),
    (result) => ({ ...result, helperAttested: false }),
  ]) {
    const adapter = createFixtureAdapter({ targetPreflightOverride: mutate });
    const service = createConfiguredService(fixture, adapter, createDurableStore());
    let failure;
    try { await service.previewInstall(DEVICE_A, 8000); } catch (error) { failure = error; }
    assert.equal(failure.code, 'TARGET_PREFLIGHT_ATTESTATION_INVALID');
    assert.equal(`${failure.code} ${failure.message}`.includes(DEVICE_A), false);
    assert.equal(`${failure.code} ${failure.message}`.includes(DEVICE_B), false);
  }
});

test('incomplete present, non-present, or phantom inventory blocks install, maintenance, and removal', async () => {
  const fixture = validFixture();
  const adapter = createFixtureAdapter({ inventory: { presentComplete: true, nonPresentComplete: false, phantomComplete: true } });
  const service = createConfiguredService(fixture, adapter, createDurableStore());
  assert.equal((await service.status()).status, 'NEEDS_REVIEW');
  await assert.rejects(() => service.previewInstall(DEVICE_A, 8000), (error) => error.code === 'ATTACHMENT_INVENTORY_INCOMPLETE');

  const maintenanceAdapter = createFixtureAdapter();
  const maintenanceStore = createDurableStore();
  const maintenanceService = createConfiguredService(fixture, maintenanceAdapter, maintenanceStore);
  await installFixture(maintenanceService, maintenanceAdapter);
  maintenanceAdapter.state.inventory.phantomComplete = false;
  await assert.rejects(() => maintenanceService.previewRepair(DEVICE_A), (error) => error.code === 'ATTACHMENT_INVENTORY_INCOMPLETE');

  maintenanceAdapter.state.inventory.phantomComplete = true;
  await maintenanceService.apply((await maintenanceService.previewDetach(DEVICE_A)).token);
  maintenanceAdapter.state.inventory.presentComplete = false;
  await assert.rejects(() => maintenanceService.previewRemovePackage(), (error) => error.code === 'ATTACHMENT_INVENTORY_INCOMPLETE');
});

test('a real phantom attachment is part of exact state and blocks maintenance without mutation', async () => {
  const fixture = validFixture();
  const adapter = createFixtureAdapter();
  const store = createDurableStore();
  const service = createConfiguredService(fixture, adapter, store);
  await installFixture(service, adapter);
  const callsBeforeFault = [...adapter.calls];
  adapter.state.attachments.push({ deviceDigest: DEVICE_B, requestedHz: 1000, presence: 'PHANTOM' });
  const status = await service.status();
  assert.equal(status.status, 'NEEDS_REVIEW');
  assert.equal(status.reasons[0].code, 'EXACT_STATE_DRIFT');
  await assert.rejects(() => service.previewRepair(DEVICE_A), (error) => error.code === 'EXACT_STATE_DRIFT');
  await assert.rejects(() => service.previewRemovePackage(), (error) => ['EXACT_STATE_DRIFT', 'FILTER_DETACH_REQUIRED'].includes(error.code));
  assert.deepEqual(adapter.calls, callsBeforeFault);
});

test('native checkpoint schema, journal identity, freshness, and chain are fail-closed', async () => {
  const fixture = validFixture();
  for (const mutate of [
    (checkpoint) => ({ ...checkpoint, kind: 'RECOVERY_CHECKPOINT' }),
    (checkpoint) => ({ ...checkpoint, preimageBindingsSha256: '0'.repeat(64) }),
    (checkpoint) => ({ ...checkpoint, journalIdentity: 'e'.repeat(64) }),
    (checkpoint) => ({ ...checkpoint, sealedAt: '2000-01-01T00:00:00.000Z' }),
    (checkpoint) => ({ ...checkpoint, helperAttested: false }),
  ]) {
    const adapter = createFixtureAdapter({ observeOverride: (result) => ({ ...result, nativeCheckpoint: mutate(result.nativeCheckpoint) }) });
    const status = await createConfiguredService(fixture, adapter, createDurableStore()).status();
    assert.equal(status.status, 'NEEDS_REVIEW');
    assert.equal(status.reasons[0].code, 'OBSERVATION_FAILED');
  }

  const chainAdapter = createFixtureAdapter();
  const chainStore = createDurableStore();
  const chainService = createConfiguredService(fixture, chainAdapter, chainStore);
  const preview = await chainService.previewInstall(DEVICE_A, 8000);
  chainAdapter.observeOverride = (result, context) => context.checkpointRequest.extendJournal ? { ...result, nativeCheckpoint: { ...result.nativeCheckpoint, previousId: 'checkpoint_99999999999999999999' } } : result;
  await assert.rejects(() => chainService.apply(preview.token), (error) => error.code === 'NATIVE_CHECKPOINT_CHAIN_INVALID');
  assert.equal(chainAdapter.calls.length, 0);
  assert.equal(chainStore.writes.length, 0);
});

test('fresh opaque recovery checkpoints are durably recorded before every mutation and sealed again after', async () => {
  const fixture = validFixture();
  const adapter = createFixtureAdapter();
  const store = createDurableStore();
  const service = createConfiguredService(fixture, adapter, store);
  await service.apply((await service.previewInstall(DEVICE_A, 8000)).token);
  const beforeWrites = store.writes.filter((entry) => /^BEFORE_/.test(entry.operation?.phase || ''));
  const afterWrites = store.writes.filter((entry) => /^AFTER_/.test(entry.operation?.phase || ''));
  assert.equal(beforeWrites.length, 2);
  assert.equal(afterWrites.length, 2);
  for (const entry of [...beforeWrites, ...afterWrites]) {
    assert.equal(entry.expected.nativeCheckpoint.kind, 'RECOVERY_CHECKPOINT');
    assert.equal(entry.expected.nativeCheckpoint.preimageSchema, 'DIALED_NATIVE_PREIMAGE_V1');
    assert.equal(entry.expected.nativeCheckpoint.preimageBindingsSha256, NATIVE_PREIMAGE_BINDINGS_SHA256);
    assert.equal(entry.expected.nativeCheckpoint.helperAttested, true);
  }
  for (const entry of beforeWrites) assert.equal(entry.expected.nativeCheckpoint.operationId, entry.operation.id);
  assert.equal(beforeWrites[0].expected.package, null);
  assert.equal(beforeWrites[1].expected.package.version, '2.0.0');
});

test('externally installed packages require explicit adoption and remain protected from package mutation', async () => {
  const fixture = validFixture();
  const adapter = createFixtureAdapter({ package: identityFor(fixture.manifest), attachments: [{ deviceDigest: DEVICE_A, requestedHz: 8000 }] });
  const store = createDurableStore();
  const service = createConfiguredService(fixture, adapter, store);
  const detected = await service.status(DEVICE_A);
  assert.equal(detected.status, 'EXTERNAL_PACKAGE_PRESENT');
  assert.equal(detected.capabilities.adopt, true);
  await assert.rejects(() => service.previewInstall(DEVICE_B, 4000), (error) => error.code === 'EXPLICIT_ADOPTION_REQUIRED');
  const adopted = await service.apply((await service.previewAdoption(DEVICE_A, 8000)).token);
  assert.equal(adopted.action, 'ADOPT');
  assert.equal((await service.status(DEVICE_A)).ownership, 'ADOPTED');
  await assert.rejects(() => service.previewRepair(DEVICE_A), (error) => error.code === 'EXTERNAL_PACKAGE_PROTECTED');
  await assert.rejects(() => service.previewUpgrade(), (error) => error.code === 'EXTERNAL_PACKAGE_PROTECTED');
  await assert.rejects(() => service.previewRemovePackage(), (error) => error.code === 'EXTERNAL_PACKAGE_PROTECTED');
  const detached = await service.apply((await service.previewDetach(DEVICE_A)).token);
  assert.equal(detached.status, 'FILTER_DETACHED');
  assert.deepEqual(adapter.calls, ['detachFilter']);
});

test('Dialed-owned package removal is impossible until every managed filter is detached', async () => {
  const fixture = validFixture();
  const adapter = createFixtureAdapter();
  const store = createDurableStore();
  const service = createConfiguredService(fixture, adapter, store);
  await installFixture(service, adapter);
  await assert.rejects(() => service.previewRemovePackage(), (error) => error.code === 'FILTER_DETACH_REQUIRED');
  const detachPreview = await service.previewDetach(DEVICE_A);
  assert.equal(detachPreview.requiresRestart, true);
  const detached = await service.apply(detachPreview.token);
  assert.equal(detached.status, 'FILTER_DETACHED');
  const removePreview = await service.previewRemovePackage();
  assert.equal(removePreview.requiresRestart, true);
  const removed = await service.apply(removePreview.token);
  assert.equal(removed.status, 'REMOVED');
  assert.deepEqual(adapter.calls.slice(-2), ['detachFilter', 'removePackage']);
  assert.equal(store.record.ownership, null);
});

test('repair detaches all exact Dialed scopes, repairs, restores requests, and refuses unmanaged scope', async () => {
  const fixture = validFixture();
  const adapter = createFixtureAdapter();
  const store = createDurableStore();
  const service = createConfiguredService(fixture, adapter, store);
  await installFixture(service, adapter);
  const repaired = await service.apply((await service.previewRepair(DEVICE_A)).token);
  assert.equal(repaired.status, 'RESTART_REQUIRED');
  assert.deepEqual(adapter.calls.slice(-3), ['detachFilter', 'repairPackage', 'attachFilter']);

  adapter.state.restartRequired = false;
  await service.reconcile(repaired.operationId);
  adapter.state.attachments.push({ deviceDigest: DEVICE_B, requestedHz: 1000, presence: 'NON_PRESENT' });
  await assert.rejects(() => service.previewRepair(DEVICE_A), (error) => error.code === 'EXACT_STATE_DRIFT' || error.code === 'UNMANAGED_ATTACHMENTS_PRESENT');
});

async function mutationBoundaryFixture(boundary) {
  const fixture = validFixture(boundary === 'upgradePackage' ? '1.0.0' : '2.0.0');
  const adapter = createFixtureAdapter();
  const store = createDurableStore();
  let service = createConfiguredService(fixture, adapter, store);
  if (['detachFilter', 'repairPackage', 'removePackage', 'upgradePackage'].includes(boundary)) await installFixture(service, adapter);
  if (boundary === 'removePackage') await service.apply((await service.previewDetach(DEVICE_A)).token);
  if (boundary === 'upgradePackage') {
    const next = validFixture('2.0.0', [store.record.ownership.package]);
    fs.copyFileSync(path.join(next.root, 'manifest.json'), path.join(fixture.root, 'manifest.json'));
    fs.rmSync(path.join(fixture.root, 'payload'), { recursive: true });
    fs.cpSync(path.join(next.root, 'payload'), path.join(fixture.root, 'payload'), { recursive: true });
    fixture.manifest = next.manifest;
    service = createConfiguredService(fixture, adapter, store);
  }
  const previewFactory = boundary === 'removePackage' ? () => service.previewRemovePackage()
    : boundary === 'upgradePackage' ? () => service.previewUpgrade()
      : ['detachFilter', 'repairPackage'].includes(boundary) ? () => service.previewRepair(DEVICE_A)
        : () => service.previewInstall(DEVICE_A, 8000);
  return { adapter, store, service, previewFactory };
}

for (const boundary of ['installPackage', 'attachFilter', 'detachFilter', 'repairPackage', 'removePackage', 'upgradePackage']) {
  test(`mutation fault at ${boundary} leaves a durable NEEDS_REVIEW record and cannot auto-resume`, async () => {
    const { adapter, store, service, previewFactory } = await mutationBoundaryFixture(boundary);
    adapter.faultMethod = boundary;
    const preview = await previewFactory();
    let failure;
    try { await service.apply(preview.token); } catch (error) { failure = error; }
    assert.equal(failure?.code, 'DRIVER_MUTATION_FAILED');
    assert.equal(store.record.lifecycleState, 'NEEDS_REVIEW');
    assert.equal(store.record.operation.id, failure.operationId);
    assert.equal((await service.status()).status, 'NEEDS_REVIEW');
    assert.equal((await service.reconcile(failure.operationId)).status, 'NEEDS_REVIEW');
  });
}

test('a helper error after Windows mutation preserves the fresh preimage and requires exact review', async () => {
  const fixture = validFixture();
  const adapter = createFixtureAdapter({ faultAfterMutationMethod: 'installPackage' });
  const store = createDurableStore();
  const service = createConfiguredService(fixture, adapter, store);
  let failure;
  try { await service.apply((await service.previewInstall(DEVICE_A, 8000)).token); } catch (error) { failure = error; }
  assert.equal(failure.code, 'DRIVER_MUTATION_FAILED');
  assert.equal(adapter.state.package.version, '2.0.0');
  assert.equal(store.record.lifecycleState, 'NEEDS_REVIEW');
  assert.equal(store.record.operation.phase, 'BEFORE_INSTALL_PACKAGE_1');
  assert.equal(store.record.expected.package, null);
  assert.equal(store.record.expected.nativeCheckpoint.kind, 'RECOVERY_CHECKPOINT');
});

test('wrong or incomplete post-mutation observations never commit success', async () => {
  for (const [kind, observeOverride, expectedCode] of [
    ['wrong effect', (result, context) => context.checkpointRequest.purpose === 'AFTER_INSTALLPACKAGE' ? { ...result, package: null } : result, 'POST_MUTATION_VERIFICATION_FAILED'],
    ['incomplete inventory', (result, context) => context.checkpointRequest.purpose === 'AFTER_INSTALLPACKAGE' ? { ...result, inventory: { ...result.inventory, phantomComplete: false } } : result, 'ATTACHMENT_INVENTORY_INCOMPLETE'],
    ['changed boot contract', (result, context) => context.checkpointRequest.purpose === 'AFTER_INSTALLPACKAGE' ? { ...result, nativeCheckpoint: { ...result.nativeCheckpoint, bootId: hash('unexpected-boot') } } : result, 'POST_MUTATION_VERIFICATION_FAILED'],
  ]) {
    const fixture = validFixture();
    const adapter = createFixtureAdapter({ observeOverride });
    const store = createDurableStore();
    const service = createConfiguredService(fixture, adapter, store);
    let failure;
    try { await service.apply((await service.previewInstall(DEVICE_A, 8000)).token); } catch (error) { failure = error; }
    assert.equal(failure.code, expectedCode, kind);
    assert.equal(store.record.lifecycleState, 'NEEDS_REVIEW', kind);
    assert.equal(store.record.operation.phase, 'BEFORE_INSTALL_PACKAGE_1', kind);
    assert.equal(adapter.calls.includes('attachFilter'), false, kind);
  }
});

test('install rejects a collateral phantom attachment and never records success', async () => {
  const fixture = validFixture();
  const adapter = createFixtureAdapter({
    postMutationHook: (method, state) => {
      if (method === 'installPackage') state.attachments.push({ deviceDigest: DEVICE_B, requestedHz: 1000, presence: 'PHANTOM' });
    },
  });
  const store = createDurableStore();
  const service = createConfiguredService(fixture, adapter, store);
  let failure;
  try { await service.apply((await service.previewInstall(DEVICE_A, 8000)).token); } catch (error) { failure = error; }
  assert.equal(failure.code, 'POST_MUTATION_VERIFICATION_FAILED');
  assert.equal(store.record.lifecycleState, 'NEEDS_REVIEW');
  assert.equal(store.record.operation.phase, 'BEFORE_INSTALL_PACKAGE_1');
  assert.notEqual(store.record.lastOperationId, failure.operationId);
  assert.deepEqual(adapter.calls, ['installPackage']);
});

test('attach rejects removal of another attachment and preserves no false success', async () => {
  const fixture = validFixture();
  const adapter = createFixtureAdapter();
  const store = createDurableStore();
  const service = createConfiguredService(fixture, adapter, store);
  await installFixture(service, adapter, DEVICE_A, 8000);
  adapter.postMutationHook = (method, state, context) => {
    if (method === 'attachFilter' && context.target.deviceDigest === DEVICE_B) state.attachments = state.attachments.filter((entry) => entry.deviceDigest !== DEVICE_A);
  };
  let failure;
  try { await service.apply((await service.previewInstall(DEVICE_B, 4000)).token); } catch (error) { failure = error; }
  assert.equal(failure.code, 'POST_MUTATION_VERIFICATION_FAILED');
  assert.equal(store.record.lifecycleState, 'NEEDS_REVIEW');
  assert.equal(store.record.operation.phase, 'BEFORE_ATTACH_FILTER_1');
  assert.equal(adapter.state.attachments.some((entry) => entry.deviceDigest === DEVICE_A), false);
  assert.equal(adapter.state.attachments.some((entry) => entry.deviceDigest === DEVICE_B), true);
});

test('detach rejects another target rate or presence change before repair can continue', async () => {
  const fixture = validFixture();
  const adapter = createFixtureAdapter();
  const store = createDurableStore();
  const service = createConfiguredService(fixture, adapter, store);
  await installFixture(service, adapter, DEVICE_A, 8000);
  const attached = await service.apply((await service.previewInstall(DEVICE_B, 4000)).token);
  adapter.state.restartRequired = false;
  await service.reconcile(attached.operationId);
  adapter.postMutationHook = (method, state, context) => {
    if (method === 'detachFilter' && context.target.deviceDigest === DEVICE_A) {
      state.attachments = state.attachments.map((entry) => entry.deviceDigest === DEVICE_B ? { ...entry, requestedHz: 500, presence: 'PHANTOM' } : entry);
    }
  };
  let failure;
  try { await service.apply((await service.previewRepair(DEVICE_A)).token); } catch (error) { failure = error; }
  assert.equal(failure.code, 'POST_MUTATION_VERIFICATION_FAILED');
  assert.equal(store.record.lifecycleState, 'NEEDS_REVIEW');
  assert.equal(store.record.operation.phase, 'BEFORE_DETACH_FILTER_1');
  assert.equal(adapter.calls.includes('repairPackage'), false);
  assert.deepEqual(adapter.state.attachments, [{ deviceDigest: DEVICE_B, requestedHz: 500, presence: 'PHANTOM' }]);
});

test('package-null observations with any attachment are refused before preview or mutation', async () => {
  const fixture = validFixture();
  const adapter = createFixtureAdapter({ attachments: [{ deviceDigest: DEVICE_A, requestedHz: 8000, presence: 'PHANTOM' }] });
  const store = createDurableStore();
  const service = createConfiguredService(fixture, adapter, store);
  const status = await service.status();
  assert.equal(status.status, 'NEEDS_REVIEW');
  assert.equal(status.reasons[0].code, 'OBSERVATION_FAILED');
  await assert.rejects(() => service.previewInstall(DEVICE_A, 8000), (error) => error.code === 'INCONSISTENT_NATIVE_STATE');
  assert.equal(adapter.calls.length, 0);
  assert.equal(store.writes.length, 0);
});

const journalFaultCases = [
  { name: 'STARTED', match: (next) => next.operation?.phase === 'STARTED', calls: [], review: false },
  { name: 'BEFORE_INSTALL', match: (next) => next.operation?.phase === 'BEFORE_INSTALL_PACKAGE_1', calls: [], review: true },
  { name: 'AFTER_INSTALL', match: (next) => next.operation?.phase === 'AFTER_INSTALL_PACKAGE_1', calls: ['installPackage'], review: true },
  { name: 'BEFORE_ATTACH', match: (next) => next.operation?.phase === 'BEFORE_ATTACH_FILTER_2', calls: ['installPackage'], review: true },
  { name: 'AFTER_ATTACH', match: (next) => next.operation?.phase === 'AFTER_ATTACH_FILTER_2', calls: ['installPackage', 'attachFilter'], review: true },
  { name: 'FINAL', match: (next) => next.operation === null && next.lastOutcome?.outcome === 'APPLIED', calls: ['installPackage', 'attachFilter'], review: true },
];

for (const fault of journalFaultCases) {
  test(`journal write failure at ${fault.name} never crosses an unjournaled mutation boundary`, async () => {
    const fixture = validFixture();
    const adapter = createFixtureAdapter();
    const store = createDurableStore(null, { failWrite: fault.match });
    const service = createConfiguredService(fixture, adapter, store);
    let failure;
    try { await service.apply((await service.previewInstall(DEVICE_A, 8000)).token); } catch (error) { failure = error; }
    assert.equal(failure.code, 'OPERATION_FAILED');
    assert.deepEqual(adapter.calls, fault.calls);
    if (fault.review) {
      assert.equal(store.record.lifecycleState, 'NEEDS_REVIEW');
      assert.equal(store.record.review.code, 'OPERATION_FAILED');
    } else {
      assert.equal(store.record, null);
      assert.equal((await service.status()).status, 'READY_FOR_PREFLIGHT');
    }
  });
}

test('upgrade moves only a Dialed-owned exact package and preserves managed requests', async () => {
  const fixture = validFixture('1.0.0');
  const adapter = createFixtureAdapter();
  const store = createDurableStore();
  let service = createConfiguredService(fixture, adapter, store);
  await installFixture(service, adapter);
  const next = validFixture('2.0.0', [store.record.ownership.package]);
  fs.copyFileSync(path.join(next.root, 'manifest.json'), path.join(fixture.root, 'manifest.json'));
  fs.rmSync(path.join(fixture.root, 'payload'), { recursive: true });
  fs.cpSync(path.join(next.root, 'payload'), path.join(fixture.root, 'payload'), { recursive: true });
  fixture.manifest = next.manifest;
  service = createConfiguredService(fixture, adapter, store);
  const upgraded = await service.apply((await service.previewUpgrade()).token);
  assert.equal(upgraded.status, 'RESTART_REQUIRED');
  assert.deepEqual(adapter.calls.slice(-3), ['detachFilter', 'upgradePackage', 'attachFilter']);
  assert.equal(store.record.ownership.package.version, '2.0.0');
  assert.deepEqual(store.record.ownership.managedTargets, [{ deviceDigest: DEVICE_A, requestedHz: 8000 }]);
});

test('upgrade refuses an installed package absent from the exact predecessor allowlist', async () => {
  const fixture = validFixture('1.0.0');
  const adapter = createFixtureAdapter();
  const store = createDurableStore();
  let service = createConfiguredService(fixture, adapter, store);
  await installFixture(service, adapter);
  const next = validFixture('2.0.0');
  fs.copyFileSync(path.join(next.root, 'manifest.json'), path.join(fixture.root, 'manifest.json'));
  fs.rmSync(path.join(fixture.root, 'payload'), { recursive: true });
  fs.cpSync(path.join(next.root, 'payload'), path.join(fixture.root, 'payload'), { recursive: true });
  fixture.manifest = next.manifest;
  service = createConfiguredService(fixture, adapter, store);
  await assert.rejects(() => service.previewUpgrade(), (error) => error.code === 'UPGRADE_PREDECESSOR_NOT_ALLOWED');
  assert.equal(adapter.calls.includes('upgradePackage'), false);
});

test('exact state comparison is order-stable and reports fields without exposing values', () => {
  const expected = { package: { version: '1' }, attachments: [{ deviceDigest: DEVICE_A, requestedHz: 8000 }], restartRequired: false };
  assert.equal(lifecycle.compareExactState(expected, structuredClone(expected)).matches, true);
  const drift = lifecycle.compareExactState(expected, { ...expected, restartRequired: true });
  assert.equal(drift.matches, false);
  assert.deepEqual(drift.differences, ['restartRequired']);
  assert.equal(JSON.stringify(drift).includes(DEVICE_A), false);
});

test('all public status, preview, apply, reconcile, and error surfaces redact native state and device scope', async () => {
  const fixture = validFixture();
  const adapter = createFixtureAdapter();
  const store = createDurableStore();
  const service = createConfiguredService(fixture, adapter, store);
  const status = await service.status(DEVICE_A);
  const preview = await service.previewInstall(DEVICE_A, 8000);
  const applied = await service.apply(preview.token);
  adapter.state.restartRequired = false;
  const reconciled = await service.reconcile(applied.operationId);
  let publicError;
  try { await service.apply(preview.token); } catch (error) { publicError = { code: error.code, message: error.message, operationId: error.operationId || null }; }
  const unavailable = await lifecycle.createInputDriverLifecycleService({ configuration: {} }).status();
  const forbidden = [
    DEVICE_A, DEVICE_B, STORE_IDENTITY, 'checkpoint_', 'DIALED_NATIVE_PREIMAGE_V1', NATIVE_PREIMAGE_BINDINGS_SHA256,
    'DialedFixtureFilter', '\\SystemRoot', 'payload/fixture', fixture.root,
  ];
  for (const [label, value] of Object.entries({ status, preview, applied, reconciled, publicError, unavailable })) {
    const serialized = JSON.stringify(value);
    for (const secret of forbidden) assert.equal(serialized.includes(secret), false, `${label} leaked ${secret}`);
    assert.doesNotMatch(serialized, /nativeCheckpoint|journalIdentity|bootId|serviceName|oemInf|imagePath|helperCommand/i, label);
  }
});

test('fixture file store uses process-local revision compare-and-swap but can never satisfy the production protection gate', async () => {
  const root = tempDir('dialed-driver-store-');
  const uncontracted = lifecycle.createFileTransactionStore(path.join(root, 'uncontracted.json'));
  assert.equal(uncontracted.contract, null);
  const claimedProtection = { kind: lifecycle.STORE_CONTRACT_KIND, protectedMachineDirectory: true, crossProcessCas: true, appendOnlyJournal: true, identity: 'e'.repeat(64) };
  const store = lifecycle.createFileTransactionStore({ filePath: path.join(root, 'state.json'), protectionContract: claimedProtection });
  assert.equal(store.contract, null);
  assert.equal(store.productionEligible, false);
  assert.equal(lifecycle.attestProtectedHelperStore, undefined);
  const fixture = validFixture();
  const gated = await createConfiguredService(fixture, createFixtureAdapter(), store).status();
  assert.equal(gated.status, 'UNAVAILABLE');
  assert.equal(gated.reasons[0].code, 'PROTECTED_TRANSACTION_STORE_REQUIRED');
  const record = { storeSchemaVersion: '2.0.0', revision: 1, lifecycleState: 'READY_FOR_PREFLIGHT', ownership: null, expected: null, operation: null, lastOperationId: null, lastOutcome: null, review: null, updatedAt: new Date().toISOString() };
  await store.write(record, 0);
  assert.deepEqual(await store.read(), record);
  await assert.rejects(() => store.write({ ...record, revision: 2 }, 0), (error) => error.code === 'TRANSACTION_CONFLICT');
});

test('lifecycle state order is explicit and invalid jumps are refused', () => {
  assert.equal(lifecycle.transitionLifecycle('READY_FOR_PREFLIGHT', 'PREVIEW_INSTALL'), 'INSTALL_PREVIEWED');
  assert.equal(lifecycle.transitionLifecycle('FILTER_DETACHED', 'PREVIEW_REMOVE_PACKAGE'), 'PACKAGE_REMOVAL_PREVIEWED');
  assert.equal(lifecycle.transitionLifecycle('PACKAGE_REMOVAL_PREVIEWED', 'REMOVE_PACKAGE'), 'REMOVING_PACKAGE');
  assert.equal(lifecycle.transitionLifecycle('REMOVING_PACKAGE', 'REMOVED'), 'REMOVED');
  assert.throws(() => lifecycle.transitionLifecycle('READY_FOR_PREFLIGHT', 'REMOVE_PACKAGE'), /not allowed/);
});

test('lifecycle ships no driver payload, generic process bridge, or security-policy bypass', () => {
  const directory = path.resolve(__dirname, '../src/main/input-driver-lifecycle');
  const files = fs.readdirSync(directory);
  assert.equal(files.some((file) => /\.(sys|inf|cat)$/i.test(file)), false);
  const source = fs.readFileSync(path.join(directory, 'index.cjs'), 'utf8');
  assert.doesNotMatch(source, /child_process|execFile|spawn\s*\(/i);
  for (const forbidden of ['bcdedit', 'Set-MpPreference', 'Disable-MMAgent', 'sc.exe']) assert.doesNotMatch(source, new RegExp(forbidden, 'i'));
});
