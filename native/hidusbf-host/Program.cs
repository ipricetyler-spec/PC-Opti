using System;
using System.IO;
using System.Security.Principal;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Dialed.HidusbfHelper;

class HostEntryPoint {
  static async Task<int> Main(string[] args) {
    var diagnostics = new NativeDiagnostics();
    try {
      if (args.Length != 2 || !LifecycleSession.IsDigest(args[0])) throw new InvalidOperationException("Bounded helper arguments required.");
      string nonce = args[0], brokerSid = new SecurityIdentifier(args[1]).Value;
      using var identity = WindowsIdentity.GetCurrent();
      if (!new WindowsPrincipal(identity).IsInRole(WindowsBuiltInRole.Administrator) || identity.User.Value != brokerSid)
        throw new InvalidOperationException("Ordinary same-user UAC elevation required.");
      string directory = AppContext.BaseDirectory;
      // The bundled driver is x64 only; Windows on ARM cannot load it, even under emulation.
      if (System.Runtime.InteropServices.RuntimeInformation.OSArchitecture != System.Runtime.InteropServices.Architecture.X64)
        throw new InvalidOperationException("UNSUPPORTED_ARCHITECTURE: the bundled driver runs only on x64 Windows.");
      var release = ReleasePolicy.Load(directory, allowRecovery: true);
      using var ownImage = release.PinExecutable(Environment.ProcessPath, false);
      using var deadline = new CancellationTokenSource(TimeSpan.FromMinutes(10));
      using var server = AuthenticatedPipe.CreateLocalServer(nonce, brokerSid);
      await server.WaitForConnectionAsync(deadline.Token);
      using var peer = NativePeerIdentity.Verify(server.SafePipeHandle, new PeerPolicy(release.Data.BrokerSha256, release.Data.PublisherThumbprint, brokerSid), false);
      using var journal = diagnostics.At("OPEN_JOURNAL", ProtectedMachineJournal.Open);
      var machine = new WindowsMachine(Path.GetFullPath(Path.Combine(directory, "..", "hidusbf")), release.AcceptPlatform, release.AcceptDevice, diagnostics);
      using var session = new LifecycleSession(journal, machine, peer.AssertAliveAndConnected) { RecoveryOnly = release.RecoveryOnly };
      return await NativeSessionServer.Run(server, nonce, session, machine, peer.AssertAliveAndConnected, diagnostics, deadline.Token);
    } catch (EndOfStreamException) { return 0; }
    catch (Exception error) { Console.Error.WriteLine(JsonSerializer.Serialize(diagnostics.Failure(error))); return 1; }
  }
}
