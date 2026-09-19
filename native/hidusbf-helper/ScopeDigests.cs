using System;
using System.Collections.Generic;
using System.Linq;

namespace Dialed.HidusbfHelper {
  // These property names/order and ordinal UTF-16 array ordering are the policy
  // collector contract. Never use the process culture for an authorization digest.
  // Pure construction is shared by WindowsMachine and the closed C# fixture.
  public static class ScopeDigests {
    // Input interfaces belong to their nearest physical USB device. A hub must
    // not inherit eligibility from a keyboard/controller plugged into it.
    // Full descendant inventory and authorization fingerprints remain separate.
    public static bool IsPhysicalUsb(string id) => id != null &&
      id.StartsWith("USB\\VID_", StringComparison.OrdinalIgnoreCase) && !id.Contains("&MI_", StringComparison.OrdinalIgnoreCase);

    public static HashSet<string> InputMembers(string root, IEnumerable<KeyValuePair<string, string>> parents) {
      var nodes = parents.ToArray();
      var members = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { root };
      for (int pass = 0; pass < nodes.Length; pass++) {
        var children = nodes.Where(x => x.Value != null && members.Contains(x.Value) && !members.Contains(x.Key) && !IsPhysicalUsb(x.Key)).Select(x => x.Key).ToArray();
        if (children.Length == 0) break;
        foreach (string child in children) members.Add(child);
      }
      return members;
    }

    public static string Device(string device, string parent, string location, string speed, IEnumerable<string> children) =>
      LifecycleSession.Digest(new { Device = device.ToUpperInvariant(), Parent = parent, Location = location,
        Speed = speed, Children = children.Select(x => x.ToUpperInvariant()).OrderBy(x => x, StringComparer.Ordinal).ToArray() });

    // The caller supplies EVERY eligible physical scope, including unselected ones.
    // Selection belongs only to the separate AuthorizedDeviceDigests policy field.
    public static string Platform(string os, uint options, object secureBoot, string usbXhci, string usbPort, IEnumerable<string> scopes) =>
      LifecycleSession.Digest(new { Os = os, Options = options, SecureBoot = secureBoot, UsbXhci = usbXhci, UsbPort = usbPort,
        Scopes = scopes.OrderBy(x => x, StringComparer.Ordinal).ToArray() });
  }
}
