# Hardware-matched BIOS plan

Implemented in the 2.7.0 source candidate on 2026-08-27. Open **Optimize → My BIOS plan**. Existing Windows optimizations, nine workspaces and eight themes remain available.

## Using it

1. Open the BIOS plan to read CPU, motherboard/revision, BIOS version/date, RAM part numbers/population/reported configured speed and GPU model names locally.
2. Review the relevant checks. Expand a card for compatibility prerequisites, menu hints, steps, verification, recovery and first-party sources. Advanced CPU tuning is opt-in.
3. Record the previous setting. Save the text plan somewhere accessible while Windows is closed, complete one manual change at a time, and record your testing outcome afterward.

Progress labels are user notes, not verified BIOS state. Notes persist locally across restarts and reported memory-speed changes; a hardware or BIOS identity change uses a new note set. The downloadable text contains hardware model names and the notes the user entered. Neither the app nor the export collects serial numbers or recovery keys. No data goes to an AI service.

## Database coverage

Eight independently written recommendation recipes:

- AM5 DDR5 EXPO and AM4 DDR4 XMP-derived memory profiles.
- Intel XMP on reviewed 12th/13th/14th-generation and Core Ultra 200 desktop platforms.
- Standard Ryzen boost and Intel 13th/14th-generation desktop stability-baseline review.
- GeForce Resizable BAR and Radeon Smart Access Memory compatibility checks.
- Optional supported Ryzen PBO / Curve Optimizer investigation, with individual validation rather than universal offsets.

Matching requires a recognized CPU family, motherboard chipset, supported board vendor and desktop form factor. Memory recipes additionally require consistent DDR generation; GPU recipes check GPU family and platform restrictions. ASUS, MSI, GIGABYTE and ASRock have reviewed vendor guidance. Exact support links currently cover TUF GAMING X870-PLUS WIFI, MAG X670E TOMAHAWK WIFI, B650 Steel Legend WiFi and B650 AORUS ELITE AX (separate known 1.0/1.1 and 1.2 revisions). Similar model suffixes and uncertain revisions do not select an exact link.

These are **hardware-family candidates**, not a database of bench-tested exact CPU/board/BIOS/RAM combinations. Current profiles, voltages, offsets, cooling, boot mode, encryption status and enabled Resizable BAR state are not read. Part numbers do not prove a matched RAM kit or QVL approval. Unsupported/OEM/mobile systems receive inventory and an explanation, not a guessed desktop preset.

## Implementation and extending coverage

- [Catalog](../src/main/bios-guidance/catalog.cjs): immutable recipes, source links, vendor hints, exact model support records and review dates.
- [Matcher and inventory](../src/main/bios-guidance/index.cjs): fixed read-only CIM query; 30-second timeout; bounded/normalized results and explicit component errors. No renderer-supplied query parameters.
- [UI](../src/components/BiosGuidanceCenter.tsx): loaded only on demand, explicit notes and portable plan; existing Windows runner remains mounted when switching subviews.
- `bios:hardware-guidance` is available in public, consumer-premium and owner profiles. Main process coalesces overlapping read requests.

To add a recipe, review first-party documentation, define positive and negative matching criteria, record prerequisites, tradeoffs, validation and recovery, and add fixture cases for nearby unsupported combinations. Add exact board links only with conservative name/revision matching. Do not infer voltages/timings from a model string, silently turn a source claim into measured benefit, or add automatic firmware execution. Sources were reviewed on 2026-08-27, with review due on 2027-02-23. An overdue review or uncertain clock displays a prominent current-documentation warning; it does not delete the user's reference guides or notes.

## Verification and remaining gates

- Full Bun suite: 141 passing tests, including 32 BIOS cases. TypeScript, production renderer build, clean-room parity and syntax checks pass.
- Browser fixture harness: `scripts/check-bios-ui.cjs`; existing Playwright installation supplied through `DIALED_PLAYWRIGHT_PATH`, local Vite server at `127.0.0.1:5178`. No Windows actions are invoked by this harness.
- Browser acceptance: all eight themes at 960 and 1280 pixels without document overflow; six sections preserved; notes survive reload; text download includes recovery/sources/notes; unsupported and error paths show no inferred tuning cards; no page errors. Evidence: `output/playwright/bios-ui-acceptance.json` and `bios-plan-carbon-gold-960.png`.
- Read-only native inventory was exercised on the owner's Ryzen 7 9800X3D / ASUS TUF GAMING X870-PLUS WIFI desktop. Two RAM modules were detected; four guidance candidates matched with no inventory errors. The sandbox denial path was also observed and correctly returned unknown inventory without recommendations.
- No firmware setting, reboot, driver, security option, game file or unrelated installation was changed. No performance gain or manual BIOS recovery was tested.
- This is not packaged Electron acceptance: the 2.7.0 installer still needs packaging, authorized signing, signature verification and installed-upgrade checks. No signing transaction was used for this feature.

## 2026-09-05 additions

The 13-recipe catalog adds cooling, exact-model thermal limits, stock scheduling and
PCIe troubleshooting. 7800X3D (89 C) and 9800X3D (95 C) specifications are distinct;
they are not instructions to raise thermal limits. Observations, suggested checks and
user-confirmed notes remain separate, with normal-mode claim limits.
