const crypto = require('node:crypto');
const dns = require('node:dns');
const fs = require('node:fs');
const https = require('node:https');
const path = require('node:path');
const { resolvePublicAddresses } = require('../network-probe/index.cjs');
const { buildAuthenticodeReadScript } = require('../release-status/index.cjs');
const { runPowerShell } = require('../scanner/index.cjs');

const UPDATE_SCHEMA_VERSION = '1.0.0';
const MANIFEST_MAX_BYTES = 128 * 1024;
const INSTALLER_MAX_BYTES = 512 * 1024 * 1024;
const NETWORK_TIMEOUT_MS = 30_000;
const PREVIEW_TTL_MS = 10 * 60 * 1000;
const INSTALL_TTL_MS = 15 * 60 * 1000;
const UPDATE_ROOT_NAME = 'verified-updates';

function cleanText(value) {
  return String(value || '').trim();
}

function normalizeThumbprint(value) {
  return cleanText(value).replace(/[^a-f0-9]/gi, '').toUpperCase();
}

function safeHttpsUrl(value, label) {
  let parsed;
  try {
    parsed = new URL(cleanText(value));
  } catch {
    throw new Error(`${label} must be a valid HTTPS URL.`);
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hash || (parsed.port && parsed.port !== '443')) {
    throw new Error(`${label} must use HTTPS without credentials, a fragment, or a non-standard port.`);
  }
  return parsed;
}

function parseVersion(value, label = 'Version') {
  const text = cleanText(value);
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*))?$/.exec(text);
  if (!match) throw new Error(`${label} must be a three-part semantic version.`);
  return { text, major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), prerelease: match[4] || '' };
}

function compareVersions(left, right) {
  const a = typeof left === 'string' ? parseVersion(left) : left;
  const b = typeof right === 'string' ? parseVersion(right) : right;
  for (const key of ['major', 'minor', 'patch']) {
    if (a[key] !== b[key]) return a[key] > b[key] ? 1 : -1;
  }
  if (a.prerelease === b.prerelease) return 0;
  if (!a.prerelease) return 1;
  if (!b.prerelease) return -1;
  return a.prerelease.localeCompare(b.prerelease, undefined, { numeric: true });
}

function normalizeUpdateTrust(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const values = {
    channel: cleanText(source.channel) || 'stable',
    feedUrl: cleanText(source.feedUrl),
    manifestKeyId: cleanText(source.manifestKeyId),
    manifestPublicKeySpkiBase64: cleanText(source.manifestPublicKeySpkiBase64),
    publisherSubject: cleanText(source.publisherSubject),
    publisherThumbprint: normalizeThumbprint(source.publisherThumbprint),
    allowedInstallerHosts: Array.isArray(source.allowedInstallerHosts)
      ? [...new Set(source.allowedInstallerHosts.map((entry) => cleanText(entry).toLowerCase()).filter(Boolean))]
      : [],
  };
  const missingFields = [];
  if (!values.feedUrl) missingFields.push('feedUrl');
  if (!values.manifestKeyId) missingFields.push('manifestKeyId');
  if (!values.manifestPublicKeySpkiBase64) missingFields.push('manifestPublicKeySpkiBase64');
  if (!values.publisherSubject) missingFields.push('publisherSubject');
  // publisherThumbprint is deliberately optional. Trusted Signing issues short-lived
  // certificates - days, not years - so a thumbprint pinned at build time would refuse every
  // later release as if it were an attack. The expected thumbprint travels per release inside
  // the update manifest instead, which Dialed signs with its own key and verifies before use.
  // Setting it here is still honoured, for a deployment that signs with one long-lived
  // certificate and wants the stricter pin.
  if (!values.allowedInstallerHosts.length) missingFields.push('allowedInstallerHosts');
  if (missingFields.length) {
    return { status: 'UNCONFIGURED', configured: false, missingFields, errors: [], feedHost: '', ...values };
  }

  const errors = [];
  let feedHost = '';
  try { feedHost = safeHttpsUrl(values.feedUrl, 'Update feed URL').hostname.toLowerCase(); } catch (error) { errors.push(error.message); }
  if (!/^[a-z0-9][a-z0-9._-]{2,63}$/i.test(values.manifestKeyId)) errors.push('Manifest key id is invalid.');
  if (values.channel !== 'stable') errors.push('Only the stable update channel is supported in this build.');
  if (values.publisherThumbprint && !/^[A-F0-9]{40}$/.test(values.publisherThumbprint)) errors.push('Publisher thumbprint must be a 40-character SHA-1 certificate thumbprint.');
  if (values.allowedInstallerHosts.some((host) => !/^[a-z0-9.-]+$/i.test(host) || host.startsWith('.') || host.endsWith('.'))) {
    errors.push('One or more installer hosts are invalid.');
  }
  try {
    const key = crypto.createPublicKey({
      key: Buffer.from(values.manifestPublicKeySpkiBase64, 'base64'),
      format: 'der',
      type: 'spki',
    });
    if (key.asymmetricKeyType !== 'ed25519') errors.push('Manifest public key must be Ed25519.');
  } catch {
    errors.push('Manifest public key is not valid base64-encoded SPKI key material.');
  }
  return {
    status: errors.length ? 'INVALID_CONFIGURATION' : 'READY',
    configured: errors.length === 0,
    missingFields: [],
    errors,
    feedHost,
    ...values,
  };
}

function publicConfiguration(configuration) {
  return {
    status: configuration.status,
    configured: configuration.configured,
    channel: configuration.channel,
    feedHost: configuration.feedHost,
    missingFields: configuration.missingFields,
    errors: configuration.errors,
    backgroundUpdates: false,
  };
}

function validateSignedPayload(payload, trust) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Signed update payload must be an object.');
  if (payload.product !== 'Dialed') throw new Error('Signed update payload is for a different product.');
  if (payload.channel !== trust.channel) throw new Error('Signed update payload is for a different channel.');
  const release = payload.release;
  if (!release || typeof release !== 'object' || Array.isArray(release)) throw new Error('Signed update payload has no release object.');
  const version = parseVersion(release.version, 'Release version');
  if (trust.channel === 'stable' && version.prerelease) throw new Error('Stable update payload cannot publish a prerelease version.');
  const publishedAt = cleanText(release.publishedAt);
  const publishedTime = Date.parse(publishedAt);
  if (!Number.isFinite(publishedTime)) throw new Error('Release publishedAt is invalid.');
  if (publishedTime > Date.now() + (24 * 60 * 60 * 1000)) throw new Error('Release publishedAt is implausibly far in the future.');

  const installer = release.installer;
  if (!installer || typeof installer !== 'object' || Array.isArray(installer)) throw new Error('Signed update payload has no installer object.');
  const fileName = cleanText(installer.fileName);
  if (fileName !== `Dialed Setup ${version.text}.exe`) throw new Error('Installer filename does not match the signed Dialed release version.');
  const installerUrl = safeHttpsUrl(installer.url, 'Installer URL');
  if (!trust.allowedInstallerHosts.includes(installerUrl.hostname.toLowerCase())) throw new Error('Installer URL host is not in the build-time allowlist.');
  const decodedName = decodeURIComponent(path.posix.basename(installerUrl.pathname));
  if (decodedName !== fileName) throw new Error('Installer URL filename does not match the signed filename.');
  const sizeBytes = Number(installer.sizeBytes);
  if (!Number.isInteger(sizeBytes) || sizeBytes <= 0 || sizeBytes > INSTALLER_MAX_BYTES) throw new Error('Installer size is outside the allowed range.');
  const sha256 = cleanText(installer.sha256).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error('Installer SHA-256 is invalid.');
  if (cleanText(installer.signerSubject) !== trust.publisherSubject) throw new Error('Signed installer publisher subject does not match the build-time trust value.');
  // The publisher name stays pinned at build time. The certificate thumbprint comes from this
  // manifest, whose signature has already been verified against the build-time manifest key, so
  // the release states which certificate signed it and rotation does not look like tampering.
  const signerThumbprint = normalizeThumbprint(installer.signerThumbprint);
  if (!/^[A-F0-9]{40}$/.test(signerThumbprint)) throw new Error('Signed update payload does not state a valid installer certificate thumbprint.');
  if (trust.publisherThumbprint && signerThumbprint !== trust.publisherThumbprint) throw new Error('Signed installer publisher thumbprint does not match the build-time trust value.');
  let notesUrl = '';
  if (release.notesUrl) notesUrl = safeHttpsUrl(release.notesUrl, 'Release notes URL').toString();
  return {
    version: version.text,
    publishedAt: new Date(publishedTime).toISOString(),
    notesUrl,
    installer: {
      url: installerUrl.toString(), fileName, sizeBytes, sha256,
      signerSubject: trust.publisherSubject, signerThumbprint,
    },
  };
}

function verifyUpdateManifest(manifestBytes, trust, dependencies = {}) {
  if (!Buffer.isBuffer(manifestBytes) || manifestBytes.length === 0 || manifestBytes.length > MANIFEST_MAX_BYTES) {
    throw new Error('Update manifest is empty or exceeds the size limit.');
  }
  let wrapper;
  try { wrapper = JSON.parse(manifestBytes.toString('utf8')); } catch { throw new Error('Update manifest is not valid JSON.'); }
  if (!wrapper || wrapper.schemaVersion !== UPDATE_SCHEMA_VERSION) throw new Error('Update manifest schema version is unsupported.');
  const signedBase64 = cleanText(wrapper.signed);
  const signature = wrapper.signature;
  if (!signedBase64 || !signature || signature.algorithm !== 'Ed25519' || signature.keyId !== trust.manifestKeyId) {
    throw new Error('Update manifest signature metadata does not match the trusted key.');
  }
  const payloadBytes = Buffer.from(signedBase64, 'base64');
  const signatureBytes = Buffer.from(cleanText(signature.value), 'base64');
  if (!payloadBytes.length || payloadBytes.length > MANIFEST_MAX_BYTES || signatureBytes.length !== 64) throw new Error('Update manifest signature encoding is invalid.');
  const verify = dependencies.cryptoVerify || crypto.verify;
  const publicKey = {
    key: Buffer.from(trust.manifestPublicKeySpkiBase64, 'base64'), format: 'der', type: 'spki',
  };
  if (!verify(null, payloadBytes, publicKey, signatureBytes)) throw new Error('Update manifest signature is invalid.');
  let payload;
  try { payload = JSON.parse(payloadBytes.toString('utf8')); } catch { throw new Error('Signed update payload is not valid JSON.'); }
  return validateSignedPayload(payload, trust);
}

async function resolvedHttpsOptions(parsed, dependencies = {}) {
  const resolver = dependencies.resolvePublicAddresses || ((hostname) => resolvePublicAddresses(hostname, dependencies.dnsLookup || dns.promises.lookup));
  const records = await resolver(parsed.hostname);
  return {
    lookup(hostname, options, callback) {
      if (hostname.toLowerCase() !== parsed.hostname.toLowerCase()) return callback(new Error('Unexpected hostname during update request.'));
      if (options && options.all) return callback(null, records.map((record) => ({ address: record.address, family: record.family })));
      return callback(null, records[0].address, records[0].family);
    },
  };
}

async function readHttpsBuffer(url, maximumBytes, dependencies = {}) {
  const parsed = safeHttpsUrl(url, 'Update request URL');
  const pinned = await resolvedHttpsOptions(parsed, dependencies);
  const request = dependencies.httpsRequest || https.request;
  return new Promise((resolve, reject) => {
    const req = request(parsed, { method: 'GET', headers: { Accept: 'application/json', 'User-Agent': 'Dialed-Verified-Updater/1' }, lookup: pinned.lookup }, (response) => {
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`Update server returned HTTP ${response.statusCode || 'unknown'}; redirects are not followed.`));
        return;
      }
      const chunks = [];
      let received = 0;
      response.on('data', (chunk) => {
        received += chunk.length;
        if (received > maximumBytes) req.destroy(new Error('Update response exceeded the size limit.'));
        else chunks.push(chunk);
      });
      response.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.setTimeout(NETWORK_TIMEOUT_MS, () => req.destroy(new Error('Update request timed out.')));
    req.on('error', reject);
    req.end();
  });
}

async function downloadHttpsFile(url, destination, expected, dependencies = {}) {
  const parsed = safeHttpsUrl(url, 'Installer URL');
  const pinned = await resolvedHttpsOptions(parsed, dependencies);
  const request = dependencies.httpsRequest || https.request;
  const fileSystem = dependencies.fs || fs;
  await new Promise((resolve, reject) => {
    const req = request(parsed, { method: 'GET', headers: { Accept: 'application/octet-stream', 'User-Agent': 'Dialed-Verified-Updater/1' }, lookup: pinned.lookup }, (response) => {
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`Installer server returned HTTP ${response.statusCode || 'unknown'}; redirects are not followed.`));
        return;
      }
      const contentLength = Number(response.headers['content-length']);
      if (Number.isFinite(contentLength) && contentLength > 0 && contentLength !== expected.sizeBytes) {
        response.resume();
        reject(new Error('Installer Content-Length does not match the signed manifest.'));
        return;
      }
      const output = fileSystem.createWriteStream(destination, { flags: 'wx', mode: 0o600 });
      const digest = crypto.createHash('sha256');
      let received = 0;
      response.on('data', (chunk) => {
        received += chunk.length;
        if (received > expected.sizeBytes || received > INSTALLER_MAX_BYTES) req.destroy(new Error('Installer exceeded the signed size limit.'));
        else digest.update(chunk);
      });
      response.pipe(output);
      output.on('finish', () => {
        output.close(() => {
          if (received !== expected.sizeBytes) reject(new Error('Installer byte count does not match the signed manifest.'));
          else if (digest.digest('hex') !== expected.sha256) reject(new Error('Installer SHA-256 does not match the signed manifest.'));
          else resolve();
        });
      });
      output.on('error', reject);
      response.on('error', reject);
    });
    req.setTimeout(NETWORK_TIMEOUT_MS, () => req.destroy(new Error('Installer download timed out.')));
    req.on('error', reject);
    req.end();
  });
}

function sha256File(filePath, fileSystem = fs) {
  const digest = crypto.createHash('sha256');
  const handle = fileSystem.openSync(filePath, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytesRead = 0;
    do {
      bytesRead = fileSystem.readSync(handle, buffer, 0, buffer.length, null);
      if (bytesRead > 0) digest.update(buffer.subarray(0, bytesRead));
    } while (bytesRead > 0);
  } finally {
    fileSystem.closeSync(handle);
  }
  return digest.digest('hex');
}

function assertOwnedRegularFile(filePath, expectedRoot, fileSystem = fs) {
  const resolved = path.resolve(filePath);
  const root = `${path.resolve(expectedRoot)}${path.sep}`;
  if (!resolved.startsWith(root)) throw new Error('Update file escaped the app-owned download directory.');
  const stat = fileSystem.lstatSync(resolved);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Update file is not a regular app-owned file.');
  return stat;
}

async function readAuthenticode(filePath, dependencies = {}) {
  const executePowerShell = dependencies.runPowerShell || runPowerShell;
  const result = await executePowerShell(buildAuthenticodeReadScript(filePath));
  const parsed = JSON.parse(result.stdout);
  return {
    status: cleanText(parsed.status),
    signerSubject: cleanText(parsed.signerSubject),
    signerThumbprint: normalizeThumbprint(parsed.signerThumbprint),
    timestampSubject: cleanText(parsed.timestampSubject),
  };
}

async function verifyInstallerFile(filePath, release, trust, updateRoot, dependencies = {}) {
  const fileSystem = dependencies.fs || fs;
  const stat = assertOwnedRegularFile(filePath, updateRoot, fileSystem);
  if (stat.size !== release.installer.sizeBytes) throw new Error('Downloaded installer size no longer matches the signed manifest.');
  if (sha256File(filePath, fileSystem) !== release.installer.sha256) throw new Error('Downloaded installer hash no longer matches the signed manifest.');
  const signature = await (dependencies.readAuthenticode || readAuthenticode)(filePath, dependencies);
  if (cleanText(signature.status).toLowerCase() !== 'valid') throw new Error('Windows does not report the downloaded installer signature as Valid.');
  if (cleanText(signature.signerSubject) !== trust.publisherSubject) throw new Error('Downloaded installer publisher subject does not match the pinned publisher.');
  if (normalizeThumbprint(signature.signerThumbprint) !== normalizeThumbprint(release.installer.signerThumbprint)) throw new Error('Downloaded installer certificate thumbprint does not match the one stated in the signed manifest.');
  if (!cleanText(signature.timestampSubject)) throw new Error('Downloaded installer has no Authenticode timestamp evidence.');
  return { status: 'VALID', signerSubject: trust.publisherSubject, signerThumbprint: normalizeThumbprint(release.installer.signerThumbprint), timestampSubject: cleanText(signature.timestampSubject) };
}

function atomicWriteJson(filePath, value, fileSystem = fs) {
  const temporary = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fileSystem.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  fileSystem.renameSync(temporary, filePath);
}

function createUpdaterService(options, dependencies = {}) {
  const fileSystem = dependencies.fs || fs;
  const trust = normalizeUpdateTrust(options.trust);
  const currentVersion = parseVersion(options.currentVersion, 'Current application version');
  const updateRoot = path.join(path.resolve(options.userDataPath), UPDATE_ROOT_NAME);
  let updatePreview = null;
  let installPreview = null;

  function getStatus() {
    return {
      configuration: publicConfiguration(trust),
      phase: installPreview && installPreview.expiresAt >= Date.now() ? 'READY_TO_INSTALL' : 'IDLE',
      downloaded: installPreview && installPreview.expiresAt >= Date.now()
        ? { version: installPreview.release.version, fileName: installPreview.release.installer.fileName, verifiedAt: installPreview.verifiedAt }
        : null,
    };
  }

  function assertOperational() {
    if (!trust.configured) throw new Error(trust.status === 'UNCONFIGURED' ? `Verified updates are not configured: ${trust.missingFields.join(', ')}.` : `Verified update configuration is invalid: ${trust.errors.join(' ')}`);
    if (!options.isPackaged) throw new Error('Verified updates are available only from a packaged Dialed build.');
  }

  async function assertRunningPublisher() {
    const signature = await (dependencies.readAuthenticode || readAuthenticode)(options.runningExecutablePath, dependencies);
    // This build's own certificate has usually rotated by the time an update is offered, so the
    // running executable is held to the pinned publisher name, a valid signature and a timestamp
    // - not to one certificate. A pinned thumbprint, when configured, still applies.
    if (cleanText(signature.status).toLowerCase() !== 'valid'
      || cleanText(signature.signerSubject) !== trust.publisherSubject
      || (trust.publisherThumbprint && normalizeThumbprint(signature.signerThumbprint) !== trust.publisherThumbprint)
      || !cleanText(signature.timestampSubject)) {
      throw new Error('The running Dialed executable does not match the pinned, timestamped publisher identity; update access was blocked.');
    }
  }

  async function checkForUpdates() {
    assertOperational();
    await assertRunningPublisher();
    const bytes = await (dependencies.readHttpsBuffer || readHttpsBuffer)(trust.feedUrl, MANIFEST_MAX_BYTES, dependencies);
    const release = verifyUpdateManifest(bytes, trust, dependencies);
    const comparison = compareVersions(release.version, currentVersion);
    updatePreview = comparison > 0 ? { token: crypto.randomUUID(), expiresAt: Date.now() + PREVIEW_TTL_MS, release } : null;
    installPreview = null;
    return {
      checkedAt: new Date().toISOString(),
      currentVersion: currentVersion.text,
      status: comparison > 0 ? 'UPDATE_AVAILABLE' : comparison === 0 ? 'UP_TO_DATE' : 'FEED_OLDER_THAN_INSTALLED',
      release: comparison > 0 ? {
        version: release.version, publishedAt: release.publishedAt, notesUrl: release.notesUrl,
        fileName: release.installer.fileName, sizeBytes: release.installer.sizeBytes,
        sha256: release.installer.sha256, signerSubject: release.installer.signerSubject,
      } : null,
      downloadToken: updatePreview?.token || null,
      expiresAt: updatePreview ? new Date(updatePreview.expiresAt).toISOString() : null,
    };
  }

  async function downloadUpdate(token) {
    assertOperational();
    const pending = updatePreview;
    updatePreview = null;
    if (!pending || pending.token !== token || pending.expiresAt < Date.now()) throw new Error('The update preview is missing, expired, or already used. Check again.');
    await assertRunningPublisher();
    const release = pending.release;
    const versionDirectory = path.join(updateRoot, release.version);
    fileSystem.mkdirSync(versionDirectory, { recursive: true, mode: 0o700 });
    for (const directory of [updateRoot, versionDirectory]) {
      const stat = fileSystem.lstatSync(directory);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('The app-owned update directory is not a regular directory.');
    }
    const finalPath = path.join(versionDirectory, release.installer.fileName);
    const partialPath = `${finalPath}.partial`;
    if (fileSystem.existsSync(partialPath)) {
      assertOwnedRegularFile(partialPath, updateRoot, fileSystem);
      fileSystem.unlinkSync(partialPath);
    }
    if (fileSystem.existsSync(finalPath)) {
      assertOwnedRegularFile(finalPath, updateRoot, fileSystem);
      fileSystem.unlinkSync(finalPath);
    }
    try {
      await (dependencies.downloadHttpsFile || downloadHttpsFile)(release.installer.url, partialPath, release.installer, dependencies);
      assertOwnedRegularFile(partialPath, updateRoot, fileSystem);
      fileSystem.renameSync(partialPath, finalPath);
      const signature = await verifyInstallerFile(finalPath, release, trust, updateRoot, dependencies);
      const verifiedAt = new Date().toISOString();
      const verificationPath = path.join(versionDirectory, 'verification.json');
      if (fileSystem.existsSync(verificationPath)) {
        assertOwnedRegularFile(verificationPath, updateRoot, fileSystem);
        fileSystem.unlinkSync(verificationPath);
      }
      atomicWriteJson(verificationPath, {
        schemaVersion: UPDATE_SCHEMA_VERSION, verifiedAt, version: release.version,
        fileName: release.installer.fileName, sizeBytes: release.installer.sizeBytes,
        sha256: release.installer.sha256, signature,
      }, fileSystem);
      installPreview = { token: crypto.randomUUID(), expiresAt: Date.now() + INSTALL_TTL_MS, release, filePath: finalPath, verifiedAt };
      return {
        status: 'READY_TO_INSTALL', version: release.version, fileName: release.installer.fileName,
        sizeBytes: release.installer.sizeBytes, sha256: release.installer.sha256, signature,
        installToken: installPreview.token, expiresAt: new Date(installPreview.expiresAt).toISOString(),
      };
    } catch (error) {
      if (fileSystem.existsSync(partialPath)) {
        try { assertOwnedRegularFile(partialPath, updateRoot, fileSystem); fileSystem.unlinkSync(partialPath); } catch { /* Preserve unexpected filesystem evidence. */ }
      }
      throw error;
    }
  }

  async function launchInstaller(token) {
    assertOperational();
    const pending = installPreview;
    installPreview = null;
    if (!pending || pending.token !== token || pending.expiresAt < Date.now()) throw new Error('The verified installer confirmation is missing, expired, or already used. Download and verify again.');
    await assertRunningPublisher();
    await verifyInstallerFile(pending.filePath, pending.release, trust, updateRoot, dependencies);
    const openInstaller = dependencies.openInstaller || options.openInstaller;
    if (typeof openInstaller !== 'function') throw new Error('Installer launch is unavailable.');
    // The staging directory sits in per-user app data, so a process running as the same
    // user without elevation can replace the file. Verifying a path and then launching
    // that same path leaves a window in which the bytes can be swapped for ones that
    // were never checked, and Dialed launches installers from an already-elevated
    // process. Moving the verified file to a name the attacker cannot predict, then
    // re-verifying at that name, closes the window: any swap before the move is caught
    // by the second verification, and after it there is no known path to swap.
    const sealedPath = path.join(path.dirname(pending.filePath), `${crypto.randomUUID()}.exe`);
    try {
      fileSystem.renameSync(pending.filePath, sealedPath);
    } catch (error) {
      throw new Error(`Windows could not secure the verified installer before launching it: ${error.message}`);
    }
    try {
      await verifyInstallerFile(sealedPath, pending.release, trust, updateRoot, dependencies);
    } catch (error) {
      try { assertOwnedRegularFile(sealedPath, updateRoot, fileSystem); fileSystem.unlinkSync(sealedPath); } catch { /* Preserve unexpected filesystem evidence. */ }
      throw new Error(`The verified installer changed after it was checked and was not launched: ${error.message}`);
    }
    // verification.json is the on-disk evidence of what was checked. The seal renames the
    // file, so record the name that actually exists alongside the published one.
    try {
      const verificationPath = path.join(path.dirname(sealedPath), 'verification.json');
      assertOwnedRegularFile(verificationPath, updateRoot, fileSystem);
      const existing = JSON.parse(fileSystem.readFileSync(verificationPath, 'utf8'));
      fileSystem.unlinkSync(verificationPath);
      atomicWriteJson(verificationPath, {
        ...existing,
        publishedFileName: pending.release.installer.fileName,
        fileName: path.basename(sealedPath),
        sealedAt: new Date().toISOString(),
      }, fileSystem);
    } catch { /* Evidence bookkeeping must never block a verified launch. */ }
    const launchError = await openInstaller(sealedPath);
    if (launchError) {
      // Leave nothing half-launched behind under a name nothing else knows about.
      try { assertOwnedRegularFile(sealedPath, updateRoot, fileSystem); fileSystem.unlinkSync(sealedPath); } catch { /* Preserve unexpected filesystem evidence. */ }
      throw new Error(`Windows could not open the verified installer: ${launchError}. Download and verify again.`);
    }
    return { launched: true, version: pending.release.version, fileName: pending.release.installer.fileName };
  }

  return { getStatus, checkForUpdates, downloadUpdate, launchInstaller };
}

module.exports = {
  INSTALLER_MAX_BYTES,
  MANIFEST_MAX_BYTES,
  UPDATE_SCHEMA_VERSION,
  compareVersions,
  createUpdaterService,
  downloadHttpsFile,
  normalizeUpdateTrust,
  parseVersion,
  publicConfiguration,
  readAuthenticode,
  readHttpsBuffer,
  safeHttpsUrl,
  validateSignedPayload,
  verifyInstallerFile,
  verifyUpdateManifest,
};
