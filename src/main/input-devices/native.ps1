# Invoked only by the main process with a fixed mode, base64 JSON, and digest-verified C# bytes, never a renderer command.
$ErrorActionPreference = 'Stop'
try {
  $DialedInputSourceBytes = [Convert]::FromBase64String([string]$DialedInputSourceBase64)
  if ($DialedInputSourceBytes.Length -lt 1 -or $DialedInputSourceBytes.Length -gt 65536) { throw 'invalid source size' }
  $DialedStrictUtf8 = [System.Text.UTF8Encoding]::new($false, $true)
  $DialedInputSource = $DialedStrictUtf8.GetString($DialedInputSourceBytes)
} catch {
  throw 'Input Devices native support failed its in-memory source validation.'
}
Add-Type -TypeDefinition $DialedInputSource -ReferencedAssemblies System.Windows.Forms,System.Drawing
Add-Type -AssemblyName System.ServiceProcess
function Assert-LegacyRestoreAuthority {
  $commonData = [Environment]::GetFolderPath([Environment+SpecialFolder]::CommonApplicationData)
  if ([string]::IsNullOrWhiteSpace($commonData)) { throw 'Native recovery location unavailable. Legacy restore blocked.' }
  $nativeDirectory = [IO.Path]::Combine($commonData,'Dialed','HidusbfLifecycle')
  $currentPath = $nativeDirectory; $nativePresent = $false
  while ($currentPath) {
    try {
      $attributes = [IO.File]::GetAttributes($currentPath)
      if (($attributes -band [IO.FileAttributes]::ReparsePoint) -or -not ($attributes -band [IO.FileAttributes]::Directory)) { throw 'Linked or unexpected native recovery path. Legacy restore blocked.' }
      if ($currentPath -eq $nativeDirectory) { $nativePresent = $true }
    } catch [IO.FileNotFoundException] { } catch [IO.DirectoryNotFoundException] { }
    $currentPath = [IO.Path]::GetDirectoryName($currentPath)
  }
  if ($nativePresent) { throw 'Native machine history is reserved. Legacy restore is blocked; do not delete history to enable it.' }
}
$DialedDriverProfiles = @{
  '2f82cdeb36bdaa42ea1933a9b11f3b8e1bdb28e6d3e3da7e65b4631b3375412d' = @{ mode='NoPatch'; defaultPatchUsbXhci=0 }
  '81f649b34978fe9f74ce5c7c04ba24d5238faec6c70018f14da9423a46e6e04d' = @{ mode='Patching'; defaultPatchUsbXhci=1 }
  'e2c9fc626bb92d2219fbef3458014c198a3c90c563f948c9a433826e64d77e90' = @{ mode='Patching'; defaultPatchUsbXhci=2 }
  'db73a8c259e16a0d02f138650497c1bdec81add66d928f3cf3ff39fad4eb421b' = @{ mode='Patching'; defaultPatchUsbXhci=3 }
}
function Read-PatchLocation([string]$registryPath) {
  $result = @{ keyExists=$false; valueExists=$false; kind=''; value=$null }
  $key = [Microsoft.Win32.Registry]::LocalMachine.OpenSubKey($registryPath)
  if (-not $key) { return $result }
  $result.keyExists = $true
  try {
    $name = @($key.GetValueNames() | Where-Object { $_ -ieq 'PatchUSBXHCI' } | Select-Object -First 1)
    if ($name.Count -eq 1) {
      $result.valueExists = $true
      $result.kind = $key.GetValueKind($name[0]).ToString()
      $raw = $key.GetValue($name[0],$null,[Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
      if ($raw -is [int]) { $result.value = [int]$raw }
    }
  } finally { $key.Dispose() }
  return $result
}
function Same-PatchLocation($actual,$expected) {
  if ($null -eq $expected) { return $false }
  if ([bool]$actual.keyExists -ne [bool]$expected.keyExists -or [bool]$actual.valueExists -ne [bool]$expected.valueExists) { return $false }
  if ([bool]$actual.valueExists) {
    if ([string]$actual.kind -cne [string]$expected.kind) { return $false }
    if ($actual.value -ne $expected.value) { return $false }
  }
  return $true
}
function Driver-State {
  $result = @{ state='Missing'; hash=''; signature='Unknown'; mode='Unknown'; patchUsbXhci=-1; patchSource='Unknown'; patchLocations=@{ servicesParameters=(Read-PatchLocation 'SYSTEM\CurrentControlSet\Services\HIDUSBF\Parameters'); legacyControl=(Read-PatchLocation 'SYSTEM\CurrentControlSet\Control\HIDUSBF') } }
  $service = [System.ServiceProcess.ServiceController]::GetDevices() | Where-Object { $_.ServiceName -eq 'hidusbf' } | Select-Object -First 1
  if (-not $service) { return $result }
  try { $result.state = $service.Status.ToString() } finally { $service.Dispose() }
  $key = [Microsoft.Win32.Registry]::LocalMachine.OpenSubKey('SYSTEM\CurrentControlSet\Services\hidusbf')
  if (-not $key) { return $result }
  try { $image = [string]$key.GetValue('ImagePath'); $type = $key.GetValue('Type') } finally { $key.Dispose() }
  $expected = [IO.Path]::Combine([Environment]::GetFolderPath('Windows'),'System32\drivers\hidusbf.sys')
  $image = [Environment]::ExpandEnvironmentVariables($image).Trim('"')
  if ($image.StartsWith('\SystemRoot\',[StringComparison]::OrdinalIgnoreCase)) { $image = [IO.Path]::Combine([Environment]::GetFolderPath('Windows'),$image.Substring(12)) }
  if ($image.StartsWith('system32\',[StringComparison]::OrdinalIgnoreCase)) { $image = [IO.Path]::Combine([Environment]::GetFolderPath('Windows'),$image) }
  if ($image -ine $expected -or $type -ne 1 -or -not [IO.File]::Exists($expected)) { $result.state='Unrecognized'; return $result }
  if ((Get-Item -LiteralPath $expected).Attributes -band [IO.FileAttributes]::ReparsePoint) { $result.state='Unrecognized'; return $result }
  $result.hash = (Get-FileHash -LiteralPath $expected -Algorithm SHA256).Hash.ToLowerInvariant()
  $signature = Get-AuthenticodeSignature -LiteralPath $expected
  if ($signature.Status -eq 'Valid' -and $signature.SignerCertificate.Subject -match '^CN=Microsoft Windows Hardware Compatibility Publisher,') { $result.signature='ValidMicrosoft' }
  $profile = $DialedDriverProfiles[$result.hash]
  if ($profile) {
    $result.mode = $profile.mode
    $result.patchUsbXhci = $profile.defaultPatchUsbXhci
    $result.patchSource = 'Driver default'
    $values = @(); $invalid = $false
    foreach($location in @($result.patchLocations.servicesParameters,$result.patchLocations.legacyControl)) {
      if (-not $location.valueExists) { continue }
      if ($location.kind -eq 'DWord' -and $location.value -is [int] -and $location.value -ge 0 -and $location.value -le 3) { $values += [int]$location.value } else { $invalid = $true }
    }
    $unique = @($values | Select-Object -Unique)
    if ($invalid -or $unique.Count -gt 1) { $result.patchUsbXhci=-1; $result.patchSource='Ambiguous registry override' }
    elseif ($unique.Count -eq 1) { $result.patchUsbXhci=$unique[0]; $result.patchSource='Registry override' }
  }
  return $result
}
$DialedBootId = ''
try {
  $os = Get-CimInstance -ClassName Win32_OperatingSystem -Property LastBootUpTime -ErrorAction Stop
  $DialedBootId = ([DateTime]$os.LastBootUpTime).ToUniversalTime().ToString('o')
} catch {}
$DialedMemoryIntegrity = 'Unknown'
try {
  $guard = Get-CimInstance -Namespace 'root\Microsoft\Windows\DeviceGuard' -ClassName Win32_DeviceGuard -ErrorAction Stop
  $running = @($guard.SecurityServicesRunning); $configured = @($guard.SecurityServicesConfigured)
  if ($running -contains 2) { $DialedMemoryIntegrity = 'Enabled' }
  elseif ($configured -contains 2) { $DialedMemoryIntegrity = 'Configured' }
  else { $DialedMemoryIntegrity = 'Disabled' }
} catch {}
$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
switch ($DialedInputMode) {
  'Scan' {
    @{ nodes=@([Dialed.Input.Devices]::Scan()); driver=(Driver-State); elevated=$admin; bootId=$DialedBootId; security=@{ memoryIntegrity=$DialedMemoryIntegrity } } | ConvertTo-Json -Depth 10 -Compress
  }
  'Change' {
    if (-not $admin) { throw 'Administrator access is unavailable in this session; the packaged Dialed app requests it at launch.' }
    $request = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($DialedInputPayload)) | ConvertFrom-Json
    if ($request.id -notmatch '^USB\\VID_[0-9A-F]{4}&PID_[0-9A-F]{4}\\[^\\]{1,240}$') { throw 'Invalid physical USB device identifier.' }
    $driver = Driver-State
    $profile = $DialedDriverProfiles[$driver.hash]
    if ($driver.state -ne 'Running' -or $driver.signature -ne 'ValidMicrosoft' -or -not $profile -or $driver.hash -ne $request.driverHash) { throw 'An exact running, verified HIDUSBF build is required; no driver is installed or replaced.' }
    $device = @([Dialed.Input.Devices]::Scan() | Where-Object { $_.id -eq $request.id })
    if ($device.Count -ne 1 -or $device[0].speed -notin @(1,2) -or $device[0].speed -ne [int]$request.speed -or $device[0].location -ne $request.location) { throw 'Device is no longer at the verified Full-Speed or High-Speed USB connection.' }
    if ($request.action -notin @('APPLY','RESTORE')) { throw 'Unsupported polling action.' }
    $before = [int]$request.before; $after = [int]$request.after; $expectedRate = 0
    if ($device[0].speed -eq 1) {
      if ($before -notin @(1,2,4,8) -or $after -notin @(1,2,4,8)) { throw 'Unsupported Full-Speed interval.' }
      $expectedRate = [int](1000 / $after)
    } else {
      if ($driver.mode -ne 'Patching' -or $driver.patchUsbXhci -notin @(0,1,2,3)) { throw 'High-Speed changes require an exact patching tier with an unambiguous xHCI capability.' }
      if ($before -notin @(1,2,3,4) -or $after -notin @(1,2,3,4)) { throw 'Unsupported High-Speed interval.' }
      $expectedRate = [int](8000 / [Math]::Pow(2,$after-1))
      $ceiling = if($driver.patchUsbXhci -eq 2){4000}elseif($driver.patchUsbXhci -eq 3){8000}else{1000}
      if ($request.action -ne 'RESTORE' -and $expectedRate -gt $ceiling) { throw 'The installed xHCI patch tier does not support that requested rate.' }
    }
    if ([int]$request.rate -ne $expectedRate) { throw 'Requested rate does not match the speed-specific interval.' }
    if ($request.action -eq 'RESTORE') { Assert-LegacyRestoreAuthority }
    [Dialed.Input.Devices]::ChangeExistingInterval($request.id,$request.location,$request.key,[int]$request.before,[int]$request.after)
    @{ status='CONFIGURED'; reconnectRequired=$true } | ConvertTo-Json -Compress
  }
  'TierChange' {
    if (-not $admin) { throw 'Administrator access is unavailable in this session; the packaged Dialed app requests it at launch.' }
    $request = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($DialedInputPayload)) | ConvertFrom-Json
    if ($request.action -notin @('ENABLE','RESTORE')) { throw 'Unsupported global tier action.' }
    if ([string]::IsNullOrWhiteSpace([string]$request.expectedBootId) -or [string]$request.expectedBootId -cne $DialedBootId) { throw 'Windows boot-session evidence changed after preview.' }
    if ($request.action -eq 'ENABLE' -and $DialedMemoryIntegrity -ne 'Disabled') { throw 'Memory Integrity must be explicitly observed disabled; Dialed will not weaken Windows security.' }
    $driver = Driver-State; $profile = $DialedDriverProfiles[$driver.hash]
    if ($driver.signature -ne 'ValidMicrosoft' -or -not $profile -or $profile.mode -ne 'Patching' -or $driver.hash -ne $request.driverHash -or $driver.state -in @('Missing','Unrecognized')) { throw 'An exact verified HIDUSBF patching build is required; no driver is installed or replaced.' }
    if ($request.action -eq 'ENABLE' -and $driver.state -ne 'Running') { throw 'The exact verified HIDUSBF patching driver must be running before enabling a higher tier.' }
    $canonicalPath = 'SYSTEM\CurrentControlSet\Services\HIDUSBF\Parameters'
    $legacyPath = 'SYSTEM\CurrentControlSet\Control\HIDUSBF'
    $before = Read-PatchLocation $canonicalPath; $legacy = Read-PatchLocation $legacyPath
    if (-not (Same-PatchLocation $before $request.beforeCanonical) -or -not (Same-PatchLocation $legacy $request.legacyPatch)) { throw 'Global tier registry state changed after preview.' }
    if ($legacy.valueExists) { throw 'A legacy global tier value is present; a second value will not be created.' }
    $service = [Microsoft.Win32.Registry]::LocalMachine.OpenSubKey('SYSTEM\CurrentControlSet\Services\HIDUSBF',$true)
    if (-not $service) { throw 'The verified HIDUSBF service key is unavailable.' }
    try {
      if ($request.action -eq 'RESTORE') { Assert-LegacyRestoreAuthority }
      $parameters = $service.OpenSubKey('Parameters',$true)
      try {
        if ($request.afterCanonical.valueExists) {
          if ([string]$request.afterCanonical.kind -cne 'DWord' -or $request.afterCanonical.value -notin @(0,1,2,3)) { throw 'The requested global tier value is invalid.' }
          if (-not $parameters) { $parameters = $service.CreateSubKey('Parameters',[Microsoft.Win32.RegistryKeyPermissionCheck]::ReadWriteSubTree) }
          $parameters.SetValue('PatchUSBXHCI',[int]$request.afterCanonical.value,[Microsoft.Win32.RegistryValueKind]::DWord); $parameters.Flush()
        } else {
          if (-not $parameters) { throw 'The global tier value disappeared before restore.' }
          $parameters.DeleteValue('PatchUSBXHCI',$false); $parameters.Flush()
        }
      } finally { if ($parameters) { $parameters.Dispose() } }
      if (-not $request.afterCanonical.keyExists) {
        $check = $service.OpenSubKey('Parameters',$false)
        try {
          if ($check -and $check.GetValueNames().Count -eq 0 -and $check.GetSubKeyNames().Count -eq 0) { $check.Dispose(); $check=$null; $service.DeleteSubKey('Parameters',$false) }
        } finally { if ($check) { $check.Dispose() } }
      }
    } finally { $service.Dispose() }
    $after = Read-PatchLocation $canonicalPath; $legacyAfter = Read-PatchLocation $legacyPath
    if (-not (Same-PatchLocation $after $request.afterCanonical) -or -not (Same-PatchLocation $legacyAfter $request.legacyPatch)) { throw 'Global tier registry readback failed.' }
    @{ status='CONFIGURED'; rebootRequired=$true; driver=(Driver-State) } | ConvertTo-Json -Depth 8 -Compress
  }
  'Test' {
    $request = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($DialedInputPayload)) | ConvertFrom-Json
    $nodes = @([Dialed.Input.Devices]::Scan())
    $target = @($nodes | Where-Object { $_.id -eq $request.id -and $_.present })
    if ($target.Count -ne 1) { throw 'Selected input device disconnected. Rescan first.' }
    $map = @{}; foreach($node in $nodes) { $map[$node.id] = $node }
    $ids = @($nodes | Where-Object {
      if ($_.id -notlike 'HID\*') { return $false }
      $current = $_.id; $seen = @{}
      for($depth=0;$depth -lt 32;$depth++) {
        if($current -eq $request.id) { return $true }
        if(-not $map.ContainsKey($current) -or $seen.ContainsKey($current)) { return $false }
        $seen[$current]=$true; $current=$map[$current].parent
      }
      return $false
    } | ForEach-Object { $_.id })
    if($ids.Count -eq 0) { throw 'This device exposes no supported mouse, keyboard, or game-controller Raw Input channel.' }
    $captured = @([Dialed.Input.TimingWindow]::CaptureEvents([string[]]$ids))
    $channels = @($captured | ForEach-Object {
      $source = $map[$_.id]
      $kind = if($_.keyboard){'KEYBOARD'}elseif($source){[string]$source.inputKind}else{'INPUT'}
      if($kind -eq 'KEYBOARD') { @{ kind=$kind; messageCount=$_.messageCount; spanMs=$_.spanMs; activity=$_.activity } }
      else { @{ kind=$kind; timesMs=@($_.timesMs); motionTimesMs=@($_.motionTimesMs); activity=$_.activity; hidReports=$_.hidReports; firstHidReports=$_.firstHidReports } }
    })
    @{ channels=$channels; durationMs=8000; activityVersion=1 } | ConvertTo-Json -Depth 5 -Compress
  }
  default { throw 'Unsupported input-device operation.' }
}
