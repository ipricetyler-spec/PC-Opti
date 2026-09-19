const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const updater = require('../src/main/updater/index.cjs');

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

function signedManifest(privateKey, trust, installerBytes = Buffer.from('fixture installer bytes'), version = '2.8.0') {
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
        signerThumbprint: trust.publisherThumbprint,
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
  assert.deepEqual(result.missingFields, [
    'feedUrl', 'manifestKeyId', 'manifestPublicKeySpkiBase64',
    'publisherSubject', 'publisherThumbprint', 'allowedInstallerHosts',
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

test('installer verification directly rejects all six post-download tamper conditions', async (context) => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'dialed-updater-tamper-'));
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
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'dialed-updater-test-'));
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
      // The installer is launched under an unpredictable name, not the published one:
      // the staging directory is user-writable, so launching the path that was just
      // verified would let another program running as the same user swap the bytes in
      // between. The published name must not survive to the launch.
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

test('production update request refuses private resolution before opening HTTPS', async () => {
  let requests = 0;
  await assert.rejects(updater.readHttpsBuffer('https://updates.example.test/feed.json', 1024, {
    resolvePublicAddresses: async () => { throw new Error('fixture private address blocked'); },
    httpsRequest: () => { requests += 1; },
  }), /private address blocked/);
  assert.equal(requests, 0);
});
