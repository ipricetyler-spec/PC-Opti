const assert = require('node:assert/strict');
const { test } = require('node:test');
const { isAllowedAppNavigation, normalizeExternalTarget } = require('../src/main/navigation/index.cjs');

test('external targets allow credential-free public HTTPS and simple email links', () => {
  assert.equal(normalizeExternalTarget('https://learn.microsoft.com/en-us/windows/'), 'https://learn.microsoft.com/en-us/windows/');
  assert.equal(normalizeExternalTarget('mailto:support@example.com'), 'mailto:support@example.com');
});

test('external targets reject downgrade, credentials, local hosts, numeric hosts and email headers', () => {
  for (const target of [
    'http://example.com',
    'https://user:secret@example.com',
    'https://localhost/help',
    'https://127.0.0.1/help',
    'https://example.com:8443/help',
    'mailto:support@example.com?subject=Injected',
  ]) assert.throws(() => normalizeExternalTarget(target));
});

test('development navigation requires the exact trusted origin', () => {
  const trusted = 'http://127.0.0.1:4173/';
  assert.equal(isAllowedAppNavigation('http://127.0.0.1:4173/settings?tab=themes', trusted), true);
  assert.equal(isAllowedAppNavigation('http://127.0.0.1:4173.evil.test/', trusted), false);
  assert.equal(isAllowedAppNavigation('http://127.0.0.1:5173/', trusted), false);
});

test('packaged navigation stays on the exact bundled entry file', () => {
  const trusted = 'file:///E:/Dialed/resources/app.asar/dist/index.html';
  assert.equal(isAllowedAppNavigation(`${trusted}#settings`, trusted), true);
  assert.equal(isAllowedAppNavigation('file:///E:/Dialed/resources/app.asar/dist/other.html', trusted), false);
  assert.equal(isAllowedAppNavigation('https://example.com/', trusted), false);
});
