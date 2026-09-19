using System;
using System.Linq;

namespace Dialed.HidusbfHelper {
  // Presentation metadata is separate from the observation/journal contracts.
  // Reading it never enrolls, reconciles, starts a watcher or writes a record.
  public sealed record SetupRateOption(int Hz, bool Available, string Reason);
  public sealed record SetupDeviceState(string DeviceId, bool OriginalsRecorded, int? SavedHz,
    string RecommendedAction, SetupRateOption[] Rates, string Message);
  public sealed record SetupSessionState(LifecycleObservation Observation, SetupDeviceState[] Devices,
    string HistoryStatus, LifecycleResult Pending, bool ServiceOwned);

  public sealed partial class LifecycleSession {
    public static int? ConfiguredRate(DeviceSetting device) {
      if (device?.Interval?.Present != true) return null;
      return device.Speed switch {
        "FULL" => device.Interval.Value switch { 8 => 125, 4 => 250, 2 => 500, 1 => 1000, _ => null },
        "HIGH" => device.Interval.Value switch { 4 => 1000, 3 => 2000, 2 => 4000, 1 => 8000, _ => null },
        _ => null
      };
    }
    public SetupSessionState ReadSetupStatus() {
      lock (gate) {
        assertPeer(); var record = ReadRecord();
        // A disconnected pending device may have incomplete topology. Use the
        // clearly identified saved operation until explicit reconciliation.
        var observed = record.Pending != null ? Copy(record.Pending.ReadbackVerified ? record.Pending.Plan.After : record.Pending.Before) : Copy(machine.Observe());
        string history = record.NeedsReview ? "NEEDS_REVIEW" : record.Pending != null ? "PENDING" :
          record.Expected == null || Digest(record.Expected) == Digest(observed) ? "CURRENT" : "CHECK_REQUIRED";
        var devices = observed.Devices.Where(x => x.Eligible).Select(device => {
          bool recorded = record.Ownership.Devices.TryGetValue(device.Id, out var original) &&
            original.InterfaceDigest == device.InterfaceDigest && original.IntervalLocation == device.IntervalLocation &&
            original.Coordinate != null && original.Coordinate == device.Coordinate;
          bool mismatched = record.Ownership.Devices.ContainsKey(device.Id) && !recorded;
          string action = null, message = "Current driver state needs review.";
          if (recorded) { action = "APPLY"; message = "Original settings recorded. Choose a rate to review."; }
          else if (mismatched) message = "Recorded originals do not match this exact device scope. Preserve history and review the connection.";
          else if (observed.Service.Service != null && observed.Service.File != null && Attached(device)) {
            action = "ADOPT"; message = "First use in Dialed: record this device's originals once, then choose a rate. Recording does not change the device.";
          } else if (observed.Service.Service == null && observed.Service.File == null && !observed.Service.ServiceKeyPresent &&
            !observed.Service.ServiceParameters.KeyPresent && !observed.Service.ControlParameters.KeyPresent && !observed.Devices.Any(Attached)) {
            action = "INSTALL"; message = "This device needs driver setup before changing its rate.";
          } else message = "This device has no recorded compatible attachment. Review driver setup; the shared installation will be preserved.";
          if (!device.Present || !device.Authorized || !observed.SecurityAccepted || history != "CURRENT") action = null;
          if (history != "CURRENT") message = history == "PENDING" ? "Finish the saved operation before requesting another change." : "Check the saved operation before making a new request.";
          else if (!device.Authorized) message = "Rate changes for this device are not enabled in this build. This is a driver-policy restriction, not a finding that the device cannot be tuned.";
          else if (!observed.SecurityAccepted) message = "Rate changes are not enabled for this Windows configuration by this build's driver policy.";
          var options = new[] { 125, 250, 500, 1000, 2000, 4000, 8000 }.Select(hz => {
            if (device.Speed != "FULL" && device.Speed != "HIGH") return new SetupRateOption(hz, false, "USB speed is unsupported or unknown.");
            if (device.Speed == "FULL" && hz > 1000) return new SetupRateOption(hz, false, "Full-Speed setup supports up to 1000 Hz.");
            if (device.Speed == "HIGH" && hz < 1000) return new SetupRateOption(hz, false, "High-Speed setup offers 1000, 2000, 4000 and 8000 Hz.");
            if (history != "CURRENT" || mismatched) return new SetupRateOption(hz, false, "Review the saved operation first.");
            if (action == "ADOPT") return new SetupRateOption(hz, false, "Record this device's originals first.");
            if (action == null) return new SetupRateOption(hz, false, message);
            try {
              // Pure planning only; acknowledgement here describes capability.
              // Actual PREVIEW/APPLY still requires the owner's acknowledgement.
              Plan(observed, new LifecycleIntent(action, device.Id, device.InterfaceDigest, hz, true), record.Ownership);
              return new SetupRateOption(hz, true, "Available to review; delivered rate is checked separately.");
            } catch (InvalidOperationException error) {
              string reason = error.Message == "Separate shared variant replacement required." ? "The current shared driver does not support this rate; review driver maintenance separately." :
                error.Message.Contains("acknowledgement") ? "This rate is unavailable with the current Windows security configuration. Keep protections unchanged." : "Current device or driver state does not support this rate. Review technical details.";
              return new SetupRateOption(hz, false, reason);
            }
          }).ToArray();
          return new SetupDeviceState(device.Id, recorded, ConfiguredRate(device), action, options, message);
        }).ToArray();
        LifecycleResult pending = record.Pending == null ? null : ReconnectResult(record.Pending,
          record.Pending.Plan.ReconnectRequired ? "RECONNECT_REQUIRED" : record.Pending.Plan.RestartRequired ? "RESTART_REQUIRED" : "PENDING_REVIEW");
        assertPeer();
        return new SetupSessionState(observed, devices, history, pending, record.Ownership.ServiceOwned);
      }
    }
  }
}
