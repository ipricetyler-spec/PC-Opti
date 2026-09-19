# Input setup simplification - September 13, 2026

Status: **source and closed-fixture pass complete**. Resumed after the Codex app
interrupted the authorized full pass. This source is not in the preserved signed
reconnect test build. No new physical test, policy, signing or package is included.

## Normal path

1. Open Input Devices and select the device. Its name, saved rate and **Change
   rate…** are together. An unfiltered device instead shows **Set up polling rate…**.
2. Confirm the same device in setup. The helper reads protected history without
   changing it. If originals are already recorded for the exact scope, it selects
   the rate-change action. Otherwise, an eligible existing attachment offers
   **Review recording** first. Recording still requires confirmation.
3. Choose an applicable rate. Read the requirement, check the acknowledgment,
   and select **Review selected action**. Confirm the exact device, rate and
   reconnect/restart requirement, then choose **Confirm this action** once.
4. Follow setup's current instruction. A qualifying rate-only change follows
   **Review → Save setting → Reconnect device → Verify**. Keep setup open and use
   the same port. Other operations retain their own restart/recovery rules.
5. Completion names the device and requested rate, and explicitly distinguishes
   observed reconnect from a Windows restart. It remains visible beside the
   device. Starting another request keeps a separate **Last completed change**.
6. Closing setup refreshes the main app's saved settings and clears old
   measurements/previews. It does not itself prove success. Run the separate
   **Measured Windows delivery** check only when a new measurement is wanted.

Existing-driver adjustments, shared-driver controls and signed-package
maintenance remain under **Existing-driver tools and maintenance**. Relevant
recovery entries remain discoverable; using one opens its confirmation section.
Native shared-driver actions remain under **Driver maintenance and recovery**.
HIDUSBF attribution and its official link remain visible in the normal profile.

## Refusal and recovery behavior

- Setup status never enrolls a device, appends/migrates history, reconciles, starts
  a reconnect watcher or changes Windows. Pending status uses its saved operation
  instead of scanning temporarily incomplete disconnected topology.
- Enrollment requires matching device ID, interface scope and exact saved
  interval coordinate. Mismatch, pending/review state, unsupported speed/rate,
  policy/security limits and incompatible shared variants cannot offer an unsafe
  normal rate choice. PREVIEW/APPLY still validate independently.
- A reopened pending operation asks for **Check saved operation** before a fresh
  reconnect. Merely reading status does not resume it or repeat APPLY.
- Reconnect success requires explicit operation/device/rate/activation metadata.
  Generic CONFIGURATION_VERIFIED, adoption and restart recovery cannot be
  mislabeled as an observed device reconnect.
- Setup launch errors unlock the main page. While setup is open, conflicting
  controls are disabled. A close event carries no Electron event authority or
  operation payload; unsubscribe removes its listener. An in-flight old scan
  finishes before the fresh post-setup scan, so stale results cannot win.

## Verification

- `bun run lint`: PASS. Generated `output` is excluded so the original source
  backup is not type-checked as another application.
- `bun test --timeout 120000 ./tests`: **634 pass / 0 fail / 39 files**.
  Includes the new close-subscription contract, 57 setup-state checks, 113
  reconnect checks and the retained native/ownership/boot/inventory suites.
- Renderer build to the isolated evidence directory: PASS. Vite's existing
  greater-than-500-kB chunk warning remains; this is not a package build.
- Seven closed bundled-setup browser cases pass: ready, expired, missing helper,
  invalid bundle, Low-Speed, Low-Speed with invalid bundle, and Full-Speed.
  Disabled controls explain why, cancellation remains usable, and details start
  collapsed. Real native launches and Windows operations: zero.
- Main-page browser/service fixture: eight themes at 960/1280 px, no horizontal
  overflow or browser errors, all retained lifecycle states, keyboard confirmation
  and cancellation, exact selection, secondary recovery, automatic close refresh,
  and a deliberately delayed stale scan all pass. Operations use invented data.
- Eight inert WinForms scenarios render the actual setup controls, including
  recording, rate selection, compact 604x560 layout, pending reconnect, completion,
  inventory review and history refusal. Reviewed native-control captures and
  layout assertions pass. These are appearance fixtures, not a signed helper
  session, UAC/driver lifecycle test or owner visual acceptance.
- Corrected four-page local recovery PDF rendered and visually checked. The
  mistaken **Preview change** label is now **Review selected action**. Page 1
  records that the physical round trip is already complete and distinguishes the
  preserved build from the new source UI. Recovery command text still matches the
  original saved reference; none of those commands were executed.
- The preserved signed host and broker still hash to
  `29d32316e634f0fa27a30383e3b08d8b815a3e2a071f2a724649cf010125ee82` and
  `fc419d4ce744edd13f94444d1d4452bcc2d73c63f362f293e35af94b946d2d53`.
  The original source backup, original PDFs and completed physical evidence remain.

Evidence: `output/input-setup-simplification-20260913/RESULT.json`, final test and
build logs, `native-appearance/RESULT.json`, and
`output/playwright/input-simplification-20260913/input-devices-ui-report.json`.
Bundled browser evidence: `output/playwright/bundled-setup-ui-1789338242339/`.

Corrected local PDF:
`output/pdf/Dialed-Edge-Reconnect-Recovery-Clarified-2026-09-13.pdf`.
The prior PDF/ZIP and Drive upload remain unchanged. This corrected copy has not
been uploaded or owner-confirmed on the phone.

## Stop condition

This authorized simplification pass is complete. Preserve the source changes
and verified signed reconnect build. Any later candidate build/signing/package,
policy renewal, physical operation, emergency recovery execution or publication
requires its own explicit authorization. The completed Edge round trip must not
be repeated merely to inspect the new UI. No model setting was changed.
