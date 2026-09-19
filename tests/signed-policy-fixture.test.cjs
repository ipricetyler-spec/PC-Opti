const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const workflow = require('../scripts/native-release-policy.cjs');

test('signed fixture is optional for verification but never accepted by prepare or anchors', () => {
  const args = ['verify', '--review', 'r', '--candidate', 'c', '--public-key', 'k', '--fingerprint', 'f', '--policy-dir', 'p'];
  assert.equal(workflow.argumentsFor(args).options['signed-fixture'], undefined);
  assert.equal(workflow.argumentsFor([...args, '--signed-fixture', 's']).options['signed-fixture'], 's');
  assert.throws(() => workflow.argumentsFor([...args, '--signed-fixture', 's', '--signed-fixture', 't']));
  assert.throws(() => workflow.argumentsFor(['anchors', '--public-key', 'k', '--fingerprint', 'f', '--signed-fixture', 's']));
});

test('fixture verification refuses incomplete or mismatched trust evidence before launching a process', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dialed-signed-fixture-'));
  const file = path.join(directory, 'manifest.json');
  const thumbprint = 'C'.repeat(40);
  try {
    for (const bad of [{}, { status: 'SIGNED_POLICY_FIXTURE', publisherThumbprint: 'A'.repeat(40), files: [], sources: [] }, { status: 'SIGNED_POLICY_FIXTURE', publisherThumbprint: thumbprint, directory, files: Array(4).fill({ file: 'duplicate.exe' }), sources: [{ file: 'missing.cs' }] }]) {
      fs.writeFileSync(file, JSON.stringify(bad));
      assert.throws(() => workflow.signedFixture(file, thumbprint), /fixture|Duplicate/);
    }
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
