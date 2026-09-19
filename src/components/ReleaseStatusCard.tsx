import { useState } from 'react';
import { BadgeCheck, Download, RefreshCw, ShieldAlert, Upload } from 'lucide-react';
import type { ReleaseStatus, UpdateCheckResult, UpdateDownloadResult } from '../types';
import { useConfirm } from './ConfirmContext';

interface ReleaseStatusCardProps {
  status: ReleaseStatus | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
}

function formatBytes(bytes: number) {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

function signatureLabel(status: ReleaseStatus | null) {
  const value = status?.signature.status.toLowerCase();
  if (value === 'valid') return 'Signed and verified';
  if (value === 'notsigned') return 'Unsigned test build';
  if (value === 'not_applicable') return 'Development preview';
  if (value === 'unavailable') return 'Signature unavailable';
  if (value === 'unknown' || value === 'unknownerror') return 'Unsigned or unverified';
  return status?.signature.status || 'Unavailable';
}

function updaterLabel(status: ReleaseStatus | null) {
  if (status?.update.status === 'READY') return 'Ready';
  if (status?.update.status === 'UNCONFIGURED') return 'Not configured';
  if (status?.update.status === 'INVALID_CONFIGURATION') return 'Configuration needs review';
  return 'Unavailable';
}

export function ReleaseStatusCard({ status, loading, error, onRefresh }: ReleaseStatusCardProps) {
  const [updateCheck, setUpdateCheck] = useState<UpdateCheckResult | null>(null);
  const [download, setDownload] = useState<UpdateDownloadResult | null>(null);
  const [updateBusy, setUpdateBusy] = useState(false);
  const confirm = useConfirm();
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [updateMessage, setUpdateMessage] = useState<string | null>(null);
  const signatureValid = status?.signature.status.toLowerCase() === 'valid';
  const configurationReady = status?.update.status === 'READY';

  const checkForUpdates = async () => {
    if (!window.pcOptiNative || !status?.updateCheckAvailable || updateBusy) return;
    setUpdateBusy(true); setUpdateError(null); setUpdateMessage(null); setUpdateCheck(null); setDownload(null);
    try {
      const result = await window.pcOptiNative.checkForUpdates();
      setUpdateCheck(result);
      if (result.status === 'UP_TO_DATE') setUpdateMessage('This signed build is already at the feed’s current version.');
      if (result.status === 'FEED_OLDER_THAN_INSTALLED') setUpdateMessage('The trusted feed is older than this installed build; no downgrade is offered.');
    } catch (caught) {
      setUpdateError(caught instanceof Error ? caught.message : 'The update check failed. Nothing was downloaded.');
    } finally { setUpdateBusy(false); }
  };

  const downloadUpdate = async () => {
    if (!window.pcOptiNative || !updateCheck?.downloadToken || updateBusy) return;
    setUpdateBusy(true); setUpdateError(null); setUpdateMessage(null);
    try {
      const result = await window.pcOptiNative.downloadUpdate(updateCheck.downloadToken);
      setDownload(result);
      setUpdateCheck(null);
      setUpdateMessage('The installer bytes, SHA-256, Windows publisher and timestamp all verified. Installation has not started.');
    } catch (caught) {
      setUpdateError(caught instanceof Error ? caught.message : 'The update could not be downloaded or verified, so it was not opened.');
    } finally { setUpdateBusy(false); }
  };

  const launchInstaller = async () => {
    if (!window.pcOptiNative || !download?.installToken || updateBusy) return;
    const confirmed = await confirm({
      title: `Open the verified ${download.fileName} installer?`,
      description: 'The installer file, its SHA-256 hash and its Windows signature were verified.',
      details: `${download.fileName}\nSHA-256 ${download.sha256}`,
      notice: 'Windows may show an administrator prompt. Dialed does not install silently, close itself or reboot; finish or cancel in the installer window.',
      confirmLabel: 'Open installer',
    });
    if (!confirmed) return;
    setUpdateBusy(true); setUpdateError(null);
    try {
      await window.pcOptiNative.launchUpdateInstaller(download.installToken);
      setDownload(null);
      setUpdateMessage('Windows was asked to open the re-verified installer. Complete or cancel the installer in its own window.');
    } catch (caught) {
      setUpdateError(caught instanceof Error ? caught.message : 'The verified installer could not be opened.');
    } finally { setUpdateBusy(false); }
  };

  const unavailableDetail = status?.update.status === 'UNCONFIGURED'
    ? `Missing release trust: ${status.update.missingFields.join(', ')}.`
    : status?.update.status === 'INVALID_CONFIGURATION'
      ? status.update.errors.join(' ')
      : !status?.packaged ? 'Development previews cannot use the release updater.' : '';

  return <section className="mb-6 rounded-2xl border border-slate-800 bg-slate-900/70 p-5 shadow-xl">
    <div className="flex flex-col justify-between gap-4 md:flex-row md:items-start"><div><p className="text-xs font-semibold uppercase tracking-wider text-cyan-300">Version and updates</p><h2 className="mt-1 text-xl font-bold text-white">Updates you control</h2><p className="mt-1 max-w-3xl text-xs leading-relaxed text-slate-400">Dialed only checks for updates when you ask, and verifies every download is genuine before it opens. Nothing downloads or installs in the background.</p></div><button type="button" onClick={onRefresh} disabled={loading || !window.pcOptiNative} className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-200 disabled:opacity-50"><RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />{loading ? 'Checking…' : 'Refresh'}</button></div>
    <div className="mt-4 grid gap-3 md:grid-cols-3">
      <article className="rounded-xl border border-slate-800 bg-slate-950/45 p-4"><p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Version</p><p className="mt-2 text-lg font-bold text-slate-100">{status?.version || 'Unavailable'}</p><p className="mt-1 text-[11px] text-slate-500">{status?.packaged ? status.executableName : 'Browser or development preview'}</p></article>
      <article className={`rounded-xl border p-4 ${signatureValid ? 'border-emerald-500/25 bg-emerald-950/15' : 'border-amber-500/25 bg-amber-950/10'}`}><p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">This copy of Dialed</p><p className={`mt-2 text-lg font-bold ${signatureValid ? 'text-emerald-200' : 'text-amber-200'}`}>{signatureLabel(status)}</p><p className="mt-1 break-words text-[11px] text-slate-500">{status?.signature.signerSubject || (status?.packaged ? 'This build is not signed for public release yet.' : 'Signing is checked only on a packaged Dialed executable.')}</p><details data-technical-detail className="mt-2 text-[11px] text-slate-500"><summary className="cursor-pointer text-slate-400">Technical details</summary><p className="mt-1 break-words">{status?.signature.status || 'Unavailable'} · {status?.signature.statusMessage || 'No status detail returned.'}</p></details></article>
      <article className={`rounded-xl border p-4 ${configurationReady ? 'border-emerald-500/25 bg-emerald-950/15' : 'border-amber-500/25 bg-amber-950/10'}`}><p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Updater trust</p><p className={`mt-2 text-sm font-bold ${configurationReady ? 'text-emerald-200' : 'text-amber-200'}`}>{updaterLabel(status)}</p><p className="mt-1 text-[11px] leading-relaxed text-slate-500">{configurationReady ? `${status?.update.feedHost} · ${status?.update.channel} · no background activity` : 'Updates stay disabled until release trust is configured and verified.'}</p>{unavailableDetail ? <details data-technical-detail className="mt-2 text-[11px] text-slate-500"><summary className="cursor-pointer text-slate-400">Technical details</summary><p className="mt-1 break-words">{unavailableDetail}</p></details> : null}</article>
    </div>
    <div className={`mt-3 flex gap-2 rounded-lg border p-3 text-xs leading-relaxed ${signatureValid && configurationReady ? 'border-emerald-500/20 bg-emerald-950/10 text-emerald-100/80' : 'border-amber-500/20 bg-amber-950/10 text-amber-100/80'}`}>{signatureValid && configurationReady ? <BadgeCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" /> : <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />}{signatureValid && configurationReady ? 'The running package and release trust are available. Every later check is repeated before download and installer launch.' : 'Updates are available only in the signed release version of Dialed.'}</div>
    {status?.signature.timestampSubject ? <p data-technical-detail className="mt-2 break-words text-[11px] text-slate-600">Timestamp certificate: {status.signature.timestampSubject}</p> : null}
    <div className="mt-4 flex flex-wrap gap-2">
      <button type="button" onClick={checkForUpdates} disabled={!status?.updateCheckAvailable || updateBusy || !window.pcOptiNative} className="inline-flex items-center gap-2 rounded-lg border border-cyan-500/25 bg-cyan-500/10 px-3 py-2 text-xs font-semibold text-cyan-100 disabled:cursor-not-allowed disabled:opacity-40"><RefreshCw className={`h-3.5 w-3.5 ${updateBusy ? 'animate-spin' : ''}`} />Check for updates</button>
      {updateCheck?.status === 'UPDATE_AVAILABLE' && updateCheck.release ? <button type="button" onClick={downloadUpdate} disabled={updateBusy} className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-xs font-semibold text-emerald-100 disabled:opacity-40"><Download className="h-3.5 w-3.5" />Download {updateCheck.release.version} · {formatBytes(updateCheck.release.sizeBytes)}</button> : null}
      {download ? <button type="button" onClick={launchInstaller} disabled={updateBusy} className="inline-flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs font-semibold text-amber-100 disabled:opacity-40"><Upload className="h-3.5 w-3.5" />Install update</button> : null}
    </div>
    {updateCheck?.release ? <div className="mt-3 rounded-lg border border-slate-800 bg-slate-950/45 p-3 text-[11px] leading-relaxed text-slate-400"><strong className="text-slate-200">{updateCheck.release.fileName}</strong><br />Published {new Date(updateCheck.release.publishedAt).toLocaleString()} · SHA-256 {updateCheck.release.sha256.slice(0, 16)}… · Publisher {updateCheck.release.signerSubject}</div> : null}
    {download ? <div className="mt-3 rounded-lg border border-emerald-500/20 bg-emerald-950/10 p-3 text-[11px] leading-relaxed text-emerald-100/80"><strong>{download.fileName}</strong> is ready for an explicit installer launch. SHA-256 {download.sha256.slice(0, 16)}… · certificate {download.signature.signerThumbprint.slice(0, 12)}…</div> : null}
    {updateMessage ? <p role="status" className="mt-3 rounded-lg border border-cyan-500/20 bg-cyan-950/15 p-3 text-xs text-cyan-100/80">{updateMessage}</p> : null}
    {error || updateError ? <p role="alert" className="mt-3 rounded-lg border border-rose-500/25 bg-rose-950/20 p-3 text-xs text-rose-200">{error || updateError}</p> : null}
  </section>;
}
