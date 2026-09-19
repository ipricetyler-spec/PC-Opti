import { ErrorText } from './ErrorText';
import { useEffect, useState } from 'react';
import type { BundledInputStatus as BundleStatus, InputDevice } from '../lib/inputDevices';

export function BundledInputStatus({ device, busy = false, setupOpen = false, onSetupStateChange }: { device: InputDevice; busy?: boolean; setupOpen?: boolean; onSetupStateChange?: (open: boolean) => void }) {
  const [bundle, setBundle] = useState<BundleStatus | null>(null);
  const [error, setError] = useState('');
  const [opening, setOpening] = useState(false);
  const verified = bundle?.identity === 'VERIFIED';
  const policyExpired = bundle?.nativeBroker?.code === 'NATIVE_RELEASE_REJECTED' && /expir/i.test(bundle.nativeBroker.message);
  const statusMessage = verified
    ? bundle?.nativeBroker?.available ? 'Setup is ready to review this device. Nothing changes until you confirm.' : 'Driver setup is currently unavailable.'
    : error || (bundle ? 'The bundled files did not pass verification.' : 'Checking bundled files…');
  const supportedSpeed = device.speed === 'Full-Speed' || device.speed === 'High-Speed';
  const setupBlocked = opening || busy || setupOpen || !bundle?.nativeBroker?.available || !verified || !supportedSpeed;
  const setupBlockReason = !verified
    ? bundle?.reasons.find((reason) => reason.code === 'BUNDLE_IDENTITY_FAILED')?.message || ''
    : !bundle?.nativeBroker?.available
      ? bundle?.nativeBroker?.message || bundle?.reasons.find((reason) => reason.code === 'AUTHENTICATED_NATIVE_HELPER_REQUIRED')?.message || ''
      : !supportedSpeed ? 'Rate changes are unavailable for this USB speed. You can still check Windows input delivery.' : '';
  async function openSetup() {
    setOpening(true); setError(''); onSetupStateChange?.(true);
    try {
      if (!window.pcOptiNative?.openBundledInputSetup) throw new Error('Native setup is unavailable in this desktop build.');
      await window.pcOptiNative.openBundledInputSetup(device.id);
    } catch (cause) { onSetupStateChange?.(false); setError(cause instanceof Error ? cause.message : 'Native setup could not open.'); }
    finally { setOpening(false); }
  }
  useEffect(() => {
    let mounted = true;
    const read = window.pcOptiNative?.getBundledInputStatus;
    if (!read) { setError('Open the updated desktop app to verify its bundled files.'); return; }
    void read().then((value) => { if (mounted) setBundle(value); }, () => { if (mounted) setError('Bundled driver verification is unavailable. No setting was changed.'); });
    return () => { mounted = false; };
  }, []);
  return <section aria-label="Bundled HIDUSBF setup" className="min-w-0 rounded-xl border border-slate-800 bg-slate-950/50 p-4">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0"><p className="text-xs text-slate-400">Selected device</p><h3 className="mt-1 text-lg font-semibold text-white">{device.name}</h3><p className="mt-1 text-xs text-slate-400">{device.speed} USB{device.portLabel ? ` · ${device.portLabel}` : ''}</p></div>
      <div><p className="text-xs text-slate-400">Saved rate</p><p className="mt-1 text-2xl font-bold text-white">{device.configuredHz === null ? 'Default / unknown' : `${device.configuredHz} Hz`}</p></div>
    </div>
    {device.speed === 'Low-Speed' && <p className="mt-3 text-xs text-slate-300">Low-Speed USB is not supported by this rate-change workflow. You can still check key, button or movement activity below.</p>}
    <button type="button" onClick={() => void openSetup()} disabled={setupBlocked} style={{ opacity: setupBlocked ? 0.45 : 1 }} aria-describedby={setupBlocked && setupBlockReason ? 'bundled-input-setup-blocked-reason' : undefined} className="mt-4 rounded-lg border border-cyan-300 bg-cyan-400 px-4 py-2.5 text-sm font-bold text-slate-950 shadow-sm enabled:hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300 disabled:cursor-not-allowed disabled:border-slate-700 disabled:bg-slate-800 disabled:text-slate-400 disabled:shadow-none">{opening ? 'Opening setup…' : setupOpen ? 'Setup is open…' : device.filterActive ? 'Change rate…' : 'Set up polling rate…'}</button>
    {setupBlocked && setupBlockReason && <p id="bundled-input-setup-blocked-reason" className="mt-2 text-xs text-slate-400">{setupBlockReason}</p>}
    {policyExpired && <p role="status" className="mt-3 text-xs text-amber-100">The native rate-change policy has expired. No rate-change path is available until an authorized policy update. Scanning and input checks remain available; legacy controls are not a fallback.</p>}
    <p id="bundled-input-setup-status" role="status" aria-live="polite" aria-atomic="true" className="mt-2 text-xs text-slate-300">{statusMessage}</p>
    <p className="mt-2 text-xs text-slate-400">Confirm this device in setup. Dialed checks whether its originals are already recorded and shows the applicable rates.</p>
    {error && <p role="alert" className="mt-2 text-xs text-amber-200"><ErrorText text={error} /></p>}
    <div className="mt-3 rounded-lg border border-slate-800 p-3"><p className="text-xs font-semibold text-slate-200">Reconnect status</p><p className="mt-1 text-xs text-slate-400">{setupOpen ? 'Follow the current instruction in setup. Leave it open through the reconnect check.' : 'Reported in the setup window. A saved rate or a closed window alone does not verify reconnect.'}</p></div>
    <details className="mt-4 border-t border-slate-800 pt-3"><summary className="cursor-pointer text-xs font-semibold text-slate-300">Driver setup and compatibility details</summary>
    {bundle && <>
      <p className="mt-3 text-xs text-slate-400">HIDUSBF by SweetLow / LordOfMice · {verified ? 'unchanged upstream files verified' : 'file verification failed'}. Compatibility below describes broader validation, not the result of your last rate change.</p>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">{bundle.rates.map((rate) => <div key={rate.hz} className="rounded-lg border border-slate-700 p-2"><p className="text-sm font-semibold text-white">{rate.hz / 1000} kHz</p><p className="mt-1 text-xs text-amber-200">{!verified ? 'Unavailable — bundle verification failed' : device.speed === 'Low-Speed' ? 'Unsupported by Low-Speed setup' : device.speed === 'Full-Speed' && rate.hz > 1000 ? 'Unsupported at Full-Speed' : 'Not yet validated'}</p></div>)}</div>
      <ul className="mt-3 list-disc space-y-1 pl-4 text-xs leading-relaxed text-slate-300">{bundle.reasons.map((reason) => <li key={reason.code}>{reason.message}</li>)}</ul>
      {bundle.nativeBroker && <p className="mt-2 text-xs text-slate-400">{bundle.nativeBroker.message}</p>}
      <p className="mt-2 text-xs leading-relaxed text-slate-400">Higher-rate patching variants cannot run with Memory Integrity enabled. Dialed will not change that protection. Full-Speed devices cannot inherit High-Speed 8 kHz support.</p>
    </>}
    <p className="mt-3 text-xs leading-relaxed text-slate-400">Use the delivery test below to measure Windows input events separately. Independent USB transaction evidence and physical latency remain untested.</p>
    </details>
  </section>;
}
