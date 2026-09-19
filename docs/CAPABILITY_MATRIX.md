# Capability matrix

| Capability | Class | Owner | Public | Experimental | Guidance only | Reason |
| --- | --- | --- | --- | --- | --- | --- |
| Verified system scan | S0 | Yes | Yes | No | No | Read-only with per-component errors |
| Installed-application inventory | S0 | Yes | Yes | No | No | Read-only bounded Windows metadata; unknown sizes remain unknown |
| Installed-game discovery | S0 | Yes | Yes | No | Yes | Matches read-only installed-app evidence to reviewed game guides |
| Game-config backup | S0 plus local file | Yes | Yes | No | No | Explicit selection, bounded exact-byte copy, versioned manifest, SHA-256 verification |
| Game-config restore | S1 plus local file | Yes | Yes | No | No | Short-lived preview token, stale refusal, recovery copies, output verification |
| Game graphics profile candidates | S1 plus local file | Yes | Yes | Yes | No | Fortnite/Rocket League/VALORANT/ARC Raiders exact preview, backup-first staged apply, game-closed/hash guards and restore; current-game acceptance pending |
| Bounded network-quality probe | S0 plus external request | Yes | Yes | No | Yes | Explicit consent, fixed 12-request/4.5 MiB plan, private-address refusal, no tuning |
| Current-user optional-app removal | S3 | Yes | Yes | No | No | Exact allowlist/identity, one package, no all-user/provisioned path, no deterministic rollback |
| Native PresentMon capture | S0 plus local child process | Yes | Yes | No | Yes | Pinned Intel-signed 2.5.1, fixed target/duration/output, no injection/elevation |
| Verified release update | S3 | Yes | Yes | No | No | Pinned feed/key/hosts/publisher, signed manifest, exact bytes/hash, explicit launch; unavailable until configured |
| Installed release/signature status | S0 | Yes | Yes | No | No | Checks only the exact running executable and distinguishes development preview |
| Deterministic local recommendations | S4 | Yes | Yes | No | Yes | Fixed rules cite schema-valid local evidence and never auto-apply |
| Redacted Local Audit History export | S0 plus local file | Yes | Yes | No | No | Exact preview, field allowlist, main-owned new-file save, stale refusal |
| Delete eligible completed history | S3 | Yes | Yes | No | No | Permanent local evidence deletion with protected entries and stale refusal |
| Import and compare benchmark evidence | S0 plus local storage | Yes | Yes | No | Yes | Repeated raw samples, strict conditions, variance-aware scoped interpretation |
| Delete benchmark experiment | S3 | Yes | Yes | No | No | Preview-token local evidence deletion; no Windows mutation |
| Current-user startup disable/restore | S1 | Yes | Yes | No | No | One exact Registry Run value, stale-state checks, deterministic rollback |
| Machine-wide startup disable/restore | S2 | Yes | Yes | No | No | Exact Registry view/value with deliberate elevation and stale-state refusal |
| Process EcoQoS apply/restore | S1 | Yes | Yes | No | No | Session-only, one selected eligible process, verified rollback |
| Disable Windows consumer features policy | S2 | Yes | Yes | No | No | Machine-wide elevation, restore-point boundary, and edition-dependent effect |
| Performance Lab evidence and bounded timing experiments | S0/S3 | Yes | Yes | Yes | No | State is visible; mutation remains elevated, backup-first, rebooted, and measurement-dependent |
| Clear enumerated temporary files | S3 | Yes | Yes | No | No | Narrow but intentionally non-reversible |
| SSD ReTRIM request | S3 | Yes | Yes | No | No | Revalidated native target; benefit is not guaranteed |
| Integrated signed input-driver lifecycle | S3 | Candidate | No | Yes | No | Full fixture architecture remains disabled until rights, catalog-signed payload, signed helper/app and clean-machine lifecycle acceptance pass |
| External AI audit | Parked | No | Not shipped | No | Historical code only | Not part of the current grounded local product |
| Hardware-matched BIOS plan | S4 | Yes | Yes | No | Yes | Source-backed local CPU/board/RAM/GPU matching, manual steps and recovery, explicit unknown/OEM cases |
| Automatic BIOS/UEFI changes | S5 | No | No | Research | No | No safe general write/rollback mechanism; manual guidance is separate |
| Kernel/unsigned driver techniques | S5 | No | No | Research | No | Attack surface, signing, compatibility, and anti-cheat risk |
| GPU overclock/voltage/fan control | S5 | No | No | Research | Yes | Requires supported vendor API and hardware guardrails |
| Registry/RAM/page-file/driver “cleaners” | S5 | No | No | No | No | Rejected as unsafe, unverifiable, or misleading |

Detailed runtime metadata lives in the capability registry. As of 2026-08-29, the normal `public`, `consumer-premium`, and `owner` profiles expose the same 28 implemented capabilities; monetization splitting is deferred. This does not bypass safety: eligibility, freshness, privilege, restore-point, backup, confirmation, rollback, and reboot boundaries are still enforced independently by the Electron main process. Packaged profile selection cannot be elevated by renderer IPC or an environment override.

Expanded scan coverage in schema `1.1.0` includes GPU/driver/status, motherboard make/product without serials, active power scheme, HAGS, Game DVR, page-file diagnostics, storage provider health, physical NIC link state without external probing, Secure Boot, TPM, and virtualization. Each group reports an explicit availability state.

The six-section renderer keeps Storage & apps, Reliability / repair, Security, and Laptop power as read-only Scan sub-centers. The game catalog and network lab remain guidance/evidence surfaces; they do not convert publisher troubleshooting suggestions or endpoint timing into guaranteed performance claims.
