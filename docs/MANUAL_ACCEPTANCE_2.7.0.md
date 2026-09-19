# Dialed 2.7.0 — manual acceptance when back at the PC

Status: **NOT RUN**. Automated work used fixture files only. No owner game configuration, Windows setting, firmware or unrelated installed-software state was changed.

Available artifact: `output/private-candidate-2.7.0-20260827/Dialed 2.7.0.exe` — unsigned portable, SHA-256 `b0e30a9e568a121171ca9301a8e79f098ba86039d10c8c4a65702f4ace7851cd`. Both executable signatures are `NotSigned`; 29 packaged runtime/dist files match source. There is **no completed setup installer**: Smart App Control blocked the unsigned NSIS build helper. The failed helper is retained as `FAILED-UNINSTALLER-BUILD-STUB.bin`, not a usable installer. Do not bypass Windows policy if it blocks this portable too. See the adjacent `CANDIDATE_MANIFEST.json` for exact package evidence and remaining gates.

## Before starting

- Use only the exact current 2.7.0 candidate identified by its artifact manifest. Older 2.6.0/2.6.1 builds do not include these features.
- The local candidate is unsigned and not installed. Signing requires a separate approved exact-payload run; do not disable Windows security or bypass application-control policy if unsigned execution is blocked. A final rebuild/signing pass must follow source acceptance and any repairs.
- Do not test performance remotely. Keep current settings recorded; close games and their launchers before file changes, and avoid cloud-sync activity during Apply/Restore.
- This checklist does not ask you to change BIOS settings, timing/BCD, services, drivers or networking. BIOS acceptance below is read-only.

## 1. Installed build and interface

- [ ] After the authorized install/upgrade, Settings reports the expected version and actual signature status. Confirm shortcuts and installed-product identity; no unwanted duplicate Dialed/PC-Opti installation. Preserve existing user data. Do not touch unrelated installed software.
- [ ] Home, Scan, Optimize, Game & Network, Verify and Settings all open without errors. Scan/diagnostics work through native Electron, not just browser fixtures.
- [ ] All eight themes render cleanly at minimum window width and your normal DPI scaling; changing theme persists after restart. Long paths stay inside cards.
- [ ] Existing Windows optimization selection/log/individual controls, workload profiles, local history, benchmark tools and eight game guides remain present. Do not execute unrelated tweaks just to check visibility.
- [ ] Optimize → My BIOS plan detects the expected board/CPU/RAM/GPU, shows manual steps and recovery guidance, retains a previous-setting note after restart, and exports a readable plan. There must be no firmware Apply or reboot action.

## 2. Test one game profile at a time

Record game version, launcher, GPU driver, test date and original video settings. Use the same safe practice/offline scenario for before/after checks; do not test in a competitive match.

1. Launch the game normally once and record its current settings. Exit the game and launcher.
2. In Game & Network, choose Preview Fortnite, Preview Rocket League, Preview VALORANT or Preview ARC Raiders. Confirm the correct file and exact changes. Cancel once: nothing should change and no backup should be created by preview alone.
3. Preview again, then Back up & apply. Expect an operation log and **Applied — file verified**, plus a persistent local backup. There must be no claim that FPS or game acceptance was verified.
4. Start the game. Check whether the intended settings actually changed and remained saved. Other settings, resolution, controls and rendering mode should remain unchanged. Record warnings, launch issues or cloud-sync overwrite behavior. Exit the game again.
5. Preview restoring this backup. Check the target and overwrite warning, confirm, then verify the original settings return. Restore replaces the **whole file** and may overwrite settings changed since backup. Its overwritten state is retained in recovery evidence.
6. Restart Dialed. The backup should still appear, and any interrupted operation should be flagged instead of silently reported as success.

| Case | Expected | Result |
| --- | --- | --- |
| Fortnite | Shadows, post-processing and effects at Low; other options preserved; exact restore works | NOT RUN |
| Rocket League | Motion blur and dynamic shadows off if current schema supports these keys; other options preserved; exact restore works | NOT RUN |
| VALORANT | Shadows, post-processing and effects groups at Low; resolution, textures, anti-aliasing, controls and networking preserved; exact restore works | NOT RUN |
| ARC Raiders | Shadows, post-processing and effects groups at Low; resolution, textures, view distance, anti-aliasing, upscaling, controls and networking preserved; exact restore works | NOT RUN |
| Already matching | Nothing to apply; Apply disabled; no redundant backup | NOT RUN |
| Game running | Preview/Apply/Restore refuses without editing configuration | NOT RUN |
| Unsupported/missing/read-only configuration | Explicit error; no invented config, no attribute changes | NOT RUN |
| Setting edited after preview | Apply refuses; new preview required | NOT RUN |

Rocket League's key mapping is still a candidate, not publisher-certified. VALORANT's and ARC Raiders' keys were observed in current local files and have engine documentation, but neither publisher has certified direct INI editing or the result. If any game ignores or rewrites a setting, keep the evidence and mark the recipe **not accepted**; do not advertise the recipe as working merely because a hash matched. Do not deliberately crash the app or cut power on your primary PC to test recovery.

## 3. Performance and release decision

- [ ] If evaluating benefit, collect repeated baseline and candidate runs with identical conditions; compare frame times and lows, not only a single peak FPS. Use Verify to keep evidence. Restore if visual tradeoffs or stability are unacceptable. No meaningful difference is a valid result.
- [ ] Record issues with screenshot, exact game/app version, preview changes and whether restore worked. Avoid publishing raw local paths or private config content.
- [ ] Accept or reject each recipe independently. Keep all unrelated working features. Resolve failures before public distribution.
- [ ] Final exact artifact signing, signature/hash verification, installer/upgrade/uninstall/data-retention acceptance, license/notice review and explicit publication approval remain separate release gates.

Next engineering action after these results: repair any observed mismatch, then one authorized sign/verify/install cycle for the accepted source. Billing remains deferred; permanent full owner access and introductory pricing remain the established plan.
