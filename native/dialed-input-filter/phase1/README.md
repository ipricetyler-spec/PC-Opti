# Phase 1 offline transparent-filter prototype

Status: source and deterministic contract tests only. This directory is not a
driver package, is not referenced by the Dialed product build and cannot be
installed as checked in.

## What this prototype proves

- the architecture is a device-specific PnP filter, not a primitive or class
  filter;
- the exact stack contract is a lower filter on one approved USB HID interface
  devnode;
- declarative `AddFilter` registration is used without Registry filter-list
  edits;
- no relative filter order is assumed;
- the KMDF source creates only a filter device object and supplies transparent
  PnP/power callbacks; and
- with no WDF queue, all request types remain framework-forwarded and the source
  has no user-mode or scheduling surface.

The [documented-interface verdict](ADR-0002-DOCUMENTED-SCHEDULING-INTERFACE.md)
records why no scheduling mechanism may be added: current Microsoft documentation
states that a driver cannot change an interrupt endpoint's polling interval. It
also records that this placement, while not the discouraged HIDCLASS-to-transport
placement, is outside the two filter placements Microsoft recommends for keyboards
and mice.

The [architecture decision](ARCHITECTURE_DECISION.md) and
[`prototype-contract.json`](prototype-contract.json) are normative for this
prototype.

## Deliberate non-installability

`driver/dialed_input_filter.inx` contains unresolved date, version and exact
hardware-ID tokens. There is no generated `.inf`, `.sys`, `.cat`, helper,
production manifest entry or package build hook. Substitution may occur only in
an isolated build directory after the owner packet names the exact target and
toolchain. Its provisional `ExtensionId` is not package-ready until Dialed
ownership evidence is recorded. A broad or class-wide hardware match is
prohibited.

## Toolchain gate

The target toolchain is Visual Studio 2026 Build Tools 18.3.0, MSVC 14.50,
Windows SDK/WDK 10.0.28000.2526, KMDF 1.33 and x64. None of the required WDK
build or INF-validation tools is installed on the current host, so no driver
build, `InfVerif`, static analysis, package creation or signing result is claimed.

`driver/dialed_input_filter.vcxproj` is an x64-only, warning-as-error source
project with signing explicitly off. The unresolved INX is a `None` item, so a
source build cannot silently stamp, catalog or sign an installable package.

When that exact toolchain is available in an owner-approved isolated build
environment, the minimum offline gate is:

1. warning-free x64 build;
2. `InfVerif /w` and `InfVerif /h` with no unresolved finding;
3. API/static-analysis validation;
4. exact source, generated-INF, SYS and CAT hashes;
5. proof that Dialed owns the exact `ExtensionId` used by the generated INF;
6. proof that the generated hardware ID names only the approved test interface;
7. an exact pre-attach stack graph proving the selected devnode does not place
   the filter between HIDCLASS and its HID transport minidriver;
8. transparent pass-through, PnP, power, cancellation and recovery fixtures; and
9. a fresh read-only security and Windows-systems review.

## Scheduling hard stop

This prototype does not control, modify or measure USB scheduling. `bInterval`
remains firmware-owned, and Microsoft documents that drivers cannot change it. No request handler, USB pipe handle or URB behavior may
be added until a separate accepted ADR identifies a documented interface and the
offline malformed-input, cancellation, concurrency and completion tests that
will guard it. Without that evidence, the corresponding rates remain `BLOCKED`.
