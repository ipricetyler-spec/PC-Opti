# Roadmap

This roadmap prioritizes verifiable Windows behavior and maintainability over one-click “optimizer” features.

## Next release

- [ ] Add Windows integration tests for supported Registry rollback paths in an isolated test account.
- [ ] Add a signed release pipeline for Windows artifacts and publish checksums for installers.
- [ ] Improve the local audit export so users can attach a redacted report to a bug report.
- [ ] Document supported Windows versions and known privilege limitations for each native action.

## Planned diagnostics

- [ ] Evaluate a least-privilege, separate telemetry helper for optional hardware sensors.
- [ ] Add repeatable benchmark capture guidance rather than synthetic “performance scores.”
- [ ] Surface storage and memory pressure trends with clear evidence and limitations.

## Community and maintenance

- [ ] Triage public issues using reproducible templates and severity labels.
- [ ] Publish a release note for every tagged version.
- [ ] Welcome focused pull requests that preserve the documented safety boundaries.

Items are not promises of delivery. Any action that requires elevation, affects persistent Windows configuration, or introduces a new third-party driver requires a security review first.
