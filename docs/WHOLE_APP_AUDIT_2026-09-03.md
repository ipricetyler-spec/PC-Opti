# Dialed whole-app audit — 2026-09-03

This is a **findings record, not a canonical continuity file.** It is not authoritative
over `PROJECT_HANDOFF.md`, `DECISIONS.md`, `VERIFICATION.md`, or `ROADMAP.md`, and it
does not itself approve or authorize any of the fixes it lists — treat every item below
as a reviewed recommendation to evaluate, not a pre-approved change. Nothing in the
underlying reviews edited code, ran a build, installed anything, or mutated any state;
all findings come from three independent read-only passes (product/UX, Windows-systems
correctness/safety, general code health) plus manual reconciliation, run by a Claude
Code session. A rendered version with the same content lives at
https://claude.ai/code/artifact/5ff0d773-41e2-4305-9341-eaf4f853f228 (private; share it
from its page if a viewer without repo access needs it).

Totals: 43 findings — 4 Must, 24 Should, 15 Could — plus 20+ items confirmed already
solid. `bun test`: 360/360. `bun run lint`/`bun run build`: clean. `bun audit
--audit-level=high`: 4 pre-existing high advisories (see Code health Must #1).

Confidence tags: **VERIFIED** (confirmed by reading the code/test directly) ·
**INFERRED** (reasonable from the read, not exhaustively traced) · **UNVERIFIED (test)**
(code path looks correct; only its test coverage is missing) · **BLOCKED** (needs a real
Windows host/live install to settle).

Input Devices, the HIDUSBF driver-lifecycle, and the upstream-package evidence model
were evaluated in the prior 2026-09-03 session (see `PROJECT_HANDOFF.md` and
`docs/HIDUSBF_INTEGRATION.md`) and are intentionally not re-covered here.

## If you only act on six things

1. **Core safety primitives are copy-pasted, not shared.** The single-use preview/token
   pattern is implemented independently four times (a clean generic version in
   `src/main/game-profiles/index.cjs:200-208` that nothing else reuses, plus ad hoc
   copies in `electron/main.cjs:75-83` (nine module-scope variables), `src/main/input-devices/index.cjs:448`,
   and `src/main/input-driver-lifecycle/index.cjs:598`). The Administrator elevation
   check is implemented independently three times (`src/main/journal/index.cjs:1048-1053`,
   `src/main/scanner/index.cjs:821-826`, `src/main/input-devices/native.ps1:90`). All
   copies are currently correct; the risk is a future fix to one not propagating.
2. **The one written invariant that matters most is violated exactly where it matters
   most.** `docs/SAFETY_MODEL.md` states a zero/synthetic value must never substitute
   for unavailable evidence. `metrics.*` scan fields (CPU/memory/storage,
   `src/main/scanner/index.cjs:790-826`) are the one field group exempt from that rule —
   they fall back to a literal `0` on read failure instead of an evidence-tagged
   `UNKNOWN`, unlike every `diagnostics.*` field. Those same fields feed the Drift
   baseline directly (`src/main/drift/index.cjs:34-35`), so a transient failure can
   silently poison a saved baseline or mask a real hardware change.
3. **CI is currently red, permanently, until this is fixed.** `.github/workflows/ci.yml:26`
   runs `bun audit --audit-level=high` with no `continue-on-error` in the single
   required `quality` job. Confirmed locally: exit 1, 4 high advisories in `fast-uri`
   via the `ajv` devDependency. Tests/lint/build all pass. A required check that's
   permanently red trains reviewers to ignore CI.
4. **Consent/confirmation lives only in the renderer, not the trusted process.** The
   network probe and PresentMon capture IPC handlers (`electron/main.cjs:657-663,796-801`)
   take no consent token from main-process code. Separately, five of the highest-stakes
   confirmations (export/delete/import) render raw `JSON.stringify` output inside a
   native `window.confirm()` instead of the app's own styled preview UI
   (`src/App.tsx:997,1026,1057,1078,1106`).
5. **Metadata that already exists isn't reaching the user.** `securityImplications` text
   exists per-capability (`src/main/capabilities/index.cjs:342`) but never renders in
   StartupCenter's disable dialog. EcoQoS's "security processes excluded" claim
   (`src/components/ProcessBalancer.tsx:74`) is broader than the actual
   `PROTECTED_PROCESS_NAMES` list (`src/main/scanner/index.cjs:23-30` — Defender's
   `MsMpEng.exe` isn't in it). Optional-app cleanup matches eligibility on package
   `Name` alone, not publisher (`src/main/optional-apps/index.cjs:181-199`).
6. **No visible keyboard focus, anywhere.** Zero `:focus-visible`/`outline` rules in
   `src/index.css`. 33 sites across 19 components use `outline-none` with only a 1px
   border-color change as the replacement — worst on the `oled` and `graphite` themes.

## Product, UX & accessibility

**Must**
- Five confirmation flows dump raw `JSON.stringify` into native `window.confirm()` —
  `src/App.tsx:997,1026,1057,1078,1106`. Fix: themed scrollable preview panel, or move
  JSON detail behind an existing `<details data-technical-detail>` block.
- No themed focus indicator anywhere — `src/index.css`; 33 `outline-none` sites across
  19 files (e.g. `PlanComposer.tsx:388,392,446,450,458`, `PerformanceLab.tsx:91,95,106,114`).
  Fix: one shared `:focus-visible { outline: 2px solid var(--app-accent); outline-offset: 2px; }` rule.
- Batch optimization run log has no live-region — `src/components/OptimizationCatalog.tsx:150-152`.
  Fix: `aria-live="polite" role="log"` on the log container.

**Should**
- 155 instances of 9–10px default-mode text across 26 files (`PerformanceLab.tsx` ×15,
  `PlanComposer.tsx` ×10, `NetworkQualityLab.tsx` ×11) — promote load-bearing instances
  to ~11px minimum.
- Only `SystemInsightCenters.tsx:74-88` is a real WAI-ARIA tab widget; five other
  sub-tab rows (Optimize/Games/Measure/Verify/Network) are plain button groups — extract
  a shared `TabRow` component.
- "Showing X of Y" counts have no `aria-live` anywhere (11 files, e.g.
  `MaintenanceQueue.tsx:61`, `StartupCenter.tsx:148`).
- Fixture/theme-overflow coverage runs on only 3 of ~30 components
  (`scripts/check-ui-fixtures.cjs` → bios/game-profiles/input-devices only) — broaden or
  correct VERIFICATION.md's wording.
- `PlanComposer` has no subtab of its own; always renders under Optimize → Recommended
  beneath the entire Optimization Catalog (`src/App.tsx:1128`).
- `NetworkQualityLab.tsx:270-273` chart uses hardcoded hex colors instead of theme
  tokens (`src/index.css:293-330`).
- Sidebar's "Active" label is `hidden lg:block` (1024px) while the app's own fixtures
  test at 960px (`Sidebar.tsx:55`).

**Could**: `LocalAuditHistory.tsx:205-240` filter-row layout inconsistency · mobile
sidebar scroll row has no fade affordance (`Sidebar.tsx:38`) · no skip-to-content link.

**Already solid**: preview→confirm→verify→rollback discipline (Maintenance/SafePolicies/
GameOptimization/PerformanceLab) · consistent empty/loading/error states · eight themes
are a genuine CSS custom-property system (`src/index.css:293-362`) · `SystemInsightCenters.tsx`
is a model accessible tab widget.

## Windows systems correctness & safety

### Game profiles, config & BIOS guidance
- **Must (BLOCKED, needs hardware):** ARC Raiders' process match is exact-anchored
  (`/^pioneergame$/i`, `src/main/game-profiles/index.cjs:63`) unlike Fortnite/Valorant's
  deliberate prefix-match (`:58`) — the same author's other UE-style titles. If the real
  process carries a `-Win64-Shipping.exe` suffix, the "game closed" guard would
  misreport a live game as closed, allowing a config write while it's running. Verify
  the real process name on a live install; loosen the pattern if needed.
- **Should:** COD config backup can be created but never restored — guide id has no
  matching `GAME_PROCESSES` entry (`src/main/game-config/index.cjs:82-86` vs.
  `src/main/game-profiles/index.cjs:57-67`), so restore always throws. Fails closed
  correctly; just silently unusable.
- **Could:** backup creation isn't atomic against a crash between staged files and the
  manifest write (`src/main/game-config/index.cjs:320-357`) — orphaned dir, no data loss.
- **Solid:** BIOS guidance confirmed 100% read-only; hardware matching requires exact
  CPU+chipset match and fails closed on 8 distinct unknown-hardware cases; failure-path
  test coverage (interrupted writes, drift, tampered manifests) is genuinely thorough.

### Optional-app cleanup & verified updater
- **Should:** eligibility decided by bare package `Name`, never publisher/signer
  (`src/main/optional-apps/index.cjs:181-199`) — actual removal re-validates
  `packageFullName` so the wrong package is never removed, but the wrong trust framing
  could be shown first.
- **Should (UNVERIFIED test):** updater's six tamper-detection failure branches
  (`src/main/updater/index.cjs:306-317`, `verifyInstallerFile`) have no dedicated tests
  — only the all-valid happy path is exercised.
- **Solid:** removal is current-user-only, one-at-a-time, triple-revalidated; publisher
  trust re-checked independently (not cached) before every feed/download/launch step
  (5 independent signature reads, test-confirmed); no background/silent update activity.

### Network probe & PresentMon capture
- **Should:** consent for both surfaces enforced only in the renderer
  (`electron/main.cjs:657-663,796-801`) — no main-process consent token.
- **Should (UNVERIFIED test):** PresentMon's SHA-256-mismatch/missing-binary paths
  (`src/main/presentmon/index.cjs:127-159`) aren't exercised by a real fixture.
- **Could:** `readCaptureManifests` slices to `MAX_CAPTURE_COUNT` before sorting —
  ordering edge case under out-of-band tampering only.
- **Solid:** PresentMon binary provenance independently re-verified (SHA-256/size
  recomputed and matched); SSRF guard layered and effective (though currently
  unreachable — endpoint is hardcoded); no input-latency/rated-speed claims found
  anywhere; no injection/elevation/attach-beyond-target path in capture.

### Recommendations, ProcessBalancer/EcoQoS & StartupCenter
- **Should:** EcoQoS's "security processes excluded" claim (`ProcessBalancer.tsx:74`)
  is broader than `PROTECTED_PROCESS_NAMES` (`src/main/scanner/index.cjs:23-30`) —
  `MsMpEng.exe`/`NisSrv.exe` aren't excluded.
- **Should:** StartupCenter never renders the existing `securityImplications` capability
  text (`src/main/capabilities/index.cjs:342`) in its disable confirmation
  (`src/App.tsx:887-889`) — pure surfacing fix, data already exists.
- **Could:** `applicability` field in recommendations is a hardcoded constant, never
  computed (`src/main/recommendations/index.cjs:65`) · no test for "disable then
  external re-add" reconciliation scenario.
- **Solid:** recommendations engine is genuinely deterministic, no fabrication;
  `OPTIONAL_ACTION` never auto-applies (3 independent layers); EcoQoS apply/rollback
  re-reads identity and flag state on both ends; machine-wide startup fails closed on
  missing elevation before any Registry read (zero-reads/zero-writes tested).

### Timing (BCD) & capability elevation gating
- **Should:** `src/main/capabilities/index.cjs:1053-1064` — docs call it "the
  executable source of truth" (`docs/SAFETY_MODEL.md:3`) but it only gates runtime-
  profile visibility, not elevation. No systematic test ties every Administrator-tagged
  capability to an enforced elevation check.
- **Should:** elevation check reimplemented 3× — canonical `journal/index.cjs:1048-1053`
  (reused 5×), separate copy in `scanner/index.cjs:821-826`, third copy embedded in
  `src/main/input-devices/native.ps1:90` (this one gates real mutations).
- **Could:** `docs/SAFETY_MODEL.md:9` says packaged default is "Owner's Edition";
  `package.json:71` ships `"public"` — doc drift only.
- **Solid:** BCD mutation contract fully implemented as documented (elevation → export
  +hash backup → PENDING → literal readback comparison → conflict-refusing rollback);
  no immediate-effect claims anywhere (always `PENDING_REBOOT`/`UNVERIFIED`); runtime
  profile resolution independently re-verified as un-overridable in a packaged build.

### Maintenance, Journal, Snapshot & Drift — the shared rollback contract
- **Should:** scan `metrics.*` substitutes a fabricated `0` instead of an
  evidence-tagged unavailable state — see priority #2 above.
- **Should:** EcoQoS rollback (`src/main/journal/index.cjs:1488-1527`) is the one
  restore path that doesn't verify pre-restore state matches what Dialed applied before
  writing, unlike registry/policy/timing rollback (`:776-780,1143-1148,1443-1446`).
- **Should (UNVERIFIED test):** registry/policy rollback's diverge-refusal logic
  (`:776-806,1143-1160`) has zero direct unit coverage — only ever mocked whole in tests.
- **Could:** `clear-temp-files`/`retrim-drive` (`:1622-1671`) skip an independent
  post-mutation readback that every other action family performs.
- **Solid:** journal corruption/recovery engine is the strongest-tested part of the
  codebase relative to its contract (byte/hash-verified preserved copies, symlink and
  oversized-file refusal, fsynced exclusive-create resets); interrupted-operation
  reconciliation never assumes success; scanner performs no incidental mutation; no
  renderer-supplied path/command/registry-target reaches a privileged operation anywhere
  in this call graph.

## Code health & architecture

**Must**
- Required CI gate fails on every push — `.github/workflows/ci.yml:26`
  (`bun audit --audit-level=high`, no `continue-on-error`). Fix: bump `ajv`
  (devDependency-only, used only by the parked `native/dialed-input-filter/` validator),
  or move the audit to its own step with `continue-on-error: true` + tracked issue.
- `tsconfig.json` sets no strictness flags at all — no `strict`/`noImplicitAny`/
  `strictNullChecks`. Mitigating: `any` usage is already near-zero, non-null assertions
  are zero, so the resulting backlog from enabling `strictNullChecks`+`noImplicitAny`
  should be tractable.
- Preview/token pattern reimplemented 4×  — see priority #1 above. Fix: hoist
  `createPreviewStore` (`src/main/game-profiles/index.cjs:200-208`) into shared
  infrastructure and migrate the other three onto it.

**Should**
- Dead monetization slice (`src/main/license/index.cjs`, `src/components/ConsumerUpgradeCenter.tsx`,
  `src/lib/consumerMonetization.ts`) — confirmed unreachable from anywhere else in the
  repo, zero tests, skips the atomic-write/symlink-defense conventions every other
  stateful module uses, and hardcodes real-looking activation codes
  (`license/index.cjs:12-15`: `PCOPTI-PRO-LIFE`, `PCOPTI-PRO-ANNUAL`) in a public repo.
  Move to a clearly-labeled parked location (mirroring `native/dialed-input-filter/`) or
  bring up to house conventions before ever wiring it up.
- input-devices IPC handlers (`electron/main.cjs:168-207`) skip the boundary-layer
  validation the adjacent driver-lifecycle handlers use (`:132-166`) — not currently
  exploitable (internal re-validation fails safe) but no boundary-layer backstop.
- `CONTRIBUTING.md:7-14`'s documented local gate (`bun test && bun run lint && bun run build`)
  is narrower than what `VERIFICATION.md:128-144` treats as required
  (`check:clean-room-parity`, `test:ui:fixtures`, audit) — none of which CI runs either.
- `scripts/check-clean-room-parity.cjs:6-9` scans a hardcoded 2-file allowlist rather
  than deriving it from `src/main/`'s actual module list — no live gap today, future risk.
- Likely-unused dependency `autoprefixer` (`package.json:12`) — Tailwind v4 runs
  entirely through `@tailwindcss/vite`.

**Could**: 6 embedded-PowerShell empty `catch {}` blocks without the explanatory
comment the rest of the codebase gives every other one (`journal/index.cjs:1040,1107`,
`maintenance/index.cjs:61`, `presentmon/index.cjs:35`, `scanner/index.cjs:147,713`) ·
validation strictness intentionally varies by trust boundary but the rationale is
undocumented.

**Already solid**: Electron hardening correct everywhere (`nodeIntegration:false`,
`contextIsolation:true`, `sandbox:true`, exactly one `BrowserWindow`) · TypeScript
discipline already good despite missing `strict` flag · every `src/main/*` module has
test coverage except the confirmed-dead `license` module · type assertions are narrow
and component-local, no broad escape hatches.
