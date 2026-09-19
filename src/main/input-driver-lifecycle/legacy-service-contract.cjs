// Exact upstream legacy-service planning. No Windows I/O, paths or commands accepted
// from the renderer. Native authentication and protected execution are separate gates.
const crypto = require('node:crypto');
const { INVENTORY_SHA256 } = require('./bundled-inventory.cjs');
const RATES = Object.freeze([125, 250, 500, 1000, 2000, 4000, 8000]);
const VARIANTS = Object.freeze({
  NOPATCH: Object.freeze({ path: 'DRIVER/AMD64_AS/NoPatch/hidusbf.sys', sha256: '2f82cdeb36bdaa42ea1933a9b11f3b8e1bdb28e6d3e3da7e65b4631b3375412d', patching: false, tier: 0 }),
  PATCH_1K: Object.freeze({ path: 'DRIVER/AMD64_AS/1khz/hidusbf.sys', sha256: '81f649b34978fe9f74ce5c7c04ba24d5238faec6c70018f14da9423a46e6e04d', patching: true, tier: 1 }),
  PATCH_2K_4K: Object.freeze({ path: 'DRIVER/AMD64_AS/2khz-4khz/hidusbf.sys', sha256: 'e2c9fc626bb92d2219fbef3458014c198a3c90c563f948c9a433826e64d77e90', patching: true, tier: 2 }),
  PATCH_4K_8K: Object.freeze({ path: 'DRIVER/AMD64_AS/4khz-8khz/hidusbf.sys', sha256: 'db73a8c259e16a0d02f138650497c1bdec81add66d928f3cf3ff39fad4eb421b', patching: true, tier: 3 }),
});
const ACTIONS = Object.freeze(['INSTALL', 'ADOPT', 'APPLY', 'DETACH', 'REPAIR', 'REMOVE']);
const SERVICE_IMAGE = '\\SystemRoot\\System32\\drivers\\hidusbf.sys';
const stable = (value) => Array.isArray(value) ? `[${value.map(stable).join(',')}]` : value && typeof value === 'object' ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}` : JSON.stringify(value);
const digest = (value) => crypto.createHash('sha256').update(stable(value)).digest('hex');
const clone = (value) => JSON.parse(JSON.stringify(value));
function freeze(value) { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
function fail(code, message) { const error = new Error(message); error.code = code; throw error; }
function exact(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join('|') !== [...keys].sort().join('|')) fail('INVALID_STATE', `${label} fields are incomplete or unexpected.`);
}
function assertDigest(value) { if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) fail('INVALID_IDENTITY', 'Exact device/payload identity required.'); }
function valueState(value, array = false) {
  exact(value, ['present', 'value'], 'Original value');
  if (typeof value.present !== 'boolean' || (!value.present && value.value !== null)) fail('INVALID_STATE', 'Value absence must be explicit.');
  if (value.present && (array ? !Array.isArray(value.value) || value.value.length > 32 || value.value.some((item) => typeof item !== 'string' || !/^[A-Za-z0-9_.-]{1,128}$/.test(item)) : !Number.isSafeInteger(value.value) || value.value < 0 || value.value > 0xffffffff)) fail('INVALID_STATE', 'Original Registry value is not supported.');
}
function parameterState(value) {
  exact(value, ['keyPresent', 'patchUsbXhci', 'patchUsbPort'], 'Parameter location');
  if (typeof value.keyPresent !== 'boolean') fail('INVALID_STATE', 'Parameter key absence must be explicit.');
  valueState(value.patchUsbXhci); valueState(value.patchUsbPort);
  if (!value.keyPresent && (value.patchUsbXhci.present || value.patchUsbPort.present)) fail('INVALID_STATE', 'Absent parameter key cannot hold values.');
}
function newService(variant) {
  const absent = () => ({ keyPresent: false, patchUsbXhci: { present: false, value: null }, patchUsbPort: { present: false, value: null } });
  return { name: 'hidusbf', imagePath: SERVICE_IMAGE, type: 1, start: 3, errorControl: 1, variant, binarySha256: VARIANTS[variant].sha256, signatureValid: true, running: false, parameters: { services: absent(), legacyControl: absent() } };
}
function effectiveTier(service) {
  const values = Object.values(service.parameters).filter((location) => location.patchUsbXhci.present).map((location) => location.patchUsbXhci.value);
  if (values.some((value) => value > 3) || new Set(values).size > 1) fail('AMBIGUOUS_PATCH_PARAMETERS', 'The two upstream patch parameter locations conflict or are unrecognized.');
  return values.length ? values[0] : VARIANTS[service.variant].tier;
}
function validateState(raw) {
  exact(raw, ['schemaVersion', 'inventoryComplete', 'bootId', 'security', 'service', 'driverFile', 'orphanedServiceState', 'devices', 'pendingRestart'], 'Legacy state');
  if (typeof raw.orphanedServiceState !== 'boolean') fail('INVALID_STATE', 'Orphaned service/parameter state must be explicitly checked.');
  if (raw.driverFile !== null) {
    exact(raw.driverFile, ['sha256', 'signatureValid'], 'Installed SYS file'); assertDigest(raw.driverFile.sha256);
    if (typeof raw.driverFile.signatureValid !== 'boolean') fail('INVALID_STATE', 'Installed file trust must be explicit.');
  }
  if (raw.schemaVersion !== 1 || typeof raw.inventoryComplete !== 'boolean' || typeof raw.pendingRestart !== 'boolean' || typeof raw.bootId !== 'string' || !raw.bootId || raw.bootId.length > 128) fail('INVALID_STATE', 'Invalid legacy state header.');
  exact(raw.security, ['memoryIntegrity', 'secureBoot', 'signatureEnforcement', 'testSigning', 'kernelPolicy'], 'Security');
  for (const key of ['memoryIntegrity', 'secureBoot', 'signatureEnforcement', 'testSigning']) if (!['ENABLED', 'DISABLED', 'UNKNOWN'].includes(raw.security[key])) fail('INVALID_STATE', 'Unknown security vocabulary.');
  if (!['ACCEPTED', 'BLOCKED', 'UNKNOWN'].includes(raw.security.kernelPolicy)) fail('INVALID_STATE', 'Unknown kernel policy state.');
  if (raw.service !== null) {
    exact(raw.service, ['name', 'imagePath', 'type', 'start', 'errorControl', 'variant', 'binarySha256', 'signatureValid', 'running', 'parameters'], 'Service');
    if (raw.service.name !== 'hidusbf' || raw.service.imagePath !== SERVICE_IMAGE || raw.service.type !== 1 || raw.service.start !== 3 || raw.service.errorControl !== 1) fail('SERVICE_CONFIGURATION_DRIFT', 'The fixed legacy service name, image path, type, start or error control differs.');
    if (!Object.hasOwn(VARIANTS, raw.service.variant) || raw.service.binarySha256 !== VARIANTS[raw.service.variant].sha256 || typeof raw.service.signatureValid !== 'boolean' || typeof raw.service.running !== 'boolean') fail('UNKNOWN_SERVICE', 'The service is not an exact reviewed upstream binary.');
    if (!raw.driverFile || raw.driverFile.sha256 !== raw.service.binarySha256 || raw.driverFile.signatureValid !== raw.service.signatureValid) fail('SERVICE_FILE_MISMATCH', 'Service and installed file identity disagree.');
    exact(raw.service.parameters, ['services', 'legacyControl'], 'Parameter locations');
    parameterState(raw.service.parameters.services); parameterState(raw.service.parameters.legacyControl);
    effectiveTier(raw.service);
  }
  if (!Array.isArray(raw.devices) || raw.devices.length > 4096) fail('INVALID_STATE', 'Device inventory invalid.');
  const ids = new Set();
  for (const device of raw.devices) {
    exact(device, ['id', 'interfaceDigest', 'transport', 'speed', 'present', 'problem', 'scopeResolved', 'lowerFilters', 'interval'], 'Device');
    assertDigest(device.id); assertDigest(device.interfaceDigest);
    if (ids.has(device.id)) fail('AMBIGUOUS_DEVICE', 'Duplicate selected-device identity.');
    ids.add(device.id);
    if (!['USB', 'BLUETOOTH', 'UNKNOWN'].includes(device.transport) || !['FULL', 'HIGH', 'LOW', 'UNKNOWN'].includes(device.speed) || typeof device.present !== 'boolean' || typeof device.scopeResolved !== 'boolean' || !Number.isSafeInteger(device.problem) || device.problem < 0) fail('INVALID_STATE', 'Device state invalid.');
    valueState(device.lowerFilters, true); valueState(device.interval);
    if (device.lowerFilters.present && new Set(device.lowerFilters.value.map((item) => item.toLowerCase())).size !== device.lowerFilters.value.length) fail('AMBIGUOUS_FILTERS', 'Duplicate filter entries require review.');
  }
  return freeze(clone(raw));
}
function attached(device) { return device.lowerFilters.present && device.lowerFilters.value.some((value) => value.toLowerCase() === 'hidusbf'); }
function intervalForRequest(speed, hz) {
  const value = speed === 'FULL' ? ({ 125: 8, 250: 4, 500: 2, 1000: 1 })[hz] : speed === 'HIGH' ? ({ 1000: 4, 2000: 3, 4000: 2, 8000: 1 })[hz] : null;
  if (!value) fail('UNSUPPORTED_RATE', 'This USB speed cannot represent the selected request.');
  return value;
}
function chooseVariant(speed, hz) {
  intervalForRequest(speed, hz);
  return speed === 'FULL' ? 'NOPATCH' : hz <= 1000 ? 'PATCH_1K' : hz <= 4000 ? 'PATCH_2K_4K' : 'PATCH_4K_8K';
}
function checkSecurity(state, variant) {
  const security = state.security;
  if (security.secureBoot === 'UNKNOWN' || security.memoryIntegrity === 'UNKNOWN' || security.signatureEnforcement !== 'ENABLED' || security.testSigning !== 'DISABLED' || security.kernelPolicy !== 'ACCEPTED') fail('SECURITY_NOT_ACCEPTED', 'Current security and kernel policy acceptance must be established without changing protections.');
  if (VARIANTS[variant].patching && security.memoryIntegrity !== 'DISABLED') fail('PATCHING_INCOMPATIBLE_WITH_MEMORY_INTEGRITY', 'This upstream patching variant is incompatible with enabled Memory Integrity. Dialed will not disable it.');
}
function planLegacyChange(raw, request, ownership = { serviceOwned: false, devices: {} }) {
  const state = validateState(raw);
  exact(request, ['action', 'deviceId', 'interfaceDigest', 'requestedHz', 'acknowledgePatching'], 'Request');
  if (!ACTIONS.includes(request.action) || typeof request.acknowledgePatching !== 'boolean') fail('INVALID_REQUEST', 'Unknown action or patching acknowledgement.');
  if (!state.inventoryComplete || state.devices.some((device) => !device.scopeResolved)) fail('INCOMPLETE_INVENTORY', 'Present and absent attachment scope must be completely enumerated.');
  if (state.orphanedServiceState) fail('ORPHANED_SERVICE_STATE', 'Unowned service keys or legacy parameters require review before any lifecycle operation.');
  if (state.pendingRestart) fail('RESTART_PENDING', 'Reconcile the saved restart before another change.');
  const { action } = request;
  const deviceAction = ['INSTALL', 'ADOPT', 'APPLY', 'DETACH'].includes(action);
  const rateAction = ['INSTALL', 'APPLY'].includes(action);
  if (deviceAction) { assertDigest(request.deviceId); assertDigest(request.interfaceDigest); }
  else if (request.deviceId !== null || request.interfaceDigest !== null) fail('INVALID_REQUEST', 'This action has no device argument.');
  if (rateAction ? !RATES.includes(request.requestedHz) : request.requestedHz !== null) fail('INVALID_REQUEST', 'Unexpected or unsupported rate.');
  const device = deviceAction ? state.devices.find((entry) => entry.id === request.deviceId && entry.interfaceDigest === request.interfaceDigest) : null;
  if (deviceAction && (!device || (action !== 'DETACH' && (!device.present || device.problem)) || device.transport !== 'USB' || !['FULL', 'HIGH'].includes(device.speed))) fail('DEVICE_NOT_ELIGIBLE', 'The exact selected USB device/interface is absent, unsupported or has a problem.');
  const next = clone(state), nextOwnership = clone(ownership);
  const target = device ? next.devices.find((entry) => entry.id === device.id) : null;
  let variant = state.service?.variant || null;
  if (rateAction) {
    const desired = chooseVariant(device.speed, request.requestedHz);
    // Never replace a shared installed binary or alter a global patch value as a
    // side effect of a per-device rate request. Explicit detach/remove/reinstall only.
    variant = variant || desired;
    const selected = VARIANTS[variant];
    if (selected.patching && !request.acknowledgePatching) fail('PATCHING_ACKNOWLEDGEMENT_REQUIRED', 'Review the upstream patching requirement explicitly.');
    checkSecurity(state, variant);
    if (state.service && !state.service.signatureValid) fail('SIGNATURE_NOT_ACCEPTED', 'Installed signature was not accepted.');
    if (device.speed === 'HIGH') {
      const tier = state.service ? effectiveTier(state.service) : selected.tier;
      const ceiling = ({ 0: 1000, 1: 1000, 2: 4000, 3: 8000 })[tier];
      if (!selected.patching || !ceiling || request.requestedHz > ceiling) fail('SHARED_VARIANT_CHANGE_REQUIRED', 'This request requires a different reviewed shared-service tier. Detach owned scopes before a separately reviewed service replacement.');
    }
    if (action === 'INSTALL') {
      if (state.service || state.driverFile || state.devices.some(attached)) fail('SERVICE_CONFLICT', 'An existing service, SYS file or filter attachment prevents a new install.');
      next.service = newService(variant);
      next.driverFile = { sha256: selected.sha256, signatureValid: true };
      nextOwnership.serviceOwned = true;
    } else if (!state.service || !Object.hasOwn(ownership.devices, device.id)) fail('OWNERSHIP_REQUIRED', 'Adopt the exact existing device scope before applying changes.');
    if (!Object.hasOwn(nextOwnership.devices, device.id)) nextOwnership.devices[device.id] = { lowerFilters: clone(device.lowerFilters), interval: clone(device.interval), interfaceDigest: device.interfaceDigest };
    target.lowerFilters = { present: true, value: attached(device) ? [...device.lowerFilters.value] : [...(device.lowerFilters.value || []), 'hidusbf'] };
    target.interval = { present: true, value: intervalForRequest(device.speed, request.requestedHz) };
    next.pendingRestart = true;
  } else if (action === 'ADOPT') {
    if (!state.service || !state.service.signatureValid || !attached(device) || Object.hasOwn(ownership.devices, device.id)) fail('ADOPTION_REFUSED', 'Only an exact external filtered device scope can be adopted once.');
    checkSecurity(state, variant);
    if (VARIANTS[variant].patching && !request.acknowledgePatching) fail('PATCHING_ACKNOWLEDGEMENT_REQUIRED', 'Explicit patching acknowledgement required.');
    // Existing attachment belongs to the owner; detach restores it, never removes it.
    nextOwnership.devices[device.id] = { lowerFilters: clone(device.lowerFilters), interval: clone(device.interval), interfaceDigest: device.interfaceDigest };
  } else if (action === 'DETACH') {
    const original = ownership.devices[device.id];
    if (!original || original.interfaceDigest !== device.interfaceDigest) fail('OWNERSHIP_REQUIRED', 'No exact saved ownership exists for this interface.');
    target.lowerFilters = clone(original.lowerFilters); target.interval = clone(original.interval);
    delete nextOwnership.devices[device.id]; next.pendingRestart = true;
  } else if (action === 'REMOVE') {
    if (!state.service || !ownership.serviceOwned || Object.keys(ownership.devices).length || state.devices.some(attached)) fail('SHARED_SERVICE_IN_USE', 'Removal requires Dialed-owned service with no present or absent attachments.');
    next.service = null; next.driverFile = null; nextOwnership.serviceOwned = false; next.pendingRestart = true;
  } else if (action === 'REPAIR') {
    if (!state.service || !ownership.serviceOwned || !state.service.signatureValid) fail('REPAIR_REFUSED', 'Repair requires the unchanged Dialed-owned service. Drift needs review.');
    checkSecurity(state, variant);
    // Repair can reassert the same binary only. It cannot replace external drift.
    next.pendingRestart = true;
  }
  const plan = { schemaVersion: 1, installModel: 'LEGACY_SERVICE', inventorySha256: INVENTORY_SHA256, action, deviceId: request.deviceId, requestedHz: request.requestedHz, variant, beforeDigest: digest(state), after: next, ownership: nextOwnership, requiresRestart: next.pendingRestart, configurationOnly: true };
  return freeze({ ...plan, planDigest: digest(plan) });
}
module.exports = { ACTIONS, RATES, VARIANTS, SERVICE_IMAGE, newService, effectiveTier, attached, digest, clone, freeze, fail, validateState, intervalForRequest, chooseVariant, planLegacyChange };
