# Input devices: a general release policy (design, not built)

Status: proposed. Nothing here is implemented or signed. It is written now so the
policy can be built as soon as the gating questions below are answered.

## Why

The native helper only acts when a signed policy allows it. The current policy
(schema 1, `VALIDATION_ONLY`) lists exact machine and device digests. That suits a
test on one PC, but a release has to work on PCs and devices nobody listed in
advance.

## What changes

Schema 2 adds a `ACCEPTED_RELEASE` purpose that authorizes **device classes**
instead of device digests:

| Field | Meaning |
|---|---|
| `SchemaVersion` | `2` |
| `Purpose` | `ACCEPTED_RELEASE` (`VALIDATION_ONLY` keeps schema 1's exact lists) |
| `ExpiresAt`, `BrokerSha256`, `HelperSha256`, `PublisherThumbprint` | unchanged |
| `DeviceClasses` | e.g. `usb-hid-mouse`, `usb-hid-keyboard`, `usb-hid-gamepad` |
| `SpeedClasses` | `full-speed` (125–1000 Hz), `high-speed` (1000–8000 Hz) |
| `MinimumWindowsBuild` | lowest build the release was tested on |
| `DeniedDevices` | explicit VID:PID refusals for devices known to misbehave |

Rules the helper enforces for every device, whatever the policy says:

- The device must be USB, report a supported HID usage for its class, and have the
  shared driver package and Windows state the helper already checks today.
- Low-Speed, unknown or composite-ambiguous devices stay refused.
- An offered rate is a request, not proof the device delivers it; the app keeps
  measuring delivery separately.
- Every change is journaled with an exact undo, as now.

The same RSA key and PSS signature check are used. `VALIDATION_ONLY` policies keep
working unchanged.

## What must happen first

1. **HIDUSBF redistribution rights.** A release policy only matters if the driver can
   be shipped. See `docs/HIDUSBF_RIGHTS_AND_PACKAGE_DECISION.md`.
2. **Code signing and the installer**, with the owner's approval of the exact artifacts.
3. **A hardware matrix**: several mice, keyboards and controllers, receivers, and at
   least two USB controller vendors, including undo and recovery on each.

Only then is schema 2 built in `native/hidusbf-helper/ReleasePolicy.cs` and
`src/main/input-driver-lifecycle/release-policy-contract.cjs`, with tests for every
refusal, and a release policy signed.
