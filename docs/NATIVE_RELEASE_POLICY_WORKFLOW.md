# Native release-policy workflow

Current continuation (2026-09-07): initial Phase 3 BLOCKED findings were remediated;
owner-authorized replacement artifacts are complete and the primary trust re-review
passes readiness to request physical scope. See NATIVE_TRUST_REVIEW_2026-09-07.md.
Current candidate/package use suffix 20260907; preserve them and the older 20260906
evidence. Creation commands below are historical templates, not permission to
recreate or renew either policy. Current-source parity must refuse the old candidate.

Updated: 2026-09-06. Phase 1 source/fixture foundation only. The real compiled anchors
remain empty; production remains UNCONFIGURED. No production private key, production
policy, Authenticode signature or physical acceptance was created in this phase.

Subsequent owner-authorized follow-up completed Phase 2: the local key exists as
encrypted DPAPI data, the isolated candidate has matching public anchors, and its two
current native helpers have verified signatures/timestamps. The reviewed EXAMPLE-PC scope,
detached-signed `VALIDATION_ONLY` policy and verified unlaunched package now exist at
the paths recorded below. Development anchors remain empty. Use
`docs/NATIVE_POLICY_KEY_CUSTODY_2026-09-06.md` for custody and
`docs/NATIVE_TRUST_REVIEW_HANDOFF_2026-09-06.md` for exact artifacts. The Phase 1
description above remains historical evidence; no key-custody decision is pending and
no `ACCEPTED_RELEASE` or physical acceptance exists.

## Contract and custody

`scripts/native-release-policy.cjs` is an offline operator tool, outside the renderer
and native runtime. It neither generates keys nor reads trust from the environment.
The operator supplies an absolute SPKI public PEM path and its independently reviewed
lowercase SHA256 fingerprint of the DER SubjectPublicKeyInfo. Only ordinary RSA keys
from 3072 through 8192 bits are supported; the upper bound matches the 1024-byte
signature limit. The same canonical public PEM is compiled into the C# and JavaScript
literal anchors. `anchors` previews the two affected paths; `--write` changes only
those literal spans. The native build refuses inconsistent anchors before compiling.

Choose one owner-controlled custody method:

- External private PEM: an existing owner-protected RSA private-key file outside this
  checkout, every candidate directory and policy output directory. The current file
  adapter accepts unencrypted PKCS#8/PKCS#1 PEM, with custody/access controls supplied
  by the owner. It does not implement passphrase storage, create a key, change ACLs,
  or copy the private key. Paths are explicit; linked paths and private hard links
  refuse. Private bytes enter only the signing process, are never logged or passed
  to a child process, and the read buffer is cleared afterward. This is not a claim
  that the managed runtime can guarantee erasure of every internal key allocation.
- Non-exportable HSM/key-vault custody: use `prepare`, have the chosen external signer
  sign those exact bytes, save the raw signature as `release-policy.sig`, and use
  `verify`. The contract is SHA256 plus RSA-PSS with a 32-byte salt, MGF1-SHA256 and
  a signature the size of the RSA modulus. If the provider takes a digest, give it
  SHA256 of the prepared bytes exactly once; do not double-hash. Provider onboarding,
  credentials and real-provider acceptance are outside this phase.

Authenticode's Azure signing certificate and this policy RSA key are separate
identities. The historical Azure profile/signature evidence does not select or
provision policy-key custody. Never paste private bytes or credentials into a task,
command argument, repository file, manifest, package or log.

## Reviewed policy input

The `--review` file is a bounded UTF-8 JSON object with exactly these eight fields:

| Field | Required reviewed value |
| --- | --- |
| SchemaVersion | Integer literal `1` |
| ExpiresAt | Real UTC ISO timestamp, future and within seven days of issuance/verification |
| BrokerSha256 | Lowercase SHA256 of final Authenticode-signed `Dialed.HidusbfBroker.exe` |
| HelperSha256 | Lowercase SHA256 of final Authenticode-signed `Dialed.HidusbfHost.exe` |
| PublisherThumbprint | Exact 40-hex signing-certificate thumbprint verified for both files |
| AcceptedPlatformDigests | 1–128 distinct exact lowercase SHA256 platform digests |
| Purpose | `VALIDATION_ONLY` |
| AuthorizedDeviceDigests | 1–128 distinct separately authorized lowercase SHA256 device-scope digests |

No wildcard, inferred device scope, missing field, duplicate/escaped-duplicate field,
extra field, malformed identity or expired review is accepted. Preparation normalizes
field order, UTC milliseconds, uppercase publisher thumbprint and sorted digest arrays,
then writes compact JSON with one LF. Those bytes are deterministic; RSA-PSS signatures
are deliberately randomized. C# and JavaScript still recognize `ACCEPTED_RELEASE` as a
separate runtime contract, but this tool cannot issue it. The seven-day issuance limit
does not silently change the runtime expiry semantics for separately reviewed releases.

The tool verifies full-file hashes against the reviewed inputs; it does **not** assert
Authenticode trust, timestamp validity, publisher ownership, actual platform/device
observation or owner approval. Those evidence checks precede preparation. It runs no
Windows inventory, device operation, broker or helper. A syntactically valid digest
alone is not physical evidence or authorization. Do not populate scope with invented
values to get a policy through the tool. The exact real scopes remain later inputs.

## Exact later order: GPT-5.6 Sol / High

1. Receive the owner's custody choice, reviewed public SPKI PEM and independently
   reviewed DER fingerprint. Preview in this checkout, inspect the two source spans,
   then repeat with `--write` only for that reviewed key:

   ```powershell
   bun scripts/native-release-policy.cjs anchors --public-key "<absolute-public-SPKI-PEM-path>" --fingerprint "<reviewed-lowercase-SPKI-DER-SHA256>"
   bun scripts/native-release-policy.cjs anchors --public-key "<absolute-public-SPKI-PEM-path>" --fingerprint "<reviewed-lowercase-SPKI-DER-SHA256>" --write
   ```

   The current unconfigured-production regression remains strict. A later configured
   candidate must retain unconfigured-build refusal coverage rather than turning that
   test into a bypass. The public key is build-time source, never an adjacent runtime
   key file, environment override, renderer field or caller-supplied trust anchor.

2. Rebuild **current source**, after public-key compilation, into a new absolute
   directory. Its parent must be inside the authorized release workspace:

   ```powershell
   bun scripts/build-hidusbf-native.cjs --output "<absolute-new-native-candidate-directory>"
   ```

   The build includes the public-key fingerprint and both verifier-source hashes in
   `BUILD_MANIFEST.json`. It snapshots source hashes before compilation and refuses
   manifest issuance if source or trust changes during the build. It produces unsigned
   bytes and never launches or signs them.
   Configured default builds refuse; explicit outputs cannot already exist. Existing
   policy files also block the default build. Do not reuse historical signed binaries
   or run `electron:build` after signing: its native rebuild would invalidate pins.

3. Stage only the two exact current native executable files for separately authorized
   Authenticode signing. Preserve the unsigned source build and historical signatures.
   Use the existing reviewed Windows signing workflow/provider; authentication may
   need the owner. Verify each final signature with SignTool `/pa /all /v /tw`, require
   no timestamp warnings, and record Valid Authenticode, publisher thumbprint and
   timestamp evidence. Both files must match the reviewed publisher. This phase did
   not run those steps or refresh the historical Azure authentication state. Verification
   options are documented in [Microsoft's SignTool reference](https://learn.microsoft.com/en-us/windows/win32/seccrypto/signtool).

4. Hash the **final signed bytes** and review the eight-field policy input above.
   The build manifest describes the unsigned inputs; retain a separate signed-file
   evidence manifest. Never claim that its pre-sign hashes describe signed files.
   Review expiry, exact platform digests and separately authorized device digests.

5. Create/sign the policy using one custody route. All paths below are absolute;
   `--output` must name a new directory with an existing parent. No prior policy is
   overwritten. The policy output contains only policy JSON and, when signed, its
   raw signature; it does not copy executables, public keys or private keys.

   ```powershell
   bun scripts/native-release-policy.cjs sign --review "<review-json>" --candidate "<final-signed-native-directory>" --public-key "<public-SPKI-PEM>" --fingerprint "<reviewed-SPKI-DER-SHA256>" --private-key "<external-owner-held-private-PEM>" --output "<new-policy-directory>"
   ```

   For non-exportable custody, replace `sign` with `prepare` and omit `--private-key`.
   The owner-held signer then creates `release-policy.sig` for the prepared bytes.

6. Run the same explicit verification for either custody route:

   ```powershell
   bun scripts/native-release-policy.cjs verify --review "<review-json>" --candidate "<final-signed-native-directory>" --public-key "<public-SPKI-PEM>" --fingerprint "<reviewed-SPKI-DER-SHA256>" --policy-dir "<policy-directory>"
   ```

   `sign` and `verify` verify the signature/schema through JavaScript and the actual
   C# `ReleasePolicy.Verify` contract, using the closed fixture's `--verify-policy`
   entrypoint. This needs the .NET SDK; it does not run `Load`, `PinExecutable`, UAC,
   device/service APIs or either production native executable. Hashes/signature and
   compiled-anchor parity are checked again before success. A failed C# check may
   leave incomplete/unaccepted policy output; never package it until `verify` passes.

7. Package those exact signed native files, verified policy and current application
   source containing the same public key. Verify packaged hashes, policy signature,
   publisher/timestamps, source manifest and exact resource allowlist again. The old
   unsigned-private-candidate verifier intentionally forbids policy activation files;
   it cannot certify a configured candidate. Candidate-specific signed packaging and
   its final evidence remain Phase 2 work. Do not rebuild native code after hashing.

8. Stop before launch/install. Phase 3 is an independently owner-approved trust review;
   neither policy issuance nor signature verification authorizes a physical operation,
   HIDUSBF change, app launch, reboot, security change or publication.

## Current Phase 2 commands

**Completed 2026-09-06. Do not rerun these creation/signing commands against the existing
paths.** The exact results are preserved under `output/native-policy-candidate-20260906`
and `output/native-policy-package-20260906`; the latter's verifier may be rerun read-only
and will preserve/compare its immutable report. The commands below remain the audited
procedure and use new-output enforcement.

The repository has fail-closed operator tooling for this sequence. The initial
2026-09-06 preflight found the selected Razer but not the selected DualSense Edge and
correctly refused to issue scope evidence. After both devices were present, the same
command produced the completed two-pass scope without changing either device.

```powershell
$candidate = "E:\CodexProjects\pc-optimizer\github-pc-opti\output\native-policy-candidate-20260906"
$public = "C:\Users\user\.dialed-signing\release-policy-public.pem"
$fingerprint = "9b4276c9991b35c7f3e784357080e4ba709ecaeab8255d34e79df92023a2cef9"
bun scripts/collect-native-policy-scope.cjs --machine EXAMPLE-PC --device 054C:0DF2 --device 1532:00A5 --output "$candidate\scope\SCOPE_EVIDENCE.json"
```

Inspect the complete preimages and confirm both selected products before choosing a
canonical UTC expiry within seven days. Then prepare the exact review, policy, detached
signature and both-contract verification. Every output path must be new.

```powershell
bun scripts/prepare-validation-policy-review.cjs --scope "$candidate\scope\SCOPE_EVIDENCE.json" --signature-manifest "$candidate\SIGNATURE_MANIFEST.json" --expires "<UTC-within-seven-days>" --output "$candidate\scope\VALIDATION_POLICY_REVIEW.json"
bun "$candidate\source\scripts\native-release-policy.cjs" prepare --review "$candidate\scope\VALIDATION_POLICY_REVIEW.json" --candidate "$candidate\signing" --public-key "$public" --fingerprint "$fingerprint" --output "$candidate\policy"
pwsh -NoLogo -NoProfile -NonInteractive -File scripts/native-policy-key.ps1 -Action Sign -KeyDirectory "C:\Users\user\.dialed-signing" -PublicFingerprint "$fingerprint" -PolicyPath "$candidate\policy\release-policy.json" -SignaturePath "$candidate\policy\release-policy.sig"
bun "$candidate\source\scripts\native-release-policy.cjs" verify --review "$candidate\scope\VALIDATION_POLICY_REVIEW.json" --candidate "$candidate\signing" --public-key "$public" --fingerprint "$fingerprint" --policy-dir "$candidate\policy"
```

After both contracts pass, prepare and verify only an unpacked, unlaunched candidate.
This path refreshes web assets but does not rebuild or re-sign the native helpers.
Dependency rebuild and builder signing are disabled; resource editing remains
enabled so the assembled main app carries its administrator manifest before signing.

On hosts where unsigned fixture execution is refused, the release `verify`/`sign`
commands and both package commands accept optional `--signed-fixture` pointing to
an explicitly prepared `SIGNED_POLICY_FIXTURE` JSON manifest. It pins the fixture
launcher, DLL, dependency/runtime files, and complete native source set. The verifier
requires current source parity plus valid timestamped launcher/DLL signatures from
the policy's publisher, then runs the same closed `--verify-policy` contract and
rechecks the fixture. This avoids rebuilding approved signed bytes into unsigned
outputs. It does not replace the policy signature, broaden scope or affect runtime
trust. Without this option, the existing build-and-run fixture path remains.

Sign fixture binaries once per unique artifact. Identical launcher bytes across
canonical/key-compiled fixture directories can reuse the already verified signed
copy; different DLLs require their own signatures. Fixture signing and the three
product executables should be reported separately to the owner.

```powershell
$package = "E:\CodexProjects\pc-optimizer\github-pc-opti\output\native-policy-package-20260906"
bun scripts/prepare-native-policy-package.cjs --candidate "$candidate" --policy-dir "$candidate\policy" --review "$candidate\scope\VALIDATION_POLICY_REVIEW.json" --public-key "$public" --fingerprint "$fingerprint" --output "$package"
bun scripts/verify-native-policy-package.cjs --package "$package" --candidate "$candidate" --policy-dir "$candidate\policy" --review "$candidate\scope\VALIDATION_POLICY_REVIEW.json" --public-key "$public" --fingerprint "$fingerprint"
```

Successful package verification is the Phase 2 handoff input for GPT-6 Astra / High.
It remains source/signature/package evidence only, not launch, physical or release
acceptance.

## One owner decision

Resolved by the owner's subsequent request to create the folder/key and continue. Local
Windows-user-encrypted custody is established; see the linked current custody record.
Do not request this decision again. The original options below describe the Phase1
gate and alternative adapters, not an instruction to recreate the existing key.

Choose custody for an RSA 3072–8192-bit policy key: an owner-protected external private
PEM, or a non-exportable HSM/key-vault signer that supports the specified RSA-PSS
contract. Provide only the absolute path to the matching reviewed public SPKI PEM
and its independently reviewed lowercase SHA256 DER fingerprint. Do not provide a
private key or credential in chat. The next command is the `anchors` preview in step 1;
after that input, route the current-candidate phase to GPT-5.6 Sol / High.
