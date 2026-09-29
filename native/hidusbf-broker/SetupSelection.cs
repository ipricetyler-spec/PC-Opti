using System;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using Dialed.HidusbfHelper;

// An initial UI selection, never a device authorization or requested operation.
public static class SetupSelection {
  public static string ParseArguments(string[] args) {
    if (args?.Length == 0) return null;
    if (args?.Length != 2 || args[0] != "--select-device" || args[1]?.Length != 64 ||
        args[1].Any(c => !(c >= '0' && c <= '9') && !(c >= 'a' && c <= 'f')))
      throw new InvalidOperationException("Setup accepts only an optional device-selection digest, not commands or rate arguments.");
    return args[1];
  }
  // The hint is this helper's own device id (LifecycleSession.Digest of the upper-case instance
  // ID); Dialed computes it. It used to be compared as SHA256(device.Id), which never matched a
  // real device, so setup opened with nothing selected.
  public static DeviceSetting Choose(DeviceSetting[] inventory, string pendingId, string retainedId, string hint) {
    var devices = inventory.Where(device => device.Eligible).ToArray();
    var id = pendingId ?? retainedId;
    var matches = id != null ? devices.Where(device => device.Id == id) :
      hint != null ? devices.Where(device => device.Id == hint) : devices.Take(1);
    var exact = matches.Take(2).ToArray();
    // A missing, duplicated or stale selection must not silently choose a peer.
    return exact.Length == 1 ? exact[0] : null;
  }
}
