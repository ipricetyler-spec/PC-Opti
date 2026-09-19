using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using Dialed.HidusbfHelper;

static class InventoryReconciliationChecks {
  static int checks;
  static void Check(bool value, string reason) { if (!value) throw new Exception("Inventory reconciliation: " + reason); checks++; }
  static void Refuse(Action action, string reason) {
    try { action(); }
    catch (InvalidOperationException error) { Check(error.Message.Contains(reason), "refusal: " + error.Message); return; }
    throw new Exception("Inventory reconciliation: expected refusal " + reason);
  }
  static LifecycleRecord Read(JournalLog log) => JsonSerializer.Deserialize<LifecycleRecord>(log.LastPayload);
  static void Seed(JournalLog log, LifecycleRecord record) => log.Append(JsonSerializer.Serialize(record), log.Revision);
  static DeviceSetting DefaultDevice(string instance, string name, string speed = "UNKNOWN") => new DeviceSetting(
    LifecycleSession.Digest(instance), LifecycleSession.Digest(instance + "-scope"), true, speed, false,
    new FilterValue(false, Array.Empty<string>()), new DwordValue(false, null), "Hardware", name, false,
    IntervalBinding.Create(instance, "Hardware"), true);

  sealed class MemoryMachine : ILifecycleMachine {
    public LifecycleObservation State;
    public Func<int, LifecycleObservation> OnObserve;
    public int Observations, Executions;
    public LifecycleObservation Observe() { Observations++; return OnObserve == null ? State : OnObserve(Observations); }
    public void Execute(NativePlan plan, LifecycleObservation before, Action assertPeer) { Executions++; throw new Exception("Unexpected execution during inventory refresh."); }
  }

  public static void Run(LifecycleObservation initial, LifecycleIntent install) {
    var installed = LifecycleSession.Plan(initial, install, new LifecycleOwnership(false, new Dictionary<string, SavedDevice>())).After;
    var target = installed.Devices[0] with { IntervalLocation = "Driver", Interval = new DwordValue(true, 1),
      Coordinate = IntervalBinding.Create(installed.Devices[0].Coordinate.InstanceId, "Driver", @"{36fc9e60-c465-11cf-8056-444553540000}\0030") };
    var hub = DefaultDevice(@"USB\VID_174C&PID_2074\HUB", "USB hub", "HIGH");
    var keyboard = DefaultDevice(@"USB\VID_1C4F&PID_5C44\KEYBOARD", "Spare keyboard");
    var headset = DefaultDevice(@"USB\VID_10F5&PID_2267\HEADSET", "Existing headset") with { Filters = new FilterValue(true, new[] { "hidusbf" }) };
    var baseline = installed with { PlatformDigest = new string('a', 64), Devices = new[] { target, hub, headset },
      Service = installed.Service with { Service = installed.Service.Service with { State = 4 } } };
    var adopt = install with { Action = "ADOPT", RequestedHz = null };
    var ownership = LifecycleSession.Plan(baseline, adopt, new LifecycleOwnership(false, new Dictionary<string, SavedDevice>())).Ownership;
    var record = new LifecycleRecord(baseline, ownership, null, false, 2);
    var next = baseline with { Devices = new[] { target, hub with { InterfaceDigest = LifecycleSession.Digest("hub with keyboard") }, headset, keyboard } };
    var apply = install with { Action = "APPLY", RequestedHz = 1000 };

    Check(InventoryReconciliation.CanRefresh(record, next), "keyboard plus hub descendants accepted");
    Check(!InventoryReconciliation.CanRefresh(record, baseline), "no change is not a refresh");
    Check(InventoryReconciliation.CanRefresh(record, baseline with { Devices = baseline.Devices.Reverse().ToArray() }), "enumeration order may refresh without changing identities");
    foreach (var changed in new[] {
      hub with { Present = false, Speed = "UNKNOWN", InterfaceDigest = LifecycleSession.Digest("absent hub") },
      hub with { Name = "Renamed hub" }, hub with { InterfaceDigest = LifecycleSession.Digest("different children") }
    }) Check(InventoryReconciliation.CanRefresh(record, baseline with { Devices = new[] { target, changed, headset } }), "only unconfigured topology changes accepted");
    Check(InventoryReconciliation.CanRefresh(record with { Ownership = ownership with { ServiceOwned = true } }, next), "owned service may retain its existing ownership");

    var drifts = new Dictionary<string, Func<LifecycleObservation, LifecycleObservation>> {
      ["boot plus inventory"] = x => x with { BootId = BootSessionChecks.Next(x.BootId) },
      ["security"] = x => x with { SecurityAccepted = false },
      ["memory integrity"] = x => x with { MemoryIntegrity = true },
      ["platform"] = x => x with { PlatformDigest = new string('e', 64) },
      ["shared driver bytes"] = x => x with { Service = x.Service with { File = x.Service.File with { Sha256 = new string('e', 64) } } },
      ["service state"] = x => x with { Service = x.Service with { Service = x.Service.Service with { State = 1 } } },
      ["patch parameter"] = x => x with { Service = x.Service with { ServiceParameters = new PatchParameters(true, new DwordValue(true, 3), new DwordValue(false, null)) } },
      ["missing target"] = x => x with { Devices = x.Devices.Where(d => d.Id != target.Id).ToArray() },
      ["missing unrelated installed record"] = x => x with { Devices = x.Devices.Where(d => d.Id != hub.Id).ToArray() },
      ["duplicate ID"] = x => x with { Devices = x.Devices.Append(keyboard).ToArray() },
      ["duplicate fingerprint"] = x => x with { Devices = x.Devices.Select(d => d.Id == keyboard.Id ? d with { InterfaceDigest = target.InterfaceDigest } : d).ToArray() },
      ["null record"] = x => x with { Devices = x.Devices.Append(null).ToArray() },
      ["missing inventory"] = x => x with { Devices = null },
      ["empty inventory"] = x => x with { Devices = Array.Empty<DeviceSetting>() }
    };
    foreach (var mutation in new Dictionary<string, Func<DeviceSetting, DeviceSetting>> {
      ["target disconnected"] = x => x with { Present = false },
      ["target fingerprint"] = x => x with { InterfaceDigest = new string('e', 64) },
      ["target ineligible"] = x => x with { Eligible = false },
      ["target unauthorized"] = x => x with { Authorized = false },
      ["target interval"] = x => x with { Interval = new DwordValue(true, 2) },
      ["target filter"] = x => x with { Filters = new FilterValue(false, Array.Empty<string>()) },
      ["target alias"] = x => x with { IntervalIsolated = false },
      ["target remap"] = x => x with { Coordinate = IntervalBinding.Create(x.Coordinate.InstanceId, "Driver", @"{36fc9e60-c465-11cf-8056-444553540000}\0031") }
    }) drifts[mutation.Key] = x => x with { Devices = x.Devices.Select(d => d.Id == target.Id ? mutation.Value(d) : d).ToArray() };
    foreach (var mutation in new Dictionary<string, Func<DeviceSetting, DeviceSetting>> {
      ["eligible addition"] = x => x with { Eligible = true },
      ["authorized addition"] = x => x with { Authorized = true },
      ["HIDUSBF addition"] = x => x with { Filters = new FilterValue(true, new[] { "HIDUSBF" }) },
      ["third-party filter addition"] = x => x with { Filters = new FilterValue(true, new[] { "external" }) },
      ["present empty filter"] = x => x with { Filters = new FilterValue(true, Array.Empty<string>()) },
      ["configured addition"] = x => x with { Interval = new DwordValue(true, 1) },
      ["malformed absent interval"] = x => x with { Interval = new DwordValue(false, 1) },
      ["missing coordinate"] = x => x with { Coordinate = null },
      ["interval alias"] = x => x with { IntervalIsolated = false },
      ["different view"] = x => x with { Coordinate = x.Coordinate with { RegistryView = "Registry32" } },
      ["different concrete control set"] = x => x with { Coordinate = IntervalBinding.Create(x.Coordinate.InstanceId, "Hardware", controlSet: "ControlSet002") },
      ["wrong value"] = x => x with { Coordinate = x.Coordinate with { ValueName = "Other" } },
      ["driver-key alias"] = x => x with { IntervalLocation = "Driver", Coordinate = target.Coordinate with { InstanceId = x.Coordinate.InstanceId } },
      ["invalid ID binding"] = x => x with { Id = new string('e', 64) },
      ["invalid fingerprint"] = x => x with { InterfaceDigest = "unbound" },
      ["unknown speed representation"] = x => x with { Speed = "INVALID" },
      ["null filters"] = x => x with { Filters = null },
      ["absent filter with data"] = x => x with { Filters = new FilterValue(false, new[] { "hidden" }) }
    }) drifts[mutation.Key] = x => x with { Devices = x.Devices.Select(d => d.Id == keyboard.Id ? mutation.Value(d) : d).ToArray() };
    drifts["existing unconfigured key remap"] = x => x with { Devices = x.Devices.Select(d => d.Id == hub.Id ? d with { Coordinate = IntervalBinding.Create(hub.Coordinate.InstanceId, "Hardware", controlSet: "ControlSet002") } : d).ToArray() };
    drifts["unselected filtered device presence"] = x => x with { Devices = x.Devices.Select(d => d.Id == headset.Id ? d with { Present = false } : d).ToArray() };
    drifts["unselected filtered device descendants"] = x => x with { Devices = x.Devices.Select(d => d.Id == headset.Id ? d with { InterfaceDigest = new string('e', 64) } : d).ToArray() };
    foreach (var drift in drifts) {
      var changed = drift.Value(next);
      Check(!InventoryReconciliation.CanRefresh(record, changed), "reject " + drift.Key);
      using var bytes = new MemoryStream(); using var log = new JournalLog(bytes); Seed(log, record);
      byte[] original = bytes.ToArray(); var machine = new MemoryMachine { State = changed }; var session = new LifecycleSession(log, machine, () => { });
      Refuse(() => session.Reconcile(), "NEEDS_REVIEW");
      Check(bytes.ToArray().SequenceEqual(original) && machine.Executions == 0, "reconcile preserves history on " + drift.Key);
      Refuse(() => session.Preview(apply), "NEEDS_REVIEW");
      Check(Read(log).NeedsReview && LifecycleSession.Digest(Read(log).Ownership) == LifecycleSession.Digest(ownership), "dangerous drift still latches review: " + drift.Key);
    }

    foreach (var badRecord in new[] {
      record with { NeedsReview = true }, record with { SchemaVersion = 1 },
      record with { Expected = baseline with { BootId = "" } },
      record with { Expected = baseline with { PlatformDigest = "" } },
      record with { Ownership = new LifecycleOwnership(false, new Dictionary<string, SavedDevice> { [target.Id] = ownership.Devices[target.Id] with { Interval = null } }) },
      record with { Ownership = new LifecycleOwnership(false, new Dictionary<string, SavedDevice> { [new string('e', 64)] = ownership.Devices[target.Id] }) },
      record with { Ownership = new LifecycleOwnership(false, new Dictionary<string, SavedDevice> { [target.Id] = ownership.Devices[target.Id] with { Coordinate = hub.Coordinate } }) }
    }) Check(!InventoryReconciliation.CanRefresh(badRecord, next), "ambiguous/unusable baseline refused");
    Check(!InventoryReconciliation.CanRefresh(null, next) && !InventoryReconciliation.CanRefresh(record, null), "missing observation or journal refused");
    Check(!InventoryReconciliation.CanRefresh(record, next with { Devices = Enumerable.Repeat(keyboard, 4097).ToArray() }), "bounded inventory");

    ExerciseSession(record, next, apply);
    // Refresh must not interfere with pending completion or clear a prior review.
    // Preserve this existing schema-2 restart-pending regression. New reconnect
    // records have separate schema-3 interruption/drift coverage.
    var plan = LifecycleSession.Plan(baseline, apply, ownership) with { RestartRequired = true, ReconnectRequired = false };
    foreach (var blocked in new[] { record with { NeedsReview = true }, record with { Pending = new PendingOperation(new string('d', 64), baseline, plan) } }) {
      Check(!InventoryReconciliation.CanRefresh(blocked, next), "pending/review classification refuses");
      using var log = new JournalLog(new MemoryStream()); Seed(log, blocked);
      var machine = new MemoryMachine { State = next }; var session = new LifecycleSession(log, machine, () => { });
      Refuse(() => session.Preview(apply), "NEEDS_REVIEW"); Refuse(() => session.Reconcile(), "NEEDS_REVIEW");
      Check(Read(log).NeedsReview && LifecycleSession.Digest(Read(log).Expected) == LifecycleSession.Digest(baseline) && machine.Executions == 0, "pending/review keeps original expectation");
      Check(LifecycleSession.Digest(Read(log).Pending) == LifecycleSession.Digest(blocked.Pending), "pending evidence retained");
    }
    CheckPresentation();
    Console.WriteLine("closed-inventory-reconciliation-pass:" + checks);
  }

  static void ExerciseSession(LifecycleRecord record, LifecycleObservation next, LifecycleIntent apply) {
    using (var bytes = new MemoryStream()) using (var log = new JournalLog(bytes)) {
      Seed(log, record); var machine = new MemoryMachine { State = record.Expected }; var session = new LifecycleSession(log, machine, () => { });
      var oldPreview = session.Preview(apply); byte[] original = bytes.ToArray(); machine.State = next;
      Refuse(() => session.Preview(apply), "INVENTORY_RECONCILE_REQUIRED");
      Check(bytes.ToArray().SequenceEqual(original) && !Read(log).NeedsReview, "preview refuses without poisoning journal");
      machine.State = record.Expected; Refuse(() => session.Apply(oldPreview.Token, oldPreview.PlanDigest), "Preview missing");
      machine.State = next; machine.Observations = 0; string originals = LifecycleSession.Digest(Read(log).Ownership); long revision = log.Revision;
      Check(session.Reconcile().Status == "INVENTORY_REFRESHED", "explicit refresh succeeds");
      Check(machine.Observations == 2 && machine.Executions == 0, "two observations and zero device executions");
      Check(log.Revision == revision + 1 && LifecycleSession.Digest(Read(log).Ownership) == originals, "one append preserves exact originals and service ownership");
      Check(!Read(log).NeedsReview && Read(log).Pending == null && LifecycleSession.Digest(Read(log).Expected) == LifecycleSession.Digest(next), "complete refreshed expectation saved");
      var preview = session.Preview(apply);
      Check(preview.Plan.BeforeDigest == LifecycleSession.Digest(next), "new preview binds refreshed complete inventory");
      Check(LifecycleSession.Digest(preview.Plan.Ownership) == originals, "rate preview preserves originals");
      revision = log.Revision; Check(session.Reconcile().Status == "CONFIGURATION_VERIFIED" && log.Revision == revision, "repeated check does not append");
      var restore = session.Preview(apply with { Action = "DETACH", RequestedHz = null });
      var restored = restore.Plan.After.Devices.Single(x => x.Id == apply.DeviceId);
      Check(restored.Interval == record.Ownership.Devices[apply.DeviceId].Interval && restored.Coordinate == record.Ownership.Devices[apply.DeviceId].Coordinate,
        "restore still uses recorded originals and coordinates");
    }
    // Clicking the existing explicit check may refresh without first attempting
    // a preview. It must also revoke previews made before the connection change.
    using (var log = new JournalLog(new MemoryStream())) {
      Seed(log, record); var machine = new MemoryMachine { State = record.Expected }; var session = new LifecycleSession(log, machine, () => { });
      var old = session.Preview(apply); machine.State = next; session.Reconcile();
      Refuse(() => session.Apply(old.Token, old.PlanDigest), "Preview missing"); Check(machine.Executions == 0, "refresh revokes old preview");
    }
    using (var bytes = new MemoryStream()) using (var log = new JournalLog(bytes)) {
      Seed(log, record); var machine = new MemoryMachine { State = record.Expected }; var session = new LifecycleSession(log, machine, () => { });
      var old = session.Preview(apply); byte[] original = bytes.ToArray(); machine.State = next;
      Refuse(() => session.Apply(old.Token, old.PlanDigest), "INVENTORY_RECONCILE_REQUIRED");
      Check(bytes.ToArray().SequenceEqual(original) && machine.Executions == 0, "stale apply neither creates pending intent nor writes");
    }
    foreach (string race in new[] { "INVENTORY", "PROTECTED", "PEER", "INPLACE" }) {
      using var bytes = new MemoryStream(); using var log = new JournalLog(bytes); Seed(log, record); byte[] original = bytes.ToArray();
      var snapshot = JsonSerializer.Deserialize<LifecycleObservation>(JsonSerializer.Serialize(next));
      var machine = new MemoryMachine { State = snapshot };
      machine.OnObserve = n => {
        if (n == 1 || race == "PEER") return snapshot;
        if (race == "INPLACE") { snapshot.Devices[0] = snapshot.Devices[0] with { Interval = new DwordValue(true, 99) }; return snapshot; }
        return race == "INVENTORY" ? record.Expected : snapshot with { SecurityAccepted = false };
      };
      int peerChecks = 0; var session = new LifecycleSession(log, machine, () => { if (++peerChecks == 3 && race == "PEER") throw new InvalidOperationException("peer gone"); });
      Refuse(() => session.Reconcile(), race == "PEER" ? "peer gone" : "INVENTORY_REFRESH_UNSTABLE");
      Check(bytes.ToArray().SequenceEqual(original) && machine.Executions == 0, "unstable refresh preserves journal: " + race);
    }
    // Exercise the actual request dispatcher with no WindowsMachine or pipe.
    using (var log = new JournalLog(new MemoryStream())) {
      Seed(log, record); var machine = new MemoryMachine { State = next }; var session = new LifecycleSession(log, machine, () => { }); string nonce = new string('a', 64);
      byte[] Request(string operation, object payload) => JsonSerializer.SerializeToUtf8Bytes(new { version = 1, operation, nonce, planDigest = new string('0', 64), payload });
      using var refusal = JsonDocument.Parse(SessionProtocol.Reply(Request("PREVIEW", apply), nonce, session, machine));
      Check(!refusal.RootElement.GetProperty("ok").GetBoolean() && refusal.RootElement.GetProperty("error").GetString().StartsWith("INVENTORY_RECONCILE_REQUIRED:"), "request boundary gives actionable refusal");
      using var refreshed = JsonDocument.Parse(SessionProtocol.Reply(Request("RECONCILE", new { }), nonce, session, machine));
      Check(refreshed.RootElement.GetProperty("ok").GetBoolean() && refreshed.RootElement.GetProperty("value").GetProperty("Status").GetString() == "INVENTORY_REFRESHED", "explicit request returns new status");
      using var rejected = JsonDocument.Parse(SessionProtocol.Reply(Request("RECONCILE", new { Expected = next }), nonce, session, machine));
      Check(!rejected.RootElement.GetProperty("ok").GetBoolean(), "caller cannot supply replacement inventory");
      Check(machine.Executions == 0, "protocol refresh makes no device call");
    }
  }

  static void CheckPresentation() {
    foreach (string code in new[] { "INVENTORY_RECONCILE_REQUIRED: change", "INVENTORY_REFRESH_UNSTABLE: changed again" }) {
      Check(SetupPresentation.IsInventoryRefusal(code) && !SetupPresentation.IsHistoryRefusal(code), "inventory refusal keeps explicit refresh available");
      string text = SetupPresentation.FailureText(code);
      Check(text.Contains("Refresh USB inventory") && text.Contains("original settings stay intact"), "actionable preservation message");
    }
    Check(!SetupPresentation.IsInventoryRefusal("NEEDS_REVIEW: changed driver") && !SetupPresentation.IsInventoryRefusal(null), "other refusals not relabeled");
    Check(SetupPresentation.ReconcileLabel(true) == "Refresh USB inventory" && SetupPresentation.ReconcileLabel(false) == "Check saved operation", "button matches requested recovery action");
    foreach (bool enabled in new[] { false, true }) foreach (bool changed in new[] { false, true }) foreach (bool selected in new[] { false, true })
      Check(SetupPresentation.CanPreview(enabled, changed, selected ? SetupPresentation.Actions[0] : null) == (enabled && !changed && selected), "preview pauses until inventory refresh");
    string result = SetupPresentation.ResultText("INVENTORY_REFRESHED");
    Check(result.Contains("ownership are unchanged") && result.Contains("no restart") && result.Contains("new preview"), "refresh result limits and next action");
  }

  // The input contains derived captured observations, never a live protected
  // journal path. All writes below are to MemoryStream; no OS adapter is created.
  public static void RunCaptured(string path) {
    using var document = JsonDocument.Parse(File.ReadAllBytes(path));
    int cases = 0;
    foreach (var item in document.RootElement.EnumerateArray()) {
      var record = JsonSerializer.Deserialize<LifecycleRecord>(item.GetProperty("Record").GetRawText());
      var current = JsonSerializer.Deserialize<LifecycleObservation>(item.GetProperty("Current").GetRawText());
      var target = record.Ownership.Devices.Single();
      Check(InventoryReconciliation.CanRefresh(record, current), "captured unrelated inventory difference accepted");
      ExerciseSession(record, current, new LifecycleIntent("APPLY", target.Key, target.Value.InterfaceDigest, 1000, true)); cases++;
    }
    Console.WriteLine("closed-captured-inventory-pass:" + cases + ":" + checks);
  }
}
