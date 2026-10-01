const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { tempDir } = require('./helpers/temp-dir.cjs');
const { runHidusbfFixture } = require('./helpers/hidusbf-fixture.cjs');
const { latestVerifiedPayload, summarizeSetupRecord, readSetupRecord } = require('../src/main/input-devices/setup-record.cjs');

const dotnet = spawnSync('dotnet', ['--version'], { windowsHide: true, encoding: 'utf8', timeout: 10000 });

test('the read-only reader verifies a journal written by the real native JournalLog', { skip: process.platform !== 'win32' || dotnet.status !== 0 ? 'Windows .NET SDK unavailable' : false, timeout: 300000 }, () => {
  const programData = tempDir('dialed-setup-record-');
  const folder = path.join(programData, 'Dialed', 'HidusbfLifecycle');
  fs.mkdirSync(folder, { recursive: true });
  const file = path.join(folder, 'journal.bin');
  try {
    runHidusbfFixture(['--write-journal-sample', file]);
    const bytes = fs.readFileSync(file);
    assert.equal(JSON.parse(latestVerifiedPayload(bytes)).Note, 'Unicode check: café', 'the latest verified record');
    assert.deepEqual(readSetupRecord(programData), { state: 'NEEDS_REVIEW', ownedDeviceIds: ['a'.repeat(64), 'b'.repeat(64)] });
    // Any altered byte breaks the chain, and the result is unknown, never fine.
    const altered = Buffer.from(bytes); altered[10] ^= 1; fs.writeFileSync(file, altered);
    assert.equal(readSetupRecord(programData), null);
    // An unfinished write (truncated record) is unknown too.
    fs.writeFileSync(file, bytes.subarray(0, bytes.length - 5));
    assert.equal(readSetupRecord(programData), null);
    fs.writeFileSync(file, bytes);
    assert.deepEqual(readSetupRecord(programData).state, 'NEEDS_REVIEW');
    // Reading never changed the file.
    assert.deepEqual(fs.readFileSync(file), bytes);
  } finally { fs.rmSync(programData, { recursive: true, force: true }); }
});

test('no record, a linked path or a malformed payload are told apart from a healthy record', () => {
  const programData = tempDir('dialed-setup-record-none-');
  try {
    assert.deepEqual(readSetupRecord(programData), { state: 'NONE', ownedDeviceIds: [] });
    assert.equal(readSetupRecord('relative'), null);
    assert.equal(readSetupRecord(programData, { lstatSync: () => ({ isSymbolicLink: () => true, isFile: () => true, size: 1 }) }), null);
  } finally { fs.rmSync(programData, { recursive: true, force: true }); }
  assert.equal(summarizeSetupRecord('not json'), null);
  assert.equal(summarizeSetupRecord('{"Ownership":{}}'), null);
  assert.equal(summarizeSetupRecord('{"NeedsReview":false,"Pending":{"x":1},"Ownership":{"Devices":{}}}').state, 'PENDING');
  assert.equal(summarizeSetupRecord('{"NeedsReview":false,"Pending":null,"Ownership":{"Devices":{}}}').state, 'OK');
});
