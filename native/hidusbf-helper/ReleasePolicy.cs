using System;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;

namespace Dialed.HidusbfHelper {
  // Schema 1 (VALIDATION_ONLY or legacy ACCEPTED_RELEASE) names exact platform and
  // device digests. Schema 2 is the general release: ACCEPTED_RELEASE only, authorizing
  // device classes and USB speed classes instead of listed devices. Schema 2 fields are
  // omitted when unset, so a schema 1 policy serializes exactly as before.
  public sealed record ReleasePolicyData(int SchemaVersion, DateTimeOffset ExpiresAt, string BrokerSha256, string HelperSha256,
    string PublisherThumbprint, string[] AcceptedPlatformDigests, string Purpose = "VALIDATION_ONLY", string[] AuthorizedDeviceDigests = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingDefault)] string[] DeviceClasses = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingDefault)] string[] SpeedClasses = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingDefault)] int MinimumWindowsBuild = 0,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingDefault)] string[] DeniedDevices = null);
  // What the helper observed, for policy decisions. Schema 1 uses the digests only.
  public sealed record PlatformFacts(string Digest, int WindowsBuild);
  public sealed record DeviceFacts(string InterfaceDigest, string InstanceId, string Speed, string[] InputKinds);
  public sealed class ReleasePolicy {
    // Set only for a reviewed signing release. No environment variable, request,
    // adjacent key file or synthetic 'signed' flag can replace this trust anchor.
    static readonly string ReleasePublicKeyPem = "";
    public ReleasePolicyData Data { get; }
    ReleasePolicy(ReleasePolicyData data) { Data = data; }
    public static ReleasePolicy Load(string directory) {
      if (string.IsNullOrWhiteSpace(ReleasePublicKeyPem)) throw new InvalidOperationException("UNCONFIGURED: native release signing trust is not configured.");
      byte[] policy = ReadBounded(Path.Combine(directory, "release-policy.json"), 65536);
      byte[] signature = ReadBounded(Path.Combine(directory, "release-policy.sig"), 1024);
      return new ReleasePolicy(Verify(policy, signature, ReleasePublicKeyPem, DateTimeOffset.UtcNow));
    }
    internal static ReleasePolicyData Verify(byte[] bytes, byte[] signature, string publicKeyPem, DateTimeOffset now) {
      if (bytes.Length < 1 || bytes.Length > 65536 || signature.Length < 1 || signature.Length > 1024) throw new InvalidOperationException("Release policy exceeds bounds.");
      using var key = RSA.Create(); key.ImportFromPem(publicKeyPem);
      if (key.KeySize < 3072 || !key.VerifyData(bytes, signature, HashAlgorithmName.SHA256, RSASignaturePadding.Pss)) throw new InvalidOperationException("Release policy signature rejected.");
      using var document = JsonDocument.Parse(bytes, new JsonDocumentOptions { MaxDepth = 8 });
      var names = document.RootElement.EnumerateObject().Select(x => x.Name).ToArray();
      if (document.RootElement.TryGetProperty("SchemaVersion", out var schema) && schema.ValueKind == JsonValueKind.Number && schema.GetRawText() == "2")
        return VerifyGeneralRelease(bytes, document, names, now);
      if (names.Length != 8 || names.Distinct().Count() != 8 || names.Except(new[] { "SchemaVersion", "ExpiresAt", "BrokerSha256", "HelperSha256", "PublisherThumbprint", "AcceptedPlatformDigests", "Purpose", "AuthorizedDeviceDigests" }).Any()) throw new InvalidOperationException("Unexpected policy fields.");
      var data = JsonSerializer.Deserialize<ReleasePolicyData>(bytes);
      string expiry = document.RootElement.GetProperty("ExpiresAt").GetString();
      if (data == null || data.SchemaVersion != 1 || expiry == null || !Regex.IsMatch(expiry, @"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,7})?(?:Z|\+00:00)$") || data.ExpiresAt <= now || (data.Purpose != "VALIDATION_ONLY" && data.Purpose != "ACCEPTED_RELEASE") || !LifecycleSession.IsDigest(data.BrokerSha256) || !LifecycleSession.IsDigest(data.HelperSha256) ||
          data.PublisherThumbprint == null || data.PublisherThumbprint.Length != 40 || !data.PublisherThumbprint.All(Uri.IsHexDigit) ||
          data.AcceptedPlatformDigests == null || data.AcceptedPlatformDigests.Length < 1 || data.AcceptedPlatformDigests.Length > 128 || data.AcceptedPlatformDigests.Distinct().Count() != data.AcceptedPlatformDigests.Length || data.AcceptedPlatformDigests.Any(x => !LifecycleSession.IsDigest(x)) ||
          data.AuthorizedDeviceDigests == null || data.AuthorizedDeviceDigests.Length < 1 || data.AuthorizedDeviceDigests.Length > 128 || data.AuthorizedDeviceDigests.Distinct().Count() != data.AuthorizedDeviceDigests.Length || data.AuthorizedDeviceDigests.Any(x => !LifecycleSession.IsDigest(x)))
        throw new InvalidOperationException("Invalid, expired or unconfigured release policy.");
      return data;
    }
    static readonly string[] GeneralFields = { "SchemaVersion", "ExpiresAt", "BrokerSha256", "HelperSha256", "PublisherThumbprint", "Purpose", "DeviceClasses", "SpeedClasses", "MinimumWindowsBuild", "DeniedDevices" };
    static readonly string[] KnownDeviceClasses = { "MOUSE", "KEYBOARD", "GAMEPAD", "JOYSTICK" };
    static readonly string[] KnownSpeedClasses = { "FULL", "HIGH" };
    // A general release must be renewed at least this often.
    static readonly TimeSpan MaximumGeneralLifetime = TimeSpan.FromDays(400);

    static bool BoundedSet(string[] values, int minimum, int maximum, Func<string, bool> valid) =>
      values != null && values.Length >= minimum && values.Length <= maximum && values.Distinct(StringComparer.Ordinal).Count() == values.Length && values.All(x => x != null && valid(x));

    static ReleasePolicyData VerifyGeneralRelease(byte[] bytes, JsonDocument document, string[] names, DateTimeOffset now) {
      if (names.Length != GeneralFields.Length || names.Distinct().Count() != names.Length || names.Except(GeneralFields).Any()) throw new InvalidOperationException("Unexpected policy fields.");
      ReleasePolicyData data;
      try { data = JsonSerializer.Deserialize<ReleasePolicyData>(bytes); }
      catch (JsonException) { throw new InvalidOperationException("Invalid, expired or unconfigured release policy."); }
      string expiry = document.RootElement.GetProperty("ExpiresAt").GetString();
      var build = document.RootElement.GetProperty("MinimumWindowsBuild");
      if (data == null || data.SchemaVersion != 2 || data.Purpose != "ACCEPTED_RELEASE" || expiry == null ||
          !Regex.IsMatch(expiry, @"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,7})?(?:Z|\+00:00)$") || data.ExpiresAt <= now || data.ExpiresAt - now > MaximumGeneralLifetime ||
          !LifecycleSession.IsDigest(data.BrokerSha256) || !LifecycleSession.IsDigest(data.HelperSha256) ||
          data.PublisherThumbprint == null || data.PublisherThumbprint.Length != 40 || !data.PublisherThumbprint.All(Uri.IsHexDigit) ||
          data.AcceptedPlatformDigests != null || data.AuthorizedDeviceDigests != null ||
          !BoundedSet(data.DeviceClasses, 1, KnownDeviceClasses.Length, x => KnownDeviceClasses.Contains(x, StringComparer.Ordinal)) ||
          !BoundedSet(data.SpeedClasses, 1, KnownSpeedClasses.Length, x => KnownSpeedClasses.Contains(x, StringComparer.Ordinal)) ||
          build.ValueKind != JsonValueKind.Number || build.GetRawText() != data.MinimumWindowsBuild.ToString(System.Globalization.CultureInfo.InvariantCulture) ||
          data.MinimumWindowsBuild < 17763 || data.MinimumWindowsBuild > 99999 ||
          !BoundedSet(data.DeniedDevices, 0, 512, x => Regex.IsMatch(x, "^[0-9A-F]{4}:[0-9A-F]{4}$")))
        throw new InvalidOperationException("Invalid, expired or unconfigured release policy.");
      return data;
    }

    /** A schema 2 decision for one device; pure, so the fixture can test every refusal. */
    public static bool DeviceAllowedByClass(ReleasePolicyData data, DeviceFacts facts) {
      if (data?.SchemaVersion != 2 || facts == null || facts.InstanceId == null || facts.InputKinds == null) return false;
      if (!data.SpeedClasses.Contains(facts.Speed, StringComparer.Ordinal)) return false;
      var kinds = facts.InputKinds.Distinct(StringComparer.Ordinal).ToArray();
      if (kinds.Length == 0 || !kinds.All(x => data.DeviceClasses.Contains(x, StringComparer.Ordinal))) return false;
      var id = Regex.Match(facts.InstanceId, @"^USB\\VID_([0-9A-Fa-f]{4})&PID_([0-9A-Fa-f]{4})(?:\\|$)");
      if (!id.Success) return false;
      return !data.DeniedDevices.Contains((id.Groups[1].Value + ":" + id.Groups[2].Value).ToUpperInvariant(), StringComparer.Ordinal);
    }

    static byte[] ReadBounded(string file, int maximum) {
      for (string part = file; !string.IsNullOrEmpty(part); part = Path.GetDirectoryName(part))
        if ((File.GetAttributes(part) & FileAttributes.ReparsePoint) != 0) throw new InvalidOperationException("Linked release path refused.");
      using var stream = new FileStream(file, FileMode.Open, FileAccess.Read, FileShare.Read);
      if (stream.Length < 1 || stream.Length > maximum) throw new InvalidOperationException("Release file exceeds bounds.");
      var bytes = new byte[(int)stream.Length]; stream.ReadExactly(bytes); return bytes;
    }
    public FileStream PinExecutable(string file, bool broker) {
      for (string part = Path.GetFullPath(file); !string.IsNullOrEmpty(part); part = Path.GetDirectoryName(part))
        if ((File.GetAttributes(part) & FileAttributes.ReparsePoint) != 0) throw new InvalidOperationException("Linked executable refused.");
      var stream = new FileStream(file, FileMode.Open, FileAccess.Read, FileShare.Read);
      try {
        string expected = broker ? Data.BrokerSha256 : Data.HelperSha256;
        if (Convert.ToHexString(SHA256.HashData(stream)).ToLowerInvariant() != expected) throw new InvalidOperationException("Native executable is not the reviewed release.");
        NativePeerIdentity.VerifyAuthenticode(file, stream.SafeFileHandle);
        using var signer = new System.Security.Cryptography.X509Certificates.X509Certificate2(System.Security.Cryptography.X509Certificates.X509Certificate.CreateFromSignedFile(file));
        if (!signer.Thumbprint.Equals(Data.PublisherThumbprint, StringComparison.OrdinalIgnoreCase)) throw new InvalidOperationException("Native publisher mismatch.");
        return stream;
      } catch { stream.Dispose(); throw; }
    }
    public bool AcceptPlatform(PlatformFacts facts) => facts != null && Data.ExpiresAt > DateTimeOffset.UtcNow && (Data.SchemaVersion == 2
      ? facts.WindowsBuild >= Data.MinimumWindowsBuild
      : Data.AcceptedPlatformDigests.Contains(facts.Digest, StringComparer.Ordinal));
    public bool AcceptDevice(DeviceFacts facts) => facts != null && Data.ExpiresAt > DateTimeOffset.UtcNow && (Data.SchemaVersion == 2
      ? DeviceAllowedByClass(Data, facts)
      : Data.AuthorizedDeviceDigests.Contains(facts.InterfaceDigest, StringComparer.Ordinal));
  }
}
