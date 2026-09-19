const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { runPowerShell } = require('../scanner/index.cjs');

const TIMING_ACTIONS = Object.freeze({
  RESTORE_AUTOMATIC_CLOCK_SOURCE: 'timing:restore-automatic-clock-source',
  DISABLE_DYNAMIC_TICK: 'timing:disable-dynamic-tick',
});

const MICROSOFT_SOURCES = Object.freeze({
  bcdEdit: 'https://learn.microsoft.com/en-us/windows-hardware/drivers/devtest/bcdedit--set',
  timerResolution: 'https://learn.microsoft.com/en-us/windows/win32/api/timeapi/nf-timeapi-timebeginperiod',
  performanceCounter: 'https://learn.microsoft.com/en-us/windows/win32/sysinfo/acquiring-high-resolution-time-stamps',
});
const SUPPORTED_BOOT_TIMING_SOURCES = new Set(['bcdedit /enum ACTIVE', 'bcdedit /enum {current}']);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeBcdBoolean(value, name) {
  if (value === null || value === undefined || value === '') return null;
  const normalized = String(value).trim().toUpperCase();
  if (normalized !== 'YES' && normalized !== 'NO') {
    throw new Error(`BCDEdit returned an unsupported ${name} value.`);
  }
  return normalized;
}

function parseBootTimingState(output) {
  if (typeof output !== 'string' || output.trim().length === 0) {
    throw new Error('BCDEdit returned no active-entry data.');
  }
  const loaderBlocks = output.trim().split(/\r?\n\s*\r?\n/)
    .filter((block) => /\\windows\\system32\\winload\.(?:efi|exe)/i.test(block));
  if (loaderBlocks.length !== 1) {
    throw new Error('BCDEdit did not return one unambiguous active Windows loader entry.');
  }
  const settings = new Map();
  for (const line of loaderBlocks[0].split(/\r?\n/)) {
    const match = /^\s*(useplatformclock|disabledynamictick)\s+(\S+)\s*$/i.exec(line);
    if (match) settings.set(match[1].toLowerCase(), match[2]);
  }
  return {
    source: 'bcdedit /enum ACTIVE',
    usePlatformClock: normalizeBcdBoolean(settings.get('useplatformclock'), 'useplatformclock'),
    disableDynamicTick: normalizeBcdBoolean(settings.get('disabledynamictick'), 'disabledynamictick'),
  };
}

function assertBootTimingState(state) {
  if (!state || !SUPPORTED_BOOT_TIMING_SOURCES.has(state.source)) {
    throw new Error('A verified active Windows boot-loader timing state is required.');
  }
  normalizeBcdBoolean(state.usePlatformClock, 'useplatformclock');
  normalizeBcdBoolean(state.disableDynamicTick, 'disabledynamictick');
  return true;
}

function timingStateEquals(left, right) {
  assertBootTimingState(left);
  assertBootTimingState(right);
  return left.usePlatformClock === right.usePlatformClock
    && left.disableDynamicTick === right.disableDynamicTick;
}

function timingTargetStateEquals(actionId, left, right) {
  assertBootTimingState(left);
  assertBootTimingState(right);
  if (actionId === TIMING_ACTIONS.RESTORE_AUTOMATIC_CLOCK_SOURCE) {
    return left.usePlatformClock === right.usePlatformClock;
  }
  if (actionId === TIMING_ACTIONS.DISABLE_DYNAMIC_TICK) {
    return left.disableDynamicTick === right.disableDynamicTick;
  }
  throw new Error('This timing experiment action is not recognized.');
}

function timingActionReachedIntendedState(actionId, state) {
  assertBootTimingState(state);
  if (actionId === TIMING_ACTIONS.RESTORE_AUTOMATIC_CLOCK_SOURCE) {
    return state.usePlatformClock === null;
  }
  if (actionId === TIMING_ACTIONS.DISABLE_DYNAMIC_TICK) {
    return state.disableDynamicTick === 'YES';
  }
  throw new Error('This timing experiment action is not recognized.');
}

function assertTimingActionApplicable(actionId, state) {
  assertBootTimingState(state);
  if (actionId === TIMING_ACTIONS.RESTORE_AUTOMATIC_CLOCK_SOURCE) {
    if (state.usePlatformClock === null) {
      throw new Error('Windows already has no explicit useplatformclock override on the current boot entry.');
    }
    return true;
  }
  if (actionId === TIMING_ACTIONS.DISABLE_DYNAMIC_TICK) {
    if (state.disableDynamicTick === 'YES') {
      throw new Error('Dynamic Tick is already disabled on the current boot entry.');
    }
    return true;
  }
  throw new Error('This timing experiment action is not recognized.');
}

function displayBcdValue(value, absentLabel, yesLabel = 'Set to Yes', noLabel = 'Set to No') {
  if (value === null) return absentLabel;
  return value === 'YES' ? yesLabel : noLabel;
}

function timingExperimentsForState(state, unavailableReason = null) {
  const stateAvailable = Boolean(state && !unavailableReason);
  if (stateAvailable) assertBootTimingState(state);
  const clockApplicable = stateAvailable && state.usePlatformClock !== null;
  const tickApplicable = stateAvailable && state.disableDynamicTick !== 'YES';

  return [
    {
      id: 'automatic-clock-source',
      title: 'Platform clock source',
      kind: 'BOOT_CONFIGURATION',
      hypothesis: 'Another tool has forced Windows to use a particular timer. This puts the choice back to Windows, which picks the best one for your hardware.',
      framing: 'Returns a forced timer setting to the Windows default. Whether it changes performance depends on your hardware.',
      currentState: stateAvailable ? displayBcdValue(state.usePlatformClock, 'Windows default', 'Forced to the platform clock by another tool', 'Set to No by another tool') : 'Unavailable',
      availability: !stateAvailable ? 'UNAVAILABLE' : clockApplicable ? 'APPLICABLE' : 'ALREADY_DEFAULT',
      actionId: clockApplicable ? TIMING_ACTIONS.RESTORE_AUTOMATIC_CLOCK_SOURCE : null,
      actionLabel: !stateAvailable ? 'Unavailable' : clockApplicable ? 'Restore Windows default' : 'Already using Windows default',
      risk: 'Medium',
      requiresElevation: true,
      requiresReboot: true,
      rollback: 'Dialed saves the previous value and puts it back exactly, unless something else has changed it since.',
      limitations: 'This does not turn off HPET in the BIOS or in Device Manager. Measure to see whether it made a difference.',
      ongoingTesting: 'Restart, then measure your game at least three times before and after. Keep the change only if it clearly helped.',
      sources: [MICROSOFT_SOURCES.bcdEdit, MICROSOFT_SOURCES.performanceCounter],
      unavailableReason,
    },
    {
      id: 'consistent-tick-experiment',
      title: 'Dynamic tick',
      kind: 'BOOT_CONFIGURATION',
      hypothesis: 'Windows normally pauses its timer tick when idle to save power. Keeping it running can make frame timing steadier on some PCs.',
      framing: 'A Microsoft troubleshooting setting. It helps some PCs, does nothing on others, and uses a little more power.',
      currentState: stateAvailable ? displayBcdValue(state.disableDynamicTick, 'Windows default (on)', 'Off', 'On (set explicitly)') : 'Unavailable',
      availability: !stateAvailable ? 'UNAVAILABLE' : tickApplicable ? 'APPLICABLE' : 'ALREADY_CONFIGURED',
      actionId: tickApplicable ? TIMING_ACTIONS.DISABLE_DYNAMIC_TICK : null,
      actionLabel: !stateAvailable ? 'Unavailable' : tickApplicable ? 'Configure experiment' : 'Already configured',
      risk: 'Medium',
      requiresElevation: true,
      requiresReboot: true,
      rollback: 'Dialed puts the previous value back, or removes it if there was none.',
      limitations: 'Microsoft describes this as a troubleshooting option, not a gaming tweak. It takes effect after a restart.',
      ongoingTesting: 'Restart, then measure your game before and after. If it did not clearly help, undo it.',
      sources: [MICROSOFT_SOURCES.bcdEdit],
      unavailableReason,
    },
    {
      id: 'precision-timer-session-research',
      title: '0.5 ms timer request — not enabled',
      kind: 'RESEARCH_ONLY',
      hypothesis: 'A finer timer can make short waits more precise in some programs.',
      framing: 'On current Windows, a timer request only affects the program that makes it, so Dialed asking for it would not help your game. Not offered.',
      currentState: 'Not offered',
      availability: 'RESEARCH_ONLY',
      actionId: null,
      actionLabel: 'Not offered',
      risk: 'Research',
      requiresElevation: false,
      requiresReboot: false,
      rollback: 'Nothing to undo; Dialed does not make this request.',
      limitations: 'A finer timer can cost performance and power. The Global timer resolution tweak is the supported way to let games share one.',
      ongoingTesting: 'Not offered.',
      sources: [MICROSOFT_SOURCES.timerResolution],
      unavailableReason: 'Not offered in this version.',
    },
  ];
}

async function readBootTimingState() {
  const script = `& {
    $lines = @(& bcdedit.exe /enum ACTIVE 2>&1)
    if ($LASTEXITCODE -ne 0) { throw ($lines -join [Environment]::NewLine) }
    $lines -join [Environment]::NewLine
  }`;
  const { stdout } = await runPowerShell(script);
  return parseBootTimingState(stdout);
}

async function listTimingExperiments(adapters = {}) {
  const readState = adapters.readBootTimingState || readBootTimingState;
  try {
    const state = await readState();
    return { items: clone(timingExperimentsForState(state)), errors: [] };
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : String(error);
    const message = /access is denied/i.test(rawMessage)
      ? 'Restart Dialed as administrator to read and use Windows boot timing controls.'
      : rawMessage;
    return {
      items: clone(timingExperimentsForState(null, message)),
      errors: [{ component: 'Boot timing state', message }],
    };
  }
}

function encodedPowerShellString(value) {
  return Buffer.from(String(value), 'utf8').toString('base64');
}

function assertUnredirectedDirectory(directory, fileSystem) {
  const resolved = path.resolve(directory);
  const root = path.parse(resolved).root;
  let current = root;
  for (const part of resolved.slice(root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    if (!fileSystem.existsSync(current)) break;
    const stat = fileSystem.lstatSync(current);
    if (stat.isSymbolicLink() || !stat.isDirectory() || path.resolve(fileSystem.realpathSync(current)).toLowerCase() !== current.toLowerCase()) {
      throw new Error('BCD backup refused: a directory ancestor is redirected or not a directory.');
    }
  }
}

async function createBcdBackup(userDataPath, actionId, adapters = {}) {
  if (!Object.values(TIMING_ACTIONS).includes(actionId)) throw new Error('This timing experiment action is not recognized.');
  if (typeof userDataPath !== 'string' || !path.isAbsolute(userDataPath)) throw new Error('BCD backup requires the internal absolute user-data path.');
  const executePowerShell = adapters.runPowerShell || runPowerShell;
  const fileSystem = adapters.fs || fs;
  const now = adapters.now || Date.now;
  const randomBytes = adapters.randomBytes || crypto.randomBytes;
  const backupRoot = path.join(userDataPath, 'safety-backups', 'bcd');
  assertUnredirectedDirectory(backupRoot, fileSystem);
  fileSystem.mkdirSync(backupRoot, { recursive: true });
  assertUnredirectedDirectory(backupRoot, fileSystem);
  const safeAction = actionId.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '');
  const fileName = `${safeAction}-${now()}-${randomBytes(4).toString('hex')}.bcd`;
  const target = path.join(backupRoot, fileName);
  const encodedTarget = encodedPowerShellString(target);
  await executePowerShell(`& {
    $target = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedTarget}'))
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
public static class DialedBcdDirectoryLock {
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern SafeFileHandle CreateFile(string name, uint access, uint share, IntPtr security, uint disposition, uint flags, IntPtr template);
  [DllImport("kernel32.dll", SetLastError=true)]
  static extern bool GetFileInformationByHandleEx(SafeFileHandle file, int infoClass, out AttributeTag info, uint size);
  [StructLayout(LayoutKind.Sequential)] struct AttributeTag { public uint Attributes; public uint Tag; }
  public static SafeFileHandle Lock(string path) {
    // Deny delete sharing while the export runs, pinning every ancestor.
    var handle = CreateFile(path, 0x80, 3, IntPtr.Zero, 3, 0x02200000, IntPtr.Zero);
    if(handle.IsInvalid) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
    AttributeTag info;
    if(!GetFileInformationByHandleEx(handle, 9, out info, 8) || (info.Attributes & 0x400) != 0 || (info.Attributes & 0x10) == 0) {
      handle.Dispose(); throw new InvalidOperationException("BCD backup directory is redirected or cannot be verified.");
    }
    return handle;
  }
}
'@
    $handles = New-Object System.Collections.Generic.List[Microsoft.Win32.SafeHandles.SafeFileHandle]
    try {
      $directory = [IO.Path]::GetDirectoryName($target)
      $root = [IO.Path]::GetPathRoot($directory)
      $current = $root
      $handles.Add([DialedBcdDirectoryLock]::Lock($current))
      foreach ($part in $directory.Substring($root.Length).Split([IO.Path]::DirectorySeparatorChar)) {
        if ($part) { $current = [IO.Path]::Combine($current, $part); $handles.Add([DialedBcdDirectoryLock]::Lock($current)) }
      }
      if ([IO.File]::Exists($target) -or [IO.Directory]::Exists($target)) { throw 'BCD backup target already exists.' }
      $output = @(& bcdedit.exe /export $target 2>&1)
      if ($LASTEXITCODE -ne 0) { throw ($output -join [Environment]::NewLine) }
    } finally { foreach ($handle in $handles) { $handle.Dispose() } }
  }`);
  if (!fileSystem.existsSync(target)) throw new Error('Windows reported a BCD export but the bounded backup file is absent.');
  assertUnredirectedDirectory(backupRoot, fileSystem);
  const outputStat = fileSystem.lstatSync(target);
  if (outputStat.isSymbolicLink() || !outputStat.isFile()) throw new Error('BCD backup output is not a regular file.');
  const bytes = outputStat.size;
  if (bytes < 1) throw new Error('The bounded BCD backup is empty.');
  const sha256 = crypto.createHash('sha256').update(fileSystem.readFileSync(target)).digest('hex');
  return {
    relativePath: path.relative(userDataPath, target),
    bytes,
    sha256,
    createdAt: new Date().toISOString(),
  };
}

async function runFixedBcdCommand(command) {
  const script = `& {
    $output = @(& bcdedit.exe ${command} 2>&1)
    if ($LASTEXITCODE -ne 0) { throw ($output -join [Environment]::NewLine) }
    [pscustomobject]@{ configured = $true; output = ($output -join [Environment]::NewLine) } | ConvertTo-Json -Compress
  }`;
  const { stdout, stderr, exitCode } = await runPowerShell(script);
  return { output: JSON.parse(stdout), stdout, stderr, exitCode };
}

async function applyBootTimingAction(actionId) {
  if (actionId === TIMING_ACTIONS.RESTORE_AUTOMATIC_CLOCK_SOURCE) {
    return runFixedBcdCommand("/deletevalue '{current}' useplatformclock");
  }
  if (actionId === TIMING_ACTIONS.DISABLE_DYNAMIC_TICK) {
    return runFixedBcdCommand("/set '{current}' disabledynamictick yes");
  }
  throw new Error('This timing experiment action is not recognized.');
}

async function restoreBootTimingAction(preAction) {
  const actionId = preAction?.actionId;
  const state = preAction?.state;
  assertBootTimingState(state);
  if (actionId === TIMING_ACTIONS.RESTORE_AUTOMATIC_CLOCK_SOURCE) {
    if (!state.usePlatformClock) throw new Error('The captured useplatformclock value is not restorable.');
    return runFixedBcdCommand(`/set '{current}' useplatformclock ${state.usePlatformClock.toLowerCase()}`);
  }
  if (actionId === TIMING_ACTIONS.DISABLE_DYNAMIC_TICK) {
    if (state.disableDynamicTick === null) {
      return runFixedBcdCommand("/deletevalue '{current}' disabledynamictick");
    }
    return runFixedBcdCommand(`/set '{current}' disabledynamictick ${state.disableDynamicTick.toLowerCase()}`);
  }
  throw new Error('This timing experiment action is not recognized.');
}

module.exports = {
  MICROSOFT_SOURCES,
  TIMING_ACTIONS,
  applyBootTimingAction,
  assertBootTimingState,
  assertTimingActionApplicable,
  createBcdBackup,
  listTimingExperiments,
  parseBootTimingState,
  readBootTimingState,
  restoreBootTimingAction,
  timingActionReachedIntendedState,
  timingExperimentsForState,
  timingStateEquals,
  timingTargetStateEquals,
};
