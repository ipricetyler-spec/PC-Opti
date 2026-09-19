# Safety model

The executable source of truth is `src/main/capabilities/index.cjs`. UI copy and future presets must not weaken its metadata.

## Runtime profiles

The Electron main process resolves exactly one `owner` or `public` runtime profile. Packaged builds read the default from `package.json`; `PC_OPTI_RUNTIME_PROFILE` is honored only by an unpackaged development/test process and cannot override a packaged build. The renderer can read the resolved profile and its filtered capability records but cannot select or elevate it.

Owner's Edition is the current packaged default. The public profile includes only capabilities marked `publicAvailability: ENABLED`; `CANDIDATE` means hidden and refused until its integration evidence is complete, and `DISABLED` means intentionally unavailable. Every sensitive IPC handler checks the active profile in the main process. Hiding UI is a usability consequence, not the security boundary.

Local history remains visible in both profiles, but a rollback affordance is removed when the entry's original capability is unavailable in the active profile. Direct rollback calls are refused using the entry's main-process journal record.

## Classes

- **S0 — Observation:** read-only state.
- **S1 — Low-risk reversible:** narrow current-user or session action with deterministic rollback.
- **S2 — Privileged reversible:** narrow persistent/system-wide action with deliberate elevation and strong rollback.
- **S3 — Advanced conditional:** requires extra applicability evidence or is intentionally non-reversible.
- **S4 — Guidance only:** Dialed explains but does not mutate.
- **S5 — Research/prohibited automation:** no executable control.

## Mutation contract

1. Validate the typed IPC input and map it to a known capability.
2. Re-read authoritative state immediately before mutation.
3. Reject stale, unsupported, unexpected-kind, changed, or ambiguous targets.
4. Write a local `PENDING` journal entry containing the captured pre-state.
5. Execute one fixed-scope native operation without renderer-supplied commands.
6. Re-read the target and compare with the intended state.
7. Record the exact outcome, exit evidence, and rollback availability.
8. On rollback, verify the target still matches the state Dialed applied; never overwrite diverged state.
9. After interruption, reconcile current state and never retry blindly.

Operational success is not a performance claim. A setting can be verified while producing no measurable user benefit.

## Privilege model

New packaged Windows apps request administrator access through their executable manifest and ordinary UAC at launch. Development sessions still inherit their caller's privileges. S2 actions continue to fail closed when not elevated and retain explicit per-action consent, target validation and rollback. The native input helper additionally requires its signed policy, pinned executable identities and fixed typed protocol; elevation alone cannot enable an unconfigured helper. A shell, PowerShell text, file path, Registry path, or generic command supplied by the renderer must never cross that boundary. No compatibility Registry override or UAC bypass is used.

## Unsupported states

Use `Unknown`, `Unsupported`, `Permission required`, or `Vendor-specific`. Zero, false, an empty list, or a synthetic score must not substitute for unavailable evidence.

`SystemScanSnapshot` schema `1.1.0` enforces this rule for expanded diagnostics with tagged evidence records: `AVAILABLE`, `UNKNOWN`, `UNSUPPORTED`, or `PERMISSION_REQUIRED`. Only `AVAILABLE` records may contain a value. Observed `false` remains valid evidence when Windows explicitly returned it; an unavailable record cannot contain a placeholder value.

## Recommendation contract

Local recommendations are deterministic main-process output over a validated snapshot and capability metadata. Each item must contain an observation, rationale, cited field paths, expected benefit, risk, confidence, applicability, action/guidance status, rollback information, and verification method. `OPTIONAL_ACTION` identifies a separately reviewable capability; it never applies it. Guidance cannot create a renderer-supplied command or bypass the mutation contract.

## Local evidence retention contract

Export is allowlist-based, previewed exactly, and written only through a main-owned save dialog. Retention deletion requires a fresh preview and unchanged full-journal fingerprint. `PENDING`, `NEEDS_REVIEW`, invalid/unclassified, and rollback-available entries are protected. Deletion is permanent local evidence removal, never rollback, and cannot be triggered with renderer-supplied entry IDs or paths.
