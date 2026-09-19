const { test } = require('node:test');
const { tempDir } = require('./helpers/temp-dir.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const journal = require('../src/main/journal/index.cjs');

test('maintenance distinguishes command completion, file-byte accounting and unmeasured device effects', async () => {
  const directory = tempDir('dialed-maintenance-evidence-');
  try {
    const clean = await journal.executeMaintenanceAction(directory, 'clear-temp-files', {
      prepareTempState: async () => ({ pathCount: 2 }),
      clearTempFiles: async () => ({ exitCode: 0, stdout: '', stderr: '', output: { deletedFileCount: 1, skippedFileCount: 1, reclaimedBytes: 200 } }),
    });
    assert.equal(clean.success, true);
    assert.equal(clean.result.reclaimedBytes, 200);
    assert.equal(clean.result.observedFreeSpaceChangeBytes, null);
    assert.equal(clean.result.byteAccounting, 'SUM_OF_REMOVED_FILE_LENGTHS');
    const trim = await journal.executeMaintenanceAction(directory, 'retrim-drive:C', {
      isCurrentProcessElevated: async () => true,
      listStorageVolumes: async () => ({ errors: [], items: [{ driveLetter: 'C', isSSD: true, trimEnabled: true }] }),
      retrimDrive: async () => ({ exitCode: 0, stdout: '', stderr: '', output: {} }),
    });
    assert.equal(trim.result.deviceEffect, 'UNVERIFIED');
    assert.equal(trim.result.performanceEffect, 'UNMEASURED');
    const failed = await journal.executeMaintenanceAction(directory, 'clear-temp-files', {
      prepareTempState: async () => ({}),
      clearTempFiles: async () => ({ exitCode: 1, stderr: 'fixture command failed', output: {} }),
    });
    assert.equal(failed.success, false);
    assert.equal(failed.entry.status, 'FAILED');
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('ReTRIM refuses with readable privilege guidance before inventory, dispatch, or journaling', async () => {
  const directory = tempDir('dialed-retrim-preflight-');
  let inventoryCalled = false;
  let retrimCalled = false;
  try {
    await assert.rejects(journal.executeMaintenanceAction(directory, 'retrim-drive:C', {
      isCurrentProcessElevated: async () => false,
      listStorageVolumes: async () => { inventoryCalled = true; return { errors: [], items: [] }; },
      retrimDrive: async () => { retrimCalled = true; return { exitCode: 0, output: {} }; },
    }), /running as administrator.*Local Audit History was not changed/i);
    assert.equal(inventoryCalled, false);
    assert.equal(retrimCalled, false);
    assert.deepEqual(journal.readJournal(directory), []);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
