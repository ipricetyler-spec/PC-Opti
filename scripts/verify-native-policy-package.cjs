// Read-only verification for the unpacked VALIDATION_ONLY candidate. This never
// launches the application or native helpers and never signs or mutates the host.
const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const asar = require('@electron/asar');
const { verifyBundledInventory } = require('../src/main/input-driver-lifecycle/bundled-inventory.cjs');
const { NATIVE_INPUT_SOURCE_SHA256 } = require('../src/main/input-devices/index.cjs');
const { resolveSigningConfiguration } = require('./windows-signing.cjs');
const { verifyPreservedCandidate } = require('./prepare-native-policy-package.cjs');

const ROOT = path.resolve(__dirname, '..');
const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function parseArguments(argv) {
  const allowed = ['--package', '--candidate', '--policy-dir', '--review', '--public-key', '--fingerprint', '--signed-fixture'];
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index], value = argv[index + 1];
    if (!allowed.includes(name) || !value || options[name]) throw new Error('Expected unique package, candidate, policy-dir, review, public-key and fingerprint options.');
    options[name] = value;
  }
  if (allowed.some(name => name !== '--signed-fixture' && !options[name])) throw new Error('All native validation package verification options are required.');
  for (const name of Object.keys(options).filter((name) => name !== '--fingerprint')) if (!path.isAbsolute(options[name])) throw new Error('Verification paths must be absolute.');
  return options;
}

function inspectAuthenticode(files) {
  const quote = (value) => `'${value.replace(/'/g, "''")}'`;
  const command = `@(${files.map(quote).join(',')}) | ForEach-Object { $s=Get-AuthenticodeSignature -LiteralPath $_; [pscustomobject]@{ path=$_; status=[string]$s.Status; subject=[string]$s.SignerCertificate.Subject; thumbprint=[string]$s.SignerCertificate.Thumbprint; timestampPresent=($null -ne $s.TimeStamperCertificate); timestampSubject=[string]$s.TimeStamperCertificate.Subject } } | ConvertTo-Json -Compress`;
  const raw = childProcess.execFileSync('pwsh.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8', windowsHide: true, timeout: 30000 });
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed : [parsed];
}

function verifySignTool(files) {
  const signTool = resolveSigningConfiguration({ ...process.env, DIALED_ENABLE_SIGNING: '0', PC_OPTI_ENABLE_SIGNING: '0' }).signToolPath;
  return files.map((file) => {
    const output = childProcess.execFileSync(signTool, ['verify', '/pa', '/all', '/v', '/tw', file], { encoding: 'utf8', windowsHide: true, timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'] });
    assert.match(output, /Number of signatures successfully Verified:\s*1/i);
    assert.match(output, /Number of warnings:\s*0/i);
    assert.match(output, /Number of errors:\s*0/i);
    return { file: path.basename(file), exitCode: 0, warnings: 0, errors: 0 };
  });
}

function runPolicyVerification(options) {
  const candidate = path.resolve(options['--candidate']);
  const result = childProcess.execFileSync(process.execPath, [path.join(candidate, 'source/scripts/native-release-policy.cjs'), 'verify',
    '--review', options['--review'], '--candidate', path.join(candidate, 'signing'),
    '--public-key', options['--public-key'], '--fingerprint', options['--fingerprint'], '--policy-dir', options['--policy-dir'],
    ...(options['--signed-fixture'] ? ['--signed-fixture', options['--signed-fixture']] : []),
  ], { cwd: path.join(candidate, 'source'), encoding: 'utf8', windowsHide: true, timeout: 120000, stdio: ['ignore', 'pipe', 'pipe'] });
  assert.match(result, /VALIDATION_POLICY_CONTRACT_VERIFIED/);
}

function writeOrVerifyReport(report, reportFile, sumsFile, sums) {
  if (fs.existsSync(reportFile) || fs.existsSync(sumsFile)) {
    assert.equal(fs.existsSync(reportFile), true, 'Existing package evidence is incomplete.');
    assert.equal(fs.existsSync(sumsFile), true, 'Existing package evidence is incomplete.');
    const existing = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
    assert.deepEqual({ ...report, verifiedAt: existing.verifiedAt }, existing, 'Existing package verification differs from current read-only results.');
    assert.equal(fs.readFileSync(sumsFile, 'utf8'), sums, 'Existing package checksums differ from current read-only results.');
    return 'PRESERVED_AND_MATCHED';
  }
  fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
  fs.writeFileSync(sumsFile, sums, { flag: 'wx' });
  return 'WRITTEN_NEW';
}

function main(argv) {
  const options = parseArguments(argv);
  const packageRoot = path.resolve(options['--package']);
  const candidate = path.resolve(options['--candidate']);
  const policyDirectory = path.resolve(options['--policy-dir']);
  const { preparation, signatures } = verifyPreservedCandidate(candidate, options['--fingerprint']);
  runPolicyVerification(options);

  const unpacked = path.join(packageRoot, 'package', 'win-unpacked');
  const project = path.join(packageRoot, 'project');
  const appExecutable = path.join(unpacked, 'Dialed.exe');
  const archive = path.join(unpacked, 'resources', 'app.asar');
  const nativeRoot = path.join(unpacked, 'resources', 'hidusbf-native');
  const presentMon = path.join(unpacked, 'resources', 'presentmon', 'PresentMon-2.5.1-x64.exe');
  for (const file of [appExecutable, archive, presentMon]) assert.ok(fs.statSync(file).isFile(), `Packaged file missing: ${file}`);
  assert.deepEqual(fs.readdirSync(nativeRoot).sort(), ['BUILD_MANIFEST.json', 'Dialed.HidusbfBroker.exe', 'Dialed.HidusbfHost.exe', 'release-policy.json', 'release-policy.sig']);

  const review = JSON.parse(fs.readFileSync(options['--review'], 'utf8'));
  const policy = fs.readFileSync(path.join(policyDirectory, 'release-policy.json'));
  assert.deepEqual(fs.readFileSync(path.join(nativeRoot, 'release-policy.json')), policy);
  assert.deepEqual(fs.readFileSync(path.join(nativeRoot, 'release-policy.sig')), fs.readFileSync(path.join(policyDirectory, 'release-policy.sig')));
  assert.deepEqual(JSON.parse(policy), review, 'Canonical policy differs from reviewed eight-field input.');

  const artifacts = new Map(signatures.artifacts.map((artifact) => [artifact.file, artifact]));
  const nativeFiles = ['Dialed.HidusbfBroker.exe', 'Dialed.HidusbfHost.exe'].map((name) => path.join(nativeRoot, name));
  for (const file of nativeFiles) {
    const artifact = artifacts.get(path.basename(file));
    assert.equal(sha256(file), artifact.sha256, `Packaged signed native bytes drifted: ${path.basename(file)}`);
    assert.equal(fs.statSync(file).size, artifact.bytes);
  }
  const auth = inspectAuthenticode([...nativeFiles, presentMon, appExecutable]);
  for (const file of nativeFiles) {
    const entry = auth.find((value) => path.resolve(value.path) === path.resolve(file));
    const artifact = artifacts.get(path.basename(file));
    assert.equal(entry?.status, 'Valid');
    assert.equal(entry?.thumbprint, artifact.publisherThumbprint);
    assert.equal(entry?.subject, artifact.publisher);
    assert.equal(entry?.timestampPresent, true);
  }
  assert.equal(auth.find((value) => path.resolve(value.path) === path.resolve(presentMon))?.status, 'Valid');
  const signTool = verifySignTool(nativeFiles);

  const nativeManifest = JSON.parse(fs.readFileSync(path.join(nativeRoot, 'BUILD_MANIFEST.json'), 'utf8'));
  assert.equal(nativeManifest.status, 'SIGNED_VALIDATION_POLICY_CANDIDATE');
  assert.equal(nativeManifest.policyTrust, 'PUBLIC_KEY_COMPILED_INACTIVE');
  assert.equal(nativeManifest.policyPublicKeySpkiSha256, options['--fingerprint']);
  assert.equal(nativeManifest.purpose, 'VALIDATION_ONLY');
  assert.equal(nativeManifest.executed, false);
  assert.equal(nativeManifest.signed, true);
  assert.equal(nativeManifest.policyIssued, true);
  assert.equal(nativeManifest.physicalAcceptance, false);
  for (const source of preparation.sources) assert.equal(sha256(path.join(ROOT, source.file)), source.canonicalSha256);

  const broker = require(path.join(candidate, 'source/src/main/input-driver-lifecycle/native-broker.cjs'));
  const brokerStatus = broker.readNativeBrokerStatus(nativeRoot);
  assert.equal(brokerStatus.available, true);
  assert.equal(brokerStatus.code, 'NATIVE_BROKER_READY');

  const entries = asar.listPackage(archive).map((entry) => ({ archivePath: entry.replace(/^[/\\]+/, ''), relativePath: entry.replace(/^[/\\]+/, '').replace(/\\/g, '/') }));
  const files = entries.filter(({ archivePath }) => !asar.statFile(archive, archivePath).files);
  const allowedRoots = new Set(['dist', 'electron', 'src', 'package.json']);
  for (const entry of entries) assert.ok(allowedRoots.has(entry.relativePath.split('/')[0]), `Unexpected ASAR root: ${entry.relativePath}`);
  let exactSourceMatches = 0;
  for (const entry of files) {
    if (entry.relativePath === 'package.json') continue;
    const expected = entry.relativePath === 'src/main/input-driver-lifecycle/native-broker.cjs'
      ? path.join(candidate, 'source', entry.relativePath)
      : path.join(ROOT, ...entry.relativePath.split('/'));
    if (!fs.existsSync(expected) || !fs.statSync(expected).isFile()) continue;
    assert.equal(crypto.createHash('sha256').update(asar.extractFile(archive, entry.archivePath)).digest('hex'), sha256(expected), `Packaged source drifted: ${entry.relativePath}`);
    exactSourceMatches += 1;
  }
  const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const packagedJson = JSON.parse(asar.extractFile(archive, 'package.json').toString('utf8'));
  assert.equal(packagedJson.name, packageJson.name);
  assert.equal(packagedJson.version, packageJson.version);
  assert.deepEqual(packagedJson.dialed, packageJson.dialed);
  assert.equal(sha256(path.join(ROOT, 'src/main/input-devices/usb-native.cs')), NATIVE_INPUT_SOURCE_SHA256);

  const hidusbfRoot = path.join(unpacked, 'resources', 'hidusbf');
  const bundle = verifyBundledInventory(hidusbfRoot, { packaged: true });
  const driverPayloads = [];
  (function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.isFile() && /\.(?:inf|sys|cat)$/i.test(entry.name)) driverPayloads.push(file);
    }
  }(unpacked));
  const inventory = JSON.parse(fs.readFileSync(path.join(hidusbfRoot, 'inventory.json'), 'utf8'));
  const expectedPayloads = inventory.files.filter((entry) => entry.selected && /\.(?:inf|sys|cat)$/i.test(entry.path)).map((entry) => path.join(hidusbfRoot, 'payload', ...entry.path.split('/'))).sort();
  assert.deepEqual(driverPayloads.sort(), expectedPayloads);

  const report = {
    schemaVersion: 1,
    status: 'UNLAUNCHED_NATIVE_VALIDATION_PACKAGE_VERIFIED',
    verifiedAt: new Date().toISOString(),
    packageRoot,
    unpackedDirectory: unpacked,
    application: { file: 'package/win-unpacked/Dialed.exe', sha256: sha256(appExecutable), authenticode: auth.find((value) => path.resolve(value.path) === path.resolve(appExecutable))?.status || 'Unknown', launched: false },
    archive: { file: 'package/win-unpacked/resources/app.asar', sha256: sha256(archive), entries: entries.length, exactSourceMatches },
    native: { status: brokerStatus.code, artifacts: signatures.artifacts.map((artifact) => ({ file: artifact.file, sha256: artifact.sha256, authenticode: artifact.authenticode, publisherThumbprint: artifact.publisherThumbprint, timestampPresent: artifact.timestampPresent })), signTool },
    policy: { purpose: review.Purpose, expiresAt: review.ExpiresAt, platformCount: review.AcceptedPlatformDigests.length, authorizedDeviceCount: review.AuthorizedDeviceDigests.length, javascriptContract: 'PASS', csharpContract: 'PASS' },
    hidusbfBundle: bundle,
    productExecutableLaunched: false,
    installerBuiltOrRun: false,
    nativeRebuiltOrResigned: false,
    physicalAcceptance: false,
    publicationApproved: false,
  };
  const sums = `${report.application.sha256}  ${report.application.file}\n${report.archive.sha256}  ${report.archive.file}\n`;
  const evidence = writeOrVerifyReport(report, path.join(packageRoot, 'PACKAGE_VERIFICATION.json'), path.join(packageRoot, 'SHA256SUMS.txt'), sums);
  console.log(JSON.stringify({ status: report.status, evidence, packageRoot, nativeFiles: report.native.artifacts.length, policy: report.policy }));
}

if (require.main === module) {
  try { main(process.argv.slice(2)); }
  catch { console.error('Native validation package verification failed. No product executable was launched.'); process.exitCode = 1; }
}

module.exports = { inspectAuthenticode, parseArguments, verifySignTool, writeOrVerifyReport };
