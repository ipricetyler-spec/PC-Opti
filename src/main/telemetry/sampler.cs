// Dialed hardware-reading sampler. Read-only: PDH performance counters queried with
// English counter names (PdhAddEnglishCounter), DXGI adapter enumeration, the target
// process start time, and (when enabled and signature-verified by the caller) NVIDIA's
// own NVML driver library for GPU temperature, power, clock and slowdown reasons.
// It never changes Windows, driver, device, fan, power-limit or counter-logging state.
// https://learn.microsoft.com/windows/win32/api/pdh/nf-pdh-pdhaddenglishcounterw
// https://learn.microsoft.com/windows/win32/api/pdh/nf-pdh-pdhgetformattedcounterarrayw
// https://learn.microsoft.com/windows/win32/api/dxgi/nf-dxgi-idxgifactory1-enumadapters1
// https://docs.nvidia.com/deploy/nvml-api/group__nvmlDeviceQueries.html
using System;
using System.Diagnostics;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

[ComImport, Guid("770aae78-f26f-4dba-a829-253c83d1b387"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IDialedDxgiFactory1 {
  // IDXGIObject and IDXGIFactory slots are declared only to keep the vtable order.
  void SetPrivateData(); void SetPrivateDataInterface(); void GetPrivateData(); void GetParent();
  void EnumAdapters(); void MakeWindowAssociation(); void GetWindowAssociation(); void CreateSwapChain(); void CreateSoftwareAdapter();
  [PreserveSig] int EnumAdapters1(uint index, out IDialedDxgiAdapter1 adapter);
}

[ComImport, Guid("29038f61-3839-4626-91fd-086879011a05"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IDialedDxgiAdapter1 {
  void SetPrivateData(); void SetPrivateDataInterface(); void GetPrivateData(); void GetParent();
  void EnumOutputs(); void GetDesc(); void CheckInterfaceSupport();
  [PreserveSig] int GetDesc1(out DialedAdapterDesc1 desc);
}

[StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
public struct DialedAdapterDesc1 {
  [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string Description;
  public uint VendorId; public uint DeviceId; public uint SubSysId; public uint Revision;
  public UIntPtr DedicatedVideoMemory; public UIntPtr DedicatedSystemMemory; public UIntPtr SharedSystemMemory;
  public uint LuidLow; public int LuidHigh; public uint Flags;
}

// nvmlPciInfo_t (v3): busIdLegacy[16], domain, bus, device, pciDeviceId, pciSubSystemId, busId[32].
[StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)]
public struct DialedNvmlPciInfo {
  [MarshalAs(UnmanagedType.ByValArray, SizeConst = 16)] public byte[] BusIdLegacy;
  public uint Domain; public uint Bus; public uint Device; public uint PciDeviceId; public uint PciSubSystemId;
  [MarshalAs(UnmanagedType.ByValArray, SizeConst = 32)] public byte[] BusId;
}

public static class DialedTelemetry {
  [DllImport("pdh.dll", CharSet = CharSet.Unicode)] static extern uint PdhOpenQuery(string dataSource, IntPtr userData, out IntPtr query);
  [DllImport("pdh.dll", CharSet = CharSet.Unicode)] static extern uint PdhAddEnglishCounter(IntPtr query, string path, IntPtr userData, out IntPtr counter);
  [DllImport("pdh.dll")] static extern uint PdhCollectQueryData(IntPtr query);
  [DllImport("pdh.dll", CharSet = CharSet.Unicode)] static extern uint PdhGetFormattedCounterArray(IntPtr counter, uint format, ref uint bufferSize, out uint itemCount, IntPtr buffer);
  [DllImport("pdh.dll")] static extern uint PdhCloseQuery(IntPtr query);
  [DllImport("dxgi.dll")] static extern int CreateDXGIFactory1(ref Guid riid, [MarshalAs(UnmanagedType.Interface)] out IDialedDxgiFactory1 factory);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern IntPtr LoadLibraryExW(string path, IntPtr file, uint flags);

  // NVML query functions only. The module is loaded by absolute, caller-verified path
  // first, so these imports bind to that already-loaded nvml.dll.
  [DllImport("nvml.dll")] static extern int nvmlInit_v2();
  [DllImport("nvml.dll")] static extern int nvmlShutdown();
  [DllImport("nvml.dll")] static extern int nvmlSystemGetDriverVersion(byte[] version, uint length);
  [DllImport("nvml.dll")] static extern int nvmlDeviceGetCount_v2(out uint count);
  [DllImport("nvml.dll")] static extern int nvmlDeviceGetHandleByIndex_v2(uint index, out IntPtr device);
  [DllImport("nvml.dll")] static extern int nvmlDeviceGetName(IntPtr device, byte[] name, uint length);
  [DllImport("nvml.dll")] static extern int nvmlDeviceGetPciInfo_v3(IntPtr device, ref DialedNvmlPciInfo pci);
  [DllImport("nvml.dll")] static extern int nvmlDeviceGetTemperature(IntPtr device, int sensor, out uint celsius);
  [DllImport("nvml.dll")] static extern int nvmlDeviceGetPowerUsage(IntPtr device, out uint milliwatts);
  [DllImport("nvml.dll")] static extern int nvmlDeviceGetEnforcedPowerLimit(IntPtr device, out uint milliwatts);
  [DllImport("nvml.dll")] static extern int nvmlDeviceGetClockInfo(IntPtr device, int clockType, out uint mhz);
  [DllImport("nvml.dll")] static extern int nvmlDeviceGetFanSpeed(IntPtr device, out uint percent);
  [DllImport("nvml.dll")] static extern int nvmlDeviceGetCurrentClocksThrottleReasons(IntPtr device, out ulong reasons);

  const uint PDH_MORE_DATA = 0x800007D2;
  const uint FORMAT = 0x00000200 | 0x00008000; // PDH_FMT_DOUBLE | PDH_FMT_NOCAP100
  const int MAX_ITEMS = 4096;
  const int MAX_NVML_DEVICES = 8;
  const uint LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR = 0x00000100;
  const uint LOAD_LIBRARY_SEARCH_SYSTEM32 = 0x00000800;
  const int NVML_TEMPERATURE_GPU = 0;
  const int NVML_CLOCK_GRAPHICS = 0;
  const int NVML_CLOCK_MEM = 1;

  static readonly CultureInfo CI = CultureInfo.InvariantCulture;
  static readonly string[] Keys = { "cpuUtility", "cpuPerformance", "cpuFrequency", "cpuLimit", "memAvailable", "gpuEngine", "gpuDedicated", "gpuShared", "gpuProcessDedicated" };
  static readonly string[] Paths = {
    "\\Processor Information(_Total)\\% Processor Utility",
    // Every core, not only _Total: the aggregator takes _Total for the all-core figure
    // and the busiest core for "fastest core", which is what a game's main thread sees.
    "\\Processor Information(*)\\% Processor Performance",
    "\\Processor Information(_Total)\\Processor Frequency",
    "\\Processor Information(_Total)\\% Performance Limit",
    "\\Memory\\Available Bytes",
    "\\GPU Engine(*)\\Utilization Percentage",
    "\\GPU Adapter Memory(*)\\Dedicated Usage",
    "\\GPU Adapter Memory(*)\\Shared Usage",
    "\\GPU Process Memory(*)\\Dedicated Usage",
  };

  delegate int UIntReader(IntPtr device, out uint value);

  static bool nvmlReady = false;
  static IntPtr[] nvmlDevices = new IntPtr[0];

  static string Hex(uint value) { return "0x" + value.ToString("x", CI); }

  static string Quote(string value) {
    var sb = new StringBuilder("\"");
    foreach (char ch in value ?? "") {
      if (ch == '"' || ch == '\\') sb.Append('\\').Append(ch);
      else if (ch < 0x20) sb.Append("\\u").Append(((int)ch).ToString("x4", CI));
      else sb.Append(ch);
    }
    return sb.Append('"').ToString();
  }

  static string Ascii(byte[] buffer) {
    int length = Array.IndexOf(buffer, (byte)0);
    return Encoding.ASCII.GetString(buffer, 0, length < 0 ? buffer.Length : length).Trim();
  }

  public static string AdaptersJson() {
    var sb = new StringBuilder("[");
    try {
      Guid iid = new Guid("770aae78-f26f-4dba-a829-253c83d1b387");
      IDialedDxgiFactory1 factory;
      if (CreateDXGIFactory1(ref iid, out factory) != 0 || factory == null) return "[]";
      for (uint index = 0; index < 16; index++) {
        IDialedDxgiAdapter1 adapter;
        if (factory.EnumAdapters1(index, out adapter) != 0 || adapter == null) break;
        DialedAdapterDesc1 desc;
        if (adapter.GetDesc1(out desc) == 0) {
          if (sb.Length > 1) sb.Append(',');
          sb.Append("{\"luid\":").Append(Quote(string.Format(CI, "0x{0:x8}_0x{1:x8}", unchecked((uint)desc.LuidHigh), desc.LuidLow)))
            .Append(",\"description\":").Append(Quote(desc.Description))
            .Append(",\"vendorId\":").Append(desc.VendorId.ToString(CI))
            .Append(",\"deviceId\":").Append(desc.DeviceId.ToString(CI))
            .Append(",\"subSysId\":").Append(desc.SubSysId.ToString(CI))
            .Append(",\"dedicatedVideoMemory\":").Append(desc.DedicatedVideoMemory.ToUInt64().ToString(CI))
            .Append(",\"software\":").Append((desc.Flags & 2) != 0 ? "true" : "false")
            .Append('}');
        }
        Marshal.ReleaseComObject(adapter);
      }
      Marshal.ReleaseComObject(factory);
    } catch { }
    return sb.Append(']').ToString();
  }

  static string NvmlOpen(string path, string status) {
    if (string.IsNullOrEmpty(path)) return "{\"type\":\"nvml\",\"status\":" + Quote(string.IsNullOrEmpty(status) ? "DISABLED" : status) + ",\"devices\":[]}";
    try {
      if (LoadLibraryExW(path, IntPtr.Zero, LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR | LOAD_LIBRARY_SEARCH_SYSTEM32) == IntPtr.Zero) {
        return "{\"type\":\"nvml\",\"status\":\"UNAVAILABLE\",\"code\":" + Marshal.GetLastWin32Error().ToString(CI) + ",\"devices\":[]}";
      }
      int init = nvmlInit_v2();
      if (init != 0) return "{\"type\":\"nvml\",\"status\":\"UNAVAILABLE\",\"code\":" + init.ToString(CI) + ",\"devices\":[]}";
      nvmlReady = true;
      var version = new byte[96];
      string driver = nvmlSystemGetDriverVersion(version, 96) == 0 ? Ascii(version) : "";
      uint count;
      if (nvmlDeviceGetCount_v2(out count) != 0) count = 0;
      int limit = (int)Math.Min(count, (uint)MAX_NVML_DEVICES);
      nvmlDevices = new IntPtr[limit];
      var sb = new StringBuilder("{\"type\":\"nvml\",\"status\":\"OK\",\"driverVersion\":").Append(Quote(driver)).Append(",\"devices\":[");
      bool first = true;
      for (int i = 0; i < limit; i++) {
        IntPtr handle;
        if (nvmlDeviceGetHandleByIndex_v2((uint)i, out handle) != 0) continue;
        nvmlDevices[i] = handle;
        var name = new byte[96];
        string deviceName = nvmlDeviceGetName(handle, name, 96) == 0 ? Ascii(name) : "";
        var pci = new DialedNvmlPciInfo { BusIdLegacy = new byte[16], BusId = new byte[32] };
        bool pciOk = nvmlDeviceGetPciInfo_v3(handle, ref pci) == 0;
        if (!first) sb.Append(',');
        first = false;
        sb.Append("{\"index\":").Append(i.ToString(CI)).Append(",\"name\":").Append(Quote(deviceName))
          .Append(",\"pciDeviceId\":").Append(pciOk ? pci.PciDeviceId.ToString(CI) : "null")
          .Append(",\"pciSubSystemId\":").Append(pciOk ? pci.PciSubSystemId.ToString(CI) : "null").Append('}');
      }
      return sb.Append("]}").ToString();
    } catch (Exception error) {
      nvmlReady = false;
      return "{\"type\":\"nvml\",\"status\":\"UNAVAILABLE\",\"error\":" + Quote(error.GetType().Name) + ",\"devices\":[]}";
    }
  }

  static void AppendReading(StringBuilder sb, IntPtr device, UIntReader reader) {
    uint value = 0;
    int code;
    try { code = reader(device, out value); } catch { code = -1; }
    sb.Append(',').Append(code.ToString(CI)).Append(',').Append(code == 0 ? value.ToString(CI) : "null");
  }

  static void AppendNvml(StringBuilder sb) {
    if (!nvmlReady) return;
    sb.Append(",\"g\":[");
    bool first = true;
    for (int i = 0; i < nvmlDevices.Length; i++) {
      IntPtr device = nvmlDevices[i];
      if (device == IntPtr.Zero) continue;
      if (!first) sb.Append(',');
      first = false;
      sb.Append('[').Append(i.ToString(CI));
      AppendReading(sb, device, (IntPtr d, out uint v) => nvmlDeviceGetTemperature(d, NVML_TEMPERATURE_GPU, out v));
      AppendReading(sb, device, (IntPtr d, out uint v) => nvmlDeviceGetPowerUsage(d, out v));
      AppendReading(sb, device, (IntPtr d, out uint v) => nvmlDeviceGetEnforcedPowerLimit(d, out v));
      AppendReading(sb, device, (IntPtr d, out uint v) => nvmlDeviceGetClockInfo(d, NVML_CLOCK_GRAPHICS, out v));
      AppendReading(sb, device, (IntPtr d, out uint v) => nvmlDeviceGetClockInfo(d, NVML_CLOCK_MEM, out v));
      AppendReading(sb, device, (IntPtr d, out uint v) => nvmlDeviceGetFanSpeed(d, out v));
      ulong reasons = 0;
      int reasonCode;
      try { reasonCode = nvmlDeviceGetCurrentClocksThrottleReasons(device, out reasons); } catch { reasonCode = -1; }
      sb.Append(',').Append(reasonCode.ToString(CI)).Append(',').Append(reasonCode == 0 ? Quote("0x" + reasons.ToString("x", CI)) : "null").Append(']');
    }
    sb.Append(']');
  }

  static void AppendCounter(StringBuilder sb, IntPtr counter, uint failure, string prefix) {
    if (counter == IntPtr.Zero) { sb.Append("{\"st\":\"").Append(Hex(failure)).Append("\",\"items\":[]}"); return; }
    uint size = 0;
    uint count;
    uint status = PdhGetFormattedCounterArray(counter, FORMAT, ref size, out count, IntPtr.Zero);
    if (status != PDH_MORE_DATA) { sb.Append("{\"st\":\"").Append(Hex(status)).Append("\",\"items\":[]}"); return; }
    IntPtr buffer = Marshal.AllocHGlobal((int)size);
    try {
      status = PdhGetFormattedCounterArray(counter, FORMAT, ref size, out count, buffer);
      sb.Append("{\"st\":\"").Append(Hex(status)).Append("\",\"items\":[");
      if (status == 0) {
        // PDH_FMT_COUNTERVALUE_ITEM_W: name pointer, CStatus, then the double union.
        int itemSize = IntPtr.Size == 8 ? 24 : 16;
        int valueOffset = IntPtr.Size == 8 ? 16 : 8;
        bool first = true;
        for (int n = 0; n < count && n < MAX_ITEMS; n++) {
          IntPtr item = new IntPtr(buffer.ToInt64() + (long)n * itemSize);
          string name = Marshal.PtrToStringUni(Marshal.ReadIntPtr(item)) ?? "";
          if (prefix != null && !name.StartsWith(prefix, StringComparison.Ordinal)) continue;
          int cstatus = Marshal.ReadInt32(item, IntPtr.Size);
          double value = BitConverter.Int64BitsToDouble(Marshal.ReadInt64(item, valueOffset));
          if (!first) sb.Append(',');
          first = false;
          sb.Append('[').Append(Quote(name)).Append(',').Append(cstatus.ToString(CI)).Append(',')
            .Append(double.IsNaN(value) || double.IsInfinity(value) ? "null" : value.ToString("R", CI)).Append(']');
        }
      }
      sb.Append("]}");
    } finally {
      Marshal.FreeHGlobal(buffer);
    }
  }

  public static void Run(int samples, int pid, string nvmlPath, string nvmlStatus) {
    IntPtr query;
    uint openStatus = PdhOpenQuery(null, IntPtr.Zero, out query);
    var counters = new IntPtr[Keys.Length];
    var addStatus = new uint[Keys.Length];
    for (int k = 0; k < Keys.Length; k++) {
      if (openStatus != 0) { addStatus[k] = openStatus; continue; }
      if (Keys[k] == "gpuProcessDedicated" && pid <= 0) continue;
      addStatus[k] = PdhAddEnglishCounter(query, Paths[k], IntPtr.Zero, out counters[k]);
    }
    string target = "NONE";
    DateTime targetStart = DateTime.MinValue;
    if (pid > 0) {
      try { targetStart = Process.GetProcessById(pid).StartTime.ToUniversalTime(); target = "OK"; }
      catch { target = "CHANGED"; }
    }
    string pidPrefix = "pid_" + pid.ToString(CI) + "_";
    try {
      Console.Out.WriteLine(NvmlOpen(nvmlPath, nvmlStatus));
      Console.Out.Flush();
      var clock = Stopwatch.StartNew();
      for (int i = 0; i < samples; i++) {
        long wait = (long)i * 1000 - clock.ElapsedMilliseconds;
        if (wait > 0) Thread.Sleep((int)wait);
        uint collect = openStatus == 0 ? PdhCollectQueryData(query) : openStatus;
        if (target == "OK") {
          try { if (Process.GetProcessById(pid).StartTime.ToUniversalTime() != targetStart) target = "CHANGED"; }
          catch { target = "CHANGED"; }
        }
        var sb = new StringBuilder();
        sb.Append("{\"type\":\"sample\",\"i\":").Append(i.ToString(CI))
          .Append(",\"tMs\":").Append(clock.ElapsedMilliseconds.ToString(CI))
          .Append(",\"target\":\"").Append(target).Append("\",\"collect\":\"").Append(Hex(collect)).Append("\",\"c\":{");
        for (int k = 0; k < Keys.Length; k++) {
          if (k > 0) sb.Append(',');
          sb.Append('"').Append(Keys[k]).Append("\":");
          bool usable = openStatus == 0 && addStatus[k] == 0 && counters[k] != IntPtr.Zero;
          AppendCounter(sb, usable ? counters[k] : IntPtr.Zero, addStatus[k], Keys[k] == "gpuProcessDedicated" ? pidPrefix : null);
        }
        sb.Append('}');
        AppendNvml(sb);
        sb.Append('}');
        Console.Out.WriteLine(sb.ToString());
        Console.Out.Flush();
      }
    } finally {
      if (openStatus == 0) PdhCloseQuery(query);
      if (nvmlReady) { try { nvmlShutdown(); } catch { } nvmlReady = false; }
    }
  }
}
