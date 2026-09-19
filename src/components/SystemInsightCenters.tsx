import { partName } from '../lib/friendlyError';
import { ErrorText } from './ErrorText';
import { AlertTriangle, AppWindow, Gauge, HardDrive, HeartPulse, RefreshCw, Search, Settings2, ShieldCheck } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { DiagnosticEvidence, InstalledApplicationInventory, SystemScanSnapshot } from '../types';
import { WindowsControlsCenter } from './WindowsControlsCenter';
import { LiveHardwareCard } from './LiveHardwareCard';

interface SystemInsightCentersProps {
  snapshot: SystemScanSnapshot | null;
  inventory: InstalledApplicationInventory | null;
  appsLoading: boolean;
  appsError: string | null;
  onRefreshApps: () => void;
}

type CenterId = 'storage' | 'windows' | 'reliability' | 'security' | 'power';
type PageFileValue = SystemScanSnapshot['diagnostics']['pageFile'] extends DiagnosticEvidence<infer T> ? T : never;
type StorageHealthValue = SystemScanSnapshot['diagnostics']['storageHealth'] extends DiagnosticEvidence<infer T> ? T : never;

function formatBytes(bytes: number | null) {
  if (bytes === null) return 'Unknown';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = -1;
  do { value /= 1024; unit += 1; } while (value >= 1024 && unit < units.length - 1);
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
}

function evidenceLabel<T>(evidence: DiagnosticEvidence<T>, available: (value: T) => string) {
  return evidence.status === 'AVAILABLE' ? available(evidence.value) : evidence.status.replaceAll('_', ' ');
}

function pageFileLabel(mode: PageFileValue['mode']) {
  if (mode === 'Automatic') return 'Windows managed';
  if (mode === 'Custom') return 'Custom size';
  return mode;
}

function storageHealthLabel(items: StorageHealthValue) {
  if (items.length === 0) return 'No drives returned';
  const needingReview = items.filter((item) => item.healthStatus.toLowerCase() !== 'healthy' || item.operationalStatus.toLowerCase() !== 'ok');
  return needingReview.length === 0
    ? `${items.length} drive${items.length === 1 ? '' : 's'} report healthy`
    : `${needingReview.length} of ${items.length} need review`;
}

export function SystemInsightCenters({ snapshot, inventory, appsLoading, appsError, onRefreshApps }: SystemInsightCentersProps) {
  const [center, setCenter] = useState<CenterId>('storage');
  const [appQuery, setAppQuery] = useState('');
  const [appSort, setAppSort] = useState<'name' | 'size' | 'publisher'>('size');

  const applications = useMemo(() => {
    const query = appQuery.trim().toLowerCase();
    const filtered = (inventory?.items || []).filter((item) => !query || `${item.displayName} ${item.publisher} ${item.displayVersion}`.toLowerCase().includes(query));
    return [...filtered].sort((left, right) => {
      if (appSort === 'publisher') return (left.publisher || 'zzzz').localeCompare(right.publisher || 'zzzz') || left.displayName.localeCompare(right.displayName);
      if (appSort === 'size') return (right.estimatedSizeBytes ?? -1) - (left.estimatedSizeBytes ?? -1) || left.displayName.localeCompare(right.displayName);
      return left.displayName.localeCompare(right.displayName);
    });
  }, [appQuery, appSort, inventory]);

  const tabs: Array<{ id: CenterId; label: string; icon: typeof HardDrive }> = [
    { id: 'storage', label: 'Storage & apps', icon: HardDrive },
    { id: 'windows', label: 'Windows controls', icon: Settings2 },
    { id: 'reliability', label: 'System status', icon: HeartPulse },
    { id: 'security', label: 'Security', icon: ShieldCheck },
    { id: 'power', label: 'Power & hardware', icon: Gauge },
  ];
  const tabId = (id: CenterId) => `system-center-tab-${id}`;
  const panelId = (id: CenterId) => `system-center-panel-${id}`;
  const storage = snapshot?.metrics.storage.status === 'AVAILABLE' ? snapshot.metrics.storage.value : null;

  return <section className="mt-6 rounded-2xl border border-slate-800 bg-slate-900/70 p-5 shadow-xl">
    <div><p className="text-xs font-semibold uppercase tracking-wider text-violet-300">Scan details</p><h2 className="mt-1 text-xl font-bold text-white">What Dialed found on this PC</h2><p className="mt-1 max-w-3xl text-xs leading-relaxed text-slate-400">Details from the scan, grouped by area. Reading these changes nothing. Windows controls opens the matching Windows Settings pages.</p></div>

    <div role="tablist" aria-label="System evidence views" className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">{tabs.map((tab, index) => {
      const Icon = tab.icon;
      return <button key={tab.id} id={tabId(tab.id)} type="button" role="tab" aria-selected={center === tab.id} aria-controls={panelId(tab.id)} tabIndex={center === tab.id ? 0 : -1} onClick={() => setCenter(tab.id)} onKeyDown={(event) => {
        let nextIndex = index;
        if (event.key === 'ArrowRight' || event.key === 'ArrowDown') nextIndex = (index + 1) % tabs.length;
        else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') nextIndex = (index - 1 + tabs.length) % tabs.length;
        else if (event.key === 'Home') nextIndex = 0;
        else if (event.key === 'End') nextIndex = tabs.length - 1;
        else return;
        event.preventDefault();
        const next = tabs[nextIndex];
        setCenter(next.id);
        requestAnimationFrame(() => document.getElementById(tabId(next.id))?.focus());
      }} className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-xs font-semibold ${center === tab.id ? 'border-violet-400/40 bg-violet-400/10 text-violet-100' : 'border-slate-800 bg-slate-950/40 text-slate-400 hover:border-slate-600'}`}><Icon className="h-4 w-4" />{tab.label}</button>;
    })}</div>

    {center === 'storage' ? <div id={panelId('storage')} role="tabpanel" aria-labelledby={tabId('storage')} className="mt-4 space-y-4">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{storage?.map((volume) => {
        const usedBytes = Math.max(0, volume.totalBytes - volume.freeBytes);
        const usedPercent = volume.totalBytes > 0 ? (usedBytes / volume.totalBytes) * 100 : 0;
        return <article key={volume.driveLetter} className="rounded-xl border border-slate-800 bg-slate-950/45 p-4"><div className="flex items-center justify-between gap-2"><h3 className="text-sm font-semibold text-slate-100">{volume.driveLetter}: {volume.label || 'Local volume'}</h3><span data-technical-detail className="rounded bg-slate-800 px-2 py-1 text-[11px] text-slate-300">{volume.isSSD ? 'SSD' : 'HDD / unknown'}</span></div><p className="mt-3 text-xl font-bold text-white">{formatBytes(volume.freeBytes)} free</p><div className="mt-2 h-2 overflow-hidden rounded bg-slate-800"><div className={`h-full ${usedPercent >= 90 ? 'bg-rose-400' : usedPercent >= 80 ? 'bg-amber-400' : 'bg-cyan-400'}`} style={{ width: `${Math.min(100, usedPercent)}%` }} /></div><p data-technical-detail className="mt-2 text-[11px] text-slate-500">{formatBytes(usedBytes)} used of {formatBytes(volume.totalBytes)} · TRIM {volume.trimEnabled ? 'reported enabled' : 'not reported enabled'}</p></article>;
      })}</div>
      {!snapshot ? <p className="rounded-lg border border-amber-500/20 bg-amber-950/10 p-3 text-xs text-amber-100/70">Scan this PC to see its drives.</p> : snapshot.metrics.storage.status !== 'AVAILABLE' ? <p className="rounded-lg border border-amber-500/20 bg-amber-950/10 p-3 text-xs text-amber-100/70">{snapshot.metrics.storage.status.replaceAll('_', ' ')}: {snapshot.metrics.storage.reason}</p> : storage?.length === 0 ? <p className="rounded-lg border border-slate-700 bg-slate-950/40 p-3 text-xs text-slate-400">No drives were found.</p> : null}
      <div className="rounded-xl border border-slate-800 bg-slate-950/45 p-4">
        <div className="flex flex-col justify-between gap-3 md:flex-row md:items-end"><div><div className="flex items-center gap-2"><AppWindow className="h-4 w-4 text-cyan-300" /><h3 className="text-sm font-semibold text-slate-100">Installed apps</h3></div><p className="mt-1 text-[11px] leading-relaxed text-slate-500">What Windows lists as installed. Some apps do not report their size.</p></div><button type="button" onClick={onRefreshApps} disabled={appsLoading} className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-[11px] font-semibold text-slate-300 disabled:opacity-50"><RefreshCw className={`h-3.5 w-3.5 ${appsLoading ? 'animate-spin' : ''}`} />{appsLoading ? 'Reading apps…' : 'Refresh apps'}</button></div>
        <div className="mt-3 flex flex-wrap gap-2"><label className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-300"><Search className="h-3.5 w-3.5 text-slate-500" /><input value={appQuery} onChange={(event) => setAppQuery(event.target.value)} placeholder="Search name, publisher, version" className="w-64 bg-transparent outline-none placeholder:text-slate-600" /></label><select aria-label="Sort installed apps" value={appSort} onChange={(event) => setAppSort(event.target.value as typeof appSort)} className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-200"><option value="size">Largest known size</option><option value="name">Name</option><option value="publisher">Publisher</option></select></div>
        {appsError ? <p role="alert" className="mt-3 rounded-lg border border-rose-500/25 bg-rose-950/20 p-3 text-xs text-rose-200"><ErrorText text={appsError} /></p> : null}
        <div className="mt-3 max-h-96 overflow-y-auto rounded-lg border border-slate-800"><table className="w-full table-fixed text-left text-[11px]"><thead className="sticky top-0 bg-slate-900 text-slate-500"><tr><th className="w-[38%] px-3 py-2">Application</th><th className="w-[27%] px-3 py-2">Publisher</th><th className="w-[17%] px-3 py-2">Version</th><th className="w-[18%] px-3 py-2 text-right">Estimated size</th></tr></thead><tbody>{applications.map((item) => <tr key={`${item.displayName}-${item.displayVersion}-${item.publisher}`} className="border-t border-slate-800 text-slate-300"><td className="break-words px-3 py-2 font-semibold text-slate-200">{item.displayName}</td><td className="break-words px-3 py-2 text-slate-500">{item.publisher || 'Unknown'}</td><td className="break-words px-3 py-2 text-slate-500">{item.displayVersion || 'Unknown'}</td><td className="px-3 py-2 text-right text-slate-400">{formatBytes(item.estimatedSizeBytes)}</td></tr>)}</tbody></table>{!appsLoading && inventory && applications.length === 0 ? <p className="p-4 text-xs text-slate-500">No installed application matched this view.</p> : null}</div>
        {inventory ? <p data-technical-detail className="mt-2 text-[11px] leading-relaxed text-slate-600">{inventory.items.length} registered entries · {inventory.limitations}</p> : null}
      </div>
    </div> : null}

    {center === 'windows' ? <div id={panelId('windows')} role="tabpanel" aria-labelledby={tabId('windows')}><WindowsControlsCenter snapshot={snapshot} /></div> : null}

    {center === 'reliability' ? <div id={panelId('reliability')} role="tabpanel" aria-labelledby={tabId('reliability')} className="mt-4 grid gap-3 lg:grid-cols-2">
      <EvidenceCard title="Scan result" value={snapshot ? snapshot.metadata.errors.length === 0 ? 'Complete' : `Complete with ${snapshot.metadata.errors.length} data gap${snapshot.metadata.errors.length === 1 ? '' : 's'}` : 'Not run'} detail={snapshot ? `${snapshot.metadata.executionTimeMs} ms · ${snapshot.metadata.elevated ? 'administrator' : 'standard-user'} evidence` : 'Scan this PC first.'} tone={snapshot && snapshot.metadata.errors.length === 0 ? 'good' : 'warn'} />
      <EvidenceCard title="Windows drive status" value={snapshot ? evidenceLabel(snapshot.diagnostics.storageHealth, storageHealthLabel) : 'Unavailable'} detail={snapshot?.diagnostics.storageHealth.status === 'AVAILABLE' ? `${snapshot.diagnostics.storageHealth.value.map((item) => `${item.friendlyName}: ${item.healthStatus} / ${item.operationalStatus}`).join(' · ')}. Windows status only; not a SMART failure prediction.` : 'Windows did not report drive health.'} tone={snapshot?.diagnostics.storageHealth.status === 'AVAILABLE' && snapshot.diagnostics.storageHealth.value.length > 0 && snapshot.diagnostics.storageHealth.value.every((item) => item.healthStatus.toLowerCase() === 'healthy' && item.operationalStatus.toLowerCase() === 'ok') ? 'good' : 'warn'} />
      <EvidenceCard title="Page file" value={snapshot ? evidenceLabel(snapshot.diagnostics.pageFile, (value) => pageFileLabel(value.mode)) : 'Unavailable'} detail="Shown for information. Dialed does not change the page file." tone="neutral" />
      <EvidenceCard title="Repair tools" value="No automatic repairs" detail="Dialed does not run system repair tools or registry cleaners." tone="neutral" />
      {snapshot?.metadata.errors.length ? <div className="rounded-xl border border-amber-500/25 bg-amber-950/10 p-4 lg:col-span-2"><h3 className="text-sm font-semibold text-amber-200">Items that could not be read</h3><div className="mt-3 grid gap-2">{snapshot.metadata.errors.map((error, index) => <div key={`${error.component}-${index}`} className="rounded border border-amber-500/15 bg-slate-950/30 p-3 text-xs"><p className="font-semibold text-slate-200">{partName(error.component)}</p><p className="mt-1 break-words text-slate-500"><ErrorText text={error.message} /></p></div>)}</div></div> : null}
    </div> : null}

    {center === 'security' ? <div id={panelId('security')} role="tabpanel" aria-labelledby={tabId('security')} className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      <EvidenceCard title="Secure Boot" value={snapshot ? evidenceLabel(snapshot.diagnostics.secureBoot, (value) => value.state) : 'Unavailable'} detail="Shown for information. Change it in your BIOS if needed." tone="neutral" />
      <EvidenceCard title="TPM" value={snapshot ? evidenceLabel(snapshot.diagnostics.tpm, (value) => value.present ? value.ready ? 'Present and ready' : 'Present, not ready' : 'Not present') : 'Unavailable'} detail="Shown for information. Dialed never changes the TPM." tone="neutral" />
      <EvidenceCard title="Virtualization" value={snapshot ? evidenceLabel(snapshot.diagnostics.virtualization, (value) => value.hypervisorPresent ? 'Hypervisor present' : value.firmwareVirtualizationEnabled === true ? 'Firmware enabled' : value.firmwareVirtualizationEnabled === false ? 'Firmware disabled' : 'Unknown') : 'Unavailable'} detail="Shown for information. Some anti-cheat and security tools need this on." tone="neutral" />
      <EvidenceCard title="Anti-cheat" value={snapshot ? evidenceLabel(snapshot.diagnostics.antiCheat, (items) => items.length ? `${items.length} product signal${items.length === 1 ? '' : 's'}` : 'None found') : 'Unavailable'} detail="Dialed never changes a game while anti-cheat might be watching. Not finding it does not prove it is absent." tone="neutral" />
    </div> : null}

    {center === 'power' ? <div id={panelId('power')} role="tabpanel" aria-labelledby={tabId('power')} className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      <EvidenceCard title="Active power plan" value={snapshot ? evidenceLabel(snapshot.diagnostics.powerScheme, (value) => value.name || 'Active plan detected') : 'Unavailable'} detail={snapshot?.diagnostics.powerScheme.status === 'AVAILABLE' ? `Switch plans in Tweaks › Windows. Plan ID: ${snapshot.diagnostics.powerScheme.value.guid}.` : 'Scan this PC to see the power plan.'} tone="neutral" />
      <EvidenceCard title="Processor" value={snapshot ? evidenceLabel(snapshot.metrics.cpu, (value) => value.name) : 'Unavailable'} detail={snapshot?.metrics.cpu.status === 'AVAILABLE' ? `${snapshot.metrics.cpu.value.cores} cores · ${snapshot.metrics.cpu.value.logicalProcessors} logical processors · reported max ${snapshot.metrics.cpu.value.maxClockSpeedMhz} MHz` : snapshot ? snapshot.metrics.cpu.reason : 'Scan this PC first.'} tone="neutral" />
      <EvidenceCard title="Graphics" value={snapshot ? evidenceLabel(snapshot.diagnostics.graphics, (items) => items.map((item) => item.name).join(', ') || 'No adapter returned') : 'Unavailable'} detail="Shown for information." tone="neutral" />
      <EvidenceCard title="System board" value={snapshot ? evidenceLabel(snapshot.diagnostics.motherboard, (value) => [value.manufacturer, value.product].filter(Boolean).join(' · ') || 'No board name returned') : 'Unavailable'} detail="Shown for information. Dialed never changes BIOS settings." tone="neutral" />
      <div className="md:col-span-2 xl:col-span-4"><LiveHardwareCard /></div>
    </div> : null}
  </section>;
}

function EvidenceCard({ title, value, detail, tone }: { title: string; value: string; detail: string; tone: 'good' | 'warn' | 'neutral' }) {
  const palette = tone === 'good' ? 'border-emerald-500/25 bg-emerald-950/15' : tone === 'warn' ? 'border-amber-500/25 bg-amber-950/10' : 'border-slate-800 bg-slate-950/45';
  return <article className={`min-w-0 rounded-xl border p-4 ${palette}`}><p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{title}</p><p className="mt-2 break-words text-sm font-bold text-slate-100">{value}</p><p className="mt-2 break-words text-[11px] leading-relaxed text-slate-400">{detail}</p></article>;
}
