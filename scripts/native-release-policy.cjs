// Offline release tooling. No key generation, Authenticode, native product launch,
// environment-based trust, device access or runtime activation lives here.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { parsePolicy, parseGeneralPolicy, isGeneralRelease, FIELDS, GENERAL_FIELDS } = require('../src/main/input-driver-lifecycle/release-policy-contract.cjs');
const { verifyPolicy } = require('../src/main/input-driver-lifecycle/native-broker.cjs');
const ROOT = path.resolve(__dirname, '..');
const CS_ANCHOR = 'native/hidusbf-helper/ReleasePolicy.cs';
const JS_ANCHOR = 'src/main/input-driver-lifecycle/native-broker.cjs';
const ANCHORS = [
  [CS_ANCHOR, /static readonly string ReleasePublicKeyPem = ("(?:[^"\\]|\\.)*");/g, value => `static readonly string ReleasePublicKeyPem = ${JSON.stringify(value)};`],
  [JS_ANCHOR, /const RELEASE_PUBLIC_KEY = (''|"(?:[^"\\]|\\.)*");/g, value => `const RELEASE_PUBLIC_KEY = ${JSON.stringify(value)};`],
];
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const inside = (base, file) => { const relative = path.relative(base, file); return !relative || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)); };
function safePath(file, { missing = false } = {}) {
  if (typeof file !== 'string' || !path.isAbsolute(file) || file.includes('\0')) throw new Error('An absolute filesystem path is required.');
  const resolved = path.resolve(file);
  for (let current = resolved; ; current = path.dirname(current)) {
    let stat;
    try { stat = fs.lstatSync(current); }
    catch (error) { if (!missing || error.code !== 'ENOENT') throw new Error('Required release input is missing or inaccessible.'); }
    if (stat?.isSymbolicLink()) throw new Error('Linked release paths are refused.');
    if (current === path.dirname(current)) break;
  }
  return resolved;
}
function readBounded(file, maximum, { secret = false, forbidden = [ROOT] } = {}) {
  const resolved = safePath(file);
  if (secret && forbidden.some(base => inside(safePath(base, { missing: true }), resolved))) throw new Error('Private key must remain outside the workspace, candidate and output directories.');
  const fd = fs.openSync(resolved, 'r');
  let bytes;
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size < 1 || stat.size > maximum || (secret && stat.nlink !== 1)) throw new Error('Release input size/type or private-key hard link refused.');
    bytes = Buffer.alloc(stat.size);
    let offset = 0;
    while (offset < bytes.length) {
      const count = fs.readSync(fd, bytes, offset, bytes.length - offset, null);
      if (!count) throw new Error('Release input changed during read.');
      offset += count;
    }
    if (fs.fstatSync(fd).size !== stat.size) throw new Error('Release input changed during read.');
    return bytes;
  } catch (error) { if (secret && bytes) bytes.fill(0); throw error; }
  finally { fs.closeSync(fd); }
}
function publicIdentity(bytes, fingerprint) {
  // createPublicKey also accepts private keys: explicitly prohibit that behavior.
  const pem = Buffer.isBuffer(bytes) ? bytes.toString('utf8') : bytes;
  if (typeof pem !== 'string' || pem.length > 16384 || !/^-----BEGIN PUBLIC KEY-----\r?\n[A-Za-z0-9+/=\r\n]+-----END PUBLIC KEY-----\s*$/.test(pem)) throw new Error('Only public SPKI PEM material is accepted.');
  let key;
  try { key = crypto.createPublicKey(pem); } catch { throw new Error('Public RSA key is malformed.'); }
  if (key.asymmetricKeyType !== 'rsa' || key.asymmetricKeyDetails.modulusLength < 3072 || key.asymmetricKeyDetails.modulusLength > 8192) throw new Error('Policy key must be RSA 3072 through 8192 bits.');
  const der = key.export({ type: 'spki', format: 'der' });
  const actual = sha256(der);
  if (typeof fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(fingerprint) || actual !== fingerprint) throw new Error('Reviewed public-key SPKI SHA256 fingerprint is missing or mismatched.');
  return { key, pem: key.export({ type: 'spki', format: 'pem' }), fingerprint: actual };
}
function anchorValues(root = ROOT) {
  return ANCHORS.map(([file, pattern]) => {
    const text = readBounded(path.join(root, file), 1024 * 1024).toString('utf8');
    const matches = [...text.matchAll(pattern)];
    if (matches.length !== 1) throw new Error('Expected exactly one compiled trust anchor per source.');
    return { file, text, value: matches[0][1] === "''" ? '' : JSON.parse(matches[0][1]) };
  });
}
function checkAnchors(root = ROOT, identity) {
  const values = anchorValues(root);
  if (values[0].value !== values[1].value) throw new Error('Compiled native policy trust anchors differ.');
  if (values[0].value) {
    const actual = sha256(crypto.createPublicKey(values[0].value).export({ type: 'spki', format: 'der' }));
    const reviewed = publicIdentity(values[0].value, actual);
    if (reviewed.pem !== values[0].value) throw new Error('Compiled public key is not canonical SPKI PEM.');
  }
  if (identity && values[0].value !== identity.pem) throw new Error('Reviewed public key is not compiled into both anchors.');
  return values[0].value ? 'PUBLIC_KEY_COMPILED_INACTIVE' : 'UNCONFIGURED';
}
function compileAnchors(identity, { root = ROOT, write = false } = {}) {
  // Only these two literal spans change. No formatter, build or signing follows.
  const values = anchorValues(root);
  const edits = values.map((entry, index) => ({ ...entry, next: entry.text.replace(ANCHORS[index][1], () => ANCHORS[index][2](identity.pem)) }));
  if (write) {
    for (const entry of edits) if (fs.readFileSync(path.join(root, entry.file), 'utf8') !== entry.text) throw new Error('Anchor source changed during review.');
    for (const entry of edits) fs.writeFileSync(path.join(root, entry.file), entry.next);
    checkAnchors(root, identity);
  }
  return edits.map(entry => ({ file: entry.file, changed: entry.text !== entry.next }));
}
function checkHashes(policy, candidate) {
  for (const [name, expected] of [['Dialed.HidusbfBroker.exe', policy.BrokerSha256], ['Dialed.HidusbfHost.exe', policy.HelperSha256]]) {
    if (sha256(readBounded(path.join(candidate, name), 128 * 1024 * 1024)) !== expected) throw new Error('Final executable hash differs from the reviewed policy.');
  }
}
function preparePolicy(reviewBytes, candidate, now = Date.now()) {
  const policy = parsePolicy(reviewBytes, now);
  if (policy.Purpose !== 'VALIDATION_ONLY') throw new Error('This workflow only issues VALIDATION_ONLY policies.');
  if (Date.parse(policy.ExpiresAt) > now + 7 * 24 * 60 * 60 * 1000) throw new Error('Validation policy expiry must be within seven days.');
  checkHashes(policy, candidate);
  const canonical = Object.fromEntries(FIELDS.map(field => [field, policy[field]]));
  canonical.ExpiresAt = new Date(policy.ExpiresAt).toISOString();
  canonical.PublisherThumbprint = policy.PublisherThumbprint.toUpperCase();
  canonical.AcceptedPlatformDigests = [...policy.AcceptedPlatformDigests].sort();
  canonical.AuthorizedDeviceDigests = [...policy.AuthorizedDeviceDigests].sort();
  return Buffer.from(JSON.stringify(canonical) + '\n', 'utf8');
}
function signPolicy(bytes, identity, privateKeyPath, forbidden = [ROOT]) {
  const policy = parsePolicy(bytes);
  if (policy.Purpose !== 'VALIDATION_ONLY' || Date.parse(policy.ExpiresAt) > Date.now() + 7 * 24 * 60 * 60 * 1000) throw new Error('Only bounded VALIDATION_ONLY policy bytes may be signed.');
  return signBytes(bytes, identity, privateKeyPath, forbidden);
}
// Schema 2, the general release. Separate commands, so the validation workflow above can
// never sign a release by accident. Lifetime is bounded by the contract (400 days).
function prepareGeneralPolicy(reviewBytes, candidate, now = Date.now()) {
  if (!isGeneralRelease(reviewBytes)) throw new Error('This command only prepares schema 2 general release policies.');
  const policy = parseGeneralPolicy(reviewBytes, now);
  checkHashes(policy, candidate);
  const canonical = Object.fromEntries(GENERAL_FIELDS.map(field => [field, policy[field]]));
  canonical.ExpiresAt = new Date(policy.ExpiresAt).toISOString();
  canonical.PublisherThumbprint = policy.PublisherThumbprint.toUpperCase();
  for (const field of ['DeviceClasses', 'SpeedClasses', 'DeniedDevices']) canonical[field] = [...policy[field]].sort();
  return Buffer.from(JSON.stringify(canonical) + '\n', 'utf8');
}
function signGeneralPolicy(bytes, identity, privateKeyPath, forbidden = [ROOT]) {
  if (!isGeneralRelease(bytes)) throw new Error('Only schema 2 general release policy bytes may be signed here.');
  parseGeneralPolicy(bytes);
  return signBytes(bytes, identity, privateKeyPath, forbidden);
}
function verifyPreparedGeneral(bytes, signature, identity, reviewBytes, candidate, now = Date.now()) {
  const expected = prepareGeneralPolicy(reviewBytes, candidate, now);
  if (!bytes.equals(expected)) throw new Error('Signed bytes differ from the canonical reviewed policy.');
  return verifyPolicy(bytes, signature, identity.pem, now);
}
function signBytes(bytes, identity, privateKeyPath, forbidden) {
  // Keep secret bytes in process memory only; never pass them to a child process,
  // stringify an error from the crypto provider, or write them to any output.
  const secret = readBounded(privateKeyPath, 32768, { secret: true, forbidden: [ROOT, ...forbidden] });
  try {
    const key = crypto.createPrivateKey(secret);
    if (key.asymmetricKeyType !== 'rsa' || key.asymmetricKeyDetails.modulusLength < 3072 || key.asymmetricKeyDetails.modulusLength > 8192 ||
        !crypto.createPublicKey(key).export({ type: 'spki', format: 'der' }).equals(identity.key.export({ type: 'spki', format: 'der' }))) throw new Error();
    const signature = crypto.sign('sha256', bytes, { key, padding: crypto.constants.RSA_PKCS1_PSS_PADDING, saltLength: 32 });
    verifyPolicy(bytes, signature, identity.pem);
    return signature;
  } catch { throw new Error('External private key or policy signing rejected; no key material is reported.'); }
  finally { secret.fill(0); }
}
function verifyPrepared(bytes, signature, identity, reviewBytes, candidate, now = Date.now()) {
  const expected = preparePolicy(reviewBytes, candidate, now);
  if (!bytes.equals(expected)) throw new Error('Signed bytes differ from the canonical reviewed policy.');
  return verifyPolicy(bytes, signature, identity.pem, now);
}
function signedFixture(manifestPath, publisherThumbprint) {
  const manifest = JSON.parse(readBounded(manifestPath, 65536));
  if (manifest.status !== 'SIGNED_POLICY_FIXTURE' || manifest.publisherThumbprint !== publisherThumbprint || !Array.isArray(manifest.files) || manifest.files.length !== 4 || !Array.isArray(manifest.sources) || !manifest.sources.length) throw new Error('Signed fixture manifest is incomplete.');
  const names = ['Dialed.HidusbfProtocolFixture.exe', 'Dialed.HidusbfProtocolFixture.dll', 'Dialed.HidusbfProtocolFixture.deps.json', 'Dialed.HidusbfProtocolFixture.runtimeconfig.json'];
  const directory = safePath(manifest.directory);
  if (new Set(manifest.files.map(f => f.file)).size !== 4) throw new Error('Duplicate fixture file.');
  const expectedSources = ['src/main/input-devices/usb-native.cs'];
  for (const folder of ['hidusbf-helper', 'hidusbf-host', 'hidusbf-broker', 'hidusbf-helper-fixture', 'hidusbf-boot-diagnostic']) {
    for (const name of fs.readdirSync(path.join(ROOT, 'native', folder))) if (/\.(cs|csproj)$/.test(name)) expectedSources.push(`native/${folder}/${name}`);
  }
  if (JSON.stringify(manifest.sources.map(s => s.file).sort()) !== JSON.stringify(expectedSources.sort())) throw new Error('Signed fixture source coverage differs.');
  for (const file of manifest.files) {
    if (!names.includes(file.file) || !/^[a-f0-9]{64}$/.test(file.sha256) || sha256(readBounded(path.join(directory, file.file), 8 * 1024 * 1024)) !== file.sha256) throw new Error('Signed fixture file drift.');
  }
  for (const source of manifest.sources) {
    if (!/^(native\/[a-z-]+\/[A-Za-z0-9.]+\.(cs|csproj)|src\/main\/input-devices\/usb-native\.cs)$/.test(source.file) || !/^[a-f0-9]{64}$/.test(source.sha256) || sha256(readBounded(path.join(ROOT, source.file), 1024 * 1024)) !== source.sha256) throw new Error('Signed fixture source drift.');
  }
  const quote = value => "'" + value.replace(/'/g, "''") + "'";
  const files = names.slice(0, 2).map(file => path.join(directory, file));
  const command = `@(${files.map(quote).join(',')}) | ForEach-Object { $s=Get-AuthenticodeSignature -LiteralPath $_; [pscustomobject]@{status=[string]$s.Status;thumbprint=[string]$s.SignerCertificate.Thumbprint;timestamp=($null -ne $s.TimeStamperCertificate)} } | ConvertTo-Json -Compress`;
  const signatures = JSON.parse(execFileSync('pwsh.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8', windowsHide: true, timeout: 30000 }));
  if (!Array.isArray(signatures) || signatures.length !== 2 || signatures.some(s => s.status !== 'Valid' || s.thumbprint !== publisherThumbprint || !s.timestamp)) throw new Error('Signed fixture publisher or signature refused.');
  return path.join(directory, names[0]);
}
function verifyCSharp(directory, publicKeyPath, fixtureManifest) {
  try {
    const args = ['--verify-policy', path.join(directory, 'release-policy.json'), path.join(directory, 'release-policy.sig'), publicKeyPath];
    const publisher = JSON.parse(readBounded(args[1], 65536)).PublisherThumbprint;
    const executable = fixtureManifest ? signedFixture(fixtureManifest, publisher) : 'dotnet';
    const result = execFileSync(executable, fixtureManifest ? args : ['run', '--project', path.join(ROOT, 'native/hidusbf-helper-fixture/Dialed.HidusbfProtocolFixture.csproj'), '--configuration', 'Release', '--verbosity', 'quiet', '--', ...args], { encoding: 'utf8', windowsHide: true, timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'] });
    if (!result.includes('closed-policy-contract-pass')) throw new Error();
    if (fixtureManifest) signedFixture(fixtureManifest, publisher);
  } catch { throw new Error('Closed C# policy-contract verification failed; output is not ready.'); }
}
function argumentsFor(argv) {
  const [command, ...rest] = argv;
  const allowed = {
    anchors: ['public-key', 'fingerprint', 'write'],
    prepare: ['review', 'candidate', 'public-key', 'fingerprint', 'output'],
    sign: ['review', 'candidate', 'public-key', 'fingerprint', 'private-key', 'output', 'signed-fixture'],
    verify: ['review', 'candidate', 'public-key', 'fingerprint', 'policy-dir', 'signed-fixture'],
    'prepare-release': ['review', 'candidate', 'public-key', 'fingerprint', 'output'],
    'sign-release': ['review', 'candidate', 'public-key', 'fingerprint', 'private-key', 'output', 'signed-fixture'],
    'verify-release': ['review', 'candidate', 'public-key', 'fingerprint', 'policy-dir', 'signed-fixture'],
  }[command];
  if (!allowed) throw new Error('Use anchors, prepare, sign, verify, prepare-release, sign-release or verify-release; see docs/NATIVE_RELEASE_POLICY_WORKFLOW.md.');
  const options = {};
  for (let index = 0; index < rest.length; index++) {
    const name = rest[index].startsWith('--') ? rest[index].slice(2) : '';
    if (!allowed.includes(name) || Object.hasOwn(options, name)) throw new Error('Unexpected or duplicate release-tool option.');
    if (name === 'write') options[name] = true;
    else {
      const value = rest[++index];
      if (!value || value.startsWith('--')) throw new Error('Missing release-tool option value.');
      options[name] = value;
    }
  }
  if (allowed.some(name => !['write', 'signed-fixture'].includes(name) && !Object.hasOwn(options, name))) throw new Error('Required release-tool option missing.');
  return { command, options };
}
function main(argv) {
  const { command, options: o } = argumentsFor(argv);
  const identity = publicIdentity(readBounded(o['public-key'], 16384), o.fingerprint);
  if (command === 'anchors') {
    const edits = compileAnchors(identity, { write: o.write === true });
    console.log(JSON.stringify({ status: o.write ? 'PUBLIC_KEY_COMPILED_INACTIVE' : 'PUBLIC_KEY_PREVIEW_ONLY', fingerprint: identity.fingerprint, edits }));
    return;
  }
  checkAnchors(ROOT, identity);
  const review = readBounded(o.review, 65536);
  const candidate = safePath(o.candidate);
  const general = command.endsWith('-release');
  const prepare = general ? prepareGeneralPolicy : preparePolicy;
  const check = general ? verifyPreparedGeneral : verifyPrepared;
  const bytes = prepare(review, candidate);
  if (command === 'verify' || command === 'verify-release') {
    const directory = safePath(o['policy-dir']);
    check(readBounded(path.join(directory, 'release-policy.json'), 65536), readBounded(path.join(directory, 'release-policy.sig'), 1024), identity, review, candidate);
    verifyCSharp(directory, o['public-key'], o['signed-fixture']);
    check(readBounded(path.join(directory, 'release-policy.json'), 65536), readBounded(path.join(directory, 'release-policy.sig'), 1024), identity, review, candidate);
  } else {
    const output = safePath(o.output, { missing: true });
    if (fs.existsSync(output) || inside(output, candidate)) throw new Error('Output must be a new directory outside the candidate ancestry.');
    // No file is created until schema, scope, hashes and external key all pass.
    const signature = command === 'sign' ? signPolicy(bytes, identity, o['private-key'], [ROOT, candidate, output])
      : command === 'sign-release' ? signGeneralPolicy(bytes, identity, o['private-key'], [ROOT, candidate, output]) : null;
    if (signature) check(bytes, signature, identity, review, candidate);
    fs.mkdirSync(output); // Parent must already exist; never overwrite a prior policy.
    fs.writeFileSync(path.join(output, 'release-policy.json'), bytes, { flag: 'wx' });
    if (signature) {
      fs.writeFileSync(path.join(output, 'release-policy.sig'), signature, { flag: 'wx' });
      verifyCSharp(output, o['public-key'], o['signed-fixture']);
      check(readBounded(path.join(output, 'release-policy.json'), 65536), readBounded(path.join(output, 'release-policy.sig'), 1024), identity, review, candidate);
    }
  }
  checkAnchors(ROOT, identity);
  console.log(JSON.stringify({ status: command === 'prepare' || command === 'prepare-release' ? 'UNSIGNED_POLICY_PREPARED' : general ? 'GENERAL_RELEASE_POLICY_CONTRACT_VERIFIED' : 'VALIDATION_POLICY_CONTRACT_VERIFIED', fingerprint: identity.fingerprint, authenticodeVerified: false, executed: false, physicalAcceptance: false }));
}
if (require.main === module) {
  try { main(process.argv.slice(2)); }
  catch { console.error('Native release-policy operation refused. Check the reviewed inputs and workflow; no secret details are logged.'); process.exitCode = 1; }
}
module.exports = { publicIdentity, anchorValues, checkAnchors, compileAnchors, preparePolicy, signPolicy, verifyPrepared, prepareGeneralPolicy, signGeneralPolicy, verifyPreparedGeneral, readBounded, safePath, argumentsFor, signedFixture, main };
