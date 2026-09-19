const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { parsePolicy, parseGeneralPolicy, isGeneralRelease } = require('./release-policy-contract.cjs');
// Release-only trust anchor. Requests and environment variables cannot configure it.
const RELEASE_PUBLIC_KEY = '';
function verifyPolicy(bytes, signature, publicKey, now = Date.now()) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 1 || bytes.length > 65536 || !Buffer.isBuffer(signature) || signature.length < 1 || signature.length > 1024) throw new Error('Native release policy exceeds bounds.');
  const key = crypto.createPublicKey(publicKey);
  if (key.asymmetricKeyType !== 'rsa' || key.asymmetricKeyDetails.modulusLength < 3072 || !crypto.verify('sha256', bytes, { key, padding: crypto.constants.RSA_PKCS1_PSS_PADDING, saltLength: 32 }, signature)) throw new Error('Native release policy signature failed.');
  // Schema 2 is the general release; schema 1 lists exact platforms and devices.
  return isGeneralRelease(bytes) ? parseGeneralPolicy(bytes, now) : parsePolicy(bytes, now);
}
function readFile(file, maximum) {
  for (let current = path.resolve(file); ; current = path.dirname(current)) {
    if (fs.lstatSync(current).isSymbolicLink()) throw new Error('Linked native release path refused.');
    if (current === path.dirname(current)) break;
  }
  const size = fs.statSync(file).size;
  if (size < 1 || size > maximum) throw new Error('Native release file exceeds bounds.');
  return fs.readFileSync(file);
}
function readNativeBrokerStatus(directory) {
  if (!RELEASE_PUBLIC_KEY) return { available: false, code: 'NATIVE_RELEASE_TRUST_UNCONFIGURED', message: 'The native setup implementation is present in source, but this build has no signed native release configuration.' };
  try {
    const policy = verifyPolicy(readFile(path.join(directory, 'release-policy.json'), 65536), readFile(path.join(directory, 'release-policy.sig'), 1024), RELEASE_PUBLIC_KEY);
    for (const [name, hash] of [['Dialed.HidusbfBroker.exe', policy.BrokerSha256], ['Dialed.HidusbfHost.exe', policy.HelperSha256]]) {
      if (crypto.createHash('sha256').update(readFile(path.join(directory, name), 128 * 1024 * 1024)).digest('hex') !== hash) throw new Error('Native executable differs from the reviewed release.');
    }
    return { available: true, code: 'NATIVE_BROKER_READY', message: 'Open native setup to inspect this exact device and review an operation. Device compatibility is checked there.' };
  } catch (error) { return { available: false, code: 'NATIVE_RELEASE_REJECTED', message: error.message }; }
}
function observeSetupExit(child, onClosed) {
  // Process completion is only a refresh signal, never proof of a driver result.
  let completed = false;
  child.once('exit', () => { if (completed) return; completed = true; onClosed(); });
}
function setupSelectionArguments(deviceId) {
  if (typeof deviceId !== 'string' || deviceId.length !== 64 || !/^[a-f0-9]{64}$/.test(deviceId)) throw new Error('Select a valid input device for setup.');
  // Presentation hint only. Native inventory and policy still decide which
  // exact device exists and whether any operation may be reviewed/applied.
  return ['--select-device', deviceId];
}
function createNativeBrokerLauncher(directory, onClosed = () => {}) {
  let running = false;
  async function launch(deviceId) {
    const selectionArguments = setupSelectionArguments(deviceId);
    const status = readNativeBrokerStatus(directory);
    if (!status.available) throw new Error(status.message);
    if (running) throw new Error('Native driver setup is already open.');
    running = true;
    try {
      const systemRoot = process.env.SystemRoot || 'C:\\Windows';
      // Do not forward NODE_OPTIONS, profiler/startup hooks, .NET runtime overrides
      // or caller commands into the native broker. Only the validated selection
      // digest crosses this launch boundary, never a path, rate or operation.
      const env = { SystemRoot: systemRoot, windir: systemRoot, PATH: path.join(systemRoot, 'System32'),
        ProgramFiles: process.env.ProgramFiles, TEMP: process.env.TEMP, TMP: process.env.TMP,
        DOTNET_EnableDiagnostics: '0', COMPlus_EnableDiagnostics: '0', CORECLR_ENABLE_PROFILING: '0' };
      const child = spawn(path.join(directory, 'Dialed.HidusbfBroker.exe'), selectionArguments, { cwd: directory, env, shell: false, windowsHide: false, stdio: 'ignore' });
      observeSetupExit(child, () => { running = false; onClosed(); });
      await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
      return { status: 'OPENED', changed: false };
    } catch (error) { running = false; throw error; }
  }
  launch.isRunning = () => running;
  return launch;
}
module.exports = { readNativeBrokerStatus, createNativeBrokerLauncher, verifyPolicy, observeSetupExit, setupSelectionArguments };
