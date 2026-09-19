using System;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;

namespace Dialed.HidusbfHelper {
  public sealed record NativeFailure(string Stage, string ExceptionType, string HResult);

  // In-memory diagnostic context only. Never records paths, device IDs, tokens,
  // exception messages/stacks, or journal content. Successful steps restore phase;
  // a failed nested read leaves its precise stage without changing exception type.
  public sealed class NativeDiagnostics {
    public string Stage { get; set; } = "STARTUP";
    public T At<T>(string stage, Func<T> action) {
      string previous = Stage; Stage = stage;
      T result = action(); Stage = previous; return result;
    }
    public NativeFailure Failure(Exception error) => new NativeFailure(Stage,
      error.GetType().FullName ?? "System.Exception", "0x" + unchecked((uint)error.HResult).ToString("X8"));
  }

  public static class NativeSessionServer {
    public const int RequestLimit = 32;
    // Caller supplies a verified, pinned peer and session. Framing/peer failures
    // are never converted into an authenticated response. Unexpected dispatch
    // failure sends diagnostics only, then closes; there is no resumed dispatch.
    public static async Task<int> Run(Stream stream, string nonce, LifecycleSession session, ILifecycleMachine machine,
      Action assertPeer, NativeDiagnostics diagnostics, CancellationToken cancel) {
      for (int messages = 0; messages < RequestLimit; messages++) {
        diagnostics.Stage = "READ_REQUEST";
        byte[] request = await AuthenticatedPipe.ReadBoundedMessage(stream, cancel);
        diagnostics.Stage = "AUTHENTICATE_REQUEST"; assertPeer();
        bool terminal = false;
        byte[] reply;
        diagnostics.Stage = "DISPATCH";
        try { reply = SessionProtocol.Reply(request, nonce, session, machine, diagnostics); }
        catch (Exception error) when (error is not OperationCanceledException && error is not OutOfMemoryException) {
          terminal = true;
          reply = JsonSerializer.SerializeToUtf8Bytes(new { ok = false, error = "Native helper failure; session closed. Outcome requires review.",
            terminal = true, diagnostic = diagnostics.Failure(error) });
        }
        diagnostics.Stage = "AUTHENTICATE_REPLY"; assertPeer();
        diagnostics.Stage = "WRITE_REPLY";
        await AuthenticatedPipe.WriteBoundedMessage(stream, reply, cancel);
        if (terminal) {
          // Keep the host alive for the broker's REQUIRED post-read peer check.
          // The broker closes the pipe after accepting a terminal diagnostic.
          // Any further frame is discarded without parsing/dispatch/execution.
          diagnostics.Stage = "TERMINAL_CLOSE";
          using var close = CancellationTokenSource.CreateLinkedTokenSource(cancel);
          close.CancelAfter(TimeSpan.FromSeconds(5));
          try { await AuthenticatedPipe.ReadBoundedMessage(stream, close.Token); }
          catch (Exception error) when (error is IOException || error is OperationCanceledException || error is InvalidOperationException) { }
          return 1;
        }
      }
      return 0;
    }
  }

  public sealed class NativeRequestRefusedException : InvalidOperationException {
    public NativeRequestRefusedException(string message) : base(message) { }
  }

  // One request at a time, no retries/reconnects. After a failed peer check,
  // malformed/truncated reply, cancellation, or terminal diagnostic the channel
  // cannot issue another request, including APPLY with a previously seen token.
  public sealed class NativeSessionClient : IDisposable {
    readonly Stream stream;
    readonly string nonce;
    readonly Action assertPeer;
    readonly CancellationToken cancel;
    int requests, busy;
    bool closed;
    public bool IsUsable => !closed && !cancel.IsCancellationRequested && requests < NativeSessionServer.RequestLimit;
    public NativeFailure LastFailure { get; private set; }
    public NativeSessionClient(Stream stream, string nonce, Action assertPeer, CancellationToken cancel) {
      this.stream = stream ?? throw new ArgumentNullException(nameof(stream));
      if (!LifecycleSession.IsDigest(nonce)) throw new InvalidOperationException("Session nonce required.");
      this.nonce = nonce; this.assertPeer = assertPeer ?? throw new ArgumentNullException(nameof(assertPeer)); this.cancel = cancel;
    }
    static void Fields(JsonElement value, params string[] expected) {
      if (value.ValueKind != JsonValueKind.Object) throw new InvalidOperationException("Invalid native reply.");
      var names = value.EnumerateObject().Select(x => x.Name).ToArray();
      if (names.Length != expected.Length || names.Distinct().Count() != names.Length || names.Except(expected).Any())
        throw new InvalidOperationException("Unexpected native reply fields.");
    }
    public async Task<T> Call<T>(string operation, object payload, string digest = null) {
      if (!IsUsable) throw new InvalidOperationException("Native session closed. Reopen native setup before another request.");
      if (Interlocked.CompareExchange(ref busy, 1, 0) != 0) throw new InvalidOperationException("Native request already pending.");
      var diagnostics = new NativeDiagnostics();
      try {
        cancel.ThrowIfCancellationRequested();
        diagnostics.Stage = "CLIENT_AUTHENTICATE_REQUEST"; assertPeer();
        var message = new { version = 1, operation, nonce, planDigest = digest ?? new string('0', 64), payload };
        requests++;
        diagnostics.Stage = "CLIENT_WRITE_REQUEST";
        await AuthenticatedPipe.WriteBoundedMessage(stream, JsonSerializer.SerializeToUtf8Bytes(message), cancel);
        diagnostics.Stage = "CLIENT_READ_REPLY";
        byte[] bytes = await AuthenticatedPipe.ReadBoundedMessage(stream, cancel);
        diagnostics.Stage = "CLIENT_AUTHENTICATE_REPLY"; assertPeer();
        diagnostics.Stage = "CLIENT_PARSE_REPLY";
        using var response = JsonDocument.Parse(bytes, new JsonDocumentOptions { MaxDepth = 32 });
        var root = response.RootElement;
        if (root.GetProperty("ok").GetBoolean()) {
          Fields(root, "ok", "value");
          T value = JsonSerializer.Deserialize<T>(root.GetProperty("value").GetRawText());
          if (value is null) throw new InvalidOperationException("Missing native reply value.");
          return value;
        }
        if (root.TryGetProperty("terminal", out var terminal)) {
          Fields(root, "ok", "error", "terminal", "diagnostic");
          if (terminal.ValueKind != JsonValueKind.True || root.GetProperty("error").ValueKind != JsonValueKind.String)
            throw new InvalidOperationException("Invalid terminal reply.");
          var detail = root.GetProperty("diagnostic"); Fields(detail, "Stage", "ExceptionType", "HResult");
          var failure = JsonSerializer.Deserialize<NativeFailure>(detail.GetRawText());
          if (failure == null || failure.Stage == null || !Regex.IsMatch(failure.Stage, "^[A-Z_]{1,48}$") ||
            failure.ExceptionType == null || !Regex.IsMatch(failure.ExceptionType, "^[A-Za-z0-9_.+`]{1,160}$") ||
            failure.HResult == null || !Regex.IsMatch(failure.HResult, "^0x[0-9A-F]{8}$")) throw new InvalidOperationException("Invalid native diagnostic.");
          LastFailure = failure;
          throw new InvalidOperationException($"Native helper stopped during {failure.Stage}: {failure.ExceptionType} ({failure.HResult}). Outcome requires review.");
        }
        Fields(root, "ok", "error");
        string refusal = root.GetProperty("error").GetString();
        if (string.IsNullOrWhiteSpace(refusal)) throw new InvalidOperationException("Missing native refusal reason.");
        throw new NativeRequestRefusedException(refusal);
      } catch (NativeRequestRefusedException) { throw; }
      catch (Exception error) {
        LastFailure ??= diagnostics.Failure(error);
        Dispose();
        throw;
      } finally { Interlocked.Exchange(ref busy, 0); }
    }
    public void Dispose() { if (closed) return; closed = true; stream.Dispose(); }
  }
}
