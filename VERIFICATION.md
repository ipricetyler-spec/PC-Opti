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

## 2026-09-26 — unused display-experiment model removed

- Removed from `src/lib/displayExperiment.ts`: the old experiment session, stage, evidence
  strength, context filter, change sentence and storage writers. Each name was searched for in
  `src/`, `tests/` and `scripts/` first; none was used outside the library and its own test.
- Kept because live code still calls them: run filing, run linking and the run selection it uses,
  the session limit, vendor detection, and reading a stored experiment for the legacy notice.
- Five tests that covered only removed code were deleted. The fourteen that protect live
  behaviour stay, now built on a local manual-session fixture.
- `npm test` 782/782, `npm run test:ts` 127/127, lint and build clean. No UI was exercised: this
  removes code nothing in the app called.

## 2026-09-26 — UI fixture gate, stage 1: runner and sidebar navigation

- Cause of the Games timeout, reproduced with a probe of the same fixture page: no page error,
  and the sidebar renders under the fixture's capabilities. The selector was stale. Sidebar
  buttons now read "03 Games" (a number, then the label), so `/^Games/` could never match. The
  checks predate the eight-section sidebar and still use old names (Optimize, Scan, Network,
  Verify) and old copy.
- Correction to the entry above: `npm run test:ui:fixtures` always started and stopped its own
  loopback server. Only a check script run on its own needed one.
- The runner now builds first, so it cannot test a stale `dist/`. A script run on its own with no
  server says to run `npm run test:ui:fixtures` instead of showing a bare connection error.
- Sidebar clicks go through `scripts/ui-fixture-page.cjs`, matching the section's accessible name.
  An unknown name fails in milliseconds and lists the real sections. Probed against a live
  preview: 8 sections found; Games opens and becomes `aria-current`; "Optimize" fails in 17 ms
  with the list.
- The gate still fails, now at `check-game-profiles-ui.cjs:134`: it waits for "Applied — file
  verified", and the component's heading reads "Applied and checked". That and the other stale
  names, copy and the nine-section counts are stage 2. No assertion was changed in stage 1.
- `npm test` 782/782, `npm run test:ts` 127/127, lint and build clean.

## 2026-09-26 — UI fixture gate, stage 2: checks brought up to the current app

- Each check was run on its own against a fresh build and fixed one failure at a time; probes of
  the fixture page established the cause before each change.
- Renamed screens and copy were followed and each assertion kept. Stale fixture stubs gained the
  native reads newer views call (`listPowerPlans`, `readDisplayModes`), each rejecting or empty.
- The game-profile fixture points the profile-folder variables at its own fixture profile, in its
  own process, so the backup/restore confinement rule runs unchanged against fixture files.
- Theme lists now come from `src/lib/themes.ts`. The old hard-coded eight ids no longer existed,
  so every per-theme pass had been testing the fallback styling.
- Two product defects the gate caught, fixed: Home and Measure tabs pointed `aria-controls` at
  panels that did not exist (now wrapped in `TabPanel`, probed: every tab links to a labelled
  panel), and the input check repeated its verdict as a per-channel line when the summary added a
  caveat (containment now counts as a repeat).
- Results: `check-bios-ui` and `check-workspace-states-ui` (56 checks) pass. `check-input-devices-ui`
  and `check-game-profiles-ui` each pass end to end in a throwaway copy with one undecided block
  removed (the header "Goal:" assertion; the Home saved-session flow). `check-theme-contrast`
  fails on a real finding: faint text is 3.68:1 (Console) and 4.02:1 (Instrument), under 4.5:1.
  The gate is therefore still red; the three open items need the owner.
- `npm test` 782/782, `npm run test:ts` 127/127, lint and build clean.

## 2026-09-26 — UI fixture gate green (owner decisions applied)

- Faint text lightened just enough to pass: Console `#6f7890` → `#81899e`, Instrument
  `#7d848b` → `#888e95`. Computed 4.63:1 and 4.61:1 on the lightest surface, still dimmer than
  muted text; the contrast check reports no findings.
- Measure › Test a change now links to **Saved tests**, which opens the saved-tests panel with no
  finished test required. The game-profile check drives the whole saved-tests flow from it:
  create, reload, edit, archive, restore, export, delete, import review, conflict refusal and
  duplicate prevention, all with their original assertions.
- The input check's `.app-header` "Goal:" assertion is deleted: the header shows no goal now.
- `npm run test:ui:fixtures` from an empty `dist/`: builds, all five checks pass, server stopped.
- `npm test` 782/782, `npm run test:ts` 127/127, lint and build clean.
- Not verified: the new Saved tests link and the lighter faint text were exercised only in the
  browser fixture, not in the installed app (which predates this work).

## 2026-09-26 — renderer bundle split by section

- Main chunk measured before and after, from `npm run build`: **624.46 kB → 414.82 kB**
  (gzip 172.76 → 124.10 kB). The "chunks larger than 500 kB" warning is gone; the threshold was
  not changed.
- Each sidebar section's components load through one dynamic import per section
  (`src/workspaces`), so a section arrives as one chunk on first open: scan details 50.8 kB,
  tweaks 52.4, games 48.6, settings 15.3, measure 14.2, gpu 11.1 (kB).
- Kept in the main chunk on purpose: Home (landing), `TweaksOverview` (App uses its hook),
  `ThemePicker` (applies saved appearance at startup) and Restore, which the error screen's
  "Open recovery" leads to and must open even if another section's chunk fails.
- `dist/index.html` loads only the main script and stylesheet; no section chunk is preloaded.
  Test a change does not pull in the 411 kB NetworkQualityLab (charts) chunk.
- `npm test` 782/782, `npm run test:ts` 127/127, lint and build clean.
  `npm run test:ui:fixtures` from an empty `dist/` passes, including the fault test that blocks
  the Input devices chunk and recovers to Restore.
- Not verified: the packaged Electron app (file:// in app.asar). Earlier lazy chunks already load
  there, but this build was not packaged or launched.

## 2026-09-26 — protected folder rename (switched off)

- Read-only inspection of this PC: `C:\ProgramData\Dialed-ad0f83361119` holds only
  `Journal\journal.json` (73,898 bytes, 50 entries); `HKLM\SOFTWARE\Dialed\ProtectedDataRoot`
  records it; `C:\ProgramData\Dialed` holds only the native helper's `HidusbfLifecycle`.
- Observed on throwaway folders: a directory rename refuses to replace an existing folder, even an
  empty one, and refuses while a file inside is open (both EPERM); the old name is gone after it.
- `tests/protected-folder-rename.test.cjs` (14 tests, fakes only) includes a power cut before
  every write of the rename: straight after it exactly one folder holds the intact log, and the
  next start leaves the registry naming it with no marker left. Two deliberate breaks of the
  recovery logic were each caught by the matching test, then reverted.
- The folder script and the three registry commands parse with the PowerShell parser (not run).
- `npm test` 796/796, `npm run test:ts` 127/127, lint and build clean.
- Not verified, and not run: the rename on this PC, the registry commands against real HKLM, and
  that Windows keeps the folder's protected permissions across the rename (reasoned; the moved
  folder is re-checked by the admin-only checks before its new name is recorded).

## 2026-09-26 — signed build of `7a33a94` installed

- First package refused by `npm run candidate:verify`: the native helpers had been built on
  2026-09-20, before two changes to `usb-native.cs`, which the helper compiles in. Cause: only the
  `electron-builder` step was run. Rebuilt with `build:hidusbf-native`, `build`, `sbom` and
  `license:inventory` first, then the signed `electron-builder --win nsis`.
- Second package: verifier `SIGNED_INSTALLER_CANDIDATE`; installer `Valid`, CN=Tyler Price,
  timestamped; SHA-256 `C2E507E90B918C7A9DBF66F7030635FEEF400E62E0A61CADD8A7503B470E114B`. The
  packaged `app.asar` contains the section chunks, the Saved tests link, the new faint colour and
  `RENAME_PROTECTED_FOLDER = false`.
- Installed per-machine over the 2026-09-20 build (same version 2.8.0); installer exit 0.
  Installed `app.asar` is byte-identical to the verified candidate. `Dialed.exe`, the uninstaller
  and `Dialed.HidusbfHost.exe` are `Valid`, CN=Tyler Price. No Code Integrity block or audit event
  mentioning Dialed in the 30 minutes around the install. The protected folder was not renamed.
- Not verified: behaviour of the installed app beyond starting (it was running afterwards); the
  update-feed `release:*` steps were not run because there is no feed.

## 2026-09-26 — two small fixes

- `usePowerPlanName` (TweaksOverview) now checks `listPowerPlans` exists before calling it, like
  every other caller. Probed: the BIOS browser check with its `listPowerPlans` stub removed now
  passes with no page errors; before, the whole Tweaks view failed.
- The restore dialog reads "1 current file differs" (was "differ"); read from the live dialog.
- The remaining `displayExperiment.ts` exports were rechecked: all are used by live code or by the
  kept tests, so nothing was removed.
- `npm test` 796/796, `npm run test:ts` 127/127, lint and build clean, `npm run test:ui:fixtures`
  passes. Not in the installed build.

## 2026-09-27 — power plan name follows recorded changes

- `usePowerPlanName` documented that it reloads when `refreshKey` (the change history) changes,
  but its effect depended only on `enabled`. Reproduced in a browser probe: with All tweaks open,
  the active plan changed and history reloaded, yet the plan was read once and the card kept the
  old name. After adding `refreshKey` to the dependencies: read twice, card shows the new name.
- `npm test` 796/796, `npm run test:ts` 127/127, lint and build clean, `npm run test:ui:fixtures`
  passes. Not in the installed build.

## 2026-09-27 — Windows systems review fixes (`aa1f437`..`26a7262`)

Reproduced or confirmed before fixing:
- **Registry key:** `Get-Acl HKLM:\SOFTWARE\Dialed` on the owner's PC (read only): owner
  `PRICEPC\itach`, which also has FullControl. The key holds only `ProtectedDataRoot`; no startup
  backups exist under it yet.
- **History lost from view:** a probe with the real journal module in temp folders showed a log
  moved to protected folder A reads `[]` once the next start is handed a fresh folder B, and an
  entry written to per-user data during a failed start is not read on the next normal start.
- **History limit:** 1,000 entries read; 1,001 throws. `appendEntry` had no limit check.
- **Module path:** Windows PowerShell 5.1 started with `PSModulePath` removed, or set to system
  folders only, still lists `OneDrive\Documents\WindowsPowerShell\Modules` first.
- **Dev URL and consumer-content key:** confirmed from source.

Checked after fixing:
- The key lock's check (`Test-DialedKeyLocked`) run for real on in-memory security objects: the
  locked form passes; user full control, user owner, Users write and inheritance each fail. Run on
  the real key (read only), it reports the current key as not locked, which is correct. The lock
  itself was **not** applied to this PC: that happens when Dialed next starts as administrator.
- Dialed's real `runPowerShell`, run with a read-only script: module path is only
  `System32\WindowsPowerShell\v1.0\Modules` and `Program Files\WindowsPowerShell\Modules`,
  `Get-ItemProperty` loads from System32, and the process is the System32 `powershell.exe`. The
  stdin launch form used by Input devices works with the extra first line.
- The delete helper, compiled with Add-Type and run on scratch files the test creates
  (`tests/safe-delete.test.cjs`): old and read-only files are deleted; a recent file, a file with a
  second hard link, a folder, and a file reached through a junction to another folder are refused
  and still exist.
- The temp inventory script run for real (read only): one root, the user's temp folder, 1,555
  eligible files, nothing deleted. The deleting scripts were parsed, not run.
- Every changed PowerShell script parses with the Windows PowerShell parser.
- New tests: rename settling by trust (a folder squatted at the vacated old name, a forged marker,
  a failed put-back), rejected roots, the journal pause, the kept-aside per-user log, the history
  limit (fails without the fix), registry keys created only when missing (fails without the fix),
  the packaged dev URL, and the launcher helper through the injectable launchers.
- `npm test` 809/809, `npm run test:ts` 127/127, lint and build clean, `npm run test:ui:fixtures`
  passes, including a new check that Restore shows the protected-folder notices with the raw
  reason behind Details.

Not verified: `Protect-DialedKey` actually changing a key's owner and permissions (it writes the
registry); the pause and the notices in a running Electron app; `New-Item -Force` wiping an
existing key on this PC (a registry write); whether a user environment variable can override
`SystemRoot` for an elevated Dialed. None of this is in the installed build.

## 2026-09-28 — Windows systems review, the rest of the high and medium findings (`e847972`..`6d70f88`)

Reproduced or confirmed before fixing, all read-only on the owner's PC unless noted:
- **Accounts:** no code compared the elevated account with the signed-in one. The new read returns
  the same account for both on this PC (`PRICEPC\itach`).
- **Boot timing:** `bcdedit /enum {current}` shows `disabledynamictick Yes`; the BCD WMI provider
  lists element 0x260000A5 as the only boolean loader element, reading True. Dialed's new read
  returns `usePlatformClock: null, disableDynamicTick: 'YES'`, matching `bcdedit`.
- **Startup:** Task Manager records Steam, Battle.net, SteelSeriesGG and an Edge auto-launch as off
  (odd first byte plus a timestamp); Dialed showed all four as Enabled and offered Windows Security
  and Riot Vanguard for disabling. After the fix Dialed's real listing matches those records and
  marks both protected.
- **Efficiency Mode:** from source, undo left the "controlled" bit set. The new native helper was run
  on a throwaway process the probe started and ended: bits 0 → 3 → 0 and 1 → 3 → 1, and a restore
  while Efficiency Mode was off was refused.
- **Windows build:** reads 26200 here. **Game processes:** ARC Raiders' binaries are
  `PioneerGame.exe` (the reviewer's claim was wrong); Apex is `r5apex_dx12.exe`; VALORANT is not
  installed here, so its process name comes from public sources, not from this PC.
- **Ultimate plan:** `powercfg` names the source plan "Ultimate Performance" here, and Dialed finds the
  existing copy `a21971bb…`.
- **Memory Integrity guide, friendly errors, history limits, fsync, benchmark temp name, PresentMon
  and input history paths:** confirmed from source.

Checked after fixing:
- New tests with real files in temp folders: key-level game profile undo (the game's own change is
  kept; a changed profile key is refused), PresentMon capture copy (hard-linked file refused),
  input history move, journal flush-before-rename and failed-write cleanup.
- Browser fixtures: the account banner in both themes and every zoom; Memory Integrity text both
  ways in Input devices; game profile undo keeping a setting the game changed.
- `npm test` 835/835 and `npm run lint` clean after the last commit; `npm run test:ts` 128/128 and
  `npm run test:ui:fixtures` (which builds first) passed after `b1573f8`. A single chained run of
  every check was cut off when the owner's PC hard-froze (cause unknown; see the review queue).
- Rerun at `40d11b9`, one command at a time: `npm run lint` clean, `npm run check:clean-room-parity`
  passed, `npm run test:ts` 128/128, `npm test` 835/835, `npm run build` clean with no warnings,
  `npm run test:ui:fixtures` passed (58 workspace checks, no page errors). The PC stayed up.

Not verified: any per-user refusal with a real second administrator account; a boot-timing write on
a non-English PC; the Startup reading on a 32-bit machine entry (none here); key-level undo against
a real game's rewrite; the Ultimate plan on a non-English Windows; any of this in a running
Electron app or the installed build.

## 2026-09-28 — Windows systems review, the low findings (`acf9450`..`11e2a03`)

- **Bracketed value names:** checked read-only with `Get-ItemProperty -LiteralPath HKCU:\Environment`:
  `-Name 'Pat*'` and `-Name 'P[a]th'` return nothing although `Path` exists, so `-Name` is literal
  under `-LiteralPath`. The finding is wrong; nothing changed.
- **Interrupted plan add and undo:** tests with PENDING entries and a fake plan list cover done, not
  done and ambiguous adds, a finished and an unfinished removal (the finished one closes the
  original change), and the new message for any other interrupted undo.
- **Wi-Fi:** `netsh wlan show interfaces` here says "There is no wireless interface on the system";
  Dialed now reports "This PC has no Wi-Fi adapter". The Windows 11 24H2 Location notice was not
  observed (no Wi-Fi on this PC); it is tested from its documented wording and link.
- **Input tier wording:** production creates the input service without `allowLegacyNewWrites`, so new
  tier writes are refused; the capability text now says so.
- **Web permissions:** the handlers are checked from source only; Electron was not started.

- Run one at a time at `11e2a03`: `npm test` 841/841, `npm run lint` clean,
  `npm run check:clean-room-parity` passed, `npm run test:ts` 128/128, `npm run build` clean,
  `npm run test:ui:fixtures` passed (58 workspace checks, no page errors).

Not verified: the permission handlers in a running app (clipboard Copy buttons still working, other
permissions denied); the Location notice on a real 24H2 PC with Wi-Fi.

## 2026-09-28 — signed build of `df9c9ae` installed

- Owner approved packaging and install. Full order, one step at a time: `build:hidusbf-native`,
  `build`, `sbom` (392 components), `license:inventory` (525 records), signed
  `electron-builder --win nsis`. Signing reported "Signed and verified" for `Dialed.exe`, both
  HIDUSBF helpers, `elevate.exe`, the uninstaller and the installer.
- `npm run candidate:verify -- dist-electron`: `SIGNED_INSTALLER_CANDIDATE`. Installer SHA-256
  `14E84B1B2F316B03E5E767CD08ECB2674457A935AC1524AE154CEFB3960DBCC6`, Authenticode `Valid`,
  CN=Tyler Price. The input-driver lifecycle stays `UNCONFIGURED`, as intended.
- The packaged `app.asar` contains the permission handler, the account check, the dev-URL guard,
  game-profile undo, the Wi-Fi Location reason, the registry key lock, the Ultimate plan local
  name and the interrupted-add reconciliation, with `RENAME_PROTECTED_FOLDER = false`.
- Installed silently (`/S`) per-machine over the 2026-09-26 build (same version 2.8.0); installer
  exit 0. Installed `app.asar`, `Dialed.exe` and `Dialed.HidusbfHost.exe` are byte-identical to the
  verified candidate. `Dialed.exe`, the uninstaller and the helper are `Valid`, CN=Tyler Price. No
  Code Integrity event mentioning Dialed since the install.
- First start of the installed app by the owner (06:05:57), checked read-only afterwards:
  `HKLM\SOFTWARE\Dialed` is owned by Administrators with inheritance blocked; SYSTEM and
  Administrators FullControl, Users and OWNER RIGHTS ReadKey; the owner's account no longer has
  full control. `ProtectedDataRoot` is unchanged (`Dialed-ad0f83361119`), with no pending or
  rejected value. `Temp` exists with only inherited SYSTEM/Administrators/OWNER RIGHTS entries.
  PresentMon captures: 11 files (4 CSV, 7 JSON) in the protected folder and the old per-user
  folder removed, so none were skipped. Input history moved, identical in content to the kept
  `input-devices.moved-to-protected-folder.*.json`. Change log: 50 entries, none pending. No file
  under the protected folder has a non-inherited permission entry.
- Not verified: the Restore page and the other workspaces in the running app were not inspected.

## 2026-09-28 — owner testing of the installed build, and fixes (`100887f`, `38be396`)

Owner's report on the installed `df9c9ae` build: Restore history fine; Tweaks › Startup matches
(Task Manager off labels, Windows Security and Riot Vanguard protected); past PresentMon recordings
present; Measure "Copy view" works; Ultimate plan shows as in the plan list.

- **Readiness "Copy summary" seemed to do nothing.** A throwaway Electron window with Dialed's exact
  permission handlers copied successfully (Chromium requests only `clipboard-sanitized-write`), so
  the copy works; the result message was a technical detail, hidden by default. Now always shown;
  the fixture clicks it with Technical details hidden. (That probe window stole focus from the
  owner's game; see the no-visible-windows rule in memory.)
- **Network quick check "some parts failed".** The owner's saved result: `PARTIAL`, quality
  `INSUFFICIENT`, 634 Mbps download, 0/9 request failures. The 4.5 MiB quick check finishes in
  about 50 ms, below the 750 ms steady-duration bar. New test with instant transfers: status
  `PARTIAL`, `transferTooShortForLoad: true`, both under-load values `null`, no failed samples.
- **"When did we lose 8 kHz?"** Nothing was lost, read-only: HIDUSBF running, `PatchUSBXHCI = 3`,
  Memory Integrity off, Dialed's tier record for the DualSense Edge `PRESUMED_ACTIVE`, and Dialed's
  scan reports `maxHighSpeedHz: 8000`, "4–8 kHz ready". The DualSense was not connected by USB, so
  only the 1 kHz mouse and keyboard were listed. My checklist wrongly told the owner to expect the
  Memory Integrity sentence, which appears only while Memory Integrity is on.
- **Restore tabs:** the fixture checks History is selected first and opens both other tabs.
- `npm test` 842/842, `npm run test:ts` 128/128, lint clean, `npm run test:ui:fixtures` passed,
  run one at a time. Not packaged: the installed build still lacks these three fixes.

## 2026-09-28/29 — polling-rate changes restored in the installed build (`40874fd` … `b874733`)

- **Key custody.** `native-policy-key.ps1 -Action Inspect` refused: an allow entry for
  `PRICEPC\CodexSandboxUsers` (read) had been added to `C:\Users\itach\.dialed-signing` since
  2026-09-06. The private key stayed DPAPI-encrypted to the owner. The entry was removed; Inspect
  then passed with fingerprint `9b4276c9…a2cef9`.
- **Release step.** `npm run release:native` built both helpers, signed them (Tyler Price,
  timestamped), prepared and signed a schema-2 `ACCEPTED_RELEASE` policy with the DPAPI key, and
  both the JavaScript and the C# policy contracts accepted it (`GENERAL_RELEASE_POLICY_CONTRACT_VERIFIED`).
  electron-builder kept the helpers' existing signatures ("Verified existing signature"), so the
  packaged bytes are the pinned ones. `candidate:verify` reported `SIGNED_INSTALLER_CANDIDATE` with
  the policy recorded, for every package below; each install was byte-identical to its candidate.
- **Found and fixed by using the installed build:**
  - Change rate… opened on no device. The app sent `SHA256(instance ID)`; setup compared it with
    `SHA256(its own id)`, and its own id is already a hash of the JSON-encoded instance ID. Setup's
    fixture passed only because it used raw instance IDs as ids. The app's formula now reproduces
    the helper's id exactly (`7a31bcb3…` for the owner's DualSense, as the helper reported it).
  - Setup refused its 2026-09-13 record ("external drift"). A read-only observer built from the
    helper's own code showed the only differences: a later Windows session, three absent stale USB
    entries removed, an unplugged keyboard and wireless device, a hub topology change, and the
    Apex/Razer becoming authorized under the release policy. Driver file, service, patch setting
    and every interval matched. The refresh rules were widened for exactly those cases, and the
    real record then passed `CanRefresh` with the real policy.
- **Real rate change.** From the installed app: inventory refreshed, DualSense Edge 8000 → 4000 Hz
  saved, the owner reconnected it and verified, then set it back to 8000 Hz (owner confirmed all
  three).
- **Rate check.** A real rate check from the checkout on the DualSense at 8000 Hz: about
  8,007 HID reports/s, `CONSISTENT_WITH_REQUEST`. The edited capture code compiled under Windows
  PowerShell 5.1.
- **Installed setup, no-change run (`b874733`):** opened on the DualSense with rate buttons; review
  for 4000 Hz showed the patching explanation with Confirm disabled until acknowledged; Cancel
  applied nothing. Setup ran its own saved-record check on opening.
- Checks, one at a time: `npm test` 845/845, `npm run test:ts` 128/128, lint clean,
  `npm run test:ui:fixtures` passed (the BIOS check failed once and passed on the rerun), the
  native fixture passed including the new recovery checks.
- **Not verified:** a mouse rate change; the "Review what changed" recovery on a real latched
  record (the owner's record is clean; covered only by the fixture); a Windows 10 PC; a clean
  install on another PC.

## 2026-09-29 — Home no longer calls failed actions "did not finish"

- Reproduced on the installed build: Home showed "3 changes did not finish". The change log holds
  47 SUCCESS and 3 FAILED entries, all ReTRIM of C:, D: and E: on 2026-09-06, each refused by
  Windows with "Access denied". Nothing was pending or unconfirmed.
- Home now keeps "did not finish" for changes Dialed could not confirm, and shows failed actions
  separately and without the urgent marker: "3 actions failed · Windows reported an error for
  ReTRIM C:, ReTRIM D: and ReTRIM E:…". Readiness words its next step the same way.
- `npm test` 845/845, `npm run test:ts` 129/129, lint clean, `npm run test:ui:fixtures` passed.
  Not packaged: the installed build still shows the old wording.

## 2026-09-30 — pending-change recovery and protection notices (`df2c8f2` and the next commit)

- Native fixture: 333 reconciliation checks (was 317), covering a latched pending change that took
  effect, did not, or is unclear; a non-latched pending change is still refused.
- Read-only on the owner's PC, cross-checked with Windows' own tools: BitLocker off (ProtectionStatus
  0), Controlled folder access on (mode 1, Dialed not in the allowed list), classic S3 sleep, not
  Modern Standby (`powercfg /a` agrees).
- The browser fixture shows the Controlled folder access notice for Rocket League (Documents) and
  none for Fortnite (AppData).
- `npm test` 850/850, `npm run test:ts` 129/129, lint clean, `npm run test:ui:fixtures` passed, run
  one at a time; `npm run release:native` re-signed the helpers.
- Not verified: the BitLocker and Modern Standby notices on a PC where they apply; no package built.
