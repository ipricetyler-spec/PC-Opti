# Release packaging checklist

What's already built and known about getting a signed, packaged Dialed build ready,
gathered in one place so a packaging session can work from a checklist instead of
re-deriving it. This is scoped to signing, the installer, Electron fuses, and the
hardware/Windows matrix — it does not replace the legal, privacy, and commerce items in
[docs/PUBLIC_RELEASE_CHECKLIST.md](PUBLIC_RELEASE_CHECKLIST.md), and it is not a
substitute for the owner's own sign-off.

## Signing

`scripts/windows-signing.cjs` supports two signing paths, both invoked through
`scripts/electron-builder-sign.cjs` during `electron-builder` packaging. Neither is
configured yet — packaged builds today are intentionally unsigned.

- [ ] Choose a path and set `DIALED_ENABLE_SIGNING=true`. In CI, also set
      `DIALED_SIGNING_REQUIRED=true` so a misconfigured run fails instead of quietly
      producing an unsigned artifact.
- [ ] **Azure Trusted Signing** ("Artifact Signing"): set `DIALED_ARTIFACT_SIGNING_ENDPOINT`,
      `DIALED_ARTIFACT_SIGNING_ACCOUNT`, and `DIALED_ARTIFACT_SIGNING_PROFILE` (or point
      `DIALED_ARTIFACT_SIGNING_METADATA_PATH` at a prepared metadata JSON file instead),
      and make sure the Azure Code Signing client library is present — the default path is
      `%LOCALAPPDATA%\Microsoft\MicrosoftArtifactSigningClientTools\Azure.CodeSigning.Dlib.dll`,
      overridable with `DIALED_ARTIFACT_SIGNING_DLIB_PATH`.
- [ ] **Local PFX** (the alternative path): set `DIALED_CODESIGN_PFX_PATH` and
      `DIALED_CODESIGN_PFX_PASSWORD`. Both must point outside the repository and outside
      any cloud-synced folder.
- [ ] Confirm `signtool.exe` resolves — either set `DIALED_CODESIGN_TOOL_PATH` explicitly,
      or confirm a Windows 10 SDK is installed so the script finds it under
      `%ProgramFiles(x86)%\Windows Kits\10\bin`.
- [ ] Build, sign, and then **independently** verify the signature and timestamp on all
      three artifacts electron-builder produces — the NSIS installer, the portable
      executable, and the unpacked app — not just that the build exited 0.
- [ ] The installer's own TOCTOU protection (verified file renamed to a random name,
      re-verified, then launched — `src/main/updater/index.cjs`) is implemented and
      covered by fixture tests, but has never run against a real signed installer.
      Exercise it once a signed build exists.
- [ ] Leave `package.json` → `dialed.update` (feed URL, allowed installer hosts, Ed25519
      manifest key, exact Authenticode publisher subject/thumbprint) empty until the
      signing certificate is final — see [Verified updates](VERIFIED_UPDATES.md) for the
      full order of operations. Populating them early would pin a false identity that a
      later certificate change can't easily undo.

## Installer

A full unsigned packaging run was done on 2026-09-19: `electron-builder --win nsis portable`
produced the NSIS installer, the portable executable and the unpacked app, and
`scripts/verify-private-candidate.cjs dist-electron` passed over them. Nothing was installed
or launched — everything below about install, upgrade and uninstall behaviour is still open.

That run also found and fixed two things: the app archive had picked up a `node_modules`
copy of the four font packages (they are bundled into `dist` by Vite at build time, so they
are development dependencies now, and the archive dropped from 767 entries to 190), and the
verifier's pinned list of packaged input-framework files predated
`release-policy-contract.cjs`.

`package.json` → `build.nsis` is already configured per-machine, with a fixed install
directory:

```json
"nsis": {
  "oneClick": false,
  "perMachine": true,
  "selectPerMachineByDefault": true,
  "allowToChangeInstallationDirectory": false,
  ...
}
```

This closed the earlier finding that an always-elevated app could install to a
user-writable, user-chosen directory. What's still open:

- [ ] **Not yet verified on a real build.** The per-machine change is reasoned from
      electron-builder's NSIS templates, not from an observed install — run it on a real
      machine and confirm the install actually lands per-machine, in the fixed directory,
      with no prompt to change it.
- [ ] Verify install, upgrade (same version and a version bump), and uninstall leave no
      orphaned files, registry keys, shortcuts, or protected-data folder in an
      inconsistent state.
- [ ] **The portable target is still weak.** It unpacks to a predictable path under
      `%TEMP%` while running elevated, and no NSIS-style directory permission fixes a temp
      extraction. Decide whether to keep shipping it as-is, constrain what it can do until
      it's unpacked somewhere safe, or drop it. `scripts/verify-private-candidate.cjs`
      currently expects a portable artifact in five places — dropping it means updating
      that script too, not just the `build.win.target` list.
- [ ] Confirm `requestedExecutionLevel: requireAdministrator` (set on both `build.win` and
      `build.portable`) still produces the expected UAC prompt on a machine that isn't
      already running elevated — the every-day dev loop runs elevated already and won't
      catch a regression here.

## Electron fuses

`package.json` → `build.electronFuses` is set:

```json
"electronFuses": {
  "runAsNode": false,
  "enableCookieEncryption": true,
  "enableNodeOptionsEnvironmentVariable": false,
  "enableNodeCliInspectArguments": false,
  "enableEmbeddedAsarIntegrityValidation": true,
  "onlyLoadAppFromAsar": true
}
```

- [x] **Verified in a packaged build (2026-09-19).** The fuse wire was read back out of
      `dist-electron/win-unpacked/Dialed.exe` with `@electron/fuses`: RunAsNode off,
      cookie encryption on, `NODE_OPTIONS` off, CLI inspect arguments off, embedded asar
      integrity validation on, and `onlyLoadAppFromAsar` on — all six as configured.
      (`GrantFileProtocolExtraPrivileges` is left at Electron's default, on.) Re-check this
      after any Electron upgrade; the config key alone never proves the fuse was set.
- [ ] Confirm the packaged app still starts and every native capability still works with
      the fuses on. `onlyLoadAppFromAsar` in particular can break anything that expects to
      read a file next to the app outside the asar — check `extraResources` (HIDUSBF
      native helpers, PresentMon, the `.env`-free config) still load correctly.
- [ ] Decide whether a startup self-integrity check over the asar is still worth adding on
      top of `enableEmbeddedAsarIntegrityValidation`, and if not, record that decision here
      so it isn't re-opened as an unexplained gap later.

## Kernel code

- Dialed never ships its own kernel driver or a generic hardware-access driver (for example
  WinRing0 or a similar direct MSR/PCI-register-read driver), and never loads unsigned code.
  It may use a vendor's own signed driver that the user separately installed (for example
  HIDUSBF) — never a bundled, patched, or resigned copy of one.

## Hardware and Windows matrix

Everything below has been exercised on exactly one desktop, one edition of Windows, in
English, with one NVIDIA GPU. None of this is a defect in what's shipped — it's untested
territory.

No other hardware is available for testing before release. So the release notes must say
which setups were tested, that other compatible hardware is expected to work but is
untested, and how to undo and recover. Early user reports (device, USB controller,
Windows build, result) stand in for a test matrix; the items below are what to watch in
those reports.

- [ ] Owner approves the exact supported Windows versions/editions. Policy controls (background
      apps, driver-update exclusion, no-auto-restart, Windows consumer features) are
      edition-checked against Home/Pro/Enterprise/Education today, but only Home has
      actually been read on a real machine.
- [ ] Non-English Windows. Several read-only checks parse PowerShell/WMI string output —
      the Windows edition name, BIOS/board manufacturer strings, drive health status — and
      have only been exercised against English strings.
- [ ] Switchable-graphics laptops, and desktops with multiple or identical NVIDIA GPUs.
      The GPU-to-monitor association logic, the NVML sensor matching, and the BIOS
      guidance catalog's hardware classification have only been verified against a single
      desktop NVIDIA GPU.
- [ ] AMD and Intel GPU sensors, and CPU temperature, are not implemented. NVML (NVIDIA
      only) is the only live-sensor path today; there is no clean read-only equivalent for
      AMD or Intel identified yet. Scope this before promising sensor coverage anywhere
      public-facing.
      AMD Ryzen Master Monitoring SDK was evaluated and tabled. Its EULA requires every
      user to accept AMD's terms, treats the SDK as AMD confidential (never in the public
      repo), and grants use "for evaluating"; revisit only with written permission from AMD.
- [ ] Older NVIDIA drivers. The NVML read path loads the driver-installed library at its
      fixed System32 path; it has only been checked against the current driver branch.
- [ ] A packaged, elevated run on a machine other than the one Dialed was built on. Every
      automated check so far (Node/Bun test suites, the walkthrough and acceptance
      scripts) runs against fixtures or an unpackaged dev build on the same machine.
