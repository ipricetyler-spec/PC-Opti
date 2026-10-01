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
    // A later Windows session may accompany unrelated inventory (2026-09-28: the owner's PC was
    // stuck after restarts plus a plugged-in keyboard). An unusable session identity may not.
    Check(InventoryReconciliation.CanRefresh(record, next with { BootId = BootSessionChecks.Next(next.BootId) }), "later boot plus inventory accepted");
    Check(!InventoryReconciliation.CanRefresh(record, next with { BootId = "not-a-boot-session" }), "unusable boot identity refused");
    // The real platform fingerprint names every eligible device (WindowsMachine.Observe), so a newly
    // plugged eligible mouse changes it. Build both fingerprints the way the machine does.
    {
      Func<string, Func<IEnumerable<string>, string>> core = xhci => scopes => ScopeDigests.Platform("10.0.26200.0", 1u, 1, xhci, "ABSENT", scopes);
      var platformFor = core("xhci-a");
      IEnumerable<string> Eligible(LifecycleObservation o) => o.Devices.Where(d => d.Eligible).Select(d => d.InterfaceDigest);
      var realBaseline = baseline with { PlatformDigest = platformFor(Eligible(baseline)) };
      var realRecord = record with { Expected = realBaseline };
      var mouse = DefaultDevice(@"USB\VID_046D&PID_C547\MOUSE", "New mouse", "FULL") with { Eligible = true };
      var plugged = realBaseline with { Devices = realBaseline.Devices.Append(mouse).ToArray() };
      plugged = plugged with { PlatformDigest = platformFor(Eligible(plugged)) };
      Check(plugged.PlatformDigest != realBaseline.PlatformDigest, "an eligible device changes the real platform fingerprint");
      Check(!InventoryReconciliation.CanRefresh(realRecord, plugged), "without the machine's recomputation the comparison stays exact");
      Check(InventoryReconciliation.CanRefresh(realRecord, plugged, platformFor), "a newly plugged eligible device alone is refreshable");
      var updated = plugged with { PlatformDigest = core("xhci-b")(Eligible(plugged)) };
      Check(!InventoryReconciliation.CanRefresh(realRecord, updated, core("xhci-b")), "a changed USB controller driver is still refused");
    }
    // An absent entry with nothing setup reads or writes may disappear; anything else may not.
    var staleStick = DefaultDevice(@"USB\VID_0781&PID_5575\STICK", "Old USB stick") with { Present = false };
    var withStale = record with { Expected = baseline with { Devices = baseline.Devices.Append(staleStick).ToArray() } };
    Check(InventoryReconciliation.CanRefresh(withStale, next), "absent unconfigured entry may be removed");
    Check(InventoryReconciliation.CanRefresh(withStale, next with { BootId = BootSessionChecks.Next(next.BootId) }), "stale removal across a restart accepted");
    foreach (var kept in new[] { staleStick with { Present = true }, staleStick with { Filters = new FilterValue(true, new[] { "hidusbf" }) },
      staleStick with { Interval = new DwordValue(true, 1) }, staleStick with { Eligible = true }, staleStick with { Authorized = true } })
      Check(!InventoryReconciliation.CanRefresh(record with { Expected = baseline with { Devices = baseline.Devices.Append(kept).ToArray() } }, next), "present or configured entry may not disappear");

    var drifts = new Dictionary<string, Func<LifecycleObservation, LifecycleObservation>> {
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
    // A newly plugged input device is eligible and, under a release policy, authorized, with
    // nothing on it configured; that is inventory, not drift.
    foreach (var plugged in new[] { keyboard with { Eligible = true }, keyboard with { Authorized = true }, keyboard with { Eligible = true, Authorized = true, Speed = "FULL" } })
      Check(InventoryReconciliation.CanRefresh(record, next with { Devices = next.Devices.Select(d => d.Id == keyboard.Id ? plugged : d).ToArray() }), "untouched new input device accepted");
    // A new policy may authorize a device setup does not own; its settings must not move.
    Check(InventoryReconciliation.CanRefresh(record, baseline with { Devices = new[] { target, hub, headset with { Authorized = true } } }), "policy-only authorization change on an unowned device accepted");
    Check(!InventoryReconciliation.CanRefresh(record, baseline with { Devices = new[] { target, hub, headset with { Authorized = true, Interval = new DwordValue(true, 1) } } }), "authorization change cannot hide a setting change");
    Check(!InventoryReconciliation.CanRefresh(record, baseline with { Devices = new[] { target with { Authorized = false }, hub, headset } }), "owned target authorization stays exact");
    foreach (var mutation in new Dictionary<string, Func<DeviceSetting, DeviceSetting>> {
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
    DriftRecovery(record, target, apply);
    // Refresh must not interfere with pending completion or clear a prior review.
    // Preserve this existing schema-2 restart-pending regression. New reconnect
    // records have separate schema-3 interruption/drift coverage.
    var plan = LifecycleSession.Plan(baseline, apply, ownership) with { RestartRequired = true, ReconnectRequired = false };
    foreach (var blocked in new[] { record with { NeedsReview = true }, record with { Pending = new PendingOperation(new string('d', 64), baseline, plan) } }) {
      Check(!InventoryReconciliation.CanRefresh(blocked, next), "pending/review classification refuses");
      using var log = new JournalLog(new MemoryStream()); Seed(log, blocked);
      var machine = new MemoryMachine { State = next }; var session = new LifecycleSession(log, machine, () => { });
      // A saved change still running its own check is named as such, so setup offers Check saved operation, not a review.
      Refuse(() => session.Preview(apply), blocked.Pending != null ? "PENDING_OPERATION" : "NEEDS_REVIEW"); Refuse(() => session.Reconcile(), "NEEDS_REVIEW");
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

  // The only way out of a latched review: show exactly what differs, then keep the current state
  // as the baseline only if it is still exactly what was shown. Originals and devices never change.
  static void DriftRecovery(LifecycleRecord record, DeviceSetting target, LifecycleIntent apply) {
    var drifted = record.Expected with { Devices = record.Expected.Devices.Select(d => d.Id == target.Id ? d with { Interval = new DwordValue(true, 4) } : d).ToArray() };
    var latched = record with { NeedsReview = true };
    using (var bytes = new MemoryStream()) using (var log = new JournalLog(bytes)) {
      Seed(log, latched); var machine = new MemoryMachine { State = drifted }; var session = new LifecycleSession(log, machine, () => { });
      Refuse(() => session.Preview(apply), "NEEDS_REVIEW");
      var review = session.ReviewDrift();
      Check(review.StateDigest == LifecycleSession.Digest(drifted), "review fingerprints what it saw");
      Check(review.Differences.Any(x => x.Contains("rate changed from ") && x.Contains(" Hz to ") && x.Contains("originals recorded")), "review names the owned device's changed rate in Hz");
      Check(!review.Differences.Any(x => x.Contains("interval") || x.Contains("identity") || x.Contains("policy")), "review avoids raw driver terms");
      byte[] original = bytes.ToArray();
      Refuse(() => session.AcceptCurrent(new string('e', 64)), "REVIEW_STALE");
      Refuse(() => session.AcceptCurrent("not a digest"), "REVIEW_STALE");
      Check(bytes.ToArray().SequenceEqual(original), "a stale or malformed acceptance writes nothing");
      long revision = log.Revision;
      Check(session.AcceptCurrent(review.StateDigest).Status == "BASELINE_ACCEPTED", "acceptance succeeds for the reviewed state");
      Check(log.Revision == revision + 1 && machine.Executions == 0, "one append and no device call");
      var saved = Read(log);
      Check(!saved.NeedsReview && saved.Pending == null && LifecycleSession.Digest(saved.Expected) == LifecycleSession.Digest(drifted), "review cleared and baseline is the reviewed state");
      Check(LifecycleSession.Digest(saved.Ownership) == LifecycleSession.Digest(latched.Ownership), "recorded originals are kept");
      Check(session.Preview(apply).Plan.BeforeDigest == LifecycleSession.Digest(drifted), "setup works again after acceptance");
      Refuse(() => session.ReviewDrift(), "NOTHING_TO_REVIEW");
    }
    foreach (var (name, state, code) in new[] {
      ("owned device moved", drifted with { Devices = drifted.Devices.Select(d => d.Id == target.Id ? d with { Coordinate = IntervalBinding.Create(d.Coordinate.InstanceId, "Driver", @"{36fc9e60-c465-11cf-8056-444553540000}\0031") } : d).ToArray() }, "OWNED_DEVICE_MOVED"),
      // Restore needs the device eligible and its scope unchanged, so acceptance may not promise it otherwise.
      ("owned device unplugged", drifted with { Devices = drifted.Devices.Select(d => d.Id == target.Id ? d with { Present = false, Eligible = false } : d).ToArray() }, "OWNED_DEVICE_MOVED"),
      ("owned device on another port", drifted with { Devices = drifted.Devices.Select(d => d.Id == target.Id ? d with { InterfaceDigest = LifecycleSession.Digest("other port") } : d).ToArray() }, "OWNED_DEVICE_MOVED"),
      ("security unknown", drifted with { SecurityAccepted = false }, "SECURITY_UNKNOWN"),
      ("unrecognized driver", drifted with { Service = drifted.Service with { File = drifted.Service.File with { Sha256 = new string('e', 64), Variant = null } } }, "UNRECOGNIZED_DRIVER"),
    }) {
      using var bytes = new MemoryStream(); using var log = new JournalLog(bytes); Seed(log, latched); byte[] original = bytes.ToArray();
      var session = new LifecycleSession(log, new MemoryMachine { State = state }, () => { });
      Refuse(() => session.ReviewDrift(), code);
      Refuse(() => session.AcceptCurrent(LifecycleSession.Digest(state)), code);
      Check(bytes.ToArray().SequenceEqual(original), "refused acceptance writes nothing: " + name);
    }
    var plan = LifecycleSession.Plan(record.Expected, apply, record.Ownership) with { RestartRequired = true, ReconnectRequired = false };
    using (var log = new JournalLog(new MemoryStream())) {
      // A saved change is finished by its own check; review is offered only once that check gave up.
      Seed(log, record with { Pending = new PendingOperation(new string('d', 64), record.Expected, plan) });
      Refuse(() => new LifecycleSession(log, new MemoryMachine { State = drifted }, () => { }).ReviewDrift(), "PENDING_OPERATION");
    }
    // A latched saved change: say whether it took effect and keep the matching originals.
    var unrelated = record.Expected.Devices.First(d => d.Id != target.Id);
    DeviceSetting[] WithTarget(DeviceSetting[] devices, DwordValue interval) => devices.Select(d => d.Id == target.Id ? d with { Interval = interval } : d.Id == unrelated.Id ? d with { Name = "Renamed elsewhere", Eligible = true } : d).ToArray();
    var plannedInterval = plan.After.Devices.Single(d => d.Id == target.Id).Interval;
    // The plan also records an original for a second, real device, as an install would.
    var withNewPlan = plan with { Ownership = new LifecycleOwnership(false, new Dictionary<string, SavedDevice>(plan.Ownership.Devices) {
      [unrelated.Id] = new SavedDevice(unrelated.InterfaceDigest, unrelated.Filters, unrelated.Interval, unrelated.IntervalLocation, unrelated.Coordinate) }) };
    foreach (var (outcome, interval, expectedOwnership, message) in new[] {
      ("APPLIED", plannedInterval, withNewPlan.Ownership, "was saved"),
      ("NOT_APPLIED", target.Interval, record.Ownership, "did not take effect"),
      ("UNCLEAR", new DwordValue(true, 2), withNewPlan.Ownership, "is unclear") }) {
      var reference = outcome == "NOT_APPLIED" ? record.Expected : withNewPlan.After;
      var state = reference with { Devices = WithTarget(reference.Devices, interval) };
      using var bytes = new MemoryStream(); using var log = new JournalLog(bytes);
      Seed(log, latched with { Pending = new PendingOperation(new string('d', 64), record.Expected, withNewPlan) });
      var session = new LifecycleSession(log, new MemoryMachine { State = state }, () => { });
      var review = session.ReviewDrift();
      Check(review.Differences[0].Contains(message), "pending outcome stated first: " + outcome);
      Check(review.Differences.Any(x => x.StartsWith("Renamed elsewhere")), "other differences still listed: " + outcome);
      Check(session.AcceptCurrent(review.StateDigest).Status == "BASELINE_ACCEPTED", "pending resolution accepted: " + outcome);
      var saved = Read(log);
      Check(saved.Pending == null && !saved.NeedsReview && LifecycleSession.Digest(saved.Expected) == LifecycleSession.Digest(state), "pending cleared with the reviewed baseline: " + outcome);
      // Unclear keeps every original, older first; the extra planned original is kept too.
      var kept = outcome == "UNCLEAR" ? new LifecycleOwnership(record.Ownership.ServiceOwned, new Dictionary<string, SavedDevice>(withNewPlan.Ownership.Devices) { [target.Id] = record.Ownership.Devices[target.Id] }) : expectedOwnership;
      Check(LifecycleSession.Digest(saved.Ownership.Devices.OrderBy(x => x.Key, StringComparer.Ordinal).ToArray()) == LifecycleSession.Digest(kept.Devices.OrderBy(x => x.Key, StringComparer.Ordinal).ToArray()) &&
        saved.Ownership.ServiceOwned == kept.ServiceOwned, "originals follow the outcome: " + outcome);
    }
    using (var log = new JournalLog(new MemoryStream())) {
      Seed(log, record);
      Refuse(() => new LifecycleSession(log, new MemoryMachine { State = record.Expected }, () => { }).ReviewDrift(), "NOTHING_TO_REVIEW");
    }
    // An expired policy leaves only restore and removal.
    using (var log = new JournalLog(new MemoryStream())) {
      Seed(log, record);
      var recovery = new LifecycleSession(log, new MemoryMachine { State = record.Expected }, () => { }) { RecoveryOnly = true };
      Refuse(() => recovery.Preview(apply), "POLICY_EXPIRED");
      Check(recovery.Preview(apply with { Action = "DETACH", RequestedHz = null }).Plan != null, "restore still previews when the policy expired");
    }
    // An unlatched record that setup updates on its own is not offered for acceptance.
    using (var log = new JournalLog(new MemoryStream())) {
      Seed(log, record);
      var refreshable = record.Expected with { Devices = record.Expected.Devices.Select(d => d.Id == unrelated.Id ? d with { Name = "Renamed elsewhere" } : d).ToArray() };
      Check(InventoryReconciliation.CanRefresh(record, refreshable), "renamed unowned device is refreshable");
      Refuse(() => new LifecycleSession(log, new MemoryMachine { State = refreshable }, () => { }).ReviewDrift(), "NOTHING_TO_REVIEW");
      Refuse(() => new LifecycleSession(log, new MemoryMachine { State = record.Expected with { BootId = BootSessionChecks.Next(record.Expected.BootId) } }, () => { }).ReviewDrift(), "NOTHING_TO_REVIEW");
    }
    // A driver changed outside Dialed is no longer claimed, so removal can never delete another tool's driver.
    using (var log = new JournalLog(new MemoryStream())) {
      var owning = latched with { Ownership = latched.Ownership with { ServiceOwned = true } };
      Seed(log, owning);
      var outside = drifted with { Service = drifted.Service with { Service = drifted.Service.Service with { Start = drifted.Service.Service.Start == 3u ? 2u : 3u } } };
      var session = new LifecycleSession(log, new MemoryMachine { State = outside }, () => { });
      var review = session.ReviewDrift();
      Check(review.Differences.Any(x => x.Contains("will not remove the driver")), "review states the ownership consequence");
      Check(session.AcceptCurrent(review.StateDigest).Status == "BASELINE_ACCEPTED" && !Read(log).Ownership.ServiceOwned, "a changed driver is no longer claimed");
    }
    using (var bytes = new MemoryStream()) using (var log = new JournalLog(bytes)) {
      // The PC changes between the two observations of the acceptance itself.
      Seed(log, latched); byte[] original = bytes.ToArray();
      var moved = drifted with { Devices = drifted.Devices.Select(d => d.Id == target.Id ? d with { Interval = new DwordValue(true, 2) } : d).ToArray() };
      var machine = new MemoryMachine { OnObserve = n => n <= 1 ? drifted : moved };
      Refuse(() => new LifecycleSession(log, machine, () => { }).AcceptCurrent(LifecycleSession.Digest(drifted)), "REVIEW_STALE");
      Check(bytes.ToArray().SequenceEqual(original), "a change during acceptance writes nothing");
    }
    using (var log = new JournalLog(new MemoryStream())) {
      Seed(log, latched); var machine = new MemoryMachine { State = drifted }; var session = new LifecycleSession(log, machine, () => { }); string nonce = new string('a', 64);
      byte[] Request(string operation, object payload) => JsonSerializer.SerializeToUtf8Bytes(new { version = 1, operation, nonce, planDigest = new string('0', 64), payload });
      using var extra = JsonDocument.Parse(SessionProtocol.Reply(Request("REVIEW_DRIFT", new { Accept = true }), nonce, session, machine));
      Check(!extra.RootElement.GetProperty("ok").GetBoolean(), "review takes no payload");
      using var missing = JsonDocument.Parse(SessionProtocol.Reply(Request("ACCEPT_CURRENT", new { }), nonce, session, machine));
      Check(!missing.RootElement.GetProperty("ok").GetBoolean(), "acceptance requires the reviewed fingerprint");
      using var accepted = JsonDocument.Parse(SessionProtocol.Reply(Request("ACCEPT_CURRENT", new { StateDigest = LifecycleSession.Digest(drifted) }), nonce, session, machine));
      Check(accepted.RootElement.GetProperty("ok").GetBoolean() && accepted.RootElement.GetProperty("value").GetProperty("Status").GetString() == "BASELINE_ACCEPTED", "protocol acceptance");
    }
    Check(SetupPresentation.IsDriftRefusal("NEEDS_REVIEW: external drift.") && SetupPresentation.IsDriftRefusal("NEEDS_REVIEW: external state changed."), "external drift offers review");
    Check(SetupPresentation.IsDriftRefusal("NEEDS_REVIEW: partial operation or external drift."), "a saved change whose check gave up offers review");
    Check(!SetupPresentation.IsDriftRefusal("JOURNAL_SCHEMA_REVIEW_REQUIRED: x") && !SetupPresentation.IsDriftRefusal("RECONNECT_UNSTABLE: x"), "history-format and transient problems do not offer acceptance");
    Check(SetupPresentation.FailureSummary("NEEDS_REVIEW: external drift.").Contains("Review what changed"), "drift summary names the button");
    Check(SetupPresentation.FailureSummary("OWNED_DEVICE_MOVED: a device moved.") == "A device moved.", "refusal reasons read as sentences");
    string text = SetupPresentation.DriftReviewText(new[] { "Mouse: filter drivers changed." });
    Check(text.Contains("•  Mouse: filter drivers changed.") && text.Contains("Nothing on your devices changes") && text.Contains("If you are unsure, cancel"), "review text lists changes and limits");
    Check(SetupPresentation.ResultText("BASELINE_ACCEPTED").Contains("originals are kept"), "acceptance result states what is kept");
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
    Check(result.Contains("ownership are unchanged") && result.Contains("no restart") && result.Contains("Choose a rate"), "refresh result limits and next action");
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
