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

Not yet addressed from the same review: running under a different administrator account
(over-the-shoulder elevation), boot settings on non-English Windows, and the medium and low
findings. They are listed in the review queue.
