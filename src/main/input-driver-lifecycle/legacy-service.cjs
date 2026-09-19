// Shared legacy lifecycle orchestration. Windows execution is unavailable until a
// native authenticated transport exists; test transports are explicitly isolated.
const crypto = require('node:crypto');
const { createPreviewStore } = require('../shared/preview-store.cjs');
const { clone, freeze, digest, fail, validateState, planLegacyChange } = require('./legacy-service-contract.cjs');
const fixtures = new WeakSet();

function createLegacyFixtureTransport(initialState) {
  let state = clone(validateState(initialState));
  let record = { revision: 0, expected: null, ownership: { serviceOwned: false, devices: {} }, pending: null, needsReview: false, consumed: [] };
  let failure = null;
  const adapter = {
    async observe() { return clone(state); },
    async read() { return clone(record); },
    async write(next, revision) {
      if (record.revision !== revision) fail('JOURNAL_CONFLICT', 'Protected journal changed.');
      record = clone({ ...next, revision: revision + 1 });
    },
    async execute(plan) {
      if (!record.pending || record.pending.plan.planDigest !== plan.planDigest || !record.consumed.includes(record.pending.tokenDigest)) fail('UNSEALED_PLAN', 'Helper-owned checkpoint required.');
      if (digest(state) !== plan.beforeDigest) fail('HELPER_STATE_DRIFT', 'Helper readback changed before execution.');
      if (failure === 'CANCEL') { failure = null; return { canceled: true }; }
      if (failure === 'BEFORE') { failure = null; throw new Error('Fixture crash before change.'); }
      state = clone(plan.after);
      if (failure === 'AFTER') { failure = null; throw new Error('Fixture crash after change.'); }
      if (failure === 'PARTIAL') { state.pendingRestart = false; failure = null; throw new Error('Fixture partial readback.'); }
      return { canceled: false };
    },
    changeState(change) { change(state); },
    failNext(mode) { failure = mode; },
    restart() { state.bootId += '-next'; state.pendingRestart = false; if (state.service) state.service.running = true; },
  };
  fixtures.add(adapter);
  return adapter;
}

function createLegacyService({ transport, testOnly = false, now = Date.now } = {}) {
  // No caller-supplied 'signed: true' flag can promote a fixture into production.
  const active = testOnly === true && fixtures.has(transport);
  const previews = createPreviewStore({ now, ttlMs: 120000, createToken: () => crypto.randomBytes(32).toString('base64url'), clone });
  let tail = Promise.resolve();
  const serial = (operation) => { const next = tail.then(operation, operation); tail = next.catch(() => {}); return next; };
  const requireTransport = () => { if (!active) fail('AUTHENTICATED_NATIVE_HELPER_REQUIRED', 'Bundled setup requires the authenticated native helper and physical acceptance. No change was made.'); };
  async function write(record, update) { await transport.write({ ...record, ...update }, record.revision); }
  async function readExact() {
    requireTransport();
    const record = await transport.read();
    let state;
    try { state = validateState(await transport.observe()); }
    catch (error) { await write(record, { needsReview: true }); throw error; }
    if (record.pending || record.needsReview) fail('NEEDS_REVIEW', 'Reconcile the saved operation before another change.');
    if (record.expected && digest(record.expected) !== digest(state)) {
      await write(record, { needsReview: true }); fail('EXTERNAL_STATE_DRIFT', 'External state changed; the exact original checkpoint is preserved.');
    }
    return { record, state };
  }
  async function preview(request) {
    return serial(async () => {
      const { record, state } = await readExact();
      const plan = planLegacyChange(state, request, record.ownership);
      const entry = previews.issue({ plan, revision: record.revision, request: clone(request) });
      return freeze({ token: entry.token, expiresAt: new Date(entry.expiresAt).toISOString(), action: plan.action, requestedHz: plan.requestedHz, variant: plan.variant, requiresRestart: plan.requiresRestart, configurationOnly: true });
    });
  }
  async function apply(token) {
    requireTransport();
    // Consumed before queueing, rechecked when it reaches the serialized executor.
    const entry = previews.take(token);
    return serial(async () => {
      previews.assertFresh(entry);
      const { record, state } = await readExact();
      if (record.revision !== entry.preview.revision) fail('JOURNAL_CONFLICT', 'Saved ownership changed after preview.');
      const plan = planLegacyChange(state, entry.preview.request, record.ownership);
      if (plan.planDigest !== entry.preview.plan.planDigest) fail('PREVIEW_STATE_DRIFT', 'Device or shared state changed after preview.');
      const tokenDigest = digest(token);
      if (record.consumed.includes(tokenDigest)) fail('REPLAY_REFUSED', 'This approval has already been consumed.');
      const pending = { id: crypto.randomUUID(), tokenDigest, plan, original: clone(state) };
      await write(record, { pending, consumed: [...record.consumed, tokenDigest] });
      try {
        const response = await transport.execute(plan);
        const after = validateState(await transport.observe());
        const saved = await transport.read();
        if (response.canceled) {
          if (digest(after) !== plan.beforeDigest) fail('CANCELLATION_DRIFT', 'Cancellation did not preserve the original state.');
          await write(saved, { pending: null, expected: state });
          return freeze({ status: 'NOT_APPLIED', canceled: true, operationId: pending.id });
        }
        if (digest(after) !== digest(plan.after)) fail('READBACK_MISMATCH', 'Exact write/readback failed.');
        await write(saved, { pending: plan.requiresRestart ? pending : null, expected: after, ownership: plan.ownership });
        return freeze({ status: plan.requiresRestart ? 'RESTART_REQUIRED' : 'CONFIGURATION_VERIFIED', canceled: false, operationId: pending.id, achievedHz: null });
      } catch (error) {
        const saved = await transport.read();
        await write(saved, { needsReview: true });
        throw error;
      }
    });
  }
  async function reconcile() {
    requireTransport();
    return serial(async () => {
      const record = await transport.read(), state = validateState(await transport.observe());
      const pending = record.pending;
      if (!pending) {
        if (record.needsReview || (record.expected && digest(record.expected) !== digest(state))) fail('NEEDS_REVIEW', 'External drift requires an exact manual investigation; no restore was attempted.');
        return { status: 'CONFIGURATION_VERIFIED', achievedHz: null };
      }
      if (digest(state) === pending.plan.beforeDigest) {
        await write(record, { pending: null, needsReview: false, expected: state });
        return { status: 'NOT_APPLIED', achievedHz: null };
      }
      const expected = clone(pending.plan.after);
      if (digest(state) === digest(expected) && expected.pendingRestart) return { status: 'RESTART_REQUIRED', achievedHz: null };
      // Only a boot transition and expected driver-running state may differ. Security,
      // absent devices, unrelated filters, service values and request remain exact.
      const restarted = expected.pendingRestart && state.bootId !== expected.bootId && !state.pendingRestart;
      if (restarted) {
        expected.bootId = state.bootId; expected.pendingRestart = false;
        if (expected.service) expected.service.running = true;
      }
      if (digest(state) !== digest(expected)) {
        await write(record, { needsReview: true }); fail('NEEDS_REVIEW', 'Partial operation or external drift; checkpoint retained, no automatic rollback.');
      }
      await write(record, { pending: null, needsReview: false, expected: state, ownership: pending.plan.ownership });
      return { status: 'CONFIGURATION_VERIFIED', achievedHz: null };
    });
  }
  return Object.freeze({ preview, apply, reconcile, status: () => ({ status: active ? 'OFFLINE_FIXTURE_ONLY' : 'UNCONFIGURED', productionActivation: false }) });
}
module.exports = { createLegacyService, createLegacyFixtureTransport };
