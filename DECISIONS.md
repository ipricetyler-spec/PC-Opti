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
