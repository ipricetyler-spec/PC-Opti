using System;
using System.ComponentModel;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using Microsoft.Win32;
using Microsoft.Win32.SafeHandles;

namespace Dialed.HidusbfHelper {
  public sealed record DwordValue(bool Present, uint? Value);
  public sealed record PatchParameters(bool KeyPresent, DwordValue UsbXhci, DwordValue UsbPort);
  public sealed record ServiceConfiguration(uint Type, uint Start, uint ErrorControl, string ImagePath,
    string LoadOrderGroup, uint Tag, string[] Dependencies, string Account, string DisplayName, uint State);
  public sealed record DriverIdentity(string Sha256, string Variant);
  public sealed record ServiceObservation(ServiceConfiguration Service, bool ServiceKeyPresent,
    PatchParameters ServiceParameters, PatchParameters ControlParameters, DriverIdentity File);

  public static class ServiceInventory {
    public const string ImagePath = @"\SystemRoot\System32\drivers\hidusbf.sys";
    public static string DriverPath => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows), "System32", "drivers", "hidusbf.sys");
    [StructLayout(LayoutKind.Sequential)] struct Config {
      public uint Type, Start, ErrorControl; public IntPtr Image, Group; public uint Tag;
      public IntPtr Dependencies, Account, DisplayName;
    }
    [StructLayout(LayoutKind.Sequential)] struct Status { public uint Type, State, Controls, Win32Exit, ServiceExit, Checkpoint, WaitHint; }
    sealed class ServiceHandle : SafeHandleZeroOrMinusOneIsInvalid {
      public ServiceHandle() : base(true) { }
      protected override bool ReleaseHandle() => CloseServiceHandle(handle);
    }
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern ServiceHandle OpenSCManagerW(string machine, string database, uint access);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern ServiceHandle OpenServiceW(ServiceHandle manager, string service, uint access);
    [DllImport("advapi32.dll", SetLastError = true)] static extern bool CloseServiceHandle(IntPtr handle);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool QueryServiceConfigW(ServiceHandle service, IntPtr data, uint size, out uint needed);
    [DllImport("advapi32.dll", SetLastError = true)] static extern bool QueryServiceStatus(ServiceHandle service, out Status status);

    public static string RecognizeVariant(string hash) => hash switch {
      "2f82cdeb36bdaa42ea1933a9b11f3b8e1bdb28e6d3e3da7e65b4631b3375412d" => "NOPATCH",
      "81f649b34978fe9f74ce5c7c04ba24d5238faec6c70018f14da9423a46e6e04d" => "PATCH_1K",
      "e2c9fc626bb92d2219fbef3458014c198a3c90c563f948c9a433826e64d77e90" => "PATCH_2K_4K",
      "db73a8c259e16a0d02f138650497c1bdec81add66d928f3cf3ff39fad4eb421b" => "PATCH_4K_8K",
      _ => throw new InvalidOperationException("Unrecognized HIDUSBF file; preserve it for review.")
    };
    public static DwordValue DecodeDword(bool present, RegistryValueKind kind, object value) {
      if (!present) {
        if (value != null) throw new InvalidOperationException("Absent DWORD contains a value.");
        return new DwordValue(false, null);
      }
      if (kind != RegistryValueKind.DWord || value is not int number) throw new InvalidOperationException("Unexpected parameter Registry type.");
      return new DwordValue(true, unchecked((uint)number));
    }
    static DwordValue ReadDword(RegistryKey key, string name) {
      bool present = key != null && key.GetValueNames().Contains(name, StringComparer.OrdinalIgnoreCase);
      return present ? DecodeDword(true, key.GetValueKind(name), key.GetValue(name, null, RegistryValueOptions.DoNotExpandEnvironmentNames))
        : DecodeDword(false, RegistryValueKind.None, null);
    }
    static PatchParameters ReadParameters(RegistryKey machine, string path) {
      using var key = machine.OpenSubKey(path, false);
      return new PatchParameters(key != null, ReadDword(key, "PatchUSBXHCI"), ReadDword(key, "PatchUSBPort"));
    }
    public static void ValidateParameters(PatchParameters service, PatchParameters control) {
      foreach (var location in new[] { service, control }) {
        if (!location.KeyPresent && (location.UsbXhci.Present || location.UsbPort.Present) ||
            location.UsbXhci.Present && location.UsbXhci.Value > 3 || location.UsbPort.Present && location.UsbPort.Value > 1)
          throw new InvalidOperationException("Unrecognized upstream patch parameters.");
      }
      if (service.UsbXhci.Present && control.UsbXhci.Present && service.UsbXhci.Value != control.UsbXhci.Value ||
          service.UsbPort.Present && control.UsbPort.Present && service.UsbPort.Value != control.UsbPort.Value)
        throw new InvalidOperationException("Conflicting upstream parameter locations.");
    }
    static string ReadNativeString(IntPtr pointer, IntPtr buffer, uint bytes) {
      if (pointer == IntPtr.Zero) return "";
      long offset = pointer.ToInt64() - buffer.ToInt64();
      if (offset < 0 || offset >= bytes || offset % 2 != 0) throw new InvalidOperationException("Invalid service configuration pointer.");
      int maximum = checked((int)(bytes - offset) / 2);
      for (int i = 0; i < maximum; i++) if (Marshal.ReadInt16(pointer, i * 2) == 0) return Marshal.PtrToStringUni(pointer, i);
      throw new InvalidOperationException("Unterminated service configuration value.");
    }
    static ServiceConfiguration ReadService() {
      using var manager = OpenSCManagerW(null, null, 1);
      if (manager.IsInvalid) throw new Win32Exception(Marshal.GetLastWin32Error());
      using var service = OpenServiceW(manager, "hidusbf", 1 | 4);
      if (service.IsInvalid) {
        int error = Marshal.GetLastWin32Error();
        if (error == 1060) return null;
        throw new Win32Exception(error, "Cannot inspect HIDUSBF service.");
      }
      if (QueryServiceConfigW(service, IntPtr.Zero, 0, out uint needed) || Marshal.GetLastWin32Error() != 122 || needed < Marshal.SizeOf<Config>() || needed > 8192)
        throw new InvalidOperationException("Invalid service configuration size.");
      IntPtr buffer = Marshal.AllocHGlobal((int)needed);
      try {
        if (!QueryServiceConfigW(service, buffer, needed, out uint actual) || actual > needed) throw new Win32Exception(Marshal.GetLastWin32Error());
        var config = Marshal.PtrToStructure<Config>(buffer);
        string firstDependency = ReadNativeString(config.Dependencies, buffer, needed);
        // Exact upstream INF defines no dependencies. A nonempty list is refused
        // rather than interpreting or discarding a possibly altered MULTI_SZ.
        if (firstDependency.Length != 0) throw new InvalidOperationException("Unexpected HIDUSBF service dependencies.");
        if (!QueryServiceStatus(service, out var status)) throw new Win32Exception(Marshal.GetLastWin32Error());
        return new ServiceConfiguration(config.Type, config.Start, config.ErrorControl,
          ReadNativeString(config.Image, buffer, needed), ReadNativeString(config.Group, buffer, needed), config.Tag,
          Array.Empty<string>(), ReadNativeString(config.Account, buffer, needed), ReadNativeString(config.DisplayName, buffer, needed), status.State);
      } finally { Marshal.FreeHGlobal(buffer); }
    }
    public static void ValidateService(ServiceConfiguration service) {
      if (service == null) return;
      if (service.Type != 1 || service.Start != 3 || service.ErrorControl != 1 ||
          !(string.Equals(service.ImagePath, ImagePath, StringComparison.OrdinalIgnoreCase) || string.Equals(service.ImagePath, DriverPath, StringComparison.OrdinalIgnoreCase)) ||
          service.LoadOrderGroup.Length != 0 || service.Tag != 0 || service.Dependencies.Length != 0 || service.Account.Length != 0 ||
          service.State != 1 && service.State != 4)
        throw new InvalidOperationException("HIDUSBF service configuration or transitional state requires review.");
    }
    static DriverIdentity ReadFile() {
      string file = DriverPath;
      for (string item = file; !string.IsNullOrEmpty(item); item = Path.GetDirectoryName(item)) {
        try { if ((File.GetAttributes(item) & FileAttributes.ReparsePoint) != 0) throw new InvalidOperationException("Linked driver path refused."); }
        catch (FileNotFoundException) { if (item != file) throw; }
      }
      FileStream stream;
      try { stream = new FileStream(file, FileMode.Open, FileAccess.Read, FileShare.Read); }
      catch (FileNotFoundException) { return null; }
      using (stream) {
        string hash = Convert.ToHexString(SHA256.HashData(stream)).ToLowerInvariant();
        string variant = RecognizeVariant(hash);
        NativePeerIdentity.VerifyAuthenticode(file, stream.SafeFileHandle);
        return new DriverIdentity(hash, variant);
      }
    }
    public static ServiceObservation Read() {
      using var machine = RegistryKey.OpenBaseKey(RegistryHive.LocalMachine, RegistryView.Registry64);
      using var serviceKey = machine.OpenSubKey(@"SYSTEM\CurrentControlSet\Services\hidusbf", false);
      var service = ReadService(); ValidateService(service);
      var parameters = ReadParameters(machine, @"SYSTEM\CurrentControlSet\Services\hidusbf\Parameters");
      var legacy = ReadParameters(machine, @"SYSTEM\CurrentControlSet\Control\HIDUSBF");
      ValidateParameters(parameters, legacy);
      var file = ReadFile();
      if (service != null && (serviceKey == null || file == null)) throw new InvalidOperationException("HIDUSBF service/file inventory disagrees.");
      return new ServiceObservation(service, serviceKey != null, parameters, legacy, file);
    }
  }
}
