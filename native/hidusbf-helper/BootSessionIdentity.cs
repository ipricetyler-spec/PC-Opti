using System;
using System.Diagnostics.Eventing.Reader;
using System.Globalization;
using System.Linq;
using System.Xml.Linq;
using Microsoft.Win32;

namespace Dialed.HidusbfHelper {
  // WMI LastBootUpTime moves when Windows corrects its clock. Use the documented
  // boot counter plus the immutable kernel-start event, never a live timestamp.
  public static class BootSessionIdentity {
    const string Prefix = "boot-session-v1:";
    const string Provider = "Microsoft-Windows-Kernel-General";
    const string ProviderGuid = "a68ca8b7-004f-d7b6-a698-07e2de0f1f5d";
    public static string Format(uint sequence, long recordId, long startTicks) {
      if (recordId <= 0 || startTicks <= 0 || startTicks > DateTime.MaxValue.Ticks) throw new InvalidOperationException("BOOT_SESSION_UNAVAILABLE: invalid Windows startup evidence.");
      return Prefix + sequence.ToString(CultureInfo.InvariantCulture) + ":" + recordId.ToString(CultureInfo.InvariantCulture) + ":" + startTicks.ToString(CultureInfo.InvariantCulture);
    }
    static bool Parse(string value, out uint sequence, out long recordId, out long ticks) {
      sequence = 0; recordId = ticks = 0;
      if (value == null || !value.StartsWith(Prefix, StringComparison.Ordinal)) return false;
      string[] fields = value.Substring(Prefix.Length).Split(':');
      return fields.Length == 3 && uint.TryParse(fields[0], NumberStyles.None, CultureInfo.InvariantCulture, out sequence) &&
        long.TryParse(fields[1], NumberStyles.None, CultureInfo.InvariantCulture, out recordId) && recordId > 0 &&
        long.TryParse(fields[2], NumberStyles.None, CultureInfo.InvariantCulture, out ticks) && ticks > 0 && ticks <= DateTime.MaxValue.Ticks &&
        value == Format(sequence, recordId, ticks);
    }
    public static bool IsValid(string value) => Parse(value, out _, out _, out _);
    // Counter wrap, reset or cleared logs require review; they never prove restart.
    public static bool IsLater(string before, string current) =>
      Parse(before, out uint oldSequence, out long oldRecord, out long oldTicks) &&
      Parse(current, out uint sequence, out long record, out long ticks) &&
      sequence > oldSequence && record > oldRecord && ticks != oldTicks;
    public static bool IsLegacy(string value) => value != null && value.Length == 25 && value[14] == '.' &&
      (value[21] == '+' || value[21] == '-') && value.Substring(15, 6).All(char.IsAsciiDigit) && value.Substring(22, 3).All(char.IsAsciiDigit) &&
      DateTime.TryParseExact(value.Substring(0, 14), "yyyyMMddHHmmss", CultureInfo.InvariantCulture, DateTimeStyles.None, out _) &&
      int.Parse(value.Substring(22, 3), CultureInfo.InvariantCulture) <= 840;
    public static void RequireValid(string value) {
      if (!IsValid(value)) throw new InvalidOperationException("BOOT_SESSION_UNAVAILABLE: Windows restart evidence is unavailable. No recovery history was updated.");
    }
    public static string Decode(RegistryValueKind kind, object counter, string eventXml, string machineName) {
      if (kind != RegistryValueKind.DWord || counter is not int number) throw new InvalidOperationException("BOOT_SESSION_UNAVAILABLE: Windows boot counter is unavailable.");
      // The kernel event's recorded StartTime is immutable even if the live WMI
      // boot-time property changes. Reject unknown event schemas instead of guessing.
      var xml = XElement.Parse(eventXml);
      XNamespace ns = "http://schemas.microsoft.com/win/2004/08/events/event";
      var system = xml.Element(ns + "System");
      string Field(string name) => system?.Element(ns + name)?.Value;
      var provider = system?.Element(ns + "Provider");
      var data = xml.Element(ns + "EventData")?.Elements(ns + "Data").ToArray();
      var start = data?.Where(x => (string)x.Attribute("Name") == "StartTime").ToArray();
      if (xml.Name != ns + "Event" || (string)provider?.Attribute("Name") != Provider ||
        !Guid.TryParse((string)provider?.Attribute("Guid"), out var id) || id != new Guid(ProviderGuid) ||
        Field("EventID") != "12" || Field("Version") != "0" || Field("Channel") != "System" ||
        !string.Equals(Field("Computer"), machineName, StringComparison.OrdinalIgnoreCase) ||
        !long.TryParse(Field("EventRecordID"), NumberStyles.None, CultureInfo.InvariantCulture, out long record) ||
        start?.Length != 1 || !DateTime.TryParseExact(start[0].Value, "yyyy-MM-dd'T'HH:mm:ss.fffffff'Z'", CultureInfo.InvariantCulture,
          DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out var time))
        throw new InvalidOperationException("BOOT_SESSION_UNAVAILABLE: Windows startup event is missing or unsupported.");
      return Format(unchecked((uint)number), record, time.Ticks);
    }
    public static string Read() {
      using var machine = RegistryKey.OpenBaseKey(RegistryHive.LocalMachine, RegistryView.Registry64);
      using var key = machine.OpenSubKey(@"SYSTEM\CurrentControlSet\Control\Session Manager\Memory Management\PrefetchParameters", false)
        ?? throw new InvalidOperationException("BOOT_SESSION_UNAVAILABLE: Windows boot counter is missing.");
      var kind = key.GetValueKind("BootId"); var counter = key.GetValue("BootId");
      using var reader = new EventLogReader(new EventLogQuery("System", PathType.LogName,
        "*[System[Provider[@Name='Microsoft-Windows-Kernel-General'] and EventID=12]]") { ReverseDirection = true });
      using var entry = reader.ReadEvent(TimeSpan.FromSeconds(5))
        ?? throw new InvalidOperationException("BOOT_SESSION_UNAVAILABLE: Windows startup event is missing.");
      string result = Decode(kind, counter, entry.ToXml(), Environment.MachineName);
      if (kind != key.GetValueKind("BootId") || !Equals(counter, key.GetValue("BootId")))
        throw new InvalidOperationException("BOOT_SESSION_UNAVAILABLE: Windows boot counter changed during observation.");
      return result;
    }
  }
}
