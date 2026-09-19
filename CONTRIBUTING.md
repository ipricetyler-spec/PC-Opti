# Contributing to Dialed

Thanks for helping make Windows performance management more transparent and reliable.

## Local setup

Use Bun 1.3.14 or the repository-pinned CI version on Windows. Install dependencies, then run the full local quality gate:

```powershell
bun install --frozen-lockfile
bun run check:clean-room-parity
bun test
bun run lint
bun run build
bun run test:ui:fixtures
bun run sbom
bun run license:inventory
bun audit --audit-level=high
```

Use `bun run electron:dev` when you need to exercise Electron-only native telemetry. Automated development remains non-mutating. Exercise approved real Windows/device mutations only on the dedicated physical test PC defined by the owner acceptance procedure; do not create or use a VM for Dialed acceptance.

## Contribution principles

- Preserve the local-first, evidence-based design. Do not invent telemetry, scores, hardware readings, or maintenance outcomes.
- Do not add registry cleaners, RAM flushing, generic driver updates, process termination, forced service disabling, or undocumented Windows modifications.
- Make every persistent system change explicit, narrowly scoped, locally journaled, and rollback-capable whenever Windows supports deterministic restoration.
- Treat protected processes, machine-wide startup entries, and unknown Registry value types as read-only unless a dedicated security review establishes a safe workflow.
- Keep the renderer sandboxed. New privileged behavior belongs behind the Electron preload/main-process boundary with input validation.

## Pull requests

Describe the user-visible outcome, the native Windows mechanism used, the rollback behavior, and the tests run. Include documentation updates for new system actions or new risk boundaries.

For changes that touch Windows configuration, explain what happens when the action fails, the process exits, or the captured pre-action state is stale.
