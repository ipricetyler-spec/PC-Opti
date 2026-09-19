using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using Microsoft.Win32;
using Microsoft.Win32.SafeHandles;

namespace Dialed.HidusbfHelper {
  // Instantiated only by the elevated native host after authenticated release and
  // peer checks. No method is invoked by the closed fixture executable.
  public sealed class WindowsMachine : ILifecycleMachine, IDeviceReconnectMachine {
    readonly string bundle;
    readonly Func<PlatformFacts, bool> acceptedPlatform;
    readonly Func<DeviceFacts, bool> acceptedDevice;
    readonly NativeDiagnostics diagnostics;
    readonly Dictionary<string, string> instanceIds = new Dictionary<string, string>();
    readonly Dictionary<string, string> interfaceIds = new Dictionary<string, string>();
    [StructLayout(LayoutKind.Sequential)] struct CiInformation { public uint Length, Options; }
    [StructLayout(LayoutKind.Sequential)] struct DeviceInfo { public uint Size; public Guid ClassGuid; public uint DevInst; public IntPtr Reserved; }
    [DllImport("ntdll.dll")] static extern int NtQuerySystemInformation(int information, ref CiInformation value, int size, out int returned);
    [DllImport("setupapi.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern IntPtr SetupDiGetClassDevsW(IntPtr guid, string enumerator, IntPtr window, uint flags);
    [DllImport("setupapi.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool SetupDiOpenDeviceInfoW(IntPtr set, string instance, IntPtr window, uint flags, ref DeviceInfo info);
    [DllImport("setupapi.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool SetupDiSetDeviceRegistryPropertyW(IntPtr set, ref DeviceInfo info, uint property, byte[] value, uint size);
    [DllImport("setupapi.dll")] static extern bool SetupDiDestroyDeviceInfoList(IntPtr set);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern IntPtr OpenSCManagerW(string machine, string database, uint access);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern IntPtr CreateServiceW(IntPtr manager, string name, string displayName, uint access, uint type, uint start, uint error, string binary, string group, IntPtr tag, string dependencies, string account, string password);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern IntPtr OpenServiceW(IntPtr manager, string service, uint access);
    [DllImport("advapi32.dll", SetLastError = true)] static extern bool DeleteService(IntPtr service);
    [DllImport("advapi32.dll")] static extern bool CloseServiceHandle(IntPtr service);

    public WindowsMachine(string verifiedBundleDirectory, Func<PlatformFacts, bool> acceptedPlatform, Func<DeviceFacts, bool> acceptedDevice, NativeDiagnostics diagnostics = null) {
      bundle = Path.GetFullPath(verifiedBundleDirectory);
      RefuseLinks(bundle);
      this.acceptedPlatform = acceptedPlatform ?? throw new ArgumentNullException(nameof(acceptedPlatform));
      this.acceptedDevice = acceptedDevice ?? throw new ArgumentNullException(nameof(acceptedDevice));
      this.diagnostics = diagnostics ?? new NativeDiagnostics();
    }
    public IDeviceReconnectWatch WatchReconnect(string instanceId) => new WindowsDeviceReconnectWatch(instanceId);
    static void RefuseLinks(string path) {
      for (string part = path; !string.IsNullOrEmpty(part); part = Path.GetDirectoryName(part))
        if ((File.GetAttributes(part) & FileAttributes.ReparsePoint) != 0) throw new InvalidOperationException("Linked path refused.");
    }
    static string ReadControlSet() {
      using var machine = RegistryKey.OpenBaseKey(RegistryHive.LocalMachine, RegistryView.Registry64);
      using var select = machine.OpenSubKey(@"SYSTEM\Select", false);
      if (select == null || select.GetValueKind("Current") != RegistryValueKind.DWord || select.GetValue("Current") is not int number || number < 1 || number > 999)
        throw new InvalidOperationException("Current control-set identity unavailable.");
      return "ControlSet" + number.ToString("D3", System.Globalization.CultureInfo.InvariantCulture);
    }
    static RegistryKey OpenDeviceKey(string instance, bool write, string controlSet) {
      if (!instance.StartsWith("USB\\", StringComparison.OrdinalIgnoreCase) || instance.Contains("..") || instance.Contains('/')) throw new InvalidOperationException("Unsupported device key.");
      using var machine = RegistryKey.OpenBaseKey(RegistryHive.LocalMachine, RegistryView.Registry64);
      return machine.OpenSubKey(@"SYSTEM\" + controlSet + @"\Enum\" + instance, write) ?? throw new InvalidOperationException("Device key disappeared.");
    }
    static string ReadDriverReference(RegistryKey key) {
      if (!key.GetValueNames().Contains("Driver", StringComparer.OrdinalIgnoreCase)) return null;
      if (key.GetValueKind("Driver") != RegistryValueKind.String || key.GetValue("Driver", null, RegistryValueOptions.DoNotExpandEnvironmentNames) is not string reference)
        throw new InvalidOperationException("Unknown device driver-key identity.");
      IntervalBinding.DriverKey(reference);
      return reference;
    }
    static (string InstanceId, string DriverKey)[] DriverOwners(InventoryDevice[] installed) {
      using var machine = RegistryKey.OpenBaseKey(RegistryHive.LocalMachine, RegistryView.Registry64);
      string controlSet = ReadControlSet();
      return installed.Select(device => {
        using var key = machine.OpenSubKey(@"SYSTEM\" + controlSet + @"\Enum\" + device.InstanceId, false)
          ?? throw new InvalidOperationException("Device key disappeared during coordinate inventory.");
        string reference = ReadDriverReference(key);
        return (device.InstanceId, reference == null ? null : IntervalBinding.DriverKey(reference, controlSet));
      }).ToArray();
    }
    static IntervalSnapshot ReadInterval(string instance) {
      string controlSet = ReadControlSet();
      using var hardware = OpenDeviceKey(instance, false, controlSet);
      using var parameters = hardware.OpenSubKey("Device Parameters", false);
      using var machine = RegistryKey.OpenBaseKey(RegistryHive.LocalMachine, RegistryView.Registry64);
      string driverPath = ReadDriverReference(hardware);
      using var driver = driverPath == null ? null : machine.OpenSubKey(IntervalBinding.DriverKey(driverPath, controlSet), false);
      var found = new List<IntervalSnapshot>();
      foreach (var entry in new[] { (hardware, "Hardware"), (parameters, "Parameters"), (driver, "Driver") }) {
        var key = entry.Item1;
        if (key != null && key.GetValueNames().Contains("bInterval", StringComparer.OrdinalIgnoreCase))
          found.Add(new IntervalSnapshot(ServiceInventory.DecodeDword(true, key.GetValueKind("bInterval"), key.GetValue("bInterval", null, RegistryValueOptions.DoNotExpandEnvironmentNames)),
            entry.Item2, IntervalBinding.Create(instance, entry.Item2, driverPath, controlSet)));
      }
      if (found.Count > 1) throw new InvalidOperationException("Ambiguous bInterval locations.");
      return found.Count == 1 ? found[0] : new IntervalSnapshot(new DwordValue(false, null), "Hardware", IntervalBinding.Create(instance, "Hardware", controlSet: controlSet));
    }
    string BootIdentity() {
      return diagnostics.At("OBSERVE_BOOT_SESSION", BootSessionIdentity.Read);
    }
    public LifecycleObservation Observe() {
      var installed = diagnostics.At("OBSERVE_INSTALLED_DEVICES", DeviceInventory.Read);
      // Include references from all installed devnodes, even non-input children
      // that are not returned as selectable physical scopes.
      var driverOwners = diagnostics.At("OBSERVE_INTERVAL_OWNERS", () => DriverOwners(installed));
      var details = diagnostics.At("OBSERVE_USB_DETAILS", () => Dialed.Input.Devices.Scan().ToDictionary(x => x.id, StringComparer.OrdinalIgnoreCase));
      var states = new List<DeviceSetting>(); instanceIds.Clear();
      foreach (var device in installed) {
        bool physicalUsb = ScopeDigests.IsPhysicalUsb(device.InstanceId);
        if (!physicalUsb && !device.LowerFilters.Ordered.Any(x => x.Equals("hidusbf", StringComparison.OrdinalIgnoreCase))) continue;
        string id = LifecycleSession.Digest(device.InstanceId.ToUpperInvariant()); instanceIds.Add(id, device.InstanceId);
        details.TryGetValue(device.InstanceId, out var detail);
        var scope = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { device.InstanceId };
        for (int pass = 0; pass < details.Count; pass++) {
          var children = details.Values.Where(x => scope.Contains(x.parent) && !scope.Contains(x.id)).Select(x => x.id).ToArray();
          if (children.Length == 0) break;
          foreach (string child in children) scope.Add(child);
        }
        var inputMembers = ScopeDigests.InputMembers(device.InstanceId, details.Values.Select(x => new KeyValuePair<string, string>(x.id, x.parent)));
        var inputKinds = details.Values.Where(x => inputMembers.Contains(x.id) && new[] { "MOUSE", "GAMEPAD", "JOYSTICK", "KEYBOARD" }.Contains(x.inputKind)).Select(x => x.inputKind).Distinct().ToArray();
        bool inputScope = inputKinds.Length > 0;
        bool eligible = physicalUsb && inputScope && detail != null && detail.present && detail.problem == 0 && (detail.speed == 1 || detail.speed == 2);
        string speed = detail?.speed == 1 ? "FULL" : detail?.speed == 2 ? "HIGH" : "UNKNOWN";
        var interval = physicalUsb ? diagnostics.At("OBSERVE_INTERVAL", () => ReadInterval(device.InstanceId)) : new IntervalSnapshot(new DwordValue(false, null), "Hardware", null);
        // The fingerprint names the complete physical USB scope, including child
        // interfaces; platform acceptance must review that whole scope.
        string interfaceDigest = ScopeDigests.Device(device.InstanceId, detail?.parent, detail?.location, speed, scope);
        interfaceIds[id] = interfaceDigest;
        states.Add(new DeviceSetting(id, interfaceDigest, device.Present, speed, eligible, device.LowerFilters, interval.Value, interval.Location, (detail?.name ?? "USB scope") + " · " + device.InstanceId, acceptedDevice(new DeviceFacts(interfaceDigest, device.InstanceId, speed, inputKinds)),
          interval.Coordinate, IntervalBinding.IsExclusive(interval.Coordinate, driverOwners)));
      }
      var ci = new CiInformation { Length = 8 };
      if (NtQuerySystemInformation(103, ref ci, 8, out int returned) != 0 || returned != 8) throw new InvalidOperationException("Code Integrity state unavailable.");
      using var machine = RegistryKey.OpenBaseKey(RegistryHive.LocalMachine, RegistryView.Registry64);
      using var secureBoot = machine.OpenSubKey(@"SYSTEM\CurrentControlSet\Control\SecureBoot\State", false);
      object secureBootValue = secureBoot?.GetValue("UEFISecureBootEnabled");
      bool securityKnown = secureBootValue is int value && (value == 0 || value == 1) && (ci.Options & 1) != 0 && (ci.Options & (2 | 0x20 | 0x40 | 0x80 | 0x800)) == 0;
      string platform = ScopeDigests.Platform(Environment.OSVersion.Version.ToString(), ci.Options, secureBootValue,
        HashSystemDriver("USBXHCI.SYS"), HashSystemDriver("USBPORT.SYS"),
        states.Where(x => x.Eligible).Select(x => x.InterfaceDigest));
      return new LifecycleObservation(diagnostics.At("OBSERVE_BOOT", BootIdentity), securityKnown && acceptedPlatform(new PlatformFacts(platform, Environment.OSVersion.Version.Build)), (ci.Options & 0x400) != 0,
        diagnostics.At("OBSERVE_SERVICE", ServiceInventory.Read), states.ToArray(), platform);
    }
    static string HashSystemDriver(string name) {
      string path = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows), "System32", "drivers", name);
      try { RefuseLinks(path); using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read); return Convert.ToHexString(SHA256.HashData(stream)).ToLowerInvariant(); }
      catch (FileNotFoundException) { return "ABSENT"; }
    }
    sealed class WindowsIntervalStore : IIntervalStore {
      public IntervalSnapshot Read(string instance) => ReadInterval(instance);
      public bool IsExclusive(IntervalCoordinate coordinate) => IntervalBinding.IsExclusive(coordinate, DriverOwners(DeviceInventory.Read()));
      public IIntervalValue Open(IntervalCoordinate coordinate) {
        using var machine = RegistryKey.OpenBaseKey(RegistryHive.LocalMachine, RegistryView.Registry64);
        return new WindowsIntervalValue(machine.OpenSubKey(coordinate.KeyPath, true)
          ?? throw new InvalidOperationException("Original interval key unavailable."));
      }
    }
    sealed class WindowsIntervalValue : IIntervalValue {
      readonly RegistryKey key;
      public WindowsIntervalValue(RegistryKey key) { this.key = key; }
      public DwordValue Read() {
        bool present = key.GetValueNames().Contains("bInterval", StringComparer.OrdinalIgnoreCase);
        return present ? ServiceInventory.DecodeDword(true, key.GetValueKind("bInterval"), key.GetValue("bInterval", null, RegistryValueOptions.DoNotExpandEnvironmentNames)) : new DwordValue(false, null);
      }
      public void Write(DwordValue value) {
        if (value.Present) key.SetValue("bInterval", unchecked((int)value.Value.Value), RegistryValueKind.DWord);
        else key.DeleteValue("bInterval", true);
        key.Flush();
      }
      public void Dispose() => key.Dispose();
    }
    static void WriteFilters(string instance, FilterValue filters) {
      IntPtr set = SetupDiGetClassDevsW(IntPtr.Zero, null, IntPtr.Zero, 4);
      if (set == new IntPtr(-1)) throw new Win32Exception(Marshal.GetLastWin32Error());
      try {
        var info = new DeviceInfo { Size = (uint)Marshal.SizeOf<DeviceInfo>() };
        if (!SetupDiOpenDeviceInfoW(set, instance, IntPtr.Zero, 0, ref info)) throw new Win32Exception(Marshal.GetLastWin32Error());
        byte[] bytes = filters.Present ? Encoding.Unicode.GetBytes(string.Join("\0", filters.Ordered) + "\0\0") : null;
        if (!SetupDiSetDeviceRegistryPropertyW(set, ref info, 18, bytes, (uint)(bytes?.Length ?? 0))) throw new Win32Exception(Marshal.GetLastWin32Error());
      } finally { SetupDiDestroyDeviceInfoList(set); }
    }
    void Install(string variant) {
      string directory = variant switch { "NOPATCH" => "NoPatch", "PATCH_1K" => "1khz", "PATCH_2K_4K" => "2khz-4khz", "PATCH_4K_8K" => "4khz-8khz", _ => throw new InvalidOperationException("Unknown variant.") };
      string source = Path.Combine(bundle, "payload", "DRIVER", "AMD64_AS", directory, "hidusbf.sys"); RefuseLinks(source);
      using var input = new FileStream(source, FileMode.Open, FileAccess.Read, FileShare.Read);
      if (Convert.ToHexString(SHA256.HashData(input)).ToLowerInvariant() != LifecycleSession.HashForVariant(variant)) throw new InvalidOperationException("Payload hash mismatch.");
      NativePeerIdentity.VerifyAuthenticode(source, input.SafeFileHandle); input.Position = 0;
      RefuseLinks(Path.GetDirectoryName(ServiceInventory.DriverPath));
      using (var output = new FileStream(ServiceInventory.DriverPath, FileMode.CreateNew, FileAccess.Write, FileShare.None, 4096, FileOptions.WriteThrough)) { input.CopyTo(output); output.Flush(true); }
      IntPtr manager = OpenSCManagerW(null, null, 2);
      if (manager == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
      try {
        IntPtr service = CreateServiceW(manager, "hidusbf", "USB Mouse Rate Adjuster Lower Filter by SweetLow", 1, 1, 3, 1, ServiceInventory.ImagePath, null, IntPtr.Zero, null, null, null);
        if (service == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
        CloseServiceHandle(service);
      } finally { CloseServiceHandle(manager); }
    }
    static void Remove(ServiceObservation service) {
      // Do not stop a loaded kernel service automatically. A reviewed manual boot
      // into the detached/stopped state must precede deletion.
      if (service.Service.State != 1) throw new InvalidOperationException("Owned service must be stopped after detachment before removal.");
      IntPtr manager = OpenSCManagerW(null, null, 1);
      if (manager == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
      try {
        IntPtr handle = OpenServiceW(manager, "hidusbf", 0x10000);
        if (handle == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
        try { if (!DeleteService(handle)) throw new Win32Exception(Marshal.GetLastWin32Error()); }
        finally { CloseServiceHandle(handle); }
      } finally { CloseServiceHandle(manager); }
      File.Delete(ServiceInventory.DriverPath);
    }
    public void Execute(NativePlan plan, LifecycleObservation before, Action assertPeer) {
      assertPeer();
      if (LifecycleSession.Digest(Observe()) != plan.BeforeDigest || LifecycleSession.Digest(before) != plan.BeforeDigest) throw new InvalidOperationException("Machine changed before execution.");
      LifecycleSession.ValidateLocalPlan(before, plan);
      string action = plan.Intent.Action;
      if (action == "INSTALL") { assertPeer(); Install(plan.Variant); }
      if (action == "INSTALL" || action == "APPLY" || action == "DETACH") {
        var old = before.Devices.Single(x => x.Id == plan.Intent.DeviceId);
        var next = plan.After.Devices.Single(x => x.Id == old.Id);
        string instance = instanceIds[old.Id];
        if (interfaceIds[old.Id] != plan.Intent.InterfaceDigest || old.Coordinate?.InstanceId != instance.ToUpperInvariant()) throw new InvalidOperationException("Interface or coordinate changed.");
        assertPeer();
        if (old.Interval != next.Interval) IntervalBinding.Write(new WindowsIntervalStore(), old, next, assertPeer);
        assertPeer();
        var currentFilters = DeviceInventory.Read().Single(x => x.InstanceId.Equals(instance, StringComparison.OrdinalIgnoreCase)).LowerFilters;
        if (LifecycleSession.Digest(currentFilters) != LifecycleSession.Digest(old.Filters)) throw new InvalidOperationException("Filters changed before write.");
        if (LifecycleSession.Digest(old.Filters) != LifecycleSession.Digest(next.Filters)) WriteFilters(instance, next.Filters);
      }
      if (action == "REMOVE") { assertPeer(); Remove(before.Service); }
      // ADOPT only persists ownership. REPAIR verifies the exact existing image;
      // it deliberately cannot overwrite unexpected bytes or configuration.
    }
  }
}
