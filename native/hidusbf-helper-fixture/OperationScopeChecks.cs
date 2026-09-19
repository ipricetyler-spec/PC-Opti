using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using Dialed.HidusbfHelper;

static class OperationScopeChecks {
  static int checks;
  static void Check(bool condition, string reason) { if (!condition) throw new Exception("Operation scope: " + reason); checks++; }
  static void Refuse(Action action, string message = null) {
    try { action(); } catch (InvalidOperationException error) {
      Check(message == null || error.Message.Contains(message), "refusal reason: " + error.Message); return;
    }
    throw new Exception("Operation scope: expected refusal");
  }
  const string Driver0 = @"{36fc9e60-c465-11cf-8056-444553540000}\0017";
  const string Driver1 = @"{36fc9e60-c465-11cf-8056-444553540000}\0018";
  static LifecycleOwnership Empty() => new LifecycleOwnership(false, new Dictionary<string, SavedDevice>());
  static LifecycleRecord Record(JournalLog log) => JsonSerializer.Deserialize<LifecycleRecord>(log.LastPayload);
  static DeviceSetting Device(string instance, bool eligible, bool present, string driver) => new DeviceSetting(
    LifecycleSession.Digest(instance), LifecycleSession.Digest(instance + "-interface"), present, "HIGH", eligible,
    new FilterValue(true, new[] { "external", "hidusbf", "other" }), new DwordValue(true, 1), "Driver", instance, eligible,
    IntervalBinding.Create(instance, "Driver", driver), true);

  public static void Run(LifecycleObservation initial, LifecycleIntent install) {
    var installed = LifecycleSession.Plan(initial, install, Empty()).After;
    var target = Device(@"USB\VID_054C&PID_0DF2\SCOPE_TARGET", true, true, Driver0);
    var headset = Device(@"USB\VID_10F5&PID_2267\SCOPE_HEADSET", false, true, Driver1);
    var phantom = Device(@"USB\VID_1038&PID_1610\SCOPE_PHANTOM", false, false, @"{36fc9e60-c465-11cf-8056-444553540000}\0019");
    var baseline = installed with {
      Service = installed.Service with { Service = installed.Service.Service with { State = 4 },
        File = new DriverIdentity(LifecycleSession.HashForVariant("PATCH_1K"), "PATCH_1K"),
        ServiceParameters = new PatchParameters(true, new DwordValue(true, 3), new DwordValue(false, null)) },
      Devices = new[] { target, headset, phantom }
    };
    var adopt = new LifecycleIntent("ADOPT", target.Id, target.InterfaceDigest, null, true);
    var apply = adopt with { Action = "APPLY", RequestedHz = 1000 };
    var restore = adopt with { Action = "DETACH", AcknowledgePatching = false };
    var adoption = LifecycleSession.Plan(baseline, adopt, Empty());
    Check(LifecycleSession.Digest(adoption.After) == LifecycleSession.Digest(baseline), "adoption preserves complete OS state");
    Check(!adoption.Ownership.ServiceOwned && adoption.Ownership.Devices.Count == 1, "adoption retains external service ownership");
    foreach (string action in new[] { "INSTALL", "REMOVE", "REPAIR" })
      Refuse(() => LifecycleSession.Plan(baseline, action == "INSTALL" ? apply with { Action = action } : new LifecycleIntent(action, null, null, null, false), Empty()), "Unresolved shared attachment");
    foreach (var invalid in new[] {
      target with { Eligible = false }, target with { Authorized = false }, target with { Present = false },
      target with { Coordinate = null }, target with { IntervalIsolated = false },
      target with { Coordinate = target.Coordinate with { RegistryView = "Registry32" } },
      target with { Coordinate = target.Coordinate with { ValueName = "Other" } },
      target with { Coordinate = target.Coordinate with { InstanceId = headset.Coordinate.InstanceId } }
    }) Refuse(() => LifecycleSession.Plan(baseline with { Devices = new[] { invalid, headset, phantom } }, adopt, Empty()));
    Refuse(() => LifecycleSession.Plan(baseline with { SecurityAccepted = false }, adopt, Empty()));
    Refuse(() => LifecycleSession.Plan(baseline with { MemoryIntegrity = true }, adopt, Empty()));
    Refuse(() => LifecycleSession.Plan(baseline, adopt with { AcknowledgePatching = false }, Empty()));
    Refuse(() => LifecycleSession.Plan(baseline, apply, Empty()), "Adopt exact existing scope");
    Refuse(() => LifecycleSession.Plan(baseline, restore, Empty()), "Exact original device scope");
    Refuse(() => LifecycleSession.Plan(baseline with { Service = baseline.Service with { File = null } }, restore, adoption.Ownership), "Existing service and driver");
    Refuse(() => LifecycleSession.Plan(baseline with { Service = baseline.Service with { ServiceParameters = new PatchParameters(true, new DwordValue(true, 1), new DwordValue(false, null)) } },
      apply with { RequestedHz = 2000 }, adoption.Ownership), "Separate shared variant replacement");
    Refuse(() => LifecycleSession.Plan(baseline with { Devices = new[] { target with { Speed = "FULL" }, headset, phantom } },
      apply with { RequestedHz = 2000 }, adoption.Ownership), "Full-Speed rate unsupported");
    var aliased = headset with { Coordinate = headset.Coordinate with { KeyPath = target.Coordinate.KeyPath } };
    Refuse(() => LifecycleSession.Plan(baseline with { Devices = new[] { target, aliased, phantom } }, adopt, Empty()), "Shared interval coordinate");
    Check(!IntervalBinding.IsExclusive(target.Coordinate, new[] { (target.Coordinate.InstanceId, target.Coordinate.KeyPath), ("HID\\NONSELECTABLE", target.Coordinate.KeyPath) }), "nonselectable devnode alias refuses");
    Check(!IntervalBinding.IsExclusive(target.Coordinate, Array.Empty<(string, string)>()), "missing coordinate owner refuses");
    Check(IntervalBinding.IsExclusive(target.Coordinate, new[] { (target.Coordinate.InstanceId, target.Coordinate.KeyPath) }), "exclusive owner recognized");
    Refuse(() => IntervalBinding.Create(target.Coordinate.InstanceId, "Driver", @"..\OTHER"));
    Refuse(() => IntervalBinding.Create(target.Coordinate.InstanceId, "Ambiguous", Driver0));
    Refuse(() => IntervalBinding.Create(target.Coordinate.InstanceId, "Driver", Driver0, "CurrentControlSet"));
    Refuse(() => IntervalBinding.Create(target.Coordinate.InstanceId, "Driver", Driver0, "ControlSet000"));
    // Exercise the same JSON request boundary as the broker, without a pipe,
    // WindowsMachine, UAC or live journal.
    {
      using var log = new JournalLog(new MemoryStream()); var machine = new CoordinateMachine(baseline);
      var session = new LifecycleSession(log, machine, () => { }); string nonce = new string('c', 64);
      byte[] Envelope(string operation, object payload, string digest = null) => JsonSerializer.SerializeToUtf8Bytes(new {
        version = 1, operation, nonce, planDigest = digest ?? new string('0', 64), payload
      });
      using var previewReply = JsonDocument.Parse(SessionProtocol.Reply(Envelope("PREVIEW", adopt), nonce, session, machine));
      Check(previewReply.RootElement.GetProperty("ok").GetBoolean(), "mixed-scope adoption crosses request boundary");
      var preview = previewReply.RootElement.GetProperty("value");
      Check(!preview.GetProperty("RestartRequired").GetBoolean() && machine.Writes.Count == 0 && log.Revision == 0, "adoption preview does not mutate");
      using var applyReply = JsonDocument.Parse(SessionProtocol.Reply(Envelope("APPLY", new { Token = preview.GetProperty("Token").GetString() }, preview.GetProperty("PlanDigest").GetString()), nonce, session, machine));
      Check(applyReply.RootElement.GetProperty("ok").GetBoolean() && machine.Writes.Count == 0, "adoption transport apply writes only in-memory journal");
      using var extraField = JsonDocument.Parse(SessionProtocol.Reply(Envelope("PREVIEW", new {
        adopt.Action, adopt.DeviceId, adopt.InterfaceDigest, adopt.RequestedHz, adopt.AcknowledgePatching, Coordinate = target.Coordinate
      }), nonce, session, machine));
      Check(!extraField.RootElement.GetProperty("ok").GetBoolean(), "caller cannot submit interval coordinates");
    }

    // Actual planner/session and production interval-write algorithm; fake key
    // handles observe write destinations instead of assigning State=plan.After.
    foreach (string location in new[] { "Driver", "Hardware", "Parameters" }) {
      var device = target with { IntervalLocation = location, Coordinate = IntervalBinding.Create(target.Coordinate.InstanceId, location, Driver0),
        Interval = location == "Hardware" ? new DwordValue(false, null) : new DwordValue(true, 1) };
      var original = baseline with { Devices = new[] { device, headset, phantom } };
      using var log = new JournalLog(new MemoryStream());
      var machine = new CoordinateMachine(original);
      var session = new LifecycleSession(log, machine, () => { });
      var p = session.Preview(adopt);
      Check(log.Revision == 0 && machine.Writes.Count == 0, "preview has no writes");
      Check(session.Apply(p.Token, p.PlanDigest).Status == "CONFIGURATION_VERIFIED", "journal-only adoption completes");
      Check(machine.Writes.Count == 0 && Record(log).SchemaVersion == 2, "adopt has no OS write, schema is explicit");
      foreach (int rate in new[] { 1000, 2000, 4000, 8000 }) {
        p = session.Preview(apply with { RequestedHz = rate }); session.Apply(p.Token, p.PlanDigest);
        Check(machine.Observe().Devices[0].Interval.Value == (rate == 1000 ? 4u : rate == 2000 ? 3u : rate == 4000 ? 2u : 1u), "selected rate readback");
        Check(machine.Writes.All(x => x == device.Coordinate.KeyPath), "only exact selected key written");
        Check(LifecycleSession.Digest(machine.Observe().Service) == LifecycleSession.Digest(original.Service), "shared state unchanged");
        Check(LifecycleSession.Digest(machine.Observe().Devices.Skip(1).ToArray()) == LifecycleSession.Digest(original.Devices.Skip(1).ToArray()), "headset and phantom unchanged");
        machine.Restart(); session.Reconcile();
      }
      p = session.Preview(restore); session.Apply(p.Token, p.PlanDigest); machine.Restart(); session.Reconcile();
      Check(LifecycleSession.Digest(machine.Observe().Devices) == LifecycleSession.Digest(original.Devices), "exact original interval and filters restored");
      Check(!Record(log).Ownership.ServiceOwned && Record(log).Ownership.Devices.Count == 0, "restore does not own external service");
    }
    // The complete USB scope's filter restore also uses an individual entry.
    foreach (var filters in new[] { new FilterValue(false, Array.Empty<string>()), new FilterValue(true, Array.Empty<string>()), new FilterValue(true, new[] { "other", "hidusbf", "external" }) }) {
      using var log = new JournalLog(new MemoryStream());
      var owned = new LifecycleOwnership(false, new Dictionary<string, SavedDevice> { [target.Id] = new SavedDevice(target.InterfaceDigest, filters, target.Interval, target.IntervalLocation, target.Coordinate) });
      log.Append(JsonSerializer.Serialize(new LifecycleRecord(baseline, owned, null, false, 2)), 0);
      var machine = new CoordinateMachine(baseline); var session = new LifecycleSession(log, machine, () => { });
      var p = session.Preview(restore); session.Apply(p.Token, p.PlanDigest);
      Check(LifecycleSession.Digest(machine.Observe().Devices[0].Filters) == LifecycleSession.Digest(filters), "ordered/absent/empty filter restore");
      Check(machine.Writes.SequenceEqual(new[] { "FILTER:" + target.Id }), "filter write limited to selected instance");
      Check(LifecycleSession.Digest(machine.Observe().Devices.Skip(1).ToArray()) == LifecycleSession.Digest(baseline.Devices.Skip(1).ToArray()), "filter restore preserves non-targets");
    }
    foreach (bool duringOpen in new[] { false, true }) {
      var machine = new CoordinateMachine(baseline);
      Action remap = () => machine.Remap(target, Driver1);
      if (duringOpen) machine.OnOpen = remap; else remap();
      Refuse(() => IntervalBinding.Write(machine, target, target with { Interval = new DwordValue(true, 2) }, () => { }), "changed before write");
      Check(machine.Writes.Count == 0, "same-value remap refused before write");
    }
    {
      var machine = new CoordinateMachine(baseline);
      machine.OnOpen = () => machine.Remap(target, Driver0, "ControlSet002");
      Refuse(() => IntervalBinding.Write(machine, target, target with { Interval = new DwordValue(true, 2) }, () => { }));
      Check(machine.Writes.Count == 0, "control-set remap refused before write");
    }
    {
      var machine = new CoordinateMachine(baseline) { OnOpen = null };
      machine.OnOpen = () => machine.Exclusive = false;
      Refuse(() => IntervalBinding.Write(machine, target, target with { Interval = new DwordValue(true, 2) }, () => { }));
      Check(machine.Writes.Count == 0, "new alias before write refused");
    }
    // The preservation invariant independently rejects injected collateral plans.
    var plan = LifecycleSession.Plan(baseline, apply, adoption.Ownership);
    Refuse(() => LifecycleSession.ValidateLocalPlan(baseline, plan with { After = plan.After with { Service = plan.After.Service with { ServiceParameters = installed.Service.ServiceParameters } } }));
    Refuse(() => LifecycleSession.ValidateLocalPlan(baseline, plan with { After = plan.After with { Devices = new[] { plan.After.Devices[0], headset with { Interval = new DwordValue(true, 7) }, phantom } } }));
    Refuse(() => LifecycleSession.ValidateLocalPlan(baseline, plan with { Ownership = plan.Ownership with { ServiceOwned = true } }, adoption.Ownership));
    Refuse(() => LifecycleSession.ValidateLocalPlan(baseline, adoption with { After = plan.After }));
    var noCoordinate = new LifecycleOwnership(false, new Dictionary<string, SavedDevice> { [target.Id] = adoption.Ownership.Devices[target.Id] with { Coordinate = null } });
    Refuse(() => LifecycleSession.Plan(baseline, apply, noCoordinate)); Refuse(() => LifecycleSession.Plan(baseline, restore, noCoordinate));

    foreach (string failure in new[] { "DRIFT", "REMAP", "READBACK" }) {
      using var log = new JournalLog(new MemoryStream()); var machine = new CoordinateMachine(baseline);
      var session = new LifecycleSession(log, machine, () => { }); var p = session.Preview(adopt); session.Apply(p.Token, p.PlanDigest);
      p = session.Preview(apply);
      if (failure == "DRIFT") machine.Values[headset.Coordinate.KeyPath] = new DwordValue(true, 7);
      if (failure == "REMAP") machine.BeforeWrite = () => machine.Remap(target, Driver1);
      if (failure == "READBACK") machine.BadWrite = true;
      Refuse(() => session.Apply(p.Token, p.PlanDigest));
      Check(Record(log).NeedsReview, "interruption/drift preserves review state");
      Check(failure == "READBACK" || machine.Writes.Count == 0, "pre-write failure wrote nothing");
      Refuse(() => session.Apply(p.Token, p.PlanDigest)); Refuse(() => session.Preview(restore));
    }
    {
      DateTimeOffset now = DateTimeOffset.UtcNow;
      using var log = new JournalLog(new MemoryStream()); var machine = new CoordinateMachine(baseline);
      var session = new LifecycleSession(log, machine, () => { }, () => now); var p = session.Preview(adopt);
      now = now.AddMinutes(3); Refuse(() => session.Apply(p.Token, p.PlanDigest));
      Check(log.Revision == 0 && machine.Writes.Count == 0, "expired adoption has no writes");
    }
    foreach (int? version in new int?[] { null, 0, 1, 4 }) {
      using var bytes = new MemoryStream(); using var log = new JournalLog(bytes);
      string payload = JsonSerializer.Serialize(new LifecycleRecord(baseline, adoption.Ownership, null, false, version ?? 0));
      if (version == null) payload = payload.Replace(",\"SchemaVersion\":0", "");
      log.Append(payload, 0); byte[] original = bytes.ToArray();
      var machine = new CoordinateMachine(baseline); var session = new LifecycleSession(log, machine, () => { });
      Refuse(() => session.Preview(adopt), "JOURNAL_SCHEMA_REVIEW_REQUIRED");
      Refuse(() => session.Reconcile(), "JOURNAL_SCHEMA_REVIEW_REQUIRED");
      Check(original.SequenceEqual(bytes.ToArray()) && log.Revision == 1 && machine.Observations == 0, "old/unknown journal is preserved without observation or migration");
    }
    {
      using var bytes = new MemoryStream(); using var log = new JournalLog(bytes);
      log.Append(JsonSerializer.Serialize(new LifecycleRecord(baseline, noCoordinate, null, false, 2)), 0);
      byte[] original = bytes.ToArray(); var machine = new CoordinateMachine(baseline); var session = new LifecycleSession(log, machine, () => { });
      Refuse(() => session.Preview(apply), "JOURNAL_SCHEMA_REVIEW_REQUIRED"); Refuse(() => session.Reconcile(), "JOURNAL_SCHEMA_REVIEW_REQUIRED");
      Check(original.SequenceEqual(bytes.ToArray()) && machine.Observations == 0, "schema tag alone cannot confer coordinate ownership");
    }
    Console.WriteLine("closed-operation-scope-pass:" + checks);
  }

  sealed class CoordinateMachine : ILifecycleMachine, IIntervalStore {
    LifecycleObservation template;
    public readonly Dictionary<string, DwordValue> Values = new Dictionary<string, DwordValue>();
    readonly Dictionary<string, IntervalCoordinate> coordinates = new Dictionary<string, IntervalCoordinate>();
    readonly Dictionary<string, FilterValue> filters = new Dictionary<string, FilterValue>();
    public readonly List<string> Writes = new List<string>();
    public Action OnOpen, BeforeWrite;
    public bool Exclusive = true, BadWrite;
    public int Observations;
    public CoordinateMachine(LifecycleObservation state) {
      template = state;
      foreach (var device in state.Devices) { coordinates.Add(device.Coordinate.InstanceId, device.Coordinate); Values[device.Coordinate.KeyPath] = device.Interval; filters.Add(device.Id, device.Filters); }
    }
    public LifecycleObservation Observe() { Observations++; return template with { Devices = template.Devices.Select(x => x with {
      Coordinate = coordinates[x.Coordinate.InstanceId], Interval = Values[coordinates[x.Coordinate.InstanceId].KeyPath], Filters = filters[x.Id]
    }).ToArray() }; }
    public IntervalSnapshot Read(string instance) {
      var device = template.Devices.Single(x => x.Coordinate.InstanceId == instance);
      return new IntervalSnapshot(Values[coordinates[instance].KeyPath], device.IntervalLocation, coordinates[instance]);
    }
    public bool IsExclusive(IntervalCoordinate coordinate) => Exclusive && coordinates.Values.Count(x => x.KeyPath == coordinate.KeyPath) == 1;
    public IIntervalValue Open(IntervalCoordinate coordinate) { OnOpen?.Invoke(); return new Value(this, coordinate.KeyPath); }
    public void Remap(DeviceSetting device, string driver, string controlSet = "ControlSet001") {
      var next = IntervalBinding.Create(device.Coordinate.InstanceId, "Driver", driver, controlSet);
      Values[next.KeyPath] = Values[coordinates[device.Coordinate.InstanceId].KeyPath]; coordinates[device.Coordinate.InstanceId] = next;
    }
    public void Execute(NativePlan plan, LifecycleObservation before, Action assertPeer) {
      LifecycleSession.ValidateLocalPlan(before, plan);
      var old = before.Devices.Single(x => x.Id == plan.Intent.DeviceId); var next = plan.After.Devices.Single(x => x.Id == old.Id);
      BeforeWrite?.Invoke();
      if (old.Interval != next.Interval) IntervalBinding.Write(this, old, next, assertPeer);
      if (LifecycleSession.Digest(old.Filters) != LifecycleSession.Digest(next.Filters)) { filters[old.Id] = next.Filters; Writes.Add("FILTER:" + old.Id); }
    }
    public void Restart() { template = template with { BootId = BootSessionChecks.Next(template.BootId) }; }
    sealed class Value : IIntervalValue {
      readonly CoordinateMachine machine; readonly string key;
      public Value(CoordinateMachine machine, string key) { this.machine = machine; this.key = key; }
      public DwordValue Read() => machine.Values[key];
      public void Write(DwordValue value) { machine.Values[key] = machine.BadWrite ? new DwordValue(true, 99) : value; machine.Writes.Add(key); }
      public void Dispose() { }
    }
  }
}
