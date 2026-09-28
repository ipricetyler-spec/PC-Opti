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

test('a packaged build never loads a page named by the environment, and a source run only a local one', () => {
  const { developmentEntryUrl } = require('../src/main/navigation/index.cjs');
  assert.equal(developmentEntryUrl({ isPackaged: true, value: 'http://localhost:5173/' }), null);
  assert.equal(developmentEntryUrl({ isPackaged: true, value: 'https://example.com/' }), null);
  assert.equal(developmentEntryUrl({ isPackaged: false, value: 'http://localhost:5173' }), 'http://localhost:5173/');
  assert.equal(developmentEntryUrl({ isPackaged: false, value: 'http://127.0.0.1:5178/' }), 'http://127.0.0.1:5178/');
  for (const value of ['https://example.com/', 'file:///C:/evil/index.html', 'http://user:pw@localhost/', 'http://localhost.example.com/', 'not a url', '', undefined]) {
    assert.equal(developmentEntryUrl({ isPackaged: false, value }), null, String(value));
  }
});

test('web permissions are denied except writing text to the clipboard, before the window opens', () => {
  const main = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'electron', 'main.cjs'), 'utf8');
  assert.match(main, /const ALLOWED_WEB_PERMISSIONS = new Set\(\['clipboard-sanitized-write'\]\);/);
  assert.match(main, /setPermissionRequestHandler\(\(_contents, permission, callback\) => callback\(ALLOWED_WEB_PERMISSIONS\.has\(permission\)\)\)/);
  assert.match(main, /setPermissionCheckHandler\(\(_contents, permission\) => ALLOWED_WEB_PERMISSIONS\.has\(permission\)\)/);
  assert.ok(main.indexOf('setPermissionRequestHandler') < main.indexOf('  createWindow();\n'), 'set before the first window');
});
