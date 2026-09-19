# Technical details mode

Status: implemented and audited across the full source UI; a new source-matched
package and owner-host acceptance remain pending.

## Product rule

Dialed defaults to a concise user view. A single shared **Technical details** setting in Settings reveals engineering evidence similar to a “Stats for nerds” view. The preference is local to the current Windows profile.

The setting may hide:

- hardware identifiers, raw timing samples, and topology-confidence evidence;
- package hashes, signer metadata, and low-level configuration sources;
- benchmark sample payloads and internal evidence paths.

It must never hide:

- a required administrator, restart, reconnect, or recovery step;
- affected-device scope or a warning that another device could be changed;
- a failed, inconclusive, interrupted, or needs-review result;
- the distinction between configuration, observed delivery, USB transactions, and latency;
- exact restoration controls.

## Validation model

Every feature uses the smallest user check that establishes its immediate outcome. Repeated trials, raw distributions, and controlled comparisons are engineering acceptance unless a result is unstable or troubleshooting is needed.

For input polling:

1. The normal user configures the selected device and completes the required restart/reconnect boundary.
2. One eight-second result within 5% of the request is sufficient for the normal Dialed “ready” state.
3. Repeated results and channel timing distributions are optional troubleshooting evidence.
4. USB-bus proof and latency proof are performed once per supported device/driver/Windows compatibility class, then repeated when any material part changes.

This is not permission to replace verification with subjective feel. User perception is useful acceptance feedback, but it does not establish USB transaction cadence or a latency claim.

## Implementation

- Preference key: `dialed-technical-details:v1`.
- Default: hidden.
- Root state: `document.documentElement.dataset.technicalDetails`.
- Engineering-only surfaces use the `data-technical-detail` attribute.
- Safety and recovery surfaces must not use that attribute.

New features must provide a plain-language outcome first and place optional raw evidence behind the shared mode rather than inventing another local “advanced” switch.

## Product-wide application

This is one product rule, not an Input Devices-only presentation option. The
current pass covers all nine workspaces and the shared surfaces they render:

- **Home and Scan:** scan scope, device hashes, duration, raw metrics, storage
  attributes, inventory limits, and diagnostic source details are optional;
  current status, problems, and next actions remain visible.
- **Optimize and Games:** raw policy/configuration paths, DWORD values, imported
  sample payloads, backup filenames, discovery internals, and per-action logs are
  optional; action consequences, reversibility, failures, and restore remain visible.
- **Network and Input Devices:** adapter internals, sample distributions, topology
  confidence, hardware identities, interval mappings, interface lists, and evidence
  methodology are optional; connection/polling outcomes, consent, affected devices,
  claim limits, safety blockers, and recovery remain visible.
- **Measure and Verify:** capture provenance, hashes, process/timing fields, raw
  evidence rows, plan identifiers, Registry/configuration locations, and success
  payloads are optional; capture controls, failed or interrupted work, drift,
  unresolved changes, and rollback remain visible.
- **Settings:** package/signature metadata and edit timestamps are optional where
  they are supporting evidence; trust state, feature availability, theme/profile
  choices, and the Technical details control itself remain visible.

The two Input Devices tasks remain separate because they have different risk and
intent: **USB connection** is read-only topology/port comparison, while **Polling
rate** contains configuration, verification, and recovery work.
