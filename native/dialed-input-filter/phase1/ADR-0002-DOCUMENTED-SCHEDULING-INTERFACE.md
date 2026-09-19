# ADR-0002: No documented general Windows host-side interval override

**Status:** Accepted for the offline Phase 1 record only. It changes no product
behavior, enables no capability and authorizes no live action.

**Date:** 2026-09-03
**Deciders:** the owner and the Dialed native-input program
**Amends:** [ADR-0001](ARCHITECTURE_DECISION.md), whose placement rationale is
narrowed by the two findings under "Consequence for the architecture" below.
ADR-0001 is not withdrawn: the transparent prototype it describes remains the only
approved offline source.

**Supersedes:** nothing. It supplies the missing evidence behind the
`BLOCKED_PENDING_DOCUMENTED_INTERFACE` state already asserted by
[ADR-0001](ARCHITECTURE_DECISION.md) and `prototype-contract.json`.

## Question

`docs/CLAUDE_CODE_FIRST_PARTY_INPUT_DRIVER_BRIEF.md` asks whether a documented,
supportable Windows/WDK mechanism exists that can request the intended
Full-Speed and High-Speed interrupt schedules for a selected device without
patching a Microsoft driver, using undocumented offsets, or reducing Windows
protection.

## Verdict

**No general host-side override exists in the reviewed Windows/WDK surface.** As
of the sources retrieved on 2026-09-03, current official Microsoft driver
documentation states directly that the descriptor/pipe polling interval is
firmware-owned and that drivers cannot change it. No documented WDF, USBD, HID or
INF surface exposes an interval override independent of device firmware.

This does not rule out a firmware-published alternate setting or a device-vendor
configuration protocol. Those are per-device capabilities, not a general Windows
rate mechanism, and remain unavailable until exact published vendor documentation
and compatibility evidence exist.

The affected scheduling tiers therefore remain
`BLOCKED_PENDING_DOCUMENTED_INTERFACE`. Every 1/2/4/8 kHz and Full-Speed
125-1000 Hz consumer claim stays blocked. No IOCTL, Registry convention, patch
path or success fixture was invented to work around this.

### Primary evidence

`USB_ENDPOINT_DESCRIPTOR.bInterval`
([Microsoft, retrieved 2026-09-03](https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/usbspec/ns-usbspec-_usb_endpoint_descriptor)):

> The **bInterval** value contains the polling interval for interrupt and
> isochronous endpoints. [...] This value reflects the device's configuration in
> firmware. Drivers cannot change it.

`USBD_PIPE_INFORMATION.Interval`
([Microsoft, retrieved 2026-09-03](https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/usb/ns-usb-_usbd_pipe_information)):

> Contains the polling interval, indicated by the **bInterval** field in the
> corresponding endpoint descriptor [...] It reflects the device's configuration
> in firmware. Drivers cannot change it.

The same page documents the only pipe-level override a client driver may request
when it selects a configuration: `USBD_PF_CHANGE_MAX_PACKET`, which overrides the
maximum packet size. There is no documented counterpart for the interval. A
targeted search of `learn.microsoft.com` for a documented override returned only
these two pages and the same statement.

### Secondary evidence

- Selecting a different alternate interface setting is documented
  ([`WdfUsbInterfaceSelectSetting`](https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/wdfusb/nf-wdfusb-wdfusbinterfaceselectsetting),
  retrieved 2026-09-03) and would change the pipe set, but only to settings the
  device firmware already publishes, and only for the driver that owns the USB
  interface. For a USB HID device that owner is the HID transport minidriver, not
  a lower filter. This is a device-supplied capability, never a host-side
  schedule control.
- Microsoft's keyboard/mouse HID driver guidance
  ([retrieved 2026-09-03](https://learn.microsoft.com/en-us/windows-hardware/drivers/hid/keyboard-and-mouse-hid-client-drivers))
  points vendors at vendor-specific top-level collections for proprietary
  device configuration, not at filters: "Vendors should create separate, vendor
  specific, TLCs to exchange proprietary data between their HID client and the
  device. Avoid using filter drivers unless critical."

### What this rules out and what it leaves

| Candidate mechanism | Documented? | Verdict |
| --- | --- | --- |
| Change `bInterval` from a filter or client driver | Explicitly documented as impossible | `BLOCKED` |
| Pipe-level interval override at select-configuration | Not documented (only `USBD_PF_CHANGE_MAX_PACKET` exists) | `BLOCKED` |
| Re-select an alternate interface setting that firmware publishes with a smaller `bInterval` | API documented; ownership belongs to the interface's function driver; no HID device is known here to publish such a setting | `UNRESOLVED`, device-specific, not a general route |
| Vendor-published device configuration (HID feature report or vendor control transfer) | Documented as the recommended vendor pattern; the per-device protocol is the vendor's, not Microsoft's | `UNRESOLVED`, requires published vendor documentation per device |
| Patch `USBXHCI.SYS`/`USBPORT.SYS`, undocumented offsets, or reduced protection | N/A | Prohibited by program policy; never evaluated |

`scheduleMechanism = DOCUMENTED_WDF` is, on today's evidence, an **unreachable**
value in the device-capability schema. It is retained only so that a future
documented interface can be recorded without a schema migration; it must not be
selected until an official Microsoft source describes such an interface.

## Consequence for the architecture (challenge to ADR-0001)

ADR-0001 chose a transparent device-specific KMDF **lower** filter on the USB HID
interface devnode. That placement is defensible for lifecycle mechanics, but this
review raises two findings the program should record honestly:

1. **The kernel filter is not on the critical path of any presently documented
   general rate mechanism.** Because no host-side interval override exists, the
   filter cannot become the mechanism later merely by growing a request handler.
   If a documented route appears for a supported device, it is most likely a
   *device-vendor* route, and the documented Windows way to reach it is a
   user-mode HID call to a vendor-specific top-level collection - which needs no
   kernel driver, no driver signing and no security change at all.
2. **The chosen placement is not one of the two placements Microsoft explicitly
   recommends for keyboard and mouse filters.** The same guidance page lists the
   allowed scenarios as "an upper filter to kbdhid/mouhid" and "an upper filter to
   kbdclass/mouclass", and says filters "aren't recommended as a filter between
   HIDCLASS and HID transport minidrivers". A lower filter on the USB HID
   interface devnode is not the discouraged placement - `HIDCLASS.sys` is the
   function driver and the transport minidriver registers with it, so a PnP
   filter cannot be inserted between them - but it is also outside the
   recommended set, and it inherits the USB-side request traffic of the transport
   minidriver.

Neither finding is a reason to build a different driver right now. Both are
reasons **not to expand** the kernel driver while the mechanism is blocked. The
recommended next engineering step is documentary and per-device, not kernel:
identify whether any target device's vendor publishes a supported configuration
protocol, and record it as `DOCUMENTED_DEVICE_VENDOR` with its exact source.
Implementing such a route would touch the product boundary and is therefore
proposed to the owner and the primary Dialed task, not implemented here.

## Answers to the brief's six first-pass questions

1. **Is the KMDF PnP lower-filter placement correct for the exact device scope,
   and can it stay outside the HIDCLASS-to-transport boundary?** Partly. The
   placement cannot create the discouraged HIDCLASS-to-transport placement,
   because those two components share one function-driver layer on the interface
   devnode. It is a documented PnP position, delivered by a documented extension
   INF using `AddFilter`/`FilterPosition = Lower` (Windows 10 1903 and later).
   It is nevertheless outside Microsoft's two recommended keyboard/mouse filter
   placements, so it must stay transparent and must not be justified by a
   scheduling benefit it cannot provide.
2. **Does a documented general Windows mechanism exist for the intended
   schedules?** No. A firmware-published alternate setting or published vendor
   protocol remains a separate per-device question. See the verdict above.
3. **At which boundary could it be applied?** Not applicable while (2) is
   negative. No request/PnP/power boundary is proposed, and the prototype
   continues to own no queue and no request type.
4. **What identity and scope must the helper bind first?** The exact selected
   physical device digest, container identity, opaque device instance identity,
   the interface number and the interrupt-IN endpoint keys that the compatibility
   class names, plus a **complete** present, non-present and phantom inventory in
   which exactly one entry is the selected target. Hardware-ID matching must be
   device-specific; class-wide or compatible-ID matching is refused. This is now
   machine-enforced by `schemas/target-binding.schema.json` and
   `target-binding-validator.cjs`.
5. **Which lifecycle states need explicit contracts and fixtures?** Preview,
   observe, install, attach, detach, repair, upgrade, remove, plus reconnect,
   surprise removal, D0/D3 power transitions, restart/fast-startup boot-session
   change and durable review. The ordering rules, one-allowed-delta rule, sealed
   preimage chain and stale-preimage refusal are now fixture-tested.
6. **What cannot be established without hardware?** Everything at and below the
   bus: that the filter loads, attaches only to the approved scope, survives
   Driver Verifier and PnP/power cycling, detaches exactly, and any statement
   about achieved cadence or latency. Those remain `NOT RUN` in
   [ACCEPTANCE_MATRIX.md](../ACCEPTANCE_MATRIX.md).

## Action items

1. Keep `scheduling.status = BLOCKED_PENDING_DOCUMENTED_INTERFACE` and keep every
   rate tier unclaimable.
2. Do not add a request handler, USB pipe handle, URB parser or IOCTL to the
   prototype. Any such change requires a new accepted ADR citing a documented
   interface.
3. Re-check the two primary Microsoft pages when the pinned WDK version changes;
   record the retrieval date in the provenance ledger either way.
4. Treat a vendor-documented device route as a separate, user-mode, per-device
   proposal for the product boundary, not as a driver feature.
