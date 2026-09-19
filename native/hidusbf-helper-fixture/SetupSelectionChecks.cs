using System;
using Dialed.HidusbfHelper;

static class SetupSelectionChecks {
  static int checks;
  static void Check(bool value, string reason) { if (!value) throw new Exception("Setup selection: " + reason); checks++; }
  public static void Run(DeviceSetting original) {
    var edge = original with { Id = @"USB\VID_054C&PID_0DF2\EDGE", Name = "Same display name", Authorized = true };
    var mouse = original with { Id = @"USB\VID_1532&PID_00A5\MOUSE", Name = "Same display name", Authorized = false };
    var devices = new[] { edge, mouse };
    var hint = SetupSelection.DeviceKey(mouse.Id);
    Check(SetupSelection.ParseArguments(Array.Empty<string>()) == null, "standalone launch remains supported");
    Check(SetupSelection.ParseArguments(new[] { "--select-device", hint }) == hint, "selection-only arguments");
    foreach (var args in new[] { new[] {hint}, new[] {"--apply", hint}, new[] {"--select-device", hint, "8000"},
      new[] {"--select-device", hint.ToUpperInvariant()}, new[] {"--select-device", hint + "\n"},
      new[] {"--select-device", mouse.Id}, new[] {"--select-device", new string('z', 64)},
      new[] {"--select-device", new string('a', 63)}, new[] {"--select-device", (string)null} }) {
      bool refused = false; try { SetupSelection.ParseArguments(args); } catch (InvalidOperationException) { refused = true; }
      Check(refused, "malformed or command-bearing launch refused");
    }
    Check(SetupSelection.Choose(devices, null, null, hint) == mouse, "main selection wins over first device and duplicate display name");
    Check(!SetupSelection.Choose(devices, null, null, hint).Authorized, "selecting a device never grants policy authorization");
    Check(SetupSelection.Choose(new[] {mouse, edge}, null, null, hint) == mouse, "inventory order is irrelevant");
    Check(SetupSelection.Choose(devices, edge.Id, null, hint) == edge, "pending operation takes priority");
    Check(SetupSelection.Choose(devices, null, edge.Id, hint) == edge, "explicit later dropdown selection is retained");
    Check(SetupSelection.Choose(new[] {edge}, null, null, hint) == null, "missing main selection cannot fall back to Edge");
    Check(SetupSelection.Choose(devices, "MISSING", null, hint) == null, "missing pending device cannot fall back");
    Check(SetupSelection.Choose(devices, null, "MISSING", hint) == null, "disconnected retained selection cannot switch silently");
    Check(SetupSelection.Choose(new[] {edge, mouse, mouse}, null, null, hint) == null, "ambiguous identity cannot select a peer");
    Check(SetupSelection.Choose(new[] {mouse with { Eligible = false }, edge}, null, null, hint) == null, "ineligible hint does not select another device");
    Check(SetupSelection.Choose(devices, null, null, null) == edge, "standalone initial default retained");
    Check(SetupSelection.DeviceKey(mouse.Id.ToLowerInvariant()) == hint, "same instance normalization as main inventory");
    Check(SetupSelection.DeviceKey(mouse.Id + "-OTHER-PORT") != hint, "different instance never shares selection");
    Console.WriteLine("closed-setup-selection-pass:" + checks);
  }
}
