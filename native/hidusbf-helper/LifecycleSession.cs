using System;
using System.Collections.Generic;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Dialed.HidusbfHelper {
  public sealed record LifecycleIntent(string Action, string DeviceId, string InterfaceDigest, int? RequestedHz, bool AcknowledgePatching);
  public sealed record DeviceSetting(string Id, string InterfaceDigest, bool Present, string Speed, bool Eligible,
    FilterValue Filters, DwordValue Interval, string IntervalLocation, string Name = "", bool Authorized = false,
    IntervalCoordinate Coordinate = null, bool IntervalIsolated = false);
  public sealed record LifecycleObservation(string BootId, bool SecurityAccepted, bool MemoryIntegrity,
    ServiceObservation Service, DeviceSetting[] Devices, string PlatformDigest = "");
  public sealed record SavedDevice(string InterfaceDigest, FilterValue Filters, DwordValue Interval, string IntervalLocation, IntervalCoordinate Coordinate = null);
  public sealed record LifecycleOwnership(bool ServiceOwned, Dictionary<string, SavedDevice> Devices);
  public sealed record NativePlan(LifecycleIntent Intent, string BeforeDigest, LifecycleObservation After,
    LifecycleOwnership Ownership, bool RestartRequired, string Variant,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingDefault)] bool ReconnectRequired = false);
  public sealed record PendingOperation(string TokenHash, LifecycleObservation Before, NativePlan Plan,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingDefault)] bool ReadbackVerified = false);
  public sealed record LifecycleRecord(LifecycleObservation Expected, LifecycleOwnership Ownership, PendingOperation Pending, bool NeedsReview, int SchemaVersion = 0);
  public sealed record NativePreview(string Token, string PlanDigest, DateTimeOffset ExpiresAt, NativePlan Plan);
  public sealed record LifecycleResult(string Status, bool ConfigurationOnly = true,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string DeviceName = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string DeviceId = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string Action = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] int? RequestedHz = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string ActivationEvidence = null);

  // Only the native host supplies this implementation. Requests contain neither
  // commands nor paths. A fixture can exercise the actual session without Windows I/O.
  public interface ILifecycleMachine {
    LifecycleObservation Observe();
    void Execute(NativePlan plan, LifecycleObservation before, Action assertPeer);
  }

  public sealed partial class LifecycleSession : IDisposable {
    readonly JournalLog journal;
    readonly ILifecycleMachine machine;
    readonly Func<DateTimeOffset> clock;
    readonly Action assertPeer;
    readonly object gate = new object();
    readonly Dictionary<string, NativePreview> previews = new Dictionary<string, NativePreview>();
    IDeviceReconnectWatch reconnectWatch;
    string reconnectToken;
    int writeSchema = 2;
    static readonly JsonSerializerOptions Json = new JsonSerializerOptions { PropertyNameCaseInsensitive = false };
    public static string Digest<T>(T value) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(value, Json)))).ToLowerInvariant();
    static T Copy<T>(T value) => JsonSerializer.Deserialize<T>(JsonSerializer.Serialize(value, Json), Json);
    static bool Attached(DeviceSetting device) => device.Filters.Ordered.Any(x => string.Equals(x, "hidusbf", StringComparison.OrdinalIgnoreCase));
    static LifecycleOwnership EmptyOwnership() => new LifecycleOwnership(false, new Dictionary<string, SavedDevice>());
    public LifecycleSession(JournalLog journal, ILifecycleMachine machine, Action assertPeer, Func<DateTimeOffset> clock = null) {
      this.journal = journal ?? throw new ArgumentNullException(nameof(journal));
      this.machine = machine ?? throw new ArgumentNullException(nameof(machine));
      this.assertPeer = assertPeer ?? throw new ArgumentNullException(nameof(assertPeer));
      this.clock = clock ?? (() => DateTimeOffset.UtcNow);
    }
    LifecycleRecord ReadRecord() {
      if (journal.LastPayload == null) return new LifecycleRecord(null, EmptyOwnership(), null, false, 2);
      var record = JsonSerializer.Deserialize<LifecycleRecord>(journal.LastPayload, Json) ?? throw new InvalidOperationException("Invalid journal state.");
      // No observation, append, migration or ownership inference for old records.
      Require(record.SchemaVersion == 2 || record.SchemaVersion == 3, "JOURNAL_SCHEMA_REVIEW_REQUIRED: preserve the journal; its format is unsupported.");
      writeSchema = record.SchemaVersion;
      Require(record.Pending?.Plan?.ReconnectRequired != true || record.SchemaVersion == 3 &&
        IsReconnectPlan(record.Pending.Before, record.Pending.Plan), "JOURNAL_SCHEMA_REVIEW_REQUIRED: invalid reconnect history; preserve the journal.");
      Require(record.Pending?.ReadbackVerified != true || record.SchemaVersion == 3 && record.Pending.Plan.ReconnectRequired,
        "JOURNAL_SCHEMA_REVIEW_REQUIRED: invalid readback marker; preserve the journal.");
      Require(record.Ownership?.Devices != null && record.Ownership.Devices.Values.All(x => x?.Coordinate != null) &&
        (record.Pending == null || record.Pending.Plan?.Ownership?.Devices != null && record.Pending.Plan.Ownership.Devices.Values.All(x => x?.Coordinate != null)),
        "JOURNAL_SCHEMA_REVIEW_REQUIRED: preserve the journal; saved interval coordinates are missing.");
      Require(record.Expected == null || BootSessionIdentity.IsValid(record.Expected.BootId) || BootSessionIdentity.IsLegacy(record.Expected.BootId),
        "BOOT_HISTORY_REVIEW_REQUIRED: preserve the journal; its Windows session identity is unsupported.");
      Require(record.Pending == null || record.Pending.Before != null && record.Pending.Plan?.After != null &&
        BootSessionIdentity.IsValid(record.Pending.Before.BootId) && record.Pending.Before.BootId == record.Pending.Plan.After.BootId &&
        (record.Expected == null || BootSessionIdentity.IsValid(record.Expected.BootId)),
        "BOOT_HISTORY_REVIEW_REQUIRED: an unfinished operation uses old or inconsistent restart evidence. Preserve the journal for review.");
      return record;
    }
    void Save(LifecycleRecord record) {
      // Old binaries reject schema 3 rather than clearing a reconnect pending
      // record as an operation without a restart. Never downgrade it afterwards.
      if (record.Pending?.Plan?.ReconnectRequired == true) writeSchema = 3;
      // Pending already holds BOTH complete snapshots. Repeating either one in
      // Expected exceeds the 64-KiB record bound on the captured 30-scope PC.
      // Schema 3 keeps them at Pending.Before / Pending.Plan.After. Completed
      // records still store the full independently observed Expected snapshot.
      if (writeSchema == 3 && record.Pending != null) record = record with { Expected = null };
      journal.Append(JsonSerializer.Serialize(record with { SchemaVersion = writeSchema }, Json), journal.Revision);
    }
    // A completed record can cross an ordinary boot only when every other
    // observed field is identical. Pending operations retain their own rules.
    static bool BootOnlyChange(LifecycleObservation expected, LifecycleObservation state) =>
      expected != null && BootSessionIdentity.IsLater(expected.BootId, state.BootId) && SameExceptBoot(expected, state);
    static bool SameExceptBoot(LifecycleObservation expected, LifecycleObservation state) =>
      expected != null && Digest(expected with { BootId = state.BootId }) == Digest(state);
    LifecycleObservation ReadExact(LifecycleRecord record) {
      assertPeer();
      if (record.Pending != null || record.NeedsReview) throw new InvalidOperationException("NEEDS_REVIEW: reconcile the saved operation.");
      var state = machine.Observe();
      BootSessionIdentity.RequireValid(state.BootId);
      if (BootSessionIdentity.IsLegacy(record.Expected?.BootId)) {
        previews.Clear();
        Require(SameExceptBoot(record.Expected, state), "BOOT_HISTORY_REVIEW_REQUIRED: saved configuration changed before the Windows session identity could be recorded. Preserve the journal.");
        throw new InvalidOperationException("BOOT_IDENTITY_RECONCILE_REQUIRED: choose Check saved operation to record the current Windows session identity. No device settings will change.");
      }
      if (record.Expected != null && Digest(record.Expected) != Digest(state)) {
        if (BootOnlyChange(record.Expected, state)) throw new InvalidOperationException("BOOT_RECONCILE_REQUIRED: reconcile the unchanged state after Windows restart.");
        if (InventoryReconciliation.CanRefresh(record, state)) {
          previews.Clear();
          throw new InvalidOperationException("INVENTORY_RECONCILE_REQUIRED: unrelated USB inventory changed; refresh USB inventory before creating a new preview.");
        }
        Save(record with { NeedsReview = true });
        throw new InvalidOperationException("NEEDS_REVIEW: external state changed.");
      }
      return state;
    }
    static void Require(bool value, string reason) { if (!value) throw new InvalidOperationException(reason); }
    static string SharedAttachmentReason(DeviceSetting[] unresolved) {
      // Device labels are untrusted display data. Bound and flatten each label so
      // an oversized inventory/name cannot break framing or forge extra lines.
      string Label(DeviceSetting device) {
        string value = device.Name ?? "";
        var elements = System.Globalization.StringInfo.GetTextElementEnumerator(value);
        var text = new StringBuilder(); int count = 0;
        while (count < 180 && elements.MoveNext()) {
          text.Append(new string(elements.GetTextElement().Select(c => char.IsControl(c) || char.IsWhiteSpace(c) || char.GetUnicodeCategory(c) == System.Globalization.UnicodeCategory.Format ? ' ' : c).ToArray()));
          count++;
        }
        bool truncated = elements.MoveNext();
        string normalized = text.ToString().Trim();
        return normalized.Length == 0 ? "USB scope " + device.Id : normalized + (truncated ? "..." : "");
      }
      var lines = unresolved.OrderBy(x => x.Id, StringComparer.Ordinal).Take(8)
        .Select(x => "- " + Label(x) + (x.Present ? " [present, ineligible]" : " [not present]"));
      return "Unresolved shared attachment. HIDUSBF is attached to " + unresolved.Length + " device scope(s) that cannot be managed safely.\r\n" +
        string.Join("\r\n", lines) + (unresolved.Length > 8 ? "\r\nAdditional affected scopes: " + (unresolved.Length - 8) + "." : "") +
        "\r\nReview existing-driver ownership and recovery before changing attachments. No change was applied.";
    }
    public static NativePlan Plan(LifecycleObservation state, LifecycleIntent intent, LifecycleOwnership ownership) {
      BootSessionIdentity.RequireValid(state.BootId);
      Require(new[] { "INSTALL", "ADOPT", "APPLY", "DETACH", "REPAIR", "REMOVE" }.Contains(intent.Action), "Unknown action.");
      bool targetAction = new[] { "INSTALL", "ADOPT", "APPLY", "DETACH" }.Contains(intent.Action);
      bool rateAction = intent.Action == "INSTALL" || intent.Action == "APPLY";
      Require(rateAction ? new int?[] { 125, 250, 500, 1000, 2000, 4000, 8000 }.Contains(intent.RequestedHz) : intent.RequestedHz == null, "Unexpected rate.");
      Require(targetAction ? IsDigest(intent.DeviceId) && IsDigest(intent.InterfaceDigest) : intent.DeviceId == null && intent.InterfaceDigest == null, "Unexpected device identity.");
      Require(state.Devices.Length <= 4096 && state.Devices.Select(x => x.Id).Distinct().Count() == state.Devices.Length, "Incomplete device inventory.");
      var unresolved = state.Devices.Where(x => Attached(x) && !x.Eligible).ToArray();
      bool localAction = intent.Action == "ADOPT" || intent.Action == "APPLY" || intent.Action == "DETACH";
      if (!localAction && unresolved.Length != 0) throw new InvalidOperationException(SharedAttachmentReason(unresolved));
      var service = state.Service;
      Require(service.Service != null || !service.ServiceKeyPresent && !service.ControlParameters.KeyPresent && !service.ServiceParameters.KeyPresent, "Orphaned service state.");
      ServiceInventory.ValidateService(service.Service);
      ServiceInventory.ValidateParameters(service.ServiceParameters, service.ControlParameters);
      if (localAction) Require(service.Service != null && service.File != null, "Existing service and driver required.");
      var target = state.Devices.SingleOrDefault(x => x.Id == intent.DeviceId && x.InterfaceDigest == intent.InterfaceDigest);
      if (targetAction) Require(target != null && target.Eligible && (intent.Action == "DETACH" || target.Present), "Exact device is ineligible.");
      if (targetAction) {
        IntervalBinding.Validate(target);
        Require(!state.Devices.Any(x => x.Id != target.Id && x.Coordinate != null &&
          x.Coordinate.RegistryView == target.Coordinate.RegistryView && string.Equals(x.Coordinate.KeyPath, target.Coordinate.KeyPath, StringComparison.OrdinalIgnoreCase) &&
          string.Equals(x.Coordinate.ValueName, target.Coordinate.ValueName, StringComparison.OrdinalIgnoreCase)), "Shared interval coordinate requires review.");
      }
      var after = Copy(state); var owned = Copy(ownership); string variant = service.File?.Variant;
      if (rateAction || intent.Action == "ADOPT" || intent.Action == "REPAIR") {
        Require(state.SecurityAccepted, "Security/physical compatibility policy has not accepted this configuration.");
        if (targetAction) Require(target.Authorized, "This exact device scope is not authorized by the signed policy.");
      }
      if (rateAction) {
        int rate = intent.RequestedHz.Value;
        uint interval;
        if (target.Speed == "FULL") interval = rate switch { 125 => 8, 250 => 4, 500 => 2, 1000 => 1, _ => throw new InvalidOperationException("Full-Speed rate unsupported.") };
        else if (target.Speed == "HIGH") interval = rate switch { 1000 => 4, 2000 => 3, 4000 => 2, 8000 => 1, _ => throw new InvalidOperationException("High-Speed rate unsupported.") };
        else throw new InvalidOperationException("USB speed unknown or unsupported.");
        variant ??= target.Speed == "FULL" ? "NOPATCH" : rate <= 1000 ? "PATCH_1K" : rate <= 4000 ? "PATCH_2K_4K" : "PATCH_4K_8K";
        if (variant != "NOPATCH") Require(intent.AcknowledgePatching && !state.MemoryIntegrity, "Patching requires explicit acknowledgement and an already compatible security configuration.");
        if (target.Speed == "HIGH") {
          uint tier = service.ServiceParameters.UsbXhci.Value ?? service.ControlParameters.UsbXhci.Value ?? (variant == "PATCH_4K_8K" ? 3u : variant == "PATCH_2K_4K" ? 2u : 1u);
          Require(variant != "NOPATCH" && tier > 0 && rate <= (tier == 3 ? 8000 : tier == 2 ? 4000 : 1000), "Separate shared variant replacement required.");
        }
        if (intent.Action == "INSTALL") {
          Require(service.Service == null && service.File == null && !state.Devices.Any(Attached), "Existing service, file or attachment prevents install.");
          var config = new ServiceConfiguration(1, 3, 1, ServiceInventory.ImagePath, "", 0, Array.Empty<string>(), "", "USB Mouse Rate Adjuster Lower Filter by SweetLow", 1);
          after = after with { Service = service with { Service = config, ServiceKeyPresent = true, File = new DriverIdentity(HashForVariant(variant), variant) } };
          owned = owned with { ServiceOwned = true };
        } else {
          Require(service.Service != null && service.File != null && owned.Devices.TryGetValue(target.Id, out var original) &&
            original.InterfaceDigest == target.InterfaceDigest && original.IntervalLocation == target.IntervalLocation &&
            original.Coordinate != null && original.Coordinate == target.Coordinate, "Adopt exact existing scope first.");
        }
        if (!owned.Devices.ContainsKey(target.Id)) owned.Devices.Add(target.Id, new SavedDevice(target.InterfaceDigest, target.Filters, target.Interval, target.IntervalLocation, target.Coordinate));
        var filters = Attached(target) ? target.Filters : new FilterValue(true, target.Filters.Ordered.Concat(new[] { "hidusbf" }).ToArray());
        after = after with { Devices = after.Devices.Select(x => x.Id == target.Id ? x with { Filters = filters, Interval = new DwordValue(true, interval) } : x).ToArray() };
      } else if (intent.Action == "ADOPT") {
        Require(service.Service != null && service.File != null && Attached(target) && !owned.Devices.ContainsKey(target.Id), "Adoption refused.");
        Require(variant == "NOPATCH" || intent.AcknowledgePatching && !state.MemoryIntegrity, "Patching acknowledgement/security required.");
        owned.Devices.Add(target.Id, new SavedDevice(target.InterfaceDigest, target.Filters, target.Interval, target.IntervalLocation, target.Coordinate));
      } else if (intent.Action == "DETACH") {
        Require(owned.Devices.TryGetValue(target.Id, out var original) && original.InterfaceDigest == target.InterfaceDigest && original.IntervalLocation == target.IntervalLocation &&
          original.Coordinate != null && original.Coordinate == target.Coordinate, "Exact original device scope missing.");
        after = after with { Devices = after.Devices.Select(x => x.Id == target.Id ? x with { Filters = original.Filters, Interval = original.Interval } : x).ToArray() };
        owned.Devices.Remove(target.Id);
      } else if (intent.Action == "REMOVE") {
        Require(service.Service != null && owned.ServiceOwned && owned.Devices.Count == 0 && !state.Devices.Any(Attached), "Shared service still in use or unowned.");
        Require(service.Service.State == 1, "Service must be stopped after detached restart before removal.");
        Require(!service.ServiceParameters.KeyPresent && !service.ControlParameters.KeyPresent, "Service parameters changed; preserve them for review.");
        after = after with { Service = service with { Service = null, ServiceKeyPresent = false, File = null } };
        owned = owned with { ServiceOwned = false };
      } else if (intent.Action == "REPAIR") {
        Require(service.Service != null && owned.ServiceOwned && service.File != null, "Repair requires unchanged owned service.");
      }
      bool sameRate = intent.Action == "APPLY" && Digest(after) == Digest(state);
      bool reconnect = intent.Action == "APPLY" && !sameRate && Attached(target) && service.Service?.State == 4 &&
        Digest(after.Service) == Digest(service) && Digest(after.Devices.Single(x => x.Id == target.Id).Filters) == Digest(target.Filters);
      var plan = new NativePlan(intent, Digest(state), after, owned,
        !sameRate && !reconnect && intent.Action != "ADOPT" && intent.Action != "REPAIR", variant, reconnect);
      if (localAction) ValidateLocalPlan(state, plan, ownership);
      return plan;
    }
    public static void ValidateLocalPlan(LifecycleObservation before, NativePlan plan, LifecycleOwnership ownership = null) {
      if (plan.Intent.Action != "ADOPT" && plan.Intent.Action != "APPLY" && plan.Intent.Action != "DETACH") return;
      var target = before.Devices.Single(x => x.Id == plan.Intent.DeviceId);
      var next = plan.After.Devices.Single(x => x.Id == target.Id);
      IntervalBinding.Validate(target); IntervalBinding.Validate(next);
      // Restoring the target's two mutable fields must reconstruct the ENTIRE
      // before-state, including order, eligibility, topology and shared state.
      var restored = plan.After with { Devices = plan.After.Devices.Select(x => x.Id == target.Id ? x with { Filters = target.Filters, Interval = target.Interval } : x).ToArray() };
      Require(Digest(restored) == Digest(before), "Non-target or shared state change refused.");
      if (plan.Intent.Action == "ADOPT") Require(Digest(plan.After) == Digest(before), "Adoption must preserve device state.");
      if (ownership != null) {
        Require(plan.Ownership.ServiceOwned == ownership.ServiceOwned &&
          Digest(plan.Ownership.Devices.Where(x => x.Key != target.Id).OrderBy(x => x.Key, StringComparer.Ordinal).ToArray()) ==
          Digest(ownership.Devices.Where(x => x.Key != target.Id).OrderBy(x => x.Key, StringComparer.Ordinal).ToArray()), "Unrelated ownership change refused.");
      }
    }
    public static string HashForVariant(string variant) => variant switch {
      "NOPATCH" => "2f82cdeb36bdaa42ea1933a9b11f3b8e1bdb28e6d3e3da7e65b4631b3375412d",
      "PATCH_1K" => "81f649b34978fe9f74ce5c7c04ba24d5238faec6c70018f14da9423a46e6e04d",
      "PATCH_2K_4K" => "e2c9fc626bb92d2219fbef3458014c198a3c90c563f948c9a433826e64d77e90",
      "PATCH_4K_8K" => "db73a8c259e16a0d02f138650497c1bdec81add66d928f3cf3ff39fad4eb421b",
      _ => throw new InvalidOperationException("Unrecognized variant.")
    };
    public static bool IsDigest(string value) => value != null && value.Length == 64 && value.All(x => x >= '0' && x <= '9' || x >= 'a' && x <= 'f');
    static bool IsReconnectPlan(LifecycleObservation before, NativePlan plan) {
      if (before == null || plan?.After == null || !plan.ReconnectRequired || plan.RestartRequired || plan.Intent?.Action != "APPLY" ||
          before.Service?.Service?.State != 4 || plan.BeforeDigest != Digest(before)) return false;
      var target = before.Devices?.SingleOrDefault(x => x.Id == plan.Intent.DeviceId);
      var next = plan.After.Devices?.SingleOrDefault(x => x.Id == plan.Intent.DeviceId);
      if (target == null || next == null || !target.Present || !target.Eligible || !target.Authorized || !Attached(target) ||
          target.InterfaceDigest != plan.Intent.InterfaceDigest || target.Interval == next.Interval || Digest(target.Filters) != Digest(next.Filters)) return false;
      try { return Digest(Plan(before, plan.Intent, plan.Ownership)) == Digest(plan); } catch (InvalidOperationException) { return false; }
    }
    void CloseReconnectWatch() { reconnectWatch?.Dispose(); reconnectWatch = null; reconnectToken = null; }
    bool ArmReconnect(PendingOperation pending) {
      if (reconnectWatch != null && reconnectToken == pending.TokenHash) return false;
      CloseReconnectWatch();
      if (machine is not IDeviceReconnectMachine observer) return false;
      var target = pending.Plan.After.Devices.Single(x => x.Id == pending.Plan.Intent.DeviceId);
      reconnectWatch = observer.WatchReconnect(target.Coordinate.InstanceId);
      Require(reconnectWatch != null, "RECONNECT_MONITOR_UNAVAILABLE: device monitor was not created; saved operation remains pending.");
      reconnectToken = pending.TokenHash;
      return true;
    }
    public void Dispose() { lock (gate) { CloseReconnectWatch(); previews.Clear(); } }
    public NativePreview Preview(LifecycleIntent intent) {
      lock (gate) {
        var record = ReadRecord(); var state = ReadExact(record);
        var plan = Plan(state, intent, record.Ownership);
        foreach (var key in previews.Where(x => x.Value.ExpiresAt <= clock()).Select(x => x.Key).ToArray()) previews.Remove(key);
        Require(previews.Count < 8, "Too many outstanding previews.");
        string token = Convert.ToHexString(RandomNumberGenerator.GetBytes(32)).ToLowerInvariant();
        var preview = new NativePreview(token, Digest(plan), clock().AddMinutes(2), plan);
        previews.Add(token, preview); return Copy(preview);
      }
    }
    public LifecycleResult Apply(string token, string planDigest) {
      lock (gate) {
        Require(token != null && previews.TryGetValue(token, out _), "Preview missing or already consumed.");
        var preview = previews[token]; previews.Remove(token);
        Require(preview.ExpiresAt > clock() && preview.PlanDigest == planDigest, "Expired or mismatched preview.");
        var record = ReadRecord(); var state = ReadExact(record);
        var plan = Plan(state, preview.Plan.Intent, record.Ownership);
        Require(Digest(plan) == preview.PlanDigest, "State or ownership changed after preview.");
        if (plan.Intent.Action == "APPLY" && Digest(plan.After) == Digest(state)) return new LifecycleResult("ALREADY_CONFIGURED");
        var pending = new PendingOperation(Digest(token), state, plan);
        Save(record with { Pending = pending });
        try {
          assertPeer(); machine.Execute(plan, state, assertPeer);
          var after = machine.Observe();
          Require(Digest(after) == Digest(plan.After), "Exact readback mismatch.");
          if (plan.ReconnectRequired) pending = pending with { ReadbackVerified = true };
          Save(new LifecycleRecord(after, plan.Ownership, plan.RestartRequired || plan.ReconnectRequired ? pending : null, false));
        } catch {
          Save(ReadRecord() with { NeedsReview = true }); throw;
        }
        // Arm only AFTER the write and exact readback are durably recorded. An
        // earlier reconnect can never satisfy activation of a later rate write.
        if (plan.ReconnectRequired) ArmReconnect(pending);
        return plan.ReconnectRequired ? ReconnectResult(pending, "RECONNECT_REQUIRED") : new LifecycleResult(plan.RestartRequired ? "RESTART_REQUIRED" : "CONFIGURATION_VERIFIED");
      }
    }
    static LifecycleResult ReconnectResult(PendingOperation pending, string status) =>
      new LifecycleResult(status, DeviceName: pending.Plan.After.Devices.SingleOrDefault(x => x.Id == pending.Plan.Intent.DeviceId)?.Name ?? "Shared driver",
        DeviceId: pending.Plan.Intent.DeviceId, Action: pending.Plan.Intent.Action, RequestedHz: pending.Plan.Intent.RequestedHz);
    LifecycleResult ReconcileReconnect(LifecycleRecord record) {
      var pending = record.Pending;
      bool newlyArmed = ArmReconnect(pending);
      var progress = reconnectWatch?.Read();
      // Do not rescan incomplete USB topology during removal. Resume opens a
      // fresh watcher; it cannot infer events missed while the helper was closed.
      if (!newlyArmed && progress != null && !progress.Started)
        return ReconnectResult(pending, progress.Removed ? "RECONNECT_WAITING_FOR_DEVICE" : "RECONNECT_REQUIRED");
      assertPeer(); var state = Copy(machine.Observe());
      BootSessionIdentity.RequireValid(state.BootId);
      var expected = pending.Plan.After;
      bool laterBoot = BootSessionIdentity.IsLater(expected.BootId, state.BootId);
      Require(expected.BootId == state.BootId || laterBoot,
        "BOOT_HISTORY_REVIEW_REQUIRED: reconnect cannot explain inconsistent Windows session evidence. Preserve the saved operation.");
      if (laterBoot) expected = expected with { BootId = state.BootId };
      if (!laterBoot && progress?.Started != true) return ReconnectResult(pending, "RECONNECT_REQUIRED");
      // Same-boot acceptance REQUIRES the exact removed -> started sequence.
      // A full, proven Windows restart remains an optional recovery route.
      assertPeer(); var confirmed = Copy(machine.Observe());
      if (Digest(state) != Digest(confirmed) || progress != reconnectWatch?.Read())
        throw new InvalidOperationException("RECONNECT_UNSTABLE: device state changed during verification; leave it connected and choose Check saved operation.");
      if (Digest(state) != Digest(expected)) {
        if (Digest(state) == Digest(pending.Before with { BootId = state.BootId })) {
          Save(record with { Expected = state, Pending = null, NeedsReview = false }); CloseReconnectWatch();
          return new LifecycleResult("NOT_APPLIED");
        }
        Save(record with { NeedsReview = true });
        throw new InvalidOperationException("NEEDS_REVIEW: reconnected device, shared state or other USB configuration differs from the saved plan.");
      }
      assertPeer(); Save(new LifecycleRecord(state, pending.Plan.Ownership, null, false));
      CloseReconnectWatch(); previews.Clear();
      return ReconnectResult(pending, "CONFIGURATION_VERIFIED") with { ActivationEvidence = laterBoot ? "WINDOWS_RESTART" : "DEVICE_RECONNECT" };
    }
    public LifecycleResult Reconcile() {
      lock (gate) {
        assertPeer(); var record = ReadRecord();
        if (record.Pending?.Plan?.ReconnectRequired == true) return ReconcileReconnect(record);
        var state = machine.Observe();
        BootSessionIdentity.RequireValid(state.BootId);
        if (record.Pending == null) {
          Require(!record.NeedsReview, "NEEDS_REVIEW: external drift.");
          if (BootSessionIdentity.IsLegacy(record.Expected?.BootId)) {
            previews.Clear();
            Require(SameExceptBoot(record.Expected, state), "BOOT_HISTORY_REVIEW_REQUIRED: saved configuration changed before the Windows session identity could be recorded. Preserve the journal.");
            assertPeer(); var confirmed = Copy(machine.Observe());
            Require(Digest(state) == Digest(confirmed), "BOOT_SESSION_UNAVAILABLE: observation changed while recording the Windows session. No recovery history was updated.");
            assertPeer(); Save(record with { Expected = confirmed });
            return new LifecycleResult("BOOT_IDENTITY_RECORDED");
          }
          if (BootOnlyChange(record.Expected, state)) {
            Save(record with { Expected = state });
            previews.Clear();
            return new LifecycleResult("CONFIGURATION_VERIFIED");
          }
          if (InventoryReconciliation.CanRefresh(record, state)) {
            previews.Clear();
            string observedDigest = Digest(state);
            assertPeer();
            var confirmed = Copy(machine.Observe());
            Require(observedDigest == Digest(confirmed), "INVENTORY_REFRESH_UNSTABLE: USB inventory changed during refresh. No recovery history was updated; check the connection and try again.");
            assertPeer();
            Save(record with { Expected = confirmed });
            return new LifecycleResult("INVENTORY_REFRESHED");
          }
          Require(record.Expected == null || Digest(record.Expected) == Digest(state), "NEEDS_REVIEW: external drift.");
          return new LifecycleResult("CONFIGURATION_VERIFIED");
        }
        var pending = record.Pending;
        if (Digest(state) == Digest(pending.Before)) {
          Save(record with { Expected = state, Pending = null, NeedsReview = false }); return new LifecycleResult("NOT_APPLIED");
        }
        var expected = pending.Plan.After;
        if (Digest(state) == Digest(expected) && pending.Plan.RestartRequired) return new LifecycleResult("RESTART_REQUIRED");
        if (pending.Plan.RestartRequired && BootSessionIdentity.IsLater(expected.BootId, state.BootId)) {
          expected = expected with { BootId = state.BootId };
          if (expected.Service.Service != null) expected = expected with { Service = expected.Service with { Service = expected.Service.Service with { State = expected.Devices.Any(Attached) ? 4u : 1u } } };
        }
        if (Digest(state) != Digest(expected)) {
          Save(record with { NeedsReview = true }); throw new InvalidOperationException("NEEDS_REVIEW: partial operation or external drift.");
        }
        Save(new LifecycleRecord(state, pending.Plan.Ownership, null, false)); return new LifecycleResult("CONFIGURATION_VERIFIED");
      }
    }
  }
}
