using System;
using System.Collections;
using System.Collections.Generic;
using System.Reflection;
using System.Runtime.ExceptionServices;
using System.Runtime.InteropServices;

namespace Dialed.HidusbfHelper {
  // The seam substitutes COM only in closed tests. Production keeps the same WMI
  // query, raw timestamp and explicit RCW release policy.
  internal interface IBootCom {
    Type ResolveLocator();
    object CreateLocator(Type type);
    object Connect(object locator);
    object Query(object service);
    IEnumerator Enumerate(object rows);
    string ReadTimestamp(object row);
    void Release(object value);
  }
  internal sealed class WindowsBootCom : IBootCom {
    public Type ResolveLocator() => Type.GetTypeFromProgID("WbemScripting.SWbemLocator", true);
    public object CreateLocator(Type type) => Activator.CreateInstance(type);
    public object Connect(object locator) => ((dynamic)locator).ConnectServer(".", @"root\cimv2");
    public object Query(object service) => ((dynamic)service).ExecQuery("SELECT LastBootUpTime FROM Win32_OperatingSystem");
    public IEnumerator Enumerate(object rows) => ((IEnumerable)rows).GetEnumerator();
    // WMI's dynamic property must be resolved on each returned object. The C#
    // COM binder can reuse the first object's member descriptor and skip that
    // resolution on later rows, producing E_FAIL. Keep the raw value and error.
    public string ReadTimestamp(object row) => (string)row.GetType().InvokeMember("LastBootUpTime",
      BindingFlags.GetProperty | BindingFlags.DoNotWrapExceptions, null, row, null);
    public void Release(object value) => Marshal.FinalReleaseComObject(value);
  }
  internal static class BootObservation {
    internal static string Read(NativeDiagnostics diagnostics, IBootCom com) {
      object locator = null, service = null, rows = null, row = null;
      IEnumerator enumerator = null;
      ExceptionDispatchInfo failure = null;
      string failureStage = null, result = null;
      T Step<T>(string stage, Func<T> action) => diagnostics.At("OBSERVE_BOOT_" + stage, action);
      void Remember(Exception error) {
        if (failure == null) { failure = ExceptionDispatchInfo.Capture(error); failureStage = diagnostics.Stage; }
      }
      // A cleanup failure must neither replace the first operation's exception
      // nor prevent remaining acquired resources from receiving cleanup attempts.
      void Cleanup(string stage, Action action) {
        try { Step(stage, () => { action(); return true; }); }
        catch (Exception error) { Remember(error); }
      }
      try {
        Type type = Step("RESOLVE_LOCATOR", com.ResolveLocator);
        locator = Step("CREATE_LOCATOR", () => com.CreateLocator(type));
        service = Step("CONNECT", () => com.Connect(locator));
        rows = Step("QUERY", () => com.Query(service));
        enumerator = Step("ENUMERATOR", () => com.Enumerate(rows));
        var values = new List<string>();
        while (Step("MOVE_NEXT", enumerator.MoveNext)) {
          row = Step("CURRENT", () => enumerator.Current);
          values.Add(Step("READ_TIMESTAMP", () => com.ReadTimestamp(row)));
          object completed = row; row = null;
          Step("RELEASE_ROW", () => { com.Release(completed); return true; });
        }
        // Match foreach's IDisposable cleanup before validating/returning.
        var completedEnumerator = enumerator; enumerator = null;
        if (completedEnumerator is IDisposable disposable)
          Step("DISPOSE_ENUMERATOR", () => { disposable.Dispose(); return true; });
        result = Step("VALIDATE", () => {
          if (values.Count != 1 || string.IsNullOrEmpty(values[0])) throw new InvalidOperationException("Boot identity unavailable.");
          return values[0];
        });
      } catch (Exception error) { Remember(error); }
      finally {
        if (row != null) Cleanup("RELEASE_ROW", () => com.Release(row));
        if (enumerator is IDisposable disposable) Cleanup("DISPOSE_ENUMERATOR", disposable.Dispose);
        if (rows != null) Cleanup("RELEASE_ROWS", () => com.Release(rows));
        if (service != null) Cleanup("RELEASE_SERVICE", () => com.Release(service));
        if (locator != null) Cleanup("RELEASE_LOCATOR", () => com.Release(locator));
      }
      if (failure != null) { diagnostics.Stage = failureStage; failure.Throw(); }
      return result;
    }
  }
}
