using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading;
using System.Windows.Forms;
using Dialed.HidusbfHelper;

// Uses the actual product controls with invented data. No policy, process,
// pipe, observation, journal or WindowsMachine is constructed by this mode.
sealed class SetupAppearanceFixture : SetupView {
  public static void CaptureViews(string directory) {
    Exception failure = null;
    var thread = new Thread(() => {
      try {
        Application.EnableVisualStyles(); Application.SetCompatibleTextRenderingDefault(false);
        Directory.CreateDirectory(directory);
        var report = new List<object>();
        foreach (string scenario in new[] { "initial", "record", "rate", "rate-small", "reconnect", "complete", "inventory", "history", "policy-blocked" }) {
          using var view = new SetupAppearanceFixture(scenario);
          view.ShowInTaskbar = false; view.StartPosition = FormStartPosition.Manual; view.Location = new Point(-2000, 0);
          view.Show(); Application.DoEvents();
          if (scenario == "rate-small") view.ClientSize = new Size(604, 560);
          view.PerformLayout(); Application.DoEvents();
          var viewport = view.Controls.OfType<Panel>().Single();
          if (viewport.HorizontalScroll.Visible) throw new Exception("Unexpected horizontal scroll: " + scenario);
          if (scenario == "rate" && (!view.preview.Enabled || !view.rates.Items.Cast<int>().SequenceEqual(new[] {1000,2000,4000,8000}))) throw new Exception("Rate controls unavailable.");
          if (scenario == "reconnect" && (view.preview.Enabled || view.devices.Enabled || view.rates.Enabled)) throw new Exception("Pending controls are unlocked.");
          if (scenario == "policy-blocked" && (view.preview.Enabled || view.rates.Items.Count != 0 || view.devices.SelectedIndex != 1 || !view.status.Text.Contains("driver-policy restriction"))) throw new Exception("Policy restriction is not visible on the selected device.");
          if (scenario == "complete") {
            if (!view.status.Text.Contains("Device reconnect verified")) throw new Exception("Completed context disappeared.");
            view.SetStatus("A new request needs review. The last completed change remains below.");
            if (!view.lastResult.Visible || !view.lastResult.Text.Contains("1000 Hz saved")) throw new Exception("New request erased completion.");
            view.SetStatus(SetupPresentation.ResultText(new LifecycleResult("CONFIGURATION_VERIFIED",DeviceName:"DualSense Edge Wireless Controller",Action:"APPLY",RequestedHz:1000,ActivationEvidence:"DEVICE_RECONNECT")));
          }
          void Save(string suffix) { using var bitmap = new Bitmap(view.Width, view.Height); view.DrawToBitmap(bitmap, new Rectangle(Point.Empty, bitmap.Size)); bitmap.Save(Path.Combine(directory, scenario + suffix + ".png"), ImageFormat.Png); }
          Save("-top"); viewport.AutoScrollPosition = new Point(0, viewport.VerticalScroll.Maximum); Application.DoEvents(); Save("-bottom");
          report.Add(new { scenario, width=view.ClientSize.Width, height=view.ClientSize.Height, horizontalOverflow=false, reviewEnabled=view.preview.Enabled, savedRate=view.savedRate.Text, status=view.status.Text });
          view.Close();
        }
        File.WriteAllText(Path.Combine(directory,"RESULT.json"),JsonSerializer.Serialize(new {status="PASS",fixtureOnly=true,deviceAccess=false,scenarios=report},new JsonSerializerOptions {WriteIndented=true}));
      } catch (Exception error) { failure = error; }
    });
    thread.SetApartmentState(ApartmentState.STA); thread.Start(); thread.Join();
    if (failure != null) throw new Exception("Setup capture failed.",failure);
  }
  public static void Run(string scenario) {
    Exception failure = null;
    var thread = new Thread(() => {
      try {
        Application.EnableVisualStyles(); Application.SetCompatibleTextRenderingDefault(false);
        using var view = new SetupAppearanceFixture(scenario); Application.Run(view);
      } catch (Exception error) { failure = error; }
    });
    thread.SetApartmentState(ApartmentState.STA); thread.Start(); thread.Join();
    if (failure != null) throw new Exception("Setup appearance fixture failed.", failure);
  }
  SetupAppearanceFixture(string scenario) : base(true) {
    if (!new[] { "initial", "record", "rate", "rate-small", "reconnect", "complete", "inventory", "history", "policy-blocked" }.Contains(scenario)) throw new ArgumentException("Unknown appearance fixture.");
    Text += " · Appearance preview (no device access)";
    devices.Items.AddRange(new object[] { "DualSense Edge Wireless Controller", "USB Keyboard", "Two identical controllers · fixture 1", "Two identical controllers · fixture 2" }); devices.SelectedIndex = 0;
    bool recording = scenario == "initial" || scenario == "record";
    installation.Text = recording ? "First use in Dialed: record this device's originals once, then choose a rate. Recording does not change the device." : "Original settings recorded. Choose a rate to review.";
    savedRate.Text = "Saved rate: 8000 Hz · " + (recording ? "Originals not recorded" : "Originals recorded");
    rates.Items.AddRange(new object[] {1000,2000,4000,8000}); rates.SelectedItem = 1000;
    rateHelp.Text = "Available to review: 1000 Hz, 2000 Hz, 4000 Hz, 8000 Hz.\r\nHigh-Speed setup offers 1000, 2000, 4000 and 8000 Hz.";
    bool inventory = scenario == "inventory", history = scenario == "history";
    actions.SelectedItem = SetupPresentation.Actions.Single(x => x.Code == (recording ? "ADOPT" : "APPLY"));
    patching.Checked = scenario != "initial";
    details.Text = "Appearance fixture only. No real device access.\r\nPlatform identity (automatic compatibility check; no input needed):\r\n" + new string('a', 64) +
      "\r\nExact USB device: USB\\VID_054C&PID_0DF2\\FIXTURE\r\nDevice scope: " + new string('b', 64);
    void Update() { var action = actions.SelectedItem as SetupAction; PresentAction(action, !history, inventory, SetupPresentation.CanPreview(!history, inventory, action) && patching.Checked, scenario == "reconnect"); }
    actions.SelectedIndexChanged += (_, _) => { patching.Checked = false; Update(); };
    patching.CheckedChanged += (_, _) => Update();
    Update();
    SetStatus(history ? SetupPresentation.FailureSummary("JOURNAL_SCHEMA_REVIEW_REQUIRED: fixture") : inventory
      ? SetupPresentation.FailureSummary("INVENTORY_RECONCILE_REQUIRED: fixture")
      : "Appearance preview only. Choose any action to inspect the layout. No device settings or recovery history can be changed here.");
    if (scenario == "reconnect" || scenario == "complete") {
      var result = new LifecycleResult(scenario == "complete" ? "CONFIGURATION_VERIFIED" : "RECONNECT_REQUIRED", DeviceName:"DualSense Edge Wireless Controller", Action:"APPLY", RequestedHz:1000, ActivationEvidence:scenario == "complete" ? "DEVICE_RECONNECT" : null);
      savedRate.Text = "Saved rate: 1000 Hz · Originals recorded";
      progress.Text = SetupPresentation.Progress(result); SetStatus(SetupPresentation.ResultText(result));
      if (scenario == "complete") { RememberResult(SetupPresentation.ResultText(result)); patching.Checked = false; }
    }
    if (scenario == "policy-blocked") {
      devices.SelectedIndex = 1;
      savedRate.Text = "Saved rate: 1000 Hz · Originals not recorded";
      installation.Text = "Rate changes for this device are not enabled in this build. This is a driver-policy restriction, not a finding that the device cannot be tuned.";
      rates.Items.Clear(); actions.SelectedIndex = 0;
      rateHelp.Text = "No rate is available to review yet.\r\n" + installation.Text;
      PresentAction(null, true, false, false, false);
      SetStatus(installation.Text);
    }
    preview.Click += (_, _) => {
      var action = (SetupAction)actions.SelectedItem;
      string review = SetupPresentation.Review(action, devices.SelectedItem.ToString(), action.UsesRate ? (int)rates.SelectedItem : null, "PATCH_1K", action.Code == "APPLY" || action.Code == "INSTALL");
      bool confirmed = ConfirmReview(review, details.Text, action.Code == "ADOPT");
      SetStatus(confirmed ? "Appearance preview: confirmation demonstrated. No request was sent; no device or history was changed." : "Preview canceled. No request was sent; no device or history was changed.");
    };
    reconcile.Click += (_, _) => SetStatus("Appearance preview only. No saved operation or USB inventory was read or changed.");
    if (scenario == "rate-small") Shown += (_, _) => ClientSize = new System.Drawing.Size(604, 560);
  }
}
