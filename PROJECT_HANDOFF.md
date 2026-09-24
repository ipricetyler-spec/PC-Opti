# Project handoff

Dialed is an Electron + React desktop app for measuring and safely tuning a Windows gaming PC.

- Main process modules live in `src/main/` (CommonJS); the UI lives in `src/` (React, Vite, Tailwind).
- Every change goes through the local change log so it can be undone.
- Architecture: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Safety rules: [docs/SAFETY_MODEL.md](docs/SAFETY_MODEL.md).

**Read [AGENTS.md](AGENTS.md) before working.** It holds the current rules, the gates that need
the owner's approval, and the traps that have already cost time. This file is a short orientation,
not the resume point: the current state and what is actually left live in the owner's private
notes, named at the top of AGENTS.md.

Run these before committing, exactly as written — a bare `node --test` or `bun test` walks into the
build snapshots under `output/` and fails for reasons unrelated to your change:

```
npm test         # Node suite, .cjs tests   — expect 782/782
npm run test:ts  # bun, TypeScript tests    — expect 131/131
npm run lint     # tsc --noEmit
npm run build    # production renderer build
```

Detailed session-by-session notes are kept privately by the owner.
