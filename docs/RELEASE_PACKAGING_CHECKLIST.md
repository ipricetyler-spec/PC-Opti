# Release packaging checklist

What's already built and known about getting a signed, packaged Dialed build ready,
gathered in one place so a packaging session can work from a checklist instead of
re-deriving it. This is scoped to signing, the installer, Electron fuses, and the
hardware/Windows matrix — it does not replace the legal, privacy, and commerce items in
[docs/PUBLIC_RELEASE_CHECKLIST.md](PUBLIC_RELEASE_CHECKLIST.md), and it is not a
substitute for the owner's own sign-off.

## Signing

`scripts/windows-signing.cjs` supports two signing paths, both invoked through
`scripts/electron-builder-sign.cjs` during `electron-builder` packaging. The Azure Trusted
Signing path is configured and working; the local PFX path remains unused.

**Done on 2026-09-20: the app is signed with Azure Trusted Signing.** Publisher
`CN=Tyler Price, O=Tyler Price, L=Lewisburg, S=tn, C=US`, from the PublicTrust profile
`gpc-owner-beta-publictrust` on account `gpcownersign260808`. Working invocation:

```
$env:PATH = "C:\Program Files\Microsoft SDKs\Azure\CLI2\wbin;" + $env:PATH
$env:DIALED_ENABLE_SIGNING = "true"
$env:DIALED_SIGNING_REQUIRED = "true"
$env:DIALED_ARTIFACT_SIGNING_ENDPOINT = "https://eus.codesigning.azure.net/"
$env:DIALED_ARTIFACT_SIGNING_ACCOUNT = "gpcownersign260808"
$env:DIALED_ARTIFACT_SIGNING_PROFILE = "gpc-owner-beta-publictrust"
$env:DIALED_ARTIFACT_SIGNING_EXCLUDE_CREDENTIALS = "SharedTokenCacheCredential"
npx --no-install electron-builder --win nsis portable
```

Three things that cost an hour and will again if forgotten:

1. **`ExcludeCredentials` is mandatory here.** The signing library walks Azure's default
   credential chain, whose first entry, `SharedTokenCacheCredential`, throws
   "Windows Data Protection API (DPAPI) is not supported on this platform" and aborts the
   whole chain before reaching the Azure CLI login. Excluding it is what makes signing work.
2. **`az` must be on PATH in the Windows sense.** Git Bash paths (`/c/Program Files/...`) are
   not resolvable by signtool's child process, and a freshly installed CLI is not on PATH in
   already-open shells. Run the signed build from PowerShell with the wbin directory prepended.
3. **Sign in to the right tenant**: `az login --tenant itachiuchiha136yahoo.onmicrosoft.com`.
   A plain `az login` landed in a tenant with no subscriptions.

Certificates from this profile are short-lived (about three days), which is normal for Trusted
Signing: every artifact is timestamped, so signatures remain valid after the certificate expires.

- [x] Choose a path and set `DIALED_ENABLE_SIGNING=true`. In CI, also set
      `DIALED_SIGNING_REQUIRED=true` so a misconfigured run fails instead of quietly
      producing an unsigned artifact.
- [x] **Azure Trusted Signing** ("Artifact Signing"): set `DIALED_ARTIFACT_SIGNING_ENDPOINT`,
      `DIALED_ARTIFACT_SIGNING_ACCOUNT`, and `DIALED_ARTIFACT_SIGNING_PROFILE` (or point
      `DIALED_ARTIFACT_SIGNING_METADATA_PATH` at a prepared metadata JSON file instead),
      and make sure the Azure Code Signing client library is present — the default path is
      `%LOCALAPPDATA%\Microsoft\MicrosoftArtifactSigningClientTools\Azure.CodeSigning.Dlib.dll`,
      overridable with `DIALED_ARTIFACT_SIGNING_DLIB_PATH`.
- [–] **Local PFX** (the alternative path): not used and not needed, now that Azure Trusted
      Signing works. Kept in the code for a future deployment that has a PFX instead. If it is
      ever used, `DIALED_CODESIGN_PFX_PATH` and `DIALED_CODESIGN_PFX_PASSWORD` must point
      outside the repository and outside any cloud-synced folder.
- [x] Confirm `signtool.exe` resolves — either set `DIALED_CODESIGN_TOOL_PATH` explicitly,
      or confirm a Windows 10 SDK is installed so the script finds it under
      `%ProgramFiles(x86)%\Windows Kits\10\bin`.
- [x] Build, sign, and then **independently** verify the signature and timestamp on all
      three artifacts electron-builder produces — the NSIS installer, the portable
      executable, and the unpacked app — not just that the build exited 0. Done 2026-09-20:
      installer, portable, unpacked app, both HIDUSBF helpers and `elevate.exe` all report
      `Valid`, signed by Tyler Price and timestamped by Microsoft's Public RSA Time Stamping
      Authority. PresentMon keeps Intel's own signature. `verify-private-candidate.cjs` now
      understands signed candidates and reports `SIGNED_PORTABLE_CANDIDATE`.
- [~] The installer's own TOCTOU protection (verified file renamed to a random name,
      re-verified, then launched — `src/main/updater/index.cjs`). Partly exercised on
      2026-09-20 against the real signed installer: `readAuthenticode` reports `Valid` with the
      right subject, thumbprint and Microsoft timestamp; `verifyInstallerFile` returns `VALID`
      for the matching publisher and refuses a different thumbprint with the expected message.
      The rename-and-launch half is still unexercised, because exercising it means running an
      installer.
- [x] **Certificate rotation is handled (2026-09-20).** The updater used to demand an exact
      SHA-1 thumbprint pinned at build time, which is incompatible with Trusted Signing: this
      account's certificates expire about three days after issue, so the pin would have refused
      every future release, with a message that reads like an attack rather than a rotation.

      The expected thumbprint now travels **per release inside the update manifest**, which
      Dialed signs with its own Ed25519 key and verifies before reading. So the release states
      which certificate signed it, and rotation is normal rather than suspicious. What did not
      change: the publisher **name** is still pinned at build time, the manifest signature is
      still required, a manifest that states no usable thumbprint is refused, and a build-time
      pinned thumbprint — for a deployment using one long-lived certificate — is still enforced
      when set. The running executable is now held to the pinned name plus a valid, timestamped
      signature, because its own certificate has usually rotated by the time an update appears.

      `scripts/generate-update-feed.cjs` records the certificate that actually signed the
      installer instead of copying the pinned value.

- [ ] `package.json` → `dialed.update` is still empty, now only for want of published
      infrastructure: the feed URL, the allowed installer hosts and the Ed25519 manifest key
      pair. `publisherSubject` is known — `CN=Tyler Price, O=Tyler Price, L=Lewisburg, S=tn,
      C=US` — and `publisherThumbprint` should be left empty on purpose.

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

- [x] **Verified on a real signed build (2026-09-20).** The installer ran per-machine into
      `C:\Program Files\Dialed` with no prompt to change the directory. UAC showed
      "Verified publisher: Tyler Price" for both the installer and the installed
      `Dialed.exe`; the certificate is issued by "Microsoft ID Verified CS EOC CA 03".
      **Smart App Control logged nothing at all** — no Code Integrity events during the whole
      install, where the unsigned build had blocked the uninstaller twice. The installed
      uninstaller is itself `Valid / Tyler Price`. No SmartScreen prompt appeared, which is
      better than expected for a certificate with no reputation history.
- [~] Install, upgrade and uninstall. Done on 2026-09-20 for a same-version upgrade over an
      older 2.8.0 build and for uninstall: the install landed in `C:\Program Files\Dialed`,
      uninstall removed it, and the protected data folder correctly survived. **Still unchecked:**
      leftover registry keys and shortcuts after uninstall, a true clean install on a machine
      with no previous Dialed, and a version-bump upgrade (needs a version other than 2.8.0).
- [ ] **The portable target is still weak.** It unpacks to a predictable path under
      `%TEMP%` while running elevated, and no NSIS-style directory permission fixes a temp
      extraction. Decide whether to keep shipping it as-is, constrain what it can do until
      it's unpacked somewhere safe, or drop it. `scripts/verify-private-candidate.cjs`
      currently expects a portable artifact in five places — dropping it means updating
      that script too, not just the `build.win.target` list.
- [x] Confirmed 2026-09-20. Both the installer and the installed `Dialed.exe` produced a UAC
      prompt reading "Verified publisher: Tyler Price". The portable executable's prompt has not
      been exercised separately.

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
- [~] Partly confirmed. The packaged app starts with the fuses on, and the input activity
      check ran from the installed copy on 2026-09-19 — which means the native input path and its
      `extraResources` load correctly under `onlyLoadAppFromAsar`. **Still unchecked:** PresentMon
      capture, the HIDUSBF broker/host handshake, and the protected change-log folder, all from a
      packaged signed build.
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
