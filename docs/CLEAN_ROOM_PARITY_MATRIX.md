# Clean-Room Parity Matrix — OS-Level Performance Intent Mapping

Scope: documented OS-level intents in this repository only (no proprietary third-party internals or copied behavior), with reversible, evidence-led implementation.

## Matrix

| Row ID | Intent family | Evidence source (file:line) | Target outcome | Status | Mutation families | External-derived inspiration | Inclusion decision (clean-room) |
|---|---|---|---|---|---|---|---|
| CRP-PL-01 | Reversible boot-timing control | `src/main/timing/index.cjs:174-192`, `src/main/timing/index.cjs:202-265`, `src/main/journal/index.cjs:926-1144`, `src/components/PerformanceLab.tsx:1-80` | Deliver bounded BCD experiments with export backup and deterministic rollback metadata before and after action | ✅ PASS | `bcdedit` | Tuned timing flows should remain write+verify+undo, not opaque one-click toggles | **Include (behavior + contract only)** |
| CRP-PL-02 | Timing-state applicability + drift detection | `src/main/timing/index.cjs:74-115`, `src/main/timing/index.cjs:107-127`, `src/main/journal/index.cjs:987-1015`, `src/main/journal/index.cjs:1058-1134` | Keep current-state, intended-state, and post-action evidence comparable and detect divergence before repeating writes | ✅ PASS | `bcdedit` | Safe timing labs should reconcile drift states and preserve human-readable evidence | **Include** |
| CRP-PL-03 | Startup rollback fidelity | `src/main/journal/index.cjs:496-542`, `src/main/journal/index.cjs:681-705`, `src/main/journal/index.cjs:1235-1260`, `src/main/scanner/index.cjs:578-706` | Preserve exact startup value, name, and logical view; restore only when the post-action state is unambiguous and bounded | ✅ PASS | `startup-registry-run` | Safer startup tooling stores reversible, exact pre-state, not “best effort” resets | **Include pattern only** |
| CRP-PL-04 | Startup mutation scope safety | `src/main/scanner/index.cjs:44-49`, `src/main/scanner/index.cjs:701-707`, `src/main/journal/index.cjs:347-376`, `src/components/StartupCenter.tsx:39-64` | Restrict startup operations to supported registry keys/values and never perform bulk mutation paths | ✅ PASS | `startup-registry-run` | Conservative single-item write boundaries reduce blast radius | **Include** |
| CRP-PL-05 | Anti-cheat-aware uncertainty posture | `src/main/scanner/index.cjs:657-681`, `src/main/scanner/index.cjs:678-683`, `src/components/ReadinessCenter.tsx:22-44`, `src/components/ReadinessCenter.tsx:233-274` | Unknown/inexact anti-cheat states must stay flagged; no hard-coded green “safe” claims | ✅ PASS | `(none)` | Competitive tools should preserve anti-cheat uncertainty as a gating signal, not hide it | **Include as posture control** |
| CRP-PL-06 | Native evidence-state taxonomy | `src/main/scanner/index.cjs:612-642`, `src/main/scanner/index.cjs:668-684`, `src/components/ReadinessCenter.tsx:180-194` | Keep every diagnostic element in explicit AVAILABLE/UNKNOWN/PERMISSION/UNSUPPORTED states and expose unknown as actionable blockers | ✅ PASS | `(none)` | Evidence uncertainty belongs in the UI and is reversible-safe by default | **Include** |
| CRP-PL-07 | Benchmark pair discipline and uncertainty thresholds | `src/main/benchmarks/index.cjs:434-470`, `src/main/benchmarks/index.cjs:467-488`, `src/main/benchmarks/index.cjs:490-514`, `src/components/BenchmarkEvidence.tsx:1-150` | Enforce BASELINE + CANDIDATE pairing before comparisons and classify variance with clear caution states | ✅ PASS | `(none)` | Real tools should prevent synthetic gain claims from incomplete datasets | **Include** |
| CRP-PL-08 | Drift reproducibility snapshot contract | `src/main/drift/index.cjs:1-320`, `src/components/DriftMonitor.tsx:1-220`, `src/components/ReadinessCenter.tsx:260-300` | Capture, persist, and compare deterministic snapshots; changes should trigger explicit recommendations, not automatic repair | ✅ PASS | `(none)` | Read-only diff-first workflows are the marketable baseline for reliability UX | **Include** |
| CRP-PL-09 | Local workload planning context without runtime automation leakage | `src/App.tsx:205-540`, `src/components/WorkloadProfiles.tsx:1-232`, `src/components/DashboardOverview.tsx:1-140` | Keep workload intent explicit and local-first while keeping mutation controls separately by profile capability and capability state | ✅ PASS | `(none)` | High-value user workflows separate intent, evidence, and mutation sequencing | **Include** |
| CRP-PL-10 | Pre-action readiness aggregation | `src/components/ReadinessCenter.tsx:1-430`, `src/App.tsx:220-240`, `src/types.ts:1-90` | Generate one-pass aggregate readyness signal with WARN/BLOCKED blocking unknown or unsafe states, and actionable next-step sequencing | ✅ PASS | `(none)` | Aggregate scoring is product-facing trust infrastructure, not feature parity | **Include** |

## Target outcome alignment by capability area

| Capability area | Desired customer-facing result | OS-level controls in scope |
|---|---|---|
| Boot timing | Reproducible, bounded experiments with explicit rollbacks | `bcdedit` experiments, `restoreBootTimingAction`, startup-aware verification |
| Startup control | Deterministic, reviewable startup edits and recoverability | Registry scope checks, pre-action capture, rollback gating |
| Evidence posture | No ambiguous “pass” badge on missing/blocked sensor reads | Explicit evidence-state enum, visible uncertainty, readiness row blockers |
| Security context | Anti-cheat posture remains conservative without hidden suppression | Service/driver presence checks, running-state notes, no anti-cheat bypass behavior |
| Measurement evidence | No synthetic global performance claims from local sample noise | Baseline/candidate pairing, variance-aware comparison classes, rollback linkage |

## Release-parity gate status (for acceptance packets)

| Gate | Result | Notes |
|---|---|---|
| Evidence completeness with row IDs/anchors | ✅ PASS | Matrix now contains 10 clean-room rows with repository line anchors and explicit outcomes |
| Mutation-family check with current source scan | ✅ PASS | `scripts/check-clean-room-parity.cjs` passes with `bcdedit` and `startup-registry-run` documented coverage |
| Runtime-safe rollout condition | ✅ PASS | Automated work remains non-mutating; real lifecycle evidence is reserved for an approved dedicated physical test PC |
| Non-GM marketing readiness posture | ✅ PASS | Readiness and Performance Lab now emphasize hypothesis + rollback + uncertainty over score promises |
| Per-release publication hygiene alignment | ✅ PASS | Current status is routed only through `PROJECT_HANDOFF.md`, `VERIFICATION.md` and `ROADMAP.md` |

## Non-goals / exclusions (deliberate clean-room boundaries)

- No direct import of third-party settings, presets, internals, registry names, or mutation command bodies.
- No one-click optimization mode, hidden mutation scheduler, or opaque auto-chaining.
- No OS-level driver/package installation, BIOS firmware writes, or network quality mutation.
- No VM. No owner-host mutation during automated development.
- No synthetic “boost” claims from partial evidence or unsupported conditions.

## Next target outcomes to operationalize

1. Keep row anchors synchronized with every subsequent mutation-path change.
2. Keep matrix outcome states stable (`PASS`, `WARN`, `BLOCKED`, `OWNER_ONLY`) with explicit owner/public notes.
3. Extend parity snapshots only when new capability families are introduced and their evidence contracts remain reversible-first.
