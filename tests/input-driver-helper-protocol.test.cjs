const assert = require('node:assert/strict');
const test = require('node:test');

const {
  HELPER_ALLOWED_DELTA,
  HELPER_OPERATIONS,
  HELPER_PROTOCOL_VERSION,
  HelperProtocolError,
  MUTATING_HELPER_OPERATIONS,
  createDeterministicHelper,
  createHelperSession,
  planDigest,
  sealPreimage,
  validateHelperRequest,
} = require('../src/main/input-driver-lifecycle/helper-protocol.cjs');

const CALLER = Object.freeze({ packageId: 'dialed-input-helper', publisherThumbprint: 'A'.repeat(40) });
const DEVICE_A = 'a'.repeat(64);
const DEVICE_B = 'b'.repeat(64);
const PHANTOM = 'c'.repeat(64);
const PACKAGE_SHA = 'd'.repeat(64);
const NEXT_PACKAGE_SHA = 'e'.repeat(64);

function plan(operation, overrides = {}) {
  return { operation, deviceDigest: null, requestedHz: null, packageSha256: null, restartExpected: false, ...overrides };
}

function attachment(deviceDigest, overrides = {}) {
  return {
    deviceDigest,
    presence: 'PRESENT',
    lowerFilters: [],
    requestedHz: null,
    dialedManaged: false,
    compatible: true,
    ...overrides,
  };
}

function assertRefused(fn, expectedCode) {
  assert.throws(fn, (error) => {
    assert.ok(error instanceof HelperProtocolError, `Expected a HelperProtocolError, received ${error}`);
    assert.equal(error.code, expectedCode, `Expected ${expectedCode}, received ${error.code}: ${error.message}`);
    return true;
  });
}

function harness(options = {}) {
  const session = createHelperSession({ callerIdentity: CALLER });
  const helper = createDeterministicHelper({
    callerIdentity: CALLER,
    reviewedPackages: [
      { sha256: PACKAGE_SHA, serviceName: 'hidusbf', oemInfName: 'oem42.inf' },
      { sha256: NEXT_PACKAGE_SHA, serviceName: 'hidusbf', oemInfName: 'oem43.inf' },
    ],
    ...options,
  });

  function call(operation, planOverrides = {}, payload = {}) {
    const request = session.issueRequest(operation, plan(operation, planOverrides), payload);
    return session.consumeResponse(helper.handle(request));
  }

  function seal() {
    return call('EXTEND_RECOVERY_CHECKPOINT').preimageDigest;
  }

  function mutate(operation, planOverrides, payload) {
    return call(operation, planOverrides, { preimageDigest: seal(), ...payload });
  }

  return { session, helper, call, seal, mutate };
}

function installedHarness(options = {}) {
  return harness({
    initialPackage: { present: true, binarySha256: PACKAGE_SHA, serviceName: 'hidusbf', oemInfName: 'oem42.inf', installedByDialed: true, signatureValid: true },
    initialAttachments: [attachment(DEVICE_A), attachment(DEVICE_B)],
    ...options,
  });
}

test('the protocol exposes one closed operation set with one allowed delta each', () => {
  assert.equal(HELPER_PROTOCOL_VERSION, '1.0.0');
  assert.equal(HELPER_OPERATIONS.length, 11);
  assert.deepEqual(Object.keys(HELPER_ALLOWED_DELTA).sort(), [...HELPER_OPERATIONS].sort());
  for (const operation of MUTATING_HELPER_OPERATIONS) assert.ok(HELPER_OPERATIONS.includes(operation));
  assert.equal(MUTATING_HELPER_OPERATIONS.includes('OBSERVE_STATE'), false);
  assert.equal(MUTATING_HELPER_OPERATIONS.includes('ADOPT_PACKAGE'), false);
});

test('the protocol carries no command, path, service or registry field a caller can set', () => {
  const session = createHelperSession({ callerIdentity: CALLER });
  const request = session.issueRequest('OBSERVE_STATE', plan('OBSERVE_STATE'));

  assert.deepEqual(Object.keys(request).sort(), ['callerIdentity', 'issuedAtMs', 'nonce', 'operation', 'payload', 'plan', 'planDigest', 'protocolVersion']);
  const serialized = JSON.stringify(request).toLowerCase();
  for (const forbidden of ['powershell', 'cmd.exe', 'hklm', 'reg add', 'sc create', 'pnputil', 'system32']) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
});

test('a nonce is single use and bound to its exact operation and reviewed plan', () => {
  const { session, helper } = harness();
  const request = session.issueRequest('OBSERVE_STATE', plan('OBSERVE_STATE'));
  const response = helper.handle(request);

  assert.doesNotThrow(() => session.consumeResponse(response));
  assert.throws(() => session.consumeResponse(response), /UNKNOWN_OR_REPLAYED_NONCE|answered it twice/);

  const second = session.issueRequest('OBSERVE_STATE', plan('OBSERVE_STATE'));
  assert.throws(() => session.consumeResponse({ ...helper.handle(second), operation: 'PREFLIGHT_PACKAGE' }), /different operation/);

  const third = session.issueRequest('OBSERVE_STATE', plan('OBSERVE_STATE'));
  assert.throws(() => session.consumeResponse({ ...helper.handle(third), planDigest: '0'.repeat(64) }), /different reviewed plan/);
});

test('the helper consumes a request nonce before dispatch and rejects a replay', () => {
  const { session, helper } = harness();
  const request = session.issueRequest('OBSERVE_STATE', plan('OBSERVE_STATE'));

  assert.equal(helper.handle(request).ok, true);
  const replay = helper.handle(request);
  assert.equal(replay.ok, false);
  assert.equal(replay.error.code, 'NONCE_REPLAYED');
});

test('the helper rejects stale and implausibly future-dated requests', () => {
  let callerNow = 1_000_000;
  let helperNow = callerNow;
  const session = createHelperSession({ callerIdentity: CALLER, now: () => callerNow });
  const helper = createDeterministicHelper({ callerIdentity: CALLER, now: () => helperNow, nonceTtlMs: 1_000 });

  const stale = session.issueRequest('OBSERVE_STATE', plan('OBSERVE_STATE'));
  helperNow += 1_001;
  assert.equal(helper.handle(stale).error.code, 'REQUEST_EXPIRED');

  helperNow = 2_000_000;
  callerNow = helperNow + 60_000;
  const future = session.issueRequest('OBSERVE_STATE', plan('OBSERVE_STATE'));
  assert.equal(helper.handle(future).error.code, 'REQUEST_EXPIRED');
});

test('operation payloads are exact and cannot re-aim a reviewed plan', () => {
  const session = createHelperSession({ callerIdentity: CALLER });

  assertRefused(
    () => session.issueRequest('OBSERVE_STATE', plan('OBSERVE_STATE'), { command: 'cmd.exe', registryPath: 'HKLM\\Software' }),
    'MALFORMED_MESSAGE',
  );
  assertRefused(
    () => session.issueRequest(
      'ATTACH_SELECTED_DEVICE',
      plan('ATTACH_SELECTED_DEVICE', { deviceDigest: DEVICE_A, requestedHz: 1000, packageSha256: PACKAGE_SHA }),
      { preimageDigest: 'f'.repeat(64), deviceDigest: DEVICE_B, requestedHz: 8000 },
    ),
    'PLAN_PAYLOAD_MISMATCH',
  );
});

test('the helper independently rejects a payload or plan changed after caller review', () => {
  const { session, helper, seal } = installedHarness();
  const reviewedPlan = plan('ATTACH_SELECTED_DEVICE', { deviceDigest: DEVICE_A, requestedHz: 1000, packageSha256: PACKAGE_SHA });
  const payloadTamper = JSON.parse(JSON.stringify(session.issueRequest(
    'ATTACH_SELECTED_DEVICE',
    reviewedPlan,
    { preimageDigest: seal(), deviceDigest: DEVICE_A, requestedHz: 1000 },
  )));
  payloadTamper.payload.deviceDigest = DEVICE_B;
  assert.equal(helper.handle(payloadTamper).error.code, 'PLAN_PAYLOAD_MISMATCH');

  const planTamper = JSON.parse(JSON.stringify(session.issueRequest(
    'ATTACH_SELECTED_DEVICE',
    reviewedPlan,
    { preimageDigest: seal(), deviceDigest: DEVICE_A, requestedHz: 1000 },
  )));
  planTamper.plan.deviceDigest = DEVICE_B;
  planTamper.payload.deviceDigest = DEVICE_B;
  assert.equal(helper.handle(planTamper).error.code, 'PLAN_DIGEST_MISMATCH');
  assert.equal(helper.snapshot().attachments.find((entry) => entry.deviceDigest === DEVICE_A).dialedManaged, false);
});

test('a plan digest changes with the device, the rate and the package', () => {
  const base = planDigest(plan('ATTACH_SELECTED_DEVICE', { deviceDigest: DEVICE_A, requestedHz: 1000, packageSha256: PACKAGE_SHA }));
  const otherDevice = planDigest(plan('ATTACH_SELECTED_DEVICE', { deviceDigest: DEVICE_B, requestedHz: 1000, packageSha256: PACKAGE_SHA }));
  const otherRate = planDigest(plan('ATTACH_SELECTED_DEVICE', { deviceDigest: DEVICE_A, requestedHz: 500, packageSha256: PACKAGE_SHA }));
  const otherPackage = planDigest(plan('ATTACH_SELECTED_DEVICE', { deviceDigest: DEVICE_A, requestedHz: 1000, packageSha256: NEXT_PACKAGE_SHA }));

  assert.equal(new Set([base, otherDevice, otherRate, otherPackage]).size, 4);
  assert.throws(() => planDigest(plan('NOT_AN_OPERATION')), /not a supported helper operation/);
  assert.throws(() => planDigest(plan('ATTACH_SELECTED_DEVICE', { requestedHz: 3000 })), /not a reviewed request/);
});

test('the helper refuses a request from another caller identity', () => {
  const helper = createDeterministicHelper({ callerIdentity: CALLER });
  const other = createHelperSession({ callerIdentity: { packageId: 'other-app', publisherThumbprint: 'B'.repeat(40) } });
  const response = helper.handle(other.issueRequest('OBSERVE_STATE', plan('OBSERVE_STATE')));

  assert.equal(response.ok, false);
  assert.equal(response.error.code, 'CALLER_IDENTITY_REJECTED');
});

test('the helper requires a pinned expected caller identity at construction', () => {
  assertRefused(() => createDeterministicHelper(), 'MALFORMED_MESSAGE');
});

test('the helper refuses malformed and unknown-operation messages without acting', () => {
  const helper = createDeterministicHelper({ callerIdentity: CALLER });

  assert.equal(helper.handle({ protocolVersion: '9.9.9' }).ok, false);
  assert.equal(helper.handle(null).ok, false);
  assert.throws(() => validateHelperRequest({ protocolVersion: HELPER_PROTOCOL_VERSION, operation: 'DELETE_EVERYTHING', nonce: 'x'.repeat(32), callerIdentity: CALLER, planDigest: '0'.repeat(64), issuedAtMs: 1, payload: {} }), HelperProtocolError);
});

test('a fresh install eligibility question never reaches the helper as a mutation', () => {
  const { call } = harness();
  const preflight = call('PREFLIGHT_PACKAGE');

  assert.equal(preflight.present, false);
  assert.equal(preflight.installedByDialed, false);
});

test('an observation cannot authorize a later mutation', () => {
  const { session, helper } = installedHarness();
  const observed = session.consumeResponse(helper.handle(session.issueRequest('OBSERVE_STATE', plan('OBSERVE_STATE'))));
  const request = session.issueRequest(
    'ATTACH_SELECTED_DEVICE',
    plan('ATTACH_SELECTED_DEVICE', { deviceDigest: DEVICE_A, requestedHz: 1000, packageSha256: PACKAGE_SHA }),
    { preimageDigest: observed.preimageDigest, deviceDigest: DEVICE_A, requestedHz: 1000 },
  );
  assertRefused(() => session.consumeResponse(helper.handle(request)), 'PREIMAGE_NOT_SEALED_OR_STALE');
});

test('an exact existing package can be adopted without claiming ownership of it', () => {
  const { call } = harness({ initialPackage: { present: true, binarySha256: PACKAGE_SHA, serviceName: 'hidusbf', installedByDialed: false, signatureValid: true } });
  const adopted = call('ADOPT_PACKAGE', { packageSha256: PACKAGE_SHA });

  assert.equal(adopted.adopted, true);
  assert.equal(adopted.ownership, 'EXTERNAL_OBSERVED_ONLY');
  assert.equal(adopted.binarySha256, PACKAGE_SHA);
});

test('adoption rechecks helper-owned hash, service and signature identity', () => {
  for (const [initialPackage, code] of [
    [{ present: true, binarySha256: PACKAGE_SHA, serviceName: 'anything', installedByDialed: false, signatureValid: true }, 'PACKAGE_SERVICE_MISMATCH'],
    [{ present: true, binarySha256: PACKAGE_SHA, serviceName: 'hidusbf', installedByDialed: false, signatureValid: false }, 'PACKAGE_SIGNATURE_INVALID'],
    [{ present: true, binarySha256: 'f'.repeat(64), serviceName: 'hidusbf', installedByDialed: false, signatureValid: true }, 'PACKAGE_IDENTITY_MISMATCH'],
  ]) {
    const { call } = harness({ initialPackage });
    assertRefused(() => call('ADOPT_PACKAGE', { packageSha256: PACKAGE_SHA }), code);
  }
});

test('attaching the selected target writes back exactly the reviewed request', () => {
  const { helper, mutate } = installedHarness();
  const result = mutate('ATTACH_SELECTED_DEVICE', { deviceDigest: DEVICE_A, requestedHz: 1000, packageSha256: PACKAGE_SHA }, { deviceDigest: DEVICE_A, requestedHz: 1000 });

  assert.equal(result.delta, 'SELECTED_ATTACHMENT_ADDED');
  assert.equal(result.readbackHz, 1000);

  const snapshot = helper.snapshot();
  const managed = snapshot.attachments.find((entry) => entry.deviceDigest === DEVICE_A);
  const untouched = snapshot.attachments.find((entry) => entry.deviceDigest === DEVICE_B);
  assert.deepEqual(managed.lowerFilters, ['hidusbf']);
  assert.equal(managed.requestedHz, 1000);
  assert.deepEqual(untouched.lowerFilters, []);
  assert.equal(untouched.requestedHz, null);
});

test('attach refuses an incompatible target and an external filter regardless of case', () => {
  const incompatible = installedHarness({ initialAttachments: [attachment(DEVICE_A, { compatible: false })] });
  assertRefused(() => incompatible.mutate('ATTACH_SELECTED_DEVICE', { deviceDigest: DEVICE_A, requestedHz: 1000, packageSha256: PACKAGE_SHA }, { deviceDigest: DEVICE_A, requestedHz: 1000 }), 'TARGET_INCOMPATIBLE');

  const external = installedHarness({ initialAttachments: [attachment(DEVICE_A, { lowerFilters: ['HiDuSbF'], dialedManaged: false })] });
  assertRefused(() => external.mutate('ATTACH_SELECTED_DEVICE', { deviceDigest: DEVICE_A, requestedHz: 1000, packageSha256: PACKAGE_SHA }, { deviceDigest: DEVICE_A, requestedHz: 1000 }), 'ATTACHMENT_ALREADY_EXTERNAL');
  assert.deepEqual(external.helper.snapshot().attachments[0].lowerFilters, ['HiDuSbF']);
});

test('changing a Dialed-managed rate preserves the original rollback value', () => {
  const { helper, mutate } = installedHarness({ initialAttachments: [attachment(DEVICE_A, { requestedHz: 250 })] });
  mutate('ATTACH_SELECTED_DEVICE', { deviceDigest: DEVICE_A, requestedHz: 1000, packageSha256: PACKAGE_SHA }, { deviceDigest: DEVICE_A, requestedHz: 1000 });
  mutate('ATTACH_SELECTED_DEVICE', { deviceDigest: DEVICE_A, requestedHz: 500, packageSha256: PACKAGE_SHA }, { deviceDigest: DEVICE_A, requestedHz: 500 });
  const detached = mutate('DETACH_SELECTED_DEVICE', { deviceDigest: DEVICE_A, packageSha256: PACKAGE_SHA }, { deviceDigest: DEVICE_A });
  assert.equal(detached.restoredHz, 250);
  assert.equal(helper.snapshot().attachments[0].requestedHz, 250);
});

test('detach restores an absent prior request rather than writing a zero', () => {
  const { helper, mutate } = installedHarness();
  mutate('ATTACH_SELECTED_DEVICE', { deviceDigest: DEVICE_A, requestedHz: 1000, packageSha256: PACKAGE_SHA }, { deviceDigest: DEVICE_A, requestedHz: 1000 });
  const detached = mutate('DETACH_SELECTED_DEVICE', { deviceDigest: DEVICE_A, packageSha256: PACKAGE_SHA }, { deviceDigest: DEVICE_A });

  assert.equal(detached.restoredHz, null);
  assert.deepEqual(detached.remainingFilters, []);
  assert.equal(helper.snapshot().attachments.find((entry) => entry.deviceDigest === DEVICE_A).requestedHz, null);
});

test('detach restores a pre-existing request instead of deleting it', () => {
  const { helper, mutate } = installedHarness({ initialAttachments: [attachment(DEVICE_A, { requestedHz: 250 })] });
  mutate('ATTACH_SELECTED_DEVICE', { deviceDigest: DEVICE_A, requestedHz: 1000, packageSha256: PACKAGE_SHA }, { deviceDigest: DEVICE_A, requestedHz: 1000 });
  const detached = mutate('DETACH_SELECTED_DEVICE', { deviceDigest: DEVICE_A, packageSha256: PACKAGE_SHA }, { deviceDigest: DEVICE_A });

  assert.equal(detached.restoredHz, 250);
  assert.equal(helper.snapshot().attachments.find((entry) => entry.deviceDigest === DEVICE_A).requestedHz, 250);
});

test('an unrelated filter keeps its place and order through attach and detach', () => {
  const { helper, mutate } = installedHarness({ initialAttachments: [attachment(DEVICE_A, { lowerFilters: ['vendorfilter', 'anotherfilter'] })] });
  mutate('ATTACH_SELECTED_DEVICE', { deviceDigest: DEVICE_A, requestedHz: 1000, packageSha256: PACKAGE_SHA }, { deviceDigest: DEVICE_A, requestedHz: 1000 });
  assert.deepEqual(helper.snapshot().attachments[0].lowerFilters, ['vendorfilter', 'anotherfilter', 'hidusbf']);

  mutate('DETACH_SELECTED_DEVICE', { deviceDigest: DEVICE_A, packageSha256: PACKAGE_SHA }, { deviceDigest: DEVICE_A });
  assert.deepEqual(helper.snapshot().attachments[0].lowerFilters, ['vendorfilter', 'anotherfilter']);
});

test('Dialed never detaches an attachment it did not make', () => {
  const { session, helper } = installedHarness({ initialAttachments: [attachment(DEVICE_A, { lowerFilters: ['hidusbf'], dialedManaged: false })] });
  const sealed = session.issueRequest('EXTEND_RECOVERY_CHECKPOINT', plan('EXTEND_RECOVERY_CHECKPOINT'));
  const preimageDigest = session.consumeResponse(helper.handle(sealed)).preimageDigest;
  const request = session.issueRequest('DETACH_SELECTED_DEVICE', plan('DETACH_SELECTED_DEVICE', { deviceDigest: DEVICE_A, packageSha256: PACKAGE_SHA }), { preimageDigest, deviceDigest: DEVICE_A });

  assertRefused(() => session.consumeResponse(helper.handle(request)), 'ATTACHMENT_NOT_DIALED_MANAGED');
});

test('a mutation without a fresh sealed preimage is refused', () => {
  const { session, helper } = installedHarness();
  const request = session.issueRequest('ATTACH_SELECTED_DEVICE', plan('ATTACH_SELECTED_DEVICE', { deviceDigest: DEVICE_A, requestedHz: 1000, packageSha256: PACKAGE_SHA }), { preimageDigest: 'f'.repeat(64), deviceDigest: DEVICE_A, requestedHz: 1000 });

  assertRefused(() => session.consumeResponse(helper.handle(request)), 'PREIMAGE_NOT_SEALED_OR_STALE');
});

test('one sealed preimage authorizes only one mutation attempt', () => {
  const { session, helper, seal } = installedHarness();
  const preimageDigest = seal();
  const first = session.issueRequest('REPAIR_EXACT_PACKAGE', plan('REPAIR_EXACT_PACKAGE', { packageSha256: PACKAGE_SHA }), { preimageDigest });
  assert.equal(session.consumeResponse(helper.handle(first)).delta, 'PACKAGE_REPAIRED');
  const second = session.issueRequest('REPAIR_EXACT_PACKAGE', plan('REPAIR_EXACT_PACKAGE', { packageSha256: PACKAGE_SHA }), { preimageDigest });
  assertRefused(() => session.consumeResponse(helper.handle(second)), 'PREIMAGE_NOT_SEALED_OR_STALE');
});

test('a preimage that went stale between sealing and applying is refused', () => {
  const { session, helper } = installedHarness();
  const sealed = session.issueRequest('EXTEND_RECOVERY_CHECKPOINT', plan('EXTEND_RECOVERY_CHECKPOINT'));
  const preimageDigest = session.consumeResponse(helper.handle(sealed)).preimageDigest;

  // Something else changed the machine after Dialed sealed its recovery state.
  helper.setSecurity({ memoryIntegrity: 'ENABLED' });

  const request = session.issueRequest('ATTACH_SELECTED_DEVICE', plan('ATTACH_SELECTED_DEVICE', { deviceDigest: DEVICE_A, requestedHz: 1000, packageSha256: PACKAGE_SHA }), { preimageDigest, deviceDigest: DEVICE_A, requestedHz: 1000 });
  assertRefused(() => session.consumeResponse(helper.handle(request)), 'PREIMAGE_NOT_SEALED_OR_STALE');
});

test('surprise removal between sealing and applying refuses the attach', () => {
  const { session, helper } = installedHarness({ surpriseRemovalBefore: ['ATTACH_SELECTED_DEVICE'] });
  const sealed = session.issueRequest('EXTEND_RECOVERY_CHECKPOINT', plan('EXTEND_RECOVERY_CHECKPOINT'));
  const preimageDigest = session.consumeResponse(helper.handle(sealed)).preimageDigest;
  const request = session.issueRequest('ATTACH_SELECTED_DEVICE', plan('ATTACH_SELECTED_DEVICE', { deviceDigest: DEVICE_A, requestedHz: 1000, packageSha256: PACKAGE_SHA }), { preimageDigest, deviceDigest: DEVICE_A, requestedHz: 1000 });

  // The device vanished after the preimage was sealed, so the sealed state no longer
  // describes the machine and the mutation is refused before it touches anything.
  assertRefused(() => session.consumeResponse(helper.handle(request)), 'PREIMAGE_STALE');
  assert.equal(helper.snapshot().attachments.find((entry) => entry.deviceDigest === DEVICE_A).dialedManaged, false);
});

test('a mid-operation failure enters durable NEEDS_REVIEW and blocks further change', () => {
  const { session, helper, mutate } = installedHarness({ failOperations: ['ATTACH_SELECTED_DEVICE'] });
  assertRefused(() => mutate('ATTACH_SELECTED_DEVICE', { deviceDigest: DEVICE_A, requestedHz: 1000, packageSha256: PACKAGE_SHA }, { deviceDigest: DEVICE_A, requestedHz: 1000 }), 'OPERATION_FAILED_NEEDS_REVIEW');
  assert.equal(helper.snapshot().needsReview, true);

  const sealed = session.issueRequest('EXTEND_RECOVERY_CHECKPOINT', plan('EXTEND_RECOVERY_CHECKPOINT'));
  const preimageDigest = session.consumeResponse(helper.handle(sealed)).preimageDigest;
  const retry = session.issueRequest('DETACH_SELECTED_DEVICE', plan('DETACH_SELECTED_DEVICE', { deviceDigest: DEVICE_A, packageSha256: PACKAGE_SHA }), { preimageDigest, deviceDigest: DEVICE_A });
  assertRefused(() => session.consumeResponse(helper.handle(retry)), 'NEEDS_REVIEW_DURABLE');
});

test('a restart requirement blocks another change until the restart is reconciled', () => {
  const { helper, mutate } = installedHarness({ attachRequiresRestart: true });
  const attached = mutate('ATTACH_SELECTED_DEVICE', { deviceDigest: DEVICE_A, requestedHz: 8000, packageSha256: PACKAGE_SHA, restartExpected: true }, { deviceDigest: DEVICE_A, requestedHz: 8000 });

  assert.equal(attached.restartRequired, true);
  assertRefused(() => mutate('ATTACH_SELECTED_DEVICE', { deviceDigest: DEVICE_B, requestedHz: 1000, packageSha256: PACKAGE_SHA }, { deviceDigest: DEVICE_B, requestedHz: 1000 }), 'RESTART_REQUIRED');

  assertRefused(() => helper.reconcileRestart(), 'RESTART_NOT_OBSERVED');
  helper.simulateRestart('boot-2');
  helper.reconcileRestart();
  assert.equal(helper.snapshot().restartRequired, false);
  assert.equal(helper.snapshot().bootSessionId, 'boot-2');
  assert.doesNotThrow(() => mutate('ATTACH_SELECTED_DEVICE', { deviceDigest: DEVICE_B, requestedHz: 1000, packageSha256: PACKAGE_SHA, restartExpected: true }, { deviceDigest: DEVICE_B, requestedHz: 1000 }));
});

test('post-restart drift preserves the restart lock and refuses reconciliation', () => {
  const { helper, mutate } = installedHarness({ attachRequiresRestart: true });
  mutate('ATTACH_SELECTED_DEVICE', { deviceDigest: DEVICE_A, requestedHz: 8000, packageSha256: PACKAGE_SHA, restartExpected: true }, { deviceDigest: DEVICE_A, requestedHz: 8000 });

  helper.simulateRestart('boot-2');
  helper.setSecurity({ memoryIntegrity: 'DISABLED' });
  assertRefused(() => helper.reconcileRestart(), 'POST_RESTART_DRIFT');
  assert.equal(helper.snapshot().restartRequired, true);
});

test('the caller cannot suppress a helper-owned restart requirement', () => {
  const { mutate } = installedHarness({ attachRequiresRestart: true });
  assertRefused(
    () => mutate('ATTACH_SELECTED_DEVICE', { deviceDigest: DEVICE_A, requestedHz: 8000, packageSha256: PACKAGE_SHA, restartExpected: false }, { deviceDigest: DEVICE_A, requestedHz: 8000 }),
    'RESTART_EXPECTATION_MISMATCH',
  );
});

test('repair and upgrade restore every saved attachment', () => {
  const { helper, mutate } = installedHarness();
  mutate('ATTACH_SELECTED_DEVICE', { deviceDigest: DEVICE_A, requestedHz: 1000, packageSha256: PACKAGE_SHA }, { deviceDigest: DEVICE_A, requestedHz: 1000 });
  mutate('ATTACH_SELECTED_DEVICE', { deviceDigest: DEVICE_B, requestedHz: 500, packageSha256: PACKAGE_SHA }, { deviceDigest: DEVICE_B, requestedHz: 500 });

  const repaired = mutate('REPAIR_EXACT_PACKAGE', { packageSha256: PACKAGE_SHA }, {});
  assert.deepEqual(repaired.restoredAttachments, [DEVICE_A, DEVICE_B].sort());

  const upgraded = mutate('UPGRADE_EXACT_PREDECESSOR', { packageSha256: NEXT_PACKAGE_SHA }, { predecessorSha256: PACKAGE_SHA });
  assert.deepEqual(upgraded.restoredAttachments, [DEVICE_A, DEVICE_B].sort());
  assert.equal(helper.snapshot().package.binarySha256, NEXT_PACKAGE_SHA);
});

test('an upgrade from a predecessor that is not the exact allowlisted one is refused', () => {
  const { mutate } = installedHarness();
  assertRefused(() => mutate('UPGRADE_EXACT_PREDECESSOR', { packageSha256: NEXT_PACKAGE_SHA }, { predecessorSha256: 'f'.repeat(64) }), 'PREDECESSOR_NOT_ALLOWLISTED');
});

test('package removal refuses while any attachment remains, including phantom scope', () => {
  const { helper, mutate } = installedHarness({ initialAttachments: [attachment(DEVICE_A), attachment(PHANTOM, { presence: 'PHANTOM' })] });
  mutate('ATTACH_SELECTED_DEVICE', { deviceDigest: DEVICE_A, requestedHz: 1000, packageSha256: PACKAGE_SHA }, { deviceDigest: DEVICE_A, requestedHz: 1000 });
  assertRefused(() => mutate('REMOVE_DETACHED_PACKAGE', { packageSha256: PACKAGE_SHA }, {}), 'MANAGED_ATTACHMENT_REMAINS');

  mutate('DETACH_SELECTED_DEVICE', { deviceDigest: DEVICE_A, packageSha256: PACKAGE_SHA }, { deviceDigest: DEVICE_A });

  // A phantom devnode still carrying the filter must block removal exactly as a present one does.
  const phantom = helper.snapshot().attachments.find((entry) => entry.deviceDigest === PHANTOM);
  assert.equal(phantom.presence, 'PHANTOM');
  assert.doesNotThrow(() => mutate('REMOVE_DETACHED_PACKAGE', { packageSha256: PACKAGE_SHA }, {}));
  assert.equal(helper.snapshot().package.present, false);
});

test('a phantom attachment that still carries the filter blocks package removal', () => {
  const { mutate } = installedHarness({ initialAttachments: [attachment(PHANTOM, { presence: 'PHANTOM', lowerFilters: ['hidusbf'], dialedManaged: true })] });
  assertRefused(() => mutate('REMOVE_DETACHED_PACKAGE', { packageSha256: PACKAGE_SHA }, {}), 'MANAGED_ATTACHMENT_REMAINS');
});

test('an externally installed package is never repaired, upgraded or removed', () => {
  const { mutate } = installedHarness({ initialPackage: { present: true, binarySha256: PACKAGE_SHA, serviceName: 'hidusbf', installedByDialed: false, signatureValid: true }, initialAttachments: [] });

  for (const operation of ['REPAIR_EXACT_PACKAGE', 'UPGRADE_EXACT_PREDECESSOR', 'REMOVE_DETACHED_PACKAGE']) {
    const payload = operation === 'UPGRADE_EXACT_PREDECESSOR' ? { predecessorSha256: PACKAGE_SHA } : {};
    assertRefused(() => mutate(operation, { packageSha256: PACKAGE_SHA }, payload), 'EXTERNAL_PACKAGE_NOT_DIALED_OWNED');
  }
});

test('an incomplete inventory blocks every mutation', () => {
  const { helper, mutate } = installedHarness();
  helper.setInventoryComplete(false);
  assertRefused(() => mutate('ATTACH_SELECTED_DEVICE', { deviceDigest: DEVICE_A, requestedHz: 1000, packageSha256: PACKAGE_SHA }, { deviceDigest: DEVICE_A, requestedHz: 1000 }), 'INVENTORY_INCOMPLETE');
});

test('a Windows protection that is not enabled blocks every mutation and is never turned off', () => {
  for (const [key, code] of [['secureBoot', 'SECURE_BOOT_NOT_ENABLED'], ['memoryIntegrity', 'MEMORY_INTEGRITY_NOT_ENABLED'], ['driverSignatureEnforcement', 'DRIVER_SIGNATURE_ENFORCEMENT_NOT_ENABLED']]) {
    const { helper, mutate } = installedHarness();
    helper.setSecurity({ [key]: 'DISABLED' });
    assertRefused(() => mutate('ATTACH_SELECTED_DEVICE', { deviceDigest: DEVICE_A, requestedHz: 1000, packageSha256: PACKAGE_SHA }, { deviceDigest: DEVICE_A, requestedHz: 1000 }), code);
    assert.equal(helper.snapshot().security[key], 'DISABLED');
  }
});

test('the recovery checkpoint chain advances once per sealed operation', () => {
  const { helper, mutate, seal } = installedHarness();
  assert.equal(helper.snapshot().checkpointSequence, 0);
  seal();
  assert.equal(helper.snapshot().checkpointSequence, 1);
  mutate('ATTACH_SELECTED_DEVICE', { deviceDigest: DEVICE_A, requestedHz: 1000, packageSha256: PACKAGE_SHA }, { deviceDigest: DEVICE_A, requestedHz: 1000 });
  assert.equal(helper.snapshot().checkpointSequence, 3);
});

test('the sealed preimage covers filters, request, package, security, session and inventory', () => {
  const state = {
    attachments: [{ deviceDigest: DEVICE_A, presence: 'PRESENT', lowerFilters: ['hidusbf'], requestedHz: 1000, dialedManaged: true }],
    package: { present: true, binarySha256: PACKAGE_SHA, serviceName: 'hidusbf', oemInfName: 'oem42.inf', installedByDialed: true },
    security: { secureBoot: 'ENABLED', memoryIntegrity: 'ENABLED', driverSignatureEnforcement: 'ENABLED' },
    bootSessionId: 'boot-1',
    driverSessionId: 'session-1',
    inventoryComplete: true,
  };
  const { preimage, preimageDigest } = sealPreimage(state);

  assert.match(preimageDigest, /^[a-f0-9]{64}$/);
  assert.deepEqual(Object.keys(preimage).sort(), ['bootSessionId', 'driverSessionId', 'installedByDialed', 'inventoryComplete', 'lowerFiltersOrdered', 'needsReview', 'oemInfName', 'packagePresent', 'packageSha256', 'packageSignatureValid', 'restartRequired', 'security', 'serviceName']);
  assert.equal(Object.isFrozen(preimage), true);

  const changed = sealPreimage({ ...state, bootSessionId: 'boot-2' });
  assert.notEqual(changed.preimageDigest, preimageDigest);
});

test('an elevation cancellation before any change leaves state untouched', () => {
  const { helper, session } = installedHarness();
  const before = helper.snapshot();

  // The caller abandons the request instead of sending it, exactly as a cancelled UAC
  // prompt does. Nothing reaches the helper, and the nonce is simply never answered.
  session.issueRequest('ATTACH_SELECTED_DEVICE', plan('ATTACH_SELECTED_DEVICE', { deviceDigest: DEVICE_A, requestedHz: 1000, packageSha256: PACKAGE_SHA }), { preimageDigest: 'f'.repeat(64), deviceDigest: DEVICE_A, requestedHz: 1000 });

  assert.equal(session.outstandingCount, 1);
  assert.deepEqual(helper.snapshot(), before);
});
