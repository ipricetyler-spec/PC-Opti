import { Download, LifeBuoy } from 'lucide-react';

// What to do if Windows will not start after a change. Dialed cannot help once that happens,
// because it cannot open either, so the steps live here to read or save beforehand. They follow
// Microsoft's Windows Recovery Environment documentation and name only what Dialed itself changes.
export const RECOVERY_STEPS: Array<{ title: string; lines: string[] }> = [
  { title: 'Open the recovery screen', lines: [
    'If Windows still starts: hold Shift while you click Restart.',
    'If it does not: Windows opens the recovery screen by itself after two failed starts. You can also turn the PC off as the Windows logo appears, twice, and it opens on the third start.',
  ] },
  { title: 'Put back a restore point', lines: [
    'Choose Troubleshoot › Advanced options › System Restore.',
    'Pick a restore point whose name starts with "Dialed". Dialed makes one before policy changes, and when you tick "Make a Windows restore point first".',
    'Your files are kept; settings and programs go back to that moment.',
  ] },
  { title: 'Or start in Safe Mode and undo in Dialed', lines: [
    'Choose Troubleshoot › Advanced options › Startup Settings › Restart, then press 4 for Safe Mode.',
    'Open Dialed, go to Restore › History and undo the most recent change.',
  ] },
  { title: 'Boot timing settings', lines: [
    'If you changed Dynamic tick or the Platform clock in Dialed, choose Troubleshoot › Advanced options › Command Prompt and type:',
    'bcdedit /deletevalue {default} disabledynamictick',
    'bcdedit /deletevalue {default} useplatformclock',
    'A line saying the value was not found is fine: it was not set. Then close the window and choose Continue.',
  ] },
  { title: 'If it asks for a BitLocker recovery key', lines: [
    'Find it at aka.ms/myrecoverykey, signed in with your Microsoft account, on a phone or another PC.',
  ] },
  { title: 'If none of this works', lines: [
    'Troubleshoot › Advanced options › Uninstall Updates removes the latest Windows update.',
    'Startup Repair fixes some start-up problems automatically.',
  ] },
];

export function recoveryStepsText(): string {
  return ['If Windows will not start: recovery steps from Dialed', '',
    ...RECOVERY_STEPS.flatMap((step, index) => [`${index + 1}. ${step.title}`, ...step.lines.map((line) => `   ${line}`), '']),
  ].join('\r\n');
}

export function RecoveryStepsCard() {
  const save = () => {
    const url = URL.createObjectURL(new Blob([recoveryStepsText()], { type: 'text/plain' }));
    const link = document.createElement('a');
    link.href = url; link.download = 'If Windows will not start - Dialed.txt'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <details id="recovery-steps" className="mt-6 rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
    <summary className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-slate-100"><LifeBuoy className="h-4 w-4 text-cyan-300" aria-hidden="true" />If Windows won't start</summary>
    <p className="mt-3 text-xs leading-relaxed text-slate-400">Dialed can't open if Windows doesn't start, so save these steps or put them on your phone now.</p>
    <button type="button" onClick={save} className="mt-3 inline-flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-200 hover:border-slate-500"><Download className="h-3.5 w-3.5" aria-hidden="true" />Save these steps</button>
    <ol className="mt-4 space-y-3 text-xs leading-relaxed">
      {RECOVERY_STEPS.map((step) => <li key={step.title}>
        <p className="font-semibold text-slate-100">{step.title}</p>
        {step.lines.map((line) => line.startsWith('bcdedit') ? <code key={line} className="mt-1 block rounded bg-slate-950/70 px-2 py-1 font-mono text-cyan-200">{line}</code> : <p key={line} className="mt-0.5 text-slate-400">{line}</p>)}
      </li>)}
    </ol>
  </details>;
}
