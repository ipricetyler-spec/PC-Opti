// Closed in-memory protocol tests. No pipe creation, native identity lookup,
// elevation, Registry, device or service call is made by this executable.
// --preview-setup-ui explicitly opens only the shared presentation with inert data.
using System;
using System.IO;
using System.Text;
using System.Diagnostics;
using System.Threading;
using System.Threading.Tasks;
using Dialed.HidusbfHelper;
class Program {
  static int checks;
  const string TargetInstance = @"USB\VID_054C&PID_0DF2\FIXTURE";
  static readonly string TargetId = LifecycleSession.Digest(TargetInstance);
  static async Task<FileStream> ReopenAfterExit(string file) {
    for (int attempt = 0; ; attempt++) {
      try { return new FileStream(file, FileMode.Open, FileAccess.ReadWrite, FileShare.Read); }
      catch (IOException error) when ((error.HResult & 0xffff) == 32 && attempt < 20) { await Task.Delay(50); }
    }
  }
  static void Assert(bool condition) { if (!condition) throw new Exception("Fixture failed."); checks++; }
  static void Refuse(Action action) { bool refused = false; try { action(); } catch (InvalidOperationException) { refused = true; } Assert(refused); }
  static async Task Main(string[] args) {
    if (args.Length == 2 && args[0] == "--capture-setup-ui") {
      SetupAppearanceFixture.CaptureViews(args[1]); return;
    }
    if (args.Length == 2 && args[0] == "--preview-setup-ui") {
      SetupAppearanceFixture.Run(args[1]); return;
    }
    if (args.Length == 2 && args[0] == "--verify-inventory-corpus") {
      InventoryReconciliationChecks.RunCaptured(args[1]); return;
    }
    if (args.Length == 2 && args[0] == "--verify-boot-session-capture") {
      BootSessionChecks.RunCaptured(args[1]); return;
    }
    if (args.Length == 2 && args[0] == "--verify-reconnect-capture") {
      DeviceReconnectChecks.RunCaptured(args[1]); return;
    }
    if (args.Length == 2 && (args[0] == "--digest-corpus" || args[0] == "--verify-digest-corpus")) {
      ScopeDigestChecks.Run(args[1]);
      if (args[0] == "--verify-digest-corpus") return;
      // Continue with the normal closed suite in the same fixture build.
    }
    if (args.Length == 2 && args[0] == "--verify-policy-corpus") {
      using var corpus = System.Text.Json.JsonDocument.Parse(File.ReadAllBytes(args[1]));
      int count = 0;
      foreach (var item in corpus.RootElement.EnumerateArray()) {
        bool accepted = false;
        try {
          ReleasePolicy.Verify(Convert.FromBase64String(item.GetProperty("bytes").GetString()), Convert.FromBase64String(item.GetProperty("signature").GetString()), item.GetProperty("publicKey").GetString(), DateTimeOffset.UtcNow);
          accepted = true;
        } catch { }
        if (accepted != item.GetProperty("accepted").GetBoolean()) throw new Exception("Policy corpus disagreement: " + item.GetProperty("name").GetString());
        count++;
      }
      Console.WriteLine("closed-policy-corpus-pass:" + count);
      return;
    }
    // Closed cross-language signature/schema verification. Reads only fixture or
    // reviewed policy files; never invokes Load, PinExecutable or Windows APIs.
    if (args.Length == 4 && args[0] == "--verify-policy") {
      try {
        ReleasePolicy.Verify(File.ReadAllBytes(args[1]), File.ReadAllBytes(args[2]), File.ReadAllText(args[3]), DateTimeOffset.UtcNow);
        Console.WriteLine("closed-policy-contract-pass");
      } catch { Console.Error.WriteLine("closed-policy-contract-rejected"); Environment.ExitCode = 1; }
      return;
    }
    if (args.Length == 2 && args[0] == "--journal-child") {
      using (var file = new FileStream(args[1], FileMode.CreateNew, FileAccess.ReadWrite, FileShare.Read, 4096, FileOptions.WriteThrough)) {
        var journal = new JournalLog(file); journal.Append("durable-before-mutation", 0);
        Console.WriteLine("checkpoint-flushed"); Console.Out.Flush();
        Thread.Sleep(Timeout.Infinite);
      }
      return;
    }
    string valid = "{\"version\":1,\"operation\":\"OBSERVE\",\"nonce\":\"" + new string('a', 64) + "\",\"planDigest\":\"" + new string('b', 64) + "\",\"payload\":{}}";
    using (var doc = AuthenticatedPipe.ParseEnvelope(Encoding.UTF8.GetBytes(valid))) Assert(doc.RootElement.GetProperty("operation").GetString() == "OBSERVE");
    Refuse(() => AuthenticatedPipe.ParseEnvelope(Encoding.UTF8.GetBytes(valid.Replace("OBSERVE", "RUN_COMMAND"))));
    Refuse(() => AuthenticatedPipe.ParseEnvelope(Encoding.UTF8.GetBytes(valid.Replace("\"version\":1", "\"version\":1,\"version\":1"))));
    Refuse(() => AuthenticatedPipe.ParseEnvelope(Encoding.UTF8.GetBytes(valid.Replace("\"version\":1", "\"extra\":1,\"version\":1"))));
    Refuse(() => new PeerPolicy("", "", ""));
    Refuse(() => NativePeerIdentity.Verify(null, null, false));
    Refuse(() => AuthenticatedPipe.CreateLocalServer("invalid", "S-1-5-18"));
    using (var stream = new MemoryStream()) {
      var bytes = Encoding.UTF8.GetBytes(valid);
      await AuthenticatedPipe.WriteBoundedMessage(stream, bytes, CancellationToken.None);
      stream.Position = 0;
      Assert(Encoding.UTF8.GetString(await AuthenticatedPipe.ReadBoundedMessage(stream, CancellationToken.None)) == valid);
    }
    bool oversized = false;
    try { await AuthenticatedPipe.ReadBoundedMessage(new MemoryStream(new byte[] {255,255,255,255}), CancellationToken.None); } catch (InvalidOperationException) { oversized = true; }
    Assert(oversized);
    bool truncated = false;
    try { await AuthenticatedPipe.ReadBoundedMessage(new MemoryStream(new byte[] {20,0,0,0,1}), CancellationToken.None); } catch (EndOfStreamException) { truncated = true; }
    Assert(truncated);
    bool cancelled = false;
    using (var cancel = new CancellationTokenSource()) { cancel.Cancel(); try { await AuthenticatedPipe.ReadBoundedMessage(new MemoryStream(new byte[10]), cancel.Token); } catch (OperationCanceledException) { cancelled = true; } }
    Assert(cancelled);
    byte[] journalBytes;
    using (var memory = new MemoryStream()) {
      var journal = new JournalLog(memory);
      journal.Append("checkpoint-before", 0); journal.Append("checkpoint-after", 1);
      Assert(journal.Revision == 2);
      Refuse(() => journal.Append("stale", 1));
      journalBytes = memory.ToArray();
    }
    using (var restored = new JournalLog(new MemoryStream(journalBytes))) Assert(restored.Revision == 2 && restored.LastPayload == "checkpoint-after");
    var corrupt = (byte[])journalBytes.Clone(); corrupt[8] ^= 1;
    Refuse(() => new JournalLog(new MemoryStream(corrupt)));
    var partial = new byte[journalBytes.Length - 2]; Array.Copy(journalBytes, partial, partial.Length);
    Refuse(() => new JournalLog(new MemoryStream(partial)));
    // Kill only this fixture's own child after its checkpoint flush. This tests
    // file persistence across a process exit, not protected-machine ACL acceptance.
    string tempFile = Path.Combine(Path.GetTempPath(), "dialed-hidusbf-journal-" + Guid.NewGuid().ToString("N") + ".bin");
    var start = new ProcessStartInfo(Environment.ProcessPath) { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true };
    start.ArgumentList.Add("--journal-child"); start.ArgumentList.Add(tempFile);
    using (var child = Process.Start(start)) {
      try {
        string ready = await child.StandardOutput.ReadLineAsync().WaitAsync(TimeSpan.FromSeconds(10));
        Assert(ready == "checkpoint-flushed");
        bool locked = false;
        try { using (var writer = new FileStream(tempFile, FileMode.Open, FileAccess.ReadWrite, FileShare.Read)) { } } catch (IOException) { locked = true; }
        Assert(locked);
        child.Kill(); await child.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(5));
        using (var file = await ReopenAfterExit(tempFile)) using (var journal = new JournalLog(file))
          Assert(journal.Revision == 1 && journal.LastPayload == "durable-before-mutation");
      } finally {
        if (!child.HasExited) { child.Kill(); child.WaitForExit(5000); }
        if (File.Exists(tempFile)) File.Delete(tempFile);
      }
    }
    var absent = DeviceInventory.DecodeFilters(false, 0, Array.Empty<byte>());
    var empty = DeviceInventory.DecodeFilters(true, 7, Encoding.Unicode.GetBytes("\0\0"));
    Assert(!absent.Present && empty.Present && empty.Ordered.Length == 0);
    var filters = DeviceInventory.DecodeFilters(true, 7, Encoding.Unicode.GetBytes("external\0hidusbf\0\0"));
    Assert(filters.Ordered[0] == "external" && filters.Ordered[1] == "hidusbf");
    Refuse(() => DeviceInventory.DecodeFilters(true, 1, Encoding.Unicode.GetBytes("hidusbf\0\0")));
    Refuse(() => DeviceInventory.DecodeFilters(true, 7, Encoding.Unicode.GetBytes("hidusbf\0")));
    Refuse(() => DeviceInventory.DecodeFilters(true, 7, Encoding.Unicode.GetBytes("hidusbf\0HIDUSBF\0\0")));
    Refuse(() => DeviceInventory.DecodeFilters(true, 7, Encoding.Unicode.GetBytes("external\0\0hidusbf\0\0")));
    var phantom = new InventoryDevice("USB\\PHANTOM", false, filters);
    var connected = new InventoryDevice("USB\\CONNECTED", true, absent);
    var merged = DeviceInventory.Merge(new[] { phantom, connected }, new[] { connected });
    Assert(merged.Length == 2 && !merged[1].Present && merged[1].LowerFilters.Ordered[1] == "hidusbf");
    Refuse(() => DeviceInventory.Merge(new[] { phantom }, new[] { connected }));
    Refuse(() => DeviceInventory.Merge(new[] { connected }, new[] { connected with { LowerFilters = empty } }));
    Refuse(() => DeviceInventory.Merge(new[] { phantom, phantom }, Array.Empty<InventoryDevice>()));
    var missingDword = ServiceInventory.DecodeDword(false, Microsoft.Win32.RegistryValueKind.None, null);
    Assert(!missingDword.Present && missingDword.Value == null);
    Assert(ServiceInventory.DecodeDword(true, Microsoft.Win32.RegistryValueKind.DWord, -1).Value == uint.MaxValue);
    Refuse(() => ServiceInventory.DecodeDword(true, Microsoft.Win32.RegistryValueKind.String, "1"));
    Refuse(() => ServiceInventory.RecognizeVariant(new string('0', 64)));
    Assert(ServiceInventory.RecognizeVariant("db73a8c259e16a0d02f138650497c1bdec81add66d928f3cf3ff39fad4eb421b") == "PATCH_4K_8K");
    var noParameters = new PatchParameters(false, missingDword, missingDword);
    ServiceInventory.ValidateParameters(noParameters, noParameters);
    Refuse(() => ServiceInventory.ValidateParameters(new PatchParameters(true, new DwordValue(true, 1), missingDword), new PatchParameters(true, new DwordValue(true, 3), missingDword)));
    Refuse(() => ServiceInventory.ValidateParameters(new PatchParameters(true, missingDword, new DwordValue(true, 2)), noParameters));
    var normalService = new ServiceConfiguration(1, 3, 1, ServiceInventory.ImagePath, "", 0, Array.Empty<string>(), "", "HIDUSBF", 1);
    ServiceInventory.ValidateService(normalService);
    ServiceInventory.ValidateService(normalService with { ImagePath = ServiceInventory.DriverPath }); Assert(true);
    Refuse(() => ServiceInventory.ValidateService(normalService with { ImagePath = @"C:\other.sys" }));
    Refuse(() => ServiceInventory.ValidateService(normalService with { Dependencies = new[] { "external" } }));
    Refuse(() => ServiceInventory.ValidateService(normalService with { State = 2 }));
    foreach (int rate in new[] { 1000, 2000, 4000, 8000 }) {
      var state = new LifecycleObservation(BootSessionChecks.First, true, false,
        new ServiceObservation(null, false, noParameters, noParameters, null),
        new[] { new DeviceSetting(TargetId, new string('b', 64), true, "HIGH", true, absent, missingDword, "Hardware", Authorized: true,
          Coordinate: IntervalBinding.Create(TargetInstance, "Hardware"), IntervalIsolated: true) });
      var fixture = new FixtureMachine { State = state };
      using var log = new JournalLog(new MemoryStream());
      var session = new LifecycleSession(log, fixture, () => { });
      var install = session.Preview(new LifecycleIntent("INSTALL", TargetId, new string('b', 64), rate, true));
      Assert(session.Apply(install.Token, install.PlanDigest).Status == "RESTART_REQUIRED");
      Refuse(() => session.Apply(install.Token, install.PlanDigest));
      Assert(fixture.State.Devices[0].Interval.Value == (rate == 1000 ? 4u : rate == 2000 ? 3u : rate == 4000 ? 2u : 1u));
      fixture.Restart(); Assert(session.Reconcile().Status == "CONFIGURATION_VERIFIED");
      var detach = session.Preview(new LifecycleIntent("DETACH", TargetId, new string('b', 64), null, false));
      Assert(session.Apply(detach.Token, detach.PlanDigest).Status == "RESTART_REQUIRED");
      Assert(!fixture.State.Devices[0].Filters.Present && !fixture.State.Devices[0].Interval.Present);
      fixture.Restart(); Assert(session.Reconcile().Status == "CONFIGURATION_VERIFIED");
      var remove = session.Preview(new LifecycleIntent("REMOVE", null, null, null, false));
      Assert(session.Apply(remove.Token, remove.PlanDigest).Status == "RESTART_REQUIRED");
      Assert(fixture.State.Service.File == null && fixture.State.Service.Service == null);
      fixture.Restart(); Assert(session.Reconcile().Status == "CONFIGURATION_VERIFIED");
    }
    var initial = new LifecycleObservation(BootSessionChecks.First, true, false,
      new ServiceObservation(null, false, noParameters, noParameters, null),
      new[] { new DeviceSetting(TargetId, new string('b', 64), true, "HIGH", true, absent, missingDword, "Hardware", Authorized: true,
        Coordinate: IntervalBinding.Create(TargetInstance, "Hardware"), IntervalIsolated: true) });
    var request = new LifecycleIntent("INSTALL", TargetId, new string('b', 64), 8000, true);
    var emptyOwnership = new LifecycleOwnership(false, new System.Collections.Generic.Dictionary<string, SavedDevice>());
    Refuse(() => LifecycleSession.Plan(initial, request with { DeviceId = new string('c', 64) }, emptyOwnership));
    Refuse(() => LifecycleSession.Plan(initial, request with { InterfaceDigest = new string('c', 64) }, emptyOwnership));
    Refuse(() => LifecycleSession.Plan(initial, request with { RequestedHz = 9000 }, emptyOwnership));
    Refuse(() => LifecycleSession.Plan(initial, request with { AcknowledgePatching = false }, emptyOwnership));
    Refuse(() => LifecycleSession.Plan(initial with { MemoryIntegrity = true }, request, emptyOwnership));
    Refuse(() => LifecycleSession.Plan(initial with { SecurityAccepted = false }, request, emptyOwnership));
    Refuse(() => LifecycleSession.Plan(initial with { Devices = new[] { initial.Devices[0] with { Authorized = false } } }, request, emptyOwnership));
    Refuse(() => LifecycleSession.Plan(initial with { Devices = new[] { initial.Devices[0] with { Speed = "FULL" } } }, request, emptyOwnership));
    Refuse(() => LifecycleSession.Plan(initial with { Devices = new[] { initial.Devices[0] with { Present = false } } }, request, emptyOwnership));
    Refuse(() => LifecycleSession.Plan(initial with { Devices = new[] { initial.Devices[0] with { Eligible = false } } }, request, emptyOwnership));
    var full = initial with { MemoryIntegrity = true, Devices = new[] { initial.Devices[0] with { Speed = "FULL" } } };
    Assert(LifecycleSession.Plan(full, request with { RequestedHz = 1000, AcknowledgePatching = false }, emptyOwnership).Variant == "NOPATCH");
    var installedState = LifecycleSession.Plan(initial, request, emptyOwnership).After;
    await PreviewTransportChecks.Run(initial);
    await SessionDiagnosticsChecks.Run(initial);
    await BootObservationChecks.Run();
    BootRecoveryChecks.Run(initial, request);
    BootSessionChecks.Run(initial, request);
    OperationScopeChecks.Run(initial, request);
    InventoryReconciliationChecks.Run(initial, request);
    SetupPresentationChecks.Run(initial, request);
    SetupStateChecks.Run(initial, request);
    SetupSelectionChecks.Run(initial.Devices[0]);
    DeviceReconnectChecks.Run(initial, request);
    Refuse(() => LifecycleSession.Plan(installedState, new LifecycleIntent("REMOVE", null, null, null, false), emptyOwnership));
    var adopted = LifecycleSession.Plan(installedState, request with { Action = "ADOPT", RequestedHz = null }, emptyOwnership);
    Assert(!adopted.Ownership.ServiceOwned && adopted.Ownership.Devices.Count == 1);
    var restoredPlan = LifecycleSession.Plan(installedState, request with { Action = "DETACH", RequestedHz = null }, adopted.Ownership);
    Assert(restoredPlan.After.Devices[0].Filters.Ordered[0] == "hidusbf");
    foreach (string failure in new[] { "BEFORE", "AFTER", "PARTIAL" }) {
      var fixture = new FixtureMachine { State = initial, Failure = failure };
      using var log = new JournalLog(new MemoryStream());
      var session = new LifecycleSession(log, fixture, () => { });
      var p = session.Preview(request);
      Refuse(() => session.Apply(p.Token, p.PlanDigest));
      Refuse(() => session.Apply(p.Token, p.PlanDigest));
      if (failure == "BEFORE") Assert(session.Reconcile().Status == "NOT_APPLIED");
      if (failure == "AFTER") { Assert(session.Reconcile().Status == "RESTART_REQUIRED"); fixture.Restart(); Assert(session.Reconcile().Status == "CONFIGURATION_VERIFIED"); }
      if (failure == "PARTIAL") { Refuse(() => session.Reconcile()); Refuse(() => session.Preview(request)); }
    }
    using (var log = new JournalLog(new MemoryStream())) {
      DateTimeOffset now = DateTimeOffset.UtcNow;
      var fixture = new FixtureMachine { State = initial };
      var session = new LifecycleSession(log, fixture, () => { }, () => now);
      var p = session.Preview(request); now = now.AddMinutes(3);
      Refuse(() => session.Apply(p.Token, p.PlanDigest));
      Assert(log.Revision == 0 && fixture.State.Service.Service == null);
      p = session.Preview(request); fixture.State = initial with { PlatformDigest = new string('c', 64) };
      Refuse(() => session.Apply(p.Token, p.PlanDigest));
      Assert(log.Revision == 0);
    }
    using (var doc = System.Text.Json.JsonDocument.Parse("{\"Action\":\"INSTALL\",\"Action\":\"REMOVE\",\"DeviceId\":null,\"InterfaceDigest\":null,\"RequestedHz\":null,\"AcknowledgePatching\":false}")) Refuse(() => SessionProtocol.ReadIntent(doc.RootElement));
    // Both source and key-compiled candidate builds must refuse missing policy.
    // A unique absent path avoids reading an incidental working-directory file.
    string absentPolicy = Path.Combine(Path.GetTempPath(), "dialed-missing-policy-" + Guid.NewGuid().ToString("N"));
    Assert(!Directory.Exists(absentPolicy));
    bool absentPolicyRefused = false;
    try { ReleasePolicy.Load(absentPolicy); }
    catch (InvalidOperationException error) when (error.Message.StartsWith("UNCONFIGURED:", StringComparison.Ordinal)) { absentPolicyRefused = true; }
    catch (DirectoryNotFoundException) { absentPolicyRefused = true; }
    catch (FileNotFoundException) { absentPolicyRefused = true; }
    Assert(absentPolicyRefused);
    using (var rsa = System.Security.Cryptography.RSA.Create(3072)) {
      var policy = new ReleasePolicyData(1, DateTimeOffset.UtcNow.AddDays(1), new string('a', 64), new string('b', 64), new string('C', 40), new[] { new string('d', 64) }, AuthorizedDeviceDigests: new[] { new string('e', 64) });
      byte[] bytes = System.Text.Json.JsonSerializer.SerializeToUtf8Bytes(policy);
      byte[] signature = rsa.SignData(bytes, System.Security.Cryptography.HashAlgorithmName.SHA256, System.Security.Cryptography.RSASignaturePadding.Pss);
      Assert(ReleasePolicy.Verify(bytes, signature, rsa.ExportSubjectPublicKeyInfoPem(), DateTimeOffset.UtcNow).SchemaVersion == 1);
      Refuse(() => ReleasePolicy.Verify(bytes, signature, rsa.ExportSubjectPublicKeyInfoPem(), DateTimeOffset.UtcNow.AddDays(2)));
      bytes[10] ^= 1;
      Refuse(() => ReleasePolicy.Verify(bytes, signature, rsa.ExportSubjectPublicKeyInfoPem(), DateTimeOffset.UtcNow));

      // Schema 2: the general release authorizes device and speed classes, not listed devices.
      string pem = rsa.ExportSubjectPublicKeyInfoPem();
      byte[] General(Action<System.Collections.Generic.Dictionary<string, object>> change = null) {
        var fields = new System.Collections.Generic.Dictionary<string, object> {
          ["SchemaVersion"] = 2, ["ExpiresAt"] = DateTimeOffset.UtcNow.AddDays(90).ToString("yyyy-MM-ddTHH:mm:ssZ"),
          ["BrokerSha256"] = new string('a', 64), ["HelperSha256"] = new string('b', 64), ["PublisherThumbprint"] = new string('C', 40),
          ["Purpose"] = "ACCEPTED_RELEASE", ["DeviceClasses"] = new[] { "MOUSE", "KEYBOARD", "GAMEPAD" }, ["SpeedClasses"] = new[] { "FULL", "HIGH" },
          ["MinimumWindowsBuild"] = 19045, ["DeniedDevices"] = new[] { "1234:ABCD" },
        };
        change?.Invoke(fields);
        return System.Text.Json.JsonSerializer.SerializeToUtf8Bytes(fields);
      }
      ReleasePolicyData Signed(byte[] data) => ReleasePolicy.Verify(data, rsa.SignData(data, System.Security.Cryptography.HashAlgorithmName.SHA256, System.Security.Cryptography.RSASignaturePadding.Pss), pem, DateTimeOffset.UtcNow);
      var general = Signed(General());
      Assert(general.SchemaVersion == 2 && general.DeviceClasses.Length == 3 && general.MinimumWindowsBuild == 19045);
      foreach (var bad in new Action<System.Collections.Generic.Dictionary<string, object>>[] {
        f => f["Purpose"] = "VALIDATION_ONLY",
        f => f["DeviceClasses"] = new[] { "MOUSE", "PRINTER" },
        f => f["DeviceClasses"] = new string[0],
        f => f["DeviceClasses"] = new[] { "MOUSE", "MOUSE" },
        f => f["SpeedClasses"] = new[] { "LOW" },
        f => f["MinimumWindowsBuild"] = 1,
        f => f["MinimumWindowsBuild"] = 19045.5,
        f => f["DeniedDevices"] = new[] { "not-an-id" },
        f => f["ExpiresAt"] = DateTimeOffset.UtcNow.AddDays(500).ToString("yyyy-MM-ddTHH:mm:ssZ"),
        f => f["ExpiresAt"] = DateTimeOffset.UtcNow.AddDays(-1).ToString("yyyy-MM-ddTHH:mm:ssZ"),
        f => f["AuthorizedDeviceDigests"] = new[] { new string('e', 64) },
        f => f.Remove("DeniedDevices"),
        f => f["Extra"] = true,
      }) Refuse(() => Signed(General(bad)));
      byte[] tampered = General(); byte[] tamperedSignature = rsa.SignData(tampered, System.Security.Cryptography.HashAlgorithmName.SHA256, System.Security.Cryptography.RSASignaturePadding.Pss);
      tampered[tampered.Length - 3] ^= 1;
      Refuse(() => ReleasePolicy.Verify(tampered, tamperedSignature, pem, DateTimeOffset.UtcNow));

      DeviceFacts Mouse(string id = @"USB\VID_046D&PID_C547\5&1", string speed = "HIGH", params string[] kinds) => new DeviceFacts(new string('f', 64), id, speed, kinds.Length == 0 ? new[] { "MOUSE" } : kinds);
      Assert(ReleasePolicy.DeviceAllowedByClass(general, Mouse()));
      Assert(ReleasePolicy.DeviceAllowedByClass(general, Mouse(kinds: new[] { "MOUSE", "KEYBOARD" })));
      Assert(ReleasePolicy.DeviceAllowedByClass(general, Mouse(speed: "FULL")));
      Assert(!ReleasePolicy.DeviceAllowedByClass(general, Mouse(speed: "LOW")));
      Assert(!ReleasePolicy.DeviceAllowedByClass(general, Mouse(speed: "UNKNOWN")));
      Assert(!ReleasePolicy.DeviceAllowedByClass(general, Mouse(kinds: new[] { "MOUSE", "JOYSTICK" })));
      Assert(!ReleasePolicy.DeviceAllowedByClass(general, new DeviceFacts(new string('f', 64), @"USB\VID_046D&PID_C547\5&1", "HIGH", new string[0])));
      Assert(!ReleasePolicy.DeviceAllowedByClass(general, Mouse(id: @"USB\VID_1234&PID_abcd\7&2")));
      Assert(!ReleasePolicy.DeviceAllowedByClass(general, Mouse(id: @"HID\VID_046D&PID_C547\5&1")));
      Assert(!ReleasePolicy.DeviceAllowedByClass(policy, Mouse()));
    }
    Console.WriteLine("closed-native-protocol-pass:" + checks);
  }
}

static class BootRecoveryChecks {
  static int checks;
  static void Check(bool value, string reason) { if (!value) throw new Exception("Boot recovery: " + reason); checks++; }
  static void Refuse(Action action) {
    try { action(); } catch (InvalidOperationException) { checks++; return; }
    throw new Exception("Boot recovery: expected refusal.");
  }
  static LifecycleRecord Record(JournalLog log) => System.Text.Json.JsonSerializer.Deserialize<LifecycleRecord>(log.LastPayload);
  public static void Run(LifecycleObservation initial, LifecycleIntent installIntent) {
    // Adopt a running external stack, persist across a fresh session, and retain
    // its ordered filters, absent interval and lack of service-removal ownership.
    var empty = new LifecycleOwnership(false, new System.Collections.Generic.Dictionary<string, SavedDevice>());
    var installed = LifecycleSession.Plan(initial, installIntent, empty).After;
    var baseline = installed with {
      Service = installed.Service with { Service = installed.Service.Service with { State = 4 } },
      Devices = new[] { installed.Devices[0] with { Filters = new FilterValue(true, new[] { "external", "hidusbf", "other" }), Interval = new DwordValue(false, null) } }
    };
    var adoptIntent = installIntent with { Action = "ADOPT", RequestedHz = null };
    var restoreIntent = installIntent with { Action = "DETACH", RequestedHz = null, AcknowledgePatching = false };
    using (var log = new JournalLog(new MemoryStream())) {
      var machine = new FixtureMachine { State = baseline };
      var session = new LifecycleSession(log, machine, () => { });
      var adopt = session.Preview(adoptIntent);
      Check(session.Apply(adopt.Token, adopt.PlanDigest).Status == "CONFIGURATION_VERIFIED", "adoption");
      string ownership = LifecycleSession.Digest(Record(log).Ownership);
      var stale = session.Preview(installIntent with { Action = "APPLY" });
      machine.Restart();
      // Reproduce the original failure directly, before any preview can latch drift.
      Check(session.Reconcile().Status == "CONFIGURATION_VERIFIED", "adopt then ordinary reboot");
      Check(LifecycleSession.Digest(Record(log).Ownership) == ownership, "adopted ownership preserved");
      Refuse(() => session.Apply(stale.Token, stale.PlanDigest));
      machine.Restart();
      session = new LifecycleSession(log, machine, () => { });
      long revision = log.Revision;
      Refuse(() => session.Preview(restoreIntent));
      Check(log.Revision == revision && !Record(log).NeedsReview, "boot-only preview refusal must not poison recovery");
      Check(session.Reconcile().Status == "CONFIGURATION_VERIFIED", "fresh session after another reboot");
      var change = session.Preview(installIntent with { Action = "APPLY" });
      session.Apply(change.Token, change.PlanDigest); machine.Restart(); session.Reconcile();
      machine.Restart();
      Check(session.Reconcile().Status == "CONFIGURATION_VERIFIED", "completed apply then unrelated reboot");
      Check(LifecycleSession.Digest(Record(log).Ownership) == ownership, "original baseline survives apply and reboots");
      var restore = session.Preview(restoreIntent);
      session.Apply(restore.Token, restore.PlanDigest); machine.Restart(); session.Reconcile();
      Check(LifecycleSession.Digest(machine.State.Devices) == LifecycleSession.Digest(baseline.Devices), "exact external filters and absent interval restored");
      Check(!Record(log).Ownership.ServiceOwned && Record(log).Ownership.Devices.Count == 0, "external service remains unowned");
      Refuse(() => session.Preview(new LifecycleIntent("REMOVE", null, null, null, false)));
    }
    // A completed owned installation also survives an extra boot and retains the
    // absent original values through restore, then permits only owned removal.
    using (var log = new JournalLog(new MemoryStream())) {
      var machine = new FixtureMachine { State = initial };
      var session = new LifecycleSession(log, machine, () => { });
      var install = session.Preview(installIntent); session.Apply(install.Token, install.PlanDigest);
      Refuse(() => session.Preview(restoreIntent));
      machine.Restart(); session.Reconcile(); machine.Restart();
      session = new LifecycleSession(log, machine, () => { });
      Check(session.Reconcile().Status == "CONFIGURATION_VERIFIED", "owned installation after extra reboot");
      Check(Record(log).Ownership.ServiceOwned && Record(log).Ownership.Devices.Count == 1, "owned baseline retained");
      var restore = session.Preview(restoreIntent); session.Apply(restore.Token, restore.PlanDigest);
      machine.Restart(); session.Reconcile();
      Check(LifecycleSession.Digest(machine.State.Devices) == LifecycleSession.Digest(initial.Devices), "owned installation restores absent values");
      var remove = session.Preview(new LifecycleIntent("REMOVE", null, null, null, false));
      Check(remove.Plan.Ownership.ServiceOwned == false, "owned service removal still available");
    }
    // Changing BootId cannot launder any other field, expired authorization,
    // corrupt identity or a previously latched review requirement.
    var drifts = new Func<LifecycleObservation, LifecycleObservation>[] {
      x => x with { PlatformDigest = new string('f', 64) },
      x => x with { SecurityAccepted = false },
      x => x with { MemoryIntegrity = true },
      x => x with { Service = x.Service with { Service = x.Service.Service with { State = 1 } } },
      x => x with { Service = x.Service with { File = x.Service.File with { Sha256 = new string('f', 64) } } },
      x => x with { Devices = new[] { x.Devices[0] with { InterfaceDigest = new string('f', 64) } } },
      x => x with { Devices = new[] { x.Devices[0] with { Authorized = false } } },
      x => x with { Devices = new[] { x.Devices[0] with { Filters = new FilterValue(false, Array.Empty<string>()) } } },
      x => x with { Devices = new[] { x.Devices[0] with { Interval = new DwordValue(true, 2) } } },
      x => x with { Devices = new[] { x.Devices[0] with { Id = new string('f', 64) } } },
      x => x with { BootId = "" }
    };
    foreach (var drift in drifts) {
      using var log = new JournalLog(new MemoryStream());
      var machine = new FixtureMachine { State = baseline };
      var session = new LifecycleSession(log, machine, () => { });
      var adopt = session.Preview(adoptIntent); session.Apply(adopt.Token, adopt.PlanDigest);
      string ownership = LifecycleSession.Digest(Record(log).Ownership);
      machine.Restart(); machine.State = drift(machine.State);
      Refuse(() => session.Reconcile()); Refuse(() => session.Preview(restoreIntent));
      Check((machine.State.BootId == "" || Record(log).NeedsReview) && LifecycleSession.Digest(Record(log).Ownership) == ownership, "drift refused with originals retained");
      machine.State = baseline with { BootId = "another-boot" };
      Refuse(() => session.Reconcile());
    }
    Console.WriteLine("closed-boot-recovery-pass:" + checks);
  }
}

class FixtureMachine : ILifecycleMachine {
  public LifecycleObservation State;
  public string Failure;
  public LifecycleObservation Observe() => State;
  public void Execute(NativePlan plan, LifecycleObservation before, Action assertPeer) {
    assertPeer(); string failure = Failure; Failure = null;
    if (failure == "BEFORE") throw new InvalidOperationException("Fixture interruption before mutation.");
    State = plan.After;
    if (failure == "PARTIAL") State = State with { Devices = new[] { State.Devices[0] with { Interval = new DwordValue(true, 9) } } };
    if (failure == "AFTER" || failure == "PARTIAL") throw new InvalidOperationException("Fixture interruption after mutation.");
  }
  public void Restart() {
    State = State with { BootId = BootSessionChecks.Next(State.BootId) };
    if (State.Service.Service != null) State = State with { Service = State.Service with { Service = State.Service.Service with { State = Array.Exists(State.Devices, x => Array.Exists(x.Filters.Ordered, value => value.Equals("hidusbf", StringComparison.OrdinalIgnoreCase))) ? 4u : 1u } } };
  }
}
