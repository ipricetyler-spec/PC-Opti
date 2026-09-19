const crypto = require('node:crypto');
const { runPowerShell } = require('../scanner/index.cjs');

// Read-only: EnumDisplayDevices + EnumDisplaySettings list the modes the driver
// currently offers. No ChangeDisplaySettings call exists in this module.
// https://learn.microsoft.com/windows/win32/api/winuser/nf-winuser-enumdisplaysettingsw
const DISPLAY_MODES_SCRIPT = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class DialedDisplayModes {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct DISPLAY_DEVICE {
    public int cb;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string DeviceName;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string DeviceString;
    public int StateFlags;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string DeviceID;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string DeviceKey;
  }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct DEVMODE {
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string dmDeviceName;
    public short dmSpecVersion; public short dmDriverVersion; public short dmSize; public short dmDriverExtra;
    public int dmFields; public int dmPositionX; public int dmPositionY; public int dmDisplayOrientation; public int dmDisplayFixedOutput;
    public short dmColor; public short dmDuplex; public short dmYResolution; public short dmTTOption; public short dmCollate;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string dmFormName;
    public short dmLogPixels; public int dmBitsPerPel; public int dmPelsWidth; public int dmPelsHeight; public int dmDisplayFlags; public int dmDisplayFrequency;
    public int dmICMMethod; public int dmICMIntent; public int dmMediaType; public int dmDitherType; public int dmReserved1; public int dmReserved2; public int dmPanningWidth; public int dmPanningHeight;
  }
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern bool EnumDisplayDevices(string lpDevice, uint iDevNum, ref DISPLAY_DEVICE lpDisplayDevice, uint dwFlags);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern bool EnumDisplaySettings(string deviceName, int modeNum, ref DEVMODE devMode);
}
"@
$displays = @()
for ($deviceIndex = 0; $deviceIndex -lt 16; $deviceIndex++) {
  $device = New-Object DialedDisplayModes+DISPLAY_DEVICE
  $device.cb = [Runtime.InteropServices.Marshal]::SizeOf($device)
  # [NullString]::Value, not $null: PowerShell turns $null into "" when calling a .NET
  # string parameter, and EnumDisplayDevices("") matches no device, so every display was lost.
  if (-not [DialedDisplayModes]::EnumDisplayDevices([NullString]::Value, [uint32]$deviceIndex, [ref]$device, 0)) { break }
  if (($device.StateFlags -band 1) -eq 0) { continue }
  $current = New-Object DialedDisplayModes+DEVMODE
  $current.dmSize = [int16][Runtime.InteropServices.Marshal]::SizeOf($current)
  if (-not [DialedDisplayModes]::EnumDisplaySettings($device.DeviceName, -1, [ref]$current)) { continue }
  $modes = @()
  for ($modeIndex = 0; $modeIndex -lt 4000; $modeIndex++) {
    $mode = New-Object DialedDisplayModes+DEVMODE
    $mode.dmSize = [int16][Runtime.InteropServices.Marshal]::SizeOf($mode)
    if (-not [DialedDisplayModes]::EnumDisplaySettings($device.DeviceName, $modeIndex, [ref]$mode)) { break }
    if ($mode.dmBitsPerPel -lt 24) { continue }
    $modes += [pscustomobject]@{ width = [int]$mode.dmPelsWidth; height = [int]$mode.dmPelsHeight; hz = [int]$mode.dmDisplayFrequency }
  }
  # Second, monitor-level enumeration. The adapter entry above describes the graphics
  # output; this describes the physical panel attached to it, and its DeviceID is the
  # only identifier here that survives a reconnect or a change in display order.
  $monitor = New-Object DialedDisplayModes+DISPLAY_DEVICE
  $monitor.cb = [Runtime.InteropServices.Marshal]::SizeOf($monitor)
  $monitorName = ''
  $monitorId = ''
  if ([DialedDisplayModes]::EnumDisplayDevices($device.DeviceName, 0, [ref]$monitor, 0)) {
    $monitorName = [string]$monitor.DeviceString
    $monitorId = [string]$monitor.DeviceID
  }
  $displays += [pscustomobject]@{
    deviceName = [string]$device.DeviceName
    adapter = [string]$device.DeviceString
    monitorName = $monitorName
    monitorId = $monitorId
    primary = (($device.StateFlags -band 4) -ne 0)
    currentWidth = [int]$current.dmPelsWidth
    currentHeight = [int]$current.dmPelsHeight
    currentHz = [int]$current.dmDisplayFrequency
    modes = @($modes)
  }
}
ConvertTo-Json -InputObject @($displays) -Depth 4 -Compress
`;

// A monitor DeviceID looks like MONITOR\GSM5B09\{guid}\0004 and can include a panel
// serial, so it is hashed rather than stored or shown. Equal monitors hash equally,
// which is all a saved baseline needs in order to match.
function monitorKey(deviceId) {
  const source = String(deviceId || '').trim();
  if (!source) return null;
  return crypto.createHash('sha256').update(source.toUpperCase(), 'utf8').digest('hex').slice(0, 16);
}

// Hz values of 0/1 mean "hardware default" and are ignored.
function refreshRate(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 1 && number < 1000 ? number : null;
}

function pixels(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 && number < 20_000 ? number : null;
}

// A mismatch is reported only when a meaningfully higher rate exists at the same resolution.
function classifyDisplayModes(rawDisplays) {
  const displays = (Array.isArray(rawDisplays) ? rawDisplays : [rawDisplays]).filter(Boolean);
  return displays.map((display, index) => {
    const currentWidth = pixels(display.currentWidth);
    const height = pixels(display.currentHeight);
    const currentHz = refreshRate(display.currentHz);
    const modes = (Array.isArray(display.modes) ? display.modes : []).filter((mode) => refreshRate(mode?.hz));
    const sameResolution = modes.filter((mode) => currentWidth !== null && Number(mode.width) === currentWidth && Number(mode.height) === height).map((mode) => Number(mode.hz));
    const maxAtCurrentResolution = sameResolution.length ? Math.max(...sameResolution) : null;
    const maxAnyResolution = modes.length ? Math.max(...modes.map((mode) => Number(mode.hz))) : null;
    let status = 'UNKNOWN';
    if (currentHz && maxAtCurrentResolution) {
      status = maxAtCurrentResolution - currentHz >= Math.max(10, currentHz * 0.05) ? 'HIGHER_RATE_AVAILABLE' : 'AT_HIGHEST_OFFERED';
    }
    return {
      label: `Display ${index + 1}`,
      // The Windows device name is positional and the Electron display id is transient,
      // so neither can key a saved baseline. The monitor DeviceID is EDID-derived and
      // survives reconnection and reordering, but can carry a panel serial, so only a
      // hash of it leaves this module. It is an equality key, never something to show.
      monitorKey: monitorKey(display.monitorId),
      monitorName: String(display.monitorName || '').slice(0, 160) || null,
      deviceName: String(display.deviceName || '').slice(0, 64) || null,
      primary: display.primary === true,
      adapter: String(display.adapter || '').slice(0, 160),
      currentWidth,
      currentHeight: height,
      currentHz,
      maxHzAtCurrentResolution: maxAtCurrentResolution,
      maxHzAnyResolution: maxAnyResolution,
      status,
    };
  });
}

async function readDisplayModes(run = runPowerShell) {
  const { stdout } = await run(DISPLAY_MODES_SCRIPT, 45_000);
  return { collectedAt: new Date().toISOString(), displays: classifyDisplayModes(JSON.parse(stdout || '[]')) };
}

module.exports = { DISPLAY_MODES_SCRIPT, classifyDisplayModes, readDisplayModes };
