const path = require('path');
const { runPowerShell } = require('../scanner/index.cjs');

function buildAuthenticodeReadScript(executablePath) {
  const encodedPath = Buffer.from(executablePath, 'utf8').toString('base64');
  return `
$path = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedPath}'))
$signature = Get-AuthenticodeSignature -LiteralPath $path -ErrorAction Stop
[pscustomobject]@{
  status = [string]$signature.Status
  statusMessage = [string]$signature.StatusMessage
  signerSubject = if ($signature.SignerCertificate) { [string]$signature.SignerCertificate.Subject } else { '' }
  signerThumbprint = if ($signature.SignerCertificate) { [string]$signature.SignerCertificate.Thumbprint } else { '' }
  timestampSubject = if ($signature.TimeStamperCertificate) { [string]$signature.TimeStamperCertificate.Subject } else { '' }
} | ConvertTo-Json -Compress
`;
}

async function readReleaseStatus({ version, isPackaged, executablePath, updateConfiguration }, dependencies = {}) {
  const executePowerShell = dependencies.runPowerShell || runPowerShell;
  const base = {
    version: String(version || 'Unknown'),
    packaged: Boolean(isPackaged),
    executableName: path.basename(String(executablePath || '')) || 'Unknown',
    updateMode: 'VERIFIED_USER_INITIATED',
    updateCheckAvailable: Boolean(isPackaged && updateConfiguration?.configured),
    update: updateConfiguration || {
      status: 'UNCONFIGURED', configured: false, channel: 'stable', feedHost: '',
      missingFields: ['feedUrl', 'manifestKeyId', 'manifestPublicKeySpkiBase64', 'publisherSubject', 'publisherThumbprint', 'allowedInstallerHosts'],
      errors: [], backgroundUpdates: false,
    },
  };
  if (!isPackaged) {
    return {
      ...base,
      signature: { status: 'NOT_APPLICABLE', statusMessage: 'Development preview; the Electron host signature is not Dialed release evidence.', signerSubject: '', signerThumbprint: '', timestampSubject: '' },
    };
  }
  try {
    const result = await executePowerShell(buildAuthenticodeReadScript(executablePath));
    const signature = JSON.parse(result.stdout);
    return {
      ...base,
      signature: {
        status: String(signature?.status || 'Unknown'),
        statusMessage: String(signature?.statusMessage || ''),
        signerSubject: String(signature?.signerSubject || ''),
        signerThumbprint: String(signature?.signerThumbprint || ''),
        timestampSubject: String(signature?.timestampSubject || ''),
      },
    };
  } catch (error) {
    return {
      ...base,
      signature: { status: 'UNAVAILABLE', statusMessage: error instanceof Error ? error.message : 'Authenticode status could not be read.', signerSubject: '', signerThumbprint: '', timestampSubject: '' },
    };
  }
}

module.exports = {
  buildAuthenticodeReadScript,
  readReleaseStatus,
};
