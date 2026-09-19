using System;
using System.Linq;
using System.Text.Json;

namespace Dialed.HidusbfHelper {
  public static class SessionProtocol {
    // Same dispatch/refusal boundary used by the host and closed transport tests.
    // Authentication remains in the host on both sides of this call. Unexpected
    // failures still propagate and terminate the host; they are not authorization.
    public static byte[] Reply(byte[] bytes, string nonce, LifecycleSession session, ILifecycleMachine machine, NativeDiagnostics diagnostics = null) {
      object result;
      try {
        using var request = diagnostics == null ? AuthenticatedPipe.ParseEnvelope(bytes) : diagnostics.At("PARSE_REQUEST", () => AuthenticatedPipe.ParseEnvelope(bytes));
        if (diagnostics != null) diagnostics.Stage = request.RootElement.GetProperty("operation").GetString();
        result = new { ok = true, value = Dispatch(request.RootElement, nonce, session, machine) };
      } catch (Exception error) when (error is InvalidOperationException || error is JsonException || error is System.ComponentModel.Win32Exception || error is System.IO.IOException || error is UnauthorizedAccessException) {
        result = new { ok = false, error = error.Message };
      }
      return JsonSerializer.SerializeToUtf8Bytes(result);
    }

    static void Fields(JsonElement value, params string[] expected) {
      if (value.ValueKind != JsonValueKind.Object) throw new InvalidOperationException("Object required.");
      var fields = value.EnumerateObject().Select(x => x.Name).ToArray();
      if (fields.Length != expected.Length || fields.Distinct().Count() != fields.Length || fields.Except(expected).Any()) throw new InvalidOperationException("Unknown, missing or duplicate fields.");
    }
    public static LifecycleIntent ReadIntent(JsonElement payload) {
      Fields(payload, "Action", "DeviceId", "InterfaceDigest", "RequestedHz", "AcknowledgePatching");
      var intent = JsonSerializer.Deserialize<LifecycleIntent>(payload.GetRawText());
      if (intent == null) throw new InvalidOperationException("Intent required.");
      return intent;
    }
    public static object Dispatch(JsonElement envelope, string sessionNonce, LifecycleSession session, ILifecycleMachine machine) {
      if (envelope.GetProperty("nonce").GetString() != sessionNonce) throw new InvalidOperationException("Wrong session nonce.");
      var payload = envelope.GetProperty("payload");
      switch (envelope.GetProperty("operation").GetString()) {
        case "OBSERVE": Fields(payload); return machine.Observe();
        case "SETUP_STATUS": Fields(payload); return session.ReadSetupStatus();
        case "RECONCILE": Fields(payload); return session.Reconcile();
        case "PREVIEW":
          var preview = session.Preview(ReadIntent(payload));
          return new { preview.Token, preview.PlanDigest, preview.ExpiresAt, preview.Plan.Variant, preview.Plan.RestartRequired, preview.Plan.ReconnectRequired };
        case "APPLY":
          Fields(payload, "Token");
          return session.Apply(payload.GetProperty("Token").GetString(), envelope.GetProperty("planDigest").GetString());
        default: throw new InvalidOperationException("Unsupported operation.");
      }
    }
  }
}
