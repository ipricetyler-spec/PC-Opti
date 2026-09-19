# Changelog

All notable changes to Dialed are documented in this file.

## [2.8.0] - 2026-08-30

### Added

- Guarded Input Devices inventory, polling guidance, exact prior-state recovery,
  interrupted-operation reconciliation, and timestamp-only input-event testing.
- Narrow reviewed game-profile transactions for Fortnite, Rocket League,
  VALORANT, and ARC Raiders, plus an independently sourced Call of Duty: Black
  Ops 7 manual guide. No automated owner game-file mutation is claimed.
- A consent-gated Network Quality Lab with separate idle/loaded latency, bounded
  transfer evidence, cancellation, and local summary history.
- Reviewed Windows Settings navigation and exact current-user optional-app
  inventory/removal that excludes protected, framework, security, gaming, driver,
  classic-program, duplicate, and unreviewed identities.
- Pinned native Intel PresentMon 2.5.1 capture with local raw evidence, bounded
  sessions, comparison import, interruption handling, and previewed deletion.
- A fail-closed verified-updater foundation with pinned HTTPS trust, Ed25519
  manifests, exact size/hash checks, Authenticode publisher verification,
  no-downgrade policy, and single-use tokens. Release trust remains unconfigured.
- A fail-closed input-driver lifecycle framework with an immutable provenance,
  permission, publisher, and INF/SYS/CAT hash manifest. No driver payload or install
  method is included.
- A shared default-off Technical details preference that keeps normal outcomes
  concise while preserving optional identities, raw measurements, and trust data.

### Changed

- Promoted the current source-only acceptance candidate to 2.8.0 after legacy
  2.5/2.6 artifacts and duplicate pre-2.7 sources were removed from active project
  scope. This version is a fresh unsigned test candidate, not a signed release.
- Consolidated browser fixture acceptance into one Bun command covering all eight
  themes, supported widths, nine workspaces, Windows controls, and updater refusal.
- Made the eight themes materially distinct across backdrop, sidebar, card,
  header, border and control treatments while preserving one responsive layout.
- Added speed-specific Full-Speed and High-Speed polling mappings with exact
  signed-driver tier detection. Compatible High-Speed devices may expose
  1/2/4/8 kHz requests only within the verified existing tier; configuration is
  never presented as achieved delivery or a latency result.
- Simplified normal Input Devices acceptance to one stable Windows-delivery check,
  made port names optional, surfaced VID/PID in Technical details, and corrected
  native polling-rate option contrast across themes.
- Applied the shared default-off Technical details presentation across all nine
  workspaces: normal views retain outcomes, actions, safety, failures and recovery,
  while optional raw paths, identities, hashes, sample distributions and methodology
  remain available on demand. Renamed the separate Input Devices tasks to **USB
  connection** and **Polling rate**.

### Fixed

- Replaced internal recommendation terminology with plain-language relevance,
  possible benefit, action, risk, undo and verification details.
- Consolidated verified scanning to one visible Scan-page action and added
  persistent running and terminal completion/failure feedback.
- Repaired Electron's pinned network lookup callback for both scalar and
  all-address DNS callback forms.
- Added keyboard event-header testing, exact selected-device instructions and a
  blocking eight-second Raw Input message loop that exits at completion or cancel.
- Documented once-at-open and explicit bounded work so the app does not imply a
  continuous network or input monitor.

### Safety

- No signing, installation, publication, reboot, firmware change, security-policy
  bypass, or live game/device/Windows/network mutation is authorized by this
  version change or its automated packaging checks.

## [2.7.0] - 2026-08-26

2026-08-27 source-candidate addition: hardware-matched BIOS guidance, eight local source-backed recipes, conservative board/model/revision matching, local notes and portable text plans. Existing features/themes retained; no automatic firmware mutation or release signing performed.

### Added

- Explicit Fortnite, Rocket League, VALORANT and ARC Raiders graphics candidates with exact Preview → Apply → Restore, automatic backups and honest file-verification logs. VALORANT requires one unambiguous account-scoped WindowsClient file and refuses any second account config; ARC Raiders uses its fixed WindowsClient file and `PioneerGame.exe` process guard. All current-game effects remain unverified, and Rocket League key mapping needs manual acceptance.
- Staged configuration replacement and durable transaction recovery, including rollback of the currently attempted file and failures while saving result metadata. Stronger manifest/path/current-state checks and restart-visible recovery warnings.
- Truthful optimization-run summaries that distinguish complete, warning, failure, and interrupted batches and expose change, rationale, expected result, undo, and verification evidence per item.
- Read-only installed-game discovery and an explicit game-configuration backup/restore center with bounded file selection, versioned manifests, exact-byte SHA-256 verification, recovery copies, stale-preview refusal, and transaction rollback on restore failure.
- First-party-source-linked Rocket League, League of Legends, and Overwatch 2 guides, bringing the guidance-only catalog to eight games.
- An explicit opt-in network-quality lab that performs exactly five bounded HTTPS requests to a fixed endpoint, blocks private/local destinations, supports cancellation, and reports scoped latency, jitter, and request-failure observations without changing network configuration.
- Read-only Storage & apps, Reliability / repair, Security, and Laptop power centers inside Scan.
- A Settings release-status card that reports the running version, package state, and exact executable Authenticode status without claiming an automatic update channel.

### Changed

- Advanced the source candidate to 2.7.0 so previously built 2.6.1 artifacts cannot be mistaken for packages containing this implementation.
- Removed the misleading owner-profile packaging shortcut; monetization splitting remains deferred and packaged runtime selection remains main-process controlled.
- Expanded the existing eight-theme design system and retained theme persistence at the 960-pixel minimum layout.

### Safety

- Game configuration operations remain explicit and local; no actual owner game files were changed during automated verification.
- The network lab is not a speed test, game-server test, route diagnosis, or proof of performance benefit, and it exposes no renderer-controlled target URL.
- No registry cleaner, driver updater, service-disabling preset, automatic repair, or unsupported third-party recipe was added.

## [2.6.1] - 2026-08-26

### Fixed

- Kept long Windows startup command lines and executable paths contained within their optimization cards at the three-column desktop breakpoint.
- Added card-boundary containment and emergency path wrapping without truncating the underlying target evidence.

## [2.6.0] - 2026-08-25

### Changed

- Renamed the customer-visible product, executable, installer, shortcuts, release artifacts, current documentation, and export filenames from PC-Opti to Dialed.
- Added the lead market line `Your PC, dialed in.` and the `Windows Performance Optimizer` descriptor.
- Promoted the release packaging version to 2.6.0 so the Dialed installer is a forward upgrade from PC-Opti 2.5.0.
- Renamed checkout and signing build variables to `VITE_DIALED_*` and `DIALED_*`; legacy `VITE_PC_OPTI_*` and `PC_OPTI_*` values remain accepted where needed during migration.

### Compatibility

- Retained the legacy package name, application ID, user-data directory, renderer storage keys, and private IPC channel names so an upgrade keeps local audit history, themes, workload profiles, rollback evidence, and installer identity.
- Updated signing, checksum, SBOM, acceptance-baseline, and release-manifest generation to derive customer-visible artifact names from the Dialed package metadata.

## [2.5.0-alpha.1] - 2026-08-15

### Added

- Central capability registry and Owner/Public/experimental classification.
- Post-action verification, stale-state refusal, mutation serialization, and interrupted-journal reconciliation.
- Previewable redacted AI audit payload with schema validation.
- Bun CI, CycloneDX inventory generation, Windows artifact workflow, and SHA-256 checksums.
- Current-state, implementation, safety, privacy, benchmark, legal, acceptance, and public-release documentation.
- `SystemScanSnapshot` schema 1.1.0 with explicit availability states for expanded read-only diagnostics and tested 1.0.0 migration.
- Deterministic local recommendations with evidence paths, capability metadata, rollback/verification details, and no automatic apply.
- Previewed allowlist-based Local Audit History export plus stale-safe retention deletion that always protects unresolved and rollback-capable entries.
- Versioned local benchmark JSON/CSV import, raw-sample statistics, strict comparison conditions, variance classifications, and review-only rollback linkage.
- Packaged Owner/Public runtime-profile resolution, filtered renderer capability metadata, public-safe navigation, and main-process fail-closed enforcement for sensitive IPC operations.
- Deterministic resolved dependency/declared-license JSON and human-review input generation with direct-dependency coverage, explicit unknowns, path privacy, and CI/package integration.

### Changed

- Packaged UI now loads local files instead of trusting a fixed localhost service.
- Windows artifacts run as the invoking user instead of requesting administrator rights globally.
- Machine-wide policy control is Owner/experimental, edition-dependent, and requires a deliberately elevated launch.

### Removed

- Obsolete Express/local audit server and stale Rigorset/AI Studio metadata.

## [2.4.0] - 2026-08-12

### Added

- Dynamic Eco-Balance for reversible, per-process Windows EcoQoS control.
- Protected process filtering and local audit-history rollback for supported actions.
- A documented Windows consumer-content policy with a System Restore checkpoint request and exact prior-state restoration.
- Actionable memory-pressure guidance that avoids unsafe RAM flushing.
- An open-source contributor guide, security policy, safety architecture, roadmap, tests, and GitHub Actions validation.

### Changed

- Source is tracked directly in the repository instead of being distributed only as an archive.

### Security

- Dialed explicitly rejects registry cleaners, generic driver updates, process termination, forced service disabling, and destructive debloat workflows.
