const { verifyBundledInventory } = require('./bundled-inventory.cjs');

function readBundledStatus(directory, { packaged = false, nativeBroker } = {}) {
  try {
    const identity = verifyBundledInventory(directory, { packaged });
    return {
      identity: 'VERIFIED', packaged, nativeBroker, selectedFileCount: identity.selectedFileCount,
      commit: identity.commit, credit: identity.credit,
      status: 'UNCONFIGURED', installEnabled: false,
      reasons: [
        ...(nativeBroker?.available === true ? [] : [{ code: 'AUTHENTICATED_NATIVE_HELPER_REQUIRED', message: 'The authenticated Windows setup helper is currently unavailable.' }]),
        { code: 'PHYSICAL_ACCEPTANCE_PENDING', message: 'Install, reconnect, recovery and removal still require acceptance on an approved physical Windows PC.' },
      ],
      rates: [1000, 2000, 4000, 8000].map((hz) => ({ hz, available: false, state: 'UNTESTED', reason: hz === 1000 ? 'Device-specific setup and physical validation are pending.' : 'High-Speed USB and an accepted upstream tier are required. Patching variants cannot run with Memory Integrity enabled; Dialed will not change that protection.' })),
    };
  } catch {
    return { identity: 'INVALID_OR_MISSING', packaged, selectedFileCount: 0, commit: null, credit: 'HIDUSBF by SweetLow / LordOfMice', status: 'UNCONFIGURED', installEnabled: false, reasons: [{ code: 'BUNDLE_IDENTITY_FAILED', message: 'The bundled upstream files are missing or differ from the reviewed inventory. Setup is unavailable.' }], rates: [1000, 2000, 4000, 8000].map((hz) => ({ hz, available: false, state: 'UNTESTED', reason: 'Exact bundled payload identity must pass first.' })) };
  }
}
module.exports = { readBundledStatus };
