# Native input stack acceptance matrix

Status legend: `PASS`, `FAIL`, `BLOCKED`, `NOT RUN`, `NOT APPLICABLE`.

Phase 0 establishes reviewable requirements only. It does not pass driver
feasibility or product compatibility.

| ID | Phase | Acceptance criterion | Required evidence | Current status |
| --- | --- | --- | --- | --- |
| P0-01 | 0 | Authoritative root is the nested E: repository and product version is 2.8.0 | Git root and parsed package version | PASS |
| P0-02 | 0 | Historical pre-driver candidate remains exact and is not treated as current after source work | File size/hash plus continuity record | PASS |
| P0-03 | 0 | Native ownership boundary contains no driver/helper/package payload or build hook | File inventory and forbidden-extension scan | PASS |
| P0-04 | 0 | Independent behavior requirements cover selection, preview, mutation, readback, restart/reconcile, verification and recovery | `BEHAVIOR_SPECIFICATION.md` review | PASS |
| P0-05 | 0 | Clean-room provenance ledger records every current reference and zero imported implementation files | `PROVENANCE_LEDGER.md` review | PASS |
| P0-06 | 0 | Threat model covers renderer/main/helper/journal/filter/Windows/device/evidence boundaries | `THREAT_MODEL.md` plus source-anchor check | PASS; bounded Windows-systems and QA reviews complete |
| P0-07 | 0 | Future operations map to the existing production-disabled lifecycle without a second UI/state machine | `LIFECYCLE_CONTRACT_MAP.md` review | PASS |
| P0-08 | 0 | Device capability schema keeps configured/session/Windows/USB/latency evidence separate and invalidates material drift | Schema plus semantic validator; positive and negative fixtures | PASS; 39 focused capability tests, documented Windows polling-period mapping and ledger-resolved provenance |
| P0-09 | 0 | Exact Phase 1 environment, signing and owner-mutation boundary is explicit | `SUPPORTED_SCOPE_AND_PHASE1_PROPOSAL.md` plus Phase 1 ADR/contract | PASS |
| P1-01 | 1 | Exact WDK/SDK/toolchain, extension-ID ownership and imported sample commit/files/licenses are pinned | Build manifest, ownership evidence and updated provenance ledger | NOT RUN; target versions pinned, tool binaries absent, extension-ID ownership unverified, no sample imported |
| P1-02 | 1 | Transparent KMDF filter builds warning-free and passes static/package/INF checks | Reproducible build, logs, hashes | BLOCKED on absent WDK/MSVC/InfVerif; source contract tests pass |
| P1-03 | 1 | Synthetic adapters prove target selection, pass-through, attach/detach, exact deltas and recovery without hardware | Fixture test report | NOT RUN for the native prototype. The offline target-binding contract now fixture-tests selection, scope, inventory completeness, lifecycle ordering, exact deltas, recovery ordering, and exact capability identity/mechanism binding (42 tests), but no adapter executes the driver, so pass-through and attach/detach remain unproven |
| P1-04 | 1 | Malformed I/O, cancellation, concurrency and fault injection do not corrupt memory or double-complete requests | Static analysis, fuzz/fault tests | NOT APPLICABLE to no-queue transparent source; required before any request handler |
| P1-05 | 1 | Approved signed prototype loads only after exact stack review on the disposable x64 target with Secure Boot, Memory Integrity, Defender, UAC and signature enforcement enabled | Before/after stack/security evidence and exact signatures | NOT RUN; owner approval and stack review required |
| P1-06 | 1 | Transparent attach/reconnect/restart/detach/removal changes only the selected approved physical scope | Full inventory and exact pre/post deltas | NOT RUN; owner approval required |
| P1-07 | 1 | Full-Speed request tier is repeatable through PnP/power and recovery on an exact compatibility class | Configuration/session/bus evidence bundle | NOT RUN |
| P1-08 | 1 | Each proposed High-Speed 1/2/4/8 kHz tier is independently observed at the selected endpoint with a supported interface and no Microsoft patch | Hardware analyzer/validated trace distributions | NOT RUN |
| P1-09 | 1 | Driver Verifier, reconnect, surprise removal, sleep/hibernate and fast-startup tests have no unresolved fault | Disposable-host logs and dump analysis | NOT RUN |
| P1-10 | 1 | A tier needing a Microsoft patch, undocumented offset, disabled protection or ambiguous bus evidence is recorded `BLOCKED` and not exposed | Capability record and test decision | NOT RUN |
| P2-01 | 2 | Signed fixed-operation helper has authenticated nonce-scoped IPC and no generic bridge | Protocol tests and security review | NOT RUN |
| P2-02 | 2 | Protected journal proves ACL ownership, append-only fsync ordering, cross-process CAS and exact recovery after every injected fault | Recovery/fault matrix | NOT RUN |
| P2-03 | 2 | Production filter passes applicable CodeQL/static analysis, package/INF validation, Driver Verifier and PnP/power matrix | Frozen evidence bundle | NOT RUN |
| P3-01 | 3 | Existing Input Devices flow completes setup through ready/not-ready and exact restoration without redesign | Nine-workspace/eight-theme fixtures and owner review | NOT RUN |
| P3-02 | 3 | Only rates with a current `SUPPORTED` compatibility record are offered | Schema/manifest integration tests | NOT RUN |
| P4-01 | 4 | App/helper/driver/installer are signed/timestamped and exact publisher/catalog/package pins match | Release manifest and signature checks | NOT RUN |
| P4-02 | 4 | WHCP/HLK, clean install, upgrade, rollback, uninstall, power/recovery, anti-cheat and supported device/Windows matrix pass | Frozen clean-release evidence | NOT RUN |
| P4-03 | 4 | Targeted IP/provenance and legal review accepts the frozen implementation | Signed review record | NOT RUN |
| P4-04 | 4 | The owner approves the exact release artifact and public claims | Exact-artifact owner approval | NOT RUN |

| P1-11 | 1 | A documented general Windows/WDK mechanism for the intended interrupt schedules is either identified with exact sources or the tier is recorded BLOCKED | Official Microsoft documentation review and recorded provenance | PASS as a review; result is BLOCKED for a general host-side interval override. Current Microsoft documentation states a driver cannot change the firmware-owned polling interval. Firmware-published alternate settings and published vendor protocols remain separate per-device questions (phase1/ADR-0002, P-010, P-024) |
| P1-12 | 1 | The selected-device identity, complete inventory, composite scope, lifecycle ordering, one-delta rule and sealed recovery chain are machine-enforced before any attachment | Target-binding schema, validator, synthetic single-step and six-step chain fixtures | PASS as an offline source contract (42 tests, including exact VID/PID/interface/composite-scope and schedule mechanism/provenance/endpoint binding, capability validation/provenance resolution, replay, reorder, broken checkpoint link, mid-chain identity change and unreconciled boot-session change); it proves no native behavior and grants no live authorisation |

## Phase 1 decision rule

Phase 1 is `PASS` only if at least one documented architecture produces
repeatable selected-endpoint bus evidence, survives required lifecycle tests and
needs no security reduction. Results are recorded per compatibility class and
rate. A partial pass never authorizes “any device” or general latency claims.
