# ADR-0001: Transparent device-specific lower filter first

**Status:** Accepted for the offline Phase 1 prototype only, amended 2026-09-03 by
[ADR-0002](ADR-0002-DOCUMENTED-SCHEDULING-INTERFACE.md)

**Amendments:** ADR-0002 established that no documented general Windows/WDK
host-side interface overrides an interrupt interval independently of device
firmware, so (a) this placement cannot become a general rate mechanism by merely
adding a request handler, and (b) although it cannot create the discouraged
HIDCLASS-to-transport placement, it is outside the two filter placements Microsoft
recommends for keyboards and mice. Read both records before acting on the placement
rationale below.

**Date:** 2026-09-02
**Deciders:** the owner and the Dialed native-input program

## Context

Dialed needs to determine whether a documented Windows driver architecture can
produce an exact selected-device USB schedule without patching Microsoft drivers
or weakening Windows security. The first prototype must also prove that the
package can attach, pass traffic, survive PnP and power transitions, detach and
recover without changing the accepted product or enabling production mutation.

Microsoft documents device-specific upper and lower PnP filters, declarative
`AddFilter` registration and WDF automatic forwarding. It also documents that
filter order is arbitrary when a base package does not define filter levels, and
discourages placing a filter between HIDCLASS and a HID transport minidriver.

## Decision

The offline prototype is an independently written KMDF **lower device filter**
for one exact USB HID interface devnode:

- the future package is an extension INF targeted to one owner-approved,
  interface-specific hardware ID;
- the INF uses `AddFilter` with `FilterPosition = Lower`, never class-wide
  `UpperFilters` or `LowerFilters` Registry edits;
- the helper must bind that hardware ID to the selected physical-device,
  interface, endpoint and topology digest before attachment;
- the prototype has no request queue, user-mode interface, custom IOCTL, USB pipe
  handle, URB parser, descriptor mutation or scheduling state;
- WDF owns transparent forwarding for every request type;
- the prototype does not depend on its order relative to another lower filter;
  any future design that requires an exact filter level is blocked unless the
  base package publishes that level; and
- USB scheduling remains `BLOCKED_PENDING_DOCUMENTED_INTERFACE`. A separate ADR,
  provenance update and offline test expansion are required before any request
  interception or scheduling experiment is added.

This placement is a lifecycle and transparency harness, not evidence that the
filter can change interrupt cadence.

## Options considered

### Device-specific lower filter with framework auto-forwarding

| Dimension | Assessment |
| --- | --- |
| Scope | One exact USB HID interface compatibility target |
| Complexity | Low for the transparent baseline |
| Scheduling access | Unproved; explicitly blocked |
| Filter ordering | No ordering dependency permitted |
| Recovery | Declarative detach plus existing exact lifecycle contract |

**Pros:** documented PnP model, no class-wide attachment, no HID transport
replacement, and the smallest kernel surface for lifecycle proof.

**Cons:** does not itself establish a documented cadence-control mechanism and
cannot rely on relative lower-filter order.

### Upper HID client filter

Rejected for the feasibility baseline. An upper client filter is useful for
class/client behavior but is not a documented owner of USB host scheduling, and
the relevant client stack varies across keyboards, mice and game controllers.

### Filter between HIDCLASS and a HID transport minidriver

Rejected. Microsoft does not recommend this placement, and it would couple the
product to a fragile transport boundary without establishing a supported cadence
control contract.

### Primitive driver, class filter or Microsoft-driver patcher

Rejected. A primitive driver is not tied to the selected PnP devnode, a class
filter broadens scope, and patching Microsoft USB drivers or undocumented state
violates the program's security and support boundaries.

## Consequences

- The transparent source can be reviewed and statically tested without a WDK or
  live device.
- Build, INF validation, signing, installation and live PnP evidence remain
  blocked until the exact owner packet is approved.
- A successful transparent prototype proves lifecycle mechanics only.
- If no separately reviewed documented scheduling interface is found, 4-8 kHz
  support remains blocked rather than being simulated or marketed.

## Action items

1. Validate this source with the pinned WDK and `InfVerif /w` plus `/h` on an
   isolated build machine.
2. Substitute one exact owner-approved hardware ID only in a generated build
   directory; never commit a broadly matching production INF.
3. Record evidence that Dialed owns the exact extension ID before generating a
   package, and capture the exact selected-devnode stack before attachment;
   block if it would create the discouraged HIDCLASS-to-transport placement.
4. Complete static analysis and synthetic lifecycle tests before requesting the
   live owner packet.
5. Require a new accepted ADR before adding any request handler or scheduling
   mechanism.
