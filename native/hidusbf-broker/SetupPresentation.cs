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
    // The rate buttons already show what is available; only explain what is missing.
    bool any = device.Rates.Any(x => x.Available);
    var reasons = device.Rates.Where(x => !x.Available).Select(x => x.Reason).Distinct().ToArray();
    return ((any ? "" : "No rate is available to review yet.\r\n") + string.Join("\r\n", reasons)).Trim();
  }
  public static string Progress(LifecycleResult result) => result?.Status switch {
    "RECONNECT_REQUIRED" => "Review complete  →  Setting saved  →  Reconnect device  →  Verify",
    "RECONNECT_WAITING_FOR_DEVICE" => "Review complete  →  Setting saved  →  Device disconnected  →  Reconnect to verify",
    "CONFIGURATION_VERIFIED" when result.ActivationEvidence == "DEVICE_RECONNECT" => "Review complete  →  Setting saved  →  Reconnected  →  Verified",
    "CONFIGURATION_VERIFIED" when result.ActivationEvidence == "WINDOWS_RESTART" => "Review complete  →  Setting saved  →  Windows restarted  →  Verified",
    "RESTART_REQUIRED" => "Review complete  →  Setting saved  →  Windows restart required  →  Check the saved change",
    "ALREADY_CONFIGURED" => "Setting already saved · No change or reconnect requested",
    _ => "Review  →  Save setting  →  Reconnect device if requested  →  Verify"
  };
  public static bool IsRateCompletion(LifecycleResult result) => result?.Status == "CONFIGURATION_VERIFIED" &&
    result.Action == "APPLY" && result.RequestedHz.HasValue &&
    (result.ActivationEvidence == "DEVICE_RECONNECT" || result.ActivationEvidence == "WINDOWS_RESTART");
  public static string ResultText(LifecycleResult result, string action = null) {
    if (IsRateCompletion(result)) return DeviceLabel(result.DeviceName) + ": " + result.RequestedHz + " Hz saved. " +
      (result.ActivationEvidence == "DEVICE_RECONNECT" ? "Device reconnect verified. No Windows restart is needed." : "Configuration verified after the Windows restart.") +
      "\r\nDone. Close setup, then use Check polling rate in Dialed to see what Windows receives.";
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
  // Drift setup can show and let the reader resolve, including a saved change whose own check gave up.
  public static bool IsDriftRefusal(string message) => message?.StartsWith("NEEDS_REVIEW:", StringComparison.Ordinal) == true;
  static readonly string[] DriftRefusalCodes = { "PENDING_OPERATION:", "NOTHING_TO_REVIEW:", "SECURITY_UNKNOWN:", "UNRECOGNIZED_DRIVER:", "OWNED_DEVICE_MOVED:", "REVIEW_STALE:" };
  public static string DriftReviewText(string[] differences) =>
    "Something outside setup changed what setup keeps track of, so it stopped before changing anything.\n\n" +
    "What differs from the saved record:\n" + string.Join("\n", (differences ?? Array.Empty<string>()).Select(x => "•  " + x)) + "\n\n" +
    "Keep current settings saves this state as the new starting point. Nothing on your devices changes, and the recorded originals are kept, so restoring them is still possible.\n\n" +
    "Only keep these if you, or software you trust, made these changes. If you are unsure, cancel and leave setup paused.";
  public static string ReconcileLabel(bool inventoryChanged) => inventoryChanged ? "Refresh USB inventory" : "Check the saved change";
  public static bool IsReconnectPending(string status) => status == "RECONNECT_REQUIRED" || status == "RECONNECT_WAITING_FOR_DEVICE";
  public static string FailureText(string message) => message?.StartsWith("BOOT_IDENTITY_RECONCILE_REQUIRED:", StringComparison.Ordinal) == true
    ? "Choose Check the saved change to update how Dialed recognizes a Windows restart. This only updates the completed recovery record; device settings and recorded originals stay unchanged.\r\nDetails: " + message
    : message?.StartsWith("BOOT_HISTORY_REVIEW_REQUIRED:", StringComparison.Ordinal) == true
    ? "Dialed cannot safely verify this recovery record's Windows restart evidence. Keep the history file intact; do not delete or reset it. No device settings were changed by this request. Setup actions are paused for this session.\r\nDetails: " + message
    : message?.StartsWith("BOOT_SESSION_UNAVAILABLE:", StringComparison.Ordinal) == true
    ? "Windows restart evidence is missing or inconsistent. No recovery history was updated. Review Technical details before continuing.\r\nDetails: " + message
    : IsInventoryRefusal(message)
    ? "Unrelated USB inventory changed. Choose Refresh USB inventory to check the current connections and update the inventory in Dialed's recovery history.\r\n" +
      "This request changed no device settings or saved history. Recorded original settings stay intact. Create a new preview after refreshing.\r\nDetails: " + message
    : IsHistoryRefusal(message)
    ? "Dialed cannot safely use this saved recovery history because its exact restore locations are missing or its format is unsupported.\r\n" +
      "No device settings were changed by this request. Keep the history file intact; do not delete or reset it. The saved record needs review before this version can manage devices: update Dialed, or save a support file from Dialed's Settings and send it to us.\r\n" +
      "Setup actions are paused for this session.\r\nDetails: " + message
    : message;
  public static string FailureSummary(string message) {
    string explained = FailureText(message);
    int diagnostic = explained.IndexOf("\r\nDetails: ", StringComparison.Ordinal);
    if (diagnostic >= 0) return explained.Substring(0, diagnostic);
    if (IsDriftRefusal(message))
      return "Something outside setup changed settings it keeps track of, so it stopped before changing anything. Choose Review what changed to see exactly what differs.";
    var code = DriftRefusalCodes.FirstOrDefault(x => message?.StartsWith(x, StringComparison.Ordinal) == true);
    if (code != null) { string rest = message.Substring(code.Length).Trim(); return rest.Length == 0 ? message : char.ToUpperInvariant(rest[0]) + rest.Substring(1); }
    if (message == "Adopt exact existing scope first.") return "This device needs recorded originals. Choose Record current settings, review and confirm it once, then choose Change polling rate.";
    if (message == "Adoption refused.") return "Current settings could not be recorded. If this device was already recorded, choose Change polling rate. Otherwise review Technical details before continuing.";
    if (message == "Patching acknowledgement/security required." || message == "Patching requires explicit acknowledgement and an already compatible security configuration.")
      return "This plan needs HIDUSBF's patching mode, which cannot run while Memory Integrity is on. Keep your security settings unchanged unless you have decided otherwise; Dialed will not change them, and its Input devices page explains the trade-off.";
    if (message.StartsWith("RECONNECT_MONITOR_UNAVAILABLE:", StringComparison.Ordinal))
      return "The saved rate change is still pending. Close and reopen setup, then choose Check the saved change before unplugging the device. Do not apply the rate again.";
    if (message.StartsWith("RECONNECT_UNSTABLE:", StringComparison.Ordinal))
      return "The device changed while Dialed was checking it. Leave it connected and choose Check the saved change. Do not apply the rate again.";
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
      action.Description + "\n\n" + (action.UsesDevice ? "This includes every part of the device, such as a built-in headset jack or touchpad.\n" : "") +
      restart + "\nA setting does not prove USB delivery or latency.\n\n" +
      // A device that stops responding after the change must not leave the reader with no way to restore it.
      (action.UsesRate ? "If this is your only mouse or keyboard, keep another one connected: if this device stops responding afterwards, you can open setup with it and restore the original settings.\n\n" : "") +
      (action.Code == "ADOPT" ? "Record these current settings?" : "Apply this change?");
  }
  public static string ResultText(string status, string action = null, string deviceName = null) => status switch {
    "RECONNECT_REQUIRED" => "Saved. Now unplug " + DeviceLabel(deviceName) + " and plug it back into the same USB port. Keep this window open; setup checks it automatically. No Windows restart is needed. If setup was reopened, it needs to see a fresh unplug and reconnect.",
    "RECONNECT_WAITING_FOR_DEVICE" => DeviceLabel(deviceName) + " disconnected. Reconnect it to the same USB port and leave this window open. Dialed will check the device and saved setting automatically.",
    "ALREADY_CONFIGURED" => "That rate setting is already saved. Nothing was changed, so no reconnect or Windows restart is requested. The saved setting does not prove delivered rate.",
    "BOOT_IDENTITY_RECORDED" => "Windows session identity recorded. Device settings, recorded originals and shared driver ownership are unchanged. No restart is requested. You can now create a new preview.",
    "INVENTORY_REFRESHED" => "Saved settings are up to date with your current USB connections. Nothing on your devices changed, and recorded originals and shared driver ownership are unchanged. Choose a rate to continue; no restart is requested.",
    "CONFIGURATION_VERIFIED" when action == "ADOPT" => "Current settings recorded. You can now preview a polling-rate change. Recording settings did not change the driver or device configuration and requires no restart.",
    "CONFIGURATION_VERIFIED" => "Saved settings checked: they match this PC. Nothing was changed, and no restart is needed.",
    "RESTART_REQUIRED" => "The saved change requires a manual Windows restart. When ready, restart Windows, then choose Check the saved change. Dialed will not restart Windows automatically. A setting does not prove delivered rate.",
    "BASELINE_ACCEPTED" => "Current settings kept as the new starting point. Nothing on your devices changed, and the recorded originals are kept, so restoring them is still possible. You can choose a rate again.",
    "NOT_APPLIED" => "The saved change was not applied. Review a new preview before requesting another change.",
    _ => "Setup could not tell how this ended (status " + status + "). Choose Check the saved change before trying again."
  };
}
