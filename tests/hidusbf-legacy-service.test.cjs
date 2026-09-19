const test = require('node:test');
const assert = require('node:assert/strict');
const { planLegacyChange, newService, intervalForRequest } = require('../src/main/input-driver-lifecycle/legacy-service-contract.cjs');
const { createLegacyService, createLegacyFixtureTransport } = require('../src/main/input-driver-lifecycle/legacy-service.cjs');
const id = 'a'.repeat(64), iface = 'b'.repeat(64);
function state(speed = 'HIGH') {
  return { schemaVersion: 1, inventoryComplete: true, bootId: 'boot1', security: { memoryIntegrity: 'DISABLED', secureBoot: 'ENABLED', signatureEnforcement: 'ENABLED', testSigning: 'DISABLED', kernelPolicy: 'ACCEPTED' }, service: null, driverFile: null, orphanedServiceState: false, pendingRestart: false,
    devices: [{ id, interfaceDigest: iface, transport: 'USB', speed, present: true, problem: 0, scopeResolved: true, lowerFilters: { present: true, value: ['otherFilter'] }, interval: { present: false, value: null } }] };
}
const request = (action = 'INSTALL', hz = 8000) => ({ action, deviceId: ['REMOVE', 'REPAIR'].includes(action) ? null : id, interfaceDigest: ['REMOVE', 'REPAIR'].includes(action) ? null : iface, requestedHz: ['INSTALL', 'APPLY'].includes(action) ? hz : null, acknowledgePatching: true });
function setup(initial = state(), options = {}) { const transport = createLegacyFixtureTransport(initial); return { transport, service: createLegacyService({ transport, testOnly: true, ...options }) }; }
async function apply(service, input) { const preview = await service.preview(input); return service.apply(preview.token); }

for (const hz of [1000, 2000, 4000, 8000]) test(`legacy ${hz} request encodes exact High-Speed interval, no achieved-rate claim`, async () => {
  const { service, transport } = setup();
  const result = await apply(service, request('INSTALL', hz));
  assert.equal(result.status, 'RESTART_REQUIRED'); assert.equal(result.achievedHz, null);
  assert.equal((await transport.observe()).devices[0].interval.value, intervalForRequest('HIGH', hz));
  assert.equal((await service.reconcile()).status, 'RESTART_REQUIRED');
  transport.restart(); assert.equal((await service.reconcile()).status, 'CONFIGURATION_VERIFIED');
});
test('install, change all rates, detach and remove preserve ordered filters and absence', async () => {
  const { service, transport } = setup();
  await apply(service, request()); transport.restart(); await service.reconcile();
  for (const hz of [1000, 2000, 4000, 8000]) { await apply(service, request('APPLY', hz)); transport.restart(); await service.reconcile(); }
  await apply(service, request('DETACH')); transport.restart(); await service.reconcile();
  const detached = await transport.observe();
  assert.deepEqual(detached.devices[0].lowerFilters, { present: true, value: ['otherFilter'] });
  assert.deepEqual(detached.devices[0].interval, { present: false, value: null });
  await apply(service, request('REMOVE')); transport.restart(); await service.reconcile();
  assert.equal((await transport.observe()).service, null);
});
test('absent LowerFilters is restored as absence, not an empty multi-string', async () => {
  const initial = state(); initial.devices[0].lowerFilters = { present: false, value: null };
  const { service, transport } = setup(initial);
  await apply(service, request()); transport.restart(); await service.reconcile();
  await apply(service, request('DETACH')); transport.restart(); await service.reconcile();
  assert.deepEqual((await transport.observe()).devices[0].lowerFilters, initial.devices[0].lowerFilters);
});
test('NoPatch Full-Speed request retains enabled Memory Integrity', () => {
  const initial = state('FULL'); initial.security.memoryIntegrity = 'ENABLED';
  const plan = planLegacyChange(initial, request('INSTALL', 1000));
  assert.equal(plan.variant, 'NOPATCH'); assert.equal(plan.after.security.memoryIntegrity, 'ENABLED');
});
for (const [name, mutate, expected] of [
  ['Bluetooth', s => { s.devices[0].transport = 'BLUETOOTH'; }, /USB device/],
  ['wrong interface', s => { s.devices[0].interfaceDigest = 'c'.repeat(64); }, /USB device/],
  ['absent target', s => { s.devices[0].present = false; }, /USB device/],
  ['unknown speed', s => { s.devices[0].speed = 'UNKNOWN'; }, /USB device/],
  ['incomplete inventory', s => { s.inventoryComplete = false; }, /enumerated/],
  ['unresolved scope', s => { s.devices[0].scopeResolved = false; }, /enumerated/],
  ['Memory Integrity', s => { s.security.memoryIntegrity = 'ENABLED'; }, /Memory Integrity/],
  ['unknown security', s => { s.security.secureBoot = 'UNKNOWN'; }, /security/],
  ['test signing', s => { s.security.testSigning = 'ENABLED'; }, /security/],
  ['signature enforcement disabled', s => { s.security.signatureEnforcement = 'DISABLED'; }, /security/],
  ['unknown kernel policy', s => { s.security.kernelPolicy = 'UNKNOWN'; }, /security/],
  ['pending restart', s => { s.pendingRestart = true; }, /restart/],
  ['phantom filter conflict', s => { s.devices.push({ ...s.devices[0], id: 'c'.repeat(64), present: false, lowerFilters: { present: true, value: ['hidusbf'] } }); }, /existing service/],
]) test(`legacy install refuses ${name}`, () => { const initial = state(); mutate(initial); assert.throws(() => planLegacyChange(initial, request()), expected); });
test('unsupported Full-Speed 8k and missing patching acknowledgement are refused', () => {
  assert.throws(() => planLegacyChange(state('FULL'), request()), /USB speed/);
  assert.throws(() => planLegacyChange(state(), { ...request(), acknowledgePatching: false }), /patching requirement/);
});
test('service swap is not a per-device side effect', async () => {
  const { service, transport } = setup(); await apply(service, request('INSTALL', 1000)); transport.restart(); await service.reconcile();
  await assert.rejects(service.preview(request('APPLY', 8000)), /different reviewed shared-service tier/);
});
test('adoption records original external filter, does not acquire removal authority', async () => {
  const initial = state(); initial.service = { ...newService('PATCH_4K_8K'), running: true };
  initial.driverFile = { sha256: initial.service.binarySha256, signatureValid: true };
  initial.devices[0].lowerFilters.value.push('hidusbf'); initial.devices[0].interval = { present: true, value: 3 };
  const { service, transport } = setup(initial);
  await apply(service, request('ADOPT')); await apply(service, request('APPLY', 8000)); transport.restart(); await service.reconcile();
  await apply(service, request('DETACH')); transport.restart(); await service.reconcile();
  assert.deepEqual((await transport.observe()).devices[0], initial.devices[0]);
  await assert.rejects(service.preview(request('REMOVE')), /Dialed-owned/);
});
test('consumed preview cannot replay across operation or service restart', async () => {
  const { service, transport } = setup(); const preview = await service.preview(request()); await service.apply(preview.token);
  await assert.rejects(service.apply(preview.token), /already used/);
  const next = createLegacyService({ transport, testOnly: true }); await assert.rejects(next.apply(preview.token), /missing/);
});
test('preview expiry and changed device state stop before execution', async () => {
  let now = 0; const { service, transport } = setup(state(), { now: () => now });
  let preview = await service.preview(request()); now = 120001; await assert.rejects(service.apply(preview.token), /expired/);
  preview = await service.preview(request()); transport.changeState(s => { s.devices[0].present = false; });
  await assert.rejects(service.apply(preview.token), /USB device/); assert.equal((await transport.observe()).service, null);
});
test('cancel preserves state and durable replay consumption', async () => {
  const { service, transport } = setup(); transport.failNext('CANCEL');
  assert.equal((await apply(service, request())).status, 'NOT_APPLIED');
  assert.equal((await transport.read()).consumed.length, 1); assert.equal((await transport.observe()).service, null);
});
for (const mode of ['BEFORE', 'AFTER', 'PARTIAL']) test(`crash ${mode} retains checkpoint across service restart`, async () => {
  const { service, transport } = setup(); transport.failNext(mode);
  await assert.rejects(apply(service, request()), /Fixture/); assert.equal((await transport.read()).needsReview, true);
  const resumed = createLegacyService({ transport, testOnly: true });
  await assert.rejects(resumed.preview(request()), /Reconcile/);
  if (mode === 'BEFORE') assert.equal((await resumed.reconcile()).status, 'NOT_APPLIED');
  else if (mode === 'AFTER') { transport.restart(); assert.equal((await resumed.reconcile()).status, 'CONFIGURATION_VERIFIED'); }
  else { await assert.rejects(resumed.reconcile(), /Partial operation/); assert.ok((await transport.read()).pending); }
});
test('external filter drift after apply is never overwritten by detach', async () => {
  const { service, transport } = setup(); await apply(service, request()); transport.restart(); await service.reconcile();
  transport.changeState(s => { s.devices[0].lowerFilters.value.unshift('external'); });
  await assert.rejects(service.preview(request('DETACH')), /External state changed/);
  assert.equal((await transport.observe()).devices[0].lowerFilters.value[0], 'external');
});
test('fixture cannot activate production even with fabricated trust fields', async () => {
  const transport = createLegacyFixtureTransport(state()); transport.signed = true;
  const service = createLegacyService({ transport });
  assert.equal(service.status().productionActivation, false);
  await assert.rejects(service.preview(request()), /authenticated native helper/);
  const forged = createLegacyService({ transport: { ...transport }, testOnly: true });
  await assert.rejects(forged.preview(request()), /authenticated native helper/);
});
for (const field of ['imagePath', 'type', 'start', 'errorControl']) test(`service ${field} drift seals NEEDS_REVIEW`, async () => {
  const { service, transport } = setup(); await apply(service, request()); transport.restart(); await service.reconcile();
  transport.changeState(s => { s.service[field] = field === 'imagePath' ? 'C:\\unreviewed.sys' : 99; });
  await assert.rejects(service.preview(request('DETACH')), /fixed legacy service/);
  assert.equal((await transport.read()).needsReview, true);
});
test('conflicting service and legacy-control patch locations are refused', () => {
  const initial = state(); initial.service = newService('PATCH_4K_8K');
  initial.driverFile = { sha256: initial.service.binarySha256, signatureValid: true };
  initial.service.parameters.services = { keyPresent: true, patchUsbXhci: { present: true, value: 2 }, patchUsbPort: { present: false, value: null } };
  initial.service.parameters.legacyControl = { keyPresent: true, patchUsbXhci: { present: true, value: 3 }, patchUsbPort: { present: false, value: null } };
  assert.throws(() => planLegacyChange(initial, request()), /locations conflict/);
});
test('empty parameter key versus absent key drift is preserved', async () => {
  const { service, transport } = setup(); await apply(service, request()); transport.restart(); await service.reconcile();
  transport.changeState(s => { s.service.parameters.legacyControl.keyPresent = true; });
  await assert.rejects(service.preview(request('DETACH')), /External state/);
});
test('orphaned installed SYS or parameter keys cannot be overwritten', () => {
  const initial = state(); initial.driverFile = { sha256: 'f'.repeat(64), signatureValid: false };
  assert.throws(() => planLegacyChange(initial, request()), /SYS file/);
  initial.driverFile = null; initial.orphanedServiceState = true;
  assert.throws(() => planLegacyChange(initial, request()), /Unowned service keys/);
});
