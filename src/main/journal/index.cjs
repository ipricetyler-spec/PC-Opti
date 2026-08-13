const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
  MANAGEABLE_STARTUP_REGISTRY_PATHS,
  createEcoQosPowerShellScript,
  isManageableProcess,
  runPowerShell,
} = require('../scanner/index.cjs');

const CONSUMER_FEATURES_POLICY = {
  registryPath: 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\CloudContent',
  valueName: 'DisableWindowsConsumerFeatures',
};

function journalPath(userDataPath) {
  return path.join(userDataPath, 'journal.json');
}

function readJournal(userDataPath) {
  const filePath = journalPath(userDataPath);
  try {
    if (!fs.existsSync(filePath)) return [];
    const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return Array.isArray(content) ? content : [];
  } catch (error) {
    throw new Error(`Could not read the local audit journal: ${error.message}`);
  }
}

function writeJournal(userDataPath, entries) {
  fs.mkdirSync(userDataPath, { recursive: true });
  const target = journalPath(userDataPath);
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(entries, null, 2), 'utf8');
  fs.renameSync(temporary, target);
}

function appendEntry(userDataPath, entry) {
  const entries = readJournal(userDataPath);
  entries.unshift(entry);
  writeJournal(userDataPath, entries);
}

function replaceEntry(userDataPath, entry) {
  const entries = readJournal(userDataPath).map((existing) => (existing.id === entry.id ? entry : existing));
  writeJournal(userDataPath, entries);
}

function createEntry(actionId, title, preAction, options = {}) {
  return {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    actionId,
    title,
    category: options.category || 'Targeted maintenance',
    preAction,
    resultingState: null,
    status: 'PENDING',
    exitCode: null,
    stdout: '',
    stderr: '',
    rollback: options.rollback || {
      available: false,
      reason: 'This maintenance action does not alter a reversible configuration state.',
    },
  };
}

function encodePowerShellValue(value) {
  return Buffer.from(String(value), 'utf8').toString('base64');
}

function decodeInPowerShell(base64) {
  return `[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${base64}'))`;
}

function assertManageableStartupItem(item) {
  if (!item || item.source !== 'Registry' || !item.canDisable) {
    throw new Error('Only current-user Registry startup entries can be changed by PC-Opti.');
  }
  if (!MANAGEABLE_STARTUP_REGISTRY_PATHS.has(item.registryPath)) {
    throw new Error('This startup entry is outside PC-Opti’s supported Registry scope.');
  }
  if (!item.valueName || !item.value) {
    throw new Error('This startup entry does not contain a restorable Registry value.');
  }
  if (!['String', 'ExpandString'].includes(item.registryValueKind)) {
    throw new Error(`Registry value type '${item.registryValueKind}' is not supported for reversible startup management.`);
  }
}

async function removeRegistryRunValue(item) {
  const key = encodePowerShellValue(item.registryPath);
  const name = encodePowerShellValue(item.valueName);
  const script = `& { $key = ${decodeInPowerShell(key)}; $name = ${decodeInPowerShell(name)}; Remove-ItemProperty -LiteralPath $key -Name $name -ErrorAction Stop; [pscustomobject]@{ registryPath = $key; valueName = $name; enabled = $false } | ConvertTo-Json -Compress }`;
  const { stdout, stderr, exitCode } = await runPowerShell(script);
  return { output: JSON.parse(stdout), stdout, stderr, exitCode };
}

async function restoreRegistryRunValue(preAction) {
  const key = encodePowerShellValue(preAction.registryPath);
  const name = encodePowerShellValue(preAction.valueName);
  const value = encodePowerShellValue(preAction.value);
  const type = preAction.registryValueKind === 'ExpandString' ? 'ExpandString' : 'String';
  const script = `& { $key = ${decodeInPowerShell(key)}; $name = ${decodeInPowerShell(name)}; $value = ${decodeInPowerShell(value)}; if (-not (Test-Path -LiteralPath $key)) { throw 'The original Registry Run key no longer exists.' }; Set-ItemProperty -LiteralPath $key -Name $name -Value $value -Type ${type} -Force -ErrorAction Stop; [pscustomobject]@{ registryPath = $key; valueName = $name; enabled = $true } | ConvertTo-Json -Compress }`;
  const { stdout, stderr, exitCode } = await runPowerShell(script);
  return { output: JSON.parse(stdout), stdout, stderr, exitCode };
}

function startupPreActionFromItem(item) {
  return {
    source: 'Registry',
    registryPath: item.registryPath,
    valueName: item.valueName,
    value: item.value,
    registryValueKind: item.registryValueKind,
    enabled: true,
  };
}

async function disableStartupItem(userDataPath, item) {
  assertManageableStartupItem(item);
  const entry = createEntry(
    `startup:disable:${item.id}`,
    `Disable startup item: ${item.name}`,
    startupPreActionFromItem(item),
    {
      category: 'Startup management',
      rollback: {
        available: true,
        kind: 'restore-registry-run-value',
        reason: 'Restores the exact Registry Run value captured before this change.',
      },
    }
  );
  appendEntry(userDataPath, entry);

  try {
    const result = await removeRegistryRunValue(item);
    entry.status = 'SUCCESS';
    entry.exitCode = result.exitCode;
    entry.stdout = result.stdout;
    entry.stderr = result.stderr;
    entry.resultingState = result.output;
    replaceEntry(userDataPath, entry);
    return { success: true, entry, result: result.output };
  } catch (error) {
    entry.status = 'FAILED';
    entry.exitCode = error && Number.isInteger(error.exitCode) ? error.exitCode : null;
    entry.stdout = error?.stdout || '';
    entry.stderr = error?.stderr || (error instanceof Error ? error.message : String(error));
    replaceEntry(userDataPath, entry);
    return { success: false, entry, error: entry.stderr };
  }
}

function assertManageableProcess(process) {
  if (!isManageableProcess(process)) {
    throw new Error('This process is outside PC-Opti’s protected process-management scope.');
  }
}

async function readRunningProcess(processId) {
  const pid = Number(processId);
  if (!Number.isInteger(pid) || pid <= 4) throw new Error('The process identifier is not valid.');
  const { stdout } = await runPowerShell(
    `$process = Get-Process -Id ${pid} -ErrorAction Stop; [pscustomobject]@{ pid = [int]$process.Id; name = [string]$process.ProcessName } | ConvertTo-Json -Compress`
  );
  return JSON.parse(stdout);
}

async function getProcessEcoQos(processId) {
  const pid = Number(processId);
  const { stdout } = await runPowerShell(createEcoQosPowerShellScript(
    `[pscustomobject]@{ pid = ${pid}; efficiencyMode = [bool][PCOptiEcoQos]::IsEcoQosEnabled(${pid}) } | ConvertTo-Json -Compress`
  ));
  return JSON.parse(stdout);
}

async function setProcessEcoQos(processId, enabled) {
  const pid = Number(processId);
  const { stdout, stderr, exitCode } = await runPowerShell(createEcoQosPowerShellScript(
    `[PCOptiEcoQos]::SetEcoQos(${pid}, $${enabled ? 'true' : 'false'}); [pscustomobject]@{ pid = ${pid}; efficiencyMode = $${enabled ? 'true' : 'false'} } | ConvertTo-Json -Compress`
  ));
  return { output: JSON.parse(stdout), stdout, stderr, exitCode };
}

async function enableProcessEcoQos(userDataPath, process) {
  assertManageableProcess(process);
  const current = await readRunningProcess(process.pid);
  if (current.name.toLowerCase() !== String(process.name).toLowerCase()) {
    throw new Error('The selected process ended or its process identifier was reused. Refresh the process inventory.');
  }
  const initialState = await getProcessEcoQos(process.pid);
  if (initialState.efficiencyMode) {
    throw new Error('Efficiency Mode is already enabled for this process. PC-Opti will not overwrite an existing QoS state.');
  }

  const entry = createEntry(
    `process:enable-ecoqos:${process.pid}`,
    `Enable EcoQoS: ${current.name} (PID ${process.pid})`,
    { pid: process.pid, name: current.name, efficiencyMode: false },
    {
      category: 'Dynamic process balancing',
      rollback: {
        available: true,
        kind: 'disable-process-ecoqos',
        reason: 'Returns this still-running process to its pre-action EcoQoS state. No process is terminated.',
      },
    }
  );
  appendEntry(userDataPath, entry);

  try {
    const result = await setProcessEcoQos(process.pid, true);
    entry.status = 'SUCCESS';
    entry.exitCode = result.exitCode;
    entry.stdout = result.stdout;
    entry.stderr = result.stderr;
    entry.resultingState = result.output;
    replaceEntry(userDataPath, entry);
    return { success: true, entry, result: result.output };
  } catch (error) {
    entry.status = 'FAILED';
    entry.exitCode = error && Number.isInteger(error.exitCode) ? error.exitCode : null;
    entry.stdout = error?.stdout || '';
    entry.stderr = error?.stderr || (error instanceof Error ? error.message : String(error));
    replaceEntry(userDataPath, entry);
    return { success: false, entry, error: entry.stderr };
  }
}

async function readConsumerFeaturesPolicy() {
  const { registryPath, valueName } = CONSUMER_FEATURES_POLICY;
  const key = encodePowerShellValue(registryPath);
  const name = encodePowerShellValue(valueName);
  const script = `& {
    $keyPath = ${decodeInPowerShell(key)}
    $valueName = ${decodeInPowerShell(name)}
    $keyExists = Test-Path -LiteralPath $keyPath
    $valueExists = $false
    $value = $null
    $valueKind = $null
    if ($keyExists) {
      $registryKey = Get-Item -LiteralPath $keyPath -ErrorAction Stop
      try {
        $rawValue = $registryKey.GetValue($valueName, $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
        if ($null -ne $rawValue) {
          $valueExists = $true
          $value = [int]$rawValue
          $valueKind = [string]$registryKey.GetValueKind($valueName)
        }
      } catch {}
    }
    [pscustomobject]@{ registryPath = $keyPath; valueName = $valueName; keyExists = [bool]$keyExists; valueExists = [bool]$valueExists; value = $value; valueKind = $valueKind } | ConvertTo-Json -Compress
  }`;
  const { stdout } = await runPowerShell(script);
  return JSON.parse(stdout);
}

function assertManageableConsumerFeaturesPolicy(state) {
  if (!state || state.registryPath !== CONSUMER_FEATURES_POLICY.registryPath || state.valueName !== CONSUMER_FEATURES_POLICY.valueName) {
    throw new Error('The consumer content policy state is not valid.');
  }
  if (state.valueExists && state.valueKind !== 'DWord') {
    throw new Error(`The existing ${CONSUMER_FEATURES_POLICY.valueName} value is not a DWORD. PC-Opti will not overwrite it.`);
  }
}

async function createSafetyCheckpoint() {
  const description = encodePowerShellValue('PC-Opti pre-policy safety state');
  const script = `& {
    $description = ${decodeInPowerShell(description)}
    $restorePath = 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\SystemRestore'
    $frequencyName = 'SystemRestorePointCreationFrequency'
    if (-not (Test-Path -LiteralPath $restorePath)) { throw 'Windows System Restore is unavailable on this device.' }
    $restoreKey = Get-Item -LiteralPath $restorePath -ErrorAction Stop
    $previous = $restoreKey.GetValue($frequencyName, $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
    $hadPrevious = $null -ne $previous
    try {
      New-ItemProperty -LiteralPath $restorePath -Name $frequencyName -PropertyType DWord -Value 0 -Force -ErrorAction Stop | Out-Null
      Checkpoint-Computer -Description $description -RestorePointType MODIFY_SETTINGS -ErrorAction Stop
      [pscustomobject]@{ description = $description; requested = $true } | ConvertTo-Json -Compress
    } finally {
      if ($hadPrevious) {
        New-ItemProperty -LiteralPath $restorePath -Name $frequencyName -PropertyType DWord -Value ([int]$previous) -Force -ErrorAction Stop | Out-Null
      } else {
        Remove-ItemProperty -LiteralPath $restorePath -Name $frequencyName -ErrorAction SilentlyContinue
      }
    }
  }`;
  const { stdout, stderr, exitCode } = await runPowerShell(script, 90_000);
  return { output: JSON.parse(stdout), stdout, stderr, exitCode };
}

async function writeConsumerFeaturesPolicy() {
  const { registryPath, valueName } = CONSUMER_FEATURES_POLICY;
  const key = encodePowerShellValue(registryPath);
  const name = encodePowerShellValue(valueName);
  const script = `& { $keyPath = ${decodeInPowerShell(key)}; $valueName = ${decodeInPowerShell(name)}; New-Item -Path $keyPath -Force -ErrorAction Stop | Out-Null; New-ItemProperty -LiteralPath $keyPath -Name $valueName -PropertyType DWord -Value 1 -Force -ErrorAction Stop | Out-Null; [pscustomobject]@{ registryPath = $keyPath; valueName = $valueName; value = 1; enabled = $true } | ConvertTo-Json -Compress }`;
  const { stdout, stderr, exitCode } = await runPowerShell(script);
  return { output: JSON.parse(stdout), stdout, stderr, exitCode };
}

async function restoreConsumerFeaturesPolicy(preAction) {
  assertManageableConsumerFeaturesPolicy(preAction);
  const key = encodePowerShellValue(preAction.registryPath);
  const name = encodePowerShellValue(preAction.valueName);
  const script = preAction.valueExists
    ? `& { $keyPath = ${decodeInPowerShell(key)}; $valueName = ${decodeInPowerShell(name)}; New-Item -Path $keyPath -Force -ErrorAction Stop | Out-Null; New-ItemProperty -LiteralPath $keyPath -Name $valueName -PropertyType DWord -Value ${Number(preAction.value)} -Force -ErrorAction Stop | Out-Null; [pscustomobject]@{ registryPath = $keyPath; valueName = $valueName; value = ${Number(preAction.value)}; restored = $true } | ConvertTo-Json -Compress }`
    : `& { $keyPath = ${decodeInPowerShell(key)}; $valueName = ${decodeInPowerShell(name)}; if (Test-Path -LiteralPath $keyPath) { Remove-ItemProperty -LiteralPath $keyPath -Name $valueName -ErrorAction SilentlyContinue }; [pscustomobject]@{ registryPath = $keyPath; valueName = $valueName; value = $null; restored = $true } | ConvertTo-Json -Compress }`;
  const { stdout, stderr, exitCode } = await runPowerShell(script);
  return { output: JSON.parse(stdout), stdout, stderr, exitCode };
}

async function enableConsumerFeaturesPolicy(userDataPath) {
  const preAction = await readConsumerFeaturesPolicy();
  assertManageableConsumerFeaturesPolicy(preAction);
  if (preAction.valueExists && preAction.value === 1) {
    throw new Error('Consumer content suggestions are already disabled. PC-Opti will not overwrite the existing policy.');
  }

  const entry = createEntry(
    'policy:disable-windows-consumer-features',
    'Disable Windows consumer content suggestions',
    preAction,
    {
      category: 'Safe OS policy',
      rollback: {
        available: true,
        kind: 'restore-consumer-features-policy',
        reason: 'Restores the exact policy-value state captured before this change.',
      },
    }
  );
  appendEntry(userDataPath, entry);

  try {
    const checkpoint = await createSafetyCheckpoint();
    const result = await writeConsumerFeaturesPolicy();
    entry.status = 'SUCCESS';
    entry.exitCode = result.exitCode;
    entry.stdout = result.stdout;
    entry.stderr = result.stderr;
    entry.resultingState = { ...result.output, safetyCheckpoint: checkpoint.output };
    replaceEntry(userDataPath, entry);
    return { success: true, entry, result: entry.resultingState };
  } catch (error) {
    entry.status = 'FAILED';
    entry.exitCode = error && Number.isInteger(error.exitCode) ? error.exitCode : null;
    entry.stdout = error?.stdout || '';
    entry.stderr = error?.stderr || (error instanceof Error ? error.message : String(error));
    replaceEntry(userDataPath, entry);
    return { success: false, entry, error: entry.stderr };
  }
}

async function rollbackAuditEntry(userDataPath, entryId) {
  const original = readJournal(userDataPath).find((entry) => entry.id === entryId);
  if (!original || original.status !== 'SUCCESS' || !original.rollback?.available) {
    throw new Error('This audit entry does not have an available deterministic rollback.');
  }

  if (original.rollback.kind === 'disable-process-ecoqos') {
    assertManageableProcess(original.preAction);
    const current = await readRunningProcess(original.preAction.pid);
    if (current.name.toLowerCase() !== String(original.preAction.name).toLowerCase()) {
      throw new Error('The managed process ended or its process identifier was reused. EcoQoS was not changed.');
    }
    const entry = createEntry(
      `process:disable-ecoqos:${original.id}`,
      `Restore EcoQoS state: ${current.name} (PID ${current.pid})`,
      { originalAuditEntryId: original.id, restoring: original.preAction },
      { category: 'Dynamic process balancing' }
    );
    appendEntry(userDataPath, entry);
    try {
      const result = await setProcessEcoQos(original.preAction.pid, false);
      entry.status = 'SUCCESS';
      entry.exitCode = result.exitCode;
      entry.stdout = result.stdout;
      entry.stderr = result.stderr;
      entry.resultingState = result.output;
      replaceEntry(userDataPath, entry);
      original.rollback = {
        available: false,
        reason: `Restored by audit entry ${entry.id}.`,
        completedAt: new Date().toISOString(),
      };
      replaceEntry(userDataPath, original);
      return { success: true, entry, result: result.output };
    } catch (error) {
      entry.status = 'FAILED';
      entry.exitCode = error && Number.isInteger(error.exitCode) ? error.exitCode : null;
      entry.stdout = error?.stdout || '';
      entry.stderr = error?.stderr || (error instanceof Error ? error.message : String(error));
      replaceEntry(userDataPath, entry);
      return { success: false, entry, error: entry.stderr };
    }
  }

  if (original.rollback.kind === 'restore-consumer-features-policy') {
    const entry = createEntry(
      `policy:restore-consumer-features:${original.id}`,
      'Restore Windows consumer content policy',
      { originalAuditEntryId: original.id, restoring: original.preAction },
      { category: 'Safe OS policy' }
    );
    appendEntry(userDataPath, entry);
    try {
      const result = await restoreConsumerFeaturesPolicy(original.preAction);
      entry.status = 'SUCCESS';
      entry.exitCode = result.exitCode;
      entry.stdout = result.stdout;
      entry.stderr = result.stderr;
      entry.resultingState = result.output;
      replaceEntry(userDataPath, entry);
      original.rollback = {
        available: false,
        reason: `Restored by audit entry ${entry.id}.`,
        completedAt: new Date().toISOString(),
      };
      replaceEntry(userDataPath, original);
      return { success: true, entry, result: result.output };
    } catch (error) {
      entry.status = 'FAILED';
      entry.exitCode = error && Number.isInteger(error.exitCode) ? error.exitCode : null;
      entry.stdout = error?.stdout || '';
      entry.stderr = error?.stderr || (error instanceof Error ? error.message : String(error));
      replaceEntry(userDataPath, entry);
      return { success: false, entry, error: entry.stderr };
    }
  }

  if (original.rollback.kind !== 'restore-registry-run-value') {
    throw new Error('This audit entry does not have a supported deterministic rollback.');
  }
  assertManageableStartupItem({ ...original.preAction, canDisable: true });

  const entry = createEntry(
    `startup:restore:${original.id}`,
    `Restore startup item: ${original.preAction.valueName}`,
    { originalAuditEntryId: original.id, restoring: original.preAction },
    { category: 'Startup management' }
  );
  appendEntry(userDataPath, entry);

  try {
    const result = await restoreRegistryRunValue(original.preAction);
    entry.status = 'SUCCESS';
    entry.exitCode = result.exitCode;
    entry.stdout = result.stdout;
    entry.stderr = result.stderr;
    entry.resultingState = result.output;
    replaceEntry(userDataPath, entry);
    original.rollback = {
      available: false,
      reason: `Restored by audit entry ${entry.id}.`,
      completedAt: new Date().toISOString(),
    };
    replaceEntry(userDataPath, original);
    return { success: true, entry, result: result.output };
  } catch (error) {
    entry.status = 'FAILED';
    entry.exitCode = error && Number.isInteger(error.exitCode) ? error.exitCode : null;
    entry.stdout = error?.stdout || '';
    entry.stderr = error?.stderr || (error instanceof Error ? error.message : String(error));
    replaceEntry(userDataPath, entry);
    return { success: false, entry, error: entry.stderr };
  }
}

async function prepareTempState() {
  const { stdout } = await runPowerShell(
    "$paths = @($env:TEMP, (Join-Path $env:WINDIR 'Temp')) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -Unique; [int64]$total = 0; [int]$count = 0; foreach ($path in $paths) { Get-ChildItem -LiteralPath $path -File -Force -Recurse -ErrorAction SilentlyContinue | ForEach-Object { $total += $_.Length; $count++ } }; [pscustomobject]@{ paths = @($paths); totalSizeBytes = $total; pathCount = $count } | ConvertTo-Json -Compress"
  );
  return JSON.parse(stdout);
}

async function clearTempFiles() {
  const { stdout, stderr, exitCode } = await runPowerShell(
    "$paths = @($env:TEMP, (Join-Path $env:WINDIR 'Temp')) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -Unique; [int64]$reclaimed = 0; [int]$deleted = 0; foreach ($path in $paths) { Get-ChildItem -LiteralPath $path -File -Force -Recurse -ErrorAction SilentlyContinue | ForEach-Object { $length = $_.Length; try { Remove-Item -LiteralPath $_.FullName -Force -ErrorAction Stop; $reclaimed += $length; $deleted++ } catch {} } }; [pscustomobject]@{ deletedFileCount = $deleted; reclaimedBytes = $reclaimed } | ConvertTo-Json -Compress"
  );
  return { output: JSON.parse(stdout), stdout, stderr, exitCode };
}

async function retrimDrive(driveLetter) {
  const { stdout, stderr, exitCode } = await runPowerShell(
    `Optimize-Volume -DriveLetter '${driveLetter}' -ReTrim -Verbose -ErrorAction Stop | Out-String`
  );
  return { output: { driveLetter, message: stdout || 'ReTRIM completed.' }, stdout, stderr, exitCode };
}

async function executeMaintenanceAction(userDataPath, actionId) {
  let title;
  let preAction;
  let execute;

  if (actionId === 'clear-temp-files') {
    title = 'Clear temporary files';
    preAction = await prepareTempState();
    execute = clearTempFiles;
  } else {
    const match = /^retrim-drive:([A-Z])$/i.exec(actionId);
    if (!match) throw new Error('This maintenance action is not recognized.');
    const driveLetter = match[1].toUpperCase();
    title = `ReTRIM ${driveLetter}:`;
    preAction = { driveLetter, operation: 'Optimize-Volume -ReTrim' };
    execute = () => retrimDrive(driveLetter);
  }

  const entry = createEntry(actionId, title, preAction);
  appendEntry(userDataPath, entry);

  try {
    const result = await execute();
    entry.status = 'SUCCESS';
    entry.exitCode = result.exitCode;
    entry.stdout = result.stdout;
    entry.stderr = result.stderr;
    entry.resultingState = result.output;
    replaceEntry(userDataPath, entry);
    return { success: true, entry, result: result.output };
  } catch (error) {
    entry.status = 'FAILED';
    entry.exitCode = error && Number.isInteger(error.exitCode) ? error.exitCode : null;
    entry.stderr = error instanceof Error ? error.message : String(error);
    replaceEntry(userDataPath, entry);
    return { success: false, entry, error: entry.stderr };
  }
}

module.exports = {
  disableStartupItem,
  enableConsumerFeaturesPolicy,
  enableProcessEcoQos,
  executeMaintenanceAction,
  readJournal,
  rollbackAuditEntry,
};
