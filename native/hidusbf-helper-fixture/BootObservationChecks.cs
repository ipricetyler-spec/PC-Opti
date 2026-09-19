using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Threading.Tasks;
using Dialed.HidusbfHelper;

static class BootObservationChecks {
  const string Stamp = "20260909071531.123456-300";
  static int checks;
  static void Check(bool value, string reason) { if (!value) throw new Exception("Boot observation: " + reason); checks++; }
  public sealed class TimestampRow {
    public object Value;
    public Exception Error;
    public object LastBootUpTime { get { if (Error != null) throw Error; return Value; } }
  }
  internal sealed class FakeCom : IBootCom {
    internal readonly Dictionary<string, Exception> Failures = new();
    internal readonly List<string> Calls = new();
    internal string[] Values = new[] { Stamp };
    readonly object locator = new(), service = new(), rows = new();
    sealed record Row(string Value);
    T Call<T>(string stage, Func<T> action) {
      Calls.Add(stage);
      if (Failures.TryGetValue(stage, out var error)) throw error;
      return action();
    }
    public Type ResolveLocator() => Call("RESOLVE_LOCATOR", () => typeof(object));
    public object CreateLocator(Type type) => Call("CREATE_LOCATOR", () => locator);
    public object Connect(object value) => Call("CONNECT", () => { if (value != locator) throw new Exception("Wrong locator"); return service; });
    public object Query(object value) => Call("QUERY", () => { if (value != service) throw new Exception("Wrong service"); return rows; });
    public IEnumerator Enumerate(object value) => Call("ENUMERATOR", () => { if (value != rows) throw new Exception("Wrong rows"); return new Rows(this); });
    public string ReadTimestamp(object value) => Call("READ_TIMESTAMP", () => ((Row)value).Value);
    public void Release(object value) => Call(value == locator ? "RELEASE_LOCATOR" : value == service ? "RELEASE_SERVICE" : value == rows ? "RELEASE_ROWS" : "RELEASE_ROW", () => true);
    sealed class Rows : IEnumerator, IDisposable {
      readonly FakeCom owner; int index = -1;
      internal Rows(FakeCom owner) { this.owner = owner; }
      public bool MoveNext() => owner.Call("MOVE_NEXT", () => ++index < owner.Values.Length);
      public object Current => owner.Call("CURRENT", () => new Row(owner.Values[index]));
      public void Reset() => throw new Exception("Enumeration must not restart");
      public void Dispose() => owner.Call("DISPOSE_ENUMERATOR", () => true);
    }
  }
  static Exception ReadFailure(FakeCom com, NativeDiagnostics diagnostics) {
    try { diagnostics.At("OBSERVE_BOOT", () => BootObservation.Read(diagnostics, com)); }
    catch (Exception error) { return error; }
    throw new Exception("Expected boot read failure");
  }
  public static async Task Run() {
    // Exercise the actual property-access implementation without COM activation.
    // The real Windows regression remains a separately invoked read-only probe.
    var access = new WindowsBootCom();
    Check(access.ReadTimestamp(new TimestampRow { Value = Stamp }) == Stamp, "production property reader preserves exact value");
    Check(access.ReadTimestamp(new TimestampRow { Value = "new-boot" }) == "new-boot", "production property reader resolves each new object");
    var propertyFailure = new COMException("property failed", unchecked((int)0x80004005));
    try { access.ReadTimestamp(new TimestampRow { Error = propertyFailure }); throw new Exception("Expected property failure"); }
    catch (COMException error) { Check(ReferenceEquals(error, propertyFailure), "reflection preserves original COM exception without invocation wrapper"); }
    Check(access.ReadTimestamp(new TimestampRow { Value = null }) == null, "missing property value is not replaced");
    try { access.ReadTimestamp(new TimestampRow { Value = 123 }); throw new Exception("Expected type refusal"); }
    catch (InvalidCastException) { Check(true, "non-string timestamp refused without coercion"); }
    var normal = new FakeCom(); var context = new NativeDiagnostics { Stage = "PREVIEW" };
    for (int i = 0; i < 6; i++) {
      Check(context.At("OBSERVE_BOOT", () => BootObservation.Read(context, normal)) == Stamp, "raw timestamp unchanged across repeated reads");
      Check(context.Stage == "PREVIEW", "successful nested reads restore outer stage");
    }
    Check(normal.Calls.Count(x => x == "CREATE_LOCATOR") == 6, "each observation re-reads; no identity cache");
    Check(normal.Calls.Count(x => x == "RELEASE_LOCATOR") == 6, "each observation cleans up");
    var asyncValue = await Task.Run(() => BootObservation.Read(new NativeDiagnostics(), new FakeCom()));
    Check(asyncValue == Stamp, "closed adapter works through asynchronous continuation; not a COM apartment test");
    normal.Values = new[] { "20260910071531.123456-300" };
    Check(BootObservation.Read(context, normal) == normal.Values[0], "changed boot remains visible");

    string[] stages = { "RESOLVE_LOCATOR", "CREATE_LOCATOR", "CONNECT", "QUERY", "ENUMERATOR", "MOVE_NEXT", "CURRENT", "READ_TIMESTAMP", "RELEASE_ROW", "DISPOSE_ENUMERATOR", "RELEASE_ROWS", "RELEASE_SERVICE", "RELEASE_LOCATOR" };
    foreach (string stage in stages) {
      var com = new FakeCom(); var diagnostic = new NativeDiagnostics();
      var original = new COMException("SECRET path/token", unchecked((int)0x80004005));
      com.Failures[stage] = original;
      var error = ReadFailure(com, diagnostic);
      Check(ReferenceEquals(original, error), "original exception preserved at " + stage);
      Check(diagnostic.Failure(error) == new NativeFailure("OBSERVE_BOOT_" + stage, "System.Runtime.InteropServices.COMException", "0x80004005"), "precise operation and HRESULT at " + stage);
      Check(!JsonSerializer.Serialize(diagnostic.Failure(error)).Contains("SECRET"), "diagnostics omit exception contents");
      Check(com.Calls.Count(x => x == stage) == 1, "failed operation is never retried");
      if (Array.IndexOf(stages, stage) >= 2) Check(com.Calls.Contains("RELEASE_LOCATOR"), "acquired locator gets cleanup");
      if (Array.IndexOf(stages, stage) >= 3) Check(com.Calls.Contains("RELEASE_SERVICE"), "acquired service gets cleanup");
      if (Array.IndexOf(stages, stage) >= 4) Check(com.Calls.Contains("RELEASE_ROWS"), "acquired rows get cleanup");
    }
    // A property failure followed by multiple cleanup failures previously lost
    // the original exception in nested finally blocks and skipped later releases.
    var multiple = new FakeCom(); var primary = new COMException("primary", unchecked((int)0x80004005));
    multiple.Failures["READ_TIMESTAMP"] = primary;
    foreach (string stage in new[] { "RELEASE_ROW", "DISPOSE_ENUMERATOR", "RELEASE_ROWS", "RELEASE_SERVICE", "RELEASE_LOCATOR" })
      multiple.Failures[stage] = new COMException("cleanup", unchecked((int)0x80004002));
    var precise = new NativeDiagnostics();
    Check(ReferenceEquals(ReadFailure(multiple, precise), primary), "cleanup cannot mask property failure");
    Check(precise.Stage == "OBSERVE_BOOT_READ_TIMESTAMP", "cleanup cannot mask property stage");
    Check(multiple.Calls.TakeLast(5).SequenceEqual(new[] { "RELEASE_ROW", "DISPOSE_ENUMERATOR", "RELEASE_ROWS", "RELEASE_SERVICE", "RELEASE_LOCATOR" }), "all cleanup attempted after first failure");
    Check(primary.StackTrace.Contains("ReadTimestamp"), "original failing stack retained locally");
    var cleanupOnly = new FakeCom(); var firstCleanup = new COMException("first cleanup", unchecked((int)0x80004002));
    cleanupOnly.Failures["RELEASE_ROWS"] = firstCleanup;
    cleanupOnly.Failures["RELEASE_LOCATOR"] = new COMException("later cleanup");
    Check(ReferenceEquals(ReadFailure(cleanupOnly, precise), firstCleanup), "cleanup failure prevents successful identity return");
    Check(precise.Stage == "OBSERVE_BOOT_RELEASE_ROWS", "first cleanup error stage retained");

    foreach (var invalid in new[] { Array.Empty<string>(), new[] { Stamp, Stamp }, new[] { "" }, new string[] { null } }) {
      var com = new FakeCom { Values = invalid }; var diagnostic = new NativeDiagnostics();
      Check(ReadFailure(com, diagnostic) is InvalidOperationException, "missing/ambiguous identity refused");
      Check(diagnostic.Stage == "OBSERVE_BOOT_VALIDATE", "invalid identity stage");
      Check(com.Calls.Contains("RELEASE_LOCATOR"), "invalid identity still releases locator");
    }
    normal.Failures["CONNECT"] = new COMException("later observation");
    Check(ReadFailure(normal, context) is COMException, "later failure cannot reuse earlier identity");
    Console.WriteLine("closed-boot-observation-pass:" + checks);
  }
}
