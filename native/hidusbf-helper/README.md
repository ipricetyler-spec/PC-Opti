# Native HIDUSBF helper boundary

Current September 13 continuation: ordinary interval-only APPLY on an already
attached, running driver uses an observed device removal/start followed by exact
stable reconciliation. Same-rate APPLY is a no-op. New reconnect history uses
schema 3; pending snapshots live at Pending.Before and Pending.Plan.After with
Expected=null and an explicit ReadbackVerified marker. Old schema-2 pending
records retain their original Windows-restart contract. Source/closed fixtures
pass, including the captured 30-scope case; this code is not in the preserved
signed package and has not been physically exercised. See
`../../docs/NATIVE_DEVICE_RECONNECT_2026-09-13.md` and root PROJECT_HANDOFF.md for
current artifacts, authority and the next test-build phase. The dated notes below
describe earlier checkpoints and do not supersede that continuation.

2026-09-12 source checkpoint: selected-device ADOPT/APPLY/restore preserve the
entire shared/non-target state while retaining unrelated ineligible attachments.
Exact interval coordinates bind HKLM/Registry64, the concrete control set, key,
value and instance; missing, aliased or remapped targets refuse. INSTALL/REMOVE/
REPAIR keep shared-attachment guards. Journal schema 2 is explicit: legacy/unknown
or unbound records require review without migration or append. Do not delete an old
journal to activate this source. 151 new closed checks pass; actual Windows coordinate
discovery/writes have not run. Signed September 10 artifacts remain unchanged.
See `../../docs/NATIVE_OPERATION_SCOPE_IMPLEMENTATION_2026-09-12.md`.

2026-09-07: completed journal records now require explicit reconciliation after an
ordinary boot, permitting only BootId to differ. Ownership/original values survive;
pending operations and latched review states keep their existing refusal rules.
Closed fixtures cover 114 existing checks plus 61 boot-recovery checks. Preserved
Phase 2 signed binaries predate this fix. See
`../../docs/NATIVE_TRUST_REMEDIATION_2026-09-07.md` and the independent recovery
procedure in `../../docs/NATIVE_VALIDATION_RECOVERY.md`; physical recovery is untested.

This library is shared by the distinct `hidusbf-broker` and `hidusbf-host`
executables. `bun run build:hidusbf-native` publishes unsigned framework-dependent
single-file executables and a source/hash manifest into output/hidusbf-native.
The app packages those files as inactive resources. It requires a separately
installed Microsoft .NET8 Windows Desktop x64 runtime. No executable has been
launched, elevated or signed by the source/fixture build workflow.

Electron opens the broker only after its native release checks. It supplies no
command, path, device or approval token. The broker obtains ordinary same-user UAC
elevation for the helper, authenticates its local pipe and shows its own device,
rate, action and confirmation interface. Native lifecycle previews originate inside
the helper; the broker returns only the consumed-once token and exact plan digest.
INSTALL/APPLY/DETACH/ADOPT/REPAIR/REMOVE never accept shell commands. REPAIR currently
verifies the unchanged owned state; it cannot overwrite unexpected drift.

DeviceInventory enumerates all installed devices, including disconnected instances,
and merges a separate present snapshot. It preserves absent versus present-empty
ordered lower filters and rejects malformed/duplicate lists and changing snapshots.
It uses unified device properties so ERROR_NOT_FOUND means absent; invalid data is
never treated as absence. Closed parser/merge tests run without native enumeration.
Class-wide and upper HIDUSBF filters refuse the legacy lower-filter route.
ServiceInventory and WindowsMachine connect fixed SCM configuration, both patch
parameter locations, installed-file hash/Authenticode, bInterval location/type/
absence, boot identity, Code Integrity, Secure Boot and physical USB/input scope.
These native reads have compiled but have not been run. WindowsMachine writes only
the selected bInterval/lower-filter scope or fixed hidusbf service/file, preserving
unrelated filters. No automatic service stop, reboot or security-policy change exists.

NativePeerIdentity obtains the peer PID from the connected Windows pipe, retains
its process lifetime and executable file handles, checks a pinned SHA256,
Authenticode/revocation verdict, publisher thumbprint and user SID, and rechecks
the pipe PID/liveness before use. Policy must be compiled/bound into a reviewed
signed release; caller-provided identity fields are never authentication.

AuthenticatedPipe creates one local-only pipe instance with an explicit DACL,
no Everyone/anonymous ACE and no client create-instance right. Length-prefixed
messages are limited to 64 KiB. Parsing rejects unexpected/duplicate envelope fields.
Callers must supply a bounded cancellation deadline. Parsing is not plan approval.

Do not use the Electron executable as the peer pin: renderer/child processes can
share that image/SID. ReleasePolicy pins the distinct native broker/helper via
an RSA-PSS signed policy and compiled public key; the current trust anchor is empty.
It also binds publisher, expiry, platform and separate device-scope digests. The
initial owner-approved physical run must be VALIDATION_ONLY; ACCEPTED_RELEASE is a
separate evidence claim. Approval of a platform never authorizes unrelated USB
devices. The launcher removes profiler/startup/runtime overrides and sets the
documented DOTNET_EnableDiagnostics=0 environment setting. Native runtime
configuration disables startup hooks. Actual loader, pipe identity,
protected ACL and UAC behavior still require validation of the signed build.

ProtectedJournal implements bounded chained
records, flush-before-return, writer exclusion, truncation/corruption refusal and
restricted-machine-directory checks; its machine-directory entrypoint is not run.
Closed tests use memory and a temporary file/terminated fixture child to demonstrate
checkpoint persistence, not protected-machine ACL acceptance. LifecycleSession uses
that journal for helper-owned plans, original values, ownership, replay refusal and
readback. Errors retain the checkpoint and require reconciliation; it never guesses
an automatic rollback after partial external drift. The113 closed native checks
exercise the actual session on an in-memory machine, not WindowsMachine's P/Invokes.
The JS legacy lifecycle remains a separate reference model.

The native path currently reconciles a manual Windows boot transition. Removal
requires all present/absent attachments detached, no owned scopes, unchanged owned
service/file and a stopped service after boot. Native hardware-key bInterval
placement, real filter/application timing and interrupted Windows recovery are
explicit physical test cases. A compile/pass or configured rate proves none of
those outcomes. Never claim physical1–8k, USB cadence or latency from this source.

Resource layout: sibling `hidusbf/` holds the unchanged upstream bundle;
`hidusbf-native/` holds the two executables and build manifest. Signed operation
later requires release-policy.json/release-policy.sig and the reviewed public key
compiled consistently into ReleasePolicy.cs and native-broker.cjs. The unsigned
private verifier requires those activation files to be absent. Signing and physical
operations require owner authorization; there is no test flag that bypasses trust.

Source-only policy tooling and the exact later compile/sign/hash/policy/package order
are documented in `docs/NATIVE_RELEASE_POLICY_WORKFLOW.md`. Both verifiers now refuse
duplicate fields, empty/duplicate scope lists and ambiguous expiry/schema types. The
offline workflow supports owner-held external RSA PEM or detached signatures, requires
a reviewed public-key fingerprint, emits only VALIDATION_ONLY policies within seven
days, and verifies the actual JavaScript/C# contract. Public-key compilation is an
explicit source edit; the real anchors remain empty pending the single owner custody/
public-key decision. Tests use ephemeral keys in temporary fixtures only.

References:
- https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-getnamedpipeclientprocessid
- https://learn.microsoft.com/en-us/windows/win32/api/wintrust/nf-wintrust-winverifytrust
- https://learn.microsoft.com/en-us/windows/win32/ipc/named-pipe-security-and-access-rights
- https://learn.microsoft.com/en-us/windows/win32/api/setupapi/nf-setupapi-setupdigetdevicepropertyw
- https://learn.microsoft.com/en-us/windows-hardware/drivers/install/devpkey-device-lowerfilters
- https://learn.microsoft.com/en-us/dotnet/core/runtime-config/debugging-profiling
