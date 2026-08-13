# Contributing to PC-Opti

Thanks for helping make Windows performance management more transparent and reliable.

## Local setup

Use Node.js 20 or newer on Windows. Install dependencies, then run the full local quality gate:

```powershell
npm install
npm test
npm run lint
npm run build
```

Use `npm run electron:dev` when you need to exercise Electron-only native telemetry or Windows actions.

## Contribution principles

- Preserve the local-first, evidence-based design. Do not invent telemetry, scores, hardware readings, or maintenance outcomes.
- Do not add registry cleaners, RAM flushing, generic driver updates, process termination, forced service disabling, or undocumented Windows modifications.
- Make every persistent system change explicit, narrowly scoped, locally journaled, and rollback-capable whenever Windows supports deterministic restoration.
- Treat protected processes, machine-wide startup entries, and unknown Registry value types as read-only unless a dedicated security review establishes a safe workflow.
- Keep the renderer sandboxed. New privileged behavior belongs behind the Electron preload/main-process boundary with input validation.

## Pull requests

Describe the user-visible outcome, the native Windows mechanism used, the rollback behavior, and the tests run. Include documentation updates for new system actions or new risk boundaries.

For changes that touch Windows configuration, explain what happens when the action fails, the process exits, or the captured pre-action state is stale.
