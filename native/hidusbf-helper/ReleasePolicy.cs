using System;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace Dialed.HidusbfHelper {
  public sealed record ReleasePolicyData(int SchemaVersion, DateTimeOffset ExpiresAt, string BrokerSha256, string HelperSha256,
    string PublisherThumbprint, string[] AcceptedPlatformDigests, string Purpose = "VALIDATION_ONLY", string[] AuthorizedDeviceDigests = null);
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
    public bool AcceptPlatform(string digest) => Data.ExpiresAt > DateTimeOffset.UtcNow && Data.AcceptedPlatformDigests.Contains(digest, StringComparer.Ordinal);
    public bool AcceptDevice(string digest) => Data.ExpiresAt > DateTimeOffset.UtcNow && Data.AuthorizedDeviceDigests.Contains(digest, StringComparer.Ordinal);
  }
}
