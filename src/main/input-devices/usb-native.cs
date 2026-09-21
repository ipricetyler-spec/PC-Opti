// Dialed-owned user-mode adapter. No driver code is embedded or loaded here.
// SetupAPI / Configuration Manager enumerate devices; foreground Raw Input checks controls and timing.
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Windows.Forms;
using Microsoft.Win32;
using Microsoft.Win32.SafeHandles;

namespace Dialed.Input {
  public sealed class Device {
    public string id, parent, name, service, className, location, inputKind;
    public string[] compatibleIds, hardwareIds, lowerFilters;
    public int problem, speed=-1, port=-1;
    public bool present;
    public IntervalState interval;
  }
  public sealed class IntervalState {
    public string key, kind;
    public int? value;
    public bool readable, ambiguous;
  }
  public static class Devices {
    [StructLayout(LayoutKind.Sequential)] struct Info { public int size; public Guid classGuid; public uint devInst; public IntPtr reserved; }
    [StructLayout(LayoutKind.Sequential)] struct PropertyKey { public Guid guid; public uint id; }
    [DllImport("setupapi.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr SetupDiGetClassDevs(IntPtr guid, string enumerator, IntPtr hwnd, uint flags);
    [DllImport("setupapi.dll", SetLastError=true)] static extern bool SetupDiEnumDeviceInfo(IntPtr set, uint index, ref Info info);
    [DllImport("setupapi.dll")] static extern bool SetupDiDestroyDeviceInfoList(IntPtr set);
    [DllImport("setupapi.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool SetupDiGetDeviceRegistryProperty(IntPtr set, ref Info info, uint property, out uint type, byte[] data, uint size, out uint needed);
    [DllImport("setupapi.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool SetupDiOpenDeviceInfo(IntPtr set, string id, IntPtr hwnd, uint flags, ref Info info);
    [DllImport("setupapi.dll", SetLastError=true)] static extern IntPtr SetupDiOpenDevRegKey(IntPtr set, ref Info info, uint scope, uint profile, uint keyType, uint access);
    [DllImport("setupapi.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool SetupDiGetDeviceProperty(IntPtr set,ref Info info,ref PropertyKey key,out uint type,byte[] data,uint size,out uint needed,uint flags);
    [DllImport("cfgmgr32.dll", CharSet=CharSet.Unicode)] static extern uint CM_Get_Device_ID(uint node, StringBuilder id, int length, uint flags);
    [DllImport("cfgmgr32.dll")] static extern uint CM_Get_Parent(out uint parent, uint node, uint flags);
    [DllImport("cfgmgr32.dll")] static extern uint CM_Get_DevNode_Status(out uint status, out uint problem, uint node, uint flags);
    [DllImport("cfgmgr32.dll",CharSet=CharSet.Unicode)] static extern uint CM_Get_Device_Interface_List_Size(out uint size,ref Guid guid,string id,uint flags);
    [DllImport("cfgmgr32.dll",CharSet=CharSet.Unicode)] static extern uint CM_Get_Device_Interface_List(ref Guid guid,string id,char[] list,uint size,uint flags);
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern SafeFileHandle CreateFile(string name,uint access,uint share,IntPtr security,uint creation,uint flags,IntPtr template);
    [DllImport("kernel32.dll",SetLastError=true)] static extern bool DeviceIoControl(SafeFileHandle handle,uint code,byte[] input,int inSize,byte[] output,int outSize,out int returned,IntPtr overlapped);
    [StructLayout(LayoutKind.Sequential)] struct RawListEntry { public IntPtr handle; public uint type; }
    [DllImport("user32.dll",SetLastError=true)] static extern uint GetRawInputDeviceList([In,Out] RawListEntry[] list,ref uint count,uint size);
    [DllImport("user32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern uint GetRawInputDeviceInfo(IntPtr device,uint command,StringBuilder data,ref uint size);
    [DllImport("user32.dll",SetLastError=true)] static extern uint GetRawInputDeviceInfo(IntPtr device,uint command,IntPtr data,ref uint size);
    static int Address(IntPtr set,ref Info info) { uint type,size; byte[] data=new byte[4]; return SetupDiGetDeviceRegistryProperty(set,ref info,28,out type,data,4,out size)&&type==4&&size==4?BitConverter.ToInt32(data,0):-1; }
    static int Speed(Device device) {
      if(device.port<1 || device.port>255 || device.parent.Length==0) return -1;
      Guid guid=new Guid("f18a0e88-c30c-11d0-8815-00a0c906bed8"); uint length;
      if(CM_Get_Device_Interface_List_Size(out length,ref guid,device.parent,0)!=0 || length<2 || length>16384) return -1;
      var chars=new char[length]; if(CM_Get_Device_Interface_List(ref guid,device.parent,chars,length,0)!=0) return -1;
      foreach(string hub in new string(chars).Split(new char[]{'\0'},StringSplitOptions.RemoveEmptyEntries)) {
        using(var handle=CreateFile(hub,0x80000000u|0x40000000u,3,IntPtr.Zero,3,0,IntPtr.Zero)) {
          if(handle.IsInvalid) continue;
          var buffer=new byte[4096]; Array.Copy(BitConverter.GetBytes(device.port),buffer,4); int returned;
          // USB_NODE_CONNECTION_INFORMATION_EX: ULONG + 18-byte device descriptor + configuration + speed.
          if(DeviceIoControl(handle,0x220448,buffer,buffer.Length,buffer,buffer.Length,out returned,IntPtr.Zero) && returned>=24 && buffer[4]==18) {
            string identity=String.Format("VID_{0:X4}&PID_{1:X4}",BitConverter.ToUInt16(buffer,12),BitConverter.ToUInt16(buffer,14));
            if(device.id.IndexOf(identity,StringComparison.OrdinalIgnoreCase)>=0 && buffer[23]<=3) return buffer[23];
          }
        }
      }
      return -1;
    }
    static Info NewInfo() { return new Info { size=Marshal.SizeOf(typeof(Info)) }; }
    static string NodeId(uint node) { var s=new StringBuilder(1024); return CM_Get_Device_ID(node,s,s.Capacity,0)==0 ? s.ToString() : ""; }
    static string[] Property(IntPtr set, ref Info info, uint property) {
      uint type,needed; var bytes=new byte[16384];
      if(!SetupDiGetDeviceRegistryProperty(set,ref info,property,out type,bytes,(uint)bytes.Length,out needed)) {
        int error=Marshal.GetLastWin32Error();
        if(error==13 || error==2) return new string[0];
        throw new Win32Exception(error,"Device property could not be read completely.");
      }
      if((type!=1 && type!=7) || needed>bytes.Length || needed%2!=0) throw new InvalidOperationException("Unexpected device property type.");
      return Encoding.Unicode.GetString(bytes,0,(int)needed).Split(new char[]{'\0'},StringSplitOptions.RemoveEmptyEntries);
    }
    static string One(IntPtr set, ref Info info, uint property) { var v=Property(set,ref info,property); return v.Length>0?v[0]:""; }
    static string BusName(IntPtr set,ref Info info) {
      var key=new PropertyKey { guid=new Guid("540b947e-8b40-45bc-a8a2-6a0b894cbda2"),id=4 }; uint type,size; var data=new byte[2048];
      return SetupDiGetDeviceProperty(set,ref info,ref key,out type,data,(uint)data.Length,out size,0) && type==18 && size<=data.Length && size%2==0 ? Encoding.Unicode.GetString(data,0,(int)size).TrimEnd('\0') : "";
    }
    static string RawName(IntPtr handle) {
      uint length=0;
      if(GetRawInputDeviceInfo(handle,0x20000007,null,ref length)==uint.MaxValue || length==0 || length>4096) return "";
      var name=new StringBuilder((int)length);
      if(GetRawInputDeviceInfo(handle,0x20000007,name,ref length)==uint.MaxValue) return "";
      string id=name.ToString(); if(id.StartsWith("\\\\?\\")) id=id.Substring(4);
      int end=id.LastIndexOf("#{",StringComparison.Ordinal); if(end>=0) id=id.Substring(0,end);
      return id.Replace('#','\\');
    }
    static Dictionary<string,string> RawInputs() {
      var result=new Dictionary<string,string>(StringComparer.OrdinalIgnoreCase); uint count=0, entrySize=(uint)Marshal.SizeOf(typeof(RawListEntry));
      if(GetRawInputDeviceList(null,ref count,entrySize)==uint.MaxValue || count>4096) return result;
      var entries=new RawListEntry[count]; if(count>0 && GetRawInputDeviceList(entries,ref count,entrySize)==uint.MaxValue) return result;
      for(uint i=0;i<count;i++) {
        string id=RawName(entries[i].handle); if(id.Length==0) continue;
        string kind=entries[i].type==0?"MOUSE":entries[i].type==1?"KEYBOARD":"";
        if(entries[i].type==2) {
          uint bytes=32; IntPtr info=Marshal.AllocHGlobal((int)bytes);
          try {
            for(int b=0;b<bytes;b++) Marshal.WriteByte(info,b,0); Marshal.WriteInt32(info,(int)bytes);
            if(GetRawInputDeviceInfo(entries[i].handle,0x2000000b,info,ref bytes)!=uint.MaxValue && bytes>=24) {
              ushort page=(ushort)Marshal.ReadInt16(info,20), usage=(ushort)Marshal.ReadInt16(info,22);
              if(page==1 && usage==2) kind="MOUSE"; else if(page==1 && usage==4) kind="JOYSTICK"; else if(page==1 && usage==5) kind="GAMEPAD";
            }
          } finally { Marshal.FreeHGlobal(info); }
        }
        if(kind.Length>0) result[id]=kind;
      }
      return result;
    }
    static RegistryKey DeviceKey(IntPtr set, ref Info info, bool write, uint keyType) {
      IntPtr key=SetupDiOpenDevRegKey(set,ref info,1,0,keyType,write?0x2001fu:0x20019u);
      if(key==new IntPtr(-1)) throw new Win32Exception(Marshal.GetLastWin32Error());
      return RegistryKey.FromHandle(new SafeRegistryHandle(key,true));
    }
    static IntervalState ReadInterval(IntPtr set, ref Info info) {
      var result=new IntervalState { readable=false, key="", kind="" };
      try {
        using(var root=DeviceKey(set,ref info,false,1)) using(var driver=DeviceKey(set,ref info,false,2)) {
          int found=0;
          foreach(string name in new string[]{"Hardware","Parameters","Driver"}) {
            using(var key=name=="Driver"?driver:(name=="Hardware"?root.OpenSubKey("",false):root.OpenSubKey("Device Parameters",false))) {
              if(key==null || key.GetValue("bInterval",null)==null) continue;
              found++; result.key=name; result.kind=key.GetValueKind("bInterval").ToString();
              if(result.kind=="DWord") result.value=(int)key.GetValue("bInterval");
            }
          }
          result.ambiguous=found>1; result.readable=true;
        }
      } catch(System.Security.SecurityException) {} catch(UnauthorizedAccessException) {} catch(Win32Exception) {}
      return result;
    }
    public static Device[] Scan() {
      var devices=new List<Device>(); var rawInputs=RawInputs(); IntPtr set=SetupDiGetClassDevs(IntPtr.Zero,null,IntPtr.Zero,6);
      if(set==new IntPtr(-1)) throw new Win32Exception(Marshal.GetLastWin32Error());
      try {
        for(uint i=0;i<4096;i++) {
          var info=NewInfo();
          if(!SetupDiEnumDeviceInfo(set,i,ref info)) {
            if(Marshal.GetLastWin32Error()!=259) throw new Win32Exception(Marshal.GetLastWin32Error());
            foreach(var device in devices) if(device.id.StartsWith("USB\\VID_",StringComparison.OrdinalIgnoreCase) && device.id.IndexOf("&MI_",StringComparison.OrdinalIgnoreCase)<0) device.speed=Speed(device);
            return devices.ToArray();
          }
          string id=NodeId(info.devInst); uint parent,status,problem;
          if(!(id.StartsWith("USB\\",StringComparison.OrdinalIgnoreCase)||id.StartsWith("HID\\",StringComparison.OrdinalIgnoreCase)||id.StartsWith("PCI\\",StringComparison.OrdinalIgnoreCase))) continue;
          bool state=CM_Get_DevNode_Status(out status,out problem,info.devInst,0)==0;
          string name=BusName(set,ref info); if(name.Length==0) name=One(set,ref info,12); if(name.Length==0) name=One(set,ref info,0);
          string inputKind=""; rawInputs.TryGetValue(id,out inputKind);
          devices.Add(new Device { id=id, parent=CM_Get_Parent(out parent,info.devInst,0)==0?NodeId(parent):"", name=name, inputKind=inputKind??"",
            className=One(set,ref info,7), service=One(set,ref info,4), location=One(set,ref info,35),
            compatibleIds=Property(set,ref info,2), hardwareIds=Property(set,ref info,1), lowerFilters=Property(set,ref info,18),
            problem=state?(int)problem:-1, present=state, port=Address(set,ref info), interval=id.StartsWith("USB\\",StringComparison.OrdinalIgnoreCase)?ReadInterval(set,ref info):null });
        }
        throw new InvalidOperationException("Device enumeration limit reached; incomplete inventory refused.");
      } finally { SetupDiDestroyDeviceInfoList(set); }
    }
    // Only an EXISTING DWORD on an ALREADY filtered device is changed. No filter/service installation.
    // The caller rechecks signed driver identity and device topology immediately before this CAS.
    public static void ChangeExistingInterval(string id,string location,string keyName,int before,int after) {
      if(after<1 || after>32 || before<1 || before>32 || (keyName!="Hardware" && keyName!="Parameters" && keyName!="Driver")) throw new ArgumentException("Unsupported interval.");
      IntPtr set=SetupDiGetClassDevs(IntPtr.Zero,null,IntPtr.Zero,6);
      if(set==new IntPtr(-1)) throw new Win32Exception(Marshal.GetLastWin32Error());
      try {
        var info=NewInfo();
        if(!SetupDiOpenDeviceInfo(set,id,IntPtr.Zero,0,ref info)) throw new Win32Exception(Marshal.GetLastWin32Error());
        uint status,problem;
        if(CM_Get_DevNode_Status(out status,out problem,info.devInst,0)!=0 || problem!=0) throw new InvalidOperationException("Device is missing or has a problem.");
        if(One(set,ref info,35)!=location) throw new InvalidOperationException("Device connection changed.");
        var filters=Property(set,ref info,18);
        if(Array.FindIndex(filters,s=>s.Equals("hidusbf",StringComparison.OrdinalIgnoreCase))<0) throw new InvalidOperationException("HIDUSBF is no longer attached.");
        var current=ReadInterval(set,ref info);
        if(!current.readable || current.ambiguous || current.kind!="DWord" || current.key!=keyName || current.value!=before) throw new InvalidOperationException("Polling configuration changed; rescan before applying.");
        using(var root=DeviceKey(set,ref info,true,keyName=="Driver"?2u:1u)) using(var key=keyName=="Driver"?root.OpenSubKey("",true):(keyName=="Hardware"?root.OpenSubKey("",true):root.OpenSubKey("Device Parameters",true))) {
          if(key==null || key.GetValueKind("bInterval")!=RegistryValueKind.DWord || (int)key.GetValue("bInterval")!=before) throw new InvalidOperationException("Polling value changed.");
          key.SetValue("bInterval",after,RegistryValueKind.DWord); key.Flush();
          if((int)key.GetValue("bInterval")!=after) throw new InvalidOperationException("Polling value readback failed.");
        }
      } finally { SetupDiDestroyDeviceInfoList(set); }
    }
  }

  // Only aggregates leave the capture process. State below is scoped to one handle and one check.
  public sealed class ControlActivity {
    public int decoded, unsupported, errors, buttons, keys, movement, axes, hats, hidReports, unstableAxes, sparseAxes, pendingAxes, reportErrors, unmonitoredControls;
  }
  public sealed class ActivityTracker {
    public readonly ControlActivity Result=new ControlActivity();
    sealed class AxisState {
      public double anchor, since=-1, start, lastSample=-1, threshold;
      public int direction, samples; public bool ready, blocked;
      public readonly List<double> baseline=new List<double>();
    }
    readonly Dictionary<string,AxisState> axisStates=new Dictionary<string,AxisState>();
    readonly Dictionary<string,HashSet<ushort>> buttonStates=new Dictionary<string,HashSet<ushort>>();
    readonly Dictionary<string,long> hatStates=new Dictionary<string,long>();
    readonly HashSet<int> heldKeys=new HashSet<int>();
    double mouseSince=-1, mouseX, mouseY;
    int? absoluteX, absoluteY;
    public void Buttons(string identity, ushort[] values) {
      var next=new HashSet<ushort>(values); HashSet<ushort> before;
      if(buttonStates.TryGetValue(identity,out before)) {
        foreach(var value in next) if(!before.Contains(value)) Result.buttons++;
        foreach(var value in before) if(!next.Contains(value)) Result.buttons++;
      }
      buttonStates[identity]=next;
    }
    public void Axis(string identity,double normalized,double ms) {
      AxisState state;
      if(!axisStates.TryGetValue(identity,out state)) { state=new AxisState { start=ms }; axisStates[identity]=state; Result.pendingAxes++; }
      if(!state.ready) {
        if(state.baseline.Count<128 && (state.lastSample<0 || ms-state.lastSample>=2)) { state.baseline.Add(normalized); state.lastSample=ms; }
        if(ms-state.start<250 || (state.baseline.Count<16 && ms-state.start<1000)) return;
        state.baseline.Sort(); int count=state.baseline.Count;
        state.anchor=state.baseline[count/2];
        double noise=(state.baseline[Math.Min(count-1,(int)(count*0.95))]-state.baseline[(int)(count*0.05)])/2;
        bool sparse=count<16 || state.start>250;
        if(sparse) Result.sparseAxes++;
        state.threshold=count<16?0.06:Math.Max(0.06,3*noise); state.ready=true; state.baseline.Clear(); Result.pendingAxes--;
        // Moving during calibration cannot produce an unqualified idle result.
        if(!sparse && noise>0.02) Result.sparseAxes++;
        if(state.threshold>0.25) { state.blocked=true; Result.unstableAxes++; }
        return;
      }
      if(state.blocked) return;
      double delta=normalized-state.anchor;
      if(Math.Abs(delta)<state.threshold) { state.since=-1; state.direction=0; state.samples=0; return; }
      int direction=Math.Sign(delta);
      if(state.since<0 || direction!=state.direction) { state.since=ms; state.direction=direction; state.samples=1; return; }
      state.samples++;
      if(state.samples>=3 && ms-state.since>=20) { Result.axes++; state.anchor=normalized; state.since=-1; state.direction=0; state.samples=0; }
    }
    public void Hat(string identity,long value) {
      long previous; if(hatStates.TryGetValue(identity,out previous) && previous!=value) Result.hats++;
      hatStates[identity]=value;
    }
    public void Keyboard(ushort scan,ushort flags,ushort virtualKey) {
      if(scan==0xff || (scan==0 && virtualKey==0)) { Result.errors++; return; }
      if(virtualKey==255) return;
      int identity=(scan==0 ? 0x10000|virtualKey : scan)|((flags&6)<<20);
      if((flags&1)==0) { if(heldKeys.Add(identity)) Result.keys++; }
      else { if(heldKeys.Remove(identity)) Result.keys++; }
      Result.decoded++;
    }
    public bool Mouse(ushort flags,ushort buttons,short wheel,int x,int y,double ms) {
      for(int bit=0;bit<10;bit++) if((buttons&(1<<bit))!=0) Result.buttons++;
      if((buttons&0xc00)!=0 && wheel!=0) Result.movement++;
      double dx=x,dy=y,threshold=3;
      if((flags&1)!=0) {
        dx=absoluteX.HasValue ? (double)x-absoluteX.Value : 0; dy=absoluteY.HasValue ? (double)y-absoluteY.Value : 0;
        absoluteX=x; absoluteY=y; threshold=128;
      } else { absoluteX=null; absoluteY=null; }
      if(mouseSince<0 || ms-mouseSince>50) { mouseSince=ms; mouseX=0; mouseY=0; }
      mouseX+=dx; mouseY+=dy;
      if(Math.Abs(mouseX)+Math.Abs(mouseY)>=threshold) { Result.movement++; mouseX=0; mouseY=0; mouseSince=ms; }
      Result.decoded++;
      return dx!=0 || dy!=0;
    }
  }
  public static class ControlPacket {
    public static bool Read(int type,byte[] data,double ms,ActivityTracker tracker,Action<byte[]> hidReport) {
      if(type==0 && data.Length>=24) return tracker.Mouse(BitConverter.ToUInt16(data,0),BitConverter.ToUInt16(data,4),BitConverter.ToInt16(data,6),BitConverter.ToInt32(data,12),BitConverter.ToInt32(data,16),ms);
      else if(type==1 && data.Length>=16) tracker.Keyboard(BitConverter.ToUInt16(data,0),BitConverter.ToUInt16(data,2),BitConverter.ToUInt16(data,6));
      else if(type==2 && data.Length>=8) {
        uint length=BitConverter.ToUInt32(data,0),reports=BitConverter.ToUInt32(data,4);
        if(length==0 || reports==0 || reports>256 || (ulong)length*reports>(ulong)(data.Length-8)) { tracker.Result.errors++; tracker.Result.reportErrors++; return false; }
        tracker.Result.hidReports+=(int)reports;
        for(uint i=0;i<reports;i++) {
          var report=new byte[length]; Array.Copy(data,8+(int)(i*length),report,0,(int)length); hidReport(report);
        }
      } else { tracker.Result.errors++; tracker.Result.reportErrors++; }
      return false;
    }
  }
  public sealed class HidControl {
    public ushort page,link,usage,bits,dataIndex; public byte report;
    public long min,max; public bool button,hat,hasNull; public string key;
  }
  // Pure HIDP capability parsing and normalization, also exercised by fixtures.
  public static class HidControls {
    public static HidControl[] ParseCaps(byte[] bytes,int count,bool buttons) {
      int unmonitored; return ParseCaps(bytes,count,buttons,out unmonitored);
    }
    public static HidControl[] ParseCaps(byte[] bytes,int count,bool buttons,out int unmonitored) {
      if(count<0 || count>256 || bytes==null || bytes.Length!=count*72) throw new ArgumentException("Invalid HID capabilities.");
      unmonitored=0; var result=new List<HidControl>();
      for(int i=0;i<count;i++) {
        int p=i*72; ushort page=BitConverter.ToUInt16(bytes,p),link=BitConverter.ToUInt16(bytes,p+6),first=BitConverter.ToUInt16(bytes,p+56);
        byte report=bytes[p+2]; bool range=bytes[p+12]!=0;
        if(bytes[p+3]!=0) continue; // The non-alias cap owns the same control.
        int last=range?BitConverter.ToUInt16(bytes,p+58):first;
        int begin=BitConverter.ToUInt16(bytes,p+68),end=range?BitConverter.ToUInt16(bytes,p+70):begin;
        if(last<first || end<begin || last-first!=end-begin || end-begin>255) { unmonitored++; continue; }
        bool skipped=false;
        if(buttons) {
          for(int usage=first;usage<=last;usage++) {
            if(page!=9 && !(page==1 && (usage==0x85 || (usage>=0x90 && usage<=0x93)))) { skipped=true; continue; }
            int index=begin+usage-first;
            if(!result.Exists(c=>c.report==report && c.dataIndex==index)) result.Add(new HidControl { button=true,page=page,link=link,usage=(ushort)usage,report=report,dataIndex=(ushort)index,key=report+":buttons" });
          }
        } else {
          if(page!=1 || bytes[p+15]==0 || (!range && BitConverter.ToUInt16(bytes,p+20)!=1)) { unmonitored++; continue; }
          ushort bits=BitConverter.ToUInt16(bytes,p+18);
          long min=BitConverter.ToInt32(bytes,p+40),max=BitConverter.ToInt32(bytes,p+44);
          if(bits<1 || bits>32 || last-first>64) { unmonitored++; continue; }
          long mask=(1L<<bits)-1;
          if(min>=0) max=max<0?max&mask:Math.Min(max,mask);
          if(max<=min || min<-(1L<<(bits-1)) || (min<0 && max>((1L<<(bits-1))-1))) { unmonitored++; continue; }
          for(int usage=first;usage<=last;usage++) {
            if(usage<0x30 || usage>0x39 || usage==0x37 || usage==0x38) { skipped=true; continue; }
            ushort index=(ushort)(begin+usage-first); string key=report+":value:"+index;
            if(!result.Exists(c=>c.key==key)) result.Add(new HidControl { page=page,link=link,report=report,usage=(ushort)usage,dataIndex=index,bits=bits,min=min,max=max,hat=usage==0x39,hasNull=bytes[p+16]!=0,key=key });
          }
        }
        if(skipped) unmonitored++; // Count skipped declarations once, not on every report.
        if(result.Count>256) throw new ArgumentException("HID control limit exceeded.");
      }
      return result.ToArray();
    }
    // 0 invalid, 1 ordinary value, 2 null. Hat null tolerance is discrete only.
    public static int Normalize(HidControl control,uint raw,out double normalized,out long value) {
      normalized=0; long mask=(1L<<control.bits)-1; value=(long)raw&mask;
      if(control.min<0 && (value&(1L<<(control.bits-1)))!=0) value-=1L<<control.bits;
      if(value<control.min || value>control.max) { value=long.MinValue; return control.hat || control.hasNull ? 2 : 0; }
      normalized=(value-control.min)/(double)(control.max-control.min); return 1;
    }
    public static void ReadData(IList<HidControl> controls,byte report,HidData[] data,int count,double ms,ActivityTracker tracker,Dictionary<ushort,uint> values) {
      if(count<0 || count>data.Length || count>4096) throw new ArgumentException("Invalid HID data count.");
      values.Clear();
      for(int i=0;i<count;i++) {
        if(values.ContainsKey(data[i].index)) { tracker.Result.errors++; return; }
        values.Add(data[i].index,data[i].raw);
      }
      bool matched=false,decoded=false,hasButtons=false; var pressed=new List<ushort>();
      foreach(var control in controls) {
        if(control.report!=report) continue;
        matched=true; uint raw;
        if(control.button) {
          hasButtons=true;
          if(values.TryGetValue(control.dataIndex,out raw) && (raw&255)!=0) pressed.Add(control.dataIndex);
          continue;
        }
        // Values are returned even when zero; absence must never become zero/neutral.
        if(!values.TryGetValue(control.dataIndex,out raw)) { tracker.Result.errors++; continue; }
        double normalized; long value; int state=Normalize(control,raw,out normalized,out value);
        if(state==0) { tracker.Result.errors++; continue; }
        if(control.hat) tracker.Hat(control.key,value);
        else if(state==1) tracker.Axis(control.key,normalized,ms);
        decoded=true;
      }
      if(hasButtons) { tracker.Buttons(report+":buttons",pressed.ToArray()); decoded=true; }
      if(decoded) tracker.Result.decoded++;
      if(!matched) tracker.Result.unsupported++;
    }
    public static ushort[] PressedButtons(IList<HidControl> controls,byte report,ushort[] indices) {
      var result=new HashSet<ushort>();
      foreach(var index in indices) foreach(var control in controls) if(control.button && control.report==report && control.dataIndex==index) { result.Add(index); break; }
      var values=new ushort[result.Count]; result.CopyTo(values); return values;
    }
  }
  [StructLayout(LayoutKind.Sequential)] public struct HidData { public ushort index,reserved; public uint raw; }
  // HIDP capability layouts follow hidpi.h (72-byte button/value capabilities).
  // Read only standard game controls; vendor bytes, sensors, counters and touch data are ignored.
  public sealed class HidActivityDecoder : IDisposable {
    const int Success=0x00110000;
    [DllImport("user32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern uint GetRawInputDeviceInfo(IntPtr device,uint command,IntPtr data,ref uint size);
    [DllImport("hid.dll")] static extern int HidP_GetCaps(IntPtr preparsed,IntPtr caps);
    [DllImport("hid.dll")] static extern int HidP_GetButtonCaps(int type,IntPtr caps,ref ushort count,IntPtr preparsed);
    [DllImport("hid.dll")] static extern int HidP_GetValueCaps(int type,IntPtr caps,ref ushort count,IntPtr preparsed);
    [DllImport("hid.dll")] static extern uint HidP_MaxDataListLength(int type,IntPtr preparsed);
    [DllImport("hid.dll")] static extern int HidP_GetData(int type,[In,Out] HidData[] data,ref uint count,IntPtr preparsed,byte[] report,uint length);
    readonly List<HidControl> controls=new List<HidControl>();
    HidData[] dataBuffer;
    readonly Dictionary<ushort,uint> values=new Dictionary<ushort,uint>();
    public int UnmonitoredControls { get; private set; }
    IntPtr preparsed;
    public bool Failed { get; private set; }
    public int ButtonGroups { get { var groups=new HashSet<string>(); foreach(var c in controls) if(c.button) groups.Add(c.key); return groups.Count; } }
    public int Axes { get { return controls.FindAll(c=>!c.button && !c.hat).Count; } }
    public int Hats { get { return controls.FindAll(c=>c.hat).Count; } }
    static ushort U16(IntPtr p,int offset) { return (ushort)Marshal.ReadInt16(p,offset); }
    public HidActivityDecoder(IntPtr device) {
      try {
        uint bytes=0;
        if(GetRawInputDeviceInfo(device,0x20000005,IntPtr.Zero,ref bytes)==uint.MaxValue || bytes==0 || bytes>65536) { Failed=true; return; }
        preparsed=Marshal.AllocHGlobal((int)bytes); uint capacity=bytes;
        if(GetRawInputDeviceInfo(device,0x20000005,preparsed,ref bytes)==uint.MaxValue || bytes>capacity) { Failed=true; return; }
        IntPtr caps=Marshal.AllocHGlobal(64);
        try {
          if(HidP_GetCaps(preparsed,caps)!=Success) { Failed=true; return; }
          if(U16(caps,2)!=1 || (U16(caps,0)!=4 && U16(caps,0)!=5)) return;
          LoadCaps(U16(caps,46),true); LoadCaps(U16(caps,48),false);
          if(controls.Count>0) {
            uint maxData=HidP_MaxDataListLength(0,preparsed);
            if(maxData==0 || maxData>4096) { Failed=true; return; }
            dataBuffer=new HidData[maxData];
          }
        } finally { Marshal.FreeHGlobal(caps); }
      } catch { Failed=true; Dispose(); }
    }
    void LoadCaps(ushort count,bool buttons) {
      if(count==0) return;
      if(count>256) { Failed=true; return; }
      ushort capacity=count; IntPtr memory=Marshal.AllocHGlobal(count*72);
      try {
        int status=buttons?HidP_GetButtonCaps(0,memory,ref count,preparsed):HidP_GetValueCaps(0,memory,ref count,preparsed);
        if(status!=Success || count>capacity) { Failed=true; return; }
        var bytes=new byte[count*72]; Marshal.Copy(memory,bytes,0,bytes.Length);
        int unmonitored; controls.AddRange(HidControls.ParseCaps(bytes,count,buttons,out unmonitored));
        UnmonitoredControls+=unmonitored;
        if(controls.Count>256) { Failed=true; return; }
      } finally { Marshal.FreeHGlobal(memory); }
    }
    public void Read(byte[] report,double ms,ActivityTracker tracker) {
      tracker.Result.unmonitoredControls=Math.Max(tracker.Result.unmonitoredControls,UnmonitoredControls);
      if(Failed) { tracker.Result.errors++; return; }
      if(report.Length==0) { tracker.Result.errors++; return; }
      if(!controls.Exists(c=>c.report==report[0])) { tracker.Result.unsupported++; return; }
      uint count=(uint)dataBuffer.Length;
      if(HidP_GetData(0,dataBuffer,ref count,preparsed,report,(uint)report.Length)!=Success || count>dataBuffer.Length) { tracker.Result.errors++; return; }
      HidControls.ReadData(controls,report[0],dataBuffer,(int)count,ms,tracker,values);
    }
    public void Dispose() { if(preparsed!=IntPtr.Zero) { Marshal.FreeHGlobal(preparsed); preparsed=IntPtr.Zero; } }
  }
  public sealed class EventChannel { public string id; public bool keyboard; public double[] timesMs, motionTimesMs; public double spanMs; public ControlActivity activity; public int messageCount,hidReports,firstHidReports; }
  public sealed class TimingWindow : Form {
    [StructLayout(LayoutKind.Sequential)] struct RawHandle { public IntPtr handle; public uint type; }
    [DllImport("user32.dll")] static extern uint GetRawInputDeviceList([In,Out] RawHandle[] list,ref uint count,uint size);
    [StructLayout(LayoutKind.Sequential)] struct RawDevice { public ushort page,usage; public uint flags; public IntPtr target; }
    [DllImport("user32.dll",SetLastError=true)] static extern bool RegisterRawInputDevices(RawDevice[] devices,uint count,uint size);
    [DllImport("user32.dll",SetLastError=true)] static extern uint GetRawInputData(IntPtr input,uint command,IntPtr data,ref uint size,uint headerSize);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr window);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr window,int command);
    [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr window,StringBuilder text,int count);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window,out uint processId);
    [DllImport("user32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern uint GetRawInputDeviceInfo(IntPtr device,uint command,StringBuilder data,ref uint size);
    // Says which window took the foreground, so a cancelled check names the culprit instead
    // of leaving the reader to guess. Titles can hold anything, so only a short, single-line,
    // printable form is kept, and nothing here is written to disk.
    static string DescribeForeground() {
      IntPtr window=GetForegroundWindow();
      if(window==IntPtr.Zero) return "no window (the desktop had focus)";
      string process="";
      try { uint id; GetWindowThreadProcessId(window,out id); if(id!=0) process=System.Diagnostics.Process.GetProcessById((int)id).ProcessName; } catch { }
      var title=new StringBuilder(160); GetWindowText(window,title,title.Capacity);
      var clean=new StringBuilder();
      foreach(char letter in title.ToString()) { if(clean.Length>=60) break; clean.Append(letter<' '||letter==127?' ':letter); }
      string text=clean.ToString().Trim();
      if(process.Length>0 && text.Length>0) return process+" (\""+text+"\")";
      if(process.Length>0) return process;
      return text.Length>0?"\""+text+"\"":"an unnamed window";
    }
    readonly HashSet<string> allowed;
    readonly HashSet<IntPtr> selectedHandles=new HashSet<IntPtr>(),failedHandles=new HashSet<IntPtr>();
    readonly HashSet<string> keyboardIds=new HashSet<string>(StringComparer.OrdinalIgnoreCase);
    readonly Dictionary<IntPtr,string> names=new Dictionary<IntPtr,string>();
    readonly Dictionary<string,List<double>> times=new Dictionary<string,List<double>>();
    readonly Dictionary<string,List<double>> motionTimes=new Dictionary<string,List<double>>();
    readonly Dictionary<string,int> firstHidReports=new Dictionary<string,int>();
    readonly Dictionary<string,ActivityTracker> activity=new Dictionary<string,ActivityTracker>();
    readonly Dictionary<IntPtr,HidActivityDecoder> decoders=new Dictionary<IntPtr,HidActivityDecoder>();
    readonly Label feedback=new Label { Dock=DockStyle.Bottom, Height=70, TextAlign=System.Drawing.ContentAlignment.MiddleCenter };
    // A Label, not a Button, on purpose: a Button takes keyboard focus the moment the window
    // opens, and a focused Button is pressed by Space and Enter - so a keyboard check would cancel
    // itself on the first Space. A Label cannot take focus and answers only to a mouse click.
    readonly Label cancelButton=new Label { Dock=DockStyle.Bottom, Height=36, Text="Cancel check", TextAlign=System.Drawing.ContentAlignment.MiddleCenter, Cursor=Cursors.Hand, BackColor=System.Drawing.Color.FromArgb(67,32,42), ForeColor=System.Drawing.Color.WhiteSmoke };
    readonly Stopwatch clock=Stopwatch.StartNew();
    int sampleCount, reportCount;
    bool started, completed, canceled, focusLost, connectionLost, foregroundRefused;
    int foreignTicks;
    string focusTaker="";
    string ResolveName(IntPtr handle) {
      string id; if(names.TryGetValue(handle,out id)) return id;
      uint length=2048; var name=new StringBuilder((int)length);
      if(GetRawInputDeviceInfo(handle,0x20000007,name,ref length)==uint.MaxValue) id="";
      else { id=name.ToString(); if(id.StartsWith("\\\\?\\")) id=id.Substring(4); int end=id.LastIndexOf("#{",StringComparison.Ordinal); if(end>=0) id=id.Substring(0,end); id=id.Replace('#','\\'); }
      names[handle]=id; return id;
    }
    public static string Instructions(bool mouse,bool keyboard,bool controller) {
      var text="Use only the selected device for eight seconds.\r\n";
      if(controller) text+="Hold sticks/triggers still for one second, then move them and use buttons/D-pad.\r\n";
      if(mouse) text+="Move the mouse steadily, click buttons and use the wheel.\r\n";
      if(keyboard) text+="Press and release different keys. Key polling rate is not measured.\r\n";
      return text+"Raw reports and key identities are not saved.\r\nKeep this window focused. Click Cancel check or close this window to cancel.";
    }
    public TimingWindow(string[] ids) {
      allowed=new HashSet<string>(ids,StringComparer.OrdinalIgnoreCase);
      uint count=0,size=(uint)Marshal.SizeOf(typeof(RawHandle));
      if(GetRawInputDeviceList(null,ref count,size)==uint.MaxValue || count>4096) throw new InvalidOperationException("Input handle inventory unavailable.");
      var handles=new RawHandle[count]; uint capacity=count;
      if(count>0 && (GetRawInputDeviceList(handles,ref count,size)==uint.MaxValue || count>capacity)) throw new InvalidOperationException("Input handle inventory changed.");
      bool mouse=false,keyboard=false,controller=false;
      for(int i=0;i<count;i++) { var item=handles[i]; string id=ResolveName(item.handle); if(!allowed.Contains(id)) continue; selectedHandles.Add(item.handle); if(item.type==1) { keyboardIds.Add(id); keyboard=true; } else if(item.type==0) mouse=true; else controller=true; }
      if(ids.Length>0 && selectedHandles.Count==0) throw new InvalidOperationException("Selected input handles disappeared. Rescan first.");
      Text="Dialed input activity check - keep this window focused";
      // Dialed's own window is usually maximised behind this one. Without TopMost the check
      // window opens behind it: invisible, so the first click lands on Dialed and cancels
      // the check. ShowInTaskbar keeps a way back to it if anything still covers it.
      TopMost=true; ShowInTaskbar=true;
      Width=700; Height=340; StartPosition=FormStartPosition.CenterScreen;
      BackColor=System.Drawing.Color.FromArgb(16,22,34); ForeColor=System.Drawing.Color.WhiteSmoke;
      Font=new System.Drawing.Font("Segoe UI",10); Padding=new Padding(16);
      feedback.Height=90; feedback.ForeColor=System.Drawing.Color.LightSkyBlue;
      var instructions=new Label { Dock=DockStyle.Fill, Text=Instructions(mouse,keyboard,controller), TextAlign=System.Drawing.ContentAlignment.MiddleCenter };
      // Dialed disables its main window during capture, so cancellation must be available here.
      // No keyboard shortcut, Escape included: every key belongs to the check.
      cancelButton.Click+=(sender,args)=>{ canceled=true; Close(); };
      Controls.Add(instructions); Controls.Add(feedback); Controls.Add(cancelButton);
      UpdateFeedback();
      // A background process cannot simply take the foreground, so ask for it explicitly and
      // only start the clock once this window actually holds it. Starting while Dialed still
      // owned the foreground is what made the check die on the reader's first click.
      Shown+=(sender,args)=>{
        // Dialed starts this process with the console hidden, and Windows applies that same
        // hide flag to the first top-level window the process creates - this one. WinForms
        // then reports Visible=true for a window Windows never draws, so the check ran
        // invisibly and every click went to whatever was behind it. SW_SHOWNORMAL undoes it.
        ShowWindow(Handle,1);
        Activate(); BringToFront(); SetForegroundWindow(Handle);
        for(int attempt=0; attempt<20 && GetForegroundWindow()!=Handle; attempt++) { Application.DoEvents(); System.Threading.Thread.Sleep(25); SetForegroundWindow(Handle); }
        if(GetForegroundWindow()!=Handle) { foregroundRefused=true; Close(); return; }
        clock.Restart(); started=true;
      };
      // Deactivation alone does not mean the reader switched away: Windows also reports it
      // while the foreground is changing hands, when no window owns it at all. Record who has
      // it and let the timer decide, so a momentary transition cannot end a valid check.
      Deactivate+=(sender,args)=>{ if(started && !completed) focusTaker=DescribeForeground(); };
      var list=new List<RawDevice>();
      // Read headers first; only exact selected-device payloads reach the decoder.
      // Foreground registration avoids Windows background raw-mouse throttling.
      foreach(ushort usage in new ushort[]{2,4,5,6}) list.Add(new RawDevice { page=1,usage=usage,flags=0x2000,target=Handle });
      if(!RegisterRawInputDevices(list.ToArray(),(uint)list.Count,(uint)Marshal.SizeOf(typeof(RawDevice)))) throw new Win32Exception(Marshal.GetLastWin32Error());
    }
    protected override void WndProc(ref Message m) {
      // WM_TIMER is low priority. Enforce the deadline on busy input streams too.
      if(m.Msg==0xff && started && !completed && clock.Elapsed.TotalSeconds>=8) {
        base.WndProc(ref m); completed=true; Close(); return;
      }
      if(m.Msg==0xfe && m.WParam==new IntPtr(2) && started && !completed) {
        if(selectedHandles.Contains(m.LParam)) { connectionLost=true; Close(); }
      }
      if(m.Msg==0xff && started && GetForegroundWindow()==Handle && sampleCount<100000) {
        uint size=(uint)(8+2*IntPtr.Size), count=size; IntPtr header=Marshal.AllocHGlobal((int)size);
        try {
          if(GetRawInputData(m.LParam,0x10000005,header,ref count,size)==size) {
            IntPtr device=Marshal.ReadIntPtr(header,8); string id=ResolveName(device);
            if(allowed.Contains(id)) {
              if(!selectedHandles.Contains(device)) { connectionLost=true; Close(); return; }
              List<double> list; if(!times.TryGetValue(id,out list)) { list=new List<double>(); times[id]=list; }
              double ms=clock.Elapsed.TotalMilliseconds; list.Add(ms); sampleCount++;
              ActivityTracker tracker;
              if(!activity.TryGetValue(id,out tracker)) { tracker=new ActivityTracker(); activity[id]=tracker; }
              int previousReports=tracker.Result.hidReports;
              bool moved=false;
              try { if(failedHandles.Contains(device)) tracker.Result.errors++; else moved=ReadControls(m.LParam,device,size,ms,tracker); }
              catch(Exception) { failedHandles.Add(device); tracker.Result.errors++; tracker.Result.reportErrors++; }
              if(moved) {
                List<double> motion; if(!motionTimes.TryGetValue(id,out motion)) { motion=new List<double>(); motionTimes[id]=motion; } motion.Add(ms);
              }
              reportCount+=tracker.Result.hidReports-previousReports;
              if(list.Count==1) firstHidReports[id]=tracker.Result.hidReports;
              if(sampleCount>=100000 || reportCount>=100000) Application.ExitThread();
            }
          }
        } finally { Marshal.FreeHGlobal(header); }
      }
      base.WndProc(ref m);
    }
    bool ReadControls(IntPtr input,IntPtr device,uint headerSize,double ms,ActivityTracker tracker) {
      uint bytes=0;
      if(GetRawInputData(input,0x10000003,IntPtr.Zero,ref bytes,headerSize)!=0 || bytes<headerSize || bytes>65536) { tracker.Result.errors++; tracker.Result.reportErrors++; return false; }
      IntPtr data=Marshal.AllocHGlobal((int)bytes);
      try {
        uint capacity=bytes;
        if(GetRawInputData(input,0x10000003,data,ref bytes,headerSize)!=capacity || bytes!=capacity || Marshal.ReadIntPtr(data,8)!=device || (uint)Marshal.ReadInt32(data,4)!=bytes) { tracker.Result.errors++; tracker.Result.reportErrors++; return false; }
        int type=Marshal.ReadInt32(data); var payload=new byte[bytes-headerSize];
        Marshal.Copy(IntPtr.Add(data,(int)headerSize),payload,0,payload.Length);
        return ControlPacket.Read(type,payload,ms,tracker,delegate(byte[] report) {
          HidActivityDecoder decoder;
          if(!decoders.TryGetValue(device,out decoder)) { decoder=new HidActivityDecoder(device); decoders[device]=decoder; }
          decoder.Read(report,ms,tracker);
        });
      } finally { Marshal.FreeHGlobal(data); }
    }
    void UpdateFeedback() {
      int buttons=0,keys=0,movement=0,axes=0,hats=0,decoded=0;
      foreach(var tracker in activity.Values) { var a=tracker.Result; buttons+=a.buttons; keys+=a.keys; movement+=a.movement; axes+=a.axes; hats+=a.hats; decoded+=a.decoded; }
      feedback.Text=String.Format("{0:0} seconds left  |  {1} Windows messages\r\nButtons {2}  |  Keys {3}  |  Mouse/wheel {4}  |  Axes {5}  |  D-pad {6}\r\n{7}",Math.Max(0,8-clock.Elapsed.TotalSeconds),sampleCount,buttons,keys,movement,axes,hats,decoded==0?"Waiting for supported control data...":"Control changes are separate from message rate.");
    }
    protected override void Dispose(bool disposing) {
      if(disposing) { foreach(var decoder in decoders.Values) decoder.Dispose(); decoders.Clear(); }
      base.Dispose(disposing);
    }
    public static EventChannel[] CaptureEvents(string[] ids) {
      using(var window=new TimingWindow(ids)) {
        // A real Windows message loop blocks between events instead of waking
        // every millisecond. The timer exists only to end this explicit test.
        using(var timer=new System.Windows.Forms.Timer()) {
          timer.Interval=50;
          timer.Tick+=(sender,args)=>{
            if(!window.started) return;
            // A null foreground means the foreground is in transition and belongs to nobody;
            // that is not the reader switching away. Only a window that is not ours, and
            // keeps the foreground across three ticks (about 150ms), ends the check. One
            // attempt is made to take it back first.
            IntPtr foreground=GetForegroundWindow();
            if(foreground==IntPtr.Zero || foreground==window.Handle) window.foreignTicks=0;
            else {
              window.foreignTicks++;
              if(window.foreignTicks==1) { window.focusTaker=DescribeForeground(); SetForegroundWindow(window.Handle); }
              if(window.foreignTicks>=3) { window.focusLost=true; window.Close(); return; }
            }
            window.UpdateFeedback();
            if(window.clock.Elapsed.TotalSeconds>=8) { window.completed=true; window.Close(); }
          };
          timer.Start();
          Application.Run(window);
          timer.Stop();
        }
        if(window.foregroundRefused) throw new InvalidOperationException("The check window could not come to the front, so nothing was measured. Minimize other windows and try again.");
        if(window.focusLost) throw new InvalidOperationException("The capture window lost focus, so the check stopped. "+(window.focusTaker.Length>0?"Focus went to "+window.focusTaker+". ":"")+"Close or quiet whatever took focus, then run the check again and keep the capture window in front.");
        if(window.connectionLost) throw new InvalidOperationException("An input connection was removed during the check. Rescan and try again; results were discarded.");
        if(window.canceled) throw new InvalidOperationException("Input check canceled. Results were discarded.");
        if(!window.completed) throw new InvalidOperationException("Input check canceled or sample limit reached. No cadence result was accepted.");
        var result=new List<EventChannel>(); foreach(var item in window.times) result.Add(new EventChannel { id=item.Key,keyboard=window.keyboardIds.Contains(item.Key),messageCount=item.Value.Count,spanMs=item.Value.Count>1?item.Value[item.Value.Count-1]-item.Value[0]:0,timesMs=window.keyboardIds.Contains(item.Key)?new double[0]:item.Value.ToArray(),motionTimesMs=window.motionTimes.ContainsKey(item.Key)?window.motionTimes[item.Key].ToArray():new double[0],activity=window.activity[item.Key].Result,hidReports=window.activity[item.Key].Result.hidReports,firstHidReports=window.firstHidReports[item.Key] }); return result.ToArray();
      }
    }
  }
}
