const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { normalizeUpdateTrust, readAuthenticode, verifyUpdateManifest } = require('../src/main/updater/index.cjs');

const ROOT = path.resolve(__dirname, '..');
const ARTIFACT_ROOT = path.join(ROOT, 'dist-electron');
const FEED_PATH = path.join(ARTIFACT_ROOT, 'UPDATE_FEED.json');
const PACKAGE = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

async function main() {
  const trust = normalizeUpdateTrust(PACKAGE.dialed?.update);
  if (!trust.configured) throw new Error('The package update trust is not configured.');
  if (!fs.existsSync(FEED_PATH) || fs.lstatSync(FEED_PATH).isSymbolicLink()) throw new Error('UPDATE_FEED.json is missing or linked.');
  const release = verifyUpdateManifest(fs.readFileSync(FEED_PATH), trust);
  if (release.version !== PACKAGE.version) throw new Error('Update feed version does not match package.json.');
  const installerPath = path.join(ARTIFACT_ROOT, release.installer.fileName);
  if (!fs.existsSync(installerPath) || fs.lstatSync(installerPath).isSymbolicLink()) throw new Error('The exact update installer is missing or linked.');
  const bytes = fs.readFileSync(installerPath);
  if (bytes.length !== release.installer.sizeBytes) throw new Error('Installer size does not match UPDATE_FEED.json.');
  if (crypto.createHash('sha256').update(bytes).digest('hex') !== release.installer.sha256) throw new Error('Installer SHA-256 does not match UPDATE_FEED.json.');
  const signature = await readAuthenticode(installerPath);
  const thumbprint = String(signature.signerThumbprint || '').replace(/[^a-f0-9]/gi, '').toUpperCase();
  if (String(signature.status).toLowerCase() !== 'valid'
    || signature.signerSubject !== trust.publisherSubject
    || thumbprint !== trust.publisherThumbprint
    || !signature.timestampSubject) {
    throw new Error('Installer Authenticode publisher, thumbprint or timestamp does not match the pinned update trust.');
  }
  console.log('Signed update feed, exact local installer and Authenticode verification passed.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
