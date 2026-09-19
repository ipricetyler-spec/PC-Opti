# Proposed supported scope and Phase 1 feasibility environment

Status: proposal only. No live driver test, signing action, account action,
restart or hardware mutation is approved by this document.

## Provisional product scope

Phase 1 is intended to answer one question: can a documented Windows filter
architecture produce a repeatable selected-device USB bus schedule without
patching a Microsoft driver or weakening Windows security?

The initial feasibility target is deliberately narrow:

- Windows 11 x64 only;
- one device-specific filter attachment, never a class-wide filter;
- USB HID interrupt-IN devices with an unambiguous physical/composite scope;
- Full-Speed, High-Speed and SuperSpeed attachment only. Low-speed devices are
  excluded: Microsoft documents their polling period as 8, 16 or 32 one-millisecond
  frames, so they cannot reach any offered rate above 125 Hz and the capability
  schema refuses to record them;
- Full-Speed requests up to 1,000 Hz and High-Speed requests at 1/2/4/8 kHz only
  when the exact endpoint and compatibility-class record permit them;
- Secure Boot, Memory Integrity, Defender, UAC and driver-signature enforcement
  enabled and unchanged; and
- a disposable bare-metal test computer with independent selected-endpoint USB
  capture. A virtual machine is not sufficient for final bus-cadence evidence.

Microsoft's current support table lists Windows 11 24H2 (build 26100), 25H2
(26200) and 26H1 (28000) as supported channels as of this Phase 0 review.
Because Home/Pro 24H2 reaches end of updates on 2026-10-13, it is transitional,
not a sensible sole commercial baseline. The proposed initial lab matrix is one
current 25H2 x64 image and one current 26H1 x64 image, fully patched at test time.
The exact commercial minimum/maximum build remains an owner decision after
feasibility. Windows 10, LTSC-only variants, ARM64, Server and unsupported builds
are excluded from the initial program.

Authoritative support reference:
[Microsoft supported Windows client versions](https://learn.microsoft.com/en-us/windows/release-health/supported-versions-windows-client).

## Documented-interface candidates

1. Start with the independently written transparent KMDF device-specific lower
   filter frozen in `phase1/ARCHITECTURE_DECISION.md`.
2. Register the exact approved USB HID interface target declaratively with an
   extension INF and `AddFilter` `FilterPosition = Lower`. Do not edit an
   arbitrary class filter list or depend on relative ordering within the lower
   filter position.
3. Prove pass-through, attach, detach, PnP/power and recovery before adding any
   scheduling experiment.
4. Evaluate only documented WDF/USB requests. Microsoft documents `bInterval` as
   device firmware configuration that a driver cannot change; a design that
   depends on falsifying or patching that descriptor is not a valid route.
5. If no supported layer can produce the requested selected-device schedule, mark
   that rate/compatibility class `BLOCKED`. Do not add a kernel patcher.

**Result of step 4/5, 2026-09-03:** no documented general Windows/WDK host-side
interval override was found. See
[ADR-0002](phase1/ADR-0002-DOCUMENTED-SCHEDULING-INTERFACE.md). Steps 1-3 can
establish lifecycle mechanics only. A firmware-published alternate setting or
published vendor protocol remains a separate per-device investigation, not a
reason to expand the kernel prototype.

Primary references:

- [Install a filter driver](https://learn.microsoft.com/en-us/windows-hardware/drivers/install/installing-a-filter-driver)
- [INF AddFilter directive](https://learn.microsoft.com/en-us/windows-hardware/drivers/install/inf-addfilter-directive)
- [Filter drivers](https://learn.microsoft.com/en-us/windows-hardware/drivers/kernel/filter-drivers)
- [USB endpoint descriptor and bInterval](https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/usbspec/ns-usbspec-_usb_endpoint_descriptor)
- [Official Microsoft Windows driver samples](https://github.com/microsoft/Windows-driver-samples)

## Frozen offline placement and request contract

The first prototype targets the exact USB HID **interface devnode** that owns the
selected interrupt-IN endpoint. The future helper must bind its interface-specific
hardware ID to the selected physical-device/topology digest and must reject a
broad, class-wide or collateral match. The extension-INF template uses a stable
Dialed ExtensionId and an unresolved exact hardware-ID token.

It is a lower device filter below the interface function driver. The base package
is not assumed to publish a named lower-filter level, so order within the lower
position is treated as arbitrary. The transparent prototype has no ordering
dependency, no request queue and no USB request ownership; WDF automatically
forwards every request type. It therefore validates only lifecycle mechanics.

Microsoft discourages filtering between HIDCLASS and HID transport minidrivers.
Dialed does not use that placement and does not replace a HID transport or class
driver; because `hidclass.sys` is the function driver and the transport minidriver
registers with it, a PnP filter cannot be inserted between them at all. The same
Microsoft guidance nevertheless recommends only two keyboard/mouse filter
placements - upper to kbdhid/mouhid and upper to kbdclass/mouclass - and a lower
filter on the USB HID interface devnode is outside that recommended set. It must
therefore stay transparent and must never be justified by a scheduling benefit it
cannot deliver. Any later request interception or scheduling work needs a separate
accepted ADR identifying a documented request surface and cancellation,
completion, concurrency and fault tests. Until then scheduling is
`BLOCKED_PENDING_DOCUMENTED_INTERFACE`.

The pinned source-build target is Visual Studio 2026 Build Tools 18.3.0, MSVC
14.50, Windows SDK/WDK 10.0.28000.2526, KMDF 1.33 and x64. The current host has
none of the required WDK/MSVC/InfVerif tools, so the source has not been compiled
or package-validated.

## Offline and fixture stage

Before a live test, the prototype must pass on synthetic adapters only:

1. Build warning-free for x64 with exact Visual Studio, SDK, WDK and KMDF versions
   pinned in the provenance ledger.
2. Static analysis and applicable CodeQL/driver package/INF validation pass, and
   the exact extension ID has recorded Dialed ownership evidence.
3. Pass-through and malformed-request tests demonstrate bounded input parsing,
   cancellation, exactly-once completion and no scheduling change by default.
4. Fixture inventory covers present, disconnected, non-present, phantom,
   composite, shared-controller and ambiguous-scope cases.
5. Existing lifecycle fixture tests cover preview/apply/reconcile, single-use
   authorization, checkpoint chaining, exact deltas and durable recovery.
6. The disposable-environment image, device, package digest, intended
   attach/detach/restart sequence and recovery method are written down for owner
   review.
7. An exact selected-devnode stack graph is captured and independently reviewed;
   attachment is blocked if the target would place the filter between HIDCLASS
   and its HID transport minidriver.

## Live feasibility sequence after approval

1. Capture the clean machine image/build, security state and full USB inventory.
2. Verify the exact test package/signature and recovery media before installation.
3. Reconfirm the approved stack graph, then install and attach the transparent
   filter only to the approved test device.
4. Exercise read/write pass-through, disconnect/reconnect, sleep/resume, fast
   startup and the approved restart sequence; detach and remove exactly.
5. With the same safeguards, test one request at a time and capture the selected
   endpoint with the approved hardware analyzer or independently validated trace.
6. Repeat enough runs to establish cadence distribution and failure rate, not a
   single best sample.
7. Restore the exact preimage, confirm no unrelated device/package/filter drift
   and archive hashes, logs and analyzer evidence.
8. Record `SUPPORTED`, `UNSUPPORTED` or `BLOCKED` per exact compatibility class.

Driver Verifier is allowed only on the disposable test machine; Microsoft warns
that it can crash a computer. No game or anti-cheat execution belongs in this
first feasibility run.

## Signature constraint

A live kernel test that disables Secure Boot, Memory Integrity or signature
enforcement cannot pass this program. If the prototype cannot load under an
owner-approved Microsoft-compatible test/preproduction signing route while those
protections remain enabled, live feasibility is `BLOCKED` pending that separate
account/signing authorization. Do not enable test-signing mode or create a local
trust bypass as a substitute.

Current signing references:

- [Driver signing options](https://learn.microsoft.com/en-us/windows-hardware/drivers/dashboard/driver-signing-offerings)
- [Signing a driver for public release](https://learn.microsoft.com/en-us/windows-hardware/drivers/develop/signing-a-driver-for-public-release)
- [Driver Verifier](https://learn.microsoft.com/en-us/windows-hardware/drivers/devtest/driver-verifier)

## Exact owner approval boundary

Before any live Phase 1 action, the owner must explicitly approve one bounded packet
that identifies:

- disposable machine and recovery/reimage method;
- exact Windows edition, build, patches, x64 architecture and WDK toolchain;
- exact prototype source revision and INF/SYS/CAT/helper hashes;
- exact signing/submission route and any account/credential action;
- exact physical test device(s), controller path and analyzer/trace method;
- allowed install, attach, reconnect, restart, detach and removal operations;
- security-state evidence showing every required protection remains enabled; and
- stop/recovery criteria.

That approval does not authorize owner-PC mutation, publication, production
signing, anti-cheat/game testing, a commercial compatibility promise or release.
