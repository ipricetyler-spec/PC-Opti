using System;
using System.Linq;
using Dialed.HidusbfHelper;

static class SetupPresentationChecks {
  static int checks;
  static void Check(bool value, string reason) { if (!value) throw new Exception("Setup presentation: " + reason); checks++; }
  public static void Run(LifecycleObservation clean, LifecycleIntent install) {
    var owned = new LifecycleOwnership(false, new System.Collections.Generic.Dictionary<string, SavedDevice>());
    var existing = LifecycleSession.Plan(clean, install, owned).After;
    Check(SetupPresentation.DefaultAction(clean) == "INSTALL", "clean installation default");
    Check(SetupPresentation.DefaultAction(existing) == "ADOPT", "existing installation starts by recording originals");
    Check(SetupPresentation.DefaultAction(null) == null, "no observation cannot default to install");
    foreach (var uncertain in new[] {
      clean with { Service = clean.Service with { ServiceKeyPresent = true } },
      clean with { Service = clean.Service with { File = existing.Service.File } },
      clean with { Service = clean.Service with { Service = existing.Service.Service } },
      clean with { Service = clean.Service with { ServiceParameters = new PatchParameters(true, new DwordValue(false, null), new DwordValue(false, null)) } },
      clean with { Devices = new[] { clean.Devices[0] with { Present = false, Filters = new FilterValue(true, new[] { "HIDUSBF" }) } } }
    }) Check(SetupPresentation.DefaultAction(uncertain) == null, "partial/phantom state never defaults to fresh install");
    Check(SetupPresentation.InstallationText(existing).Contains("already recorded"), "does not infer journal ownership from service presence");
    Check(SetupPresentation.InstallationText(existing).Contains("confirmation"), "recording is explicit");
    Check(SetupPresentation.Actions.Select(x => x.Code).SequenceEqual(new[] { "INSTALL", "ADOPT", "APPLY", "DETACH", "REPAIR", "REMOVE" }), "all useful backend actions retained");
    foreach (var action in SetupPresentation.Actions) {
      Check(action.Label != action.Code && action.ToString() == action.Label, "plain-language action label");
      Check(action.UsesRate == (action.Code == "INSTALL" || action.Code == "APPLY"), "rate field only for rate operations");
      Check(action.UsesDevice == (action.Code != "REPAIR" && action.Code != "REMOVE"), "shared operation does not use selected target");
    }
    var adopt = SetupPresentation.Actions.Single(x => x.Code == "ADOPT");
    string review = SetupPresentation.Review(adopt, "Fixture controller", null, "PATCH_1K", false);
    Check(review.Contains("does not require a restart") && !review.Contains("requires a manual Windows restart"), "adopt review has no restart requirement");
    Check(review.Contains("Record these current settings?") && !review.Contains("Requested rate:"), "adopt confirmation records settings, not a rate");
    Check(review.Contains("does not change device settings"), "adopt purpose explicit");
    var rate = SetupPresentation.Actions.Single(x => x.Code == "APPLY");
    string rateReview = SetupPresentation.Review(rate, "Fixture controller", 2000, "PATCH_1K", true);
    Check(rateReview.Contains("2000 Hz") && rateReview.Contains("requires a manual Windows restart"), "rate/restart match preview");
    Check(rateReview.Contains("will not restart Windows automatically"), "no automatic reboot promise");
    Check(rateReview.Contains("USB child functions") && rateReview.Contains("does not prove USB delivery"), "complete target and evidence scope retained");
    string recorded = SetupPresentation.ResultText("CONFIGURATION_VERIFIED", "ADOPT");
    Check(recorded.Contains("Current settings recorded") && recorded.Contains("requires no restart"), "adopt success has accurate instructions");
    Check(!recorded.Contains("Check saved operation"), "no reconciliation demanded after adoption");
    Check(SetupPresentation.ResultText("RESTART_REQUIRED").Contains("Check saved operation"), "pending restart directs to correctly named control");
    Check(!SetupPresentation.ResultText("CONFIGURATION_VERIFIED").Contains("restart Windows"), "verified generic result does not demand restart");
    Check(SetupPresentation.ResultText("NOT_APPLIED").Contains("was not applied"), "not-applied status preserved");
    Check(SetupPresentation.ResultText("UNKNOWN").Contains("requires review"), "unknown result not reported as success");
    string error = "JOURNAL_SCHEMA_REVIEW_REQUIRED: preserve old record";
    string failure = SetupPresentation.FailureText(error);
    Check(failure.Contains("do not delete or reset") && failure.Contains(error), "history refusal preserves evidence and diagnostic");
    Check(failure.Contains("paused for this session"), "history refusal explains disabled actions");
    Check(SetupPresentation.IsHistoryRefusal(error) && !SetupPresentation.IsHistoryRefusal("Other failure"), "only exact history code pauses session");
    Check(SetupPresentation.FailureText("Other failure") == "Other failure", "unrelated failures retained");
    foreach (bool usable in new[] { false, true }) foreach (bool busy in new[] { false, true }) foreach (bool history in new[] { false, true })
      Check(SetupPresentation.CanRequest(usable, busy, history) == (usable && !busy && !history), "session/busy/history control state");
    Check(SetupPresentation.InitialSelection(existing) == null, "reopening an existing installation never suggests repeating recording");
    Check(SetupPresentation.InitialSelection(clean) == "INSTALL" && SetupPresentation.InitialSelection(null) == null, "clean and disconnected initial selection");
    Check(SetupPresentation.DeviceLabel(@"Controller · USB\VID_054C&PID_0DF2\FIXTURE · HIGH") == "Controller", "normal device label keeps identifiers in details");
    Check(SetupPresentation.DeviceLabel("Two USB devices") == "Two USB devices", "ordinary device names retained");
    Check(SetupPresentation.DeviceLabel(null) == "USB device", "empty label fallback");
    Check(!SetupPresentation.FailureSummary(error).Contains(error) && SetupPresentation.FailureSummary(error).Contains("do not delete or reset"), "summary preserves recovery instructions without raw diagnostic");
    Check(SetupPresentation.FailureSummary("INVENTORY_RECONCILE_REQUIRED: fixture").Contains("Refresh USB inventory"), "inventory summary names available action");
    Check(SetupPresentation.FailureSummary("Adopt exact existing scope first.").Contains("Record current settings"), "missing originals explains first-time step");
    Check(SetupPresentation.FailureSummary("Adoption refused.").Contains("already recorded"), "record refusal does not encourage repeated adoption");
    Check(SetupPresentation.FailureSummary("Patching acknowledgement/security required.").Contains("Keep your security settings unchanged"), "acknowledgement cannot imply disabling security");
    Check(SetupPresentation.FailureSummary("unrecognized transport failure").Contains("Technical details"), "unclassified failure keeps diagnostics discoverable without claiming no mutation");
    Console.WriteLine("closed-setup-presentation-pass:" + checks);
  }
}
