using System;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text.Json;
using Dialed.HidusbfHelper;
using Microsoft.Win32;

static class BootSessionChecks {
  public static readonly string First = BootSessionIdentity.Format(275, 48415, new DateTime(2026, 9, 12, 13, 55, 30, DateTimeKind.Utc).AddMilliseconds(500).Ticks);
  public static string Next(string value) {
    string[] fields = value.Split(':');
    return BootSessionIdentity.Format(uint.Parse(fields[1], CultureInfo.InvariantCulture) + 1,
      long.Parse(fields[2], CultureInfo.InvariantCulture) + 100, long.Parse(fields[3], CultureInfo.InvariantCulture) + TimeSpan.TicksPerHour);
  }
  const string Legacy = "20260912085530.500000-300";
  const string ShiftedLegacy = "20260912085528.031312-300";
  static int checks;
  static void Check(bool value, string reason) { if (!value) throw new Exception("Boot session: " + reason); checks++; }
  static void Refuse(Action action, string prefix = "") {
    try { action(); } catch (InvalidOperationException e) { Check(e.Message.StartsWith(prefix, StringComparison.Ordinal), "refusal code: " + e.Message); return; }
    throw new Exception("Boot session: expected refusal " + prefix);
  }
  static LifecycleRecord Record(JournalLog log) => JsonSerializer.Deserialize<LifecycleRecord>(log.LastPayload);
  static void Seed(JournalLog log, LifecycleRecord record) => log.Append(JsonSerializer.Serialize(record), log.Revision);
  public static void RunCaptured(string path) {
    using var json = JsonDocument.Parse(File.ReadAllBytes(path)); var root = json.RootElement;
    var record = JsonSerializer.Deserialize<LifecycleRecord>(root.GetProperty("Record"));
    var current = JsonSerializer.Deserialize<LifecycleObservation>(root.GetProperty("Current"));
    string identity = null;
    foreach (var capture in root.GetProperty("BootEvidence").EnumerateArray()) {
      string decoded = BootSessionIdentity.Decode(Enum.Parse<RegistryValueKind>(capture.GetProperty("Kind").GetString()),
        capture.GetProperty("Counter").GetInt32(), capture.GetProperty("EventXml").GetString(), capture.GetProperty("Machine").GetString());
      Check(identity == null || identity == decoded, "two real counter/event captures agree"); identity = decoded;
    }
    Check(root.GetProperty("BootEvidence").GetArrayLength() == 2 && identity != null, "two boot captures required");
    current = current with { BootId = identity };
    using var log = new JournalLog(new MemoryStream()); Seed(log, record);
    var machine = new MemoryMachine { State = current }; var session = new LifecycleSession(log, machine, () => { });
    Check(session.Reconcile().Status == "BOOT_IDENTITY_RECORDED", "captured completed history binds without other drift");
    Check(machine.Executions == 0 && machine.Observations == 2 && log.Revision == 2, "captured fixture only appends once to memory");
    Check(LifecycleSession.Digest(Record(log).Ownership) == LifecycleSession.Digest(record.Ownership), "captured originals preserved");
    Check(LifecycleSession.Digest(Record(log).Expected) == LifecycleSession.Digest(current), "full captured current observation retained");
    Console.WriteLine(JsonSerializer.Serialize(new { Status = "CAPTURED_BOOT_BINDING_FIXTURE_PASS", Checks = checks, BootId = identity, ExpectedDigest = LifecycleSession.Digest(current), PhysicalOperation = false }));
  }
  public static void Run(LifecycleObservation initial, LifecycleIntent install) {
    // This exact pre-fix pair differed after a Windows clock correction without
    // any restart. Old reconciliation incorrectly accepted the pending change.
    var empty = new LifecycleOwnership(false, new System.Collections.Generic.Dictionary<string, SavedDevice>());
    var plan = LifecycleSession.Plan(initial, install, empty);
    var before = initial with { BootId = Legacy };
    var after = plan.After with { BootId = Legacy };
    var legacyPending = new LifecycleRecord(null, empty, new PendingOperation("fixture", before,
      plan with { BeforeDigest = LifecycleSession.Digest(before), After = after }), false, 2);
    using (var bytes = new MemoryStream()) using (var log = new JournalLog(bytes)) {
      Seed(log, legacyPending); var machine = new MemoryMachine { State = after with { BootId = ShiftedLegacy,
        Service = after.Service with { Service = after.Service.Service with { State = 4 } } } };
      var session = new LifecycleSession(log, machine, () => { }); byte[] saved = bytes.ToArray();
      Refuse(() => session.Reconcile(), "BOOT_HISTORY_REVIEW_REQUIRED:");
      machine.State = machine.State with { BootId = Next(First) };
      Refuse(() => session.Reconcile(), "BOOT_HISTORY_REVIEW_REQUIRED:");
      Refuse(() => session.Preview(install), "BOOT_HISTORY_REVIEW_REQUIRED:");
      Check(machine.Observations == 0 && machine.Executions == 0 && saved.SequenceEqual(bytes.ToArray()), "legacy pending never observed, rewritten or accepted as a restart");
    }
    using (var bytes = new MemoryStream()) using (var log = new JournalLog(bytes)) {
      var machine = new FixtureMachine { State = initial }; DateTimeOffset clock = DateTimeOffset.UtcNow;
      var session = new LifecycleSession(log, machine, () => { }, () => clock);
      var preview = session.Preview(install); session.Apply(preview.Token, preview.PlanDigest); byte[] pending = bytes.ToArray();
      // Wall-clock corrections of either sign never affect restart evidence.
      foreach (double seconds in new[] { -2.469, 2.469, 86400.0, -172800.0 }) {
        clock = clock.AddSeconds(seconds);
        Check(session.Reconcile().Status == "RESTART_REQUIRED" && pending.SequenceEqual(bytes.ToArray()), "clock correction leaves operation pending");
      }
      machine.Restart(); Check(session.Reconcile().Status == "CONFIGURATION_VERIFIED", "counter and new startup event complete unchanged operation");
      Check(Record(log).Pending == null && !Record(log).NeedsReview, "pending cleared only after proven restart");
    }
    var installed = plan.After with { Service = plan.After.Service with { Service = plan.After.Service.Service with { State = 4 } } };
    var adopt = install with { Action = "ADOPT", RequestedHz = null };
    var adopted = LifecycleSession.Plan(installed, adopt, empty);
    var completed = new LifecycleRecord(installed with { BootId = Legacy }, adopted.Ownership, null, false, 2);
    using (var bytes = new MemoryStream()) using (var log = new JournalLog(bytes)) {
      Seed(log, completed); var machine = new MemoryMachine { State = installed }; var session = new LifecycleSession(log, machine, () => { });
      byte[] saved = bytes.ToArray(); string originals = LifecycleSession.Digest(completed.Ownership);
      Refuse(() => session.Preview(install with { Action = "APPLY" }), "BOOT_IDENTITY_RECONCILE_REQUIRED:");
      Check(saved.SequenceEqual(bytes.ToArray()), "completed legacy preview does not append"); machine.Observations = 0;
      Check(session.Reconcile().Status == "BOOT_IDENTITY_RECORDED", "explicit completed legacy binding");
      Check(machine.Observations == 2 && machine.Executions == 0 && log.Revision == 2, "two matching observations, one append, zero device execution");
      Check(LifecycleSession.Digest(Record(log).Ownership) == originals && !Record(log).Ownership.ServiceOwned, "external ownership and exact originals preserved");
      Check(Record(log).Expected.BootId == First && Record(log).Pending == null && !Record(log).NeedsReview, "only completed expectation updated");
      long revision = log.Revision; Check(session.Reconcile().Status == "CONFIGURATION_VERIFIED" && log.Revision == revision, "repeat check is no-op");
      Check(session.Preview(install with { Action = "APPLY", RequestedHz = 1000 }).Plan.ReconnectRequired, "new rate preview available after binding");
    }
    foreach (var broken in new[] {
      completed with { NeedsReview = true }, completed with { SchemaVersion = 1 },
      completed with { Expected = completed.Expected with { BootId = "malformed" } },
      completed with { Expected = completed.Expected with { PlatformDigest = new string('f', 64) } },
      completed with { Expected = completed.Expected with { Devices = Array.Empty<DeviceSetting>() } }
    }) {
      using var bytes = new MemoryStream(); using var log = new JournalLog(bytes); Seed(log, broken); byte[] saved = bytes.ToArray();
      var machine = new MemoryMachine { State = installed }; var session = new LifecycleSession(log, machine, () => { });
      Refuse(() => session.Reconcile()); Check(saved.SequenceEqual(bytes.ToArray()) && machine.Executions == 0, "incompatible legacy state never rewritten");
    }
    using (var bytes = new MemoryStream()) using (var log = new JournalLog(bytes)) {
      Seed(log, completed); byte[] saved = bytes.ToArray(); var machine = new MemoryMachine { State = installed, Unstable = true };
      Refuse(() => new LifecycleSession(log, machine, () => { }).Reconcile(), "BOOT_SESSION_UNAVAILABLE:");
      Check(saved.SequenceEqual(bytes.ToArray()), "unstable binding preserves all bytes");
    }
    foreach (string invalid in new[] { null, "", Legacy, ShiftedLegacy, "boot-1", First + " ", First.Replace(":275:", ":0275:"), First.Replace(":48415:", ":0:"), First.Replace(":275:", ":4294967296:") }) {
      Check(!BootSessionIdentity.IsValid(invalid), "strict stable format");
      Check(!BootSessionIdentity.IsLater(First, invalid), "invalid marker cannot prove restart");
      Refuse(() => LifecycleSession.Plan(initial with { BootId = invalid }, install, empty), "BOOT_SESSION_UNAVAILABLE:");
    }
    Check(BootSessionIdentity.IsLegacy(Legacy) && BootSessionIdentity.IsLegacy(ShiftedLegacy), "recognize exact saved WMI shape only");
    foreach (string invalid in new[] { "20261312085530.500000-300", Legacy + " ", Legacy.Replace("-300", "-999"), First, null }) Check(!BootSessionIdentity.IsLegacy(invalid), "reject malformed legacy marker");
    string[] part = First.Split(':'); long ticks = long.Parse(part[3], CultureInfo.InvariantCulture);
    foreach (string insufficient in new[] { First, BootSessionIdentity.Format(276, 48415, ticks), BootSessionIdentity.Format(275, 48515, ticks + 1),
      BootSessionIdentity.Format(276, 48515, ticks), BootSessionIdentity.Format(274, 48515, ticks + 1), BootSessionIdentity.Format(276, 1, ticks + 1) }) {
      Check(!BootSessionIdentity.IsLater(First, insufficient), "both independent boot markers must advance");
      using var log = new JournalLog(new MemoryStream()); var machine = new FixtureMachine { State = initial }; var session = new LifecycleSession(log, machine, () => { });
      var preview = session.Preview(install); session.Apply(preview.Token, preview.PlanDigest);
      machine.State = machine.State with { BootId = insufficient };
      if (insufficient == First) Check(session.Reconcile().Status == "RESTART_REQUIRED", "same session still pending");
      else Refuse(() => session.Reconcile());
      Check(Record(log).Pending != null, "inconsistent restart evidence retains pending record");
    }
    Check(BootSessionIdentity.IsLater(First, BootSessionIdentity.Format(276, 48515, ticks - TimeSpan.TicksPerDay)), "new restart may have earlier wall time");
    const string eventXml = "<Event xmlns='http://schemas.microsoft.com/win/2004/08/events/event'><System><Provider Name='Microsoft-Windows-Kernel-General' Guid='{a68ca8b7-004f-d7b6-a698-07e2de0f1f5d}'/><EventID>12</EventID><Version>0</Version><EventRecordID>48415</EventRecordID><Channel>System</Channel><Computer>FIXTURE</Computer></System><EventData><Data Name='StartTime'>2026-09-12T13:55:30.5000000Z</Data></EventData></Event>";
    Check(BootSessionIdentity.Decode(RegistryValueKind.DWord, 275, eventXml, "fixture") == First, "read-only counter/event decoder");
    foreach (string xml in new[] { eventXml.Replace("<EventID>12", "<EventID>1"), eventXml.Replace("<Version>0", "<Version>1"), eventXml.Replace("FIXTURE", "OTHER"),
      eventXml.Replace("Kernel-General", "Other"), eventXml.Replace("a68ca8b7", "a68ca8b8"), eventXml.Replace(".5000000Z", ".5000000"), eventXml.Replace("<Channel>System", "<Channel>Application"),
      eventXml.Replace("</EventData>", "<Data Name='StartTime'>2026-09-12T13:55:30.5000000Z</Data></EventData>"), eventXml.Replace("<EventRecordID>48415", "<EventRecordID>0") })
      Refuse(() => BootSessionIdentity.Decode(RegistryValueKind.DWord, 275, xml, "FIXTURE"), "BOOT_SESSION_UNAVAILABLE:");
    Refuse(() => BootSessionIdentity.Decode(RegistryValueKind.String, "275", eventXml, "FIXTURE"));
    Refuse(() => BootSessionIdentity.Decode(RegistryValueKind.DWord, null, eventXml, "FIXTURE"));
    Check(SetupPresentation.FailureSummary("BOOT_IDENTITY_RECONCILE_REQUIRED: fixture").Contains("Check saved operation"), "binding guidance names the real button");
    Check(SetupPresentation.IsHistoryRefusal("BOOT_HISTORY_REVIEW_REQUIRED: fixture"), "unsafe legacy history pauses setup");
    Check(SetupPresentation.ResultText("BOOT_IDENTITY_RECORDED").Contains("No restart is requested"), "journal binding never implies a restart");
    Console.WriteLine("closed-boot-session-pass:" + checks);
  }
  sealed class MemoryMachine : ILifecycleMachine {
    public LifecycleObservation State; public bool Unstable; public int Observations, Executions;
    public LifecycleObservation Observe() { Observations++; return Unstable && Observations > 1 ? State with { BootId = Next(State.BootId) } : State; }
    public void Execute(NativePlan plan, LifecycleObservation before, Action assertPeer) { Executions++; throw new Exception("No device execution allowed"); }
  }
}
