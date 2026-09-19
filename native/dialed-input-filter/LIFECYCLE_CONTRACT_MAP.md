# Existing lifecycle contract map

Status: Phase 0/1 map of the current production-disabled Dialed contract to the
clean-room driver/helper boundary. The offline transparent-filter source does not
change the UI, package an artifact or enable an operation.

## Current source contract

| Surface | Current contract | Source evidence |
| --- | --- | --- |
| Configuration gate | Package status, immutable manifest digest, protected-store identity and clean-machine acceptance must be configured; trusted adapter and protected append-only store attestations must exist | `src/main/input-driver-lifecycle/index.cjs:602-615`; `package.json:74-88` |
| Package loading | Manifest is package-relative, traversal-contained, digest-pinned and bound to permission/publisher pins before payload and helper attestation | `src/main/input-driver-lifecycle/index.cjs:619-637` |
| Native observation | Read-only attestations and recovery checkpoints have distinct kinds; operation id, journal identity, freshness and append-only chain are checked | `src/main/input-driver-lifecycle/index.cjs:652-666` |
| Target preflight | Helper must attest the exact device digest, rate and checkpoint; unknown, disconnected, incompatible or rate-ineligible targets fail | `src/main/input-driver-lifecycle/index.cjs:669-685` |
| Public status | Capabilities are action-specific; renderer receives redacted package/ownership/count/outcome data, not native coordinates | `src/main/input-driver-lifecycle/index.cjs:692-717` |
| Drift handling | Interrupted operations, saved review state, observation failure and exact-state/package drift produce `NEEDS_REVIEW` | `src/main/input-driver-lifecycle/index.cjs:727-749` |
| Preview token | Random short-lived single-use token binds a private plan; preview discloses action, rate, elevation/restart expectations and public package facts | `src/main/input-driver-lifecycle/index.cjs:752-757` |
| Operations | Install/attach, adoption, repair, upgrade, exact detach and package removal have distinct preconditions and exact step plans | `src/main/input-driver-lifecycle/index.cjs:782-854` |
| Renderer IPC | Main validates scalar digest/rate/token/operation id and capability-gates mutation channels | `electron/main.cjs:128-167`; `electron/preload.cjs:31-40` |
| Product UI | Current Input Devices UI displays `UNAVAILABLE`, reviewed action buttons, exact-scope confirmation, UAC/restart wording and reconciliation without exposing an enabled package | `src/components/InputDevicesCenter.tsx:276-300` |

## Future adapter mapping

The first filter package is constrained to `PNP_FILTER`: an extension INF uses
declarative `AddFilter` at the lower position for one exact USB HID interface.
The transparent prototype owns no requests and depends on no relative filter
order. Primitive, class-wide and Microsoft-driver-patching routes are rejected.

| Existing adapter method | Future fixed helper operation | Required native result |
| --- | --- | --- |
| `preflightPackage` | `PREFLIGHT_PACKAGE` | Exact INF/SYS/CAT/helper/app bytes, catalog membership, signatures, revocation, publisher, Windows/security compatibility and provenance pins pass |
| `preflightTarget` | `PREFLIGHT_TARGET` | Exact physical digest, connection, complete composite scope and compatibility-class/rate eligibility attested against the current checkpoint |
| `observe` | `OBSERVE_STATE` or `EXTEND_RECOVERY_CHECKPOINT` | Full package, service, selected/other attachment, present/non-present/phantom, request, restart, boot and session state sealed; public result redacted |
| `installPackage` | `INSTALL_PACKAGE` | Only the reviewed immutable package becomes installed; no attachment or unrelated package changes |
| `attachFilter` | `ATTACH_SELECTED_DEVICE` | Only the reviewed physical scope gains the Dialed filter and reviewed request |
| `detachFilter` | `DETACH_SELECTED_DEVICE` | Only the selected saved scope loses the Dialed filter; package remains |
| `repairPackage` | `REPAIR_EXACT_PACKAGE` | Package identity remains exact; all Dialed-managed scopes are restored to their saved requests after repair |
| `upgradePackage` | `UPGRADE_EXACT_PREDECESSOR` | Only an allowlisted exact predecessor changes to the reviewed package; saved scopes are restored |
| `removePackage` | `REMOVE_DETACHED_PACKAGE` | No present/non-present/phantom attachment remains and only the Dialed-owned package is removed |

The helper protocol must not expose these implementation coordinates to the
renderer. The main lifecycle continues to send only an opaque device digest,
reviewed rate, preview token or saved operation id.

## State mapping

The current state machine in `src/main/input-driver-lifecycle/index.cjs:32-61`
already supplies the required product states. The native implementation must not
create a second lifecycle:

- `UNAVAILABLE` remains the production default until every static gate passes.
- `READY_FOR_PREFLIGHT` means the signed package/helper/store and supported-scope
  evidence are configured, not that a device has been changed.
- preview/install/attach/repair/upgrade/detach/remove states map one-to-one to the
  future fixed helper operations above.
- `RESTART_REQUIRED` blocks another mutation until exact reconciliation.
- `NOT_APPLIED` records cancellation before a native change.
- `NEEDS_REVIEW` is durable and never auto-resumes a partial operation.

## Phase 0 gaps retained as gates

1. No documented general Windows/WDK host-side interval override exists. The
   2026-09-03 review found that a driver cannot change an interrupt endpoint's
   firmware-owned polling interval, so the general bus-level feasibility gate
   cannot be attempted; the offline transparent prototype deliberately owns no
   requests. Firmware-published alternate settings and published vendor protocols
   remain separate, unresolved per-device routes.
2. No compiled or production driver/helper, installable package or protected
   machine store exists.
3. No exact Dialed publisher, package identity, signature, catalog or payload hash
   is configured.
4. No supported Windows/device compatibility record is `SUPPORTED`.
5. No production adapter injects the fixed helper operations.
6. No clean-machine install/restart/repair/upgrade/detach/removal evidence exists.
7. No Phase 1 live environment, signing/submission action, restart or device is
   approved.

Therefore `package.json` must remain `UNCONFIGURED`, the
`input:driver-lifecycle` capability must remain unavailable, and the accepted UI
requires no Phase 0 source change.
