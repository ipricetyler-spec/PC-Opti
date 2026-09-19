# Benchmark methodology

## Evidence units and saved sessions (2026-09-05)

Records declare `sampleUnit` as `FRAME`, `TRIAL` or `UNKNOWN`. Frame samples from
one capture are not independent runs. Native PresentMon pairs remain descriptive;
early/manual and legacy captures without protocol completion cannot enter comparison.

For independent run summaries, JSON declares `sampleUnit: "TRIAL"` and one unique
`trialIds` entry per sample. CSV declares `sampleUnit` and `trialId` on each row.
Use at least three runs per phase with no reused identity across phases. Independence
and controlled conditions remain user declarations. The CV rule is a descriptive
heuristic, not a significance test or causal proof.

Saved sessions connect one baseline, a successful intervening audit action and one
matched candidate. Notes and keep/recovery-review choices are local; they never apply
changes or establish benefit. Automatic native multi-run grouping is not implemented.


Dialed does not equate a changed setting or exit code with better performance.

## Minimum experiment record

Record the hardware/OS/build, power mode, game/application version, graphics settings, resolution, scene or replay, duration, warm-up procedure, background workload, driver version, ambient limitations, changes applied, and exact benchmark tool/version.

Run at least three comparable baseline trials and three post-change trials. Prefer a deterministic built-in benchmark or replay. Do not compare unrelated scenes or different thermal states.

## Metrics

- Average FPS or throughput where the tool measures it reliably.
- Median and percentile frametime; derive 1% lows only from adequate samples.
- 0.1% lows only when sample length and capture quality make them meaningful.
- Frame pacing/outlier count.
- CPU/GPU utilization, memory pressure, and temperature only from trustworthy supported sources.
- Network latency/jitter/loss only with a named endpoint, protocol, sample count, and route limitations.

## Interpretation

Report every trial, median, spread, and test limitations. Treat a difference smaller than normal run-to-run variance as inconclusive. Never generalize one machine/game/scene result to all devices.

If post-change results regress beyond expected variance, flag the result and recommend the capability's verified rollback. If state changed but performance did not, report “setting verified; no measured improvement.”

## Implemented local evidence format

Dialed accepts a bounded version `1.0.0` JSON document or CSV selected through an Electron main-process file dialog. JSON contains a `records` array. CSV uses one row per raw sample and groups rows by `experimentId` plus `phase`.

Each record requires:

- experiment ID and `BASELINE` or `CANDIDATE` phase;
- workload, benchmark tool and version, metric, unit, and whether higher or lower is favorable;
- variant and controlled-change description;
- timestamp and at least three exact non-negative finite samples;
- OS build, power mode, application version, graphics preset, resolution, scene, duration, warm-up, background workload, driver version, and ambient limitations;
- optional notes and an optional Local Audit History entry UUID for regression rollback guidance.

The import is previewed before bounded atomic local storage. The renderer never
supplies a file path. For native capture, the renderer supplies only an opaque
visible-process id and one of 10/20/30 seconds; the main process revalidates the
process and exact pinned PresentMon binary, owns the output/session arguments, and
retains the raw CSV plus provenance manifest. Dialed never generates missing
samples, injects into the target, simulates input or auto-elevates.

For each compatible pair Dialed reports raw samples, count, mean, median, minimum, maximum, sample standard deviation, coefficient of variation, raw percentage delta, and direction-adjusted delta. Core metadata and all required conditions must match. A run is `HIGH_VARIANCE` above a conservative 5% coefficient-of-variation threshold and `INCONCLUSIVE` when the measured difference does not exceed observed variation. Other results are `REGRESSION` or `MEASURED_DIFFERENCE`, never a universal gain claim.

A regression can point to a linked successful audit entry only while that entry still reports deterministic rollback available. Dialed never performs rollback automatically.

## Current status

Local JSON/CSV import, strict compatibility checks, deterministic statistical
comparison, and native PresentMon 2.5.1 capture are implemented. Native capture is
limited to a freshly revalidated visible process, fixed duration and bounded raw
file. Non-user process failures remain NEEDS_REVIEW, changed CSV hashes are
refused, and users can preview permanent deletion of one raw capture. Current-game
capture behavior remains owner-acceptance pending. Dialed still makes no universal
FPS, latency, responsiveness, or percentage-improvement claim.


## Native repeated runs and sessions (2026-09-05)

Native imports now support two captures as descriptive FRAME evidence, or6–20 captures with at least3 per phase as TRIAL evidence. Each capture contributes one run mean; raw CSV remains independently retained. Saved sessions retain the exact groups and enforce all-baselines-before-change-before-all-candidates chronology. Protocol, requested duration, application, source integrity and version must match. Independence and matched real conditions remain user declarations; the variation heuristic is not statistical significance or causation.
