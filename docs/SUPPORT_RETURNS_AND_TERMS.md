# Support, billing, and legal wording (internal draft)

> **Not customer terms:** Placeholder contacts, response times, return language, and storefront terms are not a shipped support commitment.

## Support policy

- Public in-app support contact: `support` email configured by `VITE_DIALED_SUPPORT_EMAIL`.
- Standard response target: up to 72 business hours for non-security requests.
- Security incidents or suspected abuse: respond faster with immediate escalation when evidence is present and user-provided logs are available.
- Public-facing support is mirrored in storefront and release notes before any paid conversion path.

## Billing and entitlement terms

Planning only: none of the following is an active customer entitlement or billing
commitment in the current build. Monetization remains deferred and all normal
capabilities remain available while the hidden commerce implementation is reviewed.

- Free public profile remains the default and fully usable baseline.
- Consumer Premium can be unlocked by:
  - 7-day or 14-day in-app trial
  - manual activation code redemption
  - one-time or annual checkout link at release time
- Trials do not start charges.
- Converting to paid is explicit and only after the user taps a checkout action or redeems a valid paid code.

## Returns and cancellation

- Returns and refunds follow the active storefront’s official terms shown on the purchase flow.
- Annual renewal users can cancel before renewal using storefront controls before the end of the paid term.
- Refund requests are submitted through the same support path listed on purchase confirmation and storefront.

## Legal and claims constraints

- No universal FPS or responsiveness claims.
- No minimum-boost promises.
- Claims in app, release notes, and storefront copy must match the evidence matrix in `LEGAL_CONSUMER_RELEASE_REVIEW.md`.
- Privacy statement remains explicit that local system state collection is scoped to app features shown on-screen.

## Distribution legal pre-publish checklist

- Terms of service + privacy notice include support/billing wording and checkout terms.
- Return and cancellation statements match app support copy and storefront listing.
- If checkout provider is changed, update this doc + manifest checkout env references.
- Legal counsel review required before public paid publication.
