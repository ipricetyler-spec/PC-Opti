const crypto = require('crypto');
const os = require('os');
const { spawn } = require('child_process');

const POWERSHELL_TIMEOUT_MS = 30_000;
const MANAGEABLE_STARTUP_REGISTRY_PATHS = new Set([
  'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run',
]);

const PROTECTED_PROCESS_NAMES = new Set([
  'applicationframehost', 'audiodg', 'csrss', 'ctfmon', 'dwm', 'explorer', 'fontdrvhost',
  'idle', 'lockapp', 'lsass', 'registry', 'runtimebroker', 'searchhost', 'securityhealthservice',
  'shellexperiencehost', 'sihost', 'smss', 'spoolsv', 'startmenuexperiencehost', 'system',
  'taskhostw', 'textinputhost', 'wininit', 'winlogon',
]);

const PROCESS_INVENTORY_SCRIPT = `
$sessionId = (Get-Process -Id $PID -ErrorAction Stop).SessionId
$performanceByPid = @{}
Get-CimInstance -ClassName Win32_PerfFormattedData_PerfProc_Process -ErrorAction SilentlyContinue | ForEach-Object {
  $performanceByPid[[int]$_.IDProcess] = $_
}
$items = @()
Get-Process -ErrorAction SilentlyContinue | Where-Object {
  -not $_.HasExited -and $_.Id -gt 4 -and $_.SessionId -eq $sessionId
} | ForEach-Object {
  $performance = $performanceByPid[[int]$_.Id]
  $items += [pscustomobject]@{
    pid = [int]$_.Id
    name = [string]$_.ProcessName
    cpuPercent = if ($performance) { [int]$performance.PercentProcessorTime } else { 0 }
    workingSetBytes = [int64]$_.WorkingSet64
  }
}
`;

const SAFE_POLICY_INVENTORY_SCRIPT = `
$path = 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\CloudContent'
$name = 'DisableWindowsConsumerFeatures'
$keyExists = Test-Path -LiteralPath $path
$valueExists = $false
$value = $null
$kind = $null
if ($keyExists) {
  $key = Get-Item -LiteralPath $path -ErrorAction Stop
  try {
    $rawValue = $key.GetValue($name, $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
    if ($null -ne $rawValue) {
      $valueExists = $true
      $value = [int]$rawValue
      $kind = [string]$key.GetValueKind($name)
    }
  } catch {}
}
[pscustomobject]@{
  id = 'disable-windows-consumer-features'
  keyExists = [bool]$keyExists
  valueExists = [bool]$valueExists
  value = $value
  valueKind = $kind
  enabled = [bool]($valueExists -and $value -eq 1 -and $kind -eq 'DWord')
} | ConvertTo-Json -Compress
`;

const ECO_QOS_TYPE_DEFINITION = `
using System;
using System.Runtime.InteropServices;

public static class PCOptiEcoQos
{
    private const uint PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
    private const uint PROCESS_SET_INFORMATION = 0x0200;
    private const int ProcessPowerThrottling = 4;
    private const uint PROCESS_POWER_THROTTLING_CURRENT_VERSION = 1;
    private const uint PROCESS_POWER_THROTTLING_EXECUTION_SPEED = 0x1;

    [StructLayout(LayoutKind.Sequential)]
    private struct PROCESS_POWER_THROTTLING_STATE
    {
        public uint Version;
        public uint ControlMask;
        public uint StateMask;
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr OpenProcess(uint desiredAccess, bool inheritHandle, int processId);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CloseHandle(IntPtr handle);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetProcessInformation(
        IntPtr hProcess,
        int processInformationClass,
        out PROCESS_POWER_THROTTLING_STATE processInformation,
        uint processInformationSize);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool SetProcessInformation(
        IntPtr hProcess,
        int processInformationClass,
        ref PROCESS_POWER_THROTTLING_STATE processInformation,
        uint processInformationSize);

    public static bool IsEcoQosEnabled(int processId)
    {
        IntPtr handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, processId);
        if (handle == IntPtr.Zero) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
        try
        {
            PROCESS_POWER_THROTTLING_STATE state;
            if (!GetProcessInformation(handle, ProcessPowerThrottling, out state, (uint)Marshal.SizeOf(typeof(PROCESS_POWER_THROTTLING_STATE))))
                throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
            return (state.ControlMask & PROCESS_POWER_THROTTLING_EXECUTION_SPEED) != 0 &&
                (state.StateMask & PROCESS_POWER_THROTTLING_EXECUTION_SPEED) != 0;
        }
        finally { CloseHandle(handle); }
    }

    public static void SetEcoQos(int processId, bool enabled)
    {
        IntPtr handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_SET_INFORMATION, false, processId);
        if (handle == IntPtr.Zero) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
        try
        {
            PROCESS_POWER_THROTTLING_STATE state = new PROCESS_POWER_THROTTLING_STATE
            {
                Version = PROCESS_POWER_THROTTLING_CURRENT_VERSION,
                ControlMask = PROCESS_POWER_THROTTLING_EXECUTION_SPEED,
                StateMask = enabled ? PROCESS_POWER_THROTTLING_EXECUTION_SPEED : 0
            };
            if (!SetProcessInformation(handle, ProcessPowerThrottling, ref state, (uint)Marshal.SizeOf(typeof(PROCESS_POWER_THROTTLING_STATE))))
                throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
        }
        finally { CloseHandle(handle); }
    }
}
`;

const STARTUP_INVENTORY_SCRIPT = "$items = @(); $runKeys = @(" +
  "[pscustomobject]@{ registryPath = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'; scope = 'Current user'; canDisable = $true }," +
  "[pscustomobject]@{ registryPath = 'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'; scope = 'All users'; canDisable = $false }," +
  "[pscustomobject]@{ registryPath = 'HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Run'; scope = 'All users (32-bit)'; canDisable = $false }" +

"); foreach ($key in $runKeys) { if (Test-Path -LiteralPath $key.registryPath) { $registryKey = Get-Item -LiteralPath $key.registryPath -ErrorAction SilentlyContinue; $properties = Get-ItemProperty -LiteralPath $key.registryPath -ErrorAction SilentlyContinue; foreach ($property in $properties.PSObject.Properties) { if ($property.Name -notmatch '^PS') { $items += [pscustomobject]@{ name = [string]$property.Name; path = [string]$property.Value; source = 'Registry'; enabled = $true; scope = [string]$key.scope; canDisable = [bool]$key.canDisable; registryPath = [string]$key.registryPath; valueName = [string]$property.Name; value = [string]$property.Value; registryValueKind = if ($registryKey) { [string]$registryKey.GetValueKind($property.Name) } else { 'Unknown' } } } } } }; Get-ScheduledTask -ErrorAction SilentlyContinue | Where-Object { $_.Settings.Enabled -and @($_.Triggers | Where-Object { $_.CimClass.CimClassName -match 'Logon|Boot' }).Count -gt 0 } | Select-Object -First 100 | ForEach-Object { $action = @($_.Actions)[0]; $items += [pscustomobject]@{ name = [string]($_.TaskPath + $_.TaskName); path = if ($action) { [string]$action.Execute } else { '' }; source = 'TaskScheduler'; enabled = $true; scope = 'Scheduled task'; canDisable = $false; taskPath = [string]$_.TaskPath; taskName = [string]$_.TaskName } }; @($items) | ConvertTo-Json -Compress";

function runPowerShell(script, timeoutMs = POWERSHELL_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { windowsHide: true }
    );

    let stdout = '';
    let stderr = '';
    let finished = false;

    const finish = (callback) => {
      if (!finished) {
        finished = true;
        callback();
      }
    };

    const timeout = setTimeout(() => {
      child.kill();
      finish(() => reject(new Error(`PowerShell query exceeded ${timeoutMs / 1000} seconds.`)));
    }, timeoutMs);

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    child.on('error', (error) => {
      clearTimeout(timeout);
      finish(() => reject(error));
    });
    child.on('close', (code) => {
      clearTimeout(timeout);
      finish(() => {
        if (code === 0) {
          resolve({ stdout: stdout.trim(), stderr: stderr.trim(), exitCode: code });
        } else {
          const error = new Error(stderr.trim() || stdout.trim() || `PowerShell exited with code ${code}.`);
          error.exitCode = code;
          error.stdout = stdout.trim();
          error.stderr = stderr.trim();
          reject(error);
        }
      });
    });
  });
}

async function getJson(component, script, errors, fallback) {
  try {
    const { stdout } = await runPowerShell(script);
    if (!stdout) throw new Error('The query returned no data.');
    return JSON.parse(stdout);
  } catch (error) {
    errors.push({ component, message: error instanceof Error ? error.message : String(error) });
    return fallback;
  }
}

function asNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function getDeviceHash(machineGuid) {
  const source = typeof machineGuid === 'string' && machineGuid.trim() ? machineGuid.trim() : os.hostname();
  return crypto.createHash('sha256').update(source, 'utf8').digest('hex');
}

function startupItemId(item) {
  const stableTarget = item.source === 'Registry'
    ? `${item.registryPath || ''}\u0000${item.valueName || item.name}`
    : `${item.taskPath || ''}\u0000${item.taskName || item.name}`;
  return crypto.createHash('sha256').update(`${item.source}\u0000${stableTarget}`, 'utf8').digest('hex').slice(0, 24);
}

function normalizeStartupInventory(rawItems) {
  return (Array.isArray(rawItems) ? rawItems : [rawItems])
    .filter((item) => item && item.name)
    .map((item) => ({
      id: startupItemId(item),
      name: String(item.name),
      path: String(item.path || ''),
      source: item.source === 'TaskScheduler' ? 'TaskScheduler' : 'Registry',
      enabled: Boolean(item.enabled),
      scope: String(item.scope || 'Unknown'),
      canDisable: item.source === 'Registry' &&
        Boolean(item.canDisable) &&
        MANAGEABLE_STARTUP_REGISTRY_PATHS.has(String(item.registryPath || '')),
      registryPath: String(item.registryPath || ''),
      valueName: String(item.valueName || ''),
      value: String(item.value || ''),
      registryValueKind: String(item.registryValueKind || 'Unknown'),
      taskPath: String(item.taskPath || ''),
      taskName: String(item.taskName || ''),
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function createEcoQosPowerShellScript(script) {
  const typeDefinition = Buffer.from(ECO_QOS_TYPE_DEFINITION, 'utf8').toString('base64');
  return `$typeDefinition = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${typeDefinition}')); if (-not ('PCOptiEcoQos' -as [type])) { Add-Type -TypeDefinition $typeDefinition -ErrorAction Stop }; ${script}`;
}

function isManageableProcess(item) {
  const pid = asNumber(item?.pid);
  const name = String(item?.name || '').trim();
  return Number.isInteger(pid) && pid > 4 && Boolean(name) && !PROTECTED_PROCESS_NAMES.has(name.toLowerCase());
}

function normalizeProcessInventory(rawItems) {
  return (Array.isArray(rawItems) ? rawItems : [rawItems])
    .filter(isManageableProcess)
    .map((item) => ({
      pid: asNumber(item.pid),
      name: String(item.name).trim(),
      cpuPercent: Math.max(0, asNumber(item.cpuPercent)),
      workingSetBytes: Math.max(0, asNumber(item.workingSetBytes)),
      efficiencyMode: Boolean(item.efficiencyMode),
    }))
    .sort((left, right) => right.cpuPercent - left.cpuPercent || right.workingSetBytes - left.workingSetBytes || left.name.localeCompare(right.name))
    .slice(0, 30);
}

async function listStartupItems() {
  const errors = [];
  const rawItems = await getJson('startupItems', STARTUP_INVENTORY_SCRIPT, errors, []);
  return { items: normalizeStartupInventory(rawItems), errors };
}

async function listManageableProcesses() {
  const errors = [];
  const script = createEcoQosPowerShellScript(`${PROCESS_INVENTORY_SCRIPT}
$result = foreach ($item in $items) {
  $isEcoQos = $false
  try { $isEcoQos = [PCOptiEcoQos]::IsEcoQosEnabled([int]$item.pid) } catch {}
  [pscustomobject]@{
    pid = $item.pid
    name = $item.name
    cpuPercent = $item.cpuPercent
    workingSetBytes = $item.workingSetBytes
    efficiencyMode = [bool]$isEcoQos
  }
}
$result | ConvertTo-Json -Compress`);
  const rawItems = await getJson('processInventory', script, errors, []);
  return { items: normalizeProcessInventory(rawItems), errors };
}

async function listSafePolicies() {
  const errors = [];
  const rawPolicy = await getJson('safePolicies', SAFE_POLICY_INVENTORY_SCRIPT, errors, {});
  const policy = rawPolicy && rawPolicy.id === 'disable-windows-consumer-features'
    ? {
      id: 'disable-windows-consumer-features',
      title: 'Disable consumer content suggestions',
      description: 'Uses the documented DisableWindowsConsumerFeatures policy to prevent Windows from automatically installing sponsored consumer apps.',
      risk: 'Safe',
      enabled: Boolean(rawPolicy.enabled),
      keyExists: Boolean(rawPolicy.keyExists),
      valueExists: Boolean(rawPolicy.valueExists),
      value: rawPolicy.value === null || rawPolicy.value === undefined ? null : asNumber(rawPolicy.value),
      valueKind: rawPolicy.valueKind ? String(rawPolicy.valueKind) : null,
    }
    : null;
  return { items: policy ? [policy] : [], errors };
}

async function createSystemScanSnapshot() {
  const startedAt = Date.now();
  const errors = [];

  const [system, cpu, storage, startupInventory, tempFiles, machineGuid, elevated] = await Promise.all([
    getJson(
      'system',
      "$os = Get-CimInstance -ClassName Win32_OperatingSystem -ErrorAction Stop; [pscustomobject]@{ caption = [string]$os.Caption; version = [string]$os.Version; build = [string]$os.BuildNumber; architecture = [string]$os.OSArchitecture; totalBytes = [int64]$os.TotalVisibleMemorySize * 1KB; freeBytes = [int64]$os.FreePhysicalMemory * 1KB } | ConvertTo-Json -Compress",
      errors,
      { caption: 'Unavailable', version: 'Unavailable', build: 'Unavailable', architecture: 'Unavailable', totalBytes: 0, freeBytes: 0 }
    ),
    getJson(
      'cpu',
      "$processors = @(Get-CimInstance -ClassName Win32_Processor -ErrorAction Stop); [pscustomobject]@{ name = [string]$processors[0].Name; cores = [int](@($processors | Measure-Object -Property NumberOfCores -Sum).Sum); logicalProcessors = [int](@($processors | Measure-Object -Property NumberOfLogicalProcessors -Sum).Sum); maxClockSpeedMhz = [int](@($processors | Measure-Object -Property MaxClockSpeed -Maximum).Maximum) } | ConvertTo-Json -Compress",
      errors,
      { name: 'Unavailable', cores: 0, logicalProcessors: 0, maxClockSpeedMhz: 0 }
    ),
    getJson(
      'storage',
      "$trimOutput = (& fsutil behavior query DisableDeleteNotify 2>$null | Out-String); $trimEnabled = $trimOutput -match 'NTFS DisableDeleteNotify\\s*=\\s*0'; $mediaByDisk = @{}; Get-PhysicalDisk -ErrorAction SilentlyContinue | ForEach-Object { $disk = $_ | Get-Disk -ErrorAction SilentlyContinue; if ($null -ne $disk) { $mediaByDisk[[int]$disk.Number] = [string]$_.MediaType } }; $result = @(); Get-Volume -ErrorAction Stop | Where-Object { $_.DriveLetter -and $_.DriveType -eq 'Fixed' } | ForEach-Object { $volume = $_; $partition = Get-Partition -DriveLetter $volume.DriveLetter -ErrorAction SilentlyContinue; $mediaType = if ($null -ne $partition) { $mediaByDisk[[int]$partition.DiskNumber] } else { '' }; $result += [pscustomobject]@{ driveLetter = [string]$volume.DriveLetter; label = [string]$volume.FileSystemLabel; totalBytes = [int64]$volume.Size; freeBytes = [int64]$volume.SizeRemaining; isSSD = ($mediaType -eq 'SSD'); trimEnabled = [bool]$trimEnabled } }; $result | ConvertTo-Json -Compress",
      errors,
      []
    ),
    listStartupItems(),
    getJson(
      'tempFiles',
      "$paths = @($env:TEMP, (Join-Path $env:WINDIR 'Temp')) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -Unique; [int64]$total = 0; [int]$count = 0; foreach ($path in $paths) { Get-ChildItem -LiteralPath $path -File -Force -Recurse -ErrorAction SilentlyContinue | ForEach-Object { $total += $_.Length; $count++ } }; [pscustomobject]@{ totalSizeBytes = $total; pathCount = $count } | ConvertTo-Json -Compress",
      errors,
      { totalSizeBytes: 0, pathCount: 0 }
    ),
    getJson(
      'deviceIdentity',
      "[pscustomobject]@{ machineGuid = [string](Get-ItemPropertyValue -Path 'HKLM:\\SOFTWARE\\Microsoft\\Cryptography' -Name 'MachineGuid' -ErrorAction Stop) } | ConvertTo-Json -Compress",
      errors,
      { machineGuid: '' }
    ),
    getJson(
      'elevation',
      "$identity = [Security.Principal.WindowsIdentity]::GetCurrent(); $principal = New-Object Security.Principal.WindowsPrincipal($identity); [pscustomobject]@{ elevated = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator) } | ConvertTo-Json -Compress",
      errors,
      { elevated: false }
    ),
  ]);

  const totalBytes = asNumber(system.totalBytes);
  const freeBytes = asNumber(system.freeBytes);
  const normalizedStorage = (Array.isArray(storage) ? storage : [storage])
    .filter((item) => item && item.driveLetter)
    .map((item) => ({
      driveLetter: String(item.driveLetter),
      label: String(item.label || ''),
      totalBytes: asNumber(item.totalBytes),
      freeBytes: asNumber(item.freeBytes),
      isSSD: Boolean(item.isSSD),
      trimEnabled: Boolean(item.trimEnabled),
    }));
  errors.push(...startupInventory.errors);
  const normalizedStartup = startupInventory.items.map((item) => ({
    name: item.name,
    path: item.path,
    source: item.source,
    enabled: item.enabled,
  }));

  return {
    schemaVersion: '1.0.0',
    timestamp: new Date().toISOString(),
    deviceHash: getDeviceHash(machineGuid.machineGuid),
    metrics: {
      os: {
        caption: String(system.caption || 'Unavailable'),
        version: String(system.version || 'Unavailable'),
        build: String(system.build || 'Unavailable'),
        architecture: String(system.architecture || 'Unavailable'),
      },
      cpu: {
        name: String(cpu.name || 'Unavailable').trim(),
        cores: asNumber(cpu.cores),
        logicalProcessors: asNumber(cpu.logicalProcessors),
        maxClockSpeedMhz: asNumber(cpu.maxClockSpeedMhz),
      },
      memory: {
        totalBytes,
        freeBytes,
        loadPercentage: totalBytes > 0 ? Math.round(((totalBytes - freeBytes) / totalBytes) * 100) : 0,
      },
      storage: normalizedStorage,
      startupItems: normalizedStartup,
      tempFiles: {
        totalSizeBytes: asNumber(tempFiles.totalSizeBytes),
        pathCount: asNumber(tempFiles.pathCount),
      },
    },
    metadata: {
      executionTimeMs: Date.now() - startedAt,
      elevated: Boolean(elevated.elevated),
      errors,
    },
  };
}

module.exports = {
  MANAGEABLE_STARTUP_REGISTRY_PATHS,
  PROTECTED_PROCESS_NAMES,
  createEcoQosPowerShellScript,
  createSystemScanSnapshot,
  isManageableProcess,
  listManageableProcesses,
  listSafePolicies,
  listStartupItems,
  runPowerShell,
};
