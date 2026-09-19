using System;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Channels;
using System.Threading.Tasks;
using Dialed.HidusbfHelper;

static class SessionDiagnosticsChecks {
  const string Nonce = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  static int checks;
  static void Check(bool value, string reason) { if (!value) throw new Exception("Session diagnostics: " + reason); checks++; }
  static byte[] Request(string operation, object payload) => JsonSerializer.SerializeToUtf8Bytes(new {
    version = 1, operation, nonce = Nonce, planDigest = new string('0', 64), payload
  });
  static async Task<Exception> Failure(Func<Task> action) {
    try { await action(); } catch (Exception error) { checks++; return error; }
    throw new Exception("Expected session failure");
  }
  static async Task<byte[]> Frame(byte[] bytes) {
    using var stream = new MemoryStream();
    await AuthenticatedPipe.WriteBoundedMessage(stream, bytes, CancellationToken.None);
    return stream.ToArray();
  }
  static async Task<byte[]> Frame(string json) => await Frame(Encoding.UTF8.GetBytes(json));
  static async Task<int> Serve(Duplex stream, LifecycleSession session, ObservedMachine machine, NativeDiagnostics diagnostics, Action assertPeer, CancellationToken cancel) {
    try { return await NativeSessionServer.Run(stream, Nonce, session, machine, assertPeer, diagnostics, cancel); }
    catch (EndOfStreamException) { return 0; }
    finally { stream.Dispose(); }
  }
  public static async Task Run(LifecycleObservation initial) {
    var intent = new LifecycleIntent("INSTALL", initial.Devices[0].Id, initial.Devices[0].InterfaceDigest, 1000, true);
    // Real server loop + client state machine + fragmented bidirectional framing.
    // Only delegate identity assertions and machine observations are synthetic.
    using (var log = new JournalLog(new MemoryStream())) {
      var diagnostics = new NativeDiagnostics();
      var machine = new ObservedMachine { State = initial with { SecurityAccepted = false }, Diagnostics = diagnostics };
      var session = new LifecycleSession(log, machine, () => { });
      var (broker, host) = Duplex.Pair(); int hostChecks = 0, brokerChecks = 0;
      var server = Serve(host, session, machine, diagnostics, () => hostChecks++, CancellationToken.None);
      using var client = new NativeSessionClient(broker, Nonce, () => brokerChecks++, CancellationToken.None);
      await client.Call<LifecycleObservation>("OBSERVE", new { });
      var refused = await Failure(async () => await client.Call<JsonElement>("PREVIEW", intent));
      Check(refused is NativeRequestRefusedException && refused.Message.Contains("Security/physical"), "specific refusal is nonterminal");
      Check(client.IsUsable && client.LastFailure == null, "refusal keeps the authenticated session usable");
      await client.Call<LifecycleObservation>("OBSERVE", new { });
      Check(hostChecks == 6 && brokerChecks == 6, "both peer checks on every request and response");
      client.Dispose(); Check(await server == 0, "ordinary client close");
      Check(log.Revision == 0 && machine.Executions == 0, "refused preview has no execution/journal append");
    }
    using (var log = new JournalLog(new MemoryStream())) {
      var diagnostics = new NativeDiagnostics();
      var machine = new ObservedMachine { State = initial, Diagnostics = diagnostics };
      var session = new LifecycleSession(log, machine, () => { });
      var (broker, host) = Duplex.Pair();
      var server = Serve(host, session, machine, diagnostics, () => { }, CancellationToken.None);
      using var client = new NativeSessionClient(broker, Nonce, () => Check(!server.IsCompleted, "host alive during both broker peer checks"), CancellationToken.None);
      await client.Call<LifecycleObservation>("OBSERVE", new { });
      machine.BootCom = new BootObservationChecks.FakeCom();
      machine.BootCom.Failures["READ_TIMESTAMP"] = new COMException("SECRET token/path must not enter diagnostics", unchecked((int)0x80004005));
      machine.BootCom.Failures["RELEASE_ROWS"] = new COMException("secondary cleanup", unchecked((int)0x80004002));
      var error = await Failure(async () => await client.Call<JsonElement>("PREVIEW", intent));
      Check(client.LastFailure == new NativeFailure("OBSERVE_BOOT_READ_TIMESTAMP", "System.Runtime.InteropServices.COMException", "0x80004005"), "precise terminal failure identity");
      Check(error.Message.Contains("OBSERVE_BOOT") && !error.Message.Contains("SECRET"), "bounded metadata without exception content");
      Check(!client.IsUsable, "terminal reply closes client");
      Check(await server == 1, "host terminal diagnostic exits with failure after client close");
      int writes = broker.BytesWritten;
      await Failure(async () => await client.Call<JsonElement>("APPLY", new { Token = new string('b', 64) }));
      Check(broker.BytesWritten == writes && machine.Executions == 0 && log.Revision == 0, "no request/execution after terminal failure");
    }
    // Even a client bypassing its closed-state check cannot get another dispatch.
    using (var log = new JournalLog(new MemoryStream())) {
      var diagnostics = new NativeDiagnostics();
      var machine = new ObservedMachine { State = initial, Diagnostics = diagnostics, Error = new ArgumentException("secret") };
      var session = new LifecycleSession(log, machine, () => { });
      var (broker, host) = Duplex.Pair();
      var server = Serve(host, session, machine, diagnostics, () => { }, CancellationToken.None);
      await AuthenticatedPipe.WriteBoundedMessage(broker, Request("PREVIEW", intent), CancellationToken.None);
      using (var reply = JsonDocument.Parse(await AuthenticatedPipe.ReadBoundedMessage(broker, CancellationToken.None))) {
        Check(reply.RootElement.GetProperty("terminal").GetBoolean() && !reply.RootElement.TryGetProperty("value", out _), "terminal failure never carries preview value");
      }
      await AuthenticatedPipe.WriteBoundedMessage(broker, Request("APPLY", new { Token = new string('b', 64) }), CancellationToken.None);
      Check(await server == 1 && machine.Observations == 1 && machine.Executions == 0, "post-terminal APPLY frame discarded");
      broker.Dispose();
    }
    var badReplies = new[] {
      new byte[] { 1, 0 }, new byte[] { 20, 0, 0, 0, 1 }, new byte[] { 255, 255, 255, 255 },
      await Frame("{x"), await Frame("{\"ok\":true,\"ok\":false,\"value\":1}"),
      await Frame("{\"ok\":true}"), await Frame("{\"ok\":true,\"value\":null}"),
      await Frame("{\"ok\":false,\"error\":\"\"}"),
      await Frame("{\"ok\":false,\"error\":\"closed\",\"terminal\":true,\"value\":{}}"),
      await Frame("{\"ok\":false,\"error\":\"closed\",\"terminal\":false,\"diagnostic\":{}}"),
      await Frame("{\"ok\":false,\"error\":\"closed\",\"terminal\":true,\"diagnostic\":{\"Stage\":\"PREVIEW\",\"ExceptionType\":\"System.Exception\",\"HResult\":\"bad\"}}")
    };
    foreach (byte[] reply in badReplies) {
      using var stream = new ScriptedStream(reply);
      using var client = new NativeSessionClient(stream, Nonce, () => { }, CancellationToken.None);
      await Failure(async () => await client.Call<object>("PREVIEW", intent));
      Check(!client.IsUsable && client.LastFailure != null, "bad reply disables session");
      int sent = stream.BytesWritten;
      await Failure(async () => await client.Call<object>("APPLY", new { Token = Nonce }));
      Check(sent == stream.BytesWritten, "no subsequent writes after invalid reply");
    }
    foreach (int failAt in new[] { 1, 2 }) {
      using var stream = new ScriptedStream(await Frame("{\"ok\":true,\"value\":{}}"));
      int assertions = 0;
      using var client = new NativeSessionClient(stream, Nonce, () => { if (++assertions == failAt) throw new InvalidOperationException("Peer changed"); }, CancellationToken.None);
      await Failure(async () => await client.Call<object>("PREVIEW", intent));
      Check(!client.IsUsable && client.LastFailure.Stage == (failAt == 1 ? "CLIENT_AUTHENTICATE_REQUEST" : "CLIENT_AUTHENTICATE_REPLY"), "failed identity checks are terminal");
      Check(failAt != 1 || stream.BytesWritten == 0, "failed initial identity sends nothing");
    }
    foreach (int failAt in new[] { 1, 2 }) {
      using var log = new JournalLog(new MemoryStream());
      var diagnostics = new NativeDiagnostics();
      var machine = new ObservedMachine { State = initial, Diagnostics = diagnostics };
      var session = new LifecycleSession(log, machine, () => { });
      using var stream = new ScriptedStream(await Frame(Request("OBSERVE", new { })));
      int assertions = 0;
      await Failure(async () => await NativeSessionServer.Run(stream, Nonce, session, machine, () => { if (++assertions == failAt) throw new InvalidOperationException("Peer changed"); }, diagnostics, CancellationToken.None));
      Check(stream.BytesWritten == 0 && machine.Executions == 0, "host never sends a reply after either failed peer check");
      Check(diagnostics.Stage == (failAt == 1 ? "AUTHENTICATE_REQUEST" : "AUTHENTICATE_REPLY"), "host identity failure stage retained");
    }
    using (var stream = new ScriptedStream(Array.Empty<byte>()) { FailWrite = true }) {
      using var client = new NativeSessionClient(stream, Nonce, () => { }, CancellationToken.None);
      await Failure(async () => await client.Call<object>("PREVIEW", intent));
      Check(!client.IsUsable && client.LastFailure.Stage == "CLIENT_WRITE_REQUEST", "write failure is terminal");
    }
    using (var log = new JournalLog(new MemoryStream())) {
      var diagnostics = new NativeDiagnostics();
      var machine = new ObservedMachine { State = initial, Diagnostics = diagnostics };
      var session = new LifecycleSession(log, machine, () => { });
      using var stream = new ScriptedStream(new byte[] { 255, 255, 255, 255 });
      await Failure(async () => await NativeSessionServer.Run(stream, Nonce, session, machine, () => { }, diagnostics, CancellationToken.None));
      Check(stream.BytesWritten == 0 && machine.Observations == 0 && diagnostics.Stage == "READ_REQUEST", "invalid incoming frame never reaches dispatch");
    }
    using (var cancel = new CancellationTokenSource()) {
      var (broker, host) = Duplex.Pair();
      using var client = new NativeSessionClient(broker, Nonce, () => { }, cancel.Token);
      var pending = client.Call<object>("PREVIEW", intent);
      int sent = broker.BytesWritten;
      var concurrent = await Failure(async () => await client.Call<object>("APPLY", new { Token = Nonce }));
      Check(concurrent.Message.Contains("already pending") && broker.BytesWritten == sent, "concurrent request cannot interleave framing");
      cancel.Cancel(); await Failure(async () => await pending);
      Check(!client.IsUsable && client.LastFailure.Stage == "CLIENT_READ_REPLY", "cancellation closes pending session");
      await Failure(async () => await client.Call<object>("APPLY", new { Token = Nonce }));
      Check(broker.BytesWritten == sent, "cancellation never retries"); host.Dispose();
    }
    using (var stream = new ScriptedStream(Enumerable.Range(0, 32).SelectMany(_ => Frame("{\"ok\":true,\"value\":{}}").GetAwaiter().GetResult()).ToArray())) {
      using var client = new NativeSessionClient(stream, Nonce, () => { }, CancellationToken.None);
      for (int index = 0; index < 32; index++) await client.Call<object>("OBSERVE", new { });
      int sent = stream.BytesWritten;
      Check(!client.IsUsable, "request limit disables client");
      await Failure(async () => await client.Call<object>("APPLY", new { Token = Nonce }));
      Check(stream.BytesWritten == sent, "request 33 never sent");
    }
    using (var log = new JournalLog(new MemoryStream())) {
      var diagnostics = new NativeDiagnostics();
      var machine = new ObservedMachine { State = initial, Diagnostics = diagnostics };
      var session = new LifecycleSession(log, machine, () => { });
      byte[] frame = await Frame(Request("OBSERVE", new { }));
      using var stream = new ScriptedStream(Enumerable.Range(0, 33).SelectMany(_ => frame).ToArray());
      Check(await NativeSessionServer.Run(stream, Nonce, session, machine, () => { }, diagnostics, CancellationToken.None) == 0 && machine.Observations == 32, "server independently enforces 32-request limit");
    }
    using (var log = new JournalLog(new MemoryStream())) {
      var diagnostics = new NativeDiagnostics();
      var machine = new ObservedMachine { State = initial, Diagnostics = diagnostics, Error = new ArgumentException("fixture") };
      var session = new LifecycleSession(log, machine, () => { });
      var (broker, host) = Duplex.Pair();
      var server = Serve(host, session, machine, diagnostics, () => { }, CancellationToken.None);
      await AuthenticatedPipe.WriteBoundedMessage(broker, Request("PREVIEW", intent), CancellationToken.None);
      await AuthenticatedPipe.ReadBoundedMessage(broker, CancellationToken.None);
      Check(!server.IsCompleted, "terminal host waits for post-read identity check");
      Check(await server.WaitAsync(TimeSpan.FromSeconds(8)) == 1 && machine.Observations == 1 && machine.Executions == 0, "unresponsive client cannot prolong terminal session beyond bounded wait");
      broker.Dispose();
    }
    Console.WriteLine("closed-session-diagnostics-pass:" + checks);
  }
  sealed class ObservedMachine : ILifecycleMachine {
    public LifecycleObservation State;
    public NativeDiagnostics Diagnostics;
    public Exception Error;
    public BootObservationChecks.FakeCom BootCom;
    public int Observations, Executions;
    public LifecycleObservation Observe() { Observations++; return Diagnostics.At("OBSERVE_BOOT", () => {
      if (Error != null) throw Error;
      return BootCom == null ? State : State with { BootId = BootObservation.Read(Diagnostics, BootCom) };
    }); }
    public void Execute(NativePlan plan, LifecycleObservation before, Action assertPeer) { Executions++; throw new Exception("Fixture prohibits execution"); }
  }
  sealed class ScriptedStream : MemoryStream {
    readonly MemoryStream input;
    public int BytesWritten;
    public bool FailWrite;
    public ScriptedStream(byte[] response) { input = new MemoryStream(response); }
    public override Task<int> ReadAsync(byte[] buffer, int offset, int count, CancellationToken cancel) => input.ReadAsync(buffer, offset, Math.Min(count, 3), cancel);
    public override Task WriteAsync(byte[] buffer, int offset, int count, CancellationToken cancel) { if (FailWrite) throw new IOException("Fixture write failure"); BytesWritten += count; return Task.CompletedTask; }
    protected override void Dispose(bool disposing) { if (disposing) input.Dispose(); base.Dispose(disposing); }
  }
  sealed class Duplex : Stream {
    readonly Channel<byte[]> input, output;
    byte[] chunk; int position;
    public int BytesWritten;
    Duplex(Channel<byte[]> input, Channel<byte[]> output) { this.input = input; this.output = output; }
    public static (Duplex, Duplex) Pair() {
      var left = Channel.CreateUnbounded<byte[]>(); var right = Channel.CreateUnbounded<byte[]>();
      return (new Duplex(left, right), new Duplex(right, left));
    }
    public override async Task<int> ReadAsync(byte[] buffer, int offset, int count, CancellationToken cancel) {
      if (chunk == null || position == chunk.Length) {
        if (!await input.Reader.WaitToReadAsync(cancel)) return 0;
        chunk = await input.Reader.ReadAsync(cancel); position = 0;
      }
      int read = Math.Min(3, Math.Min(count, chunk.Length - position));
      Array.Copy(chunk, position, buffer, offset, read); position += read; return read;
    }
    public override async Task WriteAsync(byte[] buffer, int offset, int count, CancellationToken cancel) {
      byte[] bytes = new byte[count]; Array.Copy(buffer, offset, bytes, 0, count);
      BytesWritten += count; await output.Writer.WriteAsync(bytes, cancel);
    }
    public override Task FlushAsync(CancellationToken cancel) => Task.CompletedTask;
    protected override void Dispose(bool disposing) { if (disposing) { input.Writer.TryComplete(); output.Writer.TryComplete(); } base.Dispose(disposing); }
    public override bool CanRead => true; public override bool CanWrite => true; public override bool CanSeek => false;
    public override long Length => throw new NotSupportedException();
    public override long Position { get => throw new NotSupportedException(); set => throw new NotSupportedException(); }
    public override void Flush() { }
    public override int Read(byte[] buffer, int offset, int count) => throw new NotSupportedException();
    public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();
    public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
    public override void SetLength(long value) => throw new NotSupportedException();
  }
}
