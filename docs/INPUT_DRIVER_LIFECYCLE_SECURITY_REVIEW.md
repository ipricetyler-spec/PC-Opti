# Standalone input-driver lifecycle security review

Updated: 2026-08-30 local / 2026-08-31 UTC.

## Result

The bounded offline Codex Security Standard review completed with **zero
reportable findings**. This is source evidence for the disabled, payload-agnostic
lifecycle foundation. It is not approval of a future driver package, signed
helper, protected journal, UAC transport, installer or live Windows behavior.

- Scan id: `b60ecc0b-f747-4d04-a544-19cb0aed5a06`
- Baseline HEAD: `e567e1e7c592abb70dd5184b8e2282b44d16ff9c`
- Target id: `target_sha256_2a00cd71be317ddced91165b039896b8128c695677c6ea5d0f442d5cfa54af44`
- Snapshot digest: `codex-security-snapshot/v1:sha256:bdff0452c861d991886a5fb42b7f73827dc7244e6f3038aa49a3425150bf0568`
- Validation mode: offline static source review; application and driver code were
  not executed.
- Coverage label: partial at repository level because authorization deliberately
  excluded every file outside the lifecycle inventory; all 12 named files below
  were fully reviewed.

## Exact inventory

1. `src/main/input-driver-lifecycle/index.cjs`
2. `src/main/input-driver-lifecycle/driver-package-manifest.schema.json`
3. `src/main/input-driver-lifecycle/driver-package-manifest.example.json`
4. `tests/input-driver-lifecycle.test.cjs`
5. `tests/input-driver-lifecycle-ipc.test.cjs`
6. `electron/main.cjs`
7. `electron/preload.cjs`
8. `src/electron.d.ts`
9. `src/lib/inputDevices.ts`
10. `src/components/InputDevicesCenter.tsx`
11. `scripts/check-input-devices-ui.cjs`
12. `package.json`

## Reviewed security properties

- Renderer IPC accepts only typed device digests, reviewed rates, opaque preview
  tokens and operation ids; it exposes no path, Registry, service or generic
  command bridge.
- Production remains `UNCONFIGURED` and supplies no trusted Windows adapter,
  protected transaction store or driver/helper resource, so standalone mutation
  is unreachable.
- Candidate preflight pins legal grants, package identity, INF/SYS/CAT/helper/app
  trust, signers, revocation, catalog membership, host compatibility, hashes and
  exact selected target/rate.
- Preview tokens are short-lived and single-use. Apply and every mutation boundary
  recheck the selected target, rate and exact state.
- Complete present, non-present and phantom attachment inventory, opaque native
  preimage seals, append-only checkpoints, exact allowed deltas and readback are
  required before success can be recorded.
- Public status and errors redact native device, checkpoint, journal, Registry,
  service and package-path state.

## Follow-up hardening and verification

The independent Windows review found no enabled-driver source defect and requested
schema/runtime consistency hardening. The manifest schema now requires exactly one
INF, SYS, CAT and helper entry and independently rejects absolute, traversal,
empty-segment and control-character payload paths. Browser fixtures also prove a
standalone confirmation is cleared when device selection changes.

On the resulting source:

- lifecycle core: 54/54 under Node and Bun;
- full source suite: 294/294;
- TypeScript, production build and clean-room parity: pass;
- dependency audit: zero vulnerabilities;
- isolated browser fixtures: pass across all eight lifecycle states, eight themes
  and 960/1280 widths without browser errors or horizontal overflow.

## External gates not covered

The review cannot establish the safety or correctness of components that do not
yet exist in production: the authorized signed INF/SYS/CAT package, signed narrow
helper and UAC transport, protected-machine ACLs and cross-process CAS/append-only
journal, real driver installation/upgrade/restore/removal, clean-machine/device
compatibility, signed installer/update lifecycle or owner acceptance. Production
must remain disabled until those separately reviewed gates pass.
