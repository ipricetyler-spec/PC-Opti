import { Activity, AlertTriangle } from 'lucide-react';
import type { ReactNode } from 'react';
import type { DiagnosticEvidence, SystemScanSnapshot } from '../types';

interface ExpandedDiagnosticsProps {
  diagnostics: SystemScanSnapshot['diagnostics'];
}

function stateClass(status: DiagnosticEvidence<unknown>['status']) {
  if (status === 'AVAILABLE') return 'border-slate-800 bg-slate-950/50 text-slate-300';
  if (status === 'PERMISSION_REQUIRED') return 'border-amber-500/25 bg-amber-950/20 text-amber-100/80';
  return 'border-slate-700 bg-slate-900/60 text-slate-400';
}

function EvidenceCard<T>({
  title,
  evidence,
  render,
}: {
  title: string;
  evidence: DiagnosticEvidence<T>;
  render: (value: T) => ReactNode;
}) {
  return <article className={`rounded-xl border p-4 ${stateClass(evidence.status)}`}>
    <div className="flex items-start justify-between gap-3">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-300">{title}</h4>
      <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[11px] font-semibold text-slate-400">{evidence.status.replaceAll('_', ' ')}</span>
    </div>
    <div className="mt-3 text-xs leading-relaxed">
      {evidence.status === 'AVAILABLE' ? render(evidence.value) : <p>{evidence.reason}</p>}
    </div>
    <p className="mt-3 text-[11px] text-slate-600">Source: {evidence.source || 'Not returned'}</p>
  </article>;
}

function yesNo(value: boolean | null) {
  return value === null ? 'Not returned' : value ? 'Yes' : 'No';
}

export function ExpandedDiagnostics({ diagnostics }: ExpandedDiagnosticsProps) {
  return <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
    <div className="flex items-start gap-3">
      <Activity className="mt-0.5 h-5 w-5 text-cyan-400" />
      <div>
        <h3 className="font-semibold text-slate-100">More details</h3>
        <p className="mt-1 text-xs leading-relaxed text-slate-500">Anything Windows did not report is shown as unknown, never guessed.</p>
      </div>
    </div>
    <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      <EvidenceCard title="Graphics" evidence={diagnostics.graphics} render={(items) => items.length ? <ul className="space-y-2">{items.map((item, index) => <li key={`${item.name}-${index}`}><span className="font-medium text-slate-200">{item.name}</span><br />Driver {item.driverVersion} · status {item.status}</li>)}</ul> : <p>No graphics adapter was returned.</p>} />
      <EvidenceCard title="Motherboard" evidence={diagnostics.motherboard} render={(value) => <p><span className="font-medium text-slate-200">{value.manufacturer}</span><br />{value.product}</p>} />
      <EvidenceCard title="Active power scheme" evidence={diagnostics.powerScheme} render={(value) => <p><span className="font-medium text-slate-200">{value.name}</span><br /><span className="text-[11px] text-slate-500">{value.guid}</span></p>} />
      <EvidenceCard title="Hardware GPU scheduling" evidence={diagnostics.hardwareGpuScheduling} render={(value) => <p className="font-medium text-slate-200">{value.state}</p>} />
      <EvidenceCard title="Game DVR / capture" evidence={diagnostics.gameDvr} render={(value) => <p><span className="font-medium text-slate-200">{value.state}</span><br />App capture: {yesNo(value.appCaptureEnabled)} · Game DVR: {yesNo(value.gameDvrEnabled)}</p>} />
      <EvidenceCard title="Page file" evidence={diagnostics.pageFile} render={(value) => <p><span className="font-medium text-slate-200">{value.mode}</span><br />{value.settings.length} configured setting{value.settings.length === 1 ? '' : 's'} · {value.usage.length} active entr{value.usage.length === 1 ? 'y' : 'ies'}</p>} />
      <EvidenceCard title="Storage health" evidence={diagnostics.storageHealth} render={(items) => items.length ? <ul className="space-y-2">{items.map((item, index) => <li key={`${item.friendlyName}-${index}`}><span className="font-medium text-slate-200">{item.friendlyName}</span><br />{item.healthStatus} · {item.operationalStatus} · {item.mediaType}</li>)}</ul> : <p>No drives were reported.</p>} />
      <EvidenceCard title="Physical network" evidence={diagnostics.networkAdapters} render={(items) => items.length ? <ul className="space-y-2">{items.map((item, index) => <li key={`${item.name}-${index}`}><span className="font-medium text-slate-200">{item.name}</span><br />{item.status} · {item.linkSpeed}</li>)}</ul> : <p>No network adapters were found.</p>} />
      <EvidenceCard title="Secure Boot" evidence={diagnostics.secureBoot} render={(value) => <p className="font-medium text-slate-200">{value.state}</p>} />
      <EvidenceCard title="TPM" evidence={diagnostics.tpm} render={(value) => <p><span className="font-medium text-slate-200">{value.present ? 'Present' : 'Not present'}</span><br />Ready: {yesNo(value.ready)} · Enabled: {yesNo(value.enabled)}</p>} />
      <EvidenceCard title="Virtualization" evidence={diagnostics.virtualization} render={(value) => <p>Hypervisor present: {yesNo(value.hypervisorPresent)}<br />Firmware virtualization: {yesNo(value.firmwareVirtualizationEnabled)}<br />SLAT: {yesNo(value.secondLevelAddressTranslation)}</p>} />
      <EvidenceCard title="Anti-cheat" evidence={diagnostics.antiCheat} render={(items) => items.length ? <ul className="space-y-2">{items.map((item) => <li key={item.product}><span className="font-medium text-slate-200">{item.product}</span><br />Service: {item.serviceName || 'Not returned'} · {item.state}<br />Driver present: {yesNo(item.driverPresent)}</li>)}</ul> : <p>No known anti-cheat was found.</p>} />
    </div>
    <div className="mt-4 flex gap-2 rounded-lg border border-slate-800 bg-slate-950/40 p-3 text-[11px] text-slate-500">
      <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-300" />
      Sensor temperatures, internet quality, serial numbers, and external probes are outside this scan. Security and firmware findings are guidance only.
    </div>
  </section>;
}
