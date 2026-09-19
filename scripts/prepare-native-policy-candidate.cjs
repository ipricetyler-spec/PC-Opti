// Build a reviewable, key-compiled native candidate without changing development
// anchors, copying private material, signing, packaging or launching product code.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const workflow = require('./native-release-policy.cjs');
const root = path.resolve(__dirname, '..');
const options = {};
for (let index = 2; index < process.argv.length; index += 2) {
  const name = process.argv[index], value = process.argv[index + 1];
  if (!['--public-key', '--fingerprint', '--output'].includes(name) || Object.hasOwn(options, name) || !value) throw new Error('Expected unique public-key, fingerprint and output options.');
  options[name] = value;
}
if (Object.keys(options).length !== 3) throw new Error('Public key, reviewed fingerprint and new output are required.');
const identity = workflow.publicIdentity(workflow.readBounded(options['--public-key'], 16384), options['--fingerprint']);
const destination = workflow.safePath(options['--output'], { missing: true });
const relative = path.relative(path.join(root, 'output'), destination);
if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) || fs.existsSync(destination)) throw new Error('Candidate must use a new directory under this checkout output directory.');
const sourceRoot = path.join(destination, 'source');
const unsignedRoot = path.join(destination, 'unsigned');
const signingRoot = path.join(destination, 'signing');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const sourceFiles = [
  'scripts/build-hidusbf-native.cjs', 'scripts/native-release-policy.cjs',
  'src/main/input-devices/usb-native.cs', 'src/main/input-driver-lifecycle/native-broker.cjs',
  'src/main/input-driver-lifecycle/release-policy-contract.cjs',
];
for (const directory of ['hidusbf-helper', 'hidusbf-host', 'hidusbf-broker', 'hidusbf-helper-fixture', 'hidusbf-boot-diagnostic']) {
  for (const name of fs.readdirSync(path.join(root, 'native', directory))) if (/\.(cs|csproj)$/.test(name)) sourceFiles.push(`native/${directory}/${name}`);
}
const sources = sourceFiles.sort().map(file => ({ file, bytes: workflow.readBounded(path.join(root, file), 1024 * 1024) }));
fs.mkdirSync(destination);
for (const source of sources) {
  const file = path.join(sourceRoot, source.file);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, source.bytes, { flag: 'wx' });
}
workflow.compileAnchors(identity, { root: sourceRoot, write: true });
workflow.checkAnchors(sourceRoot, identity);
execFileSync(process.execPath, [path.join(sourceRoot, 'scripts/build-hidusbf-native.cjs'), '--output', unsignedRoot], { cwd: sourceRoot, windowsHide: true, timeout: 180000, stdio: 'inherit' });
if (sources.some(source => sha(workflow.readBounded(path.join(root, source.file), 1024 * 1024)) !== sha(source.bytes))) throw new Error('Canonical source drifted during candidate preparation.');
const build = JSON.parse(fs.readFileSync(path.join(unsignedRoot, 'BUILD_MANIFEST.json'), 'utf8'));
if (build.policyPublicKeySpkiSha256 !== identity.fingerprint || build.policyTrust !== 'PUBLIC_KEY_COMPILED_INACTIVE' || build.signed || build.executed) throw new Error('Unexpected native candidate manifest.');
fs.mkdirSync(signingRoot);
for (const artifact of build.artifacts) {
  if (!['Dialed.HidusbfHost.exe', 'Dialed.HidusbfBroker.exe'].includes(artifact.file)) throw new Error('Unexpected build artifact.');
  const bytes = workflow.readBounded(path.join(unsignedRoot, artifact.file), 128 * 1024 * 1024);
  if (sha(bytes) !== artifact.sha256) throw new Error('Native build artifact changed.');
  fs.writeFileSync(path.join(signingRoot, artifact.file), bytes, { flag: 'wx' });
}
fs.copyFileSync(path.join(unsignedRoot, 'BUILD_MANIFEST.json'), path.join(signingRoot, 'UNSIGNED_BUILD_MANIFEST.json'), fs.constants.COPYFILE_EXCL);
const manifest = { schemaVersion: 1, status: 'PUBLIC_KEY_COMPILED_UNSIGNED_CANDIDATE', generatedAt: new Date().toISOString(),
  publicKeySpkiSha256: identity.fingerprint, canonicalTrust: workflow.checkAnchors(root), sourceRoot, unsignedRoot, signingRoot,
  signed: false, executed: false, policyIssued: false, privateKeyIncluded: false, artifacts: build.artifacts,
  sources: sources.map(source => ({ file: source.file, canonicalSha256: sha(source.bytes), candidateSha256: sha(fs.readFileSync(path.join(sourceRoot, source.file))) })) };
fs.writeFileSync(path.join(destination, 'PREPARATION_MANIFEST.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ status: manifest.status, publicKeySpkiSha256: identity.fingerprint, directory: destination, canonicalTrust: manifest.canonicalTrust }));
