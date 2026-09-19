# Third-party inventory process

Native HIDUSBF broker/helper source builds are framework-dependent .NET8 Windows
Desktop x64 single-file executables. They depend on the separately installed
Microsoft runtime; it is not included in the Bun dependency count or downloaded by
Dialed. Their BUILD_MANIFEST.json binds source and unsigned executable hashes. They
are Dialed-authored wrappers, distinct from the unchanged upstream kernel files.

## Unchanged HIDUSBF bundle — 2026-09-05

The npm/Bun inventory does not cover the separately bundled upstream HIDUSBF files.
Their authoritative inventory is `vendor/hidusbf/inventory.json`, pinned by
`src/main/input-driver-lifecycle/bundled-inventory.cjs`. The app resource selection
contains ten unchanged files (five SYS copies/variants, two INF and three readmes),
plus inventory and Dialed credit/update policy. The complete official archives are
repository provenance only. Setup executables, certificates, scripts and auxiliary
test-mode/alternative-loader files are not application resources.

HIDUSBF is created by SweetLow and maintained by LordOfMice:
https://github.com/LordOfMice/hidusbf . Unchanged binary/INF bundling is supported by
the maintainer statement linked in docs/HIDUSBF_RIGHTS_AND_PACKAGE_DECISION.md;
paid-release review and target Windows compatibility are separate.

This is an engineering review aid, not legal advice, license clearance, or proof that notice and redistribution obligations are complete.

Run `bun run license:inventory` after `bun install --frozen-lockfile`. The generator reads `bun.lock`, matches resolved name/version records to installed `package.json` metadata, and writes:

- `dist/third-party-inventory.json` - schema-versioned machine-readable records;
- `dist/THIRD-PARTY-REVIEW.md` - a human-review input containing direct dependencies and explicit review flags.

Each record contains package name, resolved version, direct-production/direct-development/resolved relationship, declared license text, repository/homepage metadata, and whether an installed manifest was available. Missing, invalid, platform-specific, or ambiguous metadata is `UNKNOWN`/`NOT_INSTALLED`; the generator does not infer a license from package names, source code, or a similar package.

Output is sorted and deterministic for the same `bun.lock` plus installed manifests, bounded to 2,000 resolved records, and excludes local absolute paths. Tests cover direct-dependency completeness, deterministic ordering, size, path privacy, missing-license behavior, and required human-review language.

## Current local evidence

Regenerated on 2026-08-30 from the current Bun state:

- 521 resolved lockfile records;
- 0 direct production dependencies (renderer libraries are bundled at build time);
- 15 direct development dependencies;
- 104 records with `UNKNOWN` declared license because no matching package manifest was installed on this Windows platform;
- the same 104 records explicitly marked `NOT_INSTALLED`.

These counts can change after an intentional dependency or lockfile update. The generated artifacts must be regenerated and independently reviewed for the release commit.

## Human work still required

- Obtain and review the actual license text and required notices for shipped components and bundled assets.
- Review platform-optional and bundled dependencies that were not installed in this Windows environment.
- Review Electron/Chromium third-party notices and redistribution obligations separately.
- Confirm source/repository metadata, dual-license choices, exceptions, copyleft triggers, and distribution scope.
- Record a qualified human decision before public distribution. Automated `license` fields are evidence, not conclusions.

## HIDUSBF attribution

HIDUSBF is an independent third-party kernel filter driver. It was created by
SweetLow and is maintained by LordOfMice at <https://github.com/LordOfMice/hidusbf>.
Dialed did not write it, does not modify it, and does not claim authorship of it.
Where Dialed manages an existing HIDUSBF installation, the surrounding setup flow,
safety checks, recovery journal, helper protocol and interface are Dialed's own
independent work.

The repository publishes no LICENSE file. On 2026-07-22 the repository owner stated
in issue #407 that the binaries are Public Domain and that the requester was free to
bundle the driver binaries and INF files unmodified, with one carve-out: the files
must not be changed and still carry his name. That reply was given to a different
requester about a different, free product. Dialed treats the public-domain statement
as recorded evidence, not as a cleared commercial license, and the exact per-right
status is tracked in docs/HIDUSBF_INTEGRATION.md and the machine-readable evidence
model. Attribution wording appears on the normal Input Devices page, not only behind
Technical details.

## Existing-installation polling-driver boundary

Dialed currently contains no third-party polling-driver INF, SYS, CAT, Setup
executable, branded asset or copied package. The Input Devices implementation can
inspect and configure an already-installed exact reviewed compatible driver, and
the lifecycle framework contains only code, schema and an intentionally invalid
placeholder manifest.

The forward standalone route is a clean-room Dialed-owned package. Treat supplied
third-party files as quarantined compatibility evidence and do not inspect, copy,
derive from or ship their implementation, metadata, protocol, assets or branding.
Before a Dialed payload is added, require the independent behavior specification,
complete source/license provenance ledger, documented-interface feasibility gate,
targeted IP review, exact hashes, Dialed signer/catalog pins and clean-machine
lifecycle acceptance. See
[DIALED_NATIVE_INPUT_STACK_HANDOFF.md](DIALED_NATIVE_INPUT_STACK_HANDOFF.md).
