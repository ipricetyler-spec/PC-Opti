// Read-only SetupAPI inventory. No device changes, Registry writes or restart calls.
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;

namespace Dialed.HidusbfHelper {
  public sealed record FilterValue(bool Present, string[] Ordered);
  public sealed record InventoryDevice(string InstanceId, bool Present, FilterValue LowerFilters);

  public static class DeviceInventory {
    const uint AllClasses = 4, PresentOnly = 2;
    const int NoMoreItems = 259, InsufficientBuffer = 122, NotFound = 1168;
    [StructLayout(LayoutKind.Sequential)] struct PropertyKey { public Guid Category; public uint Id; }
    [StructLayout(LayoutKind.Sequential)] struct DeviceInfo {
      public uint Size; public Guid ClassGuid; public uint DevInst; public IntPtr Reserved;
    }
    [DllImport("setupapi.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern IntPtr SetupDiGetClassDevsW(IntPtr guid, string enumerator, IntPtr hwnd, uint flags);
    [DllImport("setupapi.dll", SetLastError = true)]
    static extern bool SetupDiEnumDeviceInfo(IntPtr set, uint index, ref DeviceInfo info);
    [DllImport("setupapi.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool SetupDiGetDeviceInstanceIdW(IntPtr set, ref DeviceInfo info, StringBuilder id, uint capacity, out uint needed);
    [DllImport("setupapi.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool SetupDiGetDevicePropertyW(IntPtr set, ref DeviceInfo info, ref PropertyKey property, out uint type, byte[] data, uint capacity, out uint needed, uint flags);
    [DllImport("setupapi.dll", SetLastError = true)]
    static extern bool SetupDiDestroyDeviceInfoList(IntPtr set);

    // Preserve the absent versus present-empty distinction and ordered entries.
    // Reject malformed data rather than normalizing it into a writable plan.
    public static FilterValue DecodeFilters(bool present, uint type, byte[] bytes) {
      if (!present) {
        if (bytes.Length != 0) throw new InvalidOperationException("Absent property contains data.");
        return new FilterValue(false, Array.Empty<string>());
      }
      if (type != 7 || bytes.Length < 4 || bytes.Length > 65536 || bytes.Length % 2 != 0)
        throw new InvalidOperationException("Unexpected lower-filter property representation.");
      string value;
      try { value = new UnicodeEncoding(false, false, true).GetString(bytes); }
      catch (DecoderFallbackException) { throw new InvalidOperationException("Invalid lower-filter encoding."); }
      if (!value.EndsWith("\0\0", StringComparison.Ordinal)) throw new InvalidOperationException("Unterminated lower-filter property.");
      string body = value.Substring(0, value.Length - 2);
      string[] entries = body.Length == 0 ? Array.Empty<string>() : body.Split('\0');
      if (entries.Any(x => x.Length == 0 || x.Length > 256 || x.Any(char.IsControl)) ||
          entries.Distinct(StringComparer.OrdinalIgnoreCase).Count() != entries.Length)
        throw new InvalidOperationException("Ambiguous lower-filter property.");
      return new FilterValue(true, entries);
    }

    static FilterValue ReadFilters(IntPtr set, ref DeviceInfo info, uint propertyId = 20) {
      var property = new PropertyKey { Category = new Guid("a45c254e-df1c-4efd-8020-67d146a850e0"), Id = propertyId };
      bool success = SetupDiGetDevicePropertyW(set, ref info, ref property, out uint type, null, 0, out uint needed, 0);
      int error = success ? 0 : Marshal.GetLastWin32Error();
      // Unified properties distinguish absent (NOT_FOUND) from invalid data.
      // The legacy Registry-property API conflates those outcomes.
      if (!success && error == NotFound) return DecodeFilters(false, 0, Array.Empty<byte>());
      if (success || error != InsufficientBuffer || needed < 4 || needed > 65536)
        throw new Win32Exception(error, "Cannot size lower-filter property completely.");
      var bytes = new byte[needed];
      if (!SetupDiGetDevicePropertyW(set, ref info, ref property, out type, bytes, needed, out uint actual, 0))
        throw new Win32Exception(Marshal.GetLastWin32Error(), "Cannot read lower-filter property completely.");
      if (actual != needed) throw new InvalidOperationException("Device property changed during inventory.");
      if (type != 0x2012) throw new InvalidOperationException("Lower-filter property must be a string list.");
      return DecodeFilters(true, 7, bytes);
    }

    static InventoryDevice[] Enumerate(bool presentOnly) {
      IntPtr set = SetupDiGetClassDevsW(IntPtr.Zero, null, IntPtr.Zero, AllClasses | (presentOnly ? PresentOnly : 0));
      if (set == new IntPtr(-1)) throw new Win32Exception(Marshal.GetLastWin32Error());
      try {
        var devices = new List<InventoryDevice>();
        var identities = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        for (uint index = 0; index < 65536; index++) {
          var info = new DeviceInfo { Size = (uint)Marshal.SizeOf<DeviceInfo>() };
          if (!SetupDiEnumDeviceInfo(set, index, ref info)) {
            int error = Marshal.GetLastWin32Error();
            if (error == NoMoreItems) return devices.ToArray();
            throw new Win32Exception(error, "Device inventory is incomplete.");
          }
          var id = new StringBuilder(4096);
          if (!SetupDiGetDeviceInstanceIdW(set, ref info, id, (uint)id.Capacity, out uint needed) || needed > id.Capacity)
            throw new Win32Exception(Marshal.GetLastWin32Error(), "Cannot read device identity.");
          string identity = id.ToString();
          if (identity.Length == 0 || !identities.Add(identity)) throw new InvalidOperationException("Ambiguous device inventory.");
          if (ReadFilters(set, ref info, 19).Ordered.Any(x => x.Equals("hidusbf", StringComparison.OrdinalIgnoreCase)))
            throw new InvalidOperationException("Unexpected HIDUSBF upper-filter attachment requires review.");
          devices.Add(new InventoryDevice(identity, presentOnly, ReadFilters(set, ref info)));
        }
        throw new InvalidOperationException("Device inventory limit exceeded.");
      } finally { SetupDiDestroyDeviceInfoList(set); }
    }

    public static InventoryDevice[] Merge(InventoryDevice[] all, InventoryDevice[] present) {
      var byId = new Dictionary<string, InventoryDevice>(StringComparer.OrdinalIgnoreCase);
      foreach (var device in all) if (!byId.TryAdd(device.InstanceId, device)) throw new InvalidOperationException("Duplicate installed device.");
      var presentIds = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
      foreach (var device in present) {
        if (!presentIds.Add(device.InstanceId) || !byId.TryGetValue(device.InstanceId, out var installed) ||
            device.LowerFilters.Present != installed.LowerFilters.Present ||
            !device.LowerFilters.Ordered.SequenceEqual(installed.LowerFilters.Ordered, StringComparer.Ordinal))
          throw new InvalidOperationException("Inventory changed between installed and present snapshots.");
      }
      return all.Select(x => x with { Present = presentIds.Contains(x.InstanceId) }).OrderBy(x => x.InstanceId, StringComparer.OrdinalIgnoreCase).ToArray();
    }

    public static InventoryDevice[] Read() {
      using (var machine = Microsoft.Win32.RegistryKey.OpenBaseKey(Microsoft.Win32.RegistryHive.LocalMachine, Microsoft.Win32.RegistryView.Registry64))
      using (var classes = machine.OpenSubKey(@"SYSTEM\CurrentControlSet\Control\Class", false)) {
        if (classes == null) throw new InvalidOperationException("Device class inventory unavailable.");
        foreach (string name in classes.GetSubKeyNames()) {
          using var entry = classes.OpenSubKey(name, false);
          if (entry == null) throw new InvalidOperationException("Device class inventory changed.");
          foreach (string property in new[] { "UpperFilters", "LowerFilters" }) {
            if (!entry.GetValueNames().Contains(property, StringComparer.OrdinalIgnoreCase)) continue;
            if (entry.GetValueKind(property) != Microsoft.Win32.RegistryValueKind.MultiString || entry.GetValue(property) is not string[] values)
              throw new InvalidOperationException("Unrecognized class filter inventory.");
            if (values.Any(x => x.Equals("hidusbf", StringComparison.OrdinalIgnoreCase))) throw new InvalidOperationException("HIDUSBF class-wide attachment requires review.");
          }
        }
      }
      // Never restrict the installed snapshot to DIGCF_PRESENT: phantom devices
      // retain filters and must participate in shared-service removal decisions.
      var first = Merge(Enumerate(false), Enumerate(true));
      var second = Merge(Enumerate(false), Enumerate(true));
      if (first.Length != second.Length || first.Where((x, i) =>
          !string.Equals(x.InstanceId, second[i].InstanceId, StringComparison.OrdinalIgnoreCase) ||
          x.Present != second[i].Present || x.LowerFilters.Present != second[i].LowerFilters.Present ||
          !x.LowerFilters.Ordered.SequenceEqual(second[i].LowerFilters.Ordered, StringComparer.Ordinal)).Any())
        throw new InvalidOperationException("Device inventory changed during observation.");
      return second;
    }
  }
}
