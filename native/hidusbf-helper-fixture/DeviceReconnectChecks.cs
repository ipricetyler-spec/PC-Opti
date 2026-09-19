// Closed fixtures: no Windows notification registration or hardware calls.
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using Dialed.HidusbfHelper;

static class DeviceReconnectChecks {
  static int checks;
  static void Check(bool condition, string reason) { if (!condition) throw new Exception("Reconnect: " + reason); checks++; }
  static void Refuse(Action action, string reason) {
    try { action(); } catch (InvalidOperationException e) { Check(e.Message.Contains(reason), "refusal: " + e.Message); return; }
    throw new Exception("Reconnect: expected refusal " + reason);
  }
  sealed class Watch : IDeviceReconnectWatch {
    public readonly DeviceReconnectSequence Sequence;
    public bool Disposed;
    public Watch(string instance) { Sequence = new DeviceReconnectSequence(instance); }
    public ReconnectProgress Read() => Disposed ? throw new InvalidOperationException("Disposed watch") : Sequence.Read();
    public void Dispose() { Disposed = true; }
  }
  sealed class Machine : ILifecycleMachine, IDeviceReconnectMachine {
    public LifecycleObservation State;
    public string TargetInstance;
    public Watch Watch;
    public int Writes, Observations, Registrations;
    public bool FailWatch;
    public string ExecuteFailure;
    public Action OnObserve;
    public LifecycleObservation Observe() { Observations++; OnObserve?.Invoke(); return State; }
    public void Execute(NativePlan plan, LifecycleObservation before, Action peer) {
      peer(); Writes++;
      if (ExecuteFailure == "BEFORE") throw new InvalidOperationException("Interrupted before write");
      State = plan.After;
      if (ExecuteFailure == "AFTER") throw new InvalidOperationException("Interrupted after write");
    }
    public IDeviceReconnectWatch WatchReconnect(string instance) {
      if (FailWatch) throw new InvalidOperationException("RECONNECT_MONITOR_UNAVAILABLE: fixture registration failure");
      Registrations++; return Watch = new Watch(instance);
    }
    public void Event(uint action, string instance = null) => Watch.Sequence.Accept(instance ?? TargetInstance, action);
    public void Cycle() { Event(9); Event(7); Event(8); }
  }
  sealed class Case : IDisposable {
    public readonly MemoryStream Bytes = new MemoryStream();
    public readonly JournalLog Log;
    public readonly Machine Machine;
    public LifecycleSession Session;
    public readonly LifecycleIntent Intent;
    public Case(LifecycleObservation state, LifecycleOwnership owned, int schema = 2) {
      Log = new JournalLog(Bytes);
      Log.Append(JsonSerializer.Serialize(new LifecycleRecord(state, owned, null, false, schema)), 0);
      var target = state.Devices.Single(x => x.Id == owned.Devices.Single().Key);
      Machine = new Machine { State = state, TargetInstance = target.Coordinate.InstanceId };
      Session = new LifecycleSession(Log, Machine, () => { });
      Intent = new LifecycleIntent("APPLY", target.Id, target.InterfaceDigest, 1000, true);
    }
    public LifecycleRecord Record => JsonSerializer.Deserialize<LifecycleRecord>(Log.LastPayload);
    public LifecycleResult Apply(int hz = 1000) { var p = Session.Preview(Intent with { RequestedHz = hz }); return Session.Apply(p.Token, p.PlanDigest); }
    public void Reopen() { Session.Dispose(); Session = new LifecycleSession(Log, Machine, () => { }); }
    public void Dispose() { Session.Dispose(); Log.Dispose(); }
  }
  public static void RunCaptured(string path) {
    // Derived, readable observation export only; never open a protected journal
    // or instantiate WindowsMachine. Preserve the captured array ordering.
    using var json = JsonDocument.Parse(File.ReadAllText(path, new UTF8Encoding(false, true))); var root = json.RootElement;
    Check(root.GetProperty("SchemaVersion").GetInt32() == 2 && !root.GetProperty("PendingPresent").GetBoolean() &&
      !root.GetProperty("NeedsReview").GetBoolean() && root.GetProperty("ChainValid").GetBoolean() && root.GetProperty("ReadbackMatches").GetBoolean(), "captured completed schema-2 history");
    var baseline = JsonSerializer.Deserialize<LifecycleObservation>(root.GetProperty("Expected"));
    var originals = root.GetProperty("SavedDevices").EnumerateArray().ToDictionary(x => x.GetProperty("Id").GetString(),
      x => JsonSerializer.Deserialize<SavedDevice>(x.GetRawText()));
    var owned = new LifecycleOwnership(root.GetProperty("ServiceOwned").GetBoolean(), originals);
    Check(originals.Count == 1 && !owned.ServiceOwned && baseline.Devices.Length == 30, "captured external ownership and all native scopes");
    using var c = new Case(baseline, owned);
    var target = baseline.Devices.Single(x => x.Id == c.Intent.DeviceId);
    Check(target.Coordinate.KeyPath.EndsWith(@"\0030") && target.Interval == new DwordValue(true, 1), "exact captured interval and coordinate");
    Check(LifecycleSession.Digest(baseline) == "58bd90bea4d2df4bb2049b969c24ccef77b840590d11a9e933f3a623684b6e9a", "historical observation serialization unchanged");
    string ownedDigest = LifecycleSession.Digest(owned);
    Check(c.Apply().Status == "RECONNECT_REQUIRED", "captured 1000 plan and in-memory append fit current journal bound");
    int pendingBytes = Encoding.UTF8.GetByteCount(c.Log.LastPayload);
    Check(c.Record.Expected == null && c.Record.Pending.ReadbackVerified && c.Record.Pending.Plan.After.Devices.Single(x => x.Id == target.Id).Interval == new DwordValue(true,4), "captured readback retained without duplicate expected snapshot");
    var after = c.Record.Pending.Plan.After;
    Check(LifecycleSession.Digest(after with { Devices = after.Devices.Select(x => x.Id == target.Id ? target : x).ToArray() }) == LifecycleSession.Digest(baseline), "only captured target interval changes");
    c.Machine.Cycle(); Check(c.Session.Reconcile().Status == "CONFIGURATION_VERIFIED", "captured fixture first reconnect");
    Check(c.Apply(8000).Status == "RECONNECT_REQUIRED", "captured return plan");
    c.Machine.Cycle(); Check(c.Session.Reconcile().Status == "CONFIGURATION_VERIFIED", "captured fixture return reconnect");
    Check(LifecycleSession.Digest(c.Record.Expected) == LifecycleSession.Digest(baseline) && LifecycleSession.Digest(c.Record.Ownership) == ownedDigest, "all captured configuration and originals restored without boot change");
    Check(c.Record.SchemaVersion == 3 && c.Record.Pending == null && c.Machine.Writes == 2, "completed new-format history with exactly two fixture writes");
    Console.WriteLine(JsonSerializer.Serialize(new { Status = "CAPTURED_RECONNECT_FIXTURE_PASS", Checks = checks,
      PendingPayloadBytes = pendingBytes, MaximumPayloadBytes = 65536, NativeScopes = baseline.Devices.Length,
      ExpectedDigest = LifecycleSession.Digest(baseline), PhysicalOperation = false }));
  }
  public static void Run(LifecycleObservation initial, LifecycleIntent install) {
    var empty = new LifecycleOwnership(false, new Dictionary<string, SavedDevice>());
    var created = LifecycleSession.Plan(initial, install, empty).After;
    var baseline = created with { Service = created.Service with { Service = created.Service.Service with { State = 4 } } };
    var target = baseline.Devices[0] with { Name = "Fixture Edge · " + baseline.Devices[0].Coordinate.InstanceId };
    var other = target with { Id = LifecycleSession.Digest(@"USB\VID_1111&PID_2222\OTHER"), InterfaceDigest = LifecycleSession.Digest("other-scope"),
      Name = "Other mouse", Coordinate = IntervalBinding.Create(@"USB\VID_1111&PID_2222\OTHER", "Hardware"), Eligible = false, Authorized = false };
    baseline = baseline with { Devices = new[] { target, other } };
    var adoption = LifecycleSession.Plan(baseline, install with { Action = "ADOPT", RequestedHz = null }, empty);
    string ownedDigest = LifecycleSession.Digest(adoption.Ownership);
    string original = LifecycleSession.Digest(baseline);
    using (var c = new Case(baseline, adoption.Ownership)) {
      var p = c.Session.Preview(c.Intent);
      Check(p.Plan.ReconnectRequired && !p.Plan.RestartRequired, "attached running-driver rate plan requests reconnect");
      Check(c.Log.Revision == 1 && c.Machine.Writes == 0 && c.Machine.Registrations == 0, "preview has no write or notification side effect");
      Check(c.Session.Apply(p.Token, p.PlanDigest).Status == "RECONNECT_REQUIRED", "rate saved pending reconnect");
      Check(c.Record.SchemaVersion == 3 && c.Record.Pending != null && !c.Record.NeedsReview, "new pending format rejects old binaries");
      Check(c.Machine.Registrations == 1 && c.Machine.State.Devices[0].Interval.Value == 4, "watch armed after exact readback");
      Refuse(() => c.Session.Apply(p.Token, p.PlanDigest), "consumed");
      Refuse(() => c.Session.Preview(c.Intent), "NEEDS_REVIEW");
      byte[] pending = c.Bytes.ToArray(); int reads = c.Machine.Observations;
      for (int i = 0; i < 3; i++) Check(c.Session.Reconcile().Status == "RECONNECT_REQUIRED", "unchanged device never unlocks");
      Check(c.Machine.Observations == reads && pending.SequenceEqual(c.Bytes.ToArray()), "waiting polls do not scan or append");
      c.Machine.Event(9, other.Coordinate.InstanceId); c.Machine.Event(8, other.Coordinate.InstanceId);
      Check(c.Session.Reconcile().Status == "RECONNECT_REQUIRED", "wrong device never unlocks");
      c.Machine.Event(8); c.Machine.Event(7);
      Check(c.Session.Reconcile().Status == "RECONNECT_REQUIRED", "start/enumeration without removal never unlock");
      c.Machine.Event(9);
      // Deliberately make a full scan impossible while physically disconnected.
      c.Machine.OnObserve = () => throw new Exception("Must not scan incomplete removal topology");
      var removed = c.Session.Reconcile();
      Check(removed.Status == "RECONNECT_WAITING_FOR_DEVICE" && removed.DeviceName == target.Name, "pending target identified by journal, not UI selection");
      c.Machine.Event(7);
      Check(c.Session.Reconcile().Status == "RECONNECT_WAITING_FOR_DEVICE", "enumerated alone not started");
      c.Machine.OnObserve = null; c.Machine.Event(8);
      var completion = c.Session.Reconcile();
      Check(completion.Status == "CONFIGURATION_VERIFIED", "exact target starts and matches twice in same boot");
      Check(completion.DeviceId == target.Id && completion.DeviceName == target.Name && completion.Action == "APPLY" && completion.RequestedHz == 1000 && completion.ActivationEvidence == "DEVICE_RECONNECT", "real reconciliation carries exact completed operation to presentation");
      Check(c.Record.Pending == null && c.Record.SchemaVersion == 3 && c.Machine.Watch.Disposed, "completion durable, watcher released, schema not downgraded");
      Check(LifecycleSession.Digest(c.Record.Ownership) == ownedDigest, "recorded originals and external ownership retained");
      Check(c.Apply(8000).Status == "RECONNECT_REQUIRED" && c.Machine.Registrations == 2, "return needs a fresh watch");
      Check(c.Session.Reconcile().Status == "RECONNECT_REQUIRED", "previous reconnect cannot activate return");
      c.Machine.Cycle(); Check(c.Session.Reconcile().Status == "CONFIGURATION_VERIFIED", "return verified without Windows restart");
      Check(LifecycleSession.Digest(c.Machine.State) == original && LifecycleSession.Digest(c.Record.Ownership) == ownedDigest, "round trip restores entire baseline and retains originals");
      long revision = c.Log.Revision; int writes = c.Machine.Writes;
      Check(c.Apply(8000).Status == "ALREADY_CONFIGURED", "same rate is a no-op");
      Check(c.Log.Revision == revision && c.Machine.Writes == writes && c.Machine.Registrations == 2, "same rate never writes or asks for reconnect");
    }
    // Closing after apply, removal or arrival cannot replay in-memory events.
    foreach (int stage in new[] { 0, 1, 2 }) using (var c = new Case(baseline, adoption.Ownership)) {
      c.Apply(); if (stage > 0) c.Machine.Event(9); if (stage > 1) c.Machine.Event(8);
      var oldWatch = c.Machine.Watch; c.Reopen();
      Check(oldWatch.Disposed && c.Session.Reconcile().Status == "RECONNECT_REQUIRED", "reopen needs fresh cycle: " + stage);
      Check(c.Record.Pending != null, "interruption preserves pending");
      c.Machine.Cycle(); Check(c.Session.Reconcile().Status == "CONFIGURATION_VERIFIED", "fresh cycle recovers interrupted session");
    }
    // Reconnection alone does not excuse drift in selected scope or shared state.
    Func<LifecycleObservation, LifecycleObservation>[] drift = {
      x => x with { Devices = x.Devices.Select((d,i) => i == 0 ? d with { Interval = new DwordValue(true, 2) } : d).ToArray() },
      x => x with { Devices = x.Devices.Select((d,i) => i == 0 ? d with { Filters = new FilterValue(false, Array.Empty<string>()) } : d).ToArray() },
      x => x with { Devices = x.Devices.Select((d,i) => i == 0 ? d with { InterfaceDigest = LifecycleSession.Digest("new children or port") } : d).ToArray() },
      x => x with { Devices = x.Devices.Select((d,i) => i == 0 ? d with { Coordinate = IntervalBinding.Create(target.Coordinate.InstanceId, "Parameters") } : d).ToArray() },
      x => x with { Devices = x.Devices.Select((d,i) => i == 0 ? d with { Present = false, Eligible = false } : d).ToArray() },
      x => x with { Devices = x.Devices.Select((d,i) => i == 1 ? d with { Interval = new DwordValue(true, 7) } : d).ToArray() },
      x => x with { Devices = x.Devices.Skip(1).ToArray() },
      x => x with { SecurityAccepted = false },
      x => x with { MemoryIntegrity = true },
      x => x with { PlatformDigest = LifecycleSession.Digest("changed-platform") },
      x => x with { Service = x.Service with { Service = x.Service.Service with { State = 1 } } },
      x => x with { Service = x.Service with { File = x.Service.File with { Sha256 = new string('f',64) } } }
    };
    foreach (var alter in drift) using (var c = new Case(baseline, adoption.Ownership)) {
      c.Apply(); c.Machine.Cycle(); c.Machine.State = alter(c.Machine.State);
      Refuse(() => c.Session.Reconcile(), "NEEDS_REVIEW");
      Check(c.Record.Pending != null && c.Record.NeedsReview && LifecycleSession.Digest(c.Record.Ownership) == ownedDigest, "drift cannot discard pending/originals");
    }
    using (var c = new Case(baseline, adoption.Ownership)) {
      c.Apply(); c.Machine.Cycle(); byte[] saved = c.Bytes.ToArray(); int reads = 0;
      c.Machine.OnObserve = () => { if (++reads == 2) c.Machine.Event(9); };
      Refuse(() => c.Session.Reconcile(), "RECONNECT_UNSTABLE");
      Check(saved.SequenceEqual(c.Bytes.ToArray()), "removal during verification preserves history");
      c.Machine.OnObserve = null; c.Machine.Event(8);
      Check(c.Session.Reconcile().Status == "CONFIGURATION_VERIFIED", "new stable start can finish");
    }
    using (var c = new Case(baseline, adoption.Ownership)) {
      c.Machine.FailWatch = true; Refuse(() => c.Apply(), "RECONNECT_MONITOR_UNAVAILABLE");
      Check(c.Record.Pending != null && !c.Record.NeedsReview && c.Machine.State.Devices[0].Interval.Value == 4, "watch failure never masks applied settings or clears pending");
      c.Machine.FailWatch = false;
      Check(c.Session.Reconcile().Status == "RECONNECT_REQUIRED" && c.Machine.Writes == 1, "resume registers without repeating apply");
      c.Machine.Cycle(); Check(c.Session.Reconcile().Status == "CONFIGURATION_VERIFIED", "resume after registration failure");
    }
    foreach (string failure in new[] { "BEFORE", "AFTER" }) using (var c = new Case(baseline, adoption.Ownership)) {
      c.Machine.ExecuteFailure = failure; Refuse(() => c.Apply(), "Interrupted");
      Check(c.Record.Pending != null && c.Record.NeedsReview && c.Machine.Registrations == 0, "write interruption does not arm or forget");
      c.Reopen(); Check(c.Session.Reconcile().Status == "RECONNECT_REQUIRED", "uncertain write resumes observation only");
      c.Machine.Cycle(); Check(c.Session.Reconcile().Status == (failure == "BEFORE" ? "NOT_APPLIED" : "CONFIGURATION_VERIFIED"), "interruption reconciles exact before/after");
    }
    using (var c = new Case(baseline, adoption.Ownership)) {
      c.Apply(); c.Reopen(); c.Machine.State = c.Machine.State with { BootId = BootSessionChecks.Next(baseline.BootId) };
      Check(c.Session.Reconcile().Status == "CONFIGURATION_VERIFIED", "proven full restart remains optional recovery");
    }
    foreach (bool rollback in new[] { false, true }) using (var c = new Case(baseline, adoption.Ownership)) {
      c.Apply(); c.Machine.Cycle(); byte[] saved = c.Bytes.ToArray();
      var state = rollback ? baseline : c.Machine.State;
      c.Machine.State = state with { BootId = BootSessionIdentity.Format(274, 48414, new DateTime(2026,9,12,0,0,0,DateTimeKind.Utc).Ticks) };
      Refuse(() => c.Session.Reconcile(), "BOOT_HISTORY_REVIEW_REQUIRED");
      Check(saved.SequenceEqual(c.Bytes.ToArray()), "regressed boot cannot complete or cancel reconnect pending");
    }
    using (var c = new Case(baseline, adoption.Ownership)) {
      c.Apply(); c.Machine.Cycle(); byte[] saved = c.Bytes.ToArray(); int reads = 0;
      c.Machine.OnObserve = () => { if (++reads == 2) c.Machine.State.Devices[1] = other with { Interval = new DwordValue(true, 99) }; };
      Refuse(() => c.Session.Reconcile(), "RECONNECT_UNSTABLE");
      Check(saved.SequenceEqual(c.Bytes.ToArray()), "in-place observation mutation cannot erase earlier readback");
    }
    // The native dispatcher, not the caller, supplies reconnect evidence.
    using (var c = new Case(baseline, adoption.Ownership)) {
      string nonce = new string('d',64);
      JsonDocument Request(string operation, object payload, string digest = null) => JsonDocument.Parse(SessionProtocol.Reply(
        JsonSerializer.SerializeToUtf8Bytes(new { version = 1, operation, nonce, planDigest = digest ?? new string('0',64), payload }), nonce, c.Session, c.Machine));
      using var preview = Request("PREVIEW", c.Intent);
      var p = preview.RootElement.GetProperty("value");
      Check(p.GetProperty("ReconnectRequired").GetBoolean() && !p.GetProperty("RestartRequired").GetBoolean(), "native preview contract exposes exact activation route");
      using var applied = Request("APPLY", new { Token = p.GetProperty("Token").GetString() }, p.GetProperty("PlanDigest").GetString());
      Check(applied.RootElement.GetProperty("value").GetProperty("Status").GetString() == "RECONNECT_REQUIRED", "native reply keeps rate pending");
      byte[] saved = c.Bytes.ToArray();
      foreach (object forged in new object[] { new { Reconnected = true }, new { DeviceId = target.Id }, new { Event = "STARTED" } }) {
        using var refused = Request("RECONCILE", forged);
        Check(!refused.RootElement.GetProperty("ok").GetBoolean() && saved.SequenceEqual(c.Bytes.ToArray()), "caller-provided reconnect evidence rejected");
      }
      using var waiting = Request("RECONCILE", new { });
      Check(waiting.RootElement.GetProperty("value").GetProperty("DeviceName").GetString() == target.Name, "native reply binds display name to pending target");
      c.Machine.Cycle(); using var done = Request("RECONCILE", new { });
      Check(done.RootElement.GetProperty("value").GetProperty("Status").GetString() == "CONFIGURATION_VERIFIED", "native dispatcher completes observed cycle");
    }
    // Completed schema 3 retains normal unrelated-inventory refresh behavior.
    {
      var expected = baseline with { PlatformDigest = new string('a',64) };
      var keyboard = new DeviceSetting(LifecycleSession.Digest(@"USB\VID_1C4F&PID_5C44\FIXTURE"), LifecycleSession.Digest("keyboard-scope"), true, "UNKNOWN", false,
        new FilterValue(false, Array.Empty<string>()), new DwordValue(false,null), "Hardware", "Backup keyboard", false,
        IntervalBinding.Create(@"USB\VID_1C4F&PID_5C44\FIXTURE", "Hardware"), true);
      var next = expected with { Devices = expected.Devices.Append(keyboard).ToArray() };
      using var c = new Case(expected, adoption.Ownership, 3); c.Machine.State = next;
      Check(InventoryReconciliation.CanRefresh(c.Record, next), "completed schema 3 can refresh unrelated unconfigured USB inventory");
      Check(c.Session.Reconcile().Status == "INVENTORY_REFRESHED" && c.Record.SchemaVersion == 3, "inventory refresh never downgrades new history");
    }
    // Full-Speed standard filtering is also a reconnect-only rate change.
    {
      var full = baseline with { Devices = new[] { target with { Speed = "FULL" } },
        Service = baseline.Service with { File = new DriverIdentity(LifecycleSession.HashForVariant("NOPATCH"), "NOPATCH") } };
      var owned = LifecycleSession.Plan(full, install with { Action = "ADOPT", RequestedHz = null }, empty).Ownership;
      var rate = LifecycleSession.Plan(full, install with { Action = "APPLY", RequestedHz = 500, AcknowledgePatching = false }, owned);
      Check(rate.ReconnectRequired && !rate.RestartRequired && rate.After.Devices[0].Interval.Value == 2, "Full-Speed already-installed device uses reconnect route");
    }
    // Old schema-2 pending APPLY retains its original full-restart contract.
    using (var c = new Case(baseline, adoption.Ownership)) {
      var old = LifecycleSession.Plan(baseline, c.Intent, adoption.Ownership) with { ReconnectRequired = false, RestartRequired = true };
      Check(!JsonSerializer.Serialize(old).Contains("ReconnectRequired"), "old plan serialization remains byte compatible");
      c.Log.Append(JsonSerializer.Serialize(new LifecycleRecord(old.After, adoption.Ownership,
        new PendingOperation(new string('a',64), baseline, old), false, 2)), c.Log.Revision);
      c.Machine.State = old.After;
      Check(c.Session.Reconcile().Status == "RESTART_REQUIRED" && c.Machine.Registrations == 0, "legacy pending cannot silently become reconnect");
      c.Machine.State = old.After with { BootId = BootSessionChecks.Next(old.After.BootId) };
      Check(c.Session.Reconcile().Status == "CONFIGURATION_VERIFIED", "legacy restart still completes");
    }
    using (var c = new Case(baseline, adoption.Ownership)) {
      var p = LifecycleSession.Plan(baseline, c.Intent, adoption.Ownership);
      c.Log.Append(JsonSerializer.Serialize(new LifecycleRecord(p.After, adoption.Ownership,
        new PendingOperation(new string('a',64), baseline, p), false, 2)), c.Log.Revision);
      byte[] saved = c.Bytes.ToArray(); Refuse(() => c.Session.Reconcile(), "JOURNAL_SCHEMA_REVIEW_REQUIRED");
      Check(saved.SequenceEqual(c.Bytes.ToArray()) && c.Machine.Observations == 0, "reconnect mislabeled as schema 2 rejected before observation");
    }
    var stopped = baseline with { Service = baseline.Service with { Service = baseline.Service.Service with { State = 1 } } };
    var rateIntent = install with { Action = "APPLY", RequestedHz = 1000 };
    var stoppedPlan = LifecycleSession.Plan(stopped, rateIntent, adoption.Ownership);
    Check(stoppedPlan.RestartRequired && !stoppedPlan.ReconnectRequired, "stopped driver not misclassified as rate-only activation");
    foreach (string action in new[] { "INSTALL", "DETACH" }) {
      var p = action == "INSTALL" ? LifecycleSession.Plan(initial, install, empty)
        : LifecycleSession.Plan(baseline, install with { Action = "DETACH", RequestedHz = null }, adoption.Ownership);
      Check(p.RestartRequired && !p.ReconnectRequired, "lifecycle restart retained: " + action);
    }
    NotificationChecks(target.Coordinate.InstanceId);
    var choice = SetupPresentation.Actions.Single(x => x.Code == "APPLY");
    string review = SetupPresentation.Review(choice, "Fixture Edge", 1000, "PATCH_4K_8K", false, true);
    Check(review.Contains("same port") && review.Contains("automatically") && review.Contains("does not require a Windows restart"), "plain reconnect review");
    foreach (string status in new[] { "RECONNECT_REQUIRED", "RECONNECT_WAITING_FOR_DEVICE" }) {
      string text = SetupPresentation.ResultText(status, deviceName: target.Name);
      Check(SetupPresentation.IsReconnectPending(status) && text.Contains("Fixture Edge") && !text.Contains(target.Id), "pending target named without technical ID");
    }
    Check(!SetupPresentation.IsReconnectPending("CONFIGURATION_VERIFIED") && SetupPresentation.ResultText("ALREADY_CONFIGURED").Contains("Nothing was changed"), "poll stops and same-rate message truthful");
    Console.WriteLine("closed-device-reconnect-pass:" + checks);
  }
  static void NotificationChecks(string instance) {
    Check(Marshal.SizeOf<WindowsDeviceReconnectWatch.NotificationFilter>() == 416 &&
      Marshal.OffsetOf<WindowsDeviceReconnectWatch.NotificationFilter>("InstanceId").ToInt32() == 16, "SDK filter ABI x64 size and offset");
    var good = new byte[8].Concat(Encoding.Unicode.GetBytes(instance + "\0")).ToArray(); good[0] = 2;
    Check(WindowsDeviceReconnectWatch.DecodeInstance(good) == instance, "bounded device instance event decode");
    foreach (var bytes in new[] { Array.Empty<byte>(), good[..^2], new byte[410], new byte[9], good.Select((b,i) => i == 0 ? (byte)0 : b).ToArray(), good.Select((b,i) => i == 4 ? (byte)1 : b).ToArray() })
      Refuse(() => WindowsDeviceReconnectWatch.DecodeInstance(bytes), "notification");
    var sequence = new DeviceReconnectSequence(instance);
    foreach (uint action in new uint[] { 0, 1, 2, 3, 4, 5, 6, 10, uint.MaxValue }) sequence.Accept(instance, action);
    Check(!sequence.Read().Removed && !sequence.Read().Started, "interface and query-remove events cannot substitute for instance removal/start");
    sequence.Accept(instance.ToLowerInvariant(), 9); sequence.Accept(instance.ToLowerInvariant(), 8);
    Check(sequence.Read().Started, "case-insensitive exact Windows ID");
    sequence.Accept(instance, 9); Check(!sequence.Read().Started && sequence.Read().Removed, "second removal invalidates completed cycle");
  }
}
