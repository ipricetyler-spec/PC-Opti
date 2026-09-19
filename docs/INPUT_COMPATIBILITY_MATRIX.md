# Input compatibility and physical acceptance packet

Current product route: HIDUSBF separately installed; Dialed reads configuration and
measures selected-device Windows delivery. Driver bundling/adoption is paused.

| Class | Evidence | Still required |
| --- | --- | --- |
| DualSense Edge, previously tested owner setup | Historical configured8000 and7993/7996/7996 Windows events/s; not refreshed this pass | Record exact firmware/Windows/driver/port; dedicated physical lifecycle and independent USB/button latency |
| Standard DualSense | No current accepted physical8000 evidence | Exact identity/firmware/USB mode, supported driver/configuration and before/after tests |
| Other controllers/mice/keyboards | Inventory/checker source fixtures only unless separately recorded | Per-device supported rates and repeatable delivery; never inherit Edge support |

For each physical case record device VID/PID/interface and firmware, Windows build,
USB host/port/hub/cable, exact driver hash/signature, unchanged protection state,
requested configuration, three timestamped Windows-delivery runs, reconnect/surprise
removal/conflict/recovery outcomes. Keep unknown fields explicit. Change one variable
at a time. No driver installation or protection changes are authorized by this packet.

Independent button latency: use a GPDL-style hardware rig on an approved test device,
record its version/self-latency calibration, raw results and median/tail/spread for
matched before/after runs. Do not treat synthetic stick closure results as real stick
latency. USB transaction evidence additionally needs exact selected endpoint binding.

Public references reviewed: https://github.com/cakama3a/GPDL,
https://github.com/p0358/usb_oc-dkms, https://github.com/Jiang-lai/ds-oc-kmod.
Linux modules provide research context, not Windows production mechanisms. No code
from them has been copied into Dialed. Vendor-control research must use published
per-device APIs; no universal vendor route has been established.
