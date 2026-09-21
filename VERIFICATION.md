# Verification

How Dialed is checked before a change is accepted.

- Type check: `bun run lint`
- Main-process tests: `node --test tests/*.cjs`
- UI and library tests: `bun test`
- Production build: `bun run build`
- Windows PowerShell parses every script Dialed ships (`tests/powershell-syntax.test.cjs`).
- Pinned third-party files match their recorded SHA-256 on disk (`tests/pinned-files.test.cjs`).

Real-PC checks are read-only unless the owner explicitly approves a change. Detailed run records are kept privately by the owner.

## 2026-09-21 — portable target retirement

- `npm test`: **778/778 passed**.
- `npm run test:ts`: **131/131 passed**.
- `npm run lint`: passed (`tsc --noEmit`).
- No production build, packaging, signing, installation, or launch was performed.
- `npm run candidate:verify -- dist-electron` correctly refused the existing package before
  installer verification because its packaged `src/main/updater/index.cjs` predates the current
  source. A fresh package is required to exercise the new installer-specific verifier path.

## 2026-09-21 — input-check cancellation

- The visible foreground capture window now owns `Cancel check`; it discards the capture result.
  The disabled main-window control was removed.
- **Corrected in review:** the first version used a WinForms `Button` bound as the form's
  `CancelButton`. A probe against a real WinForms window showed the button takes keyboard focus as
  the window opens, so Space, Enter and Escape all cancelled the check — a keyboard check would
  have died on its first Space. It is now a `Label`, which cannot take focus and answers only to a
  mouse click; the same probe then showed no key cancels the check. The test pins both: the
  control must be a `Label`, and no `CancelButton` binding may exist.
- Updated `NATIVE_INPUT_SOURCE_SHA256` after changing `usb-native.cs`; the source-loader test
  verifies the exact bytes and still rejects a tampered copy.
- `npm test`: **779/779 passed** (after the correction); `npm run test:ts`: **131/131 passed**; `npm run lint` and
  `npm run build` passed.
- `powershell.exe` compiled `usb-native.cs` with the same `Add-Type` references Dialed uses;
  no native action or window was invoked. (PowerShell 7 cannot resolve its WinForms reference
  closure in this environment, so it is not the relevant compile host.)
- This is source and renderer-build evidence only. No live capture window, device, package,
  signature, or installer was run.
