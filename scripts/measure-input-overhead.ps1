# Test-only observer A/B harness. Default compiles instrumentation without device access.
# RunApprovedCapture is a mechanical opt-in, not a substitute for the owner's authorization.
param(
  [switch]$RunApprovedCapture,
  [ValidateSet('HeaderOnly','Decode')][string]$Mode='Decode',
  [string]$DeviceId,
  [ValidateRange(125,8000)][int]$SavedRequestHz=4000
)
$ErrorActionPreference='Stop'
if ($PSVersionTable.PSEdition -ne 'Desktop' -or $PSVersionTable.PSVersion.Major -ne 5 -or $PSVersionTable.PSVersion.Minor -ne 1 -or -not [Environment]::Is64BitProcess) {
  throw 'Use Windows PowerShell 5.1 Desktop x64, the production collector runtime. No compilation, inventory or capture ran.'
}
$root=Split-Path $PSScriptRoot -Parent
$sourcePath=Join-Path $root 'src\main\input-devices\usb-native.cs'
$source=[IO.File]::ReadAllText($sourcePath)
$marker='    protected override void WndProc(ref Message m) {'
if (($source.Split(@($marker),[StringSplitOptions]::None)).Count -ne 2) { throw 'Collector instrumentation marker drifted.' }
$wrapper=@'
    public static bool BenchmarkHeaderOnly;
    public static readonly List<long> BenchmarkTicks=new List<long>(100000);
    protected override void WndProc(ref Message m) {
      long began=Stopwatch.GetTimestamp(); bool input=m.Msg==0xff;
      try { MeasuredWndProc(ref m); }
      finally { if(input && BenchmarkTicks.Count<100000) BenchmarkTicks.Add(Stopwatch.GetTimestamp()-began); }
    }
    void MeasuredWndProc(ref Message m) {
'@
$source=$source.Replace($marker,$wrapper)
$decodeMarker='if(failedHandles.Contains(device))'
if (($source.Split(@($decodeMarker),[StringSplitOptions]::None)).Count -ne 2) { throw 'Decode instrumentation marker drifted.' }
$source=$source.Replace($decodeMarker,'if(BenchmarkHeaderOnly) { } else if(failedHandles.Contains(device))')
$hashAlgorithm=[Security.Cryptography.SHA256]::Create()
try { $instrumentedSha256=([BitConverter]::ToString($hashAlgorithm.ComputeHash([Text.Encoding]::UTF8.GetBytes($source)))).Replace('-','').ToLowerInvariant() }
finally { $hashAlgorithm.Dispose() }
Add-Type -TypeDefinition $source -ReferencedAssemblies System.Windows.Forms,System.Drawing
if (-not $RunApprovedCapture) { Write-Output "PASS: test-only A/B collector compiled. No inventory or capture ran. Instrumented SHA256: $instrumentedSha256"; return }
if ($DeviceId -notmatch '^USB\\VID_[0-9A-F]{4}&PID_[0-9A-F]{4}\\[^\\]{1,240}$') { throw 'Specify the exact owner-approved physical USB instance; no default target.' }
$nodes=@([Dialed.Input.Devices]::Scan()); $map=@{}; foreach($node in $nodes) {$map[$node.id]=$node}
if (-not $map.ContainsKey($DeviceId)) { throw 'Selected device not present.' }
$ids=@($nodes | Where-Object {
  if ($_.inputKind -notin @('GAMEPAD','JOYSTICK')) { return $false }
  $current=$_.id; $seen=@{}
  for($depth=0;$depth -lt 32;$depth++) {
    if($current -eq $DeviceId) {return $true}
    if(-not $map.ContainsKey($current) -or $seen.ContainsKey($current)) {return $false}
    $seen[$current]=$true; $current=$map[$current].parent
  }
  return $false
} | ForEach-Object {$_.id})
if(-not $ids.Count) {throw 'No exact controller channel; keyboard/mouse benchmarks refused.'}
[AppDomain]::MonitoringIsEnabled=$true
[Dialed.Input.TimingWindow]::BenchmarkHeaderOnly=$Mode -eq 'HeaderOnly'
[Dialed.Input.TimingWindow]::BenchmarkTicks.Clear()
$allocated=[AppDomain]::CurrentDomain.MonitoringTotalAllocatedMemorySize
$gcBefore=@([GC]::CollectionCount(0),[GC]::CollectionCount(1),[GC]::CollectionCount(2))
$cpuBefore=[Diagnostics.Process]::GetCurrentProcess().TotalProcessorTime.TotalMilliseconds
$elapsed=[Diagnostics.Stopwatch]::StartNew()
$channels=@([Dialed.Input.TimingWindow]::CaptureEvents([string[]]$ids))
$elapsed.Stop()
$cpuAfter=[Diagnostics.Process]::GetCurrentProcess().TotalProcessorTime.TotalMilliseconds
$allocatedAfter=[AppDomain]::CurrentDomain.MonitoringTotalAllocatedMemorySize
$gcAfter=@([GC]::CollectionCount(0),[GC]::CollectionCount(1),[GC]::CollectionCount(2))
$warmupExcluded=[Math]::Min(500,[Dialed.Input.TimingWindow]::BenchmarkTicks.Count)
$ticks=@([Dialed.Input.TimingWindow]::BenchmarkTicks | Select-Object -Skip 500 | Sort-Object)
$frequency=[double][Diagnostics.Stopwatch]::Frequency
$summary=@($channels | ForEach-Object {
  $times=$_.timesMs; $longGaps=0
  for($i=1;$i -lt $times.Length;$i++) {if($times[$i]-$times[$i-1] -gt 3000.0/$SavedRequestHz) {$longGaps++}}
  @{messageCount=$_.messageCount;spanMs=$_.spanMs;messageHz=if($_.spanMs -gt 0){1000*($_.messageCount-1)/$_.spanMs}else{$null};receivedReports=if($Mode -eq 'Decode'){$_.hidReports}else{$null};longGaps=$longGaps}
})
@{mode=$Mode;sourceSha256=(Get-FileHash -LiteralPath $sourcePath -Algorithm SHA256).Hash;instrumentedSourceSha256=$instrumentedSha256;processorCount=[Environment]::ProcessorCount;osVersion=[Environment]::OSVersion.VersionString;runtime=[Environment]::Version.ToString();savedRequestHz=$SavedRequestHz;elapsedMs=$elapsed.Elapsed.TotalMilliseconds;cpuOneCorePercent=100*($cpuAfter-$cpuBefore)/$elapsed.Elapsed.TotalMilliseconds;allocatedBytesApproximate=($allocatedAfter-$allocated);gcDelta=@(($gcAfter[0]-$gcBefore[0]),($gcAfter[1]-$gcBefore[1]),($gcAfter[2]-$gcBefore[2]));warmupMessagesExcludedFromHandlerStatistics=$warmupExcluded;wndProc=if($ticks.Count){@{samples=$ticks.Count;p50Us=1000000*$ticks[[int][Math]::Floor($ticks.Count*0.5)]/$frequency;p99Us=1000000*$ticks[[int][Math]::Min($ticks.Count-1,[Math]::Floor($ticks.Count*0.99))]/$frequency;maxUs=1000000*$ticks[-1]/$frequency}}else{$null};channels=$summary;limitations='Instrumented observer, not USB trace. First 500 handler timings excluded; CPU/GC/cadence include warm-up. Allocation bytes approximate and may lag GC. HeaderOnly has no report count; compare messageHz across modes. No raw reports, identities or per-message timestamps exported.'} | ConvertTo-Json -Depth 5
