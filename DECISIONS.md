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
