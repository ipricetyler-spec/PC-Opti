const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const artifactRoot = path.join(root, 'dist-electron');
if (!fs.existsSync(artifactRoot)) throw new Error('dist-electron does not exist. Build release artifacts first.');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const productName = String(packageJson.build?.productName || packageJson.name || '').trim();
const version = String(packageJson.version || '').trim();
const currentArtifacts = new Set([
  `${productName} ${version}.exe`,
  `${productName} Setup ${version}.exe`,
  `${productName} ${version}.msi`,
  `${productName} ${version}.zip`,
]);

const files = fs.readdirSync(artifactRoot, { withFileTypes: true })
  .filter((entry) => entry.isFile() && currentArtifacts.has(entry.name))
  .map((entry) => entry.name)
  .sort();
if (!files.length) throw new Error('No release artifacts were found in dist-electron.');

const lines = files.map((name) => {
  const digest = crypto.createHash('sha256').update(fs.readFileSync(path.join(artifactRoot, name))).digest('hex');
  return `${digest} *${name}`;
});
const output = path.join(artifactRoot, 'SHA256SUMS.txt');
fs.writeFileSync(output, `${lines.join('\n')}\n`, 'utf8');
console.log(`Wrote checksums for ${files.length} artifact(s) to ${output}`);
