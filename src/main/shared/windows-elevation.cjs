const WINDOWS_ELEVATION_POWERSHELL = "$identity = [Security.Principal.WindowsIdentity]::GetCurrent(); $principal = New-Object Security.Principal.WindowsPrincipal($identity); [pscustomobject]@{ elevated = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator) } | ConvertTo-Json -Compress";

function parseWindowsElevation(stdout) {
  const parsed = JSON.parse(String(stdout || ''));
  if (!parsed || typeof parsed.elevated !== 'boolean') {
    throw new Error('Windows returned an invalid elevation result.');
  }
  return parsed.elevated;
}

async function queryCurrentProcessElevation(runPowerShell) {
  if (typeof runPowerShell !== 'function') throw new Error('A bounded PowerShell adapter is required.');
  const result = await runPowerShell(WINDOWS_ELEVATION_POWERSHELL);
  return parseWindowsElevation(result?.stdout);
}

module.exports = {
  WINDOWS_ELEVATION_POWERSHELL,
  parseWindowsElevation,
  queryCurrentProcessElevation,
};
