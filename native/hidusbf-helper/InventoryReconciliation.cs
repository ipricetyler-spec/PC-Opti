using System;
using System.Collections.Generic;
using System.Linq;

namespace Dialed.HidusbfHelper {
  // Pure classification, never an observation or write. Only a completed, usable
  // journal may explicitly acknowledge unrelated USB inventory in the same boot.
  public static class InventoryReconciliation {
    static bool Index(DeviceSetting[] devices, out Dictionary<string, DeviceSetting> index) {
      index = new Dictionary<string, DeviceSetting>(StringComparer.Ordinal);
      if (devices == null || devices.Length == 0 || devices.Length > 4096) return false;
      var interfaces = new HashSet<string>(StringComparer.Ordinal);
      foreach (var device in devices) {
        if (device == null || !LifecycleSession.IsDigest(device.Id) || !LifecycleSession.IsDigest(device.InterfaceDigest) ||
            device.Filters?.Ordered == null || device.Interval == null || device.Interval.Present != device.Interval.Value.HasValue ||
            !device.Filters.Present && device.Filters.Ordered.Length != 0 ||
            !index.TryAdd(device.Id, device) || !interfaces.Add(device.InterfaceDigest)) return false;
      }
      return true;
    }

    static bool Unconfigured(DeviceSetting device, LifecycleOwnership ownership, string controlSet) {
      if (ownership.Devices.ContainsKey(device.Id) || device.Eligible || device.Authorized ||
          device.Filters.Present || device.Filters.Ordered.Length != 0 || device.Interval.Present ||
          device.IntervalLocation != "Hardware" || !ScopeDigests.IsPhysicalUsb(device.Coordinate?.InstanceId) ||
          !new[] { "UNKNOWN", "FULL", "HIGH" }.Contains(device.Speed)) return false;
      try { IntervalBinding.Validate(device); return IntervalBinding.ControlSet(device.Coordinate) == controlSet; }
      catch (InvalidOperationException) { return false; }
    }

    static bool UniqueCoordinate(DeviceSetting device, IEnumerable<DeviceSetting> inventory) =>
      !inventory.Any(other => other.Id != device.Id && other.Coordinate != null &&
        string.Equals(other.Coordinate.RegistryView, device.Coordinate.RegistryView, StringComparison.OrdinalIgnoreCase) &&
        string.Equals(other.Coordinate.KeyPath, device.Coordinate.KeyPath, StringComparison.OrdinalIgnoreCase) &&
        string.Equals(other.Coordinate.ValueName, device.Coordinate.ValueName, StringComparison.OrdinalIgnoreCase));

    public static bool CanRefresh(LifecycleRecord record, LifecycleObservation current) {
      var expected = record?.Expected;
      if (record == null || record.SchemaVersion != 2 && record.SchemaVersion != 3 || record.NeedsReview || record.Pending != null ||
          record.Ownership?.Devices == null || expected == null || current == null ||
          string.IsNullOrWhiteSpace(expected.BootId) || !expected.SecurityAccepted || expected.MemoryIntegrity ||
          !LifecycleSession.IsDigest(expected.PlatformDigest) || expected.Service == null ||
          !Index(expected.Devices, out var before) || !Index(current.Devices, out var after)) return false;
      // This includes boot, authorization, platform, shared service, SYS bytes and
      // patch parameters. Combining a boot change with inventory drift is refused.
      if (LifecycleSession.Digest(expected with { Devices = current.Devices }) != LifecycleSession.Digest(current) ||
          LifecycleSession.Digest(expected) == LifecycleSession.Digest(current)) return false;
      string controlSet;
      try {
        var controlSets = before.Values.Where(x => x.Coordinate != null).Select(x => IntervalBinding.ControlSet(x.Coordinate)).Distinct().ToArray();
        if (controlSets.Length != 1) return false;
        controlSet = controlSets[0];
      } catch (InvalidOperationException) { return false; }

      // Never lose a recorded original or refresh across a remapped saved target.
      foreach (var entry in record.Ownership.Devices) {
        var saved = entry.Value;
        if (saved?.Coordinate == null || saved.Filters?.Ordered == null || saved.Interval == null || saved.Interval.Present != saved.Interval.Value.HasValue ||
            !saved.Filters.Present && saved.Filters.Ordered.Length != 0 || !before.TryGetValue(entry.Key, out var device) || !after.ContainsKey(entry.Key) ||
            device.InterfaceDigest != saved.InterfaceDigest || device.Coordinate != saved.Coordinate ||
            device.IntervalLocation != saved.IntervalLocation) return false;
        try { IntervalBinding.Validate(device); }
        catch (InvalidOperationException) { return false; }
        if (!UniqueCoordinate(device, before.Values) || !UniqueCoordinate(device, after.Values)) return false;
      }
      foreach (var device in before.Values) {
        // Ordinary disconnection preserves an installed devnode. A missing
        // record could be an incomplete scan or external uninstall; refuse it.
        if (!after.TryGetValue(device.Id, out var next)) return false;
        if (LifecycleSession.Digest(device) == LifecycleSession.Digest(next)) continue;
        if (!Unconfigured(device, record.Ownership, controlSet) || !Unconfigured(next, record.Ownership, controlSet) ||
            !UniqueCoordinate(device, before.Values) || !UniqueCoordinate(next, after.Values)) return false;
        // Only descriptive topology/presence may differ for an existing default
        // scope. Exact coordinates, value representation and isolation stay bound.
        var restored = next with { InterfaceDigest = device.InterfaceDigest, Present = device.Present,
          Speed = device.Speed, Name = device.Name };
        if (LifecycleSession.Digest(restored) != LifecycleSession.Digest(device)) return false;
      }
      foreach (var device in after.Values.Where(x => !before.ContainsKey(x.Id))) {
        if (!Unconfigured(device, record.Ownership, controlSet) || !UniqueCoordinate(device, after.Values)) return false;
      }
      return true;
    }
  }
}
