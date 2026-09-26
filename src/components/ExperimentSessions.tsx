import { ErrorText } from './ErrorText';
import { useState } from 'react';
import type { AuditJournalEntry, BenchmarkEvidenceState, PresentMonCaptureEntry, BenchmarkImportPreview } from '../types';
import { SESSION_KEY, SESSION_SELECTION_KEY, SESSION_RECOVERY_KEY, recoverSessionStorage, selectedSessionId, parseSessions, previewSessionImport, sessionPairIssue, sessionCaptureIds, sameCaptureGroup, type ExperimentSession } from '../lib/experimentSessions';

export function ExperimentSessions({ history, evidence, onNavigate, onCompare }: {
  history: AuditJournalEntry[]; evidence: BenchmarkEvidenceState;
  onNavigate: (destination: 'optimize' | 'measure' | 'history', evidenceId?: string) => void;
  onCompare: (preview: BenchmarkImportPreview, session: ExperimentSession) => void;
}) {
  const [initial] = useState(() => { try { return { sessions: parseSessions(localStorage.getItem(SESSION_KEY)), error: '' }; } catch { return { sessions: [] as ExperimentSession[], error: 'Saved sessions could not be read. They have been preserved; new saves are disabled.' }; } });
  const [sessions, setSessions] = useState(initial.sessions);
  const [activeId, setActiveId] = useState(() => { try { return selectedSessionId(initial.sessions, localStorage.getItem(SESSION_SELECTION_KEY)); } catch { return selectedSessionId(initial.sessions, null); } });
  const [storageBlocked, setStorageBlocked] = useState(!!initial.error);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmRecovery, setConfirmRecovery] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editWorkload, setEditWorkload] = useState('');
  const [editChange, setEditChange] = useState('');
  const [captures, setCaptures] = useState<PresentMonCaptureEntry[]>([]);
  const [error, setError] = useState(initial.error);
  const [importPreview, setImportPreview] = useState<ReturnType<typeof previewSessionImport> | null>(null);
  const [importRaw, setImportRaw] = useState('');
  const [busy, setBusy] = useState(false);
  const [workload, setWorkload] = useState('');
  const [change, setChange] = useState('');
  const active = sessions.find((item) => item.id === activeId);
  const save = (next: ExperimentSession[]) => {
    if (storageBlocked) return false;
    try { const raw = JSON.stringify(next); parseSessions(raw); localStorage.setItem(SESSION_KEY,raw); setSessions(next); setError(''); return true; }
    catch { setError('The session could not be saved. Previous saved progress was preserved.'); return false; }
  };
  const select = (id: string) => { setActiveId(id); setConfirmDelete(false); setEditing(false); try { localStorage.setItem(SESSION_SELECTION_KEY, id); } catch { setError('The selection could not be saved for your next visit.'); } };
  const exportSaved = (recovery = false) => { try { const raw = localStorage.getItem(recovery ? SESSION_RECOVERY_KEY : SESSION_KEY); if (raw === null && recovery) { setError('No recovery backup is stored.'); return; } const url = URL.createObjectURL(new Blob([raw || '[]'], {type:'application/json'})); const link = document.createElement('a'); link.href = url; link.download = recovery ? 'dialed-experiment-recovery.json' : 'dialed-experiment-sessions.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); } catch { setError('The local export could not be prepared. Existing data was preserved.'); } };
  const update = (patch: Partial<ExperimentSession>) => active && save(sessions.map((item) => item.id === active.id ? { ...item, ...patch } : item));
  const issue = active ? active.archived ? 'This session is archived. Restore it to prepare another comparison.' : sessionPairIssue(active,captures,history) : null;
  const comparison = active ? evidence.comparisons.find((item) => item.experimentId === active.id
    && item.baseline?.workload === active.workload && item.candidate?.workload === active.workload
    && item.baseline?.changeDescription === active.changeDescription && item.candidate?.changeDescription === active.changeDescription
    && (active.changeMode !== 'MANUAL' || Boolean(active.manualChangedAt && item.candidate?.notes.includes(active.manualChangedAt)))
    && sameCaptureGroup(item.baseline?.trialIds,sessionCaptureIds(active,'baseline'))
    && sameCaptureGroup(item.candidate?.trialIds,sessionCaptureIds(active,'candidate'))
    && (active.changeMode === 'MANUAL' ? !item.candidate?.linkedAuditEntryId : item.candidate?.linkedAuditEntryId === active.auditId)) : undefined;
  const refresh = async () => { if (!window.pcOptiNative) return; setBusy(true); try { setCaptures((await window.pcOptiNative.getPresentMonCaptureState()).entries); setError(''); } catch { setError('Saved captures could not be read. No capture was started.'); } finally { setBusy(false); } };
  const compare = async () => {
    if (!active || issue || !window.pcOptiNative) return;
    setBusy(true);
    try { const preview = await window.pcOptiNative.prepareNativePresentMonImport([...sessionCaptureIds(active,'baseline'),...sessionCaptureIds(active,'candidate')]); if (!preview.canceled) onCompare(preview,active); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Capture comparison could not be prepared.'); }
    finally { setBusy(false); }
  };
  const button = 'rounded-lg border border-cyan-400/30 px-3 py-2 text-xs font-semibold text-cyan-200 disabled:opacity-40';
  const field = 'mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-sm';
  return <section aria-label="Saved tests" className="mb-6 rounded-2xl border border-cyan-400/20 bg-slate-900/60 p-5">
    <h2 className="text-lg font-bold">Did this change help?</h2>
    <p className="mt-2 text-xs text-slate-400">Name the game or scene and the one change you are testing. Dialed keeps your progress so you can come back to it. It never makes the change or starts measuring for you.</p>
    <form className="mt-4 grid gap-3 sm:grid-cols-3" onSubmit={(event) => { event.preventDefault(); if (!workload.trim() || !change.trim() || sessions.length >= 20 || storageBlocked) return; const id = `session-${crypto.randomUUID()}`; if (save([{id,workload:workload.trim(),changeDescription:change.trim(),createdAt:new Date().toISOString(),baselineId:'',candidateId:'',auditId:'',decision:'UNDECIDED'},...sessions])) { select(id); setWorkload(''); setChange(''); } }}>
      <label className="text-xs">Game or scene<input required maxLength={160} className={field} value={workload} onChange={(event) => setWorkload(event.target.value)} /></label>
      <label className="text-xs">The one change you are testing<input required maxLength={240} className={field} value={change} onChange={(event) => setChange(event.target.value)} /></label>
      <button className={button} disabled={storageBlocked || sessions.length >= 20}>Start test</button>
    </form>
    <div className="mt-3 flex flex-wrap gap-2"><button className={button} onClick={() => exportSaved()}>Export tests</button><button className={button} onClick={() => exportSaved(true)}>Export recovery backup</button><span className="text-xs text-slate-400">Saves a file with your test notes.</span></div>
    <label className="mt-3 block text-xs">Import tests from a file<input type="file" accept=".json,application/json" disabled={storageBlocked} className={field} onChange={async (event) => { const file = event.target.files?.[0]; event.target.value = ''; setImportPreview(null); setImportRaw(''); if (!file) return; try { if (file.size > 64000) throw new Error('Session imports are limited to 64 KB.'); const raw = await file.text(); const preview = previewSessionImport(sessions,raw); setImportRaw(raw); setImportPreview(preview); setError(''); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Session import could not be read. Existing sessions were preserved.'); } }} /></label>
    {importPreview && <div className="mt-3 space-y-2 rounded-lg border border-cyan-400/30 p-3"><h3 className="text-sm font-semibold">Review imported tests</h3><p className="text-xs text-slate-400">{importPreview.added} new tests; {importPreview.skipped} identical ones skipped. Imported decisions are reset to undecided. Recordings and change-log records are not imported, so links need checking here. Nothing is applied or restored.</p><ul className="max-h-48 overflow-auto text-xs">{importPreview.sessions.filter(item => !sessions.some(saved => saved.id === item.id)).map(item => <li key={item.id} className="py-1">{item.archived ? '[Archived] ' : ''}{item.workload} · {item.changeDescription}</li>)}</ul><button className={button} disabled={storageBlocked || !importPreview.added} onClick={() => { try { const checked = previewSessionImport(sessions,importRaw); if (save(checked.sessions)) { setImportPreview(null); setImportRaw(''); if (!activeId) select(selectedSessionId(checked.sessions,null)); } } catch (reason) { setImportPreview(null); setImportRaw(''); setError(reason instanceof Error ? reason.message : 'Your saved tests changed. Preview the import again.'); } }}>Merge reviewed tests</button><button className={button} onClick={() => { setImportPreview(null); setImportRaw(''); }}>Cancel import</button></div>}
    {sessions.length >= 20 && <p className="mt-2 text-xs text-amber-200">20-session limit reached, including archived sessions. Export your notes, then delete a session to make room.</p>}
    {storageBlocked && <div className="mt-3 space-y-2"><p className="text-xs text-amber-200">Saved data is unreadable. Export it before recovery. Recovery also preserves the original content in a separate local backup and starts an empty session list.</p><label className="block text-xs"><input type="checkbox" checked={confirmRecovery} onChange={(event) => setConfirmRecovery(event.target.checked)} /> Start a new list while preserving the unreadable data</label><button className={button} disabled={!confirmRecovery} onClick={() => { try { recoverSessionStorage(localStorage); setSessions([]); setStorageBlocked(false); select(''); setError('Original data was preserved in the local recovery backup.'); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Recovery could not save its backup. The original data was preserved.'); } }}>Recover session storage</button></div>}
    {sessions.length > 0 && <label className="mt-4 block text-xs">Open a saved test<select aria-label="Open a saved test" className={field} value={activeId} onChange={(event) => select(event.target.value)}>{sessions.map((item) => <option key={item.id} value={item.id}>{item.archived ? '[Archived] ' : ''}{item.workload} — {item.changeDescription}</option>)}</select></label>}
    {active && <div className="mt-4 space-y-3">
      <div className="flex flex-wrap gap-2"><button className={button} onClick={() => { setEditWorkload(active.workload); setEditChange(active.changeDescription); setEditing(true); }}>Edit session notes</button><button className={button} onClick={() => update({archived:!active.archived})}>{active.archived ? 'Restore archived session' : 'Archive session'}</button><button className={button} onClick={() => setConfirmDelete(true)}>Delete session</button></div>
      {editing && <form className="grid gap-2" onSubmit={(event) => { event.preventDefault(); if (!editWorkload.trim() || !editChange.trim()) return; if (save(sessions.map((item) => item.id === active.id ? {...item,workload:editWorkload.trim(),changeDescription:editChange.trim(),decision:'UNDECIDED'} : item))) setEditing(false); }}><label className="text-xs">Session workload<input className={field} required maxLength={160} value={editWorkload} onChange={(event) => setEditWorkload(event.target.value)} /></label><label className="text-xs">Session change notes<input className={field} required maxLength={240} value={editChange} onChange={(event) => setEditChange(event.target.value)} /></label><p className="text-xs text-slate-400">Editing notes resets your decision. Previously imported comparison descriptions remain unchanged.</p><div className="flex gap-2"><button className={button}>Save session notes</button><button type="button" className={button} onClick={() => setEditing(false)}>Cancel edit</button></div></form>}
      {confirmDelete && <div className="space-y-2"><p className="text-xs text-amber-200">Delete this session's notes and links? Captures, comparisons and recovery history remain available. Export first if you want to keep these notes.</p><button className={button} onClick={() => { const next = sessions.filter((item) => item.id !== active.id); if (save(next)) select(selectedSessionId(next,null)); }}>Confirm delete session</button><button className={button} onClick={() => setConfirmDelete(false)}>Cancel delete</button></div>}

      <div className="flex flex-wrap gap-2"><button className={button} onClick={() => onNavigate('measure')}>1 · Record baseline / candidate</button><button className={button} onClick={() => onNavigate('optimize')}>2 · Review a change</button><button className={button} disabled={busy} onClick={refresh}>Read saved capture evidence</button></div>
      <label className="block text-xs">Change evidence<select className={field} value={active.changeMode || 'AUDIT'} onChange={(event) => update({changeMode:event.target.value as 'AUDIT' | 'MANUAL',auditId:'',manualChangedAt:'',decision:'UNDECIDED'})}><option value="AUDIT">Saved Dialed action</option><option value="MANUAL">Manual change — declared by you</option></select></label>
      {active.changeMode === 'MANUAL' && <p className="text-xs text-amber-200">Manual evidence is your declaration, not a verified Dialed action. Record the BIOS or vendor setting you changed and its previous value in the session notes. Restore it through the same tool; Dialed cannot automatically reverse this change.</p>}
      <p className="text-xs text-slate-400">Select one capture per phase for a descriptive comparison, or at least three per phase for repeated trials (20 total maximum). Hold Ctrl to select additional captures or use Shift with the arrow keys. Each run must use the same scene and requested duration.</p>
      <div className="grid gap-3 md:grid-cols-3">{(['baseline','candidate'] as const).map((phase) => {
        const selectedIds = sessionCaptureIds(active,phase);
        const otherIds = sessionCaptureIds(active,phase === 'baseline' ? 'candidate' : 'baseline');
        return <div key={phase}><label className="text-xs">{phase === 'baseline' ? 'Runs before the change' : 'Runs after the change'}<select multiple size={4} className={field} value={selectedIds} onChange={(event) => { const ids = Array.from(event.target.selectedOptions,option => option.value); update({[`${phase}Ids`]:ids,[`${phase}Id`]:ids[0] || '',decision:'UNDECIDED'}); }}>{selectedIds.filter(id => !captures.some(item => item.captureId === id && item.status === 'COMPLETE' && item.stopReason === 'TIMED' && item.protocolComplete === true)).map(id => <option key={id} value={id}>Saved choice · open the recording to check it</option>)}{captures.filter(item => item.status === 'COMPLETE' && item.stopReason === 'TIMED' && item.protocolComplete === true).map(item => <option key={item.captureId} value={item.captureId} disabled={otherIds.includes(item.captureId)}>{item.target.name} · {new Date(item.startedAt).toLocaleString()}</option>)}</select></label><p className="mt-1 text-xs text-slate-400">{selectedIds.length} selected</p><button className={button} onClick={() => update({[`${phase}Ids`]:[],[`${phase}Id`]:'',decision:'UNDECIDED'})}>Clear the {phase === 'baseline' ? 'before' : 'after'} runs</button></div>;
      })}
      {active.changeMode === 'MANUAL' ? <label className="text-xs">Manual change time (local)<input type="datetime-local" step="1" className={field} value={active.manualChangedAt ? (() => { const date = new Date(active.manualChangedAt!); return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0,19); })() : ''} onChange={(event) => { const entered = event.target.value; if (entered && !Number.isFinite(new Date(entered).getTime())) { setError('Enter a valid manual change time.'); return; } const timestamp = entered ? new Date(entered).toISOString() : ''; update({manualChangedAt:timestamp,decision:'UNDECIDED'}); }} /></label> : <label className="text-xs">Applied change<select className={field} value={active.auditId} onChange={(event) => update({auditId:event.target.value,decision:'UNDECIDED'})}><option value="">Select verified action</option>{active.auditId && !history.some((item) => item.id === active.auditId) && <option value={active.auditId}>Saved action missing — review history</option>}{history.filter((item) => item.status === 'SUCCESS').map((item) => <option key={item.id} value={item.id}>{item.title || item.id}</option>)}</select></label>}</div>
      <p className="text-xs text-slate-400">{issue || (active.changeMode === 'MANUAL' ? 'The capture sequence matches your declared change time. Dialed has not verified the manual setting or its application.' : 'Saved identities match this sequence. Confirm the actual scene and conditions in the comparison form; matching names do not prove identical conditions.')}</p>
      <button className={button} disabled={busy || !!issue} onClick={compare}>3 · Prepare linked comparison</button>
      {comparison && <p role="status" className="text-sm">Saved comparison: {comparison.classification} — {comparison.reason}</p>}
      <div className="flex flex-wrap gap-2"><button className={button} disabled={!comparison || !!issue} onClick={() => update({decision:'KEEP'})}>Record decision to keep</button><button className={button} onClick={() => { update({decision:'REVIEW_RESTORE'}); onNavigate('history',active.auditId || undefined); }}>{active.changeMode === 'MANUAL' ? 'Review history and manual restoration notes' : 'Review exact recovery'}</button></div>
      <p className="text-xs text-slate-400">Decision: {active.decision.replaceAll('_',' ').toLowerCase()}. This records your choice, not proof of improvement or a completed restore.</p>
    </div>}
    {error && <p role="alert" className="mt-3 text-sm text-amber-200"><ErrorText text={error} /></p>}
  </section>;
}
