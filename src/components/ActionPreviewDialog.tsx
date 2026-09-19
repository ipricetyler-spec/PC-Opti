import { AlertTriangle, ShieldCheck, X } from 'lucide-react';
import { useEffect, useRef } from 'react';

export interface ActionPreviewRequest {
  title: string;
  description: string;
  detailsLabel: string;
  details: string;
  notice: string;
  confirmLabel: string;
  tone?: 'default' | 'danger';
}

interface ActionPreviewDialogProps {
  request: ActionPreviewRequest;
  onCancel: () => void;
  onConfirm: () => void;
}

const FOCUSABLE_SELECTOR = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function ActionPreviewDialog({ request, onCancel, onConfirm }: ActionPreviewDialogProps) {
  const dialogRef = useRef<HTMLElement | null>(null);
  const cancelButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    cancelButtonRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onCancel();
        return;
      }
      if (event.key !== 'Tab') return;

      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !dialog.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, [onCancel, request]);

  const danger = request.tone === 'danger';
  return <div role="presentation" className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
    <section
      ref={dialogRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-labelledby="action-preview-heading"
      aria-describedby="action-preview-description action-preview-notice"
      className="flex max-h-[calc(100vh-2rem)] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl"
    >
      <div className="flex items-start justify-between gap-4 border-b border-slate-800 px-5 py-4">
        <div className="flex min-w-0 items-start gap-3">
          {danger ? <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-rose-300" /> : <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-cyan-300" />}
          <div className="min-w-0">
            <h2 id="action-preview-heading" className="text-lg font-bold text-white">{request.title}</h2>
            <p id="action-preview-description" className="mt-1 text-xs leading-relaxed text-slate-400">{request.description}</p>
          </div>
        </div>
        <button type="button" onClick={onCancel} aria-label="Cancel and close preview" className="shrink-0 rounded-lg border border-slate-700 bg-slate-800 p-2 text-slate-300 hover:text-white"><X className="h-4 w-4" /></button>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden p-5">
        <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-slate-800 bg-slate-950/60">
          <p className="border-b border-slate-800 px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{request.detailsLabel}</p>
          <pre tabIndex={0} aria-label={request.detailsLabel} className="max-h-[min(45vh,24rem)] min-h-24 overflow-auto whitespace-pre-wrap p-4 font-mono text-[11px] leading-relaxed text-slate-300 [overflow-wrap:anywhere]">{request.details}</pre>
        </div>
        <p id="action-preview-notice" className={`mt-3 text-xs leading-relaxed ${danger ? 'text-rose-200' : 'text-amber-100'}`}>{request.notice}</p>
      </div>

      <div className="flex flex-col-reverse gap-2 border-t border-slate-800 px-5 py-4 sm:flex-row sm:items-center sm:justify-end">
        <button ref={cancelButtonRef} type="button" onClick={onCancel} className="rounded-lg border border-slate-700 bg-slate-800 px-4 py-2.5 text-xs font-semibold text-slate-200">Cancel</button>
        <button type="button" onClick={onConfirm} className={`rounded-lg px-4 py-2.5 text-xs font-bold ${danger ? 'bg-rose-500 text-white' : 'bg-cyan-400 text-slate-950'}`}>{request.confirmLabel}</button>
      </div>
    </section>
  </div>;
}
