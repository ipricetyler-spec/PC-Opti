# Decisions

Product decisions that shape Dialed. The detailed working log is kept privately by the owner.

- Every change Dialed makes is recorded in a local change log and can be undone from it.
- Dialed only offers changes that add to or improve user trust: each one says why, how to undo it and how to check it.
- Nothing is changed on a PC without the user choosing it; checks are read-only.
- Security is never weakened to make a tweak work.
- Dialed is built clean-room: other optimizers are judged only by what they visibly show, never by their code.
- Input-device work uses documented Windows interfaces and ships only after owner approval of the exact release.
- Dialed ships the per-machine NSIS installer, not a portable executable. A portable executable
  extracts to a predictable `%TEMP%` path while elevated, and no directory permission can secure
  that temporary extraction. The installer covers the use case with a working uninstaller and
  verified updates.
- Verified updates are unavailable unless Dialed has verified its admin-only protected data folder.
  A per-user fallback could let an ordinary same-user process replace an installer before Dialed
  launches it elevated, so it is never a valid update staging location.

See [docs/DECISION_LOG.md](docs/DECISION_LOG.md) and [docs/SAFETY_MODEL.md](docs/SAFETY_MODEL.md).

## Per-game power throttling exemption — declined (2026-09-26)

Dialed will not add a tweak that exempts a game from Windows Power Throttling
(`powercfg /powerthrottling disable /path <exe>`).

Power throttling parks processes Windows judges to be background work on slower, more efficient
CPU states, to save battery. `powercfg /powerthrottling list` on Windows 11 reports it under
"Battery Usage Settings By App", which is what it is. A game rendering frames in the foreground
is not what it targets, and on a desktop there is no battery and no efficiency-core split to be
parked on.

Checked on the owner's machine: Ryzen 7 9800X3D desktop, Ultimate Performance power plan. A
foreground game there is already not a throttling candidate.

It was declined for what it would do to the app rather than for the effort: a setting that sounds
meaningful, that people would enable expecting more frames, and that would change nothing
measurable, is exactly what Dialed exists not to ship. The honest card text would have read "this
probably does nothing on a desktop".

Reopen only with evidence: a before/after on a laptop, unplugged, showing a difference bigger than
run-to-run variation. Dialed can now measure precisely that.

## 2026-09-26 — The protected data folder is `C:\ProgramData\Dialed-Protected`

The admin-only folder that holds the change log was `Dialed-<12 random hex>`, because
`ProgramData\Dialed` belongs to the native input helper's own journal. New folders are now named
`Dialed-Protected`, and an existing random-named folder can be renamed to it.

Why the name cannot collide with Dialed's own folders: the native helper uses exactly
`ProgramData\Dialed`, and the older names are `Dialed-` plus twelve hex digits, which "Protected"
can never be. Anyone can create a folder under ProgramData, so a squatted `Dialed-Protected`
cannot be prevented; it is refused by the existing admin-only checks, and Dialed falls back to a
random name. A folder named plain `Dialed` is never renamed: it may hold the helper's journal.

How the rename keeps the change log safe: it is one directory rename on the same drive, so the
folder is only ever under one name and keeps its own permissions. Before renaming, Dialed records
its intent in `HKLM\SOFTWARE\Dialed\ProtectedDataRootPending` (the key is locked to administrators
at every start; see 2026-09-27); the next start finishes or abandons an interrupted rename by which
folder passes the admin-only checks, not by which name exists. The new name is recorded
only after the moved folder passes the admin-only checks; otherwise the folder is put back.
Windows refuses the rename if the name is taken or a file inside is open, and the folder then
keeps its name.

The rename ships switched off (`RENAME_PROTECTED_FOLDER` in `electron/main.cjs`) until the owner
approves running it on their own PC.

## 2026-09-27 — Windows systems review: trust boundaries and the change history

From the whole-app Windows systems review. Each finding was reproduced or confirmed before it
was fixed; the evidence is in `VERIFICATION.md`.

- **`HKLM\SOFTWARE\Dialed` is locked at every start.** The earlier note that only administrators
  can write it was wrong: on the owner's PC the key was owned by, and fully writable for, the
  signed-in account, through `HKLM\SOFTWARE`'s CREATOR OWNER entry. Dialed now sets owner
  Administrators, no inheritance, full control for Administrators and SYSTEM, read for Users, and a
  read-only OWNER RIGHTS entry so whoever owns a subkey cannot rewrite its permissions. Values found
  in the key are still only trusted after their own checks.
- **A protected folder that fails the checks is never used again, and never forgotten.** Its path
  goes into `ProtectedDataRootRejected`, and Restore says that history is no longer used and where
  it is. Dialed does not adopt it: it may have been altered.
- **Once the change log has been protected, a start that cannot open the folder pauses changes and
  undo** instead of recording in per-user data that the next start would not read. A per-user log
  left by an older build is kept aside as `journal.recorded-while-unprotected.*.json`, listed in
  Restore, and never undone from, because any program running as the user could have edited it.
- **The change history refuses new changes at 950 entries or 4.5 MB**, before touching Windows.
  Undo may go up to the 1,000-entry and 5 MB reading limits, so existing changes can always be
  undone.
- **Every elevated Windows PowerShell** starts from the fixed System32 path, resets its module
  path to the two system folders as its first statement (Windows PowerShell 5.1 always puts the
  user's Documents modules first otherwise), and, once the protected folder is open, uses a Temp
  folder inside it so Add-Type cannot be raced.
- **File cleanup covers the user's own temp folder only, and deletes through the checked handle.**
  `Windows\Temp` is left alone because every account can write there. Cleaning refuses when the
  protected Temp folder is not in use.
- **A packaged build always loads its own files.** `VITE_DEV_SERVER_URL` is honoured only in a
  source run, and only for a loopback address.
- Registry keys are created only when missing; `New-Item -Force` on an existing key replaces it.

The high and medium findings not covered above are decided in the next section. The low
findings are listed in the review queue.

## 2026-09-28 — Windows systems review: the rest of the high and medium findings

- **Per-user changes need the signed-in account.** Before the window opens, Dialed compares the
  account it runs as with the owner of Explorer in its session. When they are known to differ (a
  standard user approved the prompt with another administrator's password), every capability that
  writes the current user's hive or files is refused, and a banner says why. When it cannot tell,
  nothing is refused.
- **Boot timing is read from the BCD WMI provider for `{current}`**, not from `bcdedit` text, which
  is translated and lists every loader. Writes still use `bcdedit`, whose command words are not
  translated. `disabledynamictick` is element 0x260000A5, confirmed on the owner's PC.
- **The Memory Integrity guide appears only when this build can use the higher USB tier.**
  Otherwise the reader is told there is no reason to turn it off.
- **A setting can carry a minimum Windows build.** A known older build hides it and refuses turning
  it on; an unknown build blocks nothing, as with editions. Global timer resolution needs 22000.
- **Wording states what Microsoft documents** where Dialed cannot check the effect (no automatic
  restart), and every "Some Home editions may ignore this" text now says Dialed refuses it on Home.
- **An access-denied error is not blamed on administrator rights** (Dialed always has them); only
  "requires elevation" is. A missing registry value is not called a missing file.
- **Startup shows Task Manager's own on/off record** (`StartupApproved`, first byte odd = off, as
  Windows writes it; not documented by Microsoft) and never offers to disable Windows Security or a
  known anti-cheat.
- **Efficiency Mode undo restores both recorded bits exactly**, and while anti-cheat is installed
  Dialed does not change a program that has a window.
- **The change log is flushed to disk before it replaces the old one.** Keeping a previous
  generation was not added.
- **PresentMon captures and the input tier history live in the admin-only folder.** They are copied
  or rewritten there (inheriting its permissions); a folder move would carry the old, user-writable
  ones in and make the folder fail its own checks. Recording is refused while it is unavailable.
  Restoring a tier above 1 kHz passes the same Memory Integrity gate as setting it.
- **Game-config backups stay in per-user data.** A forged backup can only write the user's own game
  settings, and the remaining race could only place a fixed-name game config file elsewhere.
- **A game profile is undone key by key**: only the keys it changed, only while each still holds
  the value Dialed wrote. Whole-file restore stays, with a note that it discards in-game changes.
- **The Ultimate Performance plan is recognised by its local name**: undo compares with the name
  recorded when it was added, and presence reads the source plan's name from `powercfg`.
- The reviewer's ARC Raiders process-name finding was wrong: the game runs as `PioneerGame.exe`.
  VALORANT's game process was missing from the closed-game check and has been added.

## 2026-09-28 — Windows systems review: the low findings

- **Bracketed registry value names are not a problem.** The finding was wrong: every
  `Remove-ItemProperty -Name` call uses `-LiteralPath`, under which PowerShell does not expand
  wildcards in `-Name`. No change.
- **Interrupted Ultimate Performance adds and removals are settled from recorded state** instead of
  "unknown"; more than one new plan is ambiguous and nothing is removed. Any other interrupted
  undo explains that a later "changed since" refusal most likely means it finished.
- **A Wi-Fi check blocked by Location says so**, recognised by the `ms-settings:privacy-location`
  link in any language. Dialed does not change the Location setting.
- **Tweak card text vs code** was fixed with the medium findings.
- **The input tier capability says new tier changes are switched off** in this version.
- **Web permissions are denied** except `clipboard-sanitized-write` for the Copy buttons. The
  external-link handler keeps its URL check (public HTTPS and plain mailto only) and gets no
  separate capability.

## 2026-09-28 — Owner decisions after testing the installed build

- **Restore has tabs: History, Outside changes, Readiness.** This replaces the "one page" layout
  from simplification stage 5: the owner found expandable sections at the bottom of the page
  hard to find.
- **An under-load network reading that misses the reliability bar is not shown as a number.** A run
  whose transfers were only too fast says nothing failed and points to the full-speed test.
- **Changing polling rates is a core feature and must work in release builds, and keep working.**
  Until now release builds could not change any rate: the bundled HIDUSBF setup refuses to run
  without a signed release policy (`RELEASE_PUBLIC_KEY` is empty in
  `src/main/input-driver-lifecycle/native-broker.cjs`), and the older direct route is switched off.
  The owner asked for whatever is needed to restore it and retain it. Plan and facts: review queue
  Section 50.

## 2026-09-28 — Polling-rate changes ship in release builds

- **The owner's policy key is compiled into the app** (public half only, SPKI SHA256
  `9b4276c9…a2cef9`). The bundled setup now runs when a package carries a general release policy
  (schema 2, `ACCEPTED_RELEASE`) signed by that key for its exact signed helpers.
- **Scope of the release policy:** USB mice, keyboards, gamepads and joysticks at Full-Speed
  (125–1000 Hz) or High-Speed (1000–8000 Hz), Windows 10 build 19041 or later, no denied devices.
  Tested only on the owner's devices and Windows build 26200; other compatible hardware is
  expected to work but untested, as the release notes must say. The helper still refuses
  Low-Speed, unknown-speed and non-USB devices on its own.
- **Lifetime 395 days** (the contract allows 400). Each release re-signs, so the practical limit
  is how long someone runs an old build.
- **`npm run release:native` is part of `electron:build`**, and `candidate:verify` refuses a
  package without a valid policy for its own helpers, or with fewer than 30 days left. The manual
  unsigned CI workflow builds the helpers without a policy, so rate changes stay off there.
- **The Memory Integrity guide follows what this build can actually do**: with the signed setup
  available, a High-Speed device may go above 1 kHz, so the "keep it on" sentence is shown only
  when neither the setup nor the legacy route is available.
- The policy key stays DPAPI-encrypted in `C:\Users\itach\.dialed-signing`. No portable backup
  exists; losing it means a new key and a release, not a broken install.

## 2026-09-29 — Input checks, setup flow and the review latch

- **Two input checks.** "Check polling rate" leads with the measured reports per second against the
  saved rate: a controller is left untouched (it reports every interval), a mouse is moved in
  quick, large circles (it reports only while moving), and keyboards get no rate check. A mouse's
  rate is the upper quartile of 100 ms windows of unbroken movement, not the average over all
  movement: every slowdown leaves empty polling slots, and the average read a 1 kHz mouse as about
  915/s on the owner's PC. The average is still shown beside it. "Check controls"
  keeps the button, stick and key counts. The rate is what Windows received, never latency.
- **Setup updates its own saved record on opening** after a restart or USB change, because doing so
  changes no device setting. A saved change still waiting, or a record under review, still waits
  for the reader.
- **The patching acknowledgement is asked in the review, for a plan that patches.** The preview is
  requested with the flag set, which changes nothing; Confirm stays disabled until it is ticked.
- **Setup's record may follow a later Windows session together with unrelated USB changes**, absent
  stale entries may disappear, and eligibility or policy authorization of devices setup does not own
  is not drift. Owned devices, the service, driver bytes, patch parameters, security and platform
  are still compared exactly.
- **A latched review has a way out.** "Review what changed" lists every difference; "Keep current
  settings" saves exactly the reviewed state as the new baseline. It is refused while a change is
  pending, when security is unknown, for an unrecognized driver file, or when a device with recorded
  originals has moved. Originals are kept. (Superseded the same week: a pending change whose own
  check gave up can now be reviewed too — see the pending-change entry below.)

## 2026-09-30 — Protection notices before boot, game-file and power plan changes

From the Windows systems review's remaining suggestions. Each is a read-only check and a plain
notice; none blocks the change or touches a security setting.

- **BitLocker:** before a boot-setting change, the confirmation says Windows *may* ask for the
  recovery key at the next start when BitLocker is on or its state is unknown. Microsoft lists
  "changes to the boot manager" among recovery causes without naming the values it checks, so the
  wording stays "may".
- **Controlled folder access:** game profile, profile undo and config restore previews say Windows
  may block the write when the setting is on, the file is in a protected folder (the Windows
  defaults plus any added in Windows Security) and Dialed is not allowed. It is on, with Dialed not
  allowed, on the owner's PC.
- **Modern Standby:** the power plan list quotes Microsoft's rule that such PCs only allow the
  Balanced plan or plans based on it. Read from the power capabilities, not translated powercfg text.
- **A saved rate change whose check gave up** can now be resolved through "Review what changed",
  which first says whether the change took effect and keeps the matching originals.

## 2026-09-30 — From the product experience review

- **One verb, Undo,** for reversing a recorded change everywhere, including Restore's per-entry
  button. "Restore" stays the section name.
- **Place names match the screen:** Restore › History and Restore › Outside changes.
- **Home shows a failed action for 7 days**, and only until the same action succeeds. Restore keeps
  the full list.
- **The vertical sidebar starts at 960px**, the window's minimum width, with a narrower rail below
  1024px.

## 2026-10-01 — Systems re-review and product re-review fixes

- **"Keep current settings" only promises a restore that would work.** Accepting a reviewed state
  now requires each device with recorded originals to be eligible and on the same scope, exactly
  what restoring it requires. Otherwise it refuses and asks for the device on its original port.
- **Plugging a device in or out no longer looks like a Windows change.** The platform fingerprint
  includes every eligible input device. The helper now recomputes it from the current Windows,
  security and USB driver state with the saved device set; when that reproduces the saved value,
  only devices differ and they are compared one by one. No saved-record format changed.
- **An expired release policy still allows undo.** A schema 2 policy that passes every check as of
  just before it expired puts setup in recovery-only mode: restore a device or remove the driver,
  nothing else. The candidate gate still refuses any package with under 30 days left.
- **Setup refuses Windows on ARM** before anything runs; the bundled driver is x64 only.
- **Native setup has its own capability record** (`input:polling-setup`, S3, signed helper with
  UAC) instead of opening under the read-only USB checks.
- **Accepting a state where the driver changed outside Dialed** stops Dialed claiming the driver,
  so removal can never delete another tool's driver; the review says so.
- **A saved change waiting for its own check says so** (`PENDING_OPERATION`), instead of offering
  a review that then refused.
- **The review reads in Hz and plain words**, and a change whose setting matches says "was saved",
  not "took effect".
- **A rate is shown as not in effect when the HIDUSBF filter is gone**, instead of as the saved rate.
- **Gaming mice with a macro keyboard interface can run the rate check**; keyboard traffic is
  ignored by the verdict.
- **Safety notices are a separate callout** in confirmations (BitLocker, Controlled folder access,
  Modern Standby), not folded into the small print.
- **Readiness never says anti-cheat "is running" when it was not checked or only installed.**
- Feature ideas from the TunedPC screen comparison were built on 2026-10-01 (see below).

## 2026-10-01 — Comparison features, built to the seven owner requirements

- **Saved and measured stay apart.** Device rows say "Saved 4,000 Hz" (read back) and "Measured
  about 4,005 reports/s today" (observed); measurements are dated and kept per user only.
- **Home's "Your setup"** labels each line read from Windows, measured, or recorded by Dialed;
  anything unread says "Could not read" or "Not checked yet". No score, no "optimized".
- **Recording asks once** for the same game process, length and readings until Dialed closes;
  recording changes nothing on the PC, and each run still gets a fresh preview.
- **Network consent** is remembered for exactly the disclosed server, mode and limits.
- **A reversed Dialed change reads as no longer in effect**; nothing is ever reapplied on its own.
- **The restore point is opt-in**, recorded, not undone by Dialed, stops the batch if unconfirmed,
  and is never presented as a file backup or an exact undo.
- **The suggestion counter only selects**; Apply selected still reviews every change.
