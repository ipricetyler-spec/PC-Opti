const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ARTIFACT_SIGNING_TIMESTAMP_URL = 'http://timestamp.acs.microsoft.com';
const PFX_TIMESTAMP_URL = 'http://timestamp.digicert.com';
const ARTIFACT_SIGNING_CREDENTIALS = new Set([
  'EnvironmentCredential',
  'ManagedIdentityCredential',
  'WorkloadIdentityCredential',
  'SharedTokenCacheCredential',
  'VisualStudioCredential',
  'VisualStudioCodeCredential',
  'AzureCliCredential',
  'AzurePowerShellCredential',
  'AzureDeveloperCliCredential',
  'InteractiveBrowserCredential',
]);

function boolFrom(value) {
  return /^(1|true|yes|on)$/i.test(String(value || '').trim());
}

function productEnvironmentValue(environment, suffix) {
  const current = environment[`DIALED_${suffix}`];
  return current === undefined ? environment[`PC_OPTI_${suffix}`] : current;
}

function findSignTool(environment = process.env) {
  const explicit = String(productEnvironmentValue(environment, 'CODESIGN_TOOL_PATH') || '').trim();
  if (explicit) return explicit;
  const programFilesX86 = environment['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const binRoot = path.join(programFilesX86, 'Windows Kits', '10', 'bin');
  if (fs.existsSync(binRoot)) {
    const candidates = fs.readdirSync(binRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^\d+(\.\d+)+$/.test(entry.name))
      .map((entry) => path.join(binRoot, entry.name, 'x64', 'signtool.exe'))
      .filter((candidate) => fs.existsSync(candidate))
      .sort((left, right) => right.localeCompare(left, undefined, { numeric: true }));
    if (candidates.length) return candidates[0];
  }
  return 'signtool.exe';
}

function defaultArtifactSigningDlib(environment = process.env) {
  const localAppData = environment.LOCALAPPDATA || '';
  if (!localAppData) return '';
  return path.join(localAppData, 'Microsoft', 'MicrosoftArtifactSigningClientTools', 'Azure.CodeSigning.Dlib.dll');
}

function validateArtifactSigningFields({ endpoint, account, profile }) {
  let endpointUrl;
  try {
    endpointUrl = new URL(endpoint);
  } catch {
    throw new Error('Artifact Signing endpoint must be a valid HTTPS URL.');
  }
  if (endpointUrl.protocol !== 'https:' || !endpointUrl.hostname.endsWith('.codesigning.azure.net')) {
    throw new Error('Artifact Signing endpoint must use HTTPS on codesigning.azure.net.');
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9-]{1,62}$/.test(account)) {
    throw new Error('Artifact Signing account name is missing or invalid.');
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{1,99}$/.test(profile)) {
    throw new Error('Artifact Signing certificate profile name is missing or invalid.');
  }
}

function parseExcludedCredentials(value) {
  const credentials = Array.isArray(value)
    ? value.map(String)
    : String(value || '').split(/[,;\n]/);
  const normalized = credentials.map((entry) => entry.trim()).filter(Boolean);
  const unsupported = normalized.filter((entry) => !ARTIFACT_SIGNING_CREDENTIALS.has(entry));
  if (unsupported.length) {
    throw new Error(`Unsupported Artifact Signing credential exclusion: ${unsupported.join(', ')}`);
  }
  return [...new Set(normalized)];
}

function readArtifactMetadata(metadataPath) {
  const parsed = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
  const endpoint = String(parsed.Endpoint || '').trim();
  const account = String(parsed.CodeSigningAccountName || '').trim();
  const profile = String(parsed.CertificateProfileName || '').trim();
  validateArtifactSigningFields({ endpoint, account, profile });
  return {
    Endpoint: endpoint,
    CodeSigningAccountName: account,
    CertificateProfileName: profile,
    ...(parsed.CorrelationId ? { CorrelationId: String(parsed.CorrelationId) } : {}),
    ...(parsed.ExcludeCredentials
      ? { ExcludeCredentials: parseExcludedCredentials(parsed.ExcludeCredentials) }
      : {}),
  };
}

function resolveSigningConfiguration(environment = process.env) {
  const requested = boolFrom(productEnvironmentValue(environment, 'ENABLE_SIGNING'));
  const required = boolFrom(productEnvironmentValue(environment, 'SIGNING_REQUIRED'));
  const signToolPath = findSignTool(environment);
  const metadataPath = String(productEnvironmentValue(environment, 'ARTIFACT_SIGNING_METADATA_PATH') || '').trim();
  const endpoint = String(productEnvironmentValue(environment, 'ARTIFACT_SIGNING_ENDPOINT') || '').trim();
  const account = String(productEnvironmentValue(environment, 'ARTIFACT_SIGNING_ACCOUNT') || '').trim();
  const profile = String(productEnvironmentValue(environment, 'ARTIFACT_SIGNING_PROFILE') || '').trim();
  const tenantId = String(productEnvironmentValue(environment, 'ARTIFACT_SIGNING_TENANT_ID') || '').trim();
  if (tenantId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(tenantId)) {
    throw new Error('Artifact Signing tenant ID must be a valid UUID.');
  }
  const excludedCredentials = parseExcludedCredentials(
    productEnvironmentValue(environment, 'ARTIFACT_SIGNING_EXCLUDE_CREDENTIALS'),
  );
  const dlibPath = String(productEnvironmentValue(environment, 'ARTIFACT_SIGNING_DLIB_PATH') || defaultArtifactSigningDlib(environment)).trim();
  const pfxPath = String(productEnvironmentValue(environment, 'CODESIGN_PFX_PATH') || '').trim();
  const pfxPassword = String(productEnvironmentValue(environment, 'CODESIGN_PFX_PASSWORD') || '').trim();
  const timeoutMs = Number.parseInt(productEnvironmentValue(environment, 'CODESIGN_TIMEOUT_MS') || '180000', 10);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 30_000 || timeoutMs > 900_000) {
    throw new Error('Code-signing timeout must be between 30000 and 900000 milliseconds.');
  }

  let provider = 'none';
  let artifactMetadata = null;
  if (metadataPath || endpoint || account || profile) {
    artifactMetadata = metadataPath
      ? readArtifactMetadata(metadataPath)
      : (() => {
          validateArtifactSigningFields({ endpoint, account, profile });
          return {
            Endpoint: endpoint,
            CodeSigningAccountName: account,
            CertificateProfileName: profile,
            ...(excludedCredentials.length ? { ExcludeCredentials: excludedCredentials } : {}),
          };
        })();
    provider = 'azure-artifact-signing';
  } else if (pfxPath || pfxPassword) {
    if (!pfxPath || !pfxPassword) {
      throw new Error('PFX signing requires both certificate path and password environment variables.');
    }
    provider = 'pfx';
  }

  return {
    requested,
    required,
    provider,
    signToolPath,
    artifactMetadata,
    metadataPath,
    tenantId,
    dlibPath,
    pfxPath,
    pfxPassword,
    timestampUrl: String(productEnvironmentValue(environment, 'CODESIGN_TIMESTAMP_URL') || '').trim(),
    timeoutMs,
  };
}

function assertSigningReady(configuration) {
  if (configuration.required && !configuration.requested) {
    throw new Error('Signing is required but DIALED_ENABLE_SIGNING is not enabled.');
  }
  if (!configuration.requested) return;
  if (configuration.provider === 'none') {
    throw new Error('Signing was enabled but neither Artifact Signing nor PFX configuration is available.');
  }
  if (configuration.signToolPath !== 'signtool.exe' && !fs.existsSync(configuration.signToolPath)) {
    throw new Error(`SignTool was not found at the configured path: ${configuration.signToolPath}`);
  }
  if (configuration.provider === 'azure-artifact-signing' && !fs.existsSync(configuration.dlibPath)) {
    throw new Error(`Artifact Signing client library was not found: ${configuration.dlibPath}`);
  }
  if (configuration.provider === 'pfx' && !fs.existsSync(configuration.pfxPath)) {
    throw new Error(`PFX certificate was not found: ${configuration.pfxPath}`);
  }
}

function runSignTool(configuration, args, options = {}) {
  const result = childProcess.spawnSync(configuration.signToolPath, args, {
    encoding: 'utf8',
    windowsHide: true,
    timeout: options.timeout || configuration.timeoutMs || 180_000,
    env: configuration.tenantId
      ? { ...process.env, AZURE_TENANT_ID: configuration.tenantId }
      : process.env,
  });
  const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
  if (result.error) throw new Error(`SignTool could not start: ${result.error.message}`);
  if (result.status !== 0) {
    const detail = output ? `\n${output}` : '';
    throw new Error(`SignTool exited with code ${result.status}.${detail}`);
  }
  return output;
}

function withArtifactMetadata(configuration, callback) {
  if (configuration.metadataPath) return callback(configuration.metadataPath);
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dialed-artifact-signing-'));
  const metadataPath = path.join(tempRoot, 'metadata.json');
  try {
    fs.writeFileSync(metadataPath, `${JSON.stringify(configuration.artifactMetadata, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
    return callback(metadataPath);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function verifySignature(filePath, configuration) {
  try {
    const output = runSignTool(configuration, ['verify', '/pa', '/v', filePath], { timeout: 60_000 });
    return { valid: true, output };
  } catch (error) {
    return { valid: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function signFile(filePath, configuration) {
  assertSigningReady(configuration);
  if (!configuration.requested) return { signed: false, skipped: true };
  if (!path.isAbsolute(filePath) || !fs.existsSync(filePath) || !/\.(exe|msi)$/i.test(filePath)) {
    throw new Error(`Refusing to sign a missing, relative, or unsupported file: ${filePath}`);
  }
  const existing = verifySignature(filePath, configuration);
  if (existing.valid) return { signed: false, alreadyValid: true };

  if (configuration.provider === 'azure-artifact-signing') {
    withArtifactMetadata(configuration, (metadataPath) => {
      runSignTool(configuration, [
        'sign', '/v', '/debug', '/fd', 'SHA256',
        '/tr', configuration.timestampUrl || ARTIFACT_SIGNING_TIMESTAMP_URL,
        '/td', 'SHA256', '/dlib', configuration.dlibPath, '/dmdf', metadataPath, filePath,
      ]);
    });
  } else {
    runSignTool(configuration, [
      'sign', '/fd', 'SHA256', '/tr', configuration.timestampUrl || PFX_TIMESTAMP_URL,
      '/td', 'SHA256', '/f', configuration.pfxPath, '/p', configuration.pfxPassword, filePath,
    ]);
  }

  const verification = verifySignature(filePath, configuration);
  if (!verification.valid) throw new Error(`Signature verification failed after signing: ${verification.error}`);
  return { signed: true, alreadyValid: false };
}

module.exports = {
  ARTIFACT_SIGNING_TIMESTAMP_URL,
  assertSigningReady,
  boolFrom,
  parseExcludedCredentials,
  resolveSigningConfiguration,
  signFile,
  verifySignature,
};
