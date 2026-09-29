// Makes polling-rate changes work in a release build. Builds the two native helpers,
// Authenticode-signs them, and signs a general release policy that pins exactly those signed
// files with the owner's policy key. Without this step the installed app can list devices but
// "Change rate…" never opens. Every build changes the helpers' hashes, so this runs for every
// release (electron:build runs it); the policy also expires, see LIFETIME_DAYS.
// Never launches a helper, changes a device or touches Windows settings.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { resolveSigningConfiguration, assertSigningReady, signFile } = require('./windows-signing.cjs');
const { checkAnchors, anchorValues, publicIdentity } = require('./native-release-policy.cjs');
const { readNativeBrokerStatus } = require('../src/main/input-driver-lifecycle/native-broker.cjs');

const root = path.resolve(__dirname, '..');
const NATIVE = ['Dialed.HidusbfBroker.exe', 'Dialed.HidusbfHost.exe'];
// The contract allows 400 days; the margin keeps a slow clock from refusing a fresh policy.
const LIFETIME_DAYS = 395;
// What the helper may change. It still refuses on its own anything outside these: Low-Speed or
// unknown-speed devices, non-USB devices, and HID usages other than these four. Windows 10 2004
// matches the input capability's "Windows 10 and 11"; only build 26200 has been tested.
const RELEASE_SCOPE = { DeviceClasses: ['GAMEPAD', 'JOYSTICK', 'KEYBOARD', 'MOUSE'], SpeedClasses: ['FULL', 'HIGH'], MinimumWindowsBuild: 19041, DeniedDevices: [] };

const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const hashFile = file => sha256(fs.readFileSync(file));

function keyDirectoryFrom(argv) {
  if (!argv.length) return path.join(os.homedir(), '.dialed-signing');
  if (argv.length !== 2 || argv[0] !== '--key-directory' || !path.isAbsolute(argv[1])) throw new Error('Only --key-directory with an absolute path is supported.');
  return path.resolve(argv[1]);
}

function authenticode(files) {
  const quote = value => `'${value.replace(/'/g, "''")}'`;
  const command = `@(${files.map(quote).join(',')}) | ForEach-Object { $s = Get-AuthenticodeSignature -LiteralPath $_; `
    + `[pscustomobject]@{ status = [string]$s.Status; subject = [string]$s.SignerCertificate.Subject; thumbprint = [string]$s.SignerCertificate.Thumbprint; timestamped = [bool]$s.TimeStamperCertificate } } | ConvertTo-Json -Compress`;
  const parsed = JSON.parse(execFileSync('pwsh.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8', windowsHide: true, timeout: 60000 }));
  return Array.isArray(parsed) ? parsed : [parsed];
}

function main(argv) {
  const keyDirectory = keyDirectoryFrom(argv);
  const publicKeyPath = path.join(keyDirectory, 'release-policy-public.pem');
  if (checkAnchors(root) !== 'PUBLIC_KEY_COMPILED_INACTIVE') throw new Error('No release public key is compiled into source; see docs/NATIVE_RELEASE_POLICY_WORKFLOW.md.');
  const fingerprint = sha256(crypto.createPublicKey(anchorValues(root)[0].value).export({ type: 'spki', format: 'der' }));
  // The key folder must hold the same key the app will trust, or the policy would be useless.
  checkAnchors(root, publicIdentity(fs.readFileSync(publicKeyPath), fingerprint));
  const signing = resolveSigningConfiguration();
  assertSigningReady(signing);
  if (!signing.requested) throw new Error('Code signing is not configured. Set DIALED_ENABLE_SIGNING=true and the Artifact Signing variables; see docs/RELEASE_PACKAGING_CHECKLIST.md.');

  const work = path.join(root, 'output', `native-release-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  const native = path.join(work, 'native');
  const policyDirectory = path.join(work, 'policy');
  fs.mkdirSync(work, { recursive: true });
  execFileSync(process.execPath, [path.join(root, 'scripts', 'build-hidusbf-native.cjs'), '--output', native], { cwd: root, stdio: 'inherit', windowsHide: true });

  for (const name of NATIVE) {
    const result = signFile(path.join(native, name), signing);
    if (!result.signed && !result.alreadyValid) throw new Error(`Native helper was not signed: ${name}`);
  }
  const signatures = authenticode(NATIVE.map(name => path.join(native, name)));
  if (signatures.length !== NATIVE.length || signatures.some(item => item.status !== 'Valid' || !item.timestamped)) throw new Error('A native helper lacks a valid, timestamped signature.');
  const thumbprints = [...new Set(signatures.map(item => item.thumbprint.toUpperCase()))];
  if (thumbprints.length !== 1 || !/^[A-F0-9]{40}$/.test(thumbprints[0])) throw new Error('The native helpers were signed by different certificates.');

  // The policy pins the final signed bytes; nothing may rebuild or re-sign them after this.
  const review = {
    SchemaVersion: 2,
    ExpiresAt: new Date(Date.now() + LIFETIME_DAYS * 24 * 60 * 60 * 1000).toISOString(),
    BrokerSha256: hashFile(path.join(native, 'Dialed.HidusbfBroker.exe')),
    HelperSha256: hashFile(path.join(native, 'Dialed.HidusbfHost.exe')),
    PublisherThumbprint: thumbprints[0],
    Purpose: 'ACCEPTED_RELEASE',
    ...RELEASE_SCOPE,
  };
  const reviewPath = path.join(work, 'release-review.json');
  fs.writeFileSync(reviewPath, JSON.stringify(review, null, 2) + '\n', { flag: 'wx' });
  const tool = path.join(root, 'scripts', 'native-release-policy.cjs');
  const common = ['--review', reviewPath, '--candidate', native, '--public-key', publicKeyPath, '--fingerprint', fingerprint];
  const run = args => execFileSync(process.execPath, [tool, ...args], { cwd: root, stdio: 'inherit', windowsHide: true, timeout: 180000 });
  run(['prepare-release', ...common, '--output', policyDirectory]);
  // Private key bytes stay inside this PowerShell process; only paths cross over.
  execFileSync('pwsh.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', path.join(root, 'scripts', 'native-policy-key.ps1'),
    '-Action', 'Sign', '-Release', '-KeyDirectory', keyDirectory, '-PublicFingerprint', fingerprint,
    '-PolicyPath', path.join(policyDirectory, 'release-policy.json'), '-SignaturePath', path.join(policyDirectory, 'release-policy.sig')], { cwd: root, stdio: 'inherit', windowsHide: true, timeout: 120000 });
  run(['verify-release', ...common, '--policy-dir', policyDirectory]);

  for (const name of ['release-policy.json', 'release-policy.sig']) fs.copyFileSync(path.join(policyDirectory, name), path.join(native, name), fs.constants.COPYFILE_EXCL);
  const status = readNativeBrokerStatus(native);
  if (!status.available) throw new Error(`The signed native release is not accepted: ${status.message}`);

  // electron-builder packages output/hidusbf-native. Its signing hook keeps an existing valid
  // signature, so the packaged helpers stay byte-identical to what the policy pins.
  const target = path.join(root, 'output', 'hidusbf-native');
  fs.rmSync(target, { recursive: true, force: true });
  fs.cpSync(native, target, { recursive: true, errorOnExist: true });
  for (const name of [...NATIVE, 'BUILD_MANIFEST.json', 'release-policy.json', 'release-policy.sig']) {
    if (hashFile(path.join(target, name)) !== hashFile(path.join(native, name))) throw new Error(`Copy of ${name} differs.`);
  }
  if (!readNativeBrokerStatus(target).available) throw new Error('The staged native release is not accepted.');

  const evidence = {
    status: 'NATIVE_RELEASE_READY',
    generatedAt: new Date().toISOString(),
    policyPublicKeySpkiSha256: fingerprint,
    publisher: signatures[0].subject,
    publisherThumbprint: thumbprints[0],
    expiresAt: review.ExpiresAt,
    scope: RELEASE_SCOPE,
    brokerSha256: review.BrokerSha256,
    helperSha256: review.HelperSha256,
    staged: path.relative(root, target),
    evidence: path.relative(root, work),
    executed: false,
  };
  fs.writeFileSync(path.join(work, 'NATIVE_RELEASE.json'), JSON.stringify(evidence, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify(evidence, null, 2));
}

if (require.main === module) {
  try { main(process.argv.slice(2)); }
  catch (error) { console.error(`Native release refused: ${error.message}`); process.exitCode = 1; }
}
module.exports = { LIFETIME_DAYS, RELEASE_SCOPE, keyDirectoryFrom, main };
