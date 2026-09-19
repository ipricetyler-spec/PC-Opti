# Verified update release procedure

Dialed’s updater is implemented but intentionally UNCONFIGURED. It performs no
background check and offers no fallback URL. Do not enable it until the exact
release channel and final Windows signing identity are approved.

## Public trust values required from the owner

Populate package.json under dialed.update only after the final publisher
certificate is known:

- channel: stable;
- feedUrl: one direct HTTPS URL returning HTTP 200 without redirects;
- allowedInstallerHosts: exact direct-download HTTPS host(s);
- manifestKeyId: a stable non-secret identifier for the Ed25519 public key;
- manifestPublicKeySpkiBase64: base64 DER/SPKI Ed25519 public key;
- publisherSubject: exact Windows Authenticode certificate subject;
- publisherThumbprint: exact 40-hex certificate thumbprint.

These values are public trust anchors and belong in source. Certificate rotation,
feed migration or manifest-key rotation requires a reviewed source update signed
by the previously trusted release path.

## Secrets that must stay outside the repository

- Ed25519 manifest private key;
- Artifact Signing/PFX credentials and tokens;
- PFX file/password, if used.

The update-feed generator reads only the private-key path from
DIALED_UPDATE_MANIFEST_PRIVATE_KEY_PATH. Never commit the private key or populate
it inside the project, output, user-data or cloud-synced workspace.

## Final release order

1. Choose/bump the release version and finalize changelog/release notes.
2. Populate and review the public dialed.update trust values.
3. Run the full source/browser gates from a clean checkout with a frozen Bun
   install.
4. Build and sign the exact setup, portable and unpacked application with signing
   required. Verify every signature and timestamp independently.
5. Set DIALED_UPDATE_INSTALLER_URL to the direct final installer URL and optionally
   DIALED_UPDATE_RELEASE_NOTES_URL.
6. Run bun run release:update-feed. It refuses an unconfigured trust set,
   mismatched private/public key, unsigned/wrong-publisher installer, missing
   timestamp, wrong host/name/size/hash or unsupported version.
7. Run bun run release:update-feed:verify. It rechecks the manifest signature,
   exact local installer bytes/hash and Authenticode publisher/timestamp.
8. Publish the installer and UPDATE_FEED.json without redirecting either pinned
   URL to an unapproved host.
9. Exercise up-to-date, older-feed/no-downgrade, tampered manifest, wrong
   host/hash/size/publisher, expired token, explicit download and explicit
   installer-launch cases from the exact accepted signed build.
10. Verify forward upgrade, retained user data, uninstall and installed version.
    Publication still requires explicit owner approval.

The installer launch is the final updater action. Dialed does not silently close
itself, install, elevate, reboot or remove the downloaded installer.
