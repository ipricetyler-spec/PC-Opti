using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using Dialed.HidusbfHelper;

static class SetupStateChecks {
  static int checks;
  static void Check(bool value, string reason) { if (!value) throw new Exception("Setup state: " + reason); checks++; }
  sealed class Machine : ILifecycleMachine {
    public LifecycleObservation State;
    public int Reads;
    public LifecycleObservation Observe() { Reads++; return State; }
    public void Execute(NativePlan plan, LifecycleObservation before, Action peer) => throw new Exception("Read-only setup must never execute.");
  }
  static SetupSessionState Read(LifecycleObservation state, LifecycleRecord record = null, bool observe = true) {
    using var bytes = new MemoryStream(); using var log = new JournalLog(bytes);
    if (record != null) log.Append(JsonSerializer.Serialize(record), 0);
    byte[] before = bytes.ToArray(); long revision = log.Revision;
    var machine = new Machine { State = state };
    using var session = new LifecycleSession(log, machine, () => { });
    var result = session.ReadSetupStatus();
    Check(before.SequenceEqual(bytes.ToArray()) && revision == log.Revision, "status does not append or migrate history");
    Check(machine.Reads == (observe ? 1 : 0), "pending status does not scan disconnected topology");
    return result;
  }
  public static void Run(LifecycleObservation clean, LifecycleIntent install) {
    var empty = new LifecycleOwnership(false, new Dictionary<string, SavedDevice>());
    var first = Read(clean);
    Check(first.Devices[0].RecommendedAction == "INSTALL" && !first.Devices[0].OriginalsRecorded, "fresh setup suggests installation");
    Check(first.Devices[0].Rates.Where(x => x.Available).Select(x => x.Hz).SequenceEqual(new[] {1000,2000,4000,8000}), "High-Speed choices");
    var created = LifecycleSession.Plan(clean, install, empty).After;
    var state = created with { Service = created.Service with { Service = created.Service.Service with { State = 4 } } };
    var unrecorded = Read(state);
    Check(unrecorded.Devices[0].RecommendedAction == "ADOPT" && unrecorded.Devices[0].Rates.All(x => !x.Available), "existing driver never implies recorded originals");
    var adoption = LifecycleSession.Plan(state, install with { Action = "ADOPT", RequestedHz = null }, empty);
    var record = new LifecycleRecord(state, adoption.Ownership, null, false, 3);
    var enrolled = Read(state, record);
    Check(enrolled.Devices[0].OriginalsRecorded && enrolled.Devices[0].RecommendedAction == "APPLY", "exact recorded device defaults to change");
    Check(enrolled.Devices[0].SavedHz == 8000, "saved rate comes from observed interval");
    Check(SetupPresentation.SuggestedAction(enrolled.Devices[0]) == "APPLY", "UI uses enrollment rather than service guess");
    var changedScope = state with { Devices = new[] { state.Devices[0] with { InterfaceDigest = new string('f',64) } } };
    var drift = Read(changedScope, record);
    Check(drift.HistoryStatus == "CHECK_REQUIRED" && !drift.Devices[0].OriginalsRecorded && drift.Devices[0].RecommendedAction == null, "different scope never inherits enrollment");
    var changedCoordinate = state with { Devices = new[] { state.Devices[0] with { Coordinate = state.Devices[0].Coordinate with { KeyPath = state.Devices[0].Coordinate.KeyPath + "-different" } } } };
    Check(!Read(changedCoordinate, record).Devices[0].OriginalsRecorded, "exact restore coordinate must match");
    var lower = state with { Service = state.Service with { File = new DriverIdentity(LifecycleSession.HashForVariant("PATCH_1K"), "PATCH_1K") } };
    var limited = Read(lower, record with { Expected = lower });
    Check(limited.Devices[0].Rates.Where(x => x.Available).Select(x => x.Hz).SequenceEqual(new[] {1000}), "existing variant limits visible rate choices");
    Check(limited.Devices[0].Rates.Single(x => x.Hz == 8000).Reason.Contains("shared driver"), "unavailable high rate has actionable explanation");
    var full = clean with { Devices = new[] { clean.Devices[0] with { Speed = "FULL" } } };
    Check(Read(full).Devices[0].Rates.Where(x => x.Available).Select(x => x.Hz).SequenceEqual(new[] {125,250,500,1000}), "Full-Speed applicable choices");
    foreach (var blocked in new[] { clean with { MemoryIntegrity = true }, clean with { SecurityAccepted = false }, clean with { Devices = new[] { clean.Devices[0] with { Authorized = false } } }, clean with { Devices = new[] { clean.Devices[0] with { Speed = "LOW" } } } })
      Check(Read(blocked).Devices[0].Rates.All(x => !x.Available), "security, policy and unsupported speeds do not offer a rate");
    var unauthorized = Read(clean with { Devices = new[] { clean.Devices[0] with { Authorized = false } } }).Devices[0];
    Check(unauthorized.RecommendedAction == null && unauthorized.Message.Contains("driver-policy restriction"), "policy-blocked selection explains the build restriction");
    Check(unauthorized.Message.Contains("not a finding that the device cannot be tuned"), "policy refusal is not presented as hardware incompatibility");
    Check(SetupPresentation.RateHelp(unauthorized).Contains("driver-policy restriction"), "empty rate list retains its policy explanation");
    var plan = LifecycleSession.Plan(state, install with { Action = "APPLY", RequestedHz = 1000 }, adoption.Ownership);
    var pending = new PendingOperation(new string('a',64), state, plan, true);
    var savedPending = Read(plan.After, record with { Expected = null, Pending = pending }, false);
    Check(savedPending.HistoryStatus == "PENDING" && savedPending.Pending.RequestedHz == 1000 && savedPending.Pending.DeviceId == install.DeviceId, "pending action retains exact device and request");
    Check(savedPending.Devices[0].RecommendedAction == null && savedPending.Devices[0].Rates.All(x => !x.Available), "pending cannot suggest repeat apply");
    Check(savedPending.Devices[0].SavedHz == 1000, "durably read-back request is shown while pending");
    Check(Read(state, record with { Expected = null, Pending = pending with { ReadbackVerified = false } }, false).Devices[0].SavedHz == 8000, "unverified write never presented as saved new rate");
    Check(Read(state, record with { NeedsReview = true }).Devices[0].RecommendedAction == null, "needs review blocks suggestion");
    var done = new LifecycleResult("CONFIGURATION_VERIFIED", DeviceName:"Fixture Edge", DeviceId:install.DeviceId, Action:"APPLY", RequestedHz:1000, ActivationEvidence:"DEVICE_RECONNECT");
    Check(SetupPresentation.ResultText(done).Contains("Fixture Edge: 1000 Hz saved") && SetupPresentation.ResultText(done).Contains("Device reconnect verified"), "explicit reconnect completion includes identity and rate");
    Check(SetupPresentation.Progress(done).EndsWith("Verified"), "completed progress is explicit");
    foreach (var generic in new[] {new LifecycleResult("CONFIGURATION_VERIFIED"), done with {ActivationEvidence=null}, done with {Status="RECONNECT_REQUIRED"}, done with {Action="ADOPT"}})
      Check(!SetupPresentation.IsRateCompletion(generic) && !SetupPresentation.ResultText(generic).Contains("Device reconnect verified"), "generic or pending result cannot claim reconnect");
    Check(!SetupPresentation.ResultText(done with {ActivationEvidence="WINDOWS_RESTART"}).Contains("Device reconnect verified"), "boot recovery is not misreported as observed reconnect");
    using (var bytes = new MemoryStream()) using (var log = new JournalLog(bytes)) {
      var machine = new Machine { State = clean }; using var session = new LifecycleSession(log,machine,()=>{});
      string nonce = new string('d',64);
      byte[] Request(object payload) => JsonSerializer.SerializeToUtf8Bytes(new {version=1,operation="SETUP_STATUS",nonce,planDigest=new string('0',64),payload});
      using var good = JsonDocument.Parse(SessionProtocol.Reply(Request(new {}),nonce,session,machine));
      Check(good.RootElement.GetProperty("ok").GetBoolean() && log.Revision == 0, "read-only status protocol dispatch");
      using var bad = JsonDocument.Parse(SessionProtocol.Reply(Request(new {Action="APPLY"}),nonce,session,machine));
      Check(!bad.RootElement.GetProperty("ok").GetBoolean() && machine.Reads == 1 && log.Revision == 0, "status payload cannot smuggle an operation");
    }
    Console.WriteLine("closed-setup-state-pass:" + checks);
  }
}
