# Historical public-polish checkpoint

This file records an earlier artifact/marketing checkpoint. It is not current release-readiness evidence. The current source default is `public`; unsigned binaries, installed-host acceptance, checkout, entitlement, screenshot freshness, signing, and publication require separate current verification.

- Verified owner edition binaries were not removed.
- Earlier unsigned installer observed: `dist-electron/Dialed Setup 2.5.0-alpha.1.exe`.
- Earlier unsigned portable build observed: `dist-electron/Dialed 2.5.0-alpha.1.exe`.
- Verified quality gates:
  - `bun run lint`
  - `bun run test`
  - `bun run check:clean-room-parity`
  - `bun run electron:build`
  - Historical `bun run build:owner-profile` command (removed on 2026-08-26 because packaged builds ignore the development-only environment override; it did not create a distinct owner artifact)
- Verified old 2.4.0 installer artifacts in old root locations were removed from active workspace root.

## Public polish completed in this pass
- Cleanest runnable artifact set in `github-pc-opti/dist-electron`.
- Newest build launches successfully.
- No functional policy changes made to owner features; owner separation remains intact.
- Market-facing polish pass completed:
  - Upgrade copy and conversion language updated for free → trial → paid entitlement clarity.
  - Historical Premium preview copy was added; the current public navigation hides it because production commerce and entitlement are not configured.
  - Public pricing model and distribution language added to README and monetization strategy docs.
- Checkout and release scaffolding added (not production commerce or release approval):
  - External checkout launch bridge added to app with safe allowlist handling.
  - Premium UI now includes checkout actions, support email shortcut, and return/cancellation text hooks.
  - Release manifest generation added (`bun run release:manifest`) and uploaded in CI release artifacts.
  - New distribution and terms documentation added for storefront and landing preparation.
  - Checkout configuration moved to build-time `VITE_DIALED_CHECKOUT_*` values for live conversion routing.
  - Release signing and verification scripts added (`bun run release:sign`, `bun run release:verify`) and included in the build/release artifact flow.
