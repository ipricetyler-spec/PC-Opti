# Project handoff

Dialed is an Electron + React desktop app for measuring and safely tuning a Windows gaming PC.

- Main process modules live in `src/main/` (CommonJS); the UI lives in `src/` (React, Vite, Tailwind).
- Every change goes through the local change log so it can be undone.
- Run `bun run lint`, `node --test tests/*.cjs`, `bun test` and `bun run build` before committing.
- Architecture: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Safety rules: [docs/SAFETY_MODEL.md](docs/SAFETY_MODEL.md).

Detailed session-by-session notes are kept privately by the owner.
