# Dialed input filter clean-room boundary

Status: **reactivated for bounded offline engineering as of 2026-09-03.** Phase 0
contracts and an offline Phase 1 transparent-filter source prototype are preserved.
The owner reopened first-party documented-interface feasibility work; the exact
unmodified upstream-package evaluation in `docs/HIDUSBF_INTEGRATION.md` remains
separate comparison and compatibility evidence, not an implementation input. No
retained compiled driver, privileged helper, installable package, production
capability or live execution is present or authorized.

This directory is the ownership and provenance boundary for the proposed
first-party Dialed input filter. It exists so the behavior, security properties,
supported scope and evidence requirements can be reviewed independently before
any further WDK implementation is accepted.

## What is present

- [Behavior specification](BEHAVIOR_SPECIFICATION.md)
- [Existing lifecycle contract map](LIFECYCLE_CONTRACT_MAP.md)
- [Threat model](THREAT_MODEL.md)
- [Provenance ledger](PROVENANCE_LEDGER.md)
- [Supported-scope and Phase 1 proposal](SUPPORTED_SCOPE_AND_PHASE1_PROPOSAL.md)
- [Acceptance matrix](ACCEPTANCE_MATRIX.md)
- [Device-capability schema](schemas/device-capability.schema.json)
- [Device-capability structural and semantic validator](device-capability-validator.cjs)
- [Synthetic, non-product example](fixtures/device-capability.high-speed.example.json)
- [Target-binding and lifecycle-step schema](schemas/target-binding.schema.json)
- [Target-binding structural and semantic validator](target-binding-validator.cjs)
- [Synthetic, non-product attach binding](fixtures/target-binding.attach.example.json)
- [Synthetic, non-product lifecycle chain](fixtures/target-binding.lifecycle-chain.example.json)
- [Offline Phase 1 prototype and architecture decision](phase1/README.md)
- [Codex continuation handoff](CODEX_CONTINUATION_HANDOFF.md)
- [Documented-interface feasibility verdict (ADR-0002)](phase1/ADR-0002-DOCUMENTED-SCHEDULING-INTERFACE.md)

## Clean-room rule

Allowed design inputs are Dialed's independently written product requirements,
observable Windows/device behavior, published USB/HID specifications, current
Microsoft documentation and license-reviewed official samples recorded in the
provenance ledger. The owner-supplied HIDUSBF material and every other
third-party polling-driver implementation are outside this boundary and must not
be inspected, copied, translated, decompiled, disassembled or used to derive
code, INF metadata, identities, protocols, Registry layout, helper behavior, UI
copy or assets.

No external source file has been imported into this directory. If a later phase
imports an official sample, it must first add an exact source revision, file list,
license, hash and transformation plan to the provenance ledger.

## Documented-interface verdict

A 2026-09-03 review of current official Microsoft documentation found **no
general host-side Windows/WDK interval override** independent of device firmware.
Microsoft states that the polling interval "reflects the device's configuration in
firmware" and that "Drivers cannot change it". Every scheduling tier therefore
remains `BLOCKED_PENDING_DOCUMENTED_INTERFACE`, the `DOCUMENTED_WDF` schedule
mechanism is presently unreachable, and no rate claim is available at any
placement. A firmware-published alternate setting or published vendor protocol is
a separate, unresolved per-device route. The evidence, the two Microsoft
quotations and the resulting challenge to ADR-0001 are in
[ADR-0002](phase1/ADR-0002-DOCUMENTED-SCHEDULING-INTERFACE.md).

## Phase transition rule

Phase 0 added only specifications, schemas, synthetic fixtures and offline
validation. After independent review and the two contract repairs, Phase 1 added
an isolated transparent KMDF source project, unresolved INX template and static
contract tests. They remain outside the product build and cannot produce an
installable package on the current host. A production control remains disabled
until documented-interface feasibility, signing, protected recovery and
clean-machine acceptance all pass.

Target bindings are usable only after `target-binding-validator.cjs` passes. It
binds one exact physical device, container, opaque instance identity, interface and
interrupt-IN endpoint set to a complete present/non-present/phantom inventory, and
refuses an over-broad hardware identifier, an ambiguous composite scope, an
out-of-order lifecycle step, an unexpected delta, a stale or unsealed preimage, a
mutation outside D0, and any schedule request while the documented-interface gate
is blocked. A chain of steps is validated together with
`node target-binding-validator.cjs --chain <chain.json>`, which additionally
refuses a replayed, reordered or renumbered step, a broken checkpoint link, a
changed target identity mid-chain and a boot-session change that did not go
through explicit reconciliation. Add `--capability <record.json>` to cross-check
the binding against its compatibility class.

Capability records are usable only after the combined validator passes. Its CLI
first compiles and applies the strict Draft 2020-12 JSON Schema, then applies the
cross-field status, evidence, endpoint and USB interval rules; either layer fails
closed.

Historical clean-room execution detail remains in
[DIALED_NATIVE_INPUT_STACK_HANDOFF.md](../../docs/DIALED_NATIVE_INPUT_STACK_HANDOFF.md).
Current work resumes from [PROJECT_HANDOFF.md](../../PROJECT_HANDOFF.md).
