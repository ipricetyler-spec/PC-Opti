# Next task: native signed-policy foundation

Prepared: 2026-09-06

Completed in source/closed fixtures: 2026-09-06. Preserve this as the executed brief.
Current continuation is PROJECT_HANDOFF.md; the implemented workflow and single owner
custody/public-key request are in `docs/NATIVE_RELEASE_POLICY_WORKFLOW.md`. No production
key or active policy was created. Do not repeat completed Phase1 work.

## Model and outcome

Run this task with **GPT-6 Astra and High reasoning**.

Create the smallest secure, source-only foundation for Dialed's native RSA-PSS release
policy. The task should leave a reviewable external-key workflow, focused regression
coverage and exact continuation evidence for the later GPT-5.6 Sol candidate-build phase.
It must not create or store a production private key, perform Authenticode signing, launch
native code, install or change HIDUSBF, mutate Windows/devices, reboot, publish, or claim
physical/release acceptance.

## Authoritative workspace and startup

Work only in:

```text
E:\CodexProjects\pc-optimizer\github-pc-opti
```

Read completely before editing:

1. `AGENTS.md`
2. `PROJECT_HANDOFF.md`
3. This file
4. `native/hidusbf-helper/README.md`
5. `native/hidusbf-helper/ReleasePolicy.cs`
6. `src/main/input-driver-lifecycle/native-broker.cjs`
7. `tests/hidusbf-native-broker.test.cjs`

Consult only the relevant native sections of `DECISIONS.md`, `VERIFICATION.md`,
`ROADMAP.md`, `docs/HIDUSBF_PHYSICAL_ACCEPTANCE.md`, and the build/signing scripts.
Then verify:

```powershell
git rev-parse --show-toplevel
git branch --show-current
git status --short --branch
```

Expected branch: `agent/open-source-foundation`. The worktree is intentionally dirty.
Preserve every existing change. Never reset, clean, restore, stash, rebase, commit, or
copy from the older outer workspace. Use Bun, not npm; do not create `package-lock.json`.

## Verified starting state

- The C# `ReleasePublicKeyPem` and JavaScript `RELEASE_PUBLIC_KEY` constants are empty,
  so production correctly remains `UNCONFIGURED`.
- Policy verification already requires RSA-PSS/SHA-256, at least 3072-bit RSA, exact
  fields, bounded files, expiry, exact broker/helper SHA-256 values, publisher
  thumbprint, purpose, platform digests and separately authorized device digests.
- No production RSA policy key, policy generator, or policy-signing workflow was found
  in the repository. Existing RSA keys in tests are ephemeral fixtures only.
- Historical staged Authenticode-signed native executables predate the foreground input
  capture correction. They are evidence only and must not be reused as the current
  candidate.
- Owner authorization for native executable signing is recorded, but it does not decide
  production policy-key custody, authorize secret creation/storage, or authorize native
  execution or a physical operation.

## Required work

1. Reconcile the two policy verifiers and the native build/signing order. Preserve the
   fail-closed empty-anchor state until a reviewed public key is deliberately supplied.
2. Implement the smallest maintainable release-policy preparation workflow that:
   - accepts an externally held RSA private-key path or equivalent explicit signing
     input without copying private bytes into the repository, output package, logs,
     command arguments or committed configuration;
   - validates RSA type/size and derives or verifies the matching SPKI PEM public key;
   - creates deterministic, schema-exact `VALIDATION_ONLY` policy bytes only from
     reviewed final executable hashes, publisher thumbprint, expiry, accepted platform
     digests and separately authorized device digests;
   - signs those exact bytes with RSA-PSS/SHA-256 and verifies the result through both
     the JavaScript and C# contract where practical without launching production native
     executables;
   - refuses missing, malformed, expired, over-broad, wrong-purpose, wrong-key,
     wrong-hash, duplicate/extra-field and secret-in-workspace inputs;
   - provides a deterministic, reviewable way to compile the same reviewed public key
     into both trust-anchor locations without accepting it from runtime environment,
     renderer input or adjacent files.
3. Add focused tests for the workflow and compiled-anchor parity. Prefer pure/temporary
   fixtures. Do not weaken the existing unconfigured-production test merely to make a
   fixture pass.
4. Document the exact later order: compile reviewed public key, rebuild current native
   executables, Authenticode-sign them, verify signatures/timestamps/publisher, hash the
   final signed bytes, create/sign `VALIDATION_ONLY` policy, verify/package exact files,
   then stop before launch/install.
5. If an actual production public key or custody choice is required to finish activation,
   complete all key-independent source/tests/docs first. Do not invent or generate the
   production secret. Record one precise owner decision describing the acceptable key
   type, storage/custody options, public material needed and next command—without exposing
   any secret.

## Verification

Choose focused test files based on the implementation, including at minimum:

```powershell
bun test tests/hidusbf-native-broker.test.cjs tests/build-workflow.test.cjs tests/safety-guardrails.test.cjs
bun run build:hidusbf-native
bun test
bun run lint
bun run build
git diff --check
```

The native build is compilation/package evidence only. Do not run the produced broker or
host. Do not run browser/Electron fixtures unless a source change directly requires one;
record that choice accurately.

## Canonical completion records

- Put exact commands/results and evidence limitations in `VERIFICATION.md`.
- Put any settled trust/key workflow decision in `DECISIONS.md`; otherwise record the
  unresolved owner choice without pretending it is decided.
- Mark Phase 1 accurately in `ROADMAP.md`.
- Update the top `PROJECT_HANDOFF.md` resume action. If Phase 1 is complete, route the
  next task to **GPT-5.6 Sol / High** for the current native candidate. If blocked, route
  it to the single exact owner input required.

## Hard boundaries

Do not generate or commit a production private key. Do not expose credentials or key
bytes. Do not sign an executable in this phase. Do not launch the broker/helper, run a
live probe or capture, install/apply/adopt/detach/repair/remove a driver, change Windows
or security policy, invoke an installer, reboot, publish, or bypass UAC, Defender, Smart
App Control, Secure Boot, Memory Integrity, certificate trust or anti-cheat protections.
Do not run a VM. Preserve the existing HIDUSBF installation and all intentional dirty
work.

## Paste-ready new-task prompt

```text
/goal Work in E:\CodexProjects\pc-optimizer\github-pc-opti using GPT-6 Astra with
High reasoning. Read AGENTS.md, PROJECT_HANDOFF.md, and
docs/NATIVE_RELEASE_POLICY_FOUNDATION_NEXT_TASK.md completely, then execute that brief
through source-only implementation, focused/full verification, and canonical-record
updates. Preserve the intentional dirty worktree and every approval boundary. Do not
generate or store a production private key, sign or launch an executable, install or
change HIDUSBF, mutate Windows/devices, reboot, publish, or expand into optional work.
Continue autonomously through every key-independent step; if key custody or a reviewed
public key is indispensable, finish all other scoped work and return one exact owner
decision request.
```
