import { ErrorText } from './ErrorText';
import { useEffect, useRef, useState } from 'react';
import { Activity, ArrowRight, Check, CircleHelp, ExternalLink, Gamepad2, Keyboard, Mouse, Gauge, LoaderCircle, Plug, RefreshCw, RotateCcw, ShieldCheck, TriangleAlert, Usb, X } from 'lucide-react';
import type { InputDevice, InputDriverLifecycleAction, InputDriverLifecyclePreview, InputDriverLifecycleResult, InputDriverLifecycleStatus, InputInventory, InputPreview, InputTest, InputTierPreview } from '../lib/inputDevices';
import { TabRow, TabPanel } from './TabRow';
import { BundledInputStatus } from './BundledInputStatus';

const button = 'inline-flex items-center justify-center gap-2 rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-2 text-xs font-semibold text-slate-200 disabled:opacity-40';
const primary = 'inline-flex items-center justify-center gap-2 rounded-lg bg-cyan-400 px-4 py-2.5 text-xs font-bold text-slate-950 disabled:opacity-40';
const box = 'min-w-0 rounded-xl border border-slate-800 bg-slate-950/50 p-4';
// The one fixed upstream destination this workspace links to. It is passed to the
// existing main-owned external-link authority; the renderer never opens a URL itself.
const HIDUSBF_PROJECT_URL = 'https://github.com/LordOfMice/hidusbf';
const routeName = (device: InputDevice) => device.connection === 'CPU' ? 'Likely CPU-integrated' : device.connection === 'CHIPSET' ? 'Likely chipset-integrated' : 'Attachment unknown';
const formatMs = (value: number | null) => value === null ? 'Not enough data' : `${value.toFixed(2)} ms`;
const channelName = (kind: InputTest['channels'][number]['kind']) => kind === 'MOUSE' ? 'Mouse' : kind === 'KEYBOARD' ? 'Keyboard' : kind === 'JOYSTICK' ? 'Joystick' : kind === 'GAMEPAD' ? 'Gamepad' : 'Input';
const tierLabel = (tier: number | null) => tier === 3 ? '4–8 kHz' : tier === 2 ? '2–4 kHz' : tier === 1 ? '1 kHz' : tier === 0 ? 'No xHCI patch' : 'Not verified';
const driverActionTitle = (action: InputDriverLifecycleAction) => action === 'INSTALL' ? 'Install the reviewed driver for this device' : action === 'ATTACH' ? 'Attach the reviewed driver to this device' : action === 'ADOPT' ? 'Adopt this existing driver scope' : action === 'REPAIR' ? 'Repair the Dialed-installed driver' : action === 'UPGRADE' ? 'Upgrade the Dialed-installed driver' : action === 'DETACH' ? 'Detach this device from the driver' : 'Remove the detached driver package';
const unavailableDriverStatus = (): InputDriverLifecycleStatus => ({ status: 'UNAVAILABLE', installEnabled: false, capabilities: { install: false, repair: false, upgrade: false, detach: false, removePackage: false, adopt: false }, package: null, ownership: 'NONE', managedDeviceCount: 0, operationId: null, lastOutcome: null, reasons: [{ code: 'LIFECYCLE_STATUS_UNAVAILABLE', message: 'The signed driver lifecycle status could not be read safely. Refresh before trying again.' }] });
const technicalIdentity = (product: string) => {
  const match = product.match(/VID_([0-9A-F]{4})&PID_([0-9A-F]{4})/i);
  return match ? `VID ${match[1].toUpperCase()} · PID ${match[2].toUpperCase()}` : 'VID/PID unavailable';
};
function activityInstruction(kinds: InputDevice['testKinds']) {
  if (kinds.includes('JOYSTICK') || kinds.includes('GAMEPAD')) return 'Hold sticks and triggers still for one second at the start, then move them clearly. Press and release buttons and the D-pad.';
  if (kinds.includes('KEYBOARD') && kinds.includes('MOUSE')) return 'Windows exposes both keyboard- and mouse-compatible channels for this composite device. If the physical product is a keyboard, type continuously; if it is a mouse, move it continuously. Only channels that actually respond are shown.';
  const instructions = [];
  if (kinds.includes('KEYBOARD')) instructions.push('press different keys continuously');
  if (kinds.includes('MOUSE')) instructions.push('move the mouse or pointing control continuously');
  return instructions.length ? `For this device, ${instructions.join(' or ')} for the full test.` : 'Use this device continuously for the full test.';
}
function DeviceIcon({ device }: { device: InputDevice }) {
  const kinds = device.testKinds;
  const Icon = kinds.includes('GAMEPAD') || kinds.includes('JOYSTICK') ? Gamepad2 : kinds.length === 1 && kinds[0] === 'MOUSE' ? Mouse : kinds.length === 1 && kinds[0] === 'KEYBOARD' ? Keyboard : Usb;
  return <Icon aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-cyan-300" />;
}

export function InputDevicesCenter() {
  const [inventory, setInventory] = useState<InputInventory | null>(null);
  const [driverLifecycle, setDriverLifecycle] = useState<InputDriverLifecycleStatus | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [tab, setTab] = useState<'ports' | 'polling'>('polling');
  const [advanced, setAdvanced] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [label, setLabel] = useState('');
  const [rate, setRate] = useState<number | ''>('');
  const [comparison, setComparison] = useState<InputDevice | null>(null);
  const [preview, setPreview] = useState<InputPreview | null>(null);
  const [tierPreview, setTierPreview] = useState<InputTierPreview | null>(null);
  const [driverPreview, setDriverPreview] = useState<InputDriverLifecyclePreview | null>(null);
  const [driverOutcome, setDriverOutcome] = useState<InputDriverLifecycleResult | null>(null);
  const [driverRate, setDriverRate] = useState<number | ''>('');
  const [test, setTest] = useState<InputTest | null>(null);
  const running = useRef(false), mounted = useRef(true), generation = useRef(0);
  const refreshAfterSetup = useRef(false);
  const driverConfirmationRef = useRef<HTMLDivElement | null>(null);
  const api = window.pcOptiNative;
  const selected = inventory?.devices.find((item) => item.id === selectedId);
  const recovery = inventory?.history.filter((item) => item.deviceId === selectedId && item.purpose !== 'TIER_ISOLATION' && !['RESTORED', 'NOT_APPLIED'].includes(item.status)) || [];
  const isolationRecovery = inventory?.history.filter((item) => item.purpose === 'TIER_ISOLATION' && !['RESTORED', 'NOT_APPLIED'].includes(item.status)) || [];
  const filteredDevices = inventory?.filteredDevices || [];
  const tierRecovery = inventory?.tierHistory?.filter((item) => !['RESTORED', 'NOT_APPLIED'].includes(item.status)) || [];
  const recoverableTierChange = tierRecovery.find((item) => ['PRESUMED_ACTIVE', 'SCOPE_DRIFT'].includes(item.status));
  const filteredBlockers = filteredDevices.filter((item) => item.id !== selectedId && (item.wouldExceed1k || item.uncertainImpact));
  const isInputTesting = busy.startsWith('Testing input for');
  const selectedTestKinds = selected?.testKinds || [];
  const memoryIntegrity = inventory?.security?.memoryIntegrity || 'Unknown';
  const tierRestartState = inventory?.driver.restartState || 'NONE';
  const legacyWrites = inventory?.legacyNewWritesAllowed === true;
  const restoreBlocked = inventory?.legacyRestoreAuthority?.allowed === false;
  const urgentLegacy = inventory?.history.filter(item => ['PENDING','NEEDS_REVIEW'].includes(item.status)) || [];
  const urgentTier = inventory?.tierHistory.filter(item => !['RESTORED','NOT_APPLIED','PRESUMED_ACTIVE'].includes(item.status)) || [];
  const canReviewTier = Boolean(legacyWrites && selected && selected.speed === 'High-Speed' && selected.filterActive && inventory?.elevated && memoryIntegrity === 'Disabled' && tierRestartState === 'NONE' && inventory.driver.patchUsbXhci !== 3 && filteredBlockers.length === 0);
  const driverSetupMissing = Boolean(selected && !selected.filterActive);
  const driverPackageRates = driverLifecycle?.package?.supportedPollingHz || [];
  const driverRates = selected?.speed === 'Full-Speed'
    ? driverPackageRates.filter((value) => value >= 125 && value <= 1000)
    : selected?.speed === 'High-Speed'
      ? driverPackageRates.filter((value) => value >= 1000 && value <= 8000)
      : [];
  const showDriverLifecycle = Boolean(selected && advanced);
  const driverInstallAction: InputDriverLifecycleAction = driverLifecycle?.status === 'READY_FOR_PREFLIGHT' || driverLifecycle?.status === 'REMOVED' || driverLifecycle?.status === 'NOT_APPLIED' ? 'INSTALL' : 'ATTACH';

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; generation.current++; void window.pcOptiNative?.cancelInputTest?.().catch(() => {}); }; }, []);
  useEffect(() => api?.onBundledInputSetupClosed?.(() => {
    setSetupOpen(false); setTest(null); setPreview(null); setTierPreview(null); setDriverPreview(null);
    refreshAfterSetup.current = true;
    // Complete an in-flight read/test first, then scan. Never let its older result
    // win the refresh race or count closing setup as successful verification.
    if (!running.current) scanAfterSetup();
  }), []);
  useEffect(() => {
    setLabel(selected?.portLabel || '');
    setRate(selected?.configuredHz && selected.rates.includes(selected.configuredHz) ? selected.configuredHz : '');
    setPreview(null); setTierPreview(null); setDriverPreview(null); setDriverOutcome(null); setTest(null);
  }, [selected?.id, selected?.portId, selected?.portLabel, selected?.configuredHz, selected?.maxSupportedHz]);
  useEffect(() => {
    const preferred = selected?.configuredHz && driverRates.includes(selected.configuredHz) ? selected.configuredHz : driverRates.at(-1) || '';
    setDriverRate(preferred);
  }, [selected?.id, selected?.configuredHz, driverLifecycle?.package?.packageId, driverLifecycle?.package?.version, driverPackageRates.join(',')]);
  useEffect(() => {
    if (driverPreview) driverConfirmationRef.current?.focus();
  }, [driverPreview?.token]);
  useEffect(() => {
    if (!selected?.id || !api?.getInputDriverLifecycleStatus) { setDriverLifecycle(null); return; }
    let current = true;
    setDriverLifecycle(null);
    void api.getInputDriverLifecycleStatus(selected.id).then((result) => { if (current) setDriverLifecycle(result); }).catch(() => { if (current) setDriverLifecycle(unavailableDriverStatus()); });
    return () => { current = false; };
  }, [selected?.id, inventory?.scannedAt]);
  function acceptInventory(next: InputInventory, currentId = selectedId) {
    setTest(null);
    setInventory(next);
    if (next.devices.some((device) => device.id === currentId)) setSelectedId(currentId);
    else if (comparison) {
      const matches = next.devices.filter((device) => device.product === comparison.product);
      setSelectedId(matches.length === 1 ? matches[0].id : '');
    } else setSelectedId(next.devices[0]?.id || '');
  }
  async function run(message: string, operation: () => Promise<void>) {
    if (running.current) return;
    running.current = true; const version = generation.current;
    setBusy(message); setError('');
    try { await operation(); }
    catch (caught) { if (mounted.current && generation.current === version) setError(caught instanceof Error ? caught.message : String(caught)); }
    finally {
      running.current = false;
      if (mounted.current && generation.current === version) {
        setBusy('');
        if (refreshAfterSetup.current) scanAfterSetup();
      }
    }
  }
  function scanAfterSetup() {
    if (!mounted.current || running.current || !refreshAfterSetup.current) return;
    refreshAfterSetup.current = false;
    setTest(null); setPreview(null); setTierPreview(null); setDriverPreview(null); setDriverOutcome(null);
    void run('Setup closed. Refreshing saved device settings…', async () => {
      if (!api?.scanInputDevices) throw new Error('Setup closed. Refresh devices to read the saved setting.');
      const next = await api.scanInputDevices();
      if (mounted.current) {
        setTest(null); setInventory(next);
        setSelectedId(current => next.devices.some(device => device.id === current) ? current : '');
        setStatus('Saved settings refreshed after setup. Reconnect verification is shown in setup; measure Windows delivery separately.');
      }
    });
  }
  function scan() {
    setTest(null);
    if (!api?.scanInputDevices) { setError('Open the updated Dialed desktop app to scan connected USB devices. This preview contains no invented devices.'); return; }
    setPreview(null); setTierPreview(null); setDriverPreview(null); setDriverOutcome(null);
    void run('Reading USB connections…', async () => {
      const result = await api.scanInputDevices();
      if (mounted.current) acceptInventory(result);
    });
  }

  async function refreshDriverLifecycle(deviceId = selected?.id) {
    if (!api?.getInputDriverLifecycleStatus || !deviceId) return null;
    const next = await api.getInputDriverLifecycleStatus(deviceId);
    if (mounted.current) setDriverLifecycle(next);
    return next;
  }

  function reviewDriverLifecycle(action: InputDriverLifecycleAction) {
    if (!api || !selected) return;
    if (['INSTALL', 'ATTACH', 'ADOPT'].includes(action) && driverRate === '') return;
    setStatus(''); setDriverOutcome(null); setPreview(null); setTierPreview(null);
    const messages: Record<InputDriverLifecycleAction, string> = {
      INSTALL: 'Reviewing signed driver setup…', ATTACH: 'Reviewing the selected driver attachment…', ADOPT: 'Reviewing the existing signed driver scope…',
      REPAIR: 'Reviewing exact driver repair…', UPGRADE: 'Reviewing exact driver upgrade…', DETACH: 'Reviewing exact driver detach…', REMOVE_PACKAGE: 'Reviewing detached driver package removal…',
    };
    void run(messages[action], async () => {
      const next = action === 'INSTALL' || action === 'ATTACH'
        ? await api.previewInputDriverInstall(selected.id, driverRate as number)
        : action === 'ADOPT'
          ? await api.previewInputDriverAdoption(selected.id, driverRate as number)
          : action === 'REPAIR'
            ? await api.previewInputDriverRepair(selected.id)
            : action === 'UPGRADE'
              ? await api.previewInputDriverUpgrade()
              : action === 'DETACH'
                ? await api.previewInputDriverDetach(selected.id)
                : await api.previewInputDriverPackageRemoval();
      setDriverPreview(next);
    });
  }

  function applyDriverLifecycle() {
    if (!api?.applyInputDriverLifecycle || !driverPreview) return;
    const token = driverPreview.token;
    setDriverPreview(null); setStatus('');
    void run('Requesting the reviewed Windows driver operation…', async () => {
      const result = await api.applyInputDriverLifecycle(token);
      setDriverOutcome(result);
      await refreshDriverLifecycle();
      try { acceptInventory(await api.scanInputDevices()); } catch { /* Keep the verified lifecycle result; manual refresh remains available. */ }
    });
  }

  function reconcileDriverLifecycle() {
    if (!api?.reconcileInputDriverLifecycle || !driverLifecycle?.operationId) return;
    const operationId = driverLifecycle.operationId;
    setDriverPreview(null); setDriverOutcome(null); setStatus('');
    void run('Rechecking the saved driver operation…', async () => {
      setDriverLifecycle(await api.reconcileInputDriverLifecycle(operationId));
      try { acceptInventory(await api.scanInputDevices()); } catch { /* Keep the exact reconciliation result. */ }
    });
  }
  function pollingPreview(historyId?: string) {
    if (!api || !selected || rate === '') return;
    setAdvanced(true);
    setStatus(''); setTierPreview(null);
    void run('Checking this device and its driver…', async () => setPreview(await api.previewInputPolling(selected.id, rate, historyId)));
  }
  function restoreFiltered(deviceId: string, historyId: string) {
    if (!api) return;
    setAdvanced(true);
    setStatus(''); setTierPreview(null);
    void run('Checking the filtered device and its saved setting…', async () => setPreview(await api.previewInputPolling(deviceId, 1000, historyId)));
  }
  function previewIsolation(deviceId: string) {
    if (!api?.previewInputIsolation) return;
    setStatus(''); setTierPreview(null);
    void run('Checking the shared-driver safety scope…', async () => setPreview(await api.previewInputIsolation(deviceId)));
  }
  function apply() {
    if (!api || !preview) return;
    const token = preview.token; setPreview(null); setTierPreview(null);
    void run('Saving recovery information, applying and checking…', async () => {
      try { const result = await api.applyInputPolling(token); setStatus(result.message); }
      finally { try { acceptInventory(await api.scanInputDevices()); } catch { /* Keep the original operation error; refresh remains available. */ } }
    });
  }
  function reviewTier(deviceId = selected?.id, historyId?: string) {
    if (!api?.previewInputTier || !deviceId) return;
    setStatus(''); setPreview(null);
    void run('Rechecking the driver, Windows security and every filtered device…', async () => setTierPreview(await api.previewInputTier(deviceId, historyId)));
  }
  function applyTier() {
    if (!api?.applyInputTier || !tierPreview) return;
    const token = tierPreview.token; setTierPreview(null); setPreview(null);
    void run('Saving exact recovery state and configuring the shared tier…', async () => {
      try { const result = await api.applyInputTier(token); setStatus(result.message); }
      finally { try { acceptInventory(await api.scanInputDevices()); } catch { /* Keep the original operation error; refresh remains available. */ } }
    });
  }
  function testDevice() {
    if (!api || !selected) return;
    setTest(null); setPreview(null); setStatus('');
    void run(`Testing input for ${selected.name} — use only this selected device until the 8-second activity check finishes.`, async () => setTest(await api.testInputDevice(selected.id)));
  }
  function reconcile(historyId: string) {
    if (!api?.reconcileInputChange) return;
    setPreview(null); setStatus('');
    void run('Rechecking the saved before/after state…', async () => {
      acceptInventory(await api.reconcileInputChange(historyId));
      setStatus('Saved device state reconciled. Review the updated recovery entry before making another change.');
    });
  }
  function reconcileTier(historyId: string) {
    if (!api?.reconcileInputTier) return;
    setPreview(null); setTierPreview(null); setStatus('');
    void run('Checking the saved tier against this Windows boot session…', async () => {
      try {
        acceptInventory(await api.reconcileInputTier(historyId));
        setStatus('Driver setup is ready for the selected device. Run one delivery check to confirm that Windows is receiving the requested cadence.');
      } finally {
        try { acceptInventory(await api.scanInputDevices()); } catch { /* Preserve the original reconciliation result or error. */ }
      }
    });
  }

  return <section aria-label="Input devices" className="mb-6 min-w-0 overflow-hidden rounded-2xl border border-cyan-500/20 bg-slate-900 p-5 shadow-xl [overflow-wrap:anywhere]">
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div><p className="text-xs font-semibold tracking-wider text-cyan-300">INPUT DEVICES</p><h2 className="mt-1 text-2xl font-bold text-white">Your devices. Your polling rate.</h2><p className="mt-2 max-w-xl text-sm text-slate-400">Choose a device, review a rate change, then check what Windows receives.</p></div>
      <button type="button" onClick={scan} disabled={setupOpen || !!busy} className={button}>{busy && !busy.startsWith('Testing') ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}{inventory ? 'Refresh devices' : 'Scan input devices'}</button>
    </header>
    <TabRow<typeof tab> ariaLabel="Input device tools" items={[{ id: 'ports', label: <><Usb className="h-4 w-4" />USB connection</> }, { id: 'polling', label: <><Activity className="h-4 w-4" />Polling rate</> }]} value={tab} onChange={setTab} className="mt-5 flex flex-wrap gap-2 border-b border-slate-800 pb-3" buttonClassName={(selected) => selected ? primary : button} />
    <TabPanel ariaLabel="Input device tools" value={tab}>
    {!inventory ? <div className="py-10 text-center"><Plug className="mx-auto h-9 w-9 text-cyan-300" /><h3 className="mt-3 font-semibold text-white">Start with the devices you actually use</h3><p className="mx-auto mt-2 max-w-md text-sm text-slate-400">Scan to find connected USB input devices and their connection paths. Scanning does not change drivers or settings.</p></div> : !inventory.devices.length ? <div className="py-8 text-center text-sm text-slate-400">No connected USB input devices were identified. Connect a device and refresh. Bluetooth-only and remote-session devices may not appear.</div> : <div className="mt-4 grid min-w-0 gap-4 lg:grid-cols-[minmax(180px,0.65fr)_minmax(0,1.35fr)]">
      <div className="min-w-0 space-y-2" aria-label="Connected input devices">
        {inventory.devices.map((device) => <button type="button" key={device.id} disabled={setupOpen || !!busy} onClick={() => { setSelectedId(device.id); setStatus(''); setError(''); }} aria-pressed={device.id === selectedId} className={`w-full min-w-0 rounded-xl border p-3 text-left transition-colors disabled:opacity-50 ${device.id === selectedId ? 'border-cyan-400/50 bg-cyan-400/10 ring-1 ring-cyan-400/20' : 'border-slate-800 bg-slate-950/40 hover:border-slate-600'}`}>
          <span className="flex min-w-0 items-start justify-between gap-2"><span className="flex min-w-0 items-start gap-2"><DeviceIcon device={device} /><span className="min-w-0 text-sm font-semibold text-white">{device.name}</span></span>{device.id === selectedId ? <span className="shrink-0 rounded-full bg-cyan-400 px-2 py-0.5 text-[11px] font-black text-slate-950">SELECTED</span> : null}</span>
          <span className="mt-2 block text-[11px] text-slate-400">{device.portLabel ? `${device.portLabel} · ` : ''}{device.speed} USB{device.problem !== 0 ? ' · Windows needs attention' : ''}</span>
          <span data-technical-detail className="mt-1 block text-[11px] text-slate-500">{device.portNumber ? `Windows port ${device.portNumber} · ` : ''}{device.filterActive ? 'HIDUSBF filter present' : 'Standard device configuration'}</span>
        </button>)}
        <p className="pt-2 text-[11px] text-slate-500">{inventory.devices.length} connected<span data-technical-detail> · Local scan {new Date(inventory.scannedAt).toLocaleTimeString()}</span></p>
      </div>
      {!selected ? <p className="text-sm text-slate-400">Select the device you moved. Identical models are not merged automatically.</p> : <div className="min-w-0 space-y-3">
        {tab === 'ports' && <div className={box} aria-label="Selected device USB connection">
          <h3 className="text-sm font-semibold text-white">Connected through {selected.connection === 'CPU' ? 'a likely CPU-integrated USB controller' : selected.connection === 'CHIPSET' ? 'a likely chipset USB controller' : 'an unidentified USB controller route'}</h3>
          <p className="mt-2 text-xs text-cyan-200">{selected.speed === 'High-Speed' ? 'USB 2.0 High-Speed · 480 Mb/s device link' : selected.speed === 'Full-Speed' ? 'USB Full-Speed · 12 Mb/s device link' : selected.speed === 'Low-Speed' ? 'USB Low-Speed · 1.5 Mb/s device link' : selected.speed === 'SuperSpeed' ? 'USB SuperSpeed device link' : 'Device link speed unknown'} · {selected.hubs === null ? 'Hub path unknown' : selected.hubs === 0 ? 'No additional USB hubs' : `${selected.hubs} additional USB hub${selected.hubs === 1 ? '' : 's'}`}</p>
          <p className="mt-2 text-xs text-slate-300">{selected.controller}</p>
          <p className="mt-2 text-[11px] leading-relaxed text-slate-400">{selected.portLabel ? `Physical port: ${selected.portLabel}. ` : 'The physical socket is not labeled yet. '}The device link speed does not identify the socket&apos;s maximum speed or whether it is USB-A or USB-C. CPU/chipset classification is inferred from the controller ID.</p>
        </div>
        }
        {tab === 'ports' ? <>
          <div className={box}><h3 className="font-semibold text-white">Your current connection</h3>
            <p className="mt-3 text-sm font-semibold text-slate-100">{selected.hubs === 0 ? 'No additional USB hubs detected' : selected.hubs === null ? 'The full USB connection could not be confirmed' : `${selected.hubs} additional USB hub${selected.hubs === 1 ? '' : 's'} detected`}</p>
            <p className="mt-2 text-xs leading-relaxed text-slate-400">{selected.hubs === 0 ? 'Use this as a comparison point if you test another port.' : selected.hubs === null ? 'You can still use the device, but port comparison may be incomplete.' : 'A direct motherboard port may be worth comparing if you are troubleshooting.'} This view does not measure latency.</p>
            <div data-technical-detail aria-label="USB connection path" className="mt-3 flex flex-wrap items-center gap-2 text-xs"><span className="rounded-lg bg-slate-800 px-3 py-2 text-slate-200">Device</span><ArrowRight className="h-3 w-3 text-slate-500" />{selected.hubs === null ? <span className="text-amber-200">Incomplete path</span> : selected.hubNames.map((name, i) => <span key={i} className="rounded-lg border border-amber-500/20 px-3 py-2 text-amber-200">{name}</span>)}<span className="rounded-lg bg-cyan-400/10 px-3 py-2 text-cyan-200">USB controller</span></div>
            <div data-technical-detail className="mt-4 grid grid-cols-2 gap-3"><div><p className="text-[11px] uppercase tracking-wide text-slate-500">Additional hubs</p><p className="mt-1 text-lg font-bold text-white">{selected.hubs ?? 'Unknown'}</p></div><div><p className="text-[11px] uppercase tracking-wide text-slate-500">Controller attachment</p><p className="mt-1 text-xs font-semibold text-slate-200">{routeName(selected)}</p></div></div>
            <p data-technical-detail className="mt-3 text-xs leading-relaxed text-slate-300">{selected.advice}</p>
            <details data-technical-detail className="mt-3 text-[11px] text-slate-400"><summary className="cursor-pointer">Connection details &amp; confidence</summary><p className="mt-2 font-semibold text-slate-300">Technical identity: {technicalIdentity(selected.product)}</p><p className="mt-2">{selected.controller}</p><p className="mt-2">{selected.connectionEvidence}</p><p className="mt-2 break-all">{selected.location || 'Windows location path unavailable'}</p><p className="mt-2">Port numbers identify Windows connections, not printed motherboard labels. No latency is inferred from USB speed or hub count.</p></details>
          </div>
          <details className={box}><summary className="cursor-pointer text-xs font-semibold text-slate-200">Optional: name this physical port</summary><p className="mt-2 text-[11px] leading-relaxed text-slate-400">Useful only for remembering or comparing ports. A name is not required for polling setup.</p><div className="mt-2 flex flex-wrap gap-2"><label htmlFor="input-port-label" className="sr-only">Give this physical port a useful name</label><input id="input-port-label" aria-label="Give this physical port a useful name" maxLength={60} value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Rear port beside Ethernet" className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-white" /><button type="button" disabled={setupOpen || !!busy || !selected.portId} className={button} onClick={() => void run('Saving this port label…', async () => acceptInventory(await api!.labelInputPort(selected.id, label)))}>Save label</button></div></details>
          <div className={box}><h3 className="text-sm font-semibold text-white">Compare another port</h3><p className="mt-2 text-xs text-slate-400">Save this connection, move only this device, then refresh. Keep another input method available if moving your mouse.</p><button type="button" className={`${button} mt-3`} disabled={setupOpen || !!busy || !selected.routeComplete} onClick={() => setComparison({ ...selected })}><Plug className="h-3 w-3" />Use this as the starting port</button>
            {comparison && <div className="mt-3 rounded-lg border border-slate-700 p-3"><div className="flex justify-between gap-2"><p className="text-xs font-semibold text-cyan-200">Move the device, then refresh</p><button type="button" aria-label="Clear port comparison" onClick={() => setComparison(null)}><X className="h-3 w-3" /></button></div><div className="mt-3 grid grid-cols-2 gap-3 text-xs"><div><p className="text-slate-500">Starting connection</p><p className="mt-1 text-slate-200">{comparison.portLabel || comparison.name}</p><p className="mt-1 text-slate-400">{comparison.hubs ?? 'Unknown'} extra hubs</p></div><div><p className="text-slate-500">Selected connection</p><p className="mt-1 text-slate-200">{selected.portLabel || selected.name}</p><p className="mt-1 text-slate-400">{selected.hubs ?? 'Unknown'} extra hubs</p></div></div><p className="mt-3 text-[11px] text-slate-400">{comparison.product !== selected.product ? 'Different device model selected — choose the device you moved.' : comparison.portId === selected.portId ? 'Same Windows connection. Move to another physical port to compare.' : 'Different connection detected. Confirm this is the device you moved; this comparison shows topology, not measured latency.'}</p></div>}
          </div>
        </> : <>
          <BundledInputStatus device={selected} busy={!!busy} setupOpen={setupOpen} onSetupStateChange={(open) => { setSetupOpen(open); if (open) { setTest(null); setPreview(null); setTierPreview(null); setDriverPreview(null); setStatus(''); } }} />
          <div className={box} aria-label="Windows message check">
            <h3 className="text-sm font-semibold text-white">Input activity &amp; message rate</h3>
            <p className="mt-2 text-xs font-semibold leading-relaxed text-cyan-100">Use only {selected.name} for eight seconds. Keep the capture window focused; switching away cancels the check.</p>
            <p className="mt-1 text-xs leading-relaxed text-slate-400">{activityInstruction(selectedTestKinds)}</p>
            <p className="mt-2 text-xs leading-relaxed text-slate-300">See control activity separately from messages sent while idle. Small jitter and repeated states are ignored; controls held from the start may not register.</p>
            <p className="mt-2 text-[11px] text-slate-400">Key identities and raw reports are not saved. Only activity totals and timing return from the capture window.</p>
            <p className="mt-1 text-[11px] text-slate-400">For a shared receiver, the check covers its exposed input interfaces and may include more than one paired control.</p>
            <p className="mt-2 text-[11px] leading-relaxed text-slate-400">This measures messages received by Dialed from Windows. It does not verify USB polling or lower latency.</p>
            <div data-technical-detail className="mt-3 rounded-lg border border-slate-700 bg-slate-900/50 p-3 text-[11px] leading-relaxed text-slate-400">
              <p className="font-semibold text-slate-200">Measurement details</p>
              <p className="mt-1">Windows message counts and HID report counts are separate. Keyboard checks return only counts and an overall span, with no per-key timestamps. Axes use a median baseline of at least 16 samples over 250 ms, extending to one second for sparse input. Movement uses the greater of 6% of range or three times baseline noise, sustained across three reports and 20 ms. Sparse input uses a fixed 6% fallback with partial coverage. Mouse comparison needs at least 500 ms of motion spans; keyboard typing never establishes polling rate. Vendor data and sensors are ignored. These thresholds cannot prove deliberate intent or test every control.</p>
              <p className="mt-1">A lower result may reflect the device, Windows scheduling, message batching, system load, or how continuously you use it. Per-channel rates use the time between the first and last message.</p>
              <p className="mt-1 text-slate-500">The listener runs only for this check. Key identities and raw reports stay in capture memory and are not saved or sent to the app; only totals and message timing return. It does not block or modify the input path.</p>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" disabled={setupOpen || !!busy || !selected.canTest || !api?.testInputDevice} className={button} onClick={testDevice}><Activity className="h-4 w-4" />Run 8-second input check</button>
            </div>
            {isInputTesting ? <p role="status" aria-live="polite" className="mt-3 flex items-start gap-2 rounded-lg border border-cyan-400/25 bg-cyan-400/10 p-3 text-xs text-cyan-100"><LoaderCircle className="mt-0.5 h-4 w-4 shrink-0 animate-spin" /><span><strong>Testing {selected.name} now.</strong> Keep using only this exact device until the 8-second check finishes.</span></p> : null}
            {!selected.canTest && <p className="mt-2 text-[11px] text-slate-500">No supported mouse, keyboard, or game-controller message channel was detected for this device.</p>}
            {test && <div className="mt-3 space-y-2" aria-label="Input test results">
              <p className="text-xs text-slate-400">Measured {Number.isFinite(Date.parse(test.capturedAt)) ? new Date(test.capturedAt).toLocaleString() : 'time unavailable'}. Repeat after a device, driver, port or relevant configuration change.</p>
              <div aria-label="Control activity result" className="rounded-lg border border-slate-700 bg-slate-900/50 p-3 text-xs leading-relaxed text-slate-200">
                <p className="font-semibold text-white">Control activity</p>
                <p role="status" className="mt-1">{test.controlActivity?.message ?? 'Control activity was not measured by this capture.'}</p>
                {test.controlActivity && test.controlActivity.coverage !== 'NONE' && <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {[['Button changes', test.controlActivity.buttons], ['Key transitions', test.controlActivity.keys], ['Mouse / wheel', test.controlActivity.movement], ['Axis changes', test.controlActivity.axes], ['D-pad changes', test.controlActivity.hats]].map(([name, count]) => <div key={name}><dt className="text-slate-400">{name}</dt><dd className="font-semibold text-cyan-100">{count}</dd></div>)}
                </dl>}
                <p className="mt-2 text-[11px] text-slate-400">Counts describe detected changes, not unique controls or a complete device health test.</p>
              </div>
              <p role="status" className={`rounded-lg border p-3 text-xs leading-relaxed ${test.deliveryAssessment.status === 'BELOW_REQUEST_OBSERVED' ? 'border-amber-500/25 bg-amber-950/15 text-amber-100' : 'border-slate-700 bg-slate-900/50 text-slate-200'}`}>{test.deliveryAssessment.message}</p>
              {/* Per-channel lines only when they say something the summary above did not. A
                  composite device exposes several channels that often share one verdict, which
                  repeated the same sentence two or three times in a row. */}
              {(() => {
                const seen = new Set([test.deliveryAssessment.message]);
                const extra = (test.deliveryAssessment.channelAssessments ?? []).filter((assessment) => {
                  if (seen.has(assessment.message)) return false;
                  seen.add(assessment.message);
                  return true;
                });
                return extra.map((assessment) => <p key={assessment.channel} className="text-xs text-slate-300">{channelName(assessment.kind as InputTest['channels'][number]['kind'])}: {assessment.message}</p>);
              })()}
              {test.channels.map((channel) => <div data-technical-detail key={channel.channel} className="rounded-lg border border-slate-700 p-3">
                <p className="text-xs font-semibold text-slate-200">{channelName(channel.kind)} channel {channel.channel} · {channel.samples} messages</p>
                <p className="mt-1 text-sm text-cyan-200">{channel.eventHz === null ? 'More messages needed for a rate estimate' : `${channel.eventHz} Windows messages/s`}</p>
                {channel.hidReports != null && channel.hidReports > 0 && <p className="mt-1 text-xs text-slate-200">{channel.hidReports} HID reports{channel.reportHz != null ? ` · about ${channel.reportHz} reports/s` : ''}. Batched reports can exceed the message count.</p>}
                <p className="mt-1 text-[11px] text-slate-400">Observed span {formatMs(channel.activeDurationMs)} · median gap {formatMs(channel.medianGapMs)} · 95th percentile gap {formatMs(channel.p95GapMs)}</p>
              </div>)}
              <p data-technical-detail className="text-[11px] leading-relaxed text-slate-500">{test.method}</p>
            </div>}
          </div>
          {urgentLegacy.length > 0 && <div role="status" aria-label="Legacy recovery needs review" className="rounded-xl border border-amber-500/40 p-3 text-xs text-amber-100"><strong>Saved input recovery needs review.</strong>{urgentLegacy.map(item => <p key={item.id} className="mt-2">{item.name}: {item.beforeHz} to {item.afterHz} Hz · {item.status}. Original interval {item.beforeInterval ?? 'unknown'}; recorded interval {item.afterInterval ?? 'unknown'}.</p>)}<button type="button" className={button} onClick={() => setAdvanced(true)}>Show saved recovery</button></div>}
          {urgentTier.length > 0 && <div role="status" aria-label="Legacy tier recovery needs review" className="rounded-xl border border-amber-500/40 p-3 text-xs text-amber-100"><strong>Saved driver tier recovery needs review.</strong>{urgentTier.map(item => <p key={item.id}>{item.targetName}: {item.status}. Original PatchUSBXHCI {item.beforeSetting ?? 'unknown'}; recorded {item.afterSetting ?? 'unknown'}.</p>)}<button type="button" className={button} onClick={() => setAdvanced(true)}>Show saved tier recovery</button></div>}
          {restoreBlocked && <p role="status" className="rounded-xl border border-amber-500/30 p-3 text-xs text-amber-100">{inventory.legacyRestoreAuthority?.message}</p>}
          <details className="rounded-xl border border-slate-800 p-4" open={advanced} onToggle={(event) => { const open = event.currentTarget.open; setAdvanced(open); if (!open) { setPreview(null); setTierPreview(null); setDriverPreview(null); } }}>
            <summary className="cursor-pointer text-sm font-semibold text-slate-200">Existing-driver tools and maintenance{isolationRecovery.length ? ` · ${isolationRecovery.length} other-device recovery record(s)` : ''}</summary>
            {!legacyWrites && <p role="status" className="mt-3 rounded-lg border border-slate-700 p-3 text-xs text-slate-200">{inventory.legacyWriteMessage || 'Use Change rate above for new rate changes. These controls retain recovery for their own saved changes.'} Recovery remains subject to native machine-history checks.</p>}
            <p className="my-3 text-xs text-slate-400">Optional controls for an existing installation, shared-driver maintenance and signed-package recovery. Normal rate changes start with Change rate above.</p>
          <div className={box}><div className="flex flex-wrap items-start justify-between gap-2"><h3 className="font-semibold text-white">Existing-driver rate adjustment</h3><span data-technical-detail className="rounded-full bg-cyan-400/10 px-2 py-1 text-[11px] font-semibold text-cyan-200">CONFIGURE + CHECK</span></div>
            <p className="mt-3 text-[11px] uppercase tracking-wide text-slate-500">Current request</p><p className="mt-1 text-2xl font-bold text-white">{selected.configuredHz ? `${selected.configuredHz} Hz` : 'Unknown / default'}</p><p data-technical-detail className="mt-1 text-[11px] text-slate-500">This is the configured interval request, not proof of achieved device reports.</p>
            {selected.configuredHz && selected.maxSupportedHz && selected.configuredHz > selected.maxSupportedHz ? <p role="status" className="mt-2 rounded-lg border border-amber-500/25 bg-amber-950/15 p-3 text-xs leading-relaxed text-amber-100">The existing interval requests {selected.configuredHz} Hz, but the presumed current xHCI patch tier supports requests only up to {selected.maxSupportedHz} Hz. Do not treat the higher label as proof that Windows or the device is delivering it.</p> : null}
            <div data-technical-detail className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-5" aria-label="Polling evidence ladder">
              <div className="rounded-lg border border-slate-800 p-2.5"><p className="text-[11px] uppercase tracking-wide text-slate-500">1 · Request</p><p className="mt-1 text-xs font-semibold text-slate-100">{selected.configuredHz ? `${selected.configuredHz} Hz configured` : 'Unknown'}</p></div>
              <div className="rounded-lg border border-slate-800 p-2.5"><p className="text-[11px] uppercase tracking-wide text-slate-500">2 · Driver tier</p><p className="mt-1 text-xs font-semibold text-slate-100">{tierRestartState === 'NONE' && inventory.driver.maxHighSpeedHz ? `Presumed up to ${inventory.driver.maxHighSpeedHz} Hz` : tierRestartState === 'NONE' ? 'Not established' : 'Restart check pending'}</p></div>
              <div className="rounded-lg border border-slate-800 p-2.5"><p className="text-[11px] uppercase tracking-wide text-slate-500">3 · Windows delivery</p><p className="mt-1 text-xs font-semibold text-slate-100">{test?.deliveryAssessment.observedHz ? `About ${test.deliveryAssessment.observedHz}/s observed` : test ? 'Inconclusive' : 'Not checked'}</p></div>
              <div className="rounded-lg border border-slate-800 p-2.5"><p className="text-[11px] uppercase tracking-wide text-slate-500">4 · USB transactions</p><p className="mt-1 text-xs font-semibold text-amber-200">Not measured</p></div>
              <div className="rounded-lg border border-slate-800 p-2.5"><p className="text-[11px] uppercase tracking-wide text-slate-500">5 · Latency</p><p className="mt-1 text-xs font-semibold text-amber-200">Not measured</p></div>
            </div>
            {showDriverLifecycle ? <div data-input-driver-lifecycle className={`mt-3 rounded-lg border p-3 text-xs leading-relaxed ${driverLifecycle?.status === 'UNAVAILABLE' ? 'border-amber-500/30 bg-amber-950/15 text-amber-100' : 'border-cyan-400/25 bg-cyan-950/10 text-slate-200'}`}>
              {!driverLifecycle ? <p role="status" className="text-slate-300">Checking standalone driver availability for this device…</p> : driverLifecycle.status === 'UNAVAILABLE' ? <div role="status"><p className="font-semibold">Signed-package maintenance is currently unavailable.</p><p className="mt-1">This separate signed-package maintenance route is unavailable in this build. Use Change rate above for bundled native setup when it is available.</p>{driverLifecycle.reasons.length ? <ul data-technical-detail className="mt-2 list-disc space-y-1 pl-4 text-[11px] text-amber-100/80">{driverLifecycle.reasons.map((reason) => <li key={reason.code}>{reason.message}</li>)}</ul> : null}<details className="mt-2 text-[11px] text-amber-100/85"><summary className="cursor-pointer font-semibold">Why this is unavailable</summary><p className="mt-1">This maintenance route has its own package and executor requirements. Its availability does not describe the native setup button above.</p></details></div> : <>
                <div role="status"><p className="font-semibold text-white">{driverLifecycle.status === 'READY_FOR_PREFLIGHT' || driverLifecycle.status === 'REMOVED' ? 'Standalone driver setup is ready to review.' : driverLifecycle.status === 'EXTERNAL_PACKAGE_PRESENT' ? 'A matching signed driver package is already present.' : driverLifecycle.status === 'RESTART_REQUIRED' ? 'Windows restart and an exact recheck are required.' : driverLifecycle.status === 'NEEDS_REVIEW' ? 'The saved driver operation needs exact review.' : driverLifecycle.status === 'FILTER_DETACHED' ? 'The reviewed driver package is installed with no managed attachments.' : driverLifecycle.status === 'ACTIVE' || driverLifecycle.status === 'FILTER_ATTACHED' ? 'The reviewed driver scope is active.' : 'The protected driver lifecycle is waiting for an exact recheck.'}</p>
                  <p className="mt-1">{driverLifecycle.status === 'EXTERNAL_PACKAGE_PRESENT' ? 'Dialed can adopt only the selected existing attachment after review. It will not repair, upgrade, or remove an externally installed package.' : driverLifecycle.status === 'RESTART_REQUIRED' ? 'Dialed never restarts Windows automatically. Restart when convenient, return here, and recheck the saved operation before making another driver change.' : driverLifecycle.status === 'NEEDS_REVIEW' ? 'No additional driver change is allowed. Recheck the saved operation; any unresolved state remains blocked for manual recovery.' : driverLifecycle.status === 'FILTER_DETACHED' ? 'You can review a selected-device attachment, repair or upgrade only when explicitly permitted, or remove the package only after every attachment is proven absent.' : driverLifecycle.status === 'ACTIVE' || driverLifecycle.status === 'FILTER_ATTACHED' ? `Dialed is managing ${driverLifecycle.managedDeviceCount} selected device ${driverLifecycle.managedDeviceCount === 1 ? 'scope' : 'scopes'}. Exact detach and package maintenance remain separate reviewed actions.` : `Dialed will install or attach only the selected ${selected.name}, read back the result, and retain exact recovery state.`}</p>
                </div>
                {(driverLifecycle.capabilities.install || driverLifecycle.capabilities.adopt) ? driverRates.length ? <label className="mt-3 block max-w-xs text-[11px] text-slate-400">Polling request for this device<select aria-label="Choose a standalone driver polling request" value={driverRate} onChange={(event) => { setDriverRate(event.target.value ? Number(event.target.value) : ''); setDriverPreview(null); }} disabled={setupOpen || !!busy} style={{ colorScheme: 'dark' }} className="mt-1 block w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"><option className="bg-slate-950 text-white" value="">Choose a rate…</option>{driverRates.map((value) => <option className="bg-slate-950 text-white" key={value} value={value}>{value} Hz</option>)}</select></label> : <p className="mt-3 text-amber-200">This package has no reviewed request compatible with the selected device’s USB speed.</p> : null}
                <div className="mt-3 flex flex-wrap gap-2">
                  {driverLifecycle.capabilities.install ? <button type="button" disabled={setupOpen || !!busy || driverRate === '' || !driverRates.includes(driverRate)} className={primary} onClick={() => reviewDriverLifecycle(driverInstallAction)}><ShieldCheck className="h-4 w-4" />{driverInstallAction === 'INSTALL' ? 'Review driver setup' : 'Review device attachment'}</button> : null}
                  {driverLifecycle.capabilities.adopt ? <button type="button" disabled={setupOpen || !!busy || driverRate === '' || !driverRates.includes(driverRate)} className={primary} onClick={() => reviewDriverLifecycle('ADOPT')}><ShieldCheck className="h-4 w-4" />Review existing driver adoption</button> : null}
                  {driverLifecycle.capabilities.repair ? <button type="button" disabled={setupOpen || !!busy} className={button} onClick={() => reviewDriverLifecycle('REPAIR')}><RefreshCw className="h-3 w-3" />Review driver repair</button> : null}
                  {driverLifecycle.capabilities.upgrade ? <button type="button" disabled={setupOpen || !!busy} className={button} onClick={() => reviewDriverLifecycle('UPGRADE')}><RefreshCw className="h-3 w-3" />Review driver upgrade</button> : null}
                  {driverLifecycle.capabilities.detach ? <button type="button" disabled={setupOpen || !!busy} className={button} onClick={() => reviewDriverLifecycle('DETACH')}><RotateCcw className="h-3 w-3" />Review exact driver detach</button> : null}
                  {driverLifecycle.capabilities.removePackage ? <button type="button" disabled={setupOpen || !!busy} className={button} onClick={() => reviewDriverLifecycle('REMOVE_PACKAGE')}><RotateCcw className="h-3 w-3" />Review driver package removal</button> : null}
                  {['RESTART_REQUIRED', 'NEEDS_REVIEW'].includes(driverLifecycle.status) && driverLifecycle.operationId ? <button type="button" disabled={setupOpen || !!busy} className={primary} onClick={reconcileDriverLifecycle}><RefreshCw className="h-4 w-4" />{driverLifecycle.status === 'RESTART_REQUIRED' ? 'Check after restart' : 'Recheck saved driver operation'}</button> : null}
                </div>
                {driverLifecycle.reasons.length ? <ul className="mt-3 list-disc space-y-1 pl-4 text-[11px] text-amber-100">{driverLifecycle.reasons.map((reason) => <li key={reason.code}>{reason.message}</li>)}</ul> : null}
                {driverLifecycle.package ? <details data-technical-detail className="mt-3 text-[11px] text-slate-400"><summary className="cursor-pointer">Signed package evidence</summary><p className="mt-2">{driverLifecycle.package.packageId} · version {driverLifecycle.package.version}</p><p className="mt-1">Publisher: {driverLifecycle.package.publisher}</p><p className="mt-1">Attribution: {driverLifecycle.package.attribution}</p><p className="mt-1">Reviewed requests: {driverLifecycle.package.supportedPollingHz.join(', ')} Hz · maximum {driverLifecycle.package.maximumPollingHz} Hz.</p><p className="mt-1">Ownership: {driverLifecycle.ownership} · managed device count: {driverLifecycle.managedDeviceCount}.</p></details> : null}
              </>}
              {driverOutcome ? <div role="status" className={`mt-3 rounded-lg border p-3 ${driverOutcome.canceled ? 'border-slate-600 bg-slate-900/60 text-slate-200' : driverOutcome.restartRequired ? 'border-amber-500/30 bg-amber-950/15 text-amber-100' : 'border-emerald-500/25 bg-emerald-950/15 text-emerald-100'}`}><p className="font-semibold">{driverOutcome.canceled ? 'Nothing was applied.' : driverOutcome.restartRequired ? 'The driver operation was read back; Windows requires a restart.' : 'The driver operation was read back exactly.'}</p><p className="mt-1">{driverOutcome.summary} Dialed did not restart Windows or weaken a security setting.</p></div> : !driverOutcome && driverLifecycle?.lastOutcome?.outcome === 'CANCELLED' ? <div role="status" className="mt-3 rounded-lg border border-slate-600 bg-slate-900/60 p-3 text-slate-200"><p className="font-semibold">Nothing was applied.</p><p className="mt-1">The last administrator request was canceled before Windows changed driver state. Nothing changed; review it again when ready.</p><p data-technical-detail className="mt-2 text-[11px] text-slate-500">Canceled {driverLifecycle.lastOutcome.action.toLowerCase()} review · {new Date(driverLifecycle.lastOutcome.recordedAt).toLocaleString()}.</p></div> : null}
            </div> : null}
            {advanced && legacyWrites && <div className="mt-3 flex flex-wrap items-end gap-2"><label className="text-xs text-slate-400">Choose a different request<select aria-label="Choose a new polling-rate request" value={rate} onChange={(event) => { setRate(event.target.value ? Number(event.target.value) : ''); setPreview(null); }} disabled={setupOpen || !!busy || !selected.rates.length} style={{ colorScheme: 'dark' }} className="mt-1 block rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"><option className="bg-slate-950 text-white" value="">Choose a rate…</option>{selected.rates.map((value) => <option className="bg-slate-950 text-white" key={value} value={value}>{value} Hz{value === selected.configuredHz ? ' · current' : ''}</option>)}</select></label><button type="button" className={primary} disabled={setupOpen || !!busy || rate === '' || !selected.canApply || !selected.rates.includes(rate) || rate === selected.configuredHz} onClick={() => pollingPreview()}>Review rate change</button></div>}
            {advanced && selected.eligibilityReason && <p className="mt-3 flex gap-2 text-xs leading-relaxed text-amber-200"><CircleHelp className="mt-0.5 h-4 w-4 shrink-0" />{selected.eligibilityReason}</p>}
            <details data-technical-detail className="mt-3 text-[11px] leading-relaxed text-slate-400"><summary className="cursor-pointer">Supported setup &amp; driver details</summary><p className="mt-2">Driver: {inventory.driver.state || 'Unknown'} · {inventory.driver.tier || inventory.driver.mode || 'Unknown'} · {inventory.driver.signature === 'ValidMicrosoft' ? 'Microsoft signature verified' : 'Signature not verified'}</p><p className="mt-2">Post-restart presumed xHCI capability: {inventory.driver.maxHighSpeedHz ? `up to ${inventory.driver.maxHighSpeedHz} Hz requests` : 'not established'} · configured source: {inventory.driver.patchSource || 'unknown'}.</p><p className="mt-2">Dialed manages only an existing filter from one of four exact reviewed, Microsoft-valid upstream builds. Full-Speed choices remain 125–1000 Hz. High-Speed HIDUSBF request candidates expose 1/2/4/8 kHz only up to the post-restart presumed xHCI tier. Legacy maintenance retains exact recovery for its own recorded changes. New rate requests use the signed native setup path; an unavailable policy does not enable legacy writes.</p><p className="mt-2">Higher requests can add CPU and USB-controller work and may repeat unchanged reports. Configuration, tier preconditions and Windows event cadence are separate evidence; none alone proves fresh hardware reports or lower latency.</p><a href="https://github.com/LordOfMice/hidusbf" className="mt-2 inline-block text-cyan-300 underline" onClick={(event) => { if(api) { event.preventDefault(); void api.openExternalLink('https://github.com/LordOfMice/hidusbf').catch((caught) => setError(String(caught))); } }}>Original HIDUSBF project</a></details>
          </div>
          {driverPreview ? <div ref={driverConfirmationRef} tabIndex={-1} role="region" aria-labelledby="input-driver-confirmation-heading" className="rounded-xl border border-cyan-400/40 bg-cyan-400/5 p-4 focus:outline-none focus:ring-2 focus:ring-cyan-300/70"><h3 id="input-driver-confirmation-heading" className="font-semibold text-white">{driverActionTitle(driverPreview.action)}</h3><p className="mt-2 text-sm text-cyan-200">Affected scope: {driverPreview.action === 'REMOVE_PACKAGE' ? 'the detached Dialed-installed package; no filtered device may remain' : driverPreview.action === 'UPGRADE' ? 'all currently Dialed-managed device scopes' : driverPreview.action === 'REPAIR' ? `the exact saved Dialed driver scope, including ${selected.name}` : `${selected.name} only`}{driverPreview.requestedHz ? ` · ${driverPreview.requestedHz} Hz request` : ''}</p><ul className="mt-3 list-disc space-y-1 pl-4 text-xs leading-relaxed text-slate-300">{driverPreview.summary.map((item) => <li key={item}>{item}</li>)}</ul><p className="mt-3 text-xs leading-relaxed text-amber-100">{driverPreview.requiresElevation ? 'Windows will ask for administrator approval only after you confirm this preview. Canceling that prompt before a change means nothing is applied.' : 'This adoption records the exact existing scope and does not require a Windows driver mutation.'} {driverPreview.requiresRestart ? 'Windows may require a restart after readback; Dialed will never restart automatically.' : 'No restart is expected from this reviewed action.'}</p><p className="mt-2 text-xs leading-relaxed text-slate-300">The result confirms package and configuration state only. It does not prove USB transactions, fresh hardware reports, or lower latency.</p><p data-technical-detail className="mt-2 text-[11px] text-slate-500">Package {driverPreview.package.packageId} {driverPreview.package.version} · publisher {driverPreview.package.publisher} · preview expires {new Date(driverPreview.expiresAt).toLocaleTimeString()}.</p><div className="mt-3 flex flex-wrap gap-2"><button type="button" disabled={setupOpen || !!busy} className={primary} onClick={applyDriverLifecycle}><ShieldCheck className="h-4 w-4" />{driverPreview.requiresElevation ? 'Approve in Windows & apply' : 'Confirm exact adoption'}</button><button type="button" disabled={setupOpen || !!busy} className={button} onClick={() => setDriverPreview(null)}>Cancel</button></div></div> : null}
          {(advanced || recoverableTierChange) && <div className={box}>
            <div className="flex flex-wrap items-start justify-between gap-2"><div><h3 className="flex items-center gap-2 font-semibold text-white"><Gauge className="h-4 w-4 text-cyan-300" />{selected.filterActive ? 'Existing compatible high polling-rate driver' : 'Existing compatible driver — only for already filtered devices'}</h3><p className="mt-1 text-xs text-slate-400">{selected.filterActive ? 'Review changes that affect the shared driver. Device-only rate changes are available above.' : 'This device does not have the compatible filter attached. Use Set up polling rate above to inspect native setup availability.'}</p></div><span data-technical-detail className="rounded-full border border-slate-700 px-2 py-1 text-[11px] font-semibold text-slate-300">HIDUSBF · GLOBAL TO FILTERED HIGH-SPEED DEVICES</span></div>
            <div className="mt-3 grid gap-2 sm:grid-cols-3"><div className="rounded-lg border border-slate-800 p-3"><p className="text-[11px] uppercase tracking-wide text-slate-500">Driver setup</p><p className="mt-1 text-sm font-semibold text-white">{tierRestartState === 'NONE' && inventory.driver.activePatchUsbXhci === 3 ? '4–8 kHz ready' : tierLabel(inventory.driver.activePatchUsbXhci)}</p></div><div data-technical-detail className="rounded-lg border border-slate-800 p-3"><p className="text-[11px] uppercase tracking-wide text-slate-500">Configured tier</p><p className="mt-1 text-sm font-semibold text-white">{tierLabel(inventory.driver.patchUsbXhci)}</p></div><div data-technical-detail className="rounded-lg border border-slate-800 p-3"><p className="text-[11px] uppercase tracking-wide text-slate-500">Memory Integrity</p><p className={`mt-1 text-sm font-semibold ${memoryIntegrity === 'Disabled' ? 'text-slate-200' : 'text-amber-200'}`}>{memoryIntegrity}</p></div></div>
            {tierRestartState !== 'NONE' ? <div role="status" className="mt-3 rounded-lg border border-amber-500/25 bg-amber-950/15 p-3 text-xs leading-relaxed text-amber-100"><strong>{tierRestartState === 'REBOOT_REQUIRED' ? 'Windows restart required.' : tierRestartState === 'VERIFY_AFTER_REBOOT' ? 'Post-restart check required.' : 'Tier recovery needs review.'}</strong> The configured Registry value is not being presented as the presumed active driver tier until the saved operation is reconciled. Dialed never restarts Windows automatically.{inventory.driver.tierHistoryId ? <button type="button" disabled={setupOpen || !!busy} className={`${button} mt-3`} onClick={() => reconcileTier(inventory.driver.tierHistoryId!)}><RefreshCw className="h-3 w-3" />{tierRestartState === 'VERIFY_AFTER_REBOOT' ? 'Check after restart' : 'Recheck saved tier'}</button> : null}</div> : null}
            <p className="mt-3 text-xs leading-relaxed text-slate-300">{tierRestartState === 'NONE' && inventory.driver.activePatchUsbXhci === 3 ? 'Driver setup is ready. Devices sharing this driver remain listed so recovery stays understandable.' : 'Before enabling 4–8 kHz, Dialed checks every device sharing this driver. Another High-Speed device above 1 kHz—or with an unknown effect—blocks the change.'}</p>
            <div className="mt-3 space-y-2" aria-label="Devices affected by the shared driver tier">{filteredDevices.map((device) => {
              const isTarget = device.id === selectedId;
              const state = isTarget ? 'Selected target' : device.speed === 'Full-Speed' ? 'Not accelerated by the High-Speed tier' : device.wouldExceed1k ? 'Would also request above 1 kHz — resolve first' : device.uncertainImpact ? 'Impact unknown — blocks setup' : 'Reviewed at 1 kHz';
              return <div key={device.id} className={`rounded-lg border p-3 ${isTarget ? 'border-cyan-400/35 bg-cyan-400/5' : device.wouldExceed1k || device.uncertainImpact ? 'border-amber-500/25 bg-amber-950/10' : 'border-slate-800'}`}><div className="flex flex-wrap items-start justify-between gap-2"><div><p className="text-xs font-semibold text-slate-100">{device.name}</p><p className="mt-1 text-[11px] text-slate-400">{state}</p><p data-technical-detail className="mt-1 text-[11px] text-slate-500">{device.speed} · {device.configuredHz ? `${device.configuredHz} Hz interval request` : 'interval unknown'}</p>{device.interfaceNames.length ? <p data-technical-detail className="mt-1 text-[11px] text-slate-500">Related interfaces: {device.interfaceNames.join(', ')}</p> : null}</div>{legacyWrites && !isTarget && device.wouldExceed1k ? <button type="button" disabled={setupOpen || !!busy || !device.canSetSafe1k} className={button} onClick={() => previewIsolation(device.id)}>Review 1 kHz isolation</button> : null}</div>{!isTarget && (device.wouldExceed1k || device.uncertainImpact) && device.safetyReason ? <p className="mt-2 text-[11px] text-amber-200">{device.safetyReason}</p> : null}</div>;
            })}</div>
            {!filteredDevices.length ? <p className="mt-3 text-xs text-amber-200">No exact filtered-device scope was available. Tier setup is unavailable.</p> : null}
            <div className="mt-3 flex flex-wrap gap-2">{legacyWrites && tierRestartState === 'NONE' && inventory.driver.patchUsbXhci !== 3 ? <button type="button" disabled={setupOpen || !!busy || !canReviewTier} className={primary} onClick={() => reviewTier()}><ShieldCheck className="h-4 w-4" />Review guarded 8 kHz setup</button> : null}{recoverableTierChange ? <button type="button" disabled={restoreBlocked || setupOpen || !!busy || !inventory.elevated} className={button} onClick={() => reviewTier(recoverableTierChange.targetDeviceId, recoverableTierChange.id)}><RotateCcw className="h-3 w-3" />Review driver restore</button> : null}</div>
            {recoverableTierChange?.status === 'SCOPE_DRIFT' ? <p role="alert" className="mt-2 rounded-lg border border-amber-500/30 bg-amber-950/15 p-3 text-[11px] leading-relaxed text-amber-100"><strong>Filtered-device scope changed after restart.</strong> {recoverableTierChange.scopeDrift || 'Review every affected device again.'} The higher tier is not presumed active. Exact tier restore is subject to native machine-history checks.</p> : null}
            {!inventory.elevated && tierRestartState === 'NONE' ? <p className="mt-2 text-[11px] text-amber-200">This session lacks administrator access. The packaged Dialed app requests it at launch. Scanning remains read-only.</p> : null}
            {memoryIntegrity !== 'Disabled' && selected?.speed === 'High-Speed' && selected.filterActive ? <MemoryIntegrityGuide state={memoryIntegrity} /> : memoryIntegrity !== 'Disabled' ? <p className="mt-2 flex gap-2 text-[11px] leading-relaxed text-amber-200"><TriangleAlert className="h-4 w-4 shrink-0" />Dialed will not disable or weaken Memory Integrity. Tier setup remains blocked while this protection is enabled, configured or unknown.</p> : null}
          </div>}
          {preview && <div role="region" aria-label="Confirm polling change" className="rounded-xl border border-cyan-400/40 bg-cyan-400/5 p-4"><h3 className="font-semibold text-white">{preview.action === 'RESTORE' ? 'Restore previous polling setting' : preview.action === 'ISOLATE' ? 'Confirm 1 kHz isolation setting' : 'Confirm polling change'}</h3><p className="mt-2 text-sm text-cyan-200">{preview.beforeHz} Hz → {preview.afterHz} Hz requested interval</p><p className="mt-2 text-xs leading-relaxed text-slate-300">{preview.name} only. The prior override is saved before writing. Reconnect this device afterward; Dialed will not restart devices automatically. Keep another way to control your PC available. A successful readback confirms configuration only, not the achieved report rate or a latency improvement.</p>{preview.action === 'ISOLATE' ? <p className="mt-2 text-xs leading-relaxed text-amber-100">This is a prerequisite, not an optimization claim: it prevents this other filtered High-Speed device from being unintentionally raised when the shared 8 kHz tier is enabled later.</p> : null}<div className="mt-3 flex flex-wrap gap-2"><button type="button" disabled={setupOpen || !!busy} className={primary} onClick={apply}><ShieldCheck className="h-4 w-4" />{preview.action === 'RESTORE' ? 'Confirm restore' : preview.action === 'ISOLATE' ? 'Save prior setting & isolate' : 'Save previous setting & apply'}</button><button type="button" disabled={setupOpen || !!busy} className={button} onClick={() => setPreview(null)}>Cancel</button></div></div>}
          {tierPreview && <div role="region" aria-label="Confirm global xHCI tier change" className="rounded-xl border border-amber-400/40 bg-amber-950/15 p-4"><h3 className="font-semibold text-white">{tierPreview.action === 'RESTORE' ? 'Restore the previous shared driver tier' : 'Confirm global 4–8 kHz tier setup'}</h3><p className="mt-2 text-sm text-amber-100">{tierLabel(tierPreview.beforeTier)} → {tierLabel(tierPreview.afterTier)}</p><p className="mt-2 text-xs leading-relaxed text-slate-300">Target: {tierPreview.targetName}. This writes one fixed PatchUSBXHCI DWORD for the existing driver. It does not install a driver, change filters, restart devices, weaken Windows security or reboot automatically. The exact prior value—or absence—and the complete filtered-device audit are saved first.</p><div className="mt-3 space-y-1 text-[11px] text-slate-400">{tierPreview.affectedDevices.map((item) => <p key={item.id}>• {item.name}: {item.isTarget ? 'selected target' : `${item.speed}, ${item.configuredHz ? `${item.configuredHz} Hz request` : 'unknown request'}`}</p>)}</div><p className="mt-3 text-xs font-semibold text-amber-100">A Windows restart and explicit post-restart driver/scope check are required before Dialed treats the higher tier as presumed active. USB delivery remains a separate result.</p><div className="mt-3 flex flex-wrap gap-2"><button type="button" disabled={setupOpen || !!busy} className={primary} onClick={applyTier}><ShieldCheck className="h-4 w-4" />{tierPreview.action === 'RESTORE' ? 'Save state & restore tier' : 'Save state & configure tier'}</button><button type="button" disabled={setupOpen || !!busy} className={button} onClick={() => setTierPreview(null)}>Cancel</button></div></div>}
          {!!isolationRecovery.length && <div className={box}><h3 className="text-sm font-semibold text-white">Other-device recovery</h3><p className="mt-1 text-[11px] text-slate-400">These devices were kept at 1 kHz so the shared driver change would not raise them unintentionally.</p><div className="mt-2 space-y-2">{isolationRecovery.slice(0, 5).map((item) => <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-800 p-3"><div><p className="text-xs font-semibold text-slate-200">{item.name}</p><p className="mt-1 text-[11px] text-slate-400">{item.beforeHz} → {item.afterHz} Hz · {item.status}. Original interval {item.beforeInterval ?? 'unknown'}; recorded interval {item.afterInterval ?? 'unknown'}.</p></div><div className="flex flex-wrap gap-2">{['PENDING', 'NEEDS_REVIEW'].includes(item.status) ? <button type="button" disabled={setupOpen || !!busy} onClick={() => reconcile(item.id)} className={button}><RefreshCw className="h-3 w-3" />Recheck</button> : null}<button type="button" disabled={restoreBlocked || setupOpen || !!busy || item.status !== 'CONFIGURED'} onClick={() => restoreFiltered(item.deviceId, item.id)} className={button}><RotateCcw className="h-3 w-3" />Review exact restore</button></div></div>)}</div></div>}
          </details>
          {!!recovery.length && <div className={box}><h3 className="text-sm font-semibold text-white">Previous settings &amp; recovery</h3><div className="mt-2 space-y-2">{recovery.slice(0, 5).map((item) => <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-800 p-3"><div><p className="text-xs text-slate-200">{item.beforeHz} → {item.afterHz} Hz · intervals {item.beforeInterval ?? 'unknown'} → {item.afterInterval ?? 'unknown'}</p><p className={`mt-1 text-[11px] ${item.status === 'CONFIGURED' ? 'text-slate-400' : 'text-amber-200'}`}>{item.status === 'CONFIGURED' ? 'Saved configuration' : 'Interrupted or unverified — review required'}</p></div><div className="flex flex-wrap gap-2">{['PENDING', 'NEEDS_REVIEW'].includes(item.status) && <button type="button" disabled={setupOpen || !!busy} onClick={() => reconcile(item.id)} className={button}><RefreshCw className="h-3 w-3" />Recheck saved change</button>}<button type="button" disabled={restoreBlocked || setupOpen || !!busy || item.status !== 'CONFIGURED'} onClick={() => pollingPreview(item.id)} className={button}><RotateCcw className="h-3 w-3" />Review restore</button></div></div>)}</div></div>}
        </>}
      </div>}
    </div>}
    </TabPanel>
    <div data-hidusbf-credit className="mt-5 rounded-xl border border-slate-800 bg-slate-950/40 p-4">
      <h3 className="text-sm font-semibold text-white">Built on HIDUSBF</h3>
      <p className="mt-1 text-xs leading-relaxed text-slate-400">The high polling-rate kernel filter driver behind this workspace is HIDUSBF, created by SweetLow and maintained by LordOfMice. Dialed did not write it and does not modify it. The setup flow, safety checks, recovery and interface around it are Dialed&apos;s own work.</p>
      <a
        href={HIDUSBF_PROJECT_URL}
        className="mt-2 inline-flex items-center gap-1 rounded text-xs font-semibold text-cyan-300 underline underline-offset-2"
        onClick={(event) => { if (api) { event.preventDefault(); void api.openExternalLink(HIDUSBF_PROJECT_URL).catch((caught) => setError(String(caught))); } }}
      >
        <ExternalLink className="h-3 w-3" aria-hidden="true" />Official HIDUSBF project on GitHub
      </a>
    </div>
    {busy && !isInputTesting && <p role="status" className="mt-4 flex items-start gap-2 rounded-lg bg-cyan-400/5 p-3 text-xs text-cyan-200"><LoaderCircle className="h-4 w-4 shrink-0 animate-spin" />{busy}</p>}
    {status && <p role="status" className="mt-3 flex gap-2 rounded-lg border border-emerald-400/20 p-3 text-xs text-emerald-200"><Check className="h-4 w-4 shrink-0" />{status}</p>}
    {error && <p role="alert" className="mt-3 rounded-lg border border-rose-400/30 bg-rose-950/20 p-3 text-xs text-rose-200"><ErrorText text={error} /></p>}
  </section>;
}

/**
 * Shown only when someone is trying the higher shared driver tier on an eligible device
 * and Memory Integrity is not off. Dialed never changes Memory Integrity; this explains the
 * trade-off and opens the Windows page where the person can decide for themselves.
 */
function MemoryIntegrityGuide({ state }: { state: string }) {
  const [openError, setOpenError] = useState<string | null>(null);
  const open = async () => {
    setOpenError(null);
    try { await window.pcOptiNative?.openWindowsSettings('core-isolation'); }
    catch { setOpenError('Windows Security could not be opened. Open it from the Start menu: Windows Security › Device security › Core isolation details.'); }
  };
  return <div role="note" className="mt-3 rounded-lg border border-amber-500/30 bg-amber-950/15 p-3 text-xs leading-relaxed text-amber-100">
    <p className="flex gap-2 font-semibold"><TriangleAlert className="h-4 w-4 shrink-0" />Rates above 1 kHz need Memory Integrity turned off (it is {state.toLowerCase()} now)</p>
    <ul className="mt-2 list-disc space-y-1 pl-5 text-amber-100/90">
      <li><strong>Why:</strong> the higher shared tier uses a HIDUSBF “patching” build, which changes the Windows USB controller driver in memory. Memory Integrity exists to block exactly that kind of kernel change, so the two cannot run together.</li>
      <li><strong>What you give up:</strong> Memory Integrity stops malicious or vulnerable drivers from tampering with the Windows kernel. With it off, a bad driver has an easier way in. Microsoft recommends keeping it on.</li>
      <li><strong>The alternative:</strong> HIDUSBF “NoPatch” builds work with Memory Integrity on, but cannot reach the higher controller rates. For many mice, 1 kHz is already the device’s limit.</li>
      <li><strong>If you go ahead:</strong> turn it off yourself in Windows Security, restart, then come back here. If you later stop using the higher rate, turn Memory Integrity back on.</li>
    </ul>
    <p className="mt-2 text-amber-100/90">Dialed does not change Memory Integrity or ask Windows to. This button only opens the page.</p>
    <button type="button" onClick={() => void open()} className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-amber-400/40 px-3 py-1.5 font-semibold text-amber-100 hover:bg-amber-400/10">Open Core isolation settings</button>
    {openError && <p role="alert" className="mt-2 text-amber-200"><ErrorText text={openError} /></p>}
  </div>;
}
