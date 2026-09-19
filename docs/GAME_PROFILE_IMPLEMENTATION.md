# Game profile candidate — 2026-08-29

Dialed 2.7.0 now has explicit Preview → Apply → Restore under Game & Network. This is a private candidate awaiting current-game acceptance, not a claim of measured performance gains. All eight manual game guides, eight themes, six sections, BIOS guidance and existing Windows controls remain available. No billing gate was added.

## Exact recipes and evidence

| Profile | Existing section / keys | Proposed values | Evidence boundary |
| --- | --- | --- | --- |
| Fortnite: lower effects load | `[ScalabilityGroups]`: `sg.ShadowQuality`, `sg.PostProcessQuality`, `sg.EffectsQuality` | `0` (Low) | Epic documents the engine mappings; application by the current Fortnite build is unverified |
| Rocket League: reduce blur / dynamic shadows | `[SystemSettings]`: `MotionBlur`, `DynamicShadows` | `False` | Candidate mapping of existing UE3-style keys; current-game acceptance and exact semantics must be checked manually |
| VALORANT: lower engine effects load | `[ScalabilityGroups]`: `sg.ShadowQuality`, `sg.PostProcessQuality`, `sg.EffectsQuality` | `0` (Low) | Riot recommends lowering graphics quality for low client FPS; Epic documents these engine groups; a current local account-scoped WindowsClient fixture contains the keys, but current-game behavior remains unverified |
| ARC Raiders: lower effects load | `[ScalabilityGroups]`: `sg.ShadowQuality`, `sg.PostProcessQuality`, `sg.EffectsQuality` | `0` (Low) | Embark publishes a Low graphics performance target; Epic documents these engine groups; the current local WindowsClient file contains the keys, but direct editing and current-game behavior remain unverified |

Sources reviewed through 2026-08-29:

- [Epic scalability reference](https://dev.epicgames.com/documentation/en-us/unreal-engine/scalability-reference-for-unreal-engine) supports the three engine quality mappings, not a benchmark or an exact Fortnite version certification.
- [Fortnite settings persistence support](https://www.epicgames.com/help/c-1/a202300000017401?lang=en-US) identifies `FortniteGame/Saved/Config/WindowsClient/GameUserSettings.ini` beneath Local AppData.
- [Rocket League configuration-file support](https://www.epicgames.com/help/c-202300000001622/c-202300000001679/a202300000082700) identifies `Documents/My Games/Rocket League/TAGame/Config/TASystemSettings.ini`.
- [Rocket League graphics troubleshooting](https://www.epicgames.com/help/c-202300000001748/a202300000010466?lang=en-US) supports reducing graphics load in general, **not** these exact two config keys. The legacy engine documentation could not be retrieved; do not represent it as verified. Rocket League stays a labeled candidate until the owner verifies current-game settings and restore.
- [Riot's VALORANT game/network instability guidance](https://playvalorant.com/en-us/news/game-updates/valorant-game-and-network-instability-basics/) recommends lowering graphics quality when client FPS is low and names the main quality groups, but does not certify direct INI editing or a performance gain.
- [Riot's settings-reset support](https://support-valorant.riotgames.com/hc/ja/articles/45508835861779) identifies `%LOCALAPPDATA%/VALORANT/Saved/Config` as the settings root. A 2026-08-29 read-only local inspection found exactly one supported account-scoped `WindowsClient/GameUserSettings.ini` (1,391 bytes; SHA-256 `BA94EE454D117F31A0A5828C53D1DBCDB3E004CAE93CDA00B240DFCEBFC7FA0D`) with all three reviewed keys. The private account-directory name is not stored in project records.
- [Embark's ARC Raiders PC requirements](https://id.embark.games/arc-raiders/support/faq/154-pc-system-requirements-1759329994) publishes a Low graphics performance target, but it does not document direct INI editing. A 2026-08-29 read-only local inspection found `%LOCALAPPDATA%/PioneerGame/Saved/Config/WindowsClient/GameUserSettings.ini` (2,576 bytes; SHA-256 `430E20C73507D82C4749EC7029DDAF212AD1D497508F68D3F6114A32CEEF4D27`) with exactly one reviewed section and all three keys. Steam metadata and installed files confirmed `PioneerGame.exe`; the local config was not previewed, backed up or written.

No proprietary third-party files, code, presets or assets were copied. The recipes do not change rendering API, resolution, frame cap, textures, controls, network settings, driver profiles, launcher arguments, executable compatibility or anti-cheat state.

## Safety and implementation

- Main process owns recipes and paths. Windows Documents comes from Electron's known-folder API, including redirected Documents; no renderer path, raw INI content or command is accepted. VALORANT discovery inspects only one account-directory level under its fixed Local AppData root and requires exactly one account-scoped WindowsClient file; any second account config fails closed.
- Preview reads only. Apply needs its exact single-use five-minute token; expiration is checked again after waiting in the serialized mutation queue.
- Fresh process inventory must confirm the target game's known executable names are absent at preview and apply/restore. Inventory errors block the operation. Nothing kills a process. Close launchers and avoid cloud sync yourself; the process check cannot prevent a game starting concurrently or detect every renamed executable.
- The existing INI must have exactly one recognized section and all reviewed keys, with valid current values. Duplicate/missing keys, malformed sections, unsupported encoding, oversized or linked paths are refused. Unknown keys are left alone. UTF-8, UTF-8 BOM, UTF-16LE BOM, comments, whitespace and line endings are preserved.
- Backups contain original bytes and hashes. Backup integrity is verified before Apply; output is staged in a same-directory temporary file, verified, checked for intervening target edits, replaced and read back.
- Durable `transaction.json` is recorded before writes, with source paths, before/after hashes and recovery-copy names. Result persistence is inside the transaction. Failures attempt rollback, including the currently attempted target. Unrelated concurrent content is not overwritten by rollback.
- Interrupted/corrupt recovery records are surfaced alongside local backups after restart. No automatic boot-time recovery changes files. Full backup restore requires its own current-state preview and confirmation.
- Restore is **whole-file**, not selective undo; it can replace later legitimate settings after confirmation. Links/junctions and read-only targets are refused, not made writable. Cloud sync, ACL behavior, abrupt power loss and live game acceptance still need host testing. Hashes are integrity evidence, not cryptographic authentication of a locally modified backup manifest.
- Apply results distinguish `FILE_VERIFIED` from `gameEffect: UNVERIFIED`. The log is returned from the completed operation; it is not invented live progress. Backups and transaction records persist locally, independently of the Windows-actions journal.

Implementation: `src/main/game-profiles/index.cjs`, shared transaction engine in `src/main/game-config/index.cjs`, strict Electron IPC, lazy-loaded `GameOptimizationCenter.tsx`.

## Automated evidence

- 214 source tests pass; 36 game-profile tests cover parsers, all four profile round trips, VALORANT discovery/ambiguity and Riot Client blocking, ARC Raiders process blocking, token expiration/replay, missing/duplicate keys, process-state errors, stale hashes, read-only/link refusal, stage/rename/result-write failures, multi-file recovery, manifest changes, concurrent writers and persisted recovery warnings. One additional workflow test protects the generated-output watcher exclusion.
- Lint, production build and clean-room parity pass after the ARC Raiders slice. The previous high-severity dependency audit was not rerun. The build lazy-loads profiles and BIOS guidance and produces no chunk-size warning.
- `bun run test:ui:fixtures` launches an isolated preview and drives the renderer
  plus real profile/backup backend against fixture files only. It covers all four
  profiles, cancellation, Apply log, Restore, no-op, running-game error, stale
  preview, four backups after reload, six sections, all eight themes at 960/1280,
  Windows controls, and the updater’s fail-closed UI with no overflow/page errors.
- `scripts/check-bios-ui.cjs` still passes notes, reload, download, unsupported/error cases and all eight themes. BIOS remains guidance-only.

These checks do not establish native packaged IPC, installed-host compatibility, game acceptance or FPS benefit. See [manual acceptance](MANUAL_ACCEPTANCE_2.7.0.md).
