import type { ReactNode } from 'react';

/** Expert or secondary detail, closed until asked for. Nothing inside is removed; it is one
 *  click away, and a person's own choice to open it is kept while the page is open. */
export function ShowDetails({ label, children, defaultOpen = false, className = '' }: { label: string; children: ReactNode; defaultOpen?: boolean; className?: string }) {
  return <details className={`show-details rounded-2xl border border-slate-800 bg-slate-900/70 p-4 ${className}`} open={defaultOpen || undefined}>
    <summary className="cursor-pointer text-sm font-semibold text-slate-200">{label}</summary>
    <div className="mt-4">{children}</div>
  </details>;
}
