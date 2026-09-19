// Read-only source/package verification followed by local evidence generation.
// Never launches the app, installs software, signs files, or mutates Windows.
const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const asar = require('@electron/asar');
const { NATIVE_INPUT_SOURCE_SHA256 } = require('../src/main/input-devices/index.cjs');
const { verifyBundledInventory } = require('../src/main/input-driver-lifecycle/bundled-inventory.cjs');

const root = path.resolve(__dirname, '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const productName = String(packageJson.build?.productName || packageJson.name || '').trim();
const version = String(packageJson.version || '').trim();
const directory = path.resolve(root, process.argv[2] || 'dist-electron-current-source');
const portableName = `${productName} ${version}.exe`;
const portable = path.join(directory, portableName);
const unpacked = path.join(directory, 'win-unpacked', `${productName}.exe`);
const archive = path.join(directory, 'win-unpacked', 'resources', 'app.asar');
const presentMon = path.join(directory, 'win-unpacked', 'resources', 'presentmon', 'PresentMon-2.5.1-x64.exe');

for (const required of [portable, unpacked, archive, presentMon]) {
  assert.ok(fs.statSync(required).isFile(), `Required candidate file is missing: ${required}`);
}

const hashFile = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const archiveEntries = asar.listPackage(archive).map((entry) => {
  const archivePath = entry.replace(/^[/\\]+/, '');
  return { archivePath, relativePath: archivePath.replace(/\\/g, '/') };
});
const fileEntries = archiveEntries.filter(({ archivePath }) => !asar.statFile(archive, archivePath).files);
const allowedRoots = new Set(['dist', 'electron', 'src', 'package.json']);

for (const { relativePath: entry } of archiveEntries) {
  assert.ok(allowedRoots.has(entry.split('/')[0]), `Unexpected ASAR root: ${entry}`);
  if (entry === 'src' || entry.startsWith('src/')) {
    assert.ok(entry === 'src' || entry === 'src/main' || entry.startsWith('src/main/'), `Unexpected packaged source path: ${entry}`);
  }
  assert.ok(!entry.split('/').includes('node_modules'), `node_modules must not be packaged: ${entry}`);
}

let exactSourceMatches = 0;
for (const { archivePath, relativePath: entry } of fileEntries) {
  if (entry === 'package.json') continue;
  const source = path.join(root, ...entry.split('/'));
  if (!fs.existsSync(source) || !fs.statSync(source).isFile()) continue;
  const packagedBytes = asar.extractFile(archive, archivePath);
  assert.equal(
    crypto.createHash('sha256').update(packagedBytes).digest('hex'),
    hashFile(source),
    `Packaged file differs from source: ${entry}`,
  );
  exactSourceMatches += 1;
}

const packagedManifest = JSON.parse(asar.extractFile(archive, 'package.json').toString('utf8'));
assert.equal(packagedManifest.name, packageJson.name, 'Packaged application name drifted.');
assert.equal(packagedManifest.version, version, 'Packaged application version drifted.');
assert.equal(Object.keys(packagedManifest.dependencies || {}).length, 0, 'Production dependencies must remain empty.');
const packagedInputDriver = packagedManifest.dialed?.inputDriver;
assert.deepEqual(packagedInputDriver, packageJson.dialed?.inputDriver, 'Packaged input-driver configuration differs from reviewed source.');
assert.equal(packagedInputDriver?.status, 'UNCONFIGURED', 'Unsigned private candidate must keep standalone driver setup unavailable.');
assert.equal(packagedInputDriver?.manifestPath, '', 'Unsigned private candidate must not configure a driver manifest path.');
assert.equal(packagedInputDriver?.manifestSha256, '', 'Unsigned private candidate must not configure a driver manifest digest.');
assert.equal(packagedInputDriver?.publisherThumbprint, '', 'Unsigned private candidate must not configure a driver publisher.');
assert.equal(packagedInputDriver?.transactionStoreIdentity, '', 'Unsigned private candidate must not configure a protected driver journal.');
assert.equal(packagedInputDriver?.cleanMachineAcceptance, 'PENDING', 'Unsigned private candidate must not claim clean-machine driver acceptance.');

const nativeInputArchivePath = 'src/main/input-devices/usb-native.cs';
const nativeInputEntry = fileEntries.find(({ relativePath }) => relativePath === nativeInputArchivePath);
assert.ok(nativeInputEntry, 'Packaged ASAR is missing the Input Devices native source.');
const packagedNativeInputSource = asar.extractFile(archive, nativeInputEntry.archivePath);
assert.equal(hashFile(path.join(root, nativeInputArchivePath)), NATIVE_INPUT_SOURCE_SHA256, 'Reviewed Input Devices native source digest drifted from its runtime pin.');
assert.equal(crypto.createHash('sha256').update(packagedNativeInputSource).digest('hex'), NATIVE_INPUT_SOURCE_SHA256, 'Packaged ASAR Input Devices native source differs from its runtime pin.');
assert.equal(fs.existsSync(path.join(directory, 'win-unpacked', 'resources', 'input-devices', 'usb-native.cs')), false, 'Input Devices native source must not be duplicated outside ASAR.');

const quotePowerShell = (value) => `'${value.replace(/'/g, "''")}'`;
const nativeExecutables = ['Dialed.HidusbfBroker.exe', 'Dialed.HidusbfHost.exe'].map(name => path.join(directory, 'win-unpacked', 'resources', 'hidusbf-native', name));
const inspectedPaths = [portable, unpacked, presentMon, ...nativeExecutables];
const powerShell = `@(${inspectedPaths.map(quotePowerShell).join(',')}) | ForEach-Object { `
  + `$item = Get-Item -LiteralPath $_; $signature = Get-AuthenticodeSignature -LiteralPath $_; `
  + `[pscustomobject]@{ path = $_; fileVersion = [string]$item.VersionInfo.FileVersion; productVersion = [string]$item.VersionInfo.ProductVersion; status = [string]$signature.Status } `
  + `} | ConvertTo-Json -Compress`;
const rawInspection = JSON.parse(childProcess.execFileSync('pwsh.exe', [
  '-NoProfile', '-NonInteractive', '-Command', powerShell,
], { encoding: 'utf8', windowsHide: true, timeout: 30000 }));
const inspections = Array.isArray(rawInspection) ? rawInspection : [rawInspection];
const inspectionFor = (file) => inspections.find((item) => path.resolve(item.path) === path.resolve(file));
const portableInspection = inspectionFor(portable);
const unpackedInspection = inspectionFor(unpacked);
const presentMonInspection = inspectionFor(presentMon);
assert.ok(portableInspection && unpackedInspection && presentMonInspection, 'Authenticode inspection was incomplete.');
assert.equal(portableInspection.status, 'NotSigned', 'Private portable unexpectedly has an Authenticode signature.');
assert.equal(unpackedInspection.status, 'NotSigned', 'Private unpacked app unexpectedly has an Authenticode signature.');
assert.equal(presentMonInspection.status, 'Valid', 'Pinned PresentMon signature is not valid.');
for (const native of nativeExecutables) assert.equal(inspectionFor(native)?.status, 'NotSigned', 'Native private source build unexpectedly signed.');
assert.ok(portableInspection.fileVersion.startsWith(version), 'Portable file version drifted.');
assert.ok(portableInspection.productVersion.startsWith(version), 'Portable product version drifted.');

const lifecycleFiles = fileEntries.filter(({ relativePath }) => relativePath.startsWith('src/main/input-driver-lifecycle/'));
const driverPayloadFiles = [];
function collectDriverPayloads(directoryPath) {
  for (const entry of fs.readdirSync(directoryPath, { withFileTypes: true })) {
    const file = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) collectDriverPayloads(file);
    else if (entry.isFile() && /\.(?:inf|sys|cat)$/i.test(entry.name)) driverPayloadFiles.push(file);
  }
}
collectDriverPayloads(directory);
assert.deepEqual(lifecycleFiles.map(({ relativePath }) => path.posix.basename(relativePath)).sort(), [
  'bundled-inventory.cjs', 'bundled-status.cjs', 'legacy-service-contract.cjs', 'legacy-service.cjs',
  'native-broker.cjs',
  'driver-package-manifest.example.json', 'driver-package-manifest.schema.json',
  'helper-protocol.cjs', 'index.cjs', 'upstream-adapter.cjs',
  'upstream-package-evidence.cjs', 'upstream-package-evidence.example.json',
  'upstream-package-evidence.schema.json',
].sort(), 'Packaged input framework must match the reviewed offline source inventory.');
const hidusbfRoot = path.join(directory, 'win-unpacked', 'resources', 'hidusbf');
const hidusbfBundle = verifyBundledInventory(hidusbfRoot, { packaged: true });
const nativeRoot = path.join(directory, 'win-unpacked', 'resources', 'hidusbf-native');
assert.deepEqual(fs.readdirSync(nativeRoot).sort(), ['BUILD_MANIFEST.json', 'Dialed.HidusbfBroker.exe', 'Dialed.HidusbfHost.exe']);
const nativeBuild = JSON.parse(fs.readFileSync(path.join(nativeRoot, 'BUILD_MANIFEST.json'), 'utf8'));
assert.equal(nativeBuild.status, 'UNSIGNED_UNCONFIGURED_SOURCE_BUILD');
assert.equal(nativeBuild.executed, false); assert.equal(nativeBuild.signed, false); assert.equal(nativeBuild.physicalAcceptance, false);
for (const source of nativeBuild.sources) assert.equal(hashFile(path.join(root, source.file)), source.sha256, `Native source changed after build: ${source.file}`);
for (const artifact of nativeBuild.artifacts) {
  assert.equal(hashFile(path.join(nativeRoot, artifact.file)), artifact.sha256);
}
const bundleInventory = JSON.parse(fs.readFileSync(path.join(hidusbfRoot, 'inventory.json'), 'utf8'));
const expectedDriverPayloads = bundleInventory.files.filter((file) => file.selected && /\.(?:inf|sys|cat)$/i.test(file.path)).map((file) => path.join(hidusbfRoot, 'payload', ...file.path.split('/'))).sort();
assert.deepEqual(driverPayloadFiles.sort(), expectedDriverPayloads, 'Only the exact reviewed upstream resource payload may be bundled.');
assert.equal(fs.readFileSync(path.join(hidusbfRoot, 'README.md'), 'utf8'), fs.readFileSync(path.join(root, 'vendor/hidusbf/README.md'), 'utf8'), 'Bundled credit/update policy drifted.');

const artifact = {
  fileName: portableName,
  bytes: fs.statSync(portable).size,
  sha256: hashFile(portable),
  fileVersion: portableInspection.fileVersion,
  productVersion: portableInspection.productVersion,
  authenticode: portableInspection.status,
};
const unpackedExecutable = {
  fileName: `win-unpacked/${productName}.exe`,
  bytes: fs.statSync(unpacked).size,
  sha256: hashFile(unpacked),
  authenticode: unpackedInspection.status,
};
const archiveEvidence = {
  fileName: 'win-unpacked/resources/app.asar',
  bytes: fs.statSync(archive).size,
  sha256: hashFile(archive),
  entries: archiveEntries.length,
  exactSourceMatches,
  productionDependencies: Object.keys(packagedManifest.dependencies || {}).length,
};
const report = {
  schemaVersion: '1.0.0',
  product: productName,
  version,
  generatedAt: new Date().toISOString(),
  status: 'UNSIGNED_PRIVATE_PORTABLE_CANDIDATE',
  artifact,
  unpackedExecutable,
  archive: archiveEvidence,
  inputDriverLifecycle: {
    bundle: hidusbfBundle,
    nativeBuild,
    status: packagedInputDriver.status,
    frameworkFilesPresent: lifecycleFiles.length,
    payloadFilesPresent: driverPayloadFiles.length,
  },
  inputDevicesNativeSource: {
    archivePath: nativeInputArchivePath,
    sha256: NATIVE_INPUT_SOURCE_SHA256,
    externalCopyPresent: false,
  },
  presentMon: {
    sha256: hashFile(presentMon),
    authenticode: presentMonInspection.status,
  },
  acceptance: {
    sourceEvidenceReference: 'VERIFICATION.md',
    sourceGatesExecutedByThisVerifier: false,
    sourceTests: 'NOT_RUN_BY_THIS_VERIFIER',
    typeScript: 'NOT_RUN_BY_THIS_VERIFIER',
    productionBuild: 'PACKAGED_OUTPUT_INSPECTED',
    browserFixtures: 'NOT_RUN_BY_THIS_VERIFIER',
    cleanRoomParity: 'NOT_RUN_BY_THIS_VERIFIER',
    bunAudit: 'NOT_RUN_BY_THIS_VERIFIER',
    nativeLaunch: 'NOT_RUN',
    installer: 'NOT_BUILT_OR_RUN',
    signingOperations: 0,
    publicationApproved: false,
  },
};

fs.writeFileSync(path.join(directory, 'CANDIDATE_MANIFEST.json'), `${JSON.stringify(report, null, 2)}\n`);
const sums = [artifact, unpackedExecutable, archiveEvidence]
  .map((item) => `${item.sha256}  ${item.fileName}`)
  .join('\n');
fs.writeFileSync(path.join(directory, 'SHA256SUMS.txt'), `${sums}\n`);
console.log(JSON.stringify(report, null, 2));
