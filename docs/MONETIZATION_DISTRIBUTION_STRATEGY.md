# Monetization and distribution strategy

> **Current plan:** See [Dialed introductory monetization plan — 2026-08-27](MONETIZATION_PLAN_2026-08-27.md). The owner selected $10 / $15 introductory pricing, two active PCs, preview plus a seven-day refund window, software-first distribution, and permanent full owner access. No commerce implementation is authorized by this planning update.

## Historical parked draft — superseded

The earlier trial lengths, single-device offer, and day-one annual sales below are retained as historical context, not current decisions. The linked plan supersedes them. Existing checkout/license previews remain non-production.

> **Not shipped:** Commerce remains a planning exercise. The public runtime hides the checkout surface until a real provider, valid HTTPS offers, non-placeholder support metadata, and production entitlement verification exist.

## Recommended monetization model (keep current-owner/consumer split)
- Keep Owner Edition fully unchanged and private.
- Keep Public build as baseline free tier with conservative capabilities.
- Introduce **Consumer Premium** as the paid unlock:
  - 7-day and 14-day trials from in-app activation.
  - Paid activation paths with one-time and annual options from day-one, with upgrade-to-annual discount.
  - One-time promo/enterprise codes (existing manual redemption path) for pilots, reviewers, and partnerships.
- Use a short no-risk funnel:
  - `free → trial → paid activation`.
  - No paywall inside safety-grade diagnostic workflows until premium gates are needed.
- Keep distribution-safe positioning:
  - No “always works” language, no benchmark guarantees.
  - Clearly state that outcomes vary by hardware, workload, and environment.
  - Keep cancellation and refund language clear at the first paid touchpoint once checkout is enabled.

## Revenue options to launch first
- **Primary**: one-time license (single-device) + annual renewal package.
  - Lower support burden than complex recurring billing.
  - Easier for B2C trust and transparent conversion copy.
- **Secondary**: annual renewal for users who need ongoing premium workflows.
- **Tertiary**: promo bundles for channels (content creators, influencers, repair/IT channels).

## Distribution channels to activate first
- Public GitHub release landing + website storefront + README funnel
  - Clear CTA: try install → feature gates → trial → redeem.
  - Add a short pricing strip and entitlement states (`Public`, `Trial`, `Premium`) to onboarding.
- Windows download page (direct NSIS + portable artifacts)
  - Publish checksummed artifacts and clear minimum specs.
  - Add a short support FAQ adjacent to download links.
- Direct affiliate/content partnerships
  - Tutorials that show conservative workflow before premium unlock.
- Optional later stage: Microsoft Store / Steam / itch distribution
  - Do not gate these behind first release until legal, billing, and claims review are complete.

## UX conversion design already present
- Trial and redemption entry points are already in the **Upgrade** tab.
- Keep claims conservative and evidence-first:
  - Avoid absolute FPS promises.
  - State clearly that performance outcome remains measurement-bound.
- Keep Owner path always visibly exempt from trial/payment copy.

## Next actions (minimal, high-impact)
1. Add pricing constants in a single config for future checkout migration.
2. Add lightweight trial status telemetry (local-only, no PII), e.g., trial started/ended counts.
3. Add storefront landing copy for:
   - trial benefit boundaries,
   - pricing options,
   - terms and refund language,
   - upgrade code redemption support email.
4. Run one final UI pass and publish release-note draft aligned to this model.
5. Add direct conversion copy to onboarding/first run guidance:
   - public baseline clarity,
   - trial path,
   - explicit owner-exemption statement.
6. Implement checkout handoff plumbing in-app (links + launch guardrails) and release distribution proof artifacts (checksums + manifest).
7. Publish release-ready storefront/landing copy, checkout terms, and a support/returns policy snapshot in each public channel.
