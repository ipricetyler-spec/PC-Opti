using System;
using System.Linq;
using Dialed.HidusbfHelper;

// Pure presentation shared with the closed fixture. It never dispatches a request.
sealed record SetupAction(string Code, string Label, string Description, bool UsesDevice, bool UsesRate) {
  public override string ToString() => Label;
}
static class SetupPresentation {
  public static readonly SetupAction[] Actions = {
    new("INSTALL", "Install HIDUSBF", "Install the bundled driver for a new installation. An existing shared driver must be preserved.", true, true),
    new("ADOPT", "Record current settings", "Save this device's current settings in Dialed's recovery history before changing its rate. This does not change device settings or take ownership of the shared driver.", true, false),
    new("APPLY", "Change polling rate", "Change the selected USB device's polling-rate setting using its recorded originals. Other devices and the shared driver must stay unchanged.", true, true),
    new("DETACH", "Restore recorded settings", "Restore this device's recorded settings, including any HIDUSBF filter it already had. This does not uninstall the shared driver.", true, false),
    new("REPAIR", "Verify managed driver", "Check an unchanged driver managed by Dialed. This does not replace files or repair unexpected changes.", false, false),
    new("REMOVE", "Remove managed driver", "Remove only a driver owned by Dialed after every attachment is removed and the service is stopped. An existing external driver cannot be removed this way.", false, false)
  };
  public static string DefaultAction(LifecycleObservation observation) {
    if (observation == null) return null;
    var service = observation.Service;
    if (service.Service != null && service.File != null) return "ADOPT";
    bool attached = observation.Devices.Any(x => x.Filters.Ordered.Any(f => f.Equals("hidusbf", StringComparison.OrdinalIgnoreCase)));
    return service.Service == null && service.File == null && !service.ServiceKeyPresent &&
      !service.ServiceParameters.KeyPresent && !service.ControlParameters.KeyPresent && !attached ? "INSTALL" : null;
  }
  public static string InstallationText(LifecycleObservation observation) => DefaultAction(observation) switch {
    "ADOPT" => "HIDUSBF is already installed. Record current settings once, or choose Change polling rate if this device was already recorded. Both need your confirmation.",
    "INSTALL" => "No existing HIDUSBF installation or attachment was found. Preview an installation before applying it.",
    _ => "Existing driver state needs review. No installation action was selected automatically. Preserve the current driver and settings."
  };
  // OBSERVE does not report enrollment. Do not suggest repeating ADOPT merely
  // because the shared service exists; the user chooses the applicable step.
  public static string InitialSelection(LifecycleObservation observation) => DefaultAction(observation) == "INSTALL" ? "INSTALL" : null;
  public static string SuggestedAction(SetupDeviceState device) => device?.RecommendedAction;
  public static string RateHelp(SetupDeviceState device) {
    if (device == null) return "Select a device to see available rates.";
    var available = device.Rates.Where(x => x.Available).Select(x => x.Hz + " Hz").ToArray();
    string choices = available.Length == 0 ? "No rate is available to review yet." : "Available to review: " + string.Join(", ", available) + ".";
    var reasons = device.Rates.Where(x => !x.Available).Select(x => x.Reason).Distinct();
    return choices + "\r\n" + string.Join("\r\n", reasons);
  }
  public static string Progress(LifecycleResult result) => result?.Status switch {
    "RECONNECT_REQUIRED" => "Review complete  →  Setting saved  →  Reconnect device  →  Verify",
    "RECONNECT_WAITING_FOR_DEVICE" => "Review complete  →  Setting saved  →  Device disconnected  →  Reconnect to verify",
    "CONFIGURATION_VERIFIED" when result.ActivationEvidence == "DEVICE_RECONNECT" => "Review complete  →  Setting saved  →  Reconnected  →  Verified",
    "CONFIGURATION_VERIFIED" when result.ActivationEvidence == "WINDOWS_RESTART" => "Review complete  →  Setting saved  →  Windows restarted  →  Verified",
    "RESTART_REQUIRED" => "Review complete  →  Setting saved  →  Windows restart required  →  Check saved operation",
    "ALREADY_CONFIGURED" => "Setting already saved · No change or reconnect requested",
    _ => "Review  →  Save setting  →  Reconnect device if requested  →  Verify"
  };
  public static bool IsRateCompletion(LifecycleResult result) => result?.Status == "CONFIGURATION_VERIFIED" &&
    result.Action == "APPLY" && result.RequestedHz.HasValue &&
    (result.ActivationEvidence == "DEVICE_RECONNECT" || result.ActivationEvidence == "WINDOWS_RESTART");
  public static string ResultText(LifecycleResult result, string action = null) {
    if (IsRateCompletion(result)) return DeviceLabel(result.DeviceName) + ": " + result.RequestedHz + " Hz saved. " +
      (result.ActivationEvidence == "DEVICE_RECONNECT" ? "Device reconnect verified. No Windows restart is needed." : "Configuration verified after the Windows restart.") +
      "\r\nThis change is complete. You can close setup. Measured Windows delivery is a separate check in Dialed.";
    return ResultText(result.Status, action ?? result.Action, result.DeviceName);
  }
  public static string DeviceLabel(string name) {
    if (string.IsNullOrWhiteSpace(name)) return "USB device";
    int identity = name.IndexOf(" · USB\\", StringComparison.OrdinalIgnoreCase);
    return identity > 0 ? name.Substring(0, identity) : name;
  }
  public static bool CanRequest(bool usable, bool busy, bool historyNeedsReview) => usable && !busy && !historyNeedsReview;
  public static bool CanPreview(bool canRequest, bool inventoryChanged, SetupAction action) => canRequest && !inventoryChanged && action != null;
  public static bool IsHistoryRefusal(string message) => message?.StartsWith("JOURNAL_SCHEMA_REVIEW_REQUIRED:", StringComparison.Ordinal) == true ||
    message?.StartsWith("BOOT_HISTORY_REVIEW_REQUIRED:", StringComparison.Ordinal) == true;
  public static bool IsInventoryRefusal(string message) => message?.StartsWith("INVENTORY_RECONCILE_REQUIRED:", StringComparison.Ordinal) == true ||
    message?.StartsWith("INVENTORY_REFRESH_UNSTABLE:", StringComparison.Ordinal) == true;
  public static string ReconcileLabel(bool inventoryChanged) => inventoryChanged ? "Refresh USB inventory" : "Check saved operation";
  public static bool IsReconnectPending(string status) => status == "RECONNECT_REQUIRED" || status == "RECONNECT_WAITING_FOR_DEVICE";
  public static string FailureText(string message) => message?.StartsWith("BOOT_IDENTITY_RECONCILE_REQUIRED:", StringComparison.Ordinal) == true
    ? "Choose Check saved operation to update how Dialed recognizes a Windows restart. This only updates the completed recovery record; device settings and recorded originals stay unchanged.\r\nDetails: " + message
    : message?.StartsWith("BOOT_HISTORY_REVIEW_REQUIRED:", StringComparison.Ordinal) == true
    ? "Dialed cannot safely verify this recovery record's Windows restart evidence. Keep the history file intact; do not delete or reset it. No device settings were changed by this request. Setup actions are paused for this session.\r\nDetails: " + message
    : message?.StartsWith("BOOT_SESSION_UNAVAILABLE:", StringComparison.Ordinal) == true
    ? "Windows restart evidence is missing or inconsistent. No recovery history was updated. Review Technical details before continuing.\r\nDetails: " + message
    : IsInventoryRefusal(message)
    ? "Unrelated USB inventory changed. Choose Refresh USB inventory to check the current connections and update the inventory in Dialed's recovery history.\r\n" +
      "This request changed no device settings or saved history. Recorded original settings stay intact. Create a new preview after refreshing.\r\nDetails: " + message
    : IsHistoryRefusal(message)
    ? "Dialed cannot safely use this saved recovery history because its exact restore locations are missing or its format is unsupported.\r\n" +
      "No device settings were changed by this request. Keep the history file intact; do not delete or reset it. The saved record needs review before this version can manage devices.\r\n" +
      "Setup actions are paused for this session.\r\nDetails: " + message
    : message;
  public static string FailureSummary(string message) {
    string explained = FailureText(message);
    int diagnostic = explained.IndexOf("\r\nDetails: ", StringComparison.Ordinal);
    if (diagnostic >= 0) return explained.Substring(0, diagnostic);
    if (message == "Adopt exact existing scope first.") return "This device needs recorded originals. Choose Record current settings, review and confirm it once, then choose Change polling rate.";
    if (message == "Adoption refused.") return "Current settings could not be recorded. If this device was already recorded, choose Change polling rate. Otherwise review Technical details before continuing.";
    if (message == "Patching acknowledgement/security required." || message == "Patching requires explicit acknowledgement and an already compatible security configuration.")
      return "Read the HIDUSBF requirement above and check its acknowledgement before reviewing. If it is already checked, this configuration does not meet the requirement. Keep your security settings unchanged.";
    if (message.StartsWith("RECONNECT_MONITOR_UNAVAILABLE:", StringComparison.Ordinal))
      return "The saved rate change is still pending. Close and reopen setup, then choose Check saved operation before unplugging the device. Do not apply the rate again.";
    if (message.StartsWith("RECONNECT_UNSTABLE:", StringComparison.Ordinal))
      return "The device changed while Dialed was checking it. Leave it connected and choose Check saved operation. Do not apply the rate again.";
    return "Setup could not complete this request. Review Technical details before trying again.";
  }
  public static string Review(SetupAction action, string deviceName, int? rate, string variant, bool restartRequired, bool reconnectRequired = false) {
    string rateLine = action.UsesRate ? $"\nRequested rate: {rate} Hz" : "";
    string restart = reconnectRequired
      ? "After applying, keep this window open. Unplug this USB device and reconnect it to the same port. Dialed will check it automatically. This rate-only change does not require a Windows restart."
      : restartRequired
      ? "This plan requires a manual Windows restart after applying. Dialed will not restart Windows automatically."
      : "This plan does not require a restart.";
    string mode = variant == "NOPATCH" ? "Standard USB filtering" : "USB driver patching";
    return $"Action: {action.Label}\nDevice: {(action.UsesDevice ? deviceName : "shared driver")}{rateLine}\nDriver mode: {mode}\n\n" +
      action.Description + "\n\n" + (action.UsesDevice ? "The selected device includes its USB child functions.\n" : "") +
      restart + "\nA setting does not prove USB delivery or latency.\n\n" +
      (action.Code == "ADOPT" ? "Record these current settings?" : "Apply this exact preview?");
  }
  public static string ResultText(string status, string action = null, string deviceName = null) => status switch {
    "RECONNECT_REQUIRED" => "Rate setting saved for " + DeviceLabel(deviceName) + ". Keep this window open. Unplug that device and reconnect it to the same USB port; Dialed will check it automatically. No Windows restart is required for this rate-only change. If setup was reopened, it needs to see a fresh unplug/reconnect. Delivered rate has not been measured.",
    "RECONNECT_WAITING_FOR_DEVICE" => DeviceLabel(deviceName) + " disconnected. Reconnect it to the same USB port and leave this window open. Dialed will check the device and saved setting automatically.",
    "ALREADY_CONFIGURED" => "That rate setting is already saved. Nothing was changed, so no reconnect or Windows restart is requested. The saved setting does not prove delivered rate.",
    "BOOT_IDENTITY_RECORDED" => "Windows session identity recorded. Device settings, recorded originals and shared driver ownership are unchanged. No restart is requested. You can now create a new preview.",
    "INVENTORY_REFRESHED" => "USB inventory refreshed. Recorded original settings and shared driver ownership are unchanged. No device settings were changed and no restart is requested. Create a new preview before applying a change.",
    "CONFIGURATION_VERIFIED" when action == "ADOPT" => "Current settings recorded. You can now preview a polling-rate change. Recording settings did not change the driver or device configuration and requires no restart.",
    "CONFIGURATION_VERIFIED" => "Configuration verified. No restart is requested by this result. Use Windows delivery measurement separately to check delivered rate.",
    "RESTART_REQUIRED" => "The saved change requires a manual Windows restart. When ready, restart Windows, then choose Check saved operation. Dialed will not restart Windows automatically. A setting does not prove delivered rate.",
    "NOT_APPLIED" => "The saved operation was not applied. Review a new preview before requesting another change.",
    _ => "Operation status requires review: " + status
  };
}
