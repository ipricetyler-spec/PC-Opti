const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

// Git can rewrite line endings on checkout; a pinned file changed that way fails its
// integrity check and the feature it guards is switched off. .gitattributes fixes the
// endings; this test checks the files actually on disk.
const root = path.join(__dirname, '..');
const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('PresentMon executable and license on disk match their pinned hashes', () => {
  const source = read('src/main/presentmon/index.cjs');
  const pinned = (key) => new RegExp(`${key}: '([0-9a-f]{64})'`).exec(source)[1];
  assert.equal(sha256('src/main/presentmon/vendor/PresentMon-2.5.1-x64.exe'), pinned('sha256'));
  assert.equal(sha256('src/main/presentmon/vendor/LICENSE.txt'), pinned('licenseSha256'));
});

test('the input-device native helper on disk matches its pinned hash', () => {
  const pinned = /NATIVE_INPUT_SOURCE_SHA256 = '([0-9a-f]{64})'/.exec(read('src/main/input-devices/index.cjs'))[1];
  assert.equal(sha256('src/main/input-devices/usb-native.cs'), pinned);
});

test('every HIDUSBF payload file on disk matches the inventory hash for it', () => {
  const inventory = JSON.parse(read('vendor/hidusbf/inventory.json'));
  const payload = path.join(root, 'vendor', 'hidusbf', 'payload');
  const files = [];
  const walk = (dir) => { for (const name of fs.readdirSync(dir)) { const full = path.join(dir, name); if (fs.statSync(full).isDirectory()) walk(full); else files.push(full); } };
  walk(payload);
  const mismatched = [];
  let pinnedCount = 0;
  for (const full of files) {
    const relative = path.relative(payload, full).split(path.sep).join('/').toLowerCase();
    const pins = inventory.files.filter((item) => item.path.toLowerCase() === relative).map((item) => item.sha256);
    if (!pins.length) continue;
    pinnedCount += 1;
    if (!pins.includes(sha256(path.relative(root, full)))) mismatched.push(relative);
  }
  assert.ok(pinnedCount >= 10, `only ${pinnedCount} pinned payload files found`);
  assert.deepEqual(mismatched, []);
});

test('.gitattributes fixes the line endings of every pinned text file', () => {
  const attributes = read('.gitattributes');
  for (const rule of [
    'src/main/presentmon/vendor/LICENSE.txt   text eol=lf',
    'src/main/input-devices/usb-native.cs     text eol=crlf',
    'vendor/hidusbf/payload/**/*.INF          text eol=crlf',
    'vendor/hidusbf/payload/*.TXT             text eol=crlf',
  ]) assert.ok(attributes.includes(rule), rule);
});
