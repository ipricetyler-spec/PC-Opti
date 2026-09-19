# Dialed native input stack provenance ledger

Status: Phase 0. No external implementation file has been imported.

Every future imported source, sample, generated file or specification-derived
constant must be recorded here before it enters the driver/helper boundary. A
mutable URL alone is never a source pin. Any imported entry must add an exact
revision/version, local file list, SHA-256, license copy, retained notices and a
reviewed transformation description.

## Ledger states

- `REQUIREMENT`: Dialed-owned requirement or existing project contract.
- `REFERENCE_ONLY`: consulted for independently written requirements; no file or
  expressive implementation copied.
- `CANDIDATE_IMPORT`: potentially reusable material, but no import is approved.
- `IMPORTED`: exact files were approved and recorded. There are no imported
  entries in Phase 0.
- `PROHIBITED`: outside the clean-room design input set.

## Current ledger

| ID | State | Source and version | Owner/license | Files used | Transformation and purpose |
| --- | --- | --- | --- | --- | --- |
| P-001 | REQUIREMENT | `docs/DIALED_NATIVE_INPUT_STACK_HANDOFF.md`, repository snapshot 2026-09-01 | Dialed project material | Requirements only | Governing outcome, clean-room boundary, phases, hard stops and owner gates |
| P-002 | REQUIREMENT | `src/main/input-driver-lifecycle/index.cjs` and manifest schema v2.0.0 | Dialed project material | Existing source read only | Mapped future helper operations to the existing disabled lifecycle; no driver implementation derived |
| P-003 | REFERENCE_ONLY | [Microsoft: Filter drivers](https://learn.microsoft.com/en-us/windows-hardware/drivers/kernel/filter-drivers), checked 2026-09-01 | Microsoft documentation terms | None | Defines documented filter roles and device/class scope vocabulary |
| P-004 | REFERENCE_ONLY | [Microsoft: Install a filter driver](https://learn.microsoft.com/en-us/windows-hardware/drivers/install/installing-a-filter-driver), checked 2026-09-01 | Microsoft documentation terms | None | Establishes supported device-specific filter installation model |
| P-005 | REFERENCE_ONLY | [Microsoft: INF AddFilter directive](https://learn.microsoft.com/en-us/windows-hardware/drivers/install/inf-addfilter-directive), checked 2026-09-01 | Microsoft documentation terms | None | Records declarative filter registration availability and ordering limits |
| P-006 | REFERENCE_ONLY | [Microsoft: HID driver samples](https://learn.microsoft.com/en-us/windows-hardware/drivers/samples/human-interface-devices--hid--driver-samples), checked 2026-09-01 | Microsoft documentation terms | None | Identifies official sample categories only; no sample source imported |
| P-007 | CANDIDATE_IMPORT | [microsoft/Windows-driver-samples](https://github.com/microsoft/Windows-driver-samples), mutable `main`, checked 2026-09-01 | [Microsoft Public License](https://github.com/microsoft/Windows-driver-samples/blob/main/LICENSE) | None | Candidate source pool for a later minimal pass-through scaffold; must pin a commit and exact files before use |
| P-008 | REFERENCE_ONLY | [USB-IF USB 2.0 Specification](https://www.usb.org/document-library/usb-20-specification), library package dated 2025-06-03 | USB-IF specification terms | None | Defines USB transfer, endpoint and service-interval semantics; no specification text copied into code |
| P-009 | REFERENCE_ONLY | [USB-IF HID 1.12 specification](https://www.usb.org/sites/default/files/hid1_12.pdf), checked 2026-09-01 | USB-IF specification terms | None | Defines HID class behavior and report concepts; reference only |
| P-010 | REFERENCE_ONLY | [Microsoft: USB endpoint descriptor](https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/usbspec/ns-usbspec-_usb_endpoint_descriptor), checked 2026-09-01 | Microsoft documentation terms | None | Establishes that `bInterval` reflects device firmware and is not driver-changeable, plus speed-dependent interpretation |
| P-011 | REFERENCE_ONLY | [Microsoft: supported Windows client versions](https://learn.microsoft.com/en-us/windows/release-health/supported-versions-windows-client), checked 2026-09-01 | Microsoft documentation terms | None | Provisional test-build support proposal; must refresh when a live matrix is approved |
| P-012 | REFERENCE_ONLY | [Microsoft: driver signing options](https://learn.microsoft.com/en-us/windows-hardware/drivers/dashboard/driver-signing-offerings), checked 2026-09-01 | Microsoft documentation terms | None | Separates testing/attestation and retail HLK routes; no account action authorized |
| P-013 | REFERENCE_ONLY | [Microsoft: Driver Verifier](https://learn.microsoft.com/en-us/windows-hardware/drivers/devtest/driver-verifier), checked 2026-09-01 | Microsoft documentation terms | None | Defines disposable-test-machine stability gate and crash risk |
| P-014 | REFERENCE_ONLY | [Microsoft: Signing a driver for public release](https://learn.microsoft.com/en-us/windows-hardware/drivers/develop/signing-a-driver-for-public-release), checked 2026-09-01 | Microsoft documentation terms | None | Records public-release certification/signing boundary |
| P-015 | PROHIBITED | Owner-supplied HIDUSBF folder and any copied/mirrored third-party polling-driver implementation | Unknown/not relied upon | None; not inspected | Quarantined black-box compatibility evidence only; never an implementation, metadata, identity, protocol, copy or asset source |
| P-016 | REFERENCE_ONLY | [Microsoft: WdfFdoInitSetFilter](https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/wdffdo/nf-wdffdo-wdffdoinitsetfilter), checked 2026-09-02 | Microsoft documentation terms | None | Establishes the documented KMDF filter-device declaration used by the independently written transparent source |
| P-017 | REFERENCE_ONLY | [Microsoft: Forwarding I/O requests](https://learn.microsoft.com/en-us/windows-hardware/drivers/wdf/forwarding-i-o-requests), checked 2026-09-02 | Microsoft documentation terms | None | Establishes WDF automatic forwarding when a filter does not create a queue for a request type |
| P-018 | REFERENCE_ONLY | [Microsoft: Device filter driver ordering](https://learn.microsoft.com/en-us/windows-hardware/drivers/develop/device-filter-driver-ordering), checked 2026-09-02 | Microsoft documentation terms | None | Establishes declarative lower-filter registration and the prohibition on relying on arbitrary within-level/position order |
| P-019 | REFERENCE_ONLY | [Microsoft: Keyboard and mouse HID client-driver guidance](https://learn.microsoft.com/en-us/windows-hardware/drivers/hid/keyboard-and-mouse-hid-client-drivers), checked 2026-09-02 | Microsoft documentation terms | None | Records the recommendation not to filter between HIDCLASS and a HID transport minidriver |
| P-020 | REFERENCE_ONLY | [Microsoft: Supported WDK versions](https://learn.microsoft.com/en-us/windows-hardware/drivers/other-wdk-downloads), checked 2026-09-02 | Microsoft documentation terms | None | Pins the offline source-build target to WDK/SDK 10.0.28000.2526 and records the VS 2026 requirement |
| P-021 | REFERENCE_ONLY | [Microsoft: KMDF version history](https://learn.microsoft.com/en-us/windows-hardware/drivers/wdf/kmdf-version-history), checked 2026-09-02 | Microsoft documentation terms | None | Pins KMDF 1.33 for the Windows 11 x64 prototype |
| P-022 | REFERENCE_ONLY | [Microsoft: InfVerif](https://learn.microsoft.com/en-us/windows-hardware/drivers/devtest/infverif), checked 2026-09-02 | Microsoft documentation terms | None | Defines the future isolated INF validation gate; tool is absent and was not run |
| P-023 | REFERENCE_ONLY | [Microsoft: INF Version section and extension identity](https://learn.microsoft.com/en-us/windows-hardware/drivers/install/inf-version-section), checked 2026-09-02 | Microsoft documentation terms | None | Establishes the stable extension-INF identity and device-specific targeting model |
| P-024 | REFERENCE_ONLY | [Microsoft: USBD_PIPE_INFORMATION](https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/usb/ns-usb-_usbd_pipe_information), retrieved 2026-09-03 | Microsoft documentation terms | None | Primary evidence for ADR-0002: the pipe `Interval` reflects device firmware and drivers cannot change it; the only documented pipe override is `USBD_PF_CHANGE_MAX_PACKET`; supplies the documented low/full/high-speed polling-period mapping tables used by the capability validator |
| P-025 | REFERENCE_ONLY | [Microsoft: WdfUsbInterfaceSelectSetting](https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/wdfusb/nf-wdfusb-wdfusbinterfaceselectsetting), retrieved 2026-09-03 | Microsoft documentation terms | None | Establishes that alternate-setting selection is a documented capability of the interface's own client driver and only exposes settings the device firmware already publishes |
| P-026 | REFERENCE_ONLY | [Microsoft: HID architecture](https://learn.microsoft.com/en-us/windows-hardware/drivers/hid/hid-architecture), retrieved 2026-09-03 | Microsoft documentation terms | None | Establishes that `hidclass.sys` is the WDM function driver and that a transport minidriver registers with it, so a PnP filter cannot be inserted between them |
| P-027 | REFERENCE_ONLY | [Microsoft: Using an extension INF file](https://learn.microsoft.com/en-us/windows-hardware/drivers/install/using-an-extension-inf-file), retrieved 2026-09-03 | Microsoft documentation terms | None | Establishes that an extension INF may add a filter driver but never a function driver, must be a universal INF, must not be required for basic device function, and may use only an ExtensionId the organization owns |
| P-028 | REFERENCE_ONLY | [Microsoft: Device identification strings](https://learn.microsoft.com/en-us/windows-hardware/drivers/install/device-identification-strings), retrieved 2026-09-03 | Microsoft documentation terms | None | Establishes hardware/compatible IDs, instance and device instance IDs and container IDs, and that identification strings are opaque and must not be parsed; used by the target-binding contract |
| P-029 | REFERENCE_ONLY | [USB-IF USB 3.2 Specification](https://www.usb.org/document-library/usb-32-revision-11-june-2022), retrieved 2026-09-03 | USB-IF specification terms | None | SuperSpeed interrupt endpoint service-interval semantics (period = 2^(bInterval-1) x 125 microsecond service intervals); no specification text copied into code |

## Re-verification record

| ID | Re-retrieved | Reason and result |
| --- | --- | --- |
| P-005 | 2026-09-03 | Confirmed `AddFilter` is supported in Windows 10 version 1903 and later, that a filter-install section defines either `FilterLevel` or `FilterPosition` but not both, and that without base-package filter-level metadata a filter is inserted "in effectively arbitrary order" |
| P-010 | 2026-09-03 | Confirmed the exact `bInterval` wording ("This value reflects the device's configuration in firmware. Drivers cannot change it.") and the documented low/full/high-speed polling-period tables |
| P-019 | 2026-09-03 | Confirmed the two recommended keyboard/mouse filter placements (upper filter to kbdhid/mouhid, upper filter to kbdclass/mouclass), the statement that filters "aren't recommended as a filter between HIDCLASS and HID transport minidrivers", and the recommendation to use vendor-specific top-level collections instead of filters |

## Import record template

Before changing a candidate to `IMPORTED`, add:

- immutable upstream repository and commit/tag;
- exact upstream path and SHA-256 for every file;
- license identifier, license-file hash and required notices;
- local destination paths;
- portions used and a plain-language transformation;
- reviewer and review date;
- generated-output tool/version and reproducible command when applicable; and
- explicit confirmation that P-015 or another prohibited source was not in scope.

An IP/licensing review of the completed ledger and implementation remains required
before an external beta or sale.
