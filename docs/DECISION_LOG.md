# Decision log

## D-001 — Evidence over feature count

Accepted. Dialed exposes only observed telemetry and narrowly scoped operations. Registry cleaners, RAM cleaners, page-file mutation, generic driver installation, broad service disabling, Defender/Update disabling, destructive debloat, arbitrary process termination, and synthetic health/FPS scores remain rejected.

## D-002 — Bun is authoritative

Accepted. `bun.lock`, Bun CI, and Bun scripts remain the dependency workflow. No `package-lock.json` is created.

## D-003 — No fixed local HTTP trust boundary

Accepted on 2026-08-15. Packaged UI loads from local files and the renderer does not trust a fixed localhost port. The historical external-AI path is parked and not part of the current runtime.

## D-004 — Standard-user default

Accepted on 2026-08-15. The installer uses `asInvoker`. The current machine-wide owner policy is unavailable unless the owner deliberately launches Dialed elevated. A general privileged bridge is prohibited; a future helper must expose only typed operations.

## D-005 — Re-read, journal, mutate, verify

Accepted on 2026-08-15. Persistent/reversible operations must refresh authoritative state, create `PENDING` evidence, execute one narrow operation, re-read the target, and retain rollback only when current state is safe.

## D-006 — Crash state is evidence, not success

Accepted on 2026-08-15. Pending actions reconcile against current state. Diverged, unavailable, and unknown states become `NEEDS_REVIEW`; they are not retried automatically.

## D-007 — Grounded local diagnostics replace external AI

Updated on 2026-08-23. External-AI auditing is parked/not shipped. Deterministic local recommendations and native capability metadata are authoritative; no report is sent to an external model.

## D-008 — Historical product names remained provisional

Accepted before the 2026-08-25 naming decision. CALIVECT and RIGORSET were research candidates only, and the product remained PC-Opti until the owner selected a replacement.

## D-009 — 75% context checkpoint

Accepted on 2026-08-15. At approximately 75% context usage, stop opening a new implementation batch. Finish the current atomic operation, run only the verification needed to leave it truthful, update repository-owned current state and the next-session handoff, and yield with a copyable continuation prompt. If an exact usage percentage is not visible to the agent, treat the first context-pressure/compaction warning or a conservative two-thirds-to-three-quarters estimate as the trigger. Safety-critical cleanup may continue briefly; feature expansion may not.

## D-010 — Dialed is the approved product name

Accepted by the owner on 2026-08-25. Customer-visible product, executable, installer, shortcut, release-artifact, and current-documentation branding changes from PC-Opti to **Dialed**, with `Your PC, dialed in.` as the lead line. The legacy package name `pc-opti`, installer application ID `com.pc-opti.diagnostics`, user-data directory `pc-opti`, local-storage keys, and private `pc-opti:` IPC names remain stable to preserve upgrade detection, installed history, themes, profiles, rollback evidence, and native compatibility. This owner decision authorizes the rebrand but does not claim professional trademark clearance or public-release approval.
