'use strict';

/**
 * The environment for a Windows PowerShell 5.1 child process.
 *
 * When Dialed is started from PowerShell 7, it inherits PowerShell 7's PSModulePath.
 * Windows PowerShell 5.1 then tries to auto-load PowerShell 7's copies of built-in
 * modules (for example Microsoft.PowerShell.Security, which provides
 * Get-AuthenticodeSignature), fails, and the command is simply missing. Removing the
 * variable lets Windows PowerShell rebuild its own default module path.
 */
function windowsPowerShellEnvironment(source = process.env) {
  const environment = { ...source };
  for (const name of Object.keys(environment)) {
    if (name.toLowerCase() === 'psmodulepath') delete environment[name];
  }
  return environment;
}

module.exports = { windowsPowerShellEnvironment };
