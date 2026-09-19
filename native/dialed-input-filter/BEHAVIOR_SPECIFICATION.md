# Dialed native input stack behavior specification

Status: independently specified Phase 0 requirements. This document describes
required behavior, not demonstrated driver capability.

## Product outcome

Dialed extends the existing **Input Devices** workspace with one standalone
setup/recovery path for a selected physical input device. It preserves the nine
workspaces, eight themes, current navigation, visual identity and the default-off
Technical details model. It does not add a laboratory workspace or redesign the
accepted flow.

For a compatible device on a supported Windows stack, the intended sequence is:

1. Detect one physical device and its complete USB topology and composite scope.
2. Recommend a defensible connection topology without claiming lower latency.
3. Resolve an exact compatibility-class record and offer only proved request
   rates.
4. Show the package, selected scope, requested rate, restart/reconnect effect,
   recovery path and claim limits before any elevation request.
5. After confirmation, revalidate the exact package, publisher, selected-device
   digest, requested rate, full present/non-present/phantom inventory, current
   Windows build and security state.
6. Use a separately signed fixed-operation helper to install the reviewed package
   and attach it only to the selected physical-device scope.
7. Apply the reviewed request, read back configuration, require a reconnect or
   restart only when Windows reports it, and reconcile the new driver session.
8. Return a simple ready/not-ready result while keeping configured state, active
   session, Windows delivery, USB bus cadence and end-to-end latency separate.
9. Keep exact detach, restore, repair, upgrade and package removal available even
   after an interrupted operation or failed verification.

## Required component behavior

### Dialed application

- Runs `asInvoker`; ordinary discovery and status are non-elevated.
- The renderer can request only typed preview, apply and reconcile operations. It
  never supplies a path, device instance id, service name, INF name, Registry
  coordinate, command line or arbitrary IOCTL.
- A preview is bound to an exact package, device digest, rate, complete inventory,
  current lifecycle revision and short expiry. Apply consumes it once.
- Administrator consent is requested only after the user confirms the preview.
- UAC cancellation before mutation returns `NOT_APPLIED` and preserves truthful
  current state.
- The UI never restarts Windows automatically and never hides recovery because a
  later verification step failed.

### Port and topology advisor

- Uses the existing Dialed-owned topology scanner and stable physical-location
  identity.
- Records negotiated speed, host-controller path, hub depth, direct/hub
  attachment, interface scope and reconnect comparison.
- Recommends a topology for isolation and compatibility only. It must not call a
  port the lowest-latency port without independent measurement.
- Ambiguous physical scope or incomplete composite-device mapping blocks a
  mutation preview.

### Privileged helper and service boundary

- One separately signed x64 helper exposes a fixed protocol version and a finite
  operation enum: package preflight, target preflight, observe, install, repair,
  upgrade, attach, detach and remove.
- IPC is local, authenticated, nonce-scoped, single-use for mutations and bound to
  the invoking Dialed package/publisher identity.
- The helper revalidates every security-sensitive input at preview, apply and each
  individual mutation boundary. A prior renderer or main-process check is never
  sufficient.
- The helper owns an ACL-protected, append-only machine journal with cross-process
  compare-and-swap serialization. Renderer-visible state contains only opaque
  references, digests and redacted outcomes.
- The helper exposes no generic process, script, path, service, Registry or IOCTL
  bridge.

### Dialed filter

- Uses only current documented Windows/WDF interfaces whose exact sources and
  licenses are recorded in the provenance ledger.
- Is a device-specific filter. Class-wide attachment is outside the initial
  product scope.
- Defaults to transparent pass-through and no scheduling change.
- Changes scheduling only for an exact supported compatibility class and reviewed
  request. An unknown device, firmware, Windows build, controller or composite
  scope remains unchanged.
- Treats USB descriptors and all device responses as untrusted, bounded input.
- Forwards unsupported requests without semantic change and completes owned
  requests exactly once.
- Fails closed before a mutation and fails safely/pass-through after an unexpected
  runtime fault whenever Windows permits safe forwarding.
- Handles Plug and Play start/stop/remove, surprise removal, disconnect/reconnect,
  sleep/hibernate, fast startup, power transitions, update, rollback and uninstall.
- Never patches executable code, scans kernel memory, changes a Microsoft driver
  image, uses undocumented offsets or changes Windows security policy.

## Exact recovery contract

Before every native write, the protected journal seals and chains the complete
preimage:

- ordered filter list including absence;
- exact selected request and prior absence/value semantics;
- filter service, OEM INF and package identities;
- exact package and driver hashes;
- Secure Boot, Memory Integrity and driver-signature state;
- complete present, non-present and phantom attachment inventory; and
- boot identity and driver-session identity.

Each step permits one declared semantic delta. Collateral attachment, package,
rate, presence, inventory, security or boot/session drift enters durable
`NEEDS_REVIEW`. Package removal is impossible until every managed attachment,
including phantom scope, is verified absent. Recovery never depends on disabling
Secure Boot, Memory Integrity, Defender, signature enforcement or UAC.

## Evidence and claim model

| Evidence level | Required meaning | Must not be presented as |
| --- | --- | --- |
| Configured | The reviewed request was applied and read back | Active driver session, USB cadence or latency |
| Driver/session active | Exact signed package and selected attachment are active after required restart/reconnect | USB cadence or latency |
| Windows delivery | Bounded selected-device app-path events are consistent, below request or inconclusive | USB transactions, fresh reports or latency |
| USB bus delivery | Selected endpoint cadence is established by a validated trace or hardware analyzer | End-to-end input latency |
| End-to-end latency | A separate controlled physical-input-to-response method produced a distribution | Universal benefit for other hardware/workloads |

An 8 kHz consumer claim requires a `SUPPORTED` device-capability record whose
configured, active-session and USB-bus gates all pass for the exact compatibility
class. Windows event volume alone cannot satisfy it.

The compatibility-class `status` is a deterministic summary, not a substitute
for the selected rate result: it is `SUPPORTED` when at least one exact rate is
supported, otherwise `UNVERIFIED` while any rate remains unverified, otherwise
`BLOCKED` while any rate is blocked, and otherwise `UNSUPPORTED`. A caller must
still select the matching rate record. Every measured evidence result (`PASS`,
`FAIL` or `INCONCLUSIVE`) requires an immutable artifact hash; `NOT_MEASURED`
requires no artifact. Endpoint references, speed/`bInterval` ceilings and all
material invalidation triggers are machine-validated before a record is usable.

## Hard-stop behavior

The affected rate tier is `BLOCKED`, not degraded or silently substituted, when:

- it needs a Microsoft USB-driver patch, undocumented kernel offset or weakened
  Windows protection;
- the exact selected scope cannot be distinguished from another device;
- the filter cannot remain stable through Driver Verifier, PnP/power and
  reconnect testing;
- exact recovery is not available after a partial operation;
- independent bus evidence cannot identify the selected endpoint or rate;
- provenance is contaminated by unlicensed implementation material; or
- a supported anti-cheat/Windows compatibility conflict remains unresolved.

## Phase boundary

- Phase 0 contains no WDK project, driver source or native payload.
- Phase 1 now contains only an isolated offline WDK source project and an
  unresolved `.inx` template; neither is part of the product build.
- Phase 1 also contains an offline target-binding contract (schema, validator and
  synthetic fixture) that machine-enforces selected-device identity, complete
  inventory, composite scope, lifecycle ordering, the one-delta rule and sealed
  recovery. It is a source contract only and proves no native behavior.
- Scheduling remains blocked: no documented general Windows/WDK host-side
  interface overrides an interrupt endpoint interval independently of device
  firmware. Firmware-published alternate settings and published vendor protocols
  remain separate per-device questions
  (phase1/ADR-0002-DOCUMENTED-SCHEDULING-INTERFACE.md).
- A generated INF, SYS, CAT, helper or installable package remains out of scope.
- signing or Hardware Dev Center submission
- test-driver installation, restart, device mutation or analyzer capture
- production capability enablement or marketing claims
