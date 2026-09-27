'use strict';

const fs = require('node:fs');
const path = require('node:path');

// Dialed runs as administrator, and every Windows PowerShell it starts runs elevated too, so
// nothing the signed-in user can write may decide what that PowerShell loads or runs.

/** The Windows folder. A malformed value falls back to the default install location. */
function systemRoot(source = process.env) {
  const value = source.SystemRoot;
  return typeof value === 'string' && /^[A-Za-z]:\\[^\\/:*?"<>|;]+$/.test(value) ? value : 'C:\\Windows';
}

/** Windows PowerShell 5.1 at its fixed System32 path, never whatever PATH finds first. */
function windowsPowerShellPath(source = process.env) {
  return path.win32.join(systemRoot(source), 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}

// Windows PowerShell 5.1 always puts the user's Documents\WindowsPowerShell\Modules first in its
// module path, even when PSModulePath is set for it, and auto-loads modules from there by name.
// So the first statement of every script resets it to the two system folders; nothing loads a
// module before that line runs. Neither folder comes from an environment variable.
const TRUSTED_MODULE_PATH = "$env:PSModulePath = (Join-Path $PSHOME 'Modules') + ';' + (Join-Path ([Environment]::GetFolderPath('ProgramFiles')) 'WindowsPowerShell\\Modules')";

/** The script with the module path reset in front of it. */
function withTrustedModulePath(script) {
  return `${TRUSTED_MODULE_PATH}\n${script}`;
}

/** The arguments for running one script with Windows PowerShell. */
function windowsPowerShellArguments(script) {
  return ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', withTrustedModulePath(script)];
}

// Add-Type compiles into TEMP and then loads the result. In the user's own TEMP a program
// running as the user could swap the file in between, so once Dialed has its admin-only
// folder, PowerShell's TEMP points inside it.
let temporaryDirectory = null;

function usePowerShellTempDirectory(directory) {
  if (directory) fs.mkdirSync(directory, { recursive: true });
  temporaryDirectory = directory || null;
}

/**
 * The environment for a Windows PowerShell 5.1 child process.
 *
 * When Dialed is started from PowerShell 7, it inherits PowerShell 7's PSModulePath.
 * Windows PowerShell 5.1 then tries to auto-load PowerShell 7's copies of built-in
 * modules (for example Microsoft.PowerShell.Security, which provides
 * Get-AuthenticodeSignature), fails, and the command is simply missing. Removing the
 * variable lets Windows PowerShell rebuild its own default module path, which each script
 * then narrows with withTrustedModulePath.
 */
function windowsPowerShellEnvironment(source = process.env) {
  const environment = { ...source };
  for (const name of Object.keys(environment)) {
    const lower = name.toLowerCase();
    if (lower === 'psmodulepath' || (temporaryDirectory && (lower === 'temp' || lower === 'tmp'))) delete environment[name];
  }
  if (temporaryDirectory) {
    environment.TEMP = temporaryDirectory;
    environment.TMP = temporaryDirectory;
  }
  return environment;
}

module.exports = {
  systemRoot,
  usePowerShellTempDirectory,
  windowsPowerShellArguments,
  windowsPowerShellEnvironment,
  windowsPowerShellPath,
  withTrustedModulePath,
};
