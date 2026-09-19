using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text.Json;
using Dialed.HidusbfHelper;

static class ScopeDigestChecks {
  public static void Run(string file) {
    CheckInputOwnership();
    using var corpus = JsonDocument.Parse(File.ReadAllBytes(file));
    var original = CultureInfo.CurrentCulture;
    int checks = 0;
    try {
      foreach (string culture in new[] { "", "en-US", "tr-TR", "de-DE", "ja-JP", "sv-SE" }) {
        CultureInfo.CurrentCulture = CultureInfo.GetCultureInfo(culture);
        foreach (var item in corpus.RootElement.EnumerateArray()) {
          var digests = item.GetProperty("eligibleInputScopes").EnumerateArray().Select(scope => {
            var input = scope.GetProperty("preimage");
            // Deliberately undo saved ordering: this tests construction, not just
            // serialization of the collector's already canonical arrays.
            string actual = ScopeDigests.Device(input.GetProperty("Device").GetString().ToLowerInvariant(),
              input.GetProperty("Parent").GetString(), input.GetProperty("Location").GetString(), input.GetProperty("Speed").GetString(),
              input.GetProperty("Children").EnumerateArray().Select(x => x.GetString().ToLowerInvariant()).Reverse());
            if (actual != scope.GetProperty("interfaceDigest").GetString()) throw new Exception("Device construction mismatch under " + culture);
            checks++;
            return actual;
          }).ToArray();
          var platform = item.GetProperty("platformPreimage");
          string actualPlatform = ScopeDigests.Platform(platform.GetProperty("Os").GetString(), platform.GetProperty("Options").GetUInt32(),
            platform.GetProperty("SecureBoot").GetInt32(), platform.GetProperty("UsbXhci").GetString(), platform.GetProperty("UsbPort").GetString(), digests.Reverse());
          if (actualPlatform != item.GetProperty("platformDigest").GetString()) throw new Exception("Platform construction mismatch under " + culture);
          checks++;
        }
      }
    } finally { CultureInfo.CurrentCulture = original; }
    Console.WriteLine("closed-scope-construction-pass:" + checks);
  }

  static void CheckInputOwnership() {
    string hub = @"USB\VID_174C&PID_2074\HUB", nested = @"USB\VID_174C&PID_2074\NESTED";
    string keyboard = @"USB\VID_1C4F&PID_5C44\SPARE", usb = @"USB\VID_1C4F&PID_5C44&MI_00\INTERFACE", hid = @"HID\VID_1C4F&PID_5C44\KEYBOARD";
    var nodes = new[] {
      new KeyValuePair<string, string>(hub, @"USB\ROOT_HUB30\ROOT"),
      new KeyValuePair<string, string>(nested, hub),
      new KeyValuePair<string, string>(keyboard, nested),
      new KeyValuePair<string, string>(usb, keyboard),
      new KeyValuePair<string, string>(hid, usb)
    };
    int checks = 0;
    foreach (bool mixedCase in new[] { false, true }) {
      var inventory = mixedCase ? nodes.Reverse().Select(x => new KeyValuePair<string, string>(x.Key, x.Value.ToLowerInvariant())).ToArray() : nodes;
      foreach (var test in new[] {
        (Root: hub, Expected: new[] { hub }), (Root: nested, Expected: new[] { nested }),
        (Root: keyboard, Expected: new[] { keyboard, usb, hid })
      }) {
        if (!ScopeDigests.InputMembers(test.Root, inventory).SetEquals(test.Expected)) throw new Exception("Input scope crossed a physical USB boundary.");
        checks++;
      }
    }
    if (!ScopeDigests.IsPhysicalUsb(keyboard.ToLowerInvariant()) || ScopeDigests.IsPhysicalUsb(usb) || ScopeDigests.IsPhysicalUsb(hid)) throw new Exception("Physical scope identity mismatch.");
    checks++;
    Console.WriteLine("closed-input-scope-ownership-pass:" + checks);
  }
}
