# Consumer launch, storefront, and landing-page copy draft

> **Not shipped:** This is planning copy only. The public build hides Premium/checkout, local activation is not production entitlement, and no price, support SLA, signing, installed-host result, or publication claim in this draft is approved.

## Distribution goal

Drive conversion with a low-risk path and conservative, measurement-safe claims:

- Free public baseline install
- 7-day and 14-day in-app trials
- Checkout or manual code redemption conversion
- Returns, support, and billing terms visible before any paid touchpoint

## Distribution channels in scope

- GitHub Releases landing page
- Storefront listing pages (where checked)
- Optional website/landing page copy for direct acquisition

## GitHub release draft template

Use this as a starting body and replace bracketed placeholders.

### Title

`Dialed {{VERSION}} — Local-first Windows diagnostics and reversible optimization`

### Body

```markdown
## Dialed {{VERSION}} (Public Release Candidate)

Safe, local-first Windows diagnostics with rollback-aware workflow actions.

### What you get
- Read-only baseline discovery and measurable diagnostics.
- Optional Consumer Premium trial (7-day or 14-day).
- Optional purchase via one-time or annual checkout links.
- Manual promo code redemption for legacy/reviewer channels.

### Download
- `Dialed Setup {{VERSION}}.exe` (NSIS installer)
- `Dialed {{VERSION}}.exe` (portable)

### Verify artifacts
- `SHA256SUMS.txt`
- `RELEASE_MANIFEST.json`
- `CODESIGN_REPORT.json`
- `dist/sbom.cdx.json`

### Conversion flow
1. Install and run baseline scan.
2. Review readiness and diagnostics signals.
3. Start a 7-day or 14-day trial.
4. Convert via checkout or redeem a valid promo code.

### Commercial terms
- Support and terms are in app and mirrored here on the storefront.
- Trial windows and cancellation/return details are shown before checkout.

### Notes
- No benchmark promise is made. Improvements are workload- and hardware-dependent.
```

## Storefront card copy (ready-to-edit)

**Headline:** `Free default install. Premium controls when needed.`

**Subheadline:** `No hidden actions, no forced updates, no telemetry selloff.`

**Feature bullets:**
- Free public profile keeps all safe diagnostics and rollback-oriented workflows.
- Consumer Premium adds startup timing and timing-lab workflows with explicit rollback state.
- Trial-first path with manual or checkout conversion.
- Clear support, return, and cancellation terms before payment.

## Public landing page asset pack

- Hero image: `docs/images/dialed-dashboard.png`
- Claims matrix pointer: `docs/LEGAL_CONSUMER_RELEASE_REVIEW.md`
- Terms/support draft: `docs/SUPPORT_RETURNS_AND_TERMS.md`
- Monetization setup: `docs/MONETIZATION_DISTRIBUTION_STRATEGY.md`
- Distribution checklist: `docs/PUBLIC_RELEASE_CHECKLIST.md`
- Install + release checksums and signing provenance are generated in `dist-electron`.

## Checkout-ready configuration

Set these values before packaging and publishing:

- `VITE_DIALED_CHECKOUT_PROVIDER`
- `VITE_DIALED_CHECKOUT_ONE_TIME_URL`
- `VITE_DIALED_CHECKOUT_ANNUAL_URL`
- `VITE_DIALED_CHECKOUT_ONE_TIME_PRICE`
- `VITE_DIALED_CHECKOUT_ANNUAL_PRICE`
- `VITE_DIALED_CHECKOUT_ALLOWED_HOSTS` (optional)
- `VITE_DIALED_SUPPORT_EMAIL`
- `VITE_DIALED_SUPPORT_HELP_URL`

When both checkout URLs are valid HTTPS links, the in-app status flips to **Checkout active**.

## Commercialization checklist (copy + assets)

- [x] Conversion flow is `free → trial → paid`.
- [x] Paid path CTAs are separated from claims and technical evidence.
- [x] Support and returns links are visible before checkout.
- [x] Checksums + manifest links are present in release copy.
- [x] Signature and signing report paths are present in the artifact set.
