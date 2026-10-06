const { runPowerShell } = require('../scanner/index.cjs');

// Reads NVIDIA's global driver settings (the profile NVIDIA Control Panel's "Global Settings" tab
// edits) through NVIDIA's own driver interface, NVAPI. Read-only: no NVAPI function that writes is
// referenced. Each setting id below was confirmed by the installed driver returning its name.
// A setting the driver reports as not set means the driver uses its own default.
const SETTINGS = Object.freeze([
  Object.freeze({ id: 'gsync', nvId: 0x1194F158, label: 'G-SYNC', values: { 0: 'Off', 1: 'On for full screen', 2: 'On for full screen and windowed' }, unset: 'Not set (the driver decides with your monitor)' }),
  Object.freeze({ id: 'vsync', nvId: 0x00A879CF, label: 'Vertical sync', values: { 0x60925292: 'Use the 3D application setting', 0x08416747: 'Off', 0x47814940: 'On', 0x18888888: 'Fast' }, defaultValue: 0x60925292 }),
  Object.freeze({ id: 'frame-cap', nvId: 0x10835002, label: 'Max frame rate', format: (value) => (value === 0 ? 'Off' : `${value} FPS`), defaultValue: 0 }),
  Object.freeze({ id: 'low-latency', nvId: 0x007BA09E, label: 'Low latency mode (pre-rendered frames)', format: (value) => (value === 0 ? 'Off (the game decides)' : value === 1 ? 'On or Ultra (1 frame)' : `${value} frames`), defaultValue: 0 }),
  Object.freeze({ id: 'power', nvId: 0x1057EB71, label: 'Power management mode', values: { 0: 'Adaptive', 1: 'Prefer maximum performance', 2: 'Driver controlled', 3: 'Prefer consistent performance', 5: 'Normal' }, defaultValue: 5 }),
  Object.freeze({ id: 'shader-cache', nvId: 0x00AC8497, label: 'Shader cache size', format: (value) => (value === 0xFFFFFFFF ? 'Unlimited' : value === 0 ? 'Off' : value >= 1024 ? `${Math.round(value / 1024)} GB` : `${value} MB`) }),
  Object.freeze({ id: 'texture-quality', nvId: 0x00CE2691, label: 'Texture filtering quality', values: { 0xFFFFFFF6: 'High quality', 0: 'Quality', 0x0A: 'Performance', 0x14: 'High performance' }, defaultValue: 0 }),
  Object.freeze({ id: 'threaded', nvId: 0x20C1221E, label: 'Threaded optimization', values: { 0: 'Auto', 1: 'On', 2: 'Off' }, defaultValue: 0 }),
]);

const READER = `
using System;
using System.Runtime.InteropServices;
public static class DialedNvidiaRead {
  [DllImport("nvapi64.dll", EntryPoint = "nvapi_QueryInterface", CallingConvention = CallingConvention.Cdecl)] static extern IntPtr Query(uint id);
  [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate int NoArgs();
  [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate int CreateSession(out IntPtr session);
  [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate int SessionOnly(IntPtr session);
  [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate int GetProfile(IntPtr session, out IntPtr profile);
  [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate int GetSetting(IntPtr session, IntPtr profile, uint id, IntPtr setting);
  static T F<T>(uint id) { IntPtr p = Query(id); if (p == IntPtr.Zero) throw new InvalidOperationException("NVAPI function unavailable."); return (T)(object)Marshal.GetDelegateForFunctionPointer(p, typeof(T)); }
  // NVDRS_SETTING version 1: 12320 bytes; the current value is a 32-bit word at offset 8220.
  const int Size = 12320, Current = 8220, NotFound = -160;
  public static string Read(uint[] ids) {
    if (F<NoArgs>(0x0150E828)() != 0) return "{\\"available\\":false}";
    IntPtr session;
    if (F<CreateSession>(0x0694D52E)(out session) != 0) throw new InvalidOperationException("NVAPI session failed.");
    IntPtr buffer = Marshal.AllocHGlobal(Size);
    try {
      if (F<SessionOnly>(0x375DBD6B)(session) != 0) throw new InvalidOperationException("NVAPI settings did not load.");
      IntPtr profile;
      if (F<GetProfile>(0xDA8466A0)(session, out profile) != 0) throw new InvalidOperationException("NVAPI global profile unavailable.");
      GetSetting get = F<GetSetting>(0x73BF8338);
      var parts = new System.Collections.Generic.List<string>();
      foreach (uint id in ids) {
        for (int offset = 0; offset < Size; offset += 4) Marshal.WriteInt32(buffer, offset, 0);
        Marshal.WriteInt32(buffer, 0, 0x13020);
        int status = get(session, profile, id, buffer);
        if (status == 0) parts.Add("\\"" + id + "\\":" + (uint)Marshal.ReadInt32(buffer, Current));
        else if (status == NotFound) parts.Add("\\"" + id + "\\":null");
        else throw new InvalidOperationException("NVAPI read failed: " + status);
      }
      return "{\\"available\\":true,\\"settings\\":{" + string.Join(",", parts) + "}}";
    } finally { Marshal.FreeHGlobal(buffer); F<SessionOnly>(0xDAD9CFF8)(session); }
  }
}`;

function readerScript() {
  const source = Buffer.from(READER, 'utf8').toString('base64');
  const ids = SETTINGS.map((setting) => setting.nvId).join(',');
  // No nvapi64.dll means no NVIDIA driver: reported as unavailable, not as an error.
  return `& {
    if (-not (Test-Path -LiteralPath (Join-Path $env:WINDIR 'System32\\nvapi64.dll'))) { '{"available":false}'; return }
    Add-Type -TypeDefinition ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${source}'))) -ErrorAction Stop
    [DialedNvidiaRead]::Read([uint32[]]@(${ids}))
  }`;
}

function describeValue(setting, value) {
  if (value === null) return setting.unset ?? 'Not set (driver default)';
  if (setting.values) return setting.values[value] ?? `A value Dialed does not recognize (${value})`;
  return setting.format(value);
}

/** Rows for the page: the value in words and whether it differs from the driver default. */
function describeNvidiaSettings(raw) {
  if (!raw?.available) return { available: false, rows: [], notes: [] };
  const values = {};
  const rows = SETTINGS.map((setting) => {
    const stored = raw.settings?.[String(setting.nvId)];
    const value = Number.isInteger(stored) && stored >= 0 && stored <= 0xFFFFFFFF ? stored : null;
    values[setting.id] = value;
    const differs = value !== null && setting.defaultValue !== undefined && value !== setting.defaultValue;
    return { id: setting.id, label: setting.label, value: describeValue(setting, value), differs, defaultText: setting.defaultValue === undefined ? null : describeValue(setting, setting.defaultValue) };
  });
  return { available: true, rows, notes: notesFor(values) };
}

// Only combinations with documented, tested consequences; nothing about FPS.
function notesFor(values) {
  const notes = [];
  const gsyncOn = values.gsync === 1 || values.gsync === 2;
  if (gsyncOn && values.vsync === 0x08416747) notes.push('G-SYNC is on but vertical sync is forced off. When the frame rate reaches the refresh rate, G-SYNC stops working and tearing can return. Blur Busters testing recommends vertical sync On in NVIDIA Control Panel with G-SYNC.');
  if (gsyncOn && (values['frame-cap'] === null || values['frame-cap'] === 0)) notes.push('G-SYNC is on with no frame-rate cap here. A cap a few FPS below your refresh rate (in the game, or Max frame rate here) keeps G-SYNC active; many competitive games with NVIDIA Reflex cap automatically.');
  if (values.gsync === 0) notes.push('G-SYNC is off in the driver. Off is a common choice for competitive play at frame rates well above the refresh rate: lowest delay, with some tearing. On a G-SYNC monitor, turning it on in NVIDIA Control Panel › Set up G-SYNC trades a little delay for no tearing. Dialed does not read what your monitor supports.');
  if (values['shader-cache'] === 0) notes.push('The shader cache is off, so games compile shaders again each time, which can cause stutter.');
  return notes;
}

async function readNvidiaSettings(run = runPowerShell) {
  const { stdout } = await run(readerScript());
  const text = String(stdout).trim();
  let parsed;
  try { parsed = JSON.parse(text); } catch { throw new Error('Dialed could not read the NVIDIA driver settings. Nothing was changed.'); }
  return describeNvidiaSettings(parsed);
}

module.exports = { SETTINGS, READER, readerScript, describeNvidiaSettings, readNvidiaSettings };
