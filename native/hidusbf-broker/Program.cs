using System;
using System.Diagnostics;
using System.IO;
using System.IO.Pipes;
using System.Linq;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using Dialed.HidusbfHelper;

class BrokerEntryPoint {
  [STAThread] static void Main(string[] args) {
    Application.EnableVisualStyles(); Application.SetCompatibleTextRenderingDefault(false);
    try {
      string selectionHint = SetupSelection.ParseArguments(args);
      var policy = ReleasePolicy.Load(AppContext.BaseDirectory);
      using var ownImage = policy.PinExecutable(Environment.ProcessPath, true);
      string helper = Path.Combine(AppContext.BaseDirectory, "Dialed.HidusbfHost.exe");
      using var helperImage = policy.PinExecutable(helper, false);
      Application.Run(new SetupWindow(policy, helper, selectionHint));
    } catch (Exception error) { MessageBox.Show(error.Message, "Dialed driver setup unavailable", MessageBoxButtons.OK, MessageBoxIcon.Information); }
  }
}

sealed class SetupWindow : SetupView {
  readonly ReleasePolicy policy; readonly string helper;
  readonly CancellationTokenSource lifetime = new CancellationTokenSource(TimeSpan.FromMinutes(9));
  NamedPipeClientStream pipe; AuthenticatedPeer peer;
  NativeSessionClient client;
  Process hostProcess;
  LifecycleObservation observation;
  SetupSessionState setup;
  string nonce;
  string diagnostic = "";
  readonly string selectionHint;
  string retainedDeviceId;
  bool selectionUnavailable;
  bool busy, historyNeedsReview, inventoryChanged, reconnectPending, refreshing;
  readonly System.Windows.Forms.Timer reconnectTimer = new System.Windows.Forms.Timer { Interval = 1500 };
  public SetupWindow(ReleasePolicy policy, string helper, string selectionHint = null) : base(policy.Data.Purpose == "VALIDATION_ONLY") {
    this.policy = policy; this.helper = helper; this.selectionHint = selectionHint;
    actions.SelectedIndexChanged += (_, _) => { if (refreshing) return; patching.Checked = false; UpdateActions(); };
    patching.CheckedChanged += (_, _) => UpdateActions();
    rates.SelectedIndexChanged += (_, _) => { if (!refreshing) { patching.Checked = false; PresentNewRequest(); UpdateActions(); } };
    maintenance.CheckedChanged += (_, _) => { if (!maintenance.Checked) SelectSuggestedAction(); UpdateActions(); };
    UpdateActions();
    Shown += async (_, _) => await Connect();
    preview.Click += async (_, _) => await Change();
    devices.SelectedIndexChanged += (_, _) => { if (refreshing) return; patching.Checked = false; UpdateSelection(); };
    reconcile.Click += async (_, _) => await Reconcile();
    reconnectTimer.Tick += async (_, _) => {
      if (busy) return;
      if (client?.IsUsable == true) await Reconcile();
      else {
        reconnectTimer.Stop(); UpdateActions();
        SetStatus("Setup session ended. Reopen setup and choose Check saved operation to resume the pending reconnect check. Do not apply the rate again.");
      }
    };
    FormClosed += (_, _) => { reconnectTimer.Stop(); reconnectTimer.Dispose(); lifetime.Cancel(); client?.Dispose(); peer?.Dispose(); pipe?.Dispose(); hostProcess?.Dispose(); lifetime.Dispose(); };
  }
  Task<T> Call<T>(string operation, object payload, string digest = null) => client.Call<T>(operation, payload, digest);
  void UpdateActions() {
    if (IsDisposed) return;
    bool enabled = SetupPresentation.CanRequest(client?.IsUsable == true, busy, historyNeedsReview);
    var action = actions.SelectedItem as SetupAction;
    bool needsAck = action?.Code == "INSTALL" || action?.Code == "ADOPT" || action?.Code == "APPLY";
    PresentAction(action, enabled, inventoryChanged, SetupPresentation.CanPreview(enabled, inventoryChanged, action) &&
      (action?.UsesDevice != true || devices.SelectedItem is DeviceChoice) &&
      (action?.UsesRate != true || rates.SelectedItem is int) && (!needsAck || patching.Checked), reconnectPending);
  }
  void UpdateDetails() {
    var selected = (devices.SelectedItem as DeviceChoice)?.Device;
    details.Text = "Platform identity (automatic compatibility check; no input needed):\r\n" + observation?.PlatformDigest +
      (selected == null ? "" : "\r\n\r\nExact USB device: " + selected.Name + "\r\nDevice identity: " + selected.Id +
        "\r\nDevice scope: " + selected.InterfaceDigest + "\r\nPolicy: " + (selected.Authorized ? "Authorized for this device" : "Not authorized for this device")) +
      (diagnostic.Length == 0 ? "" : "\r\n\r\nLast operation details:\r\n" + diagnostic);
  }
  async Task ShowFailure(Exception error) {
    reconnectTimer.Stop();
    progress.Text = "Request needs review · Follow the setup status below";
    if (SetupPresentation.IsHistoryRefusal(error.Message)) historyNeedsReview = true;
    inventoryChanged = SetupPresentation.IsInventoryRefusal(error.Message);
    string message = SetupPresentation.FailureText(error.Message);
    if (client?.IsUsable != true) {
      message += "\r\nSession closed. Outcome requires review; no request will be retried.";
      if (client?.LastFailure is NativeFailure failure)
        message += $"\r\nDiagnostic: {failure.Stage} / {failure.ExceptionType} / {failure.HResult}";
      // Keep the original launched process for exit evidence, not a fresh PID
      // lookup. Failure to query an elevated process is explicitly unavailable.
      if (hostProcess != null) {
        try {
          using var exitWait = new CancellationTokenSource(TimeSpan.FromSeconds(1));
          await hostProcess.WaitForExitAsync(exitWait.Token);
          message += "\r\nHost exit code: " + hostProcess.ExitCode;
        } catch (OperationCanceledException) { message += "\r\nHost exit not observed within one second."; }
        catch (Exception) { message += "\r\nHost exit code unavailable."; }
      }
    }
    if (!IsDisposed) {
      diagnostic = message; UpdateDetails();
      SetStatus(SetupPresentation.FailureSummary(error.Message) + (client?.IsUsable != true ? "\r\nSession closed. The outcome needs review; reopen setup only after reviewing Technical details. No request will be retried automatically." : ""));
    }
  }
  async Task Connect() {
    try {
      nonce = Convert.ToHexString(RandomNumberGenerator.GetBytes(32)).ToLowerInvariant();
      string sid = WindowsIdentity.GetCurrent().User.Value;
      var start = new ProcessStartInfo(helper) { UseShellExecute = true, Verb = "runas", WorkingDirectory = AppContext.BaseDirectory, WindowStyle = ProcessWindowStyle.Hidden };
      start.ArgumentList.Add(nonce); start.ArgumentList.Add(sid);
      hostProcess = Process.Start(start);
      pipe = new NamedPipeClientStream(".", "Dialed.Hidusbf." + nonce, PipeDirection.InOut, PipeOptions.Asynchronous);
      await pipe.ConnectAsync(60000, lifetime.Token);
      peer = NativePeerIdentity.Verify(pipe.SafePipeHandle, new PeerPolicy(policy.Data.HelperSha256, policy.Data.PublisherThumbprint, sid), true);
      client = new NativeSessionClient(pipe, nonce, peer.AssertAliveAndConnected, lifetime.Token);
      await RefreshInventory(); UpdateActions();
      if (setup.Pending != null) {
        reconnectPending = true; // Lock new requests, but do not resume/append automatically.
        progress.Text = "Saved operation pending · Check saved operation to resume";
        SetStatus("A saved operation for " + SetupPresentation.DeviceLabel(setup.Pending.DeviceName) + " needs to finish. Choose Check saved operation before reconnecting. Do not apply the rate again.");
        UpdateActions();
      }
    } catch (System.ComponentModel.Win32Exception error) when (error.NativeErrorCode == 1223) { SetStatus("The Windows administrator prompt was canceled. No change was requested. Close this window and reopen setup from Dialed when ready."); }
    catch (Exception error) { client?.Dispose(); pipe?.Dispose(); await ShowFailure(error); UpdateActions(); }
  }
  async Task RefreshInventory() {
    string selectedId = (devices.SelectedItem as DeviceChoice)?.Device.Id ?? retainedDeviceId;
    setup = await Call<SetupSessionState>("SETUP_STATUS", new { });
    observation = setup.Observation;
    historyNeedsReview = setup.HistoryStatus == "NEEDS_REVIEW";
    inventoryChanged = setup.HistoryStatus == "CHECK_REQUIRED";
    refreshing = true;
    devices.Items.Clear();
    var eligible = observation.Devices.Where(x => x.Eligible).ToArray();
    foreach (var device in eligible) devices.Items.Add(new DeviceChoice(device,
      eligible.Count(x => SetupPresentation.DeviceLabel(x.Name) == SetupPresentation.DeviceLabel(device.Name)) > 1));
    var chosen = SetupSelection.Choose(eligible, setup.Pending?.DeviceId, selectedId, selectionHint);
    devices.SelectedItem = chosen == null ? null : devices.Items.Cast<DeviceChoice>().Single(x => x.Device == chosen);
    selectionUnavailable = chosen == null && (setup.Pending?.DeviceId != null || selectedId != null || selectionHint != null);
    refreshing = false;
    UpdateSelection();
    if (string.IsNullOrEmpty(lastResult.Text) && inventoryChanged) SetStatus("The saved configuration needs a check. Choose Check saved operation before a new change.");
  }
  SetupDeviceState SelectedSetup => setup?.Devices.SingleOrDefault(x => x.DeviceId == (devices.SelectedItem as DeviceChoice)?.Device.Id);
  void PresentNewRequest() {
    if (setup?.Pending != null || reconnectPending) return;
    progress.Text = SetupPresentation.Progress(null);
    SetStatus(SelectedSetup?.Message ?? SelectionMessage);
  }
  string SelectionMessage => selectionUnavailable
    ? "The selected device is unavailable in setup. Check its connection or choose a device explicitly; no other device was selected for you."
    : "Select a device to continue.";
  void SelectSuggestedAction() {
    var initial = SetupPresentation.Actions.SingleOrDefault(x => x.Code == SetupPresentation.SuggestedAction(SelectedSetup));
    actions.SelectedIndex = initial == null ? 0 : actions.Items.IndexOf(initial);
  }
  void UpdateSelection() {
    refreshing = true;
    var selected = SelectedSetup;
    if (selected != null) { retainedDeviceId = selected.DeviceId; selectionUnavailable = false; }
    int? requested = rates.SelectedItem as int?;
    rates.Items.Clear();
    if (selected != null) foreach (var option in selected.Rates.Where(x => x.Available)) rates.Items.Add(option.Hz);
    int? preferred = selected?.SavedHz ?? requested;
    if (preferred.HasValue && rates.Items.Contains(preferred.Value)) rates.SelectedItem = preferred.Value;
    else if (rates.Items.Contains(1000)) rates.SelectedItem = 1000;
    else if (rates.Items.Count > 0) rates.SelectedIndex = 0;
    savedRate.Text = "Saved rate: " + (selected?.SavedHz is int hz ? hz + " Hz" : "Default / not established") +
      (selected?.OriginalsRecorded == true ? " · Originals recorded" : " · Originals not recorded") +
      (setup?.Pending != null ? " · Saved operation pending" : "");
    installation.Text = selected?.Message ?? SelectionMessage;
    rateHelp.Text = SetupPresentation.RateHelp(selected);
    if (!maintenance.Checked) SelectSuggestedAction();
    refreshing = false;
    patching.Checked = false;
    PresentNewRequest();
    UpdateDetails(); UpdateActions();
  }
  async Task Change() {
    busy = true; UpdateActions();
    try {
      var choice = actions.SelectedItem as SetupAction ?? throw new InvalidOperationException("Choose a setup action first.");
      string action = choice.Code;
      bool deviceAction = choice.UsesDevice;
      var selected = (devices.SelectedItem as DeviceChoice)?.Device;
      if (deviceAction && selected == null) throw new InvalidOperationException("Select an eligible USB scope first.");
      var intent = new LifecycleIntent(action, deviceAction ? selected.Id : null, deviceAction ? selected.InterfaceDigest : null,
        action == "INSTALL" || action == "APPLY" ? (int)rates.SelectedItem : null, patching.Checked);
      var plan = await Call<BrokerPreview>("PREVIEW", intent);
      string review = SetupPresentation.Review(choice, selected == null ? null : SetupPresentation.DeviceLabel(selected.Name), intent.RequestedHz, plan.Variant, plan.RestartRequired, plan.ReconnectRequired);
      string exact = "Exact USB device: " + (deviceAction ? selected.Name : "shared driver") + "\r\nDevice identity: " + intent.DeviceId +
        "\r\nDevice scope: " + intent.InterfaceDigest + "\r\nDriver variant: " + plan.Variant + "\r\nPlan: " + plan.PlanDigest + "\r\nPreview expires: " + plan.ExpiresAt.ToString("O");
      if (!ConfirmReview(review, exact, action == "ADOPT")) { SetStatus("Preview canceled. No change was applied."); return; }
      progress.Text = "Review complete  →  Saving setting…";
      var result = await Call<LifecycleResult>("APPLY", new { Token = plan.Token }, plan.PlanDigest);
      result = result with { DeviceName = result.DeviceName ?? selected?.Name, DeviceId = result.DeviceId ?? selected?.Id, Action = result.Action ?? action, RequestedHz = result.RequestedHz ?? intent.RequestedHz };
      if (!SetupPresentation.IsReconnectPending(result.Status)) await RefreshInventory();
      PresentResult(result, action);
    } catch (Exception error) { await ShowFailure(error); }
    finally { busy = false; UpdateActions(); }
  }
  async Task Reconcile() {
    busy = true; UpdateActions();
    try {
      var result = await Call<LifecycleResult>("RECONCILE", new { }); inventoryChanged = false;
      if (!SetupPresentation.IsReconnectPending(result.Status)) await RefreshInventory();
      PresentResult(result);
    }
    catch (Exception error) { await ShowFailure(error); }
    finally { busy = false; UpdateActions(); }
  }
  void PresentResult(LifecycleResult result, string action = null) {
    if (IsDisposed) return;
    reconnectPending = SetupPresentation.IsReconnectPending(result.Status);
    if (reconnectPending) reconnectTimer.Start(); else reconnectTimer.Stop();
    if (reconnectPending && result.RequestedHz is int hz && result.DeviceId == (devices.SelectedItem as DeviceChoice)?.Device.Id)
      savedRate.Text = "Saved rate: " + hz + " Hz · Reconnect verification pending";
    progress.Text = SetupPresentation.Progress(result);
    string message = SetupPresentation.ResultText(result, action);
    SetStatus(message);
    if (SetupPresentation.IsRateCompletion(result)) RememberResult(message);
  }
  sealed record DeviceChoice(DeviceSetting Device, bool Duplicate) {
    public override string ToString() => SetupPresentation.DeviceLabel(Device.Name) + (Duplicate ? " · " + Device.Id.Substring(0, 8) : "") + (Device.Present ? "" : " · disconnected");
  }
  sealed record BrokerPreview(string Token, string PlanDigest, DateTimeOffset ExpiresAt, string Variant, bool RestartRequired, bool ReconnectRequired = false);
}
