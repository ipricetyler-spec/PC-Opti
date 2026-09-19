using System;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Dialed.HidusbfHelper;

static class PreviewTransportChecks {
  static int checks;
  static void Check(bool value, string reason) { if (!value) throw new Exception("Preview transport: " + reason); checks++; }
  const string Nonce = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  static byte[] Request(string operation, object payload, string nonce = Nonce) => JsonSerializer.SerializeToUtf8Bytes(new {
    version = 1, operation, nonce, planDigest = new string('0', 64), payload
  });
  // The real frame codec and host Reply path; neither creates a pipe or Windows
  // machine. Reads are deliberately fragmented to exercise byte-stream framing.
  static async Task<JsonDocument> Exchange(byte[] request, LifecycleSession session, ILifecycleMachine machine) {
    using var incoming = new FragmentedStream();
    await AuthenticatedPipe.WriteBoundedMessage(incoming, request, CancellationToken.None);
    incoming.Position = 0;
    byte[] reply = SessionProtocol.Reply(await AuthenticatedPipe.ReadBoundedMessage(incoming, CancellationToken.None), Nonce, session, machine);
    using var outgoing = new FragmentedStream();
    await AuthenticatedPipe.WriteBoundedMessage(outgoing, reply, CancellationToken.None);
    outgoing.Position = 0;
    return JsonDocument.Parse(await AuthenticatedPipe.ReadBoundedMessage(outgoing, CancellationToken.None));
  }
  public static async Task Run(LifecycleObservation initial) {
    var intent = new LifecycleIntent("INSTALL", initial.Devices[0].Id, initial.Devices[0].InterfaceDigest, 1000, true);
    var empty = new LifecycleOwnership(false, new System.Collections.Generic.Dictionary<string, SavedDevice>());
    var installed = LifecycleSession.Plan(initial, intent, empty).After;
    // Model the relevant captured state: external running PATCH_1K service,
    // PatchUSBXHCI=3, eight existing attachments, four phantom/unresolved scopes.
    // This is a closed guard reproduction, not an assertion of full host baseline.
    var shared = installed with {
      Service = installed.Service with {
        Service = installed.Service.Service with { State = 4 },
        ServiceParameters = new PatchParameters(true, new DwordValue(true, 3), new DwordValue(false, null))
      },
      Devices = Enumerable.Range(0, 8).Select(index => installed.Devices[0] with {
        Id = new string((char)('a' + index), 64), Name = "Fixture USB scope " + index, Present = index < 4, Eligible = index < 3,
        Interval = new DwordValue(true, 1), IntervalLocation = "Driver"
      }).ToArray()
    };
    var cases = new[] {
      (initial with { SecurityAccepted = false }, "Security/physical compatibility policy has not accepted this configuration."),
      (initial with { Devices = new[] { initial.Devices[0] with { Authorized = false } } }, "This exact device scope is not authorized by the signed policy."),
      (shared with { SecurityAccepted = false }, "Unresolved shared attachment."),
      (shared, "Unresolved shared attachment."),
      (installed, "Existing service, file or attachment prevents install.")
    };
    foreach (var item in cases) {
      using var log = new JournalLog(new MemoryStream());
      var machine = new ReadOnlyFixture { State = item.Item1 };
      var session = new LifecycleSession(log, machine, () => { });
      using (var observed = await Exchange(Request("OBSERVE", new { }), session, machine))
        Check(observed.RootElement.GetProperty("ok").GetBoolean(), "initial OBSERVE");
      using (var refused = await Exchange(Request("PREVIEW", intent with { AcknowledgePatching = item.Item1 == shared ? false : true }), session, machine)) {
        Check(!refused.RootElement.GetProperty("ok").GetBoolean(), "guard must refuse preview");
        string message = refused.RootElement.GetProperty("error").GetString();
        if (item.Item2 == "Unresolved shared attachment.") {
          Check(message.StartsWith(item.Item2, StringComparison.Ordinal), "specific attachment guard response");
          Check(message.Contains("5 device scope(s)"), "reports every unresolved attachment in the count");
          Check(message.Contains("Fixture USB scope 3 [present, ineligible]") && message.Contains("Fixture USB scope 4 [not present]"), "distinguishes connected and absent blockers");
          Check(!message.Contains("Fixture USB scope 0"), "does not blame eligible target");
        } else Check(message == item.Item2, "specific guard response");
        Check(!refused.RootElement.TryGetProperty("value", out _), "no preview token on refusal");
      }
      using (var observed = await Exchange(Request("OBSERVE", new { }), session, machine))
        Check(observed.RootElement.GetProperty("ok").GetBoolean(), "session usable after expected refusal");
      Check(machine.Executions == 0 && log.Revision == 0, "no execution or journal append for fresh-session refusal");
    }
    // A maximal inventory and hostile/long device labels must still return a
    // readable bounded refusal, not a transport failure or an executable plan.
    using (var log = new JournalLog(new MemoryStream())) {
      var large = shared with { Devices = Enumerable.Range(0, 4096).Select(i => shared.Devices[0] with {
        Id = i.ToString("x64"), Name = i == 0 ? "" : "Label\r\nFORGED\u2028LINE\u202e" + new string('X', 2000), Eligible = false
      }).ToArray() };
      var machine = new ReadOnlyFixture { State = large };
      var session = new LifecycleSession(log, machine, () => { });
      using var refused = await Exchange(Request("PREVIEW", intent), session, machine);
      string message = refused.RootElement.GetProperty("error").GetString();
      Check(!refused.RootElement.GetProperty("ok").GetBoolean() && message.Contains("4096 device scope(s)"), "large inventory refuses with exact count");
      Check(message.Split("\r\n").Count(x => x.StartsWith("- ")) == 8 && message.Contains("Additional affected scopes: 4088."), "detail list bounded without hiding total");
      Check(System.Text.Encoding.UTF8.GetByteCount(refused.RootElement.GetRawText()) < 16384, "refusal fits bounded native frame");
      Check(!message.Contains("\nFORGED") && !message.Contains('\u2028') && !message.Contains('\u202e'), "labels cannot forge lines or directional text");
      Check(message.Contains("USB scope " + new string('0', 64)), "unnamed blocker retains digest identity");
      Check(!refused.RootElement.TryGetProperty("value", out _) && log.Revision == 0 && machine.Executions == 0, "large refusal creates no token, journal or writes");
      machine.State = large with { Devices = large.Devices.Reverse().ToArray() };
      using var reversed = await Exchange(Request("PREVIEW", intent), session, machine);
      Check(reversed.RootElement.GetProperty("error").GetString() == message, "stable diagnostic order across inventory enumeration");
    }
    using (var log = new JournalLog(new MemoryStream())) {
      string emoji = string.Concat(Enumerable.Repeat("😀", 181));
      var labels = shared with { Devices = new[] {
        shared.Devices[0] with { Id = new string('b', 64), Name = "\u200e\u202e", Eligible = false },
        shared.Devices[1] with { Id = new string('c', 64), Name = emoji, Eligible = false },
      } };
      var machine = new ReadOnlyFixture { State = labels };
      var session = new LifecycleSession(log, machine, () => { });
      using var refused = await Exchange(Request("PREVIEW", intent), session, machine);
      string message = refused.RootElement.GetProperty("error").GetString();
      Check(message.Contains("USB scope " + new string('b', 64)), "format-only label falls back to scope identity");
      Check(message.Contains(string.Concat(Enumerable.Repeat("😀", 180)) + "..."), "label bound preserves complete Unicode text elements");
      Check(!refused.RootElement.TryGetProperty("value", out _) && log.Revision == 0 && machine.Executions == 0, "label refusal creates no token, journal or writes");
    }
    using (var log = new JournalLog(new MemoryStream())) {
      var machine = new ReadOnlyFixture { State = initial };
      var session = new LifecycleSession(log, machine, () => { });
      using (var preview = await Exchange(Request("PREVIEW", intent), session, machine))
        Check(preview.RootElement.GetProperty("ok").GetBoolean() && preview.RootElement.GetProperty("value").GetProperty("Token").GetString().Length == 64, "valid preview returns exact token");
      using (var refused = await Exchange(Request("PREVIEW", intent, new string('b', 64)), session, machine))
        Check(refused.RootElement.GetProperty("error").GetString() == "Wrong session nonce.", "wrong nonce remains refused");
      Check(machine.Executions == 0 && log.Revision == 0, "preview is not apply");
    }
    // The captured EOF cannot distinguish these classes of uncaught host failure
    // from termination outside dispatch. Do not label either the live root cause.
    foreach (Exception failure in new Exception[] { new COMException("Closed injected COM failure", unchecked((int)0x80004005)), new ArgumentException("Closed injected argument failure") }) {
      using var log = new JournalLog(new MemoryStream());
      var machine = new ReadOnlyFixture { State = initial, Failure = failure };
      var session = new LifecycleSession(log, machine, () => { });
      bool escaped = false;
      try { SessionProtocol.Reply(Request("PREVIEW", intent), Nonce, session, machine); }
      catch (Exception error) when (ReferenceEquals(error, failure)) { escaped = true; }
      Check(escaped, "unexpected observation exception still terminates host path");
      try {
        await AuthenticatedPipe.ReadBoundedMessage(new MemoryStream(), CancellationToken.None);
        throw new Exception("Expected EOF");
      } catch (EndOfStreamException error) { Check(error.Message == "Incomplete helper message.", "same broker symptom with no reply"); }
      Check(log.Revision == 0 && machine.Executions == 0, "injected failure is fail closed");
    }
    Console.WriteLine("closed-preview-transport-pass:" + checks);
  }
  sealed class ReadOnlyFixture : ILifecycleMachine {
    public LifecycleObservation State;
    public Exception Failure;
    public int Executions;
    public LifecycleObservation Observe() { if (Failure != null) throw Failure; return State; }
    public void Execute(NativePlan plan, LifecycleObservation before, Action assertPeer) { Executions++; throw new Exception("Execution prohibited by fixture"); }
  }
  sealed class FragmentedStream : MemoryStream {
    public override Task<int> ReadAsync(byte[] buffer, int offset, int count, CancellationToken cancel) => base.ReadAsync(buffer, offset, Math.Min(count, 3), cancel);
  }
}
