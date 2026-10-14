// Independently authored, local-only guidance. Never executable firmware settings.
const REVIEWED_AT = '2026-08-27';
const REVIEW_AFTER = '2027-02-23';
const SOURCES = {
  expo: { title: 'AMD EXPO technology and overclocking limitations', url: 'https://www.amd.com/en/products/processors/technologies/expo.html' },
  xmp: { title: 'Intel XMP configuration and compatibility', url: 'https://www.intel.com/content/www/us/en/support/articles/000094616/processors.html' },
  asusMemory: { title: 'ASUS memory profiles and recovery', url: 'https://www.asus.com/us/support/faq/1042256/' },
  msiMemory: { title: 'MSI XMP / EXPO setup', url: 'https://www.msi.com/blog/how-to-speed-up-your-ram-with-overclocking-the-ultimate-guide-to-enabling-xmp-and-expo' },
  gigabyteMemory: { title: 'GIGABYTE Intel 700-series BIOS reference (menu example)', url: 'https://download.gigabyte.com/FileList/Manual/mb_manual_intel700-X-bios_e.pdf' },
  asrockMemory: { title: 'ASRock memory compatibility and recovery', url: 'https://www.asrock.com/support/faq.asp?k=xmp' },
  rebar: { title: 'ASUS Resizable BAR prerequisites and setup', url: 'https://www.asus.com/us/support/faq/1046107/' },
  nvidia: { title: 'NVIDIA Resizable BAR compatibility requirements', url: 'https://nvidia.custhelp.com/app/answers/detail/a_id/5165' },
  sam: { title: 'AMD Smart Access Memory requirements', url: 'https://www.amd.com/content/dam/amd/en/documents/partner-hub/radeon/amd-radeon-rx-6000-series-quick-reference-competitive.pdf' },
  boost: { title: 'AMD Precision Boost 2', url: 'https://www.amd.com/en/resources/support-articles/faqs/CPU-PB2.html' },
  intelDefaults: { title: 'Intel desktop stability guidance and subsequent updates', url: 'https://community.intel.com/t5/Mobile-and-Desktop-Processors/Updated-Guidance-RE-Reports-of-13th-14th-Gen-Unlocked-Desktop/m-p/1594553' },
  curve: { title: 'AMD Ryzen Master supported tuning controls', url: 'https://www.amd.com/en/products/software/ryzen-master.html' },
  curveLimits: { title: 'AMD Curve Optimizer FAQ and validation limits', url: 'https://www.amd.com/content/dam/amd/en/documents/products/software-tools/faq-curve-optimizer.pdf' },
  memoryTraining: { reviewedAt: '2026-10-10', title: 'ASUS ROG forum (moderator): memory training and Memory Context Restore on AM5', url: 'https://rog-forum.asus.com/t5/amd-800-series/understanding-memory-training-on-amd-am5-motherboards-q-code-15/td-p/1099400' },
  asusEzFlash: { reviewedAt: '2026-10-10', title: 'ASUS EZ Flash 3: updating the BIOS from inside the BIOS', url: 'https://www.asus.com/support/faq/1012815/' },
  asusFlashback: { reviewedAt: '2026-10-10', title: 'ASUS USB BIOS FlashBack: recovery when the PC will not start', url: 'https://www.asus.com/support/faq/1038568/' },
  riotTpm: { reviewedAt: '2026-10-10', title: 'Riot Games: enabling TPM 2.0 for Vanguard', url: 'https://support.riotgames.com/en-us/riot/client/enable-tpm-20' },
  riotSecureBoot: { reviewedAt: '2026-10-10', title: 'Riot Games: Secure Boot guide', url: 'https://support.riotgames.com/en-us/riot/client/secure-boot-guide' },
  riotPreCheck: { reviewedAt: '2026-10-10', title: 'Riot Games: Vanguard pre-check requirements', url: 'https://support.riotgames.com/en-us/riot/performance/vanguard-pre-check' },
  x3dTurbo: { reviewedAt: '2026-10-10', title: 'TechSpot: AMD X3D Turbo vs. Intel 200S Boost, 12 games tested (Oct 2025)', url: 'https://www.techspot.com/review/3046-amd-x3d-turbo-vs-intel-200s-boost-overclocking/' },
  recovery: { title: 'Microsoft BitLocker recovery preparation', url: 'https://learn.microsoft.com/en-us/windows/security/operating-system-security/data-protection/bitlocker/recovery-overview' },
  thermal7800: { reviewedAt: '2026-09-05', title: 'AMD Ryzen 7 7800X3D specifications (89°C Tjmax)', url: 'https://www.amd.com/en/products/processors/desktops/ryzen/7000-series/amd-ryzen-7-7800x3d.html' },
  thermal9800: { reviewedAt: '2026-09-05', title: 'AMD Ryzen 7 9800X3D specifications (95°C Tjmax)', url: 'https://www.amd.com/en/products/processors/desktops/ryzen/9000-series/amd-ryzen-7-9800x3d.html' },
  cooling: { reviewedAt: '2026-09-05', title: 'ASUS fan control modes and configuration', url: 'https://servers.asus.com/support/faq/detail/1044236' },
  scheduler: { reviewedAt: '2026-09-05', title: 'Intel Thread Director and OS scheduling', url: 'https://www.intel.com/content/www/us/en/support/articles/000097053/processors/intel-core-processors.html' },
  cppc: { reviewedAt: '2026-09-05', title: 'AMD CPPC preferred-core behavior and chipset software', url: 'https://www.amd.com/en/resources/support-articles/release-notes/RN-RYZEN-CHIPSET-3-10-08-506.html' },
  pcie: { reviewedAt: '2026-09-05', title: 'Microsoft PCI Express graphics link widths', url: 'https://learn.microsoft.com/en-us/windows-hardware/drivers/pci/pci-express-faq-for-graphics' },
};

const BOARDS = {
  asus: { name: 'ASUS', menus: {
    'memory-training': 'Ai Tweaker / Extreme Tweaker → DRAM Timing Control → Memory Context Restore. If it is not there on your BIOS version, use the BIOS search.',
    firmware: 'Press F7 for Advanced Mode, then Tool → ASUS EZ Flash 3 Utility. USB BIOS FlashBack uses a marked rear USB port and button instead; see the board manual.',
  }, memoryMenu: 'Ai Tweaker / Extreme Tweaker → Ai Overclock Tuner. Labels include EXPO, DOCP and XMP; use the exact board manual.', sourceIds: ['asusMemory'], supportUrl: 'https://www.asus.com/support/download-center/' },
  msi: { name: 'MSI', memoryMenu: 'EZ Mode → Memory / XMP / EXPO, or the OC page on older Click BIOS versions. Use the normal kit profile, not an enhanced preset.', sourceIds: ['msiMemory'], supportUrl: 'https://www.msi.com/support' },
  gigabyte: { name: 'GIGABYTE', memoryMenu: 'Look for the memory-profile setting in the exact board manual. Intel 700-series example: Extreme Memory Profile (X.M.P.). AM5 labels differ.', sourceIds: ['gigabyteMemory'], supportUrl: 'https://www.gigabyte.com/Support' },
  asrock: { name: 'ASRock', memoryMenu: 'Use the exact board manual to locate its XMP / EXPO profile control. Menu paths vary; a path is not inferred from the brand alone.', sourceIds: ['asrockMemory'], supportUrl: 'https://www.asrock.com/support/index.asp' },
};

const MEMORY_CHECKS = [
  'Match every detected RAM part number, capacity and installed module count to the exact board revision’s memory support list. Matching part numbers alone do not prove a matched kit.',
  'Confirm that the kit actually exposes this profile in BIOS/SPD. Windows memory speed does not reveal whether EXPO or XMP is enabled.',
];

// Exact model links are a convenience, not certification of a CPU/RAM/BIOS combination.
// Similar suffixes and uncertain GIGABYTE revisions intentionally use the vendor fallback.
const BOARD_MODELS = [
  { vendor: 'asus', names: ['TUF GAMING X870-PLUS WIFI'], title: 'ASUS TUF GAMING X870-PLUS WIFI manuals and support', url: 'https://www.asus.com/motherboards-components/motherboards/tuf-gaming/tuf-gaming-x870-plus-wifi/helpdesk_manual?model2Name=TUF-GAMING-X870-PLUS-WIFI' },
  { vendor: 'msi', names: ['MAG X670E TOMAHAWK WIFI', 'MAG X670E TOMAHAWK WIFI (MS-7E12)'], title: 'MSI MAG X670E TOMAHAWK WIFI support', url: 'https://us.msi.com/Motherboard/MAG-X670E-TOMAHAWK-WIFI/support' },
  { vendor: 'asrock', names: ['B650 STEEL LEGEND WIFI'], title: 'ASRock B650 Steel Legend WiFi specifications and support', url: 'https://www.asrock.com/mb/AMD/B650%20Steel%20Legend%20WiFi/' },
  { vendor: 'gigabyte', names: ['B650 AORUS ELITE AX'], revisions: ['1.0', '1.1'], title: 'GIGABYTE B650 AORUS ELITE AX rev. 1.0 / 1.1 support', url: 'https://www.gigabyte.com/Motherboard/B650-AORUS-ELITE-AX-rev-10-11/support' },
  { vendor: 'gigabyte', names: ['B650 AORUS ELITE AX'], revisions: ['1.2'], title: 'GIGABYTE B650 AORUS ELITE AX rev. 1.2 support', url: 'https://www.gigabyte.com/uk/Motherboard/B650-AORUS-ELITE-AX-rev-12/support' },
];
const MEMORY_STEPS = [
  'Record the existing profile and displayed speed before changing anything. If already using the intended stable kit profile, leave it alone.',
  'Choose the kit’s standard supported profile shown by your BIOS. Do not copy a frequency, voltage or timing from another PC, and skip enhanced/tweaked presets for this first pass.',
  'Review the BIOS save summary, change only the memory profile, then save and restart when ready. Allow the board’s documented memory-training time.',
];
const MEMORY_VERIFY = 'After reboot, compare BIOS and Windows-reported memory speed with the selected kit profile, then run a memory-error test and repeat the same games/workloads. Include cold boots and sleep/resume. A boot or faster reported speed alone does not prove stability.';
const MEMORY_UNDO = 'If unstable, restore the previous memory profile. If the PC cannot reach BIOS after its documented training time, use only the exact board manual’s recovery / clear-CMOS procedure with its power precautions. CMOS reset can also reset boot/storage settings; Windows Restore cannot undo firmware changes.';

const PROFILES = [
  {
    id: 'am5-expo', kind: 'memory', platforms: ['am5'], memoryType: 34,
    title: 'Use your RAM kit’s supported EXPO profile', risk: 'Moderate', advanced: false,
    target: 'Standard EXPO profile, only if present and supported for this board / CPU / DIMM population.',
    benefit: 'May improve memory bandwidth and memory-sensitive game performance when the kit is currently at its default profile.',
    tradeoff: 'Memory overclocking can cause boot failures, errors or data corruption and can affect warranty coverage. No fixed DDR5 speed is safe for every AM5 system.',
    checks: MEMORY_CHECKS, steps: MEMORY_STEPS, verify: MEMORY_VERIFY, undo: MEMORY_UNDO, sourceIds: ['expo'],
  },
  {
    id: 'am4-memory-profile', kind: 'memory', platforms: ['am4'], memoryType: 26,
    title: 'Use your DDR4 kit’s supported memory profile', risk: 'Moderate', advanced: false,
    target: 'The kit’s normal XMP-derived profile, often called DOCP or A-XMP on AM4; confirm the board’s terminology.',
    benefit: 'May recover the kit’s intended memory performance if it is currently using a slower standard profile.',
    tradeoff: 'Overclocking is not guaranteed stable. The CPU memory controller, BIOS, kit and module count all matter; mixing kits raises uncertainty.',
    checks: MEMORY_CHECKS, steps: MEMORY_STEPS, verify: MEMORY_VERIFY, undo: MEMORY_UNDO, sourceIds: ['asusMemory', 'asrockMemory'],
  },
  {
    id: 'intel-xmp', kind: 'memory', platforms: ['intel-12', 'intel-13', 'intel-14', 'intel-ultra-200'], memoryType: 'ddr4-or-ddr5',
    title: 'Use your RAM kit’s supported XMP profile', risk: 'Moderate', advanced: false,
    target: 'Standard XMP profile exposed by the installed kit and supported by the board; no automatic highest-speed selection.',
    benefit: 'May improve memory-sensitive workloads compared with the kit’s standard profile.',
    tradeoff: 'XMP is memory overclocking, not a guaranteed fix. It may affect warranty and stability even on an unlocked processor.',
    checks: MEMORY_CHECKS, steps: MEMORY_STEPS, verify: MEMORY_VERIFY, undo: MEMORY_UNDO, sourceIds: ['xmp'],
  },
  {
    id: 'amd-stock-boost', kind: 'cpu', platforms: ['am4', 'am5'],
    title: 'Keep normal Ryzen boost available', risk: 'Low', advanced: false,
    target: 'The CPU vendor’s standard automatic boost behavior, not a fixed all-core overclock.',
    benefit: 'Can restore normal workload-responsive boost if a previous tuning profile disabled it. Already-standard settings need no change.',
    tradeoff: 'Normal boost depends on temperature, power, power delivery and workload. More aggressive PBO is a separate overclocking choice.',
    checks: ['Check the exact CPU and board manual for the stock boost control, sometimes named Core Performance Boost. Do not confuse it with Precision Boost Overdrive.'],
    steps: ['Record existing boost and multiplier settings. If stock boost was deliberately disabled for a thermal or reliability problem, resolve that problem first.', 'Use the board’s documented stock boost setting if currently disabled; preserve cooling, thermal protection and power safeguards. Do not load all BIOS defaults just to change one control.'],
    verify: 'Compare the same workload at stock settings while observing temperature, clocks and stability. A maximum advertised boost clock is not promised on every core or workload.',
    undo: 'Restore the recorded boost control and multiplier settings; do not change unrelated firmware options.', sourceIds: ['boost'],
  },
  {
    id: 'intel-stability-baseline', kind: 'cpu', platforms: ['intel-13', 'intel-14'],
    title: 'Start with Intel’s stability baseline', risk: 'Moderate', advanced: false,
    target: 'The board vendor’s current Intel Default Settings profile for this exact CPU, with applicable firmware mitigations reviewed first.',
    benefit: 'Prioritizes stable operation before evaluating faster memory or CPU tuning.',
    tradeoff: 'Performance can be lower than an unlimited motherboard preset. An older BIOS date alone does not prove that mitigations are missing, and an update cannot be assumed to repair existing degradation.',
    checks: ['Use the exact motherboard or system model, revision and installed BIOS version to check current OEM release notes and Intel’s linked-updated guidance. Dialed does not identify microcode from the BIOS version string.'],
    steps: ['Record the existing CPU power and boost profile. Compare it with the OEM’s documented Intel Default Settings for your exact processor.', 'If different, follow the OEM’s current default-profile instructions rather than importing generic wattage/current limits. Treat any needed firmware update as a separate vendor procedure, not a button in this plan.'],
    verify: 'Recheck the selected profile in BIOS. Retest previous crashes and representative workloads; recurring instability at supported settings requires vendor support, not more voltage.',
    undo: 'Keep a record of the previous profile, but do not reinstate a known-unstable unlimited preset. Use OEM support to establish a stable supported configuration.', sourceIds: ['intelDefaults'],
  },
  {
    id: 'nvidia-rebar', kind: 'rebar', gpuVendor: 'nvidia', platforms: ['am4', 'am5', 'intel-12', 'intel-13', 'intel-14', 'intel-ultra-200'],
    title: 'Check Resizable BAR for your GeForce GPU', risk: 'Moderate', advanced: false,
    target: 'Resizable BAR enabled only after CPU, board BIOS, GPU VBIOS, driver and boot compatibility are confirmed.',
    benefit: 'Can improve supported games; it is not a universal FPS increase.',
    tradeoff: 'An incompatible boot-mode change can prevent startup. Some GPUs require a vendor firmware update; this plan does not perform or recommend a blind flash.',
    checks: ['First read NVIDIA Control Panel → System Information → Resizable BAR. If already Yes, no BIOS change is needed.', 'Confirm support for the exact GPU, motherboard and driver. The model family match is a candidate, not certification.', 'Verify Windows is already installed in UEFI mode and the OS disk uses GPT. If either is unknown or legacy, stop: do not disable CSM or convert the disk as part of this plan.'],
    steps: ['On a confirmed compatible UEFI/GPT system, locate the board’s Above 4G Decoding and Re-Size BAR controls. Record their current values.', 'Follow the exact board manual to enable Above 4G Decoding and Re-Size BAR (Enabled or Auto as documented). If that requires changing boot mode, stop and seek board-specific help.'],
    verify: 'After reboot, confirm Resizable BAR reports Yes in NVIDIA System Information and compare the same games. Do not force unsupported per-game driver flags.',
    undo: 'Restore the two recorded PCIe settings. If boot behavior changed, restore the recorded boot configuration using the exact board manual.', sourceIds: ['nvidia', 'rebar'],
  },
  {
    id: 'amd-sam', kind: 'rebar', gpuVendor: 'amd', platforms: ['am4', 'am5'],
    title: 'Check Smart Access Memory for Radeon', risk: 'Moderate', advanced: false,
    target: 'Supported Smart Access Memory / Resizable BAR configuration; retain an already working configuration.',
    benefit: 'May improve some games by changing CPU access to graphics memory; effects are game-dependent.',
    tradeoff: 'Support depends on CPU, board firmware, GPU and driver. Changing boot mode carelessly can make Windows unbootable.',
    checks: ['Read AMD Software’s Smart Access Memory status first; an enabled status needs no change.', 'Confirm the exact hardware combination against current AMD and board support documentation.', 'Verify UEFI Windows and a GPT OS disk before any board-required CSM change. Unknown or legacy boot configuration means stop, not convert automatically.'],
    steps: ['Record current Above 4G Decoding and Re-Size BAR values. Use the board manual for their locations.', 'On a confirmed supported system with compatible boot configuration, enable the documented Above 4G / Re-Size BAR controls. Do not install firmware or change security settings from this checklist.'],
    verify: 'Recheck Smart Access Memory status in AMD Software after reboot and compare identical game workloads.',
    undo: 'Restore the recorded PCIe controls. Use the board’s own recovery procedure if startup fails; Windows Restore is not a BIOS backup.', sourceIds: ['sam', 'rebar'],
  },
  {
    id: 'amd-curve-review', kind: 'advanced-cpu', platforms: ['am4', 'am5'],
    title: 'Explore PBO / Curve Optimizer with a measured baseline', risk: 'Advanced', advanced: true,
    target: 'An individually validated tuning experiment, not a shared “best” voltage or all-core offset.',
    benefit: 'Supported CPUs may trade voltage, temperature and boost behavior for a better workload-specific result.',
    tradeoff: 'Undervolting and overclocking can cause subtle errors, crashes or data corruption and affect warranty. Even identical CPU models can need different settings; X3D models have additional model-specific limits.',
    checks: ['Confirm the exact CPU supports the intended control in current AMD/OEM documentation. A Ryzen family match alone is not approval.', 'First establish stable stock CPU and memory behavior, recoverable settings, suitable cooling and a repeatable workload.'],
    steps: ['Keep an untouched stock profile. Follow AMD’s supported tuning workflow for your exact model; adjust only one control between measurements.', 'Characterize the individual CPU rather than importing offsets from another machine. Do not raise voltage or remove thermal/current protections to chase a score.'],
    verify: 'Test idle/light work, single-core and sustained work, cold boots and your games; inspect hardware-error reports. A short automatic test alone does not prove stability or benefit.',
    undo: 'Return the tuning control to its recorded stock state and repeat the baseline tests. Restore normal settings at the first sign of instability.', sourceIds: ['curve', 'curveLimits', 'expo'],
  },
  {
    id: 'am5-memory-context-restore', kind: 'memory-training', platforms: ['am5'],
    title: 'Shorten start-up with Memory Context Restore', risk: 'Moderate', advanced: false,
    target: 'Memory Context Restore enabled, only after the memory profile has trained once and proven stable.',
    benefit: 'AM5 boards re-check the memory at power-on, which can make every cold start slow. With this on, the board reuses the saved result and reaches Windows sooner. It does not change game performance.',
    tradeoff: 'It skips a check, so a memory setup that is only just stable can show up as failed starts or crashes. After changing the RAM kit or any memory setting the board needs a full re-check, which can take several minutes on the first start.',
    checks: ['Only consider this once the PC has been stable on its current memory profile, including cold starts and sleep.', 'The first start after any memory change can sit on a black screen for several minutes while the board trains the memory. That is normal; do not interrupt it.'],
    steps: ['Note the current Memory Context Restore value (often Auto).', 'Set Memory Context Restore to Enabled. Change nothing else in the same visit.', 'Save and restart. Expect one slow start while the board saves its result, then time the next cold start.'],
    verify: 'Compare cold-start time before and after, then use the PC normally for several days, including sleep and a full power-off. Any new failed start, memory error or crash means it should go back.',
    undo: 'Set Memory Context Restore back to the value you noted (or Disabled). Before changing RAM or memory settings later, turn it off first so the board retrains fully.', sourceIds: ['memoryTraining'],
  },
  {
    id: 'firmware-update-review', kind: 'firmware', platforms: ['am4', 'am5', 'intel-12', 'intel-13', 'intel-14', 'intel-ultra-200'],
    title: 'Check whether a newer BIOS is worth installing', risk: 'Moderate', advanced: false,
    target: 'The newest BIOS for this exact board model and revision, installed only when its release notes give you a reason.',
    benefit: 'Newer BIOS versions can fix memory compatibility, stability and security problems, add support for newer processors, and are what Riot recommends when Secure Boot or TPM checks fail on an otherwise correct PC.',
    tradeoff: 'An interrupted update can leave the board unable to start. An update commonly returns settings to defaults, so the memory profile, fan curves and boot settings need setting again, and BitLocker may ask for its recovery key.',
    checks: ['Compare the version and date shown above with the newest one on the support page for your exact board model and revision. Read the release notes between the two.', 'If nothing in the notes affects you and the PC is stable, there is no need to update.', 'If device encryption or BitLocker is on, have the recovery key available on another device first.'],
    steps: ['Photograph your current settings: memory profile, fan curves, boot order, Secure Boot and TPM.', 'Download the BIOS for the exact model and revision from the maker’s site only, and follow the maker’s own update tool instructions.', 'Do not power off, reset or unplug during the update. Use a UPS or avoid updating during a storm if you can.', 'Afterwards, re-apply the settings you photographed, one area at a time.'],
    verify: 'Confirm the new version in BIOS and here after a rescan. Check that the memory speed, Secure Boot and TPM read as before, then retest the games and workloads you care about.',
    undo: 'Most boards allow installing an older BIOS the same way, but some updates block going back; the release notes say so. If the PC will not start, use the board’s documented recovery feature (for example USB BIOS FlashBack) exactly as its manual describes.', sourceIds: ['asusEzFlash', 'asusFlashback', 'recovery'],
  },
  {
    id: 'anti-cheat-security', kind: 'security', platforms: ['am4', 'am5', 'intel-12', 'intel-13', 'intel-14', 'intel-ultra-200'],
    title: 'Keep TPM 2.0, Secure Boot and IOMMU on for anti-cheat', risk: 'Moderate', advanced: false,
    target: 'Firmware TPM 2.0 (AMD fTPM or Intel PTT) on, UEFI boot with Secure Boot on, and IOMMU on, as Riot Vanguard and similar anti-cheat systems require on Windows 11.',
    benefit: 'Games protected by Vanguard refuse to start without these. Some tuning guides suggest turning fTPM off to cure stutter; Riot’s advice is to update the BIOS instead, because turning it off locks you out of those games.',
    tradeoff: 'Turning Secure Boot on needs UEFI boot and a Windows drive in the newer GPT layout; switching boot mode on a drive that is not ready can stop Windows starting. Changing the TPM can make BitLocker ask for its recovery key.',
    checks: ['In Windows, run msinfo32: BIOS Mode should read UEFI and Secure Boot State should read On. Run tpm.msc: it should say the TPM is ready for use, specification version 2.0.', 'If all of these already read correctly, change nothing.', 'If BIOS Mode reads Legacy, follow Riot’s or your board maker’s conversion steps before touching the boot mode.'],
    steps: ['If the TPM is off: turn on the firmware TPM (AMD fTPM / Intel PTT), usually under Advanced or Security → Trusted Computing.', 'If Secure Boot is off and BIOS Mode is already UEFI: turn off CSM (old-style boot support) if present, then set Secure Boot to Enabled. If it is greyed out, update the BIOS first, then restore the factory Secure Boot keys; on an old BIOS, restoring keys alone can stop a current Windows from starting until Secure Boot is turned off again.', 'Turn IOMMU on (a memory protection feature, sometimes listed under AMD CBS or as VT-d) if your anti-cheat reports it missing. Save and restart.'],
    verify: 'Recheck msinfo32 and tpm.msc, then start the game. If the checks read correctly but the game still refuses, Riot’s guidance is a BIOS update for your exact board.',
    undo: 'Return each setting to the value you noted. Do not turn the TPM or Secure Boot off to chase performance.', sourceIds: ['riotTpm', 'riotSecureBoot', 'riotPreCheck', 'recovery'],
  },
  {
    id: 'am5-x3d-game-mode', kind: 'advanced-cpu', platforms: ['am5'], cpuPattern: /\b(?:7600|7800|9800)X3D\b/i,
    title: 'Try the board’s X3D gaming mode with a measured baseline', risk: 'Advanced', advanced: true,
    target: 'The board maker’s one-click X3D mode (named X3D Turbo Mode, Turbo Game Mode or similar), kept only if your own before/after runs improve.',
    benefit: 'In TechSpot’s 12-game test on a Ryzen 7 9800X3D at 1080p with an RTX 5090, the mode gave a few percent on average, more in some games (around 10% in two) and nothing measurable in others. Gains shrink when the graphics card is the limit.',
    tradeoff: 'It is an unofficial board feature, not an AMD one. On chips like the 9800X3D, the board TechSpot tested turns off SMT (two threads per core) and tightens memory timings; other makers’ versions can differ. Work that uses many threads gets slower, and tighter timings can be unstable on some hardware.',
    checks: ['Confirm in the exact board manual what this mode changes on your processor before turning it on.', 'Record a baseline first with Test a change in Measure, in the game you care about.'],
    steps: ['Note the current value, then turn the mode on. Change nothing else in the same visit.', 'Save, restart, and repeat the same measured run.'],
    verify: 'Keep it only if your own runs improve beyond normal run-to-run variation and the PC stays stable in long sessions. Check anything else you do on this PC that uses many threads.',
    undo: 'Turn the mode off again. If the PC will not start, use the board manual’s clear-CMOS procedure.', sourceIds: ['x3dTurbo'],
  },
  {
    id: 'cooling-baseline', kind: 'cooling', platforms: ['am4', 'am5', 'intel-12', 'intel-13', 'intel-14', 'intel-ultra-200'],
    title: 'Check cooling before raising any limit', risk: 'Low', advanced: false,
    target: 'Fans and pump connected and set the way your cooler and board manuals describe.',
    benefit: 'A processor that runs too hot slows itself down. Fixing cooling can bring that speed back; raising limits cannot.',
    tradeoff: 'Higher fan speeds increase noise. Pump and fan requirements differ; a generic silent or full-speed preset is not right for every header.',
    checks: ['Confirm cooler model, connected header and its documented PWM / DC mode. Use the exact board and cooler manuals; ASUS fan controls are a reference example only.', 'Compare temperatures and clocks in the same workload before concluding that cooling limits performance. Dialed has not read fan curves or thermal throttling.'],
    steps: ['Record the current curve and header modes. Check the cooler’s recommended pump behavior separately from case / CPU fans.', 'If adjustment is needed, use the documented fan-control page and retain thermal protection. Change one supported cooling control at a time.'],
    verify: 'Repeat the workload and compare sustained clocks, temperature and noise. Confirm fans / pump operate as documented, including after a cold boot.',
    undo: 'Restore the recorded curve and header mode. Shut down and seek cooler or board support if cooling fails.', sourceIds: ['cooling', 'boost'],
  },
  ...[['7800X3D', 89, 'thermal7800'], ['9800X3D', 95, 'thermal9800']].map(([model, temperature, source]) => ({
    id: `thermal-${model.toLowerCase()}`, kind: 'thermal', platforms: ['am5'], cpuModel: model,
    title: `Understand the Ryzen 7 ${model} thermal limit`, risk: 'Low', advanced: false,
    target: `AMD lists ${temperature}°C as the highest safe temperature for this exact processor. That is a limit to stay under, not a setting to change.`,
    benefit: 'Tells you what temperature is normal for your processor, instead of a number from a different model.',
    tradeoff: 'A lower deliberate temperature cap can trade sustained performance for lower heat or noise. Raising limits is not a cooling repair.',
    checks: ['Confirm the exact CPU name against the linked AMD specification. Do not generalize this temperature to other Ryzen processors.'],
    steps: ['Record any manually selected thermal cap and why it was chosen. Retain the vendor-supported protections; do not raise limits from this guide.', 'If normal workloads throttle unexpectedly, inspect cooling using the separate cooling guide before considering CPU tuning.'],
    verify: 'Compare the same workload with model-appropriate telemetry. Temperature alone does not establish whether performance or cooling is abnormal.',
    undo: 'No change is required by this reference. Restore any separately changed cooling control from its recorded prior value.', sourceIds: [source, 'boost'],
  })),
  {
    id: 'stock-scheduling', kind: 'cpu', platforms: ['am4', 'am5', 'intel-12', 'intel-13', 'intel-14', 'intel-ultra-200'],
    title: 'Leave core scheduling at its defaults', risk: 'Low', advanced: false,
    target: 'The standard settings, with the processor maker’s chipset driver installed.',
    benefit: 'Windows and the processor already pick the best cores for a game. Guides that turn cores off or pin games to cores usually undo that.',
    tradeoff: 'Which cores are best depends on the processor, the BIOS, Windows and the game. No single switch gives more FPS everywhere.',
    checks: ['AMD CPPC preferred-core behavior and Intel Thread Director are different mechanisms. Check exact-model documentation; do not infer a BIOS toggle from the CPU brand.', 'Review current vendor chipset / system support notes if scheduling problems are reproducible. The linked AMD release note documents a historical CPPC fix, not a driver version to install today.'],
    steps: ['Record existing affinity, core-disabling and scheduling overrides before comparing against the vendor’s standard configuration.', 'Keep working defaults. Do not disable efficiency cores, SMT, idle states or security features as a blanket gaming recipe.'],
    verify: 'Repeat the affected game and background workload. Compare frame pacing and responsiveness; a different core assignment alone is not a performance improvement.',
    undo: 'Restore only the recorded override changed for the comparison. Resolve persistent issues with exact-model vendor support.', sourceIds: ['scheduler', 'cppc'],
  },
  {
    id: 'pcie-link-check', kind: 'pcie', platforms: ['am4', 'am5', 'intel-12', 'intel-13', 'intel-14', 'intel-ultra-200'],
    title: 'Check the graphics card is in a full-speed slot', risk: 'Low', advanced: false,
    target: 'The connection speed (PCIe generation and number of lanes) your graphics card, processor and slot all support.',
    benefit: 'A card in the wrong slot, or sharing lanes with a drive, runs on a slower connection. This finds that before you tune anything else.',
    tradeoff: 'A long slot is not always a full-speed slot. Forcing a higher speed in the BIOS cannot add what the hardware lacks and can stop the display or the PC from starting.',
    checks: ['Read the exact board manual’s slot and lane-sharing table, including installed storage devices. Confirm the GPU’s own maximum width and generation.', 'Use the GPU vendor’s supported telemetry and compare idle with the same running workload. Dialed has not measured this link.'],
    steps: ['Record the current BIOS link setting and reported generation / width. Keep a working Auto setting unless vendor troubleshooting identifies a specific mismatch.', 'If the workload link remains below the documented combination, consult GPU / board / riser support. Do not force Gen 4 or Gen 5 universally or move hardware while powered.'],
    verify: 'Repeat the same workload after any separately reviewed vendor correction; verify stability and the reported link, then compare performance.',
    undo: 'Restore the recorded link setting using the exact board’s recovery instructions if display or boot behavior changes.', sourceIds: ['pcie'],
  },
];

function deepFreeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}
module.exports = deepFreeze({ REVIEWED_AT, REVIEW_AFTER, SOURCES, BOARDS, BOARD_MODELS, PROFILES });
