const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { afterEach, test } = require('node:test');

const scanner = require('../src/main/scanner/index.cjs');
const journal = require('../src/main/journal/index.cjs');

const temporaryDirectories = [];

function createJournal(entries) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-opti-test-'));
  temporaryDirectories.push(directory);
  fs.writeFileSync(path.join(directory, 'journal.json'), JSON.stringify(entries), 'utf8');
  return directory;
}

afterEach(() => {
  while (temporaryDirectories.length) {
    fs.rmSync(temporaryDirectories.pop(), { recursive: true, force: true });
  }
});

test('excludes core Windows processes from EcoQoS management', () => {
  assert.equal(scanner.isManageableProcess({ pid: 99, name: 'explorer' }), false);
  assert.equal(scanner.isManageableProcess({ pid: 100, name: 'LSASS' }), false);
  assert.equal(scanner.isManageableProcess({ pid: 4, name: 'third-party-app' }), false);
  assert.equal(scanner.isManageableProcess({ pid: 101, name: 'third-party-app' }), true);
});

test('rejects startup changes outside the current-user Run key', async () => {
  await assert.rejects(
    journal.disableStartupItem(createJournal([]), {
      source: 'Registry',
      canDisable: true,
      registryPath: 'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run',
      valueName: 'UnsafeMachineWideEntry',
      value: 'example.exe',
      registryValueKind: 'String',
    }),
    /outside PC-Opti’s supported Registry scope/
  );
});

test('refuses rollback types that are not explicitly supported', async () => {
  const directory = createJournal([{
    id: 'unknown-rollback',
    status: 'SUCCESS',
    preAction: {},
    rollback: { available: true, kind: 'arbitrary-command', reason: 'unsafe test state' },
  }]);

  await assert.rejects(
    journal.rollbackAuditEntry(directory, 'unknown-rollback'),
    /does not have a supported deterministic rollback/
  );
});

test('refuses an unsafe Registry rollback before it can invoke PowerShell', async () => {
  const directory = createJournal([{
    id: 'machine-wide-rollback',
    status: 'SUCCESS',
    preAction: {
      source: 'Registry',
      registryPath: 'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run',
      valueName: 'UnsafeMachineWideEntry',
      value: 'example.exe',
      registryValueKind: 'String',
    },
    rollback: { available: true, kind: 'restore-registry-run-value', reason: 'unsafe test state' },
  }]);

  await assert.rejects(
    journal.rollbackAuditEntry(directory, 'machine-wide-rollback'),
    /outside PC-Opti’s supported Registry scope/
  );
});
