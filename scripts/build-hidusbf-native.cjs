// Compile/package preparation only. Never launches, elevates or signs an executable.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { checkAnchors, anchorValues, safePath } = require('./native-release-policy.cjs');
const root = path.resolve(__dirname, '..');
const trust = checkAnchors(root);
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--output' || !path.isAbsolute(args[1]))) throw new Error('Only --output with an absolute new directory is supported.');
if (trust !== 'UNCONFIGURED' && !args.length) throw new Error('A compiled public key requires --output with a new candidate directory; do not rebuild over staged signed bytes.');
const destination = args.length ? path.resolve(args[1]) : path.join(root, 'output', 'hidusbf-native');
safePath(destination, { missing: true });
if (args.length && fs.existsSync(destination)) throw new Error('Explicit native build output must not already exist.');
if (['release-policy.json', 'release-policy.sig'].some(file => fs.existsSync(path.join(destination, file)))) throw new Error('A native policy exists; preserve it and use a separately reviewed release workflow.');
const staging = path.join(root, 'output', `hidusbf-native-build-${Date.now()}`);
fs.mkdirSync(destination, { recursive: true });
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const sourceFiles = [];
for (const directory of ['hidusbf-helper', 'hidusbf-host', 'hidusbf-broker']) for (const file of fs.readdirSync(path.join(root, 'native', directory))) {
  if (/\.(cs|csproj)$/.test(file)) sourceFiles.push(`native/${directory}/${file}`);
}
sourceFiles.push('src/main/input-devices/usb-native.cs', 'src/main/input-driver-lifecycle/native-broker.cjs', 'src/main/input-driver-lifecycle/release-policy-contract.cjs');
const sources = sourceFiles.sort().map(file => ({ file, sha256: sha(path.join(root, file)) }));
const artifacts = [];
for (const [folder, assembly] of [['hidusbf-host', 'Dialed.HidusbfHost'], ['hidusbf-broker', 'Dialed.HidusbfBroker']]) {
  const output = path.join(staging, folder);
  execFileSync('dotnet', ['publish', path.join(root, 'native', folder, `${assembly}.csproj`), '-c', 'Release', '-o', output], { cwd: root, stdio: 'inherit', windowsHide: true, timeout: 120000 });
  const source = path.join(output, `${assembly}.exe`), target = path.join(destination, `${assembly}.exe`);
  fs.copyFileSync(source, target);
  artifacts.push({ file: path.basename(target), sha256: sha(target), bytes: fs.statSync(target).size });
}
if (sources.some(source => sha(path.join(root, source.file)) !== source.sha256)) throw new Error('Native source changed during compilation; do not use these artifacts.');
if (checkAnchors(root) !== trust) throw new Error('Compiled policy trust changed during the build.');
const publicPem = anchorValues(root)[0].value;
const manifest = { schemaVersion: 1, status: trust === 'UNCONFIGURED' ? 'UNSIGNED_UNCONFIGURED_SOURCE_BUILD' : 'UNSIGNED_PUBLIC_KEY_COMPILED_SOURCE_BUILD', generatedAt: new Date().toISOString(),
  policyTrust: trust, policyPublicKeySpkiSha256: publicPem ? crypto.createHash('sha256').update(crypto.createPublicKey(publicPem).export({ type: 'spki', format: 'der' })).digest('hex') : null,
  runtimeRequirement: 'Microsoft .NET 8 Windows Desktop x64 installed through its normal supported installation',
  executed: false, signed: false, physicalAcceptance: false, artifacts,
  sources };
fs.writeFileSync(path.join(destination, 'BUILD_MANIFEST.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify(manifest, null, 2));
