const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const ARTIFACT_ROOT = path.join(ROOT, 'dist-electron');
const MANIFEST_PATH = path.join(ARTIFACT_ROOT, 'RELEASE_MANIFEST.json');
const CHECKSUMS_PATH = path.join(ARTIFACT_ROOT, 'SHA256SUMS.txt');

function sha256(filePath) {
  const digest = crypto.createHash('sha256');
  digest.update(fs.readFileSync(filePath));
  return digest.digest('hex');
}

function readManifest() {
  if (!fs.existsSync(MANIFEST_PATH)) {
    throw new Error('RELEASE_MANIFEST.json not found. Run bun run release:manifest first.');
  }
  return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
}

function parseChecksumLines() {
  if (!fs.existsSync(CHECKSUMS_PATH)) {
    throw new Error('SHA256SUMS.txt not found. Run bun run release:checksums first.');
  }
  const lines = fs.readFileSync(CHECKSUMS_PATH, 'utf8').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return lines.map((line) => {
    const [, hash, fileName] = /([a-f0-9]{64})\s+\*?(.+)/i.exec(line) || [];
    return hash && fileName ? { fileName, hash: hash.toLowerCase() } : null;
  }).filter(Boolean);
}

function main() {
  if (!fs.existsSync(ARTIFACT_ROOT)) {
    throw new Error('dist-electron does not exist. Build artifacts before verification.');
  }

  const manifest = readManifest();
  const checksumEntries = parseChecksumLines();
  const checksumMap = new Map(checksumEntries.map((entry) => [entry.fileName, entry.hash]));
  const manifestArtifacts = Array.isArray(manifest.artifacts) ? manifest.artifacts : [];
  const failures = [];

  for (const artifact of manifestArtifacts) {
    const filePath = path.join(ARTIFACT_ROOT, artifact.fileName);
    if (!fs.existsSync(filePath)) {
      failures.push(`Missing artifact listed in manifest: ${artifact.fileName}`);
      continue;
    }
    const actual = sha256(filePath);
    if ((artifact.sha256 || '').toLowerCase() !== actual) {
      failures.push(`Checksum mismatch for ${artifact.fileName}`);
    }
    const checksumHash = checksumMap.get(artifact.fileName);
    if (checksumHash && checksumHash !== actual) {
      failures.push(`Checksum file mismatch for ${artifact.fileName}`);
    }
  }

  if (manifest.checksumsFile && manifest.checksumsFile !== 'SHA256SUMS.txt') {
    failures.push(`Manifest checksumsFile is '${manifest.checksumsFile}', expected 'SHA256SUMS.txt'.`);
  }
  if (!fs.existsSync(CHECKSUMS_PATH)) {
    failures.push('checksums file was not found for verification.');
  }

  if (failures.length) {
    console.error(failures.join('\n'));
    throw new Error(`Release verification failed with ${failures.length} issue(s).`);
  }

  console.log('Release manifest and checksum verification passed.');
}

main();

