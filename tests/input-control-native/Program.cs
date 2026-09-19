using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Windows.Forms;
using Dialed.Input;

class Program {
  [StructLayout(LayoutKind.Sequential)] struct RawDevice { public IntPtr handle; public uint type; }
  [DllImport("user32.dll")] static extern uint GetRawInputDeviceList([In,Out] RawDevice[] list,ref uint count,uint size);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern uint GetRawInputDeviceInfo(IntPtr device,uint command,StringBuilder name,ref uint size);
  static int checks;
  static void Equal(int expected,int actual,string name) {
    checks++; if(expected!=actual) throw new Exception(name+": expected "+expected+", got "+actual);
  }
  static void Put(byte[] data,int offset,uint value) { Array.Copy(BitConverter.GetBytes(value),0,data,offset,4); }
  static void U16(byte[] data,int offset,ushort value) { Array.Copy(BitConverter.GetBytes(value),0,data,offset,2); }
  static byte[] Cap(ushort bits=8,int min=0,int max=255,ushort usage=0x30) {
    var data=new byte[72]; U16(data,0,1); data[2]=1; data[15]=1; U16(data,18,bits); U16(data,20,1);
    Put(data,40,unchecked((uint)min)); Put(data,44,unchecked((uint)max)); U16(data,56,usage); return data;
  }
  static void Reject(Action action,string name) { bool failed=false; try { action(); } catch(ArgumentException) { failed=true; } Equal(1,failed?1:0,name); }
  static void RemainingReviewChecks() {
    var dpad=Cap(1,0,1,0x90); dpad[12]=1; U16(dpad,58,0x93); U16(dpad,68,20); U16(dpad,70,23);
    var buttons=HidControls.ParseCaps(dpad,1,true);
    Equal(4,buttons.Length,"B1 Generic Desktop D-pad buttons must be monitored");
    var root=Cap(); var child=Cap(); U16(child,6,1); U16(child,68,1);
    var caps=new byte[144]; Array.Copy(root,caps,72); Array.Copy(child,0,caps,72,72);
    var axes=HidControls.ParseCaps(caps,2,false);
    Equal(1,axes[1].dataIndex,"B2 repeated axis usage retains its independent data index");
    int unmonitored;
    var trigger=Cap(8,0,255,0xc4); U16(trigger,0,2);
    Equal(0,HidControls.ParseCaps(trigger,1,false,out unmonitored).Length,"Simulation trigger is not falsely monitored");
    Equal(1,unmonitored,"Simulation trigger declares incomplete coverage");
    foreach(var kind in new[]{"relative","array","vendor","dial","wheel","invalid"}) {
      var cap=Cap();
      if(kind=="relative") cap[15]=0;
      if(kind=="array") U16(cap,20,2);
      if(kind=="vendor") U16(cap,0,0xff00);
      if(kind=="dial") U16(cap,56,0x37);
      if(kind=="wheel") U16(cap,56,0x38);
      if(kind=="invalid") U16(cap,18,0);
      HidControls.ParseCaps(cap,1,false,out unmonitored); Equal(1,unmonitored,"Unmonitored "+kind+" declaration counted");
    }
    var alias=Cap(); alias[3]=1; HidControls.ParseCaps(alias,1,false,out unmonitored); Equal(0,unmonitored,"Alias does not lower coverage twice");
    var mixed=Cap(1,0,1,0x8f); mixed[12]=1; U16(mixed,58,0x93); U16(mixed,68,19); U16(mixed,70,23);
    Equal(4,HidControls.ParseCaps(mixed,1,true,out unmonitored).Length,"Mixed button range preserves supported D-pad"); Equal(1,unmonitored,"Partly skipped range lowers coverage once");
    Equal(1,HidControls.ParseCaps(Cap(1,0,1,0x85),1,true).Length,"System Main Menu supported");
    var tracker=new ActivityTracker(); var values=new Dictionary<ushort,uint>();
    HidControls.ReadData(buttons,1,new HidData[0],0,0,tracker,values);
    HidControls.ReadData(buttons,1,new[]{new HidData {index=20,raw=1}},1,10,tracker,values);
    Equal(1,tracker.Result.buttons,"D-pad press from production data-index path");
    HidControls.ReadData(buttons,1,new HidData[0],0,20,tracker,values); Equal(2,tracker.Result.buttons,"D-pad release");
    tracker=new ActivityTracker();
    for(int ms=0;ms<=300;ms+=10) HidControls.ReadData(axes,1,new[]{new HidData {index=1,raw=0},new HidData {index=0,raw=100}},2,ms,tracker,values);
    for(int ms=400;ms<=420;ms+=10) HidControls.ReadData(axes,1,new[]{new HidData {index=1,raw=0},new HidData {index=0,raw=200}},2,ms,tracker,values);
    Equal(1,tracker.Result.axes,"Only root X changes with child X first in data list");
    for(int ms=500;ms<=520;ms+=10) HidControls.ReadData(axes,1,new[]{new HidData {index=0,raw=200},new HidData {index=1,raw=200}},2,ms,tracker,values);
    Equal(2,tracker.Result.axes,"Child X changes independently of root X");
    HidControls.ReadData(axes,2,new HidData[0],0,600,tracker,values); Equal(1,tracker.Result.unsupported,"Other report cannot release axes");
    HidControls.ReadData(axes,1,new[]{new HidData {index=0,raw=200}},1,610,tracker,values); Equal(1,tracker.Result.errors,"Missing value does not become neutral");
    HidControls.ReadData(axes,1,new[]{new HidData {index=0,raw=200},new HidData {index=0,raw=0}},2,620,tracker,values); Equal(2,tracker.Result.errors,"Duplicate returned data index refused");
    var hats=HidControls.ParseCaps(Cap(4,0,7,0x39),1,false); tracker=new ActivityTracker();
    foreach(uint raw in new uint[]{8,0,8}) HidControls.ReadData(hats,1,new[]{new HidData {index=0,raw=raw}},1,0,tracker,values);
    Equal(2,tracker.Result.hats,"Data-index hat preserves undeclared neutral transitions");
  }
  static void ReviewChecks() {
    double normalized; long value;
    var axis=HidControls.ParseCaps(Cap(8,0,-1),1,false)[0];
    Equal(255,(int)axis.max,"8-bit unsigned negative maximum masks to width");
    Equal(1,HidControls.Normalize(axis,255,out normalized,out value),"Unsigned endpoint valid"); Equal(1,normalized==1?1:0,"Full unsigned movement normalizes to one");
    Equal(255,(int)HidControls.ParseCaps(Cap(8,0,1000),1,false)[0].max,"Impossible unsigned maximum clamps to width");
    axis=HidControls.ParseCaps(Cap(8,-127,127),1,false)[0]; HidControls.Normalize(axis,129,out normalized,out value); Equal(-127,(int)value,"Signed 8-bit lower endpoint");
    axis=HidControls.ParseCaps(Cap(16,0,-1),1,false)[0]; Equal(65535,(int)axis.max,"Unsigned 16-bit maximum");
    axis=HidControls.ParseCaps(Cap(32,0,-1),1,false)[0]; Equal(1,axis.max==uint.MaxValue?1:0,"Unsigned 32-bit maximum");
    axis=HidControls.ParseCaps(Cap(32,int.MinValue,int.MaxValue),1,false)[0]; HidControls.Normalize(axis,0x80000000,out normalized,out value); Equal(int.MinValue,(int)value,"Signed 32-bit lower endpoint");
    var cap=Cap(); cap[3]=1; Equal(0,HidControls.ParseCaps(cap,1,false).Length,"Alias excluded");
    cap=Cap(); cap[15]=0; Equal(0,HidControls.ParseCaps(cap,1,false).Length,"Relative axis excluded");
    cap=Cap(); U16(cap,20,2); Equal(0,HidControls.ParseCaps(cap,1,false).Length,"Value array excluded");
    cap=Cap(); U16(cap,0,0xff00); Equal(0,HidControls.ParseCaps(cap,1,false).Length,"Vendor page excluded");
    cap=Cap(); cap[12]=1; U16(cap,58,0x35); U16(cap,70,5); Equal(6,HidControls.ParseCaps(cap,1,false).Length,"Axis usage range");
    Equal(0,HidControls.ParseCaps(Cap(8,0,255,0x37),1,false).Length,"Wrapping Dial excluded");
    Equal(0,HidControls.ParseCaps(Cap(8,0,255,0x38),1,false).Length,"Wrapping Wheel excluded");
    cap=Cap(4,0,7,0x39); var hat=HidControls.ParseCaps(cap,1,false)[0];
    Equal(2,HidControls.Normalize(hat,8,out normalized,out value),"Undeclared hat neutral eight"); Equal(1,value==long.MinValue?1:0,"Hat neutral sentinel");
    Equal(2,HidControls.Normalize(hat,15,out normalized,out value),"Undeclared hat neutral fifteen");
    Equal(1,HidControls.Normalize(hat,7,out normalized,out value),"Hat direction seven");
    cap[16]=1; Equal(2,HidControls.Normalize(HidControls.ParseCaps(cap,1,false)[0],15,out normalized,out value),"Declared hat null");
    axis=HidControls.ParseCaps(Cap(8,10,200),1,false)[0]; Equal(0,HidControls.Normalize(axis,255,out normalized,out value),"Invalid axis stays invalid");
    cap=Cap(8,10,200); cap[16]=1; Equal(2,HidControls.Normalize(HidControls.ParseCaps(cap,1,false)[0],255,out normalized,out value),"Declared axis null");
    var both=new byte[144]; Array.Copy(Cap(),both,72); Array.Copy(Cap(),0,both,72,72); both[74]=2; Equal(2,HidControls.ParseCaps(both,2,false).Length,"Report IDs stay separate");
    var button=Cap(); U16(button,0,9); U16(button,68,7); Array.Copy(button,both,72); U16(button,6,1); Array.Copy(button,0,both,72,72);
    var buttons=HidControls.ParseCaps(both,2,true); Equal(1,buttons.Length,"Duplicate button data index across links counted once");
    U16(both,72+68,8); buttons=HidControls.ParseCaps(both,2,true); Equal(2,buttons.Length,"Same usage with distinct button indices preserved");
    Equal(2,HidControls.PressedButtons(buttons,1,new ushort[]{7,8,7,99}).Length,"Only unique declared button indices survive");
    Equal(0,HidControls.PressedButtons(buttons,2,new ushort[]{7,8}).Length,"Button report isolation");
    Reject(()=>HidControls.ParseCaps(new byte[72],2,false),"Truncated caps refused"); Reject(()=>HidControls.ParseCaps(new byte[257*72],257,false),"Caps count bound");
    var sparse=new ActivityTracker(); sparse.Axis("x",0.5,0); sparse.Axis("x",0.5,300); Equal(1,sparse.Result.pendingAxes,"Sparse baseline stays pending");
    sparse.Axis("x",0.5,1000); Equal(1,sparse.Result.sparseAxes,"Sparse one-second fallback flagged"); Equal(0,sparse.Result.pendingAxes,"Fallback no longer pending");
    sparse.Axis("x",0.9,1100); sparse.Axis("x",0.9,1110); sparse.Axis("x",0.9,1120); Equal(1,sparse.Result.axes,"Sparse fallback still observes sustained movement");
    var late=new ActivityTracker(); for(int i=1000;i<=1300;i+=2) late.Axis("x",0.5,i); Equal(1,late.Result.sparseAxes,"Late change-only input cannot imply idle");
    var key=new ActivityTracker(); key.Keyboard(30,0,255); Equal(0,key.Result.errors,"Fake key ignored"); Equal(0,key.Result.keys,"Fake key no transition"); key.Keyboard(255,0,255); Equal(1,key.Result.errors,"Overrun still error");
    Equal(0,TimingWindow.Instructions(false,true,false).Contains("sticks")?1:0,"Keyboard instructions exclude sticks");
    Equal(1,TimingWindow.Instructions(true,false,false).Contains("mouse steadily")?1:0,"Mouse instructions");
  }
  [STAThread] static void Main(string[] args) {
    if(args.Length==1 && args[0]=="--descriptors") {
      var nodes=Devices.Scan(); uint count=0,size=(uint)Marshal.SizeOf(typeof(RawDevice));
      if(GetRawInputDeviceList(null,ref count,size)==uint.MaxValue || count>4096) throw new Exception("Raw Input inventory unavailable");
      var devices=new RawDevice[count]; if(GetRawInputDeviceList(devices,ref count,size)==uint.MaxValue) throw new Exception("Raw Input inventory changed");
      var result=new List<object>();
      foreach(var device in devices) {
        uint length=2048; var name=new StringBuilder((int)length);
        if(GetRawInputDeviceInfo(device.handle,0x20000007,name,ref length)==uint.MaxValue) continue;
        string id=name.ToString(); if(id.StartsWith("\\\\?\\")) id=id.Substring(4);
        int end=id.LastIndexOf("#{",StringComparison.Ordinal); if(end>=0) id=id.Substring(0,end); id=id.Replace('#','\\');
        var node=Array.Find(nodes,n=>n.id.Equals(id,StringComparison.OrdinalIgnoreCase));
        if(node==null || String.IsNullOrEmpty(node.inputKind)) continue;
        if(device.type==2) using(var decoder=new HidActivityDecoder(device.handle)) result.Add(new { name=node.name, kind=node.inputKind, failed=decoder.Failed, buttonGroups=decoder.ButtonGroups, axes=decoder.Axes, hats=decoder.Hats });
        else result.Add(new { name=node.name, kind=node.inputKind, decoder=device.type==0?"RAWMOUSE":"RAWKEYBOARD" });
      }
      Console.WriteLine(JsonSerializer.Serialize(result)); return;
    }
    if(args.Length==1 && args[0]=="--appearance") {
      Application.EnableVisualStyles();
      using(var window=new TimingWindow(new string[0])) {
        window.ShowInTaskbar=false; window.StartPosition=FormStartPosition.Manual; window.Location=new System.Drawing.Point(-2000,0);
        window.Show(); Application.DoEvents();
        window.PerformLayout();
        using(var bitmap=new System.Drawing.Bitmap(window.Width,window.Height)) {
          window.DrawToBitmap(bitmap,new System.Drawing.Rectangle(0,0,window.Width,window.Height));
          bitmap.Save(Environment.GetEnvironmentVariable("DIALED_NATIVE_APPEARANCE_OUTPUT") ?? "output/input-control-activity-20260913/capture-window.png");
        }
      }
      Console.WriteLine("Rendered actual capture form with an empty device allowlist; no device payloads eligible."); return;
    }
    if(args.Length!=0) throw new Exception("Unknown fixture mode");
    var t=new ActivityTracker();
    t.Axis("x",0.5,0);
    for(int i=1;i<8000;i++) t.Axis("x",0.5+(i%3-1)*0.01,i);
    Equal(0,t.Result.axes,"Idle 8 kHz jitter");
    t.Axis("x",0.8,8000); t.Axis("x",0.5,8001); t.Axis("x",0.5,8100);
    Equal(0,t.Result.axes,"Single spike rejected");
    t.Axis("x",0.8,8200); t.Axis("x",0.8,8219); Equal(0,t.Result.axes,"Dwell incomplete");
    t.Axis("x",0.8,8220); Equal(1,t.Result.axes,"Sustained axis movement");
    t.Axis("x",0.8,8300); Equal(1,t.Result.axes,"Held axis not repeated");
    t.Axis("x",0.5,8400); t.Axis("x",0.5,8410); t.Axis("x",0.5,8420); Equal(2,t.Result.axes,"Axis return");
    t.Axis("other-report-x",0.9,8500); Equal(2,t.Result.axes,"Report isolation");
    t.Buttons("r1",new ushort[]{1}); t.Buttons("r1",new ushort[]{1});
    Equal(0,t.Result.buttons,"Initial held button and duplicate");
    t.Buttons("r2",new ushort[0]); Equal(0,t.Result.buttons,"Other report cannot release button");
    t.Buttons("r1",new ushort[0]); Equal(1,t.Result.buttons,"Button release");
    t.Buttons("r1",new ushort[]{2}); Equal(2,t.Result.buttons,"Button press");
    t.Hat("hat",long.MinValue); t.Hat("hat",0); t.Hat("hat",0); t.Hat("hat",long.MinValue);
    Equal(2,t.Result.hats,"Hat and neutral transitions");
    t.Keyboard(30,0,65); t.Keyboard(30,0,65); Equal(1,t.Result.keys,"Keyboard autorepeat suppressed");
    t.Keyboard(30,1,65); t.Keyboard(30,1,65); Equal(2,t.Result.keys,"Keyboard release duplicate suppressed");
    t.Keyboard(0xff,0,0); Equal(1,t.Result.errors,"Keyboard overrun");
    var mouse=new ActivityTracker();
    mouse.Mouse(0,0,0,1,0,0); mouse.Mouse(0,0,0,-1,0,1); Equal(0,mouse.Result.movement,"Mouse jitter");
    mouse.Mouse(0,0,0,3,0,2); Equal(1,mouse.Result.movement,"Mouse deliberate delta");
    mouse.Mouse(0,0x400,120,0,0,3); Equal(2,mouse.Result.movement,"Wheel");
    mouse.Mouse(0,3,0,0,0,4); Equal(2,mouse.Result.buttons,"Mouse press and release flags");
    var absolute=new ActivityTracker();
    absolute.Mouse(1,0,0,30000,30000,0); absolute.Mouse(1,0,0,30000,30000,1);
    Equal(0,absolute.Result.movement,"Absolute initial position ignored");
    absolute.Mouse(1,0,0,30200,30000,2); Equal(1,absolute.Result.movement,"Absolute movement");
    Equal(0,new ActivityTracker().Result.axes,"Fresh capture");
    var firstSpike=new ActivityTracker(); firstSpike.Axis("x",0.9,0);
    for(int i=2;i<400;i+=2) firstSpike.Axis("x",0.5,i);
    Equal(0,firstSpike.Result.axes,"Median baseline rejects a first-report spike");
    firstSpike.Axis("x",0.9,400); firstSpike.Axis("x",0.9,440); firstSpike.Axis("x",0.5,450);
    Equal(0,firstSpike.Result.axes,"Two-report spike rejected even across 40 ms");
    var unsettled=new ActivityTracker(); for(int i=0;i<=300;i+=2) unsettled.Axis("x",(i/2)%2,i);
    Equal(1,unsettled.Result.unstableAxes,"Unstable baseline is distinct from parsing failure"); Equal(0,unsettled.Result.errors,"Noise does not become a parser error");
    var packet=new ActivityTracker(); var reports=new List<byte[]>();
    var batch=new byte[14]; Put(batch,0,3); Put(batch,4,2);
    batch[8]=1; batch[9]=2; batch[10]=3; batch[11]=4; batch[12]=5; batch[13]=6;
    ControlPacket.Read(2,batch,0,packet,reports.Add);
    Equal(2,reports.Count,"All batched HID reports"); Equal(4,reports[1][0],"Second report offset");
    Equal(2,packet.Result.hidReports,"Reports counted separately from the single message");
    Put(batch,0,uint.MaxValue); ControlPacket.Read(2,batch,0,packet,reports.Add);
    Equal(1,packet.Result.errors,"Overflow length refused"); Equal(2,reports.Count,"No malformed report dispatched");
    Put(batch,0,3); Put(batch,4,257); ControlPacket.Read(2,batch,0,packet,reports.Add);
    Equal(2,packet.Result.errors,"Batch bound");
    Put(batch,4,0); ControlPacket.Read(2,batch,0,packet,reports.Add); Equal(3,packet.Result.errors,"Zero reports");
    ControlPacket.Read(1,new byte[3],0,packet,reports.Add); Equal(4,packet.Result.errors,"Truncated keyboard");
    var key=new byte[16]; key[0]=30; key[6]=65; ControlPacket.Read(1,key,0,packet,reports.Add);
    Equal(1,packet.Result.keys,"RAWKEYBOARD field offsets");
    var rawMouse=new byte[24]; Put(rawMouse,12,10); ControlPacket.Read(0,rawMouse,0,packet,reports.Add);
    Equal(1,packet.Result.movement,"RAWMOUSE field offsets");
    RemainingReviewChecks();
    ReviewChecks();
    Console.WriteLine("PASS "+checks+" native control checks. Synthetic packets/capabilities only; no device APIs called.");
  }
}
