# HIDUSBF integration boundary

## Current implementation — 2026-09-05

Native continuation supersedes the earlier library-only description below: separate
broker/helper executables, native observation/session/fixed Windows executor and
guarded Electron launch now build. Native confirmation uses helper-owned previews.
Signing anchors are empty; executable resources are unsigned and never launched.
See native/hidusbf-helper/README.md and the latest VERIFICATION.md entry. Full
physical1–8k operation remains unverified. Earlier package evidence is historical.

Unchanged bundling is active. The corrected legacy-service route decision in
HIDUSBF_RIGHTS_AND_PACKAGE_DECISION.md supersedes the blanket install rejection
below. Initial implementation stages both official archives and ten selected x64
payload/notice files in vendor/hidusbf, with 53 file hashes/signature observations.
The pinned bundled-inventory.cjs verifier refuses changed, missing, extra or linked
payloads. electron-builder now includes the ten selected files, inventory and credit
policy as inert resources; original archives remain repository provenance only.
Private resource inspection is recorded in VERIFICATION.md. The normal-mode UI
shows verified files and untested1/2/4/8k availability without enabling installation.

The separate legacy-service reference contract/orchestrator models exact file/service
identity, both parameter locations, orphan refusal, ordered filters/value absence,
adoption ownership,1/2/4/8k requests and crash/restart/replay behavior. Native library
components implement peer checks, local-only bounded framing and journal primitives;
they are not a broker/helper executable or connected Windows executor. Production is
UNCONFIGURED. Full integration remains unfinished; do not describe these fixtures as
native execution or physical recovery. See docs/HIDUSBF_PHYSICAL_ACCEPTANCE.md.

The following 2026-09-04 route conclusions are historical where they conflict with
the corrected decision. Continue with docs/HIDUSBF_BUNDLED_1K_8K_NEXT_TASK.md.

Updated: 2026-09-04 (route decision reproduced from primary sources).

## Decision

Dialed will evaluate the shortest standalone route: integrate exact, unmodified
files from the official HIDUSBF distribution behind Dialed's existing Input
Devices UI, safety checks and recovery lifecycle.

This is **not** a plan to compile HIDUSBF. The official repository currently
publishes prebuilt archives but no compilable driver source or license file.

## Route decision (2026-09-04)

Reproducing the primary sources settled which route is buildable. The full matrix,
quotations and retrieval dates are in
[HIDUSBF_RIGHTS_AND_PACKAGE_DECISION.md](HIDUSBF_RIGHTS_AND_PACKAGE_DECISION.md).

- **Adoption of an already-installed exact reviewed package is the recommended
  candidate route.** Its fail-closed adapter, helper protocol, and deterministic
  fixtures exist offline. They are not wired to a native authenticated helper or the
  production lifecycle, and no live attachment has been tested. The intended route
  ships no upstream file, stages no driver package, and installs nothing.
- **Installing a redistributed package is blocked, and not only on rights.** Microsoft
  is now the sole provider of production kernel-mode signatures, third-party release
  certificates can no longer sign a driver package catalog, a Microsoft submission
  applies Microsoft embedded signatures and so conflicts with the current exact-byte
  constraint, and attestation additionally requires a symbol file upstream does not
  publish. This blocks the current artifact/permission/source combination; upstream
  cooperation, source and symbols, or a suitable upstream-signed package could change
  the feasibility decision and would require a new review.
- The upstream INF has no `CatalogFile` directive, and adding one would modify a file
  the maintainer asked not to have changed.
- Copying the SYS into System32 and creating a service directly is refused: it leaves
  no Driver Store record, no clean removal and no supported upgrade identity.

## Verified upstream permission

In [issue #407](https://github.com/LordOfMice/hidusbf/issues/407#issuecomment-5043047919),
the repository owner stated on 2026-07-22: "Binaries are in Public Domain. You are
free to do anything except changing those files and continue to name them MY," and
answered "Yes, you are free to do this" to bundling the binaries and INF files
unmodified.

**That reply was given to Jbogert123 about CINCH OC, a separate free tool.** Dialed was
not the requester and intends to charge for the application, so the commercial question
is recorded UNRESOLVED rather than inherited. The same reply also records that the
upstream driver is signed through another company's signing arrangement, which is why
Dialed must not assume it may resubmit that binary.

That supports an exact-file evaluation. It does not authorize Dialed to silently
assume that every adjacent question is settled. Before paid public distribution,
record a targeted conclusion for commercial use, automated installation,
attribution/trademark wording and the exact files/version shipped.

## Technical facts that control the design

- Official repository: <https://github.com/LordOfMice/hidusbf>
- Official archive SHA-256:
  `BD8D1FB0545D8DF88D9CEF0C67682DAEF7D304561BC64ACFEE5C0D8C12D0F797`
- The archive contains prebuilt SYS variants, INF files and Setup tools; it has no
  CAT file and exposes no driver source project.
- The AMD64_AS SYS variants inspected on 2026-09-02 have valid Microsoft Windows
  Hardware Compatibility Publisher signatures. The INF files have no
  `CatalogFile` directive, so they are not a signed PnP package merely because the
  SYS has an embedded signature.
- The upstream Setup tools are self-signed and not trusted by the current Windows
  trust chain. Dialed must not treat them as its privileged helper.
- The upstream documentation warns that patching versions require Memory
  Integrity disabled on recent Windows. Dialed will neither disable that protection
  nor tell a customer that doing so is required for a supported result.

## Integration contract

1. Accept only one explicitly reviewed official archive identity and exact allowed
   file hashes. Reject extra, missing, renamed or changed files.
2. Preserve upstream files byte-for-byte. Do not rebrand or modify them while
   presenting them as the author's files.
3. Keep privileged operations main/helper-owned and fixed-purpose. Never expose a
   generic elevated command, path, Registry or service bridge.
4. Re-read the selected physical device, USB topology, filter scope, driver hash,
   signer and requested rate at preview, apply and reconciliation boundaries.
5. Capture exact prior state before mutation, journal `PENDING`, permit only the
   reviewed target/scope delta, verify readback and retain exact conflict-aware
   detach/removal recovery.
6. Keep configuration, presumed loaded tier, Windows app-path delivery, USB bus
   transactions and end-to-end latency as five different evidence levels.
7. Keep the production feature `UNCONFIGURED` until rights, package trust, signing,
   physical test-PC lifecycle and owner gates pass.
8. Complete the safe reviewable offline prototype before the owner sends the additional
   permission request. On the normal Input Devices page, visibly credit HIDUSBF as
   the upstream kernel filter created by SweetLow and maintained by LordOfMice,
   with an accessible fixed link to <https://github.com/LordOfMice/hidusbf>.
   Repeat accurate credit in notices/inventory, preserve upstream names and never
   imply that Dialed authored HIDUSBF.

## Completed safe offline slice

- Added an offline upstream-package manifest/validator using only exact public
  archive evidence and synthetic fixtures.
- Modelled the current catalog-less INF and self-signed Setup tools as explicit
  blockers, not hidden exceptions.
- Added source-only adapter/helper contracts and deterministic fixtures. These modules
  currently have no production callers and do not constitute a native helper.
- Preserved the normal Input Devices status and credit while production remains
  `UNCONFIGURED`.

The next steps require owner-controlled permission/legal decisions, a refreshed archive
pin if approved, a real authenticated native helper/package route, and later dedicated
physical-PC acceptance. None is implied by the offline fixture results.

Stop before copying the payload into product resources, invoking Setup, installing
a service/filter, restarting a device, rebooting, signing or changing Windows.

## Testing environment

Automated work uses source and fixtures on the current PC. Real install/recovery
work uses a dedicated physical Windows test PC after a specific owner packet is
approved. A VM is not part of the plan and cannot prove the relevant physical USB
behavior.
