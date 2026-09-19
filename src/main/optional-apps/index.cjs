const crypto = require('crypto');
const { spawn } = require('node:child_process');
const { windowsPowerShellEnvironment } = require('../shared/windows-powershell-env.cjs');

const POWERSHELL_TIMEOUT_MS = 20000;
const MAX_OUTPUT_BYTES = 1024 * 1024;

const OPTIONAL_APP_DEFINITIONS = Object.freeze([
  {
    id: 'clipchamp',
    packageNames: ['Clipchamp.Clipchamp'],
    publisherId: 'yxz26nhyzhsrt',
    title: 'Clipchamp',
    consequence: 'Removes the Clipchamp editor for the current Windows account. Local Clipchamp projects or app-only data may be lost.',
  },
  {
    id: 'feedback-hub',
    packageNames: ['Microsoft.WindowsFeedbackHub'],
    publisherId: '8wekyb3d8bbwe',
    title: 'Feedback Hub',
    consequence: 'Removes the Feedback Hub for the current Windows account. Windows feedback submission from this app will no longer be available.',
  },
  {
    id: 'get-help',
    packageNames: ['Microsoft.GetHelp'],
    publisherId: '8wekyb3d8bbwe',
    title: 'Get Help',
    consequence: 'Removes the Get Help app for the current Windows account. Windows support links may prompt for reinstallation.',
  },
  {
    id: 'getting-started',
    packageNames: ['Microsoft.Getstarted'],
    publisherId: '8wekyb3d8bbwe',
    title: 'Windows Tips',
    consequence: 'Removes the Windows Tips/Get Started app for the current Windows account.',
  },
  {
    id: 'microsoft-365-hub',
    packageNames: ['Microsoft.MicrosoftOfficeHub'],
    publisherId: '8wekyb3d8bbwe',
    title: 'Microsoft 365 hub',
    consequence: 'Removes the Microsoft 365 launcher/hub for the current Windows account. Installed Office desktop applications are outside this action.',
  },
  {
    id: 'microsoft-news',
    packageNames: ['Microsoft.BingNews'],
    publisherId: '8wekyb3d8bbwe',
    title: 'Microsoft News',
    consequence: 'Removes the Microsoft News app for the current Windows account. Saved app preferences may not return after reinstall.',
  },
  {
    id: 'microsoft-people',
    packageNames: ['Microsoft.People'],
    publisherId: '8wekyb3d8bbwe',
    title: 'Microsoft People',
    consequence: 'Removes the People app for the current Windows account. Other applications that surface its contact UI may lose that integration.',
  },
  {
    id: 'microsoft-solitaire',
    packageNames: ['Microsoft.MicrosoftSolitaireCollection'],
    publisherId: '8wekyb3d8bbwe',
    title: 'Microsoft Solitaire Collection',
    consequence: 'Removes Microsoft Solitaire Collection for the current Windows account. Unsynced local app data may be lost.',
  },
  {
    id: 'microsoft-weather',
    packageNames: ['Microsoft.BingWeather'],
    publisherId: '8wekyb3d8bbwe',
    title: 'Microsoft Weather',
    consequence: 'Removes the Microsoft Weather app for the current Windows account. Saved app preferences may not return after reinstall.',
  },
]);

const DEFINITION_BY_ID = new Map(OPTIONAL_APP_DEFINITIONS.map((definition) => [definition.id, definition]));
const DEFINITION_BY_PACKAGE = new Map(OPTIONAL_APP_DEFINITIONS.flatMap((definition) => definition.packageNames.map((name) => [name, definition])));
// Windows bundle identities legitimately use "~" between architecture and publisher ID
// (for example, Microsoft.*_neutral_~_8wekyb3d8bbwe). Keep the family-name
// grammar narrower and reuse this exact full-name grammar at every removal gate.
const PACKAGE_FULL_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._~-]{1,299}$/;
const PACKAGE_FAMILY_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{1,239}$/;

function hasReviewedPackageIdentity(definition, item) {
  return definition.packageNames.some((name) => item.packageFamilyName === `${name}_${definition.publisherId}`);
}

const LIST_PACKAGES_SCRIPT = `
$items = @(Get-AppxPackage -PackageTypeFilter Main,Bundle -ErrorAction Stop | ForEach-Object {
  [pscustomobject]@{
    name = [string]$_.Name
    packageFullName = [string]$_.PackageFullName
    packageFamilyName = [string]$_.PackageFamilyName
    version = [string]$_.Version
    architecture = [string]$_.Architecture
    publisher = [string]$_.Publisher
    nonRemovable = [bool]$_.NonRemovable
    isFramework = [bool]$_.IsFramework
    signatureKind = [string]$_.SignatureKind
  }
})
ConvertTo-Json -InputObject @($items) -Compress -Depth 3
`;

function runPowerShell(script, dependencies = {}) {
  const spawnProcess = dependencies.spawnProcess || spawn;
  const timeoutMs = dependencies.timeoutMs || POWERSHELL_TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    const executable = `${process.env.SystemRoot || 'C:\\Windows'}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;
    const child = spawnProcess(executable, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], { windowsHide: true, env: windowsPowerShellEnvironment() });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      callback();
    };
    const append = (current, chunk) => {
      const next = current + chunk.toString();
      if (Buffer.byteLength(next, 'utf8') > MAX_OUTPUT_BYTES) {
        child.kill();
        finish(() => reject(new Error('The optional-app query exceeded its output limit.')));
      }
      return next;
    };
    const timeout = setTimeout(() => {
      child.kill();
      finish(() => reject(new Error('The optional-app operation timed out.')));
    }, timeoutMs);
    child.stdout.on('data', (chunk) => { stdout = append(stdout, chunk); });
    child.stderr.on('data', (chunk) => { stderr = append(stderr, chunk); });
    child.on('error', (error) => finish(() => reject(error)));
    child.on('close', (exitCode) => finish(() => {
      if (exitCode === 0) resolve({ stdout: stdout.trim(), stderr: stderr.trim(), exitCode });
      else {
        const error = new Error(stderr.trim() || stdout.trim() || `PowerShell exited with code ${exitCode}.`);
        error.exitCode = exitCode;
        error.stdout = stdout.trim();
        error.stderr = stderr.trim();
        reject(error);
      }
    }));
  });
}

function boundedText(value, label, maximum = 512) {
  const text = String(value || '').trim();
  if (!text || text.length > maximum) throw new Error(`${label} is invalid.`);
  return text;
}

function normalizePackages(value) {
  const source = Array.isArray(value) ? value : value ? [value] : [];
  if (source.length > 2000) throw new Error('The current-user package inventory exceeded its item limit.');
  return source.map((entry, index) => {
    const name = boundedText(entry?.name, `Package ${index + 1} name`, 160);
    const packageFullName = boundedText(entry?.packageFullName, `Package ${index + 1} full name`, 300);
    const packageFamilyName = boundedText(entry?.packageFamilyName, `Package ${index + 1} family name`, 240);
    if (!PACKAGE_FULL_NAME_PATTERN.test(packageFullName) || !PACKAGE_FAMILY_NAME_PATTERN.test(packageFamilyName)) {
      throw new Error(`Package ${index + 1} identity contains unsupported characters.`);
    }
    return {
      name,
      packageFullName,
      packageFamilyName,
      version: boundedText(entry?.version, `Package ${index + 1} version`, 80),
      architecture: String(entry?.architecture || 'Unknown').slice(0, 40),
      publisher: String(entry?.publisher || 'Unknown').slice(0, 512),
      nonRemovable: entry?.nonRemovable === true,
      isFramework: entry?.isFramework === true,
      signatureKind: String(entry?.signatureKind || 'Unknown').slice(0, 40),
    };
  });
}

function packageFingerprint(item) {
  return crypto.createHash('sha256').update(JSON.stringify({
    id: item.id,
    name: item.name,
    packageFullName: item.packageFullName,
    packageFamilyName: item.packageFamilyName,
    version: item.version,
    publisher: item.publisher,
  }), 'utf8').digest('hex');
}

async function listCurrentUserPackages(dependencies = {}) {
  const execute = dependencies.runPowerShell || runPowerShell;
  const output = await execute(LIST_PACKAGES_SCRIPT);
  return normalizePackages(JSON.parse(output.stdout || '[]'));
}

async function listOptionalAppCandidates(dependencies = {}) {
  const packages = await listCurrentUserPackages(dependencies);
  const eligible = packages.flatMap((item) => {
    const definition = DEFINITION_BY_PACKAGE.get(item.name);
    if (!definition || !hasReviewedPackageIdentity(definition, item) || item.nonRemovable || item.isFramework) return [];
    const candidate = {
      id: definition.id,
      title: definition.title,
      consequence: definition.consequence,
      name: item.name,
      packageFullName: item.packageFullName,
      packageFamilyName: item.packageFamilyName,
      version: item.version,
      publisher: item.publisher,
      architecture: item.architecture,
      signatureKind: item.signatureKind,
      scope: 'CURRENT_USER',
      recovery: 'Exact rollback is unavailable. Reinstallation may be possible from Microsoft Store Library, but availability, previous app data, and preferences are not guaranteed.',
    };
    return [{ ...candidate, fingerprint: packageFingerprint(candidate) }];
  });
  const counts = new Map();
  for (const item of eligible) counts.set(item.id, (counts.get(item.id) || 0) + 1);
  const items = eligible
    .filter((item) => counts.get(item.id) === 1)
    .sort((left, right) => left.title.localeCompare(right.title));
  return {
    scannedAt: new Date().toISOString(),
    items,
    limitations: 'Only one unambiguous exact allowlisted current-user Main/Bundle package name and publisher-derived family identity per app is shown. Duplicate identities, unreviewed publisher identities, frameworks, non-removable packages, provisioned images, other users, security components, gaming services, drivers, classic programs, and arbitrary package names are outside this workflow.',
  };
}

async function previewOptionalAppRemoval(appId, dependencies = {}) {
  const definition = DEFINITION_BY_ID.get(String(appId || ''));
  if (!definition) throw new Error('This optional app is not in Dialed’s reviewed allowlist.');
  const inventory = await listOptionalAppCandidates(dependencies);
  const item = inventory.items.find((candidate) => candidate.id === definition.id);
  if (!item) throw new Error('The selected optional app is no longer an eligible current-user package. Refresh the list.');
  return {
    ...item,
    previewedAt: new Date().toISOString(),
    changes: [`Remove exactly ${item.packageFullName} from the current Windows account.`],
    exclusions: ['No -AllUsers removal', 'No provisioned-package removal', 'No framework or dependency removal', 'No service, driver, security, gaming-service, Registry, or file deletion'],
  };
}

function previewMatchesCandidate(preview, candidate) {
  return Boolean(preview && candidate
    && preview.id === candidate.id
    && preview.packageFullName === candidate.packageFullName
    && preview.fingerprint === candidate.fingerprint
    && preview.scope === 'CURRENT_USER');
}

async function removeOptionalAppPackage(preview, dependencies = {}) {
  const definition = DEFINITION_BY_ID.get(String(preview?.id || ''));
  if (!definition || !definition.packageNames.includes(preview?.name) || !hasReviewedPackageIdentity(definition, preview) || !PACKAGE_FULL_NAME_PATTERN.test(String(preview?.packageFullName || ''))) {
    throw new Error('The optional-app removal target is invalid.');
  }
  const encodedPackage = Buffer.from(preview.packageFullName, 'utf8').toString('base64');
  const script = `
$package = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedPackage}'))
if ($package -notmatch '^[A-Za-z0-9][A-Za-z0-9._~-]{1,299}$') { throw 'The package identity is invalid.' }
$current = @(Get-AppxPackage -PackageTypeFilter Main,Bundle -ErrorAction Stop | Where-Object { $_.PackageFullName -ceq $package })
if ($current.Count -ne 1) { throw 'The exact current-user package is no longer uniquely installed.' }
if ([bool]$current[0].NonRemovable -or [bool]$current[0].IsFramework) { throw 'Windows marks this package as protected or a framework.' }
Remove-AppxPackage -Package $package -ErrorAction Stop
[pscustomobject]@{ packageFullName = $package; scope = 'CURRENT_USER'; command = 'Remove-AppxPackage'; allUsers = $false; provisionedImageChanged = $false } | ConvertTo-Json -Compress
`;
  const execute = dependencies.runPowerShell || runPowerShell;
  const result = await execute(script);
  return { ...result, output: JSON.parse(result.stdout || '{}') };
}

module.exports = {
  LIST_PACKAGES_SCRIPT,
  MAX_OUTPUT_BYTES,
  OPTIONAL_APP_DEFINITIONS,
  POWERSHELL_TIMEOUT_MS,
  listCurrentUserPackages,
  listOptionalAppCandidates,
  normalizePackages,
  packageFingerprint,
  previewMatchesCandidate,
  previewOptionalAppRemoval,
  removeOptionalAppPackage,
  runPowerShell,
};
