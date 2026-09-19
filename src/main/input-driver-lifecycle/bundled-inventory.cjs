// Read-only repository/package identity check. Never grants installation authority.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const INVENTORY_SHA256 = '1040aabbeb2001175240d7550a412c370081cce6b0dbedd1445b2adc12f36d9e';
const ARCHIVES = Object.freeze({
  'hidusbf.zip': 'bd8d1fb0545d8df88d9cef0c67682daef7d304561bc64acfee5c0d8c12d0f797',
  'hidusbfn.zip': '19da9ed6ec04aef9f231b6d62d92073c3faf639ef56fc6bbe48511ef880ea14c',
});
const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

function regularFile(root, relative) {
  if (relative.includes('\\') || relative.split('/').some((part) => !part || part === '.' || part === '..') || path.isAbsolute(relative)) throw new Error('Unsafe inventory path.');
  let current = root;
  for (const part of relative.split('/')) {
    current = path.join(current, part);
    if (fs.lstatSync(current).isSymbolicLink()) throw new Error('Linked inventory path refused.');
  }
  if (!fs.lstatSync(current).isFile()) throw new Error('Inventory entry is not a regular file.');
  return fs.readFileSync(current);
}

function listFiles(root, prefix = '') {
  if (fs.lstatSync(root).isSymbolicLink()) throw new Error('Linked payload refused.');
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isSymbolicLink()) throw new Error('Linked payload refused.');
    const relative = prefix + entry.name;
    if (entry.isDirectory()) return listFiles(path.join(root, entry.name), relative + '/');
    if (!entry.isFile()) throw new Error('Non-file payload refused.');
    return [relative];
  }).sort();
}

function verifyBundledInventory(directory, { packaged = false } = {}) {
  const root = path.resolve(directory);
  if (fs.lstatSync(root).isSymbolicLink()) throw new Error('Linked bundle refused.');
  const bytes = regularFile(root, 'inventory.json');
  if (hash(bytes) !== INVENTORY_SHA256) throw new Error('Unreviewed inventory digest.');
  const inventory = JSON.parse(bytes.toString('utf8'));
  if (!packaged) for (const [name, digest] of Object.entries(ARCHIVES)) {
    if (hash(regularFile(root, `archives/${name}`)) !== digest) throw new Error(`Archive identity mismatch: ${name}`);
  }
  if (packaged) {
    const names = fs.readdirSync(root).sort();
    if (JSON.stringify(names) !== JSON.stringify(['README.md', 'inventory.json', 'payload'])) throw new Error('Unexpected bundle resource.');
    regularFile(root, 'README.md');
  }
  const selected = inventory.files.filter((file) => file.selected);
  const actual = listFiles(path.join(root, 'payload'));
  const expected = selected.map((file) => file.path).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error('Unexpected or missing payload file.');
  for (const file of selected) {
    const payload = regularFile(root, `payload/${file.path}`);
    if (payload.length !== file.bytes || hash(payload) !== file.sha256) throw new Error(`Payload identity mismatch: ${file.path}`);
  }
  return Object.freeze({
    identity: 'VERIFIED', commit: inventory.commit, inventorySha256: INVENTORY_SHA256,
    selectedFileCount: selected.length, inventoriedFileCount: inventory.files.length,
    architecture: inventory.architecture, credit: inventory.credit,
    productionActivation: 'UNCONFIGURED', eligibleForInstallation: false, packaged,
    reason: 'Identity only; authenticated native transport, target policy compatibility and physical lifecycle acceptance remain pending.',
  });
}

module.exports = { verifyBundledInventory, INVENTORY_SHA256, ARCHIVES };
