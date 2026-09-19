using System;
using System.Runtime.InteropServices;
using System.Text;

namespace Dialed.HidusbfHelper {
  public sealed record ReconnectProgress(long Revision, bool Removed, bool Started);
  public interface IDeviceReconnectWatch : IDisposable { ReconnectProgress Read(); }
  public interface IDeviceReconnectMachine { IDeviceReconnectWatch WatchReconnect(string instanceId); }

  // Ordered OS notifications, never timestamps, caller assertions or polling a
  // Registry value. A new watcher needs a new removal followed by a new start.
  public sealed class DeviceReconnectSequence {
    readonly object gate = new object();
    readonly string instance;
    ReconnectProgress progress = new ReconnectProgress(0, false, false);
    public DeviceReconnectSequence(string instance) {
      if (!ScopeDigests.IsPhysicalUsb(instance) || instance.Length >= 200 || instance.IndexOf('\0') >= 0)
        throw new InvalidOperationException("Invalid reconnect device instance.");
      this.instance = instance;
    }
    public ReconnectProgress Read() { lock (gate) return progress; }
    public void Accept(string device, uint action) {
      if (!string.Equals(instance, device, StringComparison.OrdinalIgnoreCase) || action != 7 && action != 8 && action != 9) return;
      lock (gate) {
        if (progress.Revision == long.MaxValue) throw new InvalidOperationException("Reconnect event limit exceeded.");
        // CM_NOTIFY_ACTION: ENUMERATED=7, STARTED=8, REMOVED=9.
        progress = new ReconnectProgress(progress.Revision + 1,
          action == 9 || progress.Removed, action == 8 && progress.Removed);
      }
    }
  }

  // Read-only Config Manager subscription for ONE physical USB instance. It
  // neither opens an input device handle nor disables/restarts any device.
  public sealed class WindowsDeviceReconnectWatch : IDeviceReconnectWatch {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct NotificationFilter {
      public uint Size, Flags, FilterType, Reserved;
      [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 200)] public string InstanceId;
    }
    [UnmanagedFunctionPointer(CallingConvention.Winapi)]
    delegate uint NotificationCallback(IntPtr notification, IntPtr context, uint action, IntPtr data, uint size);
    [DllImport("cfgmgr32.dll", ExactSpelling = true)]
    static extern uint CM_Register_Notification(ref NotificationFilter filter, IntPtr context, NotificationCallback callback, out IntPtr notification);
    [DllImport("cfgmgr32.dll", ExactSpelling = true)]
    static extern uint CM_Unregister_Notification(IntPtr notification);
    readonly DeviceReconnectSequence sequence;
    readonly NotificationCallback callback;
    readonly object gate = new object();
    IntPtr handle;
    bool failed, disposed;

    public WindowsDeviceReconnectWatch(string instance) {
      sequence = new DeviceReconnectSequence(instance);
      callback = OnNotification;
      var filter = new NotificationFilter { Size = (uint)Marshal.SizeOf<NotificationFilter>(), FilterType = 2, InstanceId = instance };
      uint result = CM_Register_Notification(ref filter, IntPtr.Zero, callback, out handle);
      if (result != 0 || handle == IntPtr.Zero) throw new InvalidOperationException("RECONNECT_MONITOR_UNAVAILABLE: saved settings remain pending. Device notification registration failed: " + result);
    }
    // Bounded pure decoding is exercised by the closed fixture. Device instance
    // event data has an 8-byte header followed by a UTF-16, terminated ID.
    public static string DecodeInstance(byte[] data) {
      if (data == null || data.Length < 10 || data.Length > 408 || (data.Length & 1) != 0 ||
          BitConverter.ToUInt32(data, 0) != 2 || BitConverter.ToUInt32(data, 4) != 0)
        throw new InvalidOperationException("Invalid reconnect notification.");
      int end = 8;
      while (end + 1 < data.Length && (data[end] != 0 || data[end + 1] != 0)) end += 2;
      if (end == 8 || end + 1 >= data.Length) throw new InvalidOperationException("Unterminated reconnect notification.");
      return new UnicodeEncoding(false, false, true).GetString(data, 8, end - 8);
    }
    uint OnNotification(IntPtr notification, IntPtr context, uint action, IntPtr data, uint size) {
      try {
        if (data == IntPtr.Zero || size < 10 || size > 408) throw new InvalidOperationException("Invalid notification size.");
        var bytes = new byte[size]; Marshal.Copy(data, bytes, 0, bytes.Length);
        sequence.Accept(DecodeInstance(bytes), action);
      } catch { lock (gate) failed = true; } // Never propagate across unmanaged code.
      return 0; // Never veto a removal.
    }
    public ReconnectProgress Read() {
      lock (gate) {
        if (failed || disposed) throw new InvalidOperationException("RECONNECT_MONITOR_UNAVAILABLE: saved operation remains pending; reopen setup to start a fresh reconnect check.");
        return sequence.Read();
      }
    }
    public void Dispose() {
      lock (gate) { if (disposed) return; disposed = true; }
      // Unregister waits for callbacks; never hold gate or call this in callback.
      if (handle != IntPtr.Zero) {
        uint result = CM_Unregister_Notification(handle);
        if (result != 0) {
          // Keep the delegate rooted if Windows still owns the registration.
          GCHandle.Alloc(callback);
          throw new InvalidOperationException("Reconnect notification cleanup failed: " + result);
        }
        handle = IntPtr.Zero;
      }
      GC.KeepAlive(callback);
    }
  }
}
