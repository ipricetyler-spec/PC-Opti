# Dialed approval queue

Updated: 2026-09-02. None of these items blocks offline source/fixture work.

## A-001 — HIDUSBF commercial and automation scope

- **Verified:** the maintainer publicly permits unmodified binary/INF bundling for
  the free tool described in issue #407.
- **Open:** record the exact conclusion for Dialed's paid commercial distribution,
  automated installation and attribution/trademark wording.
- **Blocks:** copying a HIDUSBF payload into a paid/public Dialed release.

## A-002 — Upstream package/install trust

- **Verified:** reviewed AMD64_AS SYS variants have valid embedded Microsoft
  signatures.
- **Open:** the upstream INF has no catalog reference and the Setup tools are
  self-signed. Approve only a supported, independently reviewed installation path
  that preserves upstream files and Windows trust.
- **Blocks:** enabling standalone installation, repair, upgrade or removal.

## A-003 — Dedicated physical Windows test PC

- **Decision:** no VM. Do not resume the historical VirtualBox environment.
- **Open:** approve the exact physical machine, Windows build, recovery method,
  security state, device/controller, package hashes and allowed install/attach/
  restart/detach/remove actions.
- **Blocks:** claiming clean-install, security compatibility, USB behavior or
  reliable recovery.

## A-004 — App/installer/update signing

- **Open:** freeze the release source, approve the Dialed publisher identity and
  signing route, then sign and independently verify the exact app, helper,
  installer and updater artifacts.
- **Blocks:** signed release acceptance and publication; not local engineering.

## A-005 — Legal/commercial and publication approval

- **Open:** approve naming clearance, licenses/notices, privacy/support/returns,
  supported-Windows/device scope, exact claims and public publication.
- **Blocks:** public promotion or sale.

Signing, installing, restarting/rebooting, mutating live devices/Windows and
publishing always require the exact applicable approval; one approval does not
silently authorize another phase.
