// Prepare an unpacked, non-launched validation candidate around the exact signed
// native helpers and verified policy. Native code is never rebuilt or re-signed.
const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const inside = (base, target) => { const relative = path.relative(base, target); return !relative || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)); };

function parseArguments(argv) {
  const allowed = ['--candidate', '--policy-dir', '--review', '--public-key', '--fingerprint', '--output', '--signed-fixture'];
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index], value = argv[index + 1];
    if (!allowed.includes(name) || !value || options[name]) throw new Error('Expected unique candidate, policy-dir, review, public-key, fingerprint and output options.');
    options[name] = value;
  }
  if (allowed.some(name => name !== '--signed-fixture' && !options[name])) throw new Error('All native validation package options are required.');
  for (const name of Object.keys(options).filter((name) => name !== '--fingerprint')) if (!path.isAbsolute(options[name])) throw new Error('Native validation package paths must be absolute.');
  const output = path.resolve(options['--output']);
  if (!inside(path.join(ROOT, 'output'), output) || output === path.join(ROOT, 'output') || fs.existsSync(output)) throw new Error('Package output must be a new directory under the authoritative output directory.');
  return options;
}

function refuseLinks(target) {
  for (let current = path.resolve(target); ; current = path.dirname(current)) {
    if (fs.lstatSync(current).isSymbolicLink()) throw new Error('Linked package paths are refused.');
    if (current === path.dirname(current)) break;
  }
}

function copyTree(source, destination) {
  refuseLinks(source);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.cpSync(source, destination, { recursive: true, errorOnExist: true, force: false, dereference: false, filter(file) {
    if (fs.lstatSync(file).isSymbolicLink()) throw new Error('Linked package content is refused.');
    return true;
  } });
}

function verifyPreservedCandidate(candidate, fingerprint) {
  refuseLinks(candidate);
  const preparation = JSON.parse(fs.readFileSync(path.join(candidate, 'PREPARATION_MANIFEST.json'), 'utf8'));
  const signatures = JSON.parse(fs.readFileSync(path.join(candidate, 'SIGNATURE_MANIFEST.json'), 'utf8'));
  if (preparation.publicKeySpkiSha256 !== fingerprint || preparation.canonicalTrust !== 'UNCONFIGURED' || preparation.executed !== false || preparation.privateKeyIncluded !== false) throw new Error('Candidate preparation identity differs from the reviewed key-compiled source.');
  if (signatures.status !== 'NATIVE_AUTHENTICODE_VERIFIED_POLICY_PENDING' || signatures.publicPolicyKeySpkiSha256 !== fingerprint || signatures.unsignedBuildPreserved !== true || signatures.artifacts?.length !== 2) throw new Error('Candidate signature manifest is incomplete.');
  for (const source of preparation.sources) {
    if (sha256(path.join(ROOT, source.file)) !== source.canonicalSha256) throw new Error(`Canonical source drifted after native signing: ${source.file}`);
    if (sha256(path.join(candidate, 'source', source.file)) !== source.candidateSha256) throw new Error(`Candidate source drifted after native signing: ${source.file}`);
  }
  const artifacts = new Map(signatures.artifacts.map((artifact) => [artifact.file, artifact]));
  for (const name of ['Dialed.HidusbfBroker.exe', 'Dialed.HidusbfHost.exe']) {
    const artifact = artifacts.get(name);
    if (!artifact || artifact.authenticode !== 'Valid' || artifact.timestampPresent !== true || artifact.signToolExit !== 0 || artifact.executed !== false || sha256(path.join(candidate, 'signing', name)) !== artifact.sha256) throw new Error(`Signed native artifact drifted: ${name}`);
  }
  return { preparation, signatures };
}

function runPolicyVerification(options, candidate) {
  const script = path.join(candidate, 'source', 'scripts', 'native-release-policy.cjs');
  const result = childProcess.execFileSync(process.execPath, [script, 'verify',
    '--review', options['--review'], '--candidate', path.join(candidate, 'signing'),
    '--public-key', options['--public-key'], '--fingerprint', options['--fingerprint'],
    '--policy-dir', options['--policy-dir'],
    ...(options['--signed-fixture'] ? ['--signed-fixture', options['--signed-fixture']] : []),
  ], { cwd: path.join(candidate, 'source'), encoding: 'utf8', windowsHide: true, timeout: 120000, stdio: ['ignore', 'pipe', 'pipe'] });
  if (!result.includes('VALIDATION_POLICY_CONTRACT_VERIFIED')) throw new Error('Policy contracts were not verified before packaging.');
}

function resolveElectronVersion() {
  const packageFile = path.join(ROOT, 'node_modules', 'electron', 'package.json');
  const distribution = path.join(ROOT, 'node_modules', 'electron', 'dist');
  const lockFile = path.join(ROOT, 'bun.lock');
  const version = JSON.parse(fs.readFileSync(packageFile, 'utf8')).version;
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) throw new Error('Installed Electron version is not exact.');
  if (!fs.statSync(path.join(distribution, 'electron.exe')).isFile()) throw new Error('Installed Electron distribution is incomplete.');
  const lock = fs.readFileSync(lockFile, 'utf8');
  if (!lock.includes(`"electron": ["electron@${version}"`)) throw new Error('Installed Electron version differs from bun.lock.');
  return { version, distribution };
}

function writeStagedPackageJson(destination) {
  const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  if (!packageJson.build?.win?.signtoolOptions?.sign) throw new Error('Expected canonical signing hook is missing.');
  delete packageJson.build.win.signtoolOptions;
  // Keep manifest/icon editing: validation apps need the same UAC launch level.
  // Disable signing alone so the already-signed native files remain untouched.
  packageJson.build.win.signAndEditExecutable = true;
  packageJson.build.win.signExecutable = false;
  fs.writeFileSync(destination, `${JSON.stringify(packageJson, null, 2)}\n`, { flag: 'wx' });
}

function main(argv) {
  const options = parseArguments(argv);
  const candidate = path.resolve(options['--candidate']);
  const policyDirectory = path.resolve(options['--policy-dir']);
  const destination = path.resolve(options['--output']);
  const { signatures } = verifyPreservedCandidate(candidate, options['--fingerprint']);
  runPolicyVerification(options, candidate);

  // Refresh web assets only. This does not compile or touch the preserved native files.
  childProcess.execFileSync(process.execPath, ['run', 'build'], { cwd: ROOT, windowsHide: true, timeout: 180000, stdio: 'inherit' });
  fs.mkdirSync(destination);
  const project = path.join(destination, 'project');
  fs.mkdirSync(project);
  for (const directory of ['dist', 'electron', 'src/main', 'vendor/hidusbf', 'build']) copyTree(path.join(ROOT, directory), path.join(project, directory));
  fs.mkdirSync(path.join(project, 'scripts'));
  for (const file of ['electron-builder-sign.cjs', 'windows-signing.cjs']) fs.copyFileSync(path.join(ROOT, 'scripts', file), path.join(project, 'scripts', file), fs.constants.COPYFILE_EXCL);
  writeStagedPackageJson(path.join(project, 'package.json'));

  // The packaged JavaScript verifier must carry the same public key as the exact
  // already-signed native binaries. Canonical development source remains untouched.
  fs.copyFileSync(path.join(candidate, 'source', 'src/main/input-driver-lifecycle/native-broker.cjs'), path.join(project, 'src/main/input-driver-lifecycle/native-broker.cjs'));
  const native = path.join(project, 'output', 'hidusbf-native');
  fs.mkdirSync(native, { recursive: true });
  const review = JSON.parse(fs.readFileSync(options['--review'], 'utf8'));
  for (const name of ['Dialed.HidusbfBroker.exe', 'Dialed.HidusbfHost.exe']) fs.copyFileSync(path.join(candidate, 'signing', name), path.join(native, name), fs.constants.COPYFILE_EXCL);
  for (const name of ['release-policy.json', 'release-policy.sig']) fs.copyFileSync(path.join(policyDirectory, name), path.join(native, name), fs.constants.COPYFILE_EXCL);
  const unsigned = JSON.parse(fs.readFileSync(path.join(candidate, 'signing', 'UNSIGNED_BUILD_MANIFEST.json'), 'utf8'));
  const nativeManifest = {
    schemaVersion: 1,
    status: 'SIGNED_VALIDATION_POLICY_CANDIDATE',
    generatedAt: new Date().toISOString(),
    policyTrust: 'PUBLIC_KEY_COMPILED_INACTIVE',
    policyPublicKeySpkiSha256: options['--fingerprint'],
    purpose: review.Purpose,
    expiresAt: review.ExpiresAt,
    publisherThumbprint: review.PublisherThumbprint,
    executed: false,
    signed: true,
    policyIssued: true,
    physicalAcceptance: false,
    artifacts: signatures.artifacts.map((artifact) => ({ file: artifact.file, sha256: artifact.sha256, bytes: artifact.bytes, unsignedSha256: artifact.unsignedSha256, authenticode: artifact.authenticode, timestampPresent: artifact.timestampPresent })),
    unsignedProvenance: { status: unsigned.status, generatedAt: unsigned.generatedAt, artifacts: unsigned.artifacts },
    sources: unsigned.sources,
  };
  fs.writeFileSync(path.join(native, 'BUILD_MANIFEST.json'), `${JSON.stringify(nativeManifest, null, 2)}\n`, { flag: 'wx' });

  const packageOutput = path.join(destination, 'package');
  const electron = resolveElectronVersion();
  const environment = { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false', DIALED_ENABLE_SIGNING: '0', PC_OPTI_ENABLE_SIGNING: '0', DIALED_SIGNING_REQUIRED: '0', PC_OPTI_SIGNING_REQUIRED: '0' };
  childProcess.execFileSync(process.execPath, ['x', 'electron-builder', '--dir', '--win', '--projectDir', project,
    `--config.directories.output=${packageOutput}`, `--config.electronVersion=${electron.version}`, `--config.electronDist=${electron.distribution}`,
    '--config.npmRebuild=false', '--config.win.signExecutable=false'], {
    cwd: ROOT, env: environment, windowsHide: true, timeout: 300000, stdio: 'inherit',
  });
  const unpacked = path.join(packageOutput, 'win-unpacked');
  if (!fs.statSync(path.join(unpacked, 'Dialed.exe')).isFile()) throw new Error('Unpacked validation candidate was not created.');
  const manifest = {
    schemaVersion: 1,
    status: 'UNLAUNCHED_NATIVE_VALIDATION_PACKAGE_PREPARED',
    generatedAt: new Date().toISOString(),
    projectSource: project,
    unpackedDirectory: unpacked,
    nativeCandidate: candidate,
    policyDirectory,
    publicKeySpkiSha256: options['--fingerprint'],
    signedNativeFilesPreserved: true,
    nativeRebuilt: false,
    nativeResigned: false,
    productExecutableLaunched: false,
    installerBuiltOrRun: false,
    physicalAcceptance: false,
  };
  fs.writeFileSync(path.join(destination, 'PACKAGE_PREPARATION.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
  console.log(JSON.stringify({ status: manifest.status, directory: destination, unpackedDirectory: unpacked }));
}

if (require.main === module) {
  try { main(process.argv.slice(2)); }
  catch { console.error('Native validation package preparation refused. No product executable was launched.'); process.exitCode = 1; }
}

module.exports = { parseArguments, verifyPreservedCandidate, resolveElectronVersion, writeStagedPackageJson };
