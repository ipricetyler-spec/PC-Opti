import { useState } from 'react';
import { friendlyError } from '../lib/friendlyError';

/** An error in plain words, with the original message one click away. Inline, so it can
 *  sit inside any paragraph that already shows an error. */
export function ErrorText({ text }: { text: string | null | undefined }) {
  const [open, setOpen] = useState(false);
  const { message, technical } = friendlyError(text);
  if (!message) return null;
  return <>
    {message}
    {technical && <>{' '}<button type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)} className="underline underline-offset-2 opacity-80 hover:opacity-100">{open ? 'Hide details' : 'Details'}</button>
      {open && <span className="mt-2 block whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed opacity-70">{technical}</span>}</>}
  </>;
}
