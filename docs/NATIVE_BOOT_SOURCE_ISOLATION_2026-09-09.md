# Boot observation source isolation

Verdict: PASS for source diagnostic preparation; BLOCKED for the actual Windows
COM cause and further physical lifecycle testing. No real WMI reproducer or product
helper was launched. The captured failure remains OBSERVE_BOOT / COMException /
0x80004005, not an established apartment, provider, binding or release defect.

## Supported source changes

`native/hidusbf-helper/WindowsMachine.cs` now delegates its exact boot read to
`BootObservation.cs`. The production COM adapter retains the same locator, local
namespace, query, dynamic property conversion, unmodified timestamp and explicit
FinalReleaseComObject calls. There is no cache, uptime estimate, fallback, retry,
apartment switch or policy change in the production path.

The shared reader distinguishes locator resolution/creation, connection, query,
enumerator acquisition, MoveNext, Current, timestamp read, row release, enumerator
disposal, validation, and rows/service/locator release. It uses the existing bounded
stage/type/HResult protocol; no exception text, stack, paths or secrets enter that
protocol. Both server and client peer checks remain unchanged.

The old nested finally blocks could replace an earlier exception with a cleanup
exception and skip remaining releases. The reader now preserves the first exception,
its original stack and operation stage, attempts remaining cleanup once, then throws.
A cleanup-only failure also prevents a successful identity return. This fixes a
source-level diagnostic ambiguity; there is no evidence it caused the captured
physical failure. Secondary cleanup exceptions are not individually transmitted.
The existing expected-refusal exception classification remains unchanged.

Microsoft documents the locator/connection split and RCW release semantics in
[SWbemLocator](https://learn.microsoft.com/en-us/windows/win32/wmisdk/swbemlocator)
and [FinalReleaseComObject](https://learn.microsoft.com/en-us/dotnet/api/system.runtime.interopservices.marshal.finalreleasecomobject?view=net-8.0).
These references explain the operation boundaries; they do not establish this host's
root cause or justify changing its COM lifetime/apartment policy speculatively.

## Verification

- `bun test --timeout 60000`: **628 pass, 0 fail, 39 files**.
- Actual C# boot reader with a synthetic COM adapter: **117 new checks**, covering
  every operation's injected failure, repeated exact timestamps, changed boot,
  missing/ambiguous timestamps, cleanup failures, original error/stack preservation,
  and failure after earlier success without fallback. No real COM is exercised.
- Existing 91 server/client checks now include the actual boot reader with injected
  timestamp and cleanup COM failures after initial OBSERVE. The precise original
  failure reaches the client; Host returns 1; subsequent APPLY sends no bytes and
  causes no execution/journal append. Other peer/transport closure checks remain.
- Existing 114 protocol, 61 boot-recovery, 39 preview and 114 synthetic cross-language
  scope checks pass. Their scope remains source/fixture evidence.
- The fixture compiles the production Host, Broker and WindowsMachine, and the new
  read-only diagnostic entry point; its sole startup remains the closed fixture
  Program. The standalone diagnostic project/entry point was not run.

Evidence directory: `output/native-boot-source-isolation-20260909`.
`CLOSED_FIXTURE.log` records the first focused run; `BUN_TEST.log` records the full
suite. `ARTIFACT_BASELINE.json` inventories 1,047 existing files across all 11 native
candidate/package/inspection/source-evidence directories, including the latest
diagnostic package and retry capture. `RESULT.json` records final source hashes,
preservation and checks of the retry report's five referenced evidence hashes.
Only the closed fixture was built/run; no product build, signing, packaging, policy
renewal, live device/Windows operation, subagent, commit or release action ran.
Current main-app/process state was not rechecked. Signed artifacts predate this new
source; their immutable parity reports retain historical meaning only.

## Exact next step

The existing capture cannot disclose its inner failing operation retrospectively.
The actual-failure regression and supported underlying COM fix remain open. A
concrete ordinary-user read-only probe is source-prepared in
`NATIVE_BOOT_COM_REPRODUCER_SCOPE_2026-09-09.md`, requiring owner approval before
execution as directed by the attached failure report. Do not start another product
helper, preview or replacement artifact cycle. Keep the preserved policy expiry
2026-09-13T10:00:30.235Z and independent recovery/physical acceptance gates unchanged.
