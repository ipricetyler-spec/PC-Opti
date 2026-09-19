const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { createPreviewStore } = require('../src/main/shared/preview-store.cjs');

test('shared preview store retains multiple live tokens only when requested and prunes expired entries', () => {
  let clock = 0;
  const tokens = ['token-a', 'token-b', 'token-c'];
  const store = createPreviewStore({
    now: () => clock,
    ttlMs: 10,
    replaceExisting: false,
    createToken: () => tokens.shift(),
  });
  const first = store.issue({ value: 'first' });
  const second = store.issue({ value: 'second' });
  assert.equal(store.take(first.token).preview.value, 'first');
  assert.equal(store.peek(second.token).preview.value, 'second');
  clock = 11;
  store.issue({ value: 'third' });
  assert.throws(() => store.take(second.token), /missing/);
});

test('shared preview store supports non-expiring latest-only authority and explicit clearing', () => {
  let token = 0;
  const store = createPreviewStore({ ttlMs: null, createToken: () => `token-${++token}` });
  const first = store.issue({ value: 'first' });
  const second = store.issue({ value: 'second' });
  assert.throws(() => store.take(first.token), /missing/);
  assert.equal(store.peekLatest().preview.value, 'second');
  assert.equal(store.takeLatest().token, second.token);
  assert.throws(() => store.takeLatest(), /missing/);
  store.issue({ value: 'third' });
  store.clear();
  assert.throws(() => store.peekLatest(), /missing/);
});

test('shared preview store preserves caller-specific errors and queue-time expiry checks', () => {
  let clock = 0;
  const store = createPreviewStore({
    now: () => clock,
    ttlMs: 10,
    makeError: (reason) => Object.assign(new Error(reason), { code: reason }),
  });
  const pending = store.issue({ value: 'queued' });
  const taken = store.take(pending.token);
  clock = 10;
  assert.throws(() => store.assertFresh(taken), (error) => error.code === 'EXPIRED_WHILE_QUEUED');
  assert.throws(() => store.take(pending.token), (error) => error.code === 'MISSING_OR_USED');
});

test('all four main-process consumers use the shared preview-store implementation', () => {
  const root = path.join(__dirname, '..');
  const sources = [
    fs.readFileSync(path.join(root, 'electron', 'main.cjs'), 'utf8'),
    fs.readFileSync(path.join(root, 'src', 'main', 'game-profiles', 'index.cjs'), 'utf8'),
    fs.readFileSync(path.join(root, 'src', 'main', 'input-devices', 'index.cjs'), 'utf8'),
    fs.readFileSync(path.join(root, 'src', 'main', 'input-driver-lifecycle', 'index.cjs'), 'utf8'),
  ];
  assert.match(sources[0], /shared\/preview-store\.cjs/);
  assert.match(sources[0], /networkProbeConsentPreviews = createMainPreviewStore/);
  assert.match(sources[0], /presentMonCaptureConsentPreviews = createMainPreviewStore/);
  assert.match(sources[2], /shared\/preview-store\.cjs/);
  assert.match(sources[3], /shared\/preview-store\.cjs/);
  assert.doesNotMatch(sources.join('\n'), /function createPreviewStore\(/);
  assert.doesNotMatch(sources[0], /latest(?:AuditExport|JournalDeletion|BenchmarkImport|PresentMonImport|BenchmarkDeletion|PolicyThrottle|GameConfigRestore|OptionalAppRemoval|PresentMonDeletion)/);
  assert.doesNotMatch(sources[2], /(?:previews|tierPreviews) = new Map\(/);
  assert.doesNotMatch(sources[3], /previewTokens = new Map\(/);
});

test('game-profile browser fixtures use the shared store without exposing its private wrapper', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'check-game-profiles-ui.cjs'), 'utf8');

  assert.match(source, /require\('\.\.\/src\/main\/shared\/preview-store\.cjs'\)/);
  assert.doesNotMatch(source, /profiles\.createPreviewStore/);
  assert.match(source, /return \{ \.\.\.pending\.preview, token: pending\.token \}/);
  assert.match(source, /publicRestorePreview\(issued\.preview, issued\.token\)/);
});
