const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '../native/dialed-input-filter/phase1');
const contract = JSON.parse(fs.readFileSync(path.join(root, 'prototype-contract.json'), 'utf8'));
const source = fs.readFileSync(path.join(root, 'driver/dialed_input_filter.c'), 'utf8');
const header = fs.readFileSync(path.join(root, 'driver/dialed_input_filter.h'), 'utf8');
const inx = fs.readFileSync(path.join(root, 'driver/dialed_input_filter.inx'), 'utf8');
const project = fs.readFileSync(path.join(root, 'driver/dialed_input_filter.vcxproj'), 'utf8');
const packageJson = fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf8');
const adr = fs.readFileSync(path.join(root, 'ADR-0002-DOCUMENTED-SCHEDULING-INTERFACE.md'), 'utf8');
const ledger = fs.readFileSync(path.resolve(__dirname, '../native/dialed-input-filter/PROVENANCE_LEDGER.md'), 'utf8');

test('Phase 1 contract stays device-specific, lower-filtered and production-disabled', () => {
  assert.equal(contract.status, 'OFFLINE_SOURCE_ONLY');
  assert.equal(contract.installModel, 'PNP_FILTER');
  assert.equal(contract.packageKind, 'EXTENSION_INF');
  assert.deepEqual(contract.packageIdentity, {
    extensionId: '{97169AAC-36F0-46A3-8B47-B728E7D0A8F9}',
    extensionIdOwnershipStatus: 'UNVERIFIED_OWNER_GATE',
    extensionIdOwnershipEvidence: null,
  });
  assert.equal(contract.target.scope, 'DEVICE_SPECIFIC_USB_HID_INTERFACE');
  assert.equal(contract.target.hardwareId, null);
  assert.deepEqual(contract.target.endpointKeys, []);
  assert.deepEqual(contract.attachment, {
    directive: 'AddFilter',
    position: 'LOWER',
    level: null,
    relativeOrderDependency: false,
    classWide: false,
  });
  assert.deepEqual(contract.preAttach, {
    exactStackGraphRequired: true,
    stackGraphReviewStatus: 'NOT_RUN',
    disallowedPlacement: 'BETWEEN_HIDCLASS_AND_HID_TRANSPORT',
  });
  assert.equal(contract.requestContract.ownership, 'WDF_AUTOFORWARD_NO_QUEUE');
  assert.deepEqual(contract.requestContract.handledRequestTypes, []);
  assert.equal(contract.scheduling.status, 'BLOCKED_PENDING_DOCUMENTED_INTERFACE');
  assert.equal(contract.scheduling.consumerClaimAllowed, false);
  assert.equal(contract.gates.liveExecutionAuthorized, false);
  assert.equal(contract.gates.productionIntegrationAuthorized, false);
  assert.equal(contract.gates.signingAuthorized, false);
  assert.equal(contract.gates.installationAuthorized, false);
  assert.equal(contract.gates.restartAuthorized, false);
  assert.equal(contract.gates.securityReductionAllowed, false);
  assert.equal(contract.validation.currentHostToolchainAvailable, false);
  assert.equal(contract.validation.buildExecuted, false);
  assert.equal(contract.validation.requiresExtensionIdOwnershipEvidence, true);
  assert.equal(contract.validation.requiresExactStackGraphReview, true);
});

test('transparent KMDF source creates a filter and owns no request surface', () => {
  assert.match(header, /EVT_WDF_DRIVER_DEVICE_ADD DialedInputFilterEvtDeviceAdd/);
  assert.match(source, /WDF_DRIVER_CONFIG_INIT\(&config, DialedInputFilterEvtDeviceAdd\)/);
  assert.match(source, /WdfFdoInitSetFilter\(DeviceInit\)/);
  assert.match(source, /WdfDeviceInitSetPnpPowerEventCallbacks/);
  assert.match(source, /WdfDeviceCreate/);
  assert.doesNotMatch(source, /WdfIoQueueCreate|WdfRequest|WdfUsb|URB|IOCTL|Zw[A-Z]|IoCreateSymbolicLink|WdfDeviceCreateDeviceInterface/);
});

test('extension INF template is exact-target, declarative and deliberately unresolved', () => {
  assert.match(inx, /^Class=Extension$/m);
  assert.match(inx, /^ExtensionId=\{97169AAC-36F0-46A3-8B47-B728E7D0A8F9\}$/m);
  assert.match(inx, /^AddFilter=DialedInputFilter,0,DialedInputFilter_Lower$/m);
  assert.match(inx, /^FilterPosition=Lower$/m);
  assert.match(inx, /\$DIALED_APPROVED_HARDWARE_ID\$/);
  assert.match(inx, /\$DIALED_DRIVER_DATE\$/);
  assert.match(inx, /\$DIALED_DRIVER_VERSION\$/);
  assert.doesNotMatch(inx, /(?:UpperFilters|LowerFilters)\s*=/i);
  assert.doesNotMatch(inx, /^AddReg\s*=/mi);
});

test('WDK project is x64-only, warning-clean, unsigned and cannot package the INX', () => {
  assert.match(project, /<TargetPlatformVersion>10\.0\.28000\.2526<\/TargetPlatformVersion>/);
  assert.match(project, /<KMDF_VERSION_MINOR>33<\/KMDF_VERSION_MINOR>/);
  assert.match(project, /<TreatWarningAsError>true<\/TreatWarningAsError>/);
  assert.match(project, /<SpectreMitigation>Spectre<\/SpectreMitigation>/);
  assert.match(project, /<SignMode>Off<\/SignMode>/);
  assert.match(project, /<None Include="dialed_input_filter\.inx" \/>/);
  assert.doesNotMatch(project, /ARM64|Win32|<Inf Include=/);
});

test('prototype has no installable payload and is absent from the product package', () => {
  const forbidden = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (/\.(?:inf|sys|cat|dll|exe)$/i.test(entry.name)) forbidden.push(absolute);
    }
  };
  visit(root);
  assert.deepEqual(forbidden, []);
  assert.doesNotMatch(packageJson, /native[\\/]dialed-input-filter[\\/]phase1/i);
});

test('the documented-interface verdict is recorded and keeps scheduling blocked', () => {
  assert.equal(contract.documentedInterfaceVerdict.adr, 'ADR-0002-DOCUMENTED-SCHEDULING-INTERFACE.md');
  assert.equal(contract.documentedInterfaceVerdict.hostScheduleControlDocumented, false);
  assert.equal(contract.documentedInterfaceVerdict.bIntervalDriverChangeable, false);
  assert.equal(contract.documentedInterfaceVerdict.documentedWdfMechanismReachable, false);
  assert.equal(contract.documentedInterfaceVerdict.createsDiscouragedHidclassToTransportPlacement, false);
  assert.deepEqual(contract.documentedInterfaceVerdict.primaryEvidenceRefs, ['P-010', 'P-024']);
  assert.equal(contract.scheduling.status, 'BLOCKED_PENDING_DOCUMENTED_INTERFACE');

  for (const reference of [
    ...contract.documentedInterfaceVerdict.primaryEvidenceRefs,
    ...contract.documentedInterfaceVerdict.secondaryEvidenceRefs,
  ]) {
    assert.match(reference, /^P-[0-9]{3}$/);
    assert.ok(ledger.includes(`| ${reference} |`), `${reference} must exist in the provenance ledger`);
  }
});

test('the ADR records the exact Microsoft statement that blocks the program', () => {
  assert.match(adr, /Drivers cannot change it/);
  assert.match(adr, /ns-usbspec-_usb_endpoint_descriptor/);
  assert.match(adr, /ns-usb-_usbd_pipe_information/);
  assert.match(adr, /BLOCKED_PENDING_DOCUMENTED_INTERFACE/);
  assert.doesNotMatch(adr, /USBXHCI\.SYS patch|test.?signing|disable Memory Integrity/i);
});

test('the target-binding contract exists, is referenced and permits no schedule request', () => {
  assert.equal(contract.targetBinding.scheduleRequestPermitted, false);
  assert.equal(contract.targetBinding.nativeBehaviorProven, false);

  for (const relativePath of [
    contract.targetBinding.schema,
    contract.targetBinding.validator,
    ...contract.targetBinding.fixtures,
  ]) {
    assert.ok(fs.existsSync(path.join(root, relativePath)), relativePath);
  }
});
