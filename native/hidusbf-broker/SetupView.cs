using System;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Windows.Forms;

// The real setup surface, separated from the privileged session so its layout
// and confirmation can also be exercised with inert fixture data.
class SetupFrame : Form {
  [DllImport("dwmapi.dll", ExactSpelling = true)]
  static extern int DwmSetWindowAttribute(IntPtr window, int attribute, ref int value, int size);
  protected override void OnHandleCreated(EventArgs e) {
    base.OnHandleCreated(e);
    if (!OperatingSystem.IsWindowsVersionAtLeast(10, 0, 22000) || SystemInformation.HighContrast) return;
    // Documented Windows 11 attributes, applied only to this window. Unsupported
    // cosmetic attributes may fail without affecting setup or system settings.
    // https://learn.microsoft.com/windows/win32/api/dwmapi/ne-dwmapi-dwmwindowattribute
    int dark = 1, caption = 0x191512, text = 0xe5ddd7;
    _ = DwmSetWindowAttribute(Handle, 20, ref dark, sizeof(int));
    _ = DwmSetWindowAttribute(Handle, 35, ref caption, sizeof(int));
    _ = DwmSetWindowAttribute(Handle, 36, ref text, sizeof(int));
  }
}
class SetupView : SetupFrame {
  protected readonly ComboBox devices = Picker("USB device");
  protected readonly ComboBox actions = Picker("Setup action");
  protected readonly ComboBox rates = Picker("Requested polling rate in Hz");
  protected readonly CheckBox patching = new() { Text = "I have read the HIDUSBF requirement above.", AutoSize = true };
  protected readonly Button preview = MakeButton("Review selected action", true);
  protected readonly Button reconcile = MakeButton("Check saved operation");
  protected readonly Label actionDescription = Paragraph("");
  protected readonly Label installation = Paragraph("");
  protected readonly Label savedRate = Paragraph("Saved rate: checking…");
  protected readonly Label rateHelp = Paragraph("");
  protected readonly Label progress = Paragraph("Review  →  Save setting  →  Reconnect device if requested  →  Verify");
  protected readonly Label lastResult = Paragraph("");
  protected readonly CheckBox maintenance = new() { Text = "Driver maintenance and recovery", AutoSize = true };
  protected readonly Label status = Paragraph("Connecting to the setup service. Complete the Windows administrator prompt to continue.");
  protected readonly Label sessionNote = Paragraph("");
  protected readonly TextBox details = new() { Multiline = true, ReadOnly = true, ScrollBars = ScrollBars.Vertical, Height = 150, AccessibleName = "Technical details", TabStop = true };
  readonly Label requirement = Paragraph("Some HIDUSBF modes patch the Windows USB driver and cannot run with Memory Integrity enabled. Dialed checks compatibility; keep your security settings unchanged.");
  readonly Label reconcileHelp = Paragraph("After a requested Windows restart, check the saved operation here. If setup reports changed USB connections, this button refreshes the saved inventory first.");
  readonly FlowLayoutPanel rateRow = new() { AutoSize = true, WrapContents = true, Dock = DockStyle.Top };
  readonly Button detailsToggle = MakeButton("Show technical details");
  readonly TableLayoutPanel content = Stack();
  readonly Panel viewport = new() { Dock = DockStyle.Fill, AutoScroll = true };
  bool detailsExpanded;
  string lastCompletion;

  internal static Color Background => SystemInformation.HighContrast ? SystemColors.Window : ColorTranslator.FromHtml("#121519");
  internal static Color Surface => SystemInformation.HighContrast ? SystemColors.Control : ColorTranslator.FromHtml("#252b33");
  internal static Color Ink => SystemInformation.HighContrast ? SystemColors.WindowText : ColorTranslator.FromHtml("#d7dde5");
  internal static Color Muted => SystemInformation.HighContrast ? SystemColors.WindowText : ColorTranslator.FromHtml("#9ba6b5");

  public SetupView(bool validationOnly) {
    Text = "Dialed · Device polling setup";
    Font = new Font("Segoe UI", 10);
    BackColor = Background; ForeColor = Ink;
    AutoScaleMode = AutoScaleMode.Dpi; AutoScaleDimensions = new SizeF(96, 96);
    ClientSize = new Size(720, 680); MinimumSize = new Size(620, 480);
    StartPosition = FormStartPosition.CenterScreen;
    content.Padding = new Padding(24, 20, 24, 16);
    viewport.Controls.Add(content); Controls.Add(viewport);
    var heading = Paragraph("Device polling setup"); heading.Font = new Font(Font.FontFamily, 19, FontStyle.Bold);
    Add(heading);
    Add(Paragraph("Choose a rate. Review the change. Reconnect only when setup asks."));
    sessionNote.Text = validationOnly ? "Validation build · Only selected test devices are authorized. Physical compatibility testing is still in progress." : "Setup checks the current device and Windows configuration before each change.";
    sessionNote.ForeColor = Muted; Add(sessionNote);
    Add(Heading("1   Choose your device")); Add(devices);
    Add(savedRate);
    Add(progress); progress.ForeColor = Muted;
    var statusBox = Stack(); statusBox.BackColor = Surface; statusBox.Padding = new Padding(12); statusBox.Margin = new Padding(0, 10, 0, 10);
    statusBox.Controls.Add(Heading("Setup status")); statusBox.Controls.Add(status); Add(statusBox);
    Add(lastResult); lastResult.Visible = false;
    Add(Heading("2   Set up this device")); Add(installation); Add(actions); actions.Visible = false;
    actions.Items.Add("Choose an action…"); actions.Items.AddRange(SetupPresentation.Actions);
    actions.SelectedIndex = 0;
    rates.Width = 130; rates.Dock = DockStyle.None;
    rateRow.Controls.Add(Paragraph("Requested rate (Hz)")); rateRow.Controls.Add(rates); Add(rateRow);
    Add(rateHelp); rateHelp.ForeColor = Muted;
    Add(actionDescription); Add(requirement); Add(patching);
    Add(Heading("3   Review and confirm"));
    Add(Paragraph("Review shows the exact action and any restart requirement. Nothing changes until you confirm."));
    Add(preview);
    Add(reconcile); reconcileHelp.ForeColor = Muted; Add(reconcileHelp);
    Add(maintenance);
    Add(detailsToggle); Add(details); details.Visible = false;
    var credit = Paragraph("HIDUSBF by SweetLow / LordOfMice · unchanged upstream driver files"); credit.ForeColor = Muted; Add(credit);
    Style(this);
    maintenance.CheckedChanged += (_, _) => { actions.Visible = maintenance.Checked; FitContent(); };
    detailsToggle.Click += (_, _) => {
      detailsExpanded = !detailsExpanded;
      details.Visible = detailsExpanded;
      detailsToggle.Text = detailsExpanded ? "Hide technical details" : "Show technical details";
      FitContent();
    };
    viewport.ClientSizeChanged += (_, _) => WrapLabels(content);
    Shown += (_, _) => FitContent();
    PresentAction(null, false, false, false);
  }
  static ComboBox Picker(string name) => new() { DropDownStyle = ComboBoxStyle.DropDownList, Dock = DockStyle.Top, AccessibleName = name, FlatStyle = FlatStyle.Flat };
  internal static Label Paragraph(string text) => new() { Text = text, AutoSize = true, Dock = DockStyle.Top, UseMnemonic = false, Margin = new Padding(0, 0, 0, 8) };
  static Label Heading(string text) { var label = Paragraph(text); label.Font = new Font("Segoe UI", 10, FontStyle.Bold); label.Margin = new Padding(0, 10, 0, 8); return label; }
  internal static TableLayoutPanel Stack() {
    var result = new TableLayoutPanel { AutoSize = true, AutoSizeMode = AutoSizeMode.GrowAndShrink, Dock = DockStyle.Top, ColumnCount = 1, Margin = Padding.Empty };
    result.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100)); return result;
  }
  internal static Button MakeButton(string text, bool primary = false) {
    var result = new Button { Text = text, AutoSize = true, AutoSizeMode = AutoSizeMode.GrowAndShrink, FlatStyle = FlatStyle.Flat, Padding = new Padding(12, 6, 12, 6), Margin = new Padding(0, 0, 0, 8), UseVisualStyleBackColor = false };
    result.BackColor = primary && !SystemInformation.HighContrast ? ColorTranslator.FromHtml("#e2e8f0") : Surface;
    result.ForeColor = primary && !SystemInformation.HighContrast ? ColorTranslator.FromHtml("#0f172a") : Ink;
    result.FlatAppearance.BorderColor = SystemInformation.HighContrast ? SystemColors.WindowText : ColorTranslator.FromHtml("#46505d");
    return result;
  }
  void Add(Control control) { if (control is ComboBox || control is TextBox) control.Margin = new Padding(0, 0, 0, 10); content.Controls.Add(control); }
  internal static void Style(Control parent) {
    foreach (Control control in parent.Controls) {
      if (control is ComboBox || control is TextBox) { control.BackColor = Surface; control.ForeColor = Ink; }
      else if (control is CheckBox) { control.ForeColor = Ink; }
      Style(control);
    }
  }
  static void WrapLabels(Control parent) {
    foreach (Control control in parent.Controls) {
      if (control is Label || control is CheckBox) control.MaximumSize = new Size(Math.Max(100, parent.ClientSize.Width - parent.Padding.Horizontal - control.Margin.Horizontal), 0);
      if (control is TextBox) control.Width = Math.Max(100, parent.ClientSize.Width - parent.Padding.Horizontal - control.Margin.Horizontal);
      if (control.HasChildren) WrapLabels(control);
    }
  }
  protected void FitContent() {
    if (!IsHandleCreated || IsDisposed) return;
    WrapLabels(content); content.PerformLayout();
    var workArea = Screen.FromControl(this).WorkingArea;
    int maxHeight = workArea.Height - (Height - ClientSize.Height) - 48;
    ClientSize = new Size(ClientSize.Width, Math.Min(maxHeight, Math.Max(430, content.PreferredSize.Height)));
    Top = Math.Max(workArea.Top + 12, Math.Min(Top, workArea.Bottom - Height - 12));
  }
  protected void PresentAction(SetupAction action, bool enabled, bool inventoryChanged, bool canPreview, bool reconnectPending = false) {
    bool acknowledge = action?.Code == "INSTALL" || action?.Code == "ADOPT" || action?.Code == "APPLY";
    devices.Enabled = enabled && !reconnectPending && action?.UsesDevice != false;
    actions.Enabled = enabled && !reconnectPending; rates.Enabled = enabled && !reconnectPending && action?.UsesRate == true;
    maintenance.Enabled = enabled && !reconnectPending;
    rateRow.Visible = action?.UsesRate == true;
    rateHelp.Visible = action?.UsesRate == true;
    requirement.Visible = acknowledge; patching.Visible = acknowledge; patching.Enabled = enabled && !reconnectPending && acknowledge;
    actionDescription.Text = action?.Description ?? "Choose an action to see what it does.";
    preview.Text = action?.Code == "ADOPT" ? "Review recording" : "Review selected action";
    preview.Enabled = canPreview && !reconnectPending; reconcile.Enabled = enabled;
    reconcile.Text = SetupPresentation.ReconcileLabel(inventoryChanged);
    reconcileHelp.Text = reconnectPending
      ? "Watching the device automatically. If setup closes, reopen it and choose Check saved operation before a fresh unplug/reconnect."
      : inventoryChanged
      ? "Check the current USB connections and refresh the saved inventory. Recorded originals stay intact; device settings are unchanged. Then review your action again."
      : "Use to resume a saved change, after a requested Windows restart, or when setup asks you to refresh USB inventory.";
    FitContent();
  }
  protected void SetStatus(string message) {
    status.Text = message; lastResult.Visible = lastCompletion != null && message != lastCompletion; FitContent();
  }
  protected void RememberResult(string message) {
    lastCompletion = message; lastResult.Text = "Last completed change\r\n" + message.Split('\r')[0];
    lastResult.Visible = status.Text != message; FitContent();
  }
  protected bool ConfirmReview(string review, string technical, bool recording) {
    using var dialog = new SetupReviewDialog(review, technical, recording);
    return dialog.ShowDialog(this) == DialogResult.Yes;
  }
}

sealed class SetupReviewDialog : SetupFrame {
  public SetupReviewDialog(string review, string technical, bool recording) {
    Text = "Dialed · Review before confirming"; Font = new Font("Segoe UI", 10);
    BackColor = SetupView.Background; ForeColor = SetupView.Ink;
    AutoScaleMode = AutoScaleMode.Dpi; AutoScaleDimensions = new SizeF(96, 96);
    StartPosition = FormStartPosition.CenterParent; MinimizeBox = false; MaximizeBox = false;
    ClientSize = new Size(600, 560); MinimumSize = new Size(500, 400);
    var viewport = new Panel { Dock = DockStyle.Fill, AutoScroll = true };
    var layout = SetupView.Stack(); layout.Padding = new Padding(24);
    var message = SetupView.Paragraph(review); message.MaximumSize = new Size(552, 0); layout.Controls.Add(message);
    var disclosure = SetupView.MakeButton("Show exact device and plan details"); layout.Controls.Add(disclosure);
    var details = new TextBox { Text = technical, ReadOnly = true, Multiline = true, Height = 140, Dock = DockStyle.Top, ScrollBars = ScrollBars.Vertical, Visible = false, AccessibleName = "Exact preview details" }; layout.Controls.Add(details);
    disclosure.Click += (_, _) => { details.Visible = !details.Visible; disclosure.Text = details.Visible ? "Hide exact device and plan details" : "Show exact device and plan details"; };
    var buttons = new FlowLayoutPanel { AutoSize = true, Dock = DockStyle.Top, Margin = new Padding(0, 16, 0, 0) };
    var cancel = SetupView.MakeButton("Cancel"); cancel.DialogResult = DialogResult.No; cancel.Margin = new Padding(0, 0, 12, 0);
    var confirm = SetupView.MakeButton(recording ? "Record settings" : "Confirm this action", true); confirm.DialogResult = DialogResult.Yes;
    buttons.Controls.Add(cancel); buttons.Controls.Add(confirm); layout.Controls.Add(buttons);
    viewport.Controls.Add(layout); Controls.Add(viewport); SetupView.Style(this);
    // Enter, Escape, closing the window and the initial focus all cancel. APPLY
    // still requires the explicit affirmative button after the actual preview.
    AcceptButton = cancel; CancelButton = cancel;
    Shown += (_, _) => { cancel.Select(); ClientSize = new Size(ClientSize.Width, Math.Min(layout.PreferredSize.Height, Screen.FromControl(this).WorkingArea.Height - 100)); };
    viewport.ClientSizeChanged += (_, _) => message.MaximumSize = new Size(Math.Max(100, viewport.ClientSize.Width - 48), 0);
  }
}
