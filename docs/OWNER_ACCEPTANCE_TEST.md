> Current status (2026-09-05): see [whole-app completion ledger](WHOLE_APP_COMPLETION_2026-09-05.md) and root VERIFICATION.md. Older counts/artifact statements below are historical. Bundled-driver lifecycle gates apply only if that paused route is resumed; the separate-install checker has its own physical compatibility and measurement acceptance.

# Dialed owner acceptance test

Updated: 2026-09-02. This is the current no-VM test model.

## What the testing proves

Testing is deliberately split because one type of test cannot prove everything:

| Layer | Where | Proves | Does not prove |
| --- | --- | --- | --- |
| Automated source/fixtures | Current development PC | Parsing, validation, UI, exact intended mutations, recovery logic and failure handling | A real driver installed, Windows accepted it, hardware timing changed or recovery works on a real stack |
| Windows/device lifecycle | Dedicated physical test PC | Clean install, device-stack behavior, restart/recovery, uninstall and security compatibility | Every customer machine/device or lower physical latency |
| Hardware measurement | Same physical test rig plus independent capture | Actual selected-endpoint USB transactions and, separately, physical latency | Universal benefit or every game/device |
| Owner UI acceptance | Exact packaged artifact on an approved PC | The product is understandable and flows work for the owner | Signing, commercial rights or public-release readiness |

A VM is not used. It cannot establish the physical USB/controller behavior at the
center of this feature, and the owner has rejected the VM direction.

## 1. Automated source and fixture gate

Run from the authoritative E: checkout with Bun:

```powershell
bun test
bun run lint
bun run build
bun run check:clean-room-parity
bun audit --audit-level=high
bun run test:ui:fixtures
```

Required results:

- exact package/archive and allowed-file hashes are accepted; all drift is rejected;
- missing/extra/renamed files, wrong signers, catalog-less package state and
  untrusted Setup tools remain explicit blocked states;
- target selection, scope mapping, preview, single-use authorization, readback,
  restart reconciliation, exact detach/removal and interrupted recovery fixtures
  pass;
- no fixture invokes a real driver, Registry, device restart, reboot or security
  change;
- all nine workspaces, eight themes and both tested widths render without browser
  errors or horizontal overflow.

## 2. Dedicated physical Windows test-PC packet

Before execution, record and approve:

- machine identifier and recovery/reimage method;
- Windows edition/build and updates;
- Secure Boot, Memory Integrity, Defender, Smart App Control and anti-cheat state;
- USB host controller, physical port/hub path, cable and target device firmware;
- exact Dialed/app/helper/archive/file hashes and signer identities;
- exact allowed install, attach, reconnect/restart, detach, removal and reboot steps;
- a known-good alternate keyboard/mouse and recovery path if the target stops.

Stop if the packet is incomplete or current state differs.

### Lifecycle cases

1. Clean machine, no HIDUSBF: status is truthful and no action is available until
   the reviewed package passes all checks.
2. Install: one reviewed elevation; verify exact service/file/package state and no
   unrelated filter/device delta.
3. Attach selected device: verify only the approved physical scope changes.
4. Apply supported rate: save exact prior state, verify configured readback and
   state that runtime effect is still unproved until restart/reconciliation.
5. Restart/reconnect only as approved; verify exact driver hash/signer, target,
   scope and requested value. Drift must become `NEEDS_REVIEW`, never success.
6. Conflict tests: external target/rate/filter/package changes must refuse stale
   apply or restore without overwriting them.
7. Interrupted-operation tests: stop after each durable checkpoint and verify safe
   reconciliation or explicit `NEEDS_REVIEW` after relaunch.
8. Exact restore and detach: restore only the captured state when current state
   still matches; verify the selected device remains usable.
9. Package removal: refuse while any present, disconnected or phantom attachment
   remains; remove only after the complete inventory is clean.
10. App uninstall/upgrade: never strand an unresolved driver operation or delete
    its recovery record; verify retained user data and reinstall behavior.

At every step, compare pre/post device inventory, filter scope, service/driver
state and the protected journal. Any unexplained delta fails acceptance.

## 3. Port and polling evidence

### Connection/port advisor

Verify that Dialed identifies the selected physical USB device, controller and
port/hub path, explains direct-versus-hub limitations and never labels a port
“faster” without measured evidence. Replug to one alternate physical port and
confirm the topology result changes to the new path.

### Windows app-path cadence

Run the bounded selected-device check three times. Confirm it counts only that
device's timestamped event headers, stores no key/button/movement content and
reports consistent/below-request/inconclusive without calling the result USB
transactions or latency.

### USB transaction proof

Use an independent selected-endpoint USB capture method on the physical rig.
Match device/interface/endpoint and compare transaction intervals before/after.
Raw Input alone cannot pass this gate.

### Physical latency proof

Use a controlled physical stimulus and independent response capture, enough
repeats for median/tail/spread, and matched before/after conditions. A configured
rate or USB transaction cadence alone cannot pass this gate.

## 4. Owner UI acceptance

Only after the relevant source and physical lifecycle gates pass:

- identify the exact packaged artifact by version/hash/signature;
- verify normal mode explains outcome, action, risk, restart and recovery without
  requiring Technical details;
- verify Technical details exposes hashes/signers/topology/evidence when requested;
- confirm keyboard navigation, focus, cancellation and failure recovery;
- do not infer permission for a driver action from approval to open the app.

## Failure conditions

Acceptance fails on any protection bypass, wrong-device or collateral mutation,
unexplained scope drift, stale overwrite, false success, missing promised recovery,
unsigned/untrusted privileged component, ambiguous evidence claim, data loss,
Critical/High safety defect or inability to return the physical test PC/device to
its approved baseline.
