# Verification

How Dialed is checked before a change is accepted.

- Type check: `bun run lint`
- Main-process tests: `node --test tests/*.cjs`
- UI and library tests: `bun test`
- Production build: `bun run build`
- Windows PowerShell parses every script Dialed ships (`tests/powershell-syntax.test.cjs`).
- Pinned third-party files match their recorded SHA-256 on disk (`tests/pinned-files.test.cjs`).

Real-PC checks are read-only unless the owner explicitly approves a change. Detailed run records are kept privately by the owner.
