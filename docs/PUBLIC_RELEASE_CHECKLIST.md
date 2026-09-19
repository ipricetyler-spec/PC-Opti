> Current status (2026-09-05): see [whole-app completion ledger](WHOLE_APP_COMPLETION_2026-09-05.md) and root VERIFICATION.md. Older counts/artifact statements below are historical. Bundled-driver lifecycle gates apply only if that paused route is resumed; the separate-install checker has its own physical compatibility and measurement acceptance.

# Public release checklist

## Engineering

- [ ] All automated gates pass from a clean checkout with frozen Bun install.
- [x] Current intentional dirty source/fixture tree passes 304 tests, TypeScript,
      production build, clean-room parity, syntax/diff checks, and the isolated
      eight-theme browser suite. This does not replace the clean-checkout gate.
- [ ] Owner approves the exact supported Windows versions/editions, processor
      architectures and Secure Boot/Memory Integrity/security-state support scope.
- [ ] Windows integration matrix passes on every approved support class.
- [ ] Installer, portable, upgrade, migration, uninstall, and data-retention behavior are verified.
- [x] No unresolved Critical/High consumer-safety or security defect is known in
      the current source after the full-app security scan, both bounded fixes and
      two independent post-fix source reviews. Live helper/driver/Windows matrix
      acceptance remains separately open below.
- [x] Local runtime profiles expose the full implemented feature set equally while monetization is deferred; main-process safety checks remain active.
- [ ] Candidate game profiles pass current-game acceptance before public distribution; file hash verification alone is insufficient.
- [ ] Pending-journal and rollback compatibility are tested across upgrades.
- [x] Payload-agnostic input-driver lifecycle source/fixture QA passes, while the
      production capability remains unconfigured and disabled.
- [ ] Signed input-driver clean-machine matrix passes install/adopt/repair/upgrade,
      restart reconciliation, exact detach, phantom inventory, package removal
      and recovery-aware app uninstall on every supported Windows/security class.

## Security and supply chain

- [ ] Dependency audit reviewed; exceptions have owner, rationale, and expiry.
- [ ] CycloneDX inventory and third-party license/notice review complete.
  - Regenerated for current source on 2026-09-01: 386 SBOM components and 521
    resolved declared-license records. This is dirty-tree evidence, not a frozen
    release-commit inventory. Missing/platform-uninstalled metadata stays explicitly
    flagged; human license/notice review is not complete.
- [ ] Signing identity approved; protected CI secrets configured; signed artifacts verified.
  - Current 2.8.0 source-matched private candidate is intentionally `NotSigned`.
    Older signed 2.6.0 artifacts are historical only and do not satisfy this gate.
- [ ] Checksums and provenance/attestation generated from the release commit.
- [ ] Vulnerability intake and update/incident procedure tested.
- [ ] Populate and approve package.json dialed.update with the final HTTPS feed,
      allowed installer host(s), Ed25519 public manifest key/id and exact
      Authenticode publisher subject/thumbprint.
- [ ] Generate and independently verify UPDATE_FEED.json from the exact signed
      installer using the private Ed25519 key kept outside the repository.
- [ ] The clean-room driver behavior specification, source/license provenance
      ledger and targeted IP review are approved; no supplied third-party
      implementation file, metadata, asset or branding entered the build.
- [ ] The documented-interface feasibility gate proves each claimed rate with
      Windows protections enabled and independent selected-device bus evidence;
      no Microsoft driver patch or undocumented kernel offset is used.
- [ ] One Dialed-owned INF/SYS/CAT package passes role-correct catalog membership,
      hash, signer, revocation, INF/service and Windows compatibility verification,
      plus the applicable Hardware Dev Center and WHCP/HLK route.
- [ ] The separately signed narrow x64 helper, packaged Dialed app and protected
      machine journal pass signature, nonce/scope, ACL, cross-process serialization,
      crash/fault and collateral-device review. No generic privileged bridge exists.

## Privacy and claims

- [ ] User-facing privacy notice matches the exact release data flow and provider terms.
- [x] External-AI audit claims and navigation are absent from the public build; the path is parked.
- [ ] History export/deletion and retention behavior are documented.
- [ ] Every performance/benefit statement maps to the claims substantiation matrix.
- [ ] No universal boost, latency, safety, “health,” or superiority claim.

## Legal and commercial

- [ ] Human counsel/commercial review complete; this checklist is not treated as legal advice.
- [x] Final owner naming decision recorded: Dialed, 2026-08-25.
- [ ] Professional name clearance completed; preliminary screening is not treated as clearance.
- [ ] Dependency licenses/notices and redistribution rights approved.
- [ ] Monetization/renewal/cancellation requirements re-checked if billing exists.
- [ ] Release channel, support policy, supported Windows scope, and data-retention policy approved.

## Publication

- [ ] Version/changelog/release notes match the artifacts.
- [ ] Screenshots, README, installer, store/landing copy, and UI use substantiated language.
- [ ] Final artifacts, hashes, signatures, SBOM, and release commit independently verified.
- [ ] RELEASE_MANIFEST.json is generated and included with each public release package.
- [ ] UPDATE_FEED.json is signature-verified, published at the pinned URL, and
      exercised through up-to-date, no-downgrade, tamper and explicit-install cases.
- [ ] Owner explicitly approves publication (A-005).

## Current product and commerce status

- [x] Nine-workspace navigation, eight themes, and existing optimization controls remain present in source/browser checks.
- [x] BIOS plans are guidance only; no firmware apply/reboot API exists.
- [x] Paid-tier splitting, billing and production licensing are deferred; the checkout/activation preview is hidden.
- [x] Introductory pricing and permanent owner access remain planning decisions, not a shipped entitlement system; see MONETIZATION_PLAN_2026-08-27.md.
- [x] Distribution landing and support/returns drafts exist; they are not proof of approved terms or a live storefront.
- [ ] Implement and verify production payments, entitlements, cancellation, and permanent owner access before selling subscriptions.
- [x] Select 2.8.0 as the current source/product-test version.
- [x] Build and independently verify a fresh unsigned portable matching the final
  no-redesign source. Current private owner-review candidate:
      `output/private-candidate-2.8.0-post-security-final-20260901/Dialed 2.8.0.exe`,
      SHA-256
      `61a6e2b663894dbe8786675f2202778c1667a033d3e183915e6ead49e3be974c`.
      It remains unsigned, unpromoted, unlaunched, uninstalled and not public-
      release evidence. The `3615761c...b1cdc2d`, `b177400b...15de6` and promoted
      `135d7e...` artifacts are stale historical evidence.
- [ ] After current-product acceptance, sign and independently verify rebuilt or
      unchanged exact artifacts before installer execution.
- [ ] Complete the current owner procedure in OWNER_ACCEPTANCE_TEST.md.
