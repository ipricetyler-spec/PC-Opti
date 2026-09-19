using System;
using System.Collections.Generic;
using System.IO;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;

namespace Dialed.HidusbfHelper {
  // Append-only framed records. Truncation, corruption and stale revisions refuse
  // further appends; no truncation/repair API exists. A write-through file handle
  // with FileShare.Read supplies cross-process writer exclusion on the native path.
  public sealed class JournalLog : IDisposable {
    const int MaximumPayload = 65536;
    readonly Stream stream;
    readonly object gate = new object();
    readonly UTF8Encoding utf8 = new UTF8Encoding(false, true);
    public long Revision { get; private set; }
    string previous = new string('0', 64);
    public string LastPayload { get; private set; }
    bool poisoned;
    public JournalLog(Stream stream) {
      if (stream == null || !stream.CanRead || !stream.CanWrite || !stream.CanSeek) throw new InvalidOperationException("Seekable journal required.");
      this.stream = stream;
      Load();
    }
    static string Hash(byte[] bytes) { using (var sha = SHA256.Create()) return BitConverter.ToString(sha.ComputeHash(bytes)).Replace("-", "").ToLowerInvariant(); }
    void Load() {
      stream.Position = 0;
      using (var reader = new BinaryReader(stream, utf8, true)) {
        while (stream.Position < stream.Length) {
          if (stream.Length - stream.Position < 4) throw new InvalidOperationException("Interrupted journal header; review required.");
          int length = reader.ReadInt32();
          if (length < 1 || length > MaximumPayload || stream.Length - stream.Position < length + 64) throw new InvalidOperationException("Interrupted or invalid journal record; review required.");
          var bytes = reader.ReadBytes(length);
          string recorded = Encoding.ASCII.GetString(reader.ReadBytes(64));
          string payload = utf8.GetString(bytes);
          string hash = Hash(utf8.GetBytes((Revision + 1).ToString(System.Globalization.CultureInfo.InvariantCulture) + "\n" + previous + "\n" + payload));
          if (recorded != hash) throw new InvalidOperationException("Journal chain mismatch; review required.");
          Revision++; previous = hash; LastPayload = payload;
        }
      }
    }
    public void Append(string payload, long expectedRevision) {
      lock (gate) {
        if (poisoned || expectedRevision != Revision) throw new InvalidOperationException("Journal revision conflict or interrupted write.");
        byte[] bytes = utf8.GetBytes(payload ?? "");
        if (bytes.Length < 1 || bytes.Length > MaximumPayload || stream.Length > 64 * 1024 * 1024) throw new InvalidOperationException("Journal bound exceeded; preserve evidence for review.");
        string hash = Hash(utf8.GetBytes((Revision + 1).ToString(System.Globalization.CultureInfo.InvariantCulture) + "\n" + previous + "\n" + payload));
        try {
          stream.Position = stream.Length;
          using (var writer = new BinaryWriter(stream, utf8, true)) { writer.Write(bytes.Length); writer.Write(bytes); writer.Write(Encoding.ASCII.GetBytes(hash)); writer.Flush(); }
          var file = stream as FileStream;
          if (file != null) file.Flush(true); else stream.Flush();
          Revision++; previous = hash; LastPayload = payload;
        } catch { poisoned = true; throw; }
      }
    }
    public void Dispose() { stream.Dispose(); }
  }

  public static class ProtectedMachineJournal {
    // Not called by the application or fixture. A future signed native helper may
    // open this only after OS caller authentication and ordinary UAC approval.
    public static JournalLog Open() {
      using (var identity = WindowsIdentity.GetCurrent()) {
        if (!new WindowsPrincipal(identity).IsInRole(WindowsBuiltInRole.Administrator)) throw new InvalidOperationException("Ordinary administrator approval is required.");
      }
      string parent = Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData);
      if (String.IsNullOrEmpty(parent)) throw new InvalidOperationException("Machine data directory unavailable.");
      string directory = Path.Combine(parent, "Dialed", "HidusbfLifecycle");
      foreach (string part in new string[] { Path.Combine(parent, "Dialed"), directory }) {
        RefuseLinks(part, true);
        if (!Directory.Exists(part)) {
          var security = new DirectorySecurity(); security.SetAccessRuleProtection(true, false);
          var admins = new SecurityIdentifier(WellKnownSidType.BuiltinAdministratorsSid, null);
          var system = new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null);
          security.SetOwner(admins);
          foreach (var sid in new SecurityIdentifier[] { admins, system }) security.AddAccessRule(new FileSystemAccessRule(sid, FileSystemRights.FullControl, InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit, PropagationFlags.None, AccessControlType.Allow));
          new DirectoryInfo(part).Create(security);
        }
        RefuseLinks(part, false);
        var observed = new DirectoryInfo(part).GetAccessControl();
        if (!observed.AreAccessRulesProtected) throw new InvalidOperationException("Machine journal directory has inherited access; no ACL was changed.");
        var owner = (SecurityIdentifier)observed.GetOwner(typeof(SecurityIdentifier));
        if (!owner.IsWellKnown(WellKnownSidType.BuiltinAdministratorsSid) && !owner.IsWellKnown(WellKnownSidType.LocalSystemSid)) throw new InvalidOperationException("Machine journal owner is untrusted.");
        foreach (FileSystemAccessRule rule in observed.GetAccessRules(true, true, typeof(SecurityIdentifier))) {
          var sid = (SecurityIdentifier)rule.IdentityReference;
          if (rule.AccessControlType == AccessControlType.Allow && !sid.IsWellKnown(WellKnownSidType.BuiltinAdministratorsSid) && !sid.IsWellKnown(WellKnownSidType.LocalSystemSid)) throw new InvalidOperationException("Machine journal access is not restricted to administrators and SYSTEM.");
        }
      }
      string file = Path.Combine(directory, "journal.bin");
      RefuseLinks(file, true);
      if (File.Exists(file)) {
        var acl = new FileInfo(file).GetAccessControl();
        var owner = (SecurityIdentifier)acl.GetOwner(typeof(SecurityIdentifier));
        if (!owner.IsWellKnown(WellKnownSidType.BuiltinAdministratorsSid) && !owner.IsWellKnown(WellKnownSidType.LocalSystemSid)) throw new InvalidOperationException("Journal file owner is untrusted.");
        foreach (FileSystemAccessRule rule in acl.GetAccessRules(true, true, typeof(SecurityIdentifier))) {
          var sid = (SecurityIdentifier)rule.IdentityReference;
          if (rule.AccessControlType == AccessControlType.Allow && !sid.IsWellKnown(WellKnownSidType.BuiltinAdministratorsSid) && !sid.IsWellKnown(WellKnownSidType.LocalSystemSid)) throw new InvalidOperationException("Journal file access is untrusted.");
        }
      }
      // Opening a second writer fails; it cannot race a compare-and-append.
      var stream = new FileStream(file, FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.Read, 4096, FileOptions.WriteThrough);
      try { return new JournalLog(stream); } catch { stream.Dispose(); throw; }
    }
    static void RefuseLinks(string path, bool allowMissingLeaf) {
      for (string current = path; !String.IsNullOrEmpty(current); current = Path.GetDirectoryName(current)) {
        if (!File.Exists(current) && !Directory.Exists(current)) { if (allowMissingLeaf) continue; throw new InvalidOperationException("Machine journal path missing."); }
        if ((File.GetAttributes(current) & FileAttributes.ReparsePoint) != 0) throw new InvalidOperationException("Linked machine journal path refused.");
      }
    }
  }
}
