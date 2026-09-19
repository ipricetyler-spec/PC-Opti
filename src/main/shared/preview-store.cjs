const crypto = require('node:crypto');

const DEFAULT_PREVIEW_TTL_MS = 5 * 60 * 1000;

function defaultPreviewError(reason) {
  if (reason === 'EXPIRED_WHILE_QUEUED') return new Error('Preview expired while queued. Request a new preview.');
  return new Error('Preview is missing, expired or already used. Request a new preview.');
}

// Main-owned, short-lived, single-use authority. Callers choose whether a new
// preview replaces the previous one and can preserve their domain-specific
// token format, TTL, cloning, and error contract.
function createPreviewStore(options = {}) {
  const config = typeof options === 'function' ? { now: options } : options;
  const now = typeof config.now === 'function' ? config.now : Date.now;
  const createToken = typeof config.createToken === 'function' ? config.createToken : crypto.randomUUID;
  const clone = typeof config.clone === 'function' ? config.clone : (value) => value;
  const makeError = typeof config.makeError === 'function' ? config.makeError : defaultPreviewError;
  const replaceExisting = config.replaceExisting !== false;
  const ttlMs = config.ttlMs === undefined ? DEFAULT_PREVIEW_TTL_MS : config.ttlMs;
  if (ttlMs !== null && (!Number.isSafeInteger(ttlMs) || ttlMs <= 0)) throw new TypeError('Preview TTL must be a positive safe integer or null.');

  const entries = new Map();
  const issuedEntries = new WeakSet();
  let latestToken = null;

  function error(reason) {
    const failure = makeError(reason);
    if (!(failure instanceof Error)) throw new TypeError('Preview error factory must return an Error.');
    return failure;
  }

  function readNow() {
    const value = now();
    if (!Number.isFinite(value)) throw new TypeError('Preview clock must return a finite number.');
    return value;
  }

  function isExpired(entry, timestamp) {
    return entry.expiresAt !== null && entry.expiresAt <= timestamp;
  }

  function prune(timestamp = readNow()) {
    for (const [token, entry] of entries) {
      if (!isExpired(entry, timestamp)) continue;
      entries.delete(token);
      if (latestToken === token) latestToken = null;
    }
  }

  function clear() {
    entries.clear();
    latestToken = null;
  }

  function issue(preview) {
    const issuedAt = readNow();
    prune(issuedAt);
    if (replaceExisting) clear();
    const token = createToken();
    if (typeof token !== 'string' || token.length === 0 || entries.has(token)) throw new Error('Preview token generation failed.');
    const entry = {
      token,
      preview: clone(preview),
      expiresAt: ttlMs === null ? null : issuedAt + ttlMs,
    };
    entries.set(token, entry);
    issuedEntries.add(entry);
    latestToken = token;
    return entry;
  }

  function lookup(token, consume) {
    const entry = entries.get(token);
    if (!entry) throw error('MISSING_OR_USED');
    if (consume) {
      entries.delete(token);
      if (latestToken === token) latestToken = null;
    }
    if (isExpired(entry, readNow())) {
      entries.delete(token);
      if (latestToken === token) latestToken = null;
      throw error('EXPIRED');
    }
    return entry;
  }

  function take(token) {
    return lookup(token, true);
  }

  function peek(token) {
    return lookup(token, false);
  }

  function takeLatest() {
    if (!latestToken) throw error('MISSING_OR_USED');
    return take(latestToken);
  }

  function peekLatest() {
    if (!latestToken) throw error('MISSING_OR_USED');
    return peek(latestToken);
  }

  function assertFresh(entry) {
    if (!entry || !issuedEntries.has(entry)) throw error('MISSING_OR_USED');
    if (isExpired(entry, readNow())) throw error('EXPIRED_WHILE_QUEUED');
    return entry;
  }

  return Object.freeze({ clear, issue, take, peek, takeLatest, peekLatest, assertFresh, prune });
}

module.exports = { DEFAULT_PREVIEW_TTL_MS, createPreviewStore };
