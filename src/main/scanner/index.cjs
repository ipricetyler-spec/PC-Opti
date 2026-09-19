const crypto = require('crypto');
const os = require('os');
const { spawn } = require('child_process');
const {
  SNAPSHOT_SCHEMA_VERSION,
  availableEvidence,
  unavailableEvidence,
  validateSystemScanSnapshot,
} = require('../snapshot/index.cjs');
const { createTempMaintenancePowerShellScript } = require('../maintenance/index.cjs');
const { WINDOWS_ELEVATION_POWERSHELL } = require('../shared/windows-elevation.cjs');
const { windowsPowerShellEnvironment } = require('../shared/windows-powershell-env.cjs');

const POWERSHELL_TIMEOUT_MS = 30_000;
const MANAGEABLE_STARTUP_REGISTRY_PATHS = new Set([
  'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run',
  'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run',
]);
const STARTUP_RUN_REGISTRY_PATHS = new Set([
  'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run',
  'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run',
]);
const STARTUP_REGISTRY_VIEWS = new Set(['Registry32', 'Registry64']);

const PROTECTED_PROCESS_NAMES = new Set([
  'applicationframehost', 'audiodg', 'bedaisy', 'beservice', 'csrss', 'ctfmon', 'dwm',
  'denuvo-anti-cheat', 'denuvo-anti-cheat-crash-report', 'denuvo-anti-cheat-update-service',
  'easyanticheat', 'easyanticheat_eos', 'explorer', 'fontdrvhost', 'idle', 'lockapp', 'lsass',
  'registry', 'ricochet', 'runtimebroker', 'searchhost', 'securityhealthservice',
  'shellexperiencehost', 'sihost', 'smss', 'spoolsv', 'startmenuexperiencehost', 'system',
  'taskhostw', 'textinputhost', 'vgc', 'vgk', 'vgtray', 'wininit', 'winlogon',
]);

const ANTI_CHEAT_PROCESS_NAMES_BY_PRODUCT = Object.freeze({
  Vanguard: Object.freeze(['vgc', 'vgk', 'vgtray']),
  'Easy Anti-Cheat': Object.freeze(['easyanticheat', 'easyanticheat_eos']),
  BattlEye: Object.freeze(['beservice', 'bedaisy']),
  Denuvo: Object.freeze([
    'denuvo',
    'denuvoanticheat',
    'denuvo-anti-cheat',
    'denuvo-anti-cheat-crash-report',
    'denuvo-anti-cheat-update-service',
  ]),
  Ricochet: Object.freeze(['ricochet']),
});

const ANTI_CHEAT_PRODUCTS = Object.freeze([
  Object.freeze({
    product: 'Vanguard',
    serviceNames: Object.freeze(['vgc']),
    driverNames: Object.freeze(['vgk']),
    namePrefixes: Object.freeze([]),
    displayNames: Object.freeze(['riot vanguard']),
  }),
  Object.freeze({
    product: 'Easy Anti-Cheat',
    serviceNames: Object.freeze(['easyanticheat', 'easyanticheat_eos']),
    driverNames: Object.freeze(['easyanticheat', 'easyanticheat_eos']),
    namePrefixes: Object.freeze(['easyanticheat']),
    displayNames: Object.freeze(['easy anti-cheat', 'easy anti cheat']),
  }),
  Object.freeze({
    product: 'BattlEye',
    serviceNames: Object.freeze(['beservice']),
    driverNames: Object.freeze(['bedaisy']),
    namePrefixes: Object.freeze([]),
    displayNames: Object.freeze(['battleye']),
  }),
  Object.freeze({
    product: 'Denuvo',
    serviceNames: Object.freeze(['denuvoanticheat']),
    driverNames: Object.freeze(['denuvoanticheat']),
    namePrefixes: Object.freeze(['denuvoanticheat']),
    displayNames: Object.freeze(['denuvo anti-cheat', 'denuvo anti cheat']),
  }),
  Object.freeze({
    product: 'Ricochet',
    serviceNames: Object.freeze(['ricochet']),
    driverNames: Object.freeze(['ricochet']),
    namePrefixes: Object.freeze(['atvi-randgrid']),
    displayNames: Object.freeze(['ricochet anti-cheat', 'ricochet anti cheat']),
  }),
]);

// Read-only CIM inventory documented by Microsoft:
// https://learn.microsoft.com/en-us/windows/win32/cimwin32prov/win32-service
// https://learn.microsoft.com/en-us/windows/win32/cimwin32prov/win32-systemdriver
const WINDOWS_SERVICE_ENUMERATION_SCRIPT = `
@(
  Get-CimInstance -ClassName Win32_Service -ErrorAction Stop | ForEach-Object {
    [pscustomobject]@{
      name = [string]$_.Name
      displayName = [string]$_.DisplayName
      state = [string]$_.State
    }
  }
) | ConvertTo-Json -Compress
`;

const WINDOWS_DRIVER_ENUMERATION_SCRIPT = `
@(
  Get-CimInstance -ClassName Win32_SystemDriver -ErrorAction Stop | ForEach-Object {
    [pscustomobject]@{
      name = [string]$_.Name
      displayName = [string]$_.DisplayName
      state = [string]$_.State
    }
  }
) | ConvertTo-Json -Compress
`;

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
    # $( ) is required: a bare try/catch as a hashtable value swallows the next line
    # while looking for 'finally', and the whole script fails to parse.
    creationTime = $(try { [string]$_.StartTime.ToUniversalTime().ToFileTimeUtc() } catch { $null })
    cpuPercent = if ($performance) { [int]$performance.PercentProcessorTime } else { $null }
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
        ref PROCESS_POWER_THROTTLING_STATE processInformation,
        uint processInformationSize);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool SetProcessInformation(
        IntPtr hProcess,
        int processInformationClass,
        ref PROCESS_POWER_THROTTLING_STATE processInformation,
        uint processInformationSize);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetProcessTimes(IntPtr handle, out long creation, out long exit, out long kernel, out long user);

    private static void AssertLifetime(IntPtr handle, long expectedCreationTime)
    {
        long creation, exit, kernel, user;
        if (!GetProcessTimes(handle, out creation, out exit, out kernel, out user))
            throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
        if (creation != expectedCreationTime || exit != 0)
            throw new InvalidOperationException("The selected process lifetime changed or ended.");
    }

    public static bool IsEcoQosEnabled(int processId) { return IsEcoQosEnabled(processId, 0); }
    public static bool IsEcoQosEnabled(int processId, long expectedCreationTime)
    {
        IntPtr handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, processId);
        if (handle == IntPtr.Zero) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
        try
        {
            if (expectedCreationTime != 0) AssertLifetime(handle, expectedCreationTime);
            PROCESS_POWER_THROTTLING_STATE state = new PROCESS_POWER_THROTTLING_STATE
            {
                Version = PROCESS_POWER_THROTTLING_CURRENT_VERSION,
                ControlMask = 0,
                StateMask = 0
            };
            if (!GetProcessInformation(handle, ProcessPowerThrottling, ref state, (uint)Marshal.SizeOf(typeof(PROCESS_POWER_THROTTLING_STATE))))
                throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
            return (state.ControlMask & PROCESS_POWER_THROTTLING_EXECUTION_SPEED) != 0 &&
                (state.StateMask & PROCESS_POWER_THROTTLING_EXECUTION_SPEED) != 0;
        }
        finally { CloseHandle(handle); }
    }

    public static bool SetEcoQos(int processId, bool enabled, long expectedCreationTime)
    {
        IntPtr handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_SET_INFORMATION, false, processId);
        if (handle == IntPtr.Zero) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
        try
        {
            if (expectedCreationTime <= 0) throw new InvalidOperationException("A process lifetime is required.");
            AssertLifetime(handle, expectedCreationTime);
            PROCESS_POWER_THROTTLING_STATE previous = new PROCESS_POWER_THROTTLING_STATE { Version = PROCESS_POWER_THROTTLING_CURRENT_VERSION };
            if (!GetProcessInformation(handle, ProcessPowerThrottling, ref previous, (uint)Marshal.SizeOf(typeof(PROCESS_POWER_THROTTLING_STATE))))
                throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
            bool previousEnabled = (previous.ControlMask & 1) != 0 && (previous.StateMask & 1) != 0;
            if (previousEnabled == enabled) throw new InvalidOperationException("The QoS state changed before the action.");
            PROCESS_POWER_THROTTLING_STATE state = new PROCESS_POWER_THROTTLING_STATE
            {
                Version = PROCESS_POWER_THROTTLING_CURRENT_VERSION,
                ControlMask = previous.ControlMask | PROCESS_POWER_THROTTLING_EXECUTION_SPEED,
                StateMask = enabled ? previous.StateMask | PROCESS_POWER_THROTTLING_EXECUTION_SPEED : previous.StateMask & ~PROCESS_POWER_THROTTLING_EXECUTION_SPEED
            };
            AssertLifetime(handle, expectedCreationTime);
            if (!SetProcessInformation(handle, ProcessPowerThrottling, ref state, (uint)Marshal.SizeOf(typeof(PROCESS_POWER_THROTTLING_STATE))))
                throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
            AssertLifetime(handle, expectedCreationTime);
            if (!GetProcessInformation(handle, ProcessPowerThrottling, ref state, (uint)Marshal.SizeOf(typeof(PROCESS_POWER_THROTTLING_STATE))))
                throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
            bool actual = (state.ControlMask & 1) != 0 && (state.StateMask & 1) != 0;
            if (actual != enabled) throw new InvalidOperationException("QoS readback did not match the requested state.");
            return actual;
        }
        finally { CloseHandle(handle); }
    }
}
`;

// Microsoft documents the persistent per-user and machine-wide Run keys here:
// https://learn.microsoft.com/en-us/windows/win32/setupapi/run-and-runonce-registry-keys
// HKLM\\Software is redirected on WOW64, while HKCU\\Software is shared. Open
// explicit logical views instead of addressing the reserved Wow6432Node path:
// https://learn.microsoft.com/en-us/windows/win32/winprog64/shared-registry-keys
// https://learn.microsoft.com/en-us/windows/win32/winprog64/registry-redirector
const STARTUP_INVENTORY_SCRIPT = `
$items = @()
$subKeyPath = 'Software\\Microsoft\\Windows\\CurrentVersion\\Run'
$is64BitOperatingSystem = [Environment]::Is64BitOperatingSystem
$currentUserView = if ($is64BitOperatingSystem) {
  [Microsoft.Win32.RegistryView]::Registry64
} else {
  [Microsoft.Win32.RegistryView]::Registry32
}
$targets = @(
  [pscustomobject]@{
    hive = [Microsoft.Win32.RegistryHive]::CurrentUser
    registryPath = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'
    registryView = $currentUserView
    scope = 'Current user'
    canDisable = $true
  }
)
$machineViews = if ($is64BitOperatingSystem) {
  @([Microsoft.Win32.RegistryView]::Registry64, [Microsoft.Win32.RegistryView]::Registry32)
} else {
  @([Microsoft.Win32.RegistryView]::Registry32)
}
foreach ($view in $machineViews) {
  $scope = if (-not $is64BitOperatingSystem) { 'All users' } elseif ($view -eq [Microsoft.Win32.RegistryView]::Registry64) { 'All users (64-bit)' } else { 'All users (32-bit)' }
  $targets += [pscustomobject]@{
    hive = [Microsoft.Win32.RegistryHive]::LocalMachine
    registryPath = 'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'
    registryView = $view
    scope = $scope
    canDisable = $true
  }
}
foreach ($target in $targets) {
  $baseKey = $null
  $registryKey = $null
  try {
    $baseKey = [Microsoft.Win32.RegistryKey]::OpenBaseKey($target.hive, $target.registryView)
    $registryKey = $baseKey.OpenSubKey($subKeyPath, $false)
    if ($null -eq $registryKey) { continue }
    foreach ($valueName in $registryKey.GetValueNames()) {
      $rawValue = $registryKey.GetValue($valueName, $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
      $items += [pscustomobject]@{
        name = [string]$valueName
        path = [string]$rawValue
        source = 'Registry'
        enabled = $true
        scope = [string]$target.scope
        canDisable = [bool]$target.canDisable
        registryPath = [string]$target.registryPath
        registryView = [string]$target.registryView
        valueName = [string]$valueName
        value = [string]$rawValue
        registryValueKind = [string]$registryKey.GetValueKind($valueName)
      }
    }
  } finally {
    if ($null -ne $registryKey) { $registryKey.Dispose() }
    if ($null -ne $baseKey) { $baseKey.Dispose() }
  }
}
Get-ScheduledTask -ErrorAction SilentlyContinue |
  Where-Object { $_.Settings.Enabled -and @($_.Triggers | Where-Object { $_.CimClass.CimClassName -match 'Logon|Boot' }).Count -gt 0 } |
  Select-Object -First 100 |
  ForEach-Object {
    $action = @($_.Actions)[0]
    $items += [pscustomobject]@{
      name = [string]($_.TaskPath + $_.TaskName)
      path = if ($action) { [string]$action.Execute } else { '' }
      source = 'TaskScheduler'
      enabled = $true
      scope = 'Scheduled task'
      canDisable = $false
      taskPath = [string]$_.TaskPath
      taskName = [string]$_.TaskName
    }
  }
@($items) | ConvertTo-Json -Compress
`;

const STORAGE_INVENTORY_SCRIPT = "$trimOutput = (& fsutil behavior query DisableDeleteNotify 2>$null | Out-String); $trimEnabled = $trimOutput -match 'NTFS DisableDeleteNotify\\s*=\\s*0'; $mediaByDisk = @{}; Get-PhysicalDisk -ErrorAction SilentlyContinue | ForEach-Object { $disk = $_ | Get-Disk -ErrorAction SilentlyContinue; if ($null -ne $disk) { $mediaByDisk[[int]$disk.Number] = [string]$_.MediaType } }; $result = @(); Get-Volume -ErrorAction Stop | Where-Object { $_.DriveLetter -and $_.DriveType -eq 'Fixed' } | ForEach-Object { $volume = $_; $partition = Get-Partition -DriveLetter $volume.DriveLetter -ErrorAction SilentlyContinue; $mediaType = if ($null -ne $partition) { $mediaByDisk[[int]$partition.DiskNumber] } else { '' }; $result += [pscustomobject]@{ driveLetter = [string]$volume.DriveLetter; label = [string]$volume.FileSystemLabel; totalBytes = [int64]$volume.Size; freeBytes = [int64]$volume.SizeRemaining; isSSD = ($mediaType -eq 'SSD'); trimEnabled = [bool]$trimEnabled } }; $result | ConvertTo-Json -Compress";

const GRAPHICS_DIAGNOSTIC_SCRIPT = `
$items = @(Get-CimInstance -ClassName Win32_VideoController -ErrorAction Stop | ForEach-Object {
  [pscustomobject]@{
    name = [string]$_.Name
    driverVersion = [string]$_.DriverVersion
    status = [string]$_.Status
    adapterCompatibility = [string]$_.AdapterCompatibility
  }
})
@($items) | ConvertTo-Json -Compress
`;

const MOTHERBOARD_DIAGNOSTIC_SCRIPT = `
$board = Get-CimInstance -ClassName Win32_BaseBoard -ErrorAction Stop | Select-Object -First 1
[pscustomobject]@{
  manufacturer = [string]$board.Manufacturer
  product = [string]$board.Product
} | ConvertTo-Json -Compress
`;

const POWER_SCHEME_DIAGNOSTIC_SCRIPT = `
$output = (& powercfg.exe /getactivescheme 2>&1 | Out-String).Trim()
if ($LASTEXITCODE -ne 0) { throw $output }
$match = [regex]::Match($output, '([0-9a-fA-F-]{36})(?:\\s+\\((.+)\\))?')
if (-not $match.Success) { throw 'Windows returned an unrecognized active power-scheme response.' }
[pscustomobject]@{
  guid = [string]$match.Groups[1].Value.ToLowerInvariant()
  name = if ($match.Groups[2].Success) { [string]$match.Groups[2].Value.Trim() } else { '' }
} | ConvertTo-Json -Compress
`;

const HAGS_DIAGNOSTIC_SCRIPT = `
$path = 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\GraphicsDrivers'
$name = 'HwSchMode'
$value = $null
$exists = $false
if (Test-Path -LiteralPath $path) {
  $key = Get-Item -LiteralPath $path -ErrorAction Stop
  $raw = $key.GetValue($name, $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
  if ($null -ne $raw) { $exists = $true; $value = [int]$raw }
}
[pscustomobject]@{
  state = if (-not $exists) { 'System default' } elseif ($value -eq 2) { 'Enabled' } elseif ($value -eq 1) { 'Disabled' } else { 'Unknown value' }
  configuredValue = if ($exists) { $value } else { $null }
} | ConvertTo-Json -Compress
`;

const GAME_DVR_DIAGNOSTIC_SCRIPT = `
$capturePath = 'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\GameDVR'
$configPath = 'HKCU:\\System\\GameConfigStore'
$capture = $null
$gameDvr = $null
if (Test-Path -LiteralPath $capturePath) {
  $capture = (Get-Item -LiteralPath $capturePath -ErrorAction Stop).GetValue('AppCaptureEnabled', $null)
}
if (Test-Path -LiteralPath $configPath) {
  $gameDvr = (Get-Item -LiteralPath $configPath -ErrorAction Stop).GetValue('GameDVR_Enabled', $null)
}
$values = @($capture, $gameDvr) | Where-Object { $null -ne $_ }
$state = if ($values.Count -eq 0) { 'System default' } elseif (@($values | Where-Object { [int]$_ -eq 0 }).Count -eq $values.Count) { 'Disabled' } elseif (@($values | Where-Object { [int]$_ -ne 0 }).Count -eq $values.Count) { 'Enabled' } else { 'Mixed' }
[pscustomobject]@{
  state = $state
  appCaptureEnabled = if ($null -eq $capture) { $null } else { [bool]([int]$capture -ne 0) }
  gameDvrEnabled = if ($null -eq $gameDvr) { $null } else { [bool]([int]$gameDvr -ne 0) }
} | ConvertTo-Json -Compress
`;

const PAGE_FILE_DIAGNOSTIC_SCRIPT = `
$system = Get-CimInstance -ClassName Win32_ComputerSystem -ErrorAction Stop
$settings = @(Get-CimInstance -ClassName Win32_PageFileSetting -ErrorAction SilentlyContinue | ForEach-Object {
  [pscustomobject]@{ name = [string]$_.Name; initialSizeMb = [int64]$_.InitialSize; maximumSizeMb = [int64]$_.MaximumSize }
})
$usage = @(Get-CimInstance -ClassName Win32_PageFileUsage -ErrorAction SilentlyContinue | ForEach-Object {
  [pscustomobject]@{ name = [string]$_.Name; allocatedBaseSizeMb = [int64]$_.AllocatedBaseSize; currentUsageMb = [int64]$_.CurrentUsage; peakUsageMb = [int64]$_.PeakUsage }
})
[pscustomobject]@{
  mode = if ([bool]$system.AutomaticManagedPagefile) { 'Automatic' } elseif ($settings.Count -gt 0 -or $usage.Count -gt 0) { 'Custom' } else { 'Disabled' }
  automaticManaged = [bool]$system.AutomaticManagedPagefile
  settings = @($settings)
  usage = @($usage)
} | ConvertTo-Json -Depth 4 -Compress
`;

const STORAGE_HEALTH_DIAGNOSTIC_SCRIPT = `
$items = @(Get-PhysicalDisk -ErrorAction Stop | ForEach-Object {
  [pscustomobject]@{
    friendlyName = [string]$_.FriendlyName
    mediaType = [string]$_.MediaType
    healthStatus = [string]$_.HealthStatus
    operationalStatus = [string](@($_.OperationalStatus) -join ', ')
    sizeBytes = [int64]$_.Size
  }
})
@($items) | ConvertTo-Json -Compress
`;

const NETWORK_DIAGNOSTIC_SCRIPT = `
$items = @(Get-NetAdapter -Physical -ErrorAction Stop | ForEach-Object {
  [pscustomobject]@{
    name = [string]$_.Name
    interfaceDescription = [string]$_.InterfaceDescription
    status = [string]$_.Status
    linkSpeed = [string]$_.LinkSpeed
  }
})
@($items) | ConvertTo-Json -Compress
`;

const SECURE_BOOT_DIAGNOSTIC_SCRIPT = `
try {
  $enabled = Confirm-SecureBootUEFI -ErrorAction Stop
  [pscustomobject]@{ state = if ($enabled) { 'Enabled' } else { 'Disabled' } } | ConvertTo-Json -Compress
} catch [System.PlatformNotSupportedException] {
  [pscustomobject]@{ evidenceStatus = 'UNSUPPORTED'; reason = 'Secure Boot is unavailable because Windows is not running in a supported UEFI mode.' } | ConvertTo-Json -Compress
} catch [System.UnauthorizedAccessException] {
  [pscustomobject]@{ evidenceStatus = 'PERMISSION_REQUIRED'; reason = 'Windows requires additional permission to read Secure Boot state.' } | ConvertTo-Json -Compress
}
`;

const TPM_DIAGNOSTIC_SCRIPT = `
$tpm = Get-Tpm -ErrorAction Stop
[pscustomobject]@{
  present = [bool]$tpm.TpmPresent
  ready = [bool]$tpm.TpmReady
  enabled = [bool]$tpm.TpmEnabled
  activated = [bool]$tpm.TpmActivated
  manufacturerVersion = [string]$tpm.ManufacturerVersion
} | ConvertTo-Json -Compress
`;

const VIRTUALIZATION_DIAGNOSTIC_SCRIPT = `
$computer = Get-CimInstance -ClassName Win32_ComputerSystem -ErrorAction Stop
$processors = @(Get-CimInstance -ClassName Win32_Processor -ErrorAction Stop)
[pscustomobject]@{
  hypervisorPresent = [bool]$computer.HypervisorPresent
  firmwareVirtualizationEnabled = if (@($processors).Count -gt 0) { [bool](@($processors | Where-Object { $_.VirtualizationFirmwareEnabled }).Count -eq @($processors).Count) } else { $null }
  secondLevelAddressTranslation = if (@($processors).Count -gt 0) { [bool](@($processors | Where-Object { $_.SecondLevelAddressTranslationExtensions }).Count -eq @($processors).Count) } else { $null }
} | ConvertTo-Json -Compress
`;

function runPowerShell(script, timeoutMs = POWERSHELL_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { windowsHide: true, env: windowsPowerShellEnvironment() }
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

function classifyEvidenceError(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (/access (?:is )?denied|unauthorized|permission|privilege/i.test(message)) {
    return 'PERMISSION_REQUIRED';
  }
  if (/not supported|unsupported|invalid class|not recognized as the name of a cmdlet/i.test(message)) {
    return 'UNSUPPORTED';
  }
  return 'UNKNOWN';
}

async function collectEvidence(component, source, read, normalize = (value) => value, errors = null) {
  try {
    const raw = await read();
    if (raw?.evidenceStatus && raw.evidenceStatus !== 'AVAILABLE') {
      return unavailableEvidence(raw.evidenceStatus, raw.reason, source);
    }
    const value = normalize(raw);
    if (value === undefined || value === null) throw new Error('The query returned no usable evidence.');
    return availableEvidence(value, source);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (Array.isArray(errors)) errors.push({ component, message });
    return unavailableEvidence(classifyEvidenceError(error), `${component}: ${message}`, source);
  }
}

async function getEvidence(component, source, script, normalize = (value) => value, errors = null) {
  return collectEvidence(component, source, async () => {
    const { stdout } = await runPowerShell(script);
    if (!stdout) throw new Error('The query returned no data.');
    return JSON.parse(stdout);
  }, normalize, errors);
}

function normalizeArray(value) {
  return (Array.isArray(value) ? value : [value]).filter((item) => item !== null && item !== undefined);
}

function asNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function requiredNumber(value, label, { positive = false } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number) || (positive ? number <= 0 : number < 0)) {
    throw new Error(`${label} was not returned as a ${positive ? 'positive' : 'non-negative'} number.`);
  }
  return number;
}

function normalizeSystemMetrics(value) {
  const totalBytes = requiredNumber(value?.totalBytes, 'Total physical memory', { positive: true });
  const freeBytes = requiredNumber(value?.freeBytes, 'Free physical memory');
  if (freeBytes > totalBytes) throw new Error('Free physical memory exceeded total physical memory.');
  return {
    os: {
      caption: String(value?.caption || 'Unavailable'),
      version: String(value?.version || 'Unavailable'),
      build: String(value?.build || 'Unavailable'),
      architecture: String(value?.architecture || 'Unavailable'),
    },
    memory: {
      totalBytes,
      freeBytes,
      loadPercentage: Math.round(((totalBytes - freeBytes) / totalBytes) * 100),
    },
  };
}

function normalizeCpuMetrics(value) {
  const name = String(value?.name || '').trim();
  if (!name) throw new Error('Processor name was not returned.');
  return {
    name,
    cores: requiredNumber(value?.cores, 'Processor core count', { positive: true }),
    logicalProcessors: requiredNumber(value?.logicalProcessors, 'Logical processor count', { positive: true }),
    maxClockSpeedMhz: requiredNumber(value?.maxClockSpeedMhz, 'Maximum processor clock', { positive: true }),
  };
}

function normalizeStorageMetrics(value) {
  const items = normalizeStorageInventory(value);
  for (const item of items) {
    if (item.totalBytes <= 0 || item.freeBytes < 0 || item.freeBytes > item.totalBytes) {
      throw new Error(`Storage capacity evidence for ${item.driveLetter}: was invalid.`);
    }
  }
  return items;
}

function getDeviceHash(machineGuid) {
  const source = typeof machineGuid === 'string' && machineGuid.trim() ? machineGuid.trim() : os.hostname();
  return crypto.createHash('sha256').update(source, 'utf8').digest('hex');
}

function startupItemId(item) {
  const stableTarget = item.source === 'Registry'
    ? `${item.registryPath || ''}\u0000${item.registryView || ''}\u0000${item.valueName || item.name}`
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
      registryView: STARTUP_REGISTRY_VIEWS.has(String(item.registryView || ''))
        ? String(item.registryView)
        : '',
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

function normalizeWindowsInventory(items) {
  return normalizeArray(items)
    .filter((item) => item && (item.name || item.displayName))
    .map((item) => ({
      name: String(item.name || '').trim(),
      displayName: String(item.displayName || '').trim(),
      state: String(item.state || 'Unknown').trim() || 'Unknown',
    }));
}

function inventoryItemMatches(item, definition, exactNameKey) {
  const name = item.name.toLowerCase();
  const displayName = item.displayName.toLowerCase();
  return definition[exactNameKey].includes(name) ||
    definition.namePrefixes.some((prefix) => name.startsWith(prefix)) ||
    definition.displayNames.some((candidate) => displayName.includes(candidate));
}

async function enumerateWindowsServices() {
  const { stdout } = await runPowerShell(WINDOWS_SERVICE_ENUMERATION_SCRIPT);
  if (!stdout) throw new Error('Windows service enumeration returned no data.');
  return normalizeWindowsInventory(JSON.parse(stdout));
}

async function enumerateWindowsDrivers() {
  const { stdout } = await runPowerShell(WINDOWS_DRIVER_ENUMERATION_SCRIPT);
  if (!stdout) throw new Error('Windows driver enumeration returned no data.');
  return normalizeWindowsInventory(JSON.parse(stdout));
}

/**
 * @typedef {Object} AntiCheatDetection
 * @property {string} product
 * @property {string} serviceName
 * @property {string} state
 * @property {boolean} driverPresent
 */

/**
 * @param {{listWindowsServices?: Function, listWindowsDrivers?: Function}} adapters
 * @returns {Promise<AntiCheatDetection[]>}
 */
async function detectInstalledAntiCheats(adapters = {}) {
  const listServices = adapters.listWindowsServices || enumerateWindowsServices;
  const listDrivers = adapters.listWindowsDrivers || enumerateWindowsDrivers;
  const [services, drivers] = await Promise.all([listServices(), listDrivers()]);
  const normalizedServices = normalizeWindowsInventory(services);
  const normalizedDrivers = normalizeWindowsInventory(drivers);

  return ANTI_CHEAT_PRODUCTS.flatMap((definition) => {
    const service = normalizedServices.find((item) => inventoryItemMatches(item, definition, 'serviceNames'));
    const driverPresent = normalizedDrivers.some((item) => inventoryItemMatches(item, definition, 'driverNames'));
    if (!service && !driverPresent) return [];
    return [{
      product: definition.product,
      serviceName: service?.name || '',
      state: service?.state || 'Unknown',
      driverPresent,
    }];
  });
}

async function getAntiCheatEvidence(adapters = {}) {
  const source = 'Win32_Service and Win32_SystemDriver';
  try {
    return availableEvidence(await detectInstalledAntiCheats(adapters), source);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return unavailableEvidence(classifyEvidenceError(error), `antiCheat: ${message}`, source);
  }
}

function normalizeProcessInventory(rawItems) {
  return (Array.isArray(rawItems) ? rawItems : [rawItems])
    .filter(isManageableProcess)
    .map((item) => ({
      pid: asNumber(item.pid),
      name: String(item.name).trim(),
      creationTime: /^\d+$/.test(String(item.creationTime || '')) ? String(item.creationTime) : null,
      cpuPercent: item.cpuPercent != null && Number.isFinite(Number(item.cpuPercent)) ? Math.max(0, Number(item.cpuPercent)) : null,
      workingSetBytes: Math.max(0, asNumber(item.workingSetBytes)),
      efficiencyMode: Boolean(item.efficiencyMode),
    }))
    .sort((left, right) => (right.cpuPercent ?? -1) - (left.cpuPercent ?? -1) || right.workingSetBytes - left.workingSetBytes || left.name.localeCompare(right.name))
    .slice(0, 30);
}

async function listStartupItems(adapters = {}) {
  const errors = [];
  const readStartupInventory = adapters.readStartupInventory || (() => getJson('startupItems', STARTUP_INVENTORY_SCRIPT, errors, []));
  const rawItems = await readStartupInventory();
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
    creationTime = $item.creationTime
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
      risk: 'Medium',
      enabled: Boolean(rawPolicy.enabled),
      keyExists: Boolean(rawPolicy.keyExists),
      valueExists: Boolean(rawPolicy.valueExists),
      value: rawPolicy.value === null || rawPolicy.value === undefined ? null : asNumber(rawPolicy.value),
      valueKind: rawPolicy.valueKind ? String(rawPolicy.valueKind) : null,
    }
    : null;
  return { items: policy ? [policy] : [], errors };
}

function normalizeStorageInventory(storage) {
  return (Array.isArray(storage) ? storage : [storage])
    .filter((item) => item && item.driveLetter)
    .map((item) => ({
      driveLetter: String(item.driveLetter).toUpperCase(),
      label: String(item.label || ''),
      totalBytes: asNumber(item.totalBytes),
      freeBytes: asNumber(item.freeBytes),
      isSSD: Boolean(item.isSSD),
      trimEnabled: Boolean(item.trimEnabled),
    }));
}

async function listStorageVolumes() {
  const errors = [];
  const rawItems = await getJson('storage', STORAGE_INVENTORY_SCRIPT, errors, []);
  return { items: normalizeStorageInventory(rawItems), errors };
}

async function createSystemScanSnapshot(adapters = {}) {
  const startedAt = Date.now();
  const errors = [];

  const [
    system,
    cpu,
    storage,
    startupInventory,
    tempFiles,
    machineGuid,
    elevated,
    graphics,
    motherboard,
    powerScheme,
    hardwareGpuScheduling,
    gameDvr,
    pageFile,
    storageHealth,
    networkAdapters,
    secureBoot,
    tpm,
    virtualization,
    antiCheat,
  ] = await Promise.all([
    getEvidence(
      'system',
      'Win32_OperatingSystem',
      "$os = Get-CimInstance -ClassName Win32_OperatingSystem -ErrorAction Stop; [pscustomobject]@{ caption = [string]$os.Caption; version = [string]$os.Version; build = [string]$os.BuildNumber; architecture = [string]$os.OSArchitecture; totalBytes = [int64]$os.TotalVisibleMemorySize * 1KB; freeBytes = [int64]$os.FreePhysicalMemory * 1KB } | ConvertTo-Json -Compress",
      normalizeSystemMetrics,
      errors,
    ),
    getEvidence(
      'cpu',
      'Win32_Processor',
      "$processors = @(Get-CimInstance -ClassName Win32_Processor -ErrorAction Stop); [pscustomobject]@{ name = [string]$processors[0].Name; cores = [int](@($processors | Measure-Object -Property NumberOfCores -Sum).Sum); logicalProcessors = [int](@($processors | Measure-Object -Property NumberOfLogicalProcessors -Sum).Sum); maxClockSpeedMhz = [int](@($processors | Measure-Object -Property MaxClockSpeed -Maximum).Maximum) } | ConvertTo-Json -Compress",
      normalizeCpuMetrics,
      errors,
    ),
    getEvidence(
      'storage',
      'Get-CimInstance Win32_LogicalDisk and Get-Partition/Get-Disk',
      STORAGE_INVENTORY_SCRIPT,
      normalizeStorageMetrics,
      errors,
    ),
    listStartupItems(),
    getJson(
      'tempFiles',
      createTempMaintenancePowerShellScript(false),
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
      WINDOWS_ELEVATION_POWERSHELL,
      errors,
      { elevated: false }
    ),
    getEvidence('graphics', 'Win32_VideoController', GRAPHICS_DIAGNOSTIC_SCRIPT, (value) => normalizeArray(value).map((item) => ({
      name: String(item.name || 'Name not returned'),
      driverVersion: String(item.driverVersion || 'Not returned'),
      status: String(item.status || 'Not returned'),
      adapterCompatibility: String(item.adapterCompatibility || 'Not returned'),
    }))),
    getEvidence('motherboard', 'Win32_BaseBoard', MOTHERBOARD_DIAGNOSTIC_SCRIPT, (value) => ({
      manufacturer: String(value.manufacturer || 'Not returned'),
      product: String(value.product || 'Not returned'),
    })),
    getEvidence('powerScheme', 'powercfg /getactivescheme', POWER_SCHEME_DIAGNOSTIC_SCRIPT, (value) => ({
      guid: String(value.guid || ''),
      name: String(value.name || ''),
    })),
    getEvidence('hardwareGpuScheduling', 'GraphicsDrivers HwSchMode', HAGS_DIAGNOSTIC_SCRIPT, (value) => ({
      state: String(value.state || 'Unknown value'),
      configuredValue: value.configuredValue === null || value.configuredValue === undefined ? null : asNumber(value.configuredValue),
    })),
    getEvidence('gameDvr', 'Current-user Game DVR Registry values', GAME_DVR_DIAGNOSTIC_SCRIPT, (value) => ({
      state: String(value.state || 'System default'),
      appCaptureEnabled: value.appCaptureEnabled === null || value.appCaptureEnabled === undefined ? null : Boolean(value.appCaptureEnabled),
      gameDvrEnabled: value.gameDvrEnabled === null || value.gameDvrEnabled === undefined ? null : Boolean(value.gameDvrEnabled),
    })),
    getEvidence('pageFile', 'Win32_ComputerSystem and page-file CIM classes', PAGE_FILE_DIAGNOSTIC_SCRIPT, (value) => ({
      mode: ['Automatic', 'Custom', 'Disabled'].includes(value.mode) ? value.mode : 'Unknown',
      automaticManaged: Boolean(value.automaticManaged),
      settings: normalizeArray(value.settings).map((item) => ({
        name: String(item.name || 'Not returned'),
        initialSizeMb: asNumber(item.initialSizeMb),
        maximumSizeMb: asNumber(item.maximumSizeMb),
      })),
      usage: normalizeArray(value.usage).map((item) => ({
        name: String(item.name || 'Not returned'),
        allocatedBaseSizeMb: asNumber(item.allocatedBaseSizeMb),
        currentUsageMb: asNumber(item.currentUsageMb),
        peakUsageMb: asNumber(item.peakUsageMb),
      })),
    })),
    getEvidence('storageHealth', 'Get-PhysicalDisk', STORAGE_HEALTH_DIAGNOSTIC_SCRIPT, (value) => normalizeArray(value).map((item) => ({
      friendlyName: String(item.friendlyName || 'Name not returned'),
      mediaType: String(item.mediaType || 'Unspecified'),
      healthStatus: String(item.healthStatus || 'Unknown'),
      operationalStatus: String(item.operationalStatus || 'Unknown'),
      sizeBytes: asNumber(item.sizeBytes),
    }))),
    getEvidence('networkAdapters', 'Get-NetAdapter -Physical', NETWORK_DIAGNOSTIC_SCRIPT, (value) => normalizeArray(value).map((item) => ({
      name: String(item.name || 'Name not returned'),
      interfaceDescription: String(item.interfaceDescription || 'Not returned'),
      status: String(item.status || 'Unknown'),
      linkSpeed: String(item.linkSpeed || 'Not returned'),
    }))),
    getEvidence('secureBoot', 'Confirm-SecureBootUEFI', SECURE_BOOT_DIAGNOSTIC_SCRIPT, (value) => ({
      state: value.state === 'Enabled' ? 'Enabled' : 'Disabled',
    })),
    getEvidence('tpm', 'Get-Tpm', TPM_DIAGNOSTIC_SCRIPT, (value) => ({
      present: Boolean(value.present),
      ready: Boolean(value.ready),
      enabled: Boolean(value.enabled),
      activated: Boolean(value.activated),
      manufacturerVersion: String(value.manufacturerVersion || 'Not returned'),
    })),
    getEvidence('virtualization', 'Win32_ComputerSystem and Win32_Processor', VIRTUALIZATION_DIAGNOSTIC_SCRIPT, (value) => ({
      hypervisorPresent: Boolean(value.hypervisorPresent),
      firmwareVirtualizationEnabled: value.firmwareVirtualizationEnabled === null || value.firmwareVirtualizationEnabled === undefined ? null : Boolean(value.firmwareVirtualizationEnabled),
      secondLevelAddressTranslation: value.secondLevelAddressTranslation === null || value.secondLevelAddressTranslation === undefined ? null : Boolean(value.secondLevelAddressTranslation),
    })),
    getAntiCheatEvidence(adapters),
  ]);

  errors.push(...startupInventory.errors);
  const normalizedStartup = startupInventory.items.map((item) => ({
    name: item.name,
    path: item.path,
    source: item.source,
    enabled: item.enabled,
  }));

  const snapshot = {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    timestamp: new Date().toISOString(),
    deviceHash: getDeviceHash(machineGuid.machineGuid),
    metrics: {
      os: {
        caption: system.status === 'AVAILABLE' ? system.value.os.caption : 'Unavailable',
        version: system.status === 'AVAILABLE' ? system.value.os.version : 'Unavailable',
        build: system.status === 'AVAILABLE' ? system.value.os.build : 'Unavailable',
        architecture: system.status === 'AVAILABLE' ? system.value.os.architecture : 'Unavailable',
      },
      cpu,
      memory: system.status === 'AVAILABLE'
        ? availableEvidence(system.value.memory, system.source)
        : unavailableEvidence(system.status, system.reason, system.source),
      storage,
      startupItems: normalizedStartup,
      tempFiles: {
        totalSizeBytes: asNumber(tempFiles.totalSizeBytes),
        pathCount: asNumber(tempFiles.pathCount),
      },
    },
    diagnostics: {
      graphics,
      motherboard,
      powerScheme,
      hardwareGpuScheduling,
      gameDvr,
      pageFile,
      storageHealth,
      networkAdapters,
      secureBoot,
      tpm,
      virtualization,
      antiCheat,
    },
    metadata: {
      executionTimeMs: Date.now() - startedAt,
      elevated: Boolean(elevated.elevated),
      errors,
    },
  };
  validateSystemScanSnapshot(snapshot);
  return snapshot;
}

module.exports = {
  ANTI_CHEAT_PROCESS_NAMES_BY_PRODUCT,
  ANTI_CHEAT_PRODUCTS,
  MANAGEABLE_STARTUP_REGISTRY_PATHS,
  PROTECTED_PROCESS_NAMES,
  POWER_SCHEME_DIAGNOSTIC_SCRIPT,
  PROCESS_INVENTORY_SCRIPT,
  STARTUP_REGISTRY_VIEWS,
  STARTUP_RUN_REGISTRY_PATHS,
  createEcoQosPowerShellScript,
  createSystemScanSnapshot,
  collectEvidence,
  detectInstalledAntiCheats,
  isManageableProcess,
  listManageableProcesses,
  listSafePolicies,
  listStorageVolumes,
  listStartupItems,
  normalizeStartupInventory,
  normalizeProcessInventory,
  runPowerShell,
};
