# Verification

How Dialed is checked before a change is accepted.

- Type check: `bun run lint`
- Main-process tests: `node --test tests/*.cjs`
- UI and library tests: `bun test`
- Production build: `bun run build`
- Windows PowerShell parses every script Dialed ships (`tests/powershell-syntax.test.cjs`).
- Pinned third-party files match their recorded SHA-256 on disk (`tests/pinned-files.test.cjs`).

Real-PC checks are read-only unless the owner explicitly approves a change. Detailed run records are kept privately by the owner.

## 2026-09-21 — portable target retirement

- `npm test`: **778/778 passed**.
- `npm run test:ts`: **131/131 passed**.
- `npm run lint`: passed (`tsc --noEmit`).
- No production build, packaging, signing, installation, or launch was performed.
- `npm run candidate:verify -- dist-electron` correctly refused the existing package before
  installer verification because its packaged `src/main/updater/index.cjs` predates the current
  source. A fresh package is required to exercise the new installer-specific verifier path.
