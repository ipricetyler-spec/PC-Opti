import { ErrorText } from './ErrorText';
import { Activity, ArrowRight, CheckCircle2, ClipboardCheck, History, LoaderCircle, Play, Search, Signal, ShieldAlert, SlidersHorizontal, Square, Wifi, XCircle } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { NetworkProbeEndpoint, NetworkProbeProgress, NetworkProbeResult, NetworkQualityHistoryState, SystemScanSnapshot, WifiStatusReport } from '../types';
import { plainLabel } from '../lib/plainLabels';
import { TabPanel, TabRow } from './TabRow';
import { NETWORK_CONTEXT_KEY, parseNetworkContexts, compareNetworkRuns, type NetworkRunContext } from '../lib/networkComparison';

interface NetworkQualityLabProps {
  snapshot: SystemScanSnapshot | null;
  onOpenScan: () => void;
}

interface AdapterItem {
  name: string;
  interfaceDescription: string;
  status: string;
  linkSpeed: string;
}

function SavedNetworkComparison({ history }: { history: NetworkQualityHistoryState }) {
  const [initial] = useState(() => { try { return { values: parseNetworkContexts(localStorage.getItem(NETWORK_CONTEXT_KEY)), error: '' }; } catch { return { values: {} as Record<string, NetworkRunContext>, error: 'Saved condition notes could not be read. They were preserved; new saves are disabled.' }; } });
  const [contexts, setContexts] = useState(initial.values);
  const [first, setFirst] = useState('');
  const [second, setSecond] = useState('');
  const [message, setMessage] = useState(initial.error);
  const [dirty, setDirty] = useState(false);
  const result = compareNetworkRuns(history.entries.find((entry) => entry.id === first), history.entries.find((entry) => entry.id === second), contexts);
  const save = () => {
    if (initial.error || history.status !== 'READY') return;
    try {
      const retained = Object.fromEntries(history.entries.slice(0,20).filter((entry) => contexts[entry.id]).map((entry) => [entry.id, contexts[entry.id]]));
      const raw = JSON.stringify(retained); parseNetworkContexts(raw); localStorage.setItem(NETWORK_CONTEXT_KEY,raw); setContexts(retained); setDirty(false); setMessage('Notes saved.');
    } catch { setMessage('Condition notes could not be saved. Previously saved notes were preserved.'); }
  };
  return <div className="mt-4 space-y-3 rounded-xl border border-slate-700 p-3">
    <h4 className="text-sm font-semibold">Compare two saved tests</h4>
    <p className="text-xs text-slate-400">Pick a before and an after test, and note the connection, VPN and anything downloading for each. This shows your connection in general, not the route to a particular game server.</p>
    <div className="grid gap-3 md:grid-cols-2">{([['Before',first,setFirst],['After',second,setSecond]] as const).map(([label,id,setId]) => <div key={label} className="space-y-2">
      <label className="block text-xs">{label}<select className="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-2" value={id} onChange={(event) => setId(event.target.value)}><option value="">Choose a test</option>{history.entries.map((entry) => <option key={entry.id} value={entry.id}>{new Date(entry.completedAt).toLocaleString()} · {entry.mode} · {entry.quality} · {entry.status}</option>)}</select></label>
      {id && (['adapter','vpn','background'] as const).map((key) => <label key={key} className="block text-xs">{label} · {key === 'adapter' ? 'Connection (Wi-Fi or cable)' : key === 'vpn' ? 'VPN (or none)' : 'Anything downloading'}<input disabled={!!initial.error} maxLength={240} className="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-2" value={contexts[id]?.[key] || ''} onChange={(event) => { setContexts((current) => ({...current,[id]:{...(current[id] || {adapter:'',vpn:'',background:''}),[key]:event.target.value}})); setDirty(true); }} /></label>)}
    </div>)}</div>
    <button disabled={!dirty || !!initial.error || history.status !== 'READY'} onClick={save} className="rounded border border-cyan-400/30 px-3 py-2 text-xs text-cyan-200 disabled:opacity-40">Save notes</button>
    <p role="status" className="text-xs text-slate-400">{dirty ? 'Save the notes before comparing.' : result.issue || 'Differences below are after minus before.'}</p>
    {!dirty && result.deltas && <dl className="grid grid-cols-2 gap-2 text-xs">{Object.entries(result.deltas).map(([key,value]) => <div key={key}><dt>{{idleMs: 'Response time (ms)',downloadLoadedMs: 'During download (ms)',uploadLoadedMs: 'During upload (ms)',downloadMbps: 'Download (Mbps)',uploadMbps: 'Upload (Mbps)'}[key]}</dt><dd>{value === null ? 'Unavailable' : `${value > 0 ? '+' : ''}${value.toFixed(2)}`}</dd></div>)}</dl>}
    {message && <p role="status" className="text-xs text-amber-200">{message}</p>}
  </div>;
}

function linkSpeedBitsPerSecond(value: string) {
  const match = /([\d.]+)\s*([kmgt]?)bps/i.exec(value || '');
  if (!match) return -1;
  const scale: Record<string, number> = { '': 1, k: 1e3, m: 1e6, g: 1e9, t: 1e12 };
  return Number(match[1]) * scale[match[2].toLowerCase()];
}

type WifiInterface = WifiStatusReport['interfaces'][number];

function wifiAdvice(item: WifiInterface) {
  if (item.signalQuality === 'WEAK' || item.signalQuality === 'FAIR') return 'Signal is weak enough to cause lag spikes. Move closer to the router, reduce obstacles, or use Ethernet for games.';
  if (/2\.4/.test(item.band || '')) return '2.4 GHz is slower and more crowded. If your router offers 5 GHz or 6 GHz and the signal there is good, that band usually gives lower latency.';
  if (item.signalQuality === 'UNKNOWN') return 'Windows did not report signal strength for this interface.';
  return 'Signal looks healthy. Ethernet is still the most consistent choice for competitive games.';
}

function WifiLinkCard() {
  const [report, setReport] = useState<WifiStatusReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const read = async () => {
    if (!window.pcOptiNative?.readWifiStatus) { setError('Wi-Fi details are available in the Dialed desktop app.'); return; }
    setBusy(true);
    setError(null);
    try { setReport(await window.pcOptiNative.readWifiStatus()); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Wi-Fi details could not be read.'); }
    finally { setBusy(false); }
  };
  return <section aria-label="Wi-Fi signal and band" className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h3 className="text-sm font-semibold text-slate-100">Wi-Fi signal and band</h3><p className="mt-1 max-w-2xl text-xs leading-relaxed text-slate-400">Signal strength, band and channel from Windows. Your network name is not read.</p></div>
      <button type="button" onClick={() => void read()} disabled={busy} className="inline-flex items-center gap-2 rounded-lg border border-cyan-400/30 bg-cyan-400/10 px-3 py-2 text-xs font-semibold text-cyan-200 disabled:opacity-50">{busy ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Wifi className="h-3.5 w-3.5" />}{report ? 'Check again' : 'Check Wi-Fi'}</button>
    </div>
    {error && <p role="alert" className="mt-3 text-xs text-amber-200"><ErrorText text={error} /></p>}
    {report && report.status !== 'AVAILABLE' && <p role="status" className="mt-3 text-xs text-slate-400">{report.reason}</p>}
    {report?.interfaces.map((item) => <article key={item.name} className="mt-3 rounded-xl border border-slate-700 bg-slate-950/40 p-4">
      <p className="text-sm font-semibold text-slate-100">{item.name} · {item.state || 'state unknown'}</p>
      <dl className="mt-2 grid gap-2 text-xs text-slate-300 sm:grid-cols-2 lg:grid-cols-4">
        <div><dt className="text-slate-500">Signal</dt><dd>{item.signalPercent === null ? 'Unknown' : `${item.signalPercent}% · ${plainLabel(item.signalQuality)}`}</dd></div>
        <div><dt className="text-slate-500">Band</dt><dd>{item.band || 'Unknown'}</dd></div>
        <div><dt className="text-slate-500">Channel</dt><dd>{item.channel ?? 'Unknown'}</dd></div>
        <div><dt className="text-slate-500">Link rate</dt><dd>{item.receiveRateMbps === null ? 'Unknown' : `${item.receiveRateMbps} down / ${item.transmitRateMbps ?? '?'} up Mbps`}</dd></div>
      </dl>
      <p className="mt-2 text-[11px] leading-relaxed text-slate-400">{wifiAdvice(item)}</p>
    </article>)}
  </section>;
}

function normalizeStatus(value: string) {
  const normalized = value.toLowerCase();
  if (normalized.includes('down') || normalized.includes('disconnected')) return 'Disconnected';
  if (normalized === 'up' || normalized.includes('connected')) return 'Online';
  return 'Unknown';
}

export function NetworkQualityLab({ snapshot, onOpenScan }: NetworkQualityLabProps) {
  const adapters: AdapterItem[] = snapshot?.diagnostics.networkAdapters.status === 'AVAILABLE'
    ? snapshot.diagnostics.networkAdapters.value
    : [];
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'All' | 'Online' | 'Disconnected' | 'Unknown'>('All');
  const [sortMode, setSortMode] = useState<'status' | 'name' | 'speed'>('status');
  const [copyMessage, setCopyMessage] = useState<string | null>(null);
  const [probeEndpoints, setProbeEndpoints] = useState<NetworkProbeEndpoint[]>([]);
  const [probeMode, setProbeMode] = useState<'quick' | 'full'>('quick');
  const [probeConsent, setProbeConsent] = useState(false);
  const [probeRunning, setProbeRunning] = useState(false);
  const [probeStartedAt, setProbeStartedAt] = useState<number | null>(null);
  const [probeElapsedSeconds, setProbeElapsedSeconds] = useState(0);
  const [probeProgress, setProbeProgress] = useState<NetworkProbeProgress | null>(null);
  const [probeResult, setProbeResult] = useState<NetworkProbeResult | null>(null);
  const [probeHistory, setProbeHistory] = useState<NetworkQualityHistoryState>({ status: 'READY', entries: [] });
  const [probeError, setProbeError] = useState<string | null>(null);
  const [view, setView] = useState<'connection' | 'adapters'>('connection');

  useEffect(() => {
    if (!window.pcOptiNative) return;
    void Promise.all([
      window.pcOptiNative.getNetworkProbeInfo(),
      window.pcOptiNative.listNetworkQualityHistory(),
    ])
      .then(([endpoints, history]) => { setProbeEndpoints(endpoints); setProbeHistory(history); })
      .catch((error) => setProbeError(error instanceof Error ? error.message : 'The bounded probe privacy preview is unavailable.'));
  }, []);

  useEffect(() => {
    if (probeStartedAt === null) return;
    const updateElapsed = () => setProbeElapsedSeconds(Math.max(0, Math.floor((Date.now() - probeStartedAt) / 1000)));
    updateElapsed();
    const timer = window.setInterval(updateElapsed, 250);
    return () => window.clearInterval(timer);
  }, [probeStartedAt]);

  useEffect(() => {
    const native = window.pcOptiNative;
    if (!probeRunning || !native) return;
    const refresh = () => { void native.getNetworkProbeProgress().then(setProbeProgress).catch(() => undefined); };
    refresh();
    const timer = window.setInterval(refresh, 400);
    return () => window.clearInterval(timer);
  }, [probeRunning]);

  const probeEndpoint = probeEndpoints.find((entry) => entry.mode === probeMode) || null;

  const normalizedQuery = query.trim().toLowerCase();

  const adaptersView = useMemo(() => {
    const filtered = adapters.filter((item) => {
      const state = normalizeStatus(item.status);
      const matchesState = statusFilter === 'All' || state === statusFilter;
      const matchesQuery = !normalizedQuery
        || item.name.toLowerCase().includes(normalizedQuery)
        || item.interfaceDescription.toLowerCase().includes(normalizedQuery)
        || item.linkSpeed.toLowerCase().includes(normalizedQuery);
      return matchesState && matchesQuery;
    });
    const ordered = [...filtered];
    ordered.sort((left, right) => {
      if (sortMode === 'name') return left.name.localeCompare(right.name);
      if (sortMode === 'speed') return linkSpeedBitsPerSecond(right.linkSpeed) - linkSpeedBitsPerSecond(left.linkSpeed);
      const rank = (item: AdapterItem) => {
        const state = normalizeStatus(item.status);
        if (state === 'Online') return 0;
        if (state === 'Disconnected') return 1;
        return 2;
      };
      return rank(left) - rank(right);
    });
    return ordered;
  }, [adapters, normalizedQuery, sortMode, statusFilter]);

  const onlineCount = adapters.filter((item) => normalizeStatus(item.status) === 'Online').length;
  const disconnectedCount = adapters.filter((item) => normalizeStatus(item.status) === 'Disconnected').length;
  const unknownCount = adapters.filter((item) => normalizeStatus(item.status) === 'Unknown').length;

  const summaryText = `Network adapters: ${snapshot ? `${adapters.length} total · ${onlineCount} online · ${disconnectedCount} disconnected · ${unknownCount} unknown` : 'no scan yet'}`;

  const copySummary = async () => {
    try {
      await navigator.clipboard.writeText(summaryText);
      setCopyMessage('Network summary copied.');
    } catch {
      setCopyMessage('Clipboard blocked. Read the summary text above.');
    }
  };

  const runProbe = async () => {
    if (!window.pcOptiNative || !probeConsent || probeRunning) return;
    setProbeRunning(true);
    setProbeStartedAt(Date.now());
    setProbeElapsedSeconds(0);
    setProbeResult(null);
    setProbeProgress(null);
    setProbeError(null);
    try {
      const preview = await window.pcOptiNative.previewNetworkQualityProbe(probeMode);
      const result = await window.pcOptiNative.runNetworkQualityProbe(preview.token);
      setProbeResult(result);
      if (result.history) setProbeHistory(result.history);
      else if (result.persistence?.saved) setProbeHistory(await window.pcOptiNative.listNetworkQualityHistory());
    } catch (error) {
      setProbeError(error instanceof Error ? error.message : 'The bounded network probe could not complete.');
    } finally {
      setProbeRunning(false);
      setProbeStartedAt(null);
    }
  };

  const cancelProbe = async () => {
    if (!window.pcOptiNative || !probeRunning) return;
    await window.pcOptiNative.cancelNetworkQualityProbe();
  };

  const graphData = [...probeHistory.entries].filter((entry) => entry.methodVersion === 'warmed-https-v2').reverse().map((entry) => ({
    label: new Date(entry.completedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
    idle: entry.metrics.idleLatencyMs,
    loaded: entry.metrics.downloadLoadedLatencyMs,
    download: entry.metrics.downloadMbps,
    upload: entry.metrics.uploadMbps,
  }));

  const probeFailures = useMemo(() => {
    if (!probeResult) return [];
    const candidates = [
      ...probeResult.idleSamples.map((sample) => ({ label: `Idle request #${sample.index}`, error: sample.error })),
      ...probeResult.downloadLoadedSamples.map((sample) => ({ label: `Download-loaded request #${sample.index}`, error: sample.error })),
      ...probeResult.uploadLoadedSamples.map((sample) => ({ label: `Upload-loaded request #${sample.index}`, error: sample.error })),
      { label: 'Download sample', error: probeResult.download.error },
      { label: 'Upload sample', error: probeResult.upload.error },
    ];
    const seen = new Set<string>();
    return candidates.flatMap((item) => {
      const message = item.error?.trim();
      if (!message || seen.has(message)) return [];
      seen.add(message);
      return [`${item.label}: ${message}`];
    }).slice(0, 5);
  }, [probeResult]);

  const activeWireless = adapters.some((adapter) => normalizeStatus(adapter.status) === 'Online' && /wi-?fi|wireless|802\.11/i.test(`${adapter.name} ${adapter.interfaceDescription}`));
  const guidance = [
    activeWireless ? 'You are on Wi-Fi. If you can, repeat the test on a cable to compare.' : 'Keep the connection, VPN and downloads the same when comparing tests.',
    probeResult?.metrics.downloadLoadedLatencyIncreaseMs !== null && probeResult?.metrics.downloadLoadedLatencyIncreaseMs !== undefined && probeResult.metrics.downloadLoadedLatencyIncreaseMs > 30
      ? 'Your connection slowed by more than 30 ms while busy. Pause big downloads and test again; if it keeps happening, look at your router\'s QoS or SQM settings.'
      : 'Run a few tests at similar times before trusting one result.',
    probeResult && probeResult.metrics.failedSamples > 0
      ? 'A request failed. Check that websites load (some Wi-Fi needs a sign-in page). If they do, the test server may be unreachable; try once more.'
      : 'A good result here does not rule out problems with one game\'s servers; check the game\'s own network stats too.',
  ];

  return <div className="space-y-6">
    <TabRow<typeof view> ariaLabel="Network categories" items={([['connection', 'Connection Test'], ['adapters', 'Adapter Details']] as const).map(([id, label]) => ({ id, label }))} value={view} onChange={setView} />
    <TabPanel ariaLabel="Network categories" value={view}>
    <section className={`rounded-2xl border border-slate-800 bg-slate-900/70 p-6 ${view === 'adapters' ? '' : 'hidden'}`}>
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-start">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-1 text-[11px] font-semibold text-cyan-300"><Signal className="h-3.5 w-3.5" /> Adapter details</div>
          <h2 className="mt-3 text-2xl font-bold text-white">Your network adapters</h2>
          <p className="mt-1 text-sm text-slate-400">Which adapters are connected and at what speed. This does not test your internet, and Dialed never changes adapter settings.</p>
        </div>
        <button onClick={onOpenScan} className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-3.5 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-700">
          <ArrowRight className="h-3.5 w-3.5" />
          Open Scan
        </button>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Metric title="Adapters" value={`${snapshot ? adapters.length : 0}`} detail={snapshot ? 'As reported by Windows' : 'Not scanned yet'} tone="neutral" />
        <Metric title="Online" value={`${snapshot ? onlineCount : 0}`} detail="Connected now" tone={onlineCount > 0 ? 'good' : 'warn'} />
        <Metric title="Disconnected" value={`${snapshot ? disconnectedCount : 0}`} detail="Present but not connected" tone={disconnectedCount > 0 ? 'warn' : 'good'} />
        <Metric title="Unknown" value={`${snapshot ? unknownCount : 0}`} detail="Windows did not say" tone="warn" />
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <label className="block w-56 text-[11px] font-medium text-slate-400">
          <span className="mb-1 block"><Search className="mr-1 inline h-3.5 w-3.5" />Find adapter</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-200 outline-none focus:border-violet-400" placeholder="Search adapters" />
        </label>
        <label className="block w-44 text-[11px] font-medium text-slate-400">
          <span className="mb-1 block">State</span>
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as 'All' | 'Online' | 'Disconnected' | 'Unknown')} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-200 outline-none focus:border-violet-400">
            <option value="All">All</option>
            <option value="Online">Online</option>
            <option value="Disconnected">Disconnected</option>
            <option value="Unknown">Unknown</option>
          </select>
        </label>
        <label className="block w-40 text-[11px] font-medium text-slate-400">
          <span className="mb-1 block">Sort</span>
          <select value={sortMode} onChange={(event) => setSortMode(event.target.value as 'status' | 'name' | 'speed')} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-200 outline-none focus:border-violet-400">
            <option value="status">Status</option>
            <option value="name">Name</option>
            <option value="speed">Speed</option>
          </select>
        </label>
        <button onClick={copySummary} className="mt-6 inline-flex items-center gap-1.5 rounded-lg border border-violet-400/30 bg-violet-400/10 px-3 py-2 text-[11px] font-semibold text-violet-200"><ClipboardCheck className="h-3.5 w-3.5" />Copy view</button>
        <button onClick={() => { setQuery(''); setStatusFilter('All'); setSortMode('status'); }} className="mt-6 inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-2 text-[11px] font-semibold text-slate-300"><SlidersHorizontal className="h-3.5 w-3.5" />Reset</button>
      </div>
      <p className="mt-2 text-[11px] text-slate-400">{adaptersView.length} adapters visible of {adapters.length} total</p>
      {copyMessage && <p className="mt-2 rounded-lg border border-violet-500/25 bg-violet-950/30 p-2 text-[11px] text-violet-200/90">{copyMessage}</p>}
      <div className="mt-4 rounded-lg border border-amber-500/20 bg-amber-950/10 p-3 text-xs text-amber-100/80">
        <ShieldAlert className="mr-1 inline h-3.5 w-3.5 text-amber-300" />
        Adapter state does not measure latency, jitter, packet loss, DNS quality, or route health. Dialed makes no network-improvement claim from this inventory.
      </div>
    </section>

    <section className={`rounded-2xl border border-cyan-500/20 bg-gradient-to-br from-slate-900 via-slate-900 to-cyan-950/20 p-5 ${view === 'connection' ? '' : 'hidden'}`}>
      <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
        <div className="max-w-3xl"><p className="text-xs font-semibold uppercase tracking-wider text-cyan-300">Connection test</p><h3 className="mt-1 text-lg font-bold text-white">How responsive and fast is your connection?</h3><p className="mt-2 text-xs leading-relaxed text-slate-400">The quick check is light; the full test measures your top speed. Both also measure how much slower your connection responds while it is busy downloading or uploading, which is what causes lag spikes. Neither is a game ping.</p><p className="mt-2 text-xs leading-relaxed text-slate-500">{probeEndpoint?.privacy || (probeError || !window.pcOptiNative ? 'Could not load the test details, so the test cannot start.' : 'Loading…')}</p></div>
        <div className="flex shrink-0 gap-2">
          {probeRunning ? <button type="button" onClick={cancelProbe} className="inline-flex items-center gap-2 rounded-lg border border-rose-400/30 bg-rose-400/10 px-3 py-2 text-xs font-semibold text-rose-200"><XCircle className="h-4 w-4" />Cancel</button> : null}
          <button type="button" onClick={runProbe} disabled={!probeConsent || !probeEndpoint || probeRunning || !window.pcOptiNative} className="inline-flex items-center gap-2 rounded-lg bg-cyan-400 px-4 py-2 text-xs font-black text-slate-950 disabled:opacity-40">{probeRunning ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4 fill-current" />}{probeRunning ? 'Testing…' : probeMode === 'full' ? 'Start full speed test' : 'Start quick check'}</button>
        </div>
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">{probeEndpoints.map((entry) => <button key={entry.mode} type="button" aria-pressed={probeMode === entry.mode} disabled={probeRunning} onClick={() => { setProbeMode(entry.mode); setProbeConsent(false); }} className={`rounded-lg border p-3 text-left text-xs ${probeMode === entry.mode ? 'border-cyan-400/50 bg-cyan-500/10 text-cyan-100' : 'border-slate-700 bg-slate-950/40 text-slate-300'}`}><span className="font-semibold">{entry.title}</span><span className="mt-1 block text-[11px] text-slate-400">Up to {(entry.maximumTotalBytes / (1024 * 1024)).toFixed(1)} MiB · {entry.maximumParallelConnections} connection{entry.maximumParallelConnections === 1 ? '' : 's'} · {entry.maximumDurationSeconds}s limit</span></button>)}</div>
      <label className="mt-3 flex cursor-pointer items-start gap-2 rounded-lg border border-slate-700 bg-slate-950/40 p-3 text-xs leading-relaxed text-slate-300"><input type="checkbox" checked={probeConsent} onChange={(event) => setProbeConsent(event.target.checked)} disabled={probeRunning} className="mt-0.5 h-4 w-4 accent-cyan-400" /><span>I understand that this run contacts <strong className="text-slate-100">speed.cloudflare.com</strong>, transfers at most <strong className="text-slate-100">{probeEndpoint ? (probeEndpoint.maximumTotalBytes / (1024 * 1024)).toFixed(1) : '—'} MiB</strong>, may use up to {probeEndpoint?.maximumParallelConnections ?? '—'} connection(s), and exposes my public IP and ordinary HTTPS metadata to that service.</span></label>
      <div className="mt-3 flex gap-2 rounded-lg border border-amber-500/20 bg-amber-950/10 p-3 text-xs leading-relaxed text-amber-100/80"><ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" /><span>A short sample, not your plan's rated speed or a game-server ping. Dialed never changes network settings.<span className="mt-1 block text-amber-100/60">Tests only run when you start them.</span></span></div>
      {probeRunning ? <div role="status" aria-live="polite" className="mt-3 flex items-start gap-2 rounded-lg border border-cyan-400/30 bg-cyan-400/10 p-3 text-xs text-cyan-100"><LoaderCircle className="mt-0.5 h-4 w-4 shrink-0 animate-spin" /><div className="w-full"><p className="font-semibold">{probeMode === 'full' ? 'Full speed test' : 'Quick check'} · {probeElapsedSeconds}s elapsed · step {probeProgress?.completedSteps ?? 0}/{probeProgress?.totalSteps ?? 6}</p><p className="mt-1 text-slate-300">{probeProgress?.message || 'Starting…'}</p><div className="mt-2 h-1.5 overflow-hidden rounded bg-slate-800"><div className="h-full bg-cyan-300" style={{ width: `${Math.min(100, ((probeProgress?.completedSteps ?? 0) / (probeProgress?.totalSteps || 6)) * 100)}%` }} /></div></div></div> : null}
      {probeError ? <p role="alert" className="mt-3 rounded-lg border border-rose-500/25 bg-rose-950/20 p-3 text-xs text-rose-200"><ErrorText text={probeError} /></p> : null}
      {probeResult ? <div className="mt-4">
        <div role="status" className={`mb-4 flex items-start gap-2 rounded-lg border p-3 text-xs ${probeResult.status === 'COMPLETE' ? 'border-emerald-500/30 bg-emerald-950/20 text-emerald-100' : probeResult.status === 'CANCELED' ? 'border-slate-700 bg-slate-950/40 text-slate-300' : 'border-amber-500/30 bg-amber-950/20 text-amber-100'}`}>
          {probeResult.status === 'COMPLETE' ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : probeResult.status === 'CANCELED' ? <XCircle className="mt-0.5 h-4 w-4 shrink-0" /> : <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />}
          <div><p className="font-semibold">{probeResult.status === 'COMPLETE' ? 'Test finished' : probeResult.status === 'PARTIAL' ? 'Test finished, but some parts failed' : probeResult.status === 'OFFLINE' ? 'Could not reach the test server' : 'Test canceled'}</p><p className="mt-1 opacity-80">Finished in {Math.max(0.1, (new Date(probeResult.completedAt).getTime() - new Date(probeResult.startedAt).getTime()) / 1000).toFixed(1)} seconds. {probeResult.status === 'OFFLINE' ? 'Nothing could be measured. The reason is below.' : probeResult.status === 'PARTIAL' ? 'What could be measured is shown below.' : probeResult.status === 'COMPLETE' ? 'Saved, so you can compare it with later tests.' : 'Canceled tests are not saved.'}</p></div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs font-semibold text-slate-100">Latest result · {probeResult.status.replaceAll('_', ' ')}</p><p className="text-[11px] text-slate-500">{new Date(probeResult.completedAt).toLocaleString()}</p></div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <Metric title="Response time" value={formatMetric(probeResult.metrics.idleLatencyMs, 'ms')} detail={`Median of ${probeResult.metrics.successfulSamples}/${probeResult.metrics.expectedSamples}; p90 ${formatMetric(probeResult.metrics.idleP90Ms, 'ms')}`} tone={probeResult.metrics.idleLatencyMs === null ? 'warn' : 'neutral'} />
          <Metric title="Variability" value={formatMetric(probeResult.metrics.idleVariabilityMs, 'ms')} detail="p90 minus p10 warmed HTTPS response time" tone={probeResult.metrics.idleVariabilityMs === null ? 'warn' : 'neutral'} />
          <Metric title="While downloading" value={formatMetric(probeResult.metrics.downloadLoadedLatencyMs, 'ms')} detail={probeResult.metrics.downloadLoadedLatencyIncreaseMs === null ? 'Not enough data' : `${signed(probeResult.metrics.downloadLoadedLatencyIncreaseMs)} ms versus warmed idle`} tone={probeResult.loadQuality.download.status === 'SUFFICIENT' ? 'neutral' : 'warn'} />
          <Metric title="During upload" value={formatMetric(probeResult.metrics.uploadLoadedLatencyMs, 'ms')} detail={probeResult.metrics.uploadLoadedLatencyIncreaseMs === null ? 'Not enough data' : `${signed(probeResult.metrics.uploadLoadedLatencyIncreaseMs)} ms versus warmed idle`} tone={probeResult.loadQuality.upload.status === 'SUFFICIENT' ? 'neutral' : 'warn'} />
          <Metric title="Download" value={formatMetric(probeResult.metrics.downloadMbps, 'Mbps')} detail={`${(probeResult.runConditions.downloadBytes / (1024 * 1024)).toFixed(1)} MiB transferred · ${probeResult.quality.toLowerCase()} timing evidence`} tone={probeResult.download.success ? 'neutral' : 'warn'} />
          <Metric title="Upload" value={formatMetric(probeResult.metrics.uploadMbps, 'Mbps')} detail={`${(probeResult.runConditions.uploadBytes / (1024 * 1024)).toFixed(1)} MiB test upload · max ${probeResult.runConditions.maximumParallelConnections} connection(s)`} tone={probeResult.upload.success ? 'neutral' : 'warn'} />
        </div>
        <p className="mt-3 text-[11px] text-slate-400">Request failures: {probeResult.metrics.requestFailurePercent.toFixed(0)}% ({probeResult.metrics.failedSamples}/{probeResult.metrics.expectedSamples}). This is not packet loss.</p>
        <div data-technical-detail className="mt-3 grid gap-3 md:grid-cols-2">
          <SampleStrip title="Idle requests" samples={probeResult.idleSamples} />
          <SampleStrip title="Measured while downloading" samples={probeResult.downloadLoadedSamples} />
          <SampleStrip title="Measured while uploading" samples={probeResult.uploadLoadedSamples} />
        </div>
        {probeFailures.length > 0 ? <div className="mt-3 rounded-lg border border-rose-500/25 bg-rose-950/15 p-3"><p className="text-xs font-semibold text-rose-200">What failed</p><ul className="mt-2 space-y-1 text-[11px] leading-relaxed text-rose-100/80">{probeFailures.map((reason) => <li key={reason}>• {reason}</li>)}</ul></div> : null}
        <p className={`mt-3 rounded-lg border p-2 text-[11px] ${probeResult.persistence?.saved ? 'border-emerald-500/20 bg-emerald-950/10 text-emerald-200' : 'border-amber-500/20 bg-amber-950/10 text-amber-200'}`}>{probeResult.persistence?.saved ? 'Saved for comparison (the results only).' : probeResult.persistence?.reason || 'This result was not added to local history.'}</p>
        <p data-technical-detail className="mt-3 text-[11px] leading-relaxed text-slate-500">{probeResult.limitations}</p>
      </div> : null}
    </section>

    <section className={view === 'connection' ? 'grid gap-4 lg:grid-cols-[0.8fr_1.2fr]' : 'hidden'}>
      <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
        <div className="flex items-center gap-2"><Activity className="h-4 w-4 text-violet-300" /><h3 className="text-sm font-semibold text-slate-100">What to try next</h3></div>
        <div className="mt-3 space-y-2">{guidance.map((item) => <p key={item} className="rounded-lg border border-slate-700 bg-slate-950/40 p-3 text-[11px] leading-relaxed text-slate-300">{item}</p>)}</div>
        <p className="mt-3 text-[11px] leading-relaxed text-slate-500">Things to compare yourself. There is no one network setting that fixes lag for everyone.</p>
        <details className="mt-3 rounded-lg border border-slate-700 p-3 text-xs text-slate-300">
          <summary className="cursor-pointer font-semibold">A simple way to test</summary>
          <ol className="mt-3 list-decimal space-y-2 pl-5 leading-relaxed">
            <li>Run a test and note how you are connected.</li>
            <li>Change one thing, such as pausing downloads or switching to a cable, and test again.</li>
            <li>Repeat each a few times. A slowdown above 30 ms while busy is worth looking into.</li>
            <li>If only one game lags, check its own network stats and server status.</li>
            <li>If every app lags, take your saved results to your internet provider.</li>
          </ol>
          <p className="mt-3 text-slate-400">Every test uses the same Cloudflare server, so results are comparable with each other. They cannot tell whether a slowdown comes from Wi-Fi, your router or your provider.</p>
        </details>
      </div>
      <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2"><div className="flex items-center gap-2"><History className="h-4 w-4 text-cyan-300" /><h3 className="text-sm font-semibold text-slate-100">Saved tests</h3></div><p className="text-[11px] text-slate-500">Latest {probeHistory.entries.length} of 20 retained</p></div>
        <SavedNetworkComparison history={probeHistory} />
        {probeHistory.status === 'CORRUPT' ? <p role="alert" className="mt-3 rounded-lg border border-rose-500/25 bg-rose-950/20 p-3 text-xs text-rose-200">Saved tests could not be read: {probeHistory.error}</p> : graphData.length > 0 ? <div className="mt-4 h-64" aria-label="Network quality history chart">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={graphData} margin={{ top: 6, right: 8, bottom: 0, left: -18 }}>
              <CartesianGrid stroke="var(--app-border-strong)" strokeDasharray="3 3" />
              <XAxis dataKey="label" tick={{ fill: 'var(--app-muted)', fontSize: 11 }} />
              <YAxis yAxisId="latency" tick={{ fill: 'var(--app-muted)', fontSize: 11 }} unit=" ms" />
              <YAxis yAxisId="throughput" orientation="right" tick={{ fill: 'var(--app-muted)', fontSize: 11 }} unit=" Mb" />
              <Tooltip contentStyle={{ background: 'var(--app-surface-strong)', border: '1px solid var(--app-border-strong)', borderRadius: 8, color: 'var(--app-text)', fontSize: 11 }} />
              <Legend wrapperStyle={{ color: 'var(--app-text)', fontSize: 11 }} />
              <Line yAxisId="latency" type="monotone" dataKey="idle" name="Idle ms" stroke="var(--app-chart-idle)" connectNulls />
              <Line yAxisId="latency" type="monotone" dataKey="loaded" name="Loaded ms" stroke="var(--app-chart-loaded)" connectNulls />
              <Line yAxisId="throughput" type="monotone" dataKey="download" name="Down Mbps" stroke="var(--app-chart-download)" connectNulls />
              <Line yAxisId="throughput" type="monotone" dataKey="upload" name="Up Mbps" stroke="var(--app-chart-upload)" connectNulls />
            </LineChart>
          </ResponsiveContainer>
        </div> : <p className="mt-3 rounded-lg border border-slate-700 bg-slate-950/40 p-3 text-xs text-slate-400">No saved tests yet. Each finished test is saved here.</p>}
      </div>
    </section>

    <section className={`rounded-2xl border border-slate-800 bg-slate-900/70 p-5 ${view === 'adapters' ? '' : 'hidden'}`}>
      <h3 className="text-sm font-semibold text-slate-100">Adapter list</h3>
      {snapshot ? (
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {adaptersView.length > 0 ? adaptersView.map((adapter) => {
            const state = normalizeStatus(adapter.status);
            return <article key={`${adapter.name}-${adapter.interfaceDescription}`} className={`rounded-xl border p-4 ${state === 'Online' ? 'border-emerald-500/25 bg-emerald-950/15' : state === 'Disconnected' ? 'border-rose-500/25 bg-rose-950/20' : 'border-slate-700 bg-slate-950/40'}`}>
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-300"><Wifi className="h-3.5 w-3.5 text-slate-300" />{adapter.name || 'Unnamed interface'}</div>
              <p className="mt-2 text-sm font-semibold text-slate-100">{state}</p>
              <p data-technical-detail className="mt-1 text-[11px] leading-relaxed text-slate-500">{adapter.interfaceDescription}</p>
              <p className="mt-1 text-[11px] leading-relaxed text-slate-500">Link: {adapter.linkSpeed || 'Unknown'}</p>
              <p data-technical-detail className="mt-2 text-[11px] leading-relaxed text-slate-500">Raw status: {adapter.status}</p>
            </article>;
          }) : <p className="rounded-lg border border-slate-700 bg-slate-950/60 p-3 text-xs text-slate-400">Nothing matches these filters.</p>}
        </div>
      ) : <p className="mt-3 rounded-lg border border-slate-700 bg-slate-950/60 p-3 text-xs text-slate-400">Scan this PC to see its network adapters.</p>}
    </section>
    {view === 'adapters' && <WifiLinkCard />}
    </TabPanel>
  </div>;
}

function formatMetric(value: number | null, unit: string) {
  return value === null ? 'Unavailable' : `${value.toFixed(1)} ${unit}`;
}

function signed(value: number) {
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}`;
}

function SampleStrip({ title, samples }: { title: string; samples: NetworkProbeResult['idleSamples'] }) {
  const firstFailure = samples.find((sample) => !sample.success && sample.error);
  return <div className="rounded-lg border border-slate-700 bg-slate-950/30 p-3">
    <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{title}</p>
    <div className="grid grid-cols-5 gap-2">{samples.map((sample) => <div key={sample.index} title={sample.error || `${(sample.responseWaitMs ?? sample.durationMs)?.toFixed(1)} ms warmed response${sample.overlappedTransfer === false ? ' · overlap not established' : ''}`} className={`flex items-center justify-center gap-1 rounded border px-2 py-2 text-[11px] ${sample.success && sample.overlappedTransfer !== false ? 'border-emerald-500/25 bg-emerald-950/15 text-emerald-200' : 'border-rose-500/25 bg-rose-950/15 text-rose-200'}`}>{sample.success && sample.overlappedTransfer !== false ? <Signal className="h-3 w-3" /> : <Square className="h-3 w-3" />}#{sample.index}</div>)}</div>
    {firstFailure?.error ? <p className="mt-2 break-words text-[11px] leading-relaxed text-rose-200">First failure: {firstFailure.error}</p> : null}
  </div>;
}

function Metric({ title, value, detail, tone }: { title: string; value: string; detail: string; tone: 'good' | 'warn' | 'neutral' }) {
  const palette = tone === 'good'
    ? 'border-emerald-500/25 bg-emerald-950/15 text-emerald-100'
    : tone === 'warn'
      ? 'border-amber-500/25 bg-amber-950/10 text-amber-100'
      : 'border-slate-700 bg-slate-950/50 text-slate-300';
  return <article className={`rounded-xl border p-3 ${palette}`}>
    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{title}</p>
    <p className="mt-2 text-lg font-bold">{value}</p>
    <p data-technical-detail className="mt-1 text-[11px] leading-relaxed text-slate-500">{detail}</p>
  </article>;
}
