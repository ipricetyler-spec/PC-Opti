// Transport building block for a distinct signed native broker and helper.
// Deliberately not wired to Electron or to a Windows mutation executor.
using System;
using System.ComponentModel;
using System.IO;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Win32.SafeHandles;

namespace Dialed.HidusbfHelper {
  public static class AuthenticatedPipe {
    const int MaximumMessageBytes = 65536;
    [StructLayout(LayoutKind.Sequential)] struct SecurityAttributes { public int size; public IntPtr descriptor; public int inherit; }
    [DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool ConvertStringSecurityDescriptorToSecurityDescriptor(string text, uint revision, out IntPtr descriptor, out uint size);
    [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr memory);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern SafePipeHandle CreateNamedPipe(string name, uint openMode, uint pipeMode, uint maximumInstances, uint outputBytes, uint inputBytes, uint timeout, ref SecurityAttributes attributes);

    public static NamedPipeServerStream CreateLocalServer(string nonce, string brokerUserSid) {
      if (nonce == null || nonce.Length != 64) throw new InvalidOperationException("Random 256-bit pipe name required.");
      foreach (char c in nonce) if (!Uri.IsHexDigit(c)) throw new InvalidOperationException("Invalid pipe nonce.");
      string sid = new SecurityIdentifier(brokerUserSid).Value;
      // No Everyone/anonymous ACE. User can read/write/synchronize, not create
      // another instance (FILE_CREATE_PIPE_INSTANCE shares the append bit).
      IntPtr descriptor; uint size;
      if (!ConvertStringSecurityDescriptorToSecurityDescriptor("D:P(A;;GA;;;SY)(A;;0x12019b;;;" + sid + ")", 1, out descriptor, out size)) throw new Win32Exception(Marshal.GetLastWin32Error());
      try {
        var attributes = new SecurityAttributes { size = Marshal.SizeOf(typeof(SecurityAttributes)), descriptor = descriptor, inherit = 0 };
        // Duplex, first instance, overlapped; byte mode, reject remote clients.
        var handle = CreateNamedPipe(@"\\.\pipe\Dialed.Hidusbf." + nonce, 3 | 0x00080000 | 0x40000000, 8, 1, MaximumMessageBytes, MaximumMessageBytes, 0, ref attributes);
        if (handle.IsInvalid) { handle.Dispose(); throw new Win32Exception(Marshal.GetLastWin32Error()); }
        try { return new NamedPipeServerStream(PipeDirection.InOut, true, false, handle); }
        catch { handle.Dispose(); throw; }
      } finally { LocalFree(descriptor); }
    }

    public static async Task<byte[]> ReadBoundedMessage(Stream stream, CancellationToken cancel) {
      var header = new byte[4]; await ReadExact(stream, header, cancel).ConfigureAwait(false);
      uint count = (uint)(header[0] | header[1] << 8 | header[2] << 16 | header[3] << 24);
      if (count < 2 || count > MaximumMessageBytes) throw new InvalidOperationException("Message size refused.");
      var bytes = new byte[(int)count]; await ReadExact(stream, bytes, cancel).ConfigureAwait(false);
      return bytes;
    }
    static async Task ReadExact(Stream stream, byte[] buffer, CancellationToken cancel) {
      int position = 0;
      while (position < buffer.Length) {
        int count = await stream.ReadAsync(buffer, position, buffer.Length - position, cancel).ConfigureAwait(false);
        if (count == 0) throw new EndOfStreamException("Incomplete helper message.");
        position += count;
      }
    }
    public static async Task WriteBoundedMessage(Stream stream, byte[] bytes, CancellationToken cancel) {
      if (bytes == null || bytes.Length < 2 || bytes.Length > MaximumMessageBytes) throw new InvalidOperationException("Message size refused.");
      int count = bytes.Length;
      var header = new byte[] { (byte)count, (byte)(count >> 8), (byte)(count >> 16), (byte)(count >> 24) };
      await stream.WriteAsync(header, 0, header.Length, cancel).ConfigureAwait(false);
      await stream.WriteAsync(bytes, 0, bytes.Length, cancel).ConfigureAwait(false);
      await stream.FlushAsync(cancel).ConfigureAwait(false);
    }
    public static JsonDocument ParseEnvelope(byte[] bytes) {
      if (bytes == null || bytes.Length > MaximumMessageBytes) throw new InvalidOperationException("Message size refused.");
      var document = JsonDocument.Parse(bytes, new JsonDocumentOptions { MaxDepth = 16, AllowTrailingCommas = false, CommentHandling = JsonCommentHandling.Disallow });
      try {
        var root = document.RootElement;
        if (root.ValueKind != JsonValueKind.Object) throw new InvalidOperationException("Object required.");
        var seen = new System.Collections.Generic.HashSet<string>();
        foreach (var property in root.EnumerateObject()) {
          if (!seen.Add(property.Name) || !(property.Name == "version" || property.Name == "operation" || property.Name == "nonce" || property.Name == "planDigest" || property.Name == "payload")) throw new InvalidOperationException("Unknown or duplicate protocol field.");
        }
        if (seen.Count != 5 || root.GetProperty("version").GetInt32() != 1) throw new InvalidOperationException("Incomplete or unsupported protocol.");
        string operation = root.GetProperty("operation").GetString();
        if (operation != "OBSERVE" && operation != "SETUP_STATUS" && operation != "PREVIEW" && operation != "APPLY" && operation != "RECONCILE") throw new InvalidOperationException("Unsupported helper operation.");
        foreach (string key in new string[] { "nonce", "planDigest" }) {
          string value = root.GetProperty(key).GetString();
          if (value == null || value.Length != 64) throw new InvalidOperationException("Fixed digest/nonce required.");
          foreach (char c in value) if (!Uri.IsHexDigit(c)) throw new InvalidOperationException("Malformed digest/nonce.");
        }
        // Operation-specific payload validation and helper-owned plan reconstruction
        // must happen in the executor before a mutation. Parsing is not approval.
        if (root.GetProperty("payload").ValueKind != JsonValueKind.Object) throw new InvalidOperationException("Typed payload required.");
        return document;
      } catch { document.Dispose(); throw; }
    }
  }
}
