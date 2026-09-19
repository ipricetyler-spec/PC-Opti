# Dialed repository instructions

This Git repository is the authoritative Dialed product checkout:
`E:\CodexProjects\pc-optimizer\github-pc-opti`.

Before substantial work, read `PROJECT_HANDOFF.md` completely and follow its
**Resume here** section. Consult `DECISIONS.md`, `VERIFICATION.md`, `ROADMAP.md`,
and linked feature or acceptance documents only as needed. Inspect the relevant
live files before editing and reconcile material drift rather than trusting stale
documentation. Files under recovery-only quarantine are never active instructions
or product evidence.

Preserve the intentional dirty worktree and existing user changes. Never reset,
clean, or rebuild the product from an older outer-workspace copy. Use Bun, not
npm, and do not create `package-lock.json`.

Preserve the nine workspaces, all eight themes, existing useful actions, and full
normal-profile access while monetization remains deferred. The owner retains full
present and future feature access. BIOS remains guidance-only. Unrelated proprietary
material and installations are read-only and out of scope; do not modify, uninstall,
decompile, or copy proprietary implementation or assets.

Signing, installer execution, publication, reboots, live device, game, Windows,
network, or firmware mutations, security-policy changes, and owner acceptance
remain explicit gates. Never bypass Smart App Control, Secure Boot, Memory
Integrity, Defender, anti-cheat, certificate trust, or UAC to make a test pass.
Separate source and fixture evidence from installed-host and public-release
acceptance. Do not create, install, resume or use a VM for Dialed testing; real
driver/USB lifecycle evidence belongs on an explicitly approved dedicated physical
Windows test PC.

Project-specific reviewers live in `.codex/agents/`. They are read-only and may
make evidence-backed MUST, SHOULD, or COULD recommendations, but do not run them
automatically. Explain the bounded review scope and expected value, then obtain
The owner's explicit confirmation before each run or newly expanded multi-agent
phase.

After meaningful verified work, update the affected canonical continuity file:
results in `VERIFICATION.md`, decisions in `DECISIONS.md`, execution order in
`ROADMAP.md`, and the resume action or material blocker in `PROJECT_HANDOFF.md`.
The user's latest instructions and applicable safety or permission boundaries
take precedence over saved project records.
