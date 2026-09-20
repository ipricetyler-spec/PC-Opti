const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { normalizeUpdateTrust, verifyUpdateManifest } = require('../src/main/updater/index.cjs');
const { resolveSigningConfiguration, verifySignature } = require('./windows-signing.cjs');

const ROOT = path.resolve(__dirname, '..');
const ARTIFACT_ROOT = path.join(ROOT, 'dist-electron');
const OUTPUT_PATH = path.join(ARTIFACT_ROOT, 'UPDATE_FEED.json');
const PACKAGE = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

function requiredEnvironment(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`${name} is required to create a signed update feed.`);
  return value;
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function readAuthenticode(filePath) {
  const encodedPath = Buffer.from(filePath, 'utf8').toString('base64');
  const command = `
$path = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedPath}'))
$signature = Get-AuthenticodeSignature -LiteralPath $path -ErrorAction Stop
[pscustomobject]@{
  status = [string]$signature.Status
  signerSubject = if ($signature.SignerCertificate) { [string]$signature.SignerCertificate.Subject } else { '' }
  signerThumbprint = if ($signature.SignerCertificate) { [string]$signature.SignerCertificate.Thumbprint } else { '' }
  timestampSubject = if ($signature.TimeStamperCertificate) { [string]$signature.TimeStamperCertificate.Subject } else { '' }
} | ConvertTo-Json -Compress
`;
  const result = require('node:child_process').spawnSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command], {
    cwd: ROOT, encoding: 'utf8', windowsHide: true, timeout: 60_000,
  });
  if (result.error || result.status !== 0) throw new Error(`Could not inspect installer Authenticode: ${result.error?.message || result.stderr || result.stdout}`);
  return JSON.parse(result.stdout);
}

function main() {
  const trust = normalizeUpdateTrust(PACKAGE.dialed?.update);
  if (!trust.configured) {
    const detail = trust.missingFields.length ? trust.missingFields.join(', ') : trust.errors.join(' ');
    throw new Error(`Update trust is not release-ready: ${detail}`);
  }
  const privateKeyPath = path.resolve(requiredEnvironment('DIALED_UPDATE_MANIFEST_PRIVATE_KEY_PATH'));
  if (!fs.existsSync(privateKeyPath) || fs.lstatSync(privateKeyPath).isSymbolicLink()) throw new Error('Manifest private key path must be an existing regular, non-linked file.');
  const privateKey = crypto.createPrivateKey(fs.readFileSync(privateKeyPath));
  if (privateKey.asymmetricKeyType !== 'ed25519') throw new Error('Manifest private key must be Ed25519.');
  const publicDer = crypto.createPublicKey(privateKey).export({ type: 'spki', format: 'der' });
  if (publicDer.toString('base64') !== trust.manifestPublicKeySpkiBase64) throw new Error('Manifest private key does not match the public key pinned in package.json.');

  const version = String(PACKAGE.version || '').trim();
  const fileName = `Dialed Setup ${version}.exe`;
  const installerPath = path.join(ARTIFACT_ROOT, fileName);
  if (!fs.existsSync(installerPath) || fs.lstatSync(installerPath).isSymbolicLink()) throw new Error(`Signed installer not found: ${installerPath}`);
  const signing = resolveSigningConfiguration();
  const signatureCheck = verifySignature(installerPath, signing);
  if (!signatureCheck.valid) throw new Error(`SignTool did not validate the installer: ${signatureCheck.error}`);
  const authenticode = readAuthenticode(installerPath);
  const thumbprint = String(authenticode.signerThumbprint || '').replace(/[^a-f0-9]/gi, '').toUpperCase();
  // The publisher name and a timestamp are required. The thumbprint is recorded rather than
  // compared, because Trusted Signing rotates certificates every few days: the manifest states
  // which certificate signed this release, and the app checks the installer against that.
  // A build-time pinned thumbprint, when one is configured, is still enforced.
  if (String(authenticode.status).toLowerCase() !== 'valid'
    || authenticode.signerSubject !== trust.publisherSubject
    || !authenticode.timestampSubject) {
    throw new Error('Installer Authenticode publisher or timestamp does not match the pinned update trust.');
  }
  if (!/^[A-F0-9]{40}$/.test(thumbprint)) throw new Error('Installer has no usable certificate thumbprint to record in the manifest.');
  if (trust.publisherThumbprint && thumbprint !== trust.publisherThumbprint) {
    throw new Error('Installer certificate thumbprint does not match the pinned update trust.');
  }

  const installerUrl = requiredEnvironment('DIALED_UPDATE_INSTALLER_URL');
  const notesUrl = String(process.env.DIALED_UPDATE_RELEASE_NOTES_URL || '').trim();
  const payload = {
    product: 'Dialed',
    channel: trust.channel,
    release: {
      version,
      publishedAt: new Date().toISOString(),
      notesUrl,
      installer: {
        url: installerUrl,
        fileName,
        sizeBytes: fs.statSync(installerPath).size,
        sha256: sha256(installerPath),
        signerSubject: trust.publisherSubject,
        signerThumbprint: thumbprint,
      },
    },
  };
  const payloadBytes = Buffer.from(JSON.stringify(payload), 'utf8');
  const wrapper = {
    schemaVersion: '1.0.0',
    signed: payloadBytes.toString('base64'),
    signature: {
      algorithm: 'Ed25519',
      keyId: trust.manifestKeyId,
      value: crypto.sign(null, payloadBytes, privateKey).toString('base64'),
    },
  };
  const output = Buffer.from(`${JSON.stringify(wrapper, null, 2)}\n`, 'utf8');
  verifyUpdateManifest(output, trust);
  fs.writeFileSync(OUTPUT_PATH, output, { flag: 'wx', mode: 0o600 });
  console.log(`Wrote signed update feed: ${OUTPUT_PATH}`);
}

main();
