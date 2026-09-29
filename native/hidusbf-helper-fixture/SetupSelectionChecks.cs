using System;
using Dialed.HidusbfHelper;

static class SetupSelectionChecks {
  static int checks;
  static void Check(bool value, string reason) { if (!value) throw new Exception("Setup selection: " + reason); checks++; }
  public static void Run(DeviceSetting original) {
    // Real device ids, as WindowsMachine makes them: Digest of the upper-case instance ID.
    const string mouseInstance = @"USB\VID_1532&PID_00A5\MOUSE";
    var edge = original with { Id = LifecycleSession.Digest(@"USB\VID_054C&PID_0DF2\EDGE"), Name = "Same display name", Authorized = true };
    var mouse = original with { Id = LifecycleSession.Digest(mouseInstance), Name = "Same display name", Authorized = false };
    var devices = new[] { edge, mouse };
    var hint = mouse.Id;
    Check(SetupSelection.ParseArguments(Array.Empty<string>()) == null, "standalone launch remains supported");
    Check(SetupSelection.ParseArguments(new[] { "--select-device", hint }) == hint, "selection-only arguments");
    foreach (var args in new[] { new[] {hint}, new[] {"--apply", hint}, new[] {"--select-device", hint, "8000"},
      new[] {"--select-device", hint.ToUpperInvariant()}, new[] {"--select-device", hint + "\n"},
      new[] {"--select-device", mouseInstance}, new[] {"--select-device", new string('z', 64)},
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
    // Dialed's own list id (plain SHA256 of the instance ID) is not a setup id and selects nothing.
    var listId = Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(mouseInstance))).ToLowerInvariant();
    Check(SetupSelection.Choose(devices, null, null, listId) == null, "Dialed list id is not accepted as a setup id");
    // Pinned against src/main/input-devices/index.cjs nativeSetupDeviceId for the same instance.
    Check(LifecycleSession.Digest(mouseInstance) == "35f0cde70d75188d2506843c34a06a8bffa67d84b73d867fbba7650113cada35", "setup id matches what Dialed computes");
    Console.WriteLine("closed-setup-selection-pass:" + checks);
  }
}
