const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { verifyBundledInventory } = require('../src/main/input-driver-lifecycle/bundled-inventory.cjs');
const source = path.resolve(__dirname, '../vendor/hidusbf');

test('official bundle identity never grants production installation', () => {
  const result = verifyBundledInventory(source);
  assert.equal(result.identity, 'VERIFIED');
  assert.equal(result.selectedFileCount, 10);
  assert.equal(result.eligibleForInstallation, false);
  assert.equal(result.productionActivation, 'UNCONFIGURED');
});

for (const [name, mutate, message] of [
  ['changed SYS', (root) => fs.appendFileSync(path.join(root, 'payload/DRIVER/AMD64_AS/NoPatch/hidusbf.sys'), 'x'), /Payload identity/],
  ['changed archive', (root) => fs.appendFileSync(path.join(root, 'archives/hidusbf.zip'), 'x'), /Archive identity/],
  ['changed inventory', (root) => fs.appendFileSync(path.join(root, 'inventory.json'), ' '), /inventory digest/],
  ['extra executable', (root) => fs.writeFileSync(path.join(root, 'payload/Setup.exe'), 'x'), /Unexpected or missing/],
  ['missing notice', (root) => fs.unlinkSync(path.join(root, 'payload/README.ENG.TXT')), /Unexpected or missing/],
  ['linked payload directory', (root) => {
    fs.renameSync(path.join(root, 'payload'), path.join(root, 'original'));
    fs.symlinkSync(path.join(root, 'original'), path.join(root, 'payload'), 'junction');
  }, /Linked/],
]) {
  test(`bundle refuses ${name}`, () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dialed-bundle-test-'));
    try {
      fs.cpSync(source, root, { recursive: true });
      mutate(root);
      assert.throws(() => verifyBundledInventory(root), message);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
}
