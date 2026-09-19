# Dialed

**Your PC, dialed in.** Dialed is the Windows performance optimizer that shows exactly what it found, what it changed, and whether the result was measurable. It is local-first and built around observed telemetry, explicit actions, post-action verification, and deterministic rollback where supported.

![Dialed dashboard](docs/images/dialed-dashboard.png)

The source is tracked directly in this repository so changes can be reviewed, tested, and contributed to normally.

## Public flow

- **Home:** discrete Ready, Review, or Blocked state, top evidence, and the next safe action.
- **Scan:** verified system diagnostics and deterministic recommendations, with Storage & apps, evidence-aware Windows controls, Reliability / repair, Security, and Laptop power centers. Direct cleanup is limited to individually confirmed, exact current-user optional-app packages.
- **Optimize:** one-screen selection and sequential execution for every currently eligible startup, EcoQoS, cleanup, ReTRIM, policy, and Performance Lab action, with a live per-item result log. The detailed one-at-a-time interfaces remain available underneath.
- **Game & Network:** nine independently written, first-party-source-linked game guides, four guarded executable graphics candidates, exact backup/restore, local adapter evidence, an explicit opt-in bounded Cloudflare sample, and pinned native PresentMon capture/comparison. None is proof that a tweak improves a game.
- **Verify:** manual drift comparison, local action history, rollback evidence, and redacted export.
- **Settings:** eight locally persisted appearance themes, workload profiles, exact running-version/signature status, and a verified user-initiated updater. The updater has no background activity and stays unavailable until the release feed, Ed25519 key and exact Windows publisher are pinned.

## Safe feature set

- Native Windows system, storage, startup, and temporary-file telemetry.
- Background apps, which can apply reversible Windows EcoQoS to one selected non-system process. It is not an FPS boost and must not be applied to games or launchers.
- Current-user startup management with an exact Registry-value rollback.
- A documented `DisableWindowsConsumerFeatures` policy control that requests a System Restore checkpoint before applying and retains its prior policy state for rollback.
- Local audit history for every supported configuration change.
- Crash reconciliation for interrupted journal entries without blind retries.
- Grounded local diagnostics only. External-AI audits are parked and are not part of the shipped runtime.
- Versioned GPU, board, power, gaming, page-file, storage-health, network, and security diagnostics with explicit unavailable states.
- Searchable read-only installed-application inventory that preserves unknown application sizes instead of reporting false zero-byte values.
- Evidence-aware links to six reviewed Windows Settings pages and one-at-a-time removal for nine exact current-user optional-app families. It never performs all-user/provisioned debloat and does not claim deterministic rollback.
- Reviewed game discovery plus versioned, hash-verified backup and guarded restore for files the user explicitly selects. Dialed does not silently rewrite game settings.
- A canceled-by-default network lab with a fixed HTTPS endpoint, five idle requests, a bounded 4 MiB download plus five loaded-latency requests, one 512 KiB zero-body upload, private-address refusal, cancellation, local summary history, and explicit measurement limits. It never changes DNS, routes, QoS, adapters, firewall rules, or the Registry.
- Deterministic local recommendations that cite observed evidence and never apply a collection automatically.
- Previewed field-redacted Local Audit History export and explicit retention cleanup that preserves unresolved and rollback-capable evidence.
- Previewed JSON/CSV benchmark evidence import with raw samples, strict condition matching, variance-aware comparison, and no synthetic score.
- Pinned official Intel PresentMon 2.5.1 capture with exact binary/license provenance, fixed 10/20/30-second visible-process sessions, local raw evidence, comparison preparation and previewed deletion. It does not inject, auto-elevate, simulate input or call frame time input latency.
- A fail-closed updater with one pinned HTTPS feed, Ed25519-signed metadata, no redirects, exact byte/hash verification, pinned timestamped Authenticode publisher checks, no downgrade, and an explicit installer launch. Release trust is intentionally unconfigured until the final signing identity and channel are approved.
- Main-owned runtime profiles remain as future packaging structure, but the normal local build currently exposes every implemented capability. Safety prerequisites still independently refuse ineligible or unprivileged actions.
- Deterministic Bun-lockfile declared-license review inventory with explicit unknown/platform-uninstalled metadata and no claim of legal clearance.
- Actionable memory-pressure guidance without unsafe RAM cleaners or forced memory flushing.
- [Hardware-matched BIOS plans](docs/BIOS_GUIDANCE.md) with read-only CPU/board/BIOS/RAM/GPU detection, source-backed manual recommendations, previous-setting notes and a portable checklist. No automatic firmware changes or generic voltage presets.

Dialed intentionally does not provide registry cleaners, generic driver updaters, RAM flushers, process termination, forced service disabling, or destructive debloat scripts.

The current source and fresh unsigned product-test candidate are version `2.8.0`. It includes [explicit Fortnite, Rocket League, VALORANT and ARC Raiders graphics profiles](docs/GAME_PROFILE_IMPLEMENTATION.md) with exact previews, automatic backups and restore. Current-game acceptance is pending; file verification does not prove performance benefit. See the [owner acceptance checklist](docs/OWNER_ACCEPTANCE_TEST.md). Quarantined 2.7.0 and older executables predate this work and must not be used as current evidence.

## Runtime and commerce status

- The packaged default remains `public`, but it is now the full local feature build rather than a reduced entitlement tier.
- Monetization and capability splitting are deferred until the feature set is established. Main-process safety checks remain active and are not commerce gates.
- The Premium/checkout UI is hidden. The repository contains a non-production preview, but local JSON trials and activation codes are not a production entitlement system.
- Customer commerce requires valid HTTPS checkout URLs, non-placeholder offers/support metadata, a real provider, and production entitlement verification before it can ship.

### Public distribution assets

- [Distribution and landing-page copy kit](docs/DISTRIBUTION_LANDING_MARKETING_KIT.md)
- [Support, returns, and terms draft](docs/SUPPORT_RETURNS_AND_TERMS.md)
- [Monetization and distribution strategy](docs/MONETIZATION_DISTRIBUTION_STRATEGY.md)

### Checkout build-time config

Set these variables before packaging:

- `VITE_DIALED_CHECKOUT_PROVIDER`
- `VITE_DIALED_CHECKOUT_ONE_TIME_URL`
- `VITE_DIALED_CHECKOUT_ANNUAL_URL`
- `VITE_DIALED_CHECKOUT_ONE_TIME_PRICE`
- `VITE_DIALED_CHECKOUT_ANNUAL_PRICE`
- `VITE_DIALED_CHECKOUT_ALLOWED_HOSTS` (optional)
- `VITE_DIALED_SUPPORT_EMAIL`
- `VITE_DIALED_SUPPORT_HELP_URL`

These variables are development inputs only. They do not make the current local entitlement preview production-ready.

See the [architecture and safety model](docs/ARCHITECTURE.md), [security policy](SECURITY.md), [contributor guide](CONTRIBUTING.md), and [roadmap](ROADMAP.md).
The owner/release trust setup is documented separately in
[Verified updates](docs/VERIFIED_UPDATES.md).

## Build

```powershell
bun install --frozen-lockfile
bun test
bun run lint
bun run test:ui:fixtures
bun run electron:build
```

New Windows builds request administrator access at launch through the normal UAC prompt, including the portable launcher. Users do not need to change compatibility settings. Development launches still inherit the terminal's privileges, and existing binaries retain their original manifest. Action confirmation, target validation and rollback checks still apply; administrator access does not replace signed driver setup verification. Native actions and evidence remain local.

## Development

```powershell
bun test
bun run build
bun run electron:dev
```

Current implementation status and limitations are recorded in [Project handoff](PROJECT_HANDOFF.md) and [Verification](VERIFICATION.md). The no-VM test model is in [Owner acceptance test](docs/OWNER_ACCEPTANCE_TEST.md).

## License

Dialed is licensed under the [MIT License](LICENSE).
