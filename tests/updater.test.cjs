const assert = require('node:assert/strict');
const { tempDir } = require('./helpers/temp-dir.cjs');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const updater = require('../src/main/updater/index.cjs');
const artifactVersion = require('../scripts/artifact-version.cjs');

function fixtureTrust() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const trust = {
    channel: 'stable',
    feedUrl: 'https://updates.example.test/dialed/stable.json',
    manifestKeyId: 'dialed-test-key-1',
    manifestPublicKeySpkiBase64: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
    publisherSubject: 'CN=Dialed Fixture Publisher, O=Dialed Tests, C=US',
    publisherThumbprint: '00112233445566778899AABBCCDDEEFF00112233',
    allowedInstallerHosts: ['downloads.example.test'],
  };
  return { privateKey, trust: updater.normalizeUpdateTrust(trust) };
}

function signedManifest(privateKey, trust, installerBytes = Buffer.from('fixture installer bytes'), version = '2.8.0', signerThumbprint = trust.publisherThumbprint) {
  const fileName = `Dialed Setup ${version}.exe`;
  const payload = {
    product: 'Dialed',
    channel: 'stable',
    release: {
      version,
      publishedAt: '2026-08-29T12:00:00.000Z',
      notesUrl: 'https://updates.example.test/dialed/2.8.0',
      installer: {
        url: `https://downloads.example.test/releases/${encodeURIComponent(fileName)}`,
        fileName,
        sizeBytes: installerBytes.length,
        sha256: crypto.createHash('sha256').update(installerBytes).digest('hex'),
        signerSubject: trust.publisherSubject,
        signerThumbprint,
      },
    },
  };
  const signed = Buffer.from(JSON.stringify(payload), 'utf8');
  const wrapper = {
    schemaVersion: updater.UPDATE_SCHEMA_VERSION,
    signed: signed.toString('base64'),
    signature: { algorithm: 'Ed25519', keyId: trust.manifestKeyId, value: crypto.sign(null, signed, privateKey).toString('base64') },
  };
  return Buffer.from(JSON.stringify(wrapper), 'utf8');
}

test('update trust is explicitly unavailable until every release-owned value exists', () => {
  const result = updater.normalizeUpdateTrust({ channel: 'stable' });
  assert.equal(result.status, 'UNCONFIGURED');
  assert.equal(result.configured, false);
  // publisherThumbprint is not required: with a rotating signing certificate it belongs in the
  // signed manifest, per release, not pinned once at build time.
  assert.deepEqual(result.missingFields, [
    'feedUrl', 'manifestKeyId', 'manifestPublicKeySpkiBase64',
    'publisherSubject', 'allowedInstallerHosts',
  ]);
});

test('update trust rejects non-HTTPS feeds, non-Ed25519 keys and malformed publisher identity', () => {
  const { publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const result = updater.normalizeUpdateTrust({
    channel: 'preview',
    feedUrl: 'http://127.0.0.1/feed.json',
    manifestKeyId: 'x',
    manifestPublicKeySpkiBase64: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
    publisherSubject: 'CN=Fixture',
    publisherThumbprint: 'abc',
    allowedInstallerHosts: ['.invalid'],
  });
  assert.equal(result.status, 'INVALID_CONFIGURATION');
  assert.equal(result.configured, false);
  assert.ok(result.errors.length >= 5);
});

test('signed manifest verifies exact product, channel, host, bytes, publisher and Ed25519 signature', () => {
  const { privateKey, trust } = fixtureTrust();
  const result = updater.verifyUpdateManifest(signedManifest(privateKey, trust), trust);
  assert.equal(result.version, '2.8.0');
  assert.equal(result.installer.fileName, 'Dialed Setup 2.8.0.exe');
  assert.equal(result.installer.signerThumbprint, trust.publisherThumbprint);
});

test('signed manifest fails closed for tampering, unexpected hosts and publisher drift', () => {
  const { privateKey, trust } = fixtureTrust();
  const valid = JSON.parse(signedManifest(privateKey, trust).toString('utf8'));
  valid.signed = Buffer.from(JSON.stringify({ product: 'Other' }), 'utf8').toString('base64');
  assert.throws(() => updater.verifyUpdateManifest(Buffer.from(JSON.stringify(valid)), trust), /signature is invalid/);

  const bytes = Buffer.from('fixture installer bytes');
  const payload = JSON.parse(Buffer.from(JSON.parse(signedManifest(privateKey, trust, bytes).toString()).signed, 'base64').toString());
  payload.release.installer.url = 'https://evil.example.test/Dialed%20Setup%202.8.0.exe';
  const signed = Buffer.from(JSON.stringify(payload));
  const wrapper = {
    schemaVersion: updater.UPDATE_SCHEMA_VERSION,
    signed: signed.toString('base64'),
    signature: { algorithm: 'Ed25519', keyId: trust.manifestKeyId, value: crypto.sign(null, signed, privateKey).toString('base64') },
  };
  assert.throws(() => updater.verifyUpdateManifest(Buffer.from(JSON.stringify(wrapper)), trust), /host is not in/);
});

test('version comparison rejects invalid versions and prevents same-version or downgrade offers', () => {
  assert.equal(updater.compareVersions('2.8.0', '2.7.0'), 1);
  assert.equal(updater.compareVersions('2.7.0', '2.7.0'), 0);
  assert.equal(updater.compareVersions('2.6.9', '2.7.0'), -1);
  assert.equal(updater.compareVersions('2.8.0', '2.8.0-alpha.1'), 1);
  assert.throws(() => updater.parseVersion('v2.8'), /semantic version/);
});

test('release artifact resource versions match the package version, with Windows zero padding only', () => {
  assert.doesNotThrow(() => artifactVersion.assertArtifactVersion('2.8.0', {
    fileVersion: '2.8.0',
    productVersion: '2.8.0',
  }, 'Installer'));
  assert.doesNotThrow(() => artifactVersion.assertArtifactVersion('2.8.0', {
    fileVersion: '2.8.0.0',
    productVersion: '2.8.0.0',
  }, 'Installer'));
  for (const version of ['2.8.0.1', '2.8.0-preview', '2.8.01', '2.8.1', '']) {
    assert.throws(() => artifactVersion.assertArtifactVersion('2.8.0', {
      fileVersion: version,
      productVersion: version,
    }, 'Installer'), /not 2\.8\.0/);
  }
});

test('installer verification directly rejects all six post-download tamper conditions', async (context) => {
  const temporary = tempDir('dialed-updater-tamper-');
  context.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const updateRoot = path.join(temporary, 'updates');
  fs.mkdirSync(updateRoot);
  const installerBytes = Buffer.from('fixture installer bytes');
  const { privateKey, trust } = fixtureTrust();
  const release = updater.verifyUpdateManifest(signedManifest(privateKey, trust, installerBytes), trust);
  const installerPath = path.join(updateRoot, release.installer.fileName);
  const validSignature = {
    status: 'Valid',
    signerSubject: trust.publisherSubject,
    signerThumbprint: trust.publisherThumbprint,
    timestampSubject: 'CN=Fixture Timestamp',
  };
  const verifyWith = (signature = validSignature) => updater.verifyInstallerFile(
    installerPath,
    release,
    trust,
    updateRoot,
    { readAuthenticode: async () => signature },
  );

  fs.writeFileSync(installerPath, Buffer.concat([installerBytes, Buffer.from('!')]));
  await assert.rejects(verifyWith(), /size no longer matches/);

  const tamperedSameSize = Buffer.from(installerBytes);
  tamperedSameSize[0] ^= 0xff;
  fs.writeFileSync(installerPath, tamperedSameSize);
  await assert.rejects(verifyWith(), /hash no longer matches/);

  fs.writeFileSync(installerPath, installerBytes);
  await assert.rejects(verifyWith({ ...validSignature, status: 'NotSigned' }), /signature as Valid/);
  await assert.rejects(verifyWith({ ...validSignature, signerSubject: 'CN=Unexpected Publisher' }), /publisher subject/);
  await assert.rejects(verifyWith({ ...validSignature, signerThumbprint: 'FFEEDDCCBBAA99887766554433221100FFEEDDCC' }), /certificate thumbprint/);
  await assert.rejects(verifyWith({ ...validSignature, timestampSubject: '' }), /no Authenticode timestamp/);
});

test('service requires a signed packaged caller, consumes tokens, verifies the exact installer at every stage and only then opens it under a sealed name', async (t) => {
  const temporary = tempDir('dialed-updater-test-');
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const installerBytes = Buffer.from('fixture installer bytes');
  const { privateKey, trust } = fixtureTrust();
  const manifest = signedManifest(privateKey, trust, installerBytes);
  let signatureReads = 0;
  let launches = 0;
  const signature = {
    status: 'Valid',
    signerSubject: trust.publisherSubject,
    signerThumbprint: trust.publisherThumbprint,
    timestampSubject: 'CN=Fixture Timestamp',
  };
  const service = updater.createUpdaterService({
    userDataPath: temporary,
    currentVersion: '2.7.0',
    isPackaged: true,
    stagingProtected: true,
    runningExecutablePath: path.join(temporary, 'Dialed.exe'),
    trust,
  }, {
    readAuthenticode: async () => { signatureReads += 1; return signature; },
    readHttpsBuffer: async (url, limit) => {
      assert.equal(url, trust.feedUrl);
      assert.equal(limit, updater.MANIFEST_MAX_BYTES);
      return manifest;
    },
    downloadHttpsFile: async (url, destination, expected) => {
      assert.equal(new URL(url).hostname, 'downloads.example.test');
      assert.equal(expected.sizeBytes, installerBytes.length);
      fs.writeFileSync(destination, installerBytes, { flag: 'wx' });
    },
    openInstaller: async (filePath) => {
      launches += 1;
      // Protected staging prevents an ordinary process from replacing the installer. The
      // published name still must not survive to launch, so the second verification covers
      // any unexpected change between the download and launch stages.
      assert.notEqual(path.basename(filePath), 'Dialed Setup 2.8.0.exe');
      assert.match(path.basename(filePath), /^[0-9a-f-]{36}\.exe$/i);
      assert.equal(path.dirname(filePath), path.join(temporary, 'verified-updates', '2.8.0'));
      assert.ok(fs.existsSync(filePath), 'the launched installer must exist at the sealed name');
      return '';
    },
  });

  const check = await service.checkForUpdates();
  assert.equal(check.status, 'UPDATE_AVAILABLE');
  assert.ok(check.downloadToken);
  const downloaded = await service.downloadUpdate(check.downloadToken);
  assert.equal(downloaded.status, 'READY_TO_INSTALL');
  assert.equal(downloaded.signature.status, 'VALID');
  await assert.rejects(() => service.downloadUpdate(check.downloadToken), /missing, expired, or already used/);
  const launched = await service.launchInstaller(downloaded.installToken);
  assert.equal(launched.launched, true);
  await assert.rejects(() => service.launchInstaller(downloaded.installToken), /missing, expired, or already used/);
  assert.equal(launches, 1);
  // Six Authenticode reads: the running build plus the downloaded installer at each of
  // check, download and launch, and then once more after the file has been moved to its
  // unpredictable launch name, so the bytes that actually run are the bytes that passed.
  assert.equal(signatureReads, 6);
  // The published name must not be left behind for anything else to pick up.
  assert.equal(fs.existsSync(path.join(temporary, 'verified-updates', '2.8.0', 'Dialed Setup 2.8.0.exe')), false);
});

test('service performs no network or signature work when trust is unconfigured or the build is not packaged', async () => {
  let calls = 0;
  const service = updater.createUpdaterService({
    userDataPath: os.tmpdir(), currentVersion: '2.7.0', isPackaged: false,
    runningExecutablePath: 'C:\\fixture.exe', trust: {},
  }, {
    readAuthenticode: async () => { calls += 1; },
    readHttpsBuffer: async () => { calls += 1; },
  });
  await assert.rejects(() => service.checkForUpdates(), /not configured/);
  assert.equal(calls, 0);
});

test('service refuses a configured packaged update unless staging is explicitly protected', async () => {
  const { trust } = fixtureTrust();
  let calls = 0;
  const service = updater.createUpdaterService({
    userDataPath: os.tmpdir(), currentVersion: '2.7.0', isPackaged: true,
    runningExecutablePath: 'C:\\fixture.exe', trust,
  }, {
    readAuthenticode: async () => { calls += 1; },
    readHttpsBuffer: async () => { calls += 1; },
    openInstaller: async () => { calls += 1; },
  });
  await assert.rejects(() => service.checkForUpdates(), /protected folder/);
  assert.equal(calls, 0);
});

test('production update request refuses private resolution before opening HTTPS', async () => {
  let requests = 0;
  await assert.rejects(updater.readHttpsBuffer('https://updates.example.test/feed.json', 1024, {
    resolvePublicAddresses: async () => { throw new Error('fixture private address blocked'); },
    httpsRequest: () => { requests += 1; },
  }), /private address blocked/);
  assert.equal(requests, 0);
});

// A rotating signing certificate is the normal case for Azure Trusted Signing: the account used
// for Dialed issues certificates that expire in about three days. These tests pin the behaviour
// that makes rotation survivable without weakening what is checked.
test('a release signed by a rotated certificate is accepted, and the manifest states which one', () => {
  const { privateKey, trust } = fixtureTrust();
  const rotated = { ...trust, publisherThumbprint: '' };
  const manifest = signedManifest(privateKey, rotated, Buffer.from('fixture installer bytes'), '2.9.0', 'AABBCCDDEEFF00112233445566778899AABBCCDD');
  const result = updater.verifyUpdateManifest(manifest, updater.normalizeUpdateTrust({ ...rotated }));
  assert.equal(result.version, '2.9.0');
  assert.equal(result.installer.signerThumbprint, 'AABBCCDDEEFF00112233445566778899AABBCCDD', 'the thumbprint travels with the release');
});

test('a manifest without a usable certificate thumbprint is refused', () => {
  const { privateKey, trust } = fixtureTrust();
  const open = updater.normalizeUpdateTrust({ ...trust, publisherThumbprint: '' });
  for (const bad of ['', 'not-a-thumbprint', 'AABB']) {
    assert.throws(
      () => updater.verifyUpdateManifest(signedManifest(privateKey, open, Buffer.from('fixture installer bytes'), '2.9.0', bad), open),
      /valid installer certificate thumbprint/,
      `accepted a manifest whose thumbprint was ${JSON.stringify(bad)}`,
    );
  }
});

test('a build-time pinned thumbprint still overrides the manifest when one is configured', () => {
  const { privateKey, trust } = fixtureTrust();
  assert.throws(
    () => updater.verifyUpdateManifest(signedManifest(privateKey, trust, Buffer.from('fixture installer bytes'), '2.9.0', 'AABBCCDDEEFF00112233445566778899AABBCCDD'), trust),
    /does not match the build-time trust value/,
  );
});

test('the publisher name stays pinned at build time, whatever the manifest claims', () => {
  const { privateKey, trust } = fixtureTrust();
  const open = updater.normalizeUpdateTrust({ ...trust, publisherThumbprint: '' });
  const manifest = JSON.parse(signedManifest(privateKey, open).toString('utf8'));
  const payload = JSON.parse(Buffer.from(manifest.signed, 'base64').toString('utf8'));
  payload.release.installer.signerSubject = 'CN=Someone Else, O=Not Dialed, C=US';
  const bytes = Buffer.from(JSON.stringify(payload), 'utf8');
  manifest.signed = bytes.toString('base64');
  manifest.signature = { algorithm: 'Ed25519', keyId: open.manifestKeyId, value: crypto.sign(null, bytes, privateKey).toString('base64') };
  assert.throws(() => updater.verifyUpdateManifest(Buffer.from(JSON.stringify(manifest), 'utf8'), open), /publisher subject does not match/);
});

test('a PC without the protected folder is told updates are off, not that they are ready', () => {
  // The Check for updates button is enabled from this configuration. Before this, a PC whose
  // protected folder failed was shown ready-to-update trust and only learned otherwise by
  // pressing the button and reading an error.
  const { trust } = fixtureTrust();
  const ready = updater.publicConfiguration(trust, true);
  assert.equal(ready.configured, true);
  assert.equal(ready.status, 'READY');

  const unprotected = updater.publicConfiguration(trust, false);
  assert.equal(unprotected.configured, false, 'a check that cannot run must not look available');
  assert.equal(unprotected.status, 'STAGING_UNPROTECTED');
  assert.match(unprotected.errors.join(' '), /protected folder could not be prepared/);

  // Callers that do not know about staging keep the old meaning.
  assert.equal(updater.publicConfiguration(trust).configured, true);
});
