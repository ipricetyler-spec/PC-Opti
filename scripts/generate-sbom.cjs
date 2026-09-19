const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const modulesPath = path.join(root, 'node_modules');
const outputPath = path.join(root, 'dist', 'sbom.cdx.json');

function packageDirectories() {
  const directories = [];
  for (const entry of fs.readdirSync(modulesPath, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    if (entry.name.startsWith('@')) {
      const scopePath = path.join(modulesPath, entry.name);
      for (const child of fs.readdirSync(scopePath, { withFileTypes: true })) {
        if (child.isDirectory()) directories.push(path.join(scopePath, child.name));
      }
    } else {
      directories.push(path.join(modulesPath, entry.name));
    }
  }
  return directories;
}

function readComponent(directory) {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'));
    if (!manifest.name || !manifest.version) return null;
    const licenses = manifest.license ? [{ license: { id: String(manifest.license) } }] : undefined;
    return {
      type: 'library',
      'bom-ref': `pkg:npm/${encodeURIComponent(manifest.name)}@${manifest.version}`,
      group: manifest.name.startsWith('@') ? manifest.name.split('/')[0] : undefined,
      name: manifest.name,
      version: String(manifest.version),
      purl: `pkg:npm/${encodeURIComponent(manifest.name)}@${manifest.version}`,
      licenses,
    };
  } catch {
    return null;
  }
}

const components = packageDirectories()
  .map(readComponent)
  .filter(Boolean)
  .sort((left, right) => left.name.localeCompare(right.name) || left.version.localeCompare(right.version));
const manifestBytes = fs.readFileSync(path.join(root, 'bun.lock'));
const packageJson = require('../package.json');
const productName = packageJson.build?.productName || packageJson.name;
const document = {
  bomFormat: 'CycloneDX',
  specVersion: '1.5',
  serialNumber: `urn:uuid:${crypto.randomUUID()}`,
  version: 1,
  metadata: {
    timestamp: new Date().toISOString(),
    component: { type: 'application', name: productName, version: packageJson.version },
    properties: [
      { name: 'dialed:lockfile', value: 'bun.lock' },
      { name: 'dialed:bun-lock-sha256', value: crypto.createHash('sha256').update(manifestBytes).digest('hex') },
      { name: 'dialed:scope', value: 'Installed top-level package inventory; dependency relationships are not asserted.' },
    ],
  },
  components,
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
console.log(`Wrote ${components.length} components to ${outputPath}`);
