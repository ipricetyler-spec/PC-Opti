# Changelog

All notable changes to PC-Opti are documented in this file.

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

- PC-Opti explicitly rejects registry cleaners, generic driver updates, process termination, forced service disabling, and destructive debloat workflows.
