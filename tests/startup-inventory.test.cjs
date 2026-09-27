const test = require('node:test');
const assert = require('node:assert/strict');
const scanner = require('../src/main/scanner/index.cjs');

const run = (name, value, extra = {}) => ({
  name, path: value, value, source: 'Registry', enabled: true, scope: 'Current user', canDisable: true,
  registryPath: 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run', registryView: 'Registry64', valueName: name, registryValueKind: 'String', ...extra,
});

test("an entry switched off in Task Manager is shown off and not offered again", () => {
  // First bytes as read on the owner's PC: 02 and 06 on, 01 and 03 off, no record = never switched off.
  const [steam, edge, oneDrive, lists, chrome] = scanner.normalizeStartupInventory([
    run('Steam', '"C:\\Program Files (x86)\\Steam\\steam.exe" -silent', { approvedFirstByte: 3 }),
    run('Edge', '"C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe" --no-startup-window', { approvedFirstByte: 1 }),
    run('OneDrive', '"C:\\Users\\me\\AppData\\Local\\Microsoft\\OneDrive\\OneDrive.exe" /background', { approvedFirstByte: 2 }),
    run('Lists', 'C:\\Lists\\lists.exe', { approvedFirstByte: 6 }),
    run('Chrome', 'C:\\Chrome\\chrome.exe', { approvedFirstByte: null }),
  ]).sort((a, b) => ['Steam', 'Edge', 'OneDrive', 'Lists', 'Chrome'].indexOf(a.name) - ['Steam', 'Edge', 'OneDrive', 'Lists', 'Chrome'].indexOf(b.name));
  for (const item of [steam, edge]) {
    assert.equal(item.enabled, false, item.name);
    assert.equal(item.offInTaskManager, true, item.name);
    assert.equal(item.canDisable, false, item.name);
  }
  for (const item of [oneDrive, lists, chrome]) {
    assert.equal(item.enabled, true, item.name);
    assert.equal(item.offInTaskManager, false, item.name);
    assert.equal(item.canDisable, true, item.name);
  }
});

test('Windows Security and anti-cheat entries are never offered for disabling', () => {
  const items = scanner.normalizeStartupInventory([
    run('SecurityHealth', '%windir%\\system32\\SecurityHealthSystray.exe', { registryPath: 'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run', approvedFirstByte: 6 }),
    run('Riot Vanguard', '"C:\\Program Files\\Riot Vanguard\\vgtray.exe"', { registryPath: 'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run', approvedFirstByte: 2 }),
    run('Something', 'C:\\Tools\\vgtray-helper.exe'),
  ]);
  const byName = Object.fromEntries(items.map((item) => [item.name, item]));
  assert.equal(byName.SecurityHealth.protection, 'security');
  assert.equal(byName.SecurityHealth.canDisable, false);
  assert.equal(byName['Riot Vanguard'].protection, 'anti-cheat');
  assert.equal(byName['Riot Vanguard'].canDisable, false);
  assert.equal(byName.Something.protection, null, 'only the exact executable name counts');
  assert.equal(byName.Something.canDisable, true);
});

test('the inventory script reads Task Manager records without unrolling them', () => {
  const source = require('node:fs').readFileSync(require.resolve('../src/main/scanner/index.cjs'), 'utf8');
  assert.match(source, /StartupApproved/);
  assert.match(source, /\$approved = \$null\s+if \(\$null -ne \$approvedKey\) \{ \$approved = \$approvedKey\.GetValue\(\$valueName, \$null\) \}/);
  assert.match(source, /'Run32'/);
});
