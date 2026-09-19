# Independent 8 kHz USB and latency validation

Status: procedure prepared; hardware capture and latency measurement not yet performed.

## What is already accepted

The owner-host DualSense Edge path produced three Dialed Windows-delivery results of 7,993, 7,996, and 7,996 events/s against an 8,000 Hz request. The average was 7,995 events/s, or 99.94% of the request, with a range of three events/s. This is strong evidence that Dialed and Windows are delivering the requested cadence to the selected app path.

Normal users do not need to repeat a laboratory procedure. One result within 5% of the request is sufficient for the normal ready state. The following work is a one-time product-validation gate for a supported device/driver/Windows compatibility class and must be repeated after a material driver, firmware, Windows USB-stack, or measurement-method change.

## A. USB transaction proof

Use a hardware USB protocol analyzer capable of lossless High-Speed interrupt-transfer capture. Software event counters remain corroborating evidence, not the source of truth.

Record before testing:

- controller model, VID/PID, serial or anonymized unit identifier, and firmware;
- USB speed, configuration, interface, interrupt-IN endpoint, `bInterval`, and packet size;
- host controller, physical port, cable, Windows build, HIDUSBF package hashes, PatchUSBXHCI value, and Dialed build hash;
- every other device attached to the shared filter.

Microsoft documents that a High-Speed interrupt endpoint can be scheduled in microframes and that `bInterval=1` corresponds to one 125 μs microframe. Descriptor capability alone is not traffic proof: [Microsoft USB endpoint descriptor](https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/usbspec/ns-usbspec-_usb_endpoint_descriptor).

Procedure:

1. Capture at the known baseline tier/request with the same device, port, cable, and movement fixture.
2. Capture after the reviewed 8 kHz setup and required restart/reconnect.
3. Use a repeatable stick-motion or actuator sequence long enough to exclude startup and shutdown transients.
4. Run at least ten matched baseline/candidate pairs in randomized order.
5. Count successful interrupt-IN transactions for the target endpoint only. Report capture gaps, retries, NAKs, duplicate payloads, and analyzer overflow separately.
6. Calculate transaction rate plus median, 95th, and 99th percentile inter-transaction gaps for every run.
7. Retain immutable capture files and SHA-256 hashes with the test record.

Pass for the 8 kHz USB-transaction claim requires all usable candidate runs to show sustained target-endpoint transaction cadence within ±5% of 8,000/s, no unexplained capture loss, and no material device disconnect, shared-filter drift, or USB error regression. Fresh-report cadence must be reported separately from transaction cadence if identical payloads occur.

## B. End-to-end latency proof

Use an independent physical input-to-visible-response measurement rig: a controlled actuator or electrical trigger, a photodiode or equivalent display-response sensor, and a timestamp source with substantially finer resolution than the expected difference. A game’s event counter or subjective feel is not sufficient.

Procedure:

1. Fix controller, cable, port, display mode, game/test scene, frame cap, GPU/CPU load, firmware, Windows build, and background workload.
2. Compare the supported baseline and 8 kHz configurations in randomized, blinded A/B blocks.
3. Collect enough successful samples to estimate the median and tails; start with at least 200 samples per condition and increase if the confidence interval remains wider than the observed difference.
4. Reject samples only by predefined rules such as actuator failure or missing sensor transition; report every exclusion.
5. Report median, 95th percentile, distribution, paired difference, confidence interval, and display-frame quantization.
6. Repeat on more than one controller unit before making a model-wide claim.

Pass for a lower-latency claim requires a reproducible favorable paired difference whose confidence interval excludes zero, with no material stability or error regression. The public wording must name the tested device, environment, measurement path, and magnitude; it must not imply every 8 kHz-capable device receives the same benefit.

## Claim ladder

- **Configured:** exact setting written and read back.
- **Driver ready:** required tier and post-restart preconditions reconciled.
- **Windows delivery observed:** selected-device app-path cadence close to the request.
- **USB transaction cadence verified:** hardware analyzer sees the target endpoint cadence.
- **Lower latency measured:** independent physical input-to-response test shows a reproducible improvement.

Dialed may show each achieved rung, but it must never substitute a lower rung for a higher claim.
