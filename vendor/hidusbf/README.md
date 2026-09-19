# Unchanged upstream HIDUSBF inventory

HIDUSBF created by SweetLow, maintained by LordOfMice.
Official source: https://github.com/LordOfMice/hidusbf
Dialed UI, verifier and helper work are independently authored.

Retrieved directly from commit 994259a8de31b35d2d44dc800368d9418dd3eb04 on
2026-09-05. Both complete archives are inert provenance. The selected payload
preserves original paths, names, bytes and all three distribution readmes.
Run `bun scripts/verify-hidusbf-bundle.cjs` to check the pinned inventory, both
archives and exact selected payload set. The verifier never downloads or executes.

Initial platform selection: AMD64_AS (x64 modern Windows), default/1khz,
2khz-4khz, 4khz-8khz and NoPatch SYS variants, install/uninstall INF and notices.
Selection is for review, not activation. NoPatch is the first unchanged-security
candidate. Patching variants are retained for identity/compatibility review and
must not be selected silently. No ARM64/x86 acceptance is inferred.
Inventory signature observations use Get-AuthenticodeSignature and do not prove
target Code Integrity or load acceptance.

Setup.exe, sx64.exe, certificates, batch scripts and legacy alternatives remain
inside original archives only. hidusbfn.zip contains test-mode and alternative-loader
material and is provenance-only. electron-builder includes inventory.json, this
credit/update policy and the exact selected payload directory as inert resources.
Both original archives stay in the repository, outside the application package.
The presence of these files does not activate installation or run any upstream file.

Updates are manual: review official commit/history, retrieve exact official archives,
verify hashes/signatures, reconsider variants/notices, then review inventory and
verifier pin together. Never refresh pins automatically. Never execute upstream
instructions conflicting with Dialed security boundaries.
