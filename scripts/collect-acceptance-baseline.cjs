const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const POWERSHELL = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
function runReadOnlyPowerShell(script) {
  const result = spawnSync(POWERSHELL, ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error((result.stderr || result.stdout || `PowerShell exited with ${result.status}.`).trim());
  return result.stdout.trim();
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function artifactEvidence(repositoryRoot, packageJson) {
  const productName = String(packageJson.build?.productName || packageJson.name || '').trim();
  const artifactNames = [
    `${productName} ${packageJson.version}.exe`,
    `${productName} Setup ${packageJson.version}.exe`,
  ];
  return artifactNames.map((name) => {
    const filePath = path.join(repositoryRoot, 'dist-electron', name);
    if (!fs.existsSync(filePath)) return { name, present: false, sha256: null, authenticodeStatus: 'NOT_CHECKED' };
    const quoted = filePath.replaceAll("'", "''");
    let authenticodeStatus = 'UNAVAILABLE';
    try {
      authenticodeStatus = runReadOnlyPowerShell(`(Get-AuthenticodeSignature -LiteralPath '${quoted}').Status.ToString()`);
    } catch {}
    return { name, present: true, sha256: sha256(filePath), authenticodeStatus };
  });
}

function createAcceptanceRecord({ packageVersion, windows, artifacts, disposableDeclaration }) {
  return {
    schemaVersion: '1.0.0',
    createdAt: new Date().toISOString(),
    purpose: 'Read-only baseline for Dialed disposable Windows acceptance testing',
    packageVersion,
    environment: windows,
    disposableEnvironmentDeclaration: disposableDeclaration || 'NOT_DECLARED',
    mutationAuthorizationRecorded: false,
    artifacts,
    acceptanceCases: {
      standardUserDesktop: 'NOT_RUN',
      startupTransaction: 'NOT_RUN',
      ecoQosTransaction: 'NOT_RUN',
      interruptedActionRecovery: 'NOT_RUN',
      elevatedOwnerPolicy: 'NOT_RUN',
      maintenance: 'NOT_RUN',
      installerLifecycle: 'NOT_RUN',
      aiProvider: 'NOT_RUN',
    },
    guardrail: 'This baseline does not launch artifacts, install software, or execute a Windows mutation. Record real driver/device cases only on the explicitly approved dedicated physical Windows test PC after owner approval A-003.',
  };
}

function collectBaseline(repositoryRoot) {
  const packageJson = JSON.parse(fs.readFileSync(path.join(repositoryRoot, 'package.json'), 'utf8'));
  const windows = JSON.parse(runReadOnlyPowerShell(`
$os = Get-CimInstance -ClassName Win32_OperatingSystem -ErrorAction Stop
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
[pscustomobject]@{
  caption = [string]$os.Caption
  version = [string]$os.Version
  build = [string]$os.BuildNumber
  architecture = [string]$os.OSArchitecture
  elevated = [bool]$principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
} | ConvertTo-Json -Compress
  `));
  return createAcceptanceRecord({
    packageVersion: packageJson.version,
    windows,
    artifacts: artifactEvidence(repositoryRoot, packageJson),
    disposableDeclaration: process.env.PC_OPTI_DISPOSABLE_TEST_ENV,
  });
}

function resolveOutput(repositoryRoot, argument) {
  if (!argument) return null;
  const output = path.resolve(repositoryRoot, argument);
  const relative = path.relative(repositoryRoot, output);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('The evidence output path must be a file inside the repository.');
  }
  return output;
}

function main() {
  const repositoryRoot = path.resolve(__dirname, '..');
  const outputIndex = process.argv.indexOf('--output');
  const outputPath = resolveOutput(repositoryRoot, outputIndex >= 0 ? process.argv[outputIndex + 1] : null);
  const serialized = `${JSON.stringify(collectBaseline(repositoryRoot), null, 2)}\n`;
  if (outputPath) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, serialized, 'utf8');
    process.stdout.write(`Wrote read-only acceptance baseline to ${outputPath}\n`);
  } else {
    process.stdout.write(serialized);
  }
}

if (require.main === module) main();

module.exports = { artifactEvidence, collectBaseline, createAcceptanceRecord, resolveOutput };
