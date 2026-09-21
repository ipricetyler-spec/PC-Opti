const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { resolveSigningConfiguration, verifySignature } = require('./windows-signing.cjs');

const ROOT = path.resolve(__dirname, '..');
const ARTIFACT_ROOT = path.join(ROOT, 'dist-electron');

if (!fs.existsSync(ARTIFACT_ROOT)) {
  throw new Error('dist-electron does not exist. Run bun run electron:build first.');
}

function git(cmd) {
  try {
    return childProcess.execSync(cmd, { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

const packagePath = path.join(ROOT, 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
const productName = String(packageJson.build?.productName || packageJson.name || '').trim();
const version = String(packageJson.version || '').trim();
const currentArtifacts = new Set([
  `${productName} Setup ${version}.exe`,
  `${productName} ${version}.msi`,
  `${productName} ${version}.zip`,
]);
const artifactNames = fs
  .readdirSync(ARTIFACT_ROOT)
  .filter((name) => fs.statSync(path.join(ARTIFACT_ROOT, name)).isFile() && currentArtifacts.has(name))
  .sort();

if (!artifactNames.length) {
  throw new Error(`No release artifacts were found for ${productName} ${version}.`);
}

function sha256(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function getAuthenticodeStatus(exePath) {
  if (process.platform !== 'win32') return 'not-checked-windows-only';
  try {
    const verification = verifySignature(exePath, resolveSigningConfiguration());
    if (verification.valid) return 'Valid';
    return /No signature found/i.test(verification.error || '') ? 'NotSigned' : 'not-valid-or-unavailable';
  } catch {
    return 'not-available';
  }
}

function collectSigningSignals() {
  const reportPath = path.join(ARTIFACT_ROOT, 'CODESIGN_REPORT.json');
  if (!fs.existsSync(reportPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  } catch {
    return { parsed: false };
  }
}

const artifactEntries = artifactNames.map((name) => {
  const fullPath = path.join(ARTIFACT_ROOT, name);
  const stats = fs.statSync(fullPath);
  const statsObj = {
    fileName: name,
    sizeBytes: stats.size,
    sha256: sha256(fullPath),
  };
  if (/\.exe$/i.test(name)) {
    return { ...statsObj, authenticodeStatus: getAuthenticodeStatus(fullPath) };
  }
  return statsObj;
});

const checksumsPath = path.join(ARTIFACT_ROOT, 'SHA256SUMS.txt');
const checksumsAvailable = fs.existsSync(checksumsPath);
const signingReport = collectSigningSignals();
const signedArtifacts = new Set(Array.isArray(signingReport?.verified) ? signingReport.verified : []);
const allCurrentArtifactsSigned = artifactEntries.length > 0
  && artifactEntries.every((artifact) => signedArtifacts.has(artifact.fileName))
  && Array.isArray(signingReport?.errors)
  && signingReport.errors.length === 0;

const releaseManifest = {
  generatedAt: new Date().toISOString(),
  package: {
    name: packageJson.name,
    version: packageJson.version,
    appId: packageJson.build?.appId,
    productName: packageJson.build?.productName,
    author: packageJson.author,
  },
  git: {
    head: git('git rev-parse HEAD'),
    branch: git('git rev-parse --abbrev-ref HEAD'),
    remoteOrigin: git('git remote get-url origin'),
  },
  environment: {
    node: process.version,
    platform: process.platform,
    architecture: process.arch,
  },
  artifacts: artifactEntries,
  checksumsFile: 'SHA256SUMS.txt',
  notes: {
    releaseMode: allCurrentArtifactsSigned
      ? (packageJson.version.includes('alpha') ? 'pre-release' : 'release')
      : 'unsigned-test-candidate',
    monetization: 'deferred',
    checkoutConfig: {
      enabled: false,
      provider: packageJson.dialed?.checkoutProvider || null,
    },
    checksumsFilePresent: checksumsAvailable,
  },
  signing: signingReport,
};

const manifestPath = path.join(ARTIFACT_ROOT, 'RELEASE_MANIFEST.json');
fs.writeFileSync(manifestPath, `${JSON.stringify(releaseManifest, null, 2)}\n`, 'utf8');
console.log(`Wrote release manifest: ${manifestPath}`);
