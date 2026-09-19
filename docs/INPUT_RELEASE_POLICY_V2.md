# Input devices: a general release policy (schema 2)

Status: built and tested, not signed. The helper, the app and the signing tool all
understand schema 2; no release policy has been signed yet.

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

## What must happen before signing one

1. **HIDUSBF redistribution rights: decided (2026-09-19).** The maintainer's statement
   covers unchanged files with credit; the owner accepted it as sufficient.
2. **Code signing and the installer**, with the owner's approval of the exact artifacts.
3. **Hardware coverage.** Tested so far only on the owner's devices; no other hardware
   is available for testing. Release notes must say other compatible devices are
   expected to work but untested, and point to the built-in undo and recovery. Early
   user reports (device, USB controller, result) take the place of a test matrix.

## Where it lives

- `native/hidusbf-helper/ReleasePolicy.cs`: `VerifyGeneralRelease` and
  `DeviceAllowedByClass`; the helper passes each device's observed classes, speed and
  VID:PID (`WindowsMachine.cs`).
- `src/main/input-driver-lifecycle/release-policy-contract.cjs`: `parseGeneralPolicy`,
  the JavaScript twin. `tests/general-release-policy.test.cjs` checks that both agree on
  every accepted and refused policy.
- `scripts/native-release-policy.cjs`: `prepare-release`, `sign-release` and
  `verify-release`, separate from the validation commands, which still refuse releases.

A general release lasts at most 400 days, so it must be renewed.
