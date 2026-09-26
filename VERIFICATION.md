# Verification

How Dialed is checked before a change is accepted.

Run these exactly; a bare `node --test` or `bun test` walks into the build snapshots under
`output/` and fails for reasons unrelated to your change. `AGENTS.md` carries the expected counts.

- Main-process tests: `npm test`
- UI and library tests: `npm run test:ts`
- Type check: `npm run lint`
- Production build: `npm run build`
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

## 2026-09-21 — updater and candidate-verifier security follow-up

- An updater stages an installer only in Dialed's already verified admin-only protected folder.
  With that folder unavailable, every check, download and launch request fails before a signature
  read or network request. A same-user per-user-data fallback is never used for update staging.
- Update-feed and candidate verification now require both Windows resource versions to equal the
  package version, allowing only trailing `.0` components. This rejects a validly signed,
  misnamed artifact such as `2.8.0.1` for package version `2.8.0`.
- The candidate verifier now requires, inspects, and applies the common signed/unsigned,
  publisher, and timestamp rules to `resources/elevate.exe`.
- Focused updater/build-workflow tests: **21/21 passed**. The full required checks passed:
  `npm test` **781/781**, `npm run test:ts` **131/131**, `npm run lint` clean, and
  `npm run build` succeeded (the existing large-renderer-chunk warning remains).
- The existing `dist-electron` package was not re-verified: it predates the current updater
  source, and producing a fresh candidate requires separately approved packaging. No installer,
  signing, installation, or live update was run.

## 2026-09-23 — security review acted on (`1bd7066`)

- Verified updates refuse to run unless staging is the administrator-only protected folder, before
  any network or signature work. The release card no longer offers a check that would be refused.
- The update feed and the candidate verifier require the installer's own version to be the package
  version exactly, with Windows' trailing `.0` padding allowed.
- `resources/elevate.exe` is required, inspected, and held to the same signed-or-unsigned,
  publisher and timestamp rules as the rest of Dialed's own files.
- Alt+F4 closing the capture window was reviewed and is intended, not a defect; the wording was
  corrected instead.
- `npm test` 782/782, `npm run test:ts` 132/132, lint and build clean. No packaging, signing,
  installation, launch or Windows change.

## 2026-09-26 — benchmarking simplified (`45b1e23`, `f7940ea`, `b013a80`)

- A test shows the three steps a reader acts on; Result and Done are states, not steps.
- A waiting test watches for new runs itself; both manual refresh buttons are gone.
- One guided flow: Display setup starts the same test with the setting filled in, the parallel
  display-experiment steps are deleted, and every recording is reached from a finished result.
- One vocabulary in the measure screens: run, test, result.
- `npm test` 782/782, `npm run test:ts` 132/132, lint and build clean.
- Not verified: `npm run test:ui:fixtures` does not pass in this environment, and fails the same
  way on the previous commit with the changes stashed. It is a pre-existing problem with that
  gate. Those scripts also need a preview server already running on 127.0.0.1:5178, started with
  `--host 127.0.0.1`, which nothing documents.
