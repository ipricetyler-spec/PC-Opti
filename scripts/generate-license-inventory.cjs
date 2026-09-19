const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SCHEMA_VERSION = '1.0.0';
const MAX_PACKAGES = 2000;
const MAX_METADATA_LENGTH = 2048;
const DISCLAIMER = 'Automated package metadata is a review input, not legal advice, license clearance, or proof that notice and redistribution obligations are complete.';

function parseJsonWithTrailingCommas(text) {
  let output = '';
  let inString = false;
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (inString) {
      output += character;
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      output += character;
      continue;
    }
    if (character === ',') {
      let lookahead = index + 1;
      while (/\s/.test(text[lookahead] || '')) lookahead += 1;
      if (text[lookahead] === '}' || text[lookahead] === ']') continue;
    }
    output += character;
  }
  return JSON.parse(output);
}

function boundedText(value, fallback = 'UNKNOWN') {
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim().replace(/\s+/g, ' ');
  return normalized && normalized.length <= MAX_METADATA_LENGTH ? normalized : fallback;
}

function normalizeLicense(manifest) {
  const values = [];
  if (typeof manifest?.license === 'string') values.push(manifest.license);
  else if (manifest?.license && typeof manifest.license.type === 'string') values.push(manifest.license.type);
  if (Array.isArray(manifest?.licenses)) {
    for (const license of manifest.licenses) {
      if (typeof license === 'string') values.push(license);
      else if (license && typeof license.type === 'string') values.push(license.type);
    }
  }
  const normalized = [...new Set(values.map((value) => boundedText(value)).filter((value) => value !== 'UNKNOWN'))].sort();
  return normalized.length ? normalized.join(' OR ') : 'UNKNOWN';
}

function normalizeSource(value) {
  const candidate = typeof value === 'string' ? value : value?.url;
  const normalized = boundedText(candidate);
  if (normalized === 'UNKNOWN') return normalized;
  if (/^(?:[A-Za-z]:[\\/]|\\\\|\/|file:)/i.test(normalized)) return 'UNKNOWN';
  return normalized;
}

function manifestDirectories(modulesPath) {
  const results = [];
  const visited = new Set();

  function visitNodeModules(directory) {
    const resolved = path.resolve(directory);
    if (visited.has(resolved) || !fs.existsSync(resolved)) return;
    visited.add(resolved);
    for (const entry of fs.readdirSync(resolved, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || entry.name.startsWith('.')) continue;
      const entryPath = path.join(resolved, entry.name);
      if (entry.name.startsWith('@')) {
        for (const child of fs.readdirSync(entryPath, { withFileTypes: true })) {
          if (child.isDirectory() && !child.isSymbolicLink()) visitPackage(path.join(entryPath, child.name));
        }
      } else {
        visitPackage(entryPath);
      }
    }
  }

  function visitPackage(directory) {
    const manifestPath = path.join(directory, 'package.json');
    if (fs.existsSync(manifestPath)) results.push(manifestPath);
    if (results.length > MAX_PACKAGES * 4) throw new Error('Installed package metadata exceeds the inventory traversal limit.');
    visitNodeModules(path.join(directory, 'node_modules'));
  }

  visitNodeModules(modulesPath);
  return results;
}

function installedMetadata(modulesPath) {
  const metadata = new Map();
  for (const manifestPath of manifestDirectories(modulesPath)) {
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      if (!manifest.name || !manifest.version) continue;
      const key = `${manifest.name}@${manifest.version}`;
      if (!metadata.has(key)) metadata.set(key, manifest);
    } catch {
      // A missing or invalid installed manifest becomes explicit UNKNOWN metadata below.
    }
  }
  return metadata;
}

function nameAndVersion(specification) {
  const separator = specification.lastIndexOf('@');
  if (separator <= 0 || separator === specification.length - 1) throw new Error(`Invalid resolved package specification: ${specification}`);
  return { name: specification.slice(0, separator), version: specification.slice(separator + 1) };
}

function buildInventory(root) {
  const packageManifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const lockBytes = fs.readFileSync(path.join(root, 'bun.lock'));
  const lock = parseJsonWithTrailingCommas(lockBytes.toString('utf8'));
  const installed = installedMetadata(path.join(root, 'node_modules'));
  const production = new Set(Object.keys(packageManifest.dependencies || {}));
  const development = new Set(Object.keys(packageManifest.devDependencies || {}));
  const records = [];

  for (const [lockKey, value] of Object.entries(lock.packages || {})) {
    if (!Array.isArray(value) || typeof value[0] !== 'string') throw new Error(`bun.lock package ${lockKey} has an unsupported record.`);
    const { name, version } = nameAndVersion(value[0]);
    const manifest = installed.get(`${name}@${version}`);
    let relationship = 'RESOLVED';
    if (lockKey === name && production.has(name)) relationship = 'DIRECT_PRODUCTION';
    else if (lockKey === name && development.has(name)) relationship = 'DIRECT_DEVELOPMENT';
    records.push({
      name,
      version,
      relationship,
      declaredLicense: normalizeLicense(manifest),
      repository: normalizeSource(manifest?.repository),
      homepage: normalizeSource(manifest?.homepage),
      metadataStatus: manifest ? 'INSTALLED_MANIFEST' : 'NOT_INSTALLED',
    });
  }

  if (records.length === 0 || records.length > MAX_PACKAGES) throw new Error(`Resolved package count must be between 1 and ${MAX_PACKAGES}.`);
  records.sort((left, right) => left.name.localeCompare(right.name) || left.version.localeCompare(right.version) || left.relationship.localeCompare(right.relationship));
  const directNames = new Set(records.filter((record) => record.relationship.startsWith('DIRECT_')).map((record) => record.name));
  for (const name of [...production, ...development]) {
    if (!directNames.has(name)) throw new Error(`Direct dependency ${name} is missing from the resolved Bun lockfile inventory.`);
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    application: { name: packageManifest.name, version: packageManifest.version, license: boundedText(packageManifest.license) },
    source: {
      lockfile: 'bun.lock',
      lockfileSha256: crypto.createHash('sha256').update(lockBytes).digest('hex'),
      metadata: 'Installed package.json manifests matched to resolved bun.lock name and version records',
    },
    disclaimer: DISCLAIMER,
    summary: {
      packageCount: records.length,
      directProductionCount: records.filter((record) => record.relationship === 'DIRECT_PRODUCTION').length,
      directDevelopmentCount: records.filter((record) => record.relationship === 'DIRECT_DEVELOPMENT').length,
      unknownLicenseCount: records.filter((record) => record.declaredLicense === 'UNKNOWN').length,
      notInstalledCount: records.filter((record) => record.metadataStatus === 'NOT_INSTALLED').length,
    },
    packages: records,
  };
}

function renderReview(inventory) {
  const flagged = inventory.packages.filter((record) => record.declaredLicense === 'UNKNOWN' || record.metadataStatus !== 'INSTALLED_MANIFEST');
  const direct = inventory.packages.filter((record) => record.relationship !== 'RESOLVED');
  const rows = (items) => items.map((record) => `| ${record.name} | ${record.version} | ${record.relationship} | ${record.declaredLicense} | ${record.metadataStatus} |`).join('\n') || '| None | - | - | - | - |';
  return `# Third-party metadata review input\n\n${inventory.disclaimer}\n\nSource: \`${inventory.source.lockfile}\` SHA-256 \`${inventory.source.lockfileSha256}\`. Output is deterministic for the same lockfile and installed manifests; it does not include local absolute paths or license-text conclusions.\n\n## Summary\n\n- Resolved packages: ${inventory.summary.packageCount}\n- Direct production: ${inventory.summary.directProductionCount}\n- Direct development: ${inventory.summary.directDevelopmentCount}\n- Declared license unknown: ${inventory.summary.unknownLicenseCount}\n- Resolved records not installed on this platform: ${inventory.summary.notInstalledCount}\n\n## Direct dependencies\n\n| Package | Version | Relationship | Declared license | Metadata |\n| --- | --- | --- | --- | --- |\n${rows(direct)}\n\n## Requires human review\n\nThese entries have missing declared-license metadata or were not installed on this platform. Human review must also confirm license texts, notices, bundled assets, Electron/Chromium obligations, and redistribution terms for entries not listed here.\n\n| Package | Version | Relationship | Declared license | Metadata |\n| --- | --- | --- | --- | --- |\n${rows(flagged)}\n`;
}

function writeInventory(root) {
  const inventory = buildInventory(root);
  const outputDirectory = path.join(root, 'dist');
  fs.mkdirSync(outputDirectory, { recursive: true });
  fs.writeFileSync(path.join(outputDirectory, 'third-party-inventory.json'), `${JSON.stringify(inventory, null, 2)}\n`, 'utf8');
  fs.writeFileSync(path.join(outputDirectory, 'THIRD-PARTY-REVIEW.md'), renderReview(inventory), 'utf8');
  return inventory;
}

if (require.main === module) {
  const root = path.resolve(__dirname, '..');
  const inventory = writeInventory(root);
  console.log(`Wrote declared-license review metadata for ${inventory.summary.packageCount} resolved package records.`);
}

module.exports = {
  DISCLAIMER,
  buildInventory,
  normalizeLicense,
  normalizeSource,
  parseJsonWithTrailingCommas,
  renderReview,
  writeInventory,
};
