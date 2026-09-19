using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;

namespace Dialed.HidusbfHelper {
  // Derived by the helper, never accepted in a caller's LifecycleIntent.
  public sealed record IntervalCoordinate(string InstanceId, string RegistryView, string KeyPath, string ValueName);
  public sealed record IntervalSnapshot(DwordValue Value, string Location, IntervalCoordinate Coordinate);
  public interface IIntervalValue : IDisposable {
    DwordValue Read();
    void Write(DwordValue value);
  }
  public interface IIntervalStore {
    IntervalSnapshot Read(string instance);
    bool IsExclusive(IntervalCoordinate coordinate);
    IIntervalValue Open(IntervalCoordinate coordinate);
  }

  public static class IntervalBinding {
    public static string ControlSet(IntervalCoordinate coordinate) {
      if (coordinate?.KeyPath == null || !Regex.IsMatch(coordinate.KeyPath, @"^SYSTEM\\CONTROLSET[0-9]{3}\\"))
        throw new InvalidOperationException("Exact control-set identity required.");
      return coordinate.KeyPath.Split('\\')[1];
    }
    static string Root(string controlSet) {
      if (controlSet == null || !Regex.IsMatch(controlSet, @"^CONTROLSET[0-9]{3}$", RegexOptions.IgnoreCase) || controlSet.EndsWith("000", StringComparison.Ordinal))
        throw new InvalidOperationException("Unknown control-set identity.");
      return @"SYSTEM\" + controlSet.ToUpperInvariant() + @"\";
    }
    public static string DriverKey(string reference, string controlSet = "ControlSet001") {
      if (reference == null || !Regex.IsMatch(reference, @"^\{[0-9a-fA-F-]{36}\}\\[0-9]{4}$") ||
          !Guid.TryParse(reference.Substring(0, 38), out _))
        throw new InvalidOperationException("Unknown device driver-key identity.");
      return Root(controlSet) + @"CONTROL\CLASS\" + reference.ToUpperInvariant();
    }
    public static IntervalCoordinate Create(string instance, string location, string driverReference = null, string controlSet = "ControlSet001") {
      if (instance == null || !Regex.IsMatch(instance, @"^USB\\VID_[0-9A-F]{4}&PID_[0-9A-F]{4}[^\\/]*\\[^\\/]+$", RegexOptions.IgnoreCase) ||
          instance.Contains("..") || instance.Any(char.IsControl))
        throw new InvalidOperationException("Unsupported interval device identity.");
      string id = instance.ToUpperInvariant();
      string root = Root(controlSet);
      string path = location switch {
        "Hardware" => root + @"ENUM\" + id,
        "Parameters" => root + @"ENUM\" + id + @"\DEVICE PARAMETERS",
        "Driver" => DriverKey(driverReference, controlSet),
        _ => throw new InvalidOperationException("Unknown interval location.")
      };
      return new IntervalCoordinate(id, "Registry64", path, "bInterval");
    }
    public static void Validate(DeviceSetting device) {
      var coordinate = device.Coordinate;
      if (coordinate == null || coordinate.KeyPath == null || !device.IntervalIsolated ||
          LifecycleSession.Digest(coordinate.InstanceId) != device.Id)
        throw new InvalidOperationException("Exact isolated interval coordinate required.");
      string controlSet = ControlSet(coordinate);
      string classRoot = Root(controlSet) + @"CONTROL\CLASS\";
      string reference = device.IntervalLocation == "Driver" && coordinate.KeyPath.StartsWith(classRoot, StringComparison.Ordinal)
        ? coordinate.KeyPath.Substring(classRoot.Length) : null;
      if (Create(coordinate.InstanceId, device.IntervalLocation, reference, controlSet) != coordinate)
        throw new InvalidOperationException("Invalid interval coordinate.");
      if (device.Interval == null || device.Interval.Present != device.Interval.Value.HasValue)
        throw new InvalidOperationException("Invalid interval value.");
    }
    public static bool IsExclusive(IntervalCoordinate coordinate, IEnumerable<(string InstanceId, string DriverKey)> owners) {
      if (coordinate == null) return false;
      if (!coordinate.KeyPath.StartsWith(Root(ControlSet(coordinate)) + @"CONTROL\CLASS\", StringComparison.Ordinal)) return true;
      var matches = owners.Where(x => string.Equals(x.DriverKey, coordinate.KeyPath, StringComparison.OrdinalIgnoreCase)).ToArray();
      return matches.Length == 1 && string.Equals(matches[0].InstanceId, coordinate.InstanceId, StringComparison.OrdinalIgnoreCase);
    }
    public static void Write(IIntervalStore store, DeviceSetting before, DeviceSetting after, Action assertPeer) {
      Validate(before); Validate(after);
      if (before.Id != after.Id || before.Coordinate != after.Coordinate || before.IntervalLocation != after.IntervalLocation)
        throw new InvalidOperationException("Interval destination changed.");
      var expected = new IntervalSnapshot(before.Interval, before.IntervalLocation, before.Coordinate);
      assertPeer();
      if (store.Read(before.Coordinate.InstanceId) != expected || !store.IsExclusive(before.Coordinate))
        throw new InvalidOperationException("Interval coordinate or value changed before write.");
      // Open the saved key itself, not a freshly resolved Driver reference.
      using var value = store.Open(before.Coordinate);
      if (value.Read() != before.Interval || store.Read(before.Coordinate.InstanceId) != expected || !store.IsExclusive(before.Coordinate))
        throw new InvalidOperationException("Interval coordinate or value changed before write.");
      assertPeer();
      value.Write(after.Interval);
      if (value.Read() != after.Interval) throw new InvalidOperationException("Exact interval readback mismatch.");
    }
  }
}
