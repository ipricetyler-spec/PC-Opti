// Dialed-owned user-mode authentication primitive. No driver or Registry mutations.
// A server must create a local-only pipe with an explicit restrictive DACL, then
// obtain identity from its connected pipe HANDLE, never from request JSON.
using System;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Security.Principal;
using System.Text;
using Microsoft.Win32.SafeHandles;

namespace Dialed.HidusbfHelper {
  public sealed class PeerPolicy {
    public readonly string ImageSha256, PublisherThumbprint, UserSid;
    public PeerPolicy(string imageSha256, string publisherThumbprint, string userSid) {
      if (!IsHex(imageSha256, 64) || !IsHex(publisherThumbprint, 40) || String.IsNullOrEmpty(userSid))
        throw new InvalidOperationException("Signed release caller policy is not configured.");
      var sid = new SecurityIdentifier(userSid);
      if (sid.Value != userSid) throw new InvalidOperationException("Canonical user SID required.");
      ImageSha256 = imageSha256.ToLowerInvariant(); PublisherThumbprint = publisherThumbprint.ToUpperInvariant(); UserSid = userSid;
    }
    static bool IsHex(string value, int length) {
      if (value == null || value.Length != length) return false;
      foreach (char c in value) if (!Uri.IsHexDigit(c)) return false;
      return true;
    }
  }

  // Keep both handles alive throughout the bounded request to pin the process
  // lifetime and prevent executable replacement after signature/hash validation.
  public sealed class AuthenticatedPeer : IDisposable {
    readonly SafeProcessHandle process;
    readonly FileStream image;
    readonly uint processId;
    readonly SafePipeHandle pipe;
    readonly bool serverPeer;
    internal AuthenticatedPeer(SafeProcessHandle process, FileStream image, uint processId, SafePipeHandle pipe, bool serverPeer) {
      this.process = process; this.image = image; this.processId = processId; this.pipe = pipe; this.serverPeer = serverPeer;
    }
    public void AssertAliveAndConnected() {
      uint current;
      bool ok = serverPeer ? Native.GetNamedPipeServerProcessId(pipe, out current) : Native.GetNamedPipeClientProcessId(pipe, out current);
      if (!ok || current != processId || Native.WaitForSingleObject(process, 0) != 258)
        throw new InvalidOperationException("Authenticated pipe peer changed or exited.");
    }
    public void Dispose() { image.Dispose(); process.Dispose(); }
  }

  public static class NativePeerIdentity {
    // The policy must come from the reviewed signed helper/broker release, never
    // from the pipe payload. This library alone is not an executable helper.
    public static AuthenticatedPeer Verify(SafePipeHandle pipe, PeerPolicy policy, bool serverPeer) {
      if (pipe == null || pipe.IsInvalid || policy == null) throw new InvalidOperationException("Connected pipe and pinned policy required.");
      uint pid;
      bool found = serverPeer ? Native.GetNamedPipeServerProcessId(pipe, out pid) : Native.GetNamedPipeClientProcessId(pipe, out pid);
      if (!found || pid == 0) throw new Win32Exception(Marshal.GetLastWin32Error(), "Cannot identify pipe peer.");
      var process = Native.OpenProcess(0x00100000 | 0x1000, false, pid); // SYNCHRONIZE | QUERY_LIMITED_INFORMATION
      FileStream image = null;
      try {
        if (process.IsInvalid || Native.WaitForSingleObject(process, 0) != 258) throw new InvalidOperationException("Pipe peer is not alive.");
        var path = new StringBuilder(32768); uint length = (uint)path.Capacity;
        if (!Native.QueryFullProcessImageName(process, 0, path, ref length)) throw new Win32Exception(Marshal.GetLastWin32Error());
        string file = Path.GetFullPath(path.ToString());
        if (file.StartsWith(@"\\", StringComparison.Ordinal) || !Path.IsPathRooted(file)) throw new InvalidOperationException("Peer image must be local.");
        for (string item = file; !String.IsNullOrEmpty(item); item = Path.GetDirectoryName(item))
          if ((File.GetAttributes(item) & FileAttributes.ReparsePoint) != 0) throw new InvalidOperationException("Linked peer image refused.");
        // FileShare.Read denies replacement/deletion/writers during verification/use.
        image = new FileStream(file, FileMode.Open, FileAccess.Read, FileShare.Read);
        using (var sha = SHA256.Create()) {
          string actual = BitConverter.ToString(sha.ComputeHash(image)).Replace("-", "").ToLowerInvariant();
          if (actual != policy.ImageSha256) throw new InvalidOperationException("Peer executable hash is not pinned.");
        }
        VerifyAuthenticode(file, image.SafeFileHandle);
        using (var signer = new X509Certificate2(X509Certificate.CreateFromSignedFile(file)))
          if (!String.Equals(signer.Thumbprint, policy.PublisherThumbprint, StringComparison.OrdinalIgnoreCase)) throw new InvalidOperationException("Peer publisher mismatch.");
        SafeAccessTokenHandle token;
        if (!Native.OpenProcessToken(process, 8, out token)) throw new Win32Exception(Marshal.GetLastWin32Error());
        using (token) using (var identity = new WindowsIdentity(token.DangerousGetHandle()))
          if (identity.User == null || identity.User.Value != policy.UserSid) throw new InvalidOperationException("Pipe peer user mismatch.");
        var peer = new AuthenticatedPeer(process, image, pid, pipe, serverPeer);
        peer.AssertAliveAndConnected();
        return peer;
      } catch { if (image != null) image.Dispose(); process.Dispose(); throw; }
    }

    internal static void VerifyAuthenticode(string file, SafeFileHandle handle) {
      var info = new Native.TrustFile { size = (uint)Marshal.SizeOf(typeof(Native.TrustFile)), path = file, handle = handle.DangerousGetHandle() };
      IntPtr pointer = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(Native.TrustFile)));
      try {
        Marshal.StructureToPtr(info, pointer, false);
        var data = new Native.TrustData { size = (uint)Marshal.SizeOf(typeof(Native.TrustData)), uiChoice = 2, revocationChecks = 1, unionChoice = 1, file = pointer, stateAction = 1, providerFlags = 0x80 };
        var action = new Guid("00AAC56B-CD44-11d0-8CC2-00C04FC295EE");
        try {
          if (Native.WinVerifyTrust(new IntPtr(-1), ref action, ref data) != 0) throw new InvalidOperationException("Peer Authenticode/revocation policy rejected the image.");
        } finally { data.stateAction = 2; Native.WinVerifyTrust(new IntPtr(-1), ref action, ref data); }
      } finally { Marshal.DestroyStructure(pointer, typeof(Native.TrustFile)); Marshal.FreeHGlobal(pointer); }
    }
  }

  internal static class Native {
    [DllImport("kernel32.dll", SetLastError=true)] internal static extern bool GetNamedPipeClientProcessId(SafePipeHandle pipe, out uint pid);
    [DllImport("kernel32.dll", SetLastError=true)] internal static extern bool GetNamedPipeServerProcessId(SafePipeHandle pipe, out uint pid);
    [DllImport("kernel32.dll", SetLastError=true)] internal static extern SafeProcessHandle OpenProcess(uint access, bool inherit, uint pid);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] internal static extern bool QueryFullProcessImageName(SafeProcessHandle process, uint flags, StringBuilder name, ref uint size);
    [DllImport("kernel32.dll", SetLastError=true)] internal static extern uint WaitForSingleObject(SafeProcessHandle process, uint timeout);
    [DllImport("advapi32.dll", SetLastError=true)] internal static extern bool OpenProcessToken(SafeProcessHandle process, uint access, out SafeAccessTokenHandle token);
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] internal struct TrustFile { internal uint size; [MarshalAs(UnmanagedType.LPWStr)] internal string path; internal IntPtr handle, knownSubject; }
    [StructLayout(LayoutKind.Sequential)] internal struct TrustData { internal uint size; internal IntPtr policyCallback, sipClient; internal uint uiChoice, revocationChecks, unionChoice; internal IntPtr file; internal uint stateAction; internal IntPtr stateData, urlReference; internal uint providerFlags, uiContext; internal IntPtr signatureSettings; }
    [DllImport("wintrust.dll", ExactSpelling=true)] internal static extern int WinVerifyTrust(IntPtr window, ref Guid action, ref TrustData data);
  }
}
