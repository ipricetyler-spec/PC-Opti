# Dialed Input Devices

## Current flow — 2026-09-13

Select the USB input device, open **Change rate** for signed native setup, finish
its explicit reconnect/recovery instructions, then run the separate **8-second
input check**. The latest source detects standard control changes, counts Windows
messages/received HID reports separately and narrows legacy tools to own-record
restore. It is not yet in the preserved signed input-review app. See
[current implementation and remaining work](CLAUDE_FINDINGS_IMPLEMENTATION_2026-09-13.md).
The sections on evidence and recovery below describe this source revision.

## Historical existing-driver flow — 2026-09-05

Install HIDUSBF independently from its official upstream project, then use Dialed to
select the exact USB device, inspect configuration, and explicitly test Windows delivery.
The page starts on polling checks. Existing-driver adjustment tools require an explicit
advanced toggle; saved recovery remains accessible. The application does not install
HIDUSBF or suggest disabling protections. Support is device/driver/Windows specific.
General DualSense support must not inherit DualSense Edge acceptance automatically.

Status: source/fixture acceptance and the existing-driver owner-host 8 kHz path
passed on 2026-08-30. The accepted DualSense Edge path reconciled the 4–8 kHz
tier and produced 7,993/7,996/7,996 Windows-delivered events/s. Independent USB
transaction, fresh-report, and latency proof remains a separate engineering gate.
The current follow-up changed source and fixtures only; it preserved the live state.

## Historical existing-driver capabilities

Input Devices combines two tasks without pretending they measure the same thing:

- **USB connection:** identifies connected Windows Raw Input peripherals, traces
  each physical USB instance through additional hubs to its controller, labels a
  physical connection, and compares the topology after the user moves a device.
- **Polling rate:** reads an existing HIDUSBF `bInterval`, previews a supported
  speed-specific change, stores the exact prior value before writing, verifies
  readback, and offers guarded restore/reconciliation. Full-Speed choices are
  125/250/500/1000 Hz. Confirmed High-Speed choices are 1000/2000/4000/8000 Hz,
  capped by the post-restart presumed xHCI patch tier. For an existing exact reviewed
  patching driver, a separate guarded workflow can save and configure the shared
  4–8 kHz tier, require a Windows restart, and reconcile the expected driver and
  device scope after that restart. Its eight-second Raw Input check compares
  Windows message arrivals with the configured request, per channel. It never
  reads key/button/movement values and cannot detect deliberate physical activity.
  Devices may keep sending messages while untouched; a matching message rate
  must not be presented as an activity or polling-validation pass.

Port/controller attachment is inferred from Windows topology and reviewed PCI IDs.
It is not a motherboard socket map or latency measurement. Event delivery is not
USB bus polling or end-to-end input latency.

## Historical legacy polling-change candidate

Dialed enables the Apply/Restore control only when all conditions are true:

- Windows reports a present, healthy physical USB Raw Input device.
- The route is complete and has a stable Windows location.
- USB speed is confirmed **Full-Speed** or **High-Speed**.
- HIDUSBF is already attached as a lower filter.
- Exactly one existing `bInterval` DWORD is present in the SetupAPI hardware,
  device-parameters, or driver/software key and maps unambiguously for that speed.
- The running service path/type is exact and its driver is Microsoft-valid.
- Its SHA-256 exactly matches one of the four reviewed upstream builds below.
- High-Speed choices do not exceed the post-restart presumed `PatchUSBXHCI` tier.
  An invalid or conflicting override fails closed; if no override exists, the
  exact driver variant supplies the default tier.
- Dialed was deliberately opened as administrator for Apply/Restore.

Reviewed hashes:

| Upstream build | SHA-256 |
| --- | --- |
| NoPatch x64 | `2f82cdeb36bdaa42ea1933a9b11f3b8e1bdb28e6d3e3da7e65b4631b3375412d` |
| 1 kHz patch tier x64 | `81f649b34978fe9f74ce5c7c04ba24d5238faec6c70018f14da9423a46e6e04d` |
| 2–4 kHz patch tier x64 | `e2c9fc626bb92d2219fbef3458014c198a3c90c563f948c9a433826e64d77e90` |
| 4–8 kHz patch tier x64 | `db73a8c259e16a0d02f138650497c1bdec81add66d928f3cf3ff39fad4eb421b` |

For Full-Speed, `bInterval` 1/2/4/8 maps to 1000/500/250/125 Hz. For
High-Speed interrupt endpoints, `bInterval` 1/2/3/4 maps to
8000/4000/2000/1000 Hz. The 1 kHz, 2–4 kHz and 4–8 kHz tier ceilings remain
separate from that configured interval. A displayed 8,000 Hz request under a
presumed 1 kHz tier is a mismatch, not an 8 kHz success.

## Historical legacy global 8 kHz tier

The shared xHCI tier affects every High-Speed device currently using the HIDUSBF
filter; it is not a controller-only switch. Dialed therefore enables the workflow
only when all of these conditions are freshly observed:

- the existing running driver is Microsoft-valid and matches an exact reviewed
  patching build;
- Memory Integrity is explicitly reported disabled; Dialed never changes or asks
  Windows to weaken that protection;
- no legacy `PatchUSBXHCI` value or conflicting global value exists;
- the Windows boot-session identity still matches the preview;
- the selected target remains a present High-Speed input device; and
- every HIDUSBF lower-filter attachment maps unambiguously to one physical USB
  device; child/interface filter attachments remain visible and block unless the
  physical scope is safe; and
- every other filtered physical USB device, including non-input devices, is
  either unaffected, already configured at 1 kHz, or first placed at 1 kHz by a
  separately previewed and recoverable isolation change. Unknown impact blocks
  the tier change.

Enable writes only `PatchUSBXHCI=3` under the exact existing-driver Parameters
key. Before that write, Dialed durably saves the prior DWORD value and kind—or
the fact that the value was absent—plus the complete mapped and unresolved
filtered-device scope, then verifies readback. Configured and presumed-loaded
tier remain separate: a Windows restart is required, Dialed never initiates it,
and higher rate choices remain unavailable until explicit post-restart
reconciliation confirms a new boot, the same exact driver, the same exact filter
scope and the selected input target. Any added, removed, remapped or unresolved
attachment becomes `SCOPE_DRIFT`; the higher tier is not presumed active, and
exact restore remains available. Restore uses the same exact-state checks and restores the saved value or
deletes only the value that was previously absent. Recovery remains available if
Memory Integrity is later enabled or the service stops, provided the exact known
driver and saved Registry state still match.

## Historical legacy path limits (not the current bundled native setup)

- Install, replace, update, restart or remove HIDUSBF or another driver.
- Add/remove a device filter or create a missing `bInterval`.
- Disable Memory Integrity, Secure Boot, Smart App Control or another protection.
- Restart a device, reboot Windows or silently apply a requested rate.
- Read or retain keyboard keys, button/movement values, device serials or raw
  report contents.
- Claim that a configured rate proves fresh hardware reports, achieved USB
  delivery, or a performance or latency improvement.

Initial driver/filter setup remains an explicit compatibility and recovery project.
The guarded tier workflow operates only on the already-installed exact driver; the
current UI links to the original project instead of simulating a one-click install.

Dialed now contains a fail-closed lifecycle framework and immutable manifest schema,
but no driver payload or mutation method. Integrated setup stays unavailable until
the clean-room documented-interface feasibility gate, complete provenance/IP
review, a pinned Dialed-owned signed package/helper/app set, Authenticode/catalog
preflight, Hardware Dev Center certification route and clean-machine install/
upgrade/restore/removal acceptance all pass. See
[DIALED_NATIVE_INPUT_STACK_HANDOFF.md](DIALED_NATIVE_INPUT_STACK_HANDOFF.md) and
[INPUT_DRIVER_LIFECYCLE.md](INPUT_DRIVER_LIFECYCLE.md).

## Evidence ladder and why USB ETW is deferred

Current source separates the configured request, presumed driver tier, Windows
message delivery, received HID report counts and observed control changes. USB
transactions and physical latency are not measured. This source update is not in
the preserved signed input-review app.

The eight-second foreground collector checks exact selected HID identities before
reading payloads. It counts every report in a bounded RAWHID batch. Standard mouse,
keyboard and controller controls feed a noise-filtered activity check, separate
from cadence. Initial controller states, repeated reports and small jitter do not
establish activity; missing or unsupported data cannot establish idle. Timings and
aggregate counts are transient. No raw reports or key identities are saved.

Keyboard channels never compare typing with polling rate. Mouse comparisons need
motion-bound intervals at most 20 ms apart, independently of the request, totaling at
least 500 ms. Controller comparisons require at least 30 messages over 1.5 seconds,
use received reports/s when available and retain neutral styling. Each channel
has its own assessment; keyboard channels cannot lower a mixed-device verdict.
A matching rate cannot establish distinct hardware samples or lower latency.
Thresholds and observer overhead still need physical validation. See
[activity design and evidence](INPUT_CONTROL_ACTIVITY_2026-09-13.md).

A USB ETW button would
be misleading without a validated provider/event decoder that can bind controller,
endpoint and completion records to the selected physical device across supported
Windows builds. Dialed therefore does not ship a technical-looking ETW result or
claim 8 kHz delivery from Raw Input spacing. A future ETW helper must first pass
fixture decoding, cross-build provider validation, selected-device correlation,
bounded lifecycle/overhead tests and comparison against an independent USB trace.

## Recovery model

Current source reserves production legacy mutation endpoints for exact recovery
of their own recorded entries. New APPLY/ENABLE/ISOLATE writes are refused even
when native setup is unavailable or its policy expires. The signed native path
is the authority for new rate changes. The app prevents its own setup and legacy
recovery from running simultaneously. September 14 source also refuses legacy
restore when the native history directory exists, is linked, or cannot be checked;
this includes initialized or incomplete native history after helper exit. The
native adapter repeats the check before its restore write. No journal is parsed,
deleted or rewritten. Migration through native recovery remains unimplemented;
no live legacy recovery was validated. The historical write mechanics below
remain relevant to own-record restore and isolated regression fixtures only.

Apply uses a two-minute, single-use preview. Immediately before writing it re-reads
the device, route, driver and local history. A PENDING record containing the exact
prior value is fsynced before the single DWORD write. Dialed then reads the device
again before reporting CONFIGURED.

Restore is a new guarded change; it never deletes the shared service or guesses a
default. If an operation is interrupted, **Recheck saved change** compares the live
value with both saved states:

- prior value → `NOT_APPLIED`
- requested value → `CONFIGURED` or `RESTORED`
- any third value or changed identity/driver/route → refuse automatic reconciliation

History is local, bounded to 100 records and one MiB, and written atomically.
Tier history separately records the boot identity, exact global before/after state,
persisted affected-device audit and `REBOOT_REQUIRED`/`PRESUMED_ACTIVE`/
`SCOPE_DRIFT`/recovery state.

## Historical owner acceptance procedure (not authorization to repeat)

Use a mouse/controller for the first mutation test and keep another working input
method available. Complete these steps only after the final unsigned/signed build
can run under Windows policy:

1. Scan as a standard user. Confirm only real input devices appear and names match.
2. Optionally save a port label, move one device, rescan, and confirm the connection
   comparison. Port naming is not required for polling setup.
3. Run the selected mouse test while moving only that mouse, then select the
   keyboard and type during its test. Confirm both results say app-observed event
   cadence, not measured USB polling or latency, and confirm no listener remains
   after completion.
4. Inspect the DualSense Edge without applying a change. On the current host it
   should initially show an 8,000 Hz configured request separately from the
   presumed 1 kHz driver tier and must not call that 8 kHz achieved delivery. The
   selector must retain the current 8,000 Hz value; it must not silently default
   to 1,000 Hz or enable a no-op/downshift review.
5. Relaunch Dialed as administrator and review the shared-tier audit. For every
   other filtered High-Speed device above 1 kHz, review and apply its separate
   recoverable 1 kHz isolation first. Stop on any unknown-impact device.
6. Review the global tier change. Confirm it names every affected filtered device,
   saves the exact prior value or absence, writes only the fixed tier DWORD, and
   says restart required without restarting Windows.
7. Restart Windows manually. Reopen Dialed, run **Check after restart**, and
   confirm the configured tier is not shown as presumed active until the new boot,
   exact driver and exact saved filter scope match. Stop on `SCOPE_DRIFT`.
8. If the DualSense already shows the current 8,000 Hz request, do not rewrite it.
   Otherwise review/apply 8,000 Hz, reconnect that controller manually, and confirm
   input remains usable. Run the eight-second delivery check while continuously
   using only that controller. Record whether Windows delivery is consistent,
   below-request or inconclusive; none of those outcomes is USB-transaction or
   latency proof. One result within 5% of the request is enough for normal setup;
   repeated runs and raw timing distributions are optional troubleshooting evidence.
9. Exercise exact restore only when deliberately testing recovery or undoing the
   setup. Do not restore as a routine acceptance step when the accepted live state
   is meant to remain active.
10. Exercise an interrupted-operation fixture/build only—not a forced live crash—
   and verify reconciliation does not overwrite an unrelated external change.

Stop if the device identity, filter, driver hash, route or saved value changes.
Never remove the shared HIDUSBF service as a routine per-device rollback.

## Existing-installation compatibility provenance

- Original project: <https://github.com/LordOfMice/hidusbf>
- Original archive: <https://raw.githubusercontent.com/LordOfMice/hidusbf/master/hidusbf.zip>
- Reviewed upstream commit: `994259a8de31b35d2d44dc800368d9418dd3eb04`.
- Current permission, package and testing boundaries are recorded in
  [HIDUSBF_INTEGRATION.md](HIDUSBF_INTEGRATION.md).

Current bundled native setup uses exact, unmodified upstream files under a bounded
validation policy. That is separate from the historical unbundled legacy path
above. Commercial/automation rights, broader physical-machine acceptance and
public-release gates remain open; consult PROJECT_HANDOFF.md for the actual build.
