using System;
using System.Collections;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Dialed.HidusbfHelper;

// Source-prepared only. Explicit owner approval is required before execution.
// No WindowsMachine, native host/broker, lifecycle session, journal or executor.
class BootDiagnosticEntryPoint {
  // Negative control retained only in this explicitly invoked diagnostic.
  sealed class LegacyBootCom : IBootCom {
    readonly WindowsBootCom actual = new WindowsBootCom();
    public Type ResolveLocator() => actual.ResolveLocator();
    public object CreateLocator(Type type) => actual.CreateLocator(type);
    public object Connect(object locator) => actual.Connect(locator);
    public object Query(object service) => actual.Query(service);
    public IEnumerator Enumerate(object rows) => actual.Enumerate(rows);
    public string ReadTimestamp(object row) => (string)((dynamic)row).LastBootUpTime;
    public void Release(object value) => actual.Release(value);
  }
  static async Task<int> Regression() {
    var diagnostics = new NativeDiagnostics();
    try { return await RegressionCore(diagnostics); }
    catch (Exception error) {
      Console.WriteLine(JsonSerializer.Serialize(new { unexpectedFailure = diagnostics.Failure(error) }));
      return 1;
    }
  }
  static async Task<int> RegressionCore(NativeDiagnostics diagnostics) {
    string baseline = BootObservation.Read(diagnostics, new LegacyBootCom());
    Console.WriteLine("{\"legacyRead\":1,\"ok\":true}");
    try {
      await Task.Yield();
      BootObservation.Read(diagnostics, new LegacyBootCom());
      Console.WriteLine("{\"result\":\"LEGACY_FAILURE_NOT_REPRODUCED\"}");
      return 4;
    } catch (COMException error) when (diagnostics.Stage == "OBSERVE_BOOT_READ_TIMESTAMP" && unchecked((uint)error.HResult) == 0x80004005) {
      Console.WriteLine(JsonSerializer.Serialize(new { legacyFailure = diagnostics.Failure(error) }));
      // Only the expected second-read negative control may reach fixed reads.
    }
    for (int index = 0; index < 6; index++) {
      await Task.Yield();
      string value = BootObservation.Read(diagnostics, new WindowsBootCom());
      bool same = value == baseline;
      Console.WriteLine(JsonSerializer.Serialize(new { fixedRead = index + 1, sameAsLegacyFirst = same,
        thread = Environment.CurrentManagedThreadId, apartment = Thread.CurrentThread.GetApartmentState().ToString() }));
      if (!same) return 2;
    }
    Console.WriteLine("{\"result\":\"LIVE_BOOT_PROPERTY_REGRESSION_PASS\"}");
    return 0;
  }
  static async Task<int> Observe() {
    string first = null;
    var diagnostics = new NativeDiagnostics();
    for (int index = 0; index < 6; index++) {
      await Task.Yield();
      try {
        string value = diagnostics.At("OBSERVE_BOOT", () => BootObservation.Read(diagnostics, new WindowsBootCom()));
        first ??= value;
        bool stable = value == first;
        Console.WriteLine(JsonSerializer.Serialize(new { observation = index + 1, stable,
          thread = Environment.CurrentManagedThreadId, apartment = Thread.CurrentThread.GetApartmentState().ToString() }));
        if (!stable) return 2;
      } catch (Exception error) {
        Console.WriteLine(JsonSerializer.Serialize(new { observation = index + 1,
          thread = Environment.CurrentManagedThreadId, apartment = Thread.CurrentThread.GetApartmentState().ToString(),
          failure = diagnostics.Failure(error) }));
        return 1;
      }
    }
    return 0;
  }
  static async Task<int> Main(string[] args) {
    if (args.Length != 1 || (args[0] != "--observe-boot-read-only" && args[0] != "--verify-boot-property-regression")) return 64;
    var run = Task.Run<int>(args[0] == "--verify-boot-property-regression" ? Regression : Observe);
    if (await Task.WhenAny(run, Task.Delay(TimeSpan.FromSeconds(30))) == run) return await run;
    Console.WriteLine("{\"failure\":\"BOOT_OBSERVATION_TIMEOUT\"}");
    return 3;
  }
}
